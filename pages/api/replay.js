import { loadReplay } from "../../lib/replay";
// History table for the Results tab: every tracked pick rule replayed on past seasons (read-only).
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try { res.status(200).json({ ok: true, replay: await loadReplay() }); } catch (e) { res.status(502).json({ ok: false, error: String(e) }); }
}
