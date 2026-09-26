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
    const raw = await redis.mget(ids.map((id) => `result:${id}`));
    const results = raw.filter(Boolean).map((r) => JSON.parse(r));
    res.setHeader("Content-Disposition", "attachment; filename=slate-scanner-results.json");
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify({ exportedAt: new Date().toISOString(), results }, null, 2));
  } catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
}
