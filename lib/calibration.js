// TD calibration: learns from graded results whether the model's stated chance matches reality
// (e.g. "40-50%" players actually scoring 38% of the time) and corrects future numbers to match.
const BUCKETS = [[5, 15], [15, 25], [25, 35], [35, 45], [45, 60], [60, 101]];
export function buildCalibration(records) {
  const tdAll = records.flatMap((r) => r.td || []);
  const table = BUCKETS.map(([lo, hi]) => {
    const xs = tdAll.filter((p) => p.fair >= lo && p.fair < hi);
    if (xs.length < 20) return { lo, hi, mult: 1 };            // too few graded players yet — leave uncorrected
    const rate = xs.filter((p) => p.scored).length / xs.length * 100;
    const mid = xs.reduce((a, p) => a + p.fair, 0) / xs.length;
    return { lo, hi, mult: Math.max(0.7, Math.min(1.3, rate / mid)), n: xs.length };
  });
  return { t: new Date().toISOString(), table };
}
export function applyCalibration(fair, calib) {
  if (fair == null || !calib || !calib.table) return fair;
  const b = calib.table.find((x) => fair >= x.lo && fair < x.hi);
  return b ? Math.max(1, Math.min(97, fair * b.mult)) : fair;
}
// Mirrors td_prob.py's two_plus(): recomputed here so the 2+ TDs number stays consistent after live
// calibration adjusts a player's main chance (otherwise "two" would silently drift out of sync with "fair").
export function twoPlus(fairPct) {
  if (fairPct == null) return null;
  const p = Math.min(Math.max(fairPct / 100, 0), 0.95), lam = -Math.log(1 - p);
  return Math.min(60, 1.09 * (1 - Math.exp(-lam) * (1 + lam)) * 100);
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
