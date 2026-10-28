import Redis from "ioredis";
let client;
// 10/28 (owner: "move the NFL over too"): both sports live in ONE paid Redis Cloud database (250 MB, no monthly request cap; Vercel created
// its setting as NBA_DB_URL_REDIS_URL). NFL keys keep their names, NBA's carry "nba:" (nba/lib/redis.js). The old free database stays the fallback.
export const DB_URL = (env = process.env) => env.NBA_DB_URL_REDIS_URL || env.UPSTASH_REDIS_REST_URL_REDIS_URL;
const OPTS = { maxRetriesPerRequest: 3, connectTimeout: 8000 };
export function getRedis() {
  if (globalThis.__TEST_REDIS__) return globalThis.__TEST_REDIS__;
  if (!client) client = new Redis(DB_URL(), OPTS);
  return client;
}
// 60-s copy of the page data, one per deployment (a preview build must never serve its page to the live site).
export const BUILD = process.env.VERCEL_GIT_COMMIT_SHA || "local";
export const SLATE_CACHE = `slate:cache:${BUILD}`;
// parse that never throws: one corrupt stored row must not break a whole list or grading run
export const jparse = (x) => { try { return JSON.parse(x); } catch { return null; } };
export async function getJSON(key) { const v = await getRedis().get(key); return v ? JSON.parse(v) : null; }
export async function setJSON(key, obj) { await getRedis().set(key, JSON.stringify(obj)); }
// 10/14 risk fix: a capped history list that never loses the week's FIRST readings (opening lines, first forecast, first TD price).
// Plain ltrim(-cap) dropped the oldest entries -- heavy refreshing (or the 30-min Pinnacle pull after ~4 days) pushed out the opening
// numbers that TOTAL MOVE, INJURY and the wind Under need. Keeps the first `keep` entries plus the newest (cap - keep).
export async function pushCapped(redis, key, value, cap, keep = 10) {
  await redis.rpush(key, value);
  const n = await redis.llen(key); if (n <= cap) return;
  const head = await redis.lrange(key, 0, keep - 1);
  await redis.ltrim(key, n - (cap - keep), -1);
  if (head.length) await redis.lpush(key, ...head.reverse());
}
export const K = {
  snaps: (s, w, g) => `snap:${s}:${w}:${g}`,       // list of snapshots (line history)
  close: (s, w, g) => `close:${s}:${w}:${g}`,      // closing snapshot (taken at kickoff)
  tdpx: (s, w, g) => `tdpx:${s}:${w}:${g}`,        // latest Polymarket TD prices
  model: (s, w) => `model:${s}:${w}`,              // model results for the week
  books: (s, w) => `books:${s}:${w}`,              // latest sportsbook consensus
  res: (s, w, g) => `res:${s}:${w}:${g}`,          // graded result
  resIds: "res:ids",
  meta: (s, w) => `meta:${s}:${w}`,                // last snapshot times
};
