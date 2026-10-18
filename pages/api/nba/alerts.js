import { listAlerts, listResults } from "../../../nba/lib/alerts";
// Alerts feed, newest first. ?results=1 = the result lines for the top of the Bets tab (10/18).
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.query.results === "1") return res.status(200).json({ ok: true, results: await listResults(40) });
  res.status(200).json({ ok: true, alerts: await listAlerts(100) });
}
