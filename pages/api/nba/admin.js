// Signed-in one-off actions (lib/admin.js): ?do=rebuild starts the model service's daily rebuild now;
// ?do=unrecord&date=YYYY-MM-DD moves that day's early picks and parlays out of the record (kept under removed:*; only a day outside the record window).
import { startRebuild, unrecordDay } from "../../../nba/lib/admin";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const q = req.query || {};
    if (q.do === "rebuild") return res.status(200).json(await startRebuild());
    if (q.do === "unrecord" && /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || ""))) return res.status(200).json(await unrecordDay(String(q.date)));
    res.status(400).json({ ok: false, error: "do=rebuild or do=unrecord&date=YYYY-MM-DD" });
  } catch (e) { res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
}
