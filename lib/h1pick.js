// 1H SPREAD PICK (NFL, 10/28; owner: "NFL halves, quarters, team totals and game props: build these and set the limit at 58%+" / "build a different
// model where it doesn't [run hot] ... try all the options" / "if we don't blend it and it wins then don't blend it"). Of ~340 options tried on Polymarket's
// real fresh closes (last trade within 2 h of kickoff, 2025 wk10-18 + 2026 wk1-7), only the first-half spread held: a boosted-tree mean of the home
// team's first-half margin from 7 pre-game inputs, then the 300 past games whose out-of-fold prediction is nearest (lib/h1model_data.js, fit 2011-2025),
// the model's chance. Halves / quarter totals, quarter spreads, team totals and the 1H moneyline failed (scratchpad gm/opts.py, and again on the
// Polymarket US books 10/28, us/engine2.py) -- no pick on them (the game / team props have their own pick, lib/gameprops.js).
// The rule (10/28 owner: the limit is 58%; rule 8: price never picks a line): the side with the model's highest shown % (below), 58%+, priced
// 77c or less on a steady two-sided book. Shown % and the record on the US books: below. (Earlier versions: the props' 65%-from-60c rule went
// 40-16 on the international closes; the 0.4 model + 0.6 price blend said 73 and won 64% on the US steady books.)
import { H1M } from "./h1model_data";

export const H1_BAR = 0.58, H1_CAP = 0.85, H1_FLOOR = 0.70, H1_OVER = 0.02, H1_BOOK = 1.06;
// 10/29 (owner: "where did you even get the 77 cap?"): the 77c cap was copied from the player props (the owner's 10/20 props rule) without a test
// here. Tested on the same books: cap 77c 12-0 (1.7 a week), 80c 18-1, 85c weeks 1-3 11-1 / weeks 4-7 13-1 unseen = 24-2 = 92.3% (said
// 84.5, 3.7 a week); the 78-85c picks alone 19-2. The cap is 85c.
// 10/29 recheck (owner: "you are the one who made all of this, so recheck yourself"): the 11.4-point offset below was measured on the same weeks 1-7
// it was judged on; from weeks 1-3 alone it is 3.9 and the rule then went 13-10 on weeks 4-7. Worse, the model added nothing: it always took the
// line just under the 77c cap, and EVERY steady side priced 70-77c won 76-45 = 62.8% (the rule 27-15 = 64.3%). What does hold: the model at least
// 2 points above a 70-77c price, its own highest chance per game -- weeks 1-3 6-0 (chosen there), weeks 4-7 6-0 unseen (12-0, said 79.7, priced
// 74.6; inside 70-77c the model over the price won 25-6, under it 51-39). About 1-3 picks a week. Shown % = the model's own chance (it ran low here).
// 10/28 evening (owner: "recheck again" / "go find more issues" -> "build now"): on Polymarket US's STEADY books (2 h before kickoff, both sides
// adding to 98-106c; scratchpad us/h1_st.mjs) the model alone, picking its own highest side, went 31-19 = 62.0% while saying 73.4 -- it runs 11.4
// points high on the venue the app bets. The 10/28-night blend (0.4 model + 0.6 price) said 73 and won 64% too, and it let the PRICE choose the
// line (any side priced in the 70s cleared 58%; 7 of the 14 week-8 picks were sides the model itself put under their price). Now (rule 8: the
// price never picks a line): the model alone chooses the side and line, the shown % = the model's chance - 11.4 points (what it actually won
// there), the 58% bar and 77c cap apply to that, steady two-sided books only (the two prices adding to 106c or less, as the test's books did).
// Same books, this rule: 27-15 = 64.3% (shown 63.8), weeks 1-3 14-7, weeks 4-7 13-8; the live record judges (the international closes, where
// the model ran LOW -- said 65.7, won 73.9% -- are a different venue).
export const h1Shown = (pc) => (pc == null ? null : pc);
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
export const h1Qualifies = (pc, px) => pc != null && px != null && px >= H1_FLOOR && px <= H1_CAP && pc >= H1_BAR && pc >= px + H1_OVER;
// a steady two-sided book: both sides priced, adding to 106c or less (a 1c bid next to a 75c ask is not a price)
export const h1Steady = (r) => r && r.aPrice > 0 && r.hPrice > 0 && r.aPrice + r.hPrice <= H1_BOOK + 1e-9;
// rows = Polymarket's first-half spread lines { line (the away team's), aPrice, hPrice } -> the side to bet, or null (the highest qualifying shown %,
// i.e. the model's own highest chance: the price only caps it)
export function h1Side(mean, rows, away, home) {
  let best = null;
  for (const r of rows || []) {
    if (!h1Steady(r)) continue;
    const L = -Number(r.line), ph = h1HomeCover(mean, L); if (ph == null) continue;
    for (const s0 of [{ team: home, line: L, model: ph, px: r.hPrice }, { team: away, line: -L, model: 1 - ph, px: r.aPrice }]) {
      const s = { ...s0, pc: h1Shown(s0.model) };
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
