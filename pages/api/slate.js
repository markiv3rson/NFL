import { buildWeek } from "../../lib/week";
import { loadInjuriesMeta } from "../../lib/injuries";
import { getStatus } from "../../lib/status";
import { getJSON, getRedis, SLATE_CACHE, BUILD } from "../../lib/redis";
import { computeWatch } from "../../lib/watchdog";
import { winnersSummary, picksSummary } from "../../lib/paper";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const cacheable = !req.query.week;
    res.setHeader("x-build", BUILD);   // which deployment answered (the page reloads itself when this changes)
    if (cacheable) { const c = await getRedis().get(SLATE_CACHE).catch(() => null); if (c) { res.setHeader("Content-Type", "application/json"); return res.status(200).send(c); } }
    const inj = await loadInjuriesMeta().catch(() => null), injuries = inj ? inj.teams : null;
    const data = await buildWeek({ week: Number(req.query.week) || undefined, injuries, injuriesPrev: inj ? inj.prev : null });
    const status = await getStatus(data.season, data.week, data.meta || {}, data.modelRunAt).catch(() => null);
    const missFinder = await getJSON(`missfinder:${data.season}`).catch(() => null);
    const weekCheck = { games: data.games.length, withLines: data.games.filter((g) => g.poly).length, modelRun: !!data.modelRunAt };
    const watch = await computeWatch(data, status, inj);
    weekCheck.watch = watch;
    const winners = await winnersSummary(data.season).catch(() => null), picks = await picksSummary(data.season).catch(() => null);
    const body = JSON.stringify({ ok: true, ...data, winners, picks, injuries: undefined, injuriesUpdated: inj ? inj.updated : null, status, weekCheck, missFinder, now: new Date().toISOString() });
    if (cacheable) await getRedis().set(SLATE_CACHE, body, "EX", 60).catch(() => {});
    res.setHeader("Content-Type", "application/json"); res.status(200).send(body);
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
