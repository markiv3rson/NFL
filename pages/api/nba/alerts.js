import { listAlerts } from "../../../nba/lib/alerts";
// Alerts feed for the bell: newest first.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, alerts: await listAlerts(100) });
}
