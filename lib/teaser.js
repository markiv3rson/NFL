// Teaser legs (10/6): an underdog getting +1.5 to +2.5 bought 6 points higher (+7.5 to +8.5) crosses both key numbers, 3 and 7.
// 2007-25 regular season, sportsbook closing lines (nflverse games.csv): that leg covered 76.1% of 616 games, steady by period
// (2007-12 75.8%, 2013-18 74.8%, 2019-25 77.2%). The favorite version (-7.5..-8.5 down to -1.5..-2.5) covered 73.4% but only 70.5% in
// 2019-25, so it is not used. Polymarket lists alternate spreads, so the leg can be bought there as a single market: it is worth it only
// when its price sits clearly under the historical rate. TEASE_MAX_PRICE leaves ~3 points of room for fees and for history running hot.
import { getRedis } from "./redis";
export const TEASE_HIST = { hit: 0.761, n: 616, years: "2007–25" };
// Any line you can get (10/9): underdogs of +1.5..+2.5 at kickoff, 2007-25 (631 games), share that covered each line.
export const DOG_LADDER = [{ line: 6.5, hist: 0.686 }, { line: 7.5, hist: 0.737 }, { line: 8.5, hist: 0.765 }, { line: 9.5, hist: 0.78 }, { line: 10.5, hist: 0.818 }];
export const TEASE_MAX_PRICE = 0.73;
export const tkey = (s, w) => `teaser:${s}:${w}`;
const jp = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };

// The game's spread from the home side (negative = home favored): sportsbook line first, Polymarket's main line if no book line.
const homeLine = (poly, books) => (books && books.spread && books.spread.homeSpread != null ? books.spread.homeSpread : poly && poly.spread ? poly.spread.homeSpread : null);
export function teaserLeg(g, poly, books) {
  const hs = homeLine(poly, books); if (hs == null || !isFinite(hs)) return null;
  const dog = hs > 0 ? g.home : hs < 0 ? g.away : null, base = Math.abs(hs);
  if (!dog || base < 1.5 || base > 2.5) return null;
  const line = base + 6, alt = ((poly && poly.alts) || []).find((a) => a.team === dog && a.line === line) || null;
  const price = alt ? alt.price : null;
  const ladder = DOG_LADDER;
  return { game: g.key, team: dog, base, line, price, value: price != null && price <= TEASE_MAX_PRICE, ladder };
}
// Totals moved 6 points (10/9): 2007-25, any total, the Over moved down 6 or the Under moved up 6 won 66-69% in every period
// (neither side better). The side follows the model's lean (Under when it has none). Paper only.
export const TOTAL_TEASE_HIST = { hit: 0.673, n: 4991, years: "2007–25" };
const totalLine = (poly, books) => (books && books.total && books.total.line != null ? books.total.line : poly && poly.total ? poly.total.line : null);
export function totalLeg(g, poly, books, under) {
  const tl = totalLine(poly, books); if (tl == null || !isFinite(tl)) return null;
  const side = under === false ? "over" : "under";
  return { game: g.key, kind: "total", side, base: tl, line: side === "under" ? tl + 6 : tl - 6 };
}
export async function recordTotalLeg(season, week, g, poly, books, under, t, open = null, modelUnder = false) {
  const leg = totalLeg(g, poly, books, under); if (!leg) return 0;
  await getRedis().hset(tkey(season, week), `${g.key}|total`, JSON.stringify({ ...leg, week, t }));
  const mv = totalMove(open, leg.base);   // straight bet at the kickoff line when the total fell 3+ from the opening line
  if (mv && mv.under && modelUnder) await getRedis().hset(tkey(season, week), `${g.key}|totmove`, JSON.stringify({ game: g.key, kind: "total", move: true, side: "under", base: leg.base, line: leg.base, open, week, t }));
  return 1;
}
// Total moved 3+ points from the opening line (10/9, aussportsbetting.com open/close lines 2014-26, regular season):
// dropped 3+ -> Under at the new line won 57.9% (n=311; 62/60/56% by period); 63.5% when our game model also said Under
// (replayed 2014-25, n=63; 67/63/62%), 51% when it said Over, so the pick needs the model's Under. Either way 3+, that side +6 won 75%.
// Rises of 3+ toward the Over were not steady (59/47/57%), so only the drop is a straight pick.
export const TOTAL_MOVE = { under: 0.579, teased: 0.754 };
export function totalMove(open, now) {
  if (open == null || now == null || !isFinite(open) || !isFinite(now) || Math.abs(now - open) < 3) return null;
  return { under: now < open, by: Math.abs(now - open) };
}
// Saved at kickoff (the last write before kickoff wins), graded after; paper only.
export async function recordTeaser(season, week, g, poly, books, t) {
  const leg = teaserLeg(g, poly, books); if (!leg) return 0;
  await getRedis().hset(tkey(season, week), g.key, JSON.stringify({ ...leg, week, t })); return 1;
}
export async function gradeTeasersWeek(season, week, finals) {
  const r = getRedis(), all = (await r.hgetall(tkey(season, week))) || {}; let n = 0;
  for (const g of finals) for (const f of [g.key, `${g.key}|total`, `${g.key}|totmove`, `${g.key}|early`]) { const leg = jp(all[f]); if (!leg || leg.result || g.homeScore == null) continue;
    const m = g.homeScore - g.awayScore, tot = g.homeScore + g.awayScore;
    const x = leg.kind === "total" ? (leg.side === "under" ? leg.line - tot : tot - leg.line) : (leg.team === g.home ? m : -m) + leg.line;
    leg.result = x > 0 ? "W" : x < 0 ? "L" : "P";
    leg.ret = leg.price ? (leg.result === "W" ? 1 / leg.price - 1 : leg.result === "L" ? -1 : 0) : null;
    await r.hset(tkey(season, week), f, JSON.stringify(leg)); n++; }
  return n;
}
export function teaserAgg(legs) {
  const d = legs.filter((x) => x.result === "W" || x.result === "L"), w = d.filter((x) => x.result === "W").length, pr = d.filter((x) => x.ret != null);
  return { n: d.length, w, l: d.length - w, hit: d.length ? w / d.length : null, priced: pr.length, roi: pr.length ? pr.reduce((a, x) => a + x.ret, 0) / pr.length : null,
    avgPrice: pr.length ? pr.reduce((a, x) => a + x.price, 0) / pr.length : null };
}
export async function teaserSummary(season) {
  const r = getRedis(), legs = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `teaser:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jp(v); if (e) legs.push(e); } } while (c !== "0");
  const er = legs.filter((x) => x.early), mv = legs.filter((x) => x.move), tl = legs.filter((x) => x.kind === "total" && !x.move && !x.early), sl = legs.filter((x) => x.kind !== "total");
  return { all: teaserAgg(sl), value: teaserAgg(sl.filter((x) => x.value)), recorded: sl.length, totals: { ...teaserAgg(tl), recorded: tl.length, hist: TOTAL_TEASE_HIST }, moves: { ...teaserAgg(mv), recorded: mv.length }, early: { ...teaserAgg(er), recorded: er.length }, hist: TEASE_HIST, maxPrice: TEASE_MAX_PRICE };
}

// Early-week total (10/9): saved ONCE, the first time the early model disagrees with the opening total by 0.5+ while the total is still
// at its opening number; graded at that opening number (the price you get by betting early). Paper only.
export async function recordEarlyTotal(season, week, g, early, open, now, t) {
  if (early == null || open == null || now == null || Math.abs(now - open) >= 0.5 || Math.abs(early - open) < 0.5) return 0;
  const side = early > open ? "over" : "under";
  return getRedis().hsetnx(tkey(season, week), `${g.key}|early`, JSON.stringify({ game: g.key, kind: "total", early: true, side, base: open, line: open, model: early, week, t }));
}
