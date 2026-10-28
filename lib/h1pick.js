// 1H SPREAD PICK (NFL, 10/28; owner: "NFL halves, quarters, team totals and game props: build these and set the limit at 58%+" / "build a different
// model where it doesn't [run hot] ... try all the options" / "if we don't blend it and it wins then don't blend it"). Of ~340 options tried on Polymarket's
// real fresh closes (last trade within 2 h of kickoff, 2025 wk10-18 + 2026 wk1-7), only the first-half spread held: a boosted-tree mean of the home
// team's first-half margin from 7 pre-game inputs, then the 300 past games whose out-of-fold prediction is nearest (lib/h1model_data.js, fit 2011-2025),
// the model alone (blending with the price did no better). Under the props rules at the owner's 58% limit (58%+ under 60c, 65%+ from 60c, 77c cap,
// priced under its chance, one per game): 40-16 = 71.4% (said 66.2, avg price 60c); 2025 wk10-18 11-4, 2026 wk1-3 10-4, wk4-7 19-8; results drawn at
// the market's own prices reach it 3.5% of the time, the chances shuffled 0.0%. Halves / quarter totals, quarter spreads, team totals, the 1H moneyline
// and every game prop failed (scratchpad gm/opts.py) -- no pick on them.
import { H1M } from "./h1model_data";

export const H1_BAR = 0.58, H1_BAR_HI = 0.65, H1_HI_PRICE = 0.6, H1_CAP = 0.77;
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
export const h1Qualifies = (pc, px) => pc != null && px != null && px <= H1_CAP && px < pc && pc >= (px < H1_HI_PRICE ? H1_BAR : H1_BAR_HI);
// rows = Polymarket's first-half spread lines { line (the away team's), aPrice, hPrice } -> the side to bet, or null (the highest qualifying chance)
export function h1Side(mean, rows, away, home) {
  let best = null;
  for (const r of rows || []) {
    const L = -Number(r.line), ph = h1HomeCover(mean, L); if (ph == null) continue;
    for (const s of [{ team: home, line: L, pc: ph, px: r.hPrice }, { team: away, line: -L, pc: 1 - ph, px: r.aPrice }])
      if (h1Qualifies(s.pc, s.px) && (!best || s.pc > best.pc)) best = s;
  }
  return best && { ...best, pc: Math.round(best.pc * 1000) / 1000, label: `${best.team} ${best.line > 0 ? "+" : ""}${best.line} 1H` };
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
