// The Model card's two answers (the NFL app's card, 10/15, applied to NBA data):
//   PICK            -- the side a TESTED rule likes, at Polymarket's own line, with its win rate; no rule -> the model's side at the main line,
//                      shown at the model's honest history (regular season 2025-26, 1,783 games, each game predicted before it was played)
//   PICK w/ POINTS  -- 2 points is the first buy (owner 10/16): the fewest points (2+) that reach 56% on EITHER team; none reaching it -> the highest
//                      win rate within 2 points. A 1-point line is listed but never chosen: on unseen seasons (2008-26, each left out) the 1-point
//                      buys the old rule chose said 56.5% and won 53.7% (1,570 games); the same games at 2 points won 54.8%.
//   rows            -- every line you could buy (both teams; Over AND Under): Polymarket's main line ("main") and every alternate up to 7 points from
//                      it (owner 10/16: "check buying 2 3 4 5 6 7 points"), each with its historical win rate given a main line like this one
//                      (railway-model-service live._lines) and its price. PICK w/ POINTS still comes from the lines within 2 points, except a 2.5-3.5
//                      point line that beats the best line within 2 points by 3+ win points; deeper lines are shown, never the pick (each point bought
//                      costs about what it wins: history +3.6 win points per point on spreads near the line, +2.2 on totals; Pinnacle's own chance
//                      matches that history within half a point and you pay ~2 points of vig on top, measured 10/16 on 240 alternate lines).
// Win rate decides, price is only shown (owner 10/15). Colors on the page: green 56%+, light green 53-55%, yellow below.
const r1 = (x) => Math.round(x * 10) / 10;
const sg = (x) => (x > 0 ? "+" : "") + x;
export const PTS_BAR = 56, FAR_GAIN = 3, MIN_BUY = 2, RULE_POINTS = 2, MAX_BUY = 3.5, MAX_LIST = 7;
// the model's own side at the main line: honest rate on games the fit never saw (official-report injury basis, 2025-26). 10/17 pass: updated to the
// 10/17 rebuild's own report (trained 2022-24, tested 2025-26, 2,462 games: spread side 49.4%, total side 50.4%; it was 50.3 / 50.5 on 1,783 games)
export const MODEL_HIT = { spread: 49.4, total: 50.4 }, MODEL_N = 2462;
// LINE MOVE (Pinnacle moved 3+ points since its first sighting; 2024-25 + 2025-26 opening / closing lines, nothing fitted): the side the line moved
// toward won 67.9% of 483 games at the OPENING number and 56.3% at the closing number (56.6 / 56.0 by season); totals 61.8% at the open only.
export const MOVE_HIT = { spreadOpen: 67.9, spreadClose: 56.3, totalOpen: 61.8 }, MOVE_N = 483, MOVE_N_T = 1142;
// FATIGUE (10/16, closing lines 2008-26, one side fatigued only, bet the OTHER side): back-to-back after OVERTIME 57.8% of 465 games
// (55.4 / 60.6 / 58.0 by period, 13 of 19 seasons, +1.75 pts vs the line); AWAY team on a back-to-back after flying 1,500+ km 56.3% of 460
// (59.1 / 53.5 / 55.7, 15 of 19 seasons). The home version of the flight rule does not hold (50.9%), and a plain back-to-back is priced (50.9%).
export const FATIGUE_HIT = { ot: 57.8, far: 56.3 }, FATIGUE_N = { ot: 465, far: 460 };
export function fatigueRule(g) {
  const f = g && g.fatigue; if (!f) return null;
  const tired = (side) => { const x = f[side]; if (!x) return null; if (x.ot) return "ot"; if (x.far && side === "away") return "far"; return null; };
  const th = tired("home"), ta = tired("away");
  if ((th && ta) || (!th && !ta)) return null;                 // both tired or neither: no rule
  const reason = th || ta, team = th ? g.away : g.home;        // bet the fresh side
  return { team, reason, hit: FATIGUE_HIT[reason], n: FATIGUE_N[reason], why: `FATIGUE ${reason === "ot" ? "OT" : "TRAVEL"}` };
}
// ATS REGRESSION (10/16, closing lines 2008-26, computed the way the live service does: season-to-date covers over lined games): an AWAY team that
// has covered 35% or less of 20+ lined games covers 57.3% of 358 (56.1 / 56.1 / 59.0 by period, 14 of 19 seasons; 20 shuffles of the results found 0
// such angles). It is a sharp edge: at 40% it is 51.9%, with 15+ games 55.2%, 25+ games 56.0%; the home version does not hold (50.3%), nor does fading
// a hot team (50.6%). Needs 20+ lined games this season, so it can only fire from about December.
export const ATS_HIT = 57.3, ATS_N = 358, ATS_MAX = 0.35, ATS_MIN_N = 20;
export function atsRule(g) {
  const c = g && g.context && g.context.away; if (!c) return null;
  if (!(Number(c.ats_n) >= ATS_MIN_N) || !(Number(c.ats_pct) <= ATS_MAX)) return null;
  return { team: g.away, hit: ATS_HIT, n: ATS_N, why: `ATS ${Math.round(Number(c.ats_pct) * 100)}%`, ruleId: "atsreg|spread" };
}
// SHOT QUALITY (10/17, every regular-season shot 2008-26 priced by the make rate of shots like it -- 2 or 3, distance, dunk / layup / jumper...;
// research/shot_quality.py on nba.com's shot data, shot_quality_espn.py on ESPN's play-by-play, the feed the service reads nightly): Over when
// both teams' games have run COLD against their shots (last 20 games, 6.9+ points below the season's running average, both 10+ games) or the
// shots of both teams' last 10 games are worth 10.9+ points more than the total (against the season's running average, both 5+ games).
// Over won 55.2% of 2,569 games (55.1 / 54.3 / 56.3 by period, 17 of 19 seasons; found on 2008-19 54.7%, 2020-26 56.3%; the last two seasons
// 50.0 / 52.5); with cut-offs from the other seasons only it holds; 50 shuffles of the results: 0.02 of 3 such rules pass. The Under side does not hold.
export const SHOT_HIT = 55.2, SHOT_N = 2569, SHOT_COLD = -6.9, SHOT_SQ = 10.9;
export function shotRule(g, tl) {
  const h = g && g.context && g.context.home, a = g && g.context && g.context.away; if (!h || !a || tl == null) return null;
  const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const hl = num(h.sq_l20), al = num(a.sq_l20), hx = num(h.sq_x10), ax = num(a.sq_x10), cmu = num(h.sq_cold_mu), smu = num(h.sq_mu);
  const cold = hl != null && al != null && cmu != null && Number(h.sq_gp) >= 10 && Number(a.sq_gp) >= 10 && hl + al - cmu <= SHOT_COLD;
  const sq = hx != null && ax != null && smu != null && Number(h.sq_gp) >= 5 && Number(a.sq_gp) >= 5 && (hx + ax) / 2 - tl - smu >= SHOT_SQ;
  return cold || sq ? { side: "over", hit: SHOT_HIT, n: SHOT_N, why: "SHOT QUALITY", ruleId: "shotq|total" } : null;
}
export const isGreen = (hit) => hit >= PTS_BAR;

function finishRows(rows) {                                                               // the list: the main line and every alternate up to 7 points
  return rows.filter((r) => r.points <= MAX_LIST)
    .sort((x, y) => x.points - y.points || (y.first ? 1 : 0) - (x.first ? 1 : 0) || y.hit - x.hit).map(({ first, ...r }) => r);
}
function pickPts(rows) {
  const near = rows.filter((r) => r.points <= RULE_POINTS), top = Math.max(0, ...near.map((r) => r.hit));
  const far = rows.filter((r) => r.points > RULE_POINTS && r.points <= MAX_BUY && r.hit >= top + FAR_GAIN);   // a 2.5-3.5 point line only when it clearly wins more
  if (far.length) return far.slice().sort((x, y) => y.hit - x.hit)[0];
  const b = near.filter((r) => r.points >= MIN_BUY); if (!b.length) return null;        // 2 points first: a 1-point line is never the buy
  const ok = b.filter((r) => r.hit >= PTS_BAR);
  if (ok.length) { const m = Math.min(...ok.map((r) => r.points)); return ok.filter((r) => r.points === m).sort((x, y) => y.hit - x.hit)[0]; }
  return b.slice().sort((x, y) => y.hit - x.hit || x.points - y.points)[0];
}
const priced = (p) => (typeof p === "number" && p > 0 && p < 1 ? p : null);
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.5;

function spreadPart(g) {
  const ps = g.poly && g.poly.spread, hs = ps && isFinite(ps.homeSpread) ? Number(ps.homeSpread) : null;
  if (hs == null) return null;
  const lines = (g.lines || []).filter((x) => x.market === "spread" && isFinite(x.hist) && isFinite(x.line));
  const sig = g.move && g.move.signal && g.move.signal.spread, m = g.model, fat = fatigueRule(g);
  let plain = null, team = null, lm = null;
  if (sig && sig.team && (sig.team === g.home || sig.team === g.away)) {           // tested rule: LINE MOVE names the side
    const t = sig.team, line = t === g.home ? hs : -hs, atOpen = near(line, sig.open);
    lm = { team: t, hit: atOpen ? MOVE_HIT.spreadOpen : MOVE_HIT.spreadClose, n: MOVE_N, why: `LINE MOVE ${sig.pts}`, ruleId: "linemove|spread", atOpen };
  }
  const rule = [lm, fat ? { ...fat, ruleId: "fatigue|spread" } : null, atsRule(g)].filter(Boolean).sort((a, b) => b.hit - a.hit)[0] || null;   // several rules: the higher tested rate names the side
  if (rule) {
    team = rule.team; const line = team === g.home ? hs : -hs;
    plain = { id: "cardpick|spread", ruleId: rule.ruleId, kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit: rule.hit, n: rule.n, price: priced(team === g.home ? ps.home : ps.away), why: rule.why, ...(rule.atOpen != null ? { atOpen: rule.atOpen } : {}) };
  } else if (m && isFinite(m.margin) && hs !== 0) {                                 // no rule: the model's side at the main line (a tie goes to the favorite)
    const d = m.margin + hs; team = d > 0 ? g.home : d < 0 ? g.away : hs < 0 ? g.home : g.away;
    const line = team === g.home ? hs : -hs;
    plain = { id: "modelpick|spread", ruleId: "model|spread", kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit: MODEL_HIT.spread, n: MODEL_N, price: priced(team === g.home ? ps.home : ps.away) };
  }
  const raw = [];
  for (const x of lines) {
    const first = !!plain && x.team === plain.team;
    const hit = first && x.points === 0 ? plain.hit : x.hist;
    raw.push({ team: x.team, line: x.line, points: x.points, hit: r1(hit), n: x.n, price: priced(x.price), pick: x.label || `${x.team} ${sg(x.line)}`, first });
  }
  const rows = finishRows(raw), b = pickPts(rows), pts = b ? { id: "ptspick|spread", kind: "spread", ...b, ruleId: plain ? plain.ruleId : null } : null;
  if (!plain && !rows.length) return null;
  return { kind: "spread", plain, pts, rows };
}
function totalPart(g) {
  const pt = g.poly && g.poly.total, tl = pt && isFinite(pt.line) ? Number(pt.line) : null;
  if (tl == null) return null;
  const lines = (g.lines || []).filter((x) => x.market === "total" && isFinite(x.hist) && isFinite(x.line));
  const sig = g.move && g.move.signal && g.move.signal.total, m = g.model, nm = (sd) => (sd === "over" ? "Over" : "Under");
  let plain = null;
  const lm = sig && sig.side && near(tl, sig.open)                                   // LINE MOVE on totals holds only while Polymarket still has the opening number
    ? { side: sig.side, hit: MOVE_HIT.totalOpen, n: MOVE_N_T, why: `TOTAL MOVE ${sig.pts}`, ruleId: "linemove|total", atOpen: true } : null;
  const rule = [lm, shotRule(g, tl)].filter(Boolean).sort((a, b) => b.hit - a.hit)[0] || null;   // several rules: the higher tested rate names the side
  if (rule) {
    plain = { id: "cardpick|total", ruleId: rule.ruleId, kind: "total", side: rule.side, line: tl, pick: `${nm(rule.side)} ${tl}`, hit: rule.hit, n: rule.n, price: priced(rule.side === "over" ? pt.over : pt.under), why: rule.why, ...(rule.atOpen != null ? { atOpen: rule.atOpen } : {}) };
  } else if (m && isFinite(m.total)) {                                              // no rule: the model's total against the main total (a tie goes Under)
    const side = m.total > tl ? "over" : "under";
    plain = { id: "modelpick|total", ruleId: "model|total", kind: "total", side, line: tl, pick: `${nm(side)} ${tl}`, hit: MODEL_HIT.total, n: MODEL_N, price: priced(side === "over" ? pt.over : pt.under) };
  }
  const raw = [];
  for (const x of lines) {
    const first = !!plain && x.side === plain.side;
    const hit = first && x.points === 0 ? plain.hit : x.hist;
    raw.push({ side: x.side, line: x.line, points: x.points, hit: r1(hit), n: x.n, price: priced(x.price), pick: x.label || `${nm(x.side)} ${x.line}`, first });
  }
  const rows = finishRows(raw), b = pickPts(rows), pts = b ? { id: "ptspick|total", kind: "total", ...b, ruleId: plain ? plain.ruleId : null } : null;
  if (!plain && !rows.length) return null;
  return { kind: "total", plain, pts, rows };
}
export function buildCard(g) {
  if (!g || g.inProgress) return null;
  const spread = spreadPart(g), total = totalPart(g);
  return spread || total ? { spread, total, test: !!g.preseason } : null;
}
// the straight picks of one game that count for Best bets / the parlay: the card's PICK at Polymarket's own line (green only) and the moneyline PICK
export function cardLegs(g) {
  const out = []; if (!g || !g.card || g.card.test) return out;
  for (const k of ["spread", "total"]) { const x = g.card[k] && g.card[k].plain; if (x && x.line != null) out.push({ ...x, market: k, label: x.pick, pct: x.hit }); }
  return out;
}
export const ptsLeg = (g, k) => (g && g.card && !g.card.test && g.card[k] && g.card[k].pts ? { ...g.card[k].pts, market: k, label: g.card[k].pts.pick, pct: g.card[k].pts.hit, bought: true } : null);
