"""
weekly_rebuild.py -- the weekly retrain of the site's combo picks (10/9). Runs inside the Railway service (scheduler: Tuesday
4 AM PT) and replaces what used to be done by hand:

  1. the game model (fair_line) replayed week by week on every season 2014-now (past seasons cached, the current one redone)
  2. the 5 stats models scored walk-forward (each season by models trained only on earlier seasons; past seasons cached)
  3. every factor the site knows before kickoff, for every game (coaches, age, QB rushing, rest, travel, schedule spots, ...)
  4. the upgraded game model + the early-week total model (ridge, leave-one-season-out checked) -> coefficients
  5. every factor alone and in pairs, 9 bet types, kept when it beats that bet's normal rate in all three periods (60+ games)

Opening lines: data/opens.csv (aussportsbetting.com 2006-Oct 2026) plus the site's own first saved line of each game
(GET /api/opens), so no file has to be downloaded by hand any more.

Output (/data/combomodel.json): {builtAt, upgrade, early, table, checks}. Published only if the checks pass, otherwise the
previous file stays. The site reads it from GET /combo-model (lib/combomodel.js) and falls back to its built-in copy.
"""
import os, json, time, threading, warnings
import numpy as np, pandas as pd
import season as _season
warnings.filterwarnings("ignore")

CACHE = os.path.expanduser("~/.nfl_cache")
OUT_DIR = os.environ.get("MODEL_DIR", "/data")
WORK = os.path.join(OUT_DIR, "rebuild")
ARTIFACT = os.path.join(OUT_DIR, "combomodel.json")
HERE = os.path.dirname(os.path.abspath(__file__))
FIRST = 2014                       # first season with the game-model replay (needs the season before for its prior)
# 10/16 (owner: "fix what you find"): the upgraded game model's ridge strength. It was 30; tested 30 / 300 / 1000 / 3000 / 10000 / 30000 walk-forward
# (train every earlier season, test 2015-26): margin error 9.917 / 9.832 / 9.807 / 9.793 / 9.819 / 9.914, total 10.541 / 10.463 / 10.422 / 10.409 /
# 10.449 / 10.552 (line alone 9.710 / 10.362). Leave-one-season-out (the checks below): 30 -> 9.999 / 10.502, 3000 -> 9.944 / 10.455 (line 9.903 / 10.456).
# The model is still no better than the line; 3000 just stops it from adding noise. Season decay weights (0.7-0.9 a season) made it worse.
UP_ALPHA = 3000
# 10/16 (owner: "rebuild it now"): bump this tag whenever the rebuild code changes what it publishes. app.py rebuilds on start when the saved
# build carries a different tag, so a deploy to Railway rebuilds right away instead of waiting for Tuesday 4 AM PT.
BUILD_TAG = "2026-10-27 team-total + market-total checks in the rebuild report"
COLD = {"GB", "CHI", "BUF", "NE", "CLE", "PIT", "DEN", "KC", "NYJ", "NYG", "PHI", "CIN", "BAL"}
TZ = {"SEA": -3, "SF": -3, "LA": -3, "LAC": -3, "LV": -3, "OAK": -3, "SD": -3, "STL": -1, "ARI": -2, "DEN": -2, "KC": -1, "DAL": -1, "HOU": -1,
      "MIN": -1, "CHI": -1, "GB": -1, "NO": -1, "TEN": -1}
_LOCK = threading.Lock()
STATUS = {"running": False, "last": None}

def _log(*a): print("[rebuild]", *a, flush=True)

# ---------- data ----------
def games():
    import extra_factors
    g = extra_factors._games().copy()
    return g[g.result.notna()].sort_values(["gameday", "gametime"]).reset_index(drop=True)

def opens(site_opens=None):
    o = pd.read_csv(os.path.join(HERE, "data", "opens.csv"))
    if site_opens:   # {game_id: {so, to}} from the site's first saved Polymarket line, for games the file doesn't have
        extra = pd.DataFrame([{"game_id": k, "so": v.get("so"), "to": v.get("to")} for k, v in site_opens.items()])
        o = pd.concat([o, extra[~extra.game_id.isin(o.game_id)]], ignore_index=True)
    return o.drop_duplicates("game_id")

def fl_replay(season, cur):
    """Game-model predictions for every week 4+ game of a season, no look-ahead (fair_line.backtest). Past seasons cached."""
    import fair_line, io, contextlib
    f = os.path.join(WORK, f"fl_{season}.parquet")
    if season < cur and os.path.exists(f): return pd.read_parquet(f)
    with contextlib.redirect_stdout(io.StringIO()): b = fair_line.backtest(season)
    b["season"] = season; b.to_parquet(f); return b

def stats_preds(g, cur):
    """The 5 stats models, each season scored by models trained on 2012..season-1 (as extra_factors does live)."""
    import extra_factors as xf
    from sklearn.linear_model import LogisticRegression, Ridge
    from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline
    O, D, _, _, _ = xf._ratings(g[g.season >= 2012], cur)
    rows = []
    for r in g[(g.season >= 2012) & g.spread_line.notna() & g.total_line.notna()].itertuples():
        oh, da, oa, dh = O.get((r.game_id, r.home_team)), D.get((r.game_id, r.away_team)), O.get((r.game_id, r.away_team)), D.get((r.game_id, r.home_team))
        if not (oh and da and oa and dh): continue
        f = xf._row({"game_id": r.game_id, "season": r.season, "spread": r.spread_line, "tot": r.total_line, "result": r.result, "total": r.total, "div": r.div_game,
                     "rest": r.home_rest - r.away_rest, "wind": r.wind if pd.notna(r.wind) else 0, "dome": int(r.roof in ("dome", "closed")),
                     "temp": r.temp if pd.notna(r.temp) else 60}, oh, da, oa, dh)
        rows.append(f)
    X = pd.DataFrame(rows)
    out = []
    for t in range(FIRST, cur + 1):
        f = os.path.join(WORK, f"stats2_{t}.parquet")   # "2": rebuilt after the 10/13 matchup-pairing fix
        if t < cur and os.path.exists(f): out.append(pd.read_parquet(f)); continue
        tr, te = X[X.season < t], X[X.season == t]
        if not len(te): continue
        res = {"game_id": te.game_id.values}
        for kind, F_, y, rr in (("s", xf.MF, tr.result > tr.spread, tr.result - tr.spread), ("t", xf.TF, tr.total > tr.tot, tr.total - tr.tot)):
            keep = (tr.result != tr.spread) if kind == "s" else (tr.total != tr.tot)
            A, B = tr.loc[keep, F_].fillna(0), te[F_].fillna(0)
            mods = {"logit": make_pipeline(StandardScaler(), LogisticRegression(C=.05, max_iter=3000)).fit(A, y[keep]),
                    "ridge": make_pipeline(StandardScaler(), Ridge(alpha=50)).fit(A, rr[keep]),
                    "gbm": HistGradientBoostingClassifier(max_depth=3, learning_rate=.03, max_iter=200, min_samples_leaf=50).fit(A, y[keep]),
                    "gbr": HistGradientBoostingRegressor(max_depth=3, learning_rate=.03, max_iter=200, min_samples_leaf=50).fit(A, rr[keep]),
                    "rf": RandomForestClassifier(300, min_samples_leaf=40, n_jobs=-1, random_state=0).fit(A, y[keep])}
            sd = {n: float(np.std(xf._pred(m, n, A))) or 1.0 for n, m in mods.items()}
            P = {n: xf._pred(m, n, B) for n, m in mods.items()}
            for n, v in P.items(): res[f"{kind}_{n}"] = v
            res[f"{kind}_ens"] = np.mean([P[n] / sd[n] for n in mods], axis=0)
        res["ptstot"] = te.pts_tot.values
        df = pd.DataFrame(res); df.to_parquet(f); out.append(df)
    return pd.concat(out, ignore_index=True)

# ---------- per-game factors (same definitions as the site's lib/stack.js) ----------
def team_table(g):
    rows = []
    for r in g.itertuples():
        for home, team, opp, m in ((1, r.home_team, r.away_team, r.result), (0, r.away_team, r.home_team, -r.result)):
            rows.append(dict(gid=r.game_id, s=r.season, wk=r.week, day=r.gameday, team=team, opp=opp, home=home, marg=m, pts=r.home_score if home else r.away_score,
                             ot=r.overtime == 1, wd=r.weekday, loc=r.location, dv=r.div_game == 1, qb=r.home_qb_id if home else r.away_qb_id, rest=r.home_rest if home else r.away_rest))
    t = pd.DataFrame(rows).sort_values(["s", "team", "day"]).reset_index(drop=True); G = t.groupby(["s", "team"])
    for c in ["marg", "pts", "ot", "wd", "loc", "home", "dv", "qb"]: t["p_" + c] = G[c].shift()
    t["n_dv"] = G.dv.shift(-1); t["p2_home"] = G.home.shift(2); t["n_wk"] = G.wk.shift(-1)
    t["w"] = (t.marg > 0).astype(int); t["wins"] = G.w.cumsum() - t.w; t["gp"] = G.cumcount()
    t["streak3"] = G.w.transform(lambda s: s.shift().rolling(3).sum()) == 3
    t["prebye"] = (t.n_wk - t.wk) >= 2
    t["newqb"] = t.p_qb.notna() & (t.qb != t.p_qb)
    lost, rv = set(), {}
    for r in t.sort_values("day").itertuples():
        rv[r.Index] = (r.s, r.team, r.opp) in lost
        if r.marg < 0: lost.add((r.s, r.team, r.opp))
    t["rev"] = pd.Series(rv)
    return t.set_index(["gid", "team"])

def coach_rates(g):
    cov = np.sign(g.result - g.spread_line); cache = {}
    def rate(s, c):
        if (s, c) in cache: return cache[(s, c)]
        x = g[(g.season < s) & (g.season >= s - 3)]
        v = pd.concat([cov[x.index][x.home_coach == c], -cov[x.index][x.away_coach == c]]); v = v[v != 0]
        cache[(s, c)] = float((v > 0).mean()) if len(v) >= 30 else np.nan; return cache[(s, c)]
    return rate

def ages(seasons):
    out = {}
    for y in seasons:
        f = os.path.join(CACHE, f"ros_{y}.parquet")
        try:
            if not os.path.exists(f) or y == max(seasons): _season.download(f"{_season.BASE}/weekly_rosters/roster_weekly_{y}.parquet", f)
            r = pd.read_parquet(f, columns=["team", "week", "status", "birth_date"]); r = r[(r.status == "ACT") & r.birth_date.notna()]
            r["age"] = (pd.Timestamp(f"{y}-09-15") - pd.to_datetime(r.birth_date, errors="coerce")).dt.days / 365.25
            for (tm, w), a in r.groupby(["team", "week"]).age.mean().items(): out[(y, tm, w)] = a
        except Exception as e: _log("ages", y, e)
    return out

def qb_runs(seasons):
    import extra_factors as xf
    out = {}
    for y in seasons:
        try:
            p = pd.read_parquet(xf._pbp(y), columns=["season_type", "week", "rusher_player_id", "rush_attempt", "qb_kneel"])
            p = p[(p.season_type == "REG") & (p.rush_attempt == 1) & (p.qb_kneel != 1)]
            c = p.groupby(["rusher_player_id", "week"]).size().unstack(fill_value=0)
            cs = c.cumsum(axis=1).shift(axis=1).fillna(0); n = (c > 0).cumsum(axis=1).shift(axis=1).fillna(0)
            for pid in c.index:
                for w in c.columns:
                    if n.at[pid, w] >= 2: out[(y, pid, w)] = cs.at[pid, w] / n.at[pid, w]
        except Exception as e: _log("qbrun", y, e)
    return out

# Starters out (10/10): per team-week, Out/Doubtful players on the official report who averaged 60%+ of offensive or defensive snaps in
# the team's earlier games that season, by group. Same rule as the site (lib/snaps.js startersOut). Combos with these factors are kept
# for straight bets only (no teasers, owner's call).
INJ_GRP = {"QB": "qb", "WR": "sk", "TE": "sk", "RB": "sk", "T": "ol", "G": "ol", "C": "ol", "OT": "ol", "OG": "ol", "CB": "db", "S": "db", "FS": "db", "SS": "db",
           "LB": "f7", "ILB": "f7", "OLB": "f7", "MLB": "f7", "DE": "f7", "DT": "f7", "NT": "f7"}
INJ_MIN = {"qb": 1, "sk": 1, "ol": 2, "db": 2, "f7": 2}
def _nn(x):
    import re
    return re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", re.sub(r"[^a-z ]", "", str(x).lower())).strip().replace("  ", " ")
def _nfl_file(path, local, y):
    f = os.path.join(CACHE, local)
    if not os.path.exists(f) or (y >= _season.data_season() and time.time() - os.path.getmtime(f) > 6 * 3600):
        _season.download(f"{_season.BASE}/{path}", f)
    return f
def starters_out(seasons):
    out = {}
    for y in seasons:
        try:
            sn = pd.read_parquet(_nfl_file(f"snap_counts/snap_counts_{y}.parquet", f"snap_counts_{y}.parquet", y))
            inj = pd.read_parquet(_nfl_file(f"injuries/injuries_{y}.parquet", f"inj_{y}.parquet", y))
        except Exception as e: _log("starters out", y, e); continue
        sn = sn[sn.game_type == "REG"].copy(); sn["pct"] = sn[["offense_pct", "defense_pct"]].max(axis=1); sn["n"] = sn.player.map(_nn)
        inj = inj[(inj.game_type == "REG") & inj.report_status.isin(["Out", "Doubtful"])].copy(); inj["n"] = inj.full_name.map(_nn)
        for (tm, wk), x in inj.groupby(["team", "week"]):
            prev = sn[(sn.team == tm) & (sn.week < wk)]
            if not len(prev): continue
            avg = prev.groupby("n").agg(p=("pct", "mean"), pos=("position", "last")); o = {k: 0 for k in INJ_MIN}
            for n in x.n:
                if n in avg.index and avg.at[n, "p"] >= 0.6 and INJ_GRP.get(avg.at[n, "pos"]): o[INJ_GRP[avg.at[n, "pos"]]] += 1
            out[(int(y), tm, int(wk))] = o
    return out

def assemble(site_opens=None):
    cur = _season.data_season()
    os.makedirs(WORK, exist_ok=True)
    g = games(); g["gameday"] = pd.to_datetime(g.gameday)
    fl = pd.concat([fl_replay(s, cur) for s in range(FIRST, cur + 1)], ignore_index=True); _log("game-model replay rows", len(fl))
    d = fl.merge(g, left_on=["season", "week", "km", "kt", "res", "tot"], right_on=["season", "week", "spread_line", "total_line", "result", "total"])
    # review fix 10/14: two games in one week with the same lines AND result would swap model rows -- drop any game whose join is ambiguous
    amb = d.groupby(["season", "week", "km", "kt", "res", "tot"]).game_id.transform("nunique") > 1
    if amb.any(): _log("ambiguous replay joins dropped", int(d[amb].game_id.nunique()))
    d = d[~amb].drop_duplicates("game_id")
    o = opens(site_opens); d = d.merge(o, on="game_id", how="left")
    d = d.merge(stats_preds(g, cur), on="game_id", how="left")
    T = team_table(g); cr = coach_rates(g); AG = ages(range(FIRST - 1, cur + 1)); QR = qb_runs(range(FIRST - 1, cur + 1))
    def tv(c, side): return pd.Series([T[c].get((gid, tm)) for gid, tm in zip(d.game_id, d.home_team if side == "h" else d.away_team)])
    for c in ["p_marg", "p_pts", "streak3", "prebye", "newqb", "p_ot", "p_wd", "p_loc", "p_dv", "n_dv", "rev", "p_home", "p2_home", "wins", "gp"]:
        d["h_" + c], d["a_" + c] = tv(c, "h").values, tv(c, "a").values
    d["hcoach"] = [cr(s, c) for s, c in zip(d.season, d.home_coach)]; d["acoach"] = [cr(s, c) for s, c in zip(d.season, d.away_coach)]
    d["hage"] = [AG.get((s, t, w)) for s, t, w in zip(d.season, d.home_team, d.week)]; d["aage"] = [AG.get((s, t, w)) for s, t, w in zip(d.season, d.away_team, d.week)]
    d["hqbrun"] = [QR.get((s, q, w), np.nan) for s, q, w in zip(d.season, d.home_qb_id, d.week)]; d["aqbrun"] = [QR.get((s, q, w), np.nan) for s, q, w in zip(d.season, d.away_qb_id, d.week)]
    d["tzdiff"] = [TZ.get(h, 0) - TZ.get(a, 0) for h, a in zip(d.home_team, d.away_team)]
    SO = starters_out(range(FIRST, cur + 1))
    for g_ in INJ_MIN:
        d["h_inj_" + g_] = [SO.get((int(s_), t, int(w)), {}).get(g_, 0) for s_, t, w in zip(d.season, d.home_team, d.week)]
        d["a_inj_" + g_] = [SO.get((int(s_), t, int(w)), {}).get(g_, 0) for s_, t, w in zip(d.season, d.away_team, d.week)]
    d["early_slot"] = d.gametime.fillna("").str[:2].isin(["09", "12", "13"])
    return d.reset_index(drop=True), cur

def factors(d, mm, mt):
    """Every factor, as booleans per game. mm/mt = the model margin/total the model leans come from."""
    hs = d.km.values; homeDog = hs < 0; sp = np.abs(hs)
    gap = mm - d.km.values; tg = mt - d.kt.values
    H = lambda h, a: np.where(homeDog, d[h].values, d[a].values); V = lambda h, a: np.where(homeDog, d[a].values, d[h].values)
    num = lambda x: pd.to_numeric(pd.Series(x), errors="coerce").values
    dogprev, favprev = num(H("h_p_marg", "a_p_marg")), num(V("h_p_marg", "a_p_marg"))
    dogrest = np.where(homeDog, d.home_rest - d.away_rest, d.away_rest - d.home_rest)
    mvdog = np.where(homeDog, -(d.km - d.so), (d.km - d.so)); tmv = (d.kt - d.to).values
    out = d.roof.isin(["outdoors", "open"]).values; w = d.wind.fillna(0).values
    grass = d.surface.fillna("grass").str.contains("grass").values
    F = {"turf": ~grass, "grass": grass, "dome": ~out, "wind10": out & (w >= 10), "wind15": out & (w >= 15), "div": d.div_game.values == 1,
         "cold": d.temp.fillna(60).values <= 32, "shortwk": ((d.home_rest <= 4) | (d.away_rest <= 4)).values, "early": d.week.values <= 4,
         "late": d.week.values >= 13, "prime": d.gametime.fillna("").str[:2].isin(["19", "20"]).values,
         "dogrestP": dogrest > 0, "dogrest-": dogrest < 0, "dogOffLoss": dogprev < 0, "dogOffBlow": dogprev <= -17, "favOffWin": favprev > 0,
         "favOffLoss": favprev < 0, "homeDog": homeDog, "roadDog": ~homeDog, "sp>=7": sp >= 7, "sp<=3": sp <= 3, "tot>=47": d.kt.values >= 47,
         "tot<=41": d.kt.values <= 41}
    lh = gap > 0; F["mdlDog"] = np.where(homeDog, lh, ~lh); F["mdlFav"] = ~F["mdlDog"]
    F["mdlDog3"] = F["mdlDog"] & (np.abs(gap) >= 3); F["mdlFav3"] = F["mdlFav"] & (np.abs(gap) >= 3)
    F["mdlU"], F["mdlO"], F["mdlU3"], F["mdlO3"] = tg < 0, tg > 0, tg <= -3, tg >= 3
    sv = d.s_ens.values; ok = ~np.isnan(sv)
    F["statDog"] = ok & np.where(homeDog, sv > 0, sv < 0); F["statFav"] = ok & np.where(homeDog, sv < 0, sv > 0)
    F["statU"], F["statO"] = d.t_ens.values < 0, d.t_ens.values > 0
    F["mvDog1"], F["mvFav1"] = mvdog >= 1, mvdog <= -1
    F["totUp2"], F["totDn2"], F["totUp3"], F["totDn3"] = tmv >= 2, tmv <= -2, tmv >= 3, tmv <= -3
    dc, fc = num(H("hcoach", "acoach")), num(V("hcoach", "acoach"))
    F.update(dogCoachBad=dc <= .44, favCoachBad=fc <= .44, dogCoachGood=dc >= .56, favCoachGood=fc >= .56, homeCoachBad=d.hcoach.values <= .44)
    F["dogNewQB"], F["favNewQB"] = H("h_newqb", "a_newqb").astype(bool), V("h_newqb", "a_newqb").astype(bool)
    F["awayEastEarly"] = (d.tzdiff.values >= 2) & d.early_slot.values; F["awayWestTrip"] = d.tzdiff.values <= -2; F["tz2P"] = np.abs(d.tzdiff.values) >= 2
    da, fa = num(H("hage", "aage")), num(V("hage", "aage"))
    F.update(dogOlder1=(da - fa) >= 1, dogYounger1=(fa - da) >= 1, oldTeams=(d.hage.values + d.aage.values) / 2 >= 26.8, youngTeams=(d.hage.values + d.aage.values) / 2 <= 25.8)
    dq, fq = num(H("hqbrun", "aqbrun")), num(V("hqbrun", "aqbrun"))
    F.update(dogQBruns=dq >= 6, favQBruns=fq >= 6, bigDogQBruns=(dq >= 6) & (sp >= 7))
    F["dogLowScorePrev"] = (num(H("h_p_pts", "a_p_pts")) <= 10) & (dogprev < 0)
    F["favStreak3"], F["dogStreak3"] = V("h_streak3", "a_streak3") == True, H("h_streak3", "a_streak3") == True
    F["homePrebye"] = (d.h_prebye.values == True) & (d.week.values >= 8); F["awayPrebye"] = (d.a_prebye.values == True) & (d.week.values >= 8)
    F["ptsTotO3"], F["ptsTotU3"] = (d.ptstot - d.kt).values >= 3, (d.ptstot - d.kt).values <= -3
    lean = lambda c: (~np.isnan(d[c].values)) & np.where(homeDog, d[c].values > 0, d[c].values < 0)
    F["gbmDog"] = lean("s_gbm"); F["gbmFav"] = (~np.isnan(d.s_gbm.values)) & ~F["gbmDog"]; F["logitDog"] = lean("s_logit"); F["rfDog"] = lean("s_rf")
    F["gbmU"], F["gbmO"], F["ridgeU"] = d.t_gbm.values < 0, d.t_gbm.values > 0, d.t_ridge.values < 0
    F["bothMdlDog"] = F["mdlDog"] & F["statDog"]; F["bothMdlFav"] = F["mdlFav"] & F["statFav"]; F["bothU"] = F["mdlU"] & F["statU"]; F["bothO"] = F["mdlO"] & F["statO"]
    F["allLeanDog"] = F["mdlDog"] & F["gbmDog"] & F["statDog"] & F["logitDog"] & F["rfDog"]
    F["mlgap"] = (sp >= 2.5) & (sp <= 3.5) & (d.kt.values >= 48)
    # research factors (dog / favorite side)
    for nm, c, fn in [("AfterOT", "p_ot", lambda x: x == True), ("AfterMNF", "p_wd", lambda x: x == "Monday"), ("Revenge", "rev", lambda x: x == True),
                      ("LookaheadDiv", "n_dv", lambda x: x == True), ("AfterWin28", "p_marg", lambda x: num(x) >= 28), ("AfterLoss28", "p_marg", lambda x: num(x) <= -28)]:
        h, a = np.asarray(fn(d["h_" + c].values), bool), np.asarray(fn(d["a_" + c].values), bool)
        F["dog" + nm], F["fav" + nm] = np.where(homeDog, h, a), np.where(homeDog, a, h)
    hdw = (d.h_p_dv.values == True) & (num(d.h_p_marg.values) > 0); adw = (d.a_p_dv.values == True) & (num(d.a_p_marg.values) > 0)
    F["dogAfterDivWin"], F["favAfterDivWin"] = np.where(homeDog, hdw, adw), np.where(homeDog, adw, hdw)
    nd = d.div_game.values != 1
    F["sandwichAny"] = nd & (((d.h_p_dv.values == True) & (d.h_n_dv.values == True)) | ((d.a_p_dv.values == True) & (d.a_n_dv.values == True)))
    F["road2nd"] = d.a_p_home.values == 0; F["road3rd"] = (d.a_p_home.values == 0) & (d.a_p2_home.values == 0)
    F["roadOffBye"], F["homeOffBye"] = (d.away_rest >= 13).values, (d.home_rest >= 13).values
    F["divRematch"] = (d.div_game.values == 1) & ((d.h_rev.values == True) | (d.a_rev.values == True))
    hw = num(d.h_wins) / np.where(num(d.h_gp) > 0, num(d.h_gp), np.nan); aw = num(d.a_wins) / np.where(num(d.a_gp) > 0, num(d.a_gp), np.nan)
    dw, fw = np.where(homeDog, hw, aw), np.where(homeDog, aw, hw)
    F["wk17dogLosing"] = (d.week.values >= 17) & (dw < 0.4) & (fw > 0.6)
    for g_, th in INJ_MIN.items():
        if "h_inj_" + g_ in d:
            F[f"dog{g_.upper()}out"] = num(H("h_inj_" + g_, "a_inj_" + g_)) >= th; F[f"fav{g_.upper()}out"] = num(V("h_inj_" + g_, "a_inj_" + g_)) >= th
    return {k: np.nan_to_num(np.asarray(v, dtype=float)) > 0 for k, v in F.items()}

NUM = ["mm", "km", "mt", "kt", "mv", "tmv", "w", "tmp", "out", "restd", "aged", "qbr", "coach", "hpm", "apm", "dv", "s_ens", "t_ens", "s_gbm", "t_gbm", "ptstot"]
RESEARCH = ["dogAfterOT", "favAfterOT", "dogAfterMNF", "favAfterMNF", "dogRevenge", "favRevenge", "dogAfterWin28", "favAfterWin28", "dogAfterLoss28", "favAfterLoss28",
            "dogLookaheadDiv", "favLookaheadDiv", "dogAfterDivWin", "favAfterDivWin", "sandwichAny", "road3rd", "road2nd", "roadOffBye", "homeOffBye", "divRematch", "wk17dogLosing"]
EARLY_DROP = {"mv", "tmv"}

def design(d, F, early=False):
    Z = pd.DataFrame({"mm": d.mm, "km": d.so if early else d.km, "mt": d.mt, "kt": d.to if early else d.kt, "mv": (d.km - d.so).fillna(0), "tmv": (d.kt - d.to).fillna(0),
                      "w": d.wind.fillna(0) * d.roof.isin(["outdoors", "open"]), "tmp": d.temp.fillna(65), "out": d.roof.isin(["outdoors", "open"]).astype(int),
                      "restd": (d.home_rest - d.away_rest).fillna(0), "aged": (d.hage - d.aage).fillna(0), "qbr": (d.hqbrun - d.aqbrun).fillna(0),
                      "coach": d.hcoach.fillna(.5) - d.acoach.fillna(.5), "hpm": pd.to_numeric(d.h_p_marg, errors="coerce").fillna(0),
                      "apm": pd.to_numeric(d.a_p_marg, errors="coerce").fillna(0), "dv": d.div_game.astype(float), "s_ens": d.s_ens, "t_ens": d.t_ens,
                      "s_gbm": d.s_gbm, "t_gbm": d.t_gbm, "ptstot": d.ptstot})
    for k in RESEARCH: Z[k] = F[k].astype(float)
    if early: Z = Z.drop(columns=list(EARLY_DROP))
    return Z.astype(float).fillna(0)

# 10/16 (owner: "cut 1 and two"): the scanned combo table (scan) and the pick chooser (train_chooser) were removed. Both were retired as
# card picks on 10/12 (49.8% and 49-52% on unseen seasons); the rebuild now publishes the upgraded game model, the early total model and
# the total-move model only, and goes live on the model checks alone.


# Total-move model (10/13): predicts how far the total will move from the OPENING number to the close, using only what is known at the
# open (same early features as the early-week total). Ridge on standardized features. Tested leave-one-season-out on 2014-26 (2,5xx games):
# betting the opening total in the predicted direction on its 20% most confident games won 58-59% (11/12 seasons), top 10% 60-61%.
# thr20 / thr10 = the 80th / 90th percentile of |prediction| (honest: from leave-one-season-out predictions).
# Review fix 10/14: the 4 stats-model inputs were built from the CLOSING line, so they don't belong in a model of the move FROM the open.
# Without them (unseen seasons 2014-26): top 20% 58.6% (497), top 10% 62.5% (253) -- the edge did not depend on them.
# 10/14 (owner, "C"): wind ("w") dropped too -- it was trained on the wind MEASURED at kickoff, which nobody knows at the open; live the
# app only has the forecast. Without it (unseen seasons 2014-26): top 20% 57.6% (507), top 10% 61.3% (253) vs 59.1% / 62.7% with it.
MOVE_DROP = ("s_ens", "t_ens", "s_gbm", "t_gbm", "w")
def train_move(ZE, mv, seasons, tot, op):
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler
    X = ZE.values.astype(float); mu, sd = X.mean(0), X.std(0) + 1e-9; Xs = (X - mu) / sd; pr = np.full(len(X), np.nan)
    for s_ in sorted(set(seasons)):
        te = np.asarray(seasons) == s_
        if te.sum() < 50: continue
        sc = StandardScaler().fit(X[~te]); pr[te] = Ridge(alpha=1000).fit(sc.transform(X[~te]), mv[~te]).predict(sc.transform(X[te]))
    ok = ~np.isnan(pr); a = np.abs(pr[ok]); out = {}
    for nm, q in (("20", .8), ("10", .9)):
        thr = float(np.quantile(a, q)); sel = ok & (np.abs(np.nan_to_num(pr)) >= thr) & (tot != op)
        w = ((pr > 0) & (tot > op)) | ((pr < 0) & (tot < op)); out["thr" + nm] = round(thr, 4); out["hit" + nm] = round(float(w[sel].mean()) * 100, 1); out["n" + nm] = int(sel.sum())
    m = Ridge(alpha=1000).fit(Xs, mv)
    return {"feat": list(ZE.columns), "mean": [round(float(v), 6) for v in mu], "sd": [round(float(v), 6) for v in sd], "coef": [round(float(v), 6) for v in m.coef_],
            "b0": round(float(m.intercept_), 6), **out}

def build(site_opens=None):
    from sklearn.linear_model import Ridge
    t0 = time.time(); d, cur = assemble(site_opens)
    F0 = factors(d, d.mm.values, d.mt.values)
    Z = design(d, F0)
    um, ut = np.full(len(d), np.nan), np.full(len(d), np.nan)
    for s in sorted(d.season.unique()):   # leave-one-season-out: the honest accuracy check
        tr, te = (d.season != s).values, (d.season == s).values
        um[te] = Ridge(alpha=UP_ALPHA).fit(Z[tr], d.res[tr]).predict(Z[te]); ut[te] = Ridge(alpha=UP_ALPHA).fit(Z[tr], d.tot[tr]).predict(Z[te])
    fm, ft = Ridge(alpha=UP_ALPHA).fit(Z, d.res), Ridge(alpha=UP_ALPHA).fit(Z, d.tot)
    eo = d.so.notna() & d.to.notna(); ZE = design(d[eo], {k: v[eo.values] for k, v in F0.items()}, early=True); fe = Ridge(alpha=30).fit(ZE, d.tot[eo])
    err = lambda p, y: float(np.mean(np.abs(p - y)))
    checks = {"games": int(len(d)), "seasons": [int(d.season.min()), int(d.season.max())], "openLines": int(eo.sum()),
              "marginErr": round(err(um, d.res), 3), "oldMarginErr": round(err(d.mm, d.res), 3), "marketMarginErr": round(err(d.km, d.res), 3),
              "totalErr": round(err(ut, d.tot), 3), "oldTotalErr": round(err(d.mt, d.tot), 3), "marketTotalErr": round(err(d.kt, d.tot), 3),
              # 10/26 night (owner: "how accurate is our team totals?"): each team's points from the margin + total guess, leave-one-season-out, vs the closing line's
              "teamTotalErr": round(team_total_err(um, ut, d.res.values, d.tot.values), 3), "marketTeamTotalErr": round(team_total_err(d.km.values, d.kt.values, d.res.values, d.tot.values), 3),
              "minutes": round((time.time() - t0) / 60, 1)}
    feat = list(Z.columns)
    # 10/19 (owner, option B): the TEAM MODEL spread rule's fit + every team's numbers for the coming week (team_side.py). A failure here never
    # blocks the rest of the build: the site simply has no TEAM MODEL pick that week.
    try:
        import team_side
        tside = team_side.build(int(cur)); checks["teamSide"] = {"week": tside["week"], "n": tside["n"], "teams": len(tside["teams"])}
    except Exception as e:
        tside = None; checks["teamSide"] = {"error": str(e)[:200]}; _log("teamSide failed", repr(e))
    return {"builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tag": BUILD_TAG, "season": int(cur), "checks": checks, "teamSide": tside,
            "upgrade": {"feat": feat, "m": [round(float(v), 6) for v in fm.coef_], "mi": round(float(fm.intercept_), 6), "t": [round(float(v), 6) for v in ft.coef_], "ti": round(float(ft.intercept_), 6)},
            "early": {"feat": list(ZE.columns), "t": [round(float(v), 6) for v in fe.coef_], "ti": round(float(fe.intercept_), 6)},
            "moveT": train_move(ZE.drop(columns=[c for c in MOVE_DROP if c in ZE.columns]), (d.kt[eo] - d.to[eo]).values, d.season[eo].values, d.tot[eo].values, d.to[eo].values)}

def team_total_err(pred_margin, pred_total, margin, total):
    """Average miss of each team's points: home = (total + margin) / 2, away = (total - margin) / 2 (margins home-favored, as res / km are)."""
    pm, pt, m, t = (np.asarray(x, dtype=float) for x in (pred_margin, pred_total, margin, total))
    return float(np.mean(np.concatenate([np.abs((t + m) / 2 - (pt + pm) / 2), np.abs((t - m) / 2 - (pt - pm) / 2)])))

def passes(a):
    c = a["checks"]
    return c["games"] >= 2000 and c["marginErr"] <= c["oldMarginErr"] + 0.05 and c["marginErr"] <= 10.6 and c["totalErr"] <= c["oldTotalErr"] + 0.05

def run(site_opens=None):
    """Build, check, publish. Returns the checks (and whether it went live)."""
    if not _LOCK.acquire(blocking=False): return {"ok": False, "note": "already running"}
    STATUS["running"] = True
    try:
        a = build(site_opens); ok = passes(a); a["checks"]["published"] = ok
        if ok:
            tmp = ARTIFACT + ".tmp"
            with open(tmp, "w") as fh: json.dump(a, fh)
            os.replace(tmp, ARTIFACT)
        _log("done", json.dumps(a["checks"])); STATUS["last"] = a["checks"]; return {"ok": ok, **a["checks"]}
    except Exception as e:
        _log("failed", repr(e)); STATUS["last"] = {"error": str(e)}; return {"ok": False, "error": str(e)}
    finally:
        STATUS["running"] = False; _LOCK.release()

def latest():
    try:
        with open(ARTIFACT) as fh: return json.load(fh)
    except Exception: return None
