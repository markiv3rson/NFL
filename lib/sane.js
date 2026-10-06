// Line sanity (added 10/5). On 10/4 two Week 4 spread picks were saved with absurd lines ("MIN +19.5", "SEA +20.5" when the real lines
// were MIN -10 and SEA -7): Polymarket lists many alternate spread lines, and the old rule "pick the market whose price is closest to
// 50/50" chose an unpriced alternate sitting at a placeholder 50%. Those bogus lines were then graded as wins and skewed the records
// and the closing-line numbers. Guards: (1) poly.js only accepts a spread line that fits the game's moneyline; (2) a stored line that
// is far from the sportsbook closing line in the schedule file (nflverse) is dropped here, at ingestion, and when grading.
export const LINE_TOL = 6;   // points; real Polymarket vs sportsbook gaps are 1-2, late news can reach ~4
// homeSpread uses the app's sign (negative = home favored); nflverse spread_line is the reverse (positive = home favored).
export const spreadOk = (homeSpread, nvSpread) => homeSpread == null || nvSpread == null || !isFinite(nvSpread) || Math.abs(homeSpread + nvSpread) <= LINE_TOL;
export const totalOk = (line, nvTotal) => line == null || nvTotal == null || !isFinite(nvTotal) || Math.abs(line - nvTotal) <= LINE_TOL;
// Returns a copy of poly without a spread/total that disagrees with the schedule file's closing line, and which parts were dropped.
export function sanePoly(poly, nvSpread, nvTotal) {
  if (!poly) return { poly, dropped: [] };
  const out = { ...poly }, dropped = [];
  if (out.spread && !spreadOk(out.spread.homeSpread, nvSpread)) { delete out.spread; dropped.push(`spread ${poly.spread.homeSpread} vs sportsbook ${-nvSpread}`); }
  if (out.total && !totalOk(out.total.line, nvTotal)) { delete out.total; dropped.push(`total ${poly.total.line} vs sportsbook ${nvTotal}`); }
  return { poly: out, dropped };
}
// The home spread a pick label like "MIN +19.5" / "IND -4.5" stands for, given the game's home team.
export function pickHomeSpread(label, home) {
  const m = String(label || "").match(/^(\S+) ([+-]?\d+(?:\.\d+)?)$/); if (!m) return null;
  return m[1] === home ? Number(m[2]) : -Number(m[2]);
}

// Moneyline sanity (10/5). On 10/4 two moneyline picks were saved at 95% for the road underdog (MIA at MIN, LAC at SEA) from the same corrupt
// Polymarket read as the bogus alternate spreads, and graded as losses at "95%". The pick's win chance must roughly fit what the sportsbook
// closing spread (nflverse, home-favored positive) implies; a pick more than ML_TOL percentage points away is dropped.
export const ML_TOL = 25;
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
export const homeWinFromSpread = (nvSpread) => 50 * (1 + erf(nvSpread / 13.5 / Math.SQRT2));
export function mlOk(label, pct, home, nvSpread) {
  if (pct == null || nvSpread == null || !isFinite(nvSpread)) return true;
  const pickHome = String(label || "").startsWith(home + " "), hw = homeWinFromSpread(nvSpread);
  return Math.abs(pct - (pickHome ? hw : 100 - hw)) <= ML_TOL;
}
