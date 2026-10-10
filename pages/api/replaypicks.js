// Replay weeks that finished before the 10/9 picks existed (lib/backfill.js). GET /api/replaypicks?weeks=3,4
import { replayWeek } from "../../lib/backfill";
import { SEASON } from "../../lib/games";
export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  try {
    const weeks = String(req.query.weeks || "").split(",").map(Number).filter((w) => w >= 1 && w <= 22), out = {};
    for (const w of weeks) out[w] = await replayWeek(SEASON, w);
    res.status(200).json({ ok: true, saved: out });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
