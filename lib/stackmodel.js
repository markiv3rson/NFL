// STACK shadow (10/21, owner: "a model that grabs all the information from our models and judges which side" -> option A: a shadow + a purple line
// on every spread card, NEVER a pick until its live record earns it). One logistic fit (lib/stack_model_data.js, 2020-25) over every model's
// output for the game: the game model's edge vs the line, the TEAM MODEL's chance, the TD model's expected touchdowns per team and top scorer,
// the prop model's expected yards per team, the rules that fire (BOUNCE BACK, BOUNCE BACK DOG, BEAT THE), the open-to-now moves, rest, dome,
// division. Walk-forward 2022-25: every game 53.5%, the confident fifth (|p - .5| >= cut) 56.2% on 153, the rest 52.8% -- the % shown is that band.
// Signs follow the research table: "home minus away" / the home team's view; spread = home-favored margin (the opposite of the site's hs).
import { STACK_MODEL as M } from "./stack_model_data";
const sg = (x) => (x > 0 ? `+${x}` : `${x}`);
export const STACK_CUT = M.cut;
// x = the raw inputs {gm_edge, gm_tedge, tm_n, td_d, td_s, tdtop_h, tdtop_a, py_d, py_s, rec_yds_h, rec_yds_a, r_bounce, r_floordog, r_beatthe, mv_sp, mv_to, rest_d, dome, div_game}
// plus spread (home-favored margin) and total_line for the residualizing step. Any missing input -> null (the research dropped such games).
export function stackProb(x) {
  if (!x || !isFinite(x.spread) || !isFinite(x.total_line)) return null;
  let z = M.intercept;
  for (let i = 0; i < M.cols.length; i++) {
    const c = M.cols[i]; let v = x[c];
    if (v == null || !isFinite(v)) return null;
    const r = M.resid[c]; if (r) v = v - (r.a + r.b * x[r.against]);
    z += M.coef[i] * (v - M.mu[c]) / M.sd[c];
  }
  return 1 / (1 + Math.exp(-z));
}
// The inputs from the slate's own pieces (lib/week.js). Returns null when any piece is missing (no line, no model, no TD list, no yards ...).
//  hs / tl = the newest Polymarket home spread / total; hsOpen / tlOpen = the week's first Polymarket reading; mar / tot = the game model's home margin / total;
//  tmP = the TEAM MODEL's chance the home team covers (0-1); td = { home: [{fair}], away: [{fair}] } (fair in %); yards = { home: {py, rec}, away: {py, rec} };
//  picks = the card's rule picks (ids bounceback|spread, floordog|spread, with team); hb = the books' home spread (BEAT THE tiers); rest / dome / div from the schedule.
export function stackInputs({ g, hs, tl, hsOpen, tlOpen, mar, tot, tmP, td, yards, picks, hb, homeRest, awayRest, outdoor, div }) {
  if (!g || hs == null || tl == null || !isFinite(hs) || !isFinite(tl) || hs === 0) return null;
  if (mar == null || tot == null || tmP == null || !td || !yards || !yards.home || !yards.away) return null;
  const sum = (xs) => (xs || []).reduce((a, p) => a + (isFinite(p.fair) ? p.fair / 100 : 0), 0), top = (xs) => Math.max(0, ...(xs || []).map((p) => (isFinite(p.fair) ? p.fair / 100 : 0)));
  if (!(td.home || []).length || !(td.away || []).length) return null;
  const spread = -hs, total_line = tl;
  const teamOf = (c) => c.team || String(c.pick || "").split(" ")[0];
  const bb = (picks || []).find((c) => c && c.id === "bounceback|spread"), fd = (picks || []).find((c) => c && c.id === "floordog|spread");
  const tier = hb != null && isFinite(hb) && [1, 1.5, 2.5, 3.5, 5.5].includes(Math.abs(hb));
  return { spread, total_line,
    gm_edge: mar - spread, gm_tedge: tot - total_line, tm_n: tmP - 0.5,
    td_d: sum(td.home) - sum(td.away), td_s: sum(td.home) + sum(td.away), tdtop_h: top(td.home), tdtop_a: top(td.away),
    py_d: yards.home.py - yards.away.py, py_s: yards.home.py + yards.away.py, rec_yds_h: yards.home.rec, rec_yds_a: yards.away.rec,
    r_bounce: bb ? (teamOf(bb) === g.home ? 1 : -1) : 0, r_floordog: fd ? (teamOf(fd) === g.home ? 1 : -1) : 0, r_beatthe: tier ? (hb < 0 ? -1 : 1) : 0,
    mv_sp: hsOpen != null && isFinite(hsOpen) ? hsOpen - hs : 0, mv_to: tlOpen != null && isFinite(tlOpen) ? tl - tlOpen : 0,
    rest_d: isFinite(homeRest) && isFinite(awayRest) ? homeRest - awayRest : 0, dome: outdoor ? 0 : 1, div_game: div ? 1 : 0 };
}
// The card line + the shadow record: the side STACK leans to at the newest line, its confidence, the honest band %.
export function stackLine(g, hs, x) {
  const p = stackProb(x); if (p == null || !g) return null;
  const home = p > 0.5, team = home ? g.home : g.away, line = home ? hs : -hs, conf = Math.abs(p - 0.5), confident = conf >= M.cut;
  const band = confident ? M.bands.confident : M.bands.under;
  return { id: "stack|spread", kind: "spread", team, line, pick: `${team} ${sg(line)}`, p: Math.round(p * 1000) / 1000, conf: Math.round(conf * 1000) / 1000, confident, pct: band.hit, n: band.n, model: true, teaser: false };
}
