// NBA GAME PROPS PICK (10/30, owner: "1 only build now" -- the NFL GAME PROPS method on the NBA game / team markets Polymarket US lists): quarter / half
// spreads, totals, winners and ties, team points (game / halves), overtime, winning margin, race to 10 / 20 / 30. Chance = how often the market's
// condition came true in the 600 past regular-season games (2015-16 .. 2025-26, gameprops_data.js: ESPN quarter scores + closing lines; race to N from
// ESPN's play-by-play 2023-24 .. 2025-26) nearest this game's home-favored margin and total. Shown % = 0.8 chance + 0.2 price. Rule: shown 80%+, priced
// 30-82c on a real two-sided book (98-106c), the highest per market type per game.
// Test (scratchpad nbagp/test_gp.py): Polymarket US 2026-27, every finished game (99, 10/20-10/29), the last price 60+ min before tip, graded on Polymarket's
// own settlement. Options chosen on 10/20-10/24, judged on 10/25-10/29: 106-21 = 83.5% (said 83.9, priced 79.9c); every side at the same prices with no
// model (75-82c) won 74.9% (194-65), so the history picks the right expensive side; the chance by 10% band matched the results (80-90%: won 85.0).
import { GPN, GPCOLS } from "./gameprops_data";
import { usCode } from "../../lib/polyus";

export const NGP_BAR = 0.80, NGP_CAP = 0.82, NGP_MIN = 0.30, NGP_PRICE_W = 0.2, NGP_NEAR = 600, NGP_RACE_MIN = 300;
// 10/30 recheck: the test's prices were all from the 2 hours before tip (2.5 picks a game); hours earlier the books gave ~7 a game the test never saw,
// so picks are made only inside that window (a copy saved earlier is taken out)
export const NGP_WINDOW_MS = 2 * 3600e3;
export const ngpShown = (c, px) => (1 - NGP_PRICE_W) * c + NGP_PRICE_W * px;
export const ngpQualifies = (shown, px) => shown != null && px != null && shown >= NGP_BAR - 1e-9 && px >= NGP_MIN && px <= NGP_CAP;

let C = null;
function cols() {
  if (C) return C;
  C = {}; for (const [k, v] of Object.entries(GPCOLS)) C[k] = Int32Array.from(v.split(","), Number);
  C.hfav = Float64Array.from(C.hfav2, (x) => x / 2); C.tl = Float64Array.from(C.tl2, (x) => x / 2);
  return C;
}
const PART = { "first quarter": "q1", "second quarter": "q2", "third quarter": "q3", "fourth quarter": "q4", "first half": "1h", "second half": "2h" };
const PART_WORD = { q1: "1Q", q2: "2Q", q3: "3Q", q4: "4Q", "1h": "1H", "2h": "2H", fg: "" };
// a team's points in a part of game i (s = "h" / "a"); the second half and the full game count overtime
function pts(i, s, part) {
  const c = cols(), q = (n) => c[`q${s}${n}`][i], ot = c[s === "h" ? "oth" : "ota"][i];
  return part === "q1" ? q(1) : part === "q2" ? q(2) : part === "q3" ? q(3) : part === "q4" ? q(4) : part === "1h" ? q(1) + q(2) : part === "2h" ? q(3) + q(4) + ot : q(1) + q(2) + q(3) + q(4) + ot;
}
// the market -> its YES condition { k, part, s (team "h" / "a"), line / lo / hi / n }, or null
export function ngpParse(question, away, home) {
  const ql = String(question || "").toLowerCase(), A = usCode(away, "nba"), H = usCode(home, "nba");
  const part = Object.entries(PART).find(([k]) => ql.includes(k)), pt = part ? part[1] : "fg";
  const tm = /^will (?:the )?(\w+) /.exec(ql), s = tm ? (tm[1] === H ? "h" : tm[1] === A ? "a" : null) : null;
  let m;
  if ((m = /reach (\d+) points before/.exec(ql)) && s) return [10, 20, 30].includes(+m[1]) ? { k: "race", n: +m[1], s } : null;
  if (ql.includes("go to overtime")) return { k: "ot" };
  if (ql.includes("end in a tie")) return part ? { k: "tie", part: pt } : null;
  if ((m = /beat the \w+ \w+ by (\d+)\+ points/.exec(ql)) && s) return { k: "margin", part: "fg", s, lo: +m[1], hi: 999 };
  if ((m = /beat the \w+ \w+ by (\d+)-(\d+) points/.exec(ql)) && s) return { k: "margin", part: "fg", s, lo: +m[1], hi: +m[2] };
  if ((m = /cover ([+-]?\d+(?:\.\d+)?)/.exec(ql)) && s && part) return { k: "cover", part: pt, s, line: +m[1] };
  if (/ win the (first|second|third|fourth) (quarter|half)/.test(ql) && s) return { k: "win", part: pt, s };
  if ((m = /(?:first|second|third|fourth) (?:quarter|half) total.*more than (\d+(?:\.\d+)?)/.exec(ql)) && part) return { k: "total", part: pt, line: +m[1] };
  if ((m = /score more than (\d+(?:\.\d+)?) points/.exec(ql)) && s) return { k: "tpts", part: pt, s, line: +m[1] };
  return null;
}
// 1 / 0 / 0.5 (a push) for YES on past game i, or null when that game cannot say (no play-by-play for a race)
function cond(p, i) {
  const c = cols(), ov = (v, L) => (v > L ? 1 : v < L ? 0 : 0.5), mg = (part) => (p.s === "h" ? 1 : -1) * (pts(i, "h", part) - pts(i, "a", part));
  switch (p.k) {
    case "race": { const r = c[`r${p.n}`][i]; return r === 0 ? null : r === (p.s === "h" ? 1 : 2) ? 1 : 0; }
    case "ot": return c.ot[i] > 0 ? 1 : 0;
    case "tie": return pts(i, "h", p.part) === pts(i, "a", p.part) ? 1 : 0;
    case "margin": { const v = mg("fg"); return v >= p.lo && v <= p.hi ? 1 : 0; }
    case "cover": return ov(mg(p.part) + p.line, 0);
    case "win": return ov(mg(p.part), 0);
    case "total": return ov(pts(i, "h", p.part) + pts(i, "a", p.part), p.line);
    case "tpts": return ov(pts(i, p.s, p.part), p.line);
  }
  return null;
}
// past games nearest (home favored margin, total): distance (dm / 4)^2 + (dt / 8)^2, nearest first (ties by order)
function nearest(hfav, tl, cache) {
  const key = `${hfav}|${tl}`; if (cache && cache[key]) return cache[key];
  const c = cols(), d = new Float64Array(GPN), idx = new Int32Array(GPN);
  for (let i = 0; i < GPN; i++) { const a = (c.hfav[i] - hfav) / 4, b = (c.tl[i] - tl) / 8; d[i] = a * a + b * b; idx[i] = i; }
  const order = Array.from(idx).sort((x, y) => d[x] - d[y] || x - y);
  if (cache) cache[key] = order; return order;
}
export function ngpChance(p, hfav, tl, cache = {}) {
  if (!p || !isFinite(hfav) || !isFinite(tl)) return null;
  const order = nearest(hfav, tl, cache); let s = 0, n = 0;
  for (const i of order) { const v = cond(p, i); if (v == null) continue; s += v; n++; if (n >= NGP_NEAR) break; }
  return n >= (p.k === "race" ? NGP_RACE_MIN : NGP_NEAR) ? s / n : null;
}
// what you pay: the long side = the best ask, the short side = 1 - the best bid; a real two-sided book only (both 1-99c, the two adding to 98-106c)
const qv = (x) => { const v = Number(x && typeof x === "object" ? x.value : x); return v > 0 && v < 1 ? v : null; };
export function ngpPrices(m) {
  if (!m || m.closed || m.active === false || m.hidden) return null;
  const ask = qv(m.bestAskQuote), bid = qv(m.bestBidQuote); if (ask == null || bid == null) return null;
  const pl = ask, ps = Math.round((1 - bid) * 1000) / 1000;
  return pl > 0.01 && pl < 0.99 && ps > 0.01 && ps < 0.99 && pl + ps >= 0.98 - 1e-9 && pl + ps <= 1.06 + 1e-9 ? { pl, ps } : null;
}
const sg = (x) => (x > 0 ? "+" : "") + x;
// plain words for the side ("CHI -1.5 1Q", "1Q total Under 54.5", "BOS points Over 100.5", "Overtime No", "CHI first to 20 Yes")
export function ngpLabel(p, long, away, home) {
  const t = (s) => (s === "h" ? home : away), yn = long ? "Yes" : "No", ou = long ? "Over" : "Under", w = PART_WORD[p.part] || "";
  if (p.k === "cover") return (long ? `${t(p.s)} ${sg(p.line)} ${w}` : `${t(p.s === "h" ? "a" : "h")} ${sg(-p.line)} ${w}`).trim();
  if (p.k === "total") return `${w} total ${ou} ${p.line}`;
  if (p.k === "tpts") return `${t(p.s)}${w ? ` ${w}` : ""} points ${ou} ${p.line}`;
  if (p.k === "win") return `${t(p.s)} wins ${w} ${yn}`;
  if (p.k === "tie") return `${w} tie ${yn}`;
  if (p.k === "ot") return `Overtime ${yn}`;
  if (p.k === "margin") return `${t(p.s)} wins by ${p.hi >= 999 ? `${p.lo}+` : `${p.lo}-${p.hi}`} ${yn}`;
  if (p.k === "race") return `${t(p.s)} first to ${p.n} ${yn}`;
  return "";
}
// ev = the game's Polymarket US event; hfav / tl = Polymarket's main line now (home favored margin, total) -> the picks, highest shown % first
export function ngpPicks(ev, away, home, hfav, tl) {
  if (!ev || !isFinite(hfav) || !isFinite(tl)) return [];
  const cache = {}, best = {};
  for (const m of ev.markets || []) {
    const type = m.sportsMarketType || ""; if (!type || /player|full_game/.test(type)) continue;
    const p = ngpParse(m.question, away, home); if (!p) continue;
    const px = ngpPrices(m); if (!px) continue;
    const c = ngpChance(p, hfav, tl, cache); if (c == null) continue;
    for (const [long, ch, price] of [[true, c, px.pl], [false, 1 - c, px.ps]]) {
      const shown = ngpShown(ch, price); if (!ngpQualifies(shown, price)) continue;
      if (!best[type] || shown > best[type].said) best[type] = { type, slug: m.slug, long, cond: p, label: ngpLabel(p, long, away, home), said: Math.round(shown * 1000) / 1000, hist: Math.round(ch * 1000) / 1000, price };
    }
  }
  return Object.values(best).sort((a, b) => b.said - a.said);
}
// a settled market -> "W" / "L" / "P" for the side we took (outcomePrices follow marketSides, the long side first), or null while it is not settled
export function ngpResult(m, long) {
  if (!m || m.closed !== true) return null; let r = m.outcomePrices; try { if (typeof r === "string") r = JSON.parse(r); } catch { return null; }
  const sides = m.marketSides || [], li = sides.findIndex((x) => x && x.long); if (!Array.isArray(r) || r.length !== 2 || li < 0) return null;
  const v = Number(r[long ? li : 1 - li]);
  return v === 1 ? "W" : v === 0 ? "L" : v === 0.5 ? "P" : null;
}

// ---- saved picks: rewritten at every snapshot until tip-off (a type that stops qualifying is taken out; in the last hour a blank book never erases the
// saved picks), graded on Polymarket's own settlement once the game is over; never expire. `gprops:<date>:<game>` = { t, start, picks: [{ type, slug,
// long, label, said (%), price, cond, result }] }, every key in the set `gprops:ids`
export const K_GPROPS = (date, game) => `gprops:${date}:${game}`, GP_IDS = "gprops:ids";
export async function saveGameProps(r, g, ev, now = Date.now()) {
  if (!g || !g.poly || !g.poly.spread || g.poly.spread.homeSpread == null || !g.poly.total || g.poly.total.line == null || now >= Date.parse(g.start)) return null;
  const k = K_GPROPS(g.date, g.key);
  if (Date.parse(g.start) - now > NGP_WINDOW_MS) { await r.del(k).catch(() => 0); await r.srem(GP_IDS, k).catch(() => 0); return []; }
  const [away, home] = g.key.split(" @ "), picks = ngpPicks(ev, away, home, -Number(g.poly.spread.homeSpread), Number(g.poly.total.line))
    .map(({ hist, ...p }) => ({ ...p, said: Math.round(p.said * 1000) / 10 }));
  if (!picks.length) { if (Date.parse(g.start) - now > 3600e3) { await r.del(k).catch(() => 0); await r.srem(GP_IDS, k).catch(() => 0); } return picks; }
  await r.set(k, JSON.stringify({ t: new Date(now).toISOString(), start: g.start, picks })).catch(() => 0); await r.sadd(GP_IDS, k).catch(() => 0);
  return picks;
}
export async function loadGameProps(r, games) {
  const keys = (games || []).map((g) => K_GPROPS(g.date, g.key)); if (!keys.length) return {};
  const vals = await r.mget(...keys).catch(() => []), out = {};
  (games || []).forEach((g, i) => { try { const v = vals && vals[i] ? JSON.parse(vals[i]) : null; if (v && v.picks && v.picks.length) out[g.key] = v.picks; } catch {} });
  return out;
}
// every saved game 3+ hours after tip with a pick not yet graded -> the game's event again, each pick's market settlement
export async function gradeGameProps(r, getEvent, slugOf, now = Date.now()) {
  let n = 0;
  for (const k of await r.smembers(GP_IDS).catch(() => [])) {
    let v; try { v = JSON.parse(await r.get(k)); } catch { continue; }
    if (!v || !v.picks || !v.picks.length || v.picks.every((p) => p.result) || now - Date.parse(v.start) < 3 * 3600e3) continue;
    const game = k.slice(18); if (!game.includes(" @ ")) continue;
    const [away, home] = game.split(" @ "); let ev; try { ev = await getEvent(slugOf(away, home, v.start)); } catch { continue; }
    if (!ev) continue; let changed = false;
    const picks = v.picks.map((p) => { if (p.result) return p; const res = ngpResult((ev.markets || []).find((x) => x.slug === p.slug), p.long); if (res) { changed = true; return { ...p, result: res }; } return p; });
    if (changed) { await r.set(k, JSON.stringify({ ...v, picks, gradedAt: new Date(now).toISOString() })).catch(() => 0); n++; }
  }
  return n;
}
// the record of every saved pick from `from` (a date) on: W-L-push, pending, win % (pushes count neither way), average shown %, $ per $100 staked at the price
export async function gamePropsRecord(r, from = "") {
  const keys = (await r.smembers(GP_IDS).catch(() => [])).filter((k) => k.slice(7, 17) >= from), R = { w: 0, l: 0, push: 0, pending: 0 }; let said = 0, n = 0, stk = 0, ret = 0;
  const vals = keys.length ? await r.mget(...keys).catch(() => []) : [];
  for (const x of vals || []) { let v; try { v = JSON.parse(x); } catch { continue; }
    for (const p of (v && v.picks) || []) { if (!p.result) { R.pending++; continue; } if (p.result === "P") { R.push++; continue; } if (p.result !== "W" && p.result !== "L") continue;
      R[p.result === "W" ? "w" : "l"]++; said += Number(p.said) || 0; n++; const px = Number(p.price); if (px > 0 && px < 1) { stk += 100; ret += p.result === "W" ? 100 * (1 / px - 1) : -100; } } }
  return { ...R, pct: n ? Math.round((1000 * R.w) / n) / 10 : null, said: n ? Math.round((said / n) * 10) / 10 : null, per100: stk ? Math.round((ret / stk) * 100) : null };
}
