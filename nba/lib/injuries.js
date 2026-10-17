// NBA injuries. First choice: the NBA's own official injury report, read and parsed by the model service (/injuries, by game day).
// Fallback: ESPN's public injuries feed (format not verified from the cloud session). Team -> [{ name, status }].
// Statuses: Out, Doubtful, Questionable, Probable (+ Day-To-Day on ESPN). The model service weights each status by how often that status
// really sat in the NBA's report history (injury_weights.json); until that is fitted, the weights are guesses.
import { modelBase, modelHeaders } from "./model";
import { TEAMS, ABBRS } from "./teams";
import { getJSON, setJSON } from "./redis";
const URL = process.env.ESPN_INJURIES_URL || "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";
const KEY = "injuries:nba:v2";
export function teamAbbr(name) {
  const n = String(name || "").toLowerCase();
  const hit = ABBRS.find((a) => TEAMS[a].name.toLowerCase() === n) || ABBRS.find((a) => n.endsWith(TEAMS[a].nick.toLowerCase()));
  return hit || null;
}
export function parseInjuries(json) {
  const teams = {};
  for (const t of (json && json.injuries) || []) {
    const abbr = teamAbbr(t.displayName); if (!abbr) continue;
    const list = [];
    for (const p of t.injuries || []) {
      const name = p.athlete && (p.athlete.displayName || p.athlete.fullName); const status = p.status || (p.type && p.type.description);
      if (name && status) list.push({ name, status: String(status) });
    }
    teams[abbr] = list;
  }
  return teams;
}
async function officialReport() {
  const base = modelBase(); if (!base) throw new Error("MODEL_SERVICE_URL not set");
  const r = await fetch(`${base}/injuries`, { headers: modelHeaders(), cache: "no-store", signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.ok || !j.dates) throw new Error((j && j.error) || `injuries ${r.status}`);
  return { t: new Date().toISOString(), source: "nba-official", asOf: j.asOf, dates: j.dates, teams: {} };   // asOf = when the NBA published it (Eastern time)
}
async function espnReport() {
  const r = await fetch(URL, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(String(r.status));
  const teams = parseInjuries(await r.json());
  if (!Object.keys(teams).length) throw new Error("no teams parsed");
  return { t: new Date().toISOString(), source: "espn", dates: {}, teams };
}
// Injuries for a team on a game day: the official report's rows for that day, else (ESPN fallback) the team's list.
// A game day the official report covers: its rows for the team (none listed = healthy). A day it does not cover yet (tomorrow's games): ESPN's team list.
export const injuriesFor = (inj, date, team) => (inj && inj.dates && inj.dates[date] ? inj.dates[date][team] || [] : (inj && inj.teams && inj.teams[team]) || []);
export async function loadInjuries({ maxAgeMs = 5 * 60e3 } = {}) {
  const cached = await getJSON(KEY).catch(() => null);
  if (cached && Date.now() - new Date(cached.t) < maxAgeMs) return cached;
  let out = null, why = [];
  try { out = await officialReport(); } catch (e) { why.push("official: " + e.message); }
  if (out) { try { out.teams = (await espnReport()).teams; } catch (e) { out.teamsError = String(e.message || e).slice(0, 80); } }   // ESPN's lists cover the days the report does not (tomorrow's games)
  else { try { out = await espnReport(); } catch (e) { why.push("espn: " + e.message); } }
  if (out) { await setJSON(KEY, out).catch(() => {}); return out; }
  return cached ? { ...cached, stale: true } : { t: null, teams: {}, dates: {}, error: why.join("; ") };   // no list = the page says so (Estimate), never silently "healthy"
}
