import { buildWeek } from "../../lib/week";
import { loadInjuries } from "../../lib/injuries";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const injuries = await loadInjuries().catch(() => null);
    const data = await buildWeek({ week: Number(req.query.week) || undefined, injuries });
    res.status(200).json({ ok: true, ...data, injuries, now: new Date().toISOString() });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
