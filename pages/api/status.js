// Called by the Railway scheduler after it saves the nightly backup or runs the weekly TD retrain.
import { setJSON } from "../../lib/redis";
export default async function handler(req, res) {
  try {
    if (req.query.backup) await setJSON("status:backup", { t: new Date().toISOString(), where: req.query.backup, files: Number(req.query.files) || null });
    if (req.query.retrain) await setJSON("status:retrain", { t: new Date().toISOString(), summary: req.query.retrain });
    res.status(200).json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
