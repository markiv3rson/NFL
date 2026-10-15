// Win rate of ANY half-point line (10/15, owner: "build now"). Counts from the nflverse games file (lib/linetable_data.js, built by
// tests/linetable_build.mjs): for a books number, how often a team wins at a line. Three groups are checked and the LOWEST counts
// (owner: show the honest rate): closing line 1999-2025, opening line 2014-2025, and the closing line of the recent years 2020-2025.
// A line wins nothing it can push on: only half-point lines are priced (Polymarket lists half points).
import { LT } from "./linetable_data";

export const MAX_BUY = 3.5;                          // no pick ever buys more than 3.5 points (owner)
const MIN_N = { c: 40, o: 60, r: 40 };               // fewest games a group needs before it counts
export const bucketOf = (T) => (T >= 48 ? "48+" : T >= 42 ? "42-47" : "<=41");
export const latticeOf = (T) => (Number.isInteger(T) ? "i" : "h");

const sumHist = (a, b) => { const m = new Map(); for (const [v, n] of [...(a || []), ...(b || [])]) m.set(v, (m.get(v) || 0) + n); return [...m]; };
const count = (hist, wins) => { let w = 0, n = 0; for (const [v, c] of hist || []) { n += c; if (wins(v)) w += c; } return { w, n }; };
// the group's day/night games when there are enough, else all of its games
function pick(grp, night, min, wins) {
  if (!grp) return null;
  const own = count(grp[night ? "n" : "d"], wins); if (own.n >= min) return own;
  const all = count(sumHist(grp.d, grp.n), wins); return all.n >= min ? all : null;
}
function lowest(groups, night, wins) {
  const parts = {}; let rate = null, n = 0;
  for (const g of ["c", "o", "r"]) {
    const x = pick(groups && groups[g], night, MIN_N[g], wins); if (!x) continue;
    parts[g] = { rate: (100 * x.w) / x.n, n: x.n };
    if (rate == null || parts[g].rate < rate) rate = parts[g].rate;
  }
  return parts.c ? { rate, n: parts.c.n, parts } : null;   // the closing-line group must exist
}
// A = books spread number (|spread|); fav = this team is the books' favorite; L = the team's own line (-2.5 gives 2.5, +3.5 gets 3.5)
export function spreadRate(A, fav, L, night) {
  const grp = LT.s[A]; if (!grp || !isFinite(L) || Number.isInteger(L)) return null;
  return lowest(grp, !!night, fav ? (x) => x + L > 0 : (x) => -x + L > 0);
}
// T = books total; side over / under; L = the total line bought
export function totalRate(T, side, L, night) {
  const grp = LT.t[`${bucketOf(T)}|${latticeOf(T)}`]; if (!grp || !isFinite(L) || Number.isInteger(L)) return null;   // half-point lines only (no pushes); the books total's whole / half lattice picks the history
  const s = L - T;
  return lowest(grp, !!night, side === "over" ? (d) => d > s : (d) => d < s);
}
