// Opening lines (10/9): each game's FIRST saved Polymarket spread and total this season, for the weekly combo rebuild on Railway
// (weekly_rebuild.py). so = home team favored by (points), to = total.
import { getRedis, jparse, K } from "../../lib/redis";
import { SEASON, loadSeason } from "../../lib/games";
export default async function handler(req, res) {
  try {
    const season = Number(req.query.season) || SEASON, r = getRedis(), out = [];
    for (const g of await loadSeason(season)) {
      const first = (await r.lrange(K.snaps(season, g.week, g.key), 0, 5)).map(jparse).find((x) => x && x.poly && x.poly.spread && x.poly.total);
      if (first) out.push({ season, week: g.week, away: g.away, home: g.home, so: -first.poly.spread.homeSpread, to: first.poly.total.line });
    }
    res.status(200).json({ ok: true, season, games: out });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
