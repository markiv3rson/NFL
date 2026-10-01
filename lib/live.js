// Live Polymarket lines for games in progress (added 10/1). DISPLAY ONLY: nothing is stored, so the kickoff snapshot,
// closing line, pre-log, model numbers and every grade stay locked at kickoff exactly as before.
// Returns { "AWAY @ HOME": poly | null } for every game that has started and is not final; null = Polymarket has no open
// lines for it right now (paused, or the event is gone), and the page says so instead of showing stale numbers.
import { gameLines } from "./poly";
import { started } from "./games";
import { teamOf } from "./espn";
export async function liveLines(games, events) {
  const out = {};
  await Promise.all(games.filter((g) => started(g) && !g.final).map(async (g) => { out[g.key] = await gameLines(events, g.away, g.home).catch(() => null); }));
  return out;
}

// Live score + clock from ESPN's public scoreboard (display only, like the lines). Returns { "AWAY @ HOME": { a, h, st, lbl } }
// for the given games: st = "in" | "post", lbl = "Q3 4:12" / "HALFTIME" / "OT 2:10" / "FINAL". A game ESPN doesn't list, one that
// hasn't started, or a score it doesn't have is simply left out (the page then shows nothing live rather than a guess).
export function parseScoreboard(json, keys) {
  const out = {}, want = new Set(keys);
  for (const ev of (json && json.events) || []) {
    const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    const by = {}; for (const t of c.competitors || []) { const abbr = teamOf(t.team && (t.team.displayName || t.team.name)); if (abbr && t.homeAway) by[t.homeAway] = { abbr, score: Number(t.score) }; }
    if (!by.home || !by.away || !isFinite(by.home.score) || !isFinite(by.away.score)) continue;
    const key = `${by.away.abbr} @ ${by.home.abbr}`; if (!want.has(key)) continue;
    const s = ev.status || c.status || {}, ty = s.type || {}, st = ty.state === "in" || ty.state === "post" ? ty.state : null; if (!st) continue;
    const per = Number(s.period) || 0, clock = s.displayClock && s.displayClock !== "0:00" ? String(s.displayClock) : "", det = String(ty.shortDetail || ty.detail || "");
    const lbl = st === "post" || ty.completed ? "FINAL" : /half/i.test(det) && !/end of/i.test(det) ? "HALFTIME" : per > 4 ? `OT${clock ? " " + clock : ""}` : per ? `Q${per}${clock ? " " + clock : ""}` : "LIVE";
    out[key] = { a: by.away.score, h: by.home.score, st, lbl };
  }
  return out;
}
export async function liveScores(games) {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return {};
    return parseScoreboard(await r.json(), games.map((g) => g.key));
  } catch { return {}; }
}
