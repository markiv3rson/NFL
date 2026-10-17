import { loadFutures } from "../../../nba/lib/futures";
export const config = { maxDuration: 40 };
export default async function handler(req, res) {
  try { res.setHeader("Cache-Control", "no-store"); res.status(200).json(await loadFutures()); }
  catch (e) { res.status(200).json({ ok: false, error: String(e.message || e) }); }
}
