import { SEASON } from "../../lib/games";
import { listAlerts, listResults } from "../../lib/alerts";
// Alerts feed, newest first. ?results=1 = the result lines for the top of the Bets tab (10/18).
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.query.results === "1") return res.status(200).json({ ok: true, results: await listResults(SEASON, 40) });
  res.status(200).json({ ok: true, alerts: await listAlerts(SEASON, 100) });
}
