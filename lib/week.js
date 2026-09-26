// Builds the full week view (used by /api/slate and grading).
import { SEASON, currentWeek, loadGames, started, GAME_HOURS } from "./games";
import { getRedis, getJSON, K } from "./redis";
import { SEED, FLAGS } from "./seed";
import { spreadPick, totalPick, gameBets, tdRows, correlationWarnings } from "./picks";
import { venue } from "./wind";

export const WEEKLY_CAP = 200;
// Protocol sizing rules applied to the Best Bets list (sorted best edge first):
//  4.7  same team's spread and moneyline -> keep only the better value
//  2.6  correlated bets (lead-rusher TD + his team's side) = one position, combined stake <= the larger stake
//  2.6  never more than $200 riding in a week
export function sizeBets(list) {
  const out = [], sideTaken = new Map();
  for (const b of list) {
    if (b.market === "spread" || b.market === "ml") {
      const k = `${b.game}|${b.label.split(" ")[0]}`;
      if (sideTaken.has(k)) continue;
      sideTaken.set(k, b);
    }
    out.push({ ...b, rawStake: b.stake });
  }
  for (const t of out.filter((x) => x.kind === "td" && x.leadRusher)) {
    const side = out.find((x) => x.game === t.game && (x.market === "spread" || x.market === "ml") && x.label.startsWith(t.team + " "));
    if (!side) continue;
    const limit = Math.max(t.rawStake, side.rawStake), sum = t.stake + side.stake;
    if (sum > limit) { const f = limit / sum; t.stake = Math.floor(t.stake * f); side.stake = Math.floor(side.stake * f); t.capped = side.capped = "correlated"; }
  }
  for (const b of out) {
    if (b.ev > 0.3) { b.stake = 0; b.section = "recheck"; }                       // protocol: >30% = re-check, not a bet
    else if (b.estimate) { b.stake = 0; b.section = "estimate"; }                 // no sportsbook reference yet
    else b.section = "bet";
  }
  let left = WEEKLY_CAP;
  for (const b of out.filter((x) => x.section === "bet")) { const s = Math.min(b.stake, left); if (s < b.stake) b.capped = "weekly cap"; b.stake = s; left -= s; }
  return out;
}
export async function loadModel(season, week) {
  const stored = (await getJSON(K.model(season, week))) || { games: {}, td: {} };
  const seed = season === SEED.season && week === SEED.week ? SEED : { games: {}, td: {} };
  return { games: { ...seed.games, ...stored.games }, td: { ...seed.td, ...stored.td }, runAt: stored.runAt || null };
}
export async function history(season, week, key, limit = 60) {
  const raw = await getRedis().lrange(K.snaps(season, week, key), -limit, -1);
  return raw.map((x) => JSON.parse(x));
}

export async function buildWeek({ season = SEASON, week, injuries = null, full = true } = {}) {
  week = week || (await currentWeek(season));
  const sched = await loadGames(season, week);
  const model = await loadModel(season, week);
  const flags = FLAGS[`${season}:${week}`] || {};
  const booksLatest = await getJSON(K.books(season, week));
  const meta = (await getJSON(K.meta(season, week))) || {};
  const games = [], allBets = [], allTd = [];
  for (const g of sched) {
    const isStarted = started(g), close = isStarted ? ((await getJSON(K.close(season, week, g.key))) || (SEED.close || {})[`${season}:${week}:${g.key}`] || null) : null;
    const hist = full ? await history(season, week, g.key) : [];
    const lastPoly = [...hist].reverse().find((s) => s.poly) || null;
    const poly = (close && close.poly) || (lastPoly && lastPoly.poly) || null;
    const bk = (close && close.books) || (booksLatest && booksLatest.games && booksLatest.games[g.key]) || null;
    const m = model.games[g.key] || null, f = flags[g.key] || {};
    const hs = poly && poly.spread ? poly.spread.homeSpread : bk && bk.spread ? bk.spread.homeSpread : null;
    const tl = poly && poly.total ? poly.total.line : bk && bk.total ? bk.total.line : null;
    const sp = spreadPick(m, hs, g.away, g.home), tp = totalPick(m, tl);
    if (sp && f.spread) Object.assign(sp, f.spread);
    if (tp && f.total) Object.assign(tp, f.total);
    const bets = isStarted ? [] : gameBets(g.key, g.away, g.home, poly, bk, sp, tp, m).filter((b) => b.ev > 0);
    const tdPrices = await getJSON(K.tdpx(season, week, g.key));
    const td = tdRows(g.key, g.away, g.home, model.td[g.key], tdPrices, injuries);
    const firstPoly = hist.find((s) => s.poly) || null;
    const v = venue(g) || {};
    games.push({ key: g.key, away: g.away, home: g.home, kickoff: g.kickoff, started: isStarted,
      final: g.final || (isStarted && Date.now() > new Date(g.kickoff).getTime() + GAME_HOURS * 3600e3),
      awayScore: g.awayScore, homeScore: g.homeScore, outdoor: !!v.outdoor, stadium: g.stadium,
      model: m, poly, books: bk, closed: !!close, open: firstPoly ? firstPoly.poly : null,
      history: hist.map((s) => ({ t: s.t, src: s.src, poly: s.poly })), spreadPick: sp, totalPick: tp, bets });
    if (!isStarted) { allBets.push(...bets); allTd.push(...td.filter((r) => r.lean === "Bet" || r.lean === "Recheck")); }
    games[games.length - 1].td = td;
  }
  correlationWarnings(allBets.filter((b) => b.stake >= 1), allTd);
  const bestRaw = [...allBets.map((b) => ({ ...b, kind: "line" })), ...allTd.map((t) => ({ kind: "td", game: t.game, market: "td",
    label: `${t.player} anytime TD`, price: t.price, odds: t.odds, fair: t.fair / 100, fairOdds: t.fairOdds, ev: t.ev, stake: t.stake,
    warnings: t.warnings, recheck: t.recheck, injury: t.injury, team: t.team, leadRusher: t.leadRusher, marketName: t.market }))].sort((a, b) => b.ev - a.ev);
  const best = sizeBets(bestRaw.filter((b) => b.stake >= 1));
  return { season, week, games, best, modelRunAt: model.runAt, meta, booksAt: booksLatest ? booksLatest.t : null,
    hasBooks: !!booksLatest, totalStake: best.reduce((s, b) => s + (b.stake || 0), 0), weeklyCap: WEEKLY_CAP };
}
