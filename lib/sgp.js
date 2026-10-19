// Same-game parlays (10/14, owner), saved before kickoff and graded (paper:<s>:<w>:sgp|<game>). 10/19 (owner: "start making better decisions on
// parlays"): a game gets a type only when it fits that type's tested filter (2019-25, walk-forward TD model), so most games get fewer parlays:
//   2 legs  (sgp_best)      -- the 2 strongest strong legs that do not work against each other
//           (sgp_best_fill) -- else favorite wins + its top scorer at 55%+ (49.5%)
//   3 legs  (sgp_3)         -- favorite wins + Over + its top scorer: favorite 60%+, scorer 50%+, total 45+ (30.2%); not when the card's total PICK is an Under
//   4 legs  (sgp_linked)    -- the same + its 2nd scorer (15.0%)
//   my style (sgp_style)    -- the card's spread + total + the top scorer on each team: not with an Under, both scorers 40%+
//   upset   (sgp_upset)     -- underdog wins + its lead RB at 45%+ (25.1%)
// Chance = each leg's own % times the same-game links (lib/combo.js).
import { comboChance, comboPay, pairLift } from "./combo";
import { plainLeg, isGreenPick } from "./cardpick";

const TD_MIN = 0.55;
// 10/19 parlay filters (owner: "start making better decisions on parlays"), each raised the hit rate in every period 2019-25 (walk-forward TD model)
const FILL_TD = 0.55, STYLE_TD = 0.4, UPSET_RB = 0.45, PICKY = { fav: 0.6, td: 0.5, total: 45 };
// Stake per parlay type (10/14, owner): my style $5, same game 4 legs $10, 3 legs $15, 2 legs $20; 4 legs across games $10.
// Shown with the Polymarket payout and used to grade each type's money result (win/loss stays the main judge).
export const STAKES = { sgp_style: 5, sgp_style_pts: 5, sgp_linked: 10, sgp_3: 15, sgp_best: 20, sgp_best_fill: 20, leg4_fav: 10, leg4_green_fav: 10, leg4_fav_td: 10, sgp_upset: 5, leg4_td4: 5 };
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
  const linked = fits && favTD.length === 2 ? mk("sgp_linked", [favML, over, ...favTD]) : null;
  // MY STYLE: the card's spread + total + the top scorer on each team. 10/19: not when the total is an Under (a TD each team with the Under
  // hit 2.2% of 1,795 games 2019-25 vs 6.1% with the Over) and only when both scorers are 40%+ (with the Over 7.9%).
  const styleOk = (t) => t && !/^Under/.test(t.label || "") && t.side !== "under" && tds.length === 2 && tds.every((l) => l.prob >= STYLE_TD);
  const style = styleOk(to) && sp ? mk("sgp_style", [sp, to, ...tds]) : null;
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
  return { best: mk(filled ? "sgp_best_fill" : "sgp_best", keep), filled, three, linked, style, upset };
}

// 4-leg parlays across games (10/14, owner: "find strategies for a 4 leg parlay"). Each is a FIXED rule tested week by week 2014-25
// (214 weeks, closing moneylines, a walk-forward TD model); hit = share of weeks all 4 legs won. Saved weekly in the Parlay Lab and graded.
export const FOUR_LEG = {
  leg4_fav: { name: "4 biggest favorites (moneyline)", hist: 42.5, note: "one per game; skips a game where a green pick backs the underdog; a Thursday favorite counts 4 points stronger. 3+ of 4 legs won 77% of weeks" },
  leg4_green_fav: { name: "Best green pick + 3 biggest favorites", hist: 32.2, note: "the week's top green pick, then the 3 biggest favorites in other games" },
  leg4_fav_td: { name: "3 biggest favorites + most likely TD scorer", hist: 31.4, note: "the TD player is the model's top scorer in another game" },
  // 10/17 parlay lab: the 4 most likely scorers of the week, one per game, nobody on the injury report. 2019-25 (124 weeks, walk-forward TD model):
  // hit 17.7% (22 of 124), paid about 7x, money positive in 6 of 7 seasons (2019 0 of 17, then +65 / +81 / +45 / +20 / +54 / +25 per $100 at
  // model + 3c prices). The model's top scorers hit above their number (55%+ said 60 scored 64; 2026 real prices 12-2 at 63c), which 4 of them compound.
  leg4_td4: { name: "4 most likely TD scorers (one per game)", hist: 17.7, note: "the model's 4 most likely scorers of the week, one per game, nobody on the injury report" },
};
const THU_BUMP = 0.04;
export const isThursday = (t) => { if (!t) return false; const d = new Date(t); return !isNaN(d) && d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" }) === "Thu"; };
export function fourLegParlays(games) {
  const open = (games || []).filter((g) => !g.started && !g.final);
  const greens = [];
  for (const g of open) for (const k of ["spread", "total"]) { const l = plainLeg(g, k); if (l && isGreenPick(l.prob * 100)) greens.push(l); }   // plain lines (10/15)
  greens.sort((a, b) => b.prob - a.prob);
  const favs = [];
  for (const g of open) { const ml = g.poly && g.poly.ml; if (!ml || !(ml.home > 0) || !(ml.away > 0)) continue;
    const home = ml.home >= ml.away, team = home ? g.home : g.away, dog = home ? g.away : g.home;
    if (greens.some((x) => x.game === g.key && x.team === dog)) continue;   // our own green pick says the underdog
    // Thursday favorites (10/14 research, owner: "build now"): won 71.3% vs the 67.2% their moneyline priced (300 games, about +4 points in every
    // period) -> +4 points to their chance, so they rank ahead of equal-priced Sunday favorites
    const thu = isThursday(g.kickoff), p0 = (home ? ml.home : ml.away) / (ml.home + ml.away);
    favs.push({ game: g.key, kind: "ml", team, label: `${team} ML`, price: home ? ml.home : ml.away, prob: thu ? Math.min(0.99, p0 + THU_BUMP) : p0, ...(thu ? { thu: true } : {}) }); }
  favs.sort((a, b) => b.prob - a.prob);
  const tds = [];
  for (const g of open) for (const r of g.td || []) if (r.fair != null && !r.stale && !OUT.test(r.injury || "")) tds.push({ game: g.key, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100 });
  tds.sort((a, b) => b.prob - a.prob);
  const pick = (pool, n, used) => { const out = []; for (const l of pool) { if (used.has(l.game)) continue; used.add(l.game); out.push(l); if (out.length === n) break; } return out.length === n ? out : null; };
  const mk = (strategy, legs) => legs && legs.length === 4 ? { strategy, legs, stake: STAKES[strategy] || 10, prob: Math.round(legs.reduce((a, l) => a * l.prob, 1) * 1000) / 1000, pay: comboPay(legs), hist: FOUR_LEG[strategy].hist } : null;
  const out = [];
  // strong week (10/14 research): all 4 favorites priced 70%+ -> hit 48.6% of such weeks 2014-25 (146; periods 50/43/53), else 30.2% (63)
  { const f = mk("leg4_fav", pick(favs, 4, new Set())); if (f) f.strong = f.legs.every((l) => l.prob >= 0.7); out.push(f); }
  if (greens.length) { const u = new Set([greens[0].game]), f3 = pick(favs, 3, u); out.push(mk("leg4_green_fav", f3 ? [greens[0], ...f3] : null)); }
  { const u = new Set(), f3 = pick(favs, 3, u), t = f3 ? pick(tds, 1, u) : null; out.push(mk("leg4_fav_td", f3 && t ? [...f3, ...t] : null)); }
  out.push(mk("leg4_td4", pick(tds, 4, new Set())));   // 10/17 parlay lab: 4 most likely scorers, one per game
  return out.filter(Boolean);
}

// Saved on every slate build until the game kicks off (the last save before kickoff is the one graded), in the Parlay Lab's
// same-game keys so lib/paper.js gradePaper grades it and paperSummary counts it. No bell alert (noAlert).
export async function recordSgp(data, setJSON) {
  let n = 0;
  for (const g of data.games || []) { if (g.started || g.final || !g.sgp) continue;
    const parlays = [g.sgp.best, g.sgp.three, g.sgp.linked, g.sgp.style, g.sgp.upset].filter(Boolean).map((p) => ({ ...p, noAlert: true }));   // 10/19: an empty list is saved too, so a game that no longer fits the filters drops its earlier copy (never graded)
    await setJSON(`paper:${data.season}:${data.week}:sgp|${g.key}`, { t: new Date().toISOString(), season: data.season, week: data.week, game: g.key, kickoff: g.kickoff || null, parlays }); n++; }
  return n;
}
