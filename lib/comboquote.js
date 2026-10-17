// Real Polymarket combo price (10/17, owner: "I need the real price"). Tapping a parlay's PL line asks Polymarket US for a live quote of
// those exact legs, the way Polymarket's own app does when a combo is built:
//   1. each leg -> its Polymarket US market and side (the game's event lists every market; "TB +2.5" = the NO side of "PIT -2.5")
//   2. POST /v1/combos {legs:[{symbol, side}]} -> the combo's symbol ("caoc-...")
//   3. POST /v1/rfqs {symbol, cashOrderQty: stake, restRemainder: false} -> traders send quotes
//   4. GET /v1/rfqs/quotes?rfqId= -> the quote that gives the most shares for the stake (Polymarket's own count, fee included), then DELETE /v1/rfqs/{id}
// A quote is NEVER accepted (no accept call exists in this file): nothing is bought. Polymarket allows 1 combo / RFQ request a second.
import { nameMatches } from "./picks";
import { getRedis, jparse } from "./redis";

// 10/17 (owner: "I need this for the nba also"): NFL and NBA work the same on Polymarket US (event "nfl-pit-tb-2026-10-18" / "nba-bos-det-2026-10-20",
// markets football_team_full_game_spread / basketball_team_full_game_spread, ...). Team codes that differ from the app's:
const SPORT = {
  nfl: { pre: "football", slug: "nfl", us: { LA: ["lar", "la"], WAS: ["wsh", "was"], JAX: ["jac", "jax"], LV: ["lv", "lvr"] }, back: { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" } },
  nba: { pre: "basketball", slug: "nba", us: { GSW: ["gs", "gsw"], NOP: ["no", "nop"], SAS: ["sa", "sas"], NYK: ["ny", "nyk"], PHX: ["pho", "phx"] }, back: { GS: "GSW", NO: "NOP", SA: "SAS", NY: "NYK", PHO: "PHX" } },
};
const sp = (sport) => SPORT[sport] || SPORT.nfl;
const appTeam = (a, sport = "nfl") => { const u = String(a || "").toUpperCase(); return sp(sport).back[u] || u; };
const num = (x) => Number(String(x ?? "").replace(/^\+/, ""));
// The game's date on Polymarket's event slug is the Eastern-time date of kickoff / tip-off
export const etDate = (kick) => new Date(kick).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export function eventSlugs(game, kick, sport = "nfl") {
  const [a, h] = String(game || "").split(" @ "), d = etDate(kick), S = sp(sport), out = [];
  if (!a || !h || !/^\d{4}-\d\d-\d\d$/.test(d)) return out;
  for (const x of S.us[a] || [a.toLowerCase()]) for (const y of S.us[h] || [h.toLowerCase()]) out.push(`${S.slug}-${x}-${y}-${d}`);
  return out;
}
const pick = (m, s) => ({ symbol: s.identifier || m.slug, side: s.long ? "SIDE_BUY" : "SIDE_SELL" });
// One app leg -> { symbol, side } among the event's markets (full game only), or null when Polymarket has no such market.
// NFL legs carry kind (spread / total / ml / td); NBA legs carry market (spread / total / ml) and their line.
export function legSymbol(leg, markets, sport = "nfl") {
  const L = String(leg.label || ""), kind = leg.kind || leg.market, pre = sp(sport).pre;
  const of = (t) => (markets || []).filter((m) => m && m.sportsMarketType === `${pre}_${t}` && Array.isArray(m.marketSides));
  const tm = (s) => appTeam(s.team && s.team.abbreviation, sport);
  if (kind === "spread") { const line = leg.line != null && isFinite(num(leg.line)) ? num(leg.line) : num(L.split(" ").pop());
    for (const m of of("team_full_game_spread")) for (const s of m.marketSides) if (tm(s) === leg.team && Math.abs(num(s.description) - line) < 1e-9) return pick(m, s); }
  if (kind === "ml") {
    for (const m of of("team_full_game_winner")) for (const s of m.marketSides) if (tm(s) === leg.team) return pick(m, s); }
  if (kind === "total") { const line = leg.line != null && isFinite(num(leg.line)) ? num(leg.line) : num((L.match(/^(?:Over|Under)\s+([\d.]+)/) || [])[1]), side = leg.side || (/^Under/.test(L) ? "under" : "over");
    for (const m of of("team_full_game_total")) if (Math.abs(num(m.line) - line) < 1e-9) for (const s of m.marketSides) if (String(s.description).toLowerCase() === side) return pick(m, s); }
  if (kind === "td" && pre === "football") { const need = Number((L.match(/(\d)\+ TD/) || [])[1] || 1), who = leg.player || L.replace(/\s+(\d\+\s+)?TD$/, "");
    for (const m of of("player_touchdowns")) { if (num(m.line) !== need) continue;
      const full = String(m.titleShort || m.title || "").replace(/\s+\d\+\s+(TD|touchdowns)$/i, "");
      if (!nameMatches(who, full)) continue;
      const s = m.marketSides.find((x) => x.long); if (s && (!leg.team || tm(s) === leg.team)) return pick(m, s); } }
  return null;
}
// Polymarket's combo fee, fitted on the owner's 5 combos (10/17): fee per share = p (0.12805 - 0.2657 p), p = the quote price.
// Saints combo: p 0.0263 -> $10 buys 339.16 shares = 33.92x (Polymarket showed 33.92x, $10 -> $339.16). The other 4 match to the cent.
export const feePerShare = (p) => p * (0.12805 - 0.2657 * p);
export const payoutAt = (p) => (p > 0 && p < 1 ? 1 / (p + feePerShare(p)) : null);

const amt = (x) => (x == null ? null : typeof x === "object" ? num(x.value) : num(x));
// The best quote to BUY the combo (checked live 10/17 on the owner's PIT @ TB combo, 16 quotes): the requester buys at the quote's buyPrice and
// Polymarket says how many shares the stake buys, fee included (buyQtyDecimal: $10 at 0.061 -> 147.37 shares = 14.74x; Polymarket's app showed 14.79x
// minutes earlier). Best = the most shares for the stake. sellPrice is the price to SELL the combo (not used).
export function bestQuote(reply) {
  const out = [];
  const walk = (x, d = 0) => { if (!x || typeof x !== "object" || d > 6) return; if (Array.isArray(x)) return x.forEach((v) => walk(v, d + 1));
    const bp = amt(x.buyPrice);
    if (bp > 0 && bp < 1 && (!x.status || /ACTIVE/.test(x.status))) out.push({ price: bp, qty: num(x.buyQtyDecimal) > 0 ? num(x.buyQtyDecimal) : null });
    for (const v of Object.values(x)) if (v && typeof v === "object") walk(v, d + 1); };
  walk(reply);
  if (!out.length) return null;
  return out.reduce((a, q) => ((q.qty || 0) > (a.qty || 0) || (!q.qty && !a.qty && q.price < a.price) ? q : a));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 10/17 (owner: "I need it to update automatically"): every open page asks for its parlays' prices by itself and again every few minutes, so
// the server shares the work: a quote is kept 2.5 min for everyone (`cqq:`), a parlay's Polymarket markets + combo symbol a day (`cqs:`, so a
// refresh is ONE quote request, no 3 MB event download), and every Polymarket write waits for a free 1.1 s slot (`cq:slot`, 1 request a second).
export const legsSig = (legs) => legs.map((l) => [l.game, l.kind || l.market, l.team || "", l.side || "", l.line ?? "", l.label].join("|")).sort().join("~");
export const QUOTE_TTL = 420;   // 7 min: the background job (every 5 min) keeps every parlay on the pages fresher than that
async function slot(r) {
  for (let i = 0; i < 48; i++) { const ok = await r.set("cq:slot", "1", "PX", 1100, "NX").catch(() => "OK"); if (ok) return true; await wait(250); }
  return false;
}
// legs: the parlay's legs (game, kind, team, side, label, player); kick: { game key: kickoff time }; stake in $
export const quoteKey = (legs, stake, sport = "nfl") => `cqq:${sport}:${legsSig(legs)}|${stake}`;
export async function realQuote(client, legs, kick, stake, log = [], { fresh = false, sport = "nfl" } = {}) {
  const r = getRedis(), sig = legsSig(legs), qk = quoteKey(legs, stake, sport), sk = `cqs:${sport}:${sig}`;
  if (!fresh) { const hit = jparse(await r.get(qk).catch(() => null)); if (hit && hit.ok) return { ...hit, cached: true }; }
  const call = (method, path, body) => client.request(method, path, { authenticated: true, ...(body ? { body } : {}) })
    .then((x) => { log.push({ step: `${method} ${path}`, reply: JSON.stringify(x).slice(0, 20000) }); return x; })
    .catch((e) => { log.push({ step: `${method} ${path}`, error: String(e && e.message || e).slice(0, 600), status: e && e.status }); return null; });
  let known = jparse(await r.get(sk).catch(() => null)), combo = known && known.combo;
  if (!combo) {
    const events = {};
    for (const g of [...new Set(legs.map((l) => l.game))]) {
      for (const slug of eventSlugs(g, kick[g], sport)) {
        const x = await client.get(`/v1/events/slug/${slug}`).catch((e) => ({ error: String(e && e.message || e) }));
        const ev = x && (x.event || x); if (ev && Array.isArray(ev.markets)) { events[g] = ev.markets; log.push({ step: "event", slug, markets: ev.markets.length }); break; }
        log.push({ step: "event", slug, reply: JSON.stringify(x).slice(0, 300) });
      }
    }
    const sym = legs.map((l) => (events[l.game] ? legSymbol(l, events[l.game], sport) : null));
    log.push({ step: "legs", legs: legs.map((l, i) => ({ label: l.label, ...(sym[i] || { missing: true }) })) });
    const miss = legs.filter((_, i) => !sym[i]).map((l) => l.label);
    if (miss.length) return { ok: false, why: `Polymarket has no market for ${miss.join(", ")}` };
    if (!(await slot(r))) return { ok: false, why: "busy, try again" };
    const cr = await call("POST", "/v1/combos", { legs: sym });
    combo = cr && ((cr.combo && (cr.combo.id || cr.combo.symbol)) || cr.id || cr.symbol);
    if (!combo) return { ok: false, why: "Polymarket did not make the combo" };
    await r.set(sk, JSON.stringify({ combo, sym }), "EX", 86400).catch(() => {});
  }
  if (!(await slot(r))) return { ok: false, combo, why: "busy, try again" };
  const rr = await call("POST", "/v1/rfqs", { symbol: combo, cashOrderQty: String(stake), restRemainder: false });
  const rfq = rr && (rr.rfqId || (rr.rfq && (rr.rfq.id || rr.rfq.rfqId)) || rr.id);
  if (!rfq) { await r.del(sk).catch(() => {}); return { ok: false, combo, why: "Polymarket did not take the quote request" }; }   // a stale combo symbol is rebuilt next time
  let best = null;
  try {
    for (const ms of [700, 900, 1200]) {   // quotes arrive within about a second; the last read keeps every quote that came in
      await wait(ms);
      const q = await call("GET", `/v1/rfqs/quotes?rfqId=${encodeURIComponent(rfq)}`); const b = q && bestQuote(q);
      if (b) best = b;
      if (best && ms >= 900) break;
    }
  } finally { await call("DELETE", `/v1/rfqs/${encodeURIComponent(rfq)}`); }   // always close the request: nothing is bought
  if (!best) return { ok: false, combo, rfq, why: "no quote came back" };
  const out = { ok: true, combo, price: best.price, pay: best.qty ? best.qty / stake : payoutAt(best.price), t: new Date().toISOString() };
  await r.set(qk, JSON.stringify(out), "EX", QUOTE_TTL).catch(() => {});
  return out;
}

// ---- background (10/17, owner: "I need it to refresh in the background all the time") ----
// Every slate build saves the parlays on its pages (`cq:parlays:<sport>`); the scheduler calls /api/comboquotes every 5 min, which re-quotes the
// ones whose price is older than 4 min (oldest first, games within 36 h), three at a time (the 1.1 s slot keeps Polymarket at 1 request a second),
// until its time is up. Pages then open with Polymarket's real prices already there. The quotes live in the NFL database for both sports: the
// 1-a-second limit is the Polymarket account's, shared by both.
export async function saveParlayList(sport, list) {
  const keep = (list || []).filter((p) => p && Array.isArray(p.legs) && p.legs.length >= 2 && p.legs.length <= 10 && p.kick && p.legs.every((l) => l.game && l.label && p.kick[l.game]))
    .map((p) => ({ stake: p.stake || 10, kick: p.kick, legs: p.legs.map((l) => ({ game: l.game, kind: l.kind || l.market || null, team: l.team || null, side: l.side || null, line: l.line ?? null, label: l.label, player: l.player || null })) }));
  await getRedis().set(`cq:parlays:${sport}`, JSON.stringify({ t: new Date().toISOString(), list: keep }), "EX", 86400).catch(() => {});
  return keep.length;
}
export async function refreshQuotes(client, sport, { budgetMs = 40000, maxAgeS = 240, aheadH = 36, workers = 3, now = Date.now() } = {}) {
  const r = getRedis(), saved = jparse(await r.get(`cq:parlays:${sport}`).catch(() => null));
  const list = ((saved && saved.list) || []).filter((p) => { const ks = Object.values(p.kick).map((k) => Date.parse(k)); return ks.every((k) => k > now) && Math.min(...ks) - now < aheadH * 3600e3; });
  const seen = new Set(), todo = [];
  const keys = list.map((p) => quoteKey(p.legs, p.stake, sport)), vals = keys.length ? await r.mget(keys).catch(() => []) : [];
  list.forEach((p, i) => { if (seen.has(keys[i])) return; seen.add(keys[i]); const q = jparse(vals[i]); const age = q && q.t ? (now - Date.parse(q.t)) / 1000 : Infinity; if (age > maxAgeS) todo.push({ p, age }); });
  todo.sort((a, b) => b.age - a.age);
  let i = 0, ok = 0, bad = 0; const t0 = Date.now();
  const work = async () => { while (i < todo.length && Date.now() - t0 < budgetMs) { const { p } = todo[i++]; const out = await realQuote(client, p.legs, p.kick, p.stake, [], { fresh: true, sport }).catch(() => ({ ok: false })); if (out.ok) ok++; else bad++; } };
  await Promise.all(Array.from({ length: workers }, work));
  return { parlays: list.length, stale: todo.length, quoted: ok, failed: bad, left: Math.max(0, todo.length - ok - bad) };
}
