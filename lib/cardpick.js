// The Model card's two answers (10/15, owner: "build now"; 10/15 night: win rate decides, 10/16: model side when no rule):
//   PICK            -- the side a rule TESTED ON THE SIDE likes (LINE MOVE, INJURY, BOUNCE BACK, BOUNCE BACK DOG, TEAM MODEL, TOTAL MOVE), at Polymarket's own
//                      line with its win %. No such rule -> the MODEL's side at the main line (modelpick|, 50.6% spreads / 51.7% totals, yellow, its own record).
//                      10/19 (owner: "make the rules better ... not confusing"): BEAT THE no longer names the side -- its edge was the bought points (+3.5), on
//                      Polymarket's main line its side won only 46-50%; it is still recorded and graded as its own rule, and its bought line shows under MORE.
//   PICK w/ POINTS  -- the fewest points (1 or 2) that reach 56% ON THE PICK'S SIDE (10/18: one side per game; with no PICK either side); a 2.5 / 3 point line only when it beats the best
//                      line within 2 points by 3+ win points; none reaching 56% -> the highest win rate within 2 points (owner 10/16: keep this fallback).
//   rows            -- every line you could buy (main, 1, 2 points, both sides; shown under MORE). Price is shown, never judged (owner: win rate decides).
// Win rates come from lib/linetable.js (lowest of closing / opening / recent years; spreads shrunk toward the pooled cushion rate).
import { spreadRate, totalRate, MAX_BUY } from "./linetable";

const isTot = (p) => /^(Over|Under)\b/.test(p), STALE_H = 3, TESTED = /^(bounceback|floordog|injury|linemove|movepred|teammodel|overshoot)\|/;
const sg = (x) => (x > 0 ? "+" : "") + x;
const r1 = (x) => Math.round(x * 10) / 10;
// colors by win rate (owner 10/15): green 56%+, light green 53-55%, yellow below; cushion (win % minus price) is data only
export const cushionOf = (hit, price) => (hit != null && price > 0 && price < 1 ? r1(hit - price * 100) : null);
export const isGreenPick = (hit) => hit >= 56;   // 10/15 (owner): by win rate, price is only shown

// 10/15 (owner: "choose one of the markets' main numbers"): with no tested rule, the PICK is the model's side at Polymarket's main line. Honest history of the model's side (2,531 games, 2014-26): spreads 50.6%, totals 51.7% -> yellow. Own record id (modelpick|...), never mixed into the rules' record.
export const MODEL_HIT = { spread: 50.6, total: 51.7 }, MODEL_N = 2531, STACK_YARDS_V = 2;
const modelNums = (g) => { const U = g && g.modelUp, M = g && g.model, mar = U && isFinite(U.margin) ? U.margin : M && isFinite(M.homeMargin) ? M.homeMargin : null, tot = U && isFinite(U.total) ? U.total : M && isFinite(M.total) ? M.total : null; return { mar, tot }; };
const fresh = (rec, now) => !rec || !rec.t || now - Date.parse(rec.t) <= STALE_H * 3600e3;
// 10/15 (owner: "we are not trying to beat the market, I just need to win"): judged by WIN RATE, fewest points. The list holds lines 0, 1 and 2 points from Polymarket's main line for BOTH teams (plus a far line only when it clearly wins more, see finishRows).
// PICK w/ POINTS = the fewest points (1 or 2) that reach 56% on the PICK's side; none reaching it -> the highest win rate within 2 points on that side.
export const PTS_BAR = 56, FAR_GAIN = 3, RULE_POINTS = 2;
// 10/15 (owner: "option 2"): a line 2.5 or 3 points out is listed, and can be PICK w/ POINTS, only when it beats the best line within 2 points by 3+ win points. 4 points never.
function finishRows(rows) {
  const near = Math.max(0, ...rows.filter((r) => r.points <= RULE_POINTS).map((r) => r.hit));
  return rows.filter((r) => r.points <= RULE_POINTS || r.hit >= near + FAR_GAIN).sort((x, y) => x.points - y.points || (y.first ? 1 : 0) - (x.first ? 1 : 0) || y.hit - x.hit).map(({ first, ...r }) => r);
}
function pickPts(rows) {
  const b = rows.filter((r) => r.points > 0); if (!b.length) return null;
  const far = b.filter((r) => r.points > RULE_POINTS); if (far.length) return far.slice().sort((x, y) => y.hit - x.hit)[0];   // a far line only survives finishRows when it clearly wins more
  const ok = b.filter((r) => r.hit >= PTS_BAR);
  if (ok.length) { const m = Math.min(...ok.map((r) => r.points)); return ok.filter((r) => r.points === m).sort((x, y) => y.hit - x.hit)[0]; }
  return b.slice().sort((x, y) => y.hit - x.hit || x.points - y.points)[0];
}

// 10/21 (owner: "don't contradict yourself"): with a PICK, the list can no longer read against it. The PICK's own main line shows the PICK's %
// (NYG @ HOU Over 42.5 read 61.3% on the PICK and 46.8% in the list), the other side of the main line shows 100 minus it, and a line with MORE points
// never reads lower than the main line of its side (Over 40.5 cannot win less often than Over 42.5; it showed 54.4% under a 61.3% PICK).
// Without a PICK the list stays the history table's rates.
// 10/24 (rule 7 hunt): a more-points line moves by the PICK's lift too -- its % = the table's rate + (the PICK's % - the table's rate on the PICK's
// main line), the other side the same lift down. Walk-forward 2022-25, STACK's side at its own line +1 / +2 (half-point closes): favorite 50-70%
// won 59.6 / 65.2% where the card showed 57.0 / 57.2 (shifted 61.3 / 64.3), underdog 57.1 / 59.8 (shown 54.4 / 58.0, shifted 56.9 / 60.5), 70%+
// favorite 55.6 / 57.4 (51.8 / 55.2 -> 54.0 / 57.3), confident underdog 64.2 / 67.9 (56.2 / 58.5 -> 60.9 / 64.6); the model-side total +2 won 56.8%.
function boundRows(rows, plain, mine) {
  if (!plain || !isFinite(plain.hit)) return rows.map(({ step, ...r }) => r);
  const p = r1(plain.hit), q = r1(100 - plain.hit), m0 = rows.find((r) => r.points === 0 && mine(r) && isFinite(r.hit)), lift = m0 ? plain.hit - m0.hit : 0;
  return rows.map((r) => { const own = mine(r), floor = own ? p : q, hit = r.points === 0 ? floor : Math.max(r1(r.hit + (own ? lift : -lift)), floor);
    return hit === r.hit ? r : { ...r, hit, cushion: cushionOf(hit, r.price) }; }).map(({ step, ...r }) => r);
}
// 10/24 night (rule 7 recheck): the model-side total's more-points lines = the model side's own % + the SMALLEST step any history group (closing
// 1999-2025 / opening 2014-25 / recent 2020-25) takes from the main line to that line. The general lift (table + PICK % - the table's main-line
// rate) read high here: the lowest-of-three main line is often the opening group's (45.8% at a 49.5 total), so every bought line rose ~6 points.
// Leave-one-season-out 2014-25, the card's own model totals on 1,385 half-point closes: rows +1 / +2 / +3 said 54.1 / 57.1 / 60.1, won 54.7 /
// 57.8 / 60.4 (the lift said 55.1 / 58.4 / 61.6); the line PICK w/ POINTS chooses said 59.1, won 59.2 (lift 60.5 / 58.8: 3-point lines 61.9 /
// 58.6, 1-point picks won 49.3% of 69); 2014-19 59.2 / 58.9, 2020-25 59.0 / 60.0. Rules on totals keep the lift (TOTAL MOVE checked 10/23).
const groupStep = (t0, t) => { let m = null;
  for (const k of ["c", "o", "r"]) { const a = t0.parts && t0.parts[k], b = t.parts && t.parts[k]; if (!a || !b) continue; const d = b.raw - a.raw; if (m == null || d < m) m = d; }
  return m; };
function modelTotalRows(rows, plain, side) {
  const p = r1(plain.hit), q = r1(100 - plain.hit);
  return rows.map((r) => { const own = r.side === side, floor = own ? p : q;
    const hit = r.points === 0 ? floor : r.step != null ? Math.max(r1(floor + r.step), floor) : Math.max(r.hit, floor);
    return hit === r.hit ? r : { ...r, hit, cushion: cushionOf(hit, r.price) }; }).map(({ step, ...r }) => r);
}
// the tested rule pick that decides the side of one market (the highest %; a pick with a small sample ranks below a full one;
// spreads: rules on opposite teams -> the underdog's rule, see spreadPart).
const ruleOk = (c, kind) => !!c && !c.teaser && !!c.hit && TESTED.test(c.id || "") && !/ ML$/.test(c.pick || "") && (kind === "total") === isTot(c.pick);
function topPick(combos, kind) {
  let top = null;
  for (const c of combos || []) { if (!ruleOk(c, kind)) continue;
    const small = c.n != null && c.n < 60, rate = c.hit;
    if (!top || (top.small !== small ? !small : rate > top.rate)) top = { ...c, small, rate }; }
  return top;
}

function spreadPart(g, combos, poly, bk, altRec, now) {
  const ps = poly && poly.spread, nm0 = modelNums(g);
  // 10/18 (owner, option B): when spread rules pick OPPOSITE teams, the PICK is the UNDERDOG's rule (the best of the rules on the underdog), whatever the %.
  // Underdog = the books' spread (else Polymarket's main line); a pick'em keeps the highest %. Totals keep the highest %.
  const teamOf = (c) => c.team || String(c.pick).split(" ")[0];
  const sideTeams = new Set((combos || []).filter((c) => ruleOk(c, "spread")).map(teamOf));
  const hb0 = bk && bk.spread && isFinite(bk.spread.homeSpread) && bk.spread.homeSpread ? bk.spread.homeSpread : ps && isFinite(ps.homeSpread) && ps.homeSpread ? ps.homeSpread : null;
  const dog = hb0 == null ? null : hb0 < 0 ? g.away : g.home;
  const top = (sideTeams.size > 1 && dog && sideTeams.has(dog) ? topPick((combos || []).filter((c) => teamOf(c) === dog), "spread") : null) || topPick(combos, "spread");
  // no tested rule -> the model's side at the main line (a tie goes to the favorite); the list and PICK w/ POINTS show either way
  const hsP = ps && ps.homeSpread != null && isFinite(ps.homeSpread) ? Number(ps.homeSpread) : null, pH = ps ? ps.home : null, pA = ps ? ps.away : null;
  const okMkt = hsP != null && hsP !== 0 && pH > 0.1 && pH < 0.9 && pA > 0.1 && pA < 0.9;
  // 10/22 (owner: "fix the problems only. build now"): with no tested rule the side is STACK's (every model in one fit, lib/stackmodel.js) when it has a
  // line, shown at its walk-forward band (52.8% / 56.2% confident). Same 761 games 2022-25 at the closing spread: STACK's side 53.5% (53 / 52 / 50 / 58 by
  // season), the old game model's side 48.4%; where the two disagreed (427) STACK won 54.6%. No STACK line -> the game model's side at 50.6% as before.
  // Only from the FIXED team yards (yv 2, Railway with the 10/21 prop-model fix): the old sums counted inactive players and backup QBs.
  const st = !top && okMkt && g && g.stackSide && Number(g.stackSide.yv) >= STACK_YARDS_V && (g.stackSide.team === g.home || g.stackSide.team === g.away) && isFinite(g.stackSide.pct) ? g.stackSide : null;
  const mside = !top && okMkt ? (st ? st.team : nm0.mar != null ? (nm0.mar + hsP > 0 ? g.home : nm0.mar + hsP < 0 ? g.away : hsP < 0 ? g.home : g.away) : null) : null;
  const team = top ? top.team || String(top.pick).split(" ")[0] : mside, home = (team || g.home) === g.home;
  const mainLine = ps && isFinite(ps.homeSpread) && ps.homeSpread != null ? (home ? ps.homeSpread : -ps.homeSpread) : null, mainPrice = ps ? (home ? ps.home : ps.away) : null;
  const hsB = bk && bk.spread && isFinite(bk.spread.homeSpread) ? bk.spread.homeSpread : null, A = hsB != null && hsB !== 0 ? Math.abs(hsB) : mainLine != null ? Math.abs(mainLine) : null;
  const fav = hsB != null && hsB !== 0 ? (home ? hsB < 0 : hsB > 0) : mainLine != null ? mainLine < 0 : null;
  let plain = null, hit = null, n = null;
  // 10/23 night: STACK's cover rate depends on whom it backs (walk-forward 2022-25): the moneyline favorite priced 50-70% (fee out) covered
  // 57.0% of 249 (58 / 64 / 55 / 52 by season), a 70%+ favorite 49.6% of 125; on the underdog the confident / rest bands stay (56.2 / 52.8)
  const mlp = (poly && poly.ml) || (g && g.poly && g.poly.ml), pH0 = mlp && mlp.home > 0 && mlp.away > 0 ? mlp.home / (mlp.home + mlp.away) : null;
  const stFav = st && pH0 != null && pH0 !== 0.5 ? (st.team === (pH0 > 0.5 ? g.home : g.away) ? Math.max(pH0, 1 - pH0) : 0) : null;
  const stRate = st ? (stFav != null && stFav >= 0.5 && stFav < 0.7 ? [57.0, 249] : stFav != null && stFav >= 0.7 ? [49.6, 125] : [r1(st.pct), st.n ?? null]) : null;
  if (mside) { hit = st ? stRate[0] : MODEL_HIT.spread; n = st ? stRate[1] : MODEL_N; const line = mainLine, price = mainPrice > 0 && mainPrice < 1 ? mainPrice : null;
    if (line != null) plain = { id: "modelpick|spread", kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit, n, price, cushion: cushionOf(hit, price), ruleId: st ? "stack|spread" : "model|spread" }; }
  if (top) {
    const line = mainLine != null ? mainLine : isFinite(top.line) ? top.line : null;
    hit = r1(top.hit); n = top.n ?? null;
    const price = mainPrice > 0 && mainPrice < 1 ? mainPrice : null;
    if (isFinite(hit) && line != null && isFinite(line)) plain = { id: "cardpick|spread", kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit, n, price, cushion: cushionOf(hit, price), ruleId: top.id, why: top.why, ...(top.small ? { small: true } : {}) };
  }
  const rawRows = [], opp = home ? g.away : g.home;
  for (const [T, isHome] of plain ? [[team, home], [opp, !home]] : [[g.away, false], [g.home, true]]) {
    const mainT = ps && ps.homeSpread != null && isFinite(ps.homeSpread) ? (isHome ? ps.homeSpread : -ps.homeSpread) : null, pT = ps ? (isHome ? ps.home : ps.away) : null;
    const favT = hsB != null && hsB !== 0 ? (isHome ? hsB < 0 : hsB > 0) : mainT != null ? mainT < 0 : null, tabT = (L) => (A != null && favT != null ? spreadRate(A, favT, L) : null);
    if (mainT == null || !(pT > 0.1 && pT < 0.9)) continue;
    // 10/18 (owner, option A): the rows come from the line history table, so the two sides of one line never add past 100; 10/21: with a PICK,
    // boundRows (below) puts the PICK's % on its own main line and keeps every more-points line at or above its side's main line.
    const t0 = tabT(mainT);
    if (t0) rawRows.push({ team: T, line: mainT, points: 0, hit: r1(t0.rate), n: t0.n, price: pT, cushion: cushionOf(r1(t0.rate), pT), pick: `${T} ${sg(mainT)}`, ...(plain && T === team ? { first: true } : {}) });
    if (!fresh(altRec, now)) continue;
    for (const a of (altRec && altRec.alts) || []) {
      if (a.team !== T || !(a.price > 0.1 && a.price < 0.9)) continue; const L = Number(a.line), points = r1(L - mainT);
      if (!isFinite(L) || Number.isInteger(L) || !(points > 0) || points > MAX_BUY) continue;
      const t = tabT(L); if (!t) continue; const rate = r1(t.rate);
      rawRows.push({ team: T, line: L, points, hit: rate, n: t.n, price: a.price, cushion: cushionOf(rate, a.price), pick: `${T} ${sg(L)}`, first: !!plain && T === team }); }
  }
  // 10/18 (owner: "one side per game"): PICK w/ POINTS sits on the PICK's team -- the card never names both teams (TEN @ IND showed IND -6.5 and TEN +8.5)
  const rows = finishRows(boundRows(rawRows, plain, (r) => r.team === team)), b = pickPts(plain ? rows.filter((r) => r.team === team) : rows), pts = b ? { id: "ptspick|spread", kind: "spread", ...b, ruleId: top ? top.id : null } : null;
  if (!plain && !rows.length) return null;
  return { kind: "spread", plain, pts, rows, A, fav };
}

function totalPart(g, combos, poly, bk, altRec, now) {
  const top = topPick(combos, "total"), pt = poly && poly.total, nm1 = modelNums(g);
  const mainLine0 = pt && pt.line != null && isFinite(pt.line) ? Number(pt.line) : top ? top.line : null;
  const side = top ? top.side || (/^Over/.test(top.pick) ? "over" : "under") : nm1.tot != null && mainLine0 != null && pt && pt.over > 0.1 && pt.over < 0.9 && pt.under > 0.1 && pt.under < 0.9 ? (nm1.tot > mainLine0 ? "over" : "under") : null;   // no rule -> the model's total against the main total (an exact tie goes Under)
  const mainLine = mainLine0, mainPrice = pt && side ? (side === "over" ? pt.over : pt.under) : null;
  const T = bk && bk.total && bk.total.line != null && isFinite(bk.total.line) ? Number(bk.total.line) : mainLine;
  if (mainLine == null || !isFinite(mainLine)) return null;
  const price = mainPrice > 0 && mainPrice < 1 ? mainPrice : null, hit = top ? r1(top.hit) : side ? MODEL_HIT.total : null;
  const plain = !top && side && mainLine != null ? { id: "modelpick|total", kind: "total", side, line: mainLine, pick: `${side === "over" ? "Over" : "Under"} ${mainLine}`, hit, n: MODEL_N, price, cushion: cushionOf(hit, price), ruleId: "model|total" } : top && isFinite(hit) ? { id: "cardpick|total", kind: "total", side, line: mainLine, pick: `${side === "over" ? "Over" : "Under"} ${mainLine}`, hit, n: top.n ?? null, price, cushion: cushionOf(hit, price), ruleId: top.id, why: top.why, ...(top.small ? { small: true } : {}) } : null;
  if (mainLine == null || !isFinite(mainLine)) return null;
  const rawRows = [], nm = (sd) => (sd === "over" ? "Over" : "Under");
  for (const sd of plain ? [side, side === "over" ? "under" : "over"] : ["over", "under"]) {
    const pm = pt ? (sd === "over" ? pt.over : pt.under) : null; if (!(pm > 0.1 && pm < 0.9)) continue;
    const t0 = totalRate(T, sd, mainLine);
    if (t0) rawRows.push({ side: sd, line: mainLine, points: 0, hit: r1(t0.rate), n: t0.n, price: pm, cushion: cushionOf(r1(t0.rate), pm), pick: `${nm(sd)} ${mainLine}`, ...(plain && sd === side ? { first: true } : {}) });   // table rate, as the spread list
    if (!fresh(altRec, now)) continue;
    for (const a of (altRec && altRec.talts) || []) {
      if (a.side !== sd || !(a.price > 0.1 && a.price < 0.9)) continue; const L = Number(a.line), points = r1(sd === "over" ? mainLine - L : L - mainLine);
      if (!isFinite(L) || Number.isInteger(L) || !(points > 0) || points > MAX_BUY) continue;
      const t = totalRate(T, sd, L); if (!t) continue; const rate = r1(t.rate);
      rawRows.push({ side: sd, line: L, points, hit: rate, n: t.n, price: a.price, cushion: cushionOf(rate, a.price), pick: `${nm(sd)} ${L}`, first: !!plain && sd === side, ...(t0 ? { step: groupStep(t0, t) } : {}) }); }
  }
  const rows = finishRows(plain && plain.id === "modelpick|total" ? modelTotalRows(rawRows, plain, side) : boundRows(rawRows, plain, (r) => r.side === side)), b = pickPts(plain ? rows.filter((r) => r.side === side) : rows), pts = b ? { id: "ptspick|total", kind: "total", ...b, ruleId: top ? top.id : null } : null;   // same side as the PICK (Over with Over)
  if (!plain && !rows.length) return null;
  return { kind: "total", plain, pts, rows, T };
}

// 10/23 night (owner: "build things that will help"): ML PICK = the moneyline favorite when the Stack model's spread side is that favorite.
// Walk-forward 2022-25 (761 games, each season from earlier seasons only): with STACK on the favorite the favorite won 71.7% of 374 priced
// 65.7% (73/67, 70/64, 75/65, 68/67 by season) -- confident 78.0% of 59, not confident 70.5% of 315; with STACK on the underdog it won 64.3%
// priced 65.7%. The edge sits in favorites the market prices 50-70% (fee out): 50-60% won 67.7% of 130 priced 56.1, 60-70% won 69.7% of 119
// priced 64.7; 70-80% won 73.0% of 100 priced 74.6 (no edge), so the pick fires only at 50-70% and shows its band's rate. Saved at kickoff as
// `stackml|ml`, graded on the final score (a tie is a push).
export const STACK_ML = { bands: [{ lo: 0.5, hi: 0.6, hit: 67.7, n: 130 }, { lo: 0.6, hi: 0.7, hit: 69.7, n: 119 }] };
// 10/26 (owner: "I do want the moneyline version of today's sweep"): the TEAM MODEL's side STRAIGHT UP when it is 58%+ sure and the line moved 1+
// point AGAINST it since the week's first Polymarket line -- the moneyline twin of the 10/26 TEAM MOVE spread rule (63.9% ATS). Walk-forward team
// model 2014-25 at the closing moneyline, fee out (scratchpad ml/tm58.py): 147 games won 46.9% priced 35.1% = +34.2 per $100 (2014-19 +24.9 on 51,
// 2020-25 +39.1 on 96; 9 of 12 seasons up; the moves shuffled inside each season reach that money 3.3% of the time). By who it backs: a FAVORITE
// 31 games won 77.4% priced 60.7%; an UNDERDOG priced 30-50c 49 games won 57.1% priced 40.1%; an underdog under 30c 67 games won 25.4% priced 19.5%
// (+30.9 per $100 but a 25% win rate -- not a pick, win rate is the judge). The 3,059-option moneyline sweep around it (ml/sweep2.py) found nothing
// else: 156 options pass a +5-per-$100 bar in both halves where the shuffles pass ~958, and the favorite alone makes -0.7 / +0.5 per $100.
export const TM_ML = { fav: { hit: 88.9, n: 18 }, dog: { lo: 0.3, hit: 63.3, n: 30 } };   // 10/27, C 0.02 picks: against the move, favorite won 88.9% priced 61.8 (18), dog 30-50c 63.3% priced 41.9 (30); was 77.4 (31) / 57.1 (49) at C 0.05
export function mlPart(g, poly, combos = []) {
  const st = g && g.stackSide, m = (poly && poly.ml) || (g && g.poly && g.poly.ml);
  if (!m || !(m.home > 0 && m.home < 1) || !(m.away > 0 && m.away < 1)) return null;
  const pH = m.home / (m.home + m.away), fav = pH > 0.5 ? g.home : pH < 0.5 ? g.away : null, pf = Math.max(pH, 1 - pH);
  const cands = [];
  if (st && Number(st.yv) >= STACK_YARDS_V && st.team && fav && st.team === fav) { const b = STACK_ML.bands.find((x) => pf >= x.lo && pf < x.hi);
    if (b) cands.push({ id: "stackml|ml", team: fav, hit: b.hit, n: b.n }); }
  const tm = (combos || []).find((c) => c && c.id === "teammodel|spread" && c.mv === "against" && (c.team === g.home || c.team === g.away));
  if (tm) { const pt = tm.team === g.home ? pH : 1 - pH, band = pt >= 0.5 ? TM_ML.fav : pt >= TM_ML.dog.lo ? TM_ML.dog : null;
    if (band) cands.push({ id: "tmml|ml", team: tm.team, hit: band.hit, n: band.n }); }
  if (!cands.length) return null;
  const c = cands.sort((a, b) => b.hit - a.hit)[0];   // two rules on different teams: the higher win rate shows (owner's rule)
  return { plain: { id: c.id, kind: "ml", team: c.team, line: 0, pick: `${c.team} ML`, hit: c.hit, n: c.n, price: c.team === g.home ? m.home : m.away, ruleId: c.id }, ...(cands.length > 1 ? { also: cands[1] } : {}) };
}
export function buildCard(g, combos, poly, bk, altRec, now = Date.now()) {
  if (!g || g.started || g.final) return null;
  const spread = spreadPart(g, combos, poly, bk, altRec, now), total = totalPart(g, combos, poly, bk, altRec, now), ml = mlPart(g, poly, combos);
  return spread || total ? { spread, total, ...(ml ? { ml } : {}) } : null;
}
// the picks that get recorded and graded (lib/stack.js recordStack / noteFirstSeen): one per market, plus the points line when there is one
export function cardPicks(card) {
  const out = []; if (!card) return out;
  for (const k of ["spread", "total", "ml"]) { const p = card[k]; if (!p) continue;
    for (const x of [p.plain, p.pts]) if (x && x.line != null) out.push({ ...x, model: false, teaser: false }); }
  return out;
}
// Parlay / Best-bets legs (10/15, owner: "parlay legs should have the plain lines"): the card's PICK at Polymarket's own line, never the bought line.
const leg = (g, k, x, bought) => (x ? { game: g.key, kind: k, ...(k === "spread" || k === "ml" ? { team: x.team } : { side: x.side }), label: x.pick, line: x.line, price: x.price > 0 && x.price < 1 ? x.price : null, prob: x.hit / 100, cushion: x.cushion ?? null,
  rule: String(x.why || "").startsWith("BEAT") || /^[A-Z][A-Z0-9 ]+:/.test(String(x.why || "")) ? String(x.why).split(":")[0] : "", ...(x.small ? { small: true } : {}), ...(bought ? { bought: true, points: x.points } : {}) } : null);
export const plainLeg = (g, k) => (g && g.card && g.card[k] ? leg(g, k, g.card[k].plain, false) : null);
