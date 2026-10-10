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
import os, json, time, itertools, threading, warnings
import numpy as np, pandas as pd
import season as _season
warnings.filterwarnings("ignore")

CACHE = os.path.expanduser("~/.nfl_cache")
OUT_DIR = os.environ.get("MODEL_DIR", "/data")
WORK = os.path.join(OUT_DIR, "rebuild")
ARTIFACT = os.path.join(OUT_DIR, "combomodel.json")
HERE = os.path.dirname(os.path.abspath(__file__))
FIRST = 2014                       # first season with the game-model replay (needs the season before for its prior)
PERIODS = (2017, 2021)             # three test periods: FIRST-2017, 2018-2021, 2022-now
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
        f = os.path.join(WORK, f"stats_{t}.parquet")
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

def assemble(site_opens=None):
    cur = _season.data_season()
    os.makedirs(WORK, exist_ok=True)
    g = games(); g["gameday"] = pd.to_datetime(g.gameday)
    fl = pd.concat([fl_replay(s, cur) for s in range(FIRST, cur + 1)], ignore_index=True); _log("game-model replay rows", len(fl))
    d = fl.merge(g, left_on=["season", "week", "km", "kt", "res", "tot"], right_on=["season", "week", "spread_line", "total_line", "result", "total"]).drop_duplicates("game_id")
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

def scan(d, F, per):
    hs = d.km.values; homeDog = hs < 0; dm = np.where(homeDog, d.res, -d.res); sp = np.abs(hs)
    B = {"DOG6(1.5-2.5)": np.where((sp >= 1.5) & (sp <= 2.5), np.sign(dm + sp + 6), np.nan), "anyDog+6": np.sign(dm + sp + 6), "anyFav-6->": np.sign(-dm - sp + 6),
         "Under+6": -np.sign(d.tot - (d.kt + 6)).values, "Over-6": np.sign(d.tot - (d.kt - 6)).values, "Dog ATS": np.sign(dm + sp), "Fav ATS": -np.sign(dm + sp),
         "Under": -np.sign(d.tot - d.kt).values, "Over": np.sign(d.tot - d.kt).values}
    names = list(F); combos = [(n,) for n in names] + list(itertools.combinations(names, 2)); rows = []
    for bn, x in B.items():
        x = np.asarray(x, float); valid = ~np.isnan(x) & (x != 0); base = (x[valid] > 0).mean()
        for c in combos:
            k = valid.copy()
            for n in c: k &= F[n]
            n = int(k.sum())
            if n < 60: continue
            wv = x[k] > 0; pr = [wv[per[k] == p].mean() if (per[k] == p).sum() >= 12 else np.nan for p in range(3)]
            if np.any(np.isnan(pr)): continue
            if min(pr) >= base + 0.02 and wv.mean() >= base + 0.04: rows.append([bn, list(c), round(float(wv.mean()) * 100, 1), n])
    return rows

def build(site_opens=None):
    from sklearn.linear_model import Ridge
    t0 = time.time(); d, cur = assemble(site_opens)
    per = d.season.map(lambda s: 0 if s <= PERIODS[0] else (1 if s <= PERIODS[1] else 2)).values
    F0 = factors(d, d.mm.values, d.mt.values)
    Z = design(d, F0)
    um, ut = np.full(len(d), np.nan), np.full(len(d), np.nan)
    for s in sorted(d.season.unique()):   # leave-one-season-out: the honest accuracy check, and the leans the combos are scanned with
        tr, te = (d.season != s).values, (d.season == s).values
        um[te] = Ridge(alpha=30).fit(Z[tr], d.res[tr]).predict(Z[te]); ut[te] = Ridge(alpha=30).fit(Z[tr], d.tot[tr]).predict(Z[te])
    fm, ft = Ridge(alpha=30).fit(Z, d.res), Ridge(alpha=30).fit(Z, d.tot)
    eo = d.so.notna() & d.to.notna(); ZE = design(d[eo], {k: v[eo.values] for k, v in F0.items()}, early=True); fe = Ridge(alpha=30).fit(ZE, d.tot[eo])
    F = factors(d, um, ut); rows = scan(d, F, per)
    err = lambda p, y: float(np.mean(np.abs(p - y)))
    checks = {"games": int(len(d)), "seasons": [int(d.season.min()), int(d.season.max())], "openLines": int(eo.sum()),
              "marginErr": round(err(um, d.res), 3), "oldMarginErr": round(err(d.mm, d.res), 3), "marketMarginErr": round(err(d.km, d.res), 3),
              "totalErr": round(err(ut, d.tot), 3), "oldTotalErr": round(err(d.mt, d.tot), 3), "combos": len(rows), "minutes": round((time.time() - t0) / 60, 1)}
    feat = list(Z.columns)
    return {"builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "season": int(cur), "checks": checks,
            "upgrade": {"feat": feat, "m": [round(float(v), 6) for v in fm.coef_], "mi": round(float(fm.intercept_), 6), "t": [round(float(v), 6) for v in ft.coef_], "ti": round(float(ft.intercept_), 6)},
            "early": {"feat": list(ZE.columns), "t": [round(float(v), 6) for v in fe.coef_], "ti": round(float(fe.intercept_), 6)},
            "table": rows}

def passes(a):
    c = a["checks"]
    return c["games"] >= 2000 and c["marginErr"] <= c["oldMarginErr"] + 0.05 and c["marginErr"] <= 10.6 and c["totalErr"] <= c["oldTotalErr"] + 0.05 and c["combos"] >= 300

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
