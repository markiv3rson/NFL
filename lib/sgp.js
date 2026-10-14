// Same-game parlays (10/14, owner). Four per game, every game, every week -- each saved before kickoff and graded (paper:<s>:<w>:sgp|<game>):
//   2 legs  (sgp_best / sgp_best_fill) -- the 2 strongest strong legs; filled with favorite wins + its top TD when there aren't 2
//   3 legs  (sgp_3)      -- favorite wins + Over + its top TD scorer (best same-game 3-leg 2014-25: 18.8%)
//   4 legs  (sgp_linked) -- favorite wins + Over + its top 2 TD scorers (best same-game 4-leg: 7.9%)
//   my style (sgp_style) -- the owner's way: the card's spread pick + total pick + the top TD scorer on each team
// Chance = each leg's own % times the same-game links measured 2016-25 (lib/combo.js: TD + cover 1.19x, TD + Over 1.23x,
// TD + Under 0.77x, TD + other team covers 0.81x).
import { comboChance, pairLift } from "./combo";

const GREEN = 0.56, TD_MIN = 0.55;
// Stake per parlay type (10/14, owner): my style $5, same game 4 legs $10, 3 legs $15, 2 legs $20; 4 legs across games $10.
// Shown with the Polymarket payout and used to grade each type's money result (win/loss stays the main judge).
export const STAKES = { sgp_style: 5, sgp_linked: 10, sgp_3: 15, sgp_best: 20, sgp_best_fill: 20, leg4_fav: 10, leg4_green_fav: 10, leg4_fav_td: 10 };
const isTot = (p) => /^(Over|Under) /.test(p);
const OUT = /^(out|doubtful|questionable)$/i;
const ruleName = (c) => (/^[A-Z][A-Z0-9 ]+:/.test(String(c.why || "")) ? String(c.why).split(":")[0] : "");   // named green rules only ("BEAT THE 3"), not the chooser's long reason

function legPrice(g, c, kind) {   // same rule as Best bets in lib/paper.js: a pick off the main line needs its own price
  const sp = g.poly && g.poly.spread, to = g.poly && g.poly.total;
  if (c.price != null) return c.price;
  if (kind === "total") return to && Number(c.line) === Number(to.line) ? (/^Over/.test(c.pick) ? to.over : to.under) : null;
  if (!sp) return null; const team = c.pick.split(" ")[0], home = team === g.home, main = home ? sp.homeSpread : -sp.homeSpread;
  return c.line == null || Number(c.line) === Number(main) ? (home ? sp.home : sp.away) : null;
}

export function sameGameParlays(g) {
  if (!g || g.started || g.final) return null;
  const top = {};
  for (const c of g.combos || []) { if (c.teaser || !c.hit || / ML$/.test(c.pick)) continue; const k = isTot(c.pick) ? "total" : "spread"; if (!top[k] || c.hit > top[k].hit) top[k] = c; }
  // a leg without a Polymarket price yet (TD markets post late in the week; an alternate line) still counts -- the chance uses the model's %
  const line = (k) => { const c = top[k]; if (!c) return null; const lp = legPrice(g, c, k), price = lp > 0 && lp < 1 ? lp : null;
    return { game: g.key, kind: k, ...(k === "spread" ? { team: c.pick.split(" ")[0] } : { side: /^Over/.test(c.pick) ? "over" : "under" }), label: c.pick, price, prob: c.hit / 100, rule: ruleName(c) }; };
  const sp = line("spread"), to = line("total");
  const scorer = (team) => { const r = (g.td || []).filter((x) => x.team === team && x.fair != null && !x.stale && !OUT.test(x.injury || "")).sort((a, b) => b.fair - a.fair)[0];
    return r ? { game: g.key, kind: "td", team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100, ...(r.thin ? { thin: true } : {}) } : null; };
  const tds = [scorer(g.away), scorer(g.home)].filter(Boolean);
  const mk = (strategy, legs) => { if (legs.length < 2) return null; const prob = comboChance(legs);
    return { strategy, legs, stake: STAKES[strategy] || 10, prob: prob == null ? null : Math.round(prob * 1000) / 1000, pay: legs.every((l) => l.price) ? legs.reduce((a, l) => a / l.price, 1) : null }; };
  // favorite (Polymarket moneyline) legs used by the researched same-game parlays
  const ml = g.poly && g.poly.ml, tot = g.poly && g.poly.total, fav = ml && ml.home > 0 && ml.away > 0 ? (ml.home >= ml.away ? g.home : g.away) : null;
  const favML = fav ? { game: g.key, kind: "ml", team: fav, label: `${fav} ML`, price: fav === g.home ? ml.home : ml.away, prob: (fav === g.home ? ml.home : ml.away) / (ml.home + ml.away) } : null;
  const over = tot && tot.line != null ? { game: g.key, kind: "total", side: "over", label: `Over ${tot.line}`, price: tot.over > 0 && tot.over < 1 ? tot.over : null, prob: 0.5 } : null;
  const favTD = fav ? (g.td || []).filter((x) => x.team === fav && x.fair != null && !x.stale && !OUT.test(x.injury || "")).sort((a, b) => b.fair - a.fair).slice(0, 2)
    .map((r) => ({ game: g.key, kind: "td", team: fav, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100 })) : [];
  // SAME GAME · 2 LEGS ("best", owner 10/14 "we are testing everything"): the 2 strongest strong legs (green 56%+ / TD 55%+), all kinds kept --
  // a TD with the Under stays, its lower chance is in the %. Fewer than 2 strong legs -> filled, first with the researched pair (favorite
  // wins + its top TD scorer: 33.0% of 2,659 games 2014-25, best generic 2-leg), saved as its own record (sgp_best_fill).
  const strong = [sp, to].filter((l) => l && l.prob >= GREEN).concat(tds.filter((l) => l.prob >= TD_MIN)).sort((a, b) => b.prob - a.prob);
  const keep = strong.slice(0, 2), filled = keep.length < 2;
  const same = (a, b) => a.label === b.label;
  // 10/14 fix (owner: "not when it goes against"): a filler leg must not work AGAINST a leg already in (pair link under 1x) -- e.g. never
  // DEN +3.5 with SEA to win (both hit only if SEA wins by 1-3, ~13%, though it showed 34%). Same-team legs first: a team's top TD goes
  // with its spread (1.19x). Strong legs themselves are kept as they are.
  const against = (l) => keep.some((k) => pairLift(k, l) < 1);
  if (filled) for (const l of [favML, favTD[0], ...tds, sp, to].filter(Boolean)) { if (keep.length >= 2) break; if (!keep.some((k) => same(k, l)) && !against(l)) keep.push(l); }
  // SAME GAME · 3 LEGS (research 10/14): favorite wins + Over + its top TD scorer -- best same-game 3-leg, 18.8% (periods 18/18/20;
  // 25.3% when that player is 50%+). Owner's "fav covers" version 14.2%.
  const three = favML && over && favTD[0] ? mk("sgp_3", [favML, over, favTD[0]]) : null;
  // SAME GAME · 4 LEGS (linked): favorite wins + Over + its top 2 scorers -- best same-game 4-leg, 7.9% (owner's style with an Under 1.8-2.4%,
  // with an Over 4.6-5.7%)
  const linked = favML && over && favTD.length === 2 ? mk("sgp_linked", [favML, over, ...favTD]) : null;
  const style = mk("sgp_style", [sp, to, ...tds].filter(Boolean));
  return { best: mk(filled ? "sgp_best_fill" : "sgp_best", keep), filled, three, linked, style };
}

// 4-leg parlays across games (10/14, owner: "find strategies for a 4 leg parlay"). Each is a FIXED rule tested week by week 2014-25
// (214 weeks, closing moneylines, a walk-forward TD model); hit = share of weeks all 4 legs won. Saved weekly in the Parlay Lab and graded.
export const FOUR_LEG = {
  leg4_fav: { name: "4 biggest favorites (moneyline)", hist: 42.5, note: "one per game; skips a game where a green pick backs the underdog; a Thursday favorite counts 4 points stronger. 3+ of 4 legs won 77% of weeks" },
  leg4_green_fav: { name: "Best green pick + 3 biggest favorites", hist: 32.2, note: "the week's top green pick, then the 3 biggest favorites in other games" },
  leg4_fav_td: { name: "3 biggest favorites + most likely TD scorer", hist: 31.4, note: "the TD player is the model's top scorer in another game" },
};
const THU_BUMP = 0.04;
export const isThursday = (t) => { if (!t) return false; const d = new Date(t); return !isNaN(d) && d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" }) === "Thu"; };
export function fourLegParlays(games) {
  const open = (games || []).filter((g) => !g.started && !g.final);
  const greens = [];
  for (const g of open) for (const c of g.combos || []) if (!c.teaser && c.hit >= GREEN * 100 && !/ ML$/.test(c.pick)) {
    const k = isTot(c.pick) ? "total" : "spread", lp = legPrice(g, c, k);
    greens.push({ game: g.key, kind: k, ...(k === "spread" ? { team: c.pick.split(" ")[0] } : { side: /^Over/.test(c.pick) ? "over" : "under" }), label: c.pick, price: lp > 0 && lp < 1 ? lp : null, prob: c.hit / 100, rule: ruleName(c) }); }
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
  const mk = (strategy, legs) => legs && legs.length === 4 ? { strategy, legs, stake: STAKES[strategy] || 10, prob: Math.round(legs.reduce((a, l) => a * l.prob, 1) * 1000) / 1000, pay: legs.every((l) => l.price) ? legs.reduce((a, l) => a / l.price, 1) : null, hist: FOUR_LEG[strategy].hist } : null;
  const out = [];
  // strong week (10/14 research): all 4 favorites priced 70%+ -> hit 48.6% of such weeks 2014-25 (146; periods 50/43/53), else 30.2% (63)
  { const f = mk("leg4_fav", pick(favs, 4, new Set())); if (f) f.strong = f.legs.every((l) => l.prob >= 0.7); out.push(f); }
  if (greens.length) { const u = new Set([greens[0].game]), f3 = pick(favs, 3, u); out.push(mk("leg4_green_fav", f3 ? [greens[0], ...f3] : null)); }
  { const u = new Set(), f3 = pick(favs, 3, u), t = f3 ? pick(tds, 1, u) : null; out.push(mk("leg4_fav_td", f3 && t ? [...f3, ...t] : null)); }
  return out.filter(Boolean);
}

// Saved on every slate build until the game kicks off (the last save before kickoff is the one graded), in the Parlay Lab's
// same-game keys so lib/paper.js gradePaper grades it and paperSummary counts it. No bell alert (noAlert).
export async function recordSgp(data, setJSON) {
  let n = 0;
  for (const g of data.games || []) { if (g.started || g.final || !g.sgp) continue;
    const parlays = [g.sgp.best, g.sgp.three, g.sgp.linked, g.sgp.style].filter(Boolean).map((p) => ({ ...p, noAlert: true })); if (!parlays.length) continue;
    await setJSON(`paper:${data.season}:${data.week}:sgp|${g.key}`, { t: new Date().toISOString(), season: data.season, week: data.week, game: g.key, parlays }); n++; }
  return n;
}
