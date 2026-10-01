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
print(f"service checks: {'FAILED ' + str(bad) if bad else 'all passed'}"); sys.exit(1 if bad else 0)
