import Redis from "ioredis";
let client;
// With no Redis configured (a local run) the site still works: a small in-memory stand-in, nothing is kept between restarts.
class MemRedis {
  constructor() { this.m = new Map(); this.s = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async mget(...keys) { return keys.flat().map((k) => (this.m.has(k) ? this.m.get(k) : null)); }
  async set(k, v, ...args) { if (args.map((x) => String(x).toUpperCase()).includes("NX") && this.m.has(k)) return null; this.m.set(k, String(v)); return "OK"; }
  async exists(k) { return this.m.has(k) ? 1 : 0; }
  async sadd(k, v) { const x = this.s.get(k) || new Set(); x.add(v); this.s.set(k, x); return 1; }
  async srem(k, v) { const x = this.s.get(k); return x && x.delete(v) ? 1 : 0; }
  async del(...keys) { let n = 0; for (const k of keys.flat()) { if (this.m.delete(k)) n++; if (this.s.delete(k)) n++; } return n; }
  async smembers(k) { return [...(this.s.get(k) || [])]; }
}
// 10/28: the NBA Upstash database hit its free plan's 500,000 requests a month at 7:30 PM PT 10/27 and refused every write. NBA now lives in the
// paid 250 MB Redis Cloud database it shares with NFL (NBA_DB_URL_REDIS_URL), every NBA key under "nba:" so no name can touch an NFL key. The old
// Upstash database and its NBA_REDIS_URL setting were deleted by the owner the same day. No address -> the in-memory stand-in (tests, local runs).
export const NBA_PREFIX = "nba:";
const okUrl = (v) => (typeof v === "string" && /^rediss?:\/\//.test(v.trim()) ? v.trim() : null);
export function redisUrl(env = process.env) { return okUrl(env.NBA_DB_URL_REDIS_URL); }
export const sharedDb = (env = process.env) => !!okUrl(env.NBA_DB_URL_REDIS_URL);
// ioredis puts keyPrefix on every key of every command, but NOT on a SCAN pattern, and SCAN hands back the full names: so SCAN gets the label added
// to its pattern (and only ever sees NBA keys), the label is cut off the names it returns, and DBSIZE counts NBA keys only.
export function withPrefix(c, P = NBA_PREFIX) {
  const scan = c.scan.bind(c);
  c.scan = async (cursor, ...args) => {
    const a = [...args], i = a.findIndex((x) => String(x).toUpperCase() === "MATCH"), j = a.findIndex((x) => String(x).toUpperCase() === "COUNT");
    if (i >= 0) a[i + 1] = P + a[i + 1]; else a.unshift("MATCH", P + "*");
    if (j >= 0 && Number(a[j + 1]) < 1000) a[j + 1] = 1000;   // the shared database holds NFL's keys too: bigger pages, fewer calls
    const [n, ks] = await scan(cursor, ...a);
    return [n, ks.map((k) => (k.startsWith(P) ? k.slice(P.length) : k))];
  };
  c.dbsize = async () => { let cur = "0", n = 0; do { const [nx, ks] = await scan(cur, "MATCH", P + "*", "COUNT", 1000); cur = nx; n += ks.length; } while (cur !== "0"); return n; };
  return c;
}
export function getRedis() {
  if (globalThis.__TEST_REDIS__) return globalThis.__TEST_REDIS__;
  if (!client) { const url = redisUrl(), O = { maxRetriesPerRequest: 3, connectTimeout: 8000 };
    client = !url ? new MemRedis() : withPrefix(new Redis(url, { ...O, keyPrefix: NBA_PREFIX })); }
  return client;
}
// 60-s copy of the page data, one per deployment (a preview build must never serve its page to the live site).
export const BUILD = process.env.VERCEL_GIT_COMMIT_SHA || "local";
export const SLATE_CACHE = `slate:cache:${BUILD}`;
// parse that never throws: one corrupt stored row must not break a whole list or grading run
export const jparse = (x) => { try { return JSON.parse(x); } catch { return null; } };
export async function getJSON(key) { const v = await getRedis().get(key); return v ? JSON.parse(v) : null; }
export async function setJSON(key, obj) { await getRedis().set(key, JSON.stringify(obj)); }


// Many keys in one round trip (chunks of 200), so reading the whole record costs a few commands, not one per saved pick.
export async function mgetAll(r, keys, chunk = 200) {
  const out = [];
  for (let i = 0; i < keys.length; i += chunk) { const part = keys.slice(i, i + chunk); out.push(...(part.length ? await r.mget(...part) : [])); }
  return out;
}
