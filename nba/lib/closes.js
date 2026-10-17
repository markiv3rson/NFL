// Closing-line recorder. The free line history we train on (a public file of sportsbook closing lines) stops in January 2026 and is
// not kept up, so patterns that need "how did this team do against the line lately" would go silent in-season. Every snapshot saves
// each game's latest pre-tip-off Polymarket line (spread, total, moneyline chance); the last save before tip-off is the close.
// The model service reads them from /api/closes at every rebuild and fills the gap (railway-model-service/nba_data.py).
import { getRedis, jparse, mgetAll } from "./redis";
const IDS = "close:ids";
export const closeKey = (date, game) => `close:${date}:${game}`;
export async function recordCloses(games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (!g.poly || now >= Date.parse(g.start)) continue;                 // only lines seen BEFORE tip-off are closing lines
    const px = g.poly, ml = px.ml;
    const row = { date: g.date, game: g.key, away: g.away, home: g.home, start: g.start,
      hs: px.spread ? px.spread.homeSpread : null, tl: px.total ? px.total.line : null,
      mlHome: ml ? ml.midHome / (ml.midHome + ml.midAway) : null, t: new Date(now).toISOString() };
    if (row.hs == null && row.tl == null && row.mlHome == null) continue;
    const key = closeKey(g.date, g.key);
    const old = jparse(await r.get(key).catch(() => null));
    // keep the previous value of anything that disappeared (a market can close before the game does)
    if (old) for (const k of ["hs", "tl", "mlHome"]) if (row[k] == null && old[k] != null) row[k] = old[k];
    await r.set(key, JSON.stringify(row)); await r.sadd(IDS, key); n++;
  }
  return n;
}
// Lines of games that have started (so the line is final). `since` = YYYY-MM-DD, optional.
export async function loadCloses({ since = null, now = Date.now() } = {}) {
  const r = getRedis(), out = [], keys = await r.smembers(IDS), vals = await mgetAll(r, keys);
  for (const [i] of keys.entries()) {
    const v = jparse(vals[i]); if (!v || now < Date.parse(v.start)) continue;
    if (since && v.date < since) continue;
    out.push(v);
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}
