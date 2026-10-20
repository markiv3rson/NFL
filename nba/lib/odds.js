// Odds math shared by the page and the picks. NBA numbers: the measured spread of the model's margin error is 12.7 points
// and of its total error 18.5 (railway-model-service/data/model_coefs.json), the market's own is 12.4 / 17.9.
export const toProb = (american) => (american > 0 ? 100 / (american + 100) : -american / (-american + 100));
export function toAmerican(p) {
  p = Math.min(Math.max(p, 0.001), 0.999);
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}
export function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
export function ninv(p) { // inverse normal (Acklam)
  p = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export const SD_MARGIN = 12.7, SD_TOTAL = 18.5;
// A market is "thin" when nobody is really quoting it (wide gap between what you can buy and sell at).
export const isThinMarket = (ask, bid) => !(ask > 0) || bid == null || !(bid > 0) || ask - bid > Math.min(0.05, 0.4 * ask);
export const sgn = (n) => (n > 0 ? "+" : "") + n;
