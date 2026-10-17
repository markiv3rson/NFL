// "Is everything running?" for the Models tab: when the scheduler last called the site, whether the model service answers,
// and any errors from the last two days. Written by /api/snapshot, read by /api/models.
import { getRedis, jparse } from "./redis";
import { modelBase, modelHeaders } from "./model";
const SNAP = "status:snapshot", ERRS = "status:errors", TWO_DAYS = 2 * 86400e3;
export const ESPN_STATUS = "status:espn";   // last ESPN scoreboard call for the FATIGUE overtime check (lib/slate.js otSetFor): { ok, t, date, msg }

export async function markSnapshot(info, now = Date.now()) {
  await getRedis().set(SNAP, JSON.stringify({ t: new Date(now).toISOString(), ...info }), "EX", 7 * 86400).catch(() => {});
}
export async function logError(where, msg, now = Date.now()) {
  const r = getRedis();
  await r.lpush(ERRS, JSON.stringify({ t: new Date(now).toISOString(), where, msg: String(msg).slice(0, 200) })).catch(() => {});
  await r.ltrim(ERRS, 0, 49).catch(() => {});
  await r.expire(ERRS, 7 * 86400).catch(() => {});
}
export async function railwayHealth(fetcher = fetch) {
  const base = modelBase(); if (!base) return { ok: false, err: "MODEL_SERVICE_URL not set" };
  const t0 = Date.now();
  try {
    const r = await fetcher(`${base}/health`, { headers: modelHeaders(), cache: "no-store", signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => null);
    return { ok: r.ok && !!(j && j.ok) && j.engine !== false, ms: Date.now() - t0, code: r.status, engine: j ? j.engine !== false : null, lines: j && j.lines ? j.lines : null, stale: j && j.stale && Object.keys(j.stale).length ? j.stale : null, error: j && j.error ? String(j.error).slice(0, 120) : null };
  } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 80) }; }
}
// Watchdog (NFL app idea): plain-language list of anything stale or missing, so nothing fails silently. Pacific daytime = the scheduler's
// window (snapshot every 30 min, 7 AM-9:30 PM); a gap there of 90+ minutes means the Railway scheduler is not reaching the site.
export function computeWatch({ snap, railway, pinnacle, espn = null, backup, now = Date.now() }) {
  const w = [], H = 3600e3;
  if (backup !== undefined) {   // nightly backup (10/17), same checks as the NFL watchdog
    if (!backup || now - Date.parse(backup.t) > 36 * H) w.push("No backup in the last 36 h — check the Railway volume.");
    else if (backup.where === "failed") w.push("Last night's backup failed — check the Railway logs.");
  }
  const hr = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false }).format(now)) % 24;
  const day = hr >= 8 && hr < 22;
  if (railway && !railway.ok) w.push("The Railway model service is not answering: model numbers, the automatic rebuild and the schedule stop until it is back (check Railway).");
  const stale = railway && railway.ok && railway.stale ? railway.stale : {}, pbpKey = Object.keys(stale).find((k) => /^play_by_play_/.test(k)), other = Object.keys(stale).filter((k) => k !== pbpKey);
  if (other.length) w.push(`The model service could not download ${other.join(", ")} and runs on its last copy: yesterday's games may be missing from rest, ATS and the ratings.`);
  if (pbpKey) w.push(`ESPN's play-by-play is behind (${stale[pbpKey]}): SHOT QUALITY picks are off until it catches up.`);
  if (railway && railway.ok && railway.error) w.push(`The model service reports: ${railway.error}`);
  if (espn && espn.ok === false) w.push("ESPN's scoreboard did not answer on the last overtime check: FATIGUE OT picks are off until it does.");
  if (!snap) w.push("No snapshot has run yet: the scheduler has not reached the site (check SITE_URL / SITE_LOGIN on Railway).");
  else {
    const age = now - Date.parse(snap.t);
    if (day && age > 90 * 60e3) w.push(`No snapshot in ${Math.round(age / 60e3)} minutes: check the Railway scheduler.`);
    if (snap.failed) w.push(`The last snapshot failed (${snap.failed}): no new lines, picks or closing lines were saved by it.`);
    if (snap.modelOk === false) w.push("The model service did not answer on the last snapshot: no model numbers or picks until it does.");
    if (snap.games > 0 && day) {
      const p = pinnacle ? now - Date.parse(pinnacle) : Infinity;
      if (p > 3 * H) w.push(`No good Pinnacle pull ${Number.isFinite(p) ? "in " + Math.round(p / H) + " hours" : "yet"}: opening lines and LINE MOVE are not being recorded.`);
    }
  }
  return w;
}
export async function getStatus({ now = Date.now(), fetcher = fetch } = {}) {
  const r = getRedis();
  const snap = jparse(await r.get(SNAP).catch(() => null));
  const errs = ((await r.lrange(ERRS, 0, 49).catch(() => [])) || []).map(jparse).filter((e) => e && now - Date.parse(e.t) < TWO_DAYS);
  const railway = await railwayHealth(fetcher);
  const espn = jparse(await getRedis().get(ESPN_STATUS).catch(() => null));
  const keys = await r.dbsize().catch(() => null);
  const pinOk = await r.get("ok:pinnacle").catch(() => null);
  const backup = jparse(await r.get("status:backup").catch(() => null)) || null;
  return { lastSnapshot: snap, errors: errs, railway, keys, pinnacle: pinOk, espn, backup, watch: computeWatch({ snap, railway, pinnacle: pinOk, espn, backup, now }) };
}
