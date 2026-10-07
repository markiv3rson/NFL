import { getRedis, getJSON, K } from "../../../lib/redis";
import { SEASON } from "../../../lib/games";
import { edgeSummary } from "../../../lib/edges";
import { paperSummary, picksSummary } from "../../../lib/paper";
import { currentWeek } from "../../../lib/games";
import { teaserSummary } from "../../../lib/teaser";
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers(K.resIds)) || [];
    const raw = ids.length ? await redis.mget(ids.map((id) => `res:${id}`)) : [];
    const results = raw.filter(Boolean).map((r) => JSON.parse(r)).sort((a, b) => b.week - a.week || a.game.localeCompare(b.game));
    // Graded players saved before 10/5 have no position: fill it from the model run the record was graded against (same week, same game, same name and team).
    const models = {};
    for (const r of results) { if (!(r.td || []).some((p) => !p.pos)) continue;
      const mk = `${r.season}:${r.week}`; if (!(mk in models)) models[mk] = (await getJSON(K.model(r.season, r.week)).catch(() => null)) || null;
      const mt = models[mk] && models[mk].td && models[mk].td[r.game]; if (!mt) continue;
      const by = new Map([...(mt.away || []), ...(mt.home || [])].map((x) => [String(x.name), x.pos]));
      for (const p of r.td) if (!p.pos && by.get(String(p.player))) p.pos = by.get(String(p.player)); }
    // This season only (9/30: after a rollover the Record tab mixed seasons); edge stats computed live, not from the last grading
    res.status(200).json({ ok: true, results: results.filter((r) => Number(r.season) === SEASON), edges: await edgeSummary(SEASON).catch(() => null),
      paper: await paperSummary(SEASON, await currentWeek(SEASON).catch(() => null)).catch(() => null),
      picks: await picksSummary(SEASON).catch(() => null), teasers: await teaserSummary(SEASON).catch(() => null) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
