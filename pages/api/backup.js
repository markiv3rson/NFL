// Full dump of every stored key (logs, grades, snapshots, model runs, bets) for the nightly backup.
import { getRedis } from "../../lib/redis";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const r = getRedis(), out = {};
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "COUNT", 500); cursor = next;
      for (const k of keys) {
        const type = await r.type(k);
        out[k] = type === "list" ? { type, v: await r.lrange(k, 0, -1) } : type === "set" ? { type, v: await r.smembers(k) } : { type: "string", v: await r.get(k) };
      }
    } while (cursor !== "0");
    res.status(200).json({ ok: true, t: new Date().toISOString(), keys: Object.keys(out).length, data: out });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
