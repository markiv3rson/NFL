// TD BY WEEK (10/20 night, owner: "for the TD tabs i should be able to click on it and it will show me each week that the last time they made a TD ...
// some players have not gotten a touchdown the past couple weeks"): per week, the games played (keys "AWAY @ HOME") and every scorer's touchdown
// count, from the same play-by-play feed the grading uses (Railway /td-scorers: rushing, receiving and return TDs; defensive TDs excluded).
// A finished week is cached 14 days, the running week 10 minutes. The page turns this into one line per player (W1 ✓ · W2 – · W3 bye ...).
import { getRedis } from "./redis";
import { modelBase, modelHeaders } from "./model";
import { SEASON, currentWeek, loadGames } from "./games";
export const K_TDWEEKS = (s, w) => `tdweeks:${s}:${w}`;
export async function tdWeeks(season = SEASON, upto = null, fetcher = null) {
  const r = getRedis(), cur = upto || (await currentWeek(season)), weeks = {};
  const get = fetcher || (async (w) => { const base = modelBase(); if (!base) return null;
    try { return await (await fetch(`${base}/td-scorers?season=${season}&week=${w}`, { cache: "no-store", headers: modelHeaders() })).json(); } catch { return null; } });
  for (let w = 1; w <= cur; w++) {
    let d = null; try { d = JSON.parse(await r.get(K_TDWEEKS(season, w))); } catch {}
    if (!d) {
      const res = await get(w); if (!res || !res.ok || !res.games) continue;
      const games = await loadGames(season, w).catch(() => []), allFinal = games.length > 0 && games.every((g) => g.final);
      d = { games: Object.keys(res.games), counts: res.counts || {}, final: allFinal };
      await r.set(K_TDWEEKS(season, w), JSON.stringify(d), "EX", allFinal ? 14 * 86400 : 600).catch(() => {});
    }
    weeks[w] = d;
  }
  return { season, upto: cur, weeks };
}
