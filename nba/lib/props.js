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
export const NBA_PROP_BAR = 0.70;   // 10/29 (owner's table): 70%+ (was 65)
export const MAX_PRICE = 0.82;   // 10/29 (owner: "set the player props cap to 82"; 10/20 it was "cut 77+"): a row priced 82c or more is not shown and not counted (both sports)
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
// 10/23 night (owner: "build things that will help"): threes Overs off too -- live under the page's rules 5-5 at 72c (-28.8 per $100; the rows shown
// went 1-4), and last season's real lines carry no threes market to test them on (every other stat is up live or on real lines in both halves)
export const CUT_SIDES = new Set(["reb|under", "3pm|over"]);
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
// 10/23 night (rule 7 hunt): an NBA row must be priced at least MIN_GAP under its shown % (calibrated, else the blend). Rows barely under it lose:
// last season's real Polymarket Over lines under the page's rules, gap under 2 points 18 rows won 61.1% at 67c (-9.9 per $100), 2+ points 63 rows
// won 74.6% at 64c (+16.5); live graded rows 10/20-22 (threes out) under 2 points 21-9 (+0.9), 2+ 30-12 (+8.0), 3+ 22-7 (+15.3). NFL rows show no
// such effect (weeks 6-7 under 2 points 8-3, under 4 points 23-5), so NFL keeps "priced under its %".
export const MIN_GAP = 0.02;
// PRA is left out: it has no real-line market to test on and its live rows priced within 2 points went 11-0 (points 4-7, the rest 6-2).
export const GAP_FREE = new Set(["pra"]);
// 10/27 night (research): Polymarket underprices PRA. Live graded PRA Overs on real books (two-sided, ask - bid 5c or less) 10/20-26: priced 65.4c, won
// 78.7% of 357, the model said 78.2%; the best weight day by day (each day fit on the days before) 0.8, Brier 0.1784 at 0.4 -> 0.1701 (points / rebounds /
// assists / steals stay at 0.4: their gain is 0.002 or less, points worse). So a PRA Over's % = 0.8 x the model + 0.2 x the price.
export const OVER_W_STAT = { pra: 0.8 };
const overW = (stat) => OVER_W_STAT[stat] ?? OVER_W;
export const effChance = (p) => (p.side === "over" && p.price > 0 && p.price < 1 ? overW(p.stat) * p.chance + (1 - overW(p.stat)) * p.price : p.chance);
// 10/23 (owner: "check all calibration and wording and numbering"): with the calibration bands passed in, a row must ALSO be priced under its
// calibrated % (the number the page shows), so no row reads a % under its own price. Live graded rows 10/20-22: calibrated % over the price 52-25
// (67.5%, +0.2 per $100), at or under it 27-16 (62.8%, -12.2). The bands themselves are fit on the rows without this test (propCalibration).
export function onePerPlayer(picks, bands = null) {
  const priced = (p) => p.price > 0 && p.price < 1, best = new Map();
  for (const p0 of picks) {
    if (!priced(p0)) continue;
    const p = { ...p0, model: p0.chance, chance: Math.round(effChance(p0) * 10000) / 10000 };
    if (!(p.chance >= NBA_PROP_BAR)) continue;   // a row saved under an older, lower bar
    if (!priced(p) || p.price >= p.chance || p.price >= MAX_PRICE || p.price < MIN_PRICE) continue;
    if (CUT_SIDES.has(`${p.stat}|${p.side}`) || (CUT_UNDERS && p.side === "under")) continue;
    if (p.side === "over" && typeof p.tsp === "number" && p.tsp >= DOG_CUT) continue;
    if (bands) p.cal = calibrate(p.chance, bands);
    if (p.cal != null && p.cal < NBA_PROP_BAR - 1e-9) continue;   // 10/29 night recheck (the NFL fix): the bar is met on the shown, calibrated % too
    if (!GAP_FREE.has(p.stat) && p.price > (p.cal ?? p.chance) - MIN_GAP + 1e-9) continue;   // 10/23 night: priced at least 2 points under the shown %
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
export const CHUNK = 3;   // games per request to the service
export async function scoreNbaProps(games, { now = Date.now(), injuries = null, post = null, retryMs = 3000, budgetMs = 85e3 } = {}) {
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
  // 10/23 (owner): the service missed a round twice in two days (a 25-s timeout, an empty reply) -- a miss is asked once more a few
  // seconds later instead of waiting for the next 30-min snapshot; "building" (the prop model is being refit) is not asked again.
  // 10/23 recheck: the 3:30 PM PT round timed out on BOTH tries -- 20 games (tonight + tomorrow) went in ONE request and the service could not
  // answer in 25 s. Games go nearest tip-off first, CHUNK at a time, each group with its own retry, inside a time budget (the snapshot has
  // 120 s), so a slow reply costs only its own games and the next tip-offs are always scored first.
  todo.sort((a, b) => String(a.g.start).localeCompare(String(b.g.start)));
  const t0 = Date.now(), left = () => budgetMs - (Date.now() - t0);
  const runAt = new Date(now).toISOString(); let n = 0, retried = false, built = null, building = false, failed = 0, groups = 0, err = null;
  for (let i = 0; i < todo.length; i += CHUNK) {
    if (groups && left() < 30e3) { failed++; err = err || "time budget used up"; continue; }
    const part = todo.slice(i, i + CHUNK), body = { games: part.map((t) => t.body) }; groups++;
    const once = async () => { try { return await send(body); } catch (e) { return { ok: false, error: String((e && e.name) || "Error") + ": " + String((e && e.message) || e).slice(0, 120) }; } };
    let j = await once();
    if (!(j && j.ok) && !(j && j.building) && left() > 30e3) { retried = true; if (retryMs > 0) await new Promise((r) => setTimeout(r, retryMs)); const j2 = await once(); if ((j2 && j2.ok) || !(j && j.error)) j = j2; }
    if (j && j.building) { building = true; err = err || (j.error || "building"); failed += Math.ceil((todo.length - i) / CHUNK); break; }
    if (!j || !j.ok) { failed++; err = err || (j && j.error) || "no reply"; continue; }
    built = built || j.built || null;
    for (const r of j.results || []) { const t = part.find((x) => x.g.key === r.game); if (!t || !Array.isArray(r.rows)) continue;
      const hs = homeSpreadOf(t.g), rows = r.rows.map((x) => ({ ...x, tsp: hs == null || !x.team ? null : x.team === t.g.home ? hs : -hs }));   // 10/23: the player's team spread (+ = underdog)
      await setJSON(K_NBAPROPMODEL(t.g.date, t.g.key), { runAt, start: t.g.start, away: t.g.away, home: t.g.home, hs, rows, ...(t.star.length ? { star: t.star } : {}) }); n++; }
  }
  const total = Math.ceil(todo.length / CHUNK), extra = retried ? { retried: true } : {};
  if (!n && failed) return { scored: 0, ...extra, building, error: total > 1 ? `${failed} of ${total} groups: ${err}` : err };
  return { scored: n, built, ...extra, ...(failed ? { error: `${failed} of ${total} groups: ${err}` } : {}) };
}
async function scanKeys(pattern) {
  const r = getRedis(), ks = []; let c = "0";
  do { const [n, kk] = await r.scan(c, "MATCH", pattern, "COUNT", 200); c = n; ks.push(...kk); } while (c !== "0");
  return ks;
}
export async function nbaPropDays() { return [...new Set((await scanKeys("nbapropmodel:*")).map((k) => k.split(":")[1]))].sort(); }
// 10/28: the NBA database (free plan) filled up with prop copies (~0.7 MB a game day, none expired). Once a day is fully graded and past the re-check
// window, its model copies shrink to the game's names / time (the day list and the page still read them; the graded rows in nbapropres keep every
// result) and its raw price ladders (nbaprops:) go -- the nightly backup on the Railway volume keeps them.
export const COMPACT_DAYS = 8;   // RECHECK_DAYS (7) + 1
export async function compactNbaProps(now = Date.now()) {
  const r = getRedis(), today = etDate(new Date(now).toISOString()); let n = 0;
  for (const d of await nbaPropDays()) {
    if (Date.parse(today) - Date.parse(d) <= COMPACT_DAYS * 86400e3) continue;
    const keys = await scanKeys(`nbapropmodel:${d}:*`), done = (await r.hgetall(K_NBAPROPRES(d)).catch(() => null)) || {};
    for (const k of keys) {
      const key = k.slice(`nbapropmodel:${d}:`.length), m = await getJSON(k).catch(() => null);
      if (!m || m.stub || !done[key]) continue;   // not graded yet: leave it
      await r.set(k, JSON.stringify({ stub: true, runAt: m.runAt || null, start: m.start || null, away: m.away, home: m.home }));
      await r.del(K_NBAPROPS(d, key)); n++;
    }
  }
  return n;
}
// Grade the picks of every game ESPN says is final on the given dates (default: the last 3 Eastern days). A DNP is a push.
export const RECHECK_H = 6;
// 10/26 (owner: "find anything that's wrong"): ESPN kept correcting box scores AFTER the one 6-h recheck (10/23 rows: Bane steals U2.5, Clingan
// blocks U2.5, Holiday / Dunn / B.Miller rebounds -- 6 results flipped a day or more later), so a graded game is re-checked up to 3 times:
// 6+ h after its grade, then every 20+ h (`rechecks`; an old row with `rechecked` counts as 1). Days stay in the re-check pass for 7 days.
// 10/28: ESPN corrected 10/23-25 boxes AGAIN after the 3rd look (Durant ast 6 -> 5, Davis PRA 29 -> 30, Wells reb 5 -> 7: 5 results flipped) -> a look
// every 20+ h for the whole 7-day window (8 in all), not 3
export const RECHECKS = 8, RECHECK_GAP_H = 20, RECHECK_DAYS = 7;
export const recheckCount = (x) => x.rechecks ?? (x.rechecked ? 1 : 0);
// force (admin ?do=regradeprops, 10/28): look again now, whatever the count / gap -- ESPN fixed 10/23-25 boxes after the rows' last look
export const recheckDue = (x, now, gradedAt, force = false) => { if (force) return true; const c = recheckCount(x); if (c >= RECHECKS) return false;
  const since = c ? Date.parse(x.checkedAt || x.rechecked || 0) : Date.parse(gradedAt || 0);
  return now - since >= (c ? RECHECK_GAP_H : RECHECK_H) * 3600e3; };
export const gradeProp = (p, b) => { const s = b.players[normName(p.name)], v = s ? Number(s[p.stat] ?? 0) : null;
  return { actual: v, played: !!s, result: v == null ? "P" : (p.side === "over" ? v > p.line : v < p.line) ? "W" : "L" }; };
export async function gradeNbaProps({ dates = null, now = Date.now(), fetchBox = boxFor, force = false } = {}) {
  const r = getRedis(), today = etDate(new Date(now).toISOString());
  const days = dates || (await nbaPropDays()).filter((d) => d <= today && Date.parse(today) - Date.parse(d) <= RECHECK_DAYS * 86400e3);
  let n = 0;
  for (const d of days) {
    const keys = (await scanKeys(`nbapropmodel:${d}:*`)).map((k) => k.slice(`nbapropmodel:${d}:`.length)), rk = K_NBAPROPRES(d);
    const done = await r.hgetall(rk).catch(() => ({})) || {}, left = keys.filter((k) => !done[k]);
    // 10/21 review: ESPN corrects box scores after the final (OKC @ SAS 10/20: J.McCain 3 -> 2 rebounds, A.Caruso 7 -> 6 rebounds / 2 -> 1 steals,
    // which flipped a graded Under 2.5 from L to W) -- a graded game is looked at ONCE more, 6+ hours after its grade, and its saved rows re-graded.
    const again = keys.filter((k) => { if (!done[k]) return false; let x; try { x = JSON.parse(done[k]); } catch { return false; } return recheckDue(x, now, x.t, force); });
    if (!left.length && !again.length) continue;
    let box; try { box = await fetchBox(d); } catch { continue; }
    for (const key of again) {
      const b = box && box[key]; if (!b || !b.final) continue;
      let rec; try { rec = JSON.parse(done[key]); } catch { continue; }
      let changed = 0;
      const picks = (rec.picks || []).map((p) => { const g = gradeProp(p, b); if (g.actual !== p.actual || g.result !== p.result) changed++; return { ...p, ...g }; });
      const star = Array.isArray(rec.star) ? rec.star.map((p) => ({ ...p, ...gradeProp(p, b) })) : rec.star;   // the star-out shadow rows too
      const at = new Date(now).toISOString(), fixed = (rec.fixed || 0) + changed;
      await r.hset(rk, key, JSON.stringify({ ...rec, picks, ...(star ? { star } : {}), rechecked: rec.rechecked || at, checkedAt: at, rechecks: recheckCount(rec) + 1, ...(fixed ? { fixed } : {}) })); if (changed) n++;
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
export async function lastNbaProps(date, days = null, cal = null) {   // cal: propCalByDay (each day's rows on its own bands)
  const r = getRedis(), out = {}, all = (days || await nbaPropDays()).filter((d) => d < date).sort().reverse().slice(0, 10);
  for (const d of all) { const h = await r.hgetall(K_NBAPROPRES(d)).catch(() => null) || {};
    for (const v of Object.values(h)) { let rec; try { rec = JSON.parse(v); } catch { continue; }
      // 10/21: the row the page SHOWED that day (onePerPlayer, as nbaPropsForDay / nbaPropsRecord), not the first graded line of the ladder
      for (const p of onePerPlayer(rec.picks || [], bandsFor(cal, d))) { const k = `${p.name}|${p.stat}`; if (!out[k] && p.result && p.result !== "P") out[k] = { date: d, line: p.line, side: p.side, result: p.result, actual: p.actual ?? null }; } } }
  return out;
}
// 10/22 (owner: the NBA props page % = the calibrated chance): each row carries `cal` = its model % moved toward what its 5-point band really won on
// the graded rows (propCalibration, CAL_K 100) -- the same number the prop parlay legs use. The ROWS are unchanged (chosen on the model's %, the 65% bar).
// Walk-forward 10/21 rows calibrated from 10/20's: Brier 0.2119 raw -> 0.2112 (the model said 76.5, the rows won 70.1).
export async function nbaPropsForDay(date, now = Date.now()) {
  const cal = await propCalByDay(now).catch(() => null), bands = bandsFor(cal, date);
  const r = getRedis(), res = await r.hgetall(K_NBAPROPRES(date)).catch(() => null) || {}, out = [], last = await lastNbaProps(date, null, cal).catch(() => ({}));
  for (const k of await scanKeys(`nbapropmodel:${date}:*`)) {
    const key = k.slice(`nbapropmodel:${date}:`.length), model = await getJSON(k).catch(() => null); if (!model) continue;
    let picks;
    if (res[key]) { try { picks = JSON.parse(res[key]).picks || []; } catch { picks = []; } }
    else picks = nbaPropPicks(model.rows, await getJSON(K_NBAPROPS(date, key)).catch(() => null)).map((p) => ({ ...p, result: null }));
    picks = onePerPlayer(picks, bands); if (!picks.length) continue;
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
export async function nbaPropsRecord(dates, now = Date.now()) {
  const cal = await propCalByDay(now).catch(() => null);
  const r = getRedis(), rec = { all: { w: 0, l: 0 } }; for (const [s] of NBA_STATS) rec[s] = { w: 0, l: 0 };
  for (const d of dates) { const h = await r.hgetall(K_NBAPROPRES(d)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let x; try { x = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer(x.picks || [], bandsFor(cal, d))) { if (p.result !== "W" && p.result !== "L") continue; const k = p.result === "W" ? "w" : "l"; rec.all[k]++; if (rec[p.stat]) rec[p.stat][k]++; } } }
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
      // 10/23: the page's own rules except the price cap -- Overs only (an NBA prop Under cannot be bought), the Over % blended with the price, no cut side
      for (const p0 of x.picks || []) { if (!(p0.price >= MAX_PRICE && p0.price < 1) || (CUT_UNDERS && p0.side === "under") || CUT_SIDES.has(`${p0.stat}|${p0.side}`)) continue;
        const p = { ...p0, chance: effChance(p0) }; if (!(p.chance >= NBA_PROP_BAR)) continue;
        const k = `${normName(p.name)}|${p.stat}`, o = best.get(k); if (!o || p.chance > o.chance) best.set(k, p); }
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
// 10/30 (owner: "Where's the games" -- 10/29's Points rows were gone after that night's grading moved the bands): a day's rows are calibrated from the
// graded days BEFORE it only -- what the page used while they showed -- so a past day's list, its % and its record never move when later days are graded
// (Donovan Mitchell Points Over 19.5 showed 75.7% at 73c before tip, then read under its price once 10/29 itself was in the bands and left the list)
const bandsOut = (bands) => Object.fromEntries(Object.entries(bands).map(([k, b]) => [k, { n: b.n, said: b.said / b.n, won: b.won / b.n }]));
export async function propCalByDay(now = Date.now(), fresh = false) {
  const r = getRedis(), old = fresh ? null : await getJSON("nbapropcal3").catch(() => null);
  if (old && old.byDay && now - Date.parse(old.t) < 3 * 3600e3) return old;
  const bands = {}, byDay = {}, days = [...await nbaPropDays()].sort();
  for (const d of days) { byDay[d] = bandsOut(bands); const h = await r.hgetall(K_NBAPROPRES(d)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let x; try { x = JSON.parse(v); } catch { continue; }
      for (const p of onePerPlayer(x.picks || [])) { if (p.result !== "W" && p.result !== "L") continue; const b = (bands[calBand(p.chance)] = bands[calBand(p.chance)] || { n: 0, said: 0, won: 0 });
        b.n++; b.said += p.chance; if (p.result === "W") b.won++; } } }
  const cal = { t: new Date(now).toISOString(), full: bandsOut(bands), byDay };
  await setJSON("nbapropcal3", cal).catch(() => {});
  return cal;
}
// the bands a day's rows use: every graded day before it (today / a day with nothing graded yet: all graded days before it)
export function bandsFor(cal, date) {
  if (!cal) return null; if (cal.byDay && cal.byDay[date]) return cal.byDay[date];
  const later = Object.keys(cal.byDay || {}).sort().find((d) => d > date); return later ? cal.byDay[later] : cal.full;
}
export async function propCalibration(now = Date.now(), fresh = false) { return (await propCalByDay(now, fresh)).full; }
export function calibrate(chance, bands) {
  const b = bands && bands[calBand(chance)]; if (!b || !b.n) return chance;
  return Math.min(0.99, Math.max(0.01, chance + (b.won - b.said) * (b.n / (b.n + CAL_K))));
}
export async function propLegsForDay(date, games, now = Date.now()) {
  const legs = [], bands = bandsFor(await propCalByDay(now).catch(() => null), date);
  for (const g of games || []) {
    if (!g || g.date !== date || !(Date.parse(g.start) > now)) continue;
    const model = await getJSON(K_NBAPROPMODEL(date, g.key)).catch(() => null); if (!model || !model.rows) continue;
    for (const p of onePerPlayer(nbaPropPicks(model.rows, await getJSON(K_NBAPROPS(date, g.key)).catch(() => null)), bands)) if (p.price > 0 && p.price < 1) legs.push({ ...p, game: g.key, start: g.start });
  }
  const best = new Map(); for (const p of legs) { const k = normName(p.name), o = best.get(k); if (!o || p.chance > o.chance) best.set(k, p); }
  return [...best.values()].map((p) => ({ ...p, cal: calibrate(p.chance, bands) })).sort((a, b) => b.cal - a.cal);
}
