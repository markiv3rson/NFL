// TD calibration: learns from graded results whether the model's stated chance matches reality
// (e.g. "40-50%" players actually scoring 38% of the time) and corrects future numbers to match.
const BUCKETS = [[5, 15], [15, 25], [25, 35], [35, 45], [45, 60], [60, 101]];
// Each bucket's correction is SHRUNK toward "no change": the graded players count against K=150 imaginary players who
// scored exactly as predicted. One noisy week can't swing the numbers (before 9/28: 23 players scoring 22% vs a 39%
// forecast cut every 35-45% player by 30%, the floor, and a 35% player then showed LOWER than a 34.9% player).
// Corrections are interpolated between bucket centers, so a player's number never jumps at a bucket edge.
const K_PRIOR = 150;
// After the weekly retrain puts a NEW touchdown model live (10/6), games graded under the old model count half (OLD_MODEL_W): the old model's
// misses may not be the new one's. sw = { week } of the switch (games from that week on used the new model).
export const OLD_MODEL_W = 0.5;
export function buildCalibration(records, sw = null) {
  const wOf = (r) => (sw && sw.week != null && r.week != null && Number(r.week) < Number(sw.week) && (sw.season == null || Number(r.season) === Number(sw.season)) ? OLD_MODEL_W : 1);
  const tdAll = records.flatMap((r) => (r.td || []).filter((p) => p.played === true).map((p) => ({ ...p, w: wOf(r) })));   // only players KNOWN to have played: before the week's snap counts post (hours after the games) 'played' is unset, and counting those would score inactive players
  const table = BUCKETS.map(([lo, hi]) => {
    const xs = tdAll.filter((p) => p.fair >= lo && p.fair < hi);
    const c = hi > 100 ? 70 : (lo + hi) / 2;
    if (xs.length < 20) return { lo, hi, c, mult: 1, n: xs.length };  // too few graded players yet — leave uncorrected
    const n = xs.reduce((a, p) => a + p.w, 0), hits = xs.reduce((a, p) => a + (p.scored ? p.w : 0), 0);
    const mid = xs.reduce((a, p) => a + p.fair * p.w, 0) / n;
    const shrunk = (hits + K_PRIOR * mid / 100) / (n + K_PRIOR) * 100;
    return { lo, hi, c: mid, mult: Math.max(0.85, Math.min(1.15, shrunk / mid)), n: xs.length };
  });
  return { t: new Date().toISOString(), v: 2, table, ftd: buildFtdCalibration(records), ...(sw ? { switchWeek: sw.week } : {}) };
}
// First-TD-of-the-game calibration (10/6). Same shrunk-bucket method as above, but it stays OFF until FTD_MIN_GAMES graded games have
// first-TD results: on 10/6 there were 15, far too few (a few lucky games would swing it).
export const FTD_MIN_GAMES = 100;
const FTD_BUCKETS = [[0, 5], [5, 10], [10, 15], [15, 101]];
export function buildFtdCalibration(records) {
  const recs = (records || []).filter((r) => (r.td || []).some((p) => p.ftd != null));
  const xs = recs.flatMap((r) => (r.td || []).filter((p) => p.ftd != null && p.played !== false));
  const table = FTD_BUCKETS.map(([lo, hi]) => { const b = xs.filter((p) => p.ftd >= lo && p.ftd < hi), c = hi > 100 ? 20 : (lo + hi) / 2;
    if (b.length < 20) return { lo, hi, c, mult: 1, n: b.length };
    const mid = b.reduce((a, p) => a + p.ftd, 0) / b.length, hits = b.filter((p) => p.ftdHit).length;
    const shrunk = (hits + K_PRIOR * mid / 100) / (b.length + K_PRIOR) * 100;
    return { lo, hi, c: mid, mult: Math.max(0.85, Math.min(1.15, shrunk / mid)), n: b.length }; });
  return { on: recs.length >= FTD_MIN_GAMES, games: recs.length, table };
}
export function applyFtdCalibration(first, calib) {
  const f = calib && calib.ftd; if (first == null || !f || !f.on || !f.table) return first;
  const b = f.table.find((x) => first >= x.lo && first < x.hi) || f.table[f.table.length - 1];
  return Math.round(Math.max(0.1, Math.min(60, first * (b.mult ?? 1))) * 10) / 10;
}
export function applyCalibration(fair, calib) {
  if (fair == null || !calib || !calib.table || !calib.table.length) return fair;
  const t = calib.table;
  if (calib.v !== 2) return fair;   // tables built by the old unshrunk method are ignored until rebuilt at the next grading
  let mult;
  if (fair <= t[0].c) mult = t[0].mult;
  else if (fair >= t[t.length - 1].c) mult = t[t.length - 1].mult;
  else for (let i = 0; i < t.length - 1; i++) if (fair >= t[i].c && fair <= t[i + 1].c) {
    const f = (fair - t[i].c) / (t[i + 1].c - t[i].c || 1); mult = t[i].mult + f * (t[i + 1].mult - t[i].mult); break;
  }
  return Math.max(1, Math.min(97, fair * (mult ?? 1)));
}
// Mirrors td_prob.py's two_plus(): recomputed here so the 2+ TDs number stays consistent after live
// calibration adjusts a player's main chance (otherwise "two" would silently drift out of sync with "fair").
export function twoPlus(fairPct) {
  if (fairPct == null) return null;
  const p = Math.min(Math.max(fairPct / 100, 0), 0.95), lam = -Math.log(1 - p);
  return Math.min(60, 1.044 * (1 - Math.exp(-lam) * (1 + lam)) * 100);   // same factor as td_prob.two_plus (10/14 fix: was 1.035, the service moved to 1.044 on 10/1)
}
const FIRST_OTHER = 0.4, FIRST_OTHER_QB = 0.28;   // same as td_prob.py: 0.28 (defense/special teams) once the pool lists QBs (10/6)
// FIRST TD TEAM MODEL (10/20, owner: "make a model where you choose the first td ... what team will most likely score"): which TEAM scores the
// game's first touchdown, from the closing spread alone -- P(home first | a TD) = sigmoid(0.0975 + 0.0624 x home-favored margin), fit on
// nflverse play-by-play 2014-25 (3,151 games; home first 54.8%, the favorite first 58.4%, no TD at all 0.57%). Walk-forward 2017-25: the
// likelier team scored first 59.9% (said 58.5) on 2,368 games; by band said 52 / 57 / 62 / 67 / 73 hit 57 / 58 / 62 / 62 / 78. Adding the total
// or the implied points did not help (log loss 0.6711 vs 0.6717). scratchpad ftd/team_first.py.
export const FTD_COEF = { a: 0.0975, b: 0.0624 }, FTD_NONE = 0.006, FTD_OTHER_TEAM = 0.4;
// homeSpread = the home team's spread as the site stores it (negative when favored) -> { home, away } chance of scoring the first TD (0-1)
export function teamFirstChance(homeSpread) {
  if (homeSpread == null || !isFinite(Number(homeSpread))) return null;
  const ph = 1 / (1 + Math.exp(-(FTD_COEF.a + FTD_COEF.b * -Number(homeSpread))));
  return { home: (1 - FTD_NONE) * ph, away: (1 - FTD_NONE) * (1 - ph) };
}
// Mirrors td_prob.py's first_td(): a joint, whole-game computation (every listed player's share of the
// game's total expected TDs), so it has to be redone here too once any player's fair% is recalibrated —
// recomputing just one player's "first" number in isolation would be wrong.
// 10/20: with team chances (teamP = { TEAM: chance }) a player's first-TD chance = his team's chance x his share of the team's expected TDs
// (0.4 of a TD per team for defense / special teams / unlisted). Walk-forward 2020-25 (24,961 player-games): the top pick per game said 13.8
// and hit 14.9% (the whole-game share said 14.8, hit 13.6), better in 5 of 6 seasons, every band calibrated within 1-3 points.
export function firstTdShares(players, teamP = null) {
  const lams = players.map((p) => (p.fair == null ? 0 : -Math.log(1 - Math.min(Math.max(p.fair / 100, 0), 0.95))));
  if (teamP) {
    const sum = {}; players.forEach((p, i) => { sum[p.team] = (sum[p.team] || 0) + lams[i]; });
    return lams.map((lam, i) => { const t = players[i].team, pt = teamP[t]; return pt == null ? 0 : (pt * lam) / (sum[t] + FTD_OTHER_TEAM) * 100; });
  }
  const T = lams.reduce((a, b) => a + b, 0) + (players.some((p) => p.pos === "QB") ? FIRST_OTHER_QB : FIRST_OTHER);
  const totalP = 1 - Math.exp(-T);
  return lams.map((lam) => (lam / T) * totalP * 100);
}
