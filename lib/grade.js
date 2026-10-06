// Grades the model's picks at the CLOSING line (kickoff snapshot) once a game is final.
import { modelBase, modelHeaders } from "./model";
import { SEASON, loadGames } from "./games";
import { getRedis, jparse, getJSON, setJSON, K } from "./redis";
import { loadModel, history } from "./week";
import { spreadPick, totalPick, nameMatches, sgn, tdRows, winPctAt, rosterPosFor } from "./picks";
import { twoPlus, firstTdShares } from "./calibration";
// TD scorers for one final game, via the Railway service (official play-by-play). null until the data is posted.
// One fetch per week per grading pass: the service re-reads the season's play-by-play on every call, and before 9/30
// grading asked once PER GAME (16 heavy calls for one week).
const scorerCache = new Map();
async function tdScorers(season, week, key) {
  const base = modelBase();
  if (!base) return null;
  try {
    const ck = `${season}:${week}`;
    if (!scorerCache.has(ck)) scorerCache.set(ck, fetch(`${base}/td-scorers?season=${season}&week=${week}`, { cache: "no-store", headers: modelHeaders() }).then((r) => r.json()));
    const d = await scorerCache.get(ck).catch((e) => { scorerCache.delete(ck); throw e; });
    // names (anytime), plus TD counts and the game's first TD scorer when the service provides them
    return d.ok && d.games[key] ? Object.assign([...d.games[key]], { counts: (d.counts || {})[key] || null, first: d.first ? d.first[key] ?? null : undefined, teams: (d.teams || {})[key] || null }) : null;
  } catch { return null; }
}
import { FLAGS, SEED } from "./seed";
import { gradeEdgesWeek, edgeSummary } from "./edges";
import { gradePaper, gradePicksWeek, gradeWinnersWeek } from "./paper";
import { loadSnaps, qbChange } from "./snaps";
import { loadInjuries } from "./injuries";
import { alertResult, addAlert } from "./alerts";
import { spreadOk, totalOk, pickHomeSpread, sanePoly, mlOk } from "./sane";

// Closing anytime-TD prices per player: { name: { ask, bid } } from the last pre-kickoff snapshot (snapshots stop
// updating a game once it kicks off, so the stored prices ARE the closing prices). Same name matching as the TD tab.
async function tdClosePrices(season, week, g, model, snaps = null) {
  const prices = await getJSON(K.tdpx(season, week, g.key));
  const tdModel = model.td[g.key];
  if (!prices || !tdModel) return null;
  const out = {};
  // Opening price (first entry of the TD price history, added 9/29) for the TD model's own CLV: did the price move toward
  // the model between the first snapshot and kickoff?
  const firstRaw = await getRedis().lindex(`tdpxhist:${season}:${week}:${g.key}`, 0).catch(() => null), first = firstRaw ? jparse(firstRaw) : null;
  for (const r of tdRows(g.key, g.away, g.home, tdModel, prices, {}, rosterPosFor(snaps, g.away, g.home))) if (r.price != null && !r.stale) {
    const o = first && r.market && first.p[r.market] ? first.p[r.market] : null;
    out[r.player] = { ask: r.price, bid: r.bid ?? null, thin: !!r.thin, openAsk: o ? o[0] : null, openBid: o ? o[1] : null };
  }
  return Object.keys(out).length ? out : null;
}
// Did the player actually play? From snap counts (posted Mon/Tue). undefined = that team's snaps for the week aren't in
// yet (filled in later by the patch pass). The model's % assumes he plays; model accuracy uses only players who did.
function playedFlag(snaps, team, player, week) {
  const ts = snaps && snaps[team]; if (!ts) return undefined;
  const any = Object.values(ts).some((x) => x.weeks && x.weeks[week] != null); if (!any) return undefined;
  return Object.values(ts).some((x) => nameMatches(player, x.name) && x.weeks && x.weeks[week] > 0);
}
function mlModelPick(g, homeMargin, margin) {
  const home = homeMargin > 0;
  return { label: `${home ? g.home : g.away} ML (model by ${Math.abs(homeMargin).toFixed(1)})`, result: (home ? margin > 0 : margin < 0) ? "W" : "L" };
}
const result = (x) => (x > 0 ? "W" : x < 0 ? "L" : "P");
const repStatus = (inj, team, player) => { const x = (inj[team] || []).find((i) => nameMatches(player, i.name)); return x && /^(out|doubtful|questionable)$/i.test(x.status) ? x.status : null; };
// Closing-line value in points for a spread/total pick, from its label ("CLE +2.5", "Under 42.5") and the week's first Polymarket snapshot.
// Positive = the number was better at the open than at the close (the market moved toward the pick). null when the open is unknown.
// Same definition as the live grading above; used to fill older records that were graded before clvPts existed.
export function clvPtsFor(kind, label, home, openPoly) {
  if (!openPoly) return null;
  if (kind === "spread") {
    const m = String(label || "").match(/^(\S+) ([+-]?\d+(?:\.\d+)?)$/); if (!m || !openPoly.spread) return null;
    const openLine = m[1] === home ? openPoly.spread.homeSpread : -openPoly.spread.homeSpread; return +(openLine - Number(m[2])).toFixed(1);
  }
  const m = String(label || "").match(/^(Over|Under) (\d+(?:\.\d+)?)$/); if (!m || !openPoly.total) return null;
  const tl = Number(m[2]), o = openPoly.total.line; return +(m[1] === "Over" ? tl - o : o - tl).toFixed(1);
}
export async function gradeWeek(season, week) {
  const games = (await loadGames(season, week)).filter((g) => g.final);
  const model = await loadModel(season, week);
  const flags = FLAGS[`${season}:${week}`] || {};
  const snaps = await loadSnaps().catch(() => null);
  // The graded week's own report only (the feed keeps just each team's latest week; once next week's report is out,
  // using it here would flag the wrong week's QB situation). Snap counts still catch a QB change in the game itself.
  const injuries = Object.fromEntries(Object.entries((await loadInjuries().catch(() => null)) || {}).map(([t, xs]) => [t, xs.filter((x) => Number(x.week) === Number(week))]));
  let graded = 0, changed = false;
  if (await gradeEdgesWeek(season, week, games).catch(() => 0)) changed = true;   // Polymarket-vs-books tracker (once per week)
  await gradePaper(season, week, games, tdScorers).catch(() => 0);                // Parlay Lab paper parlays
  await gradePicksWeek(season, week, games).catch(() => 0);                        // Pick Lab: model's side on every game
  await gradeWinnersWeek(season, week, games).catch(() => 0);                      // Most likely winners (straight up)
  for (const g of games) {
    const prev = await getJSON(K.res(season, week, g.key));
    if (prev && prev.v >= 2) {                              // v2 = includes moneyline + TD grading
      // Already graded before closing TD prices were recorded: add them once, without re-grading anything else
      // (a full re-grade could change old spread/total results if the stored model has since been rerun).
      if (!prev.tdPx && prev.td && prev.td.length) {
        const px = await tdClosePrices(season, week, g, model, snaps);
        if (px) { prev.td = prev.td.map((p) => ({ ...p, ...(px[p.player] || {}) })); prev.tdPx = true; await setJSON(K.res(season, week, g.key), prev); changed = true; }
      }
      // Fill "played" once snap counts for the week are in (graded before they were posted, or before this existed)
      if (prev.td && prev.td.some((p) => p.played === undefined)) {
        let ch = false; prev.td = prev.td.map((p) => { if (p.played !== undefined) return p; const pl = playedFlag(snaps, p.team, p.player, week); if (pl === undefined) return p; ch = true; return { ...p, played: pl }; });
        if (ch) { await setJSON(K.res(season, week, g.key), prev); changed = true; }
      }
      // A stored spread/total pick whose line is far from the sportsbook closing line is a bad Polymarket read (10/4: "MIN +19.5"):
      // remove it so it counts in no record (the rest of the game's grading stays).
      if (!prev.lineChecked) {
        let ch = false;
        if (prev.spread && !spreadOk(pickHomeSpread(prev.spread.label, g.home), g.nvSpread)) { delete prev.spread; ch = true; }
        const tm = prev.total && String(prev.total.label).match(/(\d+(?:\.\d+)?)$/);
        if (tm && !totalOk(Number(tm[1]), g.nvTotal)) { delete prev.total; ch = true; }
        prev.lineChecked = true; if (ch) prev.lineDropped = true;
        await setJSON(K.res(season, week, g.key), prev); changed = true;
      }
      // A stored moneyline pick whose chance doesn't fit the sportsbook closing spread (10/4: "MIA ML 95%" at MIN, a corrupt read) is removed too.
      if (!prev.mlChecked) {
        if (prev.ml && !mlOk(prev.ml.label, prev.ml.pct, g.home, g.nvSpread)) { delete prev.ml; prev.mlDropped = true; }
        prev.mlChecked = true; await setJSON(K.res(season, week, g.key), prev); changed = true;
      }
      // Closing-line value for spread/total picks graded before it was recorded: fill it once from the week's first snapshot.
      if (!prev.clvChecked && ((prev.spread && prev.spread.clvPts == null) || (prev.total && prev.total.clvPts == null))) {
        const op = ((await history(season, week, g.key, 500)).find((x) => x.poly) || {}).poly || null;
        if (prev.spread && prev.spread.clvPts == null) prev.spread.clvPts = clvPtsFor("spread", prev.spread.label, g.home, op);
        if (prev.total && prev.total.clvPts == null) prev.total.clvPts = clvPtsFor("total", prev.total.label, g.home, op);
        prev.clvChecked = true; await setJSON(K.res(season, week, g.key), prev); changed = true;
      }
      if (prev.td && !prev.repChecked) {
        prev.td = prev.td.map((p) => ({ ...p, rep: p.rep ?? repStatus(injuries, p.team, p.player) })); prev.repChecked = true;
        await setJSON(K.res(season, week, g.key), prev); changed = true;
      }
      // Backfill the stats-only moneyline pick for games graded before it was restored (pre-kickoff model is stored:
      // reruns skip started games, so model.games[key] is the last pre-kickoff run).
      if (!prev.mlModel && !prev.mlModelChecked) {
        const mm = model.games[g.key], mg = g.homeScore - g.awayScore;
        if (mm && mm.homeMargin != null && mm.homeMargin !== 0 && mg !== 0) prev.mlModel = mlModelPick(g, mm.homeMargin, mg);
        prev.mlModelChecked = true; await setJSON(K.res(season, week, g.key), prev); changed = true;
      }
      // Graded before the 9/28 scorer fix (credit to whoever actually scored, return TDs count, team checked): re-mark
      // ONLY the TD scored / 2+ / first flags once with the corrected scorer list. Week 3 showed 56 scorers; correct is 58.
      if (!prev.tdScorerV2 && prev.td && prev.td.length) {
        const sc = await tdScorers(season, week, g.key);
        if (sc && sc.teams) {
          const hitBy = (name, team) => (s) => (nameMatches(name, s) || s === name) && (!sc.teams[s] || sc.teams[s].includes(team));
          const cnt = (name, team) => Object.entries(sc.counts || {}).reduce((a, [s, n]) => a + (hitBy(name, team)(s) ? n : 0), 0);
          prev.td = prev.td.map((p) => ({ ...p, scored: sc.some(hitBy(p.player, p.team)),
            ...(p.two != null && sc.counts ? { twoHit: cnt(p.player, p.team) >= 2 } : {}),
            ...(p.ftd != null && sc.first !== undefined ? { ftdHit: !!sc.first && hitBy(p.player, p.team)(sc.first) } : {}) }));
          prev.tdScorerV2 = true; await setJSON(K.res(season, week, g.key), prev); changed = true;
        }
      }
      continue;
    }
    const close = (await getJSON(K.close(season, week, g.key))) || ((SEED.close || {})[`${season}:${week}:${g.key}`] || null);
    const m = model.games[g.key];
    if (!close || !m) continue;
    const hist = await history(season, week, g.key, 500), open = (hist.find((s) => s.poly) || {}).poly || {};
    const cp = sanePoly(close.poly || null, g.nvSpread, g.nvTotal).poly || {}, cb = close.books || {};   // a bogus stored closing line is ignored (falls back to the sportsbook line)
    let hs = cp.spread ? cp.spread.homeSpread : cb.spread ? cb.spread.homeSpread : null;
    if (hs != null && !spreadOk(hs, g.nvSpread)) hs = g.nvSpread != null && isFinite(g.nvSpread) ? -g.nvSpread : null;   // a bad stored spread never feeds the moneyline chance
    const tl = cp.total ? cp.total.line : cb.total ? cb.total.line : null;
    const margin = g.homeScore - g.awayScore, total = g.homeScore + g.awayScore;
    const rec = { v: 2, season, week, game: g.key, awayScore: g.awayScore, homeScore: g.homeScore, gradedAt: new Date().toISOString(),
      qbChange: !!(snaps && (qbChange(snaps[g.away], injuries[g.away]) || qbChange(snaps[g.home], injuries[g.home]))),
      wind: m.wind ?? null, totalErr: m.total != null ? Math.abs(m.total - total) : null };
    // Moneyline: the side the model gives > 50% to win
    const winAtClose = hs != null ? winPctAt(m, hs) : m.homeWinPct;   // at the closing line, not the last rerun's line
    if (winAtClose != null && margin !== 0) {
      const homeFav = winAtClose >= 50, pct = homeFav ? winAtClose : 100 - winAtClose;
      rec.ml = { label: `${homeFav ? g.home : g.away} ML`, pct, result: (homeFav ? margin > 0 : margin < 0) ? "W" : "L" };
      if (!mlOk(rec.ml.label, rec.ml.pct, g.home, g.nvSpread)) { delete rec.ml; rec.mlDropped = true; }
      rec.mlChecked = true;
    }
    // Moneyline, stats-only model (restored 9/30): the team the model's OWN margin favors ("Model sees X by N"), graded
    // separately from the market-based win chance above. Dropped by mistake on 9/28 when the ML row switched to win chance.
    if (m && m.homeMargin != null && m.homeMargin !== 0 && margin !== 0) rec.mlModel = mlModelPick(g, m.homeMargin, margin);
    // TD model: every player's model chance vs whether he scored (rushing/receiving, from play-by-play)
    const tdModel = model.td[g.key];
    if (tdModel) {
      const scorers = await tdScorers(season, week, g.key);
      // Play-by-play not posted yet (MNF/late games finish before nflverse updates): wait and grade the whole game
      // later. Before 9/28 the game was saved as graded WITHOUT its TD results and never revisited, so those players
      // silently dropped out of the TD model check and the Polymarket comparison.
      if (!scorers) continue;
      if (scorers) rec.td = [...(tdModel.away || []).map((p) => ({ ...p, team: g.away })), ...(tdModel.home || []).map((p) => ({ ...p, team: g.home }))]
        .filter((p) => p.fair != null && p.fair >= 5).map((p) => ({ player: p.name, team: p.team, pos: p.pos || null, fair: p.fair, scored: scorers.some((s) => (nameMatches(p.name, s) || s === p.name) && (!scorers.teams || !scorers.teams[s] || scorers.teams[s].includes(p.team))) }));
      // 2+ TD and first-TD grading (added 9/28): the model's number for each, and what happened. Only when the
      // service returned counts/first (older records simply don't have these fields).
      if (rec.td && scorers.counts) {
        const cnt = (name, team) => Object.entries(scorers.counts).reduce((a, [s, n]) => a + ((nameMatches(name, s) || s === name) && (!scorers.teams || !scorers.teams[s] || scorers.teams[s].includes(team)) ? n : 0), 0);
        // Same pool the model service used (top 14 per team), not just graded players (fair 5%+), or the expected
        // first-TD count would be computed over a different, smaller pool than the one shown.
        const pool = [...(tdModel.away || []).slice().sort((a, b) => b.fair - a.fair).slice(0, 14).map((p) => ({ ...p, team: g.away })),
                      ...(tdModel.home || []).slice().sort((a, b) => b.fair - a.fair).slice(0, 14).map((p) => ({ ...p, team: g.home }))];
        const ps = firstTdShares(pool), shares = rec.td.map((p) => { const i = pool.findIndex((x) => x.name === p.player && x.team === p.team); return i >= 0 ? ps[i] : 0; });
        rec.td = rec.td.map((p, i) => ({ ...p, two: Math.round(twoPlus(p.fair) * 10) / 10, twoHit: cnt(p.player, p.team) >= 2,
          ...(scorers.first !== undefined ? { ftd: Math.round(shares[i] * 10) / 10, ftdHit: !!scorers.first && (nameMatches(p.player, scorers.first) || scorers.first === p.player) } : {}) }));
      }
      // Closing Polymarket price for each graded player (last pre-kickoff TD snapshot), so the Record tab can check
      // the model against the market it's actually bet on — not just against itself.
      const px = rec.td ? await tdClosePrices(season, week, g, model, snaps) : null;
      if (px) { rec.td = rec.td.map((p) => ({ ...p, ...(px[p.player] || {}) })); rec.tdPx = true; }
      if (rec.td && scorers.teams) rec.tdScorerV2 = true;
      if (rec.td) rec.td = rec.td.map((p) => { const pl = playedFlag(snaps, p.team, p.player, week); return pl === undefined ? p : { ...p, played: pl }; });
      // Official status that week (9/30): lets the Record tab compare the market with the SAME availability-adjusted
      // chance the TD tab showed (a Questionable player's bet settles No if he sits). Graded later than the week's
      // report (the feed keeps only each team's latest week) -> no status saved, treated as a normal player.
      if (rec.td) { rec.td = rec.td.map((p) => ({ ...p, rep: repStatus(injuries, p.team, p.player) })); rec.repChecked = true; }
    }
    const sp = spreadPick(m, hs, g.away, g.home);
    if (sp) {
      const cover = sp.side === "home" ? margin + hs : -margin - hs;
      const openLine = open.spread ? (sp.side === "home" ? open.spread.homeSpread : -open.spread.homeSpread) : null;
      rec.spread = { basis: "model", label: sp.label, pct: sp.pct, tier: (flags[g.key] && flags[g.key].spread && flags[g.key].spread.tier) || sp.tier,
        result: result(cover), clvPts: openLine != null ? +(openLine - sp.line).toFixed(1) : null };
    }
    const tp = totalPick(m, tl);
    if (tp) {
      const diff = tp.side === "over" ? total - tl : tl - total;
      const openLine = open.total ? open.total.line : null;
      rec.total = { basis: "model", label: tp.label, pct: tp.pct, tier: (flags[g.key] && flags[g.key].total && flags[g.key].total.tier) || tp.tier,
        result: result(diff), clvPts: openLine != null ? +(tp.side === "over" ? tl - openLine : openLine - tl).toFixed(1) : null };
    }
    await setJSON(K.res(season, week, g.key), rec);
    await alertResult(season, g, rec).catch(() => 0);   // 'Final' alert (10/1)
    await getRedis().sadd(K.resIds, `${season}:${week}:${g.key}`);
    graded++;
  }
  // Rebuild the miss finder and TD calibration only when something was written. gradeRecent runs on EVERY snapshot
  // (~35 a week) for every finished week, and before 9/30 each call re-read every graded record twice per week.
  if (!graded && !changed) return 0;
  const { findMisses } = await import("./missfinder");
  const { buildCalibration } = await import("./calibration");
  const allIds = (await getRedis().smembers(K.resIds)).filter((k) => k.startsWith(`${season}:`));
  const allRecs = (await Promise.all(allIds.map((k) => getRedis().get(`res:${k}`)))).filter(Boolean).map((x) => jparse(x)).filter(Boolean);
  await setJSON(`missfinder:${season}`, { t: new Date().toISOString(), misses: findMisses(allRecs) });
  await setJSON(`calib:${season}`, buildCalibration(allRecs));
  await setJSON(`edgestats:${season}`, await edgeSummary(season));
  return graded;
}
// Weekly recap (10/2): once every game of a week is graded, one alert with how each model did. Pure: records in, text out.
export function weekRecap(week, recs) {
  const rc = (list) => { const w = list.filter((x) => x && x.result === "W").length, l = list.filter((x) => x && x.result === "L").length; return `${w}–${l}`; };
  if (!recs || !recs.length) return null;
  const sp = recs.map((r) => r.spread).filter((x) => x && x.basis === "model"), tt = recs.map((r) => r.total).filter((x) => x && x.basis === "model");
  const td = recs.flatMap((r) => r.td || []).filter((p) => p.played === true);   // only players known to have played
  const exp = td.reduce((a, p) => a + p.fair, 0) / 100, hit = td.filter((p) => p.scored).length;
  return { title: `Week ${week} recap: moneyline ${rc(recs.map((r) => r.ml))} · spread side ${rc(sp)} · total side ${rc(tt)}`,
    sub: td.length ? `Touchdowns: ${hit} scored of ${td.length} players who played (the model expected ${exp.toFixed(1)})` : "" };
}
// Games that are final but still have no graded result after 12 hours, with the reason, so a game can never go ungraded silently (10/2).
// gradeWeek skips a game that has no closing line, no stored model, or no play-by-play yet; before this, nothing said so.
export async function ungradedFinals(season = SEASON, now = Date.now()) {
  const { loadSeason } = await import("./games");
  const all = await loadSeason(season), out = [];
  const model = {};
  for (const g of all.filter((x) => x.final && x.kickoff && now - new Date(x.kickoff).getTime() > 12 * 3600e3 && now - new Date(x.kickoff).getTime() < 14 * 86400e3)) {
    const rec = await getJSON(K.res(season, g.week, g.key)).catch(() => null);
    if (rec) {   // graded, but a part is missing (the 9/28 Monday game had only its moneyline: no closing line, no touchdown model)
      const parts = [!rec.spread && !rec.total && "its spread and total picks (no closing line was saved)", !rec.td && "its touchdown results"].filter(Boolean);
      // A record saved without a part can't be completed later (grading holds a game until its touchdown data exists), so warn only while it's recent: a Week 3 game from before lines were saved would otherwise warn for two weeks.
      if (parts.length && (!rec.gradedAt || now - new Date(rec.gradedAt).getTime() < 3 * 86400e3)) out.push({ key: g.key, week: g.week, reason: `graded without ${parts.join(" or ")}` });
      continue;
    }
    const m = model[g.week] || (model[g.week] = await loadModel(season, g.week));
    const close = (await getJSON(K.close(season, g.week, g.key)).catch(() => null)) || ((SEED.close || {})[`${season}:${g.week}:${g.key}`] || null);
    out.push({ key: g.key, week: g.week, reason: !close ? "no closing line was saved" : !m.games[g.key] ? "no model numbers were saved" : "waiting for the official touchdown data" });
  }
  return out;
}
export async function gradeRecent(season = SEASON) {
  const { loadSeason } = await import("./games");
  const all = await loadSeason(season);
  let n = 0;
  scorerCache.clear();   // fresh scorer lists each pass (the per-week cache only spans one pass)
  for (const w of [...new Set(all.filter((g) => g.final).map((g) => g.week))]) {
    n += await gradeWeek(season, w);
    // every game of the week final and graded -> one recap alert (once per week)
    const games = all.filter((g) => g.week === w);
    if (games.length && games.every((g) => g.final)) {
      const recs = (await Promise.all(games.map((g) => getJSON(K.res(season, w, g.key)).catch(() => null)))).filter(Boolean);
      // wait until the week's snap counts are in (every listed player has a played flag), or the touchdown line would count inactive players
      if (recs.length === games.length && recs.every((r) => (r.td || []).every((p) => p.played !== undefined))) { const r = weekRecap(w, recs); if (r) await addAlert(season, { kind: "RESULT", game: "", id: `recap|${season}|${w}`, ttlH: 24 * 60, title: r.title, sub: r.sub }).catch(() => 0); }
    }
  }
  return n;
}
