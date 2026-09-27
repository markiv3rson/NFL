// Grades the model's picks at the CLOSING line (kickoff snapshot) once a game is final.
import { SEASON, loadGames } from "./games";
import { getRedis, getJSON, setJSON, K } from "./redis";
import { loadModel, history } from "./week";
import { spreadPick, totalPick, nameMatches, sgn } from "./picks";
import { blendGame } from "./blend";
// TD scorers for one final game, via the Railway service (official play-by-play). null until the data is posted.
async function tdScorers(season, week, key) {
  const base = (process.env.MODEL_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    const d = await (await fetch(`${base}/td-scorers?season=${season}&week=${week}`, { cache: "no-store" })).json();
    return d.ok && d.games[key] ? d.games[key] : null;
  } catch { return null; }
}
import { FLAGS, SEED } from "./seed";
import { loadSnaps, qbChange } from "./snaps";
import { loadInjuries } from "./injuries";

const result = (x) => (x > 0 ? "W" : x < 0 ? "L" : "P");
export async function gradeWeek(season, week) {
  const games = (await loadGames(season, week)).filter((g) => g.final);
  const model = await loadModel(season, week);
  const flags = FLAGS[`${season}:${week}`] || {};
  const snaps = await loadSnaps().catch(() => null);
  const injuries = (await loadInjuries().catch(() => null)) || {};
  let graded = 0;
  for (const g of games) {
    const prev = await getJSON(K.res(season, week, g.key));
    if (prev && prev.v >= 2) continue;                      // v2 = includes moneyline + TD grading
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
    if (m.homeWinPct != null && margin !== 0) {
      const homeFav = m.homeWinPct >= 50, pct = homeFav ? m.homeWinPct : 100 - m.homeWinPct;
      rec.ml = { label: `${homeFav ? g.home : g.away} ML`, pct, result: (homeFav ? margin > 0 : margin < 0) ? "W" : "L" };
    }
    // TD model: every player's model chance vs whether he scored (rushing/receiving, from play-by-play)
    const tdModel = model.td[g.key];
    if (tdModel) {
      const scorers = await tdScorers(season, week, g.key);
      if (scorers) rec.td = [...(tdModel.away || []).map((p) => ({ ...p, team: g.away })), ...(tdModel.home || []).map((p) => ({ ...p, team: g.home }))]
        .filter((p) => p.fair != null && p.fair >= 5).map((p) => ({ player: p.name, team: p.team, fair: p.fair, scored: scorers.some((s) => nameMatches(p.name, s) || s === p.name) }));
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
    // Blend (logged only, never shown on Game Lines/Totals): graded the same way as the model's own picks,
    // at the same closing line, so the two can be compared fairly in the weekly recap.
    if (m && m.homeMargin != null && m.total != null && cb.spread && cb.total) {
      // homeMargin: positive = home favored. homeSpread: negative = home favored. Convert before blending.
      const bl = blendGame(m.homeMargin, -cb.spread.homeSpread, m.total, cb.total.line);
      if (bl.margin != null && hs != null) {
        const isHome = -hs - bl.margin <= 0;   // same test spreadPick() uses, with the blended margin
        const cover = isHome ? margin + hs : -margin - hs;
        rec.blendSpread = { label: `${isHome ? g.home : g.away} ${isHome ? sgn(hs) : sgn(-hs)}`, result: result(cover) };
      }
      if (bl.total != null && tl != null) {
        const side = bl.total < tl ? "under" : "over";
        const diff = side === "over" ? total - tl : tl - total;
        rec.blendTotal = { label: `${side === "over" ? "Over" : "Under"} ${tl}`, result: result(diff) };
      }
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
