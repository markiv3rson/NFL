#!/usr/bin/env python3
"""Automated checks for the NBA model service (run: python3 railway-model-service/tests_service.py, or npm test).
No network: small made-up leagues stand in for the real data. "Pass" means the code does what it was written to do —
the accuracy numbers for the predictions are in data/model_report.json and on the Models tab."""
import json, math, os, sys, datetime as dt
import numpy as np, pandas as pd

os.environ.setdefault("PRELOAD_ENGINE", "0")
os.environ.setdefault("REBUILD_ON_START", "0")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nba_data as nd, nba_features as nf, fair_line as fl, combo_study as cs, daily_rebuild as dr, live, scheduler, nba_injuries as ni, nba_prop_model as npm_

n = bad = 0
def ok(c, msg, v=None):
    global n, bad
    n += 1
    if not c:
        bad += 1
        print("FAIL", msg, "" if v is None else v)

# ---------- seasons / names
ok(nd.current_season("2026-10-12") == 2027 and nd.current_season("2027-04-01") == 2027 and nd.current_season("2026-06-30") == 2026, "season = year it ends")
ok(nd._norm("Los Angeles Clippers") == "LA Clippers" and nd._norm("New Orleans Hornets") == "New Orleans Pelicans" and nd._norm("Boston Celtics") == "Boston Celtics", "team names unified")
T = json.load(open(os.path.join(HERE, "data", "teams.json")))
ok(len(T) == 30 and all(k in live.TEAMS for k in T) and all(live.NAME2ABBR[v["name"]] == k for k, v in live.TEAMS.items()), "30 teams, names map both ways")

# ---------- a small league to test games(), ratings, context without any download
def fake_team_games():
    rng = np.random.default_rng(0)
    teams = ["Boston Celtics", "New York Knicks", "Miami Heat", "Chicago Bulls"]
    strength = {"Boston Celtics": 6, "New York Knicks": 2, "Miami Heat": -2, "Chicago Bulls": -6}
    rows, gid, d0 = [], 1000, dt.date(2025, 10, 22)
    for day in range(0, 160, 2):
        d = d0 + dt.timedelta(days=day)
        order = list(rng.permutation(teams))
        for h, a in ((order[0], order[1]), (order[2], order[3])):
            gid += 1
            mh = strength[h] - strength[a] + 2.5 + rng.normal(0, 10)
            tot = 220 + rng.normal(0, 12)
            ph, pa = round((tot + mh) / 2), round((tot - mh) / 2)
            for team, opp, home, pts, opp_pts in ((h, a, 1, ph, pa), (a, h, 0, pa, ph)):
                rows.append(dict(game_id=gid, season=2026, season_type=2, date=d, team=team, opp=opp, home=home, pts=pts, opp_pts=opp_pts,
                                 poss=100.0, field_goals_attempted=85, field_goals_made=40, three_point_field_goals_attempted=30,
                                 three_point_field_goals_made=11, free_throws_attempted=20, free_throws_made=15, offensive_rebounds=10,
                                 total_rebounds=44, turnovers=13, assists=24, team_abbreviation=team[:3].upper()))
    return pd.DataFrame(rows)
TG = fake_team_games()
R = fl.Ratings(TG, dt.date(2026, 3, 1), half_life=400, alpha=2)
ok(R.ok and R.predict("Boston Celtics", "Chicago Bulls")[0] > R.predict("Miami Heat", "New York Knicks")[0] > R.predict("Chicago Bulls", "Boston Celtics")[0], "ratings order the teams correctly")
ok(R.predict("Miami Heat", "Chicago Bulls")[0] > R.predict("Chicago Bulls", "Miami Heat")[0], "home edge is positive")
ok(R.predict("Boston Celtics", "Nobody FC") is None, "unknown team -> no prediction")
cut = dt.date(2026, 2, 20)
a = fl.Ratings(TG, cut, half_life=400, alpha=2); b = fl.Ratings(TG[TG.date < cut], cut, half_life=400, alpha=2)
ok(np.allclose(a.off, b.off) and np.allclose(a.hca, b.hca), "ratings on a date ignore that day and everything after")

# ---------- nd.games(): rest days, line sign, bad-line cleaning (feed the pieces in directly)
orig_tg, orig_odds = nd.team_games, nd.load_odds
nd.team_games = lambda seasons=None: TG
g0 = TG[TG.home == 1].iloc[:3]
odds = pd.DataFrame({"season": 2026, "date": [r.date for r in g0.itertuples()], "home": g0.team.values, "away": g0.opp.values,
                     "home_line": [4.5, -3.0, 6.0], "total_line": [221.5, 330.0, 219.5], "ml_home": [-180, 130, -250], "ml_away": [150, -150, 205],
                     "Points": (g0.pts + g0.opp_pts).values, "Win_Margin": [(g0.pts - g0.opp_pts).values[0], (g0.pts - g0.opp_pts).values[1], 999]})
nd.load_odds = lambda: odds
G = nd.games()
nd.team_games, nd.load_odds = orig_tg, orig_odds
ok(len(G) == len(TG) // 2, "one row per game", len(G))
r0, r1, r2 = G.iloc[0], G.iloc[1], G.iloc[2]
ok(r0.home_line == 4.5 and r0.total_line == 221.5, "good line kept")
ok(np.isnan(r1.total_line) and np.isnan(r1.home_line), "total of 330 is a typo -> the whole line is dropped")
ok(np.isnan(r2.home_line), "odds-file score that disagrees with the box score -> line dropped")
ok((G.rest_h <= 7).all() and (G.rest_h.iloc[:2] == 7).all(), "rest days capped at 7 and the first game is not a back-to-back")

# ---------- team context: no look-ahead, season reset, streaks
G2 = G.copy(); G2["margin"] = G2.margin.astype(float)
C = nf.team_context(G2)
first = C.iloc[0]
ok(first.h_gp == 0 and pd.isna(first.h_win_pct) and first.h_streak == 0, "a team's first game has no history")
ok(C.h_gp.max() > 5, "games played grows")
Gs = pd.concat([G2.iloc[:6], G2.iloc[6:12].assign(season=2027, date=lambda d: d.date + pd.Timedelta(days=300))], ignore_index=True)
Cs = nf.team_context(Gs)
ok((Cs[Cs.season == 2027].iloc[:2][["h_gp", "a_gp"]] == 0).all().all(), "new season: record and streak start over")
up = G2.iloc[:3].copy(); up.loc[up.index[2], "margin"] = np.nan
Cu, states = nf.team_context(up, return_states=True)
tm = up.iloc[2].home
ok(states[tm].gp <= 2, "an upcoming game (no result) does not change anyone's record")
# ATS to date and the 3-point attempt share vs the league (10/16): no look-ahead, only lined games count, needs 10 games for the share
ok({"h_ats_pct", "h_ats_n", "a_ats_pct", "a_ats_n", "h_r3_rel", "a_r3_rel"} <= set(C.columns), "context carries ATS to date and the 3-point share vs the league")
ok(first.h_ats_n == 0 and pd.isna(first.h_ats_pct) and pd.isna(first.h_r3_rel), "first game: no ATS history, no 3-point share")
_ats = C[C.h_ats_n > 0]; ok(len(_ats) and ((_ats.h_ats_pct >= 0) & (_ats.h_ats_pct <= 1)).all() and (C.h_ats_n <= C.h_gp).all(), "ATS share is 0-1 and counts only lined games")
_r3 = C[C.h_r3_rel.notna()]; ok((_r3.h_gp >= 10).all() and (_r3.h_r3_rel.abs() < 0.5).all(), "3-point share vs the league exists only after 10 games and is a small difference")

# ---------- patterns: the scan finds a planted pattern and the every-period rule works
rng = np.random.default_rng(3)
N = 9000
seasons = np.repeat(np.arange(2008, 2027), N // 19 + 1)[:N]
rows = pd.DataFrame({"game_id": np.arange(N), "season": seasons, "side": 1, "line": 0.0, "implied": 0.5, "win": 0.0, "over": np.nan})
rows["planted"] = rng.random(N) < 0.15
rows["other"] = rng.random(N) < 0.3
rows["decoy"] = rng.random(N) < 0.15
rows["cover"] = np.where(rows.planted, (rng.random(N) < 0.6).astype(float), (rng.random(N) < 0.5).astype(float))
rows["decoy_later"] = rows.decoy
late = rows.season >= 2020
rows.loc[rows.decoy & ~late, "cover"] = (rng.random((rows.decoy & ~late).sum()) < 0.62).astype(float)    # works early, dies later
rows.loc[rows.decoy & late, "cover"] = (rng.random((rows.decoy & late).sum()) < 0.45).astype(float)
t = cs.scan(rows[["game_id", "season", "side", "line", "implied", "win", "over", "cover", "planted", "other", "decoy"]], "cover")
good = cs.passes(t)
ok("planted" in set(good.pattern), "planted 60% pattern is found")
ok("decoy" not in set(good.pattern), "a pattern that stops working in the last period is NOT kept")
ok(all((good.r1 > 0.5238) & (good.r2 > 0.5238) & (good.r3 > 0.5238)), "every kept pattern beats break-even in all three periods")
ok(all(good[["n1", "n2", "n3"]].min(axis=1) >= cs.MIN_N), "every kept pattern has the minimum games in each period")

# ---------- the live conditions are the research's conditions
def live_row(**kw):
    base = {"game_id": -1, "season": 2027, "season_type": 2, "date": dt.date(2026, 10, 22), "home": "Toronto Raptors", "away": "LA Clippers",
            "home_line": 4.5, "total_line": 220.5, "ml_home": -160.0, "ml_away": 140.0, "margin": np.nan, "total": np.nan,
            "missing_min_h": 0.0, "missing_pts_h": 0.0, "star_out_h": 0, "missing_min_a": 40.0, "missing_pts_a": 22.0, "star_out_a": 1}
    ctx = dict(rest=1, gp=10, win_pct=0.6, last_win=1, last_margin=3.0, last_total=225.0, last_cover=1, last_over=1, streak=2, avg_margin5=4.0,
               cover5=0.6, over5=0.6, games_in_4=2)
    base.update({f"h_{k}": v for k, v in dict(ctx, rest=4).items()}); base.update({f"a_{k}": v for k, v in ctx.items()})
    base.update(kw); return pd.DataFrame([base])
lr = cs.side_rows(live_row(), live=True)
home, away = lr[lr.side == 1].iloc[0], lr[lr.side == -1].iloc[0]
ok(bool(home["rest_adv2+"]) and not bool(away["rest_adv2+"]) and bool(away["b2b"]) and bool(home["opp_b2b"]), "rest advantage / back-to-back read from the right team")
ok(bool(home["fav"]) and bool(away["dog"]), "favorite / dog point the right way")
ok(not any(("star_out" in c or "miss_pts" in c) for c in lr.columns), "no pattern condition uses who is injured (the back-test only knew who actually sat)")
gr_ = cs.game_rows(live_row(), live=True).iloc[0]
ok(bool(gr_["either_b2b"]) and not bool(gr_["both_b2b"]), "total-pattern conditions look at both teams")
ok(not any(("star_out" in c or "miss_pts" in c) for c in cs.game_rows(live_row(), live=True).columns), "no total-pattern condition uses injuries")

# ---------- live engine pieces
e = live.Engine(coefs=json.load(open(os.path.join(HERE, "data", "model_coefs.json"))), table=json.load(open(os.path.join(HERE, "data", "combo_table.json"))))
ok(live.tier(56.0) == "pick" and live.tier(55.9) == "lean" and abs(live.american(0.6) + 150) < 1e-6 and abs(live.american(0.4) - 150) < 1e-6, "tier cut-off 56% and price conversion")
e.hist_side = pd.DataFrame({"line": rng.normal(0, 6, 4000), "m": 0.0})
e.hist_side["m"] = e.hist_side.line + rng.normal(0, 12, 4000)
r_main, r_alt = e.spread_rate(4.5, 4.5)[0], e.spread_rate(4.5, 1.5)[0]
ok(0.4 < r_main < 0.6 and r_alt > r_main + 0.05, "a teased (easier) line wins more often than the main line", (r_main, r_alt))
e.hist_tot = pd.DataFrame({"line": rng.normal(220, 8, 4000), "total": 0.0}); e.hist_tot["total"] = e.hist_tot.line + rng.normal(0, 18, 4000)
ok(e.total_rate(220.5, 214.5, True)[0] > e.total_rate(220.5, 220.5, True)[0] + 0.05, "over a lower number wins more often")
hits = e._match({c: True for c in ["rest_adv2+", "opp_off_close_win"]}, "spread", None)
ok(any(h["pattern"] == "rest_adv2+ & opp_off_close_win" for h in hits) and all(h["rate"] >= 52.4 for h in hits), "pattern lookup needs ALL its conditions")
ok(e._match({"rest_adv2+": True}, "moneyline", None) == [], "no moneyline patterns exist (none beat the rate)")
e.pbox = pd.DataFrame({"game_id": [1] * 4 + [2] * 4, "season": 2026, "date": [dt.date(2026, 4, 1)] * 4 + [dt.date(2026, 4, 3)] * 4, "team": "Toronto Raptors",
                       "athlete_id": [1, 2, 3, 4] * 2, "athlete_display_name": ["Star One", "Two Guy", "Three Guy", "Four Guy"] * 2,
                       "min": [34.0, 30, 28, 20] * 2, "pts": [27.0, 15, 10, 6] * 2, "played": True, "starter": True})
nf.MIN_PLAYED = 2
e.status_w = dict(ni.DEFAULT_W)          # known weights, so the arithmetic below is exact
m = e._missing("Toronto Raptors", "2026-10-22", [{"name": "Star One", "status": "Out"}, {"name": "Four Guy", "status": "Questionable"}, {"name": "Random Person", "status": "Out"}])
ok(m["star_out"] == 1 and abs(m["missing_pts"] - (27 + 0.4 * 6)) < 1e-6 and len(m["out"]) == 2, "injury list -> missing rotation points (Out counts fully, Questionable partly, strangers ignored)", m)
m2 = e._missing("Toronto Raptors", "2026-10-22", [{"name": "Star One", "status": "Questionable"}])
ok(m2["star_out"] == 0, "a Questionable star is not counted as out")


# ---------- moneyline: the card's win chance is the MARKET's (calibrated on 22,000 games); patterns are information, never the pick
_co = json.load(open(os.path.join(HERE, "data", "model_coefs.json")))
em = live.Engine(coefs=_co, table={"table": [["moneyline", ["dog"], 58.0, 500, [55.0, 58.0, 60.0], [300, 300, 300], [50.0, 50.0, 50.0]]]})
em.honest = {"moneyline": {"win_rate": 50.1, "games": 471, "seasons": 13, "seasons_above_50": 7}, "spread": {"win_rate": 51.2, "games": 10209, "seasons": 17, "seasons_above_50": 14}}
srm = pd.DataFrame({"game_id": [-1, -1], "side": [1, -1], "dog": [False, True]})
o1 = em._ml({}, 0.50, 0.5, "AAA", "HHH", srm, {"i": 0})
ok("pick" not in o1 and o1["pattern"]["tier"] == "none" and o1["pattern"]["pct"] == 50.1 and o1["pattern"]["histRate"] == 58.0, "a moneyline pattern is shown as information: its honest rate (50.1%) is below break-even, so no pick", o1)
o2 = em._ml({}, 0.70, 0.66, "AAA", "HHH", srm, {"i": 0})
ok(o2["pick"]["team"] == "HHH" and o2["pick"]["source"] == "market win chance" and o2["pick"]["pct"] == 66.0 and o2["pick"]["modelAgrees"], "the pick's % is the market's own win chance", o2.get("pick"))
o4 = em._ml({}, 0.40, 0.60, "AAA", "HHH", srm, {"i": 0})
ok(o4["pick"]["team"] == "HHH" and o4["pick"]["pct"] == 60.0 and not o4["pick"]["modelAgrees"] and o4["side"] == "AAA", "when the model disagrees, the market's side is still the pick and the card says so")
o5 = em._ml({}, 0.66, None, "AAA", "HHH", None, {"i": 0})
ok(o5["pick"]["source"] == "model win chance" and o5["pick"]["team"] == "HHH", "no market price yet: the model's win chance is used")
o3 = em._ml({}, 0.50, 0.5, "AAA", "HHH", None, {"i": 0})
ok("pick" not in o3, "no side rows, no pattern, no market edge: no moneyline pick")
o6 = em._ml({"home_spread": -8.0}, 0.70, 0.05, "AAA", "HHH", None, {"i": 0})
ok("pick" not in o6 and "does not fit the spread" in o6.get("suspect", ""), "a moneyline that disagrees with the spread by 25+ points (bad read) gives no pick", o6)
o7 = em._ml({"home_spread": -8.0}, 0.70, 0.78, "AAA", "HHH", None, {"i": 0})
ok(o7["pick"]["pct"] == 78.0 and "suspect" not in o7, "a moneyline that fits the spread is used")
sp = em._pattern_pick("spread", {"rate": 59.1, "n": 342, "pattern": "x"})
ok(sp["tier"] == "none" and sp["pct"] == 51.2 and sp["histRate"] == 59.1 and sp["honest"]["games"] == 10209, "a spread pattern shown at 59.1% in-sample is only as good as its unseen rate (51.2%): not a pick")
em.honest["spread"]["win_rate"] = 57.0
ok(em._pattern_pick("spread", {"rate": 59.1, "n": 342})["tier"] == "pick", "a pattern whose unseen rate reaches 56% is a PICK")
ok(os.path.exists(os.path.join(HERE, "data", "honest_unseen.json")) and live.Engine(coefs=_co, table={"table": []}).honest.get("spread"), "the engine loads the shipped unseen-game rates")


# ---------- every buyable line (the NFL app's line table from NBA history): main line both teams / both sides + alternates in the team's favour
_eL = live.Engine(coefs=_co, table={"table": []})
_eL.hist_side = pd.DataFrame({"line": rng.normal(0, 6, 4000), "m": 0.0}); _eL.hist_side["m"] = _eL.hist_side.line + rng.normal(0, 12, 4000)
_eL.hist_tot = pd.DataFrame({"line": rng.normal(220, 8, 4000), "total": 0.0}); _eL.hist_tot["total"] = _eL.hist_tot.line + rng.normal(0, 18, 4000)
_L = _eL._lines({"away": "AAA", "home": "HHH", "home_spread": -3.5, "total": 220.5, "spread_prices": {"home": 0.52, "away": 0.48}, "total_prices": {"over": 0.5, "under": 0.5},
                 "alts": [{"team": "AAA", "line": 5.5, "price": 0.62}, {"team": "HHH", "line": -1.5, "price": 0.6}, {"team": "HHH", "line": -7.5, "price": 0.35}],
                 "total_alts": [{"line": 218.5, "over": 0.55, "under": 0.45}, {"line": 222.5, "over": 0.45, "under": 0.55}]})
_byL = {(x["market"], x.get("team") or x.get("side"), x["points"]): x for x in _L}
ok(("spread", "AAA", 0.0) in _byL and ("spread", "HHH", 0.0) in _byL and _byL[("spread", "AAA", 0.0)]["price"] == 0.48 and _byL[("spread", "HHH", 0.0)]["price"] == 0.52, "lines: the main line for both teams, with Polymarket's price", sorted(_byL))
ok(("spread", "AAA", 2.0) in _byL and ("spread", "HHH", 2.0) in _byL and ("spread", "HHH", -4.0) not in _byL and not any(k[0] == "spread" and k[2] < 0 for k in _byL), "lines: alternates in the team's favour only, with the points bought (HHH -7.5 is not a buy)")
ok(_byL[("spread", "AAA", 2.0)]["hist"] > _byL[("spread", "AAA", 0.0)]["hist"] + 3 and _byL[("spread", "HHH", 2.0)]["hist"] > _byL[("spread", "HHH", 0.0)]["hist"] + 3, "lines: a bought line wins more often than the main line")
ok(("total", "over", 0.0) in _byL and ("total", "under", 0.0) in _byL and _byL[("total", "over", 2.0)]["line"] == 218.5 and _byL[("total", "under", 2.0)]["line"] == 222.5 and _byL[("total", "under", 2.0)]["price"] == 0.55, "lines: Over / Under main and the alternates each side buys")


# ---------- season simulation (futures)
import season_sim as ss
ok(len(ss.TEAMS) == 30 and len(set(ss.EAST) & set(ss.WEST)) == 0 and len(ss.EAST) == 15 and len(ss.WEST) == 15, "futures: 15 East + 15 West teams")
ok(all(ss._tix(nd._norm(t["name"])) is not None for t in json.load(open(os.path.join(HERE, "data", "teams.json"))).values()), "futures: every team in teams.json is known to the simulation (names line up)")
_g = [(h, a) for h in range(30) for a in range(30) if h != a][:1230]
_r = ss.simulate(np.linspace(-5, 5, 30), _g, 2.0, 2.5, n=1500, seed=3)
ok(abs(_r["champion"].sum() - 1) < 1e-9 and abs(_r["conf_champion"].sum() - 2) < 1e-9 and abs(_r["playoffs"].sum() - 16) < 1e-9 and abs(_r["play_in"].sum() - 8) < 1e-9 and abs(_r["top6"].sum() - 12) < 1e-9 and abs(_r["seed1"].sum() - 2) < 1e-9 and abs(_r["best"].sum() - 1) < 1e-9, "futures: every simulated season has 1 champion, 2 conference champions, 16 playoff teams, 8 play-in teams, 12 top-6 teams", {k: float(_r[k].sum()) for k in ("champion", "playoffs", "play_in")})
ok(_r["champion"][29] > _r["champion"][0] and _r["playoffs"][29] > _r["playoffs"][0] and _r["wins"][:, 29].mean() > _r["wins"][:, 0].mean() + 10, "futures: a stronger team wins more, makes the playoffs more and wins the title more often")
_o = ss.simulate(np.zeros(30), _g, 0.0, 0.0, n=1500, seed=4, play_in=False)
ok(abs(_o["playoffs"].sum() - 16) < 1e-9 and _o["play_in"].sum() == 0 and abs(_o["champion"].max() - 1 / 30) < 0.03, "futures: pre-2021 rules (top 8 straight in, no play-in) and equal teams give equal title chances")
_t = ss.simulate(np.zeros(30), _g, 0.0, 0.0, n=3000, seed=5)
_cnt = np.zeros(30)
for _h, _a in _g:
    _cnt[_h] += 1; _cnt[_a] += 1
ok(abs((_t["wins"].mean(0) / _cnt).mean() - 0.5) < 0.01, "futures: equal teams with no home court win half their games")
ok(abs(ss.shock_points(math.sqrt(82 * 0.25)) ) < 1e-9 and ss.shock_points(9.8) > 3.0, "futures: season-strength shock is 0 when all the spread is luck, ~3 points at the measured 9.8 wins")
_c = ss.fit_blend(pd.DataFrame({"season": [2020] * 40 + [2021] * 40, "team": list(range(80)), "games": 82, "p82": np.tile(np.linspace(20, 62, 40), 2),
                                "prev82": np.tile(np.linspace(22, 60, 40), 2), "w82": np.tile(np.linspace(24, 58, 40), 2), "ret": np.tile(np.linspace(40, 95, 40), 2)}))
ok(set(_c) >= {"icpt", "b_ratings", "b_prev", "b_ret", "ret_mean", "resid_sd", "n"} and ss.blended_wins(41, 41, {**_c, "b_ret": 0.1, "ret_mean": 60}, 80) > ss.blended_wins(41, 41, {**_c, "b_ret": 0.1, "ret_mean": 60}, 40), "futures: the blend uses the roster term (more of last year's minutes back = more wins)")
ok(ss.blended_wins(45.0, float("nan"), _c) == ss.blended_wins(45.0, 45.0, _c), "futures: a team with no last season is treated as having matched its ratings")
_sched = pd.DataFrame({"home_display_name": ["Boston Celtics", "TBD", "New York Knicks"], "away_display_name": ["New York Knicks", "TBD", "Boston Celtics"]})
_gs = ss.games_from_schedule(_sched)
ok((ss.TIX["Boston Celtics"], ss.TIX["New York Knicks"]) in _gs and all(0 <= h < 30 and 0 <= a < 30 for h, a in _gs), "futures: schedule rows become team-index games; TBD rows are skipped")
ok(len([1 for h, a in _gs if h == ss.TIX["Boston Celtics"] or a == ss.TIX["Boston Celtics"]]) >= 40, "futures: the two unscheduled Cup games per team are filled in")
ok(abs(ss.over_prob({"ge": [1.0] * 51 + [0.4] * 33}, 50.5) - 0.4) < 1e-9 and ss.over_prob({"ge": [1.0] * 51 + [0.4] * 33}, 49.5) == 1.0, "futures: P(over a .5 line) is P(wins >= the next whole number)")
_pf = json.load(open(os.path.join(HERE, "data", "poly_futures_history.json")))["seasons"]
ok(_pf["2025"]["champion"]["teams"]["Oklahoma City Thunder"]["won"] and _pf["2026"]["champion"]["teams"]["New York Knicks"]["won"] and len(_pf["2025"]["champion"]["teams"]) == 30, "futures: Polymarket preseason prices for the two past champions are on file")
_rep = json.load(open(os.path.join(HERE, "data", "futures_report.json")))
ok(_rep["champion"]["avg_chance_given_to_real_champion_pct"] > _rep["champion"]["uniform_pct"] and _rep["playoffs"]["brier_model"] < _rep["playoffs"]["brier_everyone_same_chance"] and 40 < _rep["wins"]["coverage_50"] < 60 and 70 < _rep["wins"]["coverage_80"] < 90, "futures: the shipped backtest beats guessing and its win ranges are about as wide as they should be", _rep["wins"])
import app as _app
_app._futures_job = lambda *a, **k: None          # the endpoint may start a refresh if the file is old; not in a test
_app.TOKEN = "t"
_fc = _app.app.test_client().get("/futures", headers={"X-Model-Token": "t"})
ok(_fc.status_code == 200 and _fc.json["ok"] and len(_fc.json["teams"]) == 30 and "report" in _fc.json and all(len(t["ge"]) == 84 for t in _fc.json["teams"]), "the /futures endpoint serves the simulation with its backtest report")

# ---------- official injury report: parser, weights, features (synthetic reports in the documented layout; NOT a real PDF)
def make_pdf(lines):
    content = "BT /F1 8 Tf\n" + "".join(f"1 0 0 1 {x} {y} Tm ({t.replace('(', '[').replace(')', ']')}) Tj\n" for x, y, t in lines) + "ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(content)} >>\nstream\n{content}\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out = b"%PDF-1.4\n"; offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    x = len(out); out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offs: out += f"{o:010d} 00000 n \n".encode()
    return out + f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF".encode()
XC = {"Game Date": 30, "Game Time": 90, "Matchup": 150, "Team": 200, "Player Name": 330, "Current Status": 470, "Reason": 540}
REP = [("12/18/2023", "09:00 [ET]", "DAL@DEN", "Dallas Mavericks", "Lively II, Dereck", "Out", "Injury/Illness - Left Ankle; Sprain"),
       (None, None, None, None, "Doncic, Luka", "Questionable", "Injury/Illness - Left Knee; Soreness"),
       (None, None, None, "Denver Nuggets", "Gordon, Aaron", "Probable", "Injury/Illness - Right Heel; Strain"),
       (None, None, None, None, "Jokic, Nikola", "Available", "Injury/Illness - Illness, Non-COVID"),
       ("12/18/2023", "10:30 [ET]", "BOS@NYK", "New York Knicks", "Porter Jr., Kevin", "Out", "G League - Two-Way")]
L = [(30, 560, "Game"), (60, 560, "Date"), (90, 560, "Game"), (120, 560, "Time"), (150, 560, "Matchup"), (200, 560, "Team"), (330, 560, "Player"),
     (365, 560, "Name"), (470, 560, "Current"), (505, 560, "Status"), (540, 560, "Reason")]
y_ = 560
for r_ in REP:
    y_ -= 14
    for h_, v_ in zip(XC, r_):
        if v_: L.append((XC[h_], y_, v_))
p_ = ni.parse_pdf(make_pdf(L))
ok(p_["ok"] and p_["method"] == "position" and len(p_["rows"]) == 5, "report PDF parsed by cell position", p_["method"])
ok(p_["rows"][1]["Team"] == "Dallas Mavericks" and p_["rows"][1]["Game Date"] == "12/18/2023" and p_["rows"][3]["Team"] == "Denver Nuggets", "date / matchup / team carry down to the rows beneath")
ok(p_["rows"][3]["Reason"] == "Injury/Illness - Illness, Non-COVID" and p_["rows"][4]["Player Name"] == "Porter Jr., Kevin", "a reason with a comma stays a reason; suffix names stay whole")
tm = ni.teams_from_rows(p_["rows"])
ok(tm["DAL"][0] == {"name": "Dereck Lively II", "status": "Out", "reason": "Injury/Illness - Left Ankle; Sprain"} and [x["name"] for x in tm["DEN"]] == ["Aaron Gordon"] and tm["NYK"][0]["name"] == "Kevin Porter Jr.", "teams from rows: names flipped, Available left out", tm)
ok(ni.flip_name("Lively II, Dereck") == "Dereck Lively II" and ni.flip_name("Aaron Gordon") == "Aaron Gordon", "name flip")
tx = ni.parse_text("Game Date Game Time Matchup Team Player Name Current Status Reason 12/18/2023 09:00 (ET) DAL@DEN Dallas Mavericks Lively II, Dereck Out Injury/Illness - Left Ankle; Sprain Doncic, Luka Questionable Injury/Illness - Left Knee; Soreness Denver Nuggets Gordon, Aaron Probable Injury/Illness - Right Heel; Strain")
ok([(r["Team"], r["Player Name"], r["Current Status"]) for r in tx] == [("Dallas Mavericks", "Lively II, Dereck", "Out"), ("Dallas Mavericks", "Doncic, Luka", "Questionable"), ("Denver Nuggets", "Gordon, Aaron", "Probable")], "text fallback reads the same report", tx)
ok(ni.check_rows(p_["rows"]) and not ni.check_rows([{"Player Name": "x", "Current Status": "Hmm", "Team": "?"}] * 6) and not ni.check_rows([]), "a parse that does not look like an injury report is rejected")
junk = ni.parse_pdf(make_pdf([(30, 500, "Hello"), (30, 480, "this is not an injury report")]))
ok(not junk["ok"], "a PDF with another layout is reported as not recognised")
ok(ni._labels(dt.datetime(2026, 10, 20, 17, 30)) == ["05PM", "05_30PM"] and ni._labels(dt.datetime(2026, 10, 20, 17, 15)) == ["05_15PM"] and ni._labels(dt.datetime(2026, 10, 20, 17, 0)) == ["05_00PM"], "file-name labels: hour-only name only for the :30 report (never one published after the asked time), minutes name every 15 min")
# REAL reports saved from the NBA (public documents): the layout the parser must keep reading
for fx_name, n_rows, n_teams in (("injury_report_2025-12-01_05PM.pdf", 145, 25), ("injury_report_2026-04-12_05_30PM.pdf", 230, 30)):
    real = ni.parse_pdf(open(os.path.join(HERE, "fixtures", fx_name), "rb").read())
    ok(real["ok"] and real["method"] == "position" and len(real["rows"]) == n_rows and len({r["Team"] for r in real["rows"]}) == n_teams, f"real NBA report {fx_name[14:-4]} parsed", (real["method"], len(real["rows"])))
    ok(all(r["Team"] in ni.NAME2ABBR and r["Current Status"] in ni.STATUSES and "," in r["Player Name"] and r["Reason"] and r["Matchup"] and r["Game Date"] for r in real["rows"]), "every real row has team, status, 'Last, First' name, reason, matchup, date")
real = ni.parse_pdf(open(os.path.join(HERE, "fixtures", "injury_report_2025-12-01_05PM.pdf"), "rb").read())["rows"]
byname = {r["Player Name"]: r for r in real}
ok(byname["Young, Trae"]["Reason"] == "Injury/Illness - Right Knee; MCL Sprain" and byname["Young, Trae"]["Current Status"] == "Out", "a reason that wraps above AND below its row goes to the right player (Trae Young)")
ok(byname["Duren, Jalen"]["Reason"] == "Injury/Illness - Left Lower Leg; Contusion" and byname["Duren, Jalen"]["Team"] == "Detroit Pistons" and byname["Duren, Jalen"]["Matchup"] == "ATL@DET", "wrapped reason, team and matchup carried down (Jalen Duren)")
ok(byname["Allen, Jarrett"]["Reason"] == "Injury/Illness - Right 3rd Finger; Strain" and byname["Allen, Jarrett"]["Team"] == "Cleveland Cavaliers" and byname["Smith, Tolu"]["Reason"] == "G League - Two-Way", "a reason above the first row of the next game is not stolen by the row before it")
ok(ni.flip_name("Moore Jr., Wendell") == "Wendell Moore Jr." and byname["Moore Jr., Wendell"]["Current Status"] == "Out", "suffix names (Moore Jr.)")
tms = ni.teams_from_rows(real)
ok(any(x["name"] == "Trae Young" and x["status"] == "Out" for x in tms["ATL"]) and all(x["status"] != "Available" for t_ in tms.values() for x in t_), "teams from a real report: names flipped, Available left out")

# weights: Out always sits, Questionable half the time, unlisted rarely
pb = []
rng2 = np.random.default_rng(1)
days = [dt.date(2026, 1, 1) + dt.timedelta(days=i * 2) for i in range(60)]
for gi, d in enumerate(days):
    for pid, nm, mpg in ((1, "Star One", 34), (2, "Two Guy", 28), (3, "Three Guy", 24), (4, "Four Guy", 20), (5, "Five Guy", 18), (6, "Six Guy", 16)):
        pb.append(dict(game_id=1000 + gi, season=2026, date=d, team="Toronto Raptors", athlete_id=pid, athlete_display_name=nm, min=float(mpg), pts=10.0, played=True, starter=pid < 6))
PB = pd.DataFrame(pb); rep_hist = {}
sat_log = {"Out": [0, 0], "Questionable": [0, 0]}
for gi, d in enumerate(days):
    if gi < 8: continue
    st = "Out" if gi % 2 == 0 else "Questionable"
    who = 1 + (gi % 6)
    sits = True if st == "Out" else (gi % 4 == 1)
    PB.loc[(PB.game_id == 1000 + gi) & (PB.athlete_id == who), "played"] = not sits
    sat_log[st][0] += int(sits); sat_log[st][1] += 1
    nm = PB[PB.athlete_id == who].athlete_display_name.iloc[0]
    last, first = nm.split(" ")[1], nm.split(" ")[0]
    rep_hist[str(d)] = {"asOf": "x", "rows": [{"Team": "Toronto Raptors", "Player Name": f"{last}, {first}", "Current Status": st}]}
nf.MIN_PLAYED = 3
fw = ni.fit_weights(rep_hist, PB, min_n=10)
ok(abs(fw["weights"]["out"] - 1.0) < 0.05 and 0.3 < fw["weights"]["questionable"] < 0.7 and fw["dates"] == len(rep_hist), "weights are fit from how often listed players really sat", fw["weights"])
ok(ni.fit_weights(rep_hist, PB, min_n=10_000)["weights"] == {}, "a weight is only fitted when there are enough cases")
rf = nf.report_features(rep_hist, PB, {"out": 1.0, "questionable": 0.4})
r0 = rf[(rf.game_id == 1000 + 8)].iloc[0]
ok(abs(r0.missing_pts_r - 10.0) < 1e-6 and r0.missing_min_r > 0, "report-based missing points: an Out rotation player counts fully", r0.to_dict())
r1 = rf[(rf.game_id == 1000 + 9)].iloc[0]
ok(abs(r1.missing_pts_r - 4.0) < 1e-6, "report-based missing points: Questionable counts 0.4", r1.to_dict())
ok(dr.weight_checks({"weights": {"out": 0.99, "questionable": 0.4, "probable": 0.1}}) == [] and dr.weight_checks({"weights": {"out": 0.3}}) and dr.weight_checks({"weights": {"out": 0.9, "probable": 0.95}}), "weight sanity checks")
shipped_w = json.load(open(os.path.join(HERE, "data", "injury_weights.json")))
sw = shipped_w["weights"]
ok(sw["out"] > 0.95 and 0.2 < sw["questionable"] < 0.7 and sw["probable"] < 0.25 and sw["doubtful"] > sw["questionable"] and shipped_w["counts"]["Out"] > 5000 and shipped_w["dates"] > 500, "the shipped status weights are measured from real reports and make sense", sw)
ok(live.Engine(coefs=json.load(open(os.path.join(HERE, "data", "model_coefs.json"))), table={"table": []}).status_w["out"] == sw["out"], "the engine starts with the shipped weights")
# the engine uses fitted weights when a file is published
import tempfile
td_ = tempfile.mkdtemp(); json.dump({"weights": {"questionable": 0.25}}, open(os.path.join(td_, "injury_weights.json"), "w"))
old_dir = live.MODEL_DIR; live.MODEL_DIR = td_
ok(live.Engine(coefs=coefs0 if "coefs0" in globals() else json.load(open(os.path.join(HERE, "data", "model_coefs.json"))), table={"table": []}).status_w["questionable"] == 0.25, "the engine uses the fitted weights")
live.MODEL_DIR = old_dir
# the site's own closing lines fill the gap in the public line file
gx = pd.DataFrame({"date": [dt.date(2026, 10, 21), dt.date(2026, 10, 21), dt.date(2026, 10, 22)], "home": ["Toronto Raptors", "Boston Celtics", "Toronto Raptors"],
                   "away": ["LA Clippers", "New York Knicks", "Miami Heat"], "home_line": [np.nan, 3.0, np.nan], "total_line": [np.nan, 220.5, np.nan],
                   "ml_home": [np.nan] * 3, "ml_away": [np.nan] * 3})
fx = nd.fill_from_site_closes(gx, [{"date": "2026-10-21", "game": "LAC @ TOR", "away": "LAC", "home": "TOR", "hs": -4.5, "tl": 221.5, "mlHome": 0.62}])
ok(fx.home_line[0] == 4.5 and fx.total_line[0] == 221.5 and fx.line_src[0] == "polymarket" and fx.ml_home[0] < -150, "site closing line fills a game the public file lacks (spread sign flipped to the home line)")
ok(fx.home_line[1] == 3.0 and fx.line_src[1] == "sbr" and np.isnan(fx.home_line[2]), "a line from the public file is never overwritten; unknown games stay empty")

# ---------- rebuild checks
coefs = json.load(open(os.path.join(HERE, "data", "model_coefs.json"))); report = json.load(open(os.path.join(HERE, "data", "model_report.json")))
table = json.load(open(os.path.join(HERE, "data", "combo_table.json")))
ok(dr.checks(coefs, report, table, {}) == [], "the shipped files pass the publish checks", dr.checks(coefs, report, table, {}))
worse = json.loads(json.dumps(report)); worse["rows"][0]["ours_same_games"] = report["rows"][0]["market"] + 1.5
ok(any("worse than the market" in x for x in dr.checks(coefs, worse, table, {})), "a model far worse than the market is not published")
prev = json.loads(json.dumps(report)); prev["rows"][0]["ours"] = report["rows"][0]["ours"] - 0.5
ok(any("got worse" in x for x in dr.checks(coefs, report, table, {}, prev)), "accuracy getting worse than last build is not published")
prev2 = json.loads(json.dumps(prev)); prev2["injury_basis"] = "something else"
ok(not any("got worse" in x for x in dr.checks(coefs, report, table, {}, prev2)), "accuracy is only compared with a build that measured injuries the same way")
c_small = dict(coefs, games=6153, injury_basis="the official injury report before tip-off (2022-2026, 819 game days)")
ok(not any("games in the fit" in x for x in dr.checks(c_small, report, table, {})), "6,000 games is enough for a fit on the official injury reports")
ok(any("games in the fit" in x for x in dr.checks(dict(c_small, injury_basis="who actually sat (no injury-report history loaded yet: optimistic)"), report, table, {})), "but not for a fit on the long history")
few = {"table": table["table"][:2]}
ok(any("patterns kept" in x for x in dr.checks(coefs, report, few, {})), "too few patterns is not published")
below = {"table": [[*table["table"][0][:2], 51.0, *table["table"][0][3:]]] + table["table"][1:]}
ok(any("below break-even" in x for x in dr.checks(coefs, report, below, {})), "a pattern below break-even is not published")
ok(all(r[2] >= 52.4 and min(r[5]) >= 60 and (r[0] == "moneyline" or all(x > 52.0 for x in r[4])) for r in table["table"]), "shipped table: every pattern beats break-even (moneyline: the market's own chance) in every period with 60+ games")
ok(all(r[0] in ("spread", "total", "moneyline") for r in table["table"]) and all(min(r[4][i] - r[6][i] for i in range(3)) > 3.0 and r[2] >= 56.0 for r in table["table"] if r[0] == "moneyline"), "shipped table: any moneyline pattern beats the market's own win chance by 3+ points in every period and wins 56%+")

# ---------- scheduler slots
from zoneinfo import ZoneInfo
PT = ZoneInfo("America/Los_Angeles"); last = {}
at = lambda s: [x for x, _ in scheduler.due(dt.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=PT), last)]
ok(at("2026-10-22 05:15") == ["rebuild"] and at("2026-10-22 05:15") == [] and at("2026-10-22 04:00") == [], "rebuild at 5:15 AM PT (after ESPN's 4:30 AM files), once")
ok(at("2026-10-22 05:35") == ["props"] and at("2026-10-22 05:55") == ["futures"] and at("2026-10-22 08:15") == ["catchup"], "prop refit 5:35, futures 5:55, catch-up reload 8:15 AM PT")
ok(at("2026-10-22 07:00") == ["snapshot"] and at("2026-10-22 10:30") == ["snapshot"] and at("2026-10-22 21:30") == ["snapshot"] and at("2026-10-22 22:00") == [] and at("2026-10-22 06:30") == [], "snapshots (closing lines) every 30 min, 7 AM - 9:30 PM")
ok(at("2026-10-22 08:20") == ["sync"] and at("2026-10-22 23:45") == ["grade"], "bet sync hourly at :20, grading nightly")

# closing-line snapshot 3 minutes before each tip-off (two games at the same tip = one snapshot; none outside tonight)
PTz = lambda s: dt.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=PT)
tips = [PTz("2026-10-22 16:30"), PTz("2026-10-22 16:30"), PTz("2026-10-22 19:00")]
lastc = {}
atc = lambda s: [x for x, _ in scheduler.due(PTz(s), lastc, tips)]
ok(atc("2026-10-22 16:26") == [] and atc("2026-10-22 16:27") == ["close:2026-10-22 16:30"] and atc("2026-10-22 16:27") == [], "a closing snapshot 3 minutes before a tip-off, once even with two games at the same tip", atc("2026-10-22 16:28"))
ok(atc("2026-10-22 18:57") == ["close:2026-10-22 19:00"] and atc("2026-10-22 18:58") == [] and atc("2026-10-22 20:10") == [], "each distinct tip-off gets its own closing snapshot")
ok(scheduler.due(PTz("2026-10-23 12:15"), {}, tips) == [], "no tip-offs tonight -> nothing extra")

# reading tonight's tip-off times from the site's slate (a game already under way is skipped; a bad reply changes nothing)
import json as _json
_orig_call = scheduler._call
scheduler._call = lambda *a, **k: _json.dumps({"games": [{"start": "2026-10-22T23:30:00Z"}, {"start": "2026-10-23T02:00:00Z"}, {"start": "2026-10-22T21:00:00Z", "inProgress": True}]}).encode()
scheduler.refresh_tips()
ok([t.strftime("%m-%d %H:%M") for t in scheduler.TIPS] == ["10-22 16:30", "10-22 19:00"], "tip-off times are read from the slate in Pacific time, live games left out", scheduler.TIPS)
scheduler._call = lambda *a, **k: b"not json"
scheduler.refresh_tips()
ok(len(scheduler.TIPS) == 2, "an unreadable slate reply keeps the last tip-off times")
scheduler._call = lambda *a, **k: None
scheduler.refresh_tips()
ok(len(scheduler.TIPS) == 2, "no reply keeps the last tip-off times")
scheduler._call = _orig_call; scheduler.TIPS = []

# ---------- production start-up: nothing may start a thread at import (gunicorn --preload forks AFTER import and threads die in the fork)
import subprocess
out = subprocess.run([sys.executable, "-c", "import app; print(app._engine['loading'], app._engine['e'] is None)"], cwd=HERE, capture_output=True, text=True,
                     env={**os.environ, "PRELOAD_ENGINE": "1", "REBUILD_ON_START": "1"}).stdout.strip().splitlines()[-1:]
ok(out == ["False True"], "importing the service starts no background work (it starts inside the worker)", out)
ok("start_background" in open(os.path.join(HERE, "gunicorn.conf.py")).read() and hasattr(__import__("app"), "start_background"), "the gunicorn worker starts the model loading itself")

# ---------- the service
import app as service
c0 = service.app.test_client()
service.TOKEN = ""
ok(c0.get("/health").json["ok"] and c0.post("/slate", json={"games": []}).status_code == 503 and c0.get("/models").status_code == 503, "no token on the server: health answers, everything else is refused (never open)")
service.TOKEN = "secret"
c = service.app.test_client(); c.environ_base["HTTP_X_MODEL_TOKEN"] = "secret"   # every later call carries the token
ok(c.post("/slate", json={"games": [{"away": "XXX", "home": "TOR"}]}).status_code == 400, "unknown team is refused")
ok(c0.post("/slate", json={"games": []}).status_code == 401 and c0.get("/health").status_code == 200 and c.get("/models").status_code == 200, "token required except /health")
ni_latest = ni.latest
ni.latest = lambda *a, **k: {"asOf": "2026-10-20T17:30:00", "url": "u", "method": "position", "rows": p_["rows"]}
service._inj["v"] = None
j = c.get("/injuries").json
ok(j["ok"] and j["source"] == "nba-official" and j["dates"]["2023-12-18"]["DAL"][0]["name"] == "Dereck Lively II", "/injuries serves the official report by game day", j)
ni.latest = lambda *a, **k: {"error": "no report found"}
service._inj["v"] = None
ok(c.get("/injuries").status_code == 502, "/injuries says 502 when the report can't be read (the site then uses ESPN)")
ni.latest = ni_latest; service._inj["v"] = None
ok(set(c.get("/models").json["report"].keys()) >= {"rows", "spread_side", "total_side", "win_calibration"}, "models endpoint carries the accuracy report")

# ---------- 10/16 gap fixes: rest / travel from the schedule; lined games this season
_sch = pd.DataFrame({"game_date": [pd.Timestamp("2026-11-01").date(), pd.Timestamp("2026-11-02").date(), pd.Timestamp("2026-11-02").date(), pd.Timestamp("2026-11-05").date()],
                     "home_display_name": ["Denver Nuggets", "Utah Jazz", "Boston Celtics", "Denver Nuggets"],
                     "away_display_name": ["Los Angeles Lakers", "Denver Nuggets", "New York Knicks", "Miami Heat"],
                     "season_type": [2, 2, 2, 2], "status_type_name": ["STATUS_FINAL", "STATUS_SCHEDULED", "STATUS_POSTPONED", "STATUS_SCHEDULED"]})
_ix = nf.schedule_index(_sch)
_du = nf.travel_km("Denver Nuggets", "Utah Jazz")
ok(nf.schedule_rest(_ix, "Denver Nuggets", "2026-11-02", "Utah Jazz")[:2] == (1, _du) and _du > 500 and nf.schedule_rest(_ix, "Denver Nuggets", "2026-11-02", "Utah Jazz")[2] == pd.Timestamp("2026-11-01").date(), "a back-to-back read from the schedule, with the flight from last night's arena and the date of that game")
ok(nf.schedule_rest(_ix, "Denver Nuggets", "2026-11-05", "Denver Nuggets")[:2] == (3, nf.travel_km("Utah Jazz", "Denver Nuggets")), "three days later: rest 3, travel home from the last arena")
_sn = _sch.copy(); _sn["neutral_site"] = [False, True, False, False]
ok(nf.schedule_rest(nf.schedule_index(_sn), "Denver Nuggets", "2026-11-05", "Denver Nuggets")[1] == 0.0, "a neutral-site game (the Cup final) measures no travel")
_st = nf.TeamState(); _st.last_date = pd.Timestamp("2026-11-04").date(); _st.last_venue = "Denver Nuggets"; _st.season = 2027
_e3 = live.Engine(coefs=_co, table={"table": []}); _e3.sched = _ix; _e3.states = {"Denver Nuggets": _st}; _e3.season = 2027
ok(_e3._ctx("Denver Nuggets", "2026-11-05", "Denver Nuggets")["rest"] == 1, "a box score newer than the schedule's last listed game (a Cup game listed as TBD) wins")
_e3.season_start = None
ok(_e3.is_preseason("2026-10-10") and not _e3.is_preseason("2026-10-21"), "no schedule file: before Oct 15 counts as preseason, never real picks")
ok(nf.schedule_rest(_ix, "Los Angeles Lakers", "2026-11-01", "Denver Nuggets") is None and nf.schedule_rest(_ix, "Boston Celtics", "2026-11-03", "Boston Celtics") is None and nf.schedule_rest(_ix, "Miami Heat", "2026-11-05", "Denver Nuggets") is None, "first game of the season, or only a postponed game before -> nothing from the schedule")
_e2 = live.Engine(coefs=_co, table={"table": []}); _e2.sched = _ix; _e2.states = {}; _e2.season = 2027
_c2 = _e2._ctx("Denver Nuggets", "2026-11-02", "Utah Jazz")
ok(_c2["rest"] == 1 and _c2["trav_km"] == _du and _e2._ctx("Miami Heat", "2026-11-05", "Denver Nuggets")["rest"] == 7, "engine context: rest and travel from the schedule; a first game keeps rest 7")
ok(live.season_lines(pd.DataFrame({"season": [2027, 2027, 2027, 2026], "season_type": [2, 2, 2, 2], "home_line": [3.0, np.nan, -2.0, 1.0], "line_src": ["polymarket", "", "sbr", "sbr"]}), 2027) == {"season": 2027, "games": 3, "lined": 2, "polymarket": 1, "last": None}, "lined games this season, and how many came from the site's Polymarket closes")
ok(live.season_lines(pd.DataFrame({"season": [2027, 2027, 2026], "season_type": [2, 2, 2], "home_line": [3.0, 1.0, 1.0], "date": [dt.date(2026, 10, 20), dt.date(2026, 10, 21), dt.date(2026, 4, 12)]}), 2027)["last"] == "2026-10-21", "health names the newest box score of this season (10/21: the 4 AM build ran before ESPN's files)")
ok("lines" in c.get("/health").json and "stale" in c.get("/health").json, "health carries the lined-games count and the stale-file list")
# ---------- audit fixes 10/16
ok(cs.PERIODS[-1][1] == nd.current_season() and 2027 in range(2010, nd.current_season() + 1), "the pattern scan's last period and the honest test reach the running season")
_dl = nd._download; nd._download = lambda url, path: (_ for _ in ()).throw(RuntimeError("github down"))
_t26 = nd._file("espn_nba_team_boxscores", "team_box", 2026, fresh=True)
ok(_t26 is not None and len(_t26) > 1000 and "github down" in nd.STALE.get("team_box_2026", ""), "a failed download falls back to the last copy and is recorded as stale", nd.STALE)
ok(nd.odds_file(fresh=True).endswith("OddsData.sqlite") and "OddsData.sqlite" in nd.STALE, "the odds file: a failed download keeps the cached copy instead of crashing the rebuild")
nd._download = _dl; nd.STALE.clear()
_gg = G.iloc[[0]].copy(); _gg["home_line"] = np.nan; _gg["total_line"] = np.nan; _gg["line_src"] = ""
_ab = {v: k for k, v in nd._abbr_to_name().items()}; _r0 = _gg.iloc[0]
_bad = [{"date": str(_r0.date), "game": "x", "away": _ab[_r0.away], "home": _ab[_r0.home], "hs": 48.0, "tl": 1955.0, "mlHome": 0.995}]
_fb = nd.fill_from_site_closes(_gg, _bad)
ok(np.isnan(_fb.home_line.iloc[0]) and np.isnan(_fb.total_line.iloc[0]) and _fb.line_src.iloc[0] == "", "a corrupt Polymarket close (spread 48, total 1955, 99.5% moneyline) is not let into the line history")
_fc = dr.freshness_checks({"fit_through": "2026-11-01"}, pd.DataFrame({"season_type": [2, 2], "status_type_name": ["STATUS_FINAL", "STATUS_SCHEDULED"], "game_date": [pd.Timestamp("2026-11-10").date(), pd.Timestamp("2026-11-20").date()]}))
ok(len(_fc) == 1 and "finals through 2026-11-10" in _fc[0] and dr.freshness_checks({"fit_through": "2026-11-09"}, pd.DataFrame({"season_type": [2], "status_type_name": ["STATUS_FINAL"], "game_date": [pd.Timestamp("2026-11-10").date()]})) == [], "the rebuild is held when the schedule has finals the box scores never reached")
_rows = []
for gid in range(1, 26):                      # 2025-26: the star plays games 1-7 and sits out the last 18 (hurt in February), the sub plays all
    d = pd.Timestamp("2026-01-01").date() + dt.timedelta(days=3 * gid)
    _rows.append((gid, 2026, d, 1, "Star", 36 if gid <= 7 else 0, 30 if gid <= 7 else 0, gid <= 7)); _rows.append((gid, 2026, d, 2, "Sub", 24, 10, True))
_rows.append((99, 2027, pd.Timestamp("2026-10-21").date(), 1, "Star", 35, 28, True)); _rows.append((99, 2027, pd.Timestamp("2026-10-21").date(), 2, "Sub", 20, 8, True))
_tp = pd.DataFrame(_rows, columns=["game_id", "season", "date", "athlete_id", "athlete_display_name", "min", "pts", "played"]); _tp["team"] = "T"; _tp["starter"] = False
_rot = nf.rotation_from(_tp, pd.Timestamp("2026-10-22").date(), window=20)
ok(set(_rot.name) == {"Star", "Sub"} and abs(float(_rot[_rot.name == "Star"].ppg.iloc[0]) - (7 * 30 + 28) / 8) < 1e-6, "early in a season the rotation blends the whole previous season with this season's games (a star who sat out the spring is still in it)", _rot.to_dict("records"))
_old = _tp[_tp.game_id >= 6]                  # the plain 20-game window would have dropped him (2 games played of the last 20)
_o = nf.rotation_from(_old.assign(season=2027), pd.Timestamp("2026-10-22").date(), window=20)
ok("Star" not in set(_o["name"]), "the plain 20-game window alone loses him", _o.to_dict("records"))

ok(live._alt_ok({"team": "NYK", "line": -1.5, "price": 0.5}, need_team=True) and not live._alt_ok({"team": "NYK", "line": None}, need_team=True) and not live._alt_ok({"line": 220.5, "team": None}, need_team=True) and live._alt_ok({"line": 220.5}) and not live._alt_ok({"line": "x"}), "a half-posted alternate line is skipped instead of failing the game")
ok(live._failed_game({"away": "BOS", "home": "NYK", "date": "2026-10-21"}, ValueError("bad"))["model"] is None and live._failed_game({"away": "BOS", "home": "NYK"}, ValueError("bad"))["key"] == "BOS @ NYK", "a game the engine cannot price answers with no model numbers and the reason, the others still come through")

ok(dr.needs_rebuild(None) and dr.needs_rebuild({"at": "x", "published": True}) and dr.needs_rebuild({"tag": "older code"}) and not dr.needs_rebuild({"tag": dr.BUILD_TAG, "published": False}), "rebuild on deploy: a missing or older-code build triggers a rebuild at start, the current build does not")

# ---------- SHOT QUALITY (shot_quality.py): shots from ESPN play-by-play, per-team numbers before tonight, the season references
import shot_quality as sqm
_rates = sqm.load_rates()
ok(_rates and len(_rates["cell"]) > 50 and 0.9 < _rates["cell"]["0|0|dunk"] <= 1 and 0.3 < _rates["type"]["1"] < 0.4, "the shipped make-rate table (data/shot_rates.json): dunks ~92%, threes ~35%", _rates and _rates.get("type"))
_pb = pd.DataFrame([
    {"game_id": 1, "season": 2027, "season_type": 2, "team_id": 7.0, "home_team_id": 7, "away_team_id": 9, "type_text": "Jump Shot", "text": "A makes 25-foot three point jumper", "shooting_play": True, "points_attempted": 3, "scoring_play": True, "coordinate_x": -17.0, "coordinate_y": 0.0},
    {"game_id": 1, "season": 2027, "season_type": 2, "team_id": 9.0, "home_team_id": 7, "away_team_id": 9, "type_text": "Cutting Dunk Shot", "text": "B makes 1-foot dunk", "shooting_play": True, "points_attempted": 2, "scoring_play": True, "coordinate_x": 41.0, "coordinate_y": 0.5},
    {"game_id": 1, "season": 2027, "season_type": 2, "team_id": 9.0, "home_team_id": 7, "away_team_id": 9, "type_text": "Free Throw - 1 of 2", "text": "B makes free throw 1 of 2", "shooting_play": True, "points_attempted": 1, "scoring_play": True, "coordinate_x": None, "coordinate_y": None},
    {"game_id": 1, "season": 2027, "season_type": 2, "team_id": 7.0, "home_team_id": 7, "away_team_id": 9, "type_text": "Driving Layup Shot", "text": "A misses driving layup", "shooting_play": True, "points_attempted": None, "scoring_play": False, "coordinate_x": None, "coordinate_y": None},
    {"game_id": 1, "season": 2027, "season_type": 3, "team_id": 7.0, "home_team_id": 7, "away_team_id": 9, "type_text": "Jump Shot", "text": "playoff shot", "shooting_play": True, "points_attempted": 2, "scoring_play": True, "coordinate_x": 30.0, "coordinate_y": 0.0}])
_sh = sqm.shots(_pb)
ok(len(_sh) == 3 and list(_sh.side) == ["h", "a", "h"] and list(_sh.three) == [1, 0, 0] and list(_sh.kind) == ["jump", "dunk", "layup"] and _sh.db.iloc[0] == 10 and _sh.db.iloc[2] == -1,
   "shots: free throws and playoff shots left out, the float team id matched to home / away, 3 from points_attempted (or the text), distance from the coordinates (24.75 ft -> band 10), unknown distance -> -1", _sh.to_dict("records"))
# a season of 14 games between two teams: each game the home side shoots 40 mid-range twos and the away side 40 threes, makes vary by game
_rows, _gm = [], []
for i in range(14):
    d = pd.Timestamp("2026-10-21") + pd.Timedelta(days=2 * i); h, a = ("X Team", "Y Team") if i % 2 == 0 else ("Y Team", "X Team"); hid, aid = (7, 9) if i % 2 == 0 else (9, 7)
    for k in range(40):
        _rows.append({"game_id": 100 + i, "season": 2027, "season_type": 2, "team_id": float(hid), "home_team_id": hid, "away_team_id": aid, "type_text": "Jump Shot", "text": "15-foot jumper",
                      "shooting_play": True, "points_attempted": 2, "scoring_play": k < 14 + i % 5, "coordinate_x": 26.75, "coordinate_y": 0.0})
        _rows.append({"game_id": 100 + i, "season": 2027, "season_type": 2, "team_id": float(aid), "home_team_id": hid, "away_team_id": aid, "type_text": "Jump Shot", "text": "25-foot three point jumper",
                      "shooting_play": True, "points_attempted": 3, "scoring_play": k < 12 + i % 3, "coordinate_x": -16.75, "coordinate_y": 0.0})
    _gm.append({"game_id": 100 + i, "season": 2027, "season_type": 2, "date": d, "home": h, "away": a, "margin": 1, "total_line": 220.0 + i})
_G2 = pd.DataFrame(_gm); _st2 = sqm.state(pd.DataFrame(_rows), _G2, 2027, rates=_rates)
_gt = sqm.game_table(sqm.shots(pd.DataFrame(_rows)), _rates).set_index("game_id")
_luck = [(_gt.loc[str(100 + i), "fg_h"] - _gt.loc[str(100 + i), "xfg_h"]) + (_gt.loc[str(100 + i), "fg_a"] - _gt.loc[str(100 + i), "xfg_a"]) for i in range(14)]
_xt = [_gt.loc[str(100 + i), "xfg_h"] + _gt.loc[str(100 + i), "xfg_a"] for i in range(14)]
_pre_l = [np.mean(_luck[max(0, j - 20):j]) if j >= 10 else None for j in range(14)]            # both teams play every game: their pre-game numbers are equal
_pre_x = [np.mean(_xt[max(0, j - 10):j]) if j >= 5 else None for j in range(14)]
_cold_mu = np.mean([2 * v for v in _pre_l if v is not None]); _sq_mu = np.mean([v - (220.0 + j) for j, v in enumerate(_pre_x) if v is not None])
ok(_st2["games"] == 14 and _st2["teams"]["X Team"]["gp"] == 14 and abs(_st2["teams"]["X Team"]["luck20"] - np.mean(_luck)) < 1e-9 and abs(_st2["teams"]["Y Team"]["xtot10"] - np.mean(_xt[-10:])) < 1e-9,
   "per team before tonight: luck of its last 20 games (all 14 here), expected shot points of its last 10, games played", _st2["teams"])
ok(abs(_st2["cold_mu"] - _cold_mu) < 1e-9 and abs(_st2["sq_mu"] - _sq_mu) < 1e-9, "the season references come from each earlier game's PRE-game numbers (10+ games for the luck, 5+ for expected points)", (_st2["cold_mu"], _cold_mu, _st2["sq_mu"], _sq_mu))
_c = sqm.ctx(_st2, "X Team"); _c0 = sqm.ctx({}, "X Team")
ok(set(_c) == {"sq_x10", "sq_l20", "sq_gp", "sq_cold_mu", "sq_mu"} and _c["sq_gp"] == 14 and _c0["sq_gp"] == 0 and _c0["sq_l20"] is None and sqm.state(None, _G2, 2027) == {},
   "the card's keys for a team; no play-by-play yet (preseason) -> no numbers, the rule cannot fire", (_c, _c0))
_e3.shotq = _st2; _cx = _e3._ctx("Denver Nuggets", "2026-11-05", "Denver Nuggets"); _e3.shotq = {}
ok("sq_l20" in _cx and _cx["sq_gp"] == 0 and live._pub({**_cx, "sq_x10": float("nan")})["sq_x10"] is None, "every team context carries the shot keys (a team without shot data: gp 0, nothing else)", _cx)
_late = pd.concat([_G2, pd.DataFrame([{"game_id": 999, "season": 2027, "season_type": 2, "date": pd.Timestamp("2026-11-30"), "home": "X Team", "away": "Y Team", "margin": 3, "total_line": 221.0}])])
_stl = sqm.state(pd.DataFrame(_rows), _late, 2027, rates=_rates)
ok(_stl.get("stale") and _stl["teams"] == {} and "2026-11-30" in _stl["stale"], "play-by-play more than 2 days behind the box scores: no shot numbers (the rule is off) and the reason", _stl)
_tmp = tempfile.mkdtemp(); _old = nd.CACHE; nd.CACHE = _tmp
pd.DataFrame({"a": [1], "b": [2]}).to_parquet(os.path.join(_tmp, "play_by_play_2019.parquet"))
_rd = nd._file("espn_nba_pbp", "play_by_play", 2019, fresh=False, columns=["a", "zz"]); nd.CACHE = _old
ok(list(_rd.columns) == ["a"], "a big file is read with only the columns asked for (missing ones skipped)", list(_rd.columns))

# ---------- 10/20: the player-prop model (no downloads: a made-up box score table)
ok(npm_.norm_name("Jaylen Brown Jr.") == "jaylen brown" and npm_.norm_name("De'Aaron Fox") == "deaaron fox" and npm_.fix_abbr("GS") == "GSW" and npm_.fix_abbr("utah") == "UTA" and npm_.fix_abbr("BOS") == "BOS", "prop model: names normalized, ESPN team codes mapped")
sp = npm_.Spread(np.array([10.0, 20.0, 30.0]), np.array([8.0, 22.0, 33.0]))
ok(0 <= sp.over([20.0], [21.5])[0] <= 1 and sp.over([20.0], [5.5])[0] == 1.0 and sp.over([20.0], [40.5])[0] == 0.0, "prop model: the chance of a line comes from the scaled neighbours")
rng = np.random.default_rng(1); rows = []
for season in (2025, 2026):
    for gi in range(40):
        for team, opp, ha in (("BOS", "DET", "home"), ("DET", "BOS", "away")):
            for pid in range(6):
                aid = f"{team}{pid}"; mins = 30 - pid * 3
                pts = max(0, rng.normal(20 - pid * 3, 5)); reb = max(0, rng.normal(6, 2)); ast = max(0, rng.normal(4, 2))
                rows.append({"game_id": season * 1000 + gi, "season": season, "season_type": 2, "game_date": f"{season - 1}-11-{1 + gi % 28:02d}", "athlete_id": aid, "athlete_display_name": f"Player {aid}",
                    "athlete_position_abbreviation": "G" if pid % 2 else "F", "minutes": mins, "points": pts, "rebounds": reb, "assists": ast, "three_point_field_goals_made": 1, "steals": 1, "blocks": 0,
                    "starter": pid < 5, "did_not_play": False, "team_abbreviation": team, "opponent_team_abbreviation": opp, "home_away": ha, "team_score": 110, "opponent_team_score": 105})
fake = pd.DataFrame(rows)
_pb = nd.player_box
nd.player_box = lambda s: fake[fake.season == s] if s in (2025, 2026) else None
try:
    B = npm_.load_box([2025, 2026]); T = npm_.table(B); E = npm_.eligible(T)
    ok(len(B) == len(fake) and "pra" in B and set(B.team.unique()) == {"BOS", "DET"}, "prop model: the box table loads, PRA added, codes fixed")
    first = T[(T.athlete_id == "BOS0") & (T.season == 2026)].sort_values("date").iloc[0]
    ok(first.gp == 0 and abs(first.b_pts - fake[(fake.athlete_id == "BOS0") & (fake.season == 2025)].points.mean()) < 1e-9 and np.isnan(first.l5_pts) and np.isnan(first.t_for), "prop model: a season opener row = last season's average, no games yet, no team numbers yet (what the live state mimics)")
    S, teams, opp_pos = npm_._state(B, 2027)
    ok(len(S) == 12 and (S.gp == 0).all() and not teams and abs(float(S[S.athlete_id == "BOS0"].b_pts.iloc[0]) - fake[(fake.athlete_id == "BOS0") & (fake.season == 2026)].points.mean()) < 1e-9, "prop model: before the new season's file exists every player is an opener row off last season")
    S2, teams2, _ = npm_._state(B, 2026)
    ok(int(S2[S2.athlete_id == "BOS0"].gp.iloc[0]) == 40 and "BOS" in teams2 and abs(teams2["BOS"]["t_for"] - 110) < 1e-9, "prop model: with the season's file the state is this season to date + the team numbers")
finally:
    nd.player_box = _pb

# 10/21: teammates out (a regular who played one of the last 3 games and sits this one; a traded player is not "out")
f2 = fake[fake.season == 2026].copy()
f2["game_date"] = [str((pd.Timestamp("2025-11-01") + pd.Timedelta(days=int(g) % 1000)).date()) for g in f2.game_id]
f2 = f2[~((f2.athlete_id == "BOS0") & (f2.game_id == 2026020))]                      # BOS0 (30 min) sits game 20
f2 = f2[~((f2.athlete_id == "BOS1") & (f2.game_id >= 2026030))]                      # BOS1 leaves BOS after game 29 ...
mv = fake[(fake.season == 2026) & (fake.athlete_id == "BOS1") & (fake.game_id >= 2026031)].copy()
mv["team_abbreviation"], mv["opponent_team_abbreviation"], mv["home_away"] = "DET", "BOS", "away"   # ... and plays for DET from game 31
mv["game_date"] = [str((pd.Timestamp("2025-11-01") + pd.Timedelta(days=int(g) % 1000)).date()) for g in mv.game_id]
f2 = pd.concat([f2, mv], ignore_index=True)
nd.player_box = lambda s: f2 if s == 2026 else None
try:
    T2 = npm_.table(npm_.load_box([2026]))
    g20 = T2[(T2.game_id == 2026020) & (T2.team == "BOS")]; g20d = T2[(T2.game_id == 2026020) & (T2.team == "DET")]
    b0 = T2[(T2.athlete_id == "BOS0") & (T2.game_id == 2026019)].b_min.iloc[0]
    ok((g20.vac_n == 1).all() and (abs(g20.vac_min - b0) < 1e-9).all() and (g20d.vac_n == 0).all(), "prop model: a regular who sits -> his teammates carry his minutes as vacated, the other team none")
    ok((T2[(T2.game_id == 2026030) & (T2.team == "BOS")].vac_n == 0).all() and (T2[(T2.game_id == 2026021) & (T2.team == "BOS")].vac_n == 0).all(), "prop model: a traded player is not vacated; back the next game -> nothing vacated")
    ok(all(c in npm_.feats_for("pts") for c in npm_.VAC) and not any(c in npm_.feats_for("3pm") for c in npm_.VAC), "prop model: teammates-out inputs on points / rebounds / assists / PRA only")
    S3, _, _ = npm_._state(npm_.load_box([2026]), 2026)
    S3["nname"] = S3["athlete_id"].str.lower()          # the made-up names differ only by a digit, which norm_name drops
    L = {"state": S3}
    v = npm_._vac_live(L, ("BOS", "DET"), {"bos2"})
    b2 = float(S3[S3.athlete_id == "BOS2"].b_min.iloc[0])
    ok(abs(v["BOS"]["vac_min"] - b2) < 1e-9 and v["BOS"]["vac_n"] == 1 and v["DET"]["vac_n"] == 0, "prop model: live, an Out regular who played lately = vacated for his team")
    vq = npm_._vac_live(L, ("BOS",), set(), {"bos2"})
    ok(abs(vq["BOS"]["vac_min"] - b2 * npm_.Q_SITS) < 1e-9 and abs(vq["BOS"]["vac_n"] - npm_.Q_SITS) < 1e-9, "prop model: live, a Questionable regular counts 45.5% as out (the share that sits)")
    S3.loc[S3.athlete_id == "BOS2", "last3"] = False
    ok(npm_._vac_live({"state": S3}, ("BOS",), {"bos2"})["BOS"]["vac_n"] == 0, "prop model: live, a player out for weeks is already out of the averages -> not vacated again")
    ok(npm_.needs_rebuild.__doc__ and npm_.PROP_V == 2, "prop model: version 2 (an older saved model keeps serving until rebuilt)")
finally:
    nd.player_box = _pb

print(f"{bad} of {n} checks FAILED" if bad else f"all {n} service checks passed")
sys.exit(1 if bad else 0)

