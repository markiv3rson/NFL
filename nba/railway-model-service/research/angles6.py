# Edge hunt #6 (10/16, ideas from the NFL app's research day): BOUNCE BACK by the size of last game's ATS miss (NFL: road team missed by 24+
# -> 61.3%), the dog version, and totals by spread size / total size (NFL: spread <= 3 -> Under +2). Same protocol: closing lines 2008-26,
# three periods 52.38%+ with 60+ games each, seasons above 50, 20 shuffles for the luck count.
import numpy as np, pandas as pd, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); import nba_data as nd
g = nd.games(); g = g[(g.season_type == 2) & g.home_line.notna() & g.margin.notna()].copy().sort_values(["date", "game_id"])
g["acov"] = np.sign(-(g.margin - g.home_line)); g["hcov"] = -g["acov"]
# each team's last game: ATS margin (team margin minus the line it gave) and plain margin
last = {}; prev_ats_h, prev_ats_a, prev_m_h, prev_m_a, prev_loc_h, prev_loc_a = [], [], [], [], [], []
for r in g.itertuples():
    ph, pa = last.get(r.home), last.get(r.away)
    prev_ats_h.append(ph[0] if ph else np.nan); prev_m_h.append(ph[1] if ph else np.nan); prev_loc_h.append(ph[2] if ph else None)
    prev_ats_a.append(pa[0] if pa else np.nan); prev_m_a.append(pa[1] if pa else np.nan); prev_loc_a.append(pa[2] if pa else None)
    last[r.home] = (r.margin - r.home_line, r.margin, "home"); last[r.away] = (-r.margin + r.home_line, -r.margin, "away")
g["h_pats"], g["a_pats"], g["h_pm"], g["a_pm"] = prev_ats_h, prev_ats_a, prev_m_h, prev_m_a
g["h_ploc"], g["a_ploc"] = prev_loc_h, prev_loc_a
per = np.where(g.season <= 2013, "08-13", np.where(g.season <= 2019, "14-19", "20+"))
rng = np.random.default_rng(7)
def shuffled(side_col):
    out = g[side_col].values.copy()
    for s in g.season.unique():
        idx = np.where(g.season.values == s)[0]; out[idx] = rng.permutation(out[idx])
    return out
def test(name, mask, side, col="acov"):
    x = g[mask & (g[col] != 0)]; p = per[(mask & (g[col] != 0)).values]; w = (x[col] == side)
    byp = [(100 * w[p == q].mean() if (p == q).sum() else np.nan, int((p == q).sum())) for q in ("08-13", "14-19", "20+")]
    ok = all(v >= 52.38 and n >= 60 for v, n in byp)
    sea = x.assign(w=w).groupby("season").w.mean()
    print(f"{'PASS' if ok else '    '} {name}: {100*w.mean():.1f}% of {len(x)} | " + " / ".join(f"{v:.1f} ({n})" for v, n in byp) + f" | seasons>50 {(sea>.5).sum()}/{len(sea)}", flush=True)
    return ok
print("== BOUNCE BACK: team missed ATS by X+ last game -> bet it; by location this game")
for X in (15, 20, 24, 28):
    test(f"away missed by {X}+ -> bet away", g.a_pats <= -X, 1)
    test(f"home missed by {X}+ -> bet home", g.h_pats <= -X, -1)
    test(f"away LOST by {X}+ (plain) -> bet away", g.a_pm <= -X, 1)
    test(f"home LOST by {X}+ (plain) -> bet home", g.h_pm <= -X, -1)
print("== BOUNCE BACK DOG: the dog this game missed by 20+ last game")
test("away dog (+3.5 or more) missed by 20+ -> bet away", (g.a_pats <= -20) & (g.home_line >= 3.5), 1)
test("home dog (+3.5 or more) missed by 20+ -> bet home", (g.h_pats <= -20) & (g.home_line <= -3.5), -1)
print("== fade the team that COVERED big last game")
for X in (15, 20):
    test(f"away covered by {X}+ last game -> bet home", g.a_pats >= X, -1)
    test(f"home covered by {X}+ last game -> bet away", g.h_pats >= X, 1)
print("== TOTALS by spread size / total size (Under at the main total)")
g["under"] = np.where(g.total_line.notna() & (g.total != g.total_line), np.where(g.total < g.total_line, 1, -1), 0)
tl = g.total_line
for name, mask in (("spread <= 3", g.home_line.abs() <= 3), ("spread <= 3 & total 230+", (g.home_line.abs() <= 3) & (tl >= 230)), ("spread <= 3 & total <= 210", (g.home_line.abs() <= 3) & (tl <= 210)),
                   ("spread 10+", g.home_line.abs() >= 10), ("spread 10+ & total 230+", (g.home_line.abs() >= 10) & (tl >= 230)), ("total 240+", tl >= 240), ("total <= 200", tl <= 200)):
    test(f"{name} -> Under", mask & tl.notna(), 1, "under"); test(f"{name} -> Over", mask & tl.notna(), -1, "under")
print("== luck: 20 shuffles of the results, how many of the 8 bounce-back angles pass")
real_acov = g.acov.copy(); passes = []
for k in range(20):
    g["acov"] = shuffled("acov"); n = 0
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):
        for X in (15, 20, 24, 28):
            n += test("", g.a_pats <= -X, 1); n += test("", g.h_pats <= -X, -1)
    passes.append(n)
g["acov"] = real_acov
print("luck passes per shuffle (8 angles):", np.mean(passes), "max", max(passes))
