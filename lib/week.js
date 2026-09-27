// Builds the full week view (used by /api/slate and grading).
import { SEASON, currentWeek, loadGames, started, GAME_HOURS } from "./games";
import { getRedis, getJSON, K } from "./redis";
import { SEED, FLAGS } from "./seed";
import { spreadPick, totalPick, gameBets, tdRows, correlationWarnings } from "./picks";
import { venue } from "./wind";
import { loadSnaps, snapTrend, qbChange, roleBoosts } from "./snaps";
import { nameMatches } from "./picks";
import { getJSON as getJSON2 } from "./redis";
import { applyCalibration } from "./calibration";
import { SEED_BETS } from "./betsSeed";

// TNF / SNF / MNF / international badge from the official kickoff time (US Eastern).
function primeBadge(g) {
  if (/maracana|wembley|tottenham|allianz|azteca|bernab|croke|olympiastadion|mcg/i.test(g.stadium || ""))
    return (g.stadium || "").match(/maracana/i) ? "Brazil" : "Intl";
  const d = new Date(g.kickoff);
  const day = d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const hr = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  return day === "Thu" ? "TNF" : day === "Mon" ? "MNF" : day === "Sun" && hr >= 19 ? "SNF" : day === "Sat" ? "SAT" : null;
}
const GAME_STATUS = /^(out|doubtful|questionable)$/i;

export const WEEKLY_CAP = 200;
// Protocol sizing rules applied to the Best Bets list (sorted best edge first):
//  4.7  same team's spread and moneyline -> keep only the better value
//  2.6  correlated bets (lead-rusher TD + his team's side) = one position, combined stake <= the larger stake
//  2.6  never more than $200 riding in a week
export function sizeBets(list, capLeft = WEEKLY_CAP) {
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
    if (b.held) { b.stake = 0; b.section = "held"; delete b.capped; }             // QB change / data check
    else if (b.ev > 0.3) { b.stake = 0; b.section = "recheck"; delete b.capped; }  // protocol: >30% = re-check, not a bet
    else if (b.estimate) { b.stake = 0; b.section = "estimate"; delete b.capped; } // no sportsbook reference yet
    else b.section = "bet";
  }
  for (const b of out.filter((x) => x.section === "bet")) { const s = Math.min(b.stake, capLeft); if (s < b.stake) b.capped = "weekly cap"; b.stake = s; }
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
  const snaps = await loadSnaps().catch(() => null);
  const calib = await getJSON2(`calib:${season}`).catch(() => null);
  // Weekly cap = $200 minus what's already placed this week (Mark's logged bets), not other suggestions.
  const placed = SEED_BETS.filter((b) => b.week === week).reduce((s, b) => s + b.cost, 0);
  const capLeft = Math.max(0, WEEKLY_CAP - placed);
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
    // Plain-words warnings instead of "Conflict" / "Low trust"
    for (const p of [sp, tp]) if (p && (p.tier === "conflict" || p.tier === "strong-lt")) p.warn = `don't trust: ${p.short || "model can't see a key change"}`;
    // Automatic QB-change flag (either team) + bad-data guard -> bets held
    const inj = injuries || {};
    const qb = snaps ? [qbChange(snaps[g.away], inj[g.away]), qbChange(snaps[g.home], inj[g.home])].filter(Boolean) : [];
    const lastSnap = hist[hist.length - 1] || null, dataCheck = !isStarted && lastSnap && lastSnap.suspect ? lastSnap.suspect : null;
    if (qb.length) for (const p of [sp, tp]) if (p) p.warn = `${qb.join(" · ")} · model can't see this`;
    const held = qb.length ? "QB change" : dataCheck ? "data check" : null;
    const bets = isStarted ? [] : gameBets(g.key, g.away, g.home, poly, bk, sp, tp, m).filter((b) => b.ev > 0).map((b) => (held ? { ...b, held } : b));
    // Finished: grade the model's picks at the closing line (shown on the red cover)
    const isFinal = g.final || (isStarted && Date.now() > new Date(g.kickoff).getTime() + GAME_HOURS * 3600e3);
    if (g.final && g.homeScore != null) {
      const margin = g.homeScore - g.awayScore, total = g.homeScore + g.awayScore, res = (x) => (x > 0 ? "won" : x < 0 ? "lost" : "push");
      if (sp && hs != null) sp.result = res(sp.side === "home" ? margin + hs : -margin - hs);
      if (tp && tl != null) tp.result = res(tp.side === "over" ? total - tl : tl - total);
    }
    const tdPrices = await getJSON(K.tdpx(season, week, g.key));
    const td = tdRows(g.key, g.away, g.home, model.td[g.key], tdPrices, injuries);
    if (calib) for (const r of td) if (r.fair != null) { const c = applyCalibration(r.fair, calib); if (Math.abs(c - r.fair) > 0.05) { r.fair = c; r.calibrated = true; } }
    const boosts = snaps ? { [g.away]: roleBoosts(snaps[g.away], inj[g.away]), [g.home]: roleBoosts(snaps[g.home], inj[g.home]) } : {};
    const qbByTeam = snaps ? { [g.away]: qbChange(snaps[g.away], inj[g.away]), [g.home]: qbChange(snaps[g.home], inj[g.home]) } : {};
    for (const r of td) {
      if (snaps) r.snap = snapTrend(snaps[r.team], (full) => nameMatches(r.player, full));
      const flags = [];
      const b = (boosts[r.team] || {})[r.pos];
      if (b && !nameMatches(r.player, b.replace(/^Role boost: \w+1 /, "").replace(/ (Out|Doubtful)$/i, ""))) flags.push(b);
      if (qbByTeam[r.team]) flags.push(qbByTeam[r.team]);
      r.flags = flags;
    }
    const injList = [...(inj[g.away] || []).map((x) => ({ ...x, team: g.away })), ...(inj[g.home] || []).map((x) => ({ ...x, team: g.home }))]
      .filter((x) => GAME_STATUS.test(x.status)).sort((a, b) => ({ out: 0, doubtful: 1, questionable: 2 }[a.status.toLowerCase()] - { out: 0, doubtful: 1, questionable: 2 }[b.status.toLowerCase()]));
    const firstPoly = hist.find((s) => s.poly) || null;
    const v = venue(g) || {};
    games.push({ key: g.key, away: g.away, home: g.home, kickoff: g.kickoff, started: isStarted,
      final: isFinal, badge: primeBadge(g), qb, dataCheck, injuries: injList,
      awayScore: g.awayScore, homeScore: g.homeScore, outdoor: !!v.outdoor, stadium: g.stadium,
      model: m, poly, books: bk, closed: !!close, open: firstPoly ? firstPoly.poly : null,
      history: hist.map((s) => ({ t: s.t, src: s.src, poly: s.poly })), spreadPick: sp, totalPick: tp, bets });
    if (!isStarted) { allBets.push(...bets); allTd.push(...td.filter((r) => r.moneyBet)); }
    games[games.length - 1].td = td;
  }
  correlationWarnings(allBets.filter((b) => b.stake >= 1), allTd);
  const bestRaw = [...allBets.map((b) => ({ ...b, kind: "line" })), ...allTd.map((t) => ({ kind: "td", game: t.game, market: "td",
    label: `${t.player} anytime TD`, price: t.price, odds: t.odds, fair: t.fair / 100, fairOdds: t.fairOdds, ev: t.ev, stake: t.stake,
    warnings: t.warnings, recheck: t.recheck, injury: t.injury, team: t.team, leadRusher: t.leadRusher, marketName: t.market }))].sort((a, b) => b.ev - a.ev);
  const best = sizeBets(bestRaw.filter((b) => b.stake >= 1), capLeft);
  return { season, week, games, best, modelRunAt: model.runAt, meta, booksAt: booksLatest ? booksLatest.t : null,
    hasBooks: !!booksLatest, weeklyCap: WEEKLY_CAP, placedThisWeek: placed, capLeft };
}
