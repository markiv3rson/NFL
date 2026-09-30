import { getRedis, getJSON, K } from "../../../lib/redis";
import { SEASON } from "../../../lib/games";
import { edgeSummary } from "../../../lib/edges";
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers(K.resIds)) || [];
    const raw = ids.length ? await redis.mget(ids.map((id) => `res:${id}`)) : [];
    const results = raw.filter(Boolean).map((r) => JSON.parse(r)).sort((a, b) => b.week - a.week || a.game.localeCompare(b.game));
    // This season only (9/30: after a rollover the Record tab mixed seasons); edge stats computed live, not from the last grading
    res.status(200).json({ ok: true, results: results.filter((r) => Number(r.season) === SEASON), edges: await edgeSummary(SEASON).catch(() => null) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
