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
import { getJSON, setJSON, getRedis } from "./redis";
import { modelBase, modelHeaders } from "./model";

// 10/20 (owner: "58% should be the absolute floor" -> "keep it at 62% then"): a row is a side the model gives 62%+ (it was 65). The 62-65 band has NO
// real-line test yet (its live record is its test, propSummary group "62-65"); the 65%+ numbers in PROP_PASS stand.
// 10/22 (owner: "cut 62% - 65%"): the page, the RECORD tiles, LAST WK and the prop parlays show 65%+ only (PROP_BAR). Lines at 62%+ are still
// graded in the background (TRACK_BAR) so the Models "62-65" group keeps its record. Real Polymarket lines weeks 1-6: the 62-65 receiving-yards
// Unders went 15-20.
export const PROP_BAR = 0.65, TRACK_BAR = 0.62;
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
  // 10/26 (angle sweep, scratchpad k1/nflprops.py): RUSHING-YARDS UNDERS at 75%+ -- real Polymarket closes weeks 1-6 under the page's rules (priced 50-77c
  // and under the %, one per player) 19-6 = 76.0% (weeks 1-3 68.8 on 16, 4-6 88.9 on 9; +18.0 per $100 at 64c); unseen history 2021-26 said 85.6 won 85.3 (17,740 lines).
  // The 65-75 band is 50% on real lines (36) -> the family's bar is 75% (FAMILY_BAR). The bands here start at 75 (the 70-80 row = 75-80).
  "rush_yds|under|70-80": { hist: [3357, 4263], real: [8, 11] },
  "rush_yds|under|80-90": { hist: [7413, 8702], real: [11, 14] },
  "rush_yds|under|90-100": { hist: [4375, 4803], real: [0, 0] },
};
export const SHOWN_STATS = new Set(["rec_yds", "rec", "pass_yds", "rush_yds", "scrim_yds", "rush_att", "pass_td", "atd"]);   // 10/28 night: + scrimmage yards (prop_model2 only); 10/29: + rushing attempts, passing TDs, anytime TD (prop_model2 only)
export const PROP_SHORT = { rec_yds: "", rec: "Rec ", pass_yds: "Pass Yds ", rush_yds: "Rush Yds ", scrim_yds: "Scrim Yds ", rush_att: "Rush Att ", pass_td: "Pass TD ", atd: "TD " };   // the stat in front of the side on a Props row ("Rec Over 4.5", "Pass Yds Over 249.5"; receiving yards stay bare as before)   // the stats the live rerun asks the model about (lines come from the recorded Polymarket props)
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
// 10/21 fix: a pick's bid is its OWN side's -- the Under bid = 1 - the Over ASK (1 - the Over bid is the Under ask, what you would pay).
export function propPicks(modelRows, saved) {
  const rows = propRows(saved), px = new Map(rows.map((r) => [propKey(r), r])), mids = ladderMiddles(rows);
  const out = [];
  for (const r of modelRows || []) {
    const side = r.over >= TRACK_BAR ? "over" : r.under >= TRACK_BAR ? "under" : null; if (!side) continue;
    const p = px.get(propKey(r)) || {}, chance = side === "over" ? r.over : r.under, mid = mids.get(`${r.name}|${r.stat}`);
    out.push({ name: r.name, stat: r.stat, line: r.line, side, chance, mu: r.mu, band: bandOf(chance), price: side === "over" ? p.oa ?? null : p.ua ?? null,
      bid: side === "over" ? p.ob ?? null : p.oa != null ? Math.round((1 - p.oa) * 1000) / 1000 : null, liq: p.liq ?? null, team: r.team || null,
      // 10/28 night: the second model's % for the same side (m2), whether it ran for the game (m2run), where the row's % came from (src "m2" =
      // prop_model2: rushing / scrimmage yards), the player's market middle (mid50: his own ladder's 50% line)
      ...(r.m2o != null ? { m2: Math.round((side === "over" ? r.m2o : 1 - r.m2o) * 10000) / 10000 } : {}), ...(r.m2run ? { m2run: true } : {}), ...(r.src ? { src: r.src } : {}),
      ...(mid != null ? { mid50: mid } : {}) });
  }
  return out;
}
// 10/28 night (owner: "build ... 1, 2, 3, 4, and 5"): the two prop models on one row. rows = prop_model.py's (the app's model), rows2 =
// prop_model2.py's (null when it did not answer). Receiving yards / receptions keep the first model's % and carry the second's (m2o) for the
// agreement rule; rushing yards take the second model's % (its tested family: rush Unders 108-28 = 79.4% on Polymarket US 2026 wk1-7, the
// first model's rush lines have no live record yet), the first model's kept as m1o; scrimmage yards come only from the second model.
export const M2_STATS = new Set(["rush_yds", "scrim_yds", "rush_att", "pass_td", "atd"]), AGREE_STATS = new Set(["rec_yds", "rec"]);   // 10/29: + rushing attempts, passing TDs, anytime TD (the second model only)
export function mergeModels(rows, rows2) {
  const out = [], two = new Map((rows2 || []).map((r) => [propKey(r), r])), ran = Array.isArray(rows2), seen = new Set();
  for (const r of rows || []) { const r2 = two.get(propKey(r));
    if (M2_STATS.has(r.stat)) { if (!r2) { if (!ran) out.push(r); continue; } out.push({ ...r, over: r2.over, under: r2.under, m1o: r.over, src: "m2", m2run: true }); seen.add(propKey(r)); continue; }
    out.push(ran ? { ...r, ...(r2 ? { m2o: r2.over } : {}), m2run: true } : r); if (r2) seen.add(propKey(r)); }
  for (const r2 of rows2 || []) if (M2_STATS.has(r2.stat) && !seen.has(propKey(r2))) out.push({ name: r2.name, team: r2.team || null, stat: r2.stat, line: r2.line, over: r2.over, under: r2.under, src: "m2", m2run: true });
  return out;
}
// the 50% line of a player's own ladder (Polymarket's middle for him): Over mid = (Over ask + Over bid) / 2 from the saved prices, crossing 0.5
export function ladderMiddles(rows) {
  const by = new Map(), out = new Map();
  for (const r of rows || []) { if (!(r.oa > 0 && r.oa < 1 && r.ua > 0 && r.ua < 1)) continue; const k = `${r.name}|${r.stat}`; (by.get(k) || by.set(k, []).get(k)).push([r.line, (r.oa + 1 - r.ua) / 2]); }
  for (const [k, pts] of by) { pts.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < pts.length; i++) { const [x0, p0] = pts[i], [x1, p1] = pts[i + 1];
      if (p0 >= 0.5 && p1 < 0.5) { out.set(k, Math.round((x0 + (p0 - 0.5) / (p0 - p1) * (x1 - x0)) * 10) / 10); break; } } }
  return out;
}
export const groupOf = (p) => `${p.stat}|${p.side}|${p.band}`;
// 10/20 (owner: one floor, 62%, "don't make it confusing"): a row is shown when its stat + side FAMILY passed the real-line test (the four families in
// PROP_PASS) and the model gives it 62%+ (65%+ since 10/22) -- no more per-band holes (receptions Over 65-70 / receiving-yards Over 70-80 were tracked only). The bands
// stay as the record's groups.
// 10/24 (rule 7 hunt): passing-yards Overs off the page -- under the page's rules (priced under 77c, one per player) the real 2026 lines weeks 1-6 went
// 7-5 = 58.3% at -16.6 per $100 (the family was added for its 80%+ rows at 84c, which the 77c cap removed); still scored and graded in the background
export const SHOWN_FAMILIES = new Set(["rec_yds|under", "rec|over", "rec_yds|over", "rush_yds|under", "rec|under", "scrim_yds|under", "rush_att|under", "pass_td|over", "atd|under"]);   // 10/26: rushing-yards Unders; 10/28 night: + receptions Unders, scrimmage-yards Unders; 10/29: + rushing-attempts Unders, QB passing-TD Overs, anytime TD "No" (atd Under 0.5)
// 10/28 night (owner: "1, 2, 3, 4, and 5"): RECEPTIONS UNDERS at 65%+ (the page's rule weeks 6-7: 74-17 = 81.3%; 65-69 7-2, 70-74 15-8, 75-79 34-6,
// 80-84 16-1); rushing-yards Unders at 65%+ on the SECOND model (M2_STATS; 108-28 = 79.4% on Polymarket US 2026 wk1-7, the first model's 75%
// bar is gone with it); scrimmage-yards Unders the same (27-8). Receiving yards / receptions show only when the second model agrees (AGREE_STATS:
// both models weeks 6-7 130-26 = 83.3% vs 146-35 the first alone; it disagreeing 21-9). 10/28 night - 10/29: an Under more than 1.7x the player's own
// market middle was not shown; 10/29 (owner: "why are we cutting it ... test it"): under today's rules (70%+, 82c) those far Unders won 69-15 = 82.1%
// vs 311-81 = 79.3% for the rest (better in both halves of the season), so the cut is gone. The middle (mid50) is still saved on each row.
// 10/22 (owner: "fix the problems only. build now"): receiving yards (Under AND Over) start at 70% -- their 65-70% band won under 65% on real Polymarket
// lines weeks 1-6 (Under 22-14 = 61.1%, Over 7-3) and live (Under 21-13 = 61.8%, Over 11-8 = 57.9%); their 70-80% bands hold (Under 35-14 real / 48-20
// live, Over 8-4 / 14-3). The 65-70 lines are still graded in the background (record groups).
// 10/29 (owner: "build now" on the props test): receptions Overs and rushing-yards Unders 75%+ -- their 70-75% rows were the weakest on the model that
// prices them (receptions Over 70-75: Polymarket US 2026 wk1-7 14-12, live weeks 6-7 4-2; 75%+ 61-19 / 10-1. Rushing-yards Under 70-75 on the second
// model 17-8, 75%+ 93-19). Receiving-yards Overs stay 70%: their 70-75 rows on the app's own model went 10-0 live (weeks 6-7; the 16-10 was the
// second model's, which does not price them). The new families start at 75%: rushing-attempts Unders 19-4, QB passing-TD Overs 21-7, anytime TD
// "No" 159-52 (2026 wk1-7, the second model never saw 2026, the page's rules: 50-82c, priced under its %, one per player).
export const FAMILY_BAR = { "rec_yds|under": 0.70, "rec_yds|over": 0.70, "rec|over": 0.75, "rec|under": 0.70, "rush_yds|under": 0.75, "scrim_yds|under": 0.70,
  "rush_att|under": 0.75, "pass_td|over": 0.75, "atd|under": 0.75 };   // 10/29 (owner's table): every shown family 70%+   // 10/28 night: rushing-yards Unders 65% on the second model (was 75% on the first)
// 10/27 research session (owner: "research more edges ... with all of Polymarket's data ... build now"): the shown % is 0.6 x the model + 0.4 x
// Polymarket's price on a priced row (the NBA page's way, nba/lib/props.js OVER_W). Every graded line weeks 6-7 (1,813): log loss model alone 0.5084,
// price alone 0.5114, 0.4 blend 0.5038 (week 6 0.4914 -> 0.4826, week 7 0.5146 -> 0.5116 -- better both weeks; the 10/26 walk-forward on the
// research rows read the same, best at 0.3-0.4); the page's rows chosen on the blend won 78.6% of 224 vs 77.6% of 250 on the model. The saved
// pick keeps the model's own chance (`model` on the row); grading and the group records are unchanged.
export const PROP_MKT_W = 0.4;
export const blendChance = (p) => (p && p.model == null && p.price > 0 && p.price < 1 && p.chance != null ? (1 - PROP_MKT_W) * p.chance + PROP_MKT_W * p.price : p.chance);
export const agrees = (p) => !p.m2run || !AGREE_STATS.has(p.stat) || (p.m2 != null && (p.price > 0 && p.price < 1 ? (1 - PROP_MKT_W) * p.m2 + PROP_MKT_W * p.price : p.m2) >= PROP_BAR);
export const shownProp = (p) => SHOWN_FAMILIES.has(`${p.stat}|${p.side}`) && (!M2_STATS.has(p.stat) || p.src === "m2") && blendChance(p) >= (FAMILY_BAR[`${p.stat}|${p.side}`] ?? PROP_BAR)
  && agrees(p);

// Official stats for a finished week from the Railway service: { "AWAY @ HOME": { "<normalized name>": { pass_yds, ... } } }
// 10/23 recheck: kept 20 minutes (it was kept for the life of the server, so a game waiting for the snap counts never saw them)
const statCache = new Map(), STAT_TTL = 20 * 60e3;
export const clearStatCache = () => statCache.clear();
export async function weekStats(season, week) {
  const base = modelBase(); if (!base) return null;
  const ck = `${season}:${week}`, hit = statCache.get(ck);
  if (!hit || Date.now() - hit.t > STAT_TTL) statCache.set(ck, { t: Date.now(), p: fetch(`${base}/player-stats?season=${season}&week=${week}`, { cache: "no-store", headers: modelHeaders() }).then((r) => r.json()) });
  try { const d = await statCache.get(ck).p; return d && d.ok ? d : null; } catch { statCache.delete(ck); return null; }
}
export const normName = (n) => String(n || "").toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").split(/\s+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w)).join(" ");

// Grade one final game's prop picks. The game's stats must be posted (the service lists the game).
// 10/23 recheck: Polymarket's own rule on every player prop -- "The listed player must participate in the game by taking at least one snap ...
// otherwise, the market will settle to the last fair market price" -- so a player who took NO snap is a push (P, his money back at about its
// price), never an Under win. The stats list only players with a touch (or offensive snaps once snap counts post), so a player missing from
// them is decided by the week's snap counts (`snaps`, anyone with an offense / defense / special-teams snap): in them -> he played, 0 yards;
// not in them -> push; snap counts not posted yet -> his row waits (`wait`) and the game is graded again on a later run.
export const propOutcome = (p, box, snaps) => {
  const s = box[normName(p.name ?? p.player)];
  if (!s && !(Array.isArray(snaps) && snaps.length)) return null;   // no touch, snap counts not in yet -> wait
  if (s && p.stat !== "scrim_yds" && s[p.stat] === undefined) return null;   // 10/29: a stat the service's box does not carry (an older service copy) waits -- never read as 0 (a No TD would grade a win)
  const played = !!s || snaps.includes(normName(p.name ?? p.player));
  if (!played) return { actual: 0, played: false, result: "P" };
  const v = s ? (p.stat === "scrim_yds" ? Number(s.rush_yds || 0) + Number(s.rec_yds || 0) : Number(s[p.stat] || 0)) : 0, over = v > Number(p.line);   // scrimmage = rushing + receiving; rush_att / pass_td / atd come from the service (10/29)
  return { actual: v, played: true, result: (p.side === "over" ? over : !over) ? "W" : "L" };
};
// 10/26 (owner: "recheck everything ... find anything that's wrong"): stats get corrected after the first grade -- nflverse's play-by-play left
// out yards after a lateral until the service fix (Bi.Robinson week 7: 45 graded, official 59, an Under 49.5 graded W that lost), and the
// official numbers can move a day or two after a game -- so a graded game is re-graded from fresh stats twice more, 20+ h apart
// (`rechecks`, `checkedAt`, `fixed` = rows whose result or number changed). A row whose player can't be read keeps its grade.
export const PROP_RECHECKS = 2, PROP_RECHECK_H = 20;
const recheckDue = (prev, now) => !!prev && !prev.wait && (prev.rechecks || 0) < PROP_RECHECKS
  && now - Date.parse(prev.checkedAt || prev.regradedAt || prev.t || 0) >= PROP_RECHECK_H * 3600e3;
export async function gradePropsGame(redis, season, week, g, now = Date.now()) {
  const rk = K_PROPRES(season, week), old = await redis.hget(rk, g.key).catch(() => null);
  let prev = null; if (old) { try { prev = JSON.parse(old); } catch { return 0; } }
  // graded before: look again while rows wait for snap counts, ONCE for rows graded "did not play" before the snap rule (10/23), and on the rechecks
  const again = recheckDue(prev, now);
  if (prev && !again && !prev.wait && (prev.snapChecked || !(prev.picks || []).some((p) => p.played === false))) return 0;
  const st = await weekStats(season, week); if (!st || !st.games || !st.games[g.key]) return 0;
  const box = st.games[g.key], snaps = st.snaps && st.snaps[g.key];
  let picks, fixed = 0;
  if (prev) picks = (prev.picks || []).map((p) => {
    if (!again && p.result && p.played !== false) return p;
    const o = propOutcome(p, box, snaps); if (!o) return p.result ? p : { ...p, result: null, played: null };   // an old graded row keeps its grade when it can't be read
    if (p.result && (o.result !== p.result || o.actual !== p.actual)) fixed++;
    return { ...p, ...o };
  });
  else {
    const model = await getJSON(K_PROPMODEL(season, week, g.key)); if (!model || !model.rows) return 0;
    const saved = await getJSON(K_PROPS(season, week, g.key));
    picks = propPicks(model.rows, saved).map((p) => ({ ...p, ...(propOutcome(p, box, snaps) || { result: null, played: null }) }));
  }
  const wait = picks.some((p) => !p.result), at = new Date(now).toISOString();
  const rc = again ? { rechecks: (prev.rechecks || 0) + 1, checkedAt: at, ...(fixed || prev.fixed ? { fixed: (prev.fixed || 0) + fixed } : {}) } : {};
  await redis.hset(rk, g.key, JSON.stringify({ ...(prev || { t: at, runAt: null }), ...(prev ? { regradedAt: at } : {}), picks, ...rc, ...(wait ? { wait: true } : { wait: false, snapChecked: !!snaps }) }));
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
// 10/23 (owner: "check all calibration and wording"): a group is "shown" only when its family is shown AND its band starts at the family's bar
// (rec yds 70%+ since 10/22, the rest 65%+) -- the 62-65 bands and the rec yds 65-70 bands read "shown" while the page hid them
// 10/29: a band holds shown rows when its top is above the family's bar (the 70-80 band of a 75% family = its 75-80 rows)
export const groupShown = (k) => { const [st, side, band] = k.split("|"), fam = `${st}|${side}`, hi = Number(String(band).split("-")[1]) / 100;
  return SHOWN_FAMILIES.has(fam) && hi > (FAMILY_BAR[fam] ?? PROP_BAR) + 1e-9; };
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
      for (const [k, ps] of Object.entries(byGroup)) { const x = groups[k] || (groups[k] = { w: 0, l: 0, shown: groupShown(k) });   // 10/21: shown = the page's rule (SHOWN_FAMILIES), not the old per-band PROP_PASS
        for (const p of onePerPlayer(ps)) bump(x, p); }
      for (const p of onePerPlayer(graded)) bump(all, p); }
  }
  return { groups, all, lines };
}

// ---- Props page (10/17, owner: "Add props as a new sub tab for bets") ----
// 10/18 (owner: "Organize this ... there's so much ... all those prices look so high that I won't even make any money"): Polymarket lists a LADDER of
// lines per player (69.5 / 59.5 / 49.5 ...), so one player showed up 4 times and the sure Unders cost 90c+. The page now shows ONE row per player:
// a line priced at or above its win % is dropped (no money in it); no price = kept, last (10/29: no price = not shown, see onePerPlayer).
// 10/20 (owner rule: win rate picks, price never does): of the lines left, the one with the HIGHEST win % (it was the line where the % beat
// the price by the most). Real Polymarket lines 2026 weeks 1-6, receiving-yards Unders 65%+, one per player (98): highest % won 70.4%
// (said 74.6, avg 60c, +42 per $100) vs biggest gap 66.3% (said 71.9, 56c, +44) -- the live record under the gap rule was 66%.
// The record counts the same rows. Every passing line is still saved and graded (propSummary keeps the full picture per group).
// 10/20 (owner: "I don't need the 90 cent rows" -> then "cut 77+"): a row priced at MAX_PRICE or above is not shown and not counted
// in the RECORD tile (it stays saved and graded in the background like every passing line).
// 10/20 (owner: "if polymarket price is over 77c then i shouldnt consider buying it ... cut 77+"): a row priced 77c or more is not shown and not counted (was 85c)
export const MAX_PRICE = 0.82;   // 10/29 (owner: "set the player props cap to 82"): was 0.77
// 10/22 night (owner: "fix the weak spots"): no row priced under MIN_PRICE (50c: real lines weeks 1-6 under 50c 8-7, 50-77c 74-75%); saved and graded in the background.
export const MIN_PRICE = 0.50;
// 10/23 (owner: "check all calibration and wording and numbering"): with the calibration bands passed in, a priced row must ALSO be priced under its
// calibrated % (the number the page shows), so no row reads a % under its own price. Live graded rows weeks 6-7: calibrated % over the price 77-24
// (76.2%, +7.4 per $100), at or under it 5-3 (62.5%, -13.7). The bands themselves are fit on the rows without this test (propCalibration).
export function onePerPlayer(picks, bands = null) {
  const priced = (p) => p.price > 0 && p.price < 1;
  const best = new Map();
  for (const q0 of picks) {
    const p0 = q0.model == null && priced(q0) ? { ...q0, model: q0.chance, chance: Math.round(blendChance(q0) * 10000) / 10000 } : q0;   // 10/27: the blended % (blendChance)
    if (priced(p0) && (p0.price >= p0.chance || p0.price >= MAX_PRICE || p0.price < MIN_PRICE)) continue;
    // 10/29 weekend check: a row nobody sells is not a bet -- since an Under needs a real Over bid (no midpoint stand-in), unpriced rows showed with the
    // model's own % (Gibbs scrimmage Under 119.5, Mason rush attempts Under 15.5, week 8); every family was tested on priced rows only. Still graded.
    if (!priced(p0)) continue;
    const p = bands ? { ...p0, cal: calibrate(p0.chance, bands, famOf(p0)) } : p0;
    if (bands && priced(p) && p.price >= p.cal) continue;
    // 10/29 night recheck: the family bar is met on the shown (calibrated) % too -- Kyle Williams receptions Under 1.5 passed at 71% before calibration
    // and showed 68.9% on a 70%+ list
    if (bands && SHOWN_FAMILIES.has(famOf(p)) && p.cal < (FAMILY_BAR[famOf(p)] ?? PROP_BAR) - 1e-9) continue;
    const k = `${normName(p.name)}|${p.stat}`, q = best.get(k);   // 10/20: one row per player AND stat -- both sides can pass (A.J. Brown Under 99.5 88% and Over 19.5 82%); the higher % shows
    if (!q || p.chance > q.chance || (p.chance === q.chance && priced(p) && !priced(q))) best.set(k, p);
  }
  return [...best.values()].sort((a, b) => priced(b) - priced(a) || b.chance - a.chance);
}
// The week's shown props: one list, each game's picks (model 65%+, passing group, one line per player) with the price, ✓ / ✗ once graded.
// 10/20 night (owner: "i need to see each players last weeks line and see if it won or not"): the player's most recent graded prop of the same stat
// (last week, else the week before), with its line, side, ✓ / ✗ and the real number; a player with no line then still gets his last game's number.
export async function lastWeekProps(redis, season, week, bands = null) {
  const out = {};
  for (const w of [week - 1, week - 2]) {
    if (w < 1) break;
    const h = await redis.hgetall(K_PROPRES(season, w)).catch(() => null) || {};
    // 10/21: the row the page SHOWED that week (shownProp + onePerPlayer, as propsForWeek / propsRecord) -- the first graded line of the ladder
    // showed another line and side (20 of 25 week-7 cells: 18-2 on the cells vs 12-8 on the rows really shown)
    for (const v of Object.values(h)) { let rec; try { rec = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer((rec.picks || []).filter(shownProp), bands)) { const k = `${normName(p.name)}|${p.stat}`; if (!out[k] && p.result && p.result !== "P") out[k] = { week: w, line: p.line, side: p.side, result: p.result, actual: p.actual ?? null }; } }
    if (w === week - 1) {   // every player's number last week (no line needed), from the official stats the grading uses
      const st = await weekStats(season, w).catch(() => null);
      if (st && st.games) for (const box of Object.values(st.games)) for (const [nn, row] of Object.entries(box)) for (const stat of SHOWN_STATS) { const k = `${nn}|${stat}`; if (!out[k] && row && row[stat] != null) out[k] = { week: w, actual: Number(row[stat]) }; }
    }
  }
  return out;
}
export async function propsForWeek(redis, season, week, games) {
  const bands = await propCalibration(redis, season).catch(() => null);
  const res = await redis.hgetall(K_PROPRES(season, week)).catch(() => null) || {}, out = [], last = await lastWeekProps(redis, season, week, bands).catch(() => ({}));
  for (const g of games || []) {
    let picks;
    if (res[g.key]) { try { picks = (JSON.parse(res[g.key]).picks || []).filter(shownProp); } catch { picks = []; } }
    else { const model = await getJSON(K_PROPMODEL(season, week, g.key)).catch(() => null); if (!model || !model.rows) continue;
      picks = propPicks(model.rows, await getJSON(K_PROPS(season, week, g.key)).catch(() => null)).filter(shownProp).map((p) => ({ ...p, result: null })); }
    picks = onePerPlayer(picks, bands);
    if (!picks.length) continue;
    out.push({ game: g.key, away: g.away, home: g.home, kickoff: g.kickoff || null, final: !!g.final, started: !!g.started,
      picks: picks.map((p) => ({ name: p.name, team: p.team || null, stat: p.stat, side: p.side, line: p.line, chance: p.chance, cal: calibrate(p.chance, bands, famOf(p)), price: p.price ?? null, result: p.result || null, actual: p.actual ?? null, last: last[`${normName(p.name)}|${p.stat}`] || null })) });
  }
  return out;
}
// 10/23 (owner: "make sure everything is graded correctly"): EVERY graded prop line of a week (shown or only tracked) for the outside re-grade
// (`npm run verify`), and the final games whose props were scored but never graded
export async function propsGradedAll(redis, season, week, games) {
  const res = await redis.hgetall(K_PROPRES(season, week)).catch(() => null) || {}, graded = [], missing = [];
  for (const [game, v] of Object.entries(res)) { let d; try { d = JSON.parse(v); } catch { continue; } graded.push({ game, picks: (d.picks || []).map((p) => ({ name: p.name, stat: p.stat, side: p.side, line: p.line, actual: p.actual ?? null, played: p.played ?? null, result: p.result || null })) }); }
  for (const g of games || []) if (g.final && !res[g.key] && await getJSON(K_PROPMODEL(season, week, g.key)).catch(() => null)) missing.push(g.key);
  return { graded, missing };
}
// 10/23 (owner: "check all calibration"): the page's rows said 78.6% and won 75.2% (109 graded, weeks 6-7; the 80-90% rows said 84 won 72 on 36),
// so the shown % is calibrated like the NBA props (10/22): the model's % moved toward what its 5-point band really won on the page's graded rows,
// shrunk by CAL_K rows; no graded rows in a band -> the model's %. The ROWS are unchanged (chosen on the model's %, the 65 / 70% bars). Cached 3 h.
// 10/29 (owner: "make sure everything gets calibrated and graded correctly ... recheck all the other tabs calibration"): each stat + side FAMILY is
// calibrated on its own rows (bands = { "stat|side": { band: { n, said, won } } }), not pooled -- a family's misses no longer move another
// family's %. Walk-forward on the live rows (fit one week, judge the other): Brier 0.1397 / 0.1452 per family vs 0.1401 / 0.1461 pooled.
// The families the second model prices start from its Polymarket US 2026 weeks 1-7 test (PROP_CAL_SEED, the page's rules; it never saw 2026),
// so a new family's % is honest before its first graded game; the live rows add to them.
export const CAL_K = 100;
export const calBand = (c) => Math.min(95, Math.floor(c * 20 + 1e-9) * 5);
export const famOf = (p) => `${p.stat}|${p.side}`;
export const PROP_CAL_SEED = {   // family -> band -> [rows, said, won] (scratchpad us/propmodel.py rows = prop_model2.py's method)
  "rush_yds|under": { 75: [35, 0.7806, 0.8], 80: [48, 0.8244, 0.8542], 85: [28, 0.8661, 0.8214], 90: [1, 0.9018, 1] },
  "scrim_yds|under": { 70: [8, 0.7276, 0.625], 75: [12, 0.78, 0.75], 80: [7, 0.8264, 1], 85: [5, 0.8665, 1] },
  "rush_att|under": { 75: [5, 0.7881, 0.4], 80: [14, 0.8209, 0.9286], 85: [4, 0.8743, 1] },
  "pass_td|over": { 75: [8, 0.7731, 0.875], 80: [13, 0.8229, 0.6154], 85: [7, 0.8592, 0.8571] },
  "atd|under": { 75: [61, 0.7733, 0.7213], 80: [104, 0.8268, 0.7404], 85: [44, 0.8667, 0.8182], 90: [2, 0.9047, 1] },
};
export async function propCalibration(redis, season, now = Date.now(), fresh = false) {
  const ck = `propcal3:${season}`, old = fresh ? null : await getJSON(ck).catch(() => null);
  if (old && old.bands && now - Date.parse(old.t) < 3 * 3600e3) return old.bands;
  const weeks = new Set(); let c = "0";
  do { const [n, ks] = await redis.scan(c, "MATCH", `propres:${season}:*`, "COUNT", 200); c = n; for (const k of ks) weeks.add(Number(k.split(":")[2])); } while (c !== "0");
  const bands = {};
  for (const [fam, bs] of Object.entries(PROP_CAL_SEED)) for (const [band, [n, said, won]] of Object.entries(bs)) (bands[fam] = bands[fam] || {})[band] = { n, said: said * n, won: won * n };
  for (const w of weeks) { const h = await redis.hgetall(K_PROPRES(season, w)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let d; try { d = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer((d.picks || []).filter(shownProp))) { if (p.result !== "W" && p.result !== "L") continue;
        const F = (bands[famOf(p)] = bands[famOf(p)] || {}), b = (F[calBand(p.chance)] = F[calBand(p.chance)] || { n: 0, said: 0, won: 0 }); b.n++; b.said += p.chance; if (p.result === "W") b.won++; } } }
  for (const F of Object.values(bands)) for (const b of Object.values(F)) { b.said = b.said / b.n; b.won = b.won / b.n; }
  await setJSON(ck, { t: new Date(now).toISOString(), bands }).catch(() => {});
  return bands;
}
export function calibrate(chance, bands, fam) {
  const b = bands && fam && bands[fam] && bands[fam][calBand(chance)]; if (!b || !b.n) return chance;
  return Math.min(0.99, Math.max(0.01, chance + (b.won - b.said) * (b.n / (b.n + CAL_K))));
}
// W-L of the shown props this season (graded games)
export async function propsRecord(redis, season, weeks, stat = null) {   // 10/20: per stat for the Player props tabs (stat null = all; 10/28 night: or a list -- the Rush Yds tab = rushing + scrimmage yards)
  const rec = { w: 0, l: 0 }, bands = await propCalibration(redis, season).catch(() => null);
  for (const w of weeks) { const h = await redis.hgetall(K_PROPRES(season, w)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let d; try { d = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer((d.picks || []).filter(shownProp), bands)) { if (stat && !(Array.isArray(stat) ? stat.includes(p.stat) : p.stat === stat)) continue; if (p.result === "W") rec.w++; else if (p.result === "L") rec.l++; } } }   // the same rows the page shows
  return { ...rec, pct: rec.w + rec.l ? Math.round((rec.w / (rec.w + rec.l)) * 1000) / 10 : null };
}
// The lines the rerun sends the model: every recorded Polymarket line of the shown stats for one game
export async function propLinesFor(season, week, gameKey) {
  const saved = await getJSON(K_PROPS(season, week, gameKey)).catch(() => null);
  return propRows(saved).filter((r) => SHOWN_STATS.has(r.stat)).map((r) => ({ name: r.name, stat: r.stat, line: r.line }));
}

// 10/21 night (owner: "Yes build for nfl also ... We need to get these graded and picked"): the NFL Player props parlays (6 / 8 / 10 legs, $5) take
// their legs from the page's rows -- shown families at the 65% bar (62% until 10/22), priced under 77c and under the % (onePerPlayer), priced only -- of every game
// not started yet, ONE leg per player (his highest %), the strongest first. Built in lib/paper.js propParlays, saved with the week's paper.
export async function propLegsForWeek(season, week, games, now = Date.now()) {
  const legs = [], bands = await propCalibration(getRedis(), season, now).catch(() => null);   // 10/23: each leg carries its calibrated % (the parlay chance uses it)
  for (const g of games || []) {
    if (!g || g.started || g.final || !(Date.parse(g.kickoff) > now)) continue;
    const model = await getJSON(K_PROPMODEL(season, week, g.key)).catch(() => null); if (!model || !model.rows) continue;
    const picks = onePerPlayer(propPicks(model.rows, await getJSON(K_PROPS(season, week, g.key)).catch(() => null)).filter(shownProp), bands);
    for (const p of picks) if (p.price > 0 && p.price < 1) legs.push({ ...p, game: g.key, kickoff: g.kickoff });
  }
  const best = new Map(); for (const p of legs) { const k = normName(p.name), o = best.get(k); if (!o || p.chance > o.chance) best.set(k, p); }
  return [...best.values()].map((p) => ({ ...p, cal: calibrate(p.chance, bands, famOf(p)) })).sort((a, b) => b.chance - a.chance);
}
// one prop leg from the game's official stats (the same rule as gradePropsGame: a player missing from the posted stats did not play = 0)
// a parlay's prop leg: the same rule (no snap = push, no touch before snap counts post = wait)
export function gradePropLeg(l, box, snaps = null) {
  if (!box) return null;
  const o = propOutcome(l, box, snaps); return o ? { actual: o.actual, result: o.result } : null;
}
