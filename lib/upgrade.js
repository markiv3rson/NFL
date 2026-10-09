// Upgraded game model (10/9): the game model's own margin and total, corrected with everything else the app knows before kickoff
// (market line and its move since open, weather, rest, age, QB rushing, coaches, last week's result, the 5 stats models, the
// points-based total and the research factors). Ridge regression fit on 2014-25 regular-season games (scan data, same factor
// definitions as lib/stack.js). Tested leave-one-season-out: margin off by 10.01 points (old model 10.26, market ~9.9), total off by
// 10.52 (old 10.81, market ~10.5).
export const UP = {"feat": ["mm", "km", "mt", "kt", "mv", "tmv", "w", "tmp", "out", "restd", "aged", "qbr", "coach", "hpm", "apm", "dv", "s_ens", "t_ens", "s_gbm", "t_gbm", "ptstot", "dogAfterOT", "favAfterOT", "dogAfterMNF", "favAfterMNF", "dogRevenge", "favRevenge", "dogAfterWin28", "favAfterWin28", "dogAfterLoss28", "favAfterLoss28", "dogLookaheadDiv", "favLookaheadDiv", "dogAfterDivWin", "favAfterDivWin", "sandwichAny", "road3rd", "road2nd", "roadOffBye", "homeOffBye", "divRematch", "wk17dogLosing"], "m": [-0.003303, 1.077116, 0.001541, -0.132515, -0.177618, 0.339784, 0.019006, 0.019507, 0.36705, 0.011378, -0.26783, 0.214712, 1.95889, 0.00441, -0.000415, -1.323967, -0.328274, 0.167521, 0.422341, 0.390785, 0.010417, -1.640173, -1.15266, 1.503664, 0.378331, 0.645889, 0.046717, -0.32005, -0.792216, -0.552964, -1.224873, 1.079885, -0.012507, 0.764763, 0.124732, -0.218229, 0.001411, 0.611334, -0.195274, -1.443396, 0.692605, 0.401065], "mi": 3.92159, "t": [-0.117152, 0.123261, -0.202185, 1.067414, -0.191476, 0.006843, -0.222685, 0.01121, 0.365396, 0.040774, 0.68192, 0.052098, -0.029467, 0.041013, 0.013169, -1.539036, -0.42485, -0.148298, -0.810088, -1.083564, 0.009692, -0.881839, 0.302586, 1.717756, 0.381293, 0.464364, 0.462366, 0.010737, -0.27976, -0.217772, 0.817949, -0.198203, 0.179666, -0.594759, -0.838704, 1.192564, 1.022822, -0.934342, -0.644089, 0.317035, 0.92673, 2.63043], "ti": 7.004265};
// x: {feature: value}; missing numbers count as 0 (same as the fit), booleans as 0/1.
export function upgraded(x) {
  let m = UP.mi, t = UP.ti;
  UP.feat.forEach((f, i) => { const v = Number(x[f] === true ? 1 : x[f] === false ? 0 : x[f]) || 0; m += UP.m[i] * v; t += UP.t[i] * v; });
  return { margin: Math.round(m * 10) / 10, total: Math.round(t * 10) / 10 };
}
