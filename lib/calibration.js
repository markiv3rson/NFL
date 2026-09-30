// TD calibration: learns from graded results whether the model's stated chance matches reality
// (e.g. "40-50%" players actually scoring 38% of the time) and corrects future numbers to match.
const BUCKETS = [[5, 15], [15, 25], [25, 35], [35, 45], [45, 60], [60, 101]];
// Each bucket's correction is SHRUNK toward "no change": the graded players count against K=150 imaginary players who
// scored exactly as predicted. One noisy week can't swing the numbers (before 9/28: 23 players scoring 22% vs a 39%
// forecast cut every 35-45% player by 30%, the floor, and a 35% player then showed LOWER than a 34.9% player).
// Corrections are interpolated between bucket centers, so a player's number never jumps at a bucket edge.
const K_PRIOR = 150;
export function buildCalibration(records) {
  const tdAll = records.flatMap((r) => r.td || []).filter((p) => p.played !== false);   // inactive players aren't model misses
  const table = BUCKETS.map(([lo, hi]) => {
    const xs = tdAll.filter((p) => p.fair >= lo && p.fair < hi);
    const c = hi > 100 ? 70 : (lo + hi) / 2;
    if (xs.length < 20) return { lo, hi, c, mult: 1, n: xs.length };  // too few graded players yet — leave uncorrected
    const hits = xs.filter((p) => p.scored).length;
    const mid = xs.reduce((a, p) => a + p.fair, 0) / xs.length;
    const shrunk = (hits + K_PRIOR * mid / 100) / (xs.length + K_PRIOR) * 100;
    return { lo, hi, c: mid, mult: Math.max(0.85, Math.min(1.15, shrunk / mid)), n: xs.length };
  });
  return { t: new Date().toISOString(), v: 2, table };
}
export function applyCalibration(fair, calib) {
  if (fair == null || !calib || !calib.table || !calib.table.length) return fair;
  const t = calib.table;
  if (calib.v !== 2) return fair;   // tables built by the old unshrunk method are ignored until rebuilt at the next grading
  let mult;
  if (fair <= t[0].c) mult = t[0].mult;
  else if (fair >= t[t.length - 1].c) mult = t[t.length - 1].mult;
  else for (let i = 0; i < t.length - 1; i++) if (fair >= t[i].c && fair <= t[i + 1].c) {
    const f = (fair - t[i].c) / (t[i + 1].c - t[i].c || 1); mult = t[i].mult + f * (t[i + 1].mult - t[i].mult); break;
  }
  return Math.max(1, Math.min(97, fair * (mult ?? 1)));
}
// Mirrors td_prob.py's two_plus(): recomputed here so the 2+ TDs number stays consistent after live
// calibration adjusts a player's main chance (otherwise "two" would silently drift out of sync with "fair").
export function twoPlus(fairPct) {
  if (fairPct == null) return null;
  const p = Math.min(Math.max(fairPct / 100, 0), 0.95), lam = -Math.log(1 - p);
  return Math.min(60, 1.035 * (1 - Math.exp(-lam) * (1 + lam)) * 100);   // same factor as td_prob.two_plus (9/30)
}
const FIRST_OTHER = 0.4;
// Mirrors td_prob.py's first_td(): a joint, whole-game computation (every listed player's share of the
// game's total expected TDs), so it has to be redone here too once any player's fair% is recalibrated —
// recomputing just one player's "first" number in isolation would be wrong.
export function firstTdShares(players) {
  const lams = players.map((p) => (p.fair == null ? 0 : -Math.log(1 - Math.min(Math.max(p.fair / 100, 0), 0.95))));
  const T = lams.reduce((a, b) => a + b, 0) + FIRST_OTHER;
  const totalP = 1 - Math.exp(-T);
  return lams.map((lam) => (lam / T) * totalP * 100);
}
