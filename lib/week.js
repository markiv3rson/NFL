// Builds the full week view (used by /api/slate and grading).
import { SEASON, currentWeek, loadGames, loadSeason, started, GAME_HOURS } from "./games";
import { getRedis, jparse, getJSON, K } from "./redis";
import { SEED, FLAGS } from "./seed";
import { spreadPick, totalPick, gameBets, tdRows, tdUnmodeled, priceTd, winPctAt, winPctMarket, correlationWarnings, nameMatches, rosterPosFor } from "./picks";
import { venue } from "./wind";
import { loadSnaps, snapTrend, qbChange, roleBoosts, playedLastGame } from "./snaps";
import { applyCalibration, twoPlus, firstTdShares } from "./calibration";
import { placedThisWeek } from "./placed";
import { loadEspnInjuries, espnOutFor, espnQuestionableFor } from "./espn";
import { EDGE_MIN, BOOKS_MAX_AGE_H, booksMaxAgeH } from "./edges";

// TNF / SNF / MNF / international badge from the official kickoff time (US Eastern).
function primeBadge(g) {
  // International / neutral games: the schedule's location field, plus a city label (the old stadium-name list missed
  // Melbourne, Paris, Munich and Mexico City on the 2026 slate).
  const CITY = [[/maracana/i, "Brazil"], [/wembley|tottenham/i, "London"], [/melbourne/i, "Melbourne"], [/stade de france/i, "Paris"],
    [/bernab/i, "Madrid"], [/munich|allianz/i, "Munich"], [/banorte|azteca/i, "Mexico City"], [/croke/i, "Dublin"], [/olympiastadion/i, "Berlin"]];
  if (Number(g.week) === 22) return "Super Bowl";
  if (g.venueHome) return null;   // neutral site in the US (not international)
  if (g.neutral || CITY.some(([re]) => re.test(g.stadium || ""))) { const c = CITY.find(([re]) => re.test(g.stadium || "")); return c ? c[1] : "Intl"; }
  const d = new Date(g.kickoff);
  const day = d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const hr = Number(d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  return day === "Thu" ? "TNF" : day === "Mon" ? "MNF" : day === "Sun" && hr >= 19 ? "SNF" : day === "Sat" ? "SAT" : null;
}
const GAME_STATUS = /^(out|doubtful|questionable)$/i;
const Q_PLAYS = 0.669;   // Questionable RB/WR/TE who played, 2016-25 (see availability note in buildWeek)

export const WEEKLY_CAP = 200;
// Protocol sizing rules applied to the Best Bets list (sorted best edge first):
//  4.7  same team's spread and moneyline -> keep only the better value
//  2.6  correlated bets (lead-rusher TD + his team's side) = one position, combined stake <= the larger stake
//  2.6  never more than $200 riding in a week
export function sizeBets(list, capLeft = WEEKLY_CAP) {
  // Section first, so a same-team duplicate never knocks out the playable bet in favor of a held/recheck/estimate one.
  const out = list.map((b) => ({ ...b, rawStake: b.stake,
    section: b.held ? "held" : b.ev > 0.3 ? "recheck" : b.estimate ? "estimate" : "bet" }));
  for (const b of out) if (b.section !== "bet") { b.stake = 0; delete b.capped; }
  // 4.7: same team's spread and moneyline -> keep only the better value (list is sorted best edge first)
  const sideTaken = new Set();
  for (const b of out.filter((x) => x.section === "bet" && (x.market === "spread" || x.market === "ml"))) {
    const k = `${b.game}|${b.label.split(" ")[0]}`;
    if (sideTaken.has(k)) { b.section = "dup"; b.stake = 0; } else sideTaken.add(k);
  }
  // 2.6: a player TD + his team's side = one position (any player, not just the lead rusher)
  for (const t of out.filter((x) => x.kind === "td" && x.section === "bet")) {
    const side = out.find((x) => x.section === "bet" && x.game === t.game && (x.market === "spread" || x.market === "ml") && x.label.startsWith(t.team + " "));
    if (!side) continue;
    const limit = Math.max(t.rawStake, side.rawStake), sum = t.stake + side.stake;
    if (sum > limit) { const f = limit / sum; t.stake = Math.floor(t.stake * f); side.stake = Math.floor(side.stake * f); t.capped = side.capped = "correlated"; }
  }
  // 2.6: never more than the weekly cap riding in total (before 9/28 each bet was capped separately, so the SUM could pass $200)
  let left = capLeft;
  for (const b of out.filter((x) => x.section === "bet")) { const s = Math.min(b.stake, left); if (s < b.stake) b.capped = "weekly cap"; b.stake = s; left -= s; }
  return out.filter((b) => b.section !== "dup");
}
export async function loadModel(season, week) {
  const stored = (await getJSON(K.model(season, week))) || { games: {}, td: {} };
  const seed = season === SEED.season && week === SEED.week ? SEED : { games: {}, td: {} };
  return { games: { ...seed.games, ...stored.games }, td: { ...seed.td, ...stored.td }, runAt: stored.runAt || null };
}
export async function history(season, week, key, limit = 60) {
  const r = getRedis(), k = K.snaps(season, week, key);
  const raw = await r.lrange(k, -limit, -1);
  // Keep the week's FIRST snapshot even when there are more than `limit`: the History dropdown labels its oldest row
  // "opening line" and the card's `open` uses it, which was wrong once a busy week passed 60 snapshots.
  if (raw.length === limit && (await r.llen(k)) > limit) raw.unshift(await r.lindex(k, 0));
  return raw.map((x) => jparse(x)).filter(Boolean);
}

// "Chance any one of them scores" per position, from the SAME calibrated numbers the rows show (top 8 per position,
// as td_prob.group_any). Before 9/28 the rows were calibrated but this line kept the model service's raw numbers.
function groupsCal(list, calib) {
  const by = {};
  for (const p of list || []) if (p.fair != null && p.pos) (by[p.pos] = by[p.pos] || []).push(applyCalibration(p.fair, calib) / 100);
  const out = {};
  for (const [pos, xs] of Object.entries(by)) out[pos] = Math.round((1 - xs.sort((a, b) => b - a).slice(0, 8).reduce((a, x) => a * (1 - x), 1)) * 1000) / 10;
  return out;
}
export async function buildWeek({ season = SEASON, week, injuries = null, injuriesPrev = null, full = true } = {}) {
  week = week || (await currentWeek(season));
  const sched = await loadGames(season, week);
  const model = await loadModel(season, week);
  const flags = FLAGS[`${season}:${week}`] || {};
  const booksLatest = await getJSON(K.books(season, week));
  const seasonRows = await loadSeason(season).catch(() => []);
  let espn = null, espnError = null;
  try { espn = await loadEspnInjuries(); } catch (e) { espnError = String(e); }
  const meta = (await getJSON(K.meta(season, week))) || {};
  const games = [], allBets = [], allTd = [];
  const snaps = await loadSnaps().catch(() => null);
  const calib = await getJSON(`calib:${season}`).catch(() => null);
  // Weekly cap = $200 minus what you already placed this week (typed-in combos + account bets, each once, never combo legs):
  // lib/placed.js is the same count My Bets shows.
  const placed = await placedThisWeek(season, week);
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
    // Decisions (Out removal, QB-change, role boosts) use only THIS week's official report. Before 9/28, between
    // Tuesday and the Wednesday report, last week's statuses dropped/flagged players for the new week.
    const inj = Object.fromEntries(Object.entries(injuries || {}).map(([t, xs]) => [t, xs.filter((x) => x.week == null || Number(x.week) === Number(week))]));
    const qb = snaps ? [qbChange(snaps[g.away], inj[g.away]), qbChange(snaps[g.home], inj[g.home])].filter(Boolean) : [];
    const lastSnap = hist[hist.length - 1] || null, dataCheck = !isStarted && lastSnap && lastSnap.suspect ? lastSnap.suspect : null;
    // If the model already moved for a missing starting QB (injury adjustment), say so instead of "can't see this".
    const qbAdj = !!(m && m.inj && [m.inj.home, m.inj.away].some((t) => t && (t.players || []).some((q) => q.group === "QB1")));
    // (QB change shows once, in the game header — no longer repeated inside the Model column)
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
    // TD price history (first entry = opening price) and the most recent ~24 h of it for price-move alerts
    // Read only what's needed: the first entry (opening price) and the last 40 (> a day at 4-7 snapshots/day plus
    // manual taps). Before, every page load read the whole week of TD price history for every game (~1 MB).
    const hk = `tdpxhist:${season}:${week}:${g.key}`, pj = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
    const tdFirst = pj(await getRedis().lindex(hk, 0).catch(() => null));
    const recent = (await getRedis().lrange(hk, -40, -1).catch(() => [])).map(pj).filter(Boolean);
    const dayAgo = Date.now() - 24 * 3600e3, base24 = recent.filter((h) => new Date(h.t) <= dayAgo).pop() || (recent.length < 40 ? tdFirst : recent[0]) || null;
    const tdAll = tdRows(g.key, g.away, g.home, model.td[g.key], tdPrices, inj, rosterPosFor(snaps, g.away, g.home));
    // ESPN game-day status: players ESPN lists Out (dated this week) come off the TD list -- an inactive player's TD
    // market settles No. Everyone else keeps his row, with ESPN's status shown when it has one.
    // ESPN's live feed also lists healthy players as "Active" with a game recap as the comment (seen live 9/29) --
    // not injury news. Only real statuses (Questionable, Doubtful, Out, IR, Suspension...) are used or shown.
    const espnFor = (r) => ((espn && espn.teams[r.team]) || []).find((x) => nameMatches(r.player, x.name) && !/^active$/i.test(String(x.status).trim()));
    // ESPN Out counts only if posted after the team's previous game (espnOutFor, shared with the rerun)
    const espnRemoved = [];
    const td = tdAll.filter((r) => { const e = espnFor(r); if (e && espnOutFor(e, r.team, g.kickoff, seasonRows)) { espnRemoved.push(`${r.player} (${e.status})`); return false; } if (e) r.espn = e.status + (e.comment ? ` — ${e.comment.slice(0, 90)}` : ""); return true; });
    let anyCalibrated = false;
    if (calib) for (const r of td) if (r.fair != null) { const c = applyCalibration(r.fair, calib); if (Math.abs(c - r.fair) > 0.05) { r.fair = c; r.calibrated = true; anyCalibrated = true; } }
    { // re-rank (always: ESPN removals leave gaps, e.g. "#2 on team" with no #1 shown) and re-price from the numbers shown
      const ranked = td.filter((r) => r.fair != null).sort((a, b) => b.fair - a.fair); ranked.forEach((r, i) => { r.rank = i + 1; });
      for (const t of [g.away, g.home]) ranked.filter((r) => r.team === t).forEach((r, i) => { r.teamRank = i + 1; });
      for (const r of td) priceTd(r);
    }
    // Keep "2+ TDs" and "first TD of the game" consistent with a recalibrated fair%, instead of drifting stale
    // against the number that's now actually shown.
    if (anyCalibrated) {
      for (const r of td) r.two = r.fair != null ? Math.round(twoPlus(r.fair) * 10) / 10 : null;
      // firstTdShares needs BOTH teams' listed players together (the game's whole scoring pool), not one team
      // at a time -- calling it per-team would drop the other team's chances from the shared denominator.
      // Pool = the same players the model service used (top 14 per team from the model, calibrated), NOT just the
      // rows shown on the tab: before 9/28 the tab's filter (10%+ or priced) dropped low-chance players from the
      // pool, shrinking the denominator and inflating every shown player's first-TD %.
      const mt = model.td[g.key] || {}, pool = [];
      for (const side of ["away", "home"]) for (const p of (mt[side] || []).slice().sort((a, b) => b.fair - a.fair).slice(0, 14))
        pool.push({ name: p.name, team: side === "away" ? g.away : g.home, fair: calib ? applyCalibration(p.fair, calib) : p.fair });
      const shares = firstTdShares(pool);
      for (const r of td) { const i = pool.findIndex((x) => x.name === r.player && x.team === r.team); if (i >= 0) r.first = Math.round(shares[i] * 10) / 10; }
    }
    const boosts = snaps ? { [g.away]: roleBoosts(snaps[g.away], inj[g.away]), [g.home]: roleBoosts(snaps[g.home], inj[g.home]) } : {};
    const qbByTeam = snaps ? { [g.away]: qbChange(snaps[g.away], inj[g.away]), [g.home]: qbChange(snaps[g.home], inj[g.home]) } : {};
    // Opening TD price from the new price history (first snapshot of the week) so the row can show the move
    for (const r of td) { const o = tdFirst && r.market ? tdFirst.p[r.market] : null;
      if (o && o[0] > 0 && o[1] > 0 && o[0] - o[1] <= Math.min(0.05, 0.4 * o[0])) r.open = o[0]; }   // real opening markets only (9/30)
    // Price-move alert (added 9/29): real markets only, 5¢+ move over the last ~24 h (or since the first snapshot).
    // Both ends must be real markets: a 98¢ placeholder in the older snapshot vs a real 40¢ now is not a "-58¢ move".
    const realPx = (a) => a && a[0] > 0 && a[1] > 0 && a[0] - a[1] <= Math.min(0.05, 0.4 * a[0]);
    const since = base24 && tdFirst && base24.t === tdFirst.t ? "since the first price this week" : base24 ? `since ${new Date(base24.t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric" })} PT` : "in the last day";
    for (const r of td) if (base24 && r.market && realPx(base24.p[r.market]) && r.price != null && !r.thin) {
      const mv = r.price - base24.p[r.market][0]; if (Math.abs(mv) >= 0.05) { r.move = Math.round(mv * 100); r.moveSince = since; }
    }
    for (const r of td) {
      if (snaps) r.snap = snapTrend(snaps[r.team], (full) => nameMatches(r.player, full));
      // Listed Out/Doubtful on LAST week's report and missed that game: say so (this week's status isn't out until Wed).
      // Before, a player out with an injury (e.g. Nacua, Collins) still ranked near the top with no reason given.
      // A player who PLAYED his team's last game (snap counts) was not out: the feed's latest report can be older than that game (10/5: Nacua, a full game, still tagged "was out").
      const playedLast = playedLastGame(r.snap);
      if (!r.injury && !playedLast) { const lw = ((injuries || {})[r.team] || []).find((x) => Number(x.week) < Number(week) && nameMatches(r.player, x.name) && /^(out|doubtful)$/i.test(x.status));
        if (lw) r.lastWeekOut = `${lw.status} on the Week ${lw.week} report${lw.detail ? ` (${lw.detail.split(" — ")[0]})` : ""}`; }
      // "Returning" label (display only, the chance is NOT changed): Out/Doubtful on last week's report, not Out/Doubtful this week.
      // Before this week's report is out, last week's is the latest one (lastWeekOut above); after it, last week's list is `injuriesPrev`.
      { const was = r.lastWeekOut ? r.lastWeekOut.split(" on ")[0] : (((injuriesPrev || {})[r.team] || []).find((x) => nameMatches(r.player, x.name)) || {}).status;
        if (was && !playedLast && !/^(out|doubtful)$/i.test(r.injury || "")) { r.returning = String(was).toLowerCase();
          // 2021-25, out last week and not Out now: practicing fully -> 87% played, limited -> 61%, did not participate -> 17%, no practice entry -> 6%.
          r.returningState = /^(full|limited)/i.test(r.injury || "") ? "practicing" : "not practicing"; } }
      const flags = [];
      const b = (boosts[r.team] || {})[r.pos];
      if (b && !nameMatches(r.player, b.replace(/^\w+1 /, "").replace(/ is (Out|Doubtful) — .*$/i, ""))) flags.push(b);
      // (QB change is shown once on the game header, not repeated on every player row)
      r.flags = flags;
    }
    // Availability (added 9/30): the model's % assumes the player PLAYS, but a TD bet on a player who sits settles No.
    // 33.1% of Questionable RB/WR/TEs sat (4,030 cases, 2016-25), so until inactives are known the shown chance (and his
    // 2+ / first-TD numbers) is x0.67. Inside 80 min of kickoff with the ESPN feed up, anyone not ruled Out is playing.
    const minsToKick = g.kickoff ? (new Date(g.kickoff) - Date.now()) / 60000 : null;
    const inactivesKnown = !!espn && minsToKick != null && minsToKick <= 80;
    // Questionable = this week's official report, or ESPN (dated after the team's last game) before the report is out
    const isQ = (r) => /^questionable$/i.test(r.injury || "") || (!r.injury && espnQuestionableFor(espnFor(r), r.team, g.kickoff, seasonRows));
    if (!isStarted && !inactivesKnown) for (const r of td) if (r.fair != null && isQ(r)) {
      if (!r.injury) r.injury = "Questionable";   // so the row shows the pill and the "check inactives" note
      r.fairIfPlays = r.fair; r.fair = r.fair * Q_PLAYS;
      if (r.two != null) r.two = Math.round(r.two * Q_PLAYS * 10) / 10;
      if (r.first != null) r.first = Math.round(r.first * Q_PLAYS * 10) / 10;
      priceTd(r);
    }
    { const ranked = td.filter((r) => r.fair != null).sort((a, b) => b.fair - a.fair); ranked.forEach((r, i) => { r.rank = i + 1; });
      for (const t of [g.away, g.home]) ranked.filter((r) => r.team === t).forEach((r, i) => { r.teamRank = i + 1; });
      for (const r of td) priceTd(r); }   // re-rank after the discount (9/30): "#1 on team" was the pre-discount order
    // DISPLAY uses the latest report even if it's last week's (labeled with its week); decisions above use THIS week's only.
    // Before 9/28-night fix the dropdown used this-week-only too, so Mon-Wed it vanished.
    const raw = injuries || {};
    const injList = [...(raw[g.away] || []).map((x) => ({ ...x, team: g.away })), ...(raw[g.home] || []).map((x) => ({ ...x, team: g.home }))]
      .filter((x) => GAME_STATUS.test(x.status)).sort((a, b) => ({ out: 0, doubtful: 1, questionable: 2 }[a.status.toLowerCase()] - { out: 0, doubtful: 1, questionable: 2 }[b.status.toLowerCase()]));
    const firstPoly = hist.find((s) => s.poly) || null;
    const v = venue(g) || {};
    games.push({ key: g.key, away: g.away, home: g.home, kickoff: g.kickoff, started: isStarted,
      winPct: hs != null ? Math.round((m ? winPctAt(m, hs) : winPctMarket(hs)) * 10) / 10 : m ? m.homeWinPct ?? null : null,   // market spread alone is enough (model-gap weight is 0)
      final: isFinal, badge: primeBadge(g), qb, dataCheck, injuries: injList, tdUnmodeled: model.td[g.key] ? tdUnmodeled(model.td[g.key], tdPrices, new Set(tdAll.map((r) => r.market).filter(Boolean))) : [], espnRemoved,
      awayScore: g.awayScore, homeScore: g.homeScore, outdoor: !!v.outdoor, stadium: g.stadium,
      early: !!(model.td[g.key] && model.td[g.key].early && !poly), model: m, tdGroups: model.td[g.key] ? (calib ? { [g.away]: groupsCal(model.td[g.key].away, calib), [g.home]: groupsCal(model.td[g.key].home, calib) } : { [g.away]: model.td[g.key].awayGroups || null, [g.home]: model.td[g.key].homeGroups || null }) : null, poly, books: bk, closed: !!close, open: firstPoly ? firstPoly.poly : null,
      history: hist.map((s) => ({ t: s.t, src: s.src, poly: s.poly })), spreadPick: sp, totalPick: tp, bets });
    if (!isStarted) { allBets.push(...bets); allTd.push(...td.filter((r) => r.moneyBet)); }
    games[games.length - 1].td = td;
  }
  correlationWarnings(allBets.filter((b) => b.stake >= 1), allTd);
  const bestRaw = [...allBets.map((b) => ({ ...b, kind: "line" })), ...allTd.map((t) => ({ kind: "td", game: t.game, market: "td",
    label: `${t.player} anytime TD`, price: t.price, odds: t.odds, fair: t.fair / 100, fairOdds: t.fairOdds, ev: t.ev, stake: t.stake,
    warnings: t.warnings, recheck: t.recheck, injury: t.injury, team: t.team, leadRusher: t.leadRusher, marketName: t.market }))].sort((a, b) => b.ev - a.ev);
  const best = sizeBets(bestRaw.filter((b) => b.held || b.ev > 0.3 || b.estimate || b.stake >= 1), capLeft);
  // "Right now" (added 9/30): Polymarket prices 3%+ better than FRESH no-vig sportsbook prices, the same rule the edge
  // tracker logs and grades. Fees: POLY_FEE_PCT (Vercel env, % of the price paid) is taken off before the 3% test;
  // unset = 0 and the page says "before fees". Sportsbook odds older than 3 h are not used (a stale book fakes gaps).
  const fee = Math.max(0, Number(process.env.POLY_FEE_PCT) || 0) / 100;
  const booksAgeH = booksLatest && booksLatest.t ? (Date.now() - new Date(booksLatest.t)) / 3600e3 : null;
  const edgesNow = booksAgeH == null ? [] : games.filter((g) => !g.started && g.poly && g.books && booksAgeH <= booksMaxAgeH(g.kickoff))
    .flatMap((g) => gameBets(g.key, g.away, g.home, g.poly, g.books, null, null, null).filter((b) => !b.estimate)
      .map((b) => ({ game: g.key, market: b.market, label: b.label, price: b.price, fair: b.fair, evNet: b.fair / (b.price * (1 + fee)) - 1,
        held: g.dataCheck ? "data check" : (g.qb || []).length ? "QB change" : null, kickoff: g.kickoff })))
    .filter((b) => b.evNet >= EDGE_MIN).sort((a, b) => b.evNet - a.evNet);
  return { season, week, games, best, modelRunAt: model.runAt, meta, espnError, espnRows: espn ? espn.rows : 0, booksAt: booksLatest ? booksLatest.t : null,
    hasBooks: !!booksLatest, weeklyCap: WEEKLY_CAP, placedThisWeek: placed, capLeft,
    edgesNow, edgeRule: { min: EDGE_MIN, feePct: fee * 100, booksAgeH, booksMaxAgeH: BOOKS_MAX_AGE_H, booksMaxAgeEarlyH: 8 } };
}
