import { buildWeek } from "../../lib/week";
import { loadInjuriesMeta } from "../../lib/injuries";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const inj = await loadInjuriesMeta().catch(() => null), injuries = inj ? inj.teams : null;
    const data = await buildWeek({ week: Number(req.query.week) || undefined, injuries });
    res.status(200).json({ ok: true, ...data, injuries, injuriesUpdated: inj ? inj.updated : null, now: new Date().toISOString() });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
