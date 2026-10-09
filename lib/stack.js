// Combo picks (10/9): every factor tested today (weather, surface, division, spread and total size, our game model's lean and
// size, the line's move since open, plus the ideas that failed alone), alone and in pairs, for 9 bet types. Kept only pairs that
// beat that bet's normal win rate in all three periods (2014-17 / 2018-21 / 2022-25), with 60+ games. Sources: nflverse results,
// aussportsbetting.com opening lines, and this app's game model replayed week by week on 2014-25 (no look-ahead).
// Luck check (10/9): with ~80 factors, shuffled results passed as many pairs as the real ones (603-769 vs 698), so a pair is
// kept only if it ALSO beats the best shuffled result for its bet type, or holds on 2006-13 games it was never fit on.
// Kept: favorite in wind 15+ with the model (68% worst period vs 65% luck bar), Under +6 in wind 10+ when the model says Over
// (81.6% worst vs ~80%), road dog <=3 +6 (75.7% on 2006-13 vs 68.8% for all dogs), turf dog <=3 +6 (74.9% on 2006-13).
// Dropped after that check: big fav + low total Over, line-move fav +6, division dogs, dome dog, model fav+Under Over, and others.
// Referee crews also showed up (dog +6 85% with a low-scoring crew) but crews aren't in our data before kickoff, so not used.
import { getRedis } from "./redis";

const sg = (x) => (x > 0 ? `+${x}` : `${x}`);
// m = our game model (homeMargin, total, wind, outdoor, fix.div, fix.turf); hs = home spread (negative = home favored);
// tl = total; hsOpen / tlOpen = the week's first saved lines.
export function stackPicks(g, m, hs, tl, hsOpen = null, tlOpen = null) {
  if (!m || hs == null || tl == null || hs === 0) return [];
  const out = [], fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, sp = Math.abs(hs);
  const gap = m.homeMargin != null ? m.homeMargin + hs : null;                 // + = model likes home vs the line
  const likesFav = gap == null ? null : (gap > 0) === (fav === g.home), big = gap != null && Math.abs(gap) >= 3;
  const tg = m.total != null ? m.total - tl : null;                            // + = model Over
  const wind = m.outdoor && m.wind != null ? m.wind : 0, turf = !!(m.fix && m.fix.turf), dome = g.outdoor === false;
  const div = !!(m.fix && m.fix.div), road = dog === g.away;
  const dogOpen = hsOpen != null ? (dog === g.home ? hsOpen : -hsOpen) : null, dogMoved = dogOpen != null ? sp - dogOpen : null; // - = toward the dog
  const tMove = tlOpen != null ? tl - tlOpen : null;
  const add = (id, why, pick, hit, n, bet) => out.push({ id, why, pick, hit, n, ...bet });
  const sideBet = (team, line) => ({ kind: "spread", team, line });
  const totBet = (side, line) => ({ kind: "total", side, line });
  if (wind >= 15 && likesFav === true) add("favwind", "Wind 15+ · model likes the favorite", `${fav} ${sg(-sp)}`, 70.3, 74, sideBet(fav, -sp));
  if (wind >= 10 && tg != null && tg > 0) add("windover6", `Wind 10+ · model says Over${tg >= 3 ? " by 3+" : ""}`, `Under ${tl + 6}`, tg >= 3 ? 83.3 : 80.8, tg >= 3 ? 102 : 281, totBet("under", tl + 6));
  if (sp <= 3 && road) add("roaddog6", "Road dog of 3 or less, +6", `${dog} ${sg(sp + 6)}`, 75.3, 497, sideBet(dog, sp + 6));
  else if (sp <= 3 && turf) add("turfdog6", "Turf · dog of 3 or less, +6", `${dog} ${sg(sp + 6)}`, 75.8, 380, sideBet(dog, sp + 6));
  return out;
}
export const STACK_NAMES = { favwind: "Favorite in wind 15+, model agrees", windover6: "Under +6, wind 10+, model Over", roaddog6: "Road dog ≤3, +6", turfdog6: "Turf dog ≤3, +6" };
export const skey = (s, w) => `stack:${s}:${w}`;
const jp = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
export async function recordStack(season, week, g, picks, t) {
  for (const p of picks) await getRedis().hset(skey(season, week), `${g.key}|${p.id}`, JSON.stringify({ ...p, game: g.key, home: g.home, week, t }));
  return picks.length;
}
export function gradeStackPick(p, homeScore, awayScore) {
  const m = homeScore - awayScore, tot = homeScore + awayScore;
  const x = p.kind === "total" ? (p.side === "under" ? p.line - tot : tot - p.line) : (p.team === p.home ? m : -m) + p.line;
  return x > 0 ? "W" : x < 0 ? "L" : "P";
}
export async function gradeStackWeek(season, week, finals) {
  const r = getRedis(), all = (await r.hgetall(skey(season, week))) || {}; let n = 0;
  for (const [f, v] of Object.entries(all)) { const p = jp(v); if (!p || p.result) continue; const g = finals.find((y) => y.key === p.game); if (!g || g.homeScore == null) continue;
    p.result = gradeStackPick(p, g.homeScore, g.awayScore); await r.hset(skey(season, week), f, JSON.stringify(p)); n++; }
  return n;
}
export async function stackSummary(season) {
  const r = getRedis(), rows = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `stack:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jp(v); if (e) rows.push(e); } } while (c !== "0");
  const d = rows.filter((x) => x.result === "W" || x.result === "L"), w = d.filter((x) => x.result === "W").length;
  return { recorded: rows.length, n: d.length, w, l: d.length - w };
}
