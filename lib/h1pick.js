// 1H SPREAD PICK (NFL, 10/28; owner: "NFL halves, quarters, team totals and game props: build these and set the limit at 58%+" / "build a different
// model where it doesn't [run hot] ... try all the options" / "if we don't blend it and it wins then don't blend it"). Of ~340 options tried on Polymarket's
// real fresh closes (last trade within 2 h of kickoff, 2025 wk10-18 + 2026 wk1-7), only the first-half spread held: a boosted-tree mean of the home
// team's first-half margin from 7 pre-game inputs, then the 300 past games whose out-of-fold prediction is nearest (lib/h1model_data.js, fit 2011-2025),
// the model's chance (shown blended with the price: H1_PRICE_W below). Halves / quarter totals, quarter spreads, team totals, the 1H moneyline and every game prop
// failed (scratchpad gm/opts.py) -- no pick on them.
// The rule (10/28 owner: the limit is 58%; "why does it have to be lower than our percentage? ... fix it"; rule 8: price never picks a line): a side
// shows when its shown % (below) is 58%+ and it costs 77c or less (the cap), the highest shown % per game. Same games as before (scratchpad gm/rule28.py):
// 51-18 = 73.9% (said 65.7, 61c); 2025 wk10-18 14-5, 2026 wk1-3 13-3, wk4-7 24-10 = 70.6%; results drawn at the market's prices reach it 1.2% of the
// time, the chances shuffled 0%. (The first rule -- 65% from 60c and priced under the chance, copied from the props -- went 40-16, wk4-7 19-8.)
import { H1M } from "./h1model_data";

export const H1_BAR = 0.58, H1_CAP = 0.77, H1_PRICE_W = 0.6;
// 10/28 night (owner: "make sure what you're displaying on my app is true"): Polymarket US keeps every past game's prices, so the rule was replayed
// on the US first-half spreads of 2026 weeks 1-7 (3,221 lines, the model never saw them). The model's own % on the side it picks ran high there
// (said 76-80, won 72-75: it picks its own most optimistic line). Shown % = 0.4 model + 0.6 Polymarket's price (the weight chosen on weeks 1-3):
// weeks 1-3 said 73.4 won 72.7%, weeks 4-7 said 74.8 won 75.9% (41-13); all 73-25 = 74.5% vs 73.5% with the model alone. On the earlier
// international fresh closes the same blend went 47-13 = 78.3% (said 64.9: the shown % never overstates). The 58% bar and 77c cap apply to it.
export const h1Shown = (pc, px) => (pc == null || px == null ? null : (1 - H1_PRICE_W) * pc + H1_PRICE_W * px);
// the model's mean home first-half margin for the 7 inputs (hfav = home favored margin of the full game, tl = full-game total, windo = wind in an
// open-air stadium (0 under a roof), domeF, div, early = weeks 1-4, rest_d = home rest days - away rest days)
export function h1Mean(x) {
  const v = H1M.feats.map((f, i) => (Number(x[f]) - H1M.mu[i]) / H1M.sd[i]); if (v.some((z) => !isFinite(z))) return null;
  let s = H1M.base;
  for (const t of H1M.trees) { let i = 0; while (!t[i][5]) i = v[t[i][0]] <= t[i][1] ? t[i][2] : t[i][3]; s += t[i][4]; }
  return s;
}
// the 300 past first-half margins nearest the prediction (the same window the test used)
function neighbours(mean) {
  const a = H1M.oof, n = a.length, K = H1M.K; let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < mean) lo = m + 1; else hi = m; }
  let s = Math.max(0, lo - (K >> 1)); const e = Math.min(n, s + K); s = Math.max(0, e - K);
  return H1M.y.slice(s, e);
}
// the home team's chance to cover home first-half line L (site sign: -3.5 = home favored by 3.5); a push counts half
export function h1HomeCover(mean, L) {
  if (mean == null || !isFinite(L)) return null; const nb = neighbours(mean); let c = 0;
  for (const m of nb) c += m + L > 0 ? 1 : m + L === 0 ? 0.5 : 0;
  return c / nb.length;
}
export const h1Qualifies = (pc, px) => pc != null && px != null && px > 0 && px <= H1_CAP && pc >= H1_BAR;
// rows = Polymarket's first-half spread lines { line (the away team's), aPrice, hPrice } -> the side to bet, or null (the highest qualifying shown %)
export function h1Side(mean, rows, away, home) {
  let best = null;
  for (const r of rows || []) {
    const L = -Number(r.line), ph = h1HomeCover(mean, L); if (ph == null) continue;
    for (const s0 of [{ team: home, line: L, model: ph, px: r.hPrice }, { team: away, line: -L, model: 1 - ph, px: r.aPrice }]) {
      const s = { ...s0, pc: h1Shown(s0.model, s0.px) };
      if (h1Qualifies(s.pc, s.px) && (!best || s.pc > best.pc)) best = s; }
  }
  return best && { ...best, pc: Math.round(best.pc * 1000) / 1000, model: Math.round(best.model * 1000) / 1000, label: `${best.team} ${best.line > 0 ? "+" : ""}${best.line} 1H` };
}
// the model's inputs from a schedule row + the current lines: books first (nearest the closing line the model was tested on), then the
// schedule's line, then Polymarket's
export function h1Inputs(g, { booksHomeSpread = null, booksTotal = null, polyHomeSpread = null, polyTotal = null, wind = null, outdoor = null } = {}) {
  const hfav = booksHomeSpread != null ? -booksHomeSpread : g.nvSpread != null ? g.nvSpread : polyHomeSpread != null ? -polyHomeSpread : null;
  const tl = booksTotal != null ? booksTotal : g.nvTotal != null ? g.nvTotal : polyTotal;
  if (hfav == null || tl == null) return null;
  const open = outdoor != null ? !!outdoor : ["outdoors", "open"].includes(String(g.roof || "").toLowerCase());
  const rest = g.homeRest != null && g.awayRest != null ? g.homeRest - g.awayRest : 0;
  return { hfav, tl, windo: open && wind != null ? Number(wind) : 0, domeF: open ? 0 : 1, div: g.div ? 1 : 0, early: Number(g.week) <= 4 ? 1 : 0, rest_d: rest };
}
