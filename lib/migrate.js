// 10/28 (owner: "move the NFL over too, do this cleanly"): one-time copy of both old databases into the new shared one (NBA_DB_URL_REDIS_URL).
// The site already reads and writes the new database when this runs, so the copy only ADDS what is missing and never overwrites anything written
// since the switch: a string is set only if absent, a hash gets only the fields it lacks, a list gets the old entries in FRONT of any newer ones
// (lists are saved oldest-first), a set / sorted set gets the missing members. Keys keep their time to live. NBA keys land under "nba:".
export const MIGRATE_SOURCES = { nfl: { env: "UPSTASH_REDIS_REST_URL_REDIS_URL", prefix: "" }, nba: { env: "NBA_REDIS_URL", prefix: "nba:" } };

// rows = [{ key, type, v, ttl }] (ttl in ms, or null) -> writes them into dst under prefix
export async function writeRows(dst, rows, prefix = "") {
  const out = { strings: 0, lists: 0, hashes: 0, sets: 0, zsets: 0, kept: 0, failed: 0 };
  for (const { key, type, v, ttl } of rows) {
    const k = prefix + key;
    try {
      if (type === "string") {
        const ok = ttl > 0 ? await dst.set(k, v, "PX", ttl, "NX") : await dst.set(k, v, "NX");
        if (ok) out.strings++; else out.kept++;
        continue;
      }
      if (type === "list") {
        if (!v || !v.length) continue;
        if (await dst.exists(k)) await dst.lpush(k, ...[...v].reverse()); else await dst.rpush(k, ...v);
        out.lists++;
      } else if (type === "hash") {
        const f = Object.entries(v || {}); if (!f.length) continue;
        const p = dst.pipeline(); for (const [a, b] of f) p.hsetnx(k, a, b); await p.exec(); out.hashes++;
      } else if (type === "set") {
        if (!v || !v.length) continue; await dst.sadd(k, ...v); out.sets++;
      } else if (type === "zset") {
        if (!v || !v.length) continue; const args = []; for (let i = 0; i < v.length; i += 2) args.push(v[i + 1], v[i]);
        await dst.zadd(k, "NX", ...args); out.zsets++;
      } else continue;
      if (ttl > 0) await dst.pexpire(k, ttl);
    } catch { out.failed++; }
  }
  return out;
}

// one page of the source database (by SCAN cursor) -> rows
export async function readPage(src, cursor, count = 200) {
  const [next, keys] = await src.scan(cursor, "COUNT", count);
  if (!keys.length) return { next, rows: [] };
  const types = await src.pipeline(keys.map((k) => ["type", k])).exec();
  const reads = await src.pipeline(keys.map((k, i) => { const t = types[i][1];
    return t === "list" ? ["lrange", k, 0, -1] : t === "set" ? ["smembers", k] : t === "hash" ? ["hgetall", k] : t === "zset" ? ["zrange", k, 0, -1, "WITHSCORES"] : ["get", k]; })).exec();
  const ttls = await src.pipeline(keys.map((k) => ["pttl", k])).exec();
  const rows = keys.map((k, i) => ({ key: k, type: types[i][1], v: reads[i][1], ttl: Number(ttls[i][1]) > 0 ? Number(ttls[i][1]) : null })).filter((r) => r.v != null && r.type !== "none");
  return { next, rows };
}
