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
