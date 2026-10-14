// Same-game parlays (10/14, owner: "build now, all three"). Two per game, built from the card's own picks and the TD model:
//   best   -- only strong legs: green spread / total picks (56%+) and TD players the model gives 55%+ (one per team), minus any leg
//             that works AGAINST another (a TD with the Under, or a TD from the team picked NOT to cover); the stronger leg stays.
//   style  -- the owner's way: the card's spread pick + total pick (any %) + the most likely TD scorer on each team.
// Chance = each leg's own % times the same-game links measured 2016-25 (lib/combo.js: TD + cover 1.19x, TD + Over 1.23x,
// TD + Under 0.77x, TD + other team covers 0.81x). Saved before kickoff in the Parlay Lab (paper:<s>:<w>:sgp|<game>) and graded.
import { comboChance, pairLift } from "./combo";

const GREEN = 0.56, TD_MIN = 0.55;
const isTot = (p) => /^(Over|Under) /.test(p);
const OUT = /^(out|doubtful|questionable)$/i;

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
    return { game: g.key, kind: k, ...(k === "spread" ? { team: c.pick.split(" ")[0] } : { side: /^Over/.test(c.pick) ? "over" : "under" }), label: c.pick, price, prob: c.hit / 100, rule: String(c.why || "").split(":")[0] }; };
  const sp = line("spread"), to = line("total");
  const scorer = (team) => { const r = (g.td || []).filter((x) => x.team === team && x.fair != null && !x.stale && !OUT.test(x.injury || "")).sort((a, b) => b.fair - a.fair)[0];
    return r ? { game: g.key, kind: "td", team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100, ...(r.thin ? { thin: true } : {}) } : null; };
  const tds = [scorer(g.away), scorer(g.home)].filter(Boolean);
  const mk = (strategy, legs) => { if (legs.length < 2) return null; const prob = comboChance(legs);
    return { strategy, legs, prob: prob == null ? null : Math.round(prob * 1000) / 1000, pay: legs.every((l) => l.price) ? legs.reduce((a, l) => a / l.price, 1) : null }; };
  // best: strong legs, strongest first; a leg that works against one already kept is dropped
  const strong = [sp, to].filter((l) => l && l.prob >= GREEN).concat(tds.filter((l) => l.prob >= TD_MIN)).sort((a, b) => b.prob - a.prob);
  const keep = []; for (const l of strong) if (keep.every((k) => pairLift(k, l) >= 1)) keep.push(l);
  const style = mk("sgp_style", [sp, to, ...tds].filter(Boolean));
  // linked 4 (10/14 research, 2,665 games 2014-25): favorite wins + Over + the favorite's 2 most likely scorers -- every leg points the
  // same way, the best same-game 4-leg found (hit 7.9%; owner's style with an Under only 1.8-2.4%, with an Over 4.6-5.7%)
  const ml = g.poly && g.poly.ml, tot = g.poly && g.poly.total, fav = ml && ml.home > 0 && ml.away > 0 ? (ml.home >= ml.away ? g.home : g.away) : null;
  let linked = null;
  if (fav && tot && tot.line != null) {
    const fp = fav === g.home ? ml.home / (ml.home + ml.away) : ml.away / (ml.home + ml.away);
    const two = (g.td || []).filter((x) => x.team === fav && x.fair != null && !x.stale && !OUT.test(x.injury || "")).sort((a, b) => b.fair - a.fair).slice(0, 2)
      .map((r) => ({ game: g.key, kind: "td", team: fav, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100 }));
    if (two.length === 2) linked = mk("sgp_linked", [{ game: g.key, kind: "ml", team: fav, label: `${fav} ML`, price: fav === g.home ? ml.home : ml.away, prob: fp },
      { game: g.key, kind: "total", side: "over", label: `Over ${tot.line}`, price: tot.over > 0 && tot.over < 1 ? tot.over : null, prob: 0.5 }, ...two]);
  }
  return { best: mk("sgp_best", keep), single: keep.length === 1 ? keep[0] : null, style, linked };
}

// 4-leg parlays across games (10/14, owner: "find strategies for a 4 leg parlay"). Each is a FIXED rule tested week by week 2014-25
// (214 weeks, closing moneylines, a walk-forward TD model); hit = share of weeks all 4 legs won. Saved weekly in the Parlay Lab and graded.
export const FOUR_LEG = {
  leg4_fav: { name: "4 biggest favorites (moneyline)", hist: 42.5, note: "one per game; skips a game where a green pick backs the underdog. 3+ of 4 legs won 77% of weeks" },
  leg4_green_fav: { name: "Best green pick + 3 biggest favorites", hist: 32.2, note: "the week's top green pick, then the 3 biggest favorites in other games" },
  leg4_fav_td: { name: "3 biggest favorites + most likely TD scorer", hist: 31.4, note: "the TD player is the model's top scorer in another game" },
};
export function fourLegParlays(games) {
  const open = (games || []).filter((g) => !g.started && !g.final);
  const greens = [];
  for (const g of open) for (const c of g.combos || []) if (!c.teaser && c.hit >= GREEN * 100 && !/ ML$/.test(c.pick)) {
    const k = isTot(c.pick) ? "total" : "spread", lp = legPrice(g, c, k);
    greens.push({ game: g.key, kind: k, ...(k === "spread" ? { team: c.pick.split(" ")[0] } : { side: /^Over/.test(c.pick) ? "over" : "under" }), label: c.pick, price: lp > 0 && lp < 1 ? lp : null, prob: c.hit / 100, rule: String(c.why || "").split(":")[0] }); }
  greens.sort((a, b) => b.prob - a.prob);
  const favs = [];
  for (const g of open) { const ml = g.poly && g.poly.ml; if (!ml || !(ml.home > 0) || !(ml.away > 0)) continue;
    const home = ml.home >= ml.away, team = home ? g.home : g.away, dog = home ? g.away : g.home;
    if (greens.some((x) => x.game === g.key && x.team === dog)) continue;   // our own green pick says the underdog
    favs.push({ game: g.key, kind: "ml", team, label: `${team} ML`, price: home ? ml.home : ml.away, prob: (home ? ml.home : ml.away) / (ml.home + ml.away) }); }
  favs.sort((a, b) => b.prob - a.prob);
  const tds = [];
  for (const g of open) for (const r of g.td || []) if (r.fair != null && !r.stale && !OUT.test(r.injury || "")) tds.push({ game: g.key, kind: "td", team: r.team, player: r.player, label: `${r.player} TD`, market: r.market, price: r.price > 0 && r.price < 1 ? r.price : null, prob: r.fair / 100 });
  tds.sort((a, b) => b.prob - a.prob);
  const pick = (pool, n, used) => { const out = []; for (const l of pool) { if (used.has(l.game)) continue; used.add(l.game); out.push(l); if (out.length === n) break; } return out.length === n ? out : null; };
  const mk = (strategy, legs) => legs && legs.length === 4 ? { strategy, legs, prob: Math.round(legs.reduce((a, l) => a * l.prob, 1) * 1000) / 1000, pay: legs.every((l) => l.price) ? legs.reduce((a, l) => a / l.price, 1) : null, hist: FOUR_LEG[strategy].hist } : null;
  const out = [];
  out.push(mk("leg4_fav", pick(favs, 4, new Set())));
  if (greens.length) { const u = new Set([greens[0].game]), f3 = pick(favs, 3, u); out.push(mk("leg4_green_fav", f3 ? [greens[0], ...f3] : null)); }
  { const u = new Set(), f3 = pick(favs, 3, u), t = f3 ? pick(tds, 1, u) : null; out.push(mk("leg4_fav_td", f3 && t ? [...f3, ...t] : null)); }
  return out.filter(Boolean);
}

// Saved on every slate build until the game kicks off (the last save before kickoff is the one graded), in the Parlay Lab's
// same-game keys so lib/paper.js gradePaper grades it and paperSummary counts it. No bell alert (noAlert).
export async function recordSgp(data, setJSON) {
  let n = 0;
  for (const g of data.games || []) { if (g.started || g.final || !g.sgp) continue;
    const parlays = [g.sgp.best, g.sgp.style, g.sgp.linked].filter(Boolean).map((p) => ({ ...p, noAlert: true })); if (!parlays.length) continue;
    await setJSON(`paper:${data.season}:${data.week}:sgp|${g.key}`, { t: new Date().toISOString(), season: data.season, week: data.week, game: g.key, parlays }); n++; }
  return n;
}
