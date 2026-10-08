// Final scores from ESPN's public scoreboard (added 10/2). nflverse posts final scores hours after a game ends (sometimes the next
// day), so bets, the moneyline/spread/total grades and the Record waited on it. A game that nflverse still shows as unfinished,
// kicked off more than 3 h 15 min ago, and ESPN reports completed, is treated as final with ESPN's score. Touchdown results still
// wait for the official play-by-play (grading skips a game's TD part until it is posted), so nothing is guessed.
import { teamOf } from "./espn";
import { setJSON } from "./redis";
const URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
let failedAt = 0;   // after a failed or slow ESPN call, leave it alone for a minute so a slow ESPN cannot slow every page load
export const resetEspnFailure = () => { failedAt = 0; };   // tests only
// { "AWAY @ HOME": { a, h } } for games ESPN reports as completed. Anything unrecognized or without both scores is skipped.
export function finalsFromScoreboard(json) {
  const out = {};
  for (const ev of (json && json.events) || []) {
    const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    const s = ev.status || c.status || {}, ty = s.type || {};
    if (!(ty.completed === true && ty.state === "post")) continue;
    const by = {}; for (const t of c.competitors || []) { const abbr = teamOf(t.team && (t.team.displayName || t.team.name)); if (abbr && t.homeAway) by[t.homeAway] = { abbr, score: Number(t.score) }; }
    if (!by.home || !by.away || !isFinite(by.home.score) || !isFinite(by.away.score)) continue;
    out[`${by.away.abbr} @ ${by.home.abbr}`] = { a: by.away.score, h: by.home.score };
  }
  return out;
}
// Marks rows final in place (espnFinal: true). Returns how many were marked. Any failure leaves the rows exactly as nflverse has them.
export async function overlayEspnFinals(rows, now = Date.now(), fetcher = fetch) {
  const due = rows.filter((r) => !r.final && r.kickoff && now - Date.parse(r.kickoff) > 3.25 * 3600e3 && now - Date.parse(r.kickoff) < 5 * 86400e3);
  if (!due.length) return 0;
  if (Date.now() - failedAt < 60000) return 0;
  try {
    const r = await fetcher(URL, { cache: "no-store", signal: AbortSignal.timeout(3000) }); if (!r.ok) { failedAt = Date.now(); return 0; }
    const f = finalsFromScoreboard(await r.json()); let n = 0;
    for (const g of due) { const x = f[g.key]; if (x) { g.final = true; g.awayScore = x.a; g.homeScore = x.h; g.espnFinal = true; n++; } }
    return n;
  } catch { failedAt = Date.now(); return 0; }
}

// Kickoff times from ESPN (10/7). nflverse's schedule can lag a time change: on 10/7 it still had CHI @ GB at 1:00 PM ET while the game
// was at 4:25 PM ET (Polymarket and the user's NFL app agreed). The closing line, pre-log and kickoff-wave reruns all key off the kickoff,
// so a stale time saves the closing line hours early. For games not yet final in the next 8 days, ESPN's kickoff replaces nflverse's when
// they differ by 10+ minutes (r.kickoffFrom = "espn", r.kickoffWas = the old time). Any failure keeps nflverse's times.
export function kickoffsFromScoreboard(json) {
  const out = {};
  for (const ev of (json && json.events) || []) {
    const c = ev.competitions && ev.competitions[0]; if (!c || !ev.date) continue;
    const by = {}; for (const t of c.competitors || []) { const abbr = teamOf(t.team && (t.team.displayName || t.team.name)); if (abbr && t.homeAway) by[t.homeAway] = abbr; }
    if (by.home && by.away && !isNaN(Date.parse(ev.date))) out[`${by.away} @ ${by.home}`] = new Date(Date.parse(ev.date)).toISOString();
  }
  return out;
}
let kickCache = { t: 0, map: null, failedAt: 0 };
export const resetKickCache = () => { kickCache = { t: 0, map: null, failedAt: 0 }; };   // tests only
export async function overlayEspnKickoffs(rows, now = Date.now(), fetcher = fetch) {
  const soon = rows.filter((r) => !r.final && r.kickoff && Date.parse(r.kickoff) > now - 6 * 3600e3 && Date.parse(r.kickoff) < now + 8 * 86400e3);
  if (!soon.length) return 0;
  let map = kickCache.map && now - kickCache.t < 30 * 60e3 ? kickCache.map : null, fresh = false;
  if (!map) {
    if (now - kickCache.failedAt < 60000) return 0;
    try {
      const r = await fetcher(URL, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!r.ok) { kickCache.failedAt = now; await note({ ok: false, error: `ESPN returned ${r.status}` }); return 0; }
      map = kickoffsFromScoreboard(await r.json()); kickCache = { t: now, map, failedAt: 0 }; fresh = true;
    } catch (e) { kickCache.failedAt = now; await note({ ok: false, error: String(e && e.name === "TimeoutError" ? "ESPN timed out" : e).slice(0, 120) }); return 0; }
  }
  let n = 0; const moved = [], missing = [];
  for (const g of soon) { const k = map[g.key]; if (!k) { missing.push(g.key); continue; }
    if (Math.abs(Date.parse(k) - Date.parse(g.kickoff)) >= 10 * 60e3) { moved.push({ game: g.key, was: g.kickoff, now: k }); g.kickoffWas = g.kickoff; g.kickoff = k; g.kickoffFrom = "espn"; n++; } }
  if (fresh) await note({ ok: true, espnGames: Object.keys(map).length, checked: soon.length, moved, missing: missing.slice(0, 8) });
  return n;
}
// Last ESPN kickoff check, shown in Models -> System so a stale time or a failing check is visible (10/8).
async function note(x) { try { await setJSON("kickcheck", { t: new Date().toISOString(), ...x }); } catch {} }
