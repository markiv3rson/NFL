// System status + error log (shown collapsed in Record -> Model).
import { UP_MOVE } from "./upgrade";
import { DB_CAP_MB } from "./compact";
import { getRedis, getJSON } from "./redis";
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
  if (credits <= 30) return `Only ${credits} book credits left`;
  if (spent > expectedSpent * 1.4) return `Book credits: ${spent} of 500 used`;
  return null;
}
export async function getStatus(season, week, meta, modelRunAt) {
  const r = getRedis();
  const errors = (await r.lrange("errors", 0, 9)).map((x) => JSON.parse(x));
  // only the last 48 h are listed; older ones are history, not news. 10/14 (owner): an error is also hidden once the same job has worked
  // again after it (ok:<where>, stamped by a good run -- Pinnacle for now), so fixed problems don't sit on the page for two days.
  const wh = [...new Set(errors.map((e) => e.where).filter(Boolean))], okT = wh.length ? await r.mget(wh.map((w) => `ok:${w}`)).catch(() => []) : [];
  const okOf = Object.fromEntries(wh.map((w, i) => [w, okT[i] ? new Date(okT[i]).getTime() : 0]));
  const recent = errors.filter((e) => Date.now() - new Date(e.t) < 48 * 3600e3 && !(okOf[e.where] > new Date(e.t).getTime()));
  let usedMb = null;
  try { const info = await r.info("memory"); const m = info.match(/used_memory:(\d+)/); usedMb = m ? Number(m[1]) / 1048576 : null; } catch {}
  const backup = (await getJSON("status:backup")) || null;
  const auto = (await getJSON("auto:last")) || null, selfcheck = (await getJSON("selfcheck:last")) || null;
  let prelogged = 0;
  try {   // SCAN, not KEYS: KEYS walks the whole database in one blocking call on every page load
    let c = "0"; do { const [n, ks] = await r.scan(c, "MATCH", `prelog:${season}:${week}:*`, "COUNT", 500); c = n; prelogged += ks.length; } while (c !== "0");
  } catch {}
  const retrain = (await getJSON("status:retrain")) || null, kickcheck = (await getJSON("kickcheck").catch(() => null)) || null;
  const credits = meta.credits ?? null;
  // 10/14 (owner: "fix all 5"): is the Railway model service answering? (The scheduler runs inside it too.) 5-s ping of /health.
  let railway = null;
  // Any HTTP answer under 500 counts as up (only no answer / timeout / 5xx = down); one retry; code + error kept for diagnosis.
  try { const { modelBase, modelHeaders } = await import("./model"); const base = modelBase(), t0 = Date.now();
    if (base) { let code = 0, err = null, health = null;
      for (let i = 0; i < 2 && !(code && code < 500); i++) {
        try { const r = await fetch(`${base}/health`, { headers: modelHeaders(), signal: AbortSignal.timeout(5000) }); code = r.status; err = null; health = r.ok ? await r.json().catch(() => null) : null; }
        catch (e) { err = String((e && (e.cause && e.cause.code || e.message)) || e).slice(0, 120); } }
      // 10/27: the service's own build (tag, time, published) and its rebuild state (running / last result) ride along for the System block
      railway = { ok: !!(code && code < 500), code, err, ms: Date.now() - t0, t: new Date().toISOString(), build: (health && health.build) || null, rebuild: (health && health.rebuild) || null }; } } catch {}
  // TOTAL MOVE's honest test from the newest weekly rebuild (each season predicted by a model that never saw it), for the accuracy check (10/14)
  let moveCheck = null, fitCheck = null;
  try { const cm = await getJSON("combomodel:latest"), m0 = cm && cm.moveT, m = m0 && Array.isArray(m0.feat) && m0.feat.includes("w") ? { ...UP_MOVE, builtIn: true } : m0;  /* 10/14: an old wind-based model is not used (lib/upgrade.js) */ if (m && m.hit20 != null) moveCheck = { hit20: m.hit20, n20: m.n20, hit10: m.hit10, n10: m.n10, builtAt: cm.builtAt || null };
    // 10/26 night: the game model's leave-one-season-out misses vs the closing line (margin, total, each team's points) from the same rebuild
    const c = cm && cm.checks; if (c && c.marginErr != null) fitCheck = { games: c.games, margin: [c.marginErr, c.marketMarginErr ?? null], total: [c.totalErr, c.marketTotalErr ?? null], teamTotal: [c.teamTotalErr ?? null, c.marketTeamTotalErr ?? null], builtAt: cm.builtAt || null }; } catch {}
  return { lastSnapshot: meta.lastSnapshot || null, lastBooks: meta.lastBooks || null, credits,
    creditWarning: creditWarning(credits != null ? Number(credits) : null),
    modelRunAt, backup, retrain, kickcheck, moveCheck, fitCheck, railway, usedMb, capMb: DB_CAP_MB, auto, selfcheck, prelogged, errors: recent,
    // Header turns yellow only for problems in the last 24 h (older ones still listed); before 9/28 a warning from
    // last Sunday kept the whole panel on "check" for a week after it stopped mattering.
    ok: !recent.some((e) => Date.now() - new Date(e.t) < 86400e3) };   // Redis Cloud FREE plan: 30 MB (owner screenshot 10/14; was wrongly 256)
}

