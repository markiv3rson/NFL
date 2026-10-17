"""Edge hunt #3 (10/16): fatigue from the player box (minutes yesterday), rust, b2b after a close game / blowout / altitude. Same protocol as angles2."""
import sys, numpy as np, pandas as pd
import nba_data as nd, nba_features as nf
S = "/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/"
d = pd.read_pickle(S + "angles2_frame.pkl"); c = pd.read_pickle(S + "ctx.pkl")[["game_id", "h_trav_km", "a_trav_km", "h_streak", "a_streak"]]
d = d.merge(c, on="game_id", how="left")
pb = nf.player_games(); pb = pb[pb.played]
top5 = pb.sort_values("min", ascending=False).groupby(["game_id", "team"]).head(5).groupby(["game_id", "team"])["min"].sum().rename("top5")
star = pb.sort_values("min", ascending=False).groupby(["game_id", "team"]).head(1).groupby(["game_id", "team"])["min"].max().rename("star_min")
tg = nd.team_games(); tg = tg[tg.season_type == 2].sort_values(["date", "game_id"]).merge(top5.reset_index(), on=["game_id", "team"], how="left").merge(star.reset_index(), on=["game_id", "team"], how="left")
g = tg.groupby(["season", "team"], sort=False)
tg["last_top5"] = g.top5.shift(1); tg["last_star"] = g.star_min.shift(1); tg["last_abs_margin"] = (g.pts.shift(1) - g.opp_pts.shift(1)).abs()
tg["last_opp"] = g.opp.shift(1); tg["last_home"] = g.home.shift(1)
ALT = {"Denver Nuggets", "Utah Jazz"}
tg["last_at_alt"] = (tg.last_home == 0) & tg.last_opp.isin(ALT)
cols = ["game_id", "team", "last_top5", "last_star", "last_abs_margin", "last_at_alt"]
h = tg[cols].rename(columns={k: "h_" + k for k in cols if k not in ("game_id", "team")}).rename(columns={"team": "home"})
a = tg[cols].rename(columns={k: "a_" + k for k in cols if k not in ("game_id", "team")}).rename(columns={"team": "away"})
d = d.merge(h, on=["game_id", "home"], how="left").merge(a, on=["game_id", "away"], how="left")
PERS = ["08-13", "14-19", "20+"]
def ev(mask, side, col="res"):
    mask = pd.Series(mask).fillna(False).values.astype(bool)
    x = d[mask]; y = x[col] * (side if np.isscalar(side) else side[mask]); nz = y != 0; w = (y[nz] > 0)
    per = [(w[x.per[nz] == p].mean() * 100 if (x.per[nz] == p).sum() else np.nan, int((x.per[nz] == p).sum())) for p in PERS]
    seas = w.groupby(x.season[nz]).mean(); return dict(n=int(len(w)), pct=w.mean() * 100, per=per, s_above=int((seas > 0.5).sum()), s_n=int(len(seas)))
def passes(r): return all(p[1] >= 60 and p[0] >= 52.38 for p in r["per"])
hb = d.h_rest == 1; ab = d.a_rest == 1
ANG = []
def A(name, mask, side, col="res"): ANG.append((name, mask, side, col))
A("b2b + heavy minutes yesterday (top5 >= 180) home -> fade", hb & (d.h_last_top5 >= 180), -1)
A("b2b + heavy minutes yesterday (top5 >= 180) away -> fade", ab & (d.a_last_top5 >= 180), 1)
A("b2b + heavy minutes either (one side) -> fade", (hb & (d.h_last_top5 >= 180)) ^ (ab & (d.a_last_top5 >= 180)), np.where(hb & (d.h_last_top5 >= 180), -1, 1))
A("b2b + very heavy minutes (top5 >= 190) either -> fade", (hb & (d.h_last_top5 >= 190)) ^ (ab & (d.a_last_top5 >= 190)), np.where(hb & (d.h_last_top5 >= 190), -1, 1))
A("b2b + light minutes yesterday (top5 <= 150) home -> bet", hb & (d.h_last_top5 <= 150), 1)
A("b2b + light minutes yesterday (top5 <= 150) away -> bet", ab & (d.a_last_top5 <= 150), -1)
A("b2b + star played 40+ yesterday home -> fade", hb & (d.h_last_star >= 40), -1)
A("b2b + star played 40+ yesterday away -> fade", ab & (d.a_last_star >= 40), 1)
A("b2b + star 40+ either (one side) -> fade", (hb & (d.h_last_star >= 40)) ^ (ab & (d.a_last_star >= 40)), np.where(hb & (d.h_last_star >= 40), -1, 1))
A("b2b after a close game (margin <= 3) home -> fade", hb & (d.h_last_abs_margin <= 3), -1)
A("b2b after a close game (margin <= 3) away -> fade", ab & (d.a_last_abs_margin <= 3), 1)
A("b2b after a blowout (20+) home -> bet", hb & (d.h_last_abs_margin >= 20), 1)
A("b2b after a blowout (20+) away -> bet", ab & (d.a_last_abs_margin >= 20), -1)
A("b2b after playing at altitude (DEN/UTA) away -> fade", ab & (d.a_last_at_alt == True), 1)
A("b2b after playing at altitude (DEN/UTA) home -> fade", hb & (d.h_last_at_alt == True), -1)
A("rust: home rested 4+ vs away 1-2 -> fade home", (d.h_rest >= 4) & (d.a_rest <= 2), -1)
A("rust: away rested 4+ vs home 1-2 -> fade away", (d.a_rest >= 4) & (d.h_rest <= 2), 1)
A("rest edge: home rested 2 vs away b2b -> bet home", (d.h_rest == 2) & ab, 1)
A("rest edge: away rested 2 vs home b2b -> bet away", (d.a_rest == 2) & hb, -1)
A("3-in-4 + flew 1500km+ away -> fade", (d.a_in3 == True) & (d.a_trav_km >= 1500), 1)
A("3-in-4 + flew 1500km+ home -> fade", (d.h_in3 == True) & (d.h_trav_km >= 1500), -1)
A("b2b + flew 1500km+ away -> fade", ab & (d.a_trav_km >= 1500), 1)
A("b2b + flew 1500km+ home -> fade", hb & (d.h_trav_km >= 1500), -1)
A("win streak 5+ home -> fade", d.h_streak >= 5, -1)
A("win streak 5+ away -> fade", d.a_streak >= 5, 1)
A("loss streak 5+ home -> bet", d.h_streak <= -5, 1)
A("loss streak 5+ away -> bet", d.a_streak <= -5, -1)
A("OT yesterday OR top5 >= 185 (fatigue), one side -> fade", ((hb & ((d.h_last_ot == True) | (d.h_last_top5 >= 185))) ^ (ab & ((d.a_last_ot == True) | (d.a_last_top5 >= 185)))), np.where(hb & ((d.h_last_ot == True) | (d.h_last_top5 >= 185)), -1, 1))
# totals
A("b2b + heavy minutes either -> under", (hb & (d.h_last_top5 >= 180)) | (ab & (d.a_last_top5 >= 180)), -1, "tres")
A("both b2b + both heavy -> under", hb & ab & (d.h_last_top5 >= 175) & (d.a_last_top5 >= 175), -1, "tres")
A("both rested 2+ and both top-quarter pace -> over", (d.h_rest >= 2) & (d.a_rest >= 2) & (d.h_poss_s >= 100) & (d.a_poss_s >= 100), 1, "tres")
A("b2b after altitude either -> under", (ab & (d.a_last_at_alt == True)) | (hb & (d.h_last_at_alt == True)), -1, "tres")
A("both after a blowout -> over", (d.h_last_abs_margin >= 20) & (d.a_last_abs_margin >= 20), 1, "tres")
A("both after a close game -> under", (d.h_last_abs_margin <= 3) & (d.a_last_abs_margin <= 3), -1, "tres")
res = []
for name, mask, side, col in ANG:
    r = ev(mask, side, col); r["name"] = name; r["pass"] = passes(r); res.append(r)
res.sort(key=lambda r: -r["pct"])
for r in res:
    per = " / ".join(f"{p[0]:.1f}({p[1]})" for p in r["per"])
    print(f"{('* ' if r['pass'] else '  ') + r['name']:66s} {r['n']:6d} {r['pct']:6.1f}  {per}   {r['s_above']}/{r['s_n']}")
print("PASSED:", [r["name"] for r in res if r["pass"]])
rng = np.random.default_rng(2); passed = []
for k in range(20):
    for col in ("res", "tres"): d[col + "_sh"] = d.groupby("season")[col].transform(lambda s: s.sample(frac=1, random_state=int(rng.integers(1e9))).values)
    passed.append(sum(passes(ev(m, sd, cl + "_sh")) for _, m, sd, cl in ANG))
print(f"shuffle baseline: {np.mean(passed):.1f} pass by luck (max {max(passed)}) of {len(ANG)}")
d.to_pickle(S + "angles3_frame.pkl")
