// Game-day availability from ESPN's league-wide injury feed (added 9/30). The nflverse injury feed stops at Friday's
// official report; ESPN's feed keeps updating through game day (e.g. "X is inactive for Sunday's game" -> status Out).
// Source tier 4 (major outlet). Used to (1) take players ESPN lists Out on game day off the TD list and hand their
// red-zone share to teammates at the kickoff-wave rerun, and (2) show the ESPN status on the row.
// Shape (public, no key): { injuries: [ { displayName: "Buffalo Bills", injuries: [ { athlete: { displayName,
//   position: { abbreviation } }, status: "Out", date, shortComment } ] } ] }. Parsed defensively: anything
// unrecognized is skipped, and an empty/unreadable feed is reported by the Watchdog instead of failing silently.
import { TEAMS } from "./games";
let cache = { t: 0, data: null };
const NICK = Object.entries(TEAMS).map(([abbr, nick]) => [abbr, String(nick).toLowerCase()]);
export function teamOf(name) {
  const n = String(name || "").toLowerCase();
  const hit = NICK.find(([, nick]) => n.endsWith(nick) || n.includes(" " + nick));
  return hit ? hit[0] : null;
}
export function parseEspnInjuries(json) {
  const out = {}; let rows = 0;
  for (const t of (json && json.injuries) || []) {
    const abbr = teamOf(t.displayName || (t.team && t.team.displayName));
    if (!abbr) continue;
    for (const x of t.injuries || []) {
      const a = x.athlete || {}, name = a.displayName || a.fullName;
      if (!name || !x.status) continue;
      (out[abbr] = out[abbr] || []).push({ name, pos: a.position && a.position.abbreviation, status: String(x.status), date: x.date || null, comment: x.shortComment || "" });
      rows++;
    }
  }
  return { teams: out, rows };
}
export async function loadEspnInjuries() {
  if (cache.data && Date.now() - cache.t < 10 * 60e3) return cache.data;
  const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries", { cache: "no-store" });
  if (!r.ok) throw new Error(`ESPN injuries ${r.status}`);
  const d = parseEspnInjuries(await r.json());
  if (!d.rows) throw new Error("ESPN injuries feed returned no readable players");
  cache = { t: Date.now(), data: d };
  return d;
}
// "Out today": ESPN status Out (or Doubtful/Suspension) dated within the last 8 days. Older "Out" entries are left to
// the official report / roster checks so a stale ESPN row never removes a healthy player.
export function espnOut(entry, now = Date.now()) {
  if (!entry || !/^(out|doubtful|suspension)$/i.test(entry.status)) return false;
  return !entry.date || now - new Date(entry.date).getTime() < 8 * 86400e3;
}
// Questionable on ESPN AND posted after the team's previous game (9/30): the official report only lands Wed-Fri, so
// early in the week ESPN is the only source for who's questionable. Same date rule as espnOutFor below.
export function espnQuestionableFor(entry, team, kickoff, seasonRows) {
  if (!entry || !/^questionable$/i.test(entry.status || "") || !entry.date) return false;
  const k = (seasonRows || []).filter((x) => (x.home === team || x.away === team) && x.kickoff && new Date(x.kickoff) < new Date(kickoff)).map((x) => new Date(x.kickoff).getTime());
  return new Date(entry.date).getTime() > (k.length ? Math.max(...k) : 0) + 6 * 3600e3;
}
// Out AND posted after the team's previous game (+6 h): last week's inactive list must not remove a player who is back.
// ONE copy, used by the TD tab (lib/week.js) and the model rerun (pages/api/rerun.js).
export function espnOutFor(entry, team, kickoff, seasonRows, now = Date.now()) {
  if (!espnOut(entry, now)) return false;
  if (!entry.date) return true;
  const k = (seasonRows || []).filter((x) => (x.home === team || x.away === team) && x.kickoff && new Date(x.kickoff) < new Date(kickoff)).map((x) => new Date(x.kickoff).getTime());
  const prev = k.length ? Math.max(...k) : 0;
  return new Date(entry.date).getTime() > prev + 6 * 3600e3;
}

