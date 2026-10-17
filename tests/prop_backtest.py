#!/usr/bin/env python3
"""Player props, history test (10/17). Every season 2021-2026 is predicted by models trained only on earlier seasons
(prop_model.walk_forward); each player-game is checked at Polymarket-style ladder lines around his usual number; a pick is the
side the model gives 65%+; graded on what really happened. Prints win rate by stat x side x model band.
Run: cd railway-model-service && python3 ../tests/prop_backtest.py   (writes ~/.nfl_cache/prop_oof.pkl for the real-line test)"""
import sys, os, pickle, numpy as np, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "railway-model-service"))
import prop_model as pm

LADDER = {"pass_yds": np.arange(99.5, 400, 25), "rush_yds": np.arange(9.5, 150, 10), "rec_yds": np.arange(9.5, 150, 10),
          "rec": np.arange(0.5, 11, 1), "pass_cmp": np.arange(13.5, 32, 2), "pass_att": np.arange(23.5, 40, 4), "long_rec": np.array([14.5, 19.5, 24.5])}
BANDS = [(0.65, 0.70), (0.70, 0.80), (0.80, 0.90), (0.90, 1.01)]
TEST = list(range(2021, 2027))

def window(stat, proxy):
    L = LADDER[stat]
    if stat in ("rec",): return L[(L >= proxy - 2.5) & (L <= proxy + 3.5)]
    if stat == "long_rec": return L
    return L[(L >= 0.4 * proxy) & (L <= 2.0 * proxy)]

def main():
    W = pm.walk_forward(TEST)
    pickle.dump(W, open(os.path.expanduser("~/.nfl_cache/prop_oof.pkl"), "wb"))
    rows = []
    for stat, O in W.items():
        for s in TEST:
            sp_rows = O[O.season < s]; te = O[O.season == s]
            if not len(te) or len(sp_rows) < 500: continue
            sp = pm.Spread(sp_rows.mu.values, sp_rows[stat].values)
            proxy = te["b_" + stat].fillna(te.mu).values
            for i, (mu, px, y) in enumerate(zip(te.mu.values, proxy, te[stat].values)):
                lines = window(stat, max(px, 1.0))
                if not len(lines): continue
                po = sp.over(np.full(len(lines), mu), lines)
                for L, p in zip(lines, po):
                    rows.append((stat, s, L, p, y > L))
    R = pd.DataFrame(rows, columns=["stat", "season", "line", "p_over", "over"])
    R.to_pickle(os.path.expanduser("~/.nfl_cache/prop_hist.pkl"))
    print(f"history test: {len(R)} player-game lines, seasons {TEST[0]}-{TEST[-1]}, every season unseen\n")
    print("CALIBRATION (all lines, the model's Over chance vs what happened):")
    R["bin"] = (R.p_over * 10).clip(0, 9.999).astype(int)
    for stat, g in R.groupby("stat"):
        cal = g.groupby("bin").agg(said=("p_over", "mean"), hit=("over", "mean"), n=("over", "size"))
        print(f"  {pm.LABEL[stat]:18s} " + "  ".join(f"{r.said*100:4.0f}->{r.hit*100:4.0f}({r.n})" for r in cal.itertuples()))
    print("\nPICKS (side the model gives 65%+), win rate by band:")
    for stat, g in R.groupby("stat"):
        for side in ("Over", "Under"):
            pc = g.p_over if side == "Over" else 1 - g.p_over
            won = g.over if side == "Over" else ~g.over
            parts = []
            for lo, hi in BANDS:
                m = (pc >= lo) & (pc < hi)
                if m.sum(): parts.append(f"{int(lo*100)}-{min(int(hi*100),100)}%: said {pc[m].mean()*100:.1f} won {won[m].mean()*100:.1f} ({m.sum()})")
            m = pc >= 0.65
            by = " ".join(f"{s}:{won[m & (g.season==s)].mean()*100:.0f}" for s in TEST if (m & (g.season == s)).sum())
            print(f"  {pm.LABEL[stat]:18s} {side:5s} 65%+: won {won[m].mean()*100:.1f}% ({m.sum()})  by season {by}")
            for p in parts: print(f"      {p}")

if __name__ == "__main__":
    main()
