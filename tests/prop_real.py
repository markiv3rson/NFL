#!/usr/bin/env python3
"""Player props on REAL Polymarket lines (10/17): 2026 weeks 1-6 prop markets rebuilt from Polymarket's public trade log
(railway-model-service/data/poly_prop_closes.csv: last trade before kickoff = close). The 2026 model numbers come from
prop_model.walk_forward (trained on 2019-2025 only; tests/prop_backtest.py saves them). A pick = the side the model gives 65%+;
graded on the real stats; price = the close + 1c (the ask). Prints win rate by stat x side x band, and money per $100 as data.
Run after prop_backtest.py: cd railway-model-service && python3 ../tests/prop_real.py"""
import sys, os, pickle, pandas as pd
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "railway-model-service"))
import prop_model as pm, td_prob

BANDS = [(0.65, 0.70), (0.70, 0.80), (0.80, 0.90), (0.90, 1.01)]
def main():
    W = pickle.load(open(os.path.expanduser("~/.nfl_cache/prop_oof.pkl"), "rb"))
    C = pd.read_csv(os.path.join(os.path.dirname(pm.__file__), "data", "poly_prop_closes.csv"))
    _, ros = pm._pos_map(2026)
    nm = ros.assign(nn=ros.full_name.map(td_prob._nn))[["gsis_id", "nn"]]
    st = pm.stat_games(2026)
    rows = []
    for stat, O in W.items():
        sp_rows = O[O.season < 2026]; sp = pm.Spread(sp_rows.mu.values, sp_rows[stat].values)
        te = O[O.season == 2026].merge(nm, left_on="pid", right_on="gsis_id", how="left")
        c = C[C.stat == stat].copy(); c["nn"] = c.player.map(td_prob._nn)
        m = c.merge(te[["nn", "game_id", "mu", "pid", "week"]], left_on=["nn", "game_id"], right_on=["nn", "game_id"], how="inner")
        if not len(m): continue
        m["p_over"] = [float(sp.over([mu], [L])[0]) for mu, L in zip(m.mu, m.line)]
        a = st[["pid", "game_id", stat]].rename(columns={stat: "actual"})
        m = m.merge(a, on=["pid", "game_id"], how="left"); m["actual"] = m.actual.fillna(0)
        m["stat"] = stat; rows.append(m)
    R = pd.concat(rows, ignore_index=True)
    R["over"] = R.actual > R.line
    R.to_csv(os.path.expanduser("~/.nfl_cache/prop_real.csv"), index=False)
    un = len(C[C.stat.isin(W.keys())]) - len(R)
    print(f"real Polymarket lines 2026 weeks 1-6: {len(C)} traded markets, {len(R)} matched to a model number ({un} not: player with no game yet / name)\n")
    for label, sub in (("traded in the last 24 h before kickoff", R[R.n24 > 0]), ("any trade before kickoff", R)):
        print(f"== {label}: {len(sub)} lines")
        for stat, g in sub.groupby("stat"):
            for side in ("Over", "Under"):
                pc = g.p_over if side == "Over" else 1 - g.p_over
                won = g.over if side == "Over" else ~g.over
                price = (g.close if side == "Over" else 1 - g.close).clip(0.01, 0.99) + 0.01
                m = pc >= 0.65
                if not m.sum(): continue
                money = ((won[m] / price[m]) - 1).mean() * 100
                print(f"  {pm.LABEL[stat]:18s} {side:5s} 65%+: said {pc[m].mean()*100:.1f} won {won[m].mean()*100:.1f}% ({int(won[m].sum())}-{int((~won[m]).sum())}) at {price[m].mean()*100:.0f}c = {money:+.1f} per $100")
                for lo, hi in BANDS:
                    mm = (pc >= lo) & (pc < hi)
                    if mm.sum(): print(f"      {int(lo*100)}-{min(int(hi*100),100)}%: said {pc[mm].mean()*100:.1f} won {won[mm].mean()*100:.1f} ({int(won[mm].sum())}-{int((~won[mm]).sum())}) at {price[mm].mean()*100:.0f}c = {((won[mm]/price[mm])-1).mean()*100:+.1f}")
        print()
    # the market itself as a check: Polymarket's own close as a chance
    s = R[R.n24 > 0]
    print("check -- Brier on lines traded in the last 24 h (lower = better): model", round(float(((s.p_over - s.over) ** 2).mean()), 4),
          " market close", round(float(((s.close - s.over) ** 2).mean()), 4), f"({len(s)} lines)")

if __name__ == "__main__":
    main()
