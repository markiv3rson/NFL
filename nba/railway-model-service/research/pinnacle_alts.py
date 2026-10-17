"""What the market charges per point bought: Pinnacle's free feed carries alternate spreads and totals WITH prices (isAlternate true; lib/pinnacle.js
skips them on purpose). For every alternate line of every open game: points bought off the main line, the price you pay (implied %), Pinnacle's own
chance with the vig removed, and the NBA history win rate for that line given a main line like it (same lookups as live.spread_rate / total_rate).
10/16, 12 regular-season games, 120 bought spread lines + 120 bought total lines: Pinnacle's own chance = history within 0.5 win points at 1-3 points,
and you pay ~2 win points above it (vig 3.7% per alternate market). Usage (from railway-model-service):
  curl -s -H "x-api-key: <guest key in lib/pinnacle.js>" https://guest.api.arcadia.pinnacle.com/0.1/leagues/487/markets/straight > k487.json
  PYTHONPATH=. python3 research/pinnacle_alts.py k487.json [k5270.json ...]"""
import json, sys, numpy as np, pandas as pd
sys.path.insert(0, "."); import nba_data as nd
g = nd.games(); g = g[(g.season_type == 2) & g.home_line.notna() & g.margin.notna()]
hs = pd.concat([pd.DataFrame({"line": g.home_line, "m": g.margin}), pd.DataFrame({"line": -g.home_line, "m": -g.margin})])
gt = g[g.total_line.notna() & g.total.notna()]
def spread_rate(fav_main, fav_alt):
    w = hs[(hs.line - fav_main).abs() <= 1.0]
    if len(w) < 200: w = hs[(hs.line - fav_main).abs() <= 2.0]
    hit = (w.m - fav_alt) > 0; push = (w.m - fav_alt) == 0
    return 100 * hit.sum() / max((~push).sum(), 1)
def total_rate(main, alt, over):
    w = gt[(gt.total_line - main).abs() <= 4.0]
    hit = (w.total > alt) if over else (w.total < alt); push = w.total == alt
    return 100 * hit.sum() / max((~push).sum(), 1)
imp = lambda a: (100 / (a + 100) if a > 0 else -a / (-a + 100)) * 100     # American price -> implied %
for path in sys.argv[1:]:
    k = json.load(open(path))
    mains = {x["matchupId"]: x for x in k if x.get("type") == "spread" and x.get("period") == 0 and x.get("isAlternate") is False}
    tmains = {x["matchupId"]: x for x in k if x.get("type") == "total" and x.get("period") == 0 and x.get("isAlternate") is False}
    rows = []
    for x in k:
        if x.get("period") != 0 or x.get("status") not in (None, "open"): continue
        if x.get("type") == "spread" and x.get("isAlternate") and x["matchupId"] in mains:
            mp = {p["designation"]: p for p in mains[x["matchupId"]]["prices"]}; ap = {p["designation"]: p for p in x["prices"]}
            if "home" not in mp or "home" not in ap or "away" not in ap: continue
            main_home = -mp["home"]["points"]                      # Pinnacle points are the spread (-4.5 = favoured by 4.5); favoured-by = -points
            ih, ia = imp(ap["home"]["price"]), imp(ap["away"]["price"]); nv_h = 100 * ih / (ih + ia)
            for fav_main, fav_alt, raw, nv in ((main_home, -ap["home"]["points"], ih, nv_h), (-main_home, -ap["away"]["points"], ia, 100 - nv_h)):
                pts = round(fav_main - fav_alt, 1)
                if pts <= 0: continue
                rows.append(("spread", pts, raw, nv, spread_rate(fav_main, fav_alt), ih + ia - 100))
        if x.get("type") == "total" and x.get("isAlternate") and x["matchupId"] in tmains:
            mp = {p["designation"]: p for p in tmains[x["matchupId"]]["prices"]}; ap = {p["designation"]: p for p in x["prices"]}
            if "over" not in mp or "over" not in ap or "under" not in ap: continue
            main = mp["over"]["points"]; alt = ap["over"]["points"]
            io, iu = imp(ap["over"]["price"]), imp(ap["under"]["price"]); nv_o = 100 * io / (io + iu)
            if alt < main: rows.append(("total", round(main - alt, 1), io, nv_o, total_rate(main, alt, True), io + iu - 100))
            elif alt > main: rows.append(("total", round(alt - main, 1), iu, 100 - nv_o, total_rate(main, alt, False), io + iu - 100))
    d = pd.DataFrame(rows, columns=["market", "pts", "pay", "novig", "hrate", "vig"])
    print(f"== {path}: {len(mains)} games with a main spread, {len(d[d.market=='spread'])} bought spread lines, {len(d[d.market=='total'])} bought total lines, vig per alternate market avg {d.vig.mean():.1f}%")
    for mk in ("spread", "total"):
        x = d[d.market == mk]
        if not len(x): continue
        print(f"  {mk}: points bought -> lines | you pay (implied %) | Pinnacle's own chance (vig removed) | NBA history win rate | pay minus history (vig removed)")
        for p, grp in x.groupby(pd.cut(x.pts, [0, 1, 2, 3, 4, 5, 6, 7, 20], labels=["0.5-1", "1.5-2", "2.5-3", "3.5-4", "4.5-5", "5.5-6", "6.5-7", "7.5+"]), observed=True):
            print(f"    {p:>6}: {len(grp):3d} | pay {grp.pay.mean():5.1f} | Pinnacle {grp.novig.mean():5.1f} | history {grp.hrate.mean():5.1f} | {grp.pay.mean() - grp.hrate.mean():+5.1f} ({grp.novig.mean() - grp.hrate.mean():+5.1f})")
        if len(x) > 5:
            a, _ = np.polyfit(x.pts, x.pay, 1); a2, _ = np.polyfit(x.pts, x.hrate, 1); a3, _ = np.polyfit(x.pts, x.novig, 1)
            print(f"    per point bought: you pay {a:+.2f} win points of price, Pinnacle's own chance moves {a3:+.2f}, history gives {a2:+.2f} (fit over {len(x)} lines)")
        print(f"    lines where history beats the price paid: {int((x.hrate > x.pay).sum())} of {len(x)}")
