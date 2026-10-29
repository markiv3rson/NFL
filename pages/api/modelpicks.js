// Model bets pick tabs (10/28 late, owner: "Remove all the sub tabs under models bets and I need sub tabs for all the models picks in the card ...
// Game Line Picks for all games split by their time / Halves and quarters ... player props and game props also"). The SAVED picks of one week:
// each game's card picks locked at kickoff (spread / total / ML PICK + PICK w/ POINTS, stack:<s>:<w>), its 1H SPREAD and GAME PROPS picks
// (teaser:<s>:<w>) and its Best TD picks (55%+, from the graded results). The page uses the live slate for the week on screen before kickoff
// and this for every game that has started and every past week. Player prop picks come from /api/props. Read-only.
import { getRedis, jparse, K } from "../../lib/redis";
import { SEASON, displayWeek, loadGames, started } from "../../lib/games";
import { lockedPicksFrom, gpOut, h1Out } from "../../lib/week";
import { tkey } from "../../lib/tracked";
const BEST_TD = 58;   // 10/29 (owner): the page's Best TD bar
// Model bets -> Anytime TD (10/29, owner: "#1 on each team"): per team, the players who scored in at least one of their last 3 played games (earlier weeks'
// graded results), the model's likeliest of them (none -> the team's #1); every team gets one (owner: "even if it's under 50%"). Tested walk-forward 2022-26 weeks 5+: ~8 picks a
// week scored 61.8% (2026: 65%); every team (owner later) ~30 a week, 43.2%; the old top-3 list 35.5%.
const TDP_RECENT = 3;
const tdVal = (p) => (p.model != null ? p.model : p.fair);
const tdKey = (team, player) => `${team}|${player}`;
// TD history before a week: team|player -> [true/false per played game], oldest first
async function tdHistory(r, season, upto) {
  const H = new Map();
  for (let w = 1; w < upto; w++) {
    const games = await loadGames(season, w).catch(() => []); if (!games.length) continue;
    const raw = await r.mget(games.map((g) => K.res(season, w, g.key))).catch(() => []);
    for (const x of raw || []) { const rs = jparse(x); for (const p of (rs && rs.td) || []) if (p.played !== false && typeof p.scored === "boolean") { const k = tdKey(p.team, p.player); if (!H.has(k)) H.set(k, []); H.get(k).push(p.scored); } }
  }
  return H;
}
// played games in a row without a TD (counted back from his last one) under 3 = he scored in at least one of his last 3
const recent = (H, p) => { const a = H.get(tdKey(p.team, p.player)) || []; let k = 0; for (let i = a.length - 1; i >= 0 && !a[i]; i--) k++; return k < TDP_RECENT; };
const tdPicksOf = (g, rs, H) => !rs || !Array.isArray(rs.td) ? [] : [g.away, g.home].map((t) => {
  const all = rs.td.filter((x) => x.team === t && x.played !== false).sort((a, b) => tdVal(b) - tdVal(a)), p = all.find((x) => recent(H, x)) || all[0];
  return p ? { player: p.player, team: t, fair: p.fair, model: tdVal(p), price: p.ask ?? null, scored: typeof p.scored === "boolean" ? p.scored : null } : null; }).filter(Boolean);
// 10/29 (owner: "I need records at the top of every tab in models bets ... the record of the picks on there winning and losing"): the season's W-L of
// exactly the picks these tabs show (the same locked card picks, 1H / GAME PROPS / PASSING TDs picks and Best TD picks), every week so far.
// Pushes count neither way. Cached 5 minutes.
const REC_KEYS = ["spread", "spreadPts", "total", "totalPts", "ml", "h1", "gp", "ptd", "td", "ftd", "tdp"];
async function seasonRecords(r, season, weeks) {
  const ck = `modelpicks:rec3:${season}`, hit = jparse(await r.get(ck).catch(() => null)); if (hit) return hit;
  const R = Object.fromEntries(REC_KEYS.map((k) => [k, { w: 0, l: 0 }])), add = (k, res) => { if (res === "W" || res === true) R[k].w++; else if (res === "L" || res === false) R[k].l++; };
  const H = new Map();   // the TD history so far (weeks before the one being counted)
  for (const week of weeks) {
    const games = await loadGames(season, week).catch(() => []); if (!games.length) continue;
    const [locked, teaser, resRaw] = await Promise.all([r.hgetall(`stack:${season}:${week}`).catch(() => ({})), r.hgetall(tkey(season, week)).catch(() => ({})), r.mget(games.map((g) => K.res(season, week, g.key))).catch(() => [])]);
    games.forEach((g, i) => {
      if (started(g)) { const L = lockedPicksFrom(locked || {}, g.key);
        if (L.spread) { add("spread", L.spread.result); if (L.spread.pts) add("spreadPts", L.spread.pts.result); }
        if (L.total) { add("total", L.total.result); if (L.total.pts) add("totalPts", L.total.pts.result); }
        if (L.ml) add("ml", L.ml.result); }
      const h1 = jparse((teaser || {})[`${g.key}|h1spr`]); if (h1 && h1.team) add("h1", h1.result);
      for (const [f, v] of Object.entries(teaser || {})) if (f.startsWith(`${g.key}|gp|`)) { const x = jparse(v); if (x && x.label) add(x.fam === "ptd_qb" ? "ptd" : "gp", x.result); }
      const rs = jparse((resRaw || [])[i]); for (const p of (rs && rs.td) || []) if (p.fair >= BEST_TD && p.played !== false) add("td", typeof p.scored === "boolean" ? p.scored : null);
      for (const p of ftdTopOf(g, rs, teaser || {})) add("ftd", p.hit);
      for (const p of tdPicksOf(g, rs, H)) add("tdp", p.scored);
    });
    for (const x of resRaw || []) { const rs = jparse(x); for (const p of (rs && rs.td) || []) if (p.played !== false && typeof p.scored === "boolean") { const k = tdKey(p.team, p.player); if (!H.has(k)) H.set(k, []); H.get(k).push(p.scored); } }
  }
  await r.set(ck, JSON.stringify(R), "EX", 300).catch(() => {});
  return R;
}
// 10/29 (owner: First TD "PUT 1 on each team. And have it recorded and graded"): each team's likeliest first scorer by the share saved at grading (the
// First TD tab's number at kickoff), with Polymarket's first-TD price and whether he scored the game's first TD
// The SAVED pick (lib/tracked.js recordFirstTd, from 10/29) when there is one, else -- weeks before it was saved -- the same pick read from the graded results.
const ftdTopOf = (g, rs, teaser = {}) => [g.away, g.home].map((t) => {
  const sv = jparse(teaser[`${g.key}|ftd|${t}`]), rows = rs && Array.isArray(rs.td) ? rs.td : [];
  if (sv && sv.player) { const p = rows.find((x) => x.team === t && x.player === sv.player);
    return { player: sv.player, team: t, ftd: sv.ftd, price: sv.price ?? null, hit: p && typeof p.ftdHit === "boolean" ? p.ftdHit : p && p.played === false ? null : rows.length && rs.td.some((x) => typeof x.ftdHit === "boolean") ? false : null }; }
  const p = rows.filter((x) => x.team === t && x.ftd != null && x.played !== false).sort((a, b) => b.ftd - a.ftd)[0];
  return p ? { player: p.player, team: t, ftd: p.ftd, price: p.firstAsk ?? null, hit: typeof p.ftdHit === "boolean" ? p.ftdHit : null } : null; }).filter(Boolean);
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const season = SEASON, dw = await displayWeek(season), week = Number(req.query.week) || dw.week, r = getRedis();
    const games = await loadGames(season, week);
    const [locked, teaser, resRaw] = await Promise.all([r.hgetall(`stack:${season}:${week}`).catch(() => ({})), r.hgetall(tkey(season, week)).catch(() => ({})),
      games.length ? r.mget(games.map((g) => K.res(season, week, g.key))).catch(() => []) : []]);
    const H = await tdHistory(r, season, week);
    const out = games.map((g, i) => {
      const L = started(g) ? lockedPicksFrom(locked || {}, g.key) : {}, h1 = jparse((teaser || {})[`${g.key}|h1spr`]), rs = jparse((resRaw || [])[i]);
      const gp = Object.entries(teaser || {}).filter(([f]) => f.startsWith(`${g.key}|gp|`)).map(([, v]) => jparse(v)).filter((x) => x && x.label).map(gpOut).sort((a, b) => b.said - a.said);
      const td = rs && Array.isArray(rs.td) ? rs.td.filter((p) => p.fair >= BEST_TD && p.played !== false).map((p) => ({ player: p.player, team: p.team, fair: p.fair, price: p.ask ?? null, scored: typeof p.scored === "boolean" ? p.scored : null })) : [];
      return { key: g.key, away: g.away, home: g.home, kickoff: g.kickoff, week, started: started(g), final: !!g.final, awayScore: g.awayScore ?? null, homeScore: g.homeScore ?? null,
        lines: L, h1pick: h1 && h1.team ? h1Out(h1) : null, gprops: gp, td,
        // 10/29: Model bets -> Anytime TD of a played game -- each team's 12 likeliest, graded; the page drops anyone with no TD in his 3 games before
        // that week and shows the top 4 left (owner: "give me the next person up")
        ftdTop: ftdTopOf(g, rs, teaser || {}), tdPicks: tdPicksOf(g, rs, H),
        tdTop: rs && Array.isArray(rs.td) ? [g.away, g.home].flatMap((t) => rs.td.filter((p) => p.team === t && p.played !== false).sort((a, b) => b.fair - a.fair).slice(0, 12)).map((p) => ({ player: p.player, team: p.team, fair: p.fair, price: p.ask ?? null, scored: typeof p.scored === "boolean" ? p.scored : null })) : [] };
    });
    const weeks = []; for (let w = 1; w <= dw.week; w++) weeks.push(w);
    res.status(200).json({ ok: true, season, week, weeks, games: out, ...(req.query.rec ? { records: await seasonRecords(r, season, weeks) } : {}) });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
