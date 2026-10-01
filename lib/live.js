// Live Polymarket lines for games in progress (added 10/1). DISPLAY ONLY: nothing is stored, so the kickoff snapshot,
// closing line, pre-log, model numbers and every grade stay locked at kickoff exactly as before.
// Returns { "AWAY @ HOME": poly | null } for every game that has started and is not final; null = Polymarket has no open
// lines for it right now (paused, or the event is gone), and the page says so instead of showing stale numbers.
import { gameLines } from "./poly";
import { started } from "./games";
export async function liveLines(games, events) {
  const out = {};
  await Promise.all(games.filter((g) => started(g) && !g.final).map(async (g) => { out[g.key] = await gameLines(events, g.away, g.home).catch(() => null); }));
  return out;
}
