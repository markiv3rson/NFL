// Final scores from ESPN's public scoreboard, used only to grade picks. { "AWAY @ HOME": { away, home, final } } for one day.
import { ABBRS } from "./teams";
const FIX = { NY: "NYK", SA: "SAS", GS: "GSW", NO: "NOP", UTAH: "UTA", WSH: "WAS", PHO: "PHX" };
export const espnAbbr = (a) => { const x = FIX[a] || a; return ABBRS.includes(x) ? x : null; };
export function parseScoreboard(json) {
  const out = {};
  for (const ev of (json && json.events) || []) {
    const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    const away = c.competitors.find((x) => x.homeAway === "away"), home = c.competitors.find((x) => x.homeAway === "home");
    if (!away || !home) continue;
    const a = espnAbbr(away.team && away.team.abbreviation), h = espnAbbr(home.team && home.team.abbreviation);
    if (!a || !h) continue;
    const S = c.status || ev.status || {}, st = S.type || {}, period = Number(S.period) || null;
    out[`${a} @ ${h}`] = { away: Number(away.score), home: Number(home.score), final: !!st.completed, state: st.state || null, period, ot: period != null && period > 4 };
  }
  return out;
}
export async function finalsFor(dateYMD, { timeoutMs = 15000 } = {}) {   // "2026-10-20"
  const d = String(dateYMD).replace(/-/g, "");
  const url = `${process.env.ESPN_SCOREBOARD_URL || "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"}?dates=${d}`;
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${r.status} on scoreboard`);
  return parseScoreboard(await r.json());
}
// Teams whose game on that day went to overtime (period 5+), finished games only. Used for the card's FATIGUE rule (a back-to-back after overtime).
export const otTeams = (finals) => new Set(Object.entries(finals || {}).filter(([, f]) => f && f.final && f.ot).flatMap(([k]) => k.split(" @ ")));
export async function otTeamsFor(dateYMD) { return otTeams(await finalsFor(dateYMD)); }
export const allFinal = (finals) => Object.values(finals || {}).every((f) => f && f.final);   // true for a day with no games
