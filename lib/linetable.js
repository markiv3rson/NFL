// Win rate of ANY half-point line (10/15, owner: "build now"). Counts from the nflverse games file (lib/linetable_data.js, built by
// tests/linetable_build.mjs): for a books number, how often a team wins at a line. Three groups are checked and the LOWEST counts (spreads: each group shrunk, see SHRINK below)
// (owner: show the honest rate; 10/15: all games, no day / night split; a group needs 200+ games for the opening group, 60+ for the recent-years group, 40+ for the closing group): closing line 1999-2025, opening line 2014-2025, and the closing line of the recent years 2020-2025.
// A line wins nothing it can push on: only half-point lines are priced (Polymarket lists half points).
import { LT } from "./linetable_data";

export const MAX_BUY = 3.5;                          // the MORE list shows lines up to 3.5 points (owner); 10/29: PICK w/ POINTS buys 5-10 (lib/cardpick.js PTS_MIN / PTS_MAX)
const MIN_N = { c: 40, o: 200, r: 60 };             // fewest games a group needs before it counts (10/15, owner: a thin group must not drag the rate; the closing group is the base; 10/15 research: at 200 the recent-years group counted for only 1 of 15 BEAT THE tiers, hiding books 4 / 7 / 7.5 / 3.5 weak since 2020, so the recent group now counts from 60 games)
export const bucketOf = (T) => (T >= 48 ? "48+" : T >= 42 ? "42-47" : "<=41");
export const latticeOf = (T) => (Number.isInteger(T) ? "i" : "h");

const count = (hist, wins) => { let w = 0, n = 0; for (const [v, c] of hist || []) { n += c; if (wins(v)) w += c; } return { w, n }; };
// SPREAD SHRINK (10/16, owner: "everything on the card accurate as hell"): each group's rate is pulled toward a baseline = the same side buying the
// same cushion (points between the books number and the line) pooled over EVERY books number, 1999-2025 closing, as if the baseline were SHRINK_K
// extra games. Tested leave-one-season-out 2014-25 (1,510 games with a half-point closing line; the card's own PICK w/ POINTS rule applied):
// without the shrink the chosen line said 59.7% and won 57.8% (favorite side said 61.7%, won 56.6%; 2-point lines said 60.9%, won 57.4%);
// with it (lowest of the 3 groups, each shrunk, K = 200) said 59.0% and won 59.5% (favorite 59.9 / 59.4, underdog 58.8 / 59.5, 1 pt 56.4 / 57.4,
// 2 pts 59.0 / 59.3, far lines 60.7 / 61.0; rows said 56-59 won 57.6, said 60-64 won 60.6). Totals are not shrunk (their cells are big and already
// matched: PICK w/ POINTS said 56.3%, won 57.4%).
export const SHRINK_K = 200;
const BASE = {};
function baseline(fav, cu) {
  const key = `${fav ? "f" : "d"}|${cu}`; if (key in BASE) return BASE[key];
  let w = 0, n = 0;
  for (const [a, grp] of Object.entries(LT.s)) { const A = Number(a), L = fav ? -A + cu : A + cu; if (!isFinite(L) || Number.isInteger(L)) continue;
    const x = count(grp.c, fav ? (v) => v + L > 0 : (v) => -v + L > 0); w += x.w; n += x.n; }
  return (BASE[key] = n ? (100 * w) / n : null);
}
function lowest(groups, wins, base = null) {
  const parts = {}; let rate = null;
  for (const g of ["c", "o", "r"]) {
    const x = count(groups && groups[g], wins); if (x.n < MIN_N[g]) continue;
    const raw = (100 * x.w) / x.n, r = base == null ? raw : (100 * x.w + SHRINK_K * base) / (x.n + SHRINK_K);
    parts[g] = { rate: r, raw, n: x.n };
    if (rate == null || r < rate) rate = r;
  }
  return parts.c ? { rate, n: parts.c.n, parts, base } : null;   // the closing-line group must exist
}
// A = books spread number (|spread|); fav = this team is the books' favorite; L = the team's own line (-2.5 gives 2.5, +3.5 gets 3.5)
export function spreadRate(A, fav, L) {
  const grp = LT.s[A]; if (!grp || !isFinite(L) || Number.isInteger(L)) return null;
  const cu = Math.round((fav ? A + L : L - A) * 2) / 2;   // cushion: points between the books number and this line (+ = bought, - = gave up)
  return lowest(grp, fav ? (x) => x + L > 0 : (x) => -x + L > 0, baseline(fav, cu));
}
// T = books total; side over / under; L = the total line bought
export function totalRate(T, side, L) {
  const grp = LT.t[`${bucketOf(T)}|${latticeOf(T)}`]; if (!grp || !isFinite(L) || Number.isInteger(L)) return null;   // half-point lines only (no pushes); the books total's whole / half lattice picks the history
  const s = L - T;
  return lowest(grp, side === "over" ? (d) => d > s : (d) => d < s);
}
