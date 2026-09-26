import Redis from "ioredis";
let client;
function getRedis() {
  if (!client) client = new Redis(process.env.UPSTASH_REDIS_REST_URL_REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
  return client;
}
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  try {
    const redis = getRedis();
    const { game, week, modelSpread, modelTotal, modelWinPct, marketSpread, marketTotal, marketML, leanSide, leanPct } = req.body;
    if (!game) return res.status(400).json({ ok: false, error: "game is required" });
    const id = `${week || "wk"}-${game.replace(/\s+/g, "")}-${Date.now()}`;
    const record = { id, game, week, modelSpread, modelTotal, modelWinPct, marketSpread, marketTotal, marketML, leanSide, leanPct, savedAt: new Date().toISOString(), graded: false };
    await redis.set(`result:${id}`, JSON.stringify(record));
    await redis.sadd("result:ids", id);
    return res.status(200).json({ ok: true, id });
  } catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
}
