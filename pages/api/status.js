// Called by the Railway scheduler after it saves the nightly backup or runs the weekly TD retrain.
import { setJSON } from "../../lib/redis";
import { SEASON, currentWeek } from "../../lib/games";
export default async function handler(req, res) {
  try {
    if (req.query.backup) await setJSON("status:backup", { t: new Date().toISOString(), where: req.query.backup, files: Number(req.query.files) || null });
    if (req.query.combos) await setJSON("status:combos", { t: new Date().toISOString(), summary: req.query.combos });   // weekly combo rebuild (10/9)
    if (req.query.retrain) await setJSON("status:retrain", { t: new Date().toISOString(), summary: req.query.retrain });
    // A new touchdown model went live: remember from which week, so the touchdown correction counts older games half (lib/calibration.js).
    if (req.query.retrain && /^went live/i.test(req.query.retrain)) await setJSON("tdmodel:switch", { t: new Date().toISOString(), season: SEASON, week: await currentWeek(SEASON).catch(() => null) });
    res.status(200).json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
