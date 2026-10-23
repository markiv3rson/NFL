// NBA player props (10/20, owner: "find everything that works" -> the recorder; 10/20 night, owner: "Player props" page, both sports, bar 62%+).
//  - recordNbaProps: every slate build saves each Polymarket US prop line of a not-started game (points, rebounds, assists, PRA, threes, steals,
//    blocks as "N+" ladders = Over N-0.5), first price next to the latest. Key `nbaprops:<ET date>:<AWAY @ HOME>` = { first, t, m: { "name|stat|line":
//    [overAsk, overBid, underAsk, firstOverAsk, firstTime] } }.
//  - scoreNbaProps (the 30-min snapshot): the NBA service's prop model (/prop-probs, nba_prop_model.py) gives both sides of every recorded line, with
//    the day's Out / Doubtful list; saved as `nbapropmodel:<date>:<game>` -- a started game is never re-scored, so the last copy before tip-off is the
//    locked one (same rule as the NFL props).
//  - A ROW on the page = the side the model gives NBA_PROP_BAR (65% since 10/21; was 62%) or more; one row per player and stat (the highest %, priced under its % and
//    under MAX_PRICE = 77c, owner 10/20; since 10/21 a row needs a price). Every scored side at the bar is graded, shown or not.
//  - gradeNbaProps: once ESPN says the game is final, every pick at the bar is graded from ESPN's box score (nba/lib/espn.js boxFor); a player who did
//    not play is a push (not counted). Saved in `nbapropres:<date>` (one field per game). The RECORD tile per stat counts the page's rows.
//  HONEST NUMBERS (10/17 research + 10/20 check on last season's real Polymarket lines, the model's 62%+ sides): rebounds Over 62.9% (132-78),
//  rebounds Under 59.5%, points Over 58.5%, points Under 55.0%, assists Over 58.0%, assists Under 56.6%; the 62-65 band alone 51-63%. The model's
//  % runs 7-12 points hot against the NBA market; the live record per stat is the truth. PRA / threes / steals / blocks have no real-line test yet.
import { getRedis, getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";
import { boxFor } from "./espn";
import { etDate } from "./poly";

const STAT = { basketball_player_points: "pts", basketball_player_rebounds: "reb", basketball_player_assists: "ast", basketball_player_threes: "3pm",
  basketball_player_steals: "stl", basketball_player_blocks: "blk", basketball_player_pra: "pra", basketball_player_points_rebounds_assists: "pra",
  basketball_player_points_assists_rebounds: "pra", basketball_player_pts_reb_ast: "pra" };
// 10/21 (owner: "Anything below 65 gets cut" -> option B, NBA only): opening night the 62-64% rows went 6-6 while 65%+ went 114-30, and last
// season's real lines had the 62-65 band at 51-63%. Rows saved under the old 62% bar drop out of the page and the record (onePerPlayer).
export const NBA_PROP_BAR = 0.65;
export const MAX_PRICE = 0.77;   // 10/20 (owner: "cut 77+"): a row priced 77c or more is not shown and not counted (both sports)
export const NBA_STATS = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["pra", "PRA"], ["3pm", "Threes"], ["stl", "Steals"], ["blk", "Blocks"]];
const q = (x) => { const v = Number(x && typeof x === "object" ? x.value : x); return v > 0 && v < 1 ? Math.round(v * 1000) / 1000 : null; };
export const K_NBAPROPS = (date, key) => `nbaprops:${date}:${key}`;
export const K_NBAPROPMODEL = (date, key) => `nbapropmodel:${date}:${key}`;
export const K_NBAPROPRES = (date) => `nbapropres:${date}`;
export const nbaPropName = (m) => String((m && (m.title || m.titleShort)) || "").replace(/\s+\d+\+\s.*$/, "").trim();
export const normName = (n) => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()   // 10/21: accents folded (Jokić = Jokic), not dropped
  .replace(/-/g, " ").replace(/[^a-z ]/g, "").split(/\s+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w)).join(" ");
export function nbaPropsFromEvent(ev) {
  const out = [];
  for (const m of (ev && (ev.rawProps || ev.markets)) || []) {
    const stat = STAT[String(m.sportsMarketType || "")]; if (!stat || m.closed || m.active === false) continue;
    const n = Number(m.line), name = nbaPropName(m); if (!isFinite(n) || !name) continue;
    const ask = q(m.bestAskQuote), bid = q(m.bestBidQuote);
    out.push({ name, stat, line: n - 0.5, oa: ask, ob: bid, ua: bid != null ? Math.round((1 - bid) * 1000) / 1000 : null });
  }
  return out;
}
export async function recordNbaProps(date, key, rows, t) {
  if (!rows || !rows.length || !date || !key) return 0;
  const k = K_NBAPROPS(date, key), old = (await getJSON(k)) || { first: t, m: {} }, m = { ...(old.m || {}) };
  for (const r of rows) { const f = `${r.name}|${r.stat}|${r.line}`, o = m[f]; m[f] = [r.oa, r.ob, r.ua, o ? o[3] : r.oa, o ? o[4] : t]; }
  await setJSON(k, { first: old.first || t, t, m });
  return rows.length;
}
export function nbaPropRows(saved) {
  if (!saved || !saved.m) return [];
  return Object.entries(saved.m).map(([k, v]) => { const [name, stat, line] = k.split("|"); return { name, stat, line: Number(line), oa: v[0], ob: v[1], ua: v[2], oa0: v[3], t0: v[4] }; });
}
// The side the model likes more, when it reaches the bar: { name, team, stat, line, side, chance, mu, price, band }
export const bandOf = (p) => (p >= 0.9 ? "90-100" : p >= 0.8 ? "80-90" : p >= 0.7 ? "70-80" : p >= NBA_PROP_BAR ? "65-70" : null);
export function nbaPropPicks(modelRows, saved, bar = NBA_PROP_BAR) {
  const px = new Map(nbaPropRows(saved).map((r) => [`${r.name}|${r.stat}|${r.line}`, r])), out = [];
  for (const r of modelRows || []) {
    const side = r.over >= r.under ? "over" : "under", chance = side === "over" ? r.over : r.under; if (!(chance >= bar)) continue;
    if (!r.team) continue;   // 10/20 night (owner screenshot): Polymarket listed other games' players (Paul George under BOS @ DET); the model answers team null for a player not on either team -> not a row
    const p = px.get(`${r.name}|${r.stat}|${r.line}`) || {};
    out.push({ name: r.name, team: r.team, stat: r.stat, line: r.line, side, chance, mu: r.mu, band: bandOf(chance), price: side === "over" ? p.oa ?? null : p.ua ?? null, ...(r.tsp != null ? { tsp: r.tsp } : {}) });
  }
  return out;
}
// One row per player and stat: priced under its win % and under MAX_PRICE, the highest %.
// 10/21 recheck: a row needs a real Polymarket price (nobody selling = not a bet). Unpriced deep rungs of the "N+" ladders (Tatum PRA Under 54.5 98.5%)
// pushed the player's priced line off the page and padded the record: opening night 114-30 = 79.2%, of which unpriced 43-4 and priced 71-26 (73.2%).
// 10/22 night (owner: "cut the two"): no row priced under MIN_PRICE (60c: the market disagrees -- live 50-60c said 72.8 won 64.8%, last season's real lines ~54%)
// and no rebounds Under (live 28-18 = 60.9%, real lines 59.0%; still 24-15 at 60c+). Both stay saved and graded in the background.
export const MIN_PRICE = 0.60;
// 10/23 (owner: "delete all the nba unders"): Polymarket US marks the No side of every NBA player prop "not tradable" (464 of 464 on 10/23), so an
// Under cannot be bought -- no NBA Under row is shown, counted or used as a parlay leg; the Unders are still saved and graded in the background
export const CUT_SIDES = new Set(["reb|under"]);
export const CUT_UNDERS = true;
// 10/23 (owner: "fix the overs if it runs high ... so we're accurate"): an Over's % = OVER_W x the model + (1 - OVER_W) x Polymarket's price. The model
// alone ran hot on Overs (live 10/20-21 said 74.7, won 65.8% of 114; last season's real lines said 74.3, won 68.8% of 138). On 8,041 real Polymarket Over
// lines 2025-26 the blend that predicts best is 0.3-0.4 model (log loss 0.7013 model alone, 0.6904 price alone, 0.6860 at 0.4; best in both halves of the
// season); the page's rows on the blend said 70.5 and won 71.6% (81). The 65% bar, the "priced under its %" rule, the order, the RECORD tiles, the
// calibration bands and the parlay legs all use it; the saved pick keeps the model's own % (`model`), so grading is unchanged.
export const OVER_W = 0.4;
// 10/23 research (owner: "find winning edges" on the Overs): an Over by a player whose team is a 2.5+ point underdog is not a row. Last season's real
// Polymarket Over lines (one per player + stat, 45-77c): team +2.5 or more won 47.4% of 2,300 at 54c = -11.9 per $100 (Jan -9.6, Feb -16.1, Mar -8.1,
// Apr -17.7; +3 to +6 -12.8, +6 to +10 -18.6, +10 or more -10.0), everyone else 52.7% of 4,007 (-2.1); the market prices both at 54c. The page's rows:
// 78.7% (47) without them vs 61.8% (34) with them. Live 10/20-21: 30-17 (63.8%, -5.7) vs 45-22 (67.2%, -1.2). `tsp` = the team's spread, saved with the
// scored rows (Polymarket's main line at scoring time); rows saved before 10/23 have none and are not cut.
export const DOG_CUT = 2.5;
export const effChance = (p) => (p.side === "over" && p.price > 0 && p.price < 1 ? OVER_W * p.chance + (1 - OVER_W) * p.price : p.chance);
export function onePerPlayer(picks) {
  const priced = (p) => p.price > 0 && p.price < 1, best = new Map();
  for (const p0 of picks) {
    if (!priced(p0)) continue;
    const p = { ...p0, model: p0.chance, chance: Math.round(effChance(p0) * 10000) / 10000 };
    if (!(p.chance >= NBA_PROP_BAR)) continue;   // a row saved under an older, lower bar
    if (!priced(p) || p.price >= p.chance || p.price >= MAX_PRICE || p.price < MIN_PRICE) continue;
    if (CUT_SIDES.has(`${p.stat}|${p.side}`) || (CUT_UNDERS && p.side === "under")) continue;
    if (p.side === "over" && typeof p.tsp === "number" && p.tsp >= DOG_CUT) continue;
    const k = `${normName(p.name)}|${p.stat}`, o = best.get(k);
    if (!o || p.chance > o.chance) best.set(k, p);
  }
  return [...best.values()].sort((a, b) => b.chance - a.chance);
}
// 10/21 shadow (owner): a 20+ points-a-game player listed Out / Doubtful -> his team's other players' points Overs are tracked (the 10/17 research blind
// spot: teammates beat the model's points every season 2023-26). Saved with the locked model copy, graded with the game, never a row or a pick.
export const STAR_PPG = 20;
export function starsOut(g, injuries = null) {
  const out = [];
  for (const side of ["away", "home"]) { const list = injuries ? (injuries[side] || (injuries[g.key] || {})[side]) : g.injuries && g.injuries[side];
    for (const x of list || []) if ((Number(x && x.ppg) || 0) >= STAR_PPG && /^(out|doubtful)/i.test(String(x.status || ""))) out.push({ team: g[side], name: x.name, ppg: Number(x.ppg) }); }
  return out;
}
const outsOf = (list, re = /^(out|doubtful)/i) => (list || []).filter((x) => re.test(String(x && x.status || ""))).map((x) => x.name).filter(Boolean);
const QUEST = /^questionable/i;   // 10/21: sent too -- 45.5% of Questionable players sit (official reports 2021-26), the service counts them that much as teammates out
// Ask the NBA service for every recorded line of each not-started game in the record window and save the answer (the snapshot's step).
// the game's main spread for the home team (+ = home underdog): Polymarket's main line, else the sportsbooks'
const homeSpreadOf = (g) => { const v = g && ((g.poly && g.poly.spread && g.poly.spread.homeSpread) ?? (g.books && g.books.spread && g.books.spread.homeSpread)); return typeof v === "number" && isFinite(v) ? v : null; };
export async function scoreNbaProps(games, { now = Date.now(), injuries = null, post = null } = {}) {
  const base = modelBase(); if (!base) return { scored: 0, error: "NBA_MODEL_SERVICE_URL not set" };
  const todo = [];
  for (const g of games || []) {
    if (!g || !g.key || !g.date || !(Date.parse(g.start) > now)) continue;
    const lines = nbaPropRows(await getJSON(K_NBAPROPS(g.date, g.key)).catch(() => null)).map((r) => ({ name: r.name, stat: r.stat, line: r.line }));
    if (!lines.length) continue;
    const lists = injuries ? [injuries.away || (injuries[g.key] || {}).away, injuries.home || (injuries[g.key] || {}).home] : [g.injuries && g.injuries.away, g.injuries && g.injuries.home];
    const inj = lists.flatMap((l) => outsOf(l)), quest = lists.flatMap((l) => outsOf(l, QUEST));
    todo.push({ g, body: { away: g.away, home: g.home, outs: inj, quest, lines }, star: starsOut(g, injuries) });
  }
  if (!todo.length) return { scored: 0 };
  const send = post || (async (body) => { const r = await fetch(`${base}/prop-probs`, { method: "POST", headers: modelHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(25000) }); return r.json().catch(() => null); });
  const j = await send({ games: todo.map((t) => t.body) });
  if (!j || !j.ok) return { scored: 0, building: !!(j && j.building), error: (j && j.error) || "no reply" };
  const runAt = new Date(now).toISOString(); let n = 0;
  for (const r of j.results || []) { const t = todo.find((x) => x.g.key === r.game); if (!t || !Array.isArray(r.rows)) continue;
    const hs = homeSpreadOf(t.g), rows = r.rows.map((x) => ({ ...x, tsp: hs == null || !x.team ? null : x.team === t.g.home ? hs : -hs }));   // 10/23: the player's team spread (+ = underdog)
    await setJSON(K_NBAPROPMODEL(t.g.date, t.g.key), { runAt, start: t.g.start, away: t.g.away, home: t.g.home, hs, rows, ...(t.star.length ? { star: t.star } : {}) }); n++; }
  return { scored: n, built: j.built || null };
}
async function scanKeys(pattern) {
  const r = getRedis(), ks = []; let c = "0";
  do { const [n, kk] = await r.scan(c, "MATCH", pattern, "COUNT", 200); c = n; ks.push(...kk); } while (c !== "0");
  return ks;
}
export async function nbaPropDays() { return [...new Set((await scanKeys("nbapropmodel:*")).map((k) => k.split(":")[1]))].sort(); }
// Grade the picks of every game ESPN says is final on the given dates (default: the last 3 Eastern days). A DNP is a push.
export const RECHECK_H = 6;
export const gradeProp = (p, b) => { const s = b.players[normName(p.name)], v = s ? Number(s[p.stat] ?? 0) : null;
  return { actual: v, played: !!s, result: v == null ? "P" : (p.side === "over" ? v > p.line : v < p.line) ? "W" : "L" }; };
export async function gradeNbaProps({ dates = null, now = Date.now(), fetchBox = boxFor } = {}) {
  const r = getRedis(), today = etDate(new Date(now).toISOString());
  const days = dates || (await nbaPropDays()).filter((d) => d <= today && Date.parse(today) - Date.parse(d) <= 3 * 86400e3);
  let n = 0;
  for (const d of days) {
    const keys = (await scanKeys(`nbapropmodel:${d}:*`)).map((k) => k.slice(`nbapropmodel:${d}:`.length)), rk = K_NBAPROPRES(d);
    const done = await r.hgetall(rk).catch(() => ({})) || {}, left = keys.filter((k) => !done[k]);
    // 10/21 review: ESPN corrects box scores after the final (OKC @ SAS 10/20: J.McCain 3 -> 2 rebounds, A.Caruso 7 -> 6 rebounds / 2 -> 1 steals,
    // which flipped a graded Under 2.5 from L to W) -- a graded game is looked at ONCE more, 6+ hours after its grade, and its saved rows re-graded.
    const again = keys.filter((k) => { if (!done[k]) return false; let x; try { x = JSON.parse(done[k]); } catch { return false; } return !x.rechecked && now - Date.parse(x.t || 0) >= RECHECK_H * 3600e3; });
    if (!left.length && !again.length) continue;
    let box; try { box = await fetchBox(d); } catch { continue; }
    for (const key of again) {
      const b = box && box[key]; if (!b || !b.final) continue;
      let rec; try { rec = JSON.parse(done[key]); } catch { continue; }
      let changed = 0;
      const picks = (rec.picks || []).map((p) => { const g = gradeProp(p, b); if (g.actual !== p.actual || g.result !== p.result) changed++; return { ...p, ...g }; });
      await r.hset(rk, key, JSON.stringify({ ...rec, picks, rechecked: new Date(now).toISOString(), ...(changed ? { fixed: changed } : {}) })); if (changed) n++;
    }
    for (const key of left) {
      const b = box && box[key]; if (!b || !b.final) continue;
      const model = await getJSON(K_NBAPROPMODEL(d, key)).catch(() => null); if (!model || !model.rows) continue;
      const saved = await getJSON(K_NBAPROPS(d, key)).catch(() => null);
      const picks = nbaPropPicks(model.rows, saved).map((p) => ({ ...p, ...gradeProp(p, b) }));
      const star = starRows(model, saved).map((p) => ({ ...p, ...gradeProp(p, b) }));
      await r.hset(rk, key, JSON.stringify({ t: new Date(now).toISOString(), runAt: model.runAt || null, picks, ...(star.length ? { star } : {}) })); n++;
    }
  }
  return n;
}
// The page: one day's games with their rows (every stat; the page filters by its tab), ✓ / ✗ once graded.
// 10/20 night (owner): a player's most recent graded prop of the same stat before this day (line, side, ✓ / ✗, the real number)
export async function lastNbaProps(date, days = null) {
  const r = getRedis(), out = {}, all = (days || await nbaPropDays()).filter((d) => d < date).sort().reverse().slice(0, 10);
  for (const d of all) { const h = await r.hgetall(K_NBAPROPRES(d)).catch(() => null) || {};
    for (const v of Object.values(h)) { let rec; try { rec = JSON.parse(v); } catch { continue; }
      // 10/21: the row the page SHOWED that day (onePerPlayer, as nbaPropsForDay / nbaPropsRecord), not the first graded line of the ladder
      for (const p of onePerPlayer(rec.picks || [])) { const k = `${p.name}|${p.stat}`; if (!out[k] && p.result && p.result !== "P") out[k] = { date: d, line: p.line, side: p.side, result: p.result, actual: p.actual ?? null }; } } }
  return out;
}
// 10/22 (owner: the NBA props page % = the calibrated chance): each row carries `cal` = its model % moved toward what its 5-point band really won on
// the graded rows (propCalibration, CAL_K 100) -- the same number the prop parlay legs use. The ROWS are unchanged (chosen on the model's %, the 65% bar).
// Walk-forward 10/21 rows calibrated from 10/20's: Brier 0.2119 raw -> 0.2112 (the model said 76.5, the rows won 70.1).
export async function nbaPropsForDay(date, now = Date.now()) {
  const r = getRedis(), res = await r.hgetall(K_NBAPROPRES(date)).catch(() => null) || {}, out = [], last = await lastNbaProps(date).catch(() => ({}));
  const bands = await propCalibration(now).catch(() => null);
  for (const k of await scanKeys(`nbapropmodel:${date}:*`)) {
    const key = k.slice(`nbapropmodel:${date}:`.length), model = await getJSON(k).catch(() => null); if (!model) continue;
    let picks;
    if (res[key]) { try { picks = JSON.parse(res[key]).picks || []; } catch { picks = []; } }
    else picks = nbaPropPicks(model.rows, await getJSON(K_NBAPROPS(date, key)).catch(() => null)).map((p) => ({ ...p, result: null }));
    picks = onePerPlayer(picks); if (!picks.length) continue;
    out.push({ game: key, away: model.away, home: model.home, start: model.start || null, final: !!res[key],
      picks: picks.map((p) => ({ name: p.name, team: p.team || null, stat: p.stat, side: p.side, line: p.line, chance: p.chance, cal: calibrate(p.chance, bands), price: p.price ?? null, result: p.result || null, actual: p.actual ?? null, last: last[`${p.name}|${p.stat}`] || null })) });
  }
  return out.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
}
// 10/23 (owner: "make sure everything is graded correctly"): EVERY graded prop row of a day (shown or only tracked) for the outside re-grade,
// and the games scored that day that never got graded
export async function nbaPropsGradedAll(date) {
  const r = getRedis(), res = await r.hgetall(K_NBAPROPRES(date)).catch(() => null) || {}, graded = [], missing = [];
  for (const [game, v] of Object.entries(res)) { let d; try { d = JSON.parse(v); } catch { continue; } graded.push({ game, picks: (d.picks || []).map((p) => ({ name: p.name, stat: p.stat, side: p.side, line: p.line, actual: p.actual ?? null, result: p.result || null })) }); }
  for (const k of await scanKeys(`nbapropmodel:${date}:*`)) { const key = k.slice(`nbapropmodel:${date}:`.length); if (!res[key]) missing.push(key); }
  return { graded, missing };
}
// W-L per stat (and all) of the page's rows over the graded days
export async function nbaPropsRecord(dates) {
  const r = getRedis(), rec = { all: { w: 0, l: 0 } }; for (const [s] of NBA_STATS) rec[s] = { w: 0, l: 0 };
  for (const d of dates) { const h = await r.hgetall(K_NBAPROPRES(d)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let x; try { x = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer(x.picks || [])) { if (p.result !== "W" && p.result !== "L") continue; const k = p.result === "W" ? "w" : "l"; rec.all[k]++; if (rec[p.stat]) rec[p.stat][k]++; } } }
  for (const k of Object.keys(rec)) rec[k].pct = rec[k].w + rec[k].l ? Math.round((rec[k].w / (rec[k].w + rec[k].l)) * 1000) / 10 : null;
  return rec;
}

// The star-out shadow's rows of one game: each teammate's points Over at the line Polymarket priced nearest 50c (the main line of his ladder).
export function starRows(model, saved) {
  const stars = (model && model.star) || []; if (!stars.length) return [];
  const px = nbaPropRows(saved).filter((r) => r.stat === "pts" && r.oa > 0 && r.oa < 1), out = [];
  for (const s of stars) {
    const names = new Set((model.rows || []).filter((r) => r.team === s.team && r.stat === "pts" && normName(r.name) !== normName(s.name)).map((r) => r.name));
    for (const name of names) { const ls = px.filter((r) => r.name === name).sort((a, b) => Math.abs(a.oa - 0.5) - Math.abs(b.oa - 0.5)); if (!ls.length) continue;
      const m = (model.rows || []).find((r) => r.name === name && r.stat === "pts" && r.line === ls[0].line);
      out.push({ name, team: s.team, stat: "pts", side: "over", line: ls[0].line, price: ls[0].oa, chance: m ? m.over : null, star: s.name }); }
  }
  return out;
}
// 10/21 shadow trackers for the NBA Models page (owner): rows the page hides because they cost 77c+ (at the bar, one per player + stat, the highest %),
// and the star-out teammates' points Overs. W-L over every graded day; never rows, picks or parlay legs.
export async function propShadows(dates) {
  const r = getRedis(), dear = { w: 0, l: 0 }, star = { w: 0, l: 0 }, add = (e, x) => { if (x === "W") e.w++; else if (x === "L") e.l++; };
  for (const d of dates || []) { const h = await r.hgetall(K_NBAPROPRES(d)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let x; try { x = JSON.parse(v); } catch { continue; }
      const best = new Map();
      for (const p of x.picks || []) { if (!(p.chance >= NBA_PROP_BAR) || !(p.price >= MAX_PRICE && p.price < 1)) continue; const k = `${normName(p.name)}|${p.stat}`, o = best.get(k); if (!o || p.chance > o.chance) best.set(k, p); }
      for (const p of best.values()) add(dear, p.result);
      for (const p of x.star || []) add(star, p.result); } }
  for (const e of [dear, star]) e.pct = e.w + e.l ? Math.round((e.w / (e.w + e.l)) * 1000) / 10 : null;
  return { dear, star };
}
// 10/21 (owner: "6 legs 8 legs and 10 legs ... name it Props Parlays", $5 each): the day's prop rows (the page's rows at the 65% bar, priced under 77c),
// one leg per player (his highest %), the strongest first; 6 / 8 / 10 legs when the day has that many. Built in nba/lib/parlays.js.
// 10/22 (owner: "whatever the model thinks best. Run it through our calibration"): the live record of the page's prop rows (one per player + stat,
// graded W / L) by the model's % in 5-point bands; a parlay leg's chance moves toward what its band really won, shrunk by CAL_K graded rows
// (no graded rows in its band -> the model's own %). The card's spread / total % (history tables) and the moneyline % (the market's own chance,
// calibrated on 22,003 games) are already calibrated, so only prop legs go through this. Cached 3 h.
export const CAL_K = 100;
export const calBand = (c) => Math.min(95, Math.floor(c * 20 + 1e-9) * 5);
export async function propCalibration(now = Date.now(), fresh = false) {
  const r = getRedis(), old = fresh ? null : await getJSON("nbapropcal").catch(() => null);
  if (old && old.bands && now - Date.parse(old.t) < 3 * 3600e3) return old.bands;
  const bands = {};
  for (const d of await nbaPropDays()) { const h = await r.hgetall(K_NBAPROPRES(d)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let x; try { x = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer(x.picks || [])) { if (p.result !== "W" && p.result !== "L") continue; const b = (bands[calBand(p.chance)] = bands[calBand(p.chance)] || { n: 0, said: 0, won: 0 });
        b.n++; b.said += p.chance; if (p.result === "W") b.won++; } } }
  for (const b of Object.values(bands)) { b.said = b.said / b.n; b.won = b.won / b.n; }
  await setJSON("nbapropcal", { t: new Date(now).toISOString(), bands }).catch(() => {});
  return bands;
}
export function calibrate(chance, bands) {
  const b = bands && bands[calBand(chance)]; if (!b || !b.n) return chance;
  return Math.min(0.99, Math.max(0.01, chance + (b.won - b.said) * (b.n / (b.n + CAL_K))));
}
export async function propLegsForDay(date, games, now = Date.now()) {
  const legs = [];
  for (const g of games || []) {
    if (!g || g.date !== date || !(Date.parse(g.start) > now)) continue;
    const model = await getJSON(K_NBAPROPMODEL(date, g.key)).catch(() => null); if (!model || !model.rows) continue;
    for (const p of onePerPlayer(nbaPropPicks(model.rows, await getJSON(K_NBAPROPS(date, g.key)).catch(() => null)))) if (p.price > 0 && p.price < 1) legs.push({ ...p, game: g.key, start: g.start });
  }
  const best = new Map(); for (const p of legs) { const k = normName(p.name), o = best.get(k); if (!o || p.chance > o.chance) best.set(k, p); }
  const bands = legs.length ? await propCalibration(now).catch(() => null) : null;
  return [...best.values()].map((p) => ({ ...p, cal: calibrate(p.chance, bands) })).sort((a, b) => b.cal - a.cal);
}
