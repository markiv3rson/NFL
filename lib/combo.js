// Same-game links between combo legs (10/9). Measured 2016-25 on 4,300-5,100 team-games, steady in 2016-20 and 2021-25:
// a team's RB1/WR1 scores AND the team covers 1.21x / 1.16x as often as two unrelated legs would; a TD AND the Over 1.23x;
// a TD AND the Under 0.77x; RB1 and WR1 of one team 0.97x; spread and total 1.00x. The opposing team covering with a TD
// is the complement (about 0.81x). Legs from different games are unrelated (1.00x).
export const LIFT = { tdCover: 1.19, tdOppCover: 0.81, tdOver: 1.23, tdUnder: 0.77 };
const teamOf = (l) => l.team || (l.kind === "spread" || l.kind === "ml" ? l.team : null);
export function pairLift(a, b) {
  if (!a.game || a.game !== b.game) return 1;
  const [x, y] = a.kind === "td" ? [a, b] : [b, a];
  if (x.kind !== "td") return 1;
  if (y.kind === "spread" || y.kind === "ml") return teamOf(y) === x.team ? LIFT.tdCover : LIFT.tdOppCover;
  if (y.kind === "total") return y.side === "under" || /^Under/.test(y.label || "") ? LIFT.tdUnder : LIFT.tdOver;
  return 1;
}
// Chance every leg hits: product of the legs' own chances times each same-game pair's link, never above the least likely leg.
export function comboChance(legs, p = (l) => l.prob) {
  if (!legs.length || legs.some((l) => p(l) == null)) return null;
  let c = legs.reduce((a, l) => a * p(l), 1);
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) c *= pairLift(legs[i], legs[j]);
  return Math.min(c, ...legs.map(p));
}
