// Combo picks (10/9): every factor tested today (weather, surface, division, spread and total size, our game model's lean and
// size, the line's move since open, plus the ideas that failed alone), alone and in pairs, for 9 bet types. Kept only pairs that
// beat that bet's normal win rate in all three periods (2014-17 / 2018-21 / 2022-25), with 60+ games. Sources: nflverse results,
// aussportsbetting.com opening lines, and this app's game model replayed week by week on 2014-25 (no look-ahead).
// Luck check (10/9): shuffled results passed about as many pairs as the real ones, so several of these may be luck. Used anyway
// (10/9, your call); each one is graded live in Results. Held on 2006-13: road dog +6, turf dog +6. Faded there: big fav + low total.
// Referee crews also showed up (dog +6 85% with a low-scoring crew) but crews aren't in our data before kickoff, so not used.
import { getRedis } from "./redis";

const sg = (x) => (x > 0 ? `+${x}` : `${x}`);
// m = our game model (homeMargin, total, wind, outdoor, fix.div, fix.turf); hs = home spread (negative = home favored);
// tl = total; hsOpen / tlOpen = the week's first saved lines.
export function stackPicks(g, m, hs, tl, hsOpen = null, tlOpen = null) {
  if (!m || hs == null || tl == null || hs === 0) return [];
  const out = [], fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, sp = Math.abs(hs);
  const gap = m.homeMargin != null ? m.homeMargin + hs : null;                 // + = model likes home vs the line
  const likesFav = gap == null ? null : (gap > 0) === (fav === g.home), big = gap != null && Math.abs(gap) >= 3;
  const tg = m.total != null ? m.total - tl : null;                            // + = model Over
  const wind = m.outdoor && m.wind != null ? m.wind : 0, turf = !!(m.fix && m.fix.turf), dome = g.outdoor === false;
  const div = !!(m.fix && m.fix.div), road = dog === g.away;
  const dogOpen = hsOpen != null ? (dog === g.home ? hsOpen : -hsOpen) : null, dogMoved = dogOpen != null ? sp - dogOpen : null; // - = toward the dog
  const tMove = tlOpen != null ? tl - tlOpen : null;
  const add = (id, why, pick, hit, n, bet) => out.push({ id, why, pick, hit, n, ...bet });
  const sideBet = (team, line) => ({ kind: "spread", team, line });
  const totBet = (side, line) => ({ kind: "total", side, line });
  if (wind >= 15 && likesFav === true) add("favwind", "Wind 15+ · model likes the favorite", `${fav} ${sg(-sp)}`, 70.3, 74, sideBet(fav, -sp));
  if (wind >= 10 && likesFav === false && big) add("underwinddog", "Wind 10+ · model likes the dog by 3+", `Under ${tl}`, 68.4, 114, totBet("under", tl));
  if (wind >= 10 && tg != null && tg > 0) add("windover6", `Wind 10+ · model says Over${tg >= 3 ? " by 3+" : ""}`, `Under ${tl + 6}`, tg >= 3 ? 83.3 : 80.8, tg >= 3 ? 102 : 281, totBet("under", tl + 6));
  if (sp >= 7 && tl <= 41) add("bigfavlow", "Favorite 7+ · total 41 or less", `Over ${tl - 6}`, 81.7, 115, totBet("over", tl - 6));
  else if (sp >= 7 && likesFav === true && big) add("bigfavmodel", "Favorite 7+ · model likes it by 3+", `Over ${tl - 6}`, 79.7, 64, totBet("over", tl - 6));
  if (likesFav === true && big && tg != null && tg < 0) add("favunder", "Model: favorite by 3+ and Under", `Over ${tl}`, 57.8, 109, totBet("over", tl));
  if (sp >= 1.5 && sp <= 2.5 && dome && likesFav === false) add("domedog6", "Dome · model likes the dog", `${dog} ${sg(sp + 6)}`, 85.0, 80, sideBet(dog, sp + 6));
  if (sp <= 3 && road) add("roaddog6", "Road dog of 3 or less, +6", `${dog} ${sg(sp + 6)}`, 75.3, 497, sideBet(dog, sp + 6));
  else if (sp <= 3 && turf) add("turfdog6", "Turf · dog of 3 or less, +6", `${dog} ${sg(sp + 6)}`, 75.8, 380, sideBet(dog, sp + 6));
  if (tl <= 41 && dogMoved != null && dogMoved <= -1) add("lowmovefav6", "Total 41 or less · line moved 1+ toward the dog", `${fav} ${sg(-sp + 6)}`, 80.5, 87, sideBet(fav, -sp + 6));
  if (tl >= 47 && tMove != null && tMove >= 3) add("totupfav6", "Total 47+ and up 3+ since open", `${fav} ${sg(-sp + 6)}`, 77.2, 92, sideBet(fav, -sp + 6));
  if (div && tl <= 41) add("divlowdog", "Division game · total 41 or less", `${dog} ${sg(sp)}`, 56.6, 189, sideBet(dog, sp));
  return out;
}
import { COMBO_TABLE } from "./combotable";
// Factor names as in the scan (python), computed from what the app knows before kickoff. sit = situationFor() (prev games, coach).
export function comboFactors(g, m, hs, tl, hsOpen = null, tlOpen = null, sit = null, week = null) {
  if (!m || hs == null || tl == null || hs === 0) return null;
  const homeDog = hs > 0, sp = Math.abs(hs), gap = m.homeMargin != null ? m.homeMargin + hs : null, tg = m.total != null ? m.total - tl : null;
  const wind = m.outdoor && m.wind != null ? m.wind : 0, turf = !!(m.fix && m.fix.turf);
  const likesHome = gap != null ? gap > 0 : null, mdlDog = likesHome == null ? null : homeDog ? likesHome : !likesHome;
  const mvdog = hsOpen != null ? (homeDog ? hs - hsOpen : hsOpen - hs) : null, tmv = tlOpen != null ? tl - tlOpen : null;
  const S = sit || {}, dogS = (homeDog ? S.home : S.away) || {}, favS = (homeDog ? S.away : S.home) || {};
  const F = { turf, grass: !turf && g.outdoor !== false, dome: g.outdoor === false, wind10: wind >= 10, wind15: wind >= 15, div: !!(m.fix && m.fix.div),
    early: week != null && week <= 4, late: week != null && week >= 13, prime: etHour(g.kickoff) >= 19, homeDog, roadDog: !homeDog,
    "sp>=7": sp >= 7, "sp<=3": sp <= 3, "tot>=47": tl >= 47, "tot<=41": tl <= 41,
    mdlDog: mdlDog === true, mdlFav: mdlDog === false, mdlDog3: mdlDog === true && Math.abs(gap) >= 3, mdlFav3: mdlDog === false && Math.abs(gap) >= 3,
    mdlU: tg != null && tg < 0, mdlO: tg != null && tg > 0, mdlU3: tg != null && tg <= -3, mdlO3: tg != null && tg >= 3,
    mvDog1: mvdog != null && mvdog >= 1, mvFav1: mvdog != null && mvdog <= -1,
    totUp2: tmv != null && tmv >= 2, totDn2: tmv != null && tmv <= -2, totUp3: tmv != null && tmv >= 3, totDn3: tmv != null && tmv <= -3,
    dogOffLoss: dogS.prevMarg != null && dogS.prevMarg < 0, dogOffBlow: dogS.prevMarg != null && dogS.prevMarg <= -17,
    favOffWin: favS.prevMarg != null && favS.prevMarg > 0, favOffLoss: favS.prevMarg != null && favS.prevMarg < 0,
    favStreak3: !!favS.won3, dogStreak3: !!dogS.won3, homePrebye: !!(S.home && S.home.preBye) && week >= 8, awayPrebye: !!(S.away && S.away.preBye) && week >= 8,
    dogLowScorePrev: dogS.prevPts != null && dogS.prevPts <= 10 && dogS.prevMarg < 0, homeCoachBad: !!(S.homeCoachAts && S.homeCoachAts.rate <= 0.44) };
  return { F, homeDog, sp, fav: homeDog ? g.away : g.home, dog: homeDog ? g.home : g.away };
}
const MODEL_F = /^mdl/;
function etHour(k) { if (!k) return null; try { return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(k))); } catch { return null; } }
// Every combo from the table that fits this game; the best one per bet type.
export function tablePicks(g, m, hs, tl, hsOpen, tlOpen, sit, week) {
  const c = comboFactors(g, m, hs, tl, hsOpen, tlOpen, sit, week); if (!c) return [];
  const { F, sp, fav, dog } = c, best = {};
  for (const [bet, fs, win, n] of COMBO_TABLE) {
    if (!fs.every((f) => F[f])) continue;
    if (bet.startsWith("DOG6") && !(sp >= 1.5 && sp <= 2.5)) continue;
    if (!best[bet] || win > best[bet][1]) best[bet] = [fs, win, n];
  }
  const NM = { turf: "turf", grass: "grass", dome: "dome", wind10: "wind 10+", wind15: "wind 15+", div: "division game", early: "weeks 1–4", late: "week 13+", prime: "primetime",
    homeDog: "home dog", roadDog: "road dog", "sp>=7": "spread 7+", "sp<=3": "spread 3 or less", "tot>=47": "total 47+", "tot<=41": "total 41 or less",
    mdlDog: "model likes the dog", mdlFav: "model likes the favorite", mdlDog3: "model likes the dog by 3+", mdlFav3: "model likes the favorite by 3+",
    mdlU: "model Under", mdlO: "model Over", mdlU3: "model Under by 3+", mdlO3: "model Over by 3+", mvDog1: "line moved 1+ toward the favorite", mvFav1: "line moved 1+ toward the dog",
    totUp2: "total up 2+", totDn2: "total down 2+", totUp3: "total up 3+", totDn3: "total down 3+", dogOffLoss: "dog lost last week", dogOffBlow: "dog lost by 17+ last week",
    favOffWin: "favorite won last week", favOffLoss: "favorite lost last week", favStreak3: "favorite won 3 straight", dogStreak3: "dog won 3 straight",
    homePrebye: "home team's bye next", awayPrebye: "road team's bye next", dogLowScorePrev: "dog scored 10 or less last week", homeCoachBad: "home coach 44% ATS or worse" };
  const out = [];
  for (const [bet, [fs, win, n]] of Object.entries(best)) {
    const why = fs.map((f) => NM[f] || f).join(" · "), id = `${bet}|${fs.join("+")}`, model = fs.some((f) => MODEL_F.test(f));
    const T = (side, line) => ({ kind: "total", side, line }), P = (team, line) => ({ kind: "spread", team, line });
    const map = { "DOG6(1.5-2.5)": [`${dog} ${sg(sp + 6)}`, P(dog, sp + 6)], "anyDog+6": [`${dog} ${sg(sp + 6)}`, P(dog, sp + 6)], "anyFav-6->": [`${fav} ${sg(-sp + 6)}`, P(fav, -sp + 6)],
      "Under+6": [`Under ${tl + 6}`, T("under", tl + 6)], "Over-6": [`Over ${tl - 6}`, T("over", tl - 6)], "Dog ATS": [`${dog} ${sg(sp)}`, P(dog, sp)], "Fav ATS": [`${fav} ${sg(-sp)}`, P(fav, -sp)],
      Under: [`Under ${tl}`, T("under", tl)], Over: [`Over ${tl}`, T("over", tl)] }[bet];
    if (map) out.push({ id, why, pick: map[0], hit: win, n, model, teaser: /6/.test(bet), ...map[1] });
  }
  // keep one side per market: drop a pick if a higher one on the same market says the opposite (Over vs Under, dog vs fav)
  out.sort((a, b) => b.hit - a.hit);
  const keep = [];
  for (const x of out) { const clash = keep.some((k) => k.kind === x.kind && k.teaser === x.teaser && (x.kind === "total" ? k.side !== x.side : k.team !== x.team)); if (!clash) keep.push(x); }
  return keep;
}
export const STACK_NAMES = { favwind: "Favorite in wind 15+, model agrees", underwinddog: "Under, wind 10+, model likes dog 3+", windover6: "Under +6, wind 10+, model Over",
  bigfavlow: "Over −6, fav 7+, total ≤41", bigfavmodel: "Over −6, fav 7+, model fav 3+", favunder: "Over, model fav 3+ and Under", domedog6: "Dog +6, dome, model dog",
  roaddog6: "Road dog ≤3, +6", turfdog6: "Turf dog ≤3, +6", lowmovefav6: "Fav +6, total ≤41, line toward dog", totupfav6: "Fav +6, total 47+ up 3+", divlowdog: "Dog, division, total ≤41" };
export const skey = (s, w) => `stack:${s}:${w}`;
const jp = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
export async function recordStack(season, week, g, picks, t) {
  for (const p of picks) await getRedis().hset(skey(season, week), `${g.key}|${p.id}`, JSON.stringify({ ...p, game: g.key, home: g.home, week, t }));
  return picks.length;
}
export function gradeStackPick(p, homeScore, awayScore) {
  const m = homeScore - awayScore, tot = homeScore + awayScore;
  const x = p.kind === "total" ? (p.side === "under" ? p.line - tot : tot - p.line) : (p.team === p.home ? m : -m) + p.line;
  return x > 0 ? "W" : x < 0 ? "L" : "P";
}
export async function gradeStackWeek(season, week, finals) {
  const r = getRedis(), all = (await r.hgetall(skey(season, week))) || {}; let n = 0;
  for (const [f, v] of Object.entries(all)) { const p = jp(v); if (!p || p.result) continue; const g = finals.find((y) => y.key === p.game); if (!g || g.homeScore == null) continue;
    p.result = gradeStackPick(p, g.homeScore, g.awayScore); await r.hset(skey(season, week), f, JSON.stringify(p)); n++; }
  return n;
}
export async function stackSummary(season) {
  const r = getRedis(), rows = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `stack:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jp(v); if (e) rows.push(e); } } while (c !== "0");
  const d = rows.filter((x) => x.result === "W" || x.result === "L"), w = d.filter((x) => x.result === "W").length;
  return { recorded: rows.length, n: d.length, w, l: d.length - w };
}
