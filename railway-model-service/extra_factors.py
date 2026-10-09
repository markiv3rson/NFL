"""
extra_factors.py -- game factors for the site's combo picks (10/9) that the site can't work out itself:
coach records, team age, QB rushing, rest, travel, a points-based total and the 5 stats models' leans.
Every number uses only games played before the one being scored (same as the 2014-25 scan that picked the combos).
"""
import os, time, threading, pickle
import numpy as np, pandas as pd
import season as _season

CACHE = os.path.expanduser("~/.nfl_cache")
BASE = _season.BASE
SCHED_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
TZ = {"SEA": -3, "SF": -3, "LA": -3, "LAC": -3, "LV": -3, "OAK": -3, "SD": -3, "STL": -1, "ARI": -2, "DEN": -2, "KC": -1, "DAL": -1, "HOU": -1,
      "MIN": -1, "CHI": -1, "GB": -1, "NO": -1, "TEN": -1}
ST = ["epa", "sr", "pepa", "repa", "eepa", "gepa", "exp", "to", "sack", "cpoe", "rzr", "ppd", "plays", "pts"]
_LOCK = threading.Lock()
_mem = {}

def _games():
    f = os.path.join(CACHE, "games_live.csv")
    if not os.path.exists(f) or time.time() - os.path.getmtime(f) > 6 * 3600:
        try: _season.download(SCHED_URL, f)
        except Exception:
            if not os.path.exists(f): f = os.path.join(CACHE, "games.csv")
    g = pd.read_csv(f); g["gameday"] = pd.to_datetime(g.gameday)
    return g[g.game_type == "REG"].copy()

def _pbp(y):
    f = os.path.join(CACHE, f"pbp_{y}.parquet")
    if not os.path.exists(f) or (y >= _season.data_season() and time.time() - os.path.getmtime(f) > 6 * 3600):
        _season.download(f"{BASE}/pbp/play_by_play_{y}.parquet", f)
    return f

def _team_games(y):
    """Per team-game offensive stats for one season (past seasons cached to disk)."""
    out = os.path.join(CACHE, f"xf_tg_{y}.parquet")
    cur = y >= _season.data_season()
    if os.path.exists(out) and not cur: return pd.read_parquet(out)
    cols = ["game_id", "season", "season_type", "week", "posteam", "defteam", "epa", "success", "pass", "rush", "down", "yardline_100", "touchdown",
            "interception", "fumble_lost", "yards_gained", "play_type", "wp", "drive", "cpoe", "sack"]
    p = pd.read_parquet(_pbp(y), columns=cols)
    p = p[(p.season_type == "REG") & p.play_type.isin(["pass", "run"]) & p.epa.notna() & p.posteam.notna()]
    p["early"] = p.down.isin([1, 2]); p["exp"] = ((p["pass"] == 1) & (p.yards_gained >= 20)) | ((p.rush == 1) & (p.yards_gained >= 10))
    p["to"] = p.interception.fillna(0) + p.fumble_lost.fillna(0); p["gb"] = (p.wp > .1) & (p.wp < .9); p["rz"] = p.yardline_100 <= 20
    a = p.groupby(["game_id", "season", "week", "posteam", "defteam"]).agg(plays=("epa", "size"), epa=("epa", "mean"), sr=("success", "mean"), to=("to", "sum"),
        exp=("exp", "mean"), sack=("sack", "mean"), cpoe=("cpoe", "mean")).reset_index()
    for nm, m in [("pepa", p["pass"] == 1), ("repa", p.rush == 1), ("eepa", p.early), ("gepa", p.gb)]:
        a = a.merge(p[m].groupby(["game_id", "posteam"]).epa.mean().rename(nm).reset_index(), on=["game_id", "posteam"], how="left")
    rz = p[p.rz].groupby(["game_id", "posteam"]).agg(rzp=("epa", "size"), rztd=("touchdown", "sum")).reset_index()
    a = a.merge(rz, on=["game_id", "posteam"], how="left").fillna({"rzp": 0, "rztd": 0})
    dr = p.drop_duplicates(["game_id", "posteam", "drive"]).groupby(["game_id", "posteam"]).size().rename("drives").reset_index()
    a = a.merge(dr, on=["game_id", "posteam"], how="left")
    a.to_parquet(out); return a

def _ratings(g, last):
    """EWMA offense/defense ratings before every game (1/3 regression to the mean at each new season), and after the last one."""
    tg = pd.concat([_team_games(y) for y in range(2012, last + 1)])
    tg = tg.merge(g[["game_id", "gameday"]], on="game_id")
    sc = pd.concat([g[["game_id", "home_team", "home_score"]].rename(columns={"home_team": "posteam", "home_score": "pts"}),
                    g[["game_id", "away_team", "away_score"]].rename(columns={"away_team": "posteam", "away_score": "pts"})])
    tg = tg.merge(sc, on=["game_id", "posteam"], how="left")
    tg["rzr"] = tg.rztd / tg.rzp.replace(0, np.nan); tg["ppd"] = tg.pts / tg.drives
    M = tg[ST].mean().to_dict()
    def run(key):
        res, now = {}, {}
        for t, T in tg.sort_values("gameday").groupby(key):
            prev, last_s = None, None
            for r in T.itertuples():
                if prev is not None and r.season != last_s: prev = {k: v * 0.67 + M[k] * 0.33 for k, v in prev.items()}
                res[(r.game_id, t)] = dict(prev) if prev else None
                cur = {k: getattr(r, k) for k in ST}
                prev = cur if prev is None else {k: prev[k] * 0.85 + (cur[k] if pd.notna(cur[k]) else prev[k]) * 0.15 for k in ST}
                last_s = r.season
            now[t] = (prev, last_s)
        return res, now
    O, On = run("posteam"); D, Dn = run("defteam")
    return O, D, On, Dn, M

def _row(f, o_h, d_a, o_a, d_h):
    for k in ST:
        f[f"m_{k}"] = (o_h[k] + d_h[k]) / 2 - (o_a[k] + d_a[k]) / 2
        f[f"t_{k}"] = o_h[k] + d_h[k] + o_a[k] + d_a[k]
    f["pts_tot"] = (o_h["pts"] + d_a["pts"] + o_a["pts"] + d_h["pts"]) / 2
    return f

MF = [f"m_{k}" for k in ST] + ["spread", "rest", "div"]
TF = [f"t_{k}" for k in ST] + ["tot", "wind", "dome", "temp"]

def _stats_models(g, season):
    """The 5 stats models (logistic, ridge, two boosted trees, random forest) for spread and total, trained on every game before now."""
    key = (season, str(g[g.result.notna()].gameday.max()))
    pk = os.path.join(CACHE, f"xf_models_{season}.pkl")
    if _mem.get("models_key") == key: return _mem["models"]
    if os.path.exists(pk):
        with open(pk, "rb") as fh: saved = pickle.load(fh)
        if saved["key"] == key: _mem.update(models_key=key, models=saved); return saved
    from sklearn.linear_model import LogisticRegression, Ridge
    from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    O, D, On, Dn, M = _ratings(g[g.season >= 2012], season)
    rows = []
    for r in g[(g.season >= 2012) & g.result.notna()].itertuples():
        oh, da, oa, dh = O.get((r.game_id, r.home_team)), D.get((r.game_id, r.away_team)), O.get((r.game_id, r.away_team)), D.get((r.game_id, r.home_team))
        if not (oh and da and oa and dh) or pd.isna(r.spread_line) or pd.isna(r.total_line): continue
        rows.append(_row({"spread": r.spread_line, "tot": r.total_line, "result": r.result, "total": r.total, "div": r.div_game, "rest": r.home_rest - r.away_rest,
                          "wind": r.wind if pd.notna(r.wind) else 0, "dome": int(r.roof in ("dome", "closed")), "temp": r.temp if pd.notna(r.temp) else 60}, oh, da, oa, dh))
    X = pd.DataFrame(rows)
    out = {"key": key, "now": (On, Dn), "M": M}
    for kind, F, y, res in (("s", MF, (X.result > X.spread).astype(int), X.result - X.spread), ("t", TF, (X.total > X.tot).astype(int), X.total - X.tot)):
        keep = (X.result != X.spread) if kind == "s" else (X.total != X.tot)
        A, yy, rr = X.loc[keep, F].fillna(0), y[keep], res[keep]
        mods = {"logit": make_pipeline(StandardScaler(), LogisticRegression(C=.05, max_iter=3000)).fit(A, yy),
                "ridge": make_pipeline(StandardScaler(), Ridge(alpha=50)).fit(A, rr),
                "gbm": HistGradientBoostingClassifier(max_depth=3, learning_rate=.03, max_iter=200, min_samples_leaf=50).fit(A, yy),
                "gbr": HistGradientBoostingRegressor(max_depth=3, learning_rate=.03, max_iter=200, min_samples_leaf=50).fit(A, rr),
                "rf": RandomForestClassifier(300, min_samples_leaf=40, n_jobs=-1, random_state=0).fit(A, yy)}
        sd = {n: float(np.std(_pred(m, n, A))) or 1.0 for n, m in mods.items()}
        out[kind] = (mods, sd)
    with open(pk, "wb") as fh: pickle.dump(out, fh)
    _mem.update(models_key=key, models=out); return out

_WARM = threading.Event(); _warm_started = []
def warm(season=None):
    """Build the stats models once in a background thread (startup / first call)."""
    if _warm_started: return
    _warm_started.append(1)
    def run():
        try: _stats_models(_games(), season or _season.data_season())
        except Exception as e: print(f"[xf] warm: {e}", flush=True)
        finally: _WARM.set()
    threading.Thread(target=run, daemon=True).start()

def _pred(m, n, A):
    if n in ("ridge", "gbr"): return m.predict(A) / 14
    return m.predict_proba(A)[:, 1] - .5

def _rate(rows, n_min=30):
    v = rows[rows != 0]
    return float((v > 0).mean()) if len(v) >= n_min else None

def factors(games, season=None):
    """games: [{away, home, week, spread (home favored by), total, wind, dome}] -> {"AWAY @ HOME": {...}}"""
    with _LOCK:
        season = season or _season.data_season()
        g = _games(); out = {}
        cov = np.sign(g.result - g.spread_line)
        def coach(c, s):
            x = g[(g.season < s) & (g.season >= s - 3)]
            return _rate(pd.concat([cov[x.index][x.home_coach == c], -cov[x.index][x.away_coach == c]]))
        # team age: average age of the active weekly roster
        ages = {}
        try:
            rf = os.path.join(CACHE, f"ros_{season}.parquet")
            if not os.path.exists(rf) or time.time() - os.path.getmtime(rf) > 24 * 3600: _season.download(f"{BASE}/weekly_rosters/roster_weekly_{season}.parquet", rf)
            ro = pd.read_parquet(rf, columns=["team", "week", "status", "birth_date"]); ro = ro[(ro.status == "ACT") & ro.birth_date.notna()]
            ro = ro[ro.week == ro.week.max()]
            ro["age"] = (pd.Timestamp(f"{season}-09-15") - pd.to_datetime(ro.birth_date, errors="coerce")).dt.days / 365.25
            ages = ro.groupby("team").age.mean().to_dict()
        except Exception as e: print(f"[xf] ages: {e}", flush=True)
        # QB rushing: this season's starter (most pass attempts last game) rush attempts per game
        qbrun = {}
        try:
            p = pd.read_parquet(_pbp(season), columns=["season_type", "week", "posteam", "passer_player_id", "rusher_player_id", "pass_attempt", "rush_attempt", "qb_kneel"])
            p = p[p.season_type == "REG"]
            for t, T in p.groupby("posteam"):
                lw = T.week.max(); pa = T[(T.week == lw) & (T.pass_attempt == 1)].passer_player_id.value_counts()
                if not len(pa): continue
                q = pa.index[0]; r = T[(T.rusher_player_id == q) & (T.rush_attempt == 1) & (T.qb_kneel != 1)]
                n = T[(T.passer_player_id == q) | (T.rusher_player_id == q)].week.nunique()
                if n >= 2: qbrun[t] = len(r) / n
        except Exception as e: print(f"[xf] qbrun: {e}", flush=True)
        # The first build (play-by-play back to 2012) runs in the background so a rerun never waits on it; until then no stats-model factors.
        SM = _mem.get("models") if _mem.get("models") and _mem["models"]["key"][0] == season else None
        if not _WARM.is_set(): warm(season)
        elif SM is None or _mem.get("models_key") != (season, str(g[g.result.notna()].gameday.max())):
            try: SM = _stats_models(g, season)
            except Exception as e: print(f"[xf] stats models: {e}", flush=True)
        for x in games:
            a, h, wk = x["away"], x["home"], int(x.get("week") or 0)
            row = g[(g.season == season) & (g.week == wk) & (g.home_team == h) & (g.away_team == a)]
            r = row.iloc[0] if len(row) else None
            f = {"homeRest": float(r.home_rest) if r is not None and pd.notna(r.home_rest) else None,
                 "awayRest": float(r.away_rest) if r is not None and pd.notna(r.away_rest) else None,
                 "homeCoach": coach(r.home_coach, season) if r is not None else None, "awayCoach": coach(r.away_coach, season) if r is not None else None,
                 "homeAge": ages.get(h), "awayAge": ages.get(a), "homeQbRun": qbrun.get(h), "awayQbRun": qbrun.get(a),
                 "tzdiff": TZ.get(h, 0) - TZ.get(a, 0),
                 "early": bool(r is not None and isinstance(r.gametime, str) and r.gametime[:2] in ("09", "12", "13"))}
            if SM and x.get("spread") is not None and x.get("total") is not None:
                (On, Dn), M = SM["now"], SM["M"]
                oh, da, oa, dh = (On.get(h) or (None,))[0], (Dn.get(a) or (None,))[0], (On.get(a) or (None,))[0], (Dn.get(h) or (None,))[0]
                if oh and da and oa and dh:
                    if (On.get(h) or (0, season))[1] != season:   # first game of a season: same 1/3 regression the training used
                        oh, da, oa, dh = [{k: v * 0.67 + M[k] * 0.33 for k, v in z.items()} for z in (oh, da, oa, dh)]
                    fr = _row({"spread": float(x["spread"]), "tot": float(x["total"]), "div": int(bool(x.get("div"))), "rest": (f["homeRest"] or 7) - (f["awayRest"] or 7),
                               "wind": float(x.get("wind") or 0), "dome": int(bool(x.get("dome"))), "temp": float(x.get("temp") or 60)}, oh, da, oa, dh)
                    f["ptsTot"] = fr["pts_tot"]
                    for kind, F in (("s", MF), ("t", TF)):
                        mods, sd = SM[kind]; A = pd.DataFrame([fr])[F].fillna(0)
                        v = {n: float(_pred(m, n, A)[0]) for n, m in mods.items()}
                        v["ens"] = float(np.mean([v[n] / sd[n] for n in mods]))
                        f[kind] = {k: round(val, 4) for k, val in v.items()}
            out[f"{a} @ {h}"] = _clean(f)
        return out

def _clean(v):
    """NaN/inf are not valid JSON (10/9: they broke the site's rerun); send null instead."""
    if isinstance(v, dict): return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (float, np.floating)): return float(v) if np.isfinite(v) else None
    if isinstance(v, np.integer): return int(v)
    if isinstance(v, np.bool_): return bool(v)
    return v
