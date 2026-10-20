// Pinnacle every 30 minutes (10/13, owner: "build both"). Called by the Railway scheduler. Saves Pinnacle's main spread/total for every
// upcoming game, plus Polymarket's main spread/total read at the same moment, so "Pinnacle moved first, Polymarket hasn't caught up"
// can be tested. RECORDED ONLY -- nothing shown or picked until tested. A failure is logged.
import { savePinnacle, pinnacleFailed, pinnacleOk } from "../../lib/pinnacle";
import { SEASON } from "../../lib/games";
import { getRedis } from "../../lib/redis";
import { fetchEvents, gameLines, playerProps } from "../../lib/poly";
import { recordProps } from "../../lib/props";
import { getJSON, setJSON, pushCapped, K } from "../../lib/redis";
import { isThinMarket } from "../../lib/odds";
import { logError } from "../../lib/status";
import { sanePoly } from "../../lib/sane";
export const config = { maxDuration: 60 };
// 10/19 review (owner: "delete what is not helping"): the PINNACLE LINE MOVE and ORDER-BOOK TILT shadow picks are gone -- Pinnacle LINE MOVE never fired in
// weeks 3-6 (Polymarket follows the books), the tilt went 3-2; the two order-book reads per game they needed are gone too. Old rows stay graded history.
// TD prices every 30 min (10/16, owner: "get me my prices"): the scheduled snapshots (7 AM / 3 PM / 7 PM) were the only TD price refresh, so a market Polymarket
// posted in the morning showed no price -- and no parlay payout -- until the afternoon. The pull now merges the live prices into the saved set: new players are
// added, ordinary moves are taken, a price that HALVED is left to the snapshot's glitch guard (3 checks). Same history list as the snapshot (src "pin30").
export async function mergeTdPrices(redis, season, g, px, t) {
  if (!px || !g || g.week == null) return 0; const key = K.tdpx(season, g.week, g.key), old = (await getJSON(key)) || null, rec = (v) => (v == null ? null : typeof v === "number" ? { ask: v } : v);
  // 10/17: a player Polymarket no longer lists (or the old source's wording) is dropped, as the snapshot does
  const real = (v) => v && !isThinMarket(v.ask, v.bid ?? null), out = {}; let changed = Object.keys(old || {}).filter((q) => !(q in px)).length;
  for (const [q, v] of Object.entries(px)) { const n = rec(v), o = old ? rec(old[q]) : null; if (!n || !(n.ask > 0)) { if (o) out[q] = old[q]; continue; }
    if (o && real(o) && real(n) && n.ask < o.ask * 0.5) { out[q] = old[q]; continue; }   // a halving waits for the snapshot guard
    out[q] = v; if (!o || o.ask !== n.ask || (o.bid ?? null) !== (n.bid ?? null)) changed++; }
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
    // 10/14 fix: same sanity check as the snapshots (a line 6+ from the schedule's sportsbook line is an alternate read as the main one)
    const polyFor = async (g, pin) => { const raw = await gameLines(events, g.away, g.home); if (!raw) return null; const p = sanePoly(raw, g.nvSpread, g.nvTotal).poly;
      // 10/17 (owner: "Polymarket prices should update in the background"): the main spread / total / moneyline read here every 15 min is kept as the
      // game's newest Polymarket line (`polynow:`); the slate shows it when it is newer than the last snapshot (lib/week.js). Snapshots stay as they were.
      if (g.week != null && (p.spread || p.total || p.ml)) await getRedis().set(`polynow:${SEASON}:${g.week}:${g.key}`, JSON.stringify({ t, poly: { ...(p.spread ? { spread: p.spread } : {}), ...(p.total ? { total: p.total } : {}), ...(p.ml ? { ml: p.ml } : {}) } }), "EX", 4 * 86400).catch(() => 0);
      if (g.week != null && (raw.alts || raw.talts)) await getRedis().set(`alts:${SEASON}:${g.week}:${g.key}`, JSON.stringify({ t, alts: raw.alts || null, talts: raw.talts || null })).catch(() => 0);   // 10/15: alternate prices refresh every 30 min (the card drops them after 3 h; snapshots alone left them stale)
      const pp = await playerProps(events, g.away, g.home).catch(() => null);   // one read of the "-player-props" event
      if (pp) { await mergeTdPrices(getRedis(), SEASON, g, pp.td, t).catch(() => 0);   // TD prices every 15 min (10/16)
        await recordProps(getRedis(), SEASON, g, pp.stats, t).catch(() => 0); }   // player stat props, first + latest price (10/17)
      return { hs: p.spread ? p.spread.homeSpread : null, h: p.spread ? p.spread.home : null, tl: p.total ? p.total.line : null, o: p.total ? p.total.over : null }; };
    const n = await savePinnacle(getRedis(), SEASON, t, "pin30", polyFor); await pinnacleOk(getRedis());
    await getRedis().set("auto:last", JSON.stringify({ t, what: "Pinnacle pull (30 min)" })).catch(() => {});   // 10/14: the scheduler's liveness signal every 30 min (snapshots leave a 12-16 h overnight gap)
    res.status(200).json({ ok: true, games: n });
  } catch (e) { const msg = String(e).slice(0, 120); await pinnacleFailed(getRedis(), msg, logError); res.status(200).json({ ok: false, error: msg }); }
}
