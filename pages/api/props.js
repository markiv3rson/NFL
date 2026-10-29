// Props page (10/17, owner: "Add props as a new sub tab for bets"): the week's shown player props (receiving-yards Unders the model gives 65%+,
// lib/props.js PROP_PASS) with their Polymarket price, ✓ / ✗ once the game is graded, and the season's W-L. ?week=N picks the week.
import { getRedis } from "../../lib/redis";
import { SEASON, displayWeek, loadGames, started, MB_FROM_WEEK } from "../../lib/games";
import { propsForWeek, propsRecord, propSummary, propsGradedAll } from "../../lib/props";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    // 10/19 (owner: week 7 on Monday): the default week is the one the pages show (lib/games.js displayWeek); the Monday game left from the week
    // before rides along on top with its own week's props.
    const season = SEASON, dw = await displayWeek(season), cur = dw.week, week = Number(req.query.week) || cur;
    const r = getRedis(), weeks = new Set([cur]); let c = "0";
    do { const [n, ks] = await r.scan(c, "MATCH", `propmodel:${season}:*`, "COUNT", 200); c = n; for (const k of ks) weeks.add(Number(k.split(":")[2])); } while (c !== "0");
    const games = (await loadGames(season, week)).map((g) => ({ ...g, started: started(g) }));
    if (req.query.all) { res.status(200).json({ ok: true, season, week, ...(await propsGradedAll(r, season, week, games)) }); return; }   // 10/23: every graded line, for npm run verify
    let list = await propsForWeek(r, season, week, games);
    if (week === dw.week && dw.carry.length) {
      const cg = (await loadGames(season, dw.cur)).filter((g) => dw.carry.includes(g.key)).map((g) => ({ ...g, started: started(g) }));
      list = [...(await propsForWeek(r, season, dw.cur, cg).catch(() => [])).map((x) => ({ ...x, week: dw.cur, carry: true })), ...list]; }
    // 10/29 (owner: "start fresh ... only for model bets"): Model bets asks with ?fresh=1 -> its records count from week 8 (lib modelpicks MB_FROM_WEEK)
    const rw = req.query.fresh ? [...weeks].filter((w) => w >= MB_FROM_WEEK) : [...weeks];
    const record = await propsRecord(r, season, rw);
    const records = {}; for (const st of ["rec_yds", "rec", "pass_yds", "rush_yds", "pass_td", "atd"]) records[st] = await propsRecord(r, season, rw, st === "rush_yds" ? ["rush_yds", "scrim_yds", "rush_att"] : st);   // 10/28 night: scrimmage yards ride the Rush Yds tab; 10/29: + rushing attempts there, Pass TD and No TD tabs   // 10/20: one RECORD tile per Player props tab
    // 10/20 review: every graded group's live record (shown or only tracked, e.g. receiving-yards OVERS 65%+) for the weekly report -- data, not shown on the page
    const groups = req.query.groups ? (await propSummary(r, season, [...weeks]).catch(() => null)) : undefined;
    res.status(200).json({ ok: true, season, week, weeks: [...weeks].filter(Number.isFinite).sort((a, b) => a - b), games: list, record, records, ...(groups ? { groups } : {}) });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
