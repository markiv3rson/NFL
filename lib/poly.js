import { isThinMarket } from "./odds";
// Polymarket (public Gamma API): game lines + anytime-TD props.
import { TEAMS } from "./games";
const GAMMA = process.env.GAMMA_BASE || "https://gamma-api.polymarket.com";
async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
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
  for (const s of spreads) {
    const q = (s.m.question || "").match(/:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/);
    const team = q ? abbrOf(q[1], away, home) : abbrOf(s.outcomes[0], away, home);
    const line = q ? parseFloat(q[2]) : Number(s.m.line);
    if (!team || isNaN(line)) continue;
    const i = s.outcomes.findIndex((lab) => abbrOf(lab, away, home) === team);
    if (i < 0) continue;
    const price = s.prices[i], other = s.prices[1 - i], midp = s.mid[i];
    if (!best || Math.abs(midp - 0.5) < Math.abs(best.midp - 0.5)) best = { team, line, price, other, midp };
  }
  if (best) {
    const homeSpread = best.team === home ? best.line : -best.line;
    out.spread = { homeSpread, home: best.team === home ? best.price : best.other, away: best.team === home ? best.other : best.price };
  }
  let bt = null;
  for (const t of totals) {
    let line = Number(t.m.line);
    if (isNaN(line) || !t.m.line) { const q = (t.m.question || "").match(/(\d+(?:\.\d+)?)/); line = q ? parseFloat(q[1]) : NaN; }
    const oi = t.outcomes.findIndex((x) => /over/i.test(x)), ui = t.outcomes.findIndex((x) => /under/i.test(x));
    if (isNaN(line) || oi < 0 || ui < 0) continue;
    const over = t.prices[oi], midO = t.mid[oi];
    if (!bt || Math.abs(midO - 0.5) < Math.abs(bt.midO - 0.5)) bt = { line, over, under: t.prices[ui], midO };
  }
  if (bt) out.total = { line: bt.line, over: bt.over, under: bt.under };
  return out;
}

export async function fetchEvents() {
  return getJson(`${GAMMA}/events?series_id=12185&tag_id=100639&active=true&closed=false&limit=200&order=startTime&ascending=true`);
}
export function findEvent(events, away, home) {
  return events.find((e) => e.title && e.title.includes(TEAMS[away]) && e.title.includes(TEAMS[home]));
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
