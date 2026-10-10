// Upgraded game model (10/9): the game model's own margin and total, corrected with everything else the app knows before kickoff
// (market line and its move since open, weather, rest, age, QB rushing, coaches, last week's result, the 5 stats models, the
// points-based total and the research factors). Ridge regression fit on 2014-25 regular-season games plus 2026 through week 5 (scan data, same factor
// definitions as lib/stack.js). Tested leave-one-season-out: margin off by 10.01 points (old model 10.26, market ~9.9), total off by
// 10.52 (old 10.81, market ~10.5).
export const UP = {"feat": ["mm", "km", "mt", "kt", "mv", "tmv", "w", "tmp", "out", "restd", "aged", "qbr", "coach", "hpm", "apm", "dv", "s_ens", "t_ens", "s_gbm", "t_gbm", "ptstot", "dogAfterOT", "favAfterOT", "dogAfterMNF", "favAfterMNF", "dogRevenge", "favRevenge", "dogAfterWin28", "favAfterWin28", "dogAfterLoss28", "favAfterLoss28", "dogLookaheadDiv", "favLookaheadDiv", "dogAfterDivWin", "favAfterDivWin", "sandwichAny", "road3rd", "road2nd", "roadOffBye", "homeOffBye", "divRematch", "wk17dogLosing"], "m": [-0.001949, 1.073711, 0.007265, -0.138759, -0.186697, 0.348682, 0.019038, 0.01975, 0.424002, 0.023268, -0.262042, 0.211767, 1.921696, 0.005502, -0.001643, -1.37848, -0.317377, 0.166718, 0.449731, 0.442097, 0.009198, -1.629909, -1.139564, 1.495959, 0.42031, 0.66546, 0.066985, -0.387997, -0.775947, -0.611148, -1.209694, 1.094829, -0.003539, 0.779049, 0.126902, -0.226602, 0.021443, 0.590666, -0.128403, -1.492724, 0.732445, 0.399167], "mi": 3.928582, "t": [-0.110207, 0.116907, -0.212407, 1.073193, -0.181308, 0.030106, -0.22172, 0.010049, 0.319136, 0.035091, 0.60663, 0.062166, -0.029417, 0.04102, 0.014962, -1.41093, -0.478953, -0.179574, -0.793254, -0.88062, 0.008959, -0.900593, 0.287572, 1.718581, 0.32163, 0.423305, 0.420826, -0.214283, -0.316549, -0.164103, 0.821853, -0.223881, 0.158761, -0.626424, -0.855313, 1.220427, 0.971114, -0.847204, -0.684273, 0.324385, 0.844131, 2.615899], "ti": 7.331201};
// x: {feature: value}; missing numbers count as 0 (same as the fit), booleans as 0/1.
// The weekly rebuild on Railway (weekly_rebuild.py) replaces these coefficients when it publishes a new set (lib/combomodel.js).
let CUR = null, CUR_EARLY = null;
export function useCoefficients(up, early) { CUR = up && up.feat && up.m ? up : null; CUR_EARLY = early && early.feat && early.t ? early : null; }
export function upgraded(x) {
  const C = CUR || UP;
  let m = C.mi, t = C.ti;
  C.feat.forEach((f, i) => { const v = Number(x[f] === true ? 1 : x[f] === false ? 0 : x[f]) || 0; m += C.m[i] * v; t += C.t[i] * v; });
  return { margin: Math.round(m * 10) / 10, total: Math.round(t * 10) / 10 };
}

// Early-week total (10/9): the same correction but knowing only the OPENING lines (no closing line, no line move), so it can be used
// before the market moves. Tested leave-one-season-out on 2,522 games 2014-25: its side of the opening total won 54.5%
// (53.2 / 56.7 / 53.7% by period); graded at the closing total it drops to 53.4%, so the edge is getting the early number.
export const UP_EARLY = {"feat": ["mm", "km", "mt", "kt", "w", "tmp", "out", "restd", "aged", "qbr", "coach", "hpm", "apm", "dv", "s_ens", "t_ens", "s_gbm", "t_gbm", "ptstot", "dogAfterOT", "favAfterOT", "dogAfterMNF", "favAfterMNF", "dogRevenge", "favRevenge", "dogAfterWin28", "favAfterWin28", "dogAfterLoss28", "favAfterLoss28", "dogLookaheadDiv", "favLookaheadDiv", "dogAfterDivWin", "favAfterDivWin", "sandwichAny", "road3rd", "road2nd", "roadOffBye", "homeOffBye", "divRematch", "wk17dogLosing"], "t": [-0.118299, 0.118372, 0.114651, 0.697423, -0.223529, 0.031865, -0.461197, 0.007241, 0.616853, 0.078218, 0.154602, 0.052779, 0.02762, -1.670802, -0.365604, -0.221893, -0.989512, -0.912477, 0.011029, -0.876108, 0.248945, 1.703062, 0.306476, 0.416645, 0.294706, -0.031841, -0.223777, 0.04934, 1.098979, -0.140131, 0.257629, -0.577858, -0.849922, 1.283945, 0.917393, -0.801764, -0.654122, 0.467124, 0.711351, 2.44807], "ti": 8.476987};
export function upgradedEarlyTotal(x) {
  const C = CUR_EARLY || UP_EARLY;
  let t = C.ti;
  C.feat.forEach((f, i) => { const v = Number(x[f] === true ? 1 : x[f] === false ? 0 : x[f]) || 0; t += C.t[i] * v; });
  return Math.round(t * 10) / 10;
}
