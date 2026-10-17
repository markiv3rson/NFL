// NBA nightly backup (10/17: the NBA database had none after the move into the combined site). Same paging as the NFL's /api/backup:
// ?cursor=0 -> up to ~2 MB of keys plus the next cursor; the NBA Railway scheduler keeps asking until the cursor is "0" and saves one file.
// ?mark=volume|temporary|failed&files=N -> the scheduler reports how the save went (status:backup, shown on the Models tab).
import { getRedis } from "../../../nba/lib/redis";
export const config = { maxDuration: 60 };
const BUDGET = 2_000_000;
export default async function handler(req, res) {
  try {
    const r = getRedis();
    if (req.query.mark) {
      await r.set("status:backup", JSON.stringify({ t: new Date().toISOString(), where: String(req.query.mark), files: Number(req.query.files) || null }));
      return res.status(200).json({ ok: true });
    }
    const out = {};
    let cursor = String(req.query.cursor || "0"), size = 0;
    do {
      const [next, keys] = await r.scan(cursor, "COUNT", 50); cursor = next;
      if (keys.length) {
        const types = await r.pipeline(keys.map((k) => ["type", k])).exec();
        const reads = await r.pipeline(keys.map((k, i) => {
          const t = types[i][1];
          return t === "list" ? ["lrange", k, 0, -1] : t === "set" ? ["smembers", k] : t === "hash" ? ["hgetall", k] : t === "zset" ? ["zrange", k, 0, -1, "WITHSCORES"] : ["get", k];
        })).exec();
        keys.forEach((k, i) => {
          const t = types[i][1], v = reads[i][1];
          out[k] = t === "list" || t === "set" || t === "hash" || t === "zset" ? { type: t, v } : { type: "string", v };
          size += k.length + (JSON.stringify(v ?? null) || "").length;
        });
      }
    } while (cursor !== "0" && size < BUDGET);
    res.status(200).json({ ok: true, t: new Date().toISOString(), keys: Object.keys(out).length, next: cursor, data: out });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
