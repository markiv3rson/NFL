import { buildWeek } from "../../lib/week";
import { displayWeek } from "../../lib/games";
import { loadInjuriesMeta } from "../../lib/injuries";
import { getStatus } from "../../lib/status";
import { recordSgp } from "../../lib/sgp";
import { setJSON, getRedis, SLATE_CACHE, BUILD, K } from "../../lib/redis";
import { computeWatch } from "../../lib/watchdog";
import { winnersSummary, recordedFor } from "../../lib/paper";
import { saveParlayList } from "../../lib/comboquote";
export const config = { maxDuration: 85 };
export default async function handler(req, res) {
  try {
    const cacheable = !req.query.week;
    res.setHeader("x-build", BUILD);   // which deployment answered (the page reloads itself when this changes)
    const wkKey = req.query.week ? `${SLATE_CACHE}:w${Number(req.query.week)}` : null;   // a requested week (the page's "Next week" view) is cached 2 minutes under its own key
    if (wkKey) { const c = await getRedis().get(wkKey).catch(() => null); if (c) { res.setHeader("Content-Type", "application/json"); return res.status(200).send(c); } }
    if (cacheable) { const c = await getRedis().get(SLATE_CACHE).catch(() => null); if (c) { res.setHeader("Content-Type", "application/json"); return res.status(200).send(c); } }
    const inj = await loadInjuriesMeta().catch(() => null), injuries = inj ? inj.teams : null;
    // 10/19 (owner: "after sunday games are done i need to start seeing week 7 on monday except for the week 6 monday game"): the pages show
    // lib/games.js displayWeek -- the next week once only the current week's Monday game is left, with that game on top (carry, its own week's data).
    const dw = req.query.week ? null : await displayWeek().catch(() => null);
    const data = await buildWeek({ week: Number(req.query.week) || (dw ? dw.week : undefined), injuries, injuriesPrev: inj ? inj.prev : null, injuriesAt: inj ? inj.updated : null });
    const carryData = dw && dw.carry.length ? await buildWeek({ week: dw.cur, injuries, injuriesPrev: inj ? inj.prev : null, injuriesAt: inj ? inj.updated : null, only: dw.carry }).catch(() => null) : null;
    if (cacheable) await recordSgp(data, setJSON).catch(() => 0);   // same-game parlays saved until kickoff, then graded (10/14)
    if (cacheable && carryData) await recordSgp(carryData, setJSON).catch(() => 0);   // the Monday game's own (week 6) copy
    const own = data.games;   // the shown week's own games: status, week check and watchdog stay about them
    if (carryData) {   // the Monday game(s) go on top, flagged with their own week (their parlays, picks and grading stay under that week)
      const keep = new Set(dw.carry), carry = carryData.games.filter((g) => keep.has(g.key)).map((g) => ({ ...g, week: dw.cur, carry: true }));
      data.games = [...carry, ...own]; data.carry = carry.map((g) => g.key); data.carryWeek = dw.cur;
    }
    if (cacheable) {   // 10/17: the parlays on the pages, for the background job that keeps their real Polymarket prices fresh (lib/comboquote.js)
      const kick = Object.fromEntries(data.games.map((g) => [g.key, g.kickoff])), open = data.games.filter((g) => !g.started && !g.final);
      const list = [...open.flatMap((g) => Object.values(g.sgp || {}).filter((p) => p && Array.isArray(p.legs))), ...(data.bestLegs || [])].map((p) => ({ ...p, kick: Object.fromEntries(p.legs.map((l) => [l.game, kick[l.game]])) }));
      await saveParlayList("nfl", list).catch(() => 0);
    }
    const status = await getStatus(data.season, data.week, data.meta || {}, data.modelRunAt).catch(() => null);
    const weekCheck = { games: own.length, withLines: own.filter((g) => g.poly).length, modelRun: !!data.modelRunAt };
    const watch = await computeWatch({ ...data, games: own }, status, inj);
    weekCheck.watch = watch;
    weekCheck.recorded = await recordedFor(data.season, data.week, own, K).catch(() => []);
    const winners = await winnersSummary(data.season).catch(() => null);
    const body = JSON.stringify({ ok: true, ...data, winners, injuries: undefined, propLegs: undefined, injuriesUpdated: inj ? inj.updated : null, status, weekCheck, now: new Date().toISOString() });
    if (cacheable) await getRedis().set(SLATE_CACHE, body, "EX", 60).catch(() => {});
    else if (wkKey) await getRedis().set(wkKey, body, "EX", 120).catch(() => {});
    res.setHeader("Content-Type", "application/json"); res.status(200).send(body);
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
