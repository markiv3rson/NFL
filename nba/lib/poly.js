// Polymarket NBA game lines — moneyline, spread, total, plus every alternate line. 10/17 (owner: "it needs to match my app", "do it for the nba also"):
// read from POLYMARKET US (lib/polyus.js), the markets and prices of the owner's app; each US market arrives in the gamma shape parsed below.
// There are NO player props for NBA on Polymarket, so nothing here asks for them.
// Copied in shape from the NFL app's lib/poly.js, with NBA teams (taken from each event's own team list) and NBA spread sizes.
import { ninv, isThinMarket } from "./odds";
import { TEAMS, ABBRS } from "./teams";
import { usGames, usEvent, usMarkets } from "../../lib/polyus";
const arr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || "[]"); } catch { return []; } };
const isPeriod = (q) => /\b(1H|2H|1st|2nd|first|second|half|quarter|Q[1-4])\b/i.test(q || "") && !/team to score first/i.test(q || "");

// Which of our abbreviations does this outcome / label name? ("Raptors", "TOR", "Toronto Raptors")
const abbrOf = (label, away, home) => {
  const l = (label || "").toLowerCase();
  for (const t of [away, home]) if (l === t.toLowerCase() || l === TEAMS[t].nick.toLowerCase() || l.includes(TEAMS[t].nick.toLowerCase())) return t;
  return null;
};

// What you actually PAY to buy each outcome (the app's Buy button), not the midpoint.
export function buyPrices(m) {
  const mid = arr(m.outcomePrices).map(Number);
  const ask = Number(m.bestAsk), bid = Number(m.bestBid);
  const p0 = ask > 0 && ask < 1 ? ask : mid[0];
  const p1 = bid > 0 && bid < 1 ? 1 - bid : mid[1];
  const spread = ask > 0 && bid >= 0 && ask > bid ? ask - bid : Number(m.spread) || null;
  return { buy: [p0, p1], mid, spread };
}

// Prices are probabilities 0–1 (buy price). The main line is the one whose midpoint is closest to 50/50 AND consistent with the
// moneyline. Everything else with a real two-sided book goes in `alts` / `totalAlts` (the teaser lines).
export function parseGame(markets, away, home) {
  const out = {};
  const ml = [], spreads = [], totals = [];
  for (const m of markets) {
    const type = (m.sportsMarketType || "").toLowerCase();
    if (isPeriod(m.question) || m.closed) continue;
    const outcomes = arr(m.outcomes), bp = buyPrices(m), prices = bp.buy, mid = bp.mid;
    if (outcomes.length !== 2 || prices.length !== 2 || prices.some(isNaN) || mid.some(isNaN)) continue;
    if (type === "moneyline") ml.push({ outcomes, prices, mid });
    else if (type === "spreads") spreads.push({ m, outcomes, prices, mid });
    else if (type === "totals") totals.push({ m, outcomes, prices, mid });
  }
  if (ml.length) {
    const { outcomes, prices, mid } = ml[0], o = {}, om = {};
    outcomes.forEach((lab, i) => { const t = abbrOf(lab, away, home); if (t) { o[t] = prices[i]; om[t] = mid[i]; } });
    if (o[away] != null && o[home] != null) out.ml = { away: o[away], home: o[home], midAway: om[away], midHome: om[home] };
  }
  // home spread the moneyline implies (negative = home favoured), using the NBA spread of results (12.7 points)
  const implied = out.ml ? -12.7 * ninv(out.ml.midHome / (out.ml.midHome + out.ml.midAway)) : null;
  const liveBook = (m) => Number(m.bestBid) > 0 && Number(m.bestAsk) > 0;
  const useLive = spreads.some((s) => liveBook(s.m));
  const lineOf = (s) => {
    const q = (s.m.question || "").match(/:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/);
    const team = q ? abbrOf(q[1], away, home) : abbrOf(s.outcomes[0], away, home);
    const line = s.m.line != null && !isNaN(Number(s.m.line)) ? Number(s.m.line) : q ? parseFloat(q[2]) : NaN;
    return { team, line };
  };
  let best = null;
  for (const s of spreads) {
    if (useLive && !liveBook(s.m)) continue;
    const { team, line } = lineOf(s);
    if (!team || isNaN(line)) continue;
    const i = s.outcomes.findIndex((lab) => abbrOf(lab, away, home) === team);
    if (i < 0) continue;
    const price = s.prices[i], other = s.prices[1 - i], midp = s.mid[i];
    if (implied != null && Math.abs((team === home ? line : -line) - implied) > 4.5) continue;   // an alternate line, not the game's spread
    if (!best || Math.abs(midp - 0.5) < Math.abs(best.midp - 0.5)) best = { team, line, price, other, midp };
  }
  if (best) {
    const homeSpread = best.team === home ? best.line : -best.line;
    out.spread = { homeSpread, home: best.team === home ? best.price : best.other, away: best.team === home ? best.other : best.price };
  }
  // Alternate spreads with a real two-sided book: what it costs to buy team X at line L (the TEASER lines). Lines beyond 15 left out.
  const alts = [];
  for (const s of spreads) {
    if (!liveBook(s.m) || !(Number(s.m.bestAsk) - Number(s.m.bestBid) <= 0.08)) continue;
    const { team, line } = lineOf(s);
    if (!team || isNaN(line) || Math.abs(line) > 15) continue;
    const i = s.outcomes.findIndex((lab) => abbrOf(lab, away, home) === team); if (i < 0) continue;
    const other = team === home ? away : home;
    for (const [t, l, pr] of [[team, line, s.prices[i]], [other, -line, s.prices[1 - i]]])
      if (pr > 0 && pr < 1 && !alts.some((x) => x.team === t && x.line === l)) alts.push({ team: t, line: l, price: +pr.toFixed(4) });
  }
  if (alts.length) out.alts = alts;
  // Totals: main = closest to 50/50 among markets with a live book (when any exist); every live line goes in totalAlts.
  const liveTot = totals.filter((t) => liveBook(t.m));
  const pool = liveTot.length ? liveTot : totals;
  let bt = null; const totalAlts = [];
  for (const t of pool) {
    let line = Number(t.m.line);
    if (isNaN(line) || t.m.line == null) { const q = (t.m.question || "").match(/(\d+(?:\.\d+)?)/); line = q ? parseFloat(q[1]) : NaN; }
    const oi = t.outcomes.findIndex((x) => /over/i.test(x)), ui = t.outcomes.findIndex((x) => /under/i.test(x));
    if (isNaN(line) || oi < 0 || ui < 0) continue;
    const over = t.prices[oi], midO = t.mid[oi];
    if (!bt || Math.abs(midO - 0.5) < Math.abs(bt.midO - 0.5)) bt = { line, over, under: t.prices[ui], midO };
    totalAlts.push({ line, over: +over.toFixed(4), under: +t.prices[ui].toFixed(4) });
  }
  if (bt) out.total = { line: bt.line, over: bt.over, under: bt.under };
  if (totalAlts.length > 1) out.totalAlts = totalAlts.sort((a, b) => a.line - b.line);
  return out;
}

// NBA games on Polymarket US from yesterday to 10 days ahead (the All-Star break has ~7 days without games); the full market list (an NBA game
// event is a few KB) is read for the first 3 game days only (the slate shows today + the next day with games), 8 at a time. The event's slug says
// who is away / home ("nba-bos-det-2026-10-20" = BOS @ DET).
export async function fetchEvents() {
  const now = Date.now(), list = await usGames("nba", now - 86400e3, now + 10 * 86400e3);
  const days = [...new Set(list.map((e) => (e.slug.match(/(\d{4}-\d\d-\d\d)$/) || [])[1]).filter(Boolean))].sort().slice(0, 3);
  const want = list.filter((e) => days.includes((e.slug.match(/(\d{4}-\d\d-\d\d)$/) || [])[1])), out = [];
  for (let i = 0; i < want.length; i += 8) out.push(...(await Promise.all(want.slice(i, i + 8).map(async (e) => { const ev = await usEvent(e.slug).catch(() => null); if (!ev) return null;
    return { slug: e.slug, startTime: e.start || ev.startTime, teams: [{ abbreviation: e.away, ordering: "away" }, { abbreviation: e.home, ordering: "home" }], markets: usMarkets(ev, "nba") }; }))));
  return out.filter(Boolean);
}

// One game from an event: { key, away, home, start (ISO), date (ET day), event }. The event's own team list says who is away / home.
export function eventGame(ev) {
  const t = ev && Array.isArray(ev.teams) ? ev.teams : null;
  if (!t || t.length !== 2) return null;
  const ab = (x) => String(x.abbreviation || "").toUpperCase();
  const away = (t.find((x) => x.ordering === "away") || t[0]), home = (t.find((x) => x.ordering === "home") || t[1]);
  const a = ab(away), h = ab(home);
  if (!ABBRS.includes(a) || !ABBRS.includes(h) || a === h) return null;
  const raw = ev.startTime || ((ev.markets || []).find((m) => m.gameStartTime) || {}).gameStartTime;
  const ms = Date.parse(String(raw || "").replace(" ", "T").replace(/\+00$/, "Z"));
  if (isNaN(ms)) return null;
  const start = new Date(ms).toISOString();
  return { key: `${a} @ ${h}`, away: a, home: h, start, date: etDate(start), eventSlug: ev.slug, event: ev };
}
// The calendar day (US Eastern) a game belongs to — late games that tip after midnight UTC are still that evening's games.
export function etDate(iso) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return p; // YYYY-MM-DD
}

export function polyGames(events) {
  const byKey = {};
  for (const ev of events || []) {
    const g = eventGame(ev); if (!g) continue;
    let lines = null;
    try { lines = parseGame(ev.markets || [], g.away, g.home); } catch { lines = null; }
    const row = { ...g, poly: lines && (lines.ml || lines.spread || lines.total) ? lines : null }, prev = byKey[g.key];
    if (!prev || (ev.markets || []).length > ((prev.event && prev.event.markets) || []).length) byKey[g.key] = row;   // a game listed twice: keep the fuller listing
  }
  return Object.values(byKey);
}
export { isThinMarket };
