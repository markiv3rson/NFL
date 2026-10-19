// Same-game links between combo legs (10/9). Measured 2016-25 on 4,300-5,100 team-games, steady in 2016-20 and 2021-25:
// a team's RB1/WR1 scores AND the team covers 1.21x / 1.16x as often as two unrelated legs would; a TD AND the Over 1.23x;
// a TD AND the Under 0.77x; RB1 and WR1 of one team 0.97x; spread and total 1.00x. The opposing team covering with a TD
// is the complement (about 0.81x). Legs from different games are unrelated (1.00x).
export const LIFT = { tdCover: 1.19, tdOppCover: 0.81, tdOver: 1.23, tdUnder: 0.77 };
const teamOf = (l) => l.team || (l.kind === "spread" || l.kind === "ml" ? l.team : null);
const isSide = (l) => l.kind === "spread" || l.kind === "ml";   // a bet on one team's margin (its spread or its moneyline)
// Two side bets in the same game (10/14 fix, owner): they ride on the same final margin, so they are NOT unrelated. Same team: one implies
// the other (a favorite covering -2.5 has won; an underdog winning has covered +3.5) -> both hit = the less likely one. Opposite teams:
// both hit only in the window between them (SEA wins AND DEN +3.5 covers = SEA by 1-3) -> pA + pB - 1, never below 0. Before, the
// app multiplied them as if unrelated: DEN +3.5 (59%) + SEA ML (57%) showed 34%; history at those lines says about 13%.
export function pairLift(a, b, p = (l) => l.prob) {
  if (!a.game || a.game !== b.game) return 1;
  if (isSide(a) && isSide(b)) { const pa = p(a), pb = p(b); if (!(pa > 0) || !(pb > 0)) return 1;
    const both = teamOf(a) === teamOf(b) ? Math.min(pa, pb) : Math.max(0, pa + pb - 1); return both / (pa * pb); }
  const [x, y] = a.kind === "td" ? [a, b] : [b, a];
  if (x.kind !== "td") return 1;
  if (isSide(y)) return teamOf(y) === x.team ? LIFT.tdCover : LIFT.tdOppCover;
  if (y.kind === "total") return y.side === "under" || /^Under/.test(y.label || "") ? LIFT.tdUnder : LIFT.tdOver;
  return 1;
}
// Chance every leg hits: product of the legs' own chances times each same-game pair's link, never above the least likely leg.
// 10/16 (owner: "fix what you find"): the TOUCHDOWN links overlap when a parlay has several of them (a team's win, the Over and its scorers all
// ride the same game script), so their product is shrunk: lift product ^ LIFT_POWER. Measured 2021-25 on 1,359 favorite team-games with the
// walk-forward TD model: favorite ML + top TD, the app said 37.2% and 36.9% hit (one link); ML + Over + top TD said 22.9%, hit 20.9%
// (two links: measured 1.32x vs the app's 1.19 x 1.23 = 1.46x); ML + Over + top 2 scorers said 12.4%, hit 9.6% (four links). With the power
// 0.75 those become 35.6 / 20.9 / 10.3%. Only the links ABOVE 1 are shrunk: the drags (a TD with the Under, a TD against the other team's cover)
// compound at least fully -- the owner's style with the Under (cover + Under + a TD each team) hit 1.99% on 754 games 2021-25 where the full product
// said 2.63% and a shrunk product would say 3.02%; with the Over it hit 6.90% (full product 6.71%). The side-vs-side factor (two bets on the same
// margin) is structural and is NOT shrunk.
export const LIFT_POWER = 0.75;
// A team's MONEYLINE with its own scorer (10/19 parlay gaps, owner: "start making better decisions on parlays"): the link depends on how likely the
// team is to win (2019-25 walk-forward TD model, team's top scorer / underdog's RB1): favorite 50-70% 1.16-1.18x, 70%+ only 1.05x (a heavy
// favorite wins with or without its scorer); underdog 35-50% 1.23-1.34x, under 35% 1.63-1.80x (when a long shot wins, its back usually scored).
// Used for the CHANCE only; the payout keeps Polymarket's own flat links (comboPay, fitted on real quotes).
export const mlTdLift = (p) => (p >= 0.7 ? 1.05 : p >= 0.5 ? 1.17 : p >= 0.35 ? 1.27 : 1.7);
const chanceLift = (a, b, p) => { const [m, t] = a.kind === "ml" ? [a, b] : [b, a];
  return m.kind === "ml" && t.kind === "td" && m.game && m.game === t.game && m.team === t.team && p(m) > 0 ? mlTdLift(p(m)) : pairLift(a, b, p); };
export function comboChance(legs, p = (l) => l.prob) {
  if (!legs.length || legs.some((l) => p(l) == null)) return null;
  let c = legs.reduce((a, l) => a * p(l), 1), up = 1, down = 1;
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const f = chanceLift(legs[i], legs[j], p); if (isSide(legs[i]) && isSide(legs[j])) c *= f; else if (f > 1) up *= f; else down *= f; }
  return Math.min(c * Math.pow(up, LIFT_POWER) * down, ...legs.map(p));
}
// Polymarket's payout for a parlay (10/17, owner). Polymarket prices a combo with the links where legs HELP each other (a team's win, the Over and its
// scorers ride together) but pays nothing extra for legs that work AGAINST each other (a TD for one team with the other team's cover, a TD with the
// Under), and keeps a small cut. Fitted on the owner's two real quotes: NO ML .50 + Over 46.5 .49 + D.Vele TD .25 + J.Johnson TD .27 -> Polymarket
// 33.92x (this 33.4x); TB +2.5 .495 + Over 38.5 .525 + J.Warren (PIT) TD .46 + B.Irving TD .35 -> 14.79x (this 15.0x; with the drag counted it said 19x).
// The parlay's CHANCE (comboChance) keeps the drags: they are measured history. Two side bets on one game (same margin) stay structural.
export const PM_CUT = 0.977;   // geometric mean of the two quotes' ratio to the link-only price (0.993 and 0.962)
export function comboPay(legs) {
  if (!Array.isArray(legs) || !legs.length || !legs.every((l) => l.price > 0 && l.price < 1)) return null;
  const p = (l) => l.price; let c = legs.reduce((a, l) => a * l.price, 1), up = 1;
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const f = pairLift(legs[i], legs[j], p); if (isSide(legs[i]) && isSide(legs[j])) c *= f; else if (f > 1) up *= f; }
  c = Math.min(c * Math.pow(up, LIFT_POWER), ...legs.map(p));
  return c > 0 ? (legs.length > 1 ? PM_CUT : 1) / c : null;
}
