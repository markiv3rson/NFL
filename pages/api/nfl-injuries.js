import { loadInjuries } from "../../lib/injuries";
export default async function handler(req, res) {
  try { res.status(200).json({ ok: true, fetchedAt: new Date().toISOString(), teams: await loadInjuries() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
