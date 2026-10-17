// Last model refresh for the menu (10/17, owner: "last model refresh with date and time", one line, the newest of the two):
// NFL = the last model rerun saved for the current week; NBA = the last snapshot whose model call answered (NBA's numbers come with every snapshot).
import { SEASON, currentWeek } from "../../lib/games";
import { getJSON, K } from "../../lib/redis";
import { getRedis as nbaRedis, jparse } from "../../nba/lib/redis";

export default async function handler(req, res) {
  let nfl = null, nba = null;
  try { const w = await currentWeek(SEASON); const m = await getJSON(K.model(SEASON, w)); nfl = (m && m.runAt) || null; } catch {}
  try { const s = jparse(await nbaRedis().get("status:snapshot")); if (s && s.t && s.modelOk !== false) nba = s.t; } catch {}
  const newest = [nfl, nba].filter(Boolean).sort().pop() || null;
  res.status(200).json({ ok: true, nfl, nba, newest });
}
