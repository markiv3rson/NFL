#!/usr/bin/env python3
"""
honest_test.py — NBA only. The NFL app's hard rule, applied here: a pattern's win rate counts only on games it has NEVER seen.

For each test season S (2010-2026): find the patterns using every OTHER season (same rules as combo_study: beat the rate in every
period, 60+ games each), then see how those patterns do on S alone. The rate a pattern shows on the page (e.g. 59.1% over 342 games)
was measured on the very games it was found in; the numbers here are the real ones. Run: python3 honest_test.py
"""
import sys, json, numpy as np, pandas as pd
import nba_data as nd, nba_features as nf, combo_study as cs

PER = cs.PERIODS


def kept(rows, outcome, base, ml, exclude, min_n=cs.MIN_N):
    """Patterns kept when season `exclude` is left out (periods keep their boundaries; the left-out season just has fewer games)."""
    r = rows[rows.season != exclude]
    t = cs.scan(r, outcome, base, min_n=min_n)
    return cs.clean(cs.passes(t, ml))


def match_matrix(rows, patterns):
    """(n_rows, n_patterns) bool: does each row meet every condition of each pattern."""
    cols = {c: rows[c].values.astype(bool) for c in rows.columns if rows[c].dtype == bool}
    M = np.zeros((len(rows), len(patterns)), bool)
    for j, p in enumerate(patterns):
        m = np.ones(len(rows), bool)
        for c in p.split(" & "):
            m &= cols[c]
        M[:, j] = m
    return M


def loso(sr, gr, seasons=range(2010, nd.current_season() + 1), verbose=True):
    """Returns DataFrame of out-of-sample signals: one row per (game, side) pattern signal with in-sample rate, tier and the real result."""
    out = []
    for S in seasons:
        for kind, rows, outc, base, ml in (("spread", sr, "cover", None, False), ("total", gr, "over", None, False), ("moneyline", sr, "win", "implied", True)):
            g = kept(rows, outc, base, ml, exclude=S)
            if not len(g):
                continue
            test = rows[rows.season == S].reset_index(drop=True)
            if test.empty:
                continue
            M = match_matrix(test, list(g.pattern)); rate = g.rate.values
            best = np.where(M, rate[None, :], 0).max(1)                 # strongest matching pattern's in-sample rate
            hit = best > 0
            t = test[hit].copy(); t["rate_in"] = best[hit]; t["kind"] = kind; t["S"] = S
            out.append(t[["S", "kind", "game_id", "side" if "side" in t.columns else "season", "rate_in"] + ([outc] if outc in t.columns else [])].rename(columns={outc: "y"}))
            if verbose:
                print(f"  {S} {kind:9} kept {len(g):2} patterns, {int(hit.sum()):4} signals", flush=True)
    return pd.concat(out, ignore_index=True)


def summarize(sig):
    res = {}
    for kind, g in sig.groupby("kind"):
        g = g.dropna(subset=["y"])
        if kind in ("spread", "moneyline"):
            # one signal per game: the side whose best pattern is stronger
            g = g.sort_values("rate_in", ascending=False).drop_duplicates("game_id")
        res[kind] = {"signals": int(len(g)), "win_rate_unseen": round(float(g.y.mean()) * 100, 1),
                     "in_sample_rate_claimed": round(float(g.rate_in.mean()) * 100, 1),
                     "pick_tier_56+": {"n": int((g.rate_in >= 0.56).sum()), "unseen": round(float(g[g.rate_in >= 0.56].y.mean()) * 100, 1) if (g.rate_in >= 0.56).any() else None},
                     "lean_tier": {"n": int((g.rate_in < 0.56).sum()), "unseen": round(float(g[g.rate_in < 0.56].y.mean()) * 100, 1) if (g.rate_in < 0.56).any() else None},
                     "seasons_above_50": int((g.groupby("S").y.mean() > 0.5).sum()), "seasons": int(g.S.nunique())}
    return res


if __name__ == "__main__":
    g = nd.games(); c = nf.team_context(g)
    c = cs.merge_feat(c, nf.build(range(2008, nd.current_season() + 1)))
    sr = cs.side_rows(c); gr = cs.game_rows(c)
    sig = loso(sr, gr)
    sig.to_pickle((sys.argv[1] if len(sys.argv) > 1 else "honest_result.json") + ".sig.pkl")
    res = summarize(sig)
    print(json.dumps(res, indent=1))
    json.dump(res, open(sys.argv[1] if len(sys.argv) > 1 else "honest_result.json", "w"), indent=1)
