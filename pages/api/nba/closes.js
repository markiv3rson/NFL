import { loadCloses } from "../../../nba/lib/closes";
export default async function handler(req, res) {
  try { const closes = await loadCloses({ since: req.query.since || null }); res.status(200).json({ ok: true, n: closes.length, closes }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
