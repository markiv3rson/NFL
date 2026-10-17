import { loadPicks, summarize } from "../../../../nba/lib/record";
export default async function handler(req, res) {
  try { const picks = await loadPicks(); res.status(200).json({ ok: true, summary: summarize(picks), picks }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
