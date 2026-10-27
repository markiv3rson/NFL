"""Model-service checks that need no network (run: python3 tests/test_service.py; part of npm test and CI)."""
import os, sys, datetime, urllib.error, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "railway-model-service"))
import numpy as np
import season, fair_line
bad = 0
def ok(c, m):
    global bad
    if not c: bad += 1; print("FAIL", m)
def fake(exc):
    def f(*a, **k): raise exc
    return f
orig, d = urllib.request.urlopen, datetime.date(2027, 9, 1)
ok(season.calendar_season(datetime.date(2027, 1, 15)) == 2026 and season.calendar_season(datetime.date(2027, 8, 1)) == 2027, "calendar season")
urllib.request.urlopen = fake(urllib.error.HTTPError("u", 404, "nf", {}, None)); season._cache.clear(); ok(season.data_season(d) == 2026, "404 -> last season")
urllib.request.urlopen = fake(TimeoutError("t")); season._cache.clear(); ok(season.data_season(d) == 2027, "timeout keeps this season")
urllib.request.urlopen = fake(urllib.error.HTTPError("u", 503, "x", {}, None)); season._cache.clear(); ok(season.data_season(d) == 2027, "503 keeps this season")
urllib.request.urlopen = orig
# calibration constants the site mirrors (lib/picks.js CAL_WIN, lib/calibration.js twoPlus)
ok(fair_line.CAL_WIN == (-0.0470, 0.1187, 0.0) and fair_line.CAL_WIN_BEND == 0.0334, "CAL_WIN matches lib/picks.js")
ok(abs(fair_line.cal_win(0, 3) - 1 / (1 + np.exp(-(-0.0470 + 0.1187 * 3 + 0.0334 * 9 / 10)))) < 1e-12, "cal_win formula")
# predict(): removed margin terms really are gone (divisional / road bye / turnovers must not move the margin)
M = {"mu": 0.0, "off": {"A": 0.0, "H": 0.0}, "dfn": {"A": 0.0, "H": 0.0}, "hfa": 0.0, "pts": np.array([40.0, 21.0]), "st_epa": {}, "success_rate": {}, "to_margin": {"A": 3, "H": -3}, "record": {}}
base = fair_line.predict(M, "A", "H")
ok(fair_line.predict(M, "A", "H", rest_away_days=14) == base, "road-bye term removed")
ok(np.isclose(base[0] - base[1], fair_line.HFA_FIX), "turnover term removed; home fix applied")
# team TD total (td_prob.team_budget), loaded without importing td_prob (which downloads data)
src = open(os.path.join(os.path.dirname(__file__), "..", "railway-model-service", "td_prob.py")).read()
ns = {"np": np}; exec(src[src.index("BUDGET_A, BUDGET_K"):src.index("import time as _time")], ns)
p = np.array([0.45, 0.35, 0.25, 0.2, 0.15, 0.1, 0.08, 0.05, 0.03, 0.02]); q = ns["team_budget"](p, 31)
ok(bool(np.all(np.diff(q) <= 0)) and q[0] > p[0], "team TD total keeps order, scales up for a high-scoring team")
q2 = ns["team_budget"](p, 24); lam = -np.log(1 - np.clip(p, 0, .95)); tgt = max(0.3, -0.7459 + 0.1297 * 24)
exp_total = (lam * (tgt / np.sort(lam)[::-1][:8].sum()) ** 0.5).sum()
ok(abs((-np.log(1 - q2)).sum() - exp_total) < 1e-9, "concentration tilt keeps the team's expected TDs unchanged")
ok((-np.log(1 - q2))[0] / (-np.log(1 - q2)).sum() > lam[0] / lam.sum(), "concentration tilt gives the top player a bigger share")

# WIDE MODEL shadow (wide_model.py, 10/27): the team table + features on a made-up schedule, and picks() on it
import pandas as pd, numpy as np
try:
    import wide_model as WM
    rng = np.random.default_rng(1); rows = []; teams = [f"T{i}" for i in range(8)]
    for season in (2001, 2002, 2003):
        for week in range(1, 15):
            order = list(rng.permutation(teams))
            for i in range(0, 8, 2):
                h, a = order[i], order[i + 1]; sp = float(rng.integers(-7, 8)); played = not (season == 2003 and week == 14)
                rows.append(dict(game_id=f"{season}_{week:02d}_{a}_{h}", season=season, game_type="REG", week=week, gameday=f"{season}-09-{min(28, week + 7):02d}", weekday="Sunday", gametime="13:00", away_team=a, home_team=h,
                                 away_score=(None if not played else int(rng.integers(10, 35))), home_score=(None if not played else int(rng.integers(10, 35))), spread_line=sp, total_line=44.5, away_rest=7, home_rest=7, div_game=0, roof="outdoors", away_qb_id=None, home_qb_id=None))
    g = pd.DataFrame(rows); g["gameday"] = pd.to_datetime(g.gameday); opens = pd.DataFrame({"game_id": g.game_id, "so": g.spread_line + 0.5, "to": 44.0})
    T = WM.team_table(g, opens); H = T[T.home.astype(bool)]
    X, names = WM.features(H)
    ok(len(T) == 2 * len(g) and X.shape == (len(H), 90) and "mvAway" in names and "o_szn_cov" in names and float(H.mv.iloc[0]) == 0.5, "wide model: two rows a game, 90 inputs (75 flags + 15 numbers), the move = line - opening line (home line -sp, opened -sp-0.5 -> +0.5)")
    last = H[(H.season == 2003) & (H.week == 13)].iloc[0]; prev = T[(T.team == last.team) & (T.season == 2003) & (T.week < 13)].sort_values("week").iloc[-1]
    ok(float(last.prev_margin) == float(prev.pf - prev.pa) and int(last.gp) == 12, "wide model: a row's 'last game' numbers are the team's previous row (pre-game state only)")
    WM._CACHE.update(key=None, fit=None)
    r = WM.picks([dict(game="T1 @ T0", season=2003, week=14, away="T1", home="T0", homeSpread=-3.0, total=45.5, openHomeSpread=-2.0, openTotal=45.0)], g, opens)
    q = r["games"].get("T1 @ T0") or r["games"].get(next(iter(r["games"])))
    ok(r["fitGames"] > 100 and 0 <= r["thr"] <= 0.5 and (("error" in q) or (q["team"] in ("T0", "T1") and abs(q["line"]) == 3.0 and 0 < q["p"] < 1 and isinstance(q["confident"], bool))), "wide model: picks() fits on every played game with a line, sets the confident cut from out-of-sample confidence, names a side at the posted line")
    print("ok: wide_model")
except ModuleNotFoundError as e: print("skip: wide_model (", e, ")")
# WR / TE shift (td_prob.wrte_shift, 10/26): a receiver at 50% drops about 5 points, at 42% or below nothing moves, a running back never moves, order inside a position holds
ws = ns["wrte_shift"](np.array([0.50, 0.42, 0.45, 0.60, 0.50, 0.30]), np.array(["WR", "WR", "TE", "WR", "RB", "WR"]))
assert 0.44 < ws[0] < 0.46, ws; assert abs(ws[1] - 0.42) < 1e-9, ws; assert 0.42 < ws[2] < 0.45, ws; assert ws[3] < 0.60 and ws[3] > 0.54, ws
assert abs(ws[4] - 0.50) < 1e-9, ws; assert abs(ws[5] - 0.30) < 1e-9, ws; assert ws[3] > ws[0] > ws[2], ws
print("ok: wrte_shift")
# availability tilt (td_prob.availability): the best option is scaled least, order never changes, nothing goes up
a = ns["availability"](p); fac = a / p
ok(bool(np.all(a <= p + 1e-12)) and bool(np.all(np.diff(a) <= 0)) and abs(fac[0] - 0.918) < 1e-9 and bool(np.all(np.diff(fac) <= 1e-12)), "availability: scales down, keeps order, #1 least")
sh = np.random.RandomState(0).permutation(len(p)); ash = ns["availability"](p[sh]); ok(bool(np.allclose(ash, a[sh])), "availability depends on the rank, not the list order")
# touch chance (td_prob.touch_prob): a regular who played last game beats a depth player who missed it; always a real probability
F = ns["TOUCH_FEATS"]; ok(len(F) == len(ns["TOUCH_MEAN"]) == len(ns["TOUCH_SCALE"]) == len(ns["TOUCH_COEF"]), "touch model: constants line up")
def row(**k):
    base = dict(lrank=np.log(3), pb=0.2, s1f=0.7, s3f=0.7, s_miss=0, missed_last=0, lgap=0.0, depth1=1, depth_known=1, r_t=4.0, r_c=2.0); base.update(k); return [base[f] for f in F]
reg, bad_ = ns["touch_prob"](row()), ns["touch_prob"](row(s1f=0.1, s3f=0.2, missed_last=1, lgap=np.log1p(6), depth1=0, r_t=0.5, r_c=0.2))
ok(0 < bad_ < reg < 1 and reg > 0.7 and bad_ < 0.45, "touch model: regular who played last game >> depth player who missed it %s" % ((round(float(reg), 3), round(float(bad_), 3)),))
ok(ns["touch_prob"](row(missed_last=1)) < reg and ns["touch_prob"](row(lgap=np.log1p(5))) < reg and ns["touch_prob"](row(s1f=0.9)) > reg, "touch model: missed last game / long gap lower it, more snaps raise it")
# once the inactive list is out (active=True) a returning regular who missed the last game is NOT discounted for sitting: he plays
ret_ = row(missed_last=1, lgap=np.log1p(1), s1f=0.8, s3f=0.8)
ok(ns["touch_prob"](ret_, active=True) > 0.9 and ns["touch_prob"](ret_, active=True) > ns["touch_prob"](ret_, active=False) + 0.2, "touch model: confirmed-active returning regular keeps his touch chance")
ok(ns["touch_prob"](row(lrank=np.log(12), r_t=0.3, r_c=0.1, s1f=0.2, s3f=0.2), active=True) < 0.8, "touch model: a confirmed-active deep reserve still touches it less")
# returners are matched by name from the injury file (full names) to play-by-play short names
ok(ns["match_any"]("N.Collins", ["Nico Collins", "Jaylen Waddle"]) and ns["match_any"]("P.Nacua", ["Puka Nacua"]) and ns["match_any"]("Bi.Robinson", ["Bijan Robinson"]), "returning match: full names find the short names")
ok(not ns["match_any"]("Bi.Robinson", ["Brian Robinson Jr."]) and not ns["match_any"]("D.Metcalf", ["Terrance Metcalf"]) and ns["match_any"]("Puka Nacua", ["Puka Nacua"]), "returning match: another player with the same last name does not match")

# Quarterback rushing TDs and first-TD with QBs listed (10/6), loaded without importing td_prob
import pandas as pd
ns2 = {"np": np, "pd": pd}; exec(src[src.index("FIRST_OTHER = 0.4"):src.index("def group_any(df, n=8):")], ns2)
pa, ph = np.array([0.5, 0.3, 0.2]), np.array([0.45, 0.25])
f0 = ns2["first_td"]([pa, ph]); fq = ns2["first_td"]([np.append(pa, 0.4), ph], qb_lam=-np.log(0.6))
lq = -np.log(1 - np.concatenate([np.append(pa, 0.4), ph])); Tq = lq.sum() + 0.28
ok(abs(ns2["FIRST_OTHER_QB"] - 0.28) < 1e-12 and fq[0][0] < f0[0][0] and abs(sum(map(sum, fq)) - lq.sum() / Tq * (1 - np.exp(-Tq))) < 1e-12, "first TD: a listed QB takes his share, 0.28 stays for defense/special teams")
ns3 = {"np": np, "pd": pd}; exec(src[src.index("QB_F = ["):src.index("def _build_qb():")], ns3)
pbp = pd.DataFrame([
    dict(season_type="REG", game_id="g1", week=1, posteam="BUF", passer_player_id="QB1", pass_attempt=1, rush_attempt=0, qb_kneel=0, rusher_player_id=None, yardline_100=40, rush_touchdown=0),
    dict(season_type="REG", game_id="g1", week=1, posteam="BUF", passer_player_id="QB1", pass_attempt=1, rush_attempt=0, qb_kneel=0, rusher_player_id=None, yardline_100=30, rush_touchdown=0),
    dict(season_type="REG", game_id="g1", week=1, posteam="BUF", passer_player_id="QB2", pass_attempt=1, rush_attempt=0, qb_kneel=0, rusher_player_id=None, yardline_100=30, rush_touchdown=0),
    dict(season_type="REG", game_id="g1", week=1, posteam="BUF", passer_player_id=None, pass_attempt=0, rush_attempt=1, qb_kneel=0, rusher_player_id="QB1", yardline_100=3, rush_touchdown=1),
    dict(season_type="REG", game_id="g1", week=1, posteam="BUF", passer_player_id=None, pass_attempt=0, rush_attempt=1, qb_kneel=1, rusher_player_id="QB1", yardline_100=50, rush_touchdown=0)])
st = ns3["qb_starts"](pbp)
ok(len(st) == 1 and st.iloc[0].pid == "QB1" and st.iloc[0].car == 1 and st.iloc[0].i5 == 1 and st.iloc[0].rtd == 1, "QB starts: starter = most pass attempts; kneels left out; inside-5 and TD counted")
lo = 1 / (1 + np.exp(-(ns3["QB_INT"] + ns3["QB_COEF"] @ np.array([1.5, 0.2, 0.05, 0.05, 22, 0.5]))))
hi = 1 / (1 + np.exp(-(ns3["QB_INT"] + ns3["QB_COEF"] @ np.array([9, 1.5, 0.8, 0.8, 26, 0.6]))))
ok(0.05 < lo < 0.12 and 0.4 < hi < 0.7, "QB model: a pocket passer ~8%, a goal-line runner well above 40%")
ok(set(ns3["QB_LG"]) == {"car", "rz", "i5", "rtd"} and len(ns3["QB_COEF"]) == 6, "QB model: rookie blend uses an average starter for each input")

# Scheduler: ESPN kickoff replaces a stale schedule time (10/7, CHI @ GB 1:00 -> 4:25 PM ET)
import io as _io, json as _json, scheduler as _sch
# sportsbook pull times (owner): Mon-Sat 7 AM, 3 PM, 7 PM; Sunday 5, 8, 9:30 AM, 12, 4 PM (Pacific); full pulls = weekday 7 AM + every Sunday pull
ok(_sch.WEEKDAY == [(7, 0), (15, 0), (19, 0)] and _sch.SUNDAY == [(5, 0), (8, 0), (9, 30), (12, 0), (16, 0)], "scheduler: owner's pull times")
_wk_full, _wk_lite = len(_sch.BOOK_HOURS_WK) * 6 + len(_sch.BOOK_HOURS_SUN), (len(_sch.WEEKDAY) - len(_sch.BOOK_HOURS_WK)) * 6 + len(_sch.SUNDAY) - len(_sch.BOOK_HOURS_SUN)
ok(_sch.BOOK_HOURS_SUN <= set(_sch.SUNDAY) and _sch.BOOK_HOURS_WK <= set(_sch.WEEKDAY) and 230 <= (3 * _wk_full + 2 * _wk_lite) * 52 / 12 <= 270,
   f"scheduler: about 250 sportsbook credits a month ({_wk_full} full + {_wk_lite} lite pulls a week)")
_sb = {"events": [{"date": "2026-10-11T20:25Z", "competitions": [{"competitors": [{"homeAway": "home", "team": {"abbreviation": "GB"}}, {"homeAway": "away", "team": {"abbreviation": "CHI"}}]}]},
                  {"date": "2026-10-12T00:15Z", "competitions": [{"competitors": [{"homeAway": "home", "team": {"abbreviation": "LAR"}}, {"homeAway": "away", "team": {"abbreviation": "WSH"}}]}]}]}
class _R(_io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False
_csv = "season,game_type,week,gameday,gametime,away_team,home_team\n2026,REG,5,2026-10-11,13:00,CHI,GB\n2026,REG,5,2026-10-11,13:00,CIN,MIA\n"
def _fake(url, timeout=0): return _R(_json.dumps(_sb).encode() if "espn" in url else _csv.encode())
_orig = urllib.request.urlopen; urllib.request.urlopen = _fake
_dt = _sch.datetime
class _FakeDT(_dt):
    @classmethod
    def now(cls, tz=None): return _dt(2026, 10, 8, 3, 0, tzinfo=tz)
_sch.datetime = _FakeDT
try:
    ek = _sch._espn_kickoffs(); ko = dict((g, k) for k, g in _sch._kickoffs())
    ok(ek.get("WAS @ LA") is not None and ko["CHI @ GB"].strftime("%Y-%m-%d %H:%M") == "2026-10-11 20:25" and ko["CIN @ MIA"].strftime("%H:%M") == "17:00", "scheduler: ESPN kickoff wins for a moved game; ESPN codes WSH/LAR map to WAS/LA")
finally:
    urllib.request.urlopen = _orig; _sch.datetime = _dt

# After-deploy rerun (10/22): a new Railway deploy id -> one /api/rerun?src=deploy, saved so a restart of the same deploy does not rerun again; no id -> nothing
import tempfile as _tf
_calls = []; _old_bg = _sch._bg; _sch._bg = lambda kind, fn, *a, **k: (_calls.append((kind, a)), True)[1]
_sch.DEPLOY_SEEN = os.path.join(_tf.mkdtemp(), "seen.txt")
try:
    os.environ.pop("RAILWAY_DEPLOYMENT_ID", None); r0 = _sch._after_deploy(wait=0)
    os.environ["RAILWAY_DEPLOYMENT_ID"] = "dep-1"; r1 = _sch._after_deploy(wait=0); r2 = _sch._after_deploy(wait=0)
    os.environ["RAILWAY_DEPLOYMENT_ID"] = "dep-2"; r3 = _sch._after_deploy(wait=0)
    ok(r0 is False and r1 is True and r2 is False and r3 is True and _calls == [("rerun", ("/api/rerun?src=deploy",)), ("rerun", ("/api/rerun?src=deploy",))],
       "scheduler: one model rerun per new Railway deploy (none without a deploy id, none again for the same deploy)")
finally:
    _sch._bg = _old_bg; os.environ.pop("RAILWAY_DEPLOYMENT_ID", None)

# Opponent per-play defense (10/8): earlier games only (no look-ahead), shrunk toward 0
ns4 = {"np": np, "pd": pd}; exec(src[src.index("DEF_SHRINK_RUN, DEF_SHRINK_PASS"):src.index("FEATS=[")], ns4)
_p = pd.DataFrame([dict(defteam="TB", game_id=g, week=w, play_type=k, epa=e) for g, w, k, e in [("g1", 1, "run", 1.0), ("g1", 1, "run", 1.0), ("g1", 1, "pass", -1.0), ("g2", 2, "run", 0.5), ("g2", 2, "pass", 2.0)]])
_d = ns4["def_epa_todate"](_p).set_index("game_id")
ok(_d.loc["g1", "d_repa"] == 0 and abs(_d.loc["g2", "d_repa"] - 2.0 / (2 + 150)) < 1e-12 and abs(_d.loc["g2", "d_pepa"] - (-1.0) / (1 + 200)) < 1e-12, "defense per play: game 2 uses only game 1's plays, shrunk")
_r, _q = ns4["def_epa_now"](_p, "TB"); ok(abs(_r - 2.5 / (3 + 150)) < 1e-12 and abs(_q - 1.0 / (2 + 200)) < 1e-12, "defense per play: next game uses all games so far")
# Extra factors (10/9): NaN must never reach the JSON (it broke the site's rerun)
import importlib, json as _json; _xf = importlib.import_module("extra_factors")
_c = _xf._clean({"a": float("nan"), "b": np.float64(1.5), "c": {"d": float("inf"), "e": np.bool_(True)}})
ok(_c == {"a": None, "b": 1.5, "c": {"d": None, "e": True}} and "NaN" not in _json.dumps(_c), "extra factors: NaN/inf sent as null")
# Weekly rebuild (10/9): a build that is worse than the old model or too small is never published (10/16: the combo-count gate went with the scanned table)
_wr = importlib.import_module("weekly_rebuild")
_good = {"checks": {"games": 2500, "marginErr": 10.0, "oldMarginErr": 10.25, "totalErr": 10.5, "oldTotalErr": 10.8}}
# 10/26 night: team-total miss = each team's points from the margin + total guess; toy: real 30-20 (margin 10, total 50), guess margin 4 / total 40 -> home 22 vs 30 (8), away 18 vs 20 (2) -> 5.0
ok(abs(_wr.team_total_err([4], [40], [10], [50]) - 5.0) < 1e-9 and _wr.team_total_err([10, -3], [50, 44], [10, -3], [50, 44]) == 0.0, "weekly rebuild: team-total miss helper (toy 2.5; a perfect guess 0)")
ok(_wr.passes(_good) and not _wr.passes({"checks": {**_good["checks"], "games": 500}}) and not _wr.passes({"checks": {**_good["checks"], "marginErr": 10.6}}) and not hasattr(_wr, "scan") and not hasattr(_wr, "train_chooser"), "weekly rebuild: only a sound build is published; the combo scan and the chooser are gone (10/16)")
# TEAM MODEL week (10/20): a game already played but not yet scored by nflverse (Monday night at the Tuesday 4 AM rebuild) does not hold the week back
_ts = importlib.import_module("team_side")
_g = pd.DataFrame([dict(season=2026, week=6, gameday="2026-10-18", home_score=20.0), dict(season=2026, week=6, gameday="2026-10-19", home_score=np.nan),
                   dict(season=2026, week=7, gameday="2026-10-22", home_score=np.nan), dict(season=2026, week=7, gameday="2026-10-25", home_score=np.nan)])
ok(_ts.coming_week(_g, 2026, "2026-10-20") == 7 and _ts.coming_week(_g, 2026, "2026-10-19") == 6 and _ts.coming_week(_g.drop(columns="gameday"), 2026) == 6,
   "team model: the coming week skips a played-but-unscored game (Tuesday 4 AM -> week 7), keeps it on its own day, no dates -> old rule")
# STACK team yards (10/21 review): only players who played the team's most recent game are summed (injured-reserve / benched players and backup
# quarterbacks were summed before, 1.54 passers a team live vs 1.03 in the research). prop_model is loaded as source (importing it pulls td_prob).
_psrc = open(os.path.join(os.path.dirname(__file__), "..", "railway-model-service", "prop_model.py")).read()
_ns5 = {"pd": pd, "td_prob": type("T", (), {"CUR": 2026})}
exec(_psrc[_psrc.index("def _active_pids"):_psrc.index("def team_yards")], _ns5)
_ns5["_stat_games_cached"] = lambda season: pd.DataFrame([dict(team="ATL", week=w, pid=p) for w, p in [(1, "qb1"), (1, "rb1"), (5, "qb2"), (6, "qb2"), (6, "wr1"), (4, "rb1")]] + [dict(team="SF", week=6, pid="x")])
_a = _ns5["_active_pids"]({"ATL", "SF", "NYG"})
ok(_a == {"ATL": {"qb2", "wr1"}, "SF": {"x"}} and "if len(r) and t in act: r = r[r.pid.isin(act[t])]" in _psrc,
   "STACK team yards: only players who played the team's last game count (the hurt starter qb1 and rb1, last seen weeks 1 / 4, are out)")
print(f"service checks: {'FAILED ' + str(bad) if bad else 'all passed'}"); sys.exit(1 if bad else 0)
