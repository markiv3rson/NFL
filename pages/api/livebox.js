// Live grading facts (10/28 late, lib/livebox.js): ESPN's live box score of every game of the week on screen that kicked off in the last 12 hours
// (still being played, or just finished and not graded yet). Read-only; a 4-second cache (10/30; was 20 s) so open phones share one ESPN pull.
import { SEASON, displayWeek, loadGames, started } from "../../lib/games";
import { liveBoxes } from "../../lib/livebox";
import { getRedis, BUILD } from "../../lib/redis";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "application/json");
  try {
    const season = SEASON, dw = await displayWeek(season), r = getRedis(), ck = `livebox:cache:${BUILD}:${dw.week}`;
    const hit = await r.get(ck).catch(() => null); if (hit) return res.status(200).send(hit);
    const rows = [...(await loadGames(season, dw.week)), ...(dw.carry.length ? (await loadGames(season, dw.cur)).filter((g) => dw.carry.includes(g.key)) : [])];
    const now = Date.now(), keys = rows.filter((g) => started(g, now) && now - Date.parse(g.kickoff) < 12 * 3600e3).map((g) => g.key);
    const body = JSON.stringify({ ok: true, t: new Date().toISOString(), games: await liveBoxes(keys) });
    await r.set(ck, body, "EX", 4).catch(() => {});
    res.status(200).send(body);
  } catch (err) { res.status(200).send(JSON.stringify({ ok: false, error: String(err).slice(0, 200) })); }
}
