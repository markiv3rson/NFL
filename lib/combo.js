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
export function comboChance(legs, p = (l) => l.prob) {
  if (!legs.length || legs.some((l) => p(l) == null)) return null;
  let c = legs.reduce((a, l) => a * p(l), 1);
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) c *= pairLift(legs[i], legs[j], p);
  return Math.min(c, ...legs.map(p));
}
