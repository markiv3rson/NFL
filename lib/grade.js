// Grades the model's picks at the CLOSING line (kickoff snapshot) once a game is final.
import { SEASON, loadGames } from "./games";
import { getRedis, getJSON, setJSON, K } from "./redis";
import { loadModel, history } from "./week";
import { spreadPick, totalPick, nameMatches, sgn, tdRows, winPctAt } from "./picks";
import { twoPlus, firstTdShares } from "./calibration";
// TD scorers for one final game, via the Railway service (official play-by-play). null until the data is posted.
async function tdScorers(season, week, key) {
  const base = (process.env.MODEL_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    const d = await (await fetch(`${base}/td-scorers?season=${season}&week=${week}`, { cache: "no-store" })).json();
    // names (anytime), plus TD counts and the game's first TD scorer when the service provides them
    return d.ok && d.games[key] ? Object.assign([...d.games[key]], { counts: (d.counts || {})[key] || null, first: d.first ? d.first[key] ?? null : undefined, teams: (d.teams || {})[key] || null }) : null;
  } catch { return null; }
}
import { FLAGS, SEED } from "./seed";
import { loadSnaps, qbChange } from "./snaps";
import { loadInjuries } from "./injuries";

// Closing anytime-TD prices per player: { name: { ask, bid } } from the last pre-kickoff snapshot (snapshots stop
// updating a game once it kicks off, so the stored prices ARE the closing prices). Same name matching as the TD tab.
async function tdClosePrices(season, week, g, model) {
  const prices = await getJSON(K.tdpx(season, week, g.key));
  const tdModel = model.td[g.key];
  if (!prices || !tdModel) return null;
  const out = {};
  // Opening price (first entry of the TD price history, added 9/29) for the TD model's own CLV: did the price move toward
  // the model between the first snapshot and kickoff?
  const firstRaw = await getRedis().lindex(`tdpxhist:${season}:${week}:${g.key}`, 0).catch(() => null), first = firstRaw ? JSON.parse(firstRaw) : null;
  for (const r of tdRows(g.key, g.away, g.home, tdModel, prices, {})) if (r.price != null && !r.stale) {
    const o = first && r.market && first.p[r.market] ? first.p[r.market] : null;
    out[r.player] = { ask: r.price, bid: r.bid ?? null, thin: !!r.thin, openAsk: o ? o[0] : null, openBid: o ? o[1] : null };
  }
  return Object.keys(out).length ? out : null;
}
const result = (x) => (x > 0 ? "W" : x < 0 ? "L" : "P");
export async function gradeWeek(season, week) {
  const games = (await loadGames(season, week)).filter((g) => g.final);
  const model = await loadModel(season, week);
  const flags = FLAGS[`${season}:${week}`] || {};
  const snaps = await loadSnaps().catch(() => null);
  // The graded week's own report only (the feed keeps just each team's latest week; once next week's report is out,
  // using it here would flag the wrong week's QB situation). Snap counts still catch a QB change in the game itself.
  const injuries = Object.fromEntries(Object.entries((await loadInjuries().catch(() => null)) || {}).map(([t, xs]) => [t, xs.filter((x) => Number(x.week) === Number(week))]));
  let graded = 0;
  for (const g of games) {
    const prev = await getJSON(K.res(season, week, g.key));
    if (prev && prev.v >= 2) {                              // v2 = includes moneyline + TD grading
      // Already graded before closing TD prices were recorded: add them once, without re-grading anything else
      // (a full re-grade could change old spread/total results if the stored model has since been rerun).
      if (!prev.tdPx && prev.td && prev.td.length) {
        const px = await tdClosePrices(season, week, g, model);
        if (px) { prev.td = prev.td.map((p) => ({ ...p, ...(px[p.player] || {}) })); prev.tdPx = true; await setJSON(K.res(season, week, g.key), prev); }
      }
      continue;
    }
    const close = (await getJSON(K.close(season, week, g.key))) || ((SEED.close || {})[`${season}:${week}:${g.key}`] || null);
    const m = model.games[g.key];
    if (!close || !m) continue;
    const hist = await history(season, week, g.key, 500), open = (hist.find((s) => s.poly) || {}).poly || {};
    const cp = close.poly || {}, cb = close.books || {};
    const hs = cp.spread ? cp.spread.homeSpread : cb.spread ? cb.spread.homeSpread : null;
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
    }
    // TD model: every player's model chance vs whether he scored (rushing/receiving, from play-by-play)
    const tdModel = model.td[g.key];
    if (tdModel) {
      const scorers = await tdScorers(season, week, g.key);
      // Play-by-play not posted yet (MNF/late games finish before nflverse updates): wait and grade the whole game
      // later. Before 9/28 the game was saved as graded WITHOUT its TD results and never revisited, so those players
      // silently dropped out of the TD model check and the Polymarket comparison.
      if (!scorers) continue;
      if (scorers) rec.td = [...(tdModel.away || []).map((p) => ({ ...p, team: g.away })), ...(tdModel.home || []).map((p) => ({ ...p, team: g.home }))]
        .filter((p) => p.fair != null && p.fair >= 5).map((p) => ({ player: p.name, team: p.team, fair: p.fair, scored: scorers.some((s) => (nameMatches(p.name, s) || s === p.name) && (!scorers.teams || !scorers.teams[s] || scorers.teams[s].includes(p.team))) }));
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
      const px = rec.td ? await tdClosePrices(season, week, g, model) : null;
      if (px) { rec.td = rec.td.map((p) => ({ ...p, ...(px[p.player] || {}) })); rec.tdPx = true; }
    }
    const sp = spreadPick(m, hs, g.away, g.home);
    if (sp) {
      const cover = sp.side === "home" ? margin + hs : -margin - hs;
      const openLine = open.spread ? (sp.side === "home" ? open.spread.homeSpread : -open.spread.homeSpread) : null;
      rec.spread = { label: sp.label, pct: sp.pct, tier: (flags[g.key] && flags[g.key].spread && flags[g.key].spread.tier) || sp.tier,
        result: result(cover), clvPts: openLine != null ? +(openLine - sp.line).toFixed(1) : null };
    }
    const tp = totalPick(m, tl);
    if (tp) {
      const diff = tp.side === "over" ? total - tl : tl - total;
      const openLine = open.total ? open.total.line : null;
      rec.total = { label: tp.label, pct: tp.pct, tier: (flags[g.key] && flags[g.key].total && flags[g.key].total.tier) || tp.tier,
        result: result(diff), clvPts: openLine != null ? +(tp.side === "over" ? tl - openLine : openLine - tl).toFixed(1) : null };
    }
    await setJSON(K.res(season, week, g.key), rec);
    await getRedis().sadd(K.resIds, `${season}:${week}:${g.key}`);
    graded++;
  }
  const { findMisses } = await import("./missfinder");
  const { buildCalibration } = await import("./calibration");
  const allIds = (await getRedis().smembers(K.resIds)).filter((k) => k.startsWith(`${season}:`));
  const allRecs = (await Promise.all(allIds.map((k) => getRedis().get(`res:${k}`)))).filter(Boolean).map((x) => JSON.parse(x));
  await setJSON(`missfinder:${season}`, { t: new Date().toISOString(), misses: findMisses(allRecs) });
  await setJSON(`calib:${season}`, buildCalibration(allRecs));
  return graded;
}
export async function gradeRecent(season = SEASON) {
  const { loadSeason } = await import("./games");
  const all = await loadSeason(season);
  let n = 0;
  for (const w of [...new Set(all.filter((g) => g.final).map((g) => g.week))]) n += await gradeWeek(season, w);
  return n;
}
