import { gradeRecent } from "../../../lib/grade";
import { syncAccount } from "../../../lib/mybets";
import { getRedis } from "../../../lib/redis";
export const config = { maxDuration: 120 };
export default async function handler(req, res) {
  try {
    // ?lock=1 (the open page): at most one run every 5 minutes across every open tab/phone; the scheduler calls without it.
    if (req.query.lock === "1" && !(await getRedis().set("grade:lock", "1", "EX", 300, "NX"))) return res.status(200).json({ ok: true, ran: false });
    const graded = await gradeRecent();
    // Also pull the Polymarket account (settled bets) so My Bets updates on every grade run, not only on snapshots.
    const account = await syncAccount().catch((e) => ({ ok: false, note: String(e) }));
    res.status(200).json({ ok: true, ran: true, graded, account });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
