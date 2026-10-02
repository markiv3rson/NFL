import { gradeRecent } from "../../../lib/grade";
import { syncAccount } from "../../../lib/mybets";
export default async function handler(req, res) {
  try {
    const graded = await gradeRecent();
    // Also pull the Polymarket account (settled bets) so My Bets updates on every grade run, not only on snapshots.
    const account = await syncAccount().catch((e) => ({ ok: false, note: String(e) }));
    res.status(200).json({ ok: true, graded, account });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
