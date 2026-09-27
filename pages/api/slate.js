import { buildWeek } from "../../lib/week";
import { loadInjuriesMeta } from "../../lib/injuries";
import { getStatus } from "../../lib/status";
import { getJSON } from "../../lib/redis";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const inj = await loadInjuriesMeta().catch(() => null), injuries = inj ? inj.teams : null;
    const data = await buildWeek({ week: Number(req.query.week) || undefined, injuries });
    const status = await getStatus(data.season, data.week, data.meta || {}, data.modelRunAt).catch(() => null);
    const missFinder = await getJSON(`missfinder:${data.season}`).catch(() => null);
    const weekCheck = { games: data.games.length, withLines: data.games.filter((g) => g.poly).length, modelRun: !!data.modelRunAt };
    res.status(200).json({ ok: true, ...data, injuries: undefined, injuriesUpdated: inj ? inj.updated : null, status, weekCheck, missFinder, now: new Date().toISOString() });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
