// Bets -> Model bets: every parlay the app saved, by day and type, with results (lib/parlays.js).
import { loadParlays } from "../../../nba/lib/parlays";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const days = {};
    for (const p of await loadParlays()) { const { _k, ...row } = p; const D = (days[p.date] = days[p.date] || {}); (D[p.type] = D[p.type] || []).push(row); }
    res.status(200).json({ ok: true, days });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
