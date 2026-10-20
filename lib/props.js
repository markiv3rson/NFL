// PLAYER PROPS (10/17, owner: "build now"; bar 65%): passing / rushing / receiving yards, receptions, pass attempts, completions,
// longest reception.
//  - recordProps: every 15-min pull saves each Polymarket prop line of a not-started game (Over / Under price, Over bid, liquidity, volume),
//    keeping the week's FIRST price next to the latest one. Redis `props:<season>:<week>:<game>` = { first, t, m: { "name|stat|line": [...] } }.
//  - The model's chances (Railway /rerun-prop-probs, prop_model.py) are saved by the rerun as `propmodel:<season>:<week>:<game>`; reruns skip
//    started games, so the last copy before kickoff is the locked one. Same for the prices.
//  - gradeProps: once a game is final, every line where the model gives a side 65%+ is graded from the official stats (Railway
//    /player-stats; a player who did not play = 0, Polymarket settles that as Under) and saved in `propres:<season>:<week>` (one field per game).
//  - A prop group (stat x side x model band) is SHOWN only when it passed the 65% bar in history AND on real Polymarket lines (PROP_PASS,
//    from tests/prop_backtest.py + tests/prop_real.py) -- otherwise it is only tracked.
import { getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";

// 10/20 (owner: "58% should be the absolute floor" -> "keep it at 62% then"): a row is a side the model gives 62%+ (it was 65). The 62-65 band has NO
// real-line test yet (its live record is its test, propSummary group "62-65"); the 65%+ numbers in PROP_PASS stand.
export const PROP_BAR = 0.62;
export const PROP_BANDS = [[0.62, 0.65], [0.65, 0.70], [0.70, 0.80], [0.80, 0.90], [0.90, 1.01]];
export const bandOf = (p) => { const b = PROP_BANDS.find(([lo, hi]) => p >= lo && p < hi); return b ? `${Math.round(b[0] * 100)}-${Math.min(100, Math.round(b[1] * 100))}` : null; };
// Groups that passed both tests: "stat|side|band" -> { hist: [won, n], real: [won, n] }. Filled from the tests (see the notes in CLAUDE.md).
// 10/17 (owner, option A): only receiving-yards UNDERS where the model says 65%+ are shown -- the one family that cleared 65% on unseen history
// AND on real Polymarket lines in both halves of the season (PLAYER PROPS RESEARCH 2: 73.0% on 152 real lines, 72.5 / 73.5 by half; 75%+ 84.2%).
// hist = 2021-26 unseen seasons at ladder lines (tests/prop_backtest.py), real = 2026 weeks 1-6 Polymarket closes (tests/prop_real.py).
// 10/20 (owner: "build all 8"): RECEPTIONS OVERS 70%+ added -- history 2021-26 unseen 75.4 / 85.0 / 91.7% by band, real Polymarket closes weeks 1-6
// 14-2 / 3-3 / 3-3 (weeks 1-3 7-9, weeks 4-6 7-7 in the 70-80 band; the higher bands traded only from week 4). The 65-70 band (6-8 real, 2-4 in
// weeks 1-3) stays tracked only until it passes both halves. Receptions UNDERS fail on real lines (53.7 / 56.8%) and are not shown.
export const PROP_PASS = {
  "rec_yds|under|65-70": { hist: [12063, 17890], real: [52, 76] },
  "rec_yds|under|70-80": { hist: [11296, 15072], real: [36, 49] },
  "rec_yds|under|80-90": { hist: [6194, 7295], real: [16, 19] },
  "rec_yds|under|90-100": { hist: [2621, 2769], real: [7, 8] },
  "rec|over|70-80": { hist: [6341, 8415], real: [14, 16] },
  "rec|over|80-90": { hist: [4738, 5576], real: [3, 3] },
  "rec|over|90-100": { hist: [674, 735], real: [3, 3] },
  // 10/20 (owner: "find everything that works"): every band that clears 65% on unseen history AND in BOTH halves of the real lines (weeks 1-3 / 4-6).
  // Receiving-yards OVERS 65-70 (16-5; 8-4 / 8-1) and 80-90 (10-2; 7-2 / 3-0) -- the 70-80 band (14-9, 60.9%) stays tracked only; passing-yards OVERS
  // 80%+ (11-1; 5-1 / 6-1, plus 2-0 at 90%+) -- 65-80 fail a half. Rushing yards (every band fails a half) and passing-yards Unders are tracked only.
  "rec_yds|over|65-70": { hist: [2480, 3608], real: [16, 21] },
  "rec_yds|over|80-90": { hist: [466, 558], real: [10, 12] },
  "pass_yds|over|80-90": { hist: [4225, 4756], real: [11, 12] },
  "pass_yds|over|90-100": { hist: [1541, 1617], real: [2, 2] },
};
export const SHOWN_STATS = new Set(["rec_yds", "rec", "pass_yds"]);
export const PROP_SHORT = { rec_yds: "", rec: "Rec ", pass_yds: "Pass Yds " };   // the stat in front of the side on a Props row ("Rec Over 4.5", "Pass Yds Over 249.5"; receiving yards stay bare as before)   // the stats the live rerun asks the model about (lines come from the recorded Polymarket props)
export const propKey = (r) => `${r.name}|${r.stat}|${r.line}`;
export const K_PROPS = (s, w, g) => `props:${s}:${w}:${g}`;
export const K_PROPMODEL = (s, w, g) => `propmodel:${s}:${w}:${g}`;
export const K_PROPRES = (s, w) => `propres:${s}:${w}`;

// rows from lib/poly.js statPropsFromMarkets. m[key] = [overAsk, overBid, underAsk, liq, vol, firstOverAsk, firstUnderAsk, firstTime]
export async function recordProps(redis, season, g, rows, t) {
  if (!rows || !rows.length || !g || g.week == null) return 0;
  const key = K_PROPS(season, g.week, g.key), old = (await getJSON(key)) || { first: t, m: {} }, m = { ...(old.m || {}) };
  for (const r of rows) {
    const k = propKey(r), o = m[k];
    m[k] = [r.oa, r.ob, r.ua, r.liq, r.vol, o ? o[5] : r.oa, o ? o[6] : r.ua, o ? o[7] : t];
  }
  await setJSON(key, { first: old.first || t, t, m });
  return rows.length;
}
export function propRows(saved) {
  if (!saved || !saved.m) return [];
  return Object.entries(saved.m).map(([k, v]) => { const [name, stat, line] = k.split("|");
    return { name, stat, line: Number(line), oa: v[0], ob: v[1], ua: v[2], liq: v[3], vol: v[4], oa0: v[5], ua0: v[6], t0: v[7] }; });
}
// A side the model gives 65%+ -> a pick (with the price that side costs at the last reading before kickoff).
export function propPicks(modelRows, saved) {
  const px = new Map(propRows(saved).map((r) => [propKey(r), r]));
  const out = [];
  for (const r of modelRows || []) {
    const side = r.over >= PROP_BAR ? "over" : r.under >= PROP_BAR ? "under" : null; if (!side) continue;
    const p = px.get(propKey(r)) || {}, chance = side === "over" ? r.over : r.under;
    out.push({ name: r.name, stat: r.stat, line: r.line, side, chance, mu: r.mu, band: bandOf(chance), price: side === "over" ? p.oa ?? null : p.ua ?? null,
      bid: side === "over" ? p.ob ?? null : p.ob != null ? Math.round((1 - p.ob) * 1000) / 1000 : null, liq: p.liq ?? null, team: r.team || null });
  }
  return out;
}
export const groupOf = (p) => `${p.stat}|${p.side}|${p.band}`;
// 10/20 (owner: one floor, 62%, "don't make it confusing"): a row is shown when its stat + side FAMILY passed the real-line test (the four families in
// PROP_PASS) and the model gives it 62%+ -- no more per-band holes (receptions Over 65-70 / receiving-yards Over 70-80 were tracked only). The bands
// stay as the record's groups.
export const SHOWN_FAMILIES = new Set(["rec_yds|under", "rec|over", "rec_yds|over", "pass_yds|over"]);
export const shownProp = (p) => SHOWN_FAMILIES.has(`${p.stat}|${p.side}`) && p.chance >= PROP_BAR;

// Official stats for a finished week from the Railway service: { "AWAY @ HOME": { "<normalized name>": { pass_yds, ... } } }
const statCache = new Map();
async function weekStats(season, week) {
  const base = modelBase(); if (!base) return null;
  const ck = `${season}:${week}`;
  if (!statCache.has(ck)) statCache.set(ck, fetch(`${base}/player-stats?season=${season}&week=${week}`, { cache: "no-store", headers: modelHeaders() }).then((r) => r.json()));
  try { const d = await statCache.get(ck); return d && d.ok ? d : null; } catch { statCache.delete(ck); return null; }
}
export const normName = (n) => String(n || "").toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").split(/\s+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w)).join(" ");

// Grade one final game's prop picks (once). The game's stats must be posted (the service lists the game) -- a player missing from them did not play.
export async function gradePropsGame(redis, season, week, g) {
  const rk = K_PROPRES(season, week);
  if (await redis.hexists(rk, g.key)) return 0;
  const model = await getJSON(K_PROPMODEL(season, week, g.key)); if (!model || !model.rows) return 0;
  const st = await weekStats(season, week); if (!st || !st.games || !st.games[g.key]) return 0;
  const box = st.games[g.key], saved = await getJSON(K_PROPS(season, week, g.key));
  const picks = propPicks(model.rows, saved).map((p) => {
    const s = box[normName(p.name)], v = s ? Number(s[p.stat] || 0) : 0;
    const over = v > p.line;
    return { ...p, actual: v, played: !!s, result: (p.side === "over" ? over : !over) ? "W" : "L" };
  });
  await redis.hset(rk, g.key, JSON.stringify({ t: new Date().toISOString(), runAt: model.runAt || null, picks }));
  return picks.length;
}
export async function gradePropsWeek(redis, season, week, games) {
  let n = 0;
  for (const g of games) if (g.final) n += await gradePropsGame(redis, season, week, g).catch(() => 0);
  return n;
}
// Live record per group (and overall) for the Models tab: { groups: { "stat|side|band": { w, l, shown } }, all: { w, l } }
// 10/20 (owner: "don't contradict yourself or the app"): the group records counted EVERY ladder line (a player with Over 19.5 / 29.5 / 39.5 all passing = 3 wins),
// which is why "receiving-yards Over 70-80" read 48-6 here while the real traded lines read 14-9. Now each group counts ONE line per player + stat per game,
// chosen the way the page chooses its row (priced under its %, under MAX_PRICE, the highest %), so the Models numbers and the page agree; `lines` keeps the old every-line count.
export async function propSummary(redis, season, weeks) {
  const groups = {}, all = { w: 0, l: 0 }, lines = { w: 0, l: 0 };
  const bump = (x, p) => { if (p.result === "W") x.w++; else if (p.result === "L") x.l++; };
  for (const w of weeks) {
    const h = await redis.hgetall(K_PROPRES(season, w)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let d; try { d = JSON.parse(v); } catch { continue; }
      const graded = (d.picks || []).filter((p) => p.result === "W" || p.result === "L");
      for (const p of graded) bump(lines, p);
      const byGroup = {};
      for (const p of graded) (byGroup[groupOf(p)] = byGroup[groupOf(p)] || []).push(p);
      for (const [k, ps] of Object.entries(byGroup)) { const x = groups[k] || (groups[k] = { w: 0, l: 0, shown: !!PROP_PASS[k] });
        for (const p of onePerPlayer(ps)) bump(x, p); }
      for (const p of onePerPlayer(graded)) bump(all, p); }
  }
  return { groups, all, lines };
}

// ---- Props page (10/17, owner: "Add props as a new sub tab for bets") ----
// 10/18 (owner: "Organize this ... there's so much ... all those prices look so high that I won't even make any money"): Polymarket lists a LADDER of
// lines per player (69.5 / 59.5 / 49.5 ...), so one player showed up 4 times and the sure Unders cost 90c+. The page now shows ONE row per player:
// a line priced at or above its win % is dropped (no money in it); no price = kept, last.
// 10/20 (owner rule: win rate picks, price never does): of the lines left, the one with the HIGHEST win % (it was the line where the % beat
// the price by the most). Real Polymarket lines 2026 weeks 1-6, receiving-yards Unders 65%+, one per player (98): highest % won 70.4%
// (said 74.6, avg 60c, +42 per $100) vs biggest gap 66.3% (said 71.9, 56c, +44) -- the live record under the gap rule was 66%.
// The record counts the same rows. Every passing line is still saved and graded (propSummary keeps the full picture per group).
// 10/20 (owner: "I don't need the 90 cent rows" -> then "cut 77+"): a row priced at MAX_PRICE or above is not shown and not counted
// in the RECORD tile (it stays saved and graded in the background like every passing line).
// 10/20 (owner: "if polymarket price is over 77c then i shouldnt consider buying it ... cut 77+"): a row priced 77c or more is not shown and not counted (was 85c)
export const MAX_PRICE = 0.77;
export function onePerPlayer(picks) {
  const priced = (p) => p.price > 0 && p.price < 1;
  const best = new Map();
  for (const p of picks) {
    if (priced(p) && (p.price >= p.chance || p.price >= MAX_PRICE)) continue;
    const k = `${normName(p.name)}|${p.stat}`, q = best.get(k);   // 10/20: one row per player AND stat -- both sides can pass (A.J. Brown Under 99.5 88% and Over 19.5 82%); the higher % shows
    if (!q || p.chance > q.chance || (p.chance === q.chance && priced(p) && !priced(q))) best.set(k, p);
  }
  return [...best.values()].sort((a, b) => priced(b) - priced(a) || b.chance - a.chance);
}
// The week's shown props: one list, each game's picks (model 65%+, passing group, one line per player) with the price, ✓ / ✗ once graded.
export async function propsForWeek(redis, season, week, games) {
  const res = await redis.hgetall(K_PROPRES(season, week)).catch(() => null) || {}, out = [];
  for (const g of games || []) {
    let picks;
    if (res[g.key]) { try { picks = (JSON.parse(res[g.key]).picks || []).filter(shownProp); } catch { picks = []; } }
    else { const model = await getJSON(K_PROPMODEL(season, week, g.key)).catch(() => null); if (!model || !model.rows) continue;
      picks = propPicks(model.rows, await getJSON(K_PROPS(season, week, g.key)).catch(() => null)).filter(shownProp).map((p) => ({ ...p, result: null })); }
    picks = onePerPlayer(picks);
    if (!picks.length) continue;
    out.push({ game: g.key, away: g.away, home: g.home, kickoff: g.kickoff || null, final: !!g.final, started: !!g.started,
      picks: picks.map((p) => ({ name: p.name, team: p.team || null, stat: p.stat, side: p.side, line: p.line, chance: p.chance, price: p.price ?? null, result: p.result || null, actual: p.actual ?? null })) });
  }
  return out;
}
// W-L of the shown props this season (graded games)
export async function propsRecord(redis, season, weeks, stat = null) {   // 10/20: per stat for the Player props tabs (stat null = all)
  const rec = { w: 0, l: 0 };
  for (const w of weeks) { const h = await redis.hgetall(K_PROPRES(season, w)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let d; try { d = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer((d.picks || []).filter(shownProp))) { if (stat && p.stat !== stat) continue; if (p.result === "W") rec.w++; else if (p.result === "L") rec.l++; } } }   // the same rows the page shows
  return { ...rec, pct: rec.w + rec.l ? Math.round((rec.w / (rec.w + rec.l)) * 1000) / 10 : null };
}
// The lines the rerun sends the model: every recorded Polymarket line of the shown stats for one game
export async function propLinesFor(season, week, gameKey) {
  const saved = await getJSON(K_PROPS(season, week, gameKey)).catch(() => null);
  return propRows(saved).filter((r) => SHOWN_STATS.has(r.stat)).map((r) => ({ name: r.name, stat: r.stat, line: r.line }));
}
