"""Edge hunt #4 (10/16): ATS regression, favorites off a loss, body clock, home-and-home rematches, totals by tip / weekend. Same protocol."""
import numpy as np, pandas as pd
S = "/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/"
d = pd.read_pickle(S + "angles3_frame.pkl"); c = pd.read_pickle(S + "ctx.pkl")[["game_id", "h_cover5", "a_cover5", "h_last_cover", "a_last_cover", "h_last_over", "a_last_over", "h_last_total", "a_last_total"]]
d = d.merge(c, on="game_id", how="left").sort_values(["date", "game_id"]).reset_index(drop=True)
# season ATS record to date per team, and the previous meeting
cov = {}; last_meet = {}; h_ats = []; a_ats = []; h_gpl = []; a_gpl = []; prev = []
for r in d.itertuples():
    for team, out, outn in ((r.home, h_ats, h_gpl), (r.away, a_ats, a_gpl)):
        k = (r.season, team); w, n = cov.get(k, (0, 0)); out.append(w / n if n else np.nan); outn.append(n)
    key = (r.season, frozenset((r.home, r.away))); pm = last_meet.get(key); prev.append(pm)
    hc = 1 if r.res > 0 else 0 if r.res < 0 else None
    if hc is not None:
        k = (r.season, r.home); w, n = cov.get(k, (0, 0)); cov[k] = (w + hc, n + 1)
        k = (r.season, r.away); w, n = cov.get(k, (0, 0)); cov[k] = (w + 1 - hc, n + 1)
    last_meet[key] = (r.date, r.home, r.margin)
d["h_ats"] = h_ats; d["a_ats"] = a_ats; d["h_atsn"] = h_gpl; d["a_atsn"] = a_gpl
d["prev_days"] = [(r.date - p[0]).days if p else np.nan for r, p in zip(d.itertuples(), prev)]
d["prev_home_won_by"] = [(p[2] if p[1] == r.home else -p[2]) if p else np.nan for r, p in zip(d.itertuples(), prev)]   # last meeting's margin from today's home team's view
PERS = ["08-13", "14-19", "20+"]
def ev(mask, side, col="res"):
    mask = pd.Series(mask).fillna(False).values.astype(bool); x = d[mask]; y = x[col] * (side if np.isscalar(side) else side[mask]); nz = y != 0; w = (y[nz] > 0)
    per = [(w[x.per[nz] == p].mean() * 100 if (x.per[nz] == p).sum() else np.nan, int((x.per[nz] == p).sum())) for p in PERS]
    seas = w.groupby(x.season[nz]).mean(); return dict(n=int(len(w)), pct=w.mean() * 100, per=per, s_above=int((seas > 0.5).sum()), s_n=int(len(seas)))
def passes(r): return all(p[1] >= 60 and p[0] >= 52.38 for p in r["per"])
fav = np.where(d.fav_home, 1, -1); dog = -fav
h_fav_lost = d.fav_home & (d.h_last_margin < 0); a_fav_lost = ~d.fav_home & (d.a_last_margin < 0)
ANG = []
def A(name, mask, side, col="res"): ANG.append((name, mask, side, col))
A("ATS regression: home covering 65%+ (20+ gp) -> fade", (d.h_atsn >= 20) & (d.h_ats >= .65), -1)
A("ATS regression: away covering 65%+ (20+ gp) -> fade", (d.a_atsn >= 20) & (d.a_ats >= .65), 1)
A("ATS regression: home covering 35%- (20+ gp) -> bet", (d.h_atsn >= 20) & (d.h_ats <= .35), 1)
A("ATS regression: away covering 35%- (20+ gp) -> bet", (d.a_atsn >= 20) & (d.a_ats <= .35), -1)
A("favorite lost its last game -> bet favorite", h_fav_lost | a_fav_lost, fav)
A("favorite lost its last game -> bet dog", h_fav_lost | a_fav_lost, dog)
A("favorite 8+ lost its last game -> bet favorite", (h_fav_lost & (d.home_line >= 8)) | (a_fav_lost & (d.home_line <= -8)), fav)
A("dog won its last game -> fade dog", (d.fav_home & (d.a_last_margin > 0)) | (~d.fav_home & (d.h_last_margin > 0)), fav)
A("dog won its last game -> bet dog", (d.fav_home & (d.a_last_margin > 0)) | (~d.fav_home & (d.h_last_margin > 0)), dog)
A("favorite won last by 20+ -> fade favorite", (d.fav_home & (d.h_last_margin >= 20)) | (~d.fav_home & (d.a_last_margin >= 20)), dog)
A("body clock: away flew 1500+ km, tip before 7:30 PM ET -> fade", (d.a_trav_km >= 1500) & (d.tip_et < 19.5), 1)
A("body clock: away flew 1500+ km, tip before 7:30 PM ET, b2b -> fade", (d.a_trav_km >= 1500) & (d.tip_et < 19.5) & (d.a_rest == 1), 1)
A("road favorite 10+ on a back-to-back -> fade", (d.home_line <= -10) & (d.a_rest == 1), 1)
A("home favorite 10+ on a back-to-back -> fade", (d.home_line >= 10) & (d.h_rest == 1), -1)
A("home-and-home: same teams within 3 days, loser of game 1 -> bet", d.prev_days <= 3, np.where(d.prev_home_won_by > 0, -1, 1))
A("rematch within 10 days, loser of game 1 -> bet", d.prev_days <= 10, np.where(d.prev_home_won_by > 0, -1, 1))
A("rematch within 10 days, game-1 loser lost by 15+ -> bet", (d.prev_days <= 10) & (d.prev_home_won_by.abs() >= 15), np.where(d.prev_home_won_by > 0, -1, 1))
A("rematch: home lost the last meeting by 15+ -> bet home", d.prev_home_won_by <= -15, 1)
A("rematch: home won the last meeting by 15+ -> fade home", d.prev_home_won_by >= 15, -1)
A("home covered 4+ of last 5 -> fade", d.h_cover5 >= .8, -1)
A("away covered 4+ of last 5 -> fade", d.a_cover5 >= .8, 1)
A("home covered 1 or fewer of last 5 -> bet", d.h_cover5 <= .2, 1)
A("away covered 1 or fewer of last 5 -> bet", d.a_cover5 <= .2, -1)
A("both teams failed to cover last game -> bet home", (d.h_last_cover == 0) & (d.a_last_cover == 0), 1)
A("favorite failed to cover last 3 of 5 and lost last -> bet favorite", ((d.fav_home & (d.h_cover5 <= .4) & (d.h_last_margin < 0)) | (~d.fav_home & (d.a_cover5 <= .4) & (d.a_last_margin < 0))), fav)
# totals
A("weekend matinee (Sat/Sun, tip before 5 PM ET) -> under", d.dow.isin([5, 6]) & (d.tip_et < 17), -1, "tres")
A("weekend matinee -> over", d.dow.isin([5, 6]) & (d.tip_et < 17), 1, "tres")
A("both teams' last game went under by 15+ -> over", ((d.h_last_total - d.total_line) <= -15) & ((d.a_last_total - d.total_line) <= -15), 1, "tres")
A("both teams' last game went over by 15+ -> under", ((d.h_last_total - d.total_line) >= 15) & ((d.a_last_total - d.total_line) >= 15), -1, "tres")
A("both last games went over -> under", (d.h_last_over == 1) & (d.a_last_over == 1), -1, "tres")
A("both last games went under -> over", (d.h_last_over == 0) & (d.a_last_over == 0), 1, "tres")
A("rematch within 10 days -> over", d.prev_days <= 10, 1, "tres")
A("rematch within 10 days -> under", d.prev_days <= 10, -1, "tres")
A("heavy favorite (12+) on a back-to-back -> under", (d.home_line.abs() >= 12) & ((d.h_rest == 1) | (d.a_rest == 1)), -1, "tres")
A("tip 10 PM+ ET + both rested 2+ -> over", (d.tip_et >= 22) & (d.h_rest >= 2) & (d.a_rest >= 2), 1, "tres")
A("fatigue game (OT / long flight b2b) -> under", ((d.h_rest == 1) & ((d.h_last_ot == True) | (d.h_trav_km >= 1500))) | ((d.a_rest == 1) & ((d.a_last_ot == True) | (d.a_trav_km >= 1500))), -1, "tres")
res = []
for name, mask, side, col in ANG:
    r = ev(mask, side, col); r["name"] = name; r["pass"] = passes(r); res.append(r)
res.sort(key=lambda r: -r["pct"])
for r in res:
    per = " / ".join(f"{p[0]:.1f}({p[1]})" for p in r["per"])
    print(f"{('* ' if r['pass'] else '  ') + r['name']:72s} {r['n']:6d} {r['pct']:6.1f}  {per}   {r['s_above']}/{r['s_n']}")
print("PASSED:", [r["name"] for r in res if r["pass"]])
rng = np.random.default_rng(3); passed = []
for k in range(20):
    for col in ("res", "tres"): d[col + "_sh"] = d.groupby("season")[col].transform(lambda s: s.sample(frac=1, random_state=int(rng.integers(1e9))).values)
    passed.append(sum(passes(ev(m, sd, cl + "_sh")) for _, m, sd, cl in ANG))
print(f"shuffle baseline: {np.mean(passed):.1f} pass by luck (max {max(passed)}) of {len(ANG)}")
# model rebuild check: fatigue terms on top of the market line (each season held out)
from sklearn.linear_model import LinearRegression
hb = d.h_rest == 1; ab = d.a_rest == 1
X = pd.DataFrame({"ot": ((hb & (d.h_last_ot == True)).astype(int) - (ab & (d.a_last_ot == True)).astype(int)).values, "far": ((hb & (d.h_trav_km >= 1500)).astype(int) - (ab & (d.a_trav_km >= 1500)).astype(int)).values, "b2b": (hb.astype(int) - ab.astype(int)).values}, index=d.index)
p = pd.Series(0.0, index=d.index)
for s in d.season.unique():
    tr = d.season != s; p[d.season == s] = LinearRegression().fit(X[tr], d.res[tr]).predict(X[d.season == s])
m = LinearRegression().fit(X, d.res); print("market miss", round(d.res.abs().mean(), 4), "-> with fatigue terms", round((d.res - p).abs().mean(), 4), "| points per: OT %.2f, long flight %.2f, plain b2b %.2f" % tuple(m.coef_))
sel = p.abs() >= 1.0; w = ((np.sign(p[sel]) * d.res[sel]) > 0)[d.res[sel] != 0]; print("bet the fatigue-model side when it says 1+ pt:", round(w.mean() * 100, 1), "% of", len(w))
