import { getRedis, K } from "../../../lib/redis";
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers(K.resIds)) || [];
    const raw = ids.length ? await redis.mget(ids.map((id) => `res:${id}`)) : [];
    const results = raw.filter(Boolean).map((r) => JSON.parse(r)).sort((a, b) => b.week - a.week || a.game.localeCompare(b.game));
    res.status(200).json({ ok: true, results });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
