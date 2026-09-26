import { loadMyBets, syncAccount } from "../../lib/mybets";
export const config = { maxDuration: 120 };
export default async function handler(req, res) {
  try {
    let sync = null;
    if (req.query.sync === "1") sync = await syncAccount().catch((e) => ({ ok: false, note: String(e) }));
    res.status(200).json({ ok: true, sync, keysSet: !!(process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY), ...(await loadMyBets()) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
