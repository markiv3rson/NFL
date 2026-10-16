// Card picks: the green rules (LINE MOVE, BEAT THE 3, TOTAL MOVE, INJURY, BOUNCE BACK, BOUNCE BACK DOG) and the chooser (lib/chooser.js),
// plus recording, grading and the records shown next to each pick. The old scanned combos (10/9) were retired 10/12.
import { booksFresh } from "./books";
import { getRedis } from "./redis";
import { COMBO_TABLE } from "./combotable";
import { choose } from "./chooser";
const CHOOSER_N = { spread: 2535, total: 2580 };   // games behind the honest rates (2014-26, each judged by a model that never saw it)
const sg = (x) => (x > 0 ? `+${x}` : `${x}`);
let TABLE = COMBO_TABLE;
export function useTable(t) { TABLE = Array.isArray(t) && t.length ? t : COMBO_TABLE; }   // the weekly rebuild (lib/combomodel.js)
import { upgraded, upgradedEarlyTotal, predictTotalMove } from "./upgrade";
// Factor names as in the scan (python), computed from what the app knows before kickoff. sit = situationFor() (prev games, coach).
export function comboFactors(g, m, hs, tl, hsOpen = null, tlOpen = null, sit = null, week = null) {
  if (!m || hs == null || tl == null || hs === 0) return null;
  const homeDog = hs > 0, sp = Math.abs(hs), gap = m.homeMargin != null ? m.homeMargin + hs : null, tg = m.total != null ? m.total - tl : null;
  const wind = m.outdoor && m.wind != null ? m.wind : 0, turf = !!(m.fix && m.fix.turf);
  const likesHome = gap != null ? gap > 0 : null, mdlDog = likesHome == null ? null : homeDog ? likesHome : !likesHome;
  const mvdog = hsOpen != null ? (homeDog ? hs - hsOpen : hsOpen - hs) : null, tmv = tlOpen != null ? tl - tlOpen : null;
  const S = sit || {}, dogS = (homeDog ? S.home : S.away) || {}, favS = (homeDog ? S.away : S.home) || {};
  const F = { turf, grass: !turf, dome: g.outdoor === false, wind10: wind >= 10, wind15: wind >= 15, div: !!(m.fix && m.fix.div),
    early: week != null && week <= 4, late: week != null && week >= 13, prime: etHour(g.kickoff) >= 19, homeDog, roadDog: !homeDog,
    "sp>=7": sp >= 7, "sp<=3": sp <= 3, "tot>=47": tl >= 47, "tot<=41": tl <= 41,
    mdlDog: mdlDog === true, mdlFav: mdlDog === false, mdlDog3: mdlDog === true && Math.abs(gap) >= 3, mdlFav3: mdlDog === false && Math.abs(gap) >= 3,
    mdlU: tg != null && tg < 0, mdlO: tg != null && tg > 0, mdlU3: tg != null && tg <= -3, mdlO3: tg != null && tg >= 3,
    mvDog1: mvdog != null && mvdog >= 1, mvFav1: mvdog != null && mvdog <= -1,
    totUp2: tmv != null && tmv >= 2, totDn2: tmv != null && tmv <= -2, totUp3: tmv != null && tmv >= 3, totDn3: tmv != null && tmv <= -3,
    dogOffLoss: dogS.prevMarg != null && dogS.prevMarg < 0, dogOffBlow: dogS.prevMarg != null && dogS.prevMarg <= -17,
    favOffWin: favS.prevMarg != null && favS.prevMarg > 0, favOffLoss: favS.prevMarg != null && favS.prevMarg < 0,
    favStreak3: !!favS.won3, dogStreak3: !!dogS.won3, homePrebye: !!(S.home && S.home.preBye) && week >= 8, awayPrebye: !!(S.away && S.away.preBye) && week >= 8,
    dogLowScorePrev: dogS.prevPts != null && dogS.prevPts <= 10 && dogS.prevMarg < 0 };
  // From the model service (extra_factors.py): coaches, age, QB rushing, rest, travel, the 5 stats models.
  const x = m.xf || {}, H = (hv, av) => (homeDog ? hv : av), V = (hv, av) => (homeDog ? av : hv), n = (v) => v != null && isFinite(v);
  const dc = H(x.homeCoach, x.awayCoach), fc = V(x.homeCoach, x.awayCoach), dr = n(x.homeRest) && n(x.awayRest) ? H(x.homeRest - x.awayRest, x.awayRest - x.homeRest) : null;
  const da = H(x.homeAge, x.awayAge), fa = V(x.homeAge, x.awayAge), dq = H(x.homeQbRun, x.awayQbRun), fq = V(x.homeQbRun, x.awayQbRun), tz = n(x.tzdiff) ? x.tzdiff : 0;
  const s5 = x.s || {}, t5 = x.t || {}, lean = (v) => (n(v) ? (homeDog ? v > 0 : v < 0) : null);
  Object.assign(F, { cold: n(m.temp) && m.temp <= 32, shortwk: (n(x.homeRest) && x.homeRest <= 4) || (n(x.awayRest) && x.awayRest <= 4), dogrestP: n(dr) && dr > 0, "dogrest-": n(dr) && dr < 0,
    dogCoachBad: n(dc) && dc <= 0.44, favCoachBad: n(fc) && fc <= 0.44, dogCoachGood: n(dc) && dc >= 0.56, favCoachGood: n(fc) && fc >= 0.56,
    homeCoachBad: (n(x.homeCoach) && x.homeCoach <= 0.44) || !!(S.homeCoachAts && S.homeCoachAts.rate <= 0.44),
    dogNewQB: !!(m.fix && (homeDog ? m.fix.homeQbFirstStart : m.fix.awayQbFirstStart)), favNewQB: !!(m.fix && (homeDog ? m.fix.awayQbFirstStart : m.fix.homeQbFirstStart)),
    awayEastEarly: tz >= 2 && !!x.early, awayWestTrip: tz <= -2, tz2P: Math.abs(tz) >= 2,
    dogOlder1: n(da) && n(fa) && da - fa >= 1, dogYounger1: n(da) && n(fa) && fa - da >= 1,
    oldTeams: n(x.homeAge) && n(x.awayAge) && (x.homeAge + x.awayAge) / 2 >= 26.8, youngTeams: n(x.homeAge) && n(x.awayAge) && (x.homeAge + x.awayAge) / 2 <= 25.8,
    dogQBruns: n(dq) && dq >= 6, favQBruns: n(fq) && fq >= 6, bigDogQBruns: n(dq) && dq >= 6 && sp >= 7,
    ptsTotO3: n(x.ptsTot) && x.ptsTot - tl >= 3, ptsTotU3: n(x.ptsTot) && x.ptsTot - tl <= -3,
    gbmDog: lean(s5.gbm) === true, gbmFav: lean(s5.gbm) === false, logitDog: lean(s5.logit) === true, rfDog: lean(s5.rf) === true,
    gbmU: n(t5.gbm) && t5.gbm < 0, gbmO: n(t5.gbm) && t5.gbm > 0, ridgeU: n(t5.ridge) && t5.ridge < 0,
    statDog: lean(s5.ens) === true, statFav: lean(s5.ens) === false, statU: n(t5.ens) && t5.ens < 0, statO: n(t5.ens) && t5.ens > 0,
    mlgap: sp >= 2.5 && sp <= 3.5 && tl >= 48 });
  // 10/9 published-research factors (dog / favorite side of each), from situationFor() and the model service's rest days.
  const both = (k) => [!!dogS[k], !!favS[k]], dd = (k, nm) => { const [a, b] = both(k); F["dog" + nm] = a; F["fav" + nm] = b; };
  dd("prevOT", "AfterOT"); dd("prevMon", "AfterMNF"); dd("revenge", "Revenge"); dd("prevIntl", "AfterIntl"); dd("nextDiv", "LookaheadDiv"); dd("prevDivWin", "AfterDivWin");
  F.dogAfterWin28 = n(dogS.prevMarg) && dogS.prevMarg >= 28; F.favAfterWin28 = n(favS.prevMarg) && favS.prevMarg >= 28;
  F.dogAfterLoss28 = n(dogS.prevMarg) && dogS.prevMarg <= -28; F.favAfterLoss28 = n(favS.prevMarg) && favS.prevMarg <= -28;
  const notDiv = !(m.fix && m.fix.div), H0 = S.home || {}, A0 = S.away || {};
  F.sandwichAny = notDiv && ((H0.nextDiv && H0.prevDiv) || (A0.nextDiv && A0.prevDiv));
  F.road2nd = !!A0.prevAway; F.road3rd = !!(A0.prevAway && A0.prev2Away); F.intlGame = !!g.neutral;
  F.roadOffBye = n(x.awayRest) && x.awayRest >= 13; F.homeOffBye = n(x.homeRest) && x.homeRest >= 13;
  F.divRematch = !notDiv && (!!H0.revenge || !!A0.revenge);
  F.wk17dogLosing = week >= 17 && n(dogS.winPct) && n(favS.winPct) && dogS.winPct < 0.4 && favS.winPct > 0.6;
  // Upgraded model (10/9): the model leans below ("mdl...") come from it, as in the rescan that produced the combo table.
  const nz = (v) => (n(v) ? v : 0), out1 = g.outdoor === false ? 0 : 1;
  const UX = {
    w: out1 ? nz(m.wind) : 0, tmp: n(m.temp) ? m.temp : 65, out: out1, restd: n(x.homeRest) && n(x.awayRest) ? x.homeRest - x.awayRest : 0, aged: n(x.homeAge) && n(x.awayAge) ? x.homeAge - x.awayAge : 0,
    qbr: n(x.homeQbRun) && n(x.awayQbRun) ? x.homeQbRun - x.awayQbRun : 0, coach: (n(x.homeCoach) ? x.homeCoach : 0.5) - (n(x.awayCoach) ? x.awayCoach : 0.5),
    hpm: nz((S.home || {}).prevMarg), apm: nz((S.away || {}).prevMarg), dv: m.fix && m.fix.div ? 1 : 0, s_ens: nz(s5.ens), t_ens: nz(t5.ens), s_gbm: nz(s5.gbm), t_gbm: nz(t5.gbm), ptstot: nz(x.ptsTot) };
  const ok2 = m.homeMargin != null && m.total != null;
  const up = ok2 ? upgraded({ ...F, ...UX, mm: m.homeMargin, km: -hs, mt: m.total, kt: tl, mv: hsOpen != null ? hsOpen - hs : 0, tmv: tlOpen != null ? tl - tlOpen : 0 }) : null;
  // early-week total: opening lines only (null until there is an opening line)
  const early = ok2 && hsOpen != null && tlOpen != null ? upgradedEarlyTotal({ ...F, ...UX, mm: m.homeMargin, km: -hsOpen, mt: m.total, kt: tlOpen }) : null;
  const mvT = ok2 && hsOpen != null && tlOpen != null ? predictTotalMove({ ...F, ...UX, mm: m.homeMargin, km: -hsOpen, mt: m.total, kt: tlOpen }) : null;
  if (up) { const ug = up.margin + hs, ut = up.total - tl, uh = ug > 0, ud = homeDog ? uh : !uh;
    Object.assign(F, { mdlDog: ug !== 0 && ud, mdlFav: ug !== 0 && !ud, mdlDog3: ud && Math.abs(ug) >= 3, mdlFav3: !ud && Math.abs(ug) >= 3, mdlU: ut < 0, mdlO: ut > 0, mdlU3: ut <= -3, mdlO3: ut >= 3 }); }
  // Starters out (10/10): dog/fav side's QB out, a skill starter out, 2+ OL / DB / front-seven starters out. Straight bets only in the table.
  const dI = dogS.inj || {}, fI = favS.inj || {};
  Object.assign(F, { dogQBout: dI.qb >= 1, favQBout: fI.qb >= 1, dogSKout: dI.sk >= 1, favSKout: fI.sk >= 1, dogOLout: dI.ol >= 2, favOLout: fI.ol >= 2,
    dogDBout: dI.db >= 2, favDBout: fI.db >= 2, dogF7out: dI.f7 >= 2, favF7out: fI.f7 >= 2 });
  Object.assign(F, { bothMdlDog: F.mdlDog && F.statDog, bothMdlFav: F.mdlFav && F.statFav, bothU: F.mdlU && F.statU, bothO: F.mdlO && F.statO,
    allLeanDog: F.mdlDog && F.gbmDog && F.statDog && F.logitDog && F.rfDog });
  return { F, up, early, mvT, homeDog, sp, fav: homeDog ? g.away : g.home, dog: homeDog ? g.home : g.away };
}
// Best-of correction (10/9): a game that fits several combos shows its best one, and the best of several overstates. Replaying
// this exact code on 2,562 games (2014-25), each bet type actually won this many points less than the table said; shown numbers
// are corrected by it (never raised).
const BEST_OF_ADJ = { "Under+6": -7.4, "anyFav-6->": -2.9, "Dog ATS": -1.6, Over: -2.7, "anyDog+6": -2.7, "Fav ATS": -1.6, "Over-6": -3.7, "DOG6(1.5-2.5)": -4.6, Under: -6.0 };
const MODEL_F = /^(mdl|stat|gbm|logit|rf|ridge|both|all|ptsTot)/;
function etHour(k) { if (!k) return null; try { return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date(k))); } catch { return null; } }
// Every combo from the table that fits this game; the best one per bet type.
export function tablePicks(g, m, hs, tl, hsOpen, tlOpen, sit, week) {
  const c = comboFactors(g, m, hs, tl, hsOpen, tlOpen, sit, week); if (!c) return [];
  const { F, sp, fav, dog } = c, best = {};
  for (const [bet, fs, win, n] of TABLE) {
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
    homePrebye: "home team's bye next", awayPrebye: "road team's bye next", dogLowScorePrev: "dog scored 10 or less last week", homeCoachBad: "home coach 44% ATS or worse",
    cold: "32°F or colder", shortwk: "short week", dogrestP: "dog more rested", "dogrest-": "dog less rested",
    dogCoachBad: "dog coach 44% ATS or worse", favCoachBad: "favorite coach 44% ATS or worse", dogCoachGood: "dog coach 56%+ ATS", favCoachGood: "favorite coach 56%+ ATS",
    dogNewQB: "dog QB's first start", favNewQB: "favorite QB's first start", awayEastEarly: "road team flew 2+ zones east, early game", awayWestTrip: "road team flew 2+ zones west", tz2P: "2+ time zones",
    dogOlder1: "dog older by 1+ yr", dogYounger1: "dog younger by 1+ yr", oldTeams: "older teams", youngTeams: "younger teams",
    dogQBruns: "dog QB runs 6+ a game", favQBruns: "favorite QB runs 6+ a game", bigDogQBruns: "big dog with a running QB", ptsTotO3: "points-based total 3+ higher", ptsTotU3: "points-based total 3+ lower",
    dogQBout: "underdog's starting QB out", favQBout: "favorite's starting QB out", dogSKout: "underdog missing a skill starter", favSKout: "favorite missing a skill starter",
    dogOLout: "underdog missing 2+ linemen", favOLout: "favorite missing 2+ linemen", dogDBout: "underdog missing 2+ DBs", favDBout: "favorite missing 2+ DBs",
    dogF7out: "underdog missing 2+ front-seven starters", favF7out: "favorite missing 2+ front-seven starters",
    gbmDog: "boosted model likes the dog", gbmFav: "boosted model likes the favorite", logitDog: "logistic model likes the dog", rfDog: "forest model likes the dog",
    gbmU: "boosted model Under", gbmO: "boosted model Over", ridgeU: "ridge model Under", statDog: "stats models like the dog", statFav: "stats models like the favorite",
    statU: "stats models Under", statO: "stats models Over", bothMdlDog: "both models like the dog", bothMdlFav: "both models like the favorite", bothU: "both models Under", bothO: "both models Over",
    allLeanDog: "all models like the dog", mlgap: "spread ~3, total 48+",
    dogAfterOT: "dog played overtime last week", favAfterOT: "favorite played overtime last week", dogAfterMNF: "dog played Monday night", favAfterMNF: "favorite played Monday night",
    dogRevenge: "dog lost to this team earlier", favRevenge: "favorite lost to this team earlier", dogAfterIntl: "dog played overseas last week", favAfterIntl: "favorite played overseas last week",
    dogLookaheadDiv: "dog has a division game next", favLookaheadDiv: "favorite has a division game next", dogAfterDivWin: "dog won a division game last week", favAfterDivWin: "favorite won a division game last week",
    dogAfterWin28: "dog won by 28+ last week", favAfterWin28: "favorite won by 28+ last week", dogAfterLoss28: "dog lost by 28+ last week", favAfterLoss28: "favorite lost by 28+ last week",
    sandwichAny: "between two division games", road2nd: "road team's 2nd straight road game", road3rd: "road team's 3rd straight road game", intlGame: "international game",
    roadOffBye: "road team off a bye", homeOffBye: "home team off a bye", divRematch: "division rematch", wk17dogLosing: "late season, losing team vs winning team" };
  // 10/12: the card's picks come from the combined chooser (lib/chooser.js) with HONEST win rates -- not the single best scanned
  // pattern (those won 49.8% on games they hadn't seen; their 56-65% was measured on the games they were found in). One pick per
  // market. Scanned teaser combos and the 3 "keeper" angles are no longer picks (same problem: rates never checked on unseen games).
  const ch = choose(F), fade = (f, side) => MODEL_F.test(f) && ((side === "fav" && /Dog\d?$/.test(f)) || (side === "dog" && /Fav\d?$/.test(f)) || (side === "over" && /U\d?$/.test(f)) || (side === "under" && /O\d?$/.test(f)));
  // reasons: the factors pushing hardest toward the pick, in words; a spread reason skips Over/Under leans and a total reason skips dog/favorite leans
  const fits = (f, mk) => { const w = NM[f] || f; return mk === "spread" ? !/\b(Over|Under)\b/.test(w) : !/likes? the (dog|favorite)/.test(w); };
  const reason = (top, side, mk) => { const t = top.filter((f) => fits(f, mk)); return t.length ? t.slice(0, 3).map((f) => (NM[f] || f) + (fade(f, side) ? " (fade it)" : "")).join(" · ") : "no strong signal either way"; };
  const sd = ch.spread.dog ? "dog" : "fav", team = ch.spread.dog ? dog : fav, line = ch.spread.dog ? sp : -sp;
  const td = ch.total.over ? "over" : "under";
  return [...(totalMovePick(g, c.mvT, tl, tlOpen, week) || []),
    { id: "chooser|spread", why: reason(ch.spread.top, sd, "spread"), pick: `${team} ${sg(line)}`, hit: Math.round(ch.spread.p * 1000) / 10, n: CHOOSER_N.spread, model: true, teaser: false, kind: "spread", team, line },
    { id: "chooser|total", why: reason(ch.total.top, td, "total"), pick: `${ch.total.over ? "Over" : "Under"} ${tl}`, hit: Math.round(ch.total.p * 1000) / 10, n: CHOOSER_N.total, model: true, teaser: false, kind: "total", side: td, line: tl, q: ch.total.q },
  ];
}
// TOTAL MOVE (10/13): a model of how far the total will move from its opening number (lib/upgrade.js predictTotalMove). While the
// total is still at (within half a point of) its opening number, take the predicted direction at that number -- but only when the
// prediction is strong. Unseen seasons 2014-26 (each season predicted by a model that never saw it), bet at the opening total:
// most confident 20% 56.8% (507 games), most confident 10% 61.9% (252). Needs the opening number, so it only fires early in the week.
export function totalMovePick(g, mv, tl, tlOpen, week = null) {
  if (week != null && Number(week) < TESTED_FROM_WEEK) return [];   // 10/14: tested on week-4+ games only (the model replay starts at week 4)
  if (!mv || tl == null || tlOpen == null || Math.abs(tl - tlOpen) >= 0.5 || Math.abs(mv.move) < mv.thr20) return [];
  const strong = Math.abs(mv.move) >= mv.thr10, side = mv.move > 0 ? "over" : "under";
  return [{ id: "movepred|total", why: `TOTAL MOVE: model expects the total to ${side === "over" ? "rise" : "fall"} · take the opening number`, pick: `${side === "over" ? "Over" : "Under"} ${tl}`,
    hit: strong ? mv.hit10 : mv.hit20, n: strong ? mv.n10 : mv.n20, model: false, teaser: false, kind: "total", side, line: tl }];
}
// BOUNCE BACK (10/13, owner: "build now"): the ROAD team missed the spread by 24+ points (was 21+ until 10/16) in its last game -> take the road team at
// the current line. 10/16 (owner: "fix what you find"): cutoff raised 21 -> 24. The 21-23 band won only 47.8% (115 games; 43/60/39/48 by
// period) while 24+ won 61.3% (160-101, pushes out; 61/53/67/64) and 28+ 64.7% (136). Earlier note: nothing fitted (the 21 was the cutoff tested). Regular season, closing line: 2006-25 57.6% (297 games; 55/60/58% by
// period, 14 of 20 seasons), 1999-2005 (not used to find it) 54.9% (82) -> 57.0% on 379. At 24+ 60.8% (209). The home-team version
// (home missed by 21+ -> home) was only 52.4%, so road teams only.
export function bounceBackPick(g, hs, sit) {
  const a = sit && sit.away; if (!a || a.prevAts == null || a.prevAts > -24 || hs == null || !isFinite(hs) || hs === 0) return null;
  const line = -hs;
  return { id: "bounceback|spread", why: `BOUNCE BACK: ${g.away} missed the spread by ${Math.round(-a.prevAts)} last game`, pick: `${g.away} ${sg(line)}`,
    hit: 61.3, n: 261, model: false, teaser: false, kind: "spread", team: g.away, line };   // 1999-2025, all games, missed by 24+ (10/16)
}
// BOUNCE BACK DOG (10/14, owner: "I need more rules that pass"): a team that scored 3 or less in its last game and is the UNDERDOG
// now -> that team at the current line. Nothing fitted (3 = the cutoff tested). Closing line 1999-2025: 57.1% (294 games; periods
// 99-05/06-12/13-19/20-25 = 52/56/60/66); 2014-26 at the opening line 60.6% (94). Shut out (0) and an underdog 61.2% (103). The
// favorite version is only 49.0%, so underdogs only.
export const FLOOR_PTS = 3, scoredFloor = (x) => !!x && x.prevPts != null && x.prevPts <= FLOOR_PTS;   // shared with lib/tracked.js recordFloor
export function floorDogPick(g, hs, sit) {
  if (hs == null || !isFinite(hs) || hs === 0 || !sit) return null;
  const lo = scoredFloor, homeDog = hs > 0;
  const team = homeDog ? g.home : g.away, S = homeDog ? sit.home : sit.away, O = homeDog ? sit.away : sit.home;
  if (!lo(S) || lo(O)) return null;
  const line = homeDog ? hs : -hs;
  return { id: "floordog|spread", why: `BOUNCE BACK DOG: ${team} scored ${S.prevPts} last game, now the underdog`, pick: `${team} ${sg(line)}`,
    hit: 56.5, n: 285, model: false, teaser: false, kind: "spread", team, line };   // 1999-2025, all games (10/15)
}
// LINE MOVE (10/12, corrected same day): when sportsbooks have moved the spread and Polymarket still has the old number, take the side
// the books moved toward at Polymarket's number. One fixed rule, nothing fitted. History 2014-26, the side the line moved to graded at
// the OPENING number, each game counted once:
//   crossed 3 or 7 AND moved 1+ point  63.5% (587 games, 2014-2025, the app's own code replayed by `npm run accuracy`)  -> pick
//   no crossing, moved 3+              60.3% (239)                                                                  -> pick
//   no crossing, moved 2-2.9 49.8%, 1.5-1.9 57.4% (but not steady), 1-1.4 48.2%  -> not a pick
// Corrections: the first version also fired on 1+ point moves (48-52% without a crossing) and on half-point crossings -- and
// Polymarket only lists half-point spreads, so books at 7 vs Polymarket 6.5 is rounding, not a move.
export function lineMovePick(g, poly, bk, fresh = null) {
  // fresh = { booksT, polyT }: on the page both readings must be recent, or an old reading could fake a move (books: until the next
  // scheduled pull, lib/books.js booksFresh -- owner's times, 10/14; Polymarket: 3 h). The kickoff recorder passes nothing (both fetched just now).
  if (fresh) { const age = (t) => (t ? (Date.now() - new Date(t)) / 3600e3 : Infinity);
    if (!booksFresh(fresh.booksT) || age(fresh.polyT) > 3) return null; }
  const P = poly && poly.spread ? poly.spread.homeSpread : null, B = bk && bk.spread ? bk.spread.homeSpread : null;
  if (P == null || B == null || !isFinite(P) || !isFinite(B)) return null;
  // A dead one-sided Polymarket book (10/4: BAL +17.5 at 0.99 / 0.505) is a placeholder, not an old number left behind.
  const ph = Number(poly.spread.home), pa = Number(poly.spread.away);
  if (!(ph > 0.1 && ph < 0.9 && pa > 0.1 && pa < 0.9)) return null;
  const d = Math.abs(B - P), lo = Math.min(Math.abs(P), Math.abs(B)), hi = Math.max(Math.abs(P), Math.abs(B));
  const crossAt = lo < 3 && hi >= 3 ? 3 : lo < 7 && hi >= 7 ? 7 : null;
  const tier = crossAt && d >= 1 ? [63.5, 587] : d >= 3 ? [60.3, 239] : null; if (!tier) return null;
  const [hit, n] = tier, home = B < P, team = home ? g.home : g.away, line = home ? P : -P;
  const ht = (x) => `${g.home} ${sg(x)}`;
  return { id: "linemove|spread", why: `LINE MOVE: books moved to ${ht(B)}, Polymarket still ${ht(P)} · take the old number${crossAt ? ` (crossed ${crossAt})` : ""}`,
    pick: `${team} ${sg(line)}`, hit, n, model: false, teaser: false, kind: "spread", team, line };
}
// LINE MOVE on totals (10/13, owner: "find an edge"): same idea as the spread rule, nothing fitted. History 2014-26, graded at the
// opening total, each game once: total moved 3+ 66.1% (460 games, 2014-2025, the app's own code replayed); a second source (Action Network opener vs consensus
// close, 2023-25) agrees: 66.1% on 322. NOT picks: moved 2-2.9 56.1% (2025: 48%), 1-1.9 51-53%. Live gap: in weeks 3-5 of 2026
// Polymarket's total was never more than 1 point off the books, so this will rarely fire.
export function lineMoveTotalPick(g, poly, bk, fresh = null) {
  if (fresh) { const age = (t) => (t ? (Date.now() - new Date(t)) / 3600e3 : Infinity);
    if (!booksFresh(fresh.booksT) || age(fresh.polyT) > 3) return null; }
  const P = poly && poly.total ? poly.total.line : null, B = bk && bk.total ? bk.total.line : null;
  if (P == null || B == null || !isFinite(P) || !isFinite(B)) return null;
  const ov = Number(poly.total.over), un = Number(poly.total.under);
  if (!(ov > 0.1 && ov < 0.9 && un > 0.1 && un < 0.9)) return null;
  if (Math.abs(B - P) < 3) return null;
  const side = B > P ? "over" : "under";
  return { id: "linemove|total", why: `LINE MOVE: books moved the total to ${B}, Polymarket still ${P} · take the old number`,
    pick: `${side === "over" ? "Over" : "Under"} ${P}`, hit: 66.1, n: 460, model: false, teaser: false, kind: "total", side, line: P };
}
// KEY NUMBER (10/13, Claude's idea, owner: "build now"): Polymarket lists only half-point spreads, so when the books sit on exactly 3,
// the underdog can usually be had at +3.5 on Polymarket (main line or an alternate) -- the extra half point turns the ~9% of games
// that land on 3 into wins. Nothing fitted. Regular season 2006-25, books' closing line exactly 3 (793 games): underdog +3.5 won 58.1%
// (2006-13 61%, 2014-19 56%, 2020-25 56%); favorite -2.5 only 50.9%. The +3.5 usually costs more than an even bet (~53-55c).
// BUY THE POINTS tiers (books' consensus spread -> the bought Polymarket line). `hit` / `n` = all games, closing line 1999-2025 (10/15: day / night split dropped). Nothing fitted; the day-game rates by period were:
// (older history, day games only, for reference:)
// day-game rates by period 99-05 / 06-13 / 14-19 / 20-25:
//   books 1    -> dog +3.5    60.7% (450)  67/58/62/62      books 3.5  -> fav -2.5    59.8% (547)  59/58/57/65
//   books 1.5  -> dog +3.5    62.1% (169)  66/62/59/61      books 4.5  -> fav -2.5    65.6% (212)  70/66/55/67   (added 10/14)
//   books 2.5  -> dog +3.5    60.9% (422)  61/63/60/62      books 6.5  -> fav -2.5    66.9% (263)  65/58/81/71   (added 10/14)
//   books 3    -> dog +3.5    57.9% (901)  53/63/57/59      books 5.5  -> dog +7.5    61.7% (227)  58/59/61/68   (added 10/14)
//                                                          books 13.5 -> dog +14.5   68.0% (50)   67/71/67/67   (added 10/14, few games)
// Tested 10/14 and NOT picks (a period at 47-54% or under 56% overall): fav -6.5 at books 7 / 7.5 / 8; dog +7.5 at books 5 / 6 / 6.5;
// fav -9.5 at 10.5 / 11; dog +10.5 at 9 / 9.5 / 10; dog +14.5 at 13 / 14; books 2 -> dog +3.5; books 4 (both sides). Books 4.5 also
// passed on the dog side (+7.5, 60.8%) -- only the stronger favorite side is shown, one answer per card.
// The bought points cost more than the main line -- owner: judged by win rate ("I'd rather pay more than lose"); the card warns when
// the price is above the win rate. Label = the key number the bet now beats.
// OWNER RULES 10/14: never buy more than 3.5 points, and take the FEWEST points that still holds up -- on whichever side, favorite or underdog (owner: "always take the
// shortest point on either team"). Bar = the app's normal one (56%+ steady, closing AND opening line), not a stricter one. Each books number has one main tier; books 3.5 also has a
// second candidate (the favorite at -2.5, 1 point); keyNumberPick takes the candidate with the higher card % whose line Polymarket lists.
// Per tier: hit / n = closing-line win rate 1999-2025, open = [hit, n] opening-line rate 2014-2025, plain = same side at the books' own number (1999-2025).
// Complete seasons only, so the numbers never drift; `tests/accuracy.mjs` recomputes every one from the nflverse file and FAILS if one differs by more than 0.05 or its game count differs (10/14 audit: the old numbers had crept 0-2 points / 3-12 games off).
const T_ = (side, line, hit, n, key, open, plain) => ({ side, line, hit, n, key, open, plain });
export const BUY_TIERS = {   // all games (10/15, owner: day / night does not matter); numbers recomputed from the nflverse file by `npm run accuracy` (TIER NUMBERS)
  1: T_("dog", 3.5, 59.9, 536, 3, [61.0, 187], 49.1), 1.5: T_("dog", 3.5, 63.9, 194, 3, [63.0, 184], 49.0),
  2.5: T_("dog", 3.5, 59.5, 504, 3, [56.9, 325], 51.6), 3: T_("dog", 3.5, 56.7, 1112, 3, [55.3, 387], 52.4),
  3.5: T_("dog", 5.5, 56.6, 656, 5, [59.5, 284], 50.5),
  4.5: T_("fav", -2.5, 63.8, 254, 3, [65.3, 167], 50.0), 5.5: T_("dog", 7.5, 61.8, 275, 7, [56.1, 148], 54.5),
  13.5: T_("dog", 14.5, 63.9, 61, 14, [53.3, 30], 63.9),
  // favorites added back 10/15 (owner: "add all the favorites back"): every favorite line within 2.5 points that reached 56%+ in all games (numbers from the nflverse file, `npm run accuracy` TIER NUMBERS)
  2: T_("fav", -0.5, 58.1, 160, 3, [58.5, 82], 54.8), 4: T_("fav", -2.5, 63.9, 324, 3, [58.4, 161], 51.6), 5: T_("fav", -2.5, 66.3, 160, 3, [65.7, 67], 50.3),
  6: T_("fav", -3.5, 56.2, 338, 3, [55.8, 120], 49.2), 7: T_("fav", -5.5, 56.9, 469, 7, [62.5, 160], 51.0), 7.5: T_("fav", -5.5, 58.9, 275, 7, [58.6, 152], 48.0),
};
export const BUY_ALT = { 3.5: [T_("fav", -2.5, 59.1, 656, 3, [53.5, 284], 49.5)] };   // books 3.5: the favorite at -2.5 (1 point) is also allowed
export const BUY_OPEN = Object.fromEntries(Object.entries(BUY_TIERS).map(([A, T]) => [A, T.open]));
export const buyCands = (A) => [BUY_TIERS[A], ...(BUY_ALT[A] || [])].filter(Boolean);
// The card shows the LOWER of the closing and the opening-line rate when the opening sample is 60+ games (smaller ones stay on the closing rate).
export function tierRate(A, T = BUY_TIERS[A]) {
  if (!T) return null;
  const { hit, n } = T, o = T.open;
  return o && o[1] >= 60 && o[0] < hit ? { hit: o[0], n: o[1], open: true } : { hit, n };
}
export function keyNumberPick(g, poly, bk, alts = null, fresh = null) {
  if (fresh) { const age = (t) => (t ? (Date.now() - new Date(t)) / 3600e3 : Infinity);
    if (!booksFresh(fresh.booksT) || age(fresh.polyT) > 3) return null; }
  const B = bk && bk.spread ? bk.spread.homeSpread : null;
  const A = B == null ? null : Math.abs(B); if (A == null || !BUY_TIERS[A]) return null;
  const one = (T) => {
    const { hit, n } = tierRate(A, T);
    const dogHome = B > 0, fav = dogHome ? g.away : g.home, dog = dogHome ? g.home : g.away, team = T.side === "fav" ? fav : dog, teamHome = team === g.home;
    const want = T.line;   // the team's own line
    const P = poly && poly.spread ? poly.spread.homeSpread : null, ph = poly && poly.spread ? Number(poly.spread[teamHome ? "home" : "away"]) : null;
    let price = null;
    if (P != null && (teamHome ? P : -P) === want && ph > 0.1 && ph < 0.9) price = ph;   // main line already gives that number
    else { const a = (alts || (poly && poly.alts) || []).find((x) => x.team === team && Number(x.line) === want && x.price > 0.1 && x.price < 0.9); if (a) price = a.price; }
    if (price == null) return null;
    const c = Math.round(price * 100), bought = Math.abs(Math.abs(want) - A), pts = bought === 0.5 ? "the half point" : `${bought} extra point${bought === 1 ? "" : "s"}`;
    const why = T.side === "fav" ? `BEAT THE ${T.key}: books at ${team} -${A}, Polymarket gives ${want} · a ${T.key}-point win now wins the bet (${c}¢)`
      : `BEAT THE ${T.key}: books at ${team} +${A}, Polymarket gives +${want} · ${pts}, and it still wins on a ${T.key}-point loss (${c}¢)`;
    return { id: "keynum|spread", why, pick: `${team} ${sg(want)}`, hit, n, tier: A, key: T.key, plain: T.plain, model: false, teaser: false, kind: "spread", team, line: want, price, bought };
  };
  // the candidate with the higher card %; a tie goes to the one that buys fewer points
  return buyCands(A).map(one).filter(Boolean).sort((x, y) => y.hit - x.hit || x.bought - y.bought)[0] || null;
}
// INJURY (10/13, Claude's find, owner: "take the ones that help"): exactly one team has its starting QB, 2+ DBs or 2+ linemen out
// (official Out/Doubtful + 60%+ snap share, same flags as the chooser's *out signals) -> take the OTHER team at the current line, but ONLY
// while the line has not already moved 1+ point toward it since the week's first reading (the market prices the news within days).
// History 2014-26 graded at the closing line: line NOT yet moved toward the healthy team 57.0% (256 games; 52/62/58% by period);
// already moved 54.2% (not a pick). Questionable QBs and limited/DNP practice status show no edge (52.6% / 48.8%) -- only Out/Doubtful.
// 10/14 fix: weeks 4+ only, like its test (the 57.0% came from week-4+ games; weeks 1-3 were never tested -- the app's own code replayed
// there went 3-11 -- and early-season "starters" come from 0-2 games). week = null (old callers) keeps the old behavior.
export const TESTED_FROM_WEEK = 4;
export function injuryPick(g, hs, hsOpen, sit, week = null) {
  if (week != null && Number(week) < TESTED_FROM_WEEK) return null;
  const S = sit || {}, flag = (i) => !!i && (i.qb >= 1 || i.db >= 2 || i.ol >= 2), h = flag(S.home && S.home.inj), a = flag(S.away && S.away.inj);
  if (h === a || hs == null || hsOpen == null || !isFinite(hs) || !isFinite(hsOpen) || hs === 0) return null;
  const homeHealthy = a, moved = homeHealthy ? hsOpen - hs : hs - hsOpen;   // + = the line has already moved toward the healthy team
  if (moved >= 1) return null;
  const team = homeHealthy ? g.home : g.away, line = homeHealthy ? hs : -hs, out = homeHealthy ? g.away : g.home;
  return { id: "injury|spread", why: `INJURY: ${out} has its starting QB, 2+ DBs or 2+ linemen out · the line hasn't caught up yet`,
    pick: `${team} ${sg(line)}`, hit: 56.5, n: 260, model: false, teaser: false, kind: "spread", team, line };
}
export const skey = (s, w) => `stack:${s}:${w}`;
const jp = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
// CLV tracker (10/13, owner: "go"): each pick keeps the line it FIRST showed at (`first`); the line saved at kickoff is the closing
// line. clvOf = points gained by taking the first number vs the close (+ = beat the close). A side/team change starts a new `first`.
// 10/14 fix: picks are only RECORDED at kickoff, so the first line now comes from `stackfirst:` -- saved (once, hsetnx) the first time
// the slate shows each pick during the week (lib/week.js -> noteFirstSeen). Without it `first` was always the kickoff line (CLV 0).
const fkey = (s, w) => `stackfirst:${s}:${w}`, ffield = (g, p) => `${g.key}|${p.id}|${p.team || p.side || ""}`;
export async function noteFirstSeen(season, week, g, picks, t) {
  const r = getRedis();
  // 10/14 audit fix: the whole pick is kept (not just its line) so it can be GRADED at the line it was first shown. Timing picks (TOTAL
  // MOVE, INJURY, LINE MOVE) often vanish before kickoff exactly because the line moved their way -- recorded only at kickoff, they were
  // never graded. stackRecords now counts each pick once, at its first-shown line.
  const ok = (picks || []).filter((p) => p && !p.teaser && p.line != null && p.id); if (!ok.length) return;
  const have = await r.hmget(fkey(season, week), ...ok.map((p) => ffield(g, p)));
  for (const [i, p] of ok.entries()) { const old0 = jp(have[i]); if (old0 && old0.id) continue;   // already complete: no write
    const full = { id: p.id, kind: p.kind, team: p.team || null, side: p.side || null, hit: p.hit, pick: p.pick, game: g.key, home: g.home, week,
      ...(p.price != null ? { price: p.price } : {}), ...(p.points != null ? { points: p.points } : {}), ...(p.tier != null ? { tier: p.tier, key: p.key } : {}) };   // price / points / tier: the rule label and the money need them
    const added = await r.hsetnx(fkey(season, week), ffield(g, p), JSON.stringify({ line: p.line, t, ...full }));
    if (!added) { const old = jp(await r.hget(fkey(season, week), ffield(g, p))); if (old && !old.id) await r.hset(fkey(season, week), ffield(g, p), JSON.stringify({ ...full, line: old.line, t: old.t })); } }   // pre-fix rows: fill in, keep first line/time
}
export async function gradeFirstSeenWeek(season, week, finals) {
  const r = getRedis(), all = (await r.hgetall(fkey(season, week))) || {}; let n = 0;
  for (const [f, v] of Object.entries(all)) { const p = jp(v); if (!p || p.result || !p.id || !p.kind) continue; const g = finals.find((y) => y.key === p.game); if (!g || g.homeScore == null) continue;
    p.result = gradeStackPick(p, g.homeScore, g.awayScore); await r.hset(fkey(season, week), f, JSON.stringify(p)); n++; }
  return n;
}
export async function recordStack(season, week, g, picks, t) {
  const r = getRedis();
  for (const p of picks) { const f = `${g.key}|${p.id}`, old = jp(await r.hget(skey(season, week), f));
    const same = old && old.first && (old.team || null) === (p.team || null) && (old.side || null) === (p.side || null);
    const seen = jp(await r.hget(fkey(season, week), ffield(g, p)));
    const first = same ? old.first : seen && seen.line != null ? seen : { line: p.line ?? null, t };
    await r.hset(skey(season, week), f, JSON.stringify({ ...p, game: g.key, home: g.home, week, t, first })); }
  return picks.length;
}
export function clvOf(p) {
  if (!p || !p.first || p.first.line == null || p.line == null) return null;
  return p.kind === "total" ? (p.side === "under" ? p.first.line - p.line : p.line - p.first.line) : p.first.line - p.line;
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
// This season's record per combo (10/9): {id: {w, l}}, shown next to the pick on the card.
// 10/14: each pick counted ONCE per week+game+rule -- at the line it was first shown (`stackfirst:`) when that record exists, else the
// kickoff record (older weeks, retired combos). Picks that vanished before kickoff are now counted too.
export async function stackRecords(season) {
  const r = getRedis(), out = {}, one = {}; let c = "0";
  const scan = async (pat, prefer) => { let cur = "0";
    do { const [nx, ks] = await r.scan(cur, "MATCH", pat, "COUNT", 200); cur = nx;
      for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jp(v); if (!e || !e.id || !e.result) continue;   // pushes kept for de-dup (review fix)
        const key = `${e.week}|${e.game}|${e.id}`, old = one[key];
        // 10/14: first-shown wins only for GREEN picks (timing picks); a yellow chooser pick counts as locked at kickoff (its side can flip midweek)
        const pf = prefer && e.hit >= 56;
        if (!old || (pf && !old.first_) || (pf && old.first_ && e.t < old.t) || (prefer && !pf && old.first_ && e.t < old.t)) one[key] = { ...e, first_: prefer }; } } while (cur !== "0"); };
  await scan(`stack:${season}:*`, false); await scan(`stackfirst:${season}:*`, true);
  for (const e of Object.values(one)) { if (e.result !== "W" && e.result !== "L") continue; const o = (out[e.id] = out[e.id] || { w: 0, l: 0 }); if (e.result === "W") o.w++; else o.l++; }
  return out;
}
const FIXED_LINE = /^keynum\|/;   // picks whose line never moves (always +3.5 / -2.5): no line value to measure
// LIVE RULE RECORDS (10/14, owner: "build 3"): every green rule (each BEAT THE 3 tier apart) with its own live W-L at the line it
// was FIRST shown, next to the % its card says. FLAG ("BELOW") = 15+ graded and winning 10+ points under the card -- a flag only, nothing is cut.
export const FLAG_MIN = 15, FLAG_GAP = 10, CURRENT_RULES = /^(keynum|bounceback|floordog|injury|linemove|movepred|cardpick|ptspick|modelpick)\|/;   // retired scanned combos and the yellow chooser are not rules
export function ruleLabel(e) { if (e.id === "modelpick|spread" || e.id === "modelpick|total") return `MODEL SIDE · ${e.kind}`; if (e.id === "cardpick|spread" || e.id === "cardpick|total") return `PICK · ${e.kind}`; if (e.id === "ptspick|spread" || e.id === "ptspick|total") return `PICK w/ POINTS · ${e.kind} · ${e.points} pt${e.points === 1 ? "" : "s"}`; return e.id === "keynum|spread" && e.tier != null ? `BEAT THE ${e.key != null ? e.key : e.tier === 13.5 ? "14" : e.tier >= 5 ? "7" : "3"} · books ${e.tier}` : e.id; }
export function ruleFlag(w, l, say) { const n = w + l; return n >= FLAG_MIN && (100 * w) / n < say - FLAG_GAP ? "BELOW" : n < FLAG_MIN ? "TOO FEW" : "OK"; }
export function ruleRecords(rows, seen) {
  const one = {};   // one pick per week+game+rule: the first-shown record when there is one, else the kickoff record
  for (const [list, first] of [[rows, false], [seen, true]]) for (const e of list) { if (!e || !e.id || !CURRENT_RULES.test(e.id) || (e.result !== "W" && e.result !== "L")) continue;
    const k = `${e.week}|${e.game}|${e.id}`, o = one[k]; if (!o || (first && (!o.f || e.t < o.t))) one[k] = { ...e, f: first }; }
  const out = {};
  for (const e of Object.values(one)) { const k = ruleLabel(e), r = (out[k] = out[k] || { w: 0, l: 0, say: e.hit }); if (e.result === "W") r.w++; else r.l++; r.say = e.hit; }
  for (const r of Object.values(out)) r.flag = ruleFlag(r.w, r.l, r.say);
  return out;
}
export async function stackSummary(season) {
  const r = getRedis(), rows = []; let c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `stack:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jp(v); if (e) rows.push(e); } } while (c !== "0");
  // review fix 10/14: graded first-shown picks join the card record too (a green timing pick that vanished before kickoff counts)
  const seen = []; c = "0";
  do { const [nx, ks] = await r.scan(c, "MATCH", `stackfirst:${season}:*`, "COUNT", 200); c = nx;
    for (const k of ks) for (const v of Object.values((await r.hgetall(k)) || {})) { const e = jp(v); if (e && e.id && e.kind && e.result) seen.push(e); } } while (c !== "0");
  const d = rows.filter((x) => x.result === "W" || x.result === "L"), w = d.filter((x) => x.result === "W").length;
  // 10/13 (owner: "it should all be in one"): the record of the PICK each card showed, every week -- the best straight pick per game and
  // market recorded at kickoff, whichever system made it (scanned combos before 10/12, then the chooser / LINE MOVE / KEY NUMBER).
  const best = {};
  // 10/14: only GREEN first-shown picks join (a timing pick that vanished); a yellow chooser side that flipped midweek is not what the card
  // locked at kickoff, so it no longer replaces the kickoff pick just because its % was higher.
  const NEWCARD = /^(cardpick|ptspick|modelpick)\|/;   // 10/15: the new card's PICK / PICK w/ POINTS have their own records (rules below); the tile follows the PICK
  for (const x of rows.concat(seen.filter((y) => y.hit >= 56))) { if (x.teaser || !x.id || !x.kind || NEWCARD.test(x.id)) continue;
    const k = `${x.week}|${x.game}|${x.kind}`; if (!best[k] || x.hit > best[k].hit || (x.hit === best[k].hit && x.first && !best[k].first)) best[k] = x; }
  for (const x of rows) if (/^cardpick\|/.test(x.id || "")) best[`${x.week}|${x.game}|${x.kind}`] = x;   // from week 6 on, the tile counts the card's PICK (locked at kickoff)
  const card = { spread: { w: 0, l: 0 }, total: { w: 0, l: 0 }, byGame: {}, clv: { n: 0, sum: 0, beat: 0, same: 0 } };
  for (const x of Object.values(best)) { if (x.result === "W" || x.result === "L") card[x.kind === "total" ? "total" : "spread"][x.result === "W" ? "w" : "l"]++;
    // 10/14: KEY NUMBER's line is always +3.5 -> always 0; left out of LINE VALUE
    const cv = x.result && !FIXED_LINE.test(x.id) ? clvOf(x) : null; if (cv != null) { card.clv.n++; card.clv.sum += cv; if (cv > 0) card.clv.beat++; else if (cv === 0) card.clv.same++; }
    (card.byGame[`${x.week}|${x.game}`] = card.byGame[`${x.week}|${x.game}`] || []).push({ kind: x.kind, pick: x.pick, hit: x.hit, result: x.result || null }); }
  // 10/15: how the card's PICK and PICK w/ POINTS are doing (kickoff records, graded), with money per $1 at the price saved with each pick
  const cardRec = {}; for (const e of rows) { if (!/^(cardpick|ptspick|modelpick)\|(spread|total)$/.test(e.id || "")) continue; const b = (cardRec[e.id] = cardRec[e.id] || { w: 0, l: 0, stk: 0, ret: 0 });
    if (e.result === "W") b.w++; else if (e.result === "L") b.l++;
    if ((e.result === "W" || e.result === "L") && e.price > 0 && e.price < 1) { b.stk++; b.ret += e.result === "W" ? 1 / e.price - 1 : -1; } }
  return { recorded: rows.length, n: d.length, w, l: d.length - w, card, cardRec, rules: ruleRecords(rows, seen) };
}
