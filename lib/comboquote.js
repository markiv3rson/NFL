// Real Polymarket combo price (10/17, owner: "I need the real price"). Tapping a parlay's PL line asks Polymarket US for a live quote of
// those exact legs, the way Polymarket's own app does when a combo is built:
//   1. each leg -> its Polymarket US market and side (the game's event lists every market; "TB +2.5" = the NO side of "PIT -2.5")
//   2. POST /v1/combos {legs:[{symbol, side}]} -> the combo's symbol ("caoc-...")
//   3. POST /v1/rfqs {symbol, cashOrderQty: stake, restRemainder: false} -> traders send quotes
//   4. read the quotes, take the best price to buy, then DELETE /v1/rfqs/{id}
// A quote is NEVER accepted (no accept call exists in this file): nothing is bought. Polymarket allows 1 combo / RFQ request a second.
import { nameMatches } from "./picks";

const US_TEAM = { LA: ["lar", "la"], WAS: ["wsh", "was"], JAX: ["jac", "jax"], LV: ["lv", "lvr"] };
const PM_TEAM = { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" };
const appTeam = (a) => PM_TEAM[String(a || "").toUpperCase()] || String(a || "").toUpperCase();
const num = (x) => Number(String(x ?? "").replace(/^\+/, ""));
// The game's date on Polymarket's event slug is the Eastern-time date of kickoff
export const etDate = (kick) => new Date(kick).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export function eventSlugs(game, kick) {
  const [a, h] = String(game || "").split(" @ "), d = etDate(kick), out = [];
  if (!a || !h || !/^\d{4}-\d\d-\d\d$/.test(d)) return out;
  for (const x of US_TEAM[a] || [a.toLowerCase()]) for (const y of US_TEAM[h] || [h.toLowerCase()]) out.push(`nfl-${x}-${y}-${d}`);
  return out;
}
const pick = (m, s) => ({ symbol: s.identifier || m.slug, side: s.long ? "SIDE_BUY" : "SIDE_SELL" });
// One app leg -> { symbol, side } among the event's markets (full game only), or null when Polymarket has no such market
export function legSymbol(leg, markets) {
  const L = String(leg.label || ""), of = (t) => (markets || []).filter((m) => m && m.sportsMarketType === t && Array.isArray(m.marketSides));
  if (leg.kind === "spread") { const line = num(L.split(" ").pop());
    for (const m of of("football_team_full_game_spread")) for (const s of m.marketSides) if (appTeam(s.team && s.team.abbreviation) === leg.team && Math.abs(num(s.description) - line) < 1e-9) return pick(m, s); }
  if (leg.kind === "ml") {
    for (const m of of("football_team_full_game_winner")) for (const s of m.marketSides) if (appTeam(s.team && s.team.abbreviation) === leg.team) return pick(m, s); }
  if (leg.kind === "total") { const line = num((L.match(/^(?:Over|Under)\s+([\d.]+)/) || [])[1]), side = leg.side || (/^Under/.test(L) ? "under" : "over");
    for (const m of of("football_team_full_game_total")) if (Math.abs(num(m.line) - line) < 1e-9) for (const s of m.marketSides) if (String(s.description).toLowerCase() === side) return pick(m, s); }
  if (leg.kind === "td") { const need = Number((L.match(/(\d)\+ TD/) || [])[1] || 1), who = leg.player || L.replace(/\s+(\d\+\s+)?TD$/, "");
    for (const m of of("football_player_touchdowns")) { if (num(m.line) !== need) continue;
      const full = String(m.titleShort || m.title || "").replace(/\s+\d\+\s+(TD|touchdowns)$/i, "");
      if (!nameMatches(who, full)) continue;
      const s = m.marketSides.find((x) => x.long); if (s && (!leg.team || appTeam(s.team && s.team.abbreviation) === leg.team)) return pick(m, s); } }
  return null;
}
// Polymarket's combo fee, fitted on the owner's 5 combos (10/17): fee per share = p (0.12805 - 0.2657 p), p = the quote price.
// Saints combo: p 0.0263 -> $10 buys 339.16 shares = 33.92x (Polymarket showed 33.92x, $10 -> $339.16). The other 4 match to the cent.
export const feePerShare = (p) => p * (0.12805 - 0.2657 * p);
export const payoutAt = (p) => (p > 0 && p < 1 ? 1 / (p + feePerShare(p)) : null);

const amt = (x) => (x == null ? null : typeof x === "object" ? num(x.value) : num(x));
// The best price to BUY the combo among the quotes (the traders' sell price), wherever the reply puts the quote list
export function bestBuyPrice(reply) {
  const out = [];
  const walk = (x, d = 0) => { if (!x || typeof x !== "object" || d > 6) return; if (Array.isArray(x)) return x.forEach((v) => walk(v, d + 1));
    const sp = amt(x.sellPrice ?? x.askPrice ?? x.offerPrice); if (sp > 0 && sp < 1) out.push(sp);
    for (const v of Object.values(x)) if (v && typeof v === "object") walk(v, d + 1); };
  walk(reply);
  return out.length ? Math.min(...out) : null;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// legs: the parlay's legs (game, kind, team, side, label, player); kick: { game key: kickoff time }; stake in $
export async function realQuote(client, legs, kick, stake, log = []) {
  const events = {};
  for (const g of [...new Set(legs.map((l) => l.game))]) {
    for (const slug of eventSlugs(g, kick[g])) {
      const r = await client.get(`/v1/events/slug/${slug}`).catch((e) => ({ error: String(e && e.message || e) }));
      const ev = r && (r.event || r); if (ev && Array.isArray(ev.markets)) { events[g] = ev.markets; log.push({ step: "event", slug, markets: ev.markets.length }); break; }
      log.push({ step: "event", slug, reply: JSON.stringify(r).slice(0, 300) });
    }
  }
  const sym = legs.map((l) => (events[l.game] ? legSymbol(l, events[l.game]) : null));
  log.push({ step: "legs", legs: legs.map((l, i) => ({ label: l.label, ...(sym[i] || { missing: true }) })) });
  const miss = legs.filter((_, i) => !sym[i]).map((l) => l.label);
  if (miss.length) return { ok: false, why: `Polymarket has no market for ${miss.join(", ")}` };
  const call = (method, path, body) => client.request(method, path, { authenticated: true, ...(body ? { body } : {}) })
    .then((r) => { log.push({ step: `${method} ${path}`, reply: JSON.stringify(r).slice(0, 20000) }); return r; })
    .catch((e) => { log.push({ step: `${method} ${path}`, error: String(e && e.message || e).slice(0, 600), status: e && e.status }); return null; });
  const cr = await call("POST", "/v1/combos", { legs: sym });
  const combo = cr && ((cr.combo && (cr.combo.id || cr.combo.symbol)) || cr.id || cr.symbol);
  if (!combo) return { ok: false, why: "Polymarket did not make the combo" };
  await wait(1100);   // 1 combo / RFQ request a second
  const rr = await call("POST", "/v1/rfqs", { symbol: combo, cashOrderQty: String(stake), restRemainder: false });
  const rfq = rr && (rr.rfqId || (rr.rfq && (rr.rfq.id || rr.rfq.rfqId)) || rr.id);
  if (!rfq) return { ok: false, combo, why: "Polymarket did not take the quote request" };
  let price = null;
  try {
    for (const ms of [700, 900, 1200, 1500]) {
      await wait(ms);
      for (const path of [`/v1/rfqs/quotes?rfqId=${encodeURIComponent(rfq)}`, `/v1/rfqs/${encodeURIComponent(rfq)}/quotes`, `/v1/rfqs/${encodeURIComponent(rfq)}`]) {
        const q = await call("GET", path); const p = q && bestBuyPrice(q); if (p) { price = p; break; }
      }
      if (price) break;
    }
  } finally { await call("DELETE", `/v1/rfqs/${encodeURIComponent(rfq)}`); }   // always close the request: nothing is bought
  if (!price) return { ok: false, combo, rfq, why: "no quote came back" };
  return { ok: true, combo, price, pay: payoutAt(price) };
}
