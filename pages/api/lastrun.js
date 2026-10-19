// Last model refresh for the menu (10/17, owner: "last model refresh with date and time", one line, the newest of the two):
// NFL = the last model rerun saved for the current week; NBA = the last snapshot whose model call answered (NBA's numbers come with every snapshot).
import { SEASON, displayWeek } from "../../lib/games";
import { getJSON, K } from "../../lib/redis";
import { getRedis as nbaRedis, jparse } from "../../nba/lib/redis";

export default async function handler(req, res) {
  let nfl = null, nba = null;
  try { const d = await displayWeek(SEASON);   // 10/19: on Mondays the shown week (next week) and the Monday game's week -- the newer run
    for (const w of new Set([d.cur, d.week])) { const m = await getJSON(K.model(SEASON, w)); if (m && m.runAt && (!nfl || m.runAt > nfl)) nfl = m.runAt; } } catch {}
  try { const s = jparse(await nbaRedis().get("status:snapshot")); if (s && s.t && s.modelOk !== false) nba = s.t; } catch {}
  const newest = [nfl, nba].filter(Boolean).sort().pop() || null;
  res.status(200).json({ ok: true, nfl, nba, newest });
}
