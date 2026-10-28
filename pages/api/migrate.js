// 10/28: ONE-TIME copy of the old NFL and NBA databases into the new shared one (lib/migrate.js). Guarded: the caller must send `x-migrate-key` =
// the first 24 hex of the sha256 of the new database's address, which only someone holding that address can make. Paged by SCAN cursor:
// GET ?src=nfl|nba&cursor=0 -> { next, ... } until next is "0". POST ?src=nba with { rows: [...] } = a fallback from a saved backup when the old
// database cannot be read. Remove after the move.
import Redis from "ioredis";
import crypto from "crypto";
import { MIGRATE_SOURCES, readPage, writeRows } from "../../lib/migrate";
export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: "4mb" } } };
export const migrateKey = (url) => crypto.createHash("sha256").update(String(url || "")).digest("hex").slice(0, 24);
const conn = {};
const client = (url) => (conn[url] = conn[url] || new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 8000 }));
export default async function handler(req, res) {
  const dstUrl = process.env.NBA_DB_URL_REDIS_URL, S = MIGRATE_SOURCES[String(req.query.src || "")];
  if (!dstUrl || !S) return res.status(400).json({ ok: false, error: "no new database or unknown src" });
  if (req.headers["x-migrate-key"] !== migrateKey(dstUrl)) return res.status(403).json({ ok: false, error: "forbidden" });
  const dst = client(dstUrl);
  try {
    if (req.method === "POST") {
      const rows = (req.body && req.body.rows) || [];
      return res.status(200).json({ ok: true, from: "backup", n: rows.length, ...(await writeRows(dst, rows, S.prefix)) });
    }
    const srcUrl = process.env[S.env]; if (!srcUrl || srcUrl === dstUrl) return res.status(400).json({ ok: false, error: "no old database" });
    const src = client(srcUrl), t0 = Date.now(), tot = { keys: 0 };
    let cursor = String(req.query.cursor || "0");
    do {
      const { next, rows } = await readPage(src, cursor); cursor = next; tot.keys += rows.length;
      const w = await writeRows(dst, rows, S.prefix); for (const [a, b] of Object.entries(w)) tot[a] = (tot[a] || 0) + b;
    } while (cursor !== "0" && Date.now() - t0 < 40e3);
    res.status(200).json({ ok: true, src: req.query.src, next: cursor, ...tot });
  } catch (e) { res.status(200).json({ ok: false, error: String((e && e.message) || e).slice(0, 300) }); }
}
