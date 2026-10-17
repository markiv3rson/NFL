"""SHOT QUALITY honest checks (10/17): the cut-off for each season comes from the OTHER seasons (in points), on both sources (nba.com shot frame from
research/shot_quality.py, ESPN frame from shot_quality_espn.py); overlap of the two conditions; 50 shuffles of the results within each season.
Usage: python3 research/shot_quality_checks.py <nba.com frame.pkl> <espn_shot_frame.pkl>"""
import sys, warnings, numpy as np, pandas as pd
warnings.filterwarnings("ignore")
P = ("08-13", "14-19", "20+"); BE = 52.38
def center(G, d):
    x = pd.DataFrame({"s": G.season.values, "dt": G.date.values, "d": d.values})
    day = x.groupby(["s", "dt"]).d.agg(["sum", "count"]).groupby(level=0).cumsum().groupby(level=0).shift(1)
    mu = (day["sum"] / day["count"]).rename("mu").reset_index()
    return pd.Series(d.values - x.merge(mu, on=["s", "dt"], how="left").mu.values, index=d.index)
def loso_mask(G, v, ok, q, low):
    m = pd.Series(False, index=G.index)
    for s in G.season.unique():
        oth = ok & (G.season != s); cut = v[oth].quantile(q)
        m |= ok & (G.season == s) & ((v <= cut) if low else (v >= cut))
    return m
def show(G, name, m, res="over", side=1):
    x = G[m]; w = (x[res] if side == 1 else 1 - x[res]).values; okw = ~np.isnan(w); x = x[okw]; w = w[okw]
    byp = [(100 * w[x.per.values == p].mean(), int((x.per.values == p).sum())) for p in P]
    seas = pd.Series(w).groupby(x.season.values).mean(); ok = all(a >= BE and n >= 60 for a, n in byp)
    print(f"  {name:66s} {100*w.mean():5.1f}% of {len(x):5d} | " + " / ".join(f"{a:.1f}" for a, n in byp) + f" | seasons >50 {int((seas > .5).sum())}/{len(seas)}" + ("  PASS" if ok else ""))
    return ok, set(x.game_id.astype(str))
for path, lab in ((sys.argv[1], "nba.com shots"), (sys.argv[2], "ESPN play-by-play")):
    G = pd.read_pickle(path).sort_values("date").copy(); G["per"] = G.season.map(lambda s: "08-13" if s <= 2013 else "14-19" if s <= 2019 else "20+")
    if "over" not in G: G["over"] = np.where(G.total == G.total_line, np.nan, (G.total > G.total_line).astype(float))
    print(f"\n== {lab}: cut-offs from the other seasons")
    ok20 = (G.h_gp >= 10) & (G.a_gp >= 10); c = center(G, G.h_lucktot_20 + G.a_lucktot_20); okc = ok20 & c.notna()
    p1, s1 = show(G, "COLD SHOOTING: both teams' games ran cold last 20 (10%) -> OVER", loso_mask(G, c, okc, .1, True))
    ok10 = (G.h_gp >= 5) & (G.a_gp >= 5); e = center(G, (G.h_xtot_10 + G.a_xtot_10) / 2 - G.total_line); oke = ok10 & e.notna()
    p2, s2 = show(G, "SHOT QUALITY: expected points above the total last 10 (10%) -> OVER", loso_mask(G, e, oke, .9, False))
    p3, s3 = show(G, "SHOT QUALITY: expected points above the total last 10 (5%) -> OVER", loso_mask(G, e, oke, .95, False))
    print(f"  overlap: cold-shooting games also in shot-quality 10%: {len(s1 & s2)} of {len(s1)}")
    u = G.game_id.astype(str).isin(s1 | s2); show(G, "EITHER of the two (10% each) -> OVER", u)
    print("  cut-off in points (all seasons): cold shooting <= %.1f below the season's running average; shot quality >= %.1f above" % (c[okc].quantile(.1), e[oke].quantile(.9)))
    # shuffles: results shuffled within season, the same 3 rules, 50 times
    rng = np.random.default_rng(11); passes = []
    for k in range(50):
        G2 = G.copy(); G2["over"] = G2.groupby("season").over.transform(lambda v: pd.Series(rng.permutation(v.values), index=v.index))
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            passes.append(sum(show(G2, "", m)[0] for m in (loso_mask(G2, c, okc, .1, True), loso_mask(G2, e, oke, .9, False), loso_mask(G2, e, oke, .95, False))))
    print(f"  luck alone (50 shuffles): {np.mean(passes):.2f} of 3 rules pass on average, max {max(passes)}")
