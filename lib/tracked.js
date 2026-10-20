// Tracked paper tests (recorded live and graded, NOT picks). 10/19 review: only INJURY EARLY is left (the Pinnacle LINE MOVE and order-book tilt
// shadows were cut: one never fired, the other went 3-2; the wind Under, OFFENSIVE FLOOR and MIDDLE trackers were cut 10/15). Old rows stay graded
// history. They live in the Redis hash `teaser:<season>:<week>` (the old name, so records saved before 10/14 still count). Models tab -> Tracked angles.
import { getRedis } from "./redis";
export const tkey = (s, w) => `teaser:${s}:${w}`;
const jp = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
const TRACKED = ["pinlm", "pinlmT", "tilt", "tiltT", "injearly"];
// INJURY EARLY (10/16, owner: "c"): the INJURY edge is 60% at the OPENING line and gone once the line moves, so this records the healthy team at the line of the
// FIRST slate build (every 30 min) that sees exactly one team with its starting QB, 2+ DBs or 2+ linemen out -- whether or not the line has moved yet. Saved once per game
// (`<game>|injearly`), graded with the other tracked legs, shown in Models -> Tracked angles. A shadow test, not a pick.
export async function recordInjEarly(season, week, g, hs, sit, t) {
  if (!g || !g.key || hs == null || !isFinite(hs) || hs === 0 || !sit) return 0;
  const flag = (i) => !!i && (i.qb >= 1 || i.db >= 2 || i.ol >= 2), h = flag(sit.home && sit.home.inj), a = flag(sit.away && sit.away.inj);
  if (h === a) return 0;
  const homeHealthy = a, team = homeHealthy ? g.home : g.away, line = homeHealthy ? hs : -hs;
  return (await getRedis().hsetnx(tkey(season, week), `${g.key}|injearly`, JSON.stringify({ game: g.key, week, t, kind: "spread", injearly: true, team, line, out: homeHealthy ? g.away : g.home }))) ? 1 : 0;
}

export async function gradeTrackedWeek(season, week, finals) {
  const r = getRedis(), all = (await r.hgetall(tkey(season, week))) || {}; let n = 0;
  for (const g of finals) for (const f of TRACKED.map((x) => `${g.key}|${x}`)) { const leg = jp(all[f]); if (!leg || leg.result || g.homeScore == null) continue;
    const m = g.homeScore - g.awayScore, tot = g.homeScore + g.awayScore;
    const x = leg.kind === "total" ? (leg.side === "under" ? leg.line - tot : tot - leg.line) : (leg.team === g.home ? m : -m) + leg.line;
    leg.result = x > 0 ? "W" : x < 0 ? "L" : "P";
    await r.hset(tkey(season, week), f, JSON.stringify(leg)); n++; }
  return n;
}
const agg = (legs) => { const d = legs.filter((x) => x.result === "W" || x.result === "L"), w = d.filter((x) => x.result === "W").length;
  return { n: d.length, w, l: d.length - w, hit: d.length ? w / d.length : null }; };
export async function trackedSummary(season) {
  const r = getRedis(), legs = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `teaser:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jp(v); if (e) legs.push(e); } } while (c !== "0");
  const ie = legs.filter((x) => x.injearly);   // 10/19 review: the Pinnacle LINE MOVE / tilt shadows are gone (never fired / 3-2); INJURY EARLY stays
  const split = (xs) => ({ ...agg(xs), recorded: xs.length, spread: agg(xs.filter((x) => x.kind !== "total")), total: agg(xs.filter((x) => x.kind === "total")) });
  return { injearly: split(ie) };
}
