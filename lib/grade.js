// Grades the model's picks at the CLOSING line (kickoff snapshot) once a game is final.
import { SEASON, loadGames } from "./games";
import { getRedis, getJSON, setJSON, K } from "./redis";
import { loadModel, history } from "./week";
import { spreadPick, totalPick } from "./picks";
import { FLAGS, SEED } from "./seed";

const result = (x) => (x > 0 ? "W" : x < 0 ? "L" : "P");
export async function gradeWeek(season, week) {
  const games = (await loadGames(season, week)).filter((g) => g.final);
  const model = await loadModel(season, week);
  const flags = FLAGS[`${season}:${week}`] || {};
  let graded = 0;
  for (const g of games) {
    if (await getRedis().exists(K.res(season, week, g.key))) continue;
    const close = (await getJSON(K.close(season, week, g.key))) || ((SEED.close || {})[`${season}:${week}:${g.key}`] || null);
    const m = model.games[g.key];
    if (!close || !m) continue;
    const hist = await history(season, week, g.key, 500), open = (hist.find((s) => s.poly) || {}).poly || {};
    const cp = close.poly || {}, cb = close.books || {};
    const hs = cp.spread ? cp.spread.homeSpread : cb.spread ? cb.spread.homeSpread : null;
    const tl = cp.total ? cp.total.line : cb.total ? cb.total.line : null;
    const margin = g.homeScore - g.awayScore, total = g.homeScore + g.awayScore;
    const rec = { season, week, game: g.key, awayScore: g.awayScore, homeScore: g.homeScore, gradedAt: new Date().toISOString() };
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
  return graded;
}
export async function gradeRecent(season = SEASON) {
  const { loadSeason } = await import("./games");
  const all = await loadSeason(season);
  let n = 0;
  for (const w of [...new Set(all.filter((g) => g.final).map((g) => g.week))]) n += await gradeWeek(season, w);
  return n;
}
