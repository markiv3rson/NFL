import { isThinMarket, ninv } from "./odds";
// Polymarket game lines + anytime-TD props. 10/17 (owner: "it needs to match my app"): read from POLYMARKET US (lib/polyus.js), the markets and
// prices of the owner's app; the international site (gamma) listed other alternate lines. Each US market arrives in the gamma shape parsed below.
import { TEAMS } from "./games";
import { usGames, usEvent, usMarkets } from "./polyus";
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
    if (!s.prices.every((p) => p > 0.1 && p < 0.9)) continue;   // 10/26 recheck: a one-sided stub is a placeholder, never the main spread
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
    if (!t.prices.every((p) => p > 0.1 && p < 0.9)) continue;   // 10/26 recheck: a one-sided stub (0.99 / 0.49, nobody selling) is a placeholder, never the main total
    const over = t.prices[oi], midO = t.mid[oi];
    if (!bt || Math.abs(midO - 0.5) < Math.abs(bt.midO - 0.5)) bt = { line, over, under: t.prices[ui], midO, m: t.m, oi };
  }
  if (bt) { out.total = { line: bt.line, over: bt.over, under: bt.under }; }
  // Alternate TOTAL lines with a real two-sided book (10/14, bought-point totals, lib/stack.js totalBuyPick): what it costs to buy Over / Under at line L, within 6 points of the main total.
  if (bt) { const talts = [];
    for (const t of totals) { if (!liveBook(t.m) || !(Number(t.m.bestAsk) - Number(t.m.bestBid) <= 0.06)) continue;
      let line = Number(t.m.line); if (isNaN(line) || !t.m.line) { const q = (t.m.question || "").match(/(\d+(?:\.\d+)?)/); line = q ? parseFloat(q[1]) : NaN; }
      const oi = t.outcomes.findIndex((x) => /over/i.test(x)), ui = t.outcomes.findIndex((x) => /under/i.test(x));
      if (isNaN(line) || oi < 0 || ui < 0 || Math.abs(line - bt.line) > 6 || Number.isInteger(line)) continue;
      for (const [side, i] of [["over", oi], ["under", ui]]) { const pr = t.prices[i]; if (pr > 0.1 && pr < 0.9 && !talts.some((x) => x.side === side && x.line === line)) talts.push({ side, line, price: +pr.toFixed(4) }); } }
    if (talts.length) out.talts = talts; }
  return out;
}

// The NFL games on Polymarket US from 2 days ago to 12 days ahead (live games included). Each game's full market list is read once per
// call when first needed (gameLines / tdProps / playerProps share it).
export async function fetchEvents() {
  const now = Date.now(), list = await usGames("nfl", now - 2 * 86400e3, now + 12 * 86400e3);
  const ev = list.map((e) => ({ ...e, title: `${TEAMS[e.away] || e.away} vs. ${TEAMS[e.home] || e.home}`, startTime: e.start, markets: [] }));
  return Object.defineProperty(ev, "_full", { value: new Map(), enumerable: false });
}
export function findEvent(events, away, home) {
  const xs = events || [];
  return xs.find((e) => e.away === away && e.home === home) || xs.find((e) => !e.away && e.title && e.title.includes(TEAMS[away]) && e.title.includes(TEAMS[home]));
}
async function fullMarkets(events, ev) {
  if (!ev) return [];
  if (!ev.slug) return ev.markets || [];   // a game handed in with its markets already attached
  const cache = events && events._full, hit = cache && cache.get(ev.slug); if (hit) return hit;
  const p = usEvent(ev.slug).then((e) => usMarkets(e, "nfl")); if (cache) cache.set(ev.slug, p.catch(() => []));
  return p;
}
export async function gameLines(events, away, home) {
  const ev = findEvent(events, away, home);
  if (!ev) return null;
  const g = parseGame(await fullMarkets(events, ev), away, home);
  return g.ml || g.spread || g.total ? g : null;
}
// Anytime-TD and player stat markets sit in the same Polymarket US game event. Returns its markets (gamma shape) or null.
async function propsMarkets(events, away, home) {
  const ev = findEvent(events, away, home);
  if (!ev) return null;
  const ms = await fullMarkets(events, ev).catch(() => null);
  return ms && ms.length ? ms : null;
}
export async function tdProps(events, away, home) {
  const ms = await propsMarkets(events, away, home);
  return ms ? tdFromMarkets(ms) : null;
}
function tdFromMarkets(markets) {
  const out = {};
  for (const m of markets) {
    const type = (m.sportsMarketType || "").toLowerCase(), q = m.question || "";
    const anytime = type ? type === "anytime_touchdowns"
      : /touchdown/i.test(q) && !/first|last|passing/i.test(q) && (!/(\d+)\s*\+/.test(q) || /(^|\D)1\s*\+/.test(q));
    const first = type === "first_touchdown";   // 10/20: first-TD price, kept in the same map (the anytime matcher skips "first")
    if (!(anytime || first) || m.closed) continue;
    const outcomes = arr(m.outcomes), yi = outcomes.findIndex((o) => /yes/i.test(o));
    if (yi < 0) continue;
    const bp = buyPrices(m), price = bp.buy[yi];
    if (!(price > 0 && price < 1)) continue;
    const bid = yi === 0 ? Number(m.bestBid) : 1 - Number(m.bestAsk);
    const b = bid > 0 && bid < 1 ? bid : null;
    out[q] = { ask: price, bid: b, spread: bp.spread, thin: isThinMarket(price, b), ...(first ? { first: true } : {}) };
  }
  return Object.keys(out).length ? out : null;
}
// Player stat props (10/17): passing / rushing / receiving yards, receptions, pass attempts, completions, longest reception.
// Each Polymarket market is one Over/Under line ("Chuba Hubbard: Rushing Yards O/U 39.5"). Returns [{ name, stat, line, oa, ob, ua, liq, vol }]:
// oa / ua = price to buy Over / Under (0-1), ob = best bid for Over (null when none), liq / vol = Polymarket's liquidity / volume in $.
export const PROP_STAT = { passing_yards: "pass_yds", passing_attempts: "pass_att", passing_completions: "pass_cmp", rushing_yards: "rush_yds",
  receiving_yards: "rec_yds", receptions: "rec", longest_reception: "long_rec" };
export function statPropsFromMarkets(markets) {
  const out = [];
  for (const m of markets || []) {
    const stat = PROP_STAT[(m.sportsMarketType || "").toLowerCase()]; if (!stat || m.closed) continue;
    const name = String(m.question || "").split(":")[0].trim(), line = Number(m.line);
    if (!name || !Number.isFinite(line)) continue;
    const outcomes = arr(m.outcomes), oi = outcomes.findIndex((o) => /over/i.test(o)); if (oi < 0) continue;
    const bp = buyPrices(m), oa = bp.buy[oi], ua = bp.buy[1 - oi];
    const bid = oi === 0 ? Number(m.bestBid) : 1 - Number(m.bestAsk);
    out.push({ name, stat, line, oa: oa > 0 && oa < 1 ? Math.round(oa * 1000) / 1000 : null, ob: bid > 0 && bid < 1 ? Math.round(bid * 1000) / 1000 : null,
      ua: ua > 0 && ua < 1 ? Math.round(ua * 1000) / 1000 : null, liq: Math.round(Number(m.liquidityNum) || 0), vol: Math.round(Number(m.volumeNum) || 0) });
  }
  return out;
}
// One fetch of the "-player-props" event for both: { td: tdProps-shape | null, stats: [...] }.
export async function playerProps(events, away, home) {
  const ms = await propsMarkets(events, away, home);
  return ms ? { td: tdFromMarkets(ms), stats: statPropsFromMarkets(ms) } : null;
}
