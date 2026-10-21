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
export const allFinal = (finals) => Object.values(finals || {}).every((f) => f && f.final);   // true for a day with no games
// Box scores for grading player props (10/20): ESPN's scoreboard for the day (event ids) + one summary call per finished game.
// { "AWAY @ HOME": { final, players: { "<normalized name>": { pts, reb, ast, pra, "3pm", stl, blk, min } } } }
export function parseBox(summary) {
  const comp = summary && summary.header && summary.header.competitions && summary.header.competitions[0];
  const players = {};
  for (const t of (summary && summary.boxscore && summary.boxscore.players) || []) {
    const st = (t.statistics || [])[0]; if (!st) continue;
    const ix = Object.fromEntries((st.names || []).map((n, i) => [n, i]));
    const num = (arr, k) => { const v = arr[ix[k]]; if (v == null) return 0; const m = String(v).match(/^(-?\d+)/); return m ? Number(m[1]) : 0; };
    for (const a of st.athletes || []) {
      const name = a.athlete && a.athlete.displayName; if (!name || a.didNotPlay || !Array.isArray(a.stats) || !a.stats.length) continue;
      const s = a.stats, pts = num(s, "PTS"), reb = num(s, "REB"), ast = num(s, "AST");
      players[name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").split(/\s+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w)).join(" ")] =
        { pts, reb, ast, pra: pts + reb + ast, "3pm": num(s, "3PT"), stl: num(s, "STL"), blk: num(s, "BLK"), min: num(s, "MIN") };
    }
  }
  const away = comp && comp.competitors.find((x) => x.homeAway === "away"), home = comp && comp.competitors.find((x) => x.homeAway === "home");
  const a = away && espnAbbr(away.team && away.team.abbreviation), h = home && espnAbbr(home.team && home.team.abbreviation);
  const final = !!(comp && comp.status && comp.status.type && comp.status.type.completed);
  return a && h ? { key: `${a} @ ${h}`, final, players } : null;
}
export async function boxFor(dateYMD, { timeoutMs = 15000 } = {}) {
  const d = String(dateYMD).replace(/-/g, ""), base = process.env.ESPN_NBA_BASE || "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
  const sb = await fetch(`${base}/scoreboard?dates=${d}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!sb.ok) throw new Error(`${sb.status} on scoreboard`);
  const out = {};
  for (const ev of ((await sb.json()).events) || []) {
    const st = ev.status && ev.status.type; if (!st || !st.completed) continue;
    try { const r = await fetch(`${base}/summary?event=${ev.id}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue; const b = parseBox(await r.json()); if (b) out[b.key] = b; } catch {}
  }
  return out;
}
