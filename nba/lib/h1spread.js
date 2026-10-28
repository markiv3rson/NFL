// 1H SPREAD (shadow only, 10/28; owner: "research the halves / quarters / team totals with the same rules as our props ... build it"). The first-half
// margin from the full-game line (h1spread_data.js) against Polymarket US's first-half spread lines, under the props rules: a side counts when its
// chance is 56%+ (priced under 60c) or 65%+ (from 60c), it is priced 77c or less and under its chance; one per game, the highest chance.
// Test on Polymarket's real 2025-26 closes (last trade within 2 h of tip-off, 995 first-half spread lines, the history model fit on 2021-22..2024-25):
// 72-48 = 60.0% (said 58.1, price 53c), Oct-Jan 60.0% / Jan-Apr 60.0%; the model's chances shuffled reach it 0.6% of the time, results drawn at the
// market's own prices 6%; lines 1.5+ only 69-46 = 60.0% (59.1 / 61.2). Fragile: the same test with the neighbours' raw first-half margins (no smooth shift)
// reads 55.7% of 174 -- one more reason it is a shadow, not a pick. The first-half totals / moneyline and every NFL half / quarter / team-total market failed the same test. Recorded at every
// snapshot until tip-off (the last look counts; a side that stops qualifying is taken out), graded on ESPN's first-half score; never a pick until it
// holds 56%+ over ~100 games live.
import { H1 } from "./h1spread_data";
import { getRedis } from "./redis";
import { usEvent } from "../../lib/polyus";
import { eventSlug, parseGameMarkets } from "../../lib/gamemarkets";

const near = (arr, v) => { let b = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[b] - v)) b = i; return b; };
// the home team's chance to cover home first-half line l (e.g. -3.5), given the full-game home spread (site sign: -6.5 = home favored by 6.5)
export function h1HomeCover(homeSpread, l) {
  const hs = Number(homeSpread), L = Number(l); if (!isFinite(hs) || !isFinite(L)) return null;
  const hf = -hs; if (Math.abs(hf) > 16.5 || Math.abs(L) > 12.5 || Math.abs(L) < 1.5 || Math.round(L * 2) % 2 === 0) return null;   // half-point lines 1.5+ only, inside the table (the smooth spread under-counts first-half ties, so -0.5 / +0.5 are left out)
  const row = H1.p[near(H1.hfav, hf)], j = near(H1.lines, L);
  return Math.abs(H1.lines[j] - L) < 0.01 ? row[j] : null;
}
export const qualifies = (pc, px) => pc != null && px != null && px <= 0.77 && px < pc && pc >= (px < 0.6 ? 0.56 : 0.65);
// rows = Polymarket's first-half spread rows { line (the away team's), aPrice, hPrice } -> the side to record, or null
export function h1Side(homeSpread, rows, away, home) {
  let best = null;
  for (const r of rows || []) {
    const ph = h1HomeCover(homeSpread, -Number(r.line)); if (ph == null) continue;
    for (const s of [{ team: home, line: -Number(r.line), pc: ph, px: r.hPrice }, { team: away, line: Number(r.line), pc: 1 - ph, px: r.aPrice }])
      if (qualifies(s.pc, s.px) && (!best || s.pc > best.pc)) best = s;
  }
  return best && { ...best, pc: Math.round(best.pc * 1000) / 1000 };
}
const LM_IDS = "lm:ids", key = (date, game) => `lm:${date}:${game}:h1spr-spread`;
export async function recordH1Shadows(games, now = Date.now(), getEvent = usEvent, budgetMs = 25e3) {
  const r = getRedis(), t0 = Date.now(); let n = 0;
  const todo = (games || []).filter((g) => now < Date.parse(g.start) && Date.parse(g.start) - now < 30 * 3600e3 && g.poly && g.poly.spread && g.poly.spread.homeSpread != null);
  for (let i = 0; i < todo.length; i += 4) {
    if (Date.now() - t0 > budgetMs) break;
    await Promise.all(todo.slice(i, i + 4).map(async (g) => {
      const [away, home] = g.key.split(" @ "), k = key(g.date, g.key);
      let ev; try { ev = await getEvent(eventSlug("nba", away, home, g.start)); } catch { return; }
      if (!ev) return;
      const gm = parseGameMarkets(ev, "nba", away, home), P = gm.periods["1h"], s = h1Side(g.poly.spread.homeSpread, P && (P.spreadAll || P.spread), away, home);   // 10/28: every priced first-half line, not the 5 the page shows
      { const pk = `gmpx:${g.date}:${g.key}`, o = await r.get(pk).catch(() => null), ft = o ? (JSON.parse(o).first || null) : null, t = new Date(now).toISOString();   // 10/28: every other game market's prices, first + latest
        await r.set(pk, JSON.stringify({ first: ft || { t, gm }, last: { t, gm } }), "EX", 120 * 86400).catch(() => 0); }
      const old = await r.get(k).catch(() => null);
      if (!s) { if (old) { await r.del(k).catch(() => 0); await r.srem(LM_IDS, k).catch(() => 0); } return; }
      const first = old ? (JSON.parse(old).first || null) : { line: s.line, px: s.px, t: new Date(now).toISOString() };
      const row = { kind: "h1spr", market: "spread", half: 1, team: s.team, line: s.line, price: s.px, said: s.pc, fullLine: g.poly.spread.homeSpread,
        label: `${s.team} ${s.line > 0 ? "+" : ""}${s.line} 1H`, date: g.date, game: g.key, start: g.start, t: new Date(now).toISOString(), first };
      await r.set(k, JSON.stringify(row)).catch(() => 0); await r.sadd(LM_IDS, k).catch(() => 0); n++;
    }));
  }
  return n;
}
