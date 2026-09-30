// Full dump of every stored key (logs, grades, snapshots, model runs, bets) for the nightly backup, in PAGES.
// Before 9/28 it returned everything in one reply. The database is ~3.9 MB and the dump re-escapes every value, so the
// reply grows past Vercel's 4.5 MB response limit; the platform then returns an error page instead of data, which is
// the likely reason the status panel still says "Last backup: none yet". Now: ?cursor=0 → up to ~2 MB of keys plus
// the next cursor; the Railway scheduler keeps asking until cursor comes back "0" and saves one combined file.
import { getRedis } from "../../lib/redis";
export const config = { maxDuration: 60 };
const BUDGET = 2_000_000;
export default async function handler(req, res) {
  try {
    const r = getRedis(), out = {};
    let cursor = String(req.query.cursor || "0"), size = 0, first = true;
    do {
      const [next, keys] = await r.scan(cursor, "COUNT", 50); cursor = next; first = false;
      if (keys.length) {
        const types = await r.pipeline(keys.map((k) => ["type", k])).exec();
        const reads = await r.pipeline(keys.map((k, i) => {
          const t = types[i][1];
          return t === "list" ? ["lrange", k, 0, -1] : t === "set" ? ["smembers", k] : ["get", k];
        })).exec();
        keys.forEach((k, i) => {
          const t = types[i][1], v = reads[i][1];
          out[k] = t === "list" || t === "set" ? { type: t, v } : { type: "string", v };
          size += k.length + JSON.stringify(v).length;
        });
      }
    } while (cursor !== "0" && size < BUDGET);
    res.status(200).json({ ok: true, t: new Date().toISOString(), keys: Object.keys(out).length, next: cursor, data: out });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
