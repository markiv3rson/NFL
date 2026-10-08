// Parlay Lab (added 9/30): PAPER parlays only -- nothing is bet. Each week the app records a few fixed strategies at
// the Polymarket prices of that moment, grades them when the games finish, and keeps a scoreboard, so a strategy can
// prove itself on games it has never seen before any money goes on it. The strategies are fixed in advance (no
// re-tuning to past results), because re-tuning is exactly how a backtest fools itself.
//   home_fav_95   home favorites of 9.5+ points on the moneyline -- the best
//                 game-line angle (2007-25 +2.6% as singles at sportsbook prices, ~88% won), but not steady: +5.4% 2007-12, -2.3% 2013-18,
//                 +3.5% 2019-25 (re-checked 10/1). Singles, 2- and 3-leg.
//   top3_home_75  the 3 biggest home favorites the market gives 75%+ (the most likely 3-leg parlay; ~60% hit 2019-25).
//   td_edge_3     3 TD players (one per game) whose model chance beats Polymarket's price by 3%+ on a real market.
//   td_likely_2/3 the 2 or 3 players with the highest model chance to score (one per game, real market, not on the injury report),
//                 whatever the price: tracks whether stacking the most likely scorers pays (10/1).
//   same_game_3   (10/2) one parlay per game, for every game (a lone Thursday game has no other game to pair with): the biggest edge from spread/total/ML (at most 2)
//                 plus its best TD edge. The legs are linked, so no hit-rate is claimed (prob = null); only the real result is kept.
//   model_best_4  (10/2) the model's own pick, not copied from any bettor: the 4 legs it rates most likely to hit across different games,
//                 mixing home-team moneylines it gives 75%+ and the most likely touchdown scorers; real combined chance recorded.
//   right_now_3   3 legs from "Right now" (Polymarket 3%+ cheaper than fresh sportsbook fair prices), one per game.
import { getRedis, jparse, getJSON, setJSON } from "./redis";
import { nameMatches, winPctMarket } from "./picks";
import { loadSeason } from "./games";
import { loadReplay } from "./replay";
import { addAlert } from "./alerts";
import { spreadOk, totalOk, pickHomeSpread, mlOk, homeWinFromSpread } from "./sane";

export const STRATEGIES = {
  home_fav_95_single: "Home favorites 9.5+ · moneyline · singles",
  home_fav_95_2: "Home favorites 9.5+ · moneyline · 2-leg",
  home_fav_95_3: "Home favorites 9.5+ · moneyline · 3-leg",
  top3_home_75: "3 biggest home favorites (75%+) · moneyline",
  td_edge_3: "3 TD players where the model beats the price",
  td_likely_2: "2 most likely TD scorers · parlay",
  td_likely_3: "3 most likely TD scorers · parlay",
  right_now_3: "3 legs from Right now",
  model_best_4: "Model's 4 most likely legs · different games (winners + scorers)",
  same_game_3: "Same game · best spread/total/ML + a TD (odds unverified)",
  angles_2: "2 proven angles · different games",
  angles_3: "3 proven angles · different games",
  angles_fav_3: "Proven angle + 75%+ home favorites · 3 legs",
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
  // Most likely scorers: highest model chance first, real markets only, nobody on this week's injury report (a Questionable
  // player's chance is already discounted, but a parlay leg that might sit is not a "likely" leg).
  const likely = [];
  for (const g of open) for (const r of g.td || []) {
    if (r.price == null || r.thin || r.stale || r.fair == null || !(r.bid > 0) || /^(out|doubtful|questionable)$/i.test(r.injury || "")) continue;
    likely.push({ game: g.key, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price, prob: r.fair / 100 });
  }
  likely.sort((a, b) => b.prob - a.prob);
  const rn = (data.edgesNow || []).filter((e) => !e.held && e.evNet <= 0.3).map((e) => ({ game: e.game, kind: e.market, label: e.label, price: e.price, prob: e.fair, edge: e.evNet }));
  const onePerGame = (legs, k) => { const out = [], seen = new Set(); for (const l of legs) { if (seen.has(l.game)) continue; seen.add(l.game); out.push(l); if (out.length === k) break; } return out.length === k ? out : null; };
  const P = [];
  const add = (strategy, legs) => { if (legs) P.push({ strategy, legs, pay: legs.reduce((a, l) => a / l.price, 1), prob: legs.every((l) => l.prob != null) ? legs.reduce((a, l) => a * l.prob, 1) : null }); };
  for (const l of favs) add("home_fav_95_single", [l]);
  add("home_fav_95_2", onePerGame(favs, 2)); add("home_fav_95_3", onePerGame(favs, 3));
  add("top3_home_75", onePerGame(strong, 3));
  add("td_edge_3", onePerGame(tds, 3));
  add("td_likely_2", onePerGame(likely, 2)); add("td_likely_3", onePerGame(likely, 3));
  add("right_now_3", onePerGame(rn, 3));
  // Model's own best legs, any type, highest model chance first (games are independent of each other, so the product is a fair chance).
  add("model_best_4", onePerGame([...strong, ...likely].sort((a, b) => b.prob - a.prob), 4));
  // Proven angles (10/8): games flagged on Game Lines (rules that beat break-even in every period 2007-25). Chance = the rule's
  // 19-season hit rate. angles_fav_3 needs at least one angle leg, filled with the strongest home moneyline favorites.
  const ang = [];
  for (const g of open) for (const a of g.angles || []) { const ml = / ML$/.test(a.pick);
    ang.push({ game: g.key, kind: ml ? "ml" : /^(Over|Under) /.test(a.pick) ? "total" : "spread", ...(ml ? { team: a.pick.split(" ")[0] } : {}), label: a.pick, rule: a.id, price: a.price, prob: a.hit / 100 }); }
  ang.sort((a, b) => b.prob - a.prob);
  add("angles_2", onePerGame(ang, 2)); add("angles_3", onePerGame(ang, 3));
  if (ang.length) { const first = ang[0], rest = onePerGame(strong.filter((l) => l.game !== first.game), 2); if (rest) add("angles_fav_3", [first, ...rest]); }
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
  let n = await gradePaperKey(key(season, week), season, week, finals, tdScorers);
  for (const k of await sameGameKeys(season, week)) n += await gradePaperKey(k, season, week, finals, tdScorers);   // same-game records (one per game)
  return n;
}
async function sameGameKeys(season, week) {
  const r = getRedis(), out = []; let c = "0";
  do { const [n, ks] = await r.scan(c, "MATCH", `${key(season, week)}:*`, "COUNT", 200); c = n; out.push(...ks); } while (c !== "0");
  return out;
}
async function gradePaperKey(k, season, week, finals, tdScorers) {
  const rec = await getJSON(k); if (!rec) return 0;
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
    if (p.result && !p.alerted) {   // tell the alerts bell once when a model parlay is decided
      p.alerted = true; changed++;
      await addAlert(season, { kind: "RESULT", game: p.legs[0] ? p.legs[0].game : "", title: `Model parlay ${p.result === "W" ? "hit" : p.result === "L" ? "missed" : "pushed"}: ${STRATEGIES[p.strategy] || p.strategy}`,
        sub: p.legs.map((l) => `${l.label} ${l.result || ""}`.trim()).join(" · "), id: `parlay|${k}|${p.strategy}|${rec.parlays.indexOf(p)}`, ttlH: 24 * 60 });
    }
    if (p.result) p.ret = p.result === "W" ? p.legs.filter((l) => l.result === "W").reduce((a, l) => a / l.price, 1) - 1 : p.result === "P" ? 0 : -1;   // per $1, pushed legs drop out
  }
  if (changed) await setJSON(k, rec);
  return changed;
}


// Lab review (10/2): the loop. Each parlay type is judged by a rule fixed in advance, from its own graded results, so a few lucky or
// unlucky weeks can't steer it. With a model chance on every parlay: compare how often it hit with how often the model said it would
// (z = (hit rate - said) / standard error). Without one (linked same-game legs): judge by return only.
export const LAB_MIN = 30;
export function labReview(b) {
  if (!b || !b.graded) return { verdict: "WAITING", note: "no graded parlays yet" };
  if (b.graded < LAB_MIN) return { verdict: "TOO FEW", note: `${b.graded} of ${LAB_MIN} graded before it is judged` };
  if (b.expN >= b.graded * 0.8 && b.expRate != null) {
    const e = Math.min(0.99, Math.max(0.01, b.expRate)), z = (b.hitRate - e) / Math.sqrt(e * (1 - e) / b.graded);
    if (z < -1.5) return { verdict: "OVERSTATED", note: `hit ${Math.round(b.hitRate * 100)}% vs ${Math.round(e * 100)}% said: its chances run too high`, z };
    if (z > 1.5) return { verdict: "UNDERSTATED", note: `hit ${Math.round(b.hitRate * 100)}% vs ${Math.round(e * 100)}% said: its chances run low`, z };
    return { verdict: "HOLDS", note: `hit ${Math.round(b.hitRate * 100)}% vs ${Math.round(e * 100)}% said`, z };
  }
  return b.roi > 0 ? { verdict: "PAYING", note: `return ${(b.roi * 100).toFixed(0)}% over ${b.graded}` } : { verdict: "LOSING", note: `return ${(b.roi * 100).toFixed(0)}% over ${b.graded}` };
}

// Scoreboard for the Parlay Lab tab: this week's paper parlays + every strategy's record this season.
export async function paperSummary(season, week) {
  const r = getRedis(), board = {}; let c = "0";
  do { const [n, ks] = await r.scan(c, "MATCH", `paper:${season}:*`, "COUNT", 200); c = n;
    for (const k of ks) { const rec = await getJSON(k); for (const p of (rec && rec.parlays) || []) {
      const b = (board[p.strategy] = board[p.strategy] || { recorded: 0, graded: 0, hits: 0, ret: 0, expHits: 0, expN: 0 });
      b.recorded++; if (p.result) { b.graded++; b.hits += p.result === "W" ? 1 : 0; b.ret += p.ret; if (p.prob != null) { b.expHits += p.prob; b.expN++; } } } } } while (c !== "0");
  for (const b of Object.values(board)) { b.roi = b.graded ? b.ret / b.graded : null; b.hitRate = b.graded ? b.hits / b.graded : null; b.expRate = b.expN ? b.expHits / b.expN : null; }
  for (const b of Object.values(board)) b.review = labReview(b);
  const main = (await getJSON(key(season, week))) || null, extra = [];
  for (const k of await sameGameKeys(season, week)) { const rec = await getJSON(k); if (rec && rec.parlays) extra.push(...rec.parlays); }
  const wk = extra.length ? { ...(main || { season, week, t: new Date().toISOString() }), parlays: [...((main && main.parlays) || []), ...extra] } : main;
  return { week: wk, board, names: STRATEGIES };
}

// ---------- Pick Lab: the model's side on EVERY game, recorded at kickoff (paper singles) ----------
// Why (9/30): "model's side" is the pick the model would make on each spread and total. Backtests (2013-25) put it at
// ~51% against the closing line (break-even 52.4%); a "model or market?" picker reached 53.1% in its best setting and a
// median of 51.9% across 24 settings (scrambled labels never got above 51.8%). This measures the plain model side at the
// real kickoff-time Polymarket price, on games it has never seen, with the disagreement size saved so it can be sliced later.
const sg = (n) => (n > 0 ? "+" : "") + n;
export const pkey = (s, w) => `picks:${s}:${w}`;
// Model's side on the spread and the total for one game (nulls when there is no model, no line, or a dead toss-up).
// Schedule situation for a game (10/1): each team's previous result this season, and whether this game is the one before its bye.
export async function situationFor(season, week, g) {
  const rows = (await loadSeason(Number(season))).filter((r) => r.season === Number(season));
  const out = {};
  for (const [side, team] of [["home", g.home], ["away", g.away]]) {
    const mine = rows.filter((r) => r.home === team || r.away === team).sort((a, b) => a.week - b.week);
    const prev = mine.filter((r) => r.week < week && r.final).pop(), next = mine.find((r) => r.week > week);
    const pts = prev ? (prev.home === team ? prev.homeScore : prev.awayScore) : null, opp = prev ? (prev.home === team ? prev.awayScore : prev.homeScore) : null;
    const done = mine.filter((r) => r.week < week && r.final), m3 = done.slice(-3).map((r) => (r.home === team ? r.homeScore - r.awayScore : r.awayScore - r.homeScore));
    out[side] = { prevPts: pts, prevLost: pts != null && pts < opp, prevMarg: pts != null ? pts - opp : null, won3: m3.length === 3 && m3.every((x) => x > 0), preBye: !!next && next.week >= week + 2 };
  }
  // home coach's last-3-seasons ATS record (coach-fade angle)
  try { const row = rows.find((r) => r.key === g.key && r.week === Number(week)); const c = row && row.homeCoach && ((await loadReplay()).coaches || {})[row.homeCoach]; out.homeCoachAts = c || null; } catch { out.homeCoachAts = null; }
  return out;
}
export function picksFor(g, poly, m, sit = null) {
  if (!poly || !m) return [];
  const out = [];
  if (poly.spread && m.homeMargin != null) {
    const hs = poly.spread.homeSpread, gap = m.homeMargin + hs;            // model's home margin minus the market's (-hs)
    const tie = Math.abs(gap) < 0.05 && m.calHomeCover != null && m.calHomeCover !== 50;   // tie: lean the calibrated side (same rule as lib/picks.js)
    if (Math.abs(gap) >= 0.05 || tie) { const home = tie ? m.calHomeCover > 50 : gap > 0;
      out.push({ game: g.key, market: "spread", label: home ? `${g.home} ${sg(hs)}` : `${g.away} ${sg(-hs)}`, line: home ? hs : -hs, price: home ? poly.spread.home : poly.spread.away, gap: tie ? 0 : Math.abs(gap) }); }
  }
  if (poly.total && m.total != null) {
    const gap = m.total - poly.total.line;
    const tie = Math.abs(gap) < 0.05 && m.calUnder != null && m.calUnder !== 50;
    if (Math.abs(gap) >= 0.05 || tie) { const over = tie ? m.calUnder < 50 : gap > 0;
      out.push({ game: g.key, market: "total", label: `${over ? "Over" : "Under"} ${poly.total.line}`, line: poly.total.line, price: over ? poly.total.over : poly.total.under, gap: tie ? 0 : Math.abs(gap) }); }
  }
  // Road underdog of +3 to +6.5 (added 10/1): away covered 52.9% of these in 2007-18 (n=902) and 54.7% in 2019-25 (n=506),
  // 53.6% pooled (n=1,408; break-even 52.4% at -110). Re-verified 10/1 against the nflverse closing lines. Found by scanning
  // dozens of rules, so it is paper-tracked here until it holds on new games.
  if (poly.spread && poly.spread.homeSpread <= -3 && poly.spread.homeSpread >= -6.5)
    out.push({ game: g.key, market: "dog", label: `${g.away} ${sg(-poly.spread.homeSpread)}`, line: -poly.spread.homeSpread, price: poly.spread.away, gap: 0 });
  // Road team in close games (added 10/1): spread within 3 either way. Away covered 51.7% (2007-18) and 53.2% (2019-25), n=1,725.
  if (poly.spread && Math.abs(poly.spread.homeSpread) <= 3)
    out.push({ game: g.key, market: "away3", label: `${g.away} ${sg(-poly.spread.homeSpread)}`, line: -poly.spread.homeSpread, price: poly.spread.away, gap: 0 });
  // Underdog off a loss scoring 10 or fewer (added 10/1): the dog covered 53.6% / 52.1% / 56.5% in 2007-13 / 2014-18 / 2019-25 (n=780).
  if (sit && poly.spread && poly.spread.homeSpread !== 0) { const homeDog = poly.spread.homeSpread > 0, d = homeDog ? sit.home : sit.away;
    if (d && d.prevLost && d.prevPts <= 10) out.push({ game: g.key, market: "lowloss", label: homeDog ? `${g.home} ${sg(poly.spread.homeSpread)}` : `${g.away} ${sg(-poly.spread.homeSpread)}`,
      line: homeDog ? poly.spread.homeSpread : -poly.spread.homeSpread, price: homeDog ? poly.spread.home : poly.spread.away, gap: 0 }); }
  // Home team in the game before its bye, week 8+ (added 10/1): 56.8% / 57.5% / 67.1% (n=150). Small sample, so paper only.
  if (sit && poly.spread && sit.home && sit.home.preBye && g.week >= 8)
    out.push({ game: g.key, market: "prebye", label: `${g.home} ${sg(poly.spread.homeSpread)}`, line: poly.spread.homeSpread, price: poly.spread.home, gap: 0 });
  // Combos (10/8, cross-checked pairs): each found on 2006-16, confirmed on 2017-20 and held on 2021-25.
  // Road dog +3 to +6.5 when it lost its last game by 17+ or the home team won its last by 17+: covered 59% (n=330), 58% in 2021-25.
  const rd = poly.spread && poly.spread.homeSpread <= -3 && poly.spread.homeSpread >= -6.5;
  if (sit && rd && ((sit.away && sit.away.prevMarg != null && sit.away.prevMarg <= -17) || (sit.home && sit.home.prevMarg != null && sit.home.prevMarg >= 17)))
    out.push({ game: g.key, market: "dogblow", label: `${g.away} ${sg(-poly.spread.homeSpread)}`, line: -poly.spread.homeSpread, price: poly.spread.away, gap: 0 });
  // Road team off a loss at a home team on a 3-game win streak: road team covered 58.4% (n=305), 41/41/43% home cover by period.
  if (sit && poly.spread && sit.away && sit.away.prevLost && sit.home && sit.home.won3)
    out.push({ game: g.key, market: "streakfade", label: `${g.away} ${sg(-poly.spread.homeSpread)}`, line: -poly.spread.homeSpread, price: poly.spread.away, gap: 0 });
  // Division game, outdoor wind 10+ mph: Under 56.8% (n=458), 57.4% in 2021-25.
  if (poly.total && m.outdoor && m.wind != null && m.wind >= 10 && m.fix && m.fix.div)
    out.push({ game: g.key, market: "winddiv", label: `Under ${poly.total.line}`, line: poly.total.line, price: poly.total.under, gap: 0 });
  // Road moneyline, spread 2.5-3.5 and total 48+ (10/8): paper only, never flagged (see lib/replay.js).
  if (poly.spread && poly.total && poly.ml && Math.abs(poly.spread.homeSpread) >= 2.5 && Math.abs(poly.spread.homeSpread) <= 3.5 && poly.total.line >= 48 && poly.ml.away > 0)
    out.push({ game: g.key, market: "roadml3", label: `${g.away} ML`, line: 0, price: poly.ml.away, gap: 0 });
  // Coach fade (10/8): road team vs a home coach who covered 44% or less over the previous 3 seasons. 55.1% (n=356), 57/54/54% by period.
  if (sit && poly.spread && sit.homeCoachAts && sit.homeCoachAts.rate <= 0.44)
    out.push({ game: g.key, market: "coachfade", label: `${g.away} ${sg(-poly.spread.homeSpread)}`, line: -poly.spread.homeSpread, price: poly.spread.away, gap: 0 });
  // Windy unders (added 10/1): outdoor games with a 12+ mph kickoff forecast went Under the closing total 56% of the time
  // (54% 2007-12, 58% 2013-18, 57% 2019-25; n=786). One rule out of ~40 scanned, so it is paper-tracked until it holds live.
  if (poly.total && m.outdoor && m.wind != null && m.wind >= 12)
    out.push({ game: g.key, market: "wind", label: `Under ${poly.total.line}`, line: poly.total.line, price: poly.total.under, gap: 0 });
  return out.filter((p) => p.price > 0 && p.price < 1);
}
export async function recordPicks(season, week, g, poly, m, t) {
  const sit = await situationFor(season, week, g).catch(() => null);
  const ps = picksFor({ ...g, week: g.week ?? week }, poly, m, sit); if (!ps.length) return 0;
  for (const p of ps) await getRedis().hset(pkey(season, week), `${p.game}|${p.market}`, JSON.stringify({ ...p, t }));   // last write before kickoff wins
  return ps.length;
}
// Grade every recorded pick of a week whose game is final. A win returns 1/price - 1 per $1; a push returns 0.
export async function gradePicksWeek(season, week, finals) {
  const r = getRedis(), all = await r.hgetall(pkey(season, week)); let n = 0;
  // Remove picks saved with an absurd line (10/4: "MIN +19.5" when the real line was MIN -10): spread-based picks if the spread is off,
  // total picks if the total is off. They would otherwise be graded as real wins/losses.
  for (const g of finals) {
    const home = g.key.split(" @ ")[1], spreadMk = ["spread", "dog", "away3", "lowloss", "prebye", "dogblow", "streakfade", "coachfade"];
    for (const market of [...spreadMk, "total", "winddiv", "wind"]) { const f = `${g.key}|${market}`; if (!all[f]) continue; const p = jparse(all[f]); if (!p) continue;
      const bad = market === "total" || market === "winddiv" || market === "wind" ? !totalOk(Number((String(p.label).match(/(\d+(?:\.\d+)?)$/) || [])[1]), g.nvTotal) : !spreadOk(pickHomeSpread(p.label, home), g.nvSpread);
      if (bad) { await r.hdel(pkey(season, week), f); delete all[f]; } }
  }
  for (const g of finals) for (const market of ["spread", "total", "dog", "away3", "wind", "lowloss", "prebye", "dogblow", "streakfade", "winddiv", "roadml3", "coachfade"]) {
    const f = `${g.key}|${market}`; if (!all[f]) continue; const p = jparse(all[f]); if (!p || p.result) continue;
    const margin = g.homeScore - g.awayScore, tot = g.homeScore + g.awayScore, home = g.key.split(" @ ")[1];
    let x;
    if (market === "roadml3") { const team = p.label.split(" ")[0]; x = team === home ? margin : -margin; }
    else if (market === "spread" || market === "dog" || market === "away3" || market === "lowloss" || market === "prebye" || market === "dogblow" || market === "streakfade" || market === "coachfade") { const team = p.label.split(" ")[0]; x = (team === home ? margin : -margin) + p.line; }
    else x = p.label.startsWith("Over") ? tot - p.line : p.line - tot;
    p.result = x > 0 ? "W" : x < 0 ? "L" : "P"; p.ret = p.result === "W" ? 1 / p.price - 1 : p.result === "L" ? -1 : 0;
    await r.hset(pkey(season, week), f, JSON.stringify(p)); n++;
  }
  return n;
}
export async function picksSummary(season) {
  const r = getRedis(), rows = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `picks:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jparse(v); if (e) rows.push(e); } } while (c !== "0");
  const agg = (xs) => { const d = xs.filter((p) => p.result), w = d.filter((p) => p.result === "W").length, l = d.filter((p) => p.result === "L").length;
    return { recorded: xs.length, graded: d.length, w, l, hit: w + l ? w / (w + l) : null, roi: d.length ? d.reduce((a, p) => a + p.ret, 0) / d.length : null,
      need: d.length ? d.reduce((a, p) => a + p.price, 0) / d.length : null }; };     // avg price paid = the hit rate needed to break even
  const out = {};
  for (const m of ["spread", "total", "dog", "away3", "wind", "lowloss", "prebye"]) { const xs = rows.filter((p) => p.market === m);
    out[m] = m !== "spread" && m !== "total" ? agg(xs) : { ...agg(xs), bands: [["under 2 pts", 0, 2], ["2 to 4", 2, 4], ["4 and up", 4, 99]].map(([label, lo, hi]) => ({ label, ...agg(xs.filter((p) => p.gap >= lo && p.gap < hi)) })) }; }
  return out;
}

// ---------- Most likely winners: the favorite in every game, recorded at kickoff, graded straight up ----------
// "Right" here means who WINS (not the spread). 2007-25: a favorite of -3..-7 won ~67%, -7..-9.5 ~76%, -9.5..-13.5 ~85%, 13.5+ ~90%.
// The chance comes from the market spread (the app's calibrated win chance); the moneyline is the fallback.
export const wkey = (s, w) => `winners:${s}:${w}`;
export function winnerFor(g, poly) {
  const hs = poly && poly.spread ? poly.spread.homeSpread : null;
  let ph = hs != null ? winPctMarket(hs) / 100 : null;
  if (ph == null && poly && poly.ml && poly.ml.home > 0 && poly.ml.away > 0) ph = poly.ml.home / (poly.ml.home + poly.ml.away);
  if (ph == null || Math.abs(ph - 0.5) < 1e-9) return null;
  const home = ph > 0.5; return { game: g.key, team: home ? g.home : g.away, where: home ? "home" : "away", p: home ? ph : 1 - ph };
}
export async function recordWinner(season, week, g, poly, t, m = null) {
  let w = winnerFor(g, poly); if (!w) return 0;
  // A winner whose chance doesn't fit the sportsbook closing spread (10/4: "MIA 95%" at MIN from a corrupt read) is replaced by the
  // sportsbook spread's own favorite, so a bad Polymarket read never becomes a saved pick.
  if (g.nvSpread != null && isFinite(g.nvSpread) && !mlOk(`${w.team} ML`, w.p * 100, g.home, g.nvSpread)) {
    const ph = homeWinFromSpread(g.nvSpread) / 100; if (Math.abs(ph - 0.5) < 1e-9) return 0;
    const home = ph > 0.5; w = { game: g.key, team: home ? g.home : g.away, where: home ? "home" : "away", p: home ? ph : 1 - ph }; }
  // Stats-only winner (10/1): the team the model's own margin favors, no market input; tracked beside the market-based pick.
  const st = m && m.homeMargin != null && m.homeMargin !== 0 ? { statsWhere: m.homeMargin > 0 ? "home" : "away", statsTeam: m.homeMargin > 0 ? g.home : g.away } : {};
  await getRedis().hset(wkey(season, week), g.key, JSON.stringify({ ...w, ...st, week, t }));   // last write before kickoff wins
  return 1;
}
export async function gradeWinnersWeek(season, week, finals) {
  const r = getRedis(), all = await r.hgetall(wkey(season, week)); let n = 0;
  for (const g of finals) { const raw = all[g.key]; if (!raw) continue; const w = jparse(raw); if (!w) continue;
    if (!mlOk(`${w.team} ML`, w.p * 100, g.home, g.nvSpread)) { await r.hdel(wkey(season, week), g.key); continue; }   // a corrupt-read winner counts in no record
    if (w.result) continue;
    const margin = g.homeScore - g.awayScore; w.result = margin === 0 ? "P" : (w.where === "home" ? margin > 0 : margin < 0) ? "W" : "L";
    if (w.statsWhere) w.sres = margin === 0 ? "P" : (w.statsWhere === "home" ? margin > 0 : margin < 0) ? "W" : "L";
    await r.hset(wkey(season, week), g.key, JSON.stringify(w)); n++; }
  return n;
}
export async function winnersSummary(season) {
  const r = getRedis(), rows = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `winners:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jparse(v); if (e) rows.push(e); } } while (c !== "0");
  const agg = (xs) => { const d = xs.filter((x) => x.result === "W" || x.result === "L"), w = d.filter((x) => x.result === "W").length;
    return { n: d.length, w, l: d.length - w, hit: d.length ? w / d.length : null, said: d.length ? d.reduce((a, x) => a + x.p, 0) / d.length : null }; };
  const weeks = {}; for (const x of rows) (weeks[x.week] = weeks[x.week] || []).push(x);
  const top4 = Object.values(weeks).flatMap((xs) => xs.slice().sort((a, b) => b.p - a.p).slice(0, 4));
  const sx = rows.filter((x) => x.sres).map((x) => ({ ...x, result: x.sres, p: 0.5 }));
  return { recorded: rows.length, all: agg(rows), top4: agg(top4), stats: agg(sx),
    bands: [["50-60%", .5, .6], ["60-70%", .6, .7], ["70-80%", .7, .8], ["80%+", .8, 1.01]].map(([label, lo, hi]) => ({ label, ...agg(rows.filter((x) => x.p >= lo && x.p < hi)) })) };
}

// What was actually saved for each game that has kicked off (closing line, the model's picks, the favorite): shown in
// System status so a missing record is visible instead of silent (10/2).
export async function recordedFor(season, week, games, K) {
  const r = getRedis(), pk = await r.hkeys(pkey(season, week)).catch(() => []), out = [];
  for (const g of games.filter((x) => x.started || x.final)) {
    out.push({ game: g.key, close: !!(await r.exists(K.close(season, week, g.key))), picks: pk.filter((k) => k.startsWith(`${g.key}|`)).length, winner: !!(await r.hexists(wkey(season, week), g.key)) });
  }
  return out;
}

// Same-game paper parlay for games that play outside the Sunday slate (no second game to pair with). Pure: returns a parlay or null.
export function buildSameGame(data, gameKey) {
  const g = data.games.find((x) => x.key === gameKey); if (!g || g.started || g.final) return null;
  const lines = (data.edgesNow || []).filter((e) => e.game === gameKey && !e.held && e.evNet > 0 && e.evNet <= 0.3).sort((a, b) => b.evNet - a.evNet);
  const legs = [], kinds = new Set();
  // 1) the biggest sportsbook gaps (spread/moneyline count as one "side" slot, total as another)
  for (const e of lines) { const slot = e.market === "ml" || e.market === "spread" ? "side" : e.market; if (kinds.has(slot)) continue; kinds.add(slot); legs.push({ game: gameKey, kind: e.market, label: e.label, price: e.price, prob: null, edge: e.evNet, src: "gap" }); if (legs.length === 2) break; }
  // 2) the model's own side fills any slot the gaps left empty (there is always a model side, gaps need fresh sportsbook odds)
  if (!kinds.has("side") && g.spreadPick && g.poly && g.poly.spread) { const sp = g.spreadPick, price = sp.side === "home" ? g.poly.spread.home : g.poly.spread.away; if (price > 0 && price < 1) { kinds.add("side"); legs.push({ game: gameKey, kind: "spread", label: sp.label, price, prob: null, edge: null, src: "model" }); } }
  if (!kinds.has("total") && g.totalPick && g.poly && g.poly.total) { const tp = g.totalPick, price = tp.side === "over" ? g.poly.total.over : g.poly.total.under; if (price > 0 && price < 1) { kinds.add("total"); legs.push({ game: gameKey, kind: "total", label: tp.label, price, prob: null, edge: null, src: "model" }); } }
  // 3) one scorer: the biggest touchdown gap, else the model's most likely scorer on a real market who is not ruled out
  let td = null;
  const real = (g.td || []).filter((r) => r.price > 0 && r.price < 1 && !r.thin && !r.stale && r.fair != null && r.bid > 0);
  for (const r of real) { const e = r.fair / 100 / r.price - 1; if (e >= 0.03 && e <= 0.3 && (!td || e > td.edge)) td = { game: gameKey, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price, prob: null, edge: e, src: "gap" }; }
  if (!td) { const top = real.filter((r) => !/^(out|doubtful|questionable)$/i.test(r.injury || "")).sort((a, b) => b.fair - a.fair)[0];
    if (top) td = { game: gameKey, kind: "td", team: top.team, player: top.player, label: `${top.player} TD`, market: top.market, price: top.price, prob: null, edge: null, src: "model" }; }
  if (td) legs.push(td);
  if (legs.length < 2) return null;
  return { strategy: "same_game_3", legs, pay: legs.reduce((a, l) => a / l.price, 1), prob: null };
}
// Record once per game (every game, any day), within ~26 h before its kickoff. Never overwrites.
export async function recordSameGame(season, week, games, getData) {
  const r = getRedis(); let n = 0, data = null;
  for (const g of games) {
    if (!g.kickoff || g.started || g.final) continue;
    const hrs = (new Date(g.kickoff).getTime() - Date.now()) / 3600e3;
    if (hrs < 0 || hrs > 26) continue;
    const k = `${key(season, week)}:${g.key}`; if (await r.exists(k)) continue;
    data = data || (await getData());   // the full week is built only when a game actually needs its record (not on every snapshot)
    const p = buildSameGame(data, g.key); if (!p) continue;
    await setJSON(k, { t: new Date().toISOString(), season, week, game: g.key, parlays: [p] }); n++;
  }
  return n;
}
