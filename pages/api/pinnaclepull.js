// Pinnacle every 30 minutes (10/13, owner: "build both"). Called by the Railway scheduler. Saves Pinnacle's main spread/total for every
// upcoming game, plus Polymarket's main spread/total read at the same moment, so "Pinnacle moved first, Polymarket hasn't caught up"
// can be tested. RECORDED ONLY -- nothing shown or picked until tested. A failure is logged.
import { savePinnacle } from "../../lib/pinnacle";
import { SEASON } from "../../lib/games";
import { getRedis } from "../../lib/redis";
import { fetchEvents, gameLines, bookDepth } from "../../lib/poly";
import { logError } from "../../lib/status";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  const t = new Date().toISOString();
  try {
    const events = await fetchEvents().catch(() => []);
    // 10/14 (owner: "go"): plus each main market's order book -- dollars within 5c of the best bid (bd) / ask (ad), best bid/ask
    // (bb/ba) -- and Polymarket's running volume / liquidity (vol/liq; volume per 30 min = difference between records). Spread book =
    // home side, total book = Over side. Recorded only.
    const polyFor = async (g) => { const p = await gameLines(events, g.away, g.home); if (!p) return null;
      const M = p._mkt || {}, mk = async (x) => (x ? { ...((await bookDepth(x.tok).catch(() => null)) || {}), vol: x.vol, liq: x.liq } : null);
      const [sb, tb] = await Promise.all([mk(M.spread), mk(M.total)]);
      return { hs: p.spread ? p.spread.homeSpread : null, h: p.spread ? p.spread.home : null, tl: p.total ? p.total.line : null, o: p.total ? p.total.over : null,
        ...(sb ? { sb } : {}), ...(tb ? { tb } : {}) }; };
    const n = await savePinnacle(getRedis(), SEASON, t, "pin30", polyFor);
    res.status(200).json({ ok: true, games: n });
  } catch (e) { const msg = String(e).slice(0, 120); await logError("pinnacle", `Pinnacle lines pull failed: ${msg}`).catch(() => {}); res.status(200).json({ ok: false, error: msg }); }
}
