import { SEASON, currentWeek, loadGames, started } from "../../lib/games";
import { fetchEvents } from "../../lib/poly";
import { liveLines } from "../../lib/live";
import { getRedis, BUILD } from "../../lib/redis";
// Current Polymarket lines for games in progress. Read-only: writes nothing but a 15-second cache (so a few open tabs
// share one Polymarket request). Polymarket is only called while some game is actually in progress.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "application/json");
  try {
    const season = SEASON, week = await currentWeek(season), r = getRedis(), ck = `live:cache:${BUILD}:${week}`;
    const hit = await r.get(ck).catch(() => null);
    if (hit) return res.status(200).send(hit);
    const games = (await loadGames(season, week)).filter((g) => started(g) && !g.final);
    const t = new Date().toISOString();
    let body;
    if (!games.length) body = JSON.stringify({ ok: true, t, games: {} });
    else {
      const events = await fetchEvents();
      body = JSON.stringify({ ok: true, t, games: await liveLines(games, events) });
    }
    await r.set(ck, body, "EX", 15).catch(() => {});
    res.status(200).send(body);
  } catch (err) { res.status(502).send(JSON.stringify({ ok: false, error: String(err) })); }
}
