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
export function comboChance(legs, p = (l) => l.prob) {
  if (!legs.length || legs.some((l) => p(l) == null)) return null;
  let c = legs.reduce((a, l) => a * p(l), 1), up = 1, down = 1;
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const f = pairLift(legs[i], legs[j], p); if (isSide(legs[i]) && isSide(legs[j])) c *= f; else if (f > 1) up *= f; else down *= f; }
  return Math.min(c * Math.pow(up, LIFT_POWER) * down, ...legs.map(p));
}
// Polymarket's payout for a parlay (10/17, owner: the app showed NO ML + Over 46.5 + D.Vele TD + J.Johnson TD at 62x, Polymarket's own combo paid
// 33.92x). Polymarket prices a same-game combo with its links (a team's win, the Over and its scorers ride together), so the payout is 1 / the
// legs' PRICES run through the same link math as the chance: 0.50 x 0.49 x 0.25 x 0.27 x links 1.77 = 2.9% -> 34x. Legs in different games have no
// link, so a parlay across games stays the prices multiplied. null when a leg has no price.
export function comboPay(legs) {
  if (!Array.isArray(legs) || !legs.length || !legs.every((l) => l.price > 0 && l.price < 1)) return null;
  const c = comboChance(legs, (l) => l.price); return c > 0 ? 1 / c : null;
}
