// Pinnacle every 30 minutes (10/13, owner: "build both"). Called by the Railway scheduler. Saves Pinnacle's main spread/total for every
// upcoming game, plus Polymarket's main spread/total read at the same moment, so "Pinnacle moved first, Polymarket hasn't caught up"
// can be tested. RECORDED ONLY -- nothing shown or picked until tested. A failure is logged.
import { savePinnacle, pinnacleFailed, pinnacleOk } from "../../lib/pinnacle";
import { SEASON } from "../../lib/games";
import { getRedis } from "../../lib/redis";
import { fetchEvents, gameLines, bookDepth, playerProps } from "../../lib/poly";
import { recordProps } from "../../lib/props";
import { getJSON, setJSON, pushCapped, K } from "../../lib/redis";
import { isThinMarket } from "../../lib/odds";
import { lineMovePick, lineMoveTotalPick } from "../../lib/stack";
import { tkey } from "../../lib/tracked";
import { logError } from "../../lib/status";
import { sanePoly } from "../../lib/sane";
export const config = { maxDuration: 60 };
// SHADOW picks (10/14, owner: "build everything now"). Recorded and graded, NOT shown, NOT picks until they hold live:
//  1. PINNACLE LINE MOVE: the LINE MOVE rules (spread: crossed 3/7 and moved 1+, or moved 3+; total: 3+ apart) with PINNACLE in place of
//     the books' consensus, vs Polymarket read at the same moment -> the Pinnacle side at Polymarket's number. Saved the first time it fires.
//  2. ORDER-BOOK TILT: one side of Polymarket's main market has 4x+ the money resting near the top (and $1,000+) -> that side at
//     Polymarket's number. Spread book = home side (bids = buyers of home); total book = Over side. Saved the first time it fires.
export async function recordShadow(redis, season, g, p, pin, sb, tb, t) {
  if (!g || g.week == null || !p) return 0; const k = tkey(season, g.week); let n = 0;
  const put = async (f, v) => { n += (await redis.hsetnx(k, `${g.key}|${f}`, JSON.stringify({ game: g.key, week: g.week, t, ...v }))) ? 1 : 0; };
  if (pin && pin.hs != null) { const x = lineMovePick(g, p, { spread: { homeSpread: pin.hs } }); if (x) await put("pinlm", { kind: "spread", pinlm: true, team: x.team, line: x.line, pin: pin.hs, poly: p.spread.homeSpread }); }
  if (pin && pin.tl != null) { const x = lineMoveTotalPick(g, p, { total: { line: pin.tl } }); if (x) await put("pinlmT", { kind: "total", pinlm: true, side: x.side, line: x.line, pin: pin.tl, poly: p.total.line }); }
  const tilt = (b) => (b && b.bd != null && b.ad != null && Math.max(b.bd, b.ad) >= 1000 ? (b.bd >= 4 * Math.max(b.ad, 1) ? 1 : b.ad >= 4 * Math.max(b.bd, 1) ? -1 : 0) : 0);
  const live = (a, b) => a > 0.1 && a < 0.9 && b > 0.1 && b < 0.9;   // review fix: skip dead / placeholder books, like LINE MOVE
  const ts = tilt(sb); if (ts && p.spread && live(Number(p.spread.home), Number(p.spread.away))) { const home = ts > 0, P = p.spread.homeSpread; await put("tilt", { kind: "spread", tilt: true, team: home ? g.home : g.away, line: home ? P : -P, bd: sb.bd, ad: sb.ad }); }
  const tt = tilt(tb); if (tt && p.total && live(Number(p.total.over), Number(p.total.under))) await put("tiltT", { kind: "total", tilt: true, side: tt > 0 ? "over" : "under", line: p.total.line, bd: tb.bd, ad: tb.ad });
  return n;
}
// TD prices every 30 min (10/16, owner: "get me my prices"): the scheduled snapshots (7 AM / 3 PM / 7 PM) were the only TD price refresh, so a market Polymarket
// posted in the morning showed no price -- and no parlay payout -- until the afternoon. The pull now merges the live prices into the saved set: new players are
// added, ordinary moves are taken, a price that HALVED is left to the snapshot's glitch guard (3 checks). Same history list as the snapshot (src "pin30").
export async function mergeTdPrices(redis, season, g, px, t) {
  if (!px || !g || g.week == null) return 0; const key = K.tdpx(season, g.week, g.key), old = (await getJSON(key)) || null, rec = (v) => (v == null ? null : typeof v === "number" ? { ask: v } : v);
  const real = (v) => v && !isThinMarket(v.ask, v.bid ?? null), out = { ...(old || {}) }; let changed = 0;
  for (const [q, v] of Object.entries(px)) { const n = rec(v), o = old ? rec(old[q]) : null; if (!n || !(n.ask > 0)) continue;
    if (o && real(o) && real(n) && n.ask < o.ask * 0.5) continue;   // a halving waits for the snapshot guard
    if (!o || o.ask !== n.ask || (o.bid ?? null) !== (n.bid ?? null)) { out[q] = v; changed++; } }
  if (!changed) return 0;
  await setJSON(key, out);
  const compact = {}; for (const [q, v] of Object.entries(out)) { const o = rec(v); if (o && o.ask > 0) compact[q] = [o.ask, o.bid ?? null]; }
  await pushCapped(redis, `tdpxhist:${season}:${g.week}:${g.key}`, JSON.stringify({ t, src: "pin30", p: compact }), 150);
  return changed;
}
export default async function handler(req, res) {
  const t = new Date().toISOString();
  try {
    const events = await fetchEvents().catch(() => []);
    // 10/14 (owner: "go"): plus each main market's order book -- dollars within 5c of the best bid (bd) / ask (ad), best bid/ask
    // (bb/ba) -- and Polymarket's running volume / liquidity (vol/liq; volume per 30 min = difference between records). Spread book =
    // home side, total book = Over side. Recorded only.
    // 10/14 fix: same sanity check as the snapshots (a line 6+ from the schedule's sportsbook line is an alternate read as the main one)
    const polyFor = async (g, pin) => { const raw = await gameLines(events, g.away, g.home); if (!raw) return null; const p = sanePoly(raw, g.nvSpread, g.nvTotal).poly;
      if (raw._mkt) Object.defineProperty(p, "_mkt", { value: { ...(raw._mkt.spread && p.spread ? { spread: raw._mkt.spread } : {}), ...(raw._mkt.total && p.total ? { total: raw._mkt.total } : {}) }, enumerable: false });
      const M = p._mkt || {}, mk = async (x) => (x ? { ...((await bookDepth(x.tok).catch(() => null)) || {}), vol: x.vol, liq: x.liq } : null);
      const [sb, tb] = await Promise.all([mk(M.spread), mk(M.total)]);
      if (g.week != null && (raw.alts || raw.talts)) await getRedis().set(`alts:${SEASON}:${g.week}:${g.key}`, JSON.stringify({ t, alts: raw.alts || null, talts: raw.talts || null })).catch(() => 0);   // 10/15: alternate prices refresh every 30 min (the card drops them after 3 h; snapshots alone left them stale)
      await recordShadow(getRedis(), SEASON, g, p, pin, sb, tb, t).catch(() => 0);
      const pp = await playerProps(events, g.away, g.home).catch(() => null);   // one read of the "-player-props" event
      if (pp) { await mergeTdPrices(getRedis(), SEASON, g, pp.td, t).catch(() => 0);   // TD prices every 15 min (10/16)
        await recordProps(getRedis(), SEASON, g, pp.stats, t).catch(() => 0); }   // player stat props, first + latest price (10/17)
      return { hs: p.spread ? p.spread.homeSpread : null, h: p.spread ? p.spread.home : null, tl: p.total ? p.total.line : null, o: p.total ? p.total.over : null,
        ...(sb ? { sb } : {}), ...(tb ? { tb } : {}) }; };
    const n = await savePinnacle(getRedis(), SEASON, t, "pin30", polyFor); await pinnacleOk(getRedis());
    await getRedis().set("auto:last", JSON.stringify({ t, what: "Pinnacle pull (30 min)" })).catch(() => {});   // 10/14: the scheduler's liveness signal every 30 min (snapshots leave a 12-16 h overnight gap)
    res.status(200).json({ ok: true, games: n });
  } catch (e) { const msg = String(e).slice(0, 120); await pinnacleFailed(getRedis(), msg, logError); res.status(200).json({ ok: false, error: msg }); }
}
