// Past betting splits for testing (10/12, owner: "build now"). One NFL week from Action Network's public scoreboard, read-only:
// each game's teams, final score and the consensus (book 15) / opening (book 30) rows with lines + bets % / money %. Nothing is
// stored or shown; it exists so the splits ideas can be tested on past seasons (2018-2025 have splits; the current season does not).
const BASE = "https://api.actionnetwork.com/web/v1/scoreboard/nfl?period=game";
export default async function handler(req, res) {
  const season = Number(req.query.season), week = Number(req.query.week);
  if (!(season >= 2015 && season <= 2030 && week >= 1 && week <= 18 && Number.isInteger(week))) return res.status(400).json({ ok: false, error: "season 2015-2030, week 1-18" });
  try {
    const r = await fetch(`${BASE}&season=${season}&week=${week}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(200).json({ ok: false, status: r.status });
    const j = await r.json(), games = [];
    const KEEP = /public|money|spread_home$|spread_away$|^total$|^ml_home$|^ml_away$|^over$|^under$|_line$|num_bets|book_id|^inserted$/;
    for (const g of j.games || []) {
      if (g.status !== "complete") continue;
      const teams = Object.fromEntries((g.teams || []).map((t) => [t.id, t.abbr])), b = g.boxscore || {};
      const rows = (g.odds || []).filter((o) => o && (o.book_id === 15 || o.book_id === 30) && o.type === "game")
        .map((o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => KEEP.test(k) && (typeof v === "number" || typeof v === "string"))));
      games.push({ id: g.id, start: g.start_time, away: teams[g.away_team_id], home: teams[g.home_team_id], as: b.total_away_points ?? null, hs: b.total_home_points ?? null, rows });
    }
    res.setHeader("Cache-Control", "s-maxage=86400");
    res.status(200).json({ ok: true, season, week, games });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
