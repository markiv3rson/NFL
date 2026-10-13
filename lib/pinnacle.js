// Pinnacle's free guest feed (10/13, owner: "build now"). Pinnacle is the sharpest book; its full-game main spread / total is
// RECORDED ONLY on each snapshot so it can later be tested against Polymarket on unseen games. Not shown, not used for picks:
// LINE MOVE's 63.2% was measured on the books' consensus line, not Pinnacle's. Two pages: matchups (team names) + markets (numbers).
import { TEAMS, loadSeason, started } from "./games";
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
  const pin = await fetchPinnacle(); let n = 0;
  const seen = new Set(), ahead = (await loadSeason(season)).filter((g) => !started(g) && pin[g.key] && !seen.has(g.key) && seen.add(g.key));   // next meeting only
  // review fix 10/14: games run 6 at a time, and the Polymarket part (order book) gets 15 s per game, so one slow book can't push the
  // whole pull past Vercel's 60 s limit and lose every game after it.
  const one = async (g) => { const k = `pinnacle:${season}:${g.week}:${g.key}`;
    const poly = polyFor ? await Promise.race([polyFor(g, pin[g.key]).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 15000))]) : null;
    await redis.rpush(k, JSON.stringify({ t, src, ...pin[g.key], ...(poly ? { poly } : {}) })); await redis.ltrim(k, -200, -1); n++; };
  for (let i = 0; i < ahead.length; i += 6) await Promise.all(ahead.slice(i, i + 6).map(one));
  return n;
}
