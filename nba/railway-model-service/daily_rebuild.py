#!/usr/bin/env python3
"""
daily_rebuild.py — NBA only. The automatic rebuild (scheduler: every day 4 AM PT).

  1. Re-download the current season's box scores / schedule and the closing-line file.
  2. Walk-forward ratings for every season (past seasons cached, the current one redone).
  3. Refit the margin / total / win-chance numbers and rewrite the accuracy report (fit_model.py).
  4. Re-scan every pattern alone and in pairs, kept only if it beats the break-even rate in all three periods (combo_study.py),
     with the shuffled-outcome false-discovery check.
  5. Publish only if the checks pass. Otherwise the previous files stay and the reason is saved in status.json.

Output (MODEL_DIR, default ./data): model_coefs.json, model_report.json, combo_table.json, combo_summary.json, status.json
"""
import json, os, shutil, tempfile, threading, time, traceback
import numpy as np, pandas as pd

import nba_data as nd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("MODEL_DIR", os.path.join(HERE, "data"))
FILES = ["model_coefs.json", "model_report.json", "combo_table.json", "combo_summary.json"]
OPTIONAL = ["injury_weights.json"]          # published when there is enough injury-report history to fit it
_LOCK = threading.Lock()
STATE = {"running": False}
# Rebuild on deploy (the NFL app's idea, 10/16): the published build carries this tag; when the service starts with a build made by older
# rebuild code (a different tag) it rebuilds right away instead of waiting for 4 AM, so a merge that changes the model is live the same hour.
BUILD_TAG = "2026-10-16 early-season rotation blend, scan to the current season, schedule rest"


def needs_rebuild(status):
    """True when nothing is published yet, or the published build was made by other rebuild code."""
    return status is None or status.get("tag") != BUILD_TAG


def _log(*a):
    print("[rebuild]", *a, flush=True)


def status():
    f = os.path.join(OUT, "status.json")
    return json.load(open(f)) if os.path.exists(f) else None


def _save_status(s):
    os.makedirs(OUT, exist_ok=True)
    f = os.path.join(OUT, "status.json")
    json.dump(s, open(f + ".new", "w"), indent=1)
    os.replace(f + ".new", f)                        # never a half-written file under a /health read


def freshness_checks(coefs, sch=None):
    """The box-score release can stop or be renamed while the schedule keeps marking games final: the fit must reach them."""
    try:
        sch = nd.schedule(nd.current_season()) if sch is None else sch
        if sch is None or not len(sch):
            return []
        fin = sch[(sch.season_type == 2) & (sch.status_type_name.astype(str) == "STATUS_FINAL")]
        if not len(fin):
            return []
        last_final = pd.to_datetime(fin.game_date).max()
        if (last_final - pd.Timestamp(coefs["fit_through"])).days > 3:
            return [f"box scores stop at {coefs['fit_through']} but the schedule has finals through {last_final.date()}"]
    except Exception as e:
        print("[rebuild] freshness check failed:", e, flush=True)
    return []


def weight_checks(weights):
    """Fitted status weights must make sense: Out ~ always sits, Questionable somewhere in between."""
    bad = []
    w = (weights or {}).get("weights", {})
    if "out" in w and not (0.8 <= w["out"] <= 1.0):
        bad.append(f"fitted weight for Out is {w['out']} (expected 0.8-1.0): the report parse looks wrong")
    for st in ("questionable", "doubtful", "probable"):
        if st in w and not (0.0 <= w[st] <= 1.0):
            bad.append(f"fitted weight for {st} is {w[st]}")
    if "out" in w and "probable" in w and w["probable"] > w["out"]:
        bad.append("Probable sits more often than Out: the report parse looks wrong")
    return bad


def checks(coefs, report, table, summary, previous_report=None):
    """Return a list of failed-check messages (empty = publish)."""
    bad = []
    rows = {r["model"]: r for r in report["rows"]}
    sp = rows["Spread (margin)"]
    if not (8.0 < sp["ours"] < 11.5):
        bad.append(f"spread accuracy looks wrong ({sp['ours']} points)")
    if sp["ours_same_games"] - sp["market"] > 0.8:
        bad.append(f"model is {sp['ours_same_games'] - sp['market']:.2f} points worse than the market (limit 0.8)")
    # only comparable when both builds measured the injury effect the same way (a different basis means a different test set)
    if previous_report and previous_report.get("injury_basis") == report.get("injury_basis"):
        old = {r["model"]: r for r in previous_report["rows"]}["Spread (margin)"]["ours"]
        if sp["ours"] - old > 0.3:
            bad.append(f"spread accuracy got worse: {old} -> {sp['ours']}")
    # a fit on the official injury reports can only use the seasons since they were kept (2021-22 on): about 6,000 games, not 21,000
    need = 5000 if "official" in str(coefs.get("injury_basis", "")) else 20000
    if not coefs["games"] > need:
        bad.append(f"only {coefs['games']} games in the fit (need {need}+)")
    if not (0.7 < coefs["margin"]["coef"][0] < 1.1):
        bad.append(f"ratings weight {coefs['margin']['coef'][0]:.2f} outside 0.7-1.1")
    if len(table["table"]) < 5:
        bad.append(f"only {len(table['table'])} patterns kept")
    if any(r[2] < 52.4 for r in table["table"]):
        bad.append("a kept pattern is below break-even")
    if any(min(r[5]) < 60 for r in table["table"]):
        bad.append("a kept pattern has fewer than 60 games in a period")
    last = pd.Timestamp(coefs["fit_through"])
    if (pd.Timestamp.today() - last).days > 240:
        bad.append(f"data stops at {last.date()}")
    return bad


def run(null_runs=20):
    if not _LOCK.acquire(blocking=False):
        return {"ok": False, "error": "a rebuild is already running"}
    STATE["running"] = True
    t0 = time.time()
    try:
        import fit_model, combo_study as cs
        tmp = tempfile.mkdtemp(prefix="nba_rebuild_")
        # fit_model / combo_study write into their own data dir; redirect them to a scratch folder first
        fit_model.DATA = tmp
        os.makedirs(tmp, exist_ok=True)
        nd.odds_file(fresh=True)
        import nba_injuries as ni, nba_features as nf
        _log("data refreshed; loading injury-report history")
        hist = ni.history(max_seconds=int(os.environ.get("INJURY_HISTORY_SECONDS", "900")))
        days = sum(1 for v in hist.values() if v)
        weights = None
        if days >= 50:
            weights = ni.fit_weights(hist, nf.player_games(range(2021, nd.current_season() + 1)))
            json.dump(weights, open(os.path.join(tmp, "injury_weights.json"), "w"), indent=1)
        _log(f"injury reports: {days} game days; weights: {(weights or {}).get('weights')}")
        _log("fitting model")
        coefs, report = fit_model.main(hist, weights)
        _log("scanning patterns")
        res, sr, gr, summary = cs.run(null_runs)
        table = cs.write_table(res, summary, path_dir=tmp)
        prev = None
        pf = os.path.join(OUT, "model_report.json")
        if os.path.exists(pf):
            prev = json.load(open(pf))
        bad = checks(coefs, report, table, summary, prev) + weight_checks(weights) + freshness_checks(coefs)
        s = {"at": pd.Timestamp.now().isoformat(), "tag": BUILD_TAG, "seconds": round(time.time() - t0), "patterns": len(table["table"]), "published": not bad,
             "failed_checks": bad, "fit_through": coefs["fit_through"], "games": coefs["games"], "injury_days": days,
             "injury_basis": coefs.get("injury_basis"), "status_weights": (weights or {}).get("weights"), "stale_files": dict(nd.STALE)}
        if not bad:
            os.makedirs(OUT, exist_ok=True)
            for f in FILES + [o for o in OPTIONAL if os.path.exists(os.path.join(tmp, o))]:
                shutil.copy(os.path.join(tmp, f), os.path.join(OUT, f + ".new"))
                os.replace(os.path.join(OUT, f + ".new"), os.path.join(OUT, f))
            _log("published", s)
        else:
            _log("NOT published:", bad)
        _save_status(s)
        shutil.rmtree(tmp, ignore_errors=True)
        return {"ok": True, **s}
    except Exception as e:
        traceback.print_exc()
        s = {"at": pd.Timestamp.now().isoformat(), "published": False, "failed_checks": [f"rebuild crashed: {e}"]}
        _save_status(s)
        return {"ok": False, **s}
    finally:
        STATE["running"] = False
        _LOCK.release()


def start_async():
    threading.Thread(target=run, daemon=True).start()


if __name__ == "__main__":
    print(json.dumps(run(), indent=1))
