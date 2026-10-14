import { isThinMarket, ninv } from "./odds";
// Polymarket (public Gamma API): game lines + anytime-TD props.
import { TEAMS } from "./games";
const GAMMA = process.env.GAMMA_BASE || "https://gamma-api.polymarket.com";
async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.json();
}
const arr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || "[]"); } catch { return []; } };
const isPeriod = (q) => /\b(1H|2H|1st|2nd|first|second|half|quarter|Q[1-4])\b/i.test(q || "");
const abbrOf = (label, away, home) => {
  const l = (label || "").toLowerCase();
  if (l.includes(TEAMS[away].toLowerCase()) || l === away.toLowerCase()) return away;
  if (l.includes(TEAMS[home].toLowerCase()) || l === home.toLowerCase()) return home;
  return null;
};

// What you actually PAY to buy each outcome (the app's Buy button), not the midpoint.
// outcome[0] = bestAsk; outcome[1] = 1 - bestBid. Falls back to outcomePrices if the book fields are missing.
export function buyPrices(m) {
  const mid = arr(m.outcomePrices).map(Number);
  const ask = Number(m.bestAsk), bid = Number(m.bestBid);
  const p0 = ask > 0 && ask < 1 ? ask : mid[0];
  const p1 = bid > 0 && bid < 1 ? 1 - bid : mid[1];
  const spread = ask > 0 && bid >= 0 && ask > bid ? ask - bid : Number(m.spread) || null;
  return { buy: [p0, p1], mid, spread };
}
// Prices are probabilities 0–1 (buy price). Main line = the one whose midpoint is closest to 50/50.
export function parseGame(markets, away, home) {
  const out = {};
  const ml = [], spreads = [], totals = [];
  for (const m of markets) {
    const type = (m.sportsMarketType || "").toLowerCase();
    if (isPeriod(m.question) || m.closed) continue;
    const outcomes = arr(m.outcomes), bp = buyPrices(m), prices = bp.buy, mid = bp.mid;
    if (outcomes.length !== 2 || prices.length !== 2 || prices.some(isNaN) || mid.some(isNaN)) continue;
    if (type === "moneyline") ml.push({ outcomes, prices });
    else if (type === "spreads") spreads.push({ m, outcomes, prices, mid });
    else if (type === "totals") totals.push({ m, outcomes, prices, mid });
  }
  if (ml.length) {
    const { outcomes, prices } = ml[0], o = {};
    outcomes.forEach((lab, i) => { const t = abbrOf(lab, away, home); if (t) o[t] = prices[i]; });
    if (o[away] != null && o[home] != null) out.ml = { away: o[away], home: o[home] };
  }
  let best = null;
  // Polymarket lists many alternate spread lines. The main line is the one near 50/50 AND consistent with the moneyline: a line more
  // than 4.5 points from what the moneyline implies is an alternate (unpriced alternates sit at a placeholder 50% and used to win).
  // Markets with a real two-sided book are preferred when any exist.
  const implied = out.ml ? -13.5 * ninv(out.ml.home / (out.ml.home + out.ml.away)) : null;   // home spread the moneyline implies (negative = home favored)
  const liveBook = (m) => Number(m.bestBid) > 0 && Number(m.bestAsk) > 0;
  const useLive = spreads.some((s) => liveBook(s.m));
  for (const s of spreads) {
    if (useLive && !liveBook(s.m)) continue;
    const q = (s.m.question || "").match(/:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/);
    const team = q ? abbrOf(q[1], away, home) : abbrOf(s.outcomes[0], away, home);
    const line = q ? parseFloat(q[2]) : Number(s.m.line);
    if (!team || isNaN(line)) continue;
    const i = s.outcomes.findIndex((lab) => abbrOf(lab, away, home) === team);
    if (i < 0) continue;
    const price = s.prices[i], other = s.prices[1 - i], midp = s.mid[i];
    if (implied != null && Math.abs((team === home ? line : -line) - implied) > 4.5) continue;   // an alternate line, not the game's spread
    // 10/14 fix: in a near pick'em Polymarket lists BOTH teams at -1.5 at ~48% (NO @ NYG: Giants -1.5 48%, Saints -1.5 47.5%). Picking the
    // one a hair closer to 50% made the moneyline's underdog the favorite. When two lines are about equally close to 50/50 (within 1.5c),
    // take the one nearer the spread the moneyline implies.
    const hl = team === home ? line : -line, dm = Math.abs(midp - 0.5), bm = best ? Math.abs(best.midp - 0.5) : null;
    const closer = best && implied != null && Math.abs(dm - bm) < 0.015 ? Math.abs(hl - implied) < Math.abs(best.hl - implied) : dm < bm;
    if (!best || closer) best = { team, line, price, other, midp, m: s.m, i, hl };
  }
  if (best) {
    const homeSpread = best.team === home ? best.line : -best.line;
    out.spread = { homeSpread, home: best.team === home ? best.price : best.other, away: best.team === home ? best.other : best.price };
    mktInfo(out, "spread", best.m, best.team === home ? best.i : 1 - best.i);   // home side's order book (10/14 recording)
  }
  // Alternate spreads with a real two-sided book (10/6), both sides of each market: what it costs to buy team X at line L.
  // Used by BEAT THE 3 / 7 / 14 (bought points off the main line, lib/stack.js BUY_TIERS). Lines beyond 15 points are left out.
  const alts = [];
  for (const s of spreads) {
    if (!liveBook(s.m) || !(Number(s.m.bestAsk) - Number(s.m.bestBid) <= 0.06)) continue;
    const q = (s.m.question || "").match(/:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/);
    const team = q ? abbrOf(q[1], away, home) : abbrOf(s.outcomes[0], away, home);
    const line = q ? parseFloat(q[2]) : Number(s.m.line);
    if (!team || isNaN(line) || Math.abs(line) > 15) continue;
    const i = s.outcomes.findIndex((lab) => abbrOf(lab, away, home) === team); if (i < 0) continue;
    const other = team === home ? away : home;
    for (const [t, l, pr] of [[team, line, s.prices[i]], [other, -line, s.prices[1 - i]]])
      if (pr > 0 && pr < 1 && !alts.some((x) => x.team === t && x.line === l)) alts.push({ team: t, line: l, price: +pr.toFixed(4) });
  }
  if (alts.length) out.alts = alts;
  let bt = null;
  for (const t of totals) {
    let line = Number(t.m.line);
    if (isNaN(line) || !t.m.line) { const q = (t.m.question || "").match(/(\d+(?:\.\d+)?)/); line = q ? parseFloat(q[1]) : NaN; }
    const oi = t.outcomes.findIndex((x) => /over/i.test(x)), ui = t.outcomes.findIndex((x) => /under/i.test(x));
    if (isNaN(line) || oi < 0 || ui < 0) continue;
    const over = t.prices[oi], midO = t.mid[oi];
    if (!bt || Math.abs(midO - 0.5) < Math.abs(bt.midO - 0.5)) bt = { line, over, under: t.prices[ui], midO, m: t.m, oi };
  }
  if (bt) { out.total = { line: bt.line, over: bt.over, under: bt.under }; mktInfo(out, "total", bt.m, bt.oi); }   // Over side's order book
  return out;
}

// Order-book recording (10/14, owner: "go"): the main spread/total market's token for one side plus Polymarket's running volume and
// liquidity. Kept NON-enumerable so it never lands in snapshots (JSON skips it); only the 30-minute Pinnacle pull reads it.
function mktInfo(out, kind, m, side) {
  if (!m) return; let tok = null;
  try { const ids = Array.isArray(m.clobTokenIds) ? m.clobTokenIds : JSON.parse(m.clobTokenIds || "[]"); tok = ids[side] || null; } catch {}
  if (!out._mkt) Object.defineProperty(out, "_mkt", { value: {}, enumerable: false });
  out._mkt[kind] = { tok, vol: Number(m.volumeNum ?? m.volume) || null, liq: Number(m.liquidityNum ?? m.liquidity) || null };
}
// Dollars resting within 5 cents of the best bid / best ask for one token (CLOB order book).
export async function bookDepth(tok) {
  if (!tok) return null;
  const r = await fetch(`https://clob.polymarket.com/book?token_id=${tok}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }); if (!r.ok) return null;
  const b = await r.json(), bids = (b.bids || []).map((x) => [Number(x.price), Number(x.size)]), asks = (b.asks || []).map((x) => [Number(x.price), Number(x.size)]);
  const bb = bids.length ? Math.max(...bids.map((x) => x[0])) : null, ba = asks.length ? Math.min(...asks.map((x) => x[0])) : null;
  const sum = (xs, ok) => Math.round(xs.filter(([p]) => ok(p)).reduce((a, [p, s]) => a + p * s, 0));
  return { bb, ba, bd: bb == null ? 0 : sum(bids, (p) => p >= bb - 0.05), ad: ba == null ? 0 : sum(asks, (p) => p <= ba + 0.05) };
}
export async function fetchEvents() {
  return getJson(`${GAMMA}/events?series_id=12185&tag_id=100639&active=true&closed=false&limit=200&order=startTime&ascending=true`);
}
export function findEvent(events, away, home) {
  return events.find((e) => e.title && e.title.includes(TEAMS[away]) && e.title.includes(TEAMS[home]));
}
// Polymarket's game start time per game, { "AWAY @ HOME": ISO } (10/8: the schedule file and ESPN both kept CHI @ GB at
// 1:00 ET after it moved to 4:25; Polymarket had it right). Event startTime first, then a market's gameStartTime.
export function polyKickoffs(events, games) {
  const out = {};
  for (const g of games || []) {
    const ev = findEvent(events || [], g.away, g.home); if (!ev) continue;
    const raw = ev.startTime || ((ev.markets || []).find((m) => m.gameStartTime) || {}).gameStartTime;
    if (!raw) continue;
    const ms = Date.parse(String(raw).replace(" ", "T").replace(/\+00$/, "Z"));
    if (!isNaN(ms)) out[g.key] = new Date(ms).toISOString();
  }
  return out;
}
export async function gameLines(events, away, home) {
  const ev = findEvent(events, away, home);
  if (!ev) return null;
  let markets = ev.markets || [];
  let g = parseGame(markets, away, home);
  if ((!g.spread || !g.total || !g.ml) && ev.gameId) {
    try {
      const more = await getJson(`${GAMMA}/markets?game_id=${ev.gameId}&closed=false&limit=500`);
      if (Array.isArray(more)) g = parseGame(markets.concat(more), away, home);
    } catch {}
  }
  return g.ml || g.spread || g.total ? g : null;
}
// Anytime-TD props live in a companion "-player-props" event. Returns { question: price 0–1 }.
export async function tdProps(events, away, home) {
  const ev = findEvent(events, away, home);
  if (!ev || !ev.slug) return null;
  let pe;
  try { pe = await getJson(`${GAMMA}/events?slug=${ev.slug}-player-props`); } catch { return null; }
  pe = Array.isArray(pe) ? pe[0] : pe;
  if (!pe || !pe.markets) return null;
  const out = {};
  for (const m of pe.markets) {
    const type = (m.sportsMarketType || "").toLowerCase(), q = m.question || "";
    const anytime = type ? type === "anytime_touchdowns"
      : /touchdown/i.test(q) && !/first|last|passing/i.test(q) && (!/(\d+)\s*\+/.test(q) || /(^|\D)1\s*\+/.test(q));
    if (!anytime || m.closed) continue;
    const outcomes = arr(m.outcomes), yi = outcomes.findIndex((o) => /yes/i.test(o));
    if (yi < 0) continue;
    const bp = buyPrices(m), price = bp.buy[yi];
    if (!(price > 0 && price < 1)) continue;
    const bid = yi === 0 ? Number(m.bestBid) : 1 - Number(m.bestAsk);
    const b = bid > 0 && bid < 1 ? bid : null;
    out[q] = { ask: price, bid: b, spread: bp.spread, thin: isThinMarket(price, b) };
  }
  return Object.keys(out).length ? out : null;
}
