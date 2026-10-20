#!/usr/bin/env python3
"""team_side.py checks that need no downloads: synthetic games with the file's line convention (+ = home favoured)."""
import numpy as np, pandas as pd, team_side as ts
rng = np.random.default_rng(3)
rows = []
for s in (2019, 2020, 2021, 2022):
    for i in range(600):
        strength_h, strength_a = rng.normal(0, 4), rng.normal(0, 4)
        line = strength_h - strength_a + 2.5                     # home favoured margin, + = home favoured
        margin = line + rng.normal(0, 12)
        rows.append(dict(game_id=f"{s}{i}", season=s, season_type=2, date=pd.Timestamp(f"{s-1}-10-20") + pd.Timedelta(days=i % 170), home=f"T{i % 30}", away=f"T{(i * 7 + 1) % 30}",
                         pts_h=110 + margin / 2, pts_a=110 - margin / 2, margin=margin, total=220, poss=100 + rng.normal(0, 3), rest_h=2, rest_a=2,
                         fg3a_h=35, fga_h=90, fg3a_a=35, fga_a=90, home_line=line))
g = pd.DataFrame(rows)
T = ts.team_rows(g); X = ts._design(g, T)
base = X.y.mean(); assert 0.45 <= base <= 0.55, base                     # with the right sign the base rate is ~50%
d = ts.fit(g, through=2021); assert d["feat"][0] == "d_win" and len(d["coef"]) == len(d["feat"]) and 0.45 <= 0.5
nums = ts.season_numbers(T, 2022, pd.Timestamp("2021-12-01"))
p = ts.prob_home_covers(d, nums.get("T1"), nums.get("T8"), 2, 1); assert p is not None and 0 < p < 1
# a flipped sign must be refused
g2 = g.copy(); g2["home_line"] = -g2["home_line"]
try:
    ts.fit(g2, through=2021); raise SystemExit("FAIL: flipped sign was accepted")
except ValueError:
    pass
print("team_side checks: all passed (base rate %.3f, fit n %d, p %.3f)" % (base, d["n"], p))
