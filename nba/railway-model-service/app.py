#!/usr/bin/env python3
"""
app.py — the NBA model service (Railway). A thin Flask wrapper around live.py / daily_rebuild.py.

Endpoints:
  GET  /health
  POST /slate        body: {"games": [{"away":"LAC","home":"TOR","date":"2026-10-20","home_spread":-4.5,"total":220.5,
                                       "ml":{"home":0.62,"away":0.40},"alts":[{"team":"TOR","line":-1.5,"price":0.58}],
                                       "total_alts":[{"line":216.5,"over":0.53,"under":0.47}],
                                       "injuries":{"home":[{"name":"..","status":"Out"}],"away":[...]}}]}
  GET  /models       accuracy report + pattern summary + last rebuild status (the site's Models tab)
  GET  /combo-table  every pattern kept (the site shows them and checks picks against them)
  POST /rebuild      run the daily rebuild now
"""
import hmac, json, os, threading
import pandas as pd
from flask import Flask, request, jsonify

import daily_rebuild, live, nba_injuries, season_sim, time, traceback
import nba_data as nd

app = Flask(__name__)
TOKEN = os.environ.get("MODEL_SERVICE_TOKEN", "").strip()
_engine = {"e": None, "err": None, "loading": False}


@app.before_request
def _auth():
    if request.path == "/health":
        return None
    if not TOKEN:                                   # never open: without a token nothing but /health answers
        return jsonify({"ok": False, "error": "MODEL_SERVICE_TOKEN not set"}), 503
    if not hmac.compare_digest(request.headers.get("X-Model-Token", "").strip(), TOKEN):
        return jsonify({"ok": False, "error": "unauthorized"}), 401


def engine(wait=True):
    if _engine["e"] is None and not _engine["loading"]:
        _engine["loading"] = True
        def go():
            try:
                _engine["e"] = live.Engine().load()
                _engine["err"] = None
            except Exception as ex:   # noqa
                _engine["err"] = str(ex)
            finally:
                _engine["loading"] = False
        t = threading.Thread(target=go, daemon=True); t.start()
        if wait:
            t.join()
    return _engine["e"]


def _reload():
    e = _engine["e"]
    if e is None:
        return
    try:
        e.reload_files(); e.load(); _engine["err"] = None
    except Exception as ex:                          # the engine keeps serving what it had; the failure is visible on /health
        _engine["err"] = f"reload failed: {ex}"[:200]
        traceback.print_exc()


def start_background():
    """Start loading the model and (on a first deploy with nothing published) the first rebuild.
    Called from INSIDE the gunicorn worker (gunicorn.conf.py post_fork). Threads started while gunicorn --preload imports this
    file would die when the worker is forked and leave "model is still loading" stuck forever, so nothing starts at import."""
    if os.environ.get("PRELOAD_ENGINE", "1") == "1":
        engine(wait=False)
    if os.environ.get("FUTURES_ON_START", "1") == "1":
        age = season_sim.live_age_hours()
        if age is None or age > 24:
            threading.Thread(target=lambda: (time.sleep(90), _futures_job()), daemon=True).start()
    if os.environ.get("PROPS_ON_START", "1") == "1" and nba_prop_model.load_live() is None:   # 10/20: the prop model, built once in the background when missing
        threading.Thread(target=lambda: (time.sleep(240), _prop_build_bg()), daemon=True).start()
    if daily_rebuild.needs_rebuild(daily_rebuild.status()) and os.environ.get("REBUILD_ON_START", "1") == "1":   # first deploy, or a build from older code
        threading.Thread(target=lambda: (__import__("time").sleep(180), daily_rebuild.run(), _reload()), daemon=True).start()


@app.route("/health")
def health():
    s = daily_rebuild.status() or {}
    try:
        lines = _engine["e"].lines_this_season() if _engine["e"] is not None and getattr(_engine["e"], "g", None) is not None else None
    except Exception:
        lines = None
    return jsonify({"ok": True, "engine": _engine["e"] is not None, "loading": _engine["loading"], "error": _engine["err"],
                    "rebuild": s, "rebuilding": daily_rebuild.STATE["running"], "lines": lines, "stale": dict(nd.STALE)})


@app.route("/slate", methods=["POST"])
def slate():
    body = request.get_json(force=True, silent=True) or {}
    games = body.get("games") or []
    bad = [g for g in games if not isinstance(g, dict) or g.get("away") not in live.TEAMS or g.get("home") not in live.TEAMS]
    if bad:
        return jsonify({"ok": False, "error": "unknown team", "games": bad}), 400
    e = engine(wait=False)          # loading or failed: 503 at once, never a minutes-long wait inside the request
    if e is None:
        return jsonify({"ok": False, "error": _engine["err"] or "model is still loading"}), 503

    try:
        return jsonify({"ok": True, "games": e.slate(games), "builtAt": e.loaded_at, "fitThrough": e.coefs.get("fit_through"), "seasonStart": e.season_start,
                        "patternsBuilt": e.table.get("built")})
    except Exception as ex:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "error": str(ex)}), 500


_inj = {"t": 0, "v": None}


@app.route("/injuries")
def injuries():
    """The NBA's own latest injury report, by game day: {dates: {YYYY-MM-DD: {ABBR: [{name, status, reason}]}}}. 5-minute copy.
    502 when the report can't be fetched or read (the site then falls back to ESPN)."""
    if _inj["v"] is None or time.time() - _inj["t"] > 300:
        _inj["v"], _inj["t"] = nba_injuries.latest(), time.time()
    r = _inj["v"]
    if "rows" not in r:
        return jsonify({"ok": False, "error": r.get("error", "no report"), "url": r.get("url")}), 502
    by = {}
    for row in r["rows"]:
        try:
            d = pd.to_datetime(row["Game Date"], format="%m/%d/%Y").date().isoformat()
        except Exception:
            continue
        by.setdefault(d, []).append(row)
    return jsonify({"ok": True, "source": "nba-official", "asOf": r["asOf"], "method": r["method"], "url": r["url"],
                    "dates": {d: nba_injuries.teams_from_rows(rows) for d, rows in by.items()}})


@app.route("/models")
def models():
    d = live.MODEL_DIR
    def load(n):
        p = os.path.join(d, n)
        return json.load(open(p if os.path.exists(p) else os.path.join(live.DATA, n)))
    pat = load("combo_summary.json")
    try:      # honest leave-one-season-out rates (measured once, shipped in the repo) always win over a copy the volume's older summary carries
        hu = json.load(open(os.path.join(live.DATA, "honest_unseen.json")))
        for k, v in pat.get("kinds", {}).items():
            if k in hu: v["unseen"] = hu[k]
    except Exception:
        pass
    return jsonify({"ok": True, "report": load("model_report.json"), "patterns": pat, "status": daily_rebuild.status()})


@app.route("/combo-table")
def combo_table():
    e = engine(wait=False)          # loading or failed: 503 at once, never a minutes-long wait inside the request
    return jsonify({"ok": True, **(e.table if e else live._load("combo_table.json"))})


_fut = {"running": False}


def _futures_job(force_backtest=False):
    if _fut["running"]:
        return
    _fut["running"] = True
    try:
        have_report = any(os.path.exists(os.path.join(d, "futures_report.json")) for d in (season_sim.DATA, live.DATA))
        if force_backtest or not have_report:
            try:
                season_sim.refresh_backtest()
            except Exception as ex:   # noqa
                print("[futures] backtest failed:", str(ex)[:200], flush=True)
        season_sim.refresh_live()
    except Exception as ex:   # noqa
        print("[futures] simulation failed:", str(ex)[:200], flush=True)
    finally:
        _fut["running"] = False


@app.route("/futures")
def futures():
    """Season simulation (wins, playoffs, seeds, conference and title chances) + how well it did on past seasons."""
    d = season_sim.load_live()
    age = season_sim.live_age_hours()
    if d is None or (age is not None and age > 30):
        threading.Thread(target=_futures_job, daemon=True).start()
    if d is None:
        return jsonify({"ok": False, "loading": True, "error": "the season simulation is still being built"}), 202
    rep = os.path.join(season_sim.DATA, "futures_report.json")
    rep = json.load(open(rep if os.path.exists(rep) else os.path.join(live.DATA, "futures_report.json")))
    return jsonify({"ok": True, **d, "report": rep, "stale_hours": None if age is None else round(age, 1)})


# ---- Player props (10/20, owner: "Player props" page, both sports) ----
# nba_prop_model.py: built in the background when the saved model is missing (a few minutes), refit daily by the scheduler (4:20 AM PT).
import nba_prop_model
_PROP_BUILD = {"running": False}


def _prop_build_bg():
    if _PROP_BUILD["running"]:
        return
    _PROP_BUILD["running"] = True
    def go():
        try: nba_prop_model.build_live(log=lambda m: print(m, flush=True))
        except Exception as e: print(f"[nba props] build failed: {e}", flush=True)
        finally: _PROP_BUILD["running"] = False
    threading.Thread(target=go, daemon=True).start()


@app.route("/prop-probs", methods=["POST"])
def prop_probs():
    """body: {"games": [{"away","home","outs":[names],"lines":[{"name","stat","line"}]}]} -> {"ok","built","results":[{"game","rows":[{name,team,stat,line,mu,over,under}]}]}.
    503 with "building" while the model is still being built."""
    try:
        if nba_prop_model.load_live() is None:
            _prop_build_bg(); return jsonify({"ok": False, "error": "prop model not built yet", "building": True}), 503
        body = request.get_json(force=True, silent=True) or {}
        res = nba_prop_model.chances_many(body.get("games") or [])
        return jsonify({"ok": True, "built": nba_prop_model._LIVE.get("built"), "results": res})
    except Exception as ex:
        return jsonify({"ok": False, "error": str(ex)}), 500


@app.route("/build-props", methods=["POST"])
def build_props():
    _prop_build_bg(); return jsonify({"ok": True, "note": "started" if _PROP_BUILD["running"] else "already running"})


@app.route("/rebuild", methods=["POST"])
def rebuild():
    if daily_rebuild.STATE["running"]:
        return jsonify({"ok": False, "error": "already running"}), 409
    def go():
        daily_rebuild.run(); _reload()
    threading.Thread(target=go, daemon=True).start()
    return jsonify({"ok": True, "started": True})


if __name__ == "__main__":
    start_background()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
