// Parlay Lab (added 9/30): PAPER parlays only -- nothing is bet. Each week the app saves fixed parlay types at the Polymarket prices of that
// moment, grades them when the games finish, and keeps a scoreboard. Since 10/19 the weekly types are the Best Legs (best_2 / best_3 / td_likely_2 /
// td_likely_3); same-game parlays are saved per game by lib/sgp.js. Names of retired types stay in STRATEGIES so their graded history still reads.
import { getRedis, jparse, getJSON, setJSON } from "./redis";
import { nameMatches, winPctMarket } from "./picks";
import { loadSeason } from "./games";
import { espnOutFor } from "./espn";
import { sameName } from "./snaps";
import { loadReplay } from "./replay";
import { mlOk, homeWinFromSpread } from "./sane";
import { comboPay } from "./combo";
import { plainLeg, isGreenPick } from "./cardpick";
import { weekStats, gradePropLeg, PROP_RECHECKS, PROP_RECHECK_H } from "./props";

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
  sgp_upset: "Same game · Upset (underdog wins + its lead RB scores)",
  sgp_st: "Same game · spread + total (the card's two PICKs)",
  leg4_td4: "4 legs · 4 most likely TD scorers (one per game)",
  pp6: "Player props · 6 legs",
  pp8: "Player props · 8 legs",
  pp10: "Player props · 10 legs",
};
const key = (s, w) => `paper:${s}:${w}`;
const homeSpread = (g) => (g.poly && g.poly.spread ? g.poly.spread.homeSpread : g.books && g.books.spread ? g.books.spread.homeSpread : null);

// Best Legs (10/19, owner: "start picking better ... you choose"): the parlays built ONLY from the app's strongest legs -- the card's green PICKs
// (56%+, one per game) and the model's most likely TD scorers (nobody on the injury report, one per game), 2 or 3 legs, different games.
// Saved and graded every week since 10/10 with the other paper parlays; Model bets shows them under "Best Legs".
export const BEST_LEGS = ["best_2", "best_3", "td_likely_2", "td_likely_3"];
export const BEST_STAKE = { best_2: 10, best_3: 10, td_likely_2: 10, td_likely_3: 10 };
const TD_LIKELY = 0.55;   // 10/26 night (owner): every TD leg in any parlay is 55%+ (the Best TD picks bar). Walk-forward TD model 2021-25, one scorer per game:
                          // pair hit 48.1% (said 39.3, 79 weeks) and triple 33.8% (said 23.7, 68 weeks) with the bar vs 46.7 / 32.2 without (90 weeks); live 3 of 7
function likelyLegs(open) {   // most likely scorers at 55%+: highest model chance first, real markets only, nobody on this week's injury report
  const likely = [];
  for (const g of open) for (const r of g.td || []) {
    if (r.price == null || r.stale || r.fair == null || !(r.bid > 0) || r.fair / 100 < TD_LIKELY || /^(out|doubtful|questionable)$/i.test(r.injury || "")) continue;
    likely.push({ game: g.key, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price, prob: r.fair / 100, ...(r.thin ? { thin: true } : {}) });
  }
  return likely.sort((a, b) => b.prob - a.prob);
}
function greenLegs(open) {   // the card's PICK at Polymarket's own line, green (56%+), best win rate first (10/23 night: the ML pick too)
  const bb = [];
  for (const g of open) for (const k of ["spread", "total", "ml"]) { const l = plainLeg(g, k); if (!l || !(l.price > 0 && l.price < 1) || !isGreenPick(l.prob * 100)) continue;
    bb.push({ game: g.key, kind: k, ...(l.team ? { team: l.team } : {}), label: l.label, price: l.price, prob: l.prob, cushion: l.cushion, ...(l.small ? { small: true } : {}) }); }
  return bb.sort((a, b) => (!!a.small - !!b.small) || b.prob - a.prob);
}
const onePer = (legs, k) => { const out = [], seen = new Set(); for (const l of legs) { if (seen.has(l.game)) continue; seen.add(l.game); out.push(l); if (out.length === k) break; } return out.length === k ? out : null; };
export function bestLegParlays(games) {
  const open = (games || []).filter((g) => !g.started && !g.final), bb = greenLegs(open), likely = likelyLegs(open), out = [];
  for (const [strategy, legs] of [["best_2", onePer(bb, 2)], ["best_3", onePer(bb, 3)], ["td_likely_2", onePer(likely, 2)], ["td_likely_3", onePer(likely, 3)]])
    if (legs) out.push({ strategy, legs, pay: comboPay(legs), prob: legs.every((l) => l.prob != null) ? legs.reduce((a, l) => a * l.prob, 1) : null, stake: BEST_STAKE[strategy] });
  return out;
}

// Build this week's paper parlays from the page data (lib/week.js buildWeek), only games that haven't started.
// 10/19 review (owner: "delete what is not helping"): the week's saved parlays are the Best Legs only (2 / 3 best green picks, 2 / 3 most likely
// TD scorers) -- the ones Model bets shows. The old paper strategies never shown anywhere (home favorites 9.5+ singles / 2 / 3 legs, 3 biggest home
// favorites, 3 TD value picks) and the 4-leg types are no longer built; their saved records stay graded history.
// 10/21 night (owner: "build for nfl also ... We need to get these graded and picked"): Player props parlays, 6 / 8 / 10 legs, $5 each -- the week's
// prop rows (lib/props.js propLegsForWeek: the page's rows, one leg per player, strongest first) across the games not started; none when there are
// fewer rows than legs. Chance = the legs' product, payout = the legs' prices multiplied (no link measured), like the NBA Prop Parlays. Saved with
// the week's paper (recordPaper: rebuilt until one of its legs' games starts, then locked), graded from the official stats.
export const PROP_PARLAY_LEGS = [6, 8, 10];
export const PROP_PARLAY_STAKE = 5;
const PSTAT = { rec_yds: "Rec Yds", rec: "Receptions", pass_yds: "Pass Yds" };
const propPay = (legs) => (legs.every((l) => l.price > 0 && l.price < 1) ? Math.round(legs.reduce((a, l) => a / l.price, 1) * 100) / 100 : null);
export function propParlays(propLegs) {
  const out = [];
  for (const n of PROP_PARLAY_LEGS) { if (!propLegs || propLegs.length < n) break;
    const legs = propLegs.slice(0, n).map((l) => ({ game: l.game, kind: "prop", team: l.team || null, player: l.name, stat: l.stat, side: l.side, line: l.line,
      label: `${l.name} ${PSTAT[l.stat] || l.stat} ${l.side === "over" ? "Over" : "Under"} ${l.line}`, price: l.price, prob: l.cal ?? l.chance }));   // 10/23: the calibrated %
    out.push({ strategy: `pp${n}`, legs, pay: propPay(legs), prob: legs.reduce((a, l) => a * l.prob, 1), stake: PROP_PARLAY_STAKE }); }
  return out;
}
export function buildPaper(data) { return [...bestLegParlays(data.games), ...propParlays(data.propLegs)]; }

// Record once per week, ~a day before the Sunday slate (called by scheduled snapshots). Later calls never overwrite.
export async function recordPaper(season, week, data) {
  const k = key(season, week);
  if (await getRedis().exists(k)) {
    // 10/18 (owner: "fix the gaps"): a parlay type added after the week was saved (the 4 most likely TD scorers, added Saturday 4:39 PM, after the
    // Saturday 7 AM save) is added ONCE, only while none of its games has started. 10/19 (owner: "start making better decisions on parlays"):
    // every saved type is also REBUILT on each scheduled snapshot until one of its legs' games starts -- the Saturday copy could not see Sunday's
    // inactives and news (a leg ruled out on Sunday morning stayed in and was graded). A type with a started leg is never changed.
    const rec = await getJSON(k); if (!rec || !Array.isArray(rec.parlays)) return 0;
    const started = new Set(data.games.filter((g) => g.started || g.final).map((g) => g.key)), live = (p) => (p.legs || []).length && p.legs.every((l) => l.game && !started.has(l.game));
    const have = new Set(rec.parlays.map((p) => p.strategy));
    const fresh = buildPaper(data), byType = (xs) => xs.reduce((m, p) => ((m[p.strategy] = m[p.strategy] || []).push(p), m), {});
    const oldT = byType(rec.parlays), newT = byType(fresh), t = new Date().toISOString();
    let changed = 0; const out = [];
    for (const st of new Set([...Object.keys(oldT), ...Object.keys(newT)])) {
      const o = oldT[st] || [], n = (newT[st] || []).filter(live);
      // also adds a type that had no legs at the save but has them now. 10/19 check: a build with NO parlay of a type (a failed model / TD data load
      // at the last snapshot before kickoff would empty it) keeps the saved copy -- it never deletes one
      const canSwap = n.length > 0 && o.every(live) && (newT[st] || []).every(live);
      const same = JSON.stringify(o.map((p) => p.legs.map((l) => l.label))) === JSON.stringify(n.map((p) => p.legs.map((l) => l.label)));
      if (canSwap && !same) { out.push(...n.map((p) => ({ ...p, [have.has(st) ? "refreshedAt" : "addedAt"]: t }))); changed++; } else out.push(...o);
    }
    if (!changed) return 0;
    await setJSON(k, { ...rec, parlays: out });
    return changed;
  }
  const sundays = data.games.filter((g) => g.kickoff && new Date(g.kickoff).getUTCDay() === 0 && !g.started).map((g) => new Date(g.kickoff).getTime());
  if (!sundays.length) return 0;
  const hrs = (Math.min(...sundays) - Date.now()) / 3600e3;
  if (hrs > 26 || hrs < 0) return 0;                                       // Saturday evening / Sunday morning snapshot
  const parlays = buildPaper(data);
  await setJSON(k, { t: new Date().toISOString(), season, week, parlays });
  return parlays.length;
}

// Grade from final scores + TD scorers (grade.js passes them). A parlay loses as soon as one leg loses.
export async function gradePaper(season, week, finals, tdScorers, now = Date.now()) {
  let n = await gradePaperKey(key(season, week), season, week, finals, tdScorers, now);
  for (const k of await sameGameKeys(season, week)) n += await gradePaperKey(k, season, week, finals, tdScorers, now);   // same-game records (one per game)
  return n;
}
async function sameGameKeys(season, week) {
  const r = getRedis(), out = []; let c = "0";
  do { const [n, ks] = await r.scan(c, "MATCH", `${key(season, week)}:*`, "COUNT", 200); c = n; out.push(...ks); } while (c !== "0");
  return out;
}
async function gradePaperKey(k, season, week, finals, tdScorers, now = Date.now()) {
  const rec = await getJSON(k); if (!rec) return 0;
  const byKey = Object.fromEntries(finals.map((g) => [g.key, g])); let changed = 0;
  for (const p of rec.parlays) {
    // 10/26: a decided parlay with player-prop legs is re-graded from fresh stats twice more, 20+ h apart, like the Props page rows
    // (props.js PROP_RECHECKS); its result and money follow the corrected legs
    const done = p.result && p.legs.every((l) => l.result), again = done && p.legs.some((l) => l.kind === "prop") && (p.rechecks || 0) < PROP_RECHECKS
      && now - Date.parse(p.checkedAt || p.gradedAt || 0) >= PROP_RECHECK_H * 3600e3;
    // a decided parlay keeps grading its other legs (10/11): before, once one leg lost the rest stayed blank after their games ended
    if (done && !again) continue;
    let fixed = 0, read = !again;
    const had = p.result;
    for (const l of p.legs) {
      if (l.result && !(again && l.kind === "prop")) continue;
      if (l.kind === "prop" && l.result) { const st = await weekStats(season, week).catch(() => null), gp = gradePropLeg(l, st && st.games ? st.games[l.game] : null, st && st.snaps ? st.snaps[l.game] : null);
        if (gp) { read = true; if (gp.result !== l.result || gp.actual !== l.actual) fixed++; l.result = gp.result; l.actual = gp.actual; } continue; }
      const g = byKey[l.game]; if (!g) continue;
      const [away, home] = l.game.split(" @ "), margin = g.homeScore - g.awayScore;
      if (l.kind === "ml") l.result = margin === 0 ? "P" : (l.team === home ? margin > 0 : margin < 0) ? "W" : "L";
      else if (l.kind === "spread") { const m = l.label.match(/^(\S+) ([+-]?\d+(?:\.\d+)?)$/); if (m) { const x = (m[1] === home ? margin : -margin) + Number(m[2]); l.result = x > 0 ? "W" : x < 0 ? "L" : "P"; } }
      else if (l.kind === "total") { const m = l.label.match(/^(Over|Under) (\d+(?:\.\d+)?)$/); if (m) { const tot = g.homeScore + g.awayScore, x = m[1] === "Over" ? tot - Number(m[2]) : Number(m[2]) - tot; l.result = x > 0 ? "W" : x < 0 ? "L" : "P"; } }
      else if (l.kind === "td") { const sc = await tdScorers(season, week, l.game); if (sc) l.result = sc.some((s) => nameMatches(l.player, s) && (!sc.teams || !sc.teams[s] || sc.teams[s].includes(l.team))) ? "W" : "L"; }
      else if (l.kind === "prop") { const st = await weekStats(season, week).catch(() => null), gp = gradePropLeg(l, st && st.games ? st.games[l.game] : null, st && st.snaps ? st.snaps[l.game] : null); if (gp) { l.result = gp.result; l.actual = gp.actual; } }
      if (l.result) changed++;
    }
    if (p.legs.some((l) => l.result === "L")) p.result = "L";
    else if (p.legs.every((l) => l.result)) p.result = p.legs.every((l) => l.result === "P") ? "P" : "W";
    if (p.result && p.legs.some((l) => !(l.price > 0))) p.ret = null;   // 10/14: same-game legs saved before Polymarket priced them -- win/loss only
    else if (p.result) p.ret = p.result === "W" ? (p.legs.every((l) => l.kind === "prop") ? propPay(p.legs.filter((l) => l.result === "W")) : comboPay(p.legs.filter((l) => l.result === "W"))) - 1 : p.result === "P" ? 0 : -1;   // per $1, pushed legs drop out (prop parlays: the legs' prices multiplied)
    if (!had && p.result) p.gradedAt = new Date(now).toISOString();
    if (again && read) { p.rechecks = (p.rechecks || 0) + 1; p.checkedAt = new Date(now).toISOString(); if (fixed) p.fixed = (p.fixed || 0) + fixed; changed++; }
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
      b.recorded++; if (p.result) { b.graded++; if (p.ret != null) { b.ret += p.ret; const stk = p.stake || BEST_STAKE[p.strategy]; if (stk) { b.money = (b.money || 0) + p.ret * stk; b.staked = (b.staked || 0) + stk; } } else b.noRet = (b.noRet || 0) + 1; if (p.result !== "P") { b.decided = (b.decided || 0) + 1; b.hits += p.result === "W" ? 1 : 0; if (p.prob != null) { b.expHits += p.prob; b.expN++; } } } } } } while (c !== "0");
  for (const b of Object.values(board)) { const nr = b.graded - (b.noRet || 0); b.roi = nr > 0 ? b.ret / nr : null; b.decided = b.decided || 0; b.hitRate = b.decided ? b.hits / b.decided : null; b.expRate = b.expN ? b.expHits / b.expN : null; }
  for (const b of Object.values(board)) b.review = labReview(b);
  // 10/17 (owner: "are you learning from it"): every graded leg this season by kind, and which kind lost the parlays (a lost parlay counts each losing leg's kind once).
  // 10/18 fix: only the parlay types still built (STRATEGIES; the 10/14 cuts like angles / alt picks are left out), and a leg that sits in several parlays counts ONCE (week + game + label).
  const legs = {}, killers = {}, seen = new Set(); c = "0";
  do { const [n, ks] = await r.scan(c, "MATCH", `paper:${season}:*`, "COUNT", 200); c = n;
    for (const k of ks) { const rec = await getJSON(k), wk = k.split(":")[2]; for (const p of (rec && rec.parlays) || []) { if (!p.result || !STRATEGIES[p.strategy]) continue;
      const lostKinds = new Set();
      for (const l of p.legs || []) { const kd = legKind(l); if (!kd) continue; if (l.result === "L") lostKinds.add(kd);
        const id = `${wk}|${l.game}|${l.label}`; if (seen.has(id) || (l.result !== "W" && l.result !== "L")) continue; seen.add(id);
        const x = (legs[kd] = legs[kd] || { w: 0, l: 0 }); if (l.result === "W") x.w++; else x.l++; }
      if (p.result === "L") for (const kd of lostKinds) killers[kd] = (killers[kd] || 0) + 1; } } } while (c !== "0");
  const main = (await getJSON(key(season, week))) || null, extra = [];
  for (const k of await sameGameKeys(season, week)) { const rec = await getJSON(k); if (rec && rec.parlays) extra.push(...rec.parlays); }
  const wk = extra.length ? { ...(main || { season, week, t: new Date().toISOString() }), parlays: [...((main && main.parlays) || []), ...extra] } : main;
  return { week: wk, board, names: STRATEGIES, legs, killers };
}
// leg kind for the review: td / ml / spread / over / under
export const legKind = (l) => (l.kind === "total" ? (l.side === "under" || /^Under/.test(l.label || "") ? "under" : "over") : ["td", "ml", "spread", "prop"].includes(l.kind) ? l.kind : null);

// Schedule situation for a game (10/1): each team's previous result this season, and whether this game is the one before its bye.
// ESPN Out / Doubtful entries (posted after the team's last game) override or join the official list as status "Out" this week, so the starters-out
// counts see the news when ESPN has it. Same rule as the model rerun (pages/api/rerun.js injFor) and the TD tab.
export function withEspnOuts(teamInjuries, espnList, team, kickoff, seasonRows, week) {
  const off = (teamInjuries || []).map((x) => ({ ...x }));
  for (const e of espnList || []) { if (!espnOutFor(e, team, kickoff, seasonRows)) continue;
    const i = off.findIndex((x) => sameName(x.name, e.name)); if (i >= 0) off[i].status = "Out"; else off.push({ name: e.name, pos: e.pos, status: "Out", week: Number(week) }); }
  return off;
}
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
  // Starters out this week (10/10, combo factors): official Out/Doubtful + snap counts. 10/16 (owner's pass): ESPN's "ruled out" news counts too -- the official report
  // marks a player Out only on Friday (Hurts was "DNP" there on Thursday while ESPN, the alert and the model already had him out), so INJURY and INJURY EARLY saw nothing until the line had moved.
  try { const [{ loadSnaps, startersOut }, { loadInjuriesMeta }, { loadEspnInjuries }] = await Promise.all([import("./snaps"), import("./injuries"), import("./espn")]);
    const [sn, meta, espn] = await Promise.all([loadSnaps(), loadInjuriesMeta(), loadEspnInjuries().catch(() => null)]);
    const inj = meta.teams || {};
    for (const [side, team] of [["home", g.home], ["away", g.away]]) { out[side].inj = startersOut(sn[team], withEspnOuts(inj[team], espn && espn.teams ? espn.teams[team] : null, team, g.kickoff, rows, week), week);
      // 10/20: the same count on the official report of the team's PREVIOUS game week (bye-aware) -- INJURY fires only on a NEW injury
      // (history 2014-25: first week 58.2% on 146, continuing 54.4% on 114, QB out new 66.7% vs continuing 53.5%).
      const pg = rows.filter((r) => (r.home === team || r.away === team) && r.week < Number(week)).sort((a, b) => a.week - b.week).pop();
      out[side].injPrev = pg ? startersOut(sn[team], ((meta.outs || {})[team] || []).filter((x) => x.week === pg.week), pg.week) : null; } } catch {}
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
    out.push({ game: g.key, close: !!(await r.exists(K.close(season, week, g.key))), picks: pk.filter((k) => k.startsWith(`${g.key}|`)).length, card: pk.filter((k) => (k.startsWith(`${g.key}|cardpick`) || k.startsWith(`${g.key}|modelpick`))).length, winner: !!(await r.hexists(wkey(season, week), g.key)) });
  }
  return out;
}

