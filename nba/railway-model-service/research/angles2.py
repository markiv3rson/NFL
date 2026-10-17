"""Edge hunt #2 (10/16): spread and total angles not tried before, closing lines 2008-2026, regular season. Pooled %, three periods, seasons above 50,
and a shuffle baseline (results permuted within each season) that says how many angles pass by luck. Pass = 52.4%+ in every period, 60+ games each."""
import sys, numpy as np, pandas as pd
import nba_data as nd
S = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/"
c = pd.read_pickle(S + "ctx.pkl")
c = c[(c.season_type == 2) & c.home_line.notna()].copy()
tg = nd.team_games(); tg = tg[tg.season_type == 2].sort_values(["date", "game_id"]).copy()
# ---- per-team running state before each game (season to date)
tg["win"] = (tg.pts > tg.opp_pts).astype(int); tg["margin"] = tg.pts - tg.opp_pts
tg["p3"] = tg.three_point_field_goals_made / tg.three_point_field_goals_attempted.replace(0, np.nan)
tg["ftr"] = tg.free_throws_attempted / tg.field_goals_attempted
g = tg.groupby(["season", "team"], sort=False)
tg["gp"] = g.cumcount()
tg["pf"] = g.pts.cumsum() - tg.pts; tg["pa"] = g.opp_pts.cumsum() - tg.opp_pts; tg["w"] = g.win.cumsum() - tg.win
tg["pyth"] = tg.pf ** 14 / (tg.pf ** 14 + tg.pa ** 14)
tg["wpct"] = tg.w / tg.gp.replace(0, np.nan); tg["luck"] = tg.wpct - tg.pyth
tg["last_p3"] = g.p3.shift(1); tg["last_margin"] = g.margin.shift(1); tg["last_opp_pts"] = g.opp_pts.shift(1); tg["last_pts"] = g.pts.shift(1)
tg["last_home"] = g.home.shift(1); tg["last2_home"] = g.home.shift(2); tg["last3_home"] = g.home.shift(3)
tg["last_date"] = g.date.shift(1); tg["rest"] = (pd.to_datetime(tg.date) - pd.to_datetime(tg.last_date)).dt.days
tg["next_date"] = g.date.shift(-1); tg["next_gap"] = (pd.to_datetime(tg.next_date) - pd.to_datetime(tg.date)).dt.days
tg["g3"] = g.date.shift(3); tg["in4"] = (pd.to_datetime(tg.date) - pd.to_datetime(tg.g3)).dt.days <= 4   # 4th game in 5 nights (4 games in last 5 days incl. today)
tg["g2"] = g.date.shift(2); tg["in3"] = (pd.to_datetime(tg.date) - pd.to_datetime(tg.g2)).dt.days <= 3   # 3 in 4
tg["l3m"] = g.margin.transform(lambda x: x.shift(1).rolling(3).mean())
tg["l10w"] = g.win.transform(lambda x: x.shift(1).rolling(10).mean())
tg["l10p3"] = g.p3.transform(lambda x: x.shift(1).rolling(10).mean())
tg["l3p3"] = g.p3.transform(lambda x: x.shift(1).rolling(3).mean())
tg["l5pts"] = g.pts.transform(lambda x: x.shift(1).rolling(5).mean())
tg["l5opp"] = g.opp_pts.transform(lambda x: x.shift(1).rolling(5).mean())
tg["poss5"] = g.poss.transform(lambda x: x.shift(1).rolling(5).mean())
tg["poss_s"] = (g.poss.cumsum() - tg.poss) / tg.gp.replace(0, np.nan)
# home stand / road trip length BEFORE this game (consecutive same-venue games just played)
run = []
for (s, t), grp in tg.groupby(["season", "team"], sort=False):
    cnt = 0; prev = None; out = []
    for h in grp.home.values:
        out.append(cnt if prev is not None else 0)
        cnt = cnt + 1 if prev is not None and h == prev else 1; prev = h
    run.extend(out)
tg["venue_run"] = run     # how many games in a row at the same venue type BEFORE this one (0 = first game)
# last game played overtime: total minutes from the player box (> 250 team minutes)
try:
    import nba_features as nf
    pb = nf.player_games(); pb = pb[pb.played]
    mins = pb.groupby(["game_id", "team"])["min"].sum().rename("team_min").reset_index()
    tg = tg.merge(mins, on=["game_id", "team"], how="left")
    tg["ot"] = tg.team_min > 250
    tg["last_ot"] = tg.groupby(["season", "team"], sort=False).ot.shift(1)
except Exception as e:
    print("no player box:", e); tg["last_ot"] = False
# All-Star break: a gap of 6+ days in February
tg["month"] = pd.to_datetime(tg.date).dt.month
tg["after_asb"] = (tg.rest >= 6) & (tg.month == 2) & (tg.gp >= 40)
tg["before_asb"] = (tg.next_gap >= 6) & (tg.month == 2) & (tg.gp >= 40)
# schedule: tip time (ET hour) and national TV
rows = []
for s in range(2008, nd.current_season() + 1):
    sc = nd.schedule(s)
    if sc is None or not len(sc): continue
    for col_ in ("broadcast_name", "broadcast"):
        if col_ not in sc.columns: sc[col_] = ""
    sc = sc[["game_id", "game_date_time", "broadcast_name", "broadcast"]].copy()
    sc["broadcast_name"] = sc.broadcast_name.fillna("").astype(str) + " " + sc.broadcast.fillna("").astype(str)
    sc["tip_et"] = pd.to_datetime(sc.game_date_time, utc=True, errors="coerce").dt.tz_convert("America/New_York").dt.hour
    rows.append(sc)
sch = pd.concat(rows).drop_duplicates("game_id")
sch["tv"] = sch.broadcast_name.fillna("").str.contains(r"ESPN|TNT|ABC|NBA TV|NBATV", case=False)
cols = ["game_id", "team", "gp", "pyth", "wpct", "luck", "last_p3", "last_margin", "last_pts", "last_opp_pts", "last_home", "rest", "in4", "in3", "l3m", "l10w", "l10p3", "l3p3", "l5pts", "l5opp", "poss5", "poss_s", "venue_run", "last_ot", "after_asb", "before_asb", "month"]
h = tg[cols].rename(columns={k: "h_" + k for k in cols if k not in ("game_id", "team")}).rename(columns={"team": "home"})
a = tg[cols].rename(columns={k: "a_" + k for k in cols if k not in ("game_id", "team")}).rename(columns={"team": "away"})
keep_ctx = ["game_id", "season", "season_type", "date", "home", "away", "margin", "total", "home_line", "total_line", "ml_home", "ml_away"]
c = c[[x for x in c.columns if x in keep_ctx]]          # the context frame's own h_/a_ columns clash with the fresh ones built here
d = c.merge(h, on=["game_id", "home"]).merge(a, on=["game_id", "away"]).merge(sch[["game_id", "tip_et", "tv"]], on="game_id", how="left")
d["res"] = d.margin - d.home_line; d["tres"] = d.total - d.total_line
d["per"] = pd.cut(d.season, [0, 2013, 2019, 2100], labels=["08-13", "14-19", "20+"])
d["fav_home"] = d.home_line > 0; d["dow"] = pd.to_datetime(d.date).dt.dayofweek
print(len(d), "games with lines and features")
PERS = ["08-13", "14-19", "20+"]
def ev(mask, side, col="res"):
    x = d[mask]; y = x[col] * (side if np.isscalar(side) else side[mask]); nz = y != 0; w = (y[nz] > 0)
    per = [(w[x.per[nz] == p].mean() * 100 if (x.per[nz] == p).sum() else np.nan, int((x.per[nz] == p).sum())) for p in PERS]
    seas = w.groupby(x.season[nz]).mean(); return dict(n=int(len(w)), pct=w.mean() * 100, per=per, s_above=int((seas > 0.5).sum()), s_n=int(len(seas)))
def passes(r): return all(p[1] >= 60 and p[0] >= 52.38 for p in r["per"])
ANG = []
def A(name, mask, side, col="res"): ANG.append((name, mask, side, col))
# ---- SPREAD angles
A("tank: late season (gp 65+) team under .350 as dog -> bet favorite", (d.h_gp >= 65) & (((d.h_wpct < .35) & ~d.fav_home) | ((d.a_wpct < .35) & d.fav_home)), np.where(d.fav_home, 1, -1))
A("tank: late season bad dog -> bet the dog", (d.h_gp >= 65) & (((d.h_wpct < .35) & ~d.fav_home) | ((d.a_wpct < .35) & d.fav_home)), np.where(d.fav_home, -1, 1))
A("late season (gp 70+) favorite .650+ (resting) -> fade", (d.h_gp >= 70) & (((d.h_wpct >= .65) & d.fav_home) | ((d.a_wpct >= .65) & ~d.fav_home)), np.where(d.fav_home, -1, 1))
A("lucky home team (win% - pyth >= .10, gp 20+) -> fade", (d.h_gp >= 20) & (d.h_luck >= .10), -1)
A("lucky away team (win% - pyth >= .10, gp 20+) -> fade", (d.a_gp >= 20) & (d.a_luck >= .10), 1)
A("unlucky home team (win% - pyth <= -.10) -> bet", (d.h_gp >= 20) & (d.h_luck <= -.10), 1)
A("unlucky away team (win% - pyth <= -.10) -> bet", (d.a_gp >= 20) & (d.a_luck <= -.10), -1)
A("home team shot 45%+ from 3 last game -> fade", d.h_last_p3 >= .45, -1)
A("away team shot 45%+ from 3 last game -> fade", d.a_last_p3 >= .45, 1)
A("home team shot under 25% from 3 last game -> bet", d.h_last_p3 <= .25, 1)
A("away team shot under 25% from 3 last game -> bet", d.a_last_p3 <= .25, -1)
A("home hot from 3 over last 3 (40%+) -> fade", d.h_l3p3 >= .40, -1)
A("away hot from 3 over last 3 (40%+) -> fade", d.a_l3p3 >= .40, 1)
A("home team played OT yesterday -> fade", (d.h_last_ot == True) & (d.h_rest == 1), -1)
A("away team played OT yesterday -> fade", (d.a_last_ot == True) & (d.a_rest == 1), 1)
A("away 4th game in 5 nights -> bet home", d.a_in4 == True, 1)
A("home 4th game in 5 nights -> bet away", d.h_in4 == True, -1)
A("home first game back after 4+ road games -> bet home", (d.h_venue_run >= 4) & (d.h_last_home == 0), 1)
A("home first game back after 4+ road games -> fade", (d.h_venue_run >= 4) & (d.h_last_home == 0), -1)
A("away first road game after 4+ home games -> fade", (d.a_venue_run >= 4) & (d.a_last_home == 1), 1)
A("away 5th+ straight road game -> fade", (d.a_venue_run >= 4) & (d.a_last_home == 0), 1)
A("away 5th+ straight road game -> bet", (d.a_venue_run >= 4) & (d.a_last_home == 0), -1)
A("home 5th+ straight home game -> fade", (d.h_venue_run >= 4) & (d.h_last_home == 1), -1)
A("first game after All-Star break: bet home", d.h_after_asb & d.a_after_asb, 1)
A("first game after All-Star break: bet dog", d.h_after_asb & d.a_after_asb, np.where(d.fav_home, -1, 1))
A("last game before All-Star break: bet dog", d.h_before_asb & d.a_before_asb, np.where(d.fav_home, -1, 1))
A("last game before All-Star break: bet favorite", d.h_before_asb & d.a_before_asb, np.where(d.fav_home, 1, -1))
A("letdown: home won last by 15+ vs .600 team? -> fade home (won big last)", d.h_last_margin >= 15, -1)
A("letdown: away won last by 15+ -> fade away", d.a_last_margin >= 15, 1)
A("home lost last by 20+ -> bet home", d.h_last_margin <= -20, 1)
A("away lost last by 20+ -> bet away", d.a_last_margin <= -20, -1)
A("home dog of 1-3 -> bet home", (d.home_line <= -1) & (d.home_line >= -3), 1)
A("pick'em (line within 1) -> bet home", d.home_line.abs() < 1, 1)
A("home favorite 10+ -> bet home", d.home_line >= 10, 1)
A("home favorite 10+ -> bet dog", d.home_line >= 10, -1)
A("road favorite 5+ -> bet favorite", d.home_line <= -5, -1)
A("road favorite 5+ -> bet home dog", d.home_line <= -5, 1)
A("national TV game -> bet dog", d.tv == True, np.where(d.fav_home, -1, 1))
A("national TV game -> bet favorite", d.tv == True, np.where(d.fav_home, 1, -1))
A("national TV -> bet home", d.tv == True, 1)
A("early tip (before 4 PM ET) -> bet home", d.tip_et < 16, 1)
A("early tip (before 4 PM ET) -> bet dog", d.tip_et < 16, np.where(d.fav_home, -1, 1))
A("late tip (10 PM ET or later) -> bet home", d.tip_et >= 22, 1)
A("Sunday game -> bet home", d.dow == 6, 1)
A("Monday game -> bet dog", d.dow == 0, np.where(d.fav_home, -1, 1))
A("home 8-2 or better last 10 -> fade", d.h_l10w >= .8, -1)
A("away 8-2 or better last 10 -> fade", d.a_l10w >= .8, 1)
A("home 2-8 or worse last 10 -> bet", d.h_l10w <= .2, 1)
A("away 2-8 or worse last 10 -> bet", d.a_l10w <= .2, -1)
A("home avg margin last 3 >= +15 -> fade", d.h_l3m >= 15, -1)
A("away avg margin last 3 >= +15 -> fade", d.a_l3m >= 15, 1)
A("home avg margin last 3 <= -15 -> bet", d.h_l3m <= -15, 1)
A("away avg margin last 3 <= -15 -> bet", d.a_l3m <= -15, -1)
A("rested home (3+) vs away 3-in-4 -> bet home", (d.h_rest >= 3) & (d.a_in3 == True), 1)
A("rested away (3+) vs home 3-in-4 -> bet away", (d.a_rest >= 3) & (d.h_in3 == True), -1)
A("both on back-to-back -> bet home", (d.h_rest == 1) & (d.a_rest == 1), 1)
A("both on back-to-back -> bet dog", (d.h_rest == 1) & (d.a_rest == 1), np.where(d.fav_home, -1, 1))
A("October / first 5 games: bet home", (d.h_gp < 5) & (d.a_gp < 5), 1)
A("October / first 5 games: bet dog", (d.h_gp < 5) & (d.a_gp < 5), np.where(d.fav_home, -1, 1))
A("March/April: bet dog", d.h_month.isin([3, 4]), np.where(d.fav_home, -1, 1))
A("March/April: bet favorite", d.h_month.isin([3, 4]), np.where(d.fav_home, 1, -1))
A("Nov/Dec: bet home", d.h_month.isin([11, 12]), 1)
# ---- TOTAL angles (side +1 = over, -1 = under)
A("both teams shot 40%+ from 3 last game -> under", (d.h_last_p3 >= .40) & (d.a_last_p3 >= .40), -1, "tres")
A("both teams shot under 30% from 3 last game -> over", (d.h_last_p3 <= .30) & (d.a_last_p3 <= .30), 1, "tres")
A("both fast (season pace top: poss 102+) -> over", (d.h_poss_s >= 102) & (d.a_poss_s >= 102), 1, "tres")
A("both slow (poss <= 94) -> under", (d.h_poss_s <= 94) & (d.a_poss_s <= 94), -1, "tres")
A("pace mismatch 6+ poss -> under", (d.h_poss_s - d.a_poss_s).abs() >= 6, -1, "tres")
A("both on back-to-back -> under", (d.h_rest == 1) & (d.a_rest == 1), -1, "tres")
A("both rested 3+ -> over", (d.h_rest >= 3) & (d.a_rest >= 3), 1, "tres")
A("either played OT yesterday -> under", ((d.h_last_ot == True) & (d.h_rest == 1)) | ((d.a_last_ot == True) & (d.a_rest == 1)), -1, "tres")
A("either 4th in 5 nights -> under", (d.h_in4 == True) | (d.a_in4 == True), -1, "tres")
A("after All-Star break (both) -> over", d.h_after_asb & d.a_after_asb, 1, "tres")
A("before All-Star break (both) -> over", d.h_before_asb & d.a_before_asb, 1, "tres")
A("total 240+ -> under", d.total_line >= 240, -1, "tres")
A("total <= 200 -> over", d.total_line <= 200, 1, "tres")
A("spread 12+ -> under", d.home_line.abs() >= 12, -1, "tres")
A("spread 12+ -> over", d.home_line.abs() >= 12, 1, "tres")
A("pick'em (within 1) -> over", d.home_line.abs() < 1, 1, "tres")
A("national TV -> under", d.tv == True, -1, "tres")
A("national TV -> over", d.tv == True, 1, "tres")
A("early tip (before 4 PM ET) -> under", d.tip_et < 16, -1, "tres")
A("late tip (10 PM+ ET) -> over", d.tip_et >= 22, 1, "tres")
A("both scored 120+ last game -> under", (d.h_last_pts >= 120) & (d.a_last_pts >= 120), -1, "tres")
A("both allowed 120+ last game -> under", (d.h_last_opp_pts >= 120) & (d.a_last_opp_pts >= 120), -1, "tres")
A("both under 100 last game -> over", (d.h_last_pts < 100) & (d.a_last_pts < 100), 1, "tres")
A("last-5 scoring both 5+ above season line avg -> under", ((d.h_l5pts + d.a_l5opp) / 2 + (d.a_l5pts + d.h_l5opp) / 2) - d.total_line >= 8, -1, "tres")
A("last-5 scoring both 5+ below line -> over", ((d.h_l5pts + d.a_l5opp) / 2 + (d.a_l5pts + d.h_l5opp) / 2) - d.total_line <= -8, 1, "tres")
A("late season (gp 70+) -> over", (d.h_gp >= 70) & (d.a_gp >= 70), 1, "tres")
A("late season (gp 70+) tank game (a team under .350) -> over", (d.h_gp >= 70) & ((d.h_wpct < .35) | (d.a_wpct < .35)), 1, "tres")
A("first 5 games -> over", (d.h_gp < 5) & (d.a_gp < 5), 1, "tres")
A("first 5 games -> under", (d.h_gp < 5) & (d.a_gp < 5), -1, "tres")
A("Sunday -> under", d.dow == 6, -1, "tres")
A("home 5th+ straight home game -> over", (d.h_venue_run >= 4) & (d.h_last_home == 1), 1, "tres")
A("away 5th+ straight road game -> under", (d.a_venue_run >= 4) & (d.a_last_home == 0), -1, "tres")
res = []
for name, mask, side, col in ANG:
    m = mask.fillna(False).values.astype(bool) if hasattr(mask, "fillna") else mask
    r = ev(m, side, col); r["name"] = name; r["col"] = col; r["pass"] = passes(r); res.append(r)
res.sort(key=lambda r: -r["pct"])
print(f"\n{'angle':70s} {'n':>6s} {'%':>6s}  periods (08-13 / 14-19 / 20+)   seasons>50")
for r in res:
    per = " / ".join(f"{p[0]:.1f}({p[1]})" for p in r["per"])
    print(f"{('* ' if r['pass'] else '  ') + r['name']:70s} {r['n']:6d} {r['pct']:6.1f}  {per}   {r['s_above']}/{r['s_n']}")
print("\nPASSED (every period 52.4%+, 60+ games each):", [r["name"] for r in res if r["pass"]])
# shuffle baseline: permute outcomes within season, count passes, 20 rounds
rng = np.random.default_rng(1); passed = []
for k in range(20):
    for col in ("res", "tres"):
        d[col + "_sh"] = d.groupby("season")[col].transform(lambda s: s.sample(frac=1, random_state=int(rng.integers(1e9))).values)
    n = 0
    for name, mask, side, col in ANG:
        m = mask.fillna(False).values.astype(bool) if hasattr(mask, "fillna") else mask
        if passes(ev(m, side, col + "_sh")): n += 1
    passed.append(n)
print(f"shuffle baseline: {np.mean(passed):.1f} angles pass by luck on average (max {max(passed)}) out of {len(ANG)}")
d.to_pickle(S + "angles2_frame.pkl")
