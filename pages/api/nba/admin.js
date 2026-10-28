// Signed-in one-off actions (lib/admin.js): ?do=rebuild starts the model service's daily rebuild now;
// ?do=unrecord&date=YYYY-MM-DD moves that day's early picks and parlays out of the record (kept under removed:*; only a day outside the record window).
import { startRebuild, unrecordDay } from "../../../nba/lib/admin";
import { gradeNbaProps } from "../../../nba/lib/props";
import { gradeParlays } from "../../../nba/lib/parlays";
import { finalsFor, sharedBox } from "../../../nba/lib/espn";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const q = req.query || {};
    if (q.do === "rebuild") return res.status(200).json(await startRebuild());
    // 10/28: ?do=regradeprops[&date=YYYY-MM-DD] looks at every graded prop row and parlay prop leg of the last 7 days (or that day) again NOW
    if (q.do === "regradeprops") { const box = sharedBox(), date = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || "")) ? String(q.date) : null;
      return res.status(200).json({ ok: true, props: await gradeNbaProps({ dates: date ? [date] : null, fetchBox: box, force: true }), parlays: await gradeParlays(finalsFor, box, Date.now(), { force: true, date }) }); }
    if (q.do === "unrecord" && /^\d{4}-\d{2}-\d{2}$/.test(String(q.date || ""))) return res.status(200).json(await unrecordDay(String(q.date)));
    res.status(400).json({ ok: false, error: "do=rebuild, do=regradeprops[&date=YYYY-MM-DD] or do=unrecord&date=YYYY-MM-DD" });
  } catch (e) { res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
}
