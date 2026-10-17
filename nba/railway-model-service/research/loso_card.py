# Leave-one-season-out replay of the card's PICK w/ POINTS on NBA closing lines (the NFL app's 10/16 test): for every game, the per-line win
# rates come from the OTHER seasons only (live.spread_rate's rule: games with a main line within 1 point, 2 if fewer than 200), the card picks
# the row (lib/cardpick.js pickPts: fewest points reaching 56% on either team, else the best within 2 points; a 2.5-3.5 point line only if it
# beats the best within 2 by 3+), and we count what the chosen row SAID vs what it WON. Then the same with each row's rate shrunk toward the
# pooled rate of its side (favorite / dog) and points over every main line, K extra games (the NFL app's SHRINK_K).
import numpy as np, pandas as pd, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nba_data as nd
g = nd.games(); g = g[(g.season_type == 2) & g.home_line.notna() & g.margin.notna()].copy()
PTS = [1.0, 2.0, 2.5, 3.0]; BAR = 56.0; GAIN = 3.0
def table(h):     # h = hist frame (line = favoured-by, m = team margin), both orientations
    h = h.sort_values("line"); return h.line.values, h.m.values
def rate(L, M, main, alt):
    lo, hi = np.searchsorted(L, main - 1.0, "left"), np.searchsorted(L, main + 1.0, "right")
    if hi - lo < 200: lo, hi = np.searchsorted(L, main - 2.0, "left"), np.searchsorted(L, main + 2.0, "right")
    m = M[lo:hi]; d = m - alt; hit = (d > 0).sum(); push = (d == 0).sum(); n = len(m) - push
    return (hit / n if n else np.nan), n
def pooled(h):    # prior rates by (side, points): P(team covers main - p | side)
    out = {}
    for side, w in (("fav", h[h.line > 0]), ("dog", h[h.line < 0]), ("pk", h[h.line == 0])):
        for p in [0.0] + PTS:
            d = w.m - (w.line - p); n = (d != 0).sum(); out[(side, p)] = ((d > 0).sum() / n) if n else 0.5
    return out
rows_all = []
for S_ in sorted(g.season.unique()):
    tr, te = g[g.season != S_], g[g.season == S_]
    h = pd.concat([pd.DataFrame({"line": tr.home_line.values, "m": tr.margin.values}), pd.DataFrame({"line": -tr.home_line.values, "m": -tr.margin.values})], ignore_index=True)
    L, M = table(h); pri = pooled(h)
    for r in te.itertuples():
        for team, main, marg in (("home", r.home_line, r.margin), ("away", -r.home_line, -r.margin)):
            side = "fav" if main > 0 else "dog" if main < 0 else "pk"
            for p in PTS:
                alt = main - p; rt, n = rate(L, M, main, alt)
                if np.isnan(rt): continue
                won = (marg - alt > 0); push = (marg - alt == 0)
                rows_all.append((S_, r.game_id, team, side, p, rt, n, pri[(side, p)], won, push))
R = pd.DataFrame(rows_all, columns=["season", "game_id", "team", "side", "points", "rate", "n", "prior", "won", "push"])
# 10/16 fix: pushes stay in until the line is CHOSEN, and a chosen line that pushed is simply not graded. Dropping pushed rows first let the
# result pick the row (a 2-point push removed the strongest near row, so the 3-point row on the same side qualified and "won" by construction):
# the far total rows read 90% that way.
def choose(df, K):
    df = df.copy(); df["hit"] = 100 * (df.rate * df.n + K * df.prior) / (df.n + K)
    out = []
    for gid, G in df.groupby("game_id", sort=False):
        near = G[G.points <= 2.0]; far = G[G.points > 2.0]
        best_near = near.hit.max() if len(near) else -1
        cand = far[far.hit >= best_near + GAIN] if len(far) else far
        if len(cand): pick = cand.sort_values("hit", ascending=False).iloc[0]
        else:
            ok = near[near.hit >= BAR]
            if len(ok): m = ok.points.min(); pick = ok[ok.points == m].sort_values("hit", ascending=False).iloc[0]
            elif len(near): pick = near.sort_values(["hit", "points"], ascending=[False, True]).iloc[0]
            else: continue
        out.append(pick)
    C = pd.DataFrame(out); return C[~C.push]
print(f"games {g.game_id.nunique()} | rows {len(R)}")
for K in (0, 100, 200, 400):
    C = choose(R, K)
    seg = lambda m: f"{C[m].hit.mean():.1f}/{100*C[m].won.mean():.1f} ({m.sum()})"
    print(f"K={K:>3}: chosen said {C.hit.mean():.1f}% won {100*C.won.mean():.1f}% (n {len(C)}) | fav {seg(C.side=='fav')} dog {seg(C.side=='dog')} | 1pt {seg(C.points==1)} 2pt {seg(C.points==2)} far {seg(C.points>2)} | said 56+ {seg(C.hit>=56)}", flush=True)
    bys = C.groupby("season").apply(lambda x: pd.Series({"said": x.hit.mean(), "won": 100 * x.won.mean()})); print("   seasons where won >= said-2:", int((bys.won >= bys.said - 2).sum()), "of", len(bys), flush=True)
# rows themselves (all rows, not chosen): calibration by said bucket, K=0 and 200
R = R[~R.push]
for K in (0, 200):
    R["hit"] = 100 * (R.rate * R.n + K * R.prior) / (R.n + K); b = pd.cut(R.hit, [0, 50, 53, 56, 59, 62, 100])
    print(f"rows K={K}:", " | ".join(f"{str(iv)}: said {x.hit.mean():.1f} won {100*x.won.mean():.1f} ({len(x)})" for iv, x in R.groupby(b, observed=True)), flush=True)
