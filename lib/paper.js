// Parlay Lab (added 9/30): PAPER parlays only -- nothing is bet. Each week the app records a few fixed strategies at
// the Polymarket prices of that moment, grades them when the games finish, and keeps a scoreboard, so a strategy can
// prove itself on games it has never seen before any money goes on it. The strategies are fixed in advance (no
// re-tuning to past results), because re-tuning is exactly how a backtest fools itself.
//   home_fav_95   home favorites of 9.5+ points on the moneyline -- the one game-line angle that held up on locked
//                 years (2007-18 +2.2%, 2019-25 +3.5% as singles at sportsbook prices, ~88% won). Singles, 2- and 3-leg.
//   top3_home_75  the 3 biggest home favorites the market gives 75%+ (the most likely 3-leg parlay; ~60% hit 2019-25).
//   td_edge_3     3 TD players (one per game) whose model chance beats Polymarket's price by 3%+ on a real market.
//   right_now_3   3 legs from "Right now" (Polymarket 3%+ cheaper than fresh sportsbook fair prices), one per game.
import { getRedis, getJSON, setJSON } from "./redis";
import { nameMatches } from "./picks";

export const STRATEGIES = {
  home_fav_95_single: "Home favorites 9.5+ · moneyline · singles",
  home_fav_95_2: "Home favorites 9.5+ · moneyline · 2-leg",
  home_fav_95_3: "Home favorites 9.5+ · moneyline · 3-leg",
  top3_home_75: "3 biggest home favorites (75%+) · moneyline",
  td_edge_3: "3 TD players where the model beats the price",
  right_now_3: "3 legs from Right now",
};
const key = (s, w) => `paper:${s}:${w}`;
const homeSpread = (g) => (g.poly && g.poly.spread ? g.poly.spread.homeSpread : g.books && g.books.spread ? g.books.spread.homeSpread : null);

// Build this week's paper parlays from the page data (lib/week.js buildWeek), only games that haven't started.
export function buildPaper(data) {
  const open = data.games.filter((g) => !g.started && !g.final);
  const ml = (g) => g.poly && g.poly.ml && g.poly.ml.home > 0 && g.poly.ml.home < 1 ? g.poly.ml.home : null;
  const favs = open.filter((g) => homeSpread(g) != null && homeSpread(g) <= -9.5 && ml(g))
    .map((g) => ({ game: g.key, kind: "ml", team: g.home, label: `${g.home} ML`, price: ml(g), prob: (g.winPct ?? null) != null ? g.winPct / 100 : null }))
    .sort((a, b) => b.price - a.price);
  const strong = open.filter((g) => ml(g) && g.winPct != null && g.winPct >= 75)
    .map((g) => ({ game: g.key, kind: "ml", team: g.home, label: `${g.home} ML`, price: ml(g), prob: g.winPct / 100 }))
    .sort((a, b) => b.prob - a.prob);
  const tds = [];
  for (const g of open) for (const r of g.td || []) {
    if (r.price == null || r.thin || r.stale || r.fair == null || !(r.bid > 0)) continue;       // real markets only
    // 3%+ edge, but not over 30%: the rest of the app treats 30%+ as "recheck -- probably bad data" (a mismatched or
    // stale market), and picking the biggest edges would pick exactly those.
    const p = r.fair / 100, e = p / r.price - 1; if (e >= 0.03 && e <= 0.3) tds.push({ game: g.key, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price, prob: p, edge: p / r.price - 1 });
  }
  tds.sort((a, b) => b.edge - a.edge);
  const rn = (data.edgesNow || []).filter((e) => !e.held && e.evNet <= 0.3).map((e) => ({ game: e.game, kind: e.market, label: e.label, price: e.price, prob: e.fair, edge: e.evNet }));
  const onePerGame = (legs, k) => { const out = [], seen = new Set(); for (const l of legs) { if (seen.has(l.game)) continue; seen.add(l.game); out.push(l); if (out.length === k) break; } return out.length === k ? out : null; };
  const P = [];
  const add = (strategy, legs) => { if (legs) P.push({ strategy, legs, pay: legs.reduce((a, l) => a / l.price, 1), prob: legs.every((l) => l.prob != null) ? legs.reduce((a, l) => a * l.prob, 1) : null }); };
  for (const l of favs) add("home_fav_95_single", [l]);
  add("home_fav_95_2", onePerGame(favs, 2)); add("home_fav_95_3", onePerGame(favs, 3));
  add("top3_home_75", onePerGame(strong, 3));
  add("td_edge_3", onePerGame(tds, 3));
  add("right_now_3", onePerGame(rn, 3));
  return P;
}

// Record once per week, ~a day before the Sunday slate (called by scheduled snapshots). Later calls never overwrite.
export async function recordPaper(season, week, data) {
  const k = key(season, week);
  if (await getRedis().exists(k)) return 0;
  const sundays = data.games.filter((g) => g.kickoff && new Date(g.kickoff).getUTCDay() === 0 && !g.started).map((g) => new Date(g.kickoff).getTime());
  if (!sundays.length) return 0;
  const hrs = (Math.min(...sundays) - Date.now()) / 3600e3;
  if (hrs > 26 || hrs < 0) return 0;                                       // Saturday evening / Sunday morning snapshot
  const parlays = buildPaper(data);
  await setJSON(k, { t: new Date().toISOString(), season, week, parlays });
  return parlays.length;
}

// Grade from final scores + TD scorers (grade.js passes them). A parlay loses as soon as one leg loses.
export async function gradePaper(season, week, finals, tdScorers) {
  const rec = await getJSON(key(season, week)); if (!rec) return 0;
  const byKey = Object.fromEntries(finals.map((g) => [g.key, g])); let changed = 0;
  for (const p of rec.parlays) {
    if (p.result) continue;
    for (const l of p.legs) {
      if (l.result) continue;
      const g = byKey[l.game]; if (!g) continue;
      const [away, home] = l.game.split(" @ "), margin = g.homeScore - g.awayScore;
      if (l.kind === "ml") l.result = margin === 0 ? "P" : (l.team === home ? margin > 0 : margin < 0) ? "W" : "L";
      else if (l.kind === "spread") { const m = l.label.match(/^(\S+) ([+-]?\d+(?:\.\d+)?)$/); if (m) { const x = (m[1] === home ? margin : -margin) + Number(m[2]); l.result = x > 0 ? "W" : x < 0 ? "L" : "P"; } }
      else if (l.kind === "total") { const m = l.label.match(/^(Over|Under) (\d+(?:\.\d+)?)$/); if (m) { const tot = g.homeScore + g.awayScore, x = m[1] === "Over" ? tot - Number(m[2]) : Number(m[2]) - tot; l.result = x > 0 ? "W" : x < 0 ? "L" : "P"; } }
      else if (l.kind === "td") { const sc = await tdScorers(season, week, l.game); if (sc) l.result = sc.some((s) => nameMatches(l.player, s) && (!sc.teams || !sc.teams[s] || sc.teams[s].includes(l.team))) ? "W" : "L"; }
      if (l.result) changed++;
    }
    if (p.legs.some((l) => l.result === "L")) p.result = "L";
    else if (p.legs.every((l) => l.result)) p.result = p.legs.every((l) => l.result === "P") ? "P" : "W";
    if (p.result) p.ret = p.result === "W" ? p.legs.filter((l) => l.result === "W").reduce((a, l) => a / l.price, 1) - 1 : p.result === "P" ? 0 : -1;   // per $1, pushed legs drop out
  }
  if (changed) await setJSON(key(season, week), rec);
  return changed;
}

// Scoreboard for the Parlay Lab tab: this week's paper parlays + every strategy's record this season.
export async function paperSummary(season, week) {
  const r = getRedis(), board = {}; let c = "0";
  do { const [n, ks] = await r.scan(c, "MATCH", `paper:${season}:*`, "COUNT", 200); c = n;
    for (const k of ks) { const rec = await getJSON(k); for (const p of (rec && rec.parlays) || []) {
      const b = (board[p.strategy] = board[p.strategy] || { recorded: 0, graded: 0, hits: 0, ret: 0, expHits: 0, expN: 0 });
      b.recorded++; if (p.result) { b.graded++; b.hits += p.result === "W" ? 1 : 0; b.ret += p.ret; if (p.prob != null) { b.expHits += p.prob; b.expN++; } } } } } while (c !== "0");
  for (const b of Object.values(board)) { b.roi = b.graded ? b.ret / b.graded : null; b.hitRate = b.graded ? b.hits / b.graded : null; b.expRate = b.expN ? b.expHits / b.expN : null; }
  return { week: (await getJSON(key(season, week))) || null, board, names: STRATEGIES };
}

// ---------- Pick Lab: the model's side on EVERY game, recorded at kickoff (paper singles) ----------
// Why (9/30): "model's side" is the pick the model would make on each spread and total. Backtests (2013-25) put it at
// ~51% against the closing line (break-even 52.4%); a "model or market?" picker reached 53.1% in its best setting and a
// median of 51.9% across 24 settings (scrambled labels never got above 51.8%). This measures the plain model side at the
// real kickoff-time Polymarket price, on games it has never seen, with the disagreement size saved so it can be sliced later.
const sg = (n) => (n > 0 ? "+" : "") + n;
const pkey = (s, w) => `picks:${s}:${w}`;
// Model's side on the spread and the total for one game (nulls when there is no model, no line, or a dead toss-up).
export function picksFor(g, poly, m) {
  if (!poly || !m) return [];
  const out = [];
  if (poly.spread && m.homeMargin != null) {
    const hs = poly.spread.homeSpread, gap = m.homeMargin + hs;            // model's home margin minus the market's (-hs)
    if (Math.abs(gap) >= 0.05) { const home = gap > 0;
      out.push({ game: g.key, market: "spread", label: home ? `${g.home} ${sg(hs)}` : `${g.away} ${sg(-hs)}`, line: home ? hs : -hs, price: home ? poly.spread.home : poly.spread.away, gap: Math.abs(gap) }); }
  }
  if (poly.total && m.total != null) {
    const gap = m.total - poly.total.line;
    if (Math.abs(gap) >= 0.05) { const over = gap > 0;
      out.push({ game: g.key, market: "total", label: `${over ? "Over" : "Under"} ${poly.total.line}`, line: poly.total.line, price: over ? poly.total.over : poly.total.under, gap: Math.abs(gap) }); }
  }
  return out.filter((p) => p.price > 0 && p.price < 1);
}
export async function recordPicks(season, week, g, poly, m, t) {
  const ps = picksFor(g, poly, m); if (!ps.length) return 0;
  for (const p of ps) await getRedis().hset(pkey(season, week), `${p.game}|${p.market}`, JSON.stringify({ ...p, t }));   // last write before kickoff wins
  return ps.length;
}
// Grade every recorded pick of a week whose game is final. A win returns 1/price - 1 per $1; a push returns 0.
export async function gradePicksWeek(season, week, finals) {
  const r = getRedis(), all = await r.hgetall(pkey(season, week)); let n = 0;
  for (const g of finals) for (const market of ["spread", "total"]) {
    const f = `${g.key}|${market}`; if (!all[f]) continue; const p = JSON.parse(all[f]); if (p.result) continue;
    const margin = g.homeScore - g.awayScore, tot = g.homeScore + g.awayScore, home = g.key.split(" @ ")[1];
    let x;
    if (market === "spread") { const team = p.label.split(" ")[0]; x = (team === home ? margin : -margin) + p.line; }
    else x = p.label.startsWith("Over") ? tot - p.line : p.line - tot;
    p.result = x > 0 ? "W" : x < 0 ? "L" : "P"; p.ret = p.result === "W" ? 1 / p.price - 1 : p.result === "L" ? -1 : 0;
    await r.hset(pkey(season, week), f, JSON.stringify(p)); n++;
  }
  return n;
}
export async function picksSummary(season) {
  const r = getRedis(), rows = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `picks:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) rows.push(JSON.parse(v)); } while (c !== "0");
  const agg = (xs) => { const d = xs.filter((p) => p.result), w = d.filter((p) => p.result === "W").length, l = d.filter((p) => p.result === "L").length;
    return { recorded: xs.length, graded: d.length, w, l, hit: w + l ? w / (w + l) : null, roi: d.length ? d.reduce((a, p) => a + p.ret, 0) / d.length : null,
      need: d.length ? d.reduce((a, p) => a + p.price, 0) / d.length : null }; };     // avg price paid = the hit rate needed to break even
  const out = {};
  for (const m of ["spread", "total"]) { const xs = rows.filter((p) => p.market === m);
    out[m] = { ...agg(xs), bands: [["under 2 pts", 0, 2], ["2 to 4", 2, 4], ["4 and up", 4, 99]].map(([label, lo, hi]) => ({ label, ...agg(xs.filter((p) => p.gap >= lo && p.gap < hi)) })) }; }
  return out;
}
