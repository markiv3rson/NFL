// Pinnacle's free guest feed (10/13, owner: "build now"). Pinnacle is the sharpest book; its full-game main spread / total is
// RECORDED ONLY on each snapshot so it can later be tested against Polymarket on unseen games. Not shown, not used for picks:
// LINE MOVE's 63.2% was measured on the books' consensus line, not Pinnacle's. Two pages: matchups (team names) + markets (numbers).
import { TEAMS, loadSeason, started } from "./games";
import { pushCapped } from "./redis";
const BASE = process.env.PINNACLE_URL || "https://guest.api.arcadia.pinnacle.com/0.1/leagues/889";
const abbrOf = (name) => Object.keys(TEAMS).find((k) => name && String(name).endsWith(TEAMS[k])) || null;
// Returns { "AWAY @ HOME": { id, hs, hp, ap, tl, op, up } } -- hs = home spread, hp/ap = home/away American price, tl = total.
export function parsePinnacle(matchups, markets) {
  const teams = {};
  const take = (m) => {
    if (!m || !m.id || !Array.isArray(m.participants)) return;
    const h = m.participants.find((p) => p.alignment === "home"), a = m.participants.find((p) => p.alignment === "away");
    const home = h && abbrOf(h.name), away = a && abbrOf(a.name);
    if (home && away) teams[m.id] = { key: `${away} @ ${home}`, start: m.startTime || null };
  };
  for (const m of Array.isArray(matchups) ? matchups : []) { if (!m.parentId && !m.special) take(m); take(m.parent); }
  const out = {};
  for (const k of Array.isArray(markets) ? markets : []) {
    const g = teams[k && k.matchupId];
    if (!g || k.period !== 0 || k.isAlternate !== false || (k.status && k.status !== "open")) continue;
    const by = (d) => (k.prices || []).find((p) => p.designation === d);
    const o = out[g.key] || (out[g.key] = { id: k.matchupId, start: g.start });
    if (k.type === "spread") { const h = by("home"), a = by("away"); if (h && a && Number.isFinite(h.points)) Object.assign(o, { hs: h.points, hp: h.price, ap: a.price }); }
    if (k.type === "total") { const ov = by("over"), un = by("under"); if (ov && un && Number.isFinite(ov.points)) Object.assign(o, { tl: ov.points, op: ov.price, up: un.price }); }
  }
  for (const key of Object.keys(out)) if (out[key].hs == null && out[key].tl == null) delete out[key];
  return out;
}
export async function fetchPinnacle() {
  // 10/14: retries after 3 s and 10 s -- the one 2-s retry still failed ~1 pull in 3 overnight (403s come in short bursts)
  const get = async (p, waits = [3000, 10000]) => {
    const r = await fetch(`${BASE}/${p}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(10000) });   // 10 s each: 3 tries + waits stay under 45 s
    if (!r.ok) { if (waits.length) { await new Promise((ok) => setTimeout(ok, waits[0])); return get(p, waits.slice(1)); }
      throw new Error(`Pinnacle ${p} returned ${r.status}`); }
    return r.json();
  };
  const [matchups, markets] = await Promise.all([get("matchups"), get("markets/straight")]);
  return parsePinnacle(matchups, markets);
}
// Saves Pinnacle's line for every not-started game it lists, under that game's own week (Redis pinnacle:<season>:<week>:<game>, last
// 200). poly = Polymarket's main spread/total read at the same moment (10/13: every 30 min, to test "Pinnacle moved, Polymarket hasn't").
export async function savePinnacle(redis, season, t, src, polyFor = null) {
  // 10/19 review: a Pinnacle failure (403) no longer stops the Polymarket reads -- they run, then the failure is reported
  let pin = {}, perr = null; try { pin = await fetchPinnacle(); } catch (e) { perr = e; }
  let n = 0; const soon = Date.now() + 12 * 86400e3;
  // 10/19 review: EVERY not-started game in the next 12 days gets its Polymarket read (polyFor), not only the games Pinnacle lists -- on Monday
  // 10/19 four week-7 games (SF @ ATL, CIN @ BAL, GB @ DET, DAL @ PHI) had no line on the page because Pinnacle had not posted them yet while
  // Polymarket had. A Pinnacle record is saved only for games Pinnacle lists. Next meeting only (a team pair can meet twice).
  const seen = new Set(), ahead = (await loadSeason(season)).filter((g) => !started(g) && (pin[g.key] || (polyFor && g.kickoff && Date.parse(g.kickoff) < soon)) && !seen.has(g.key) && seen.add(g.key));
  // review fix 10/14: games run in batches, and the Polymarket part gets 15 s per game, so one slow read can't push the
  // whole pull past Vercel's 60 s limit and lose every game after it.
  const one = async (g) => { const k = `pinnacle:${season}:${g.week}:${g.key}`;
    const poly = polyFor ? await Promise.race([polyFor(g, pin[g.key] || null).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 15000))]) : null;
    if (!pin[g.key]) return;
    await pushCapped(redis, k, JSON.stringify({ t, src, ...pin[g.key], ...(poly ? { poly } : {}) }), 200); n++; };
  for (let i = 0; i < ahead.length; i += 8) await Promise.all(ahead.slice(i, i + 8).map(one));
  if (perr) throw perr;
  return n;
}

// 10/14 (owner: "fix all 5"): Pinnacle's free feed blocks us now and then (403) and the next 30-min pull fills the gap, so one failure
// is not an error. Logged only on the 2nd failure in a row (any success resets the count) -- then it is a real outage.
export async function pinnacleFailed(redis, msg, logError) {
  const n = await redis.incr("pinfail").catch(() => 2); await redis.expire("pinfail", 6 * 3600).catch(() => {});
  if (n >= 2) await logError("pinnacle", `Pinnacle lines pull failed ${n} times in a row: ${msg}`).catch(() => {});
}
// a good pull also stamps ok:pinnacle -> System hides Pinnacle errors from before it (lib/status.js, 10/14 owner: "delete those old errors")
export const pinnacleOk = (redis) => Promise.all([redis.del("pinfail"), redis.set("ok:pinnacle", new Date().toISOString())]).catch(() => 0);
