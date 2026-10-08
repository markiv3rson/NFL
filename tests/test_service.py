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
ok(fair_line.CAL_WIN == (-0.0452, 0.1464, 0.0), "CAL_WIN matches lib/picks.js")
ok(abs(fair_line.cal_win(0, 3) - 1 / (1 + np.exp(-(-0.0452 + 0.1464 * 3)))) < 1e-12, "cal_win formula")
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

# Opponent per-play defense (10/8): earlier games only (no look-ahead), shrunk toward 0
ns4 = {"np": np, "pd": pd}; exec(src[src.index("DEF_SHRINK_RUN, DEF_SHRINK_PASS"):src.index("FEATS=[")], ns4)
_p = pd.DataFrame([dict(defteam="TB", game_id=g, week=w, play_type=k, epa=e) for g, w, k, e in [("g1", 1, "run", 1.0), ("g1", 1, "run", 1.0), ("g1", 1, "pass", -1.0), ("g2", 2, "run", 0.5), ("g2", 2, "pass", 2.0)]])
_d = ns4["def_epa_todate"](_p).set_index("game_id")
ok(_d.loc["g1", "d_repa"] == 0 and abs(_d.loc["g2", "d_repa"] - 2.0 / (2 + 150)) < 1e-12 and abs(_d.loc["g2", "d_pepa"] - (-1.0) / (1 + 200)) < 1e-12, "defense per play: game 2 uses only game 1's plays, shrunk")
_r, _q = ns4["def_epa_now"](_p, "TB"); ok(abs(_r - 2.5 / (3 + 150)) < 1e-12 and abs(_q - 1.0 / (2 + 200)) < 1e-12, "defense per play: next game uses all games so far")
print(f"service checks: {'FAILED ' + str(bad) if bad else 'all passed'}"); sys.exit(1 if bad else 0)
