import { gradeAll, gradePick } from "../../../../nba/lib/record";
import { finalsFor } from "../../../../nba/lib/espn";
import { gradeMoves } from "../../../../nba/lib/pinnacle";
import { gradeParlays } from "../../../../nba/lib/parlays";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try { res.status(200).json({ ok: true, graded: await gradeAll(), moves: await gradeMoves(finalsFor, gradePick).catch(() => 0), parlays: await gradeParlays(finalsFor).catch(() => 0) }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
