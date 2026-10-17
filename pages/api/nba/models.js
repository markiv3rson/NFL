import { modelBase, modelHeaders } from "../../../nba/lib/model";
import { loadPicks, summarize, clvSummary } from "../../../nba/lib/record";
import { loadMoves, summarizeMoves } from "../../../nba/lib/pinnacle";
import { loadCloses } from "../../../nba/lib/closes";
import { loadParlays, summarizeParlays } from "../../../nba/lib/parlays";
import { getStatus } from "../../../nba/lib/status";
export const config = { maxDuration: 30 };
export default async function handler(req, res) {
  try {
    const base = modelBase(); let svc = null, error = null;
    if (base) { try { const r = await fetch(`${base}/models`, { headers: modelHeaders(), cache: "no-store", signal: AbortSignal.timeout(20000) }); svc = await r.json(); } catch (e) { error = String(e); } }
    else error = "MODEL_SERVICE_URL not set";
    const picks = await loadPicks().catch(() => []);
    const system = await getStatus().catch(() => null);
    const moves = summarizeMoves(await loadMoves().catch(() => []));
    const parlays = summarizeParlays(await loadParlays().catch(() => []));
    const clv = clvSummary(picks, await loadCloses().catch(() => []));
    res.status(200).json({ ok: true, error, report: svc && svc.report, patterns: svc && svc.patterns, rebuild: svc && svc.status, record: summarize(picks), recent: picks.slice(0, 40), system, clv, moves, parlays });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
