// GAME PROPS PICK (NFL, 10/28 night; owner: "test and build and model for this too. and only show our picks if there are any. let me know what passes
// so we can set a rule of % and cap price" / "try 1000 different models to see if we can find any edges"). Polymarket US keeps every past game, so
// all 51,450 game / team markets of 2026 weeks 1-7 were pulled with their price history and settlement (scratchpad us/pull.py), and 11,376 model
// options (4 input sets x ridge / 2 boosted trees x 150 / 300 / 600 nearest games x 4 price blends, per market type) were fit on 2011-2025 only and
// replayed on the steady two-sided books (us/engine2.py, us/evaluate.py). Halves, quarters and team totals: no option held (22-12 at a said 72%,
// even money). The one that held on the game and team props: the chance = how often the market's condition came true among the 600 past games
// (2011-2025) nearest this game's spread + total (each game placed by ridge fits of the market's own quantities, lib/gameprops_data.js).
// Shown % = 0.8 that chance + 0.2 Polymarket's price (the history alone ran 3-4 points high on the sides it picks). The rule (chosen on weeks 1-3,
// judged on 4-7): shown 70%+, price 30-77c, shown 6+ points over the price; one pick per game per market type (the highest shown %).
// 2026 wk1-7 (no 2026 game was used to make a pick), this file's own code (npm run accuracy, railway-model-service/data/poly_us_gameprops.csv):
// 161-28 = 85.2% (said 81.4, priced 67c, +30 per $100); weeks 1-3 99-18 = 84.6%, weeks 4-7 62-10 = 86.1%; results drawn at the market's own prices
// never reach it (p < 0.001). Most picks are total passing / rushing TDs Under, team D/ST TD No, two-point No, team field goals / TDs, race to 35 No.
// The prices are what you pay (Polymarket's price history = the best ask each side, checked 10/28); the test used the closing spread / total, live
// uses the current books' lines. Real two-sided books form on game day (4 days out every book is 1c bid / 40-60c ask: no pick until then).
import { GPD } from "./gameprops_data";
import { appTeam } from "./polyus";

// 10/29 (owner: "where did you even get the 77 cap?"): 77c was the player props' cap, copied here untested. On the same Polymarket US books (weeks
// 1-3 choose, weeks 4-7 judge): 77c 99-18 / 62-10; 82c 121-17 = 87.7% / 76-10 = 88.4% (the 77-82c picks 54-0); 85c 87.2 / 89.8; 90c 87.1 / 92.3.
export const GP_BAR = 0.70, GP_CAP = 0.82, GP_MIN = 0.30, GP_EDGE = 0.06, GP_PRICE_W = 0.2;
// the market types the rule was judged on (anything else Polymarket lists is never picked)
export const GP_FAMS = new Set(["dst_t", "first_score", "first_td", "htft", "margin", "ot", "ptd_t", "race7", "race14", "race21", "race28", "race35", "rtd_t",
  "safety", "td_t", "team_dst", "team_fg", "team_td", "team_yds", "tie", "twopt"]);
export const gpShown = (c, px) => (1 - GP_PRICE_W) * c + GP_PRICE_W * px;
export const gpQualifies = (shown, px) => shown != null && px != null && shown >= GP_BAR && px >= GP_MIN && px <= GP_CAP && shown - px >= GP_EDGE - 1e-9;

// the 2011-2025 games, decoded once
let COLS = null;
function cols() {
  if (COLS) return COLS;
  COLS = {}; for (const [k, v] of Object.entries(GPD.cols)) COLS[k] = Int32Array.from(v.split(","), Number);
  COLS.hfav = Float64Array.from(COLS.hfav2, (x) => x / 2); COLS.tl = Float64Array.from(COLS.tl2, (x) => x / 2);
  return COLS;
}

// ---- Polymarket US market -> the condition on the game (for the LONG side: Yes / Over); a port of the research's us/markets.py ----
const NAMES = { ARI: ["Arizona", "Cardinals"], ATL: ["Atlanta", "Falcons"], BAL: ["Baltimore", "Ravens"], BUF: ["Buffalo", "Bills"], CAR: ["Carolina", "Panthers"], CHI: ["Chicago", "Bears"],
  CIN: ["Cincinnati", "Bengals"], CLE: ["Cleveland", "Browns"], DAL: ["Dallas", "Cowboys"], DEN: ["Denver", "Broncos"], DET: ["Detroit", "Lions"], GB: ["Green Bay", "Packers"],
  HOU: ["Houston", "Texans"], IND: ["Indianapolis", "Colts"], JAX: ["Jacksonville", "Jaguars"], KC: ["Kansas City", "Chiefs"], LV: ["Las Vegas", "Raiders"], LAC: ["Chargers"],
  LA: ["Rams"], MIA: ["Miami", "Dolphins"], MIN: ["Minnesota", "Vikings"], NE: ["New England", "Patriots"], NO: ["New Orleans", "Saints"], NYG: ["Giants"], NYJ: ["Jets"],
  PHI: ["Philadelphia", "Eagles"], PIT: ["Pittsburgh", "Steelers"], SEA: ["Seattle", "Seahawks"], SF: ["San Francisco", "49ers"], TB: ["Tampa Bay", "Buccaneers"],
  TEN: ["Tennessee", "Titans"], WAS: ["Washington", "Commanders"] };
const teamIn = (name, cands) => { const hits = cands.filter((c) => (NAMES[c] || []).some((w) => name.includes(w))); return hits.length === 1 ? hits[0] : null; };
const num = (s) => { const m = String(s || "").match(/(-?[\d.]+)/); return m ? Number(m[1]) : NaN; };
const GAME_OVER = { football_game_overtime: ["ot", 0.5], football_game_tie: ["tie", 0.5], football_game_safety: ["safety", 0.5], football_game_total_two_point_conversions: ["twopt"],
  football_game_total_defensive_special_teams_touchdowns: ["dst_t"], football_game_total_touchdowns: ["td_t"], football_game_total_pass_touchdowns: ["ptd_t"], football_game_total_rush_touchdowns: ["rtd_t"] };
const TEAM_STAT = { football_team_total_touchdowns: "td", football_team_total_field_goals_made: "fg", football_team_total_defensive_special_teams_touchdowns: "dst", football_team_total_offensive_yards: "yds" };
export function gpParse(m, away, home) {
  const t = String((m && m.sportsMarketType) || ""), q = String((m && m.question) || ""), L = ((m && m.marketSides) || []).find((s) => s && s.long) || {};
  const lt = L.team && L.team.abbreviation ? appTeam(L.team.abbreviation) : null, s = lt && lt === home ? "h" : lt && lt === away ? "a" : null;
  let p = null;
  if (GAME_OVER[t]) { const [col, ln] = GAME_OVER[t], line = ln != null ? ln : num(q.split("Over")[1]); if (isFinite(line)) p = { fam: col, kind: "over", col, line }; }
  else if (TEAM_STAT[t]) { const line = num(q.split("Over")[1]); if (s && isFinite(line)) p = { fam: `team_${TEAM_STAT[t]}`, kind: "tstat", stat: TEAM_STAT[t], s, line }; }
  else if (t === "football_game_first_score" || t === "football_game_first_touchdown") { const col = t === "football_game_first_score" ? "first_score" : "first_td", val = /Neither/.test(q) ? "none" : s; if (val) p = { fam: col, kind: "cat", col, val }; }
  else if (t === "football_game_race_to_points") { const X = (q.match(/Race to (\d+)/) || [])[1]; if (X && s) p = { fam: `race${X}`, kind: "cat", col: `race${X}`, val: s }; }
  else if (t === "football_game_double_result") { const sl = String(m.slug || "").split("-htft-")[1], [h1, ft] = sl ? sl.split("-") : []; if (["home", "away", "tie"].includes(h1) && ["home", "away", "tie"].includes(ft)) p = { fam: "htft", kind: "htft", h1, ft }; }
  else if (t === "football_game_exact_margin") { const mm = q.match(/: (.+?) by (\d+)(?:-(\d+)|\+)/);
    if (!mm) { if (/Tie|Draw/.test(q)) p = { fam: "margin", kind: "margtie" }; }
    else { const tm = teamIn(mm[1], [home, away]), ss = tm === home ? "h" : tm === away ? "a" : null; if (ss) p = { fam: "margin", kind: "margin", s: ss, lo: +mm[2], hi: mm[3] ? +mm[3] : 999 }; } }
  return p && GP_FAMS.has(p.fam) ? p : null;
}
// the quantities that place a game for this kind of market (the research's space(): its own quantity + the game total, or both teams' numbers)
const spaceOf = (p) => (p.kind === "htft" ? ["fin_m", "fin_t", "h1_m"] : p.kind === "over" ? [p.col, "fin_t"] : p.kind === "tstat" ? [`${p.stat}_h`, `${p.stat}_a`] : ["fin_m", "fin_t"]);
// 1 / 0 / 0.5 (a push) for the long side on each past game
function cond(p, i) {
  const C = cols(), ov = (v, L) => (v > L ? 1 : v < L ? 0 : 0.5), sg = p.s === "h" ? 1 : -1, res = (m) => (m > 0 ? "home" : m < 0 ? "away" : "tie");
  switch (p.kind) {
    case "over": return ov(C[p.col][i], p.line);
    case "tstat": return ov(C[`${p.stat}_${p.s}`][i], p.line);
    case "cat": return C[p.col][i] === { h: 1, a: 2, none: 0 }[p.val] ? 1 : 0;
    case "htft": return res(C.h1_m[i]) === p.h1 && res(C.fin_m[i]) === p.ft ? 1 : 0;
    case "margin": { const mg = sg * C.fin_m[i]; return mg >= p.lo && mg <= p.hi ? 1 : 0; }
    case "margtie": return C.fin_m[i] === 0 ? 1 : 0;
  }
  return null;
}
// the 600 past games nearest (hfav = home favored margin, tl = total) in the space of the market's quantities, nearest first (ties by order)
export function gpNeighbours(space, hfav, tl, cache = {}) {
  const key = space.join("|"); if (cache[key]) return cache[key];
  const C = cols(), n = GPD.n, fit = space.map((t) => GPD.fits[t]), z = (f, h, T) => ((f[0] + f[1] * h + f[2] * T) - f[3]) / f[4];
  const me = fit.map((f) => z(f, hfav, tl)), d = new Float64Array(n), idx = new Int32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < fit.length; j++) { const e = z(fit[j], C.hfav[i], C.tl[i]) - me[j]; s += e * e; } d[i] = s; idx[i] = i; }
  const out = Array.from(idx).sort((a, b) => d[a] - d[b] || a - b).slice(0, GPD.K); cache[key] = out; return out;
}
// the long side's chance from history
export function gpChance(p, hfav, tl, cache = {}) {
  if (!p || !isFinite(hfav) || !isFinite(tl)) return null;
  const nb = gpNeighbours(spaceOf(p), hfav, tl, cache); let s = 0; for (const i of nb) s += cond(p, i); return s / nb.length;
}
// what you pay: the long side = the best ask, the short side = 1 - the best bid; a real two-sided book only (both 1-99c, the two adding to 98-106c)
const qv = (x) => { const v = Number(x && typeof x === "object" ? x.value : x); return v > 0 && v < 1 ? v : null; };
export function gpPrices(m) {
  if (!m || m.closed || m.active === false || m.hidden) return null;
  const ask = qv(m.bestAskQuote), bid = qv(m.bestBidQuote); if (ask == null || bid == null) return null;
  const pl = ask, ps = Math.round((1 - bid) * 1000) / 1000;
  return pl > 0.01 && pl < 0.99 && ps > 0.01 && ps < 0.99 && pl + ps >= 0.98 - 1e-9 && pl + ps <= 1.06 + 1e-9 ? { pl, ps } : null;
}
// plain words for a side ("Total passing TDs Under 5.5", "LA D/ST TD No")
const OVER_NAME = { ptd_t: "Total passing TDs", rtd_t: "Total rushing TDs", td_t: "Total TDs", twopt: "Two-point conversions", dst_t: "D/ST TDs" };
const YESNO_NAME = { ot: "Overtime", tie: "Tie game", safety: "Safety" };
const TEAM_NAME = { td: "TDs", fg: "field goals", dst: "D/ST TDs", yds: "total yards" };
export function gpLabel(p, long, away, home) {
  const team = (s) => (s === "h" ? home : away), yn = long ? "Yes" : "No", ou = long ? "Over" : "Under", who = (v) => (v === "home" ? home : v === "away" ? away : "Tie");
  if (p.kind === "over") return YESNO_NAME[p.col] ? `${YESNO_NAME[p.col]} ${yn}` : `${OVER_NAME[p.col]} ${ou} ${p.line}`;
  if (p.kind === "tstat") return p.stat === "dst" && p.line === 0.5 ? `${team(p.s)} D/ST TD ${yn}` : `${team(p.s)} ${TEAM_NAME[p.stat]} ${ou} ${p.line}`;
  if (p.kind === "cat") { const tm = p.val === "none" ? "Neither" : team(p.val === "h" ? "h" : "a");
    return p.col === "first_score" ? `${tm} scores first ${yn}` : p.col === "first_td" ? `${tm} first TD ${yn}` : `${tm} race to ${p.col.slice(4)} ${yn}`; }
  if (p.kind === "htft") return `Half / full ${who(p.h1)} / ${who(p.ft)} ${yn}`;
  if (p.kind === "margin") return `${team(p.s)} wins by ${p.hi >= 999 ? `${p.lo}+` : `${p.lo}-${p.hi}`} ${yn}`;
  if (p.kind === "margtie") return `Exact margin tie ${yn}`;
  return "";
}
// ev = the game's Polymarket US event; hfav / tl = the game's current spread (home favored margin) + total -> the picks, highest shown % first
export function gpPicks(ev, away, home, hfav, tl) {
  if (!ev || !isFinite(hfav) || !isFinite(tl)) return [];
  const cache = {}, best = {};
  for (const m of ev.markets || []) {
    const p = gpParse(m, away, home); if (!p) continue; const px = gpPrices(m); if (!px) continue;
    const c = gpChance(p, hfav, tl, cache); if (c == null) continue;
    for (const [long, ch, price] of [[true, c, px.pl], [false, 1 - c, px.ps]]) {
      const shown = gpShown(ch, price); if (!gpQualifies(shown, price)) continue;
      if (!best[p.fam] || shown > best[p.fam].said) best[p.fam] = { fam: p.fam, slug: m.slug, long, cond: p, label: gpLabel(p, long, away, home), said: Math.round(shown * 1000) / 1000, hist: Math.round(ch * 1000) / 1000, price }; }
  }
  // 10/28 night: + the passing-TDs cross-check pick (ptdCross), unless it is the very side a GAME PROPS pick already holds
  const x = ptdCross(ev, away, home); if (x && !Object.values(best).some((p) => p.slug === x.slug && p.long === x.long)) best.ptd_qb = x;
  return Object.values(best).sort((a, b) => b.said - a.said);
}
// a settled market -> "W" / "L" / "P" for the side we took (Polymarket's outcomePrices follow the marketSides order, long side first: checked 100%
// against the research's own settlement), or null while it is not settled
export function gpResult(m, long) {
  if (!m || m.closed !== true) return null; let r = m.outcomePrices; try { if (typeof r === "string") r = JSON.parse(r); } catch { return null; }
  const sides = m.marketSides || [], li = sides.findIndex((s) => s && s.long); if (!Array.isArray(r) || r.length !== 2 || li < 0) return null;
  const v = Number(r[long ? li : 1 - li]);
  return v === 1 ? "W" : v === 0 ? "L" : v === 0.5 ? "P" : null;
}

// ---- PASSING TDs CROSS-CHECK (10/28 night; owner: "build ... 1, 2, 3, 4, and 5") ----
// The two quarterbacks' passing-TD ladders (1+ / 2+ / 3+ / 4+ on Polymarket US) imply the game's total passing TDs; when that differs from the game
// market "Total Passing Touchdowns Over X" by PTDX_GAP+, the game market's side the QBs point to is the bet (30-77c), one per game (the biggest gap).
// Polymarket US 2026 wk1-7, prices 2 h before kickoff on real two-sided books, the game never used: 56-18 = 75.7% at 55c (+43 per $100),
// weeks 1-3 24-11, weeks 4-7 32-7; results drawn at the market's prices reach it 1 in 10,000 (scratchpad us/cross_ptd2.py; npm run accuracy
// replays this code on railway-model-service/data/poly_us_ptd_cross.csv). Both directions win (QBs say more -> Over 75%, fewer -> Under 78%).
// It never disagreed with a GAME PROPS passing-TD pick (38-6 on the same games). Shown % = 0.8 x the QBs' implied chance of that side + 0.2 x
// the price (gpShown, as the GAME PROPS pick): the implied chance alone said 80.3 on the 74 picks that won 75.7%; the blend says 75.2.
export const PTDX_GAP = 0.08;
const mid = (px) => (px.pl + 1 - px.ps) / 2;
export function ptdCross(ev, away, home) {
  const qbs = new Map(), game = [];
  for (const m of (ev && ev.markets) || []) {
    const t = String(m.sportsMarketType || ""), px = gpPrices(m); if (!px) continue;
    if (t === "football_player_passing_touchdowns") { const k = String(m.slug || "").match(/-ptd-([a-z]+)-gte(\d+)$/); if (k) (qbs.get(k[1]) || qbs.set(k[1], {}).get(k[1]))[Number(k[2])] = mid(px); }
    else if (t === "football_game_total_pass_touchdowns") { const L = num(String(m.question || "").split("Over")[1]); if (isFinite(L)) game.push({ m, L, px }); }
  }
  const two = [...qbs.values()].sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 2);
  if (two.length < 2 || !game.length) return null;
  // each QB: P(>= k) for k 1..5 (a missing rung = the rung below x 0.45, the 1+ rung = 70%; never rising) -> P(= k) -> the two convolved
  const dist = (lad) => { const ge = [1]; for (let k = 1; k <= 5; k++) { let v = lad[k]; if (v == null) v = k > 1 ? ge[k - 1] * 0.45 : 0.7; ge.push(Math.min(v, ge[k - 1])); }
    return ge.map((g, k) => g - (k + 1 <= 5 ? ge[k + 1] : 0)); };
  const a = dist(two[0]), b = dist(two[1]), tot = new Array(11).fill(0);
  for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) tot[i + j] += a[i] * b[j];
  let best = null;
  for (const { m, L, px } of game) {
    const imp = tot.slice(Math.floor(L) + 1).reduce((s, x) => s + x, 0), gap = imp - mid(px);
    for (const [long, g, price, said] of [[true, gap, px.pl, imp], [false, -gap, px.ps, 1 - imp]])
      if (g >= PTDX_GAP - 1e-9 && price >= GP_MIN && price <= GP_CAP && (!best || g > best.gap))
        best = { fam: "ptd_qb", slug: m.slug, long, cond: { fam: "ptd_t", kind: "over", col: "ptd_t", line: L }, label: gpLabel({ kind: "over", col: "ptd_t", line: L }, long, away, home), said: Math.round(gpShown(said, price) * 1000) / 1000, hist: Math.round(said * 1000) / 1000, price, gap: Math.round(g * 1000) / 1000 };
  }
  return best;
}
