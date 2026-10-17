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
// MERGED SITE (10/17): NBA keeps its OWN database. Only NBA_REDIS_URL is read -- never the NFL app's variables, so NBA can never
// write into NFL's database. Not set yet -> the in-memory stand-in (NBA pages show empty until NBA_REDIS_URL is added in Vercel).
export function redisUrl(env = process.env) {
  const v = env.NBA_REDIS_URL;
  return typeof v === "string" && /^rediss?:\/\//.test(v.trim()) ? v.trim() : null;
}
export function getRedis() {
  if (globalThis.__TEST_REDIS__) return globalThis.__TEST_REDIS__;
  if (!client) { const url = redisUrl(); client = url ? new Redis(url, { maxRetriesPerRequest: 3, connectTimeout: 8000 }) : new MemRedis(); }
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
