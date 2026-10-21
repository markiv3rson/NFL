// Same-game parlays (10/14, owner), saved before kickoff and graded (paper:<s>:<w>:sgp|<game>). 10/19 (owner: "start making better decisions on
// parlays"): a game gets a type only when it fits that type's tested filter (2019-25, walk-forward TD model), so most games get fewer parlays:
//   2 legs  (sgp_best)      -- the 2 strongest strong legs that do not work against each other
//           (sgp_best_fill) -- else favorite wins + its top scorer at 55%+ (49.5%)
//   3 legs  (sgp_3)         -- favorite wins + Over + its top scorer: favorite 60%+, scorer 50%+, total 45+ (30.2%); not when the card's total PICK is an Under
//   10/19 (owner: "I only want three max to show anywhere now. Cut all the four legs"): 4 legs (sgp_linked) and my style (sgp_style) are no
//   longer built; old saved ones stay graded history
//   upset   (sgp_upset)     -- underdog wins + its lead RB at 45%+ (25.1%)
// Chance = each leg's own % times the same-game links (lib/combo.js).
import { comboChance, comboPay, pairLift } from "./combo";
import { plainLeg, isGreenPick } from "./cardpick";

const TD_MIN = 0.55;
// 10/19 parlay filters (owner: "start making better decisions on parlays"), each raised the hit rate in every period 2019-25 (walk-forward TD model)
const FILL_TD = 0.55, UPSET_RB = 0.45, PICKY = { fav: 0.6, td: 0.5, total: 45 };
// Stake per parlay type (10/14, owner): my style $5, same game 4 legs $10, 3 legs $15, 2 legs $20; 4 legs across games $10.
// Shown with the Polymarket payout and used to grade each type's money result (win/loss stays the main judge).
export const STAKES = { sgp_st: 10, sgp_3: 15, sgp_best: 20, sgp_best_fill: 20, sgp_upset: 5 };   // types still built (old saved parlays keep their own saved stake)
const OUT = /^(out|doubtful|questionable)$/i;

export function sameGameParlays(g) {
  if (!g || g.started || g.final) return null;
  // 10/15 (owner): parlay legs are the card's PICK at Polymarket's own line (lib/cardpick.js), never a bought line
  const line = (k) => plainLeg(g, k);
  const sp = line("spread"), to = line("total");
  const scorer = (team) => { const r = (g.td || []).filter((x) => x.team === team && x.fair != null && !x.stale && !OUT.test(x.injury || "")).sort((a, b) => b.fair - a.fair)[0];
    return r ? { game: g.key, kind: "td", team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100, ...(r.thin ? { thin: true } : {}) } : null; };
  const tds = [scorer(g.away), scorer(g.home)].filter(Boolean);
  const mk = (strategy, legs) => { if (legs.length < 2) return null; const prob = comboChance(legs);
    return { strategy, legs, stake: STAKES[strategy] || 10, prob: prob == null ? null : Math.round(prob * 1000) / 1000, pay: comboPay(legs) }; };
  // favorite (Polymarket moneyline) legs used by the researched same-game parlays
  const ml = g.poly && g.poly.ml, tot = g.poly && g.poly.total, fav = ml && ml.home > 0 && ml.away > 0 ? (ml.home >= ml.away ? g.home : g.away) : null;
  const favML = fav ? { game: g.key, kind: "ml", team: fav, label: `${fav} ML`, price: fav === g.home ? ml.home : ml.away, prob: (fav === g.home ? ml.home : ml.away) / (ml.home + ml.away) } : null;
  const over = tot && tot.line != null ? { game: g.key, kind: "total", side: "over", label: `Over ${tot.line}`, price: tot.over > 0 && tot.over < 1 ? tot.over : null, prob: 0.5 } : null;
  const favTD = fav ? (g.td || []).filter((x) => x.team === fav && x.fair != null && !x.stale && !OUT.test(x.injury || "")).sort((a, b) => b.fair - a.fair).slice(0, 2)
    .map((r) => ({ game: g.key, kind: "td", team: fav, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100 })) : [];
  // SAME GAME · 2 LEGS ("best"): the 2 strongest strong legs (green 56%+ / TD 55%+). 10/19 (owner: "start making better decisions on parlays"): fewer than 2 strong legs -> the filled pair only
  // when it is the tested one with a real scorer: favorite wins + its top scorer at 55%+ (2019-25 walk-forward: 49.5% of 408 games, every
  // period 45-55%; with any top scorer only 35.5%). Otherwise no 2-leg parlay for that game.
  const strong = [sp, to].filter((l) => l && isGreenPick(l.prob * 100)).concat(tds.filter((l) => l.prob >= TD_MIN)).sort((a, b) => b.prob - a.prob);
  // 10/19: the strongest PAIR whose legs do not work against each other (a TD with the other team's cover 0.74x, a TD with the Under 0.80x,
  // measured 2019-25) and are not two bets on the same result -- CHI @ ATL week 6 paired Bijan's TD with CHI -1.5
  const side = (l) => l.kind === "spread" || l.kind === "ml", fine = (a, b) => pairLift(a, b) >= 1 && !(side(a) && side(b));
  let pair = null; for (let i = 0; i < strong.length && !pair; i++) for (let j = i + 1; j < strong.length; j++) if (fine(strong[i], strong[j])) { pair = [strong[i], strong[j]]; break; }
  const filled = !pair;
  // 10/19: our own green spread pick backs the underdog -> no favorite-based parlay on that game (same rule as the 4 biggest favorites)
  const spDog = sp && isGreenPick(sp.prob * 100) && fav && sp.team && sp.team !== fav;
  const keep = pair || (favML && favTD[0] && favTD[0].prob >= FILL_TD && !spDog ? [favML, favTD[0]] : []);
  // SAME GAME · 3 / 4 LEGS: favorite wins + Over + its top scorer (+ its 2nd). 10/19: only in games that fit the tested filter -- favorite
  // priced 60%+ (moneyline, fee out), its top scorer 50%+, total 45+. 2019-25 walk-forward: 3 legs 30.2% of 354 games (every period up:
  // 25 / 34 / 35% vs 18 / 20 / 24% unfiltered, 20.4% of 1,850); 4 legs 15.0% vs 9.6%.
  // 10/19 (owner: "make sure everything is agreeing" ... "1 yes"): no Over leg when the card's own total PICK is an Under, green or yellow
  const toUnder = to && to.side === "under";
  const fits = favML && over && favTD[0] && !spDog && !toUnder && favML.prob >= PICKY.fav && favTD[0].prob >= PICKY.td && tot.line >= PICKY.total;
  const three = fits ? mk("sgp_3", [favML, over, favTD[0]]) : null;
  // UPSET (10/17 parlay lab, owner: "calculated risk"): the underdog wins + its lead running back scores. 2019-25 walk-forward, 1,758 games: hit 17.6%,
  // paid about 8x. Why it holds: when an underdog wins its RB1 scores much more often (link 1.2-1.8x, lib/combo.js mlTdLift). 10/19: only when
  // that back is 45%+ (25.1% of 438 games, every period 22-27% vs 17-19%).
  const dog = fav ? (fav === g.home ? g.away : g.home) : null;
  const dogML = dog ? { game: g.key, kind: "ml", team: dog, label: `${dog} ML`, price: dog === g.home ? ml.home : ml.away, prob: (dog === g.home ? ml.home : ml.away) / (ml.home + ml.away) } : null;
  const dogRB = dog ? (g.td || []).filter((x) => x.team === dog && x.pos === "RB" && x.fair != null && !x.stale && !OUT.test(x.injury || "")).sort((a, b) => b.fair - a.fair)[0] : null;
  // 10/19: not when our own green spread pick backs the favorite (the card says the favorite covers; the upset needs the underdog to win)
  const spFav = sp && isGreenPick(sp.prob * 100) && fav && sp.team === fav;
  const upset = dogML && dogRB && !spFav && dogRB.fair / 100 >= UPSET_RB ? mk("sgp_upset", [dogML, { game: g.key, kind: "td", team: dog, player: dogRB.player, label: `${dogRB.player} TD`, market: dogRB.market, price: dogRB.price > 0 && dogRB.price < 1 ? dogRB.price : null, prob: dogRB.fair / 100 }]) : null;
  // 10/19 (owner: "keep it [PICK w/ POINTS] in game lines under more"): the bought-lines parlay (sgp_style_pts) is no longer built; old ones stay graded history
  // SPREAD + TOTAL (10/20, owner: "build all 8", the owner's own style without the TD legs -- his spreads 8-5 and totals 11-5 this season, TDs 10-21): the card's
  // spread PICK + total PICK at Polymarket's lines, every game that has both. Spread and total are independent (measured link 1.00), so the chance is the product.
  const st = sp && to ? mk("sgp_st", [sp, to]) : null;
  return { best: mk(filled ? "sgp_best_fill" : "sgp_best", keep), filled, three, upset, st };
}

// Saved on every slate build until the game kicks off (the last save before kickoff is the one graded), in the Parlay Lab's
// same-game keys so lib/paper.js gradePaper grades it and paperSummary counts it. No bell alert (noAlert).
export async function recordSgp(data, setJSON) {
  let n = 0;
  for (const g of data.games || []) { if (g.started || g.final || !g.sgp) continue;
    const parlays = [g.sgp.best, g.sgp.three, g.sgp.upset, g.sgp.st].filter(Boolean).map((p) => ({ ...p, noAlert: true }));   // 10/19: an empty list is saved too, so a game that no longer fits the filters drops its earlier copy (never graded)
    await setJSON(`paper:${data.season}:${data.week}:sgp|${g.key}`, { t: new Date().toISOString(), season: data.season, week: data.week, game: g.key, kickoff: g.kickoff || null, parlays }); n++; }
  return n;
}
