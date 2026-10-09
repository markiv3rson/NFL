import { getRedis, K, jparse } from "../../../lib/redis";
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers(K.resIds)) || [];
    const raw = ids.length ? await redis.mget(ids.map((id) => `res:${id}`)) : [];
    const logs = {};
    let cursor = "0";
    do { const [next, keys] = await redis.scan(cursor, "MATCH", "rerunlog:*", "COUNT", 200); cursor = next;
      for (const k of keys) logs[k] = (await redis.lrange(k, 0, -1)).map((x) => JSON.parse(x)); } while (cursor !== "0");
    // Line history (10/9): every saved Polymarket spread/total/moneyline snapshot per game, the kickoff (closing) copy and the
    // model's numbers, so opening-vs-closing tests can be run on the export. Only the fields those tests need.
    const lines = {}, models = {}; cursor = "0";
    const slim = (p) => (p ? { spread: p.spread ? { homeSpread: p.spread.homeSpread, home: p.spread.home, away: p.spread.away } : null,
      total: p.total ? { line: p.total.line, over: p.total.over, under: p.total.under } : null, ml: p.ml ? { home: p.ml.home, away: p.ml.away } : null } : null);
    do { const [next, keys] = await redis.scan(cursor, "MATCH", "snap:*", "COUNT", 200); cursor = next;
      for (const k of keys) { const [, s, w, ...g] = k.split(":"), game = g.join(":"), id = `${s}:${w}:${game}`;
        const snaps = (await redis.lrange(k, 0, -1)).map((x) => jparse(x)).filter((x) => x && x.poly).map((x) => ({ t: x.t, src: x.src || null, ...slim(x.poly) }));
        const close = jparse(await redis.get(K.close(s, w, game)));
        lines[id] = { snaps, close: close ? { t: close.t, ...slim(close.poly) } : null };
        if (!models[`${s}:${w}`]) { const m = jparse(await redis.get(K.model(s, w))); models[`${s}:${w}`] = m && m.games ? Object.fromEntries(Object.entries(m.games).map(([gk, v]) => [gk, { homeMargin: v.homeMargin ?? null, total: v.total ?? null, homeWinPct: v.homeWinPct ?? null, runAt: v.runAt || null }])) : null; } } } while (cursor !== "0");
    res.setHeader("Content-Disposition", "attachment; filename=nfl-bettors-results.json");
    res.status(200).json({ exportedAt: new Date().toISOString(), results: raw.filter(Boolean).map((r) => JSON.parse(r)), rerunHistory: logs, lines, models });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
export const config = { maxDuration: 60 };
