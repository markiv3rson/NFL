// System status + error log (shown collapsed in Record -> Model).
import { getRedis, getJSON, setJSON } from "./redis";
export async function logError(where, err) {
  const r = getRedis();
  await r.lpush("errors", JSON.stringify({ t: new Date().toISOString(), where, msg: String(err).slice(0, 300) }));
  await r.ltrim("errors", 0, 49);
}
// The Odds API free tier resets on a calendar month, 500 credits, 3 per sportsbook snapshot. Estimate how
// many snapshots are left before it resets, from how many credits have already been spent this month.
function creditWarning(credits) {
  if (credits == null) return null;
  const spent = 500 - credits;
  const now = new Date(), daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayFrac = now.getDate() / daysInMonth;
  const expectedSpent = 500 * dayFrac;            // roughly how much should be used by this point in the month
  if (credits <= 30) return `Only ${credits} sportsbook credits left this month — Books may stop updating soon.`;
  if (spent > expectedSpent * 1.4) return `Using sportsbook credits faster than usual (${spent} of 500 used, ${Math.round(dayFrac * 100)}% through the month) — may run out before it resets.`;
  return null;
}
export async function getStatus(season, week, meta, modelRunAt) {
  const r = getRedis();
  const errors = (await r.lrange("errors", 0, 9)).map((x) => JSON.parse(x));
  const weekAgo = Date.now() - 7 * 86400e3, recent = errors.filter((e) => new Date(e.t) > weekAgo);
  let usedMb = null;
  try { const info = await r.info("memory"); const m = info.match(/used_memory:(\d+)/); usedMb = m ? Number(m[1]) / 1048576 : null; } catch {}
  const backup = (await getJSON("status:backup")) || null;
  const auto = (await getJSON("auto:last")) || null, selfcheck = (await getJSON("selfcheck:last")) || null;
  let prelogged = 0;
  try {   // SCAN, not KEYS: KEYS walks the whole database in one blocking call on every page load
    let c = "0"; do { const [n, ks] = await r.scan(c, "MATCH", `prelog:${season}:${week}:*`, "COUNT", 500); c = n; prelogged += ks.length; } while (c !== "0");
  } catch {}
  const retrain = (await getJSON("status:retrain")) || null;
  const credits = meta.credits ?? null;
  return { lastSnapshot: meta.lastSnapshot || null, lastBooks: meta.lastBooks || null, credits,
    creditWarning: creditWarning(credits != null ? Number(credits) : null),
    modelRunAt, backup, retrain, usedMb, capMb: 256, auto, selfcheck, prelogged, errors: recent,
    // Header turns yellow only for problems in the last 24 h (older ones still listed); before 9/28 a warning from
    // last Sunday kept the whole panel on "check" for a week after it stopped mattering.
    ok: !recent.some((e) => Date.now() - new Date(e.t) < 86400e3) };   // Upstash free tier: 256 MB (30 MB was the old Vercel KV cap)
}

