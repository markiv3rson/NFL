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
