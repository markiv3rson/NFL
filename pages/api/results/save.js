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
    // One record per week+game: re-saving overwrites instead of duplicating,
    // but never overwrites a game that's already been graded.
    const id = `${String(week || "wk").replace(/\s+/g, "")}-${game.replace(/\s+/g, "")}`;
    const existing = await redis.get(`result:${id}`);
    if (existing && JSON.parse(existing).graded) return res.status(200).json({ ok: true, id, skipped: "already graded" });
    const record = { id, game, week, modelSpread, modelTotal, modelWinPct, marketSpread, marketTotal, marketML, leanSide, leanPct, savedAt: new Date().toISOString(), graded: false };
    await redis.set(`result:${id}`, JSON.stringify(record));
    await redis.sadd("result:ids", id);
    return res.status(200).json({ ok: true, id });
  } catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
}
