import { gradeRecent } from "../../../lib/grade";
export default async function handler(req, res) {
  try { res.status(200).json({ ok: true, graded: await gradeRecent() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
