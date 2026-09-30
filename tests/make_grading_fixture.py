"""Builds tests/fixtures/grading_2025.{csv,json}: every 2025 game (regular season + playoffs, real scores and closing lines) plus
EXPECTED grading results computed here, independently of the site's JavaScript. tests/grading_audit.mjs replays the same games through
the site's real grading code and requires an exact match. Re-run only to rebuild the fixture:  python3 tests/make_grading_fixture.py"""
import os, json, math, urllib.request
import pandas as pd
src = os.path.expanduser("~/.nfl_cache/games.csv")
g = pd.read_csv(src if os.path.exists(src) else "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv")
g = g[(g.season == 2025) & g.result.notna() & g.spread_line.notna() & g.total_line.notna()].reset_index(drop=True)
g = g.dropna(subset=["home_moneyline", "away_moneyline", "home_spread_odds", "away_spread_odds", "over_odds", "under_odds"]).reset_index(drop=True)
cols = ["game_id","season","game_type","week","gameday","gametime","away_team","away_score","home_team","home_score","location","roof","surface","stadium","spread_line","total_line","home_moneyline","away_moneyline","home_spread_odds","away_spread_odds","over_odds","under_odds"]
g[cols].to_csv(os.path.join(os.path.dirname(__file__), "fixtures", "grading_2025.csv"), index=False)
imp = lambda o: 100 / (o + 100) if o > 0 else -o / (-o + 100)            # American odds -> the price a buyer pays
res = lambda x: "W" if x > 0 else "L" if x < 0 else "P"
sig = lambda x: 1 / (1 + math.exp(-x))
games = []
for i, r in g.iterrows():
    hs = -float(r.spread_line); tl = float(r.total_line); H, A = int(r.home_score), int(r.away_score); margin, tot = H - A, H + A
    d1 = ((i * 37) % 25 - 12) * 0.5; d2 = ((i * 53) % 21 - 10) * 0.5       # synthetic model numbers (incl. exact-on-the-line games)
    hm, mt = float(r.spread_line) + d1, tl + d2                              # model home margin / total
    key = f"{r.away_team} @ {r.home_team}"
    poly = {"spread": {"homeSpread": hs + 0.0, "home": imp(r.home_spread_odds), "away": imp(r.away_spread_odds)},
            "total": {"line": tl, "over": imp(r.over_odds), "under": imp(r.under_odds)}, "ml": {"home": imp(r.home_moneyline), "away": imp(r.away_moneyline)}}
    e = {}
    gap = hm + hs
    if abs(gap) >= 0.05:                                                     # model's spread side: team the model likes more than the line
        home = gap > 0; line = hs if home else -hs; x = margin + hs if home else -(margin + hs)
        e["spread"] = {"side": "home" if home else "away", "line": line + 0.0, "result": res(x), "price": poly["spread"]["home" if home else "away"]}
    gt = mt - tl
    if abs(gt) >= 0.05:
        over = gt > 0; x = tot - tl if over else tl - tot
        e["total"] = {"side": "over" if over else "under", "line": tl, "result": res(x), "price": poly["total"]["over" if over else "under"]}
    ph = sig(-0.0452 + 0.1464 * -hs)                                         # market win chance (home)
    fav_home = ph > 0.5
    e["winner"] = {"team": r.home_team if fav_home else r.away_team, "result": "P" if margin == 0 else ("W" if (margin > 0) == fav_home else "L"), "p": ph if fav_home else 1 - ph}
    e["ml"] = None if margin == 0 else {"team": r.home_team if fav_home else r.away_team, "result": "W" if (margin > 0) == fav_home else "L"}
    e["mlModel"] = None if (hm == 0 or margin == 0) else {"result": "W" if (margin > 0) == (hm > 0) else "L"}
    legs_mb = []                                                              # My Bets legs (line is always the TEAM's own line / the total line)
    for ln in (hs, round(hs)):
        legs_mb.append(dict(leg=dict(kind="spread", team=r.home_team, line=ln + 0.0, game=key), expected=res(margin + ln)))
        legs_mb.append(dict(leg=dict(kind="spread", team=r.away_team, line=-ln + 0.0, game=key), expected=res(-margin - ln)))
    for ln in (tl, round(tl)):
        legs_mb.append(dict(leg=dict(kind="total", side="over", line=float(ln), game=key), expected=res(tot - ln)))
        legs_mb.append(dict(leg=dict(kind="total", side="under", line=float(ln), game=key), expected=res(ln - tot)))
    games.append(dict(key=key, week=int(r.week), home=r.home_team, away=r.away_team, H=H, A=A, hm=hm, mt=mt, poly=poly, expected=e, mybets=legs_mb))
# combos: 2-4 real legs per combo inside one week (ml / spread / total, several whole-number lines so pushes happen); independent expectation
legtypes = ["ml_home", "ml_away", "spread_home", "spread_away", "total_over", "total_under", "spread_home_int", "total_over_int"]
def leg_expect(gm, kind):
    m = gm["H"] - gm["A"]; t = gm["H"] + gm["A"]; p = gm["poly"]; hs = p["spread"]["homeSpread"]
    if kind == "ml_home": return dict(kind="ml", team=gm["home"], price=p["ml"]["home"]), "P" if m == 0 else ("W" if m > 0 else "L")
    if kind == "ml_away": return dict(kind="ml", team=gm["away"], price=p["ml"]["away"]), "P" if m == 0 else ("W" if m < 0 else "L")
    if kind == "spread_home": return dict(kind="spread", label=f"{gm['home']} {hs:+g}", price=p["spread"]["home"]), res(m + hs)
    if kind == "spread_away": return dict(kind="spread", label=f"{gm['away']} {-hs:+g}", price=p["spread"]["away"]), res(-m + -hs)
    if kind == "total_over": return dict(kind="total", label=f"Over {p['total']['line']:g}", price=p["total"]["over"]), res(t - p["total"]["line"])
    if kind == "total_under": return dict(kind="total", label=f"Under {p['total']['line']:g}", price=p["total"]["under"]), res(p["total"]["line"] - t)
    if kind == "spread_home_int": L = round(hs); return dict(kind="spread", label=f"{gm['home']} {L:+g}", price=0.5), res(m + L)        # whole-number line
    if kind == "total_over_int": L = round(p["total"]["line"]); return dict(kind="total", label=f"Over {L:g}", price=0.5), res(t - L)
combos = []
by_week = {}
for gm in games: by_week.setdefault(gm["week"], []).append(gm)
n = 0
for wk, gs in by_week.items():
    for s in range(0, len(gs) - 3, 4):
        size = 2 + (n % 3); n += 1
        legs, exp = [], []
        for j in range(size):
            gm = gs[s + j]; kind = legtypes[(n + j) % len(legtypes)]; leg, r = leg_expect(gm, kind); leg["game"] = gm["key"]; legs.append(leg); exp.append(r)
        if "L" in exp: result, ret = "L", -1.0
        elif all(x == "P" for x in exp): result, ret = "P", 0.0
        else: result, ret = "W", math.prod(1 / l["price"] for l, r in zip(legs, exp) if r == "W") - 1
        combos.append(dict(week=wk, legs=legs, expected=dict(result=result, ret=ret, legs=exp)))
# edge-tracker entries: ml / spread / total, graded at the result and against the closing price (same line only)
edges = []
for i, gm in enumerate(games):
    if i % 3: continue
    p = gm["poly"]; m = gm["H"] - gm["A"]; t = gm["H"] + gm["A"]; hs = p["spread"]["homeSpread"]; kind = ["ml", "spread", "total"][(i // 3) % 3]
    if kind == "ml": home = i % 2 == 0; x = (m if home else -m); r = "P" if m == 0 else ("W" if x > 0 else "L"); price = p["ml"]["home" if home else "away"]; rec = dict(market="ml", team=gm["home"] if home else gm["away"]); close = price
    elif kind == "spread": home = i % 2 == 0; line = hs if home else -hs; x = (m if home else -m) + line; r = res(x); price = 0.47; rec = dict(market="spread", team=gm["home"] if home else gm["away"], line=line + 0.0); close = p["spread"]["home" if home else "away"]
    else: over = i % 2 == 0; line = p["total"]["line"]; x = t - line if over else line - t; r = res(x); price = 0.46; rec = dict(market="total", side="over" if over else "under", line=line); close = p["total"]["over" if over else "under"]
    pl = (1 / price - 1) if r == "W" else (-1.0 if r == "L" else 0.0)
    edges.append(dict(game=gm["key"], week=gm["week"], price=price, rec=rec, expected=dict(result=r, pl=pl, clv=close / price - 1)))
json.dump(dict(games=games, combos=combos, edges=edges), open(os.path.join(os.path.dirname(__file__), "fixtures", "grading_2025.json"), "w"))
print(f"{len(games)} games, {len(combos)} combos, {len(edges)} edge entries; pushes among spread picks:", sum(1 for g in games if g['expected'].get('spread', {}).get('result') == 'P'))
