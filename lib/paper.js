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
//   model_best_4  (10/2) the model's own pick, not copied from any bettor: the 4 legs it rates most likely to hit across different games,
//                 mixing home-team moneylines it gives 75%+ and the most likely touchdown scorers; real combined chance recorded.
import { getRedis, jparse, getJSON, setJSON } from "./redis";
import { nameMatches, winPctMarket } from "./picks";
import { loadSeason } from "./games";
import { loadReplay } from "./replay";
import { addAlert } from "./alerts";
import { mlOk, homeWinFromSpread } from "./sane";
import { fourLegParlays } from "./sgp";
import { plainLeg, isGreenPick } from "./cardpick";

export const STRATEGIES = {
  home_fav_95_single: "Home favorites 9.5+ · moneyline · singles",
  home_fav_95_2: "Home favorites 9.5+ · moneyline · 2-leg",
  home_fav_95_3: "Home favorites 9.5+ · moneyline · 3-leg",
  top3_home_75: "3 biggest home favorites (75%+) · moneyline",
  td_edge_3: "3 TD players where the model beats the price",
  td_likely_2: "2 most likely TD scorers · parlay",
  td_likely_3: "3 most likely TD scorers · parlay",
  model_best_4: "Model's 4 most likely legs · different games (winners + scorers)",
  best_2: "Best bets · top 2 picks (56%+) · different games",
  best_3: "Best bets · top 3 picks (56%+) · different games",
  best_4: "Best bets · top 4 picks (56%+) · different games (Parlay of the week)",
  sgp_best: "Same game · 2 legs (strong legs)",
  sgp_best_fill: "Same game · 2 legs, filled (fewer than 2 strong legs)",
  sgp_3: "Same game · 3 legs (favorite + Over + its top scorer)",
  sgp_style: "4 legs · my style (spread + total + a TD each team)",
  sgp_style_pts: "4 legs · my style · bought lines (spread + total with points + a TD each team)",
  sgp_linked: "Same game · 4 legs (favorite + Over + its top 2 scorers)",
  leg4_fav: "4 legs · 4 biggest favorites (moneyline)",
  leg4_green_fav: "4 legs · best green pick + 3 biggest favorites",
  leg4_fav_td: "4 legs · 3 biggest favorites + most likely TD scorer",
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
    if (r.price == null || r.stale || r.fair == null || !(r.bid > 0)) continue;       // any market with a buy price (the ask) and a bid
    // 3%+ edge, but not over 30%: the rest of the app treats 30%+ as "recheck -- probably bad data" (a mismatched or
    // stale market), and picking the biggest edges would pick exactly those.
    const p = r.fair / 100, e = p / r.price - 1; if (e >= 0.03 && e <= 0.3) tds.push({ game: g.key, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price, prob: p, edge: p / r.price - 1, ...(r.thin ? { thin: true } : {}) });
  }
  tds.sort((a, b) => b.edge - a.edge);
  // 10/10: thin markets allowed (288 of 311 were thin, so the TD parlays sat empty); a leg on one says 'thin'. The price is the ask --
  // what a Yes costs -- so it is a real price to pay even when the bids are low.
  // Most likely scorers: highest model chance first, real markets only, nobody on this week's injury report (a Questionable
  // player's chance is already discounted, but a parlay leg that might sit is not a "likely" leg).
  const likely = [];
  for (const g of open) for (const r of g.td || []) {
    if (r.price == null || r.stale || r.fair == null || !(r.bid > 0) || /^(out|doubtful|questionable)$/i.test(r.injury || "")) continue;
    likely.push({ game: g.key, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price, prob: r.fair / 100, ...(r.thin ? { thin: true } : {}) });
  }
  likely.sort((a, b) => b.prob - a.prob);
  const onePerGame = (legs, k) => { const out = [], seen = new Set(); for (const l of legs) { if (seen.has(l.game)) continue; seen.add(l.game); out.push(l); if (out.length === k) break; } return out.length === k ? out : null; };
  const P = [];
  const add = (strategy, legs) => { if (legs) P.push({ strategy, legs, pay: legs.reduce((a, l) => a / l.price, 1), prob: legs.every((l) => l.prob != null) ? legs.reduce((a, l) => a * l.prob, 1) : null }); };
  for (const l of favs) add("home_fav_95_single", [l]);
  add("home_fav_95_2", onePerGame(favs, 2)); add("home_fav_95_3", onePerGame(favs, 3));
  add("top3_home_75", onePerGame(strong, 3));
  add("td_edge_3", onePerGame(tds, 3));
  add("td_likely_2", onePerGame(likely, 2)); add("td_likely_3", onePerGame(likely, 3));
  // Model's own best legs, any type, highest model chance first (games are independent of each other, so the product is a fair chance).
  add("model_best_4", onePerGame([...strong, ...likely].sort((a, b) => b.prob - a.prob), 4));
  // Best bets (10/10): the same straight picks as Best bets / Parlay of the week on Game Lines (combo picks + angles, no teasers),
  // best pick per game per market, 56%+, one per game. Before this the Parlay of the week was shown but never saved or graded.
  const bb = [];
  // 10/15 (owner): Best bets are the card's PICK at Polymarket's own line (lib/cardpick.js), green = win rate 56%+, best win rate first
  for (const g of open) for (const k of ["spread", "total"]) { const l = plainLeg(g, k); if (!l || !(l.price > 0 && l.price < 1) || !isGreenPick(l.prob * 100)) continue;
    bb.push({ game: g.key, kind: k, ...(l.team ? { team: l.team } : {}), label: l.label, price: l.price, prob: l.prob, cushion: l.cushion, ...(l.small ? { small: true } : {}) }); }
  bb.sort((a, b) => (!!a.small - !!b.small) || b.prob - a.prob);
  add("best_2", onePerGame(bb, 2)); add("best_3", onePerGame(bb, 3)); add("best_4", onePerGame(bb, 4));
  // 4-leg strategies (10/14 research, lib/sgp.js FOUR_LEG); legs without a Polymarket price yet still count (win/loss only)
  for (const f of fourLegParlays(data.games)) P.push({ strategy: f.strategy, legs: f.legs, pay: f.pay, prob: f.prob, stake: f.stake, ...(f.strong != null ? { strong: f.strong } : {}) });
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
    // a decided parlay keeps grading its other legs (10/11): before, once one leg lost the rest stayed blank after their games ended
    if (p.result && p.legs.every((l) => l.result)) continue;
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
    if (p.result && !p.alerted && !p.noAlert) {   // tell the alerts bell once when a model parlay is decided
      p.alerted = true; changed++;
      await addAlert(season, { kind: "RESULT", game: p.legs[0] ? p.legs[0].game : "", title: `Model parlay ${p.result === "W" ? "hit" : p.result === "L" ? "missed" : "pushed"}: ${STRATEGIES[p.strategy] || p.strategy}`,
        sub: p.legs.map((l) => `${l.label} ${l.result || ""}`.trim()).join(" · "), id: `parlay|${k}|${p.strategy}|${rec.parlays.indexOf(p)}`, ttlH: 24 * 60 });
    }
    if (p.result && p.legs.some((l) => !(l.price > 0))) p.ret = null;   // 10/14: same-game legs saved before Polymarket priced them -- win/loss only
    else if (p.result) p.ret = p.result === "W" ? p.legs.filter((l) => l.result === "W").reduce((a, l) => a / l.price, 1) - 1 : p.result === "P" ? 0 : -1;   // per $1, pushed legs drop out
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
  const dn = b.decided ?? b.graded;   // W/L only (pushes out)
  if (dn && b.expN >= dn * 0.8 && b.expRate != null) {
    const e = Math.min(0.99, Math.max(0.01, b.expRate)), z = (b.hitRate - e) / Math.sqrt(e * (1 - e) / dn);
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
      // 10/14 fix: a pushed parlay is neither a hit nor a miss (it counted as a miss in the hit rate); its return (0) still counts
      b.recorded++; if (p.result) { b.graded++; if (p.ret != null) { b.ret += p.ret; if (p.stake) { b.money = (b.money || 0) + p.ret * p.stake; b.staked = (b.staked || 0) + p.stake; } } else b.noRet = (b.noRet || 0) + 1; if (p.result !== "P") { b.decided = (b.decided || 0) + 1; b.hits += p.result === "W" ? 1 : 0; if (p.prob != null) { b.expHits += p.prob; b.expN++; } } } } } } while (c !== "0");
  for (const b of Object.values(board)) { const nr = b.graded - (b.noRet || 0); b.roi = nr > 0 ? b.ret / nr : null; b.decided = b.decided || 0; b.hitRate = b.decided ? b.hits / b.decided : null; b.expRate = b.expN ? b.expHits / b.expN : null; }
  for (const b of Object.values(board)) b.review = labReview(b);
  const main = (await getJSON(key(season, week))) || null, extra = [];
  for (const k of await sameGameKeys(season, week)) { const rec = await getJSON(k); if (rec && rec.parlays) extra.push(...rec.parlays); }
  const wk = extra.length ? { ...(main || { season, week, t: new Date().toISOString() }), parlays: [...((main && main.parlays) || []), ...extra] } : main;
  return { week: wk, board, names: STRATEGIES };
}

// Schedule situation for a game (10/1): each team's previous result this season, and whether this game is the one before its bye.
export async function situationFor(season, week, g) {
  const rows = (await loadSeason(Number(season))).filter((r) => r.season === Number(season));
  const out = {};
  for (const [side, team] of [["home", g.home], ["away", g.away]]) {
    const mine = rows.filter((r) => r.home === team || r.away === team).sort((a, b) => a.week - b.week);
    // review fix 10/14: "last game" = the team's most recent game before this week; if that game isn't final yet (e.g. next week's
    // card built before Monday night ends) it is UNKNOWN -- never fall back to the game two weeks back (BOUNCE BACK / DOG misfired).
    const lastG = mine.filter((r) => r.week < week).pop(), prev = lastG && lastG.final ? lastG : null, next = mine.find((r) => r.week > week);
    const pts = prev ? (prev.home === team ? prev.homeScore : prev.awayScore) : null, opp = prev ? (prev.home === team ? prev.awayScore : prev.homeScore) : null;
    const unk = !!lastG && !lastG.final;   // 10/14: last game still being played -> streaks / two-games-back are unknown too (they used older games)
    const done = mine.filter((r) => r.week < week && r.final), m3 = unk ? [] : done.slice(-3).map((r) => (r.home === team ? r.homeScore - r.awayScore : r.awayScore - r.homeScore));
    const oppTeam = side === "home" ? g.away : g.home, mg = (r) => (r.home === team ? r.homeScore - r.awayScore : r.awayScore - r.homeScore);
    const prev2 = !unk && done.length >= 2 ? done[done.length - 2] : null;
    // 10/13: last game against the spread (nflverse closing line; + = covered by that many points)
    const prevAts = prev && pts != null && prev.nvSpread != null ? (prev.home === team ? (pts - opp) - prev.nvSpread : (pts - opp) + prev.nvSpread) : null;
    out[side] = { prevPts: pts, prevLost: pts != null && pts < opp, prevMarg: pts != null ? pts - opp : null, prevAts, won3: m3.length === 3 && m3.every((x) => x > 0), preBye: !!next && next.week >= week + 2,
      // 10/9 research factors: previous game overtime / Monday / international / division win, next game division, revenge, road trip, record
      prevOT: !!(prev && prev.overtime), prevMon: !!(prev && prev.weekday === "Monday"), prevIntl: !!(prev && prev.neutral), prevDivWin: !!(prev && prev.div && mg(prev) > 0), prevDiv: !!(prev && prev.div),
      nextDiv: !!(next && next.div), revenge: done.some((r) => (r.home === oppTeam || r.away === oppTeam) && mg(r) < 0),
      prevAway: !!(prev && prev.away === team), prev2Away: !!(prev2 && prev2.away === team), winPct: done.length ? done.filter((r) => mg(r) > 0).length / done.length : null };
  }
  // Starters out this week (10/10, combo factors): official Out/Doubtful + snap counts.
  try { const [{ loadSnaps, startersOut }, { loadInjuries }] = await Promise.all([import("./snaps"), import("./injuries")]); const [sn, inj] = await Promise.all([loadSnaps(), loadInjuries()]);
    for (const [side, team] of [["home", g.home], ["away", g.away]]) out[side].inj = startersOut(sn[team], inj[team], week); } catch {}
  // home coach's last-3-seasons ATS record (coach-fade angle)
  try { const row = rows.find((r) => r.key === g.key && r.week === Number(week)); const c = row && row.homeCoach && ((await loadReplay()).coaches || {})[row.homeCoach]; out.homeCoachAts = c || null; } catch { out.homeCoachAts = null; }
  // Books moved, Polymarket lagged (10/9): first vs latest saved snapshot this week, sportsbook spread vs Polymarket spread.
  try { const { getRedis: gr, K: KK, jparse: jp } = await import("./redis"); const sn = ((await gr().lrange(KK.snaps(season, week, g.key), 0, -1)) || []).map(jp).filter((x) => x && x.books && x.books.spread && x.poly && x.poly.spread);
    if (sn.length >= 2) out.bookMove = { db: sn[sn.length - 1].books.spread.homeSpread - sn[0].books.spread.homeSpread, dp: sn[sn.length - 1].poly.spread.homeSpread - sn[0].poly.spread.homeSpread }; } catch {}
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
  const r = getRedis(), pk = await r.hkeys(`stack:${season}:${week}`).catch(() => []), out = [];   // the card picks saved at kickoff
  for (const g of games.filter((x) => x.started || x.final)) {
    out.push({ game: g.key, close: !!(await r.exists(K.close(season, week, g.key))), picks: pk.filter((k) => k.startsWith(`${g.key}|`)).length, card: pk.filter((k) => k.startsWith(`${g.key}|cardpick`)).length, winner: !!(await r.hexists(wkey(season, week), g.key)) });
  }
  return out;
}

