// Pinnacle every 30 minutes (10/13, owner: "build both"). Called by the Railway scheduler. Saves Pinnacle's main spread/total for every
// upcoming game, plus Polymarket's main spread/total read at the same moment, so "Pinnacle moved first, Polymarket hasn't caught up"
// can be tested. RECORDED ONLY -- nothing shown or picked until tested. A failure is logged.
import { savePinnacle } from "../../lib/pinnacle";
import { SEASON } from "../../lib/games";
import { getRedis } from "../../lib/redis";
import { fetchEvents, gameLines, bookDepth } from "../../lib/poly";
import { lineMovePick, lineMoveTotalPick } from "../../lib/stack";
import { tkey } from "../../lib/teaser";
import { logError } from "../../lib/status";
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
  const ts = tilt(sb); if (ts && p.spread) { const home = ts > 0, P = p.spread.homeSpread; await put("tilt", { kind: "spread", tilt: true, team: home ? g.home : g.away, line: home ? P : -P, bd: sb.bd, ad: sb.ad }); }
  const tt = tilt(tb); if (tt && p.total) await put("tiltT", { kind: "total", tilt: true, side: tt > 0 ? "over" : "under", line: p.total.line, bd: tb.bd, ad: tb.ad });
  return n;
}
export default async function handler(req, res) {
  const t = new Date().toISOString();
  try {
    const events = await fetchEvents().catch(() => []);
    // 10/14 (owner: "go"): plus each main market's order book -- dollars within 5c of the best bid (bd) / ask (ad), best bid/ask
    // (bb/ba) -- and Polymarket's running volume / liquidity (vol/liq; volume per 30 min = difference between records). Spread book =
    // home side, total book = Over side. Recorded only.
    const polyFor = async (g, pin) => { const p = await gameLines(events, g.away, g.home); if (!p) return null;
      const M = p._mkt || {}, mk = async (x) => (x ? { ...((await bookDepth(x.tok).catch(() => null)) || {}), vol: x.vol, liq: x.liq } : null);
      const [sb, tb] = await Promise.all([mk(M.spread), mk(M.total)]);
      await recordShadow(getRedis(), SEASON, g, p, pin, sb, tb, t).catch(() => 0);
      return { hs: p.spread ? p.spread.homeSpread : null, h: p.spread ? p.spread.home : null, tl: p.total ? p.total.line : null, o: p.total ? p.total.over : null,
        ...(sb ? { sb } : {}), ...(tb ? { tb } : {}) }; };
    const n = await savePinnacle(getRedis(), SEASON, t, "pin30", polyFor);
    res.status(200).json({ ok: true, games: n });
  } catch (e) { const msg = String(e).slice(0, 120); await logError("pinnacle", `Pinnacle lines pull failed: ${msg}`).catch(() => {}); res.status(200).json({ ok: false, error: msg }); }
}
