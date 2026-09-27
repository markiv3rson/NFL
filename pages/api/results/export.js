import { getRedis, K } from "../../../lib/redis";
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers(K.resIds)) || [];
    const raw = ids.length ? await redis.mget(ids.map((id) => `res:${id}`)) : [];
    const logs = {};
    let cursor = "0";
    do { const [next, keys] = await redis.scan(cursor, "MATCH", "rerunlog:*", "COUNT", 200); cursor = next;
      for (const k of keys) logs[k] = (await redis.lrange(k, 0, -1)).map((x) => JSON.parse(x)); } while (cursor !== "0");
    res.setHeader("Content-Disposition", "attachment; filename=nfl-bettors-results.json");
    res.status(200).json({ exportedAt: new Date().toISOString(), results: raw.filter(Boolean).map((r) => JSON.parse(r)), rerunHistory: logs });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
