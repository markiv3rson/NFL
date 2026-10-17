"""Replay on Polymarket's REAL closing prices (2025-26, research/poly_closes_fetch.py -> poly_closes_2026.csv): the moneyline PICK (the market's
own chance, 56%+) graded by Polymarket's own resolution with money per $100 at the real price, favorite calibration by price band, and how far
the busiest spread / total line sits from 50/50. Usage: python3 poly_closes_replay.py [csv]"""
import sys, json, ast, numpy as np, pandas as pd
src = sys.argv[1] if len(sys.argv) > 1 else "poly_closes_2026.csv"
d = pd.read_csv(src)
def lst(x):
    try: return json.loads(x) if isinstance(x, str) else None
    except Exception:
        try: return ast.literal_eval(x)
        except Exception: return None
print("games:", len(d), "| dates:", d.start.min()[:10], "to", d.start.max()[:10])
for k in ("ml", "spread", "total"):
    print(f"  {k}: closing price for {int(d[k + '_px'].notna().sum())} of {len(d)}; history points avg {d[k + '_pts'].mean():.0f}")
m = d[d.ml_px.notna()].copy(); m["fin"] = m.ml_final.map(lst)
m = m[m.fin.map(lambda f: isinstance(f, list) and len(f) == 2)].copy()
m["won0"] = m.fin.map(lambda f: float(f[0]) > 0.5); m["p0"] = m.ml_px.astype(float)
m["pfav"] = np.where(m.p0 >= 0.5, m.p0, 1 - m.p0); m["favwon"] = np.where(m.p0 >= 0.5, m.won0, ~m.won0)
print("\n== MONEYLINE at Polymarket's real closing price, graded by Polymarket's own result")
for lo, hi in ((0.5, 0.56), (0.56, 0.65), (0.65, 0.75), (0.75, 0.85), (0.85, 1.01)):
    x = m[(m.pfav >= lo) & (m.pfav < hi)]
    if len(x): print(f"  favorite priced {lo:.2f}-{hi:.2f}: said {100*x.pfav.mean():.1f}% won {100*x.favwon.mean():.1f}% (n {len(x)})")
pick = m[m.pfav >= 0.56]; money = np.where(pick.favwon, 100 / pick.pfav - 100, -100)
print(f"  the moneyline PICK (56%+ at the real price): won {100*pick.favwon.mean():.1f}% of {len(pick)} | said {100*pick.pfav.mean():.1f}% | money per $100: {money.mean():+.1f}")
lean = m[(m.pfav >= 0.524) & (m.pfav < 0.56)]; mon2 = np.where(lean.favwon, 100 / lean.pfav - 100, -100)
if len(lean): print(f"  LEAN band 52.4-56: won {100*lean.favwon.mean():.1f}% of {len(lean)} | money per $100: {mon2.mean():+.1f}")
for k, lab in (("spread", "busiest spread"), ("total", "busiest total")):
    x = d[d[k + "_px"].notna()].copy(); px = x[k + "_px"].astype(float)
    fin = x[k + "_final"].map(lst); yes = fin.map(lambda f: float(f[0]) > 0.5 if isinstance(f, list) and len(f) == 2 else np.nan)
    ok = yes.notna()
    print(f"\n== {lab}: first side's closing price avg {px.mean():.3f}; within 0.45-0.55 in {100*((px >= .45) & (px <= .55)).mean():.0f}% of games; |price - 0.50| avg {np.abs(px - .5).mean():.3f}")
    print(f"   first side won {100*yes[ok].mean():.1f}% of {int(ok.sum())} (priced {100*px[ok].mean():.1f}%) | priced 0.55+ won {100*yes[ok & (px >= .55)].mean():.1f}% of {int((ok & (px >= .55)).sum())} | priced <= 0.45 won {100*yes[ok & (px <= .45)].mean():.1f}% of {int((ok & (px <= .45)).sum())}")
    fav = px >= .5; w_f = np.where(fav, yes.astype(float), 1 - yes.astype(float)); p_f = np.where(fav, px, 1 - px); mon = np.where(w_f > 0.5, 100 / p_f - 100, -100)
    print(f"   always the priced-up side at its price: won {100*np.nanmean(w_f[ok]):.1f}%, money per $100 {np.nanmean(mon[ok]):+.1f}; the cheap side: {-np.nanmean(mon[ok]):+.1f}")
