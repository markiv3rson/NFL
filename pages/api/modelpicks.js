// Model bets pick tabs (10/28 late, owner: "Remove all the sub tabs under models bets and I need sub tabs for all the models picks in the card ...
// Game Line Picks for all games split by their time / Halves and quarters ... player props and game props also"). The SAVED picks of one week:
// each game's card picks locked at kickoff (spread / total / ML PICK + PICK w/ POINTS, stack:<s>:<w>), its 1H SPREAD and GAME PROPS picks
// (teaser:<s>:<w>) and its Best TD picks (55%+, from the graded results). The page uses the live slate for the week on screen before kickoff
// and this for every game that has started and every past week. Player prop picks come from /api/props. Read-only.
import { getRedis, jparse, K } from "../../lib/redis";
import { SEASON, displayWeek, loadGames, started } from "../../lib/games";
import { lockedPicksFrom, gpOut, h1Out } from "../../lib/week";
import { tkey } from "../../lib/tracked";
const BEST_TD = 55;
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const season = SEASON, dw = await displayWeek(season), week = Number(req.query.week) || dw.week, r = getRedis();
    const games = await loadGames(season, week);
    const [locked, teaser, resRaw] = await Promise.all([r.hgetall(`stack:${season}:${week}`).catch(() => ({})), r.hgetall(tkey(season, week)).catch(() => ({})),
      games.length ? r.mget(games.map((g) => K.res(season, week, g.key))).catch(() => []) : []]);
    const out = games.map((g, i) => {
      const L = started(g) ? lockedPicksFrom(locked || {}, g.key) : {}, h1 = jparse((teaser || {})[`${g.key}|h1spr`]), rs = jparse((resRaw || [])[i]);
      const gp = Object.entries(teaser || {}).filter(([f]) => f.startsWith(`${g.key}|gp|`)).map(([, v]) => jparse(v)).filter((x) => x && x.label).map(gpOut).sort((a, b) => b.said - a.said);
      const td = rs && Array.isArray(rs.td) ? rs.td.filter((p) => p.fair >= BEST_TD && p.played !== false).map((p) => ({ player: p.player, team: p.team, fair: p.fair, price: p.ask ?? null, scored: typeof p.scored === "boolean" ? p.scored : null })) : [];
      return { key: g.key, away: g.away, home: g.home, kickoff: g.kickoff, week, started: started(g), final: !!g.final, awayScore: g.awayScore ?? null, homeScore: g.homeScore ?? null,
        lines: L, h1pick: h1 && h1.team ? h1Out(h1) : null, gprops: gp, td };
    });
    const weeks = []; for (let w = 1; w <= dw.week; w++) weeks.push(w);
    res.status(200).json({ ok: true, season, week, weeks, games: out });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
