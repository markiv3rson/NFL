"""Buying 1-7 points, leave-one-season-out (closing lines 2008-26, regular season): calibration of the history-based win rate per points bought,
the gain per point, the PICK w/ POINTS rule with the cap raised 2..7, fixed buys, and totals the same way (owner 10/16: "check buying 2 3 4 5 6 7 points").
Convention (same as live.spread_rate): home_line = the home team's expected margin, + = home favoured; a side covers its favoured-by number f when
margin - f > 0. The first run of this script had that sign flipped ("favorites covered 21%" at the main line gave it away) and was thrown out.
Pushes stay in until a line is chosen; a chosen line that pushed is not graded. Usage (from railway-model-service): PYTHONPATH=. python3 research/buy_points.py"""
import numpy as np, pandas as pd, sys
sys.path.insert(0, "."); import nba_data as nd
g = nd.games(); g = g[(g.season_type == 2) & g.home_line.notna() & g.margin.notna()].copy()
per = lambda s: "08-13" if s <= 2013 else "14-19" if s <= 2019 else "20+"
PTS = [0, 1, 2, 3, 4, 5, 6, 7]; BAR = 56.0
rows = []
for S_ in sorted(g.season.unique()):
    tr, te = g[g.season != S_], g[g.season == S_]
    h = pd.concat([pd.DataFrame({"line": tr.home_line, "m": tr.margin}), pd.DataFrame({"line": -tr.home_line, "m": -tr.margin})]).sort_values("line")
    L, M = h.line.values, h.m.values
    for r in te.itertuples():
        for team, main, marg in (("home", r.home_line, r.margin), ("away", -r.home_line, -r.margin)):
            lo, hi = np.searchsorted(L, main - 1.0, "left"), np.searchsorted(L, main + 1.0, "right")
            if hi - lo < 200: lo, hi = np.searchsorted(L, main - 2.0, "left"), np.searchsorted(L, main + 2.0, "right")
            m = M[lo:hi]
            for p in PTS:
                alt = main - p; d = m - alt; n = len(m) - (d == 0).sum()
                if n <= 0: continue
                rows.append((S_, r.game_id, team, "fav" if main > 0 else "dog" if main < 0 else "pk", p, 100 * (d > 0).sum() / n, len(m), marg - alt > 0, marg - alt == 0))
R = pd.DataFrame(rows, columns=["season", "game_id", "team", "side", "points", "hit", "n", "won", "push"]); R["per"] = R.season.map(per)
G = R[~R.push]
print("== SPREADS: buying p points off the main line, every team of every game (said = history win rate for a main line like this one)")
for p in PTS:
    x = G[G.points == p]; byp = " | ".join(f"{q} {100*x[x.per==q].won.mean():.1f}" for q in ("08-13", "14-19", "20+"))
    print(f"  {p} pts: said {x.hit.mean():.1f} won {100*x.won.mean():.1f} (n {len(x)}) | by period won {byp} | favorites said {x[x.side=='fav'].hit.mean():.1f} won {100*x[x.side=='fav'].won.mean():.1f} | dogs said {x[x.side=='dog'].hit.mean():.1f} won {100*x[x.side=='dog'].won.mean():.1f} | pushes {100*(R[R.points==p].push.mean()):.1f}%", flush=True)
print("  gain per extra point (won at p minus won at p-1):", ", ".join(f"{p}: +{100*(G[G.points==p].won.mean()-G[G.points==p-1].won.mean()):.1f}" for p in PTS[1:]))
print("  rows said 56%+ by points: " + " | ".join(f"{p} pts said {G[(G.points==p)&(G.hit>=56)].hit.mean():.1f} won {100*G[(G.points==p)&(G.hit>=56)].won.mean():.1f} ({((G.points==p)&(G.hit>=56)).sum()})" for p in PTS[1:]))
print("  rows by said band (all points 1-7): " + " | ".join(f"{a}-{b}: won {100*G[(G.points>0)&(G.hit>=a)&(G.hit<b)].won.mean():.1f} ({((G.points>0)&(G.hit>=a)&(G.hit<b)).sum()})" for a, b in ((50,56),(56,60),(60,65),(65,70),(70,80),(80,101))))
def choose(df, min_pts, max_pts):
    out = []
    for gid, Gm in df.groupby("game_id", sort=False):
        B = Gm[(Gm.points >= min_pts) & (Gm.points <= max_pts)]
        if not len(B): continue
        ok = B[B.hit >= BAR]
        if len(ok): mn = ok.points.min(); pick = ok[ok.points == mn].sort_values("hit", ascending=False).iloc[0]
        else: pick = B.sort_values(["hit", "points"], ascending=[False, True]).iloc[0]
        out.append(pick)
    C = pd.DataFrame(out); return C[~C.push]
print("\n== the PICK w/ POINTS rule (fewest points from 2 that reach 56% on either team, else the best within the cap) with the cap raised")
for cap in (2, 3, 4, 5, 6, 7):
    C = choose(R, 2, cap); dist = C.points.value_counts().sort_index().to_dict()
    byp = " | ".join(f"{q} said {C[C.per==q].hit.mean():.1f} won {100*C[C.per==q].won.mean():.1f}" for q in ("08-13", "14-19", "20+"))
    bys = C.groupby("season").apply(lambda x: 100 * x.won.mean() - x.hit.mean())
    print(f"  cap {cap}: said {C.hit.mean():.1f} won {100*C.won.mean():.1f} (n {len(C)}) | {byp} | seasons won >= said-2: {int((bys >= -2).sum())}/{len(bys)} | points chosen {dist}", flush=True)
print("\n== fixed buys: always buy p points on the side the history likes more")
for p in (2, 3, 4, 5, 6, 7):
    x = G[G.points == p].sort_values("hit", ascending=False).groupby("game_id").head(1)
    print(f"  always {p} pts, better side: said {x.hit.mean():.1f} won {100*x.won.mean():.1f} (n {len(x)}) | " + " | ".join(f"{q} {100*x[x.per==q].won.mean():.1f}" for q in ("08-13", "14-19", "20+")))
# ---- totals (live.total_rate: games with a main total within 4; Over at line-p / Under at line+p)
gt = g[g.total_line.notna() & g.total.notna()].copy(); rows = []
for S_ in sorted(gt.season.unique()):
    tr, te = gt[gt.season != S_], gt[gt.season == S_]
    T = tr.sort_values("total_line"); TL, TT = T.total_line.values, T.total.values
    for r in te.itertuples():
        lo, hi = np.searchsorted(TL, r.total_line - 4.0, "left"), np.searchsorted(TL, r.total_line + 4.0, "right"); tt = TT[lo:hi]
        if len(tt) < 50: continue
        for side in ("over", "under"):
            for p in PTS:
                alt = r.total_line - p if side == "over" else r.total_line + p
                hit = (tt > alt) if side == "over" else (tt < alt); n = len(tt) - (tt == alt).sum()
                if not n: continue
                won = (r.total > alt) if side == "over" else (r.total < alt)
                rows.append((S_, r.game_id, side, p, 100 * hit.sum() / n, len(tt), bool(won), bool(r.total == alt)))
RT = pd.DataFrame(rows, columns=["season", "game_id", "side", "points", "hit", "n", "won", "push"]); RT["per"] = RT.season.map(per); GT = RT[~RT.push]
print("\n== TOTALS: buying p points (Over at line-p / Under at line+p)")
for p in PTS:
    x = GT[GT.points == p]
    print(f"  {p} pts: said {x.hit.mean():.1f} won {100*x.won.mean():.1f} (n {len(x)}) | by period won " + " | ".join(f"{q} {100*x[x.per==q].won.mean():.1f}" for q in ("08-13", "14-19", "20+")) + f" | Over said {x[x.side=='over'].hit.mean():.1f} won {100*x[x.side=='over'].won.mean():.1f} | Under said {x[x.side=='under'].hit.mean():.1f} won {100*x[x.side=='under'].won.mean():.1f}", flush=True)
print("  gain per extra point:", ", ".join(f"{p}: +{100*(GT[GT.points==p].won.mean()-GT[GT.points==p-1].won.mean()):.1f}" for p in PTS[1:]))
for cap in (2, 3, 4, 5, 6, 7):
    C = choose(RT.rename(columns={"side": "team"}).assign(side="t"), 2, cap); dist = C.points.value_counts().sort_index().to_dict()
    print(f"  totals rule cap {cap}: said {C.hit.mean():.1f} won {100*C.won.mean():.1f} (n {len(C)}) | points chosen {dist}", flush=True)
