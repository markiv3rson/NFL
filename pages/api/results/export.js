import { getRedis, K } from "../../../lib/redis";
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers(K.resIds)) || [];
    const raw = ids.length ? await redis.mget(ids.map((id) => `res:${id}`)) : [];
    res.setHeader("Content-Disposition", "attachment; filename=nfl-bettors-results.json");
    res.status(200).json({ exportedAt: new Date().toISOString(), results: raw.filter(Boolean).map((r) => JSON.parse(r)) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
