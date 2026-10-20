// TD by week for the Anytime TD page (10/20 night): { ok, season, upto, weeks: { w: { games: ["A @ B"...], counts: { "A @ B": { "D.Swift": 1 } }, final } } }
import { tdWeeks } from "../../lib/tdweeks";
import { SEASON } from "../../lib/games";
export default async function handler(req, res) {
  try { const out = await tdWeeks(Number(req.query.season) || SEASON); res.setHeader("Cache-Control", "no-store"); res.status(200).json({ ok: true, ...out }); }
  catch (e) { res.status(200).json({ ok: false, error: String(e && e.message || e) }); }
}
