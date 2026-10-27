"""
wide_model.py -- the WIDE MODEL shadow (owner 10/27: "test all of these ... build it into the app").
The 10/26 research (scratchpad/wide/nfl_wide.py): every situation flag on the team and the opponent (75) plus the raw numbers behind them, one
boosted-tree model (depth 3) on "home covers", each season predicted by a fit on earlier seasons; its confident fifth read 55.6% of 665 (2013-25),
above the coin-flip ceiling, but 52.3% on one fixed fit and 51.6% time-reversed, and it mostly re-found the card's own rules. NOT a pick: this module
is the live shadow -- the model's side on every unplayed game at the newest Polymarket line, the confident ones flagged, recorded and graded by the
site (lib/tracked.js "wide"), Models -> Tracked angles "WIDE (shadow)". It becomes anything only after it holds 56%+ over about 100 confident games.
Inputs: nflverse games (schedule + results + closing lines; extra_factors._games) and data/opens.csv for the opening lines (build.py's recipe).
"""
import os, time, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
import extra_factors as xf

FIX = {"STL": "LA", "SD": "LAC", "OAK": "LV", "LAR": "LA"}
V = 1                       # bump when the features change
TOP = 0.20                  # the confident fifth
_OPENS = None
def opens_file():
    global _OPENS
    if _OPENS is None:
        o = pd.read_csv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "opens.csv")); _OPENS = o.drop_duplicates("game_id")[["game_id", "so", "to"]]
    return _OPENS

def _streak(s):
    out, k = [], 0
    for v in s.shift(1):
        if pd.isna(v) or v == 0: k = 0 if pd.isna(v) else k
        elif v > 0: k = k + 1 if k > 0 else 1
        else: k = k - 1 if k < 0 else -1
        out.append(k)
    return pd.Series(out, index=s.index)

def team_table(g, opens=None):
    """One row per team-game (played or scheduled) with the pre-game state built from the team's earlier rows of the season (scratchpad rules2/build.py)."""
    d = g[g.game_type == "REG"].copy()
    for c in ("home_team", "away_team"): d[c] = d[c].replace(FIX)
    o = opens if opens is not None else opens_file()
    d = d.merge(o, on="game_id", how="left").sort_values(["season", "week", "gameday"]).reset_index(drop=True)
    d["night"] = (d.weekday != "Sunday") | (d.gametime.fillna("13:00").astype(str) >= "19:00"); d["dome"] = d.roof.isin(["dome", "closed"])
    rows = []
    for side in ("home", "away"):
        opp = "away" if side == "home" else "home"
        rows.append(pd.DataFrame({"game_id": d.game_id, "season": d.season, "week": d.week, "team": d[f"{side}_team"], "opp": d[f"{opp}_team"], "home": side == "home",
            "pf": d[f"{side}_score"], "pa": d[f"{opp}_score"], "line": -d.spread_line if side == "home" else d.spread_line, "oline": -d.so if side == "home" else d.so,
            "total": d.total_line, "otot": d.to, "rest": d[f"{side}_rest"], "orest": d[f"{opp}_rest"], "div": d.div_game == 1, "night": d.night, "dome": d.dome,
            "qb": d[f"{side}_qb_id"] if f"{side}_qb_id" in d else np.nan}))
    T = pd.concat(rows).sort_values(["team", "season", "week"]).reset_index(drop=True)
    T["margin"] = T.pf - T.pa; T["ats"] = T.margin + T.line
    gb = T.groupby(["team", "season"])
    for c in ["ats", "margin", "pf", "pa", "line", "home", "night", "total"]: T["prev_" + c] = gb[c].shift(1)
    T["prev_qb"] = gb["qb"].shift(1); T["qbchg"] = (T.qb != T.prev_qb) & T.prev_qb.notna() & T.qb.notna()
    T["gp"] = gb.cumcount()
    T["cov"] = (T.ats > 0).astype(float).where(T.ats.notna() & (T.ats != 0)); T["win"] = (T.margin > 0).astype(float).where(T.margin != 0, .5).where(T.margin.notna())
    for c in ["cov", "win", "margin", "pf", "pa", "ats"]: T["szn_" + c] = gb[c].transform(lambda s: s.shift(1).expanding().mean())
    for c in ["ats", "margin"]: T["l3_" + c] = gb[c].transform(lambda s: s.shift(1).rolling(3).mean())
    T["atsstk"] = gb["ats"].transform(_streak); T["winstk"] = gb["margin"].transform(_streak)
    ls = T.groupby(["team", "season"]).win.mean().rename("ly_win").reset_index(); ls["season"] += 1; T = T.merge(ls, on=["team", "season"], how="left")
    T["mv"] = T.line - T.oline
    keep = ["game_id", "team"] + [c for c in T.columns if c.startswith(("prev_", "szn_", "l3_", "ly_")) or c in ("atsstk", "winstk", "qbchg", "gp", "rest")]
    O = T[keep].rename(columns={c: "o_" + c for c in keep if c != "game_id"}).rename(columns={"o_team": "opp"})
    return T.merge(O, on=["game_id", "opp"], how="left")

def features(T):
    """The 75 flags + 15 numbers of the research (nfl_wide.py), on the HOME rows of T."""
    T = T.copy(); T["rdiff"] = T.rest - T.orest; L = T.line; C = {}
    def add(name, mask): C[name] = mask.fillna(False).values.astype(np.int8)
    add("home", T.home.astype(bool)); add("road", ~T.home.astype(bool)); add("fav", L < 0); add("dog", L > 0)
    for a, b in [(-99, -10), (-9.5, -7), (-6.5, -3.5), (-3, -0.5), (0.5, 3), (3.5, 6.5), (7, 9.5), (10, 99)]: add(f"line[{a},{b}]", (L >= a) & (L <= b))
    for a, b in [(0, 38), (38.5, 43), (43.5, 47), (47.5, 99)]: add(f"tot[{a},{b}]", (T.total >= a) & (T.total <= b))
    add("rest-3", T.rdiff <= -3); add("rest+3", T.rdiff >= 3); add("rest0", T.rdiff == 0)
    add("div", T["div"].astype(bool)); add("night", T.night.astype(bool)); add("dome", T.dome.astype(bool))
    hm = T.home.astype(bool)
    for p in ("", "o_"):
        pa = T[p + "prev_ats"]
        for a, b in [(-99, -21), (-20.5, -10), (-9.5, 0), (0.5, 10), (10.5, 20), (20.5, 99)]: add(f"{p}pats[{a},{b}]", (pa >= a) & (pa <= b))
        pm = T[p + "prev_margin"]; add(f"{p}lostby17", pm <= -17); add(f"{p}wonby17", pm >= 17)
        add(f"{p}pf<=10", T[p + "prev_pf"] <= 10); add(f"{p}pf>=35", T[p + "prev_pf"] >= 35); add(f"{p}pa>=35", T[p + "prev_pa"] >= 35)
        gp = T[p + "gp"] >= 4; sc = T[p + "szn_cov"]; add(f"{p}cov<=.3", gp & (sc <= .3)); add(f"{p}cov>=.7", gp & (sc >= .7))
        sm = T[p + "szn_margin"]; add(f"{p}mar<=-7", gp & (sm <= -7)); add(f"{p}mar>=7", gp & (sm >= 7))
        add(f"{p}atsstk<=-3", T[p + "atsstk"] <= -3); add(f"{p}atsstk>=3", T[p + "atsstk"] >= 3)
        add(f"{p}winstk<=-3", T[p + "winstk"] <= -3); add(f"{p}winstk>=3", T[p + "winstk"] >= 3)
        add(f"{p}qbchg", T[p + "qbchg"] == True); add(f"{p}prevnight", T[p + "prev_night"] == True)
        add(f"{p}2ndroad", (T[p + "prev_home"] == False) & ((~hm) if p == "" else hm))
    w = T.week; add("wk1-4", w <= 4); add("wk5-9", (w >= 5) & (w <= 9)); add("wk10-13", (w >= 10) & (w <= 13)); add("wk14+", w >= 14)
    add("ly>=.65", (w <= 6) & (T.ly_win >= .65)); add("ly<=.35", (w <= 6) & (T.ly_win <= .35))
    add("mvToward", T.mv <= -1); add("mvAway", T.mv >= 1); add("mvNone", T.mv.abs() < .5)
    F = pd.DataFrame(C, index=T.index)
    NUM = pd.DataFrame({"line": T.line, "total": T.total, "rdiff": T.rdiff, "prev_ats": T.prev_ats, "o_prev_ats": T.o_prev_ats, "prev_margin": T.prev_margin, "o_prev_margin": T.o_prev_margin,
                        "szn_cov": T.szn_cov, "o_szn_cov": T.o_szn_cov, "szn_margin": T.szn_margin, "o_szn_margin": T.o_szn_margin, "mv": T.mv, "week": T.week, "l3_ats": T.l3_ats, "l3_margin": T.l3_margin}, index=T.index).fillna(0)
    return np.hstack([F.values.astype(np.float32), NUM.values.astype(np.float32)]), list(F.columns) + list(NUM.columns)

def _learner(): return HistGradientBoostingClassifier(max_iter=150, learning_rate=0.03, max_depth=3, min_samples_leaf=150, l2_regularization=10)

_CACHE = {"key": None, "fit": None}
def fit(g, opens=None, cur=None):
    """One fit on every played game with a closing line (1999 .. now) + the confident threshold = the top-fifth cut of OUT-OF-SAMPLE
    confidence over the last three full seasons (each predicted by a fit on the seasons before it). Cached per played-game count."""
    T = team_table(g, opens); H = T[T.home.astype(bool) & T.line.notna() & T.margin.notna() & (T.season >= 1999)].copy()
    if cur is not None: H = H[H.season <= cur]
    key = (len(H), int(H.season.max()) if len(H) else 0, V)
    if _CACHE["key"] == key: return _CACHE["fit"]
    X, names = features(H); y = np.where(H.ats.values > 0, 1, 0); ok = H.ats.values != 0; season = H.season.values
    confs = []
    last = int(H.season.max())
    for s in (last - 2, last - 1, last):   # out-of-sample confidence for the threshold
        tr = ok & (season < s); te = season == s
        if tr.sum() < 1500 or te.sum() < 50: continue
        m = _learner().fit(X[tr], y[tr]); confs.append(np.abs(m.predict_proba(X[te])[:, 1] - 0.5))
    thr = float(np.quantile(np.concatenate(confs), 1 - TOP)) if confs else 0.08
    m = _learner().fit(X[ok], y[ok])
    out = {"model": m, "thr": thr, "n": int(ok.sum()), "seasons": [int(season.min()), last], "names": names, "T": T, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    _CACHE.update(key=key, fit=out); return out

def picks(games, g=None, opens=None):
    """games: [{game, season, week, away, home, homeSpread (negative = home favored), total, openHomeSpread, openTotal}] -> the model's side per game."""
    g = g if g is not None else xf._games(); f = fit(g, opens); T = f["T"]; out = {}
    for q in games:
        try:
            home, away = FIX.get(q["home"], q["home"]), FIX.get(q["away"], q["away"]); s, w = int(q["season"]), int(q["week"])
            row = T[(T.season == s) & (T.week == w) & (T.team == home) & (T.opp == away) & T.home.astype(bool)]
            if not len(row): out[q["game"]] = {"error": "not on the schedule"}; continue
            r = row.iloc[[0]].copy(); hs = float(q["homeSpread"]); tl = float(q["total"]) if q.get("total") is not None else np.nan
            so = q.get("openHomeSpread"); to = q.get("openTotal")
            r["line"] = hs; r["total"] = tl; r["oline"] = float(so) if so is not None else hs; r["otot"] = float(to) if to is not None else tl; r["mv"] = r.line - r.oline
            X, _ = features(r); p = float(f["model"].predict_proba(X)[0, 1]); conf = abs(p - 0.5)
            out[q["game"]] = {"team": home if p >= 0.5 else away, "line": hs if p >= 0.5 else -hs, "p": round(p, 4), "conf": round(conf, 4), "confident": bool(conf >= f["thr"]), "thr": round(f["thr"], 4)}
        except Exception as e: out[q["game"]] = {"error": str(e)[:120]}
    return {"games": out, "thr": round(f["thr"], 4), "fitGames": f["n"], "seasons": f["seasons"], "v": V, "builtAt": f["builtAt"]}
