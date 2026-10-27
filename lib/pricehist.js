// /api/pricehist and /api/nba/pricehist (10/27, owner: the game page chart): one game's moneyline price history from Polymarket US, both teams.
// ?sport=nfl|nba&away=CAR&home=GB&start=<ISO kickoff>&range=1d|1w|1m|all|live -> { ok, slug, range, pts: [[t, away, home]] }
// Cached at the edge for 30 s (Polymarket asks for at least 30 s), live 15 s.
import { moneylineSlug, priceHistory, HIST_RANGES } from "./polyus";
export default async function priceHistHandler(req, res, sport) {
  const q = req.query || {}, sp = sport || (q.sport === "nba" ? "nba" : "nfl"), range = HIST_RANGES[q.range] ? q.range : "all";
  const slug = moneylineSlug(sp, String(q.away || ""), String(q.home || ""), String(q.start || ""));
  if (!slug || !/^[A-Za-z]{2,4}$/.test(String(q.away || "")) || !/^[A-Za-z]{2,4}$/.test(String(q.home || ""))) return res.status(400).json({ ok: false, error: "away, home and start are needed" });
  try {
    const pts = await priceHistory(slug, range);
    res.setHeader("Cache-Control", `public, s-maxage=${range === "live" ? 15 : 30}, stale-while-revalidate=60`);
    res.status(200).json({ ok: true, slug, range, pts });
  } catch (e) { res.status(200).json({ ok: false, slug, range, pts: [], error: String(e.message || e) }); }
}
