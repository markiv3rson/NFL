// The Model card's two answers (the NFL app's card, 10/15, applied to NBA data):
//   PICK            -- the side a TESTED rule likes, at Polymarket's own line, with its win rate; no rule -> the model's side at the main line,
//                      shown at the model's honest history (regular season 2025-26, 1,783 games, each game predicted before it was played)
//   PICK w/ POINTS  -- 10/29 (owner: "+5 - +10"): the fewest points from 5 to 10 on the PICK's side (PTS_MIN; 10/29 night: a model-side SPREAD takes the team
//                      whose 5-10 point line wins more, spreadPart); never on the model-side TOTAL (10/26
//                      night, a coin flip whose bought points went 18-21 live). 10/16-10/28: the fewest points (2+) that reached 56%, within 2 points.
//   rows            -- every line you could buy (both teams; Over AND Under): Polymarket's main line ("main") and every alternate up to 7 points from
//                      it (owner 10/16: "check buying 2 3 4 5 6 7 points"), each with its historical win rate given a main line like this one
//                      (railway-model-service live._lines) and its price. The page's MORE list shows only the lines that win (56%+), 10/29.
// Win rate decides, price is only shown (owner 10/15). Colors on the page: green 56%+, light green 53-55%, yellow below.
const r1 = (x) => Math.round(x * 10) / 10;
const sg = (x) => (x > 0 ? "+" : "") + x;
export const PTS_BAR = 56, MAX_LIST = 7;
// 10/29 (owner: "+5 - +10", both sports): PICK w/ POINTS buys 5 to 10 points on the PICK's side -- the fewest listed, never past 10. Closing lines
// (the service's history, any side, nothing fitted): +5 won 67.9 / 66.5 / 66.1% on spreads 2008-16 / 2017-23 / 2024-26 (10/29 night: the 59.9 / 59.8 /
// 58.2 first quoted here read the home line with the wrong sign; the service's own table was always right) and 61.7 / 61.0 / 61.1% on totals; the app's own 2026-27 PICKs re-graded at +5: spreads 73-39 (65.2%), totals 49-40 (55.1%; +5.5 59.0%). The model-side total still has none.
export const PTS_MIN = 5, PTS_MAX = 10;
// 10/29 late (owner: "72% and up for the model, Polymarket ... cap it at 82"): PICK w/ POINTS = the fewest points from 5 to 10 whose shown % is 72+
// (totals 70+: even +10 wins ~71% on NBA totals) priced 82c or less; none reaching it -> the highest % priced 82c or less. Each season's line table
// from earlier seasons, 2016-27 (price ~ the line's own % + 2c): no-rule spreads 67.8 -> 71.1% (5.2 -> 6.3 points; 2025-27 66.8 -> 69.1, with the
// table from the last 3 seasons 71.0 -- the service's table, live.py RECENT_SEASONS), LINE MOVE spreads 70.2 -> 72.6% (5.1 -> 6.2).
// PTS_KEEP: a rule's lift over the table counts half on lines 5+ points out (the NFL replay: k 0.53 spreads, 0.44 totals).
export const PTS_TARGET = { spread: 72, total: 70 }, PTS_CAP = 0.82, PTS_KEEP = 0.5;
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
// BOOK GAP (10/24): the sportsbooks' consensus line sits 1-4 points (spread) or 2-6 points (total) off Polymarket's main line -> the books' side
// at Polymarket's number. Polymarket's real 2025-26 closes vs the books' closes (data/poly_closes_2026.csv + kaggle_lines_2025_26.csv, 574 games
// matched): spread 157-106 = 59.7% of 263 (Oct-Jan 58 / Jan-Apr 61), total 127-71 = 64.1% of 198 (61 / 67; Over 66-41, Under 61-30), with the
// thresholds the live shadow tracker set on 10/14 before this test (books-vs-Polymarket "bgap": 14-8 live 10/20-23). Bigger gaps are bad reads
// (-20 / -17 on a mismatched line) and give no rule; a 1-1.5 total gap is 51.8%. Needs a books pull from the last 6 hours (books pulled twice a day).
// 10/27 night (research): that file's line is Polymarket's BUSIEST line, and on most spread rows its price already leaned to the books' side (53-60c);
// the live card compares the books with the line nearest 50c. On rows priced 45-55c (the live case) the spread rule won 57.3% of 171 (55.0 / 59.3 by
// half; +1 / +2 / +3 points 61.4 / 64.3 / 68.4) -- 59.7 ran 2.4 high; totals 64.8% of 91 there = the 64.1% kept.
// 10/29 recheck (owner: "retest the book gap"): live the rule went 14-18 (spread 9-10, total 5-8) because the live card compared Polymarket with a books
// pull up to 6 HOURS old (7 AM / 1 h before the first tip) while the test above used the books' CLOSING line. The same 603 games with the books' OPENING
// line (the stale case): spread 134-158 = 45.9%, total 104-117 = 47.1%, and none of 290 gap / side options holds on the later half; with the books'
// closing line it holds on the later half (spread 1-4 pts 97-64 = 60.2%, total 2-6 pts 75-37 = 67.0%). So the rule counts only on a books line pulled
// within 90 minutes before the game's own tip (lib/books.js pulls spreads + totals before every tip-off wave).
export const BGAP_HIT = { spread: 57.3, total: 64.1 }, BGAP_PTS = { spread: { 1: 61.4, 2: 64.3, 3: 68.4 }, total: { 1: 65.2, 2: 66.7, 3: 68.2 } }, BGAP_N = { spread: 171, total: 198 }, BGAP_SP = [1, 4], BGAP_TOT = [2, 6], BGAP_TIP_MS = 90 * 60e3;
export const bgapFresh = (g) => { const b = Date.parse(g && g.booksAt), tip = Date.parse(g && g.start); return isFinite(b) && isFinite(tip) && b <= tip && tip - b <= BGAP_TIP_MS; };
export function bookGapRule(g, kind) {
  const bk = g && g.books, px = g && g.poly; if (!bk || !px || !bgapFresh(g)) return null;
  if (kind === "spread") {
    const b = bk.spread && Number(bk.spread.homeSpread), p = px.spread && Number(px.spread.homeSpread);
    if (!isFinite(b) || !isFinite(p)) return null;
    const gap = Math.abs(p - b); if (gap < BGAP_SP[0] || gap > BGAP_SP[1]) return null;
    return { team: b < p ? g.home : g.away, hit: BGAP_HIT.spread, ptsHit: BGAP_PTS.spread, n: BGAP_N.spread, why: `BOOK GAP ${gap}`, ruleId: "bookgap|spread" };
  }
  const b = bk.total && Number(bk.total.line), p = px.total && Number(px.total.line);
  if (!isFinite(b) || !isFinite(p)) return null;
  const gap = Math.abs(b - p); if (gap < BGAP_TOT[0] || gap > BGAP_TOT[1]) return null;
  return { side: b > p ? "over" : "under", hit: BGAP_HIT.total, ptsHit: BGAP_PTS.total, n: BGAP_N.total, why: `BOOK GAP ${gap}`, ruleId: "bookgap|total" };
}
export const isGreen = (hit) => hit >= PTS_BAR;

function finishRows(rows) {                                                               // the list: the main line and every alternate up to 7 points
  return rows.filter((r) => r.points <= MAX_LIST)
    .sort((x, y) => x.points - y.points || (y.first ? 1 : 0) - (x.first ? 1 : 0) || y.hit - x.hit).map(({ first, ...r }) => r);
}
function pickPts(rows, target = PTS_TARGET.spread) {   // 10/29 late: the fewest points 5-10 reading TARGET+ at 82c or less (the highest % among equals); none -> the highest % at 82c or less
  const ok = rows.filter((r) => r.points >= PTS_MIN && r.points <= PTS_MAX && r.price > 0 && r.price <= PTS_CAP); if (!ok.length) return null;
  const b = ok.filter((r) => r.hit >= target); if (!b.length) return ok.reduce((a, r) => (r.hit > a.hit || (r.hit === a.hit && r.points < a.points) ? r : a));
  const m = Math.min(...b.map((r) => r.points)); return b.filter((r) => r.points === m).sort((x, y) => y.hit - x.hit)[0];
}
const noFirst = ({ first, ...r }) => r;
// two teams' PICK w/ POINTS lines (model-side spread): the one reaching the target wins; both -> the fewer points, then the higher %; neither -> the higher %
export function betterPts(a, b, target = PTS_TARGET.spread) {
  if (!a || !b) return a || b; const ta = a.hit >= target, tb = b.hit >= target;
  if (ta !== tb) return ta ? a : b; if (ta && a.points !== b.points) return a.points < b.points ? a : b; return b.hit > a.hit ? b : a;
}
const priced = (p) => (typeof p === "number" && p > 0 && p < 1 ? p : null);
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.5;

// 10/24 (re-check, the NFL card's 10/23 fix): a rule's PICK reads its tested rate (LINE MOVE 67.9%) while the lines with MORE points on the same side
// read the plain table (MEM +1.5 57.6% under a MEM -1.5 PICK at 56.3%; a 2-point buy under a 67.9% PICK read ~58%). Now every line carries the PICK's
// lift over the table: table rate + (PICK % - the table's rate on the PICK's main line), the other side the same amount down, never under its side's
// main line. 2024-26 opening / closing lines (2,500 games): LINE MOVE spreads at +1 / +2 / +3 points won 71.0 / 72.7 / 74.1% (lift says 71.4 / 74.4 /
// 77.4), totals 63.8 / 65.2 / 67.5% (lift 63.8 / 65.5 / 68.1). Only a rule's PICK carries a lift: the model side's 49.4 / 50.4% is one number for every game
// and has no walk-forward to test it line by line, so its lines keep the table's rates (the two sides of the main line still add to 100).
// a rule measured line by line on real Polymarket closes (BOOK GAP): its own rate at each bought point, straight between the measured points, the 3-point rate past 3
function ptsRate(ph, h0, pts) {
  const v = [h0, ph[1], ph[2], ph[3]];
  if (pts >= 3) return r1(v[3]);
  const i = Math.floor(pts), f = pts - i;
  return r1(v[i] + (v[i + 1] - v[i]) * f);
}
// 10/29 weekend check (the NFL card's fix; PICK w/ POINTS buys 5-10 points): on SPREADS a rule PICK's own more-points lines keep its edge as a share of the
// losses (loss ratio) instead of adding it: LINE MOVE spreads measured +1 / +2 / +3 won 71.0 / 72.7 / 74.1% (adding said 71.4 / 74.4 / 77.4 and keeps
// growing past it; loss ratio 70.1 / 71.7 / 72.9); NFL rules replayed at +5-10 the same way. Totals keep adding (63.8 / 65.2 / 67.5 vs 63.8 / 65.5 / 68.1).
function boundRows(raw, plain, mine, ratio = false) {
  if (!plain || !isFinite(plain.hit)) return raw;
  const m0 = raw.find((r) => r.points === 0 && mine(r)), base = m0 && isFinite(m0.hist) ? m0.hist : null, lift = base == null || !String(plain.id).startsWith("cardpick|") ? 0 : plain.hit - base;
  const p = r1(plain.hit), q = r1(100 - plain.hit), ph = plain.ptsHit;
  const up = (r) => (ratio && lift && base < 100 ? r1(100 - ((100 - r.hist) * (100 - plain.hit)) / (100 - base)) : r1(r.hist + lift));
  return raw.map((r) => { const own = mine(r), floor = own ? p : q;
    // 10/29 night recheck: BOOK GAP's measured rates stop at 3 points; past 3 the line reads the larger of that 3-point rate and the table + half the
    // lift (a +8 BOOK GAP line read 68.4%, the 3-point rate, where the table alone said ~76% -- the 72% rule could never fire on it)
    const lifted = r.points >= PTS_MIN ? r1(r.hist + PTS_KEEP * (up(r) - r.hist)) : up(r);
    const hit = r.points === 0 ? floor : own && ph && r.points > 0 ? Math.max(r.points > 3 ? Math.max(ptsRate(ph, plain.hit, r.points), lifted) : ptsRate(ph, plain.hit, r.points), floor) : Math.max(own ? lifted : r1(r.hist - lift), floor);
    return { ...r, hit }; });
}
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
  const rule = [lm, bookGapRule(g, "spread"), fat ? { ...fat, ruleId: "fatigue|spread" } : null, atsRule(g)].filter(Boolean).sort((a, b) => b.hit - a.hit)[0] || null;   // several rules: the higher tested rate names the side
  if (rule) {
    team = rule.team; const line = team === g.home ? hs : -hs;
    plain = { id: "cardpick|spread", ruleId: rule.ruleId, kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit: rule.hit, n: rule.n, price: priced(team === g.home ? ps.home : ps.away), why: rule.why, ...(rule.atOpen != null ? { atOpen: rule.atOpen } : {}), ...(rule.ptsHit ? { ptsHit: rule.ptsHit } : {}) };
  } else if (m && isFinite(m.margin) && hs !== 0) {                                 // no rule: the model's side at the main line (a tie goes to the favorite)
    const d = m.margin + hs; team = d > 0 ? g.home : d < 0 ? g.away : hs < 0 ? g.home : g.away;
    const line = team === g.home ? hs : -hs;
    plain = { id: "modelpick|spread", ruleId: "model|spread", kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit: MODEL_HIT.spread, n: MODEL_N, price: priced(team === g.home ? ps.home : ps.away) };
  }
  const raw = [];
  for (const x of lines) {
    const first = !!plain && x.team === plain.team;
    raw.push({ team: x.team, line: x.line, points: x.points, hit: r1(x.hist), hist: x.hist, n: x.n, price: priced(x.price), pick: x.label || `${x.team} ${sg(x.line)}`, first });
  }
  // 10/19 (owner: "why is your decision making wrong" -- the NFL one-side rule of 10/18): PICK w/ POINTS sits on the PICK's team; BOS @ DET read PICK DET +1.5 and
  // PICK w/ POINTS BOS +1.5, a guaranteed loser on one of the two. With no PICK it may still use either side.
  // 10/29 night (owner: "situational when you should buy this much number against the team"; the NFL card's rule): with NO tested rule (the model's side),
  // PICK w/ POINTS goes on the team whose fewest 5-10 point line reads the higher win % (the line table by spread size); a rule PICK keeps its team.
  // Favorite vs underdog at the same points, the side chosen on 2008-16 also won more on 2017-24 in 49 of 66 spread-size x points cells (+1.8 points;
  // 3-4.5 underdog +3.6 at +5, 5-6.5 underdog +2.7) and in 2025-27 +1.3. Totals (Over vs Under by total size, 35 of 66) do not hold: the PICK's side stays.
  const all = boundRows(raw, plain, (r) => r.team === plain.team, true).map(({ hist, ...r }) => r), rows = finishRows(all);
  const own = pickPts(plain ? all.filter((r) => r.team === plain.team) : all), oth = plain && plain.id === "modelpick|spread" ? pickPts(all.filter((r) => r.team !== plain.team)) : null;
  const b = betterPts(own, oth) === oth && oth ? { ...oth, alt: true } : own, pts = b ? { id: "ptspick|spread", kind: "spread", ...noFirst(b), ruleId: plain ? plain.ruleId : null } : null;
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
  const rule = [lm, bookGapRule(g, "total"), shotRule(g, tl)].filter(Boolean).sort((a, b) => b.hit - a.hit)[0] || null;   // several rules: the higher tested rate names the side
  if (rule) {
    plain = { id: "cardpick|total", ruleId: rule.ruleId, kind: "total", side: rule.side, line: tl, pick: `${nm(rule.side)} ${tl}`, hit: rule.hit, n: rule.n, price: priced(rule.side === "over" ? pt.over : pt.under), why: rule.why, ...(rule.atOpen != null ? { atOpen: rule.atOpen } : {}), ...(rule.ptsHit ? { ptsHit: rule.ptsHit } : {}) };
  } else if (m && isFinite(m.total)) {                                              // no rule: the model's total against the main total (a tie goes Under)
    const side = m.total > tl ? "over" : "under";
    plain = { id: "modelpick|total", ruleId: "model|total", kind: "total", side, line: tl, pick: `${nm(side)} ${tl}`, hit: MODEL_HIT.total, n: MODEL_N, price: priced(side === "over" ? pt.over : pt.under) };
  }
  const raw = [];
  for (const x of lines) {
    const first = !!plain && x.side === plain.side;
    raw.push({ side: x.side, line: x.line, points: x.points, hit: r1(x.hist), hist: x.hist, n: x.n, price: priced(x.price), pick: x.label || `${nm(x.side)} ${x.line}`, first });
  }
  const all = boundRows(raw, plain, (r) => r.side === plain.side).map(({ hist, ...r }) => r), rows = finishRows(all);
  // 10/26 night (owner: "I want all 3"): NO PICK w/ POINTS on the model-side total. The model's total is a coin flip (MODEL_HIT.total 50.4% on
  // 2,462 unseen games), so points bought on its side are the plain table's rate with no edge, and live they went 18-21 (46.2%, -23 per $100,
  // 10/20-26). A rule's total (BOOK GAP / TOTAL MOVE / SHOT QUALITY) keeps its PICK w/ POINTS; the MORE list still shows every line.
  const modelSide = !!plain && plain.id === "modelpick|total";
  const b = modelSide ? null : pickPts(plain ? all.filter((r) => r.side === plain.side) : all, PTS_TARGET.total), pts = b ? { id: "ptspick|total", kind: "total", ...noFirst(b), ruleId: plain ? plain.ruleId : null } : null;   // same side as the PICK (10/19)
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
