// Replay (10/10): the picks built on 10/9 (teaser legs, total +6, total-fell Under, early-week total, combo picks and research
// keepers) did not exist at the kickoffs of weeks 3-4. This runs them on those games from what was saved then: the closing
// snapshot, the week's first snapshot (opening line), the week's model run and the schedule before that week, then grades them
// against the finals. Every record is tagged replay: true. Weeks already recorded live are left alone.
import { getRedis, getJSON, jparse, K } from "./redis";
import { loadGames } from "./games";
import { loadModel } from "./week";
import { situationFor } from "./paper";
import { venue } from "./wind";
import { tablePicks, comboFactors, skey, gradeStackWeek } from "./stack";
import { teaserLeg, totalLeg, totalMove, tkey, gradeTeasersWeek } from "./teaser";
import { loadComboModel } from "./combomodel";

export async function replayWeek(season, week) {
  await loadComboModel().catch(() => null);
  const r = getRedis(), games = (await loadGames(season, week)).filter((g) => g.final), model = await loadModel(season, week);
  let n = 0;
  for (const g of games) {
    const close = await getJSON(K.close(season, week, g.key)).catch(() => null), mg = model.games[g.key];
    if (!close || !close.poly || !close.poly.spread || !close.poly.total) continue;
    const poly = close.poly, bk = close.books || null, t = close.t || "replay";
    const first = jparse(await r.lindex(K.snaps(season, week, g.key), 0).catch(() => null));
    const so = first && first.poly && first.poly.spread ? first.poly.spread.homeSpread : null, to = first && first.poly && first.poly.total ? first.poly.total.line : null;
    const hs = bk && bk.spread && bk.spread.homeSpread != null ? bk.spread.homeSpread : poly.spread.homeSpread, tl = bk && bk.total && bk.total.line != null ? bk.total.line : poly.total.line;
    const tag = { replay: true, week, t };
    const put = async (key, field, obj) => { if (await r.hsetnx(key, field, JSON.stringify({ ...obj, ...tag }))) n++; };
    const leg = teaserLeg(g, poly, bk); if (leg) await put(tkey(season, week), g.key, leg);
    if (!mg) continue;
    const v = venue(g) || {}, sit = await situationFor(season, week, g).catch(() => null), G = { ...g, outdoor: !!v.outdoor };
    const mv = totalMove(to, tl), mU = mg.calUnder != null ? mg.calUnder >= 50 : null;
    const tlg = totalLeg(g, poly, bk, mv ? mv.under : mg.outdoor && mg.wind != null && mg.wind >= 15 ? true : mU == null ? true : !mU);
    if (tlg) await put(tkey(season, week), `${g.key}|total`, tlg);
    if (mv && mv.under && mU === true) await put(tkey(season, week), `${g.key}|totmove`, { game: g.key, kind: "total", move: true, side: "under", base: tl, line: tl, open: to });
    const c = comboFactors(G, mg, hs, tl, so, to, sit, Number(week));
    if (c && c.early != null && to != null && Math.abs(c.early - to) >= 0.5) await put(tkey(season, week), `${g.key}|early`, { game: g.key, kind: "total", early: true, side: c.early > to ? "over" : "under", base: to, line: to, model: c.early });
    for (const p of tablePicks(G, mg, hs, tl, so, to, sit, Number(week))) await put(skey(season, week), `${g.key}|${p.id}`, { ...p, game: g.key, home: g.home });
  }
  const fin = games.map((g) => ({ key: g.key, home: g.home, away: g.away, homeScore: g.homeScore, awayScore: g.awayScore }));
  await gradeTeasersWeek(season, week, fin); await gradeStackWeek(season, week, fin);
  return n;
}
