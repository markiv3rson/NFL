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
    // Watchdog (added 9/28): plain-language list of anything missing or stale, so nothing fails silently.
    const now = Date.now(), H = 3600e3, soon = data.games.filter((g) => !g.started && g.kickoff && new Date(g.kickoff) - now < 48 * H);
    const watch = [];
    if (data.modelRunAt && now - new Date(data.modelRunAt) > 4 * 24 * H) watch.push(`Model last ran ${Math.round((now - new Date(data.modelRunAt)) / 86400e3)} days ago — tap ▶ Rerun model.`);
    const noModel = data.games.filter((g) => !g.started && !g.model).map((g) => g.key); if (noModel.length) watch.push(`No model numbers yet: ${noModel.join(", ")}.`);
    const noLines = soon.filter((g) => !g.poly).map((g) => g.key); if (noLines.length) watch.push(`No Polymarket game lines within 48 h of kickoff: ${noLines.join(", ")}.`);
    const noTd = soon.filter((g) => !(g.td || []).some((r) => r.price != null)).map((g) => g.key); if (noTd.length) watch.push(`No Polymarket TD prices yet within 48 h of kickoff: ${noTd.join(", ")}.`);
    const noTdModel = data.games.filter((g) => !g.started && g.poly && !(g.td || []).length).map((g) => g.key); if (noTdModel.length) watch.push(`No TD model yet: ${noTdModel.join(", ")} — rerun after lines post.`);
    const dow = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short" });
    const injWeeks = inj ? [...new Set(Object.values(inj.teams).flat().map((x) => Number(x.week)))] : [];
    if (["Thu", "Fri", "Sat", "Sun"].includes(dow) && !injWeeks.includes(Number(data.week))) watch.push(`This week's official injury report isn't in the feed yet — injury adjustments are off until it is.`);
    if (status && status.lastSnapshot && now - new Date(status.lastSnapshot) > 8 * H) watch.push(`No price snapshot in ${Math.round((now - new Date(status.lastSnapshot)) / H)} h — check the Railway scheduler.`);
    if (status && (!status.backup || now - new Date(status.backup.t) > 36 * H)) watch.push(`No backup in the last 36 h — check the Railway volume.`);
    if (status && status.retrain && /^failed/.test(status.retrain.summary || "")) watch.push(`Last TD retrain failed: ${String(status.retrain.summary).slice(0, 90)}`);
    weekCheck.watch = watch;
    res.status(200).json({ ok: true, ...data, injuries: undefined, injuriesUpdated: inj ? inj.updated : null, status, weekCheck, missFinder, now: new Date().toISOString() });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
