// Builds the full week view (used by /api/slate and grading).
import { spreadJumped } from "./sane";
import { booksFresh } from "./books";
import { buildCard, cardPicks } from "./cardpick";
import { sameGameParlays } from "./sgp";
import { movePicks, stackRecords, comboFactors, lineMovePick, lineMoveTotalPick, keyNumberPick, injuryPick, bounceBackPick, floorDogPick, teamModelPick, teamSideLine, noteFirstSeen, TESTED_FROM_WEEK } from "./stack";
import { recordInjEarly } from "./tracked";
import { loadComboModel } from "./combomodel";
import { SEASON, currentWeek, loadGames, loadSeason, started, GAME_HOURS } from "./games";
import { getRedis, jparse, getJSON, K } from "./redis";
import { SEED, FLAGS } from "./seed";
import { spreadPick, totalPick, tdRows, priceTd, winPctAt, winPctMarket, nameMatches, rosterPosFor } from "./picks";
import { venue } from "./wind";
import { loadSnaps, snapTrend, qbChange, roleBoosts, playedLastGame } from "./snaps";
import { applyCalibration, twoPlus, firstTdShares, applyFtdCalibration, teamFirstChance } from "./calibration";
import { loadEspnInjuries, espnOutFor, espnQuestionableFor } from "./espn";
import { situationFor, bestLegParlays } from "./paper";

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
// Injury dropdown rows: game statuses (Out/Doubtful/Questionable) first; before those post (Wed-Thu) the report only has practice notes,
// so "did not practice" / "limited" show too, labeled, and the dropdown never vanishes midweek (10/7). Full practice is left out.
// Team record entering this game (10/8): final games of earlier weeks this season. "3–1", or "3–1–1" with ties.
export function teamRecord(rows, team, week) {
  let w = 0, l = 0, t = 0;
  for (const r of rows || []) { if (!r.final || r.week >= week || r.awayScore == null || (r.away !== team && r.home !== team)) continue;
    const mine = r.away === team ? r.awayScore : r.homeScore, opp = r.away === team ? r.homeScore : r.awayScore;
    if (mine > opp) w++; else if (mine < opp) l++; else t++; }
  return `${w}–${l}${t ? `–${t}` : ""}`;
}
// Strength of schedule (10/8): opponents' combined win share (ties half) in their games before this week, ranked 1 = hardest.
// { TEAM: { pct, rank } }; teams with no games yet are left out.
export function schedStrength(rows, week) {
  const done = (rows || []).filter((r) => r.final && r.week < week && r.awayScore != null), rec = {}, opps = {};
  for (const r of done) for (const [t, o, pf, pa] of [[r.away, r.home, r.awayScore, r.homeScore], [r.home, r.away, r.homeScore, r.awayScore]]) {
    const x = (rec[t] = rec[t] || { w: 0, n: 0 }); x.w += pf > pa ? 1 : pf === pa ? 0.5 : 0; x.n++; (opps[t] = opps[t] || []).push(o); }
  const pct = {};
  for (const [t, os] of Object.entries(opps)) { let w = 0, n = 0; for (const o of os) { w += rec[o].w; n += rec[o].n; } if (n) pct[t] = w / n; }
  const order = Object.keys(pct).sort((a, b) => pct[b] - pct[a]), out = {};
  order.forEach((t, i) => { out[t] = { pct: Math.round(pct[t] * 1000) / 1000, rank: i + 1 }; });
  return out;
}
export function injDisplay(xs) {
  return (xs || []).map((x) => (GAME_STATUS.test(x.status) ? x : /did not participate/i.test(x.status) ? { ...x, shown: "DNP (practice)" } : /limited/i.test(x.status) ? { ...x, shown: "Limited (practice)" } : null))
    .filter(Boolean).sort((a, b) => injRank(a) - injRank(b));
}
const injRank = (x) => ({ out: 0, doubtful: 1, questionable: 2 }[String(x.status).toLowerCase()] ?? (/did not/i.test(x.status) ? 3 : 4));
export async function buildWeek({ season = SEASON, week, injuries = null, injuriesPrev = null, full = true, only = null } = {}) {   // only: just these game keys (10/19: the Monday game carried onto next week's pages)
  // review fix 10/14: one situationFor per game per build (it was called 3 times: angles, model leans, combos)
  const sitMemo = new Map(), sitOnce = (g) => { if (!sitMemo.has(g.key)) sitMemo.set(g.key, situationFor(season, week, g)); return sitMemo.get(g.key); };
  week = week || (await currentWeek(season));
  const sched = (await loadGames(season, week)).filter((g) => !only || only.includes(g.key));
  const model = await loadModel(season, week);
  const flags = FLAGS[`${season}:${week}`] || {};
  const booksLatest = await getJSON(K.books(season, week));
  const seasonRows = await loadSeason(season).catch(() => []);
  let sosMap = null;
  const comboModel = await loadComboModel().catch(() => null);   // newest weekly rebuild, if any (10/9)
  let comboRec = {}; try { comboRec = await stackRecords(season); } catch {}
  // 10/13 (owner: always a PICK): once a game kicks off, the card shows the straight pick recorded at kickoff (best per market from the
  // chooser / LINE MOVE / KEY NUMBER) with its result, instead of "No pick".
  let lockedAll = {}; try { lockedAll = (await getRedis().hgetall(`stack:${season}:${week}`)) || {}; } catch {}
  const lockedFor = (key) => { const best = {}, plain = {}, pts = {};
    for (const [f, v] of Object.entries(lockedAll)) { if (!f.startsWith(key + "|")) continue; let e; try { e = JSON.parse(v); } catch { continue; }
      if (!e || e.teaser || !e.id || !e.kind) continue; const k = e.kind === "total" ? "total" : "spread", one = { pick: e.pick, hit: e.hit, why: e.why, result: e.result || null, kind: k, price: e.price ?? null, cushion: e.cushion ?? null, points: e.points ?? null };
      if (/^ptspick\|/.test(e.id)) pts[k] = one;   // 10/15: the card's PICK w/ POINTS, locked at kickoff
      else if (/^(cardpick|modelpick)\|/.test(e.id)) plain[k] = one;   // the card's PICK
      else if (!best[k] || e.hit > best[k].hit) best[k] = one; }
    for (const k of ["spread", "total"]) { if (plain[k]) best[k] = plain[k]; if (best[k] && pts[k]) best[k] = { ...best[k], pts: pts[k] }; }
    return best; };
  let espn = null, espnError = null;
  try { espn = await loadEspnInjuries(); } catch (e) { espnError = String(e); }
  const meta = (await getJSON(K.meta(season, week))) || {};
  const games = [];
  const snaps = await loadSnaps().catch(() => null);
  const calib = await getJSON(`calib:${season}`).catch(() => null);
  for (const g of sched) {
    const isStarted = started(g), close = isStarted ? ((await getJSON(K.close(season, week, g.key))) || (SEED.close || {})[`${season}:${week}:${g.key}`] || null) : null;
    const hist = full ? await history(season, week, g.key) : [];
    // 10/14 fix: a reading that failed the data check (line jumped 3+ / total 4+ between snapshots) is skipped until the next one confirms
    // it -- before, the warning showed but every pick (LINE MOVE, KEY NUMBER...) was computed from the suspect line.
    const snapPoly = [...hist].reverse().find((s) => s.poly && !s.suspect) || [...hist].reverse().find((s) => s.poly) || null;
    // 10/17 (owner: "prices should update in the background"): the 15-min pull's Polymarket reading (`polynow:`) stands in when it is newer than the last
    // snapshot and passes the same data check (spread jump 3+, total 4+, moneyline 25+ cents = held until a snapshot confirms it).
    const now15 = isStarted || close ? null : await getJSON(`polynow:${season}:${Number(g.week ?? week)}:${g.key}`).catch(() => null);
    const P0s = snapPoly && snapPoly.poly, Q = now15 && now15.poly;
    const okNow = Q && (!snapPoly || new Date(now15.t) > new Date(snapPoly.t)) && !(P0s && P0s.spread && Q.spread && spreadJumped(P0s.spread.homeSpread, Q.spread.homeSpread))
      && !(P0s && P0s.total && Q.total && Math.abs(P0s.total.line - Q.total.line) >= 4) && !(P0s && P0s.ml && Q.ml && Math.abs(P0s.ml.home - Q.ml.home) >= 0.25);
    const lastPoly = okNow ? { t: now15.t, src: "pin30", poly: { ...((P0s) || {}), ...Q } } : snapPoly;
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
    // Automatic QB-change flag (either team) + bad-data guard
    // Decisions (Out removal, QB-change, role boosts) use only THIS week's official report. Before 9/28, between
    // Tuesday and the Wednesday report, last week's statuses dropped/flagged players for the new week.
    const inj = Object.fromEntries(Object.entries(injuries || {}).map(([t, xs]) => [t, xs.filter((x) => x.week == null || Number(x.week) === Number(week))]));
    const qb = snaps ? [qbChange(snaps[g.away], inj[g.away]), qbChange(snaps[g.home], inj[g.home])].filter(Boolean) : [];
    const lastSnap = hist[hist.length - 1] || null, dataCheck = !isStarted && lastSnap && lastSnap.suspect ? lastSnap.suspect : null;
    // If the model already moved for a missing starting QB (injury adjustment), say so instead of "can't see this".
    const qbAdj = !!(m && m.inj && [m.inj.home, m.inj.away].some((t) => t && (t.players || []).some((q) => q.group === "QB1")));
    // (QB change shows once, in the game header — no longer repeated inside the Model column)
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
    const td = tdAll.filter((r) => { const e = espnFor(r); if (e && espnOutFor(e, r.team, g.kickoff, seasonRows)) return false; if (e) r.espn = e.status + (e.comment ? ` — ${e.comment.slice(0, 90)}` : ""); return true; });
    // 10/20: the first-TD market's price (same map, "<name> first touchdown") next to each player's first-TD chance
    if (tdPrices) for (const r of td) { const k = Object.keys(tdPrices).find((q) => /first touchdown$/i.test(q) && nameMatches(r.player, q.replace(/ first touchdown$/i, ""))); const v = k ? tdPrices[k] : null; if (v && v.ask > 0 && v.ask < 1) r.firstPrice = v.ask; }
    let anyCalibrated = false;
    if (calib) for (const r of td) if (r.fair != null) { const c = applyCalibration(r.fair, calib); if (Math.abs(c - r.fair) > 0.05) { r.fair = c; r.calibrated = true; anyCalibrated = true; } }
    { // re-rank (always: ESPN removals leave gaps, e.g. "#2 on team" with no #1 shown) and re-price from the numbers shown
      const ranked = td.filter((r) => r.fair != null).sort((a, b) => b.fair - a.fair); ranked.forEach((r, i) => { r.rank = i + 1; });
      for (const t of [g.away, g.home]) ranked.filter((r) => r.team === t).forEach((r, i) => { r.teamRank = i + 1; });
      for (const r of td) priceTd(r);
    }
    // Keep "2+ TDs" and "first TD of the game" consistent with a recalibrated fair%, instead of drifting stale
    // against the number that's now actually shown.
    if (anyCalibrated) for (const r of td) r.two = r.fair != null ? Math.round(twoPlus(r.fair) * 10) / 10 : null;
    {   // 10/20: the first-TD numbers are ALWAYS recomputed here with the team model (the service's own first_td() is the old whole-game share)
      // firstTdShares needs BOTH teams' listed players together (the game's whole scoring pool), not one team
      // at a time -- calling it per-team would drop the other team's chances from the shared denominator.
      // Pool = the same players the model service used (top 14 per team from the model, calibrated), NOT just the
      // rows shown on the tab: before 9/28 the tab's filter (10%+ or priced) dropped low-chance players from the
      // pool, shrinking the denominator and inflating every shown player's first-TD %.
      const mt = model.td[g.key] || {}, pool = [];
      for (const side of ["away", "home"]) for (const p of (mt[side] || []).slice().sort((a, b) => b.fair - a.fair).slice(0, 14))
        pool.push({ name: p.name, pos: p.pos, team: side === "away" ? g.away : g.home, fair: calib ? applyCalibration(p.fair, calib) : p.fair });
      // 10/20: the FIRST TD TEAM MODEL (lib/calibration.js teamFirstChance) splits the first TD between the teams from the spread; each player
      // gets his team's chance x his share of the team's expected TDs. The game carries the team chances for the First TD box / tab.
      const tp = teamFirstChance(hs), teamP = tp ? { [g.home]: tp.home, [g.away]: tp.away } : null;
      const shares = firstTdShares(pool, teamP);
      for (const r of td) { const i = pool.findIndex((x) => x.name === r.player && x.team === r.team); if (i >= 0) r.first = Math.round(shares[i] * 10) / 10; }
      if (tp) g.ftdTeam = { away: Math.round(tp.away * 1000) / 10, home: Math.round(tp.home * 1000) / 10, hs };
    }
    if (calib && calib.ftd && calib.ftd.on) for (const r of td) r.first = applyFtdCalibration(r.first, calib);   // first-TD correction: only once 100+ games are graded
    const boosts = snaps ? { [g.away]: roleBoosts(snaps[g.away], inj[g.away]), [g.home]: roleBoosts(snaps[g.home], inj[g.home]) } : {};
    const qbByTeam = snaps ? { [g.away]: qbChange(snaps[g.away], inj[g.away]), [g.home]: qbChange(snaps[g.home], inj[g.home]) } : {};
    // Opening TD price from the new price history (first snapshot of the week) so the row can show the move
    for (const r of td) { const o = tdFirst && r.market ? tdFirst.p[r.market] : null;
      if (o && o[0] > 0 && o[1] > 0 && o[0] - o[1] <= Math.min(0.05, 0.4 * o[0])) r.open = o[0]; }   // real opening markets only (9/30)
    // Price-move alert (added 9/29): real markets only, 5¢+ move over the last ~24 h (or since the first snapshot).
    // Both ends must be real markets: a 98¢ placeholder in the older snapshot vs a real 40¢ now is not a "-58¢ move".
    const realPx = (a) => a && a[0] > 0 && a[1] > 0 && a[0] - a[1] <= Math.min(0.05, 0.4 * a[0]);
    const since = base24 && tdFirst && base24.t === tdFirst.t ? "this week" : base24 ? `since ${new Date(base24.t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric" })} PT` : "in the last day";
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
    const injList = injDisplay([...(raw[g.away] || []).map((x) => ({ ...x, team: g.away })), ...(raw[g.home] || []).map((x) => ({ ...x, team: g.home }))]);

    const firstPoly = hist.find((s) => s.poly) || null;
    const v = venue(g) || {};
    // Newest lines for this game, shared by the model card and every pick (10/14).
    const FR = isStarted ? null : await (async () => {
      // 10/14 fix: Polymarket is read by the snapshot only at the owner's times, so the timing picks (KEY NUMBER, LINE MOVE: Polymarket
      // under 3 h old) were hidden most of the day. The 30-min Pinnacle pull (free) saves Pinnacle's line AND Polymarket's main lines at the
      // same moment: the newest such record (under 1.5 h) stands in for a stale Polymarket reading, and Pinnacle for KEY NUMBER's books.
      const age = (t) => (t ? (Date.now() - new Date(t)) / 3600e3 : Infinity);
      let bT = booksLatest && booksLatest.t, pT = lastPoly && lastPoly.t, pTt = pT, Pm = poly, pin = null;   // pT spread / pTt total reading time
      const booksOld = !booksFresh(bT);   // books current until the owner's next scheduled pull (10/14)
      if (booksOld || age(pT) > 3) {
        const raws = (await getRedis().lrange(`pinnacle:${season}:${Number(g.week ?? week)}:${g.key}`, -6, -1).catch(() => null)) || [];
        const recs = raws.map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter((x) => x && age(x.t) <= 1.5);
        pin = recs.length ? recs[recs.length - 1] : null;   // newest Pinnacle line (snapshot or 30-min pull)
        // newest one that also read Polymarket, passing the same data check as the snapshots (spread within 3 / total within 4 of the last good reading)
      const P0 = lastPoly && lastPoly.poly, okJump = (q) => (!P0 || !P0.spread || q.hs == null || Math.abs(q.hs - P0.spread.homeSpread) < 3) && (!P0 || !P0.total || q.tl == null || Math.abs(q.tl - P0.total.line) < 4);
      const pp = [...recs].reverse().find((x) => x.poly && (x.poly.hs != null || x.poly.tl != null) && okJump(x.poly));
        if (pp && age(pT) > 3) { const q = pp.poly; Pm = { ...(poly || {}) };
          if (q.hs != null && q.h != null) { Pm.spread = { homeSpread: q.hs, home: q.h, away: +(1 - q.h).toFixed(3) }; pT = pp.t; }
          if (q.tl != null && q.o != null) { Pm.total = { line: q.tl, over: q.o, under: +(1 - q.o).toFixed(3) }; pTt = pp.t; } }
      }
      // Every pick below uses the newest Polymarket line (INJURY's "not moved yet", TOTAL MOVE's "still at the opening number", the line
      // each pick is shown at). LINE MOVE keeps the books (tested on the books' consensus; the Pinnacle version is a shadow test).
      const hsNow = Pm && Pm.spread && Pm.spread.homeSpread != null ? Pm.spread.homeSpread : hs, tlNow = Pm && Pm.total && Pm.total.line != null ? Pm.total.line : tl;
      return { bT, pT, pTt, Pm, pin, booksOld, hsNow, tlNow };
    })();
    games.push({ key: g.key, away: g.away, home: g.home, kickoff: g.kickoff, started: isStarted,
      winPct: (FR ? FR.hsNow : hs) != null ? Math.round((m ? winPctAt(m, FR ? FR.hsNow : hs) : winPctMarket(FR ? FR.hsNow : hs)) * 10) / 10 : m ? m.homeWinPct ?? null : null,   // 10/14: newest line   // market spread alone is enough (model-gap weight is 0)
      final: isFinal, badge: primeBadge(g), qb, dataCheck, injuries: injList,
      awayScore: g.awayScore, homeScore: g.homeScore, outdoor: !!v.outdoor, stadium: g.stadium,
      // 10/19 (owner: "why does everything look wrong"): a FINISHED game shows each team's record with this game counted (TEN won at IND and still read 0-5)
      rec: { [g.away]: teamRecord(seasonRows, g.away, isFinal ? g.week + 1 : g.week), [g.home]: teamRecord(seasonRows, g.home, isFinal ? g.week + 1 : g.week) },
      sos: { [g.away]: (sosMap || (sosMap = schedStrength(seasonRows, g.week)))[g.away] || null, [g.home]: sosMap[g.home] || null },
      without: model.td[g.key] && model.td[g.key].without ? { [g.away]: model.td[g.key].without.away || [], [g.home]: model.td[g.key].without.home || [] } : null,
      early: !!(model.td[g.key] && model.td[g.key].early && !poly), model: m, tdGroups: model.td[g.key] ? (calib ? { [g.away]: groupsCal(model.td[g.key].away, calib), [g.home]: groupsCal(model.td[g.key].home, calib) } : { [g.away]: model.td[g.key].awayGroups || null, [g.home]: model.td[g.key].homeGroups || null }) : null, poly, books: bk, closed: !!close, open: firstPoly ? firstPoly.poly : null,
      ...(await (async () => { if (isStarted || !m) return {}; const h0 = hist.find((x) => x.poly && x.poly.spread), t0 = hist.find((x) => x.poly && x.poly.total);   // upgraded model (10/9)
        const hsN = FR ? FR.hsNow : hs, tlN = FR ? FR.tlNow : tl;   // same newest line as the picks (10/14)
        const c = comboFactors({ ...g, outdoor: !!v.outdoor }, m, hsN, tlN, h0 ? h0.poly.spread.homeSpread : null, t0 ? t0.poly.total.line : null, await sitOnce(g).catch(() => null), Number(g.week ?? week));
        return c && c.up ? { modelUp: c.up, lineNow: { hs: hsN, tl: tlN }, modelEarly: c.early, totalOpen: t0 ? t0.poly.total.line : null } : {}; })()),
      lockedPicks: isStarted ? lockedFor(g.key) : null,
      teamSide: isStarted || !FR ? null : teamSideLine(g, FR.hsNow, Number(g.week ?? week)),   // 10/20: the "Model (Team):" line on the spread card, every game
      combos: isStarted ? [] : await (async () => { const h0 = hist.find((x) => x.poly && x.poly.spread), t0 = hist.find((x) => x.poly && x.poly.total), sitC = await sitOnce(g).catch(() => null);
        const { bT, pT, pTt, Pm, pin, booksOld, hsNow, tlNow } = FR;
        if (Number(g.week ?? week) >= TESTED_FROM_WEEK && Pm && Pm.spread) await recordInjEarly(season, Number(g.week ?? week), g, hsNow, sitC, new Date().toISOString()).catch(() => 0);   // INJURY EARLY shadow (10/16)
        return movePicks({ ...g, outdoor: !!v.outdoor }, m, hsNow, tlNow, h0 ? h0.poly.spread.homeSpread : null, t0 ? t0.poly.total.line : null, sitC, Number(g.week ?? week)).concat(lineMovePick(g, Pm, bk, { booksT: bT, polyT: pT }) || [], lineMoveTotalPick(g, Pm, bk, { booksT: bT, polyT: pTt }) || [],
          await (async () => {
            const alts = ((await getJSON(`alts:${season}:${week}:${g.key}`).catch(() => null)) || {}).alts || null;
            let B = bk, kT = bT, via = null;
            // 10/14 (owner: "fix it"): stale books -> Pinnacle only CONFIRMS the books' last number (every history % is from the books'
            // consensus). Pinnacle alone on 1 / 1.5 / 2.5 / 3 / 3.5 while the books' last reading was elsewhere -> no pick.
            const bHs = bk && bk.spread ? bk.spread.homeSpread : null;
            if (booksOld && pin && pin.hs != null && bHs != null && Number(pin.hs) === Number(bHs)) { kT = pin.t; via = "Pinnacle"; }
            const x = keyNumberPick(g, Pm, B, alts, { booksT: kT, polyT: pT });
            return x ? [via ? { ...x, why: x.why.replace(/ · /, ` (${via} still there) · `) } : x] : [];
          })(),
          injuryPick(g, hsNow, h0 ? h0.poly.spread.homeSpread : null, sitC, Number(g.week ?? week)) || [], bounceBackPick(g, hsNow, sitC) || [], floorDogPick(g, hsNow, sitC) || [], teamModelPick(g, hsNow, Number(g.week ?? week)) || []).map((c) => ({ ...c, rec: comboRec[c.id] || { w: 0, l: 0 } }));
        })().then(async (list) => { await noteFirstSeen(season, Number(g.week ?? week), g, list, new Date().toISOString()).catch(() => 0); return list; }),   // CLV: first line shown (10/14)
      history: hist.map((s) => ({ t: s.t, src: s.src, poly: s.poly })), spreadPick: sp, totalPick: tp });
    games[games.length - 1].td = td;
    if (!isStarted && FR) {   // the card's PICK and PICK w/ POINTS (10/15, lib/cardpick.js): built from the rule / chooser picks, the newest Polymarket reading and the saved alternate lines
      const G = games[games.length - 1], altC = (await getJSON(`alts:${season}:${week}:${g.key}`).catch(() => null)) || {};
      G.card = buildCard(G, G.combos, FR.Pm, bk, altC);
      await noteFirstSeen(season, Number(g.week ?? week), G, cardPicks(G.card), new Date().toISOString()).catch(() => 0);   // first-shown line, graded like every other pick
    }
    games[games.length - 1].sgp = isStarted ? null : sameGameParlays(games[games.length - 1]);   // same-game parlays (10/14, lib/sgp.js)
  }
  const bestLegs = bestLegParlays(games);   // Best Legs (10/19, lib/paper.js): strongest legs only, 2-3 legs, different games
  return { season, week, games, bestLegs, modelRunAt: model.runAt, meta, espnError, espnRows: espn ? espn.rows : 0, booksAt: booksLatest ? booksLatest.t : null,
    hasBooks: !!booksLatest };
}
