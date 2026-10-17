"""LINE MOVE / TOTAL MOVE splits on the two seasons of NBA opening and closing lines (Kaggle 2024-25 + 2025-26; the NFL app's 10/16 idea).
Input: the open/close frame saved by the edge-hunt scripts (open_close.pkl: open_spread_home, close_spread_home, open_total, close_total,
margin, tot, season). Side the line moved toward, graded at the OPENING and at the CLOSING number, by move size, favorite / dog, home / road."""
import sys, numpy as np, pandas as pd
src = sys.argv[1] if len(sys.argv) > 1 else "open_close.pkl"
d = pd.read_pickle(src)
if "stage" in d: d = d[d.stage.astype(str).str.lower().str.contains("regular")]
d = d[d.open_spread_home.notna() & d.close_spread_home.notna() & d.margin.notna()].copy()
d["mv"] = d.close_spread_home - d.open_spread_home          # home spread change; negative = moved toward the home team
d["toward_home"] = d.mv < 0; d["size"] = d.mv.abs()
def grade(at):
    line = d.open_spread_home if at == "open" else d.close_spread_home
    home_cov = np.sign(d.margin + line)                       # home covers when margin + home_spread > 0
    side = np.where(d.toward_home, 1, -1)
    return pd.Series(np.where(home_cov == 0, np.nan, (home_cov == side).astype(float)), index=d.index)
d["w_open"], d["w_close"] = grade("open"), grade("close")
d["fav_moved"] = np.where(d.toward_home, d.open_spread_home < 0, d.open_spread_home > 0)   # the side moved toward was the favorite at the open
def rep(name, m):
    x = d[m]; by = x.groupby("season")
    print(f"{name}: at OPEN {100*x.w_open.mean():.1f}% | at CLOSE {100*x.w_close.mean():.1f}% | n {len(x)} | by season open {[round(100*v, 1) for v in by.w_open.mean()]} close {[round(100*v, 1) for v in by.w_close.mean()]}")
print("== LINE MOVE splits (NBA, open vs close)")
rep("moved 3+ (all)", d["size"] >= 3)
rep("moved 3-3.9", (d["size"] >= 3) & (d["size"] < 4)); rep("moved 4+", d["size"] >= 4); rep("moved 5+", d["size"] >= 5)
rep("moved 3+ toward the DOG", (d["size"] >= 3) & (~d.fav_moved)); rep("moved 3+ toward the FAVORITE", (d["size"] >= 3) & (d.fav_moved))
rep("moved 3+ toward the HOME team", (d["size"] >= 3) & d.toward_home); rep("moved 3+ toward the ROAD team", (d["size"] >= 3) & ~d.toward_home)
rep("moved 2-2.9", (d["size"] >= 2) & (d["size"] < 3))
t = d[d.open_total.notna() & d.close_total.notna() & d.tot.notna()].copy(); t["mvt"] = t.close_total - t.open_total
def rept(name, m, side):
    x = t[m]; wo = np.where(x.tot == x.open_total, np.nan, (np.sign(x.tot - x.open_total) == side)); wc = np.where(x.tot == x.close_total, np.nan, (np.sign(x.tot - x.close_total) == side))
    print(f"{name}: at OPEN {100*np.nanmean(wo):.1f}% | at CLOSE {100*np.nanmean(wc):.1f}% | n {len(x)}")
print("== TOTAL MOVE splits")
rept("total moved UP 3+ -> Over", t.mvt >= 3, 1); rept("total moved DOWN 3+ -> Under", t.mvt <= -3, -1)
rept("total moved UP 5+ -> Over", t.mvt >= 5, 1); rept("total moved DOWN 5+ -> Under", t.mvt <= -5, -1)
rept("total moved UP 2-2.9 -> Over", (t.mvt >= 2) & (t.mvt < 3), 1); rept("total moved DOWN 2-2.9 -> Under", (t.mvt <= -2) & (t.mvt > -3), -1)
