import Redis from "ioredis";
let client;
export function getRedis() {
  if (globalThis.__TEST_REDIS__) return globalThis.__TEST_REDIS__;
  if (!client) client = new Redis(process.env.UPSTASH_REDIS_REST_URL_REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
  return client;
}
// 60-s copy of the page data, one per deployment (a preview build must never serve its page to the live site).
export const BUILD = process.env.VERCEL_GIT_COMMIT_SHA || "local";
export const SLATE_CACHE = `slate:cache:${BUILD}`;
// parse that never throws: one corrupt stored row must not break a whole list or grading run
export const jparse = (x) => { try { return JSON.parse(x); } catch { return null; } };
export async function getJSON(key) { const v = await getRedis().get(key); return v ? JSON.parse(v) : null; }
export async function setJSON(key, obj) { await getRedis().set(key, JSON.stringify(obj)); }
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
