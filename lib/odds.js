// Odds math, same formulas as the protocol (2.1–2.6).
export const toProb = (american) => (american > 0 ? 100 / (american + 100) : -american / (-american + 100));
export function toAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return Math.round(p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p);
}
export function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
export function ninv(p) { // inverse normal (Acklam)
  p = Math.min(1 - 1e-9, Math.max(1e-9, p));   // a stored 0% / 100% would otherwise give ±Infinity and NaN picks
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
// SD_TOTAL was 10; the real spread of totals error measured over 2006-2025 is ~13.3, so the old value made Over/Under leans look more certain than they are.
export const SD_MARGIN = 13, SD_TOTAL = 13.3;
// Quarter Kelly on a $1,000 bankroll, $50 single-bet cap (protocol 2.6).
export function kellyStake(fair, price, { bankroll = 1000, frac = 0.25, cap = 50 } = {}) {
  if (!(fair > 0 && price > 0 && price < 1)) return 0;
  const b = 1 / price - 1, f = (b * fair - (1 - fair)) / b;
  return f <= 0 ? 0 : Math.min(cap, Math.round(f * frac * bankroll));
}
// Thin market: nobody bidding close to the ask. Gap allowed = 5¢, or 40% of the ask for cheap long shots
// (a 7¢ ask with a 1¢ bid is not a market). Checked on Week 3: with a flat 10¢ rule, 7–11¢ long shots with 1¢ bids
// slipped through and faked a +99% "edge"; on real markets the model was about break-even.
export const isThinMarket = (ask, bid) => !(ask > 0) || bid == null || !(bid > 0) || ask - bid > Math.min(0.05, 0.4 * ask);

// Key numbers (added 9/30). NFL margins pile up on 3, 7, 10 (and rarely land on 0), so moving a spread chance from one
// line to another with a smooth normal curve misprices moves across those numbers (-2.5 -> -3.5 is worth far more than
// -4.5 -> -5.5). KEY_W[k+30] = how often a final home margin of k happens vs what the normal curve says (2006-25, 5,247
// games, smoothed). Tested 2016-25 on alternate lines +-0.5..3 pts: better in 8 of 10 seasons (log loss 0.6822 -> 0.6811),
// most where the move crosses 3 or 7.
const KEY_W = [0.939,0.946,1.786,1.093,0.715,1.046,1.726,0.953,0.687,1.398,0.966,0.568,0.970,1.242,0.832,0.547,1.511,0.732,0.400,0.584,1.092,0.336,0.800,1.853,1.231,0.762,1.043,2.484,0.773,0.754,0.127,0.779,0.823,2.792,0.863,0.690,1.244,1.753,0.885,0.422,1.326,0.502,0.500,0.620,1.336,0.497,0.664,1.164,0.880,0.487,1.040,1.341,0.641,0.702,1.443,0.807,0.892,1.097,1.725,0.829,0.666];
function marginDist(mu) {
  const out = []; let tot = 0;
  for (let k = -70; k <= 70; k++) {
    const w = Math.abs(k) <= 30 ? KEY_W[k + 30] : 1, p = (ncdf((k + 0.5 - mu) / SD_MARGIN) - ncdf((k - 0.5 - mu) / SD_MARGIN)) * w;
    out.push(p); tot += p;
  }
  return out.map((p) => p / tot);
}
// P(home covers homeSpread), pushes excluded, from a margin distribution.
function coverFromDist(d, homeSpread) {
  let win = 0, push = 0;
  for (let k = -70; k <= 70; k++) { const x = k + homeSpread; if (x > 0) win += d[k + 70]; else if (x === 0) push += d[k + 70]; }
  return push < 1 ? win / (1 - push) : 0.5;
}
// Move a home-cover chance known at one line (fromHS, home spread) to another line (toHS), key numbers included.
// Same anchor as before (the chance at fromHS is kept exactly); only the SHAPE of the move changes.
export function shiftCover(pHome, fromHS, toHS) {
  if (fromHS === toHS) return pHome;
  const mu = -fromHS - SD_MARGIN * ninv(1 - pHome), d = marginDist(mu);
  return Math.min(0.99, Math.max(0.01, coverFromDist(d, toHS) + (pHome - coverFromDist(d, fromHS))));
}
