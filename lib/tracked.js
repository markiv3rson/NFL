// Tracked paper tests (recorded live and graded, NOT picks, not shown on cards): early-week wind Under (`|windU`), OFFENSIVE FLOOR
// (`|floor`), and the shadow rules from the 30-min Pinnacle pull (`|pinlm` / `|pinlmT` LINE MOVE using Pinnacle, `|tilt` / `|tiltT`
// Polymarket order-book tilt). Models tab -> Tracked angles. They live in the Redis hash `teaser:<season>:<week>` (its old name, kept so
// the records saved before 10/14 still count). Teaser legs themselves were removed 10/14 (owner never bets them).
import { getRedis } from "./redis";
import { scoredFloor } from "./stack";
export const tkey = (s, w) => `teaser:${s}:${w}`;
const jp = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
const TRACKED = ["windU", "floor", "pinlm", "pinlmT", "tilt", "tiltT"];

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
  const wu = legs.filter((x) => x.windU), fl = legs.filter((x) => x.floor), pl = legs.filter((x) => x.pinlm), tt = legs.filter((x) => x.tilt);
  const split = (xs) => ({ ...agg(xs), recorded: xs.length, spread: agg(xs.filter((x) => x.kind !== "total")), total: agg(xs.filter((x) => x.kind === "total")) });
  return { windU: { ...agg(wu), recorded: wu.length }, floor: { ...agg(fl), recorded: fl.length, shut: agg(fl.filter((x) => x.shut)), road: agg(fl.filter((x) => x.road)) },
    pinlm: split(pl), tilt: split(tt) };
}

export const WIND_U_MPH = 10;   // early-week wind Under (10/13): kickoff forecast 10+ mph, outdoor stadium
// OFFENSIVE FLOOR (10/14, owner: "build now", PAPER ONLY): exactly one team scored 3 or less in its last game -> that team at the
// kickoff spread (the last write before kickoff wins, like the history test at the closing line). History 1999-2025: <=3 54.6% (423),
// shut out 57.4% (155), shut out on the road 61.9% (63) -- uneven by period (2006-12 shut out 44%), so graded live first.
export async function recordFloor(season, week, g, hs, sit, t) {
  const H = sit && sit.home, A = sit && sit.away, lo = scoredFloor;
  if (hs == null || !isFinite(hs) || lo(H) === lo(A)) return 0;
  const homeTeam = lo(H), S = homeTeam ? H : A;
  await getRedis().hset(tkey(season, week), `${g.key}|floor`, JSON.stringify({ game: g.key, kind: "spread", floor: true, team: homeTeam ? g.home : g.away,
    line: homeTeam ? hs : -hs, prevPts: S.prevPts, shut: S.prevPts === 0, road: !homeTeam, week, t }));
  return 1;
}
