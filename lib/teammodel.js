// TEAM MODEL (10/19, owner: "go off the win success rate of the entire team", option B). The weekly rebuild (railway-model-service/team_side.py)
// publishes a logistic fit + every team's season-so-far numbers for the coming week; this turns them into "home covers at line hs" for a game.
// Tested (tests/team_side/, each season predicted by a model trained only on earlier seasons, 2014-25, closing spread): 60%+ sure 60.3% (217),
// 58-60% sure 55.7% (203), under 58% a coin flip -> lib/stack.js teamModelPick fires only at 58%+.
let TS = null;
export function useTeamSide(t) {
  TS = t && Array.isArray(t.feat) && Array.isArray(t.coef) && t.coef.length === t.feat.length && Array.isArray(t.mean) && Array.isArray(t.sd) && t.teams ? t : null;
}
export const teamSideNow = () => TS;
// probability the HOME team covers at its spread hs (negative = home favored), or null when either team is missing
export function teamSideProb(home, away, hs, ts = TS) {
  if (!ts || hs == null || !isFinite(hs)) return null;
  const H = ts.teams[home], A = ts.teams[away]; if (!H || !A) return null;
  let z = ts.b0;
  for (let i = 0; i < ts.feat.length; i++) {
    const f = ts.feat[i], x = f === "hline" ? hs : (Number(H[f.slice(2)]) || 0) - (Number(A[f.slice(2)]) || 0);   // a missing number counts 0, as in training
    z += ts.coef[i] * (x - ts.mean[i]) / ts.sd[i];
  }
  return 1 / (1 + Math.exp(-z));
}
