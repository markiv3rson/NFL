// Final scores from ESPN's public scoreboard (added 10/2). nflverse posts final scores hours after a game ends (sometimes the next
// day), so bets, the moneyline/spread/total grades and the Record waited on it. A game that nflverse still shows as unfinished,
// kicked off more than 3 h 15 min ago, and ESPN reports completed, is treated as final with ESPN's score. Touchdown results still
// wait for the official play-by-play (grading skips a game's TD part until it is posted), so nothing is guessed.
import { teamOf } from "./espn";
const URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
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
  try {
    const r = await fetcher(URL, { cache: "no-store", signal: AbortSignal.timeout(8000) }); if (!r.ok) return 0;
    const f = finalsFromScoreboard(await r.json()); let n = 0;
    for (const g of due) { const x = f[g.key]; if (x) { g.final = true; g.awayScore = x.a; g.homeScore = x.h; g.espnFinal = true; n++; } }
    return n;
  } catch { return 0; }
}
