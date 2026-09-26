import Redis from "ioredis";
let client;
function getRedis() {
  if (!client) client = new Redis(process.env.UPSTASH_REDIS_REST_URL_REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
  return client;
}
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers("result:ids")) || [];
    if (!ids.length) return res.status(200).json({ ok: true, results: [] });
    const raw = await redis.mget(ids.map((id) => `result:${id}`));
    const results = raw.filter(Boolean).map((r) => JSON.parse(r)).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    return res.status(200).json({ ok: true, results });
  } catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
}
