import { loadMyBets, syncAccount } from "../../lib/mybets";
export const config = { maxDuration: 120 };
export default async function handler(req, res) {
  try {
    let sync = null;
    if (req.query.sync === "1") sync = await syncAccount().catch((e) => ({ ok: false, note: String(e) }));
    const { raw, ...out } = await loadMyBets();   // 10/27: the raw Polymarket copy (positions + activities, ~1.2 MB) only on ?raw=1 -- the page never reads it
    res.status(200).json({ ok: true, sync, keysSet: !!(process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY), ...out, ...(req.query.raw === "1" ? { raw } : {}) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
