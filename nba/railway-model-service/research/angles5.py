"""Edge hunt #5 (10/16): totals only, with season-relative pace / offense / defense ranks and schedule spots. Same protocol."""
import numpy as np, pandas as pd
import nba_data as nd
S = "/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/"
d = pd.read_pickle(S + "angles3_frame.pkl")
tg = nd.team_games(); tg = tg[tg.season_type == 2].sort_values(["date", "game_id"]).copy()
g = tg.groupby(["season", "team"], sort=False)
tg["gp"] = g.cumcount()
for col, src in (("off", "pts"), ("dfn", "opp_pts"), ("pace", "poss")): tg[col] = (g[src].cumsum() - tg[src]) / tg.gp.replace(0, np.nan)
tg["fga3"] = tg.three_point_field_goals_attempted / tg.field_goals_attempted; tg["r3"] = (g.fga3.cumsum() - tg.fga3) / tg.gp.replace(0, np.nan)
tg["ftr_g"] = tg.free_throws_attempted / tg.field_goals_attempted; tg["ftr"] = (g.ftr_g.cumsum() - tg.ftr_g) / tg.gp.replace(0, np.nan)
# rank within the season-to-date league (percentile by date): compare to the league average so far that season
lg = tg.groupby(["season", "date"])[["off", "dfn", "pace", "r3"]].transform("mean")
for col in ("off", "dfn", "pace", "r3"): tg[col + "_rel"] = tg[col] - lg[col]
cols = ["game_id", "team", "off_rel", "dfn_rel", "pace_rel", "r3_rel", "ftr", "gp"]
h = tg[cols].rename(columns={k: "h_" + k + "5" for k in cols if k not in ("game_id", "team")}).rename(columns={"team": "home"})
a = tg[cols].rename(columns={k: "a_" + k + "5" for k in cols if k not in ("game_id", "team")}).rename(columns={"team": "away"})
d = d.merge(h, on=["game_id", "home"], how="left").merge(a, on=["game_id", "away"], how="left")
d = d[(d.h_gp5 >= 10) & (d.a_gp5 >= 10)]
PERS = ["08-13", "14-19", "20+"]
def ev(mask, side, col="tres"):
    mask = pd.Series(mask).fillna(False).values.astype(bool); x = d[mask]; y = x[col] * side; nz = y != 0; w = (y[nz] > 0)
    per = [(w[x.per[nz] == p].mean() * 100 if (x.per[nz] == p).sum() else np.nan, int((x.per[nz] == p).sum())) for p in PERS]
    seas = w.groupby(x.season[nz]).mean(); return dict(n=int(len(w)), pct=w.mean() * 100, per=per, s_above=int((seas > 0.5).sum()), s_n=int(len(seas)))
def passes(r): return all(p[1] >= 60 and p[0] >= 52.38 for p in r["per"])
ANG = []
def A(name, mask, side): ANG.append((name, mask, side))
A("both teams faster than league avg by 3+ poss -> over", (d.h_pace_rel5 >= 3) & (d.a_pace_rel5 >= 3), 1)
A("both teams slower than league avg by 3+ poss -> under", (d.h_pace_rel5 <= -3) & (d.a_pace_rel5 <= -3), -1)
A("both top offenses (+4 pts above avg) -> over", (d.h_off_rel5 >= 4) & (d.a_off_rel5 >= 4), 1)
A("both top offenses -> under (priced)", (d.h_off_rel5 >= 4) & (d.a_off_rel5 >= 4), -1)
A("both bad defenses (allow +4 above avg) -> over", (d.h_dfn_rel5 >= 4) & (d.a_dfn_rel5 >= 4), 1)
A("both bad defenses -> under", (d.h_dfn_rel5 >= 4) & (d.a_dfn_rel5 >= 4), -1)
A("both good defenses (-4) -> under", (d.h_dfn_rel5 <= -4) & (d.a_dfn_rel5 <= -4), -1)
A("both good defenses -> over", (d.h_dfn_rel5 <= -4) & (d.a_dfn_rel5 <= -4), 1)
A("good offense vs bad defense both ways -> over", (d.h_off_rel5 >= 3) & (d.a_dfn_rel5 >= 3) & (d.a_off_rel5 >= 3) & (d.h_dfn_rel5 >= 3), 1)
A("both heavy 3-point teams (+3% attempt share) -> under", (d.h_r3_rel5 >= .03) & (d.a_r3_rel5 >= .03), -1)
A("both heavy 3-point teams -> over", (d.h_r3_rel5 >= .03) & (d.a_r3_rel5 >= .03), 1)
A("both low 3-point teams (-3%) -> under", (d.h_r3_rel5 <= -.03) & (d.a_r3_rel5 <= -.03), -1)
A("both low 3-point teams -> over", (d.h_r3_rel5 <= -.03) & (d.a_r3_rel5 <= -.03), 1)
A("both high free-throw rate -> over", (d.h_ftr5 >= .30) & (d.a_ftr5 >= .30), 1)
A("fast vs slow (gap 5+ poss) -> under", (d.h_pace_rel5 - d.a_pace_rel5).abs() >= 5, -1)
A("fast vs slow (gap 5+) -> over", (d.h_pace_rel5 - d.a_pace_rel5).abs() >= 5, 1)
A("fast pair + both rested 2+ -> over", (d.h_pace_rel5 >= 2) & (d.a_pace_rel5 >= 2) & (d.h_rest >= 2) & (d.a_rest >= 2), 1)
A("slow pair + either b2b -> under", (d.h_pace_rel5 <= -2) & (d.a_pace_rel5 <= -2) & ((d.h_rest == 1) | (d.a_rest == 1)), -1)
A("fast pair + either b2b -> under", (d.h_pace_rel5 >= 2) & (d.a_pace_rel5 >= 2) & ((d.h_rest == 1) | (d.a_rest == 1)), -1)
A("fast pair + either b2b -> over", (d.h_pace_rel5 >= 2) & (d.a_pace_rel5 >= 2) & ((d.h_rest == 1) | (d.a_rest == 1)), 1)
A("matinee (before 5 PM ET) + either b2b -> under", (d.tip_et < 17) & ((d.h_rest == 1) | (d.a_rest == 1)), -1)
A("matinee + slow pair -> under", (d.tip_et < 17) & (d.h_pace_rel5 <= 0) & (d.a_pace_rel5 <= 0), -1)
A("late tip + fast pair -> over", (d.tip_et >= 21.5) & (d.h_pace_rel5 >= 2) & (d.a_pace_rel5 >= 2), 1)
A("total line far above both teams' avg scoring (8+) -> under", d.total_line - (d.h_off_rel5 + d.a_off_rel5 + 2 * (d.h_l5pts + d.a_l5pts) / 2) >= 8, -1)
A("high total (235+) + either b2b -> under", (d.total_line >= 235) & ((d.h_rest == 1) | (d.a_rest == 1)), -1)
A("high total (235+) + both rested 2+ -> over", (d.total_line >= 235) & (d.h_rest >= 2) & (d.a_rest >= 2), 1)
A("low total (<= 210) + both rested 2+ -> over", (d.total_line <= 210) & (d.h_rest >= 2) & (d.a_rest >= 2), 1)
A("low total (<= 210) + either b2b -> under", (d.total_line <= 210) & ((d.h_rest == 1) | (d.a_rest == 1)), -1)
res = []
for name, mask, side in ANG:
    r = ev(mask, side); r["name"] = name; r["pass"] = passes(r); res.append(r)
res.sort(key=lambda r: -r["pct"])
for r in res:
    per = " / ".join(f"{p[0]:.1f}({p[1]})" for p in r["per"])
    print(f"{('* ' if r['pass'] else '  ') + r['name']:64s} {r['n']:6d} {r['pct']:6.1f}  {per}   {r['s_above']}/{r['s_n']}")
print("PASSED:", [r["name"] for r in res if r["pass"]])
rng = np.random.default_rng(4); passed = []
for k in range(20):
    d["tres_sh"] = d.groupby("season")["tres"].transform(lambda s: s.sample(frac=1, random_state=int(rng.integers(1e9))).values)
    passed.append(sum(passes(ev(m, sd, "tres_sh")) for _, m, sd in ANG))
print(f"shuffle baseline: {np.mean(passed):.1f} pass by luck (max {max(passed)}) of {len(ANG)}")
