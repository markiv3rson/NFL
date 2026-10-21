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

const isTot = (p) => /^(Over|Under)\b/.test(p), STALE_H = 3, TESTED = /^(bounceback|floordog|injury|linemove|movepred|teammodel)\|/;
const sg = (x) => (x > 0 ? "+" : "") + x;
const r1 = (x) => Math.round(x * 10) / 10;
// colors by win rate (owner 10/15): green 56%+, light green 53-55%, yellow below; cushion (win % minus price) is data only
export const cushionOf = (hit, price) => (hit != null && price > 0 && price < 1 ? r1(hit - price * 100) : null);
export const isGreenPick = (hit) => hit >= 56;   // 10/15 (owner): by win rate, price is only shown

// 10/15 (owner: "choose one of the markets' main numbers"): with no tested rule, the PICK is the model's side at Polymarket's main line. Honest history of the model's side (2,531 games, 2014-26): spreads 50.6%, totals 51.7% -> yellow. Own record id (modelpick|...), never mixed into the rules' record.
export const MODEL_HIT = { spread: 50.6, total: 51.7 }, MODEL_N = 2531;
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
  const mside = !top && nm0.mar != null && hsP != null && hsP !== 0 && pH > 0.1 && pH < 0.9 && pA > 0.1 && pA < 0.9 ? (nm0.mar + hsP > 0 ? g.home : nm0.mar + hsP < 0 ? g.away : hsP < 0 ? g.home : g.away) : null;
  const team = top ? top.team || String(top.pick).split(" ")[0] : mside, home = (team || g.home) === g.home;
  const mainLine = ps && isFinite(ps.homeSpread) && ps.homeSpread != null ? (home ? ps.homeSpread : -ps.homeSpread) : null, mainPrice = ps ? (home ? ps.home : ps.away) : null;
  const hsB = bk && bk.spread && isFinite(bk.spread.homeSpread) ? bk.spread.homeSpread : null, A = hsB != null && hsB !== 0 ? Math.abs(hsB) : mainLine != null ? Math.abs(mainLine) : null;
  const fav = hsB != null && hsB !== 0 ? (home ? hsB < 0 : hsB > 0) : mainLine != null ? mainLine < 0 : null;
  let plain = null, hit = null, n = null;
  if (mside) { hit = MODEL_HIT.spread; n = MODEL_N; const line = mainLine, price = mainPrice > 0 && mainPrice < 1 ? mainPrice : null;
    if (line != null) plain = { id: "modelpick|spread", kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit, n, price, cushion: cushionOf(hit, price), ruleId: "model|spread" }; }
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
    // 10/18 (owner, option A): every row in the list -- the PICK's own line included -- is the line history table's rate, so a line with more points
    // never reads lower than the one before it and the two sides of one line never add past 100. The PICK line on top keeps its rule's %.
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
  const rows = finishRows(rawRows), b = pickPts(plain ? rows.filter((r) => r.team === team) : rows), pts = b ? { id: "ptspick|spread", kind: "spread", ...b, ruleId: top ? top.id : null } : null;
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
    { const t0 = totalRate(T, sd, mainLine); if (t0) rawRows.push({ side: sd, line: mainLine, points: 0, hit: r1(t0.rate), n: t0.n, price: pm, cushion: cushionOf(r1(t0.rate), pm), pick: `${nm(sd)} ${mainLine}`, ...(plain && sd === side ? { first: true } : {}) }); }   // table rate, as the spread list
    if (!fresh(altRec, now)) continue;
    for (const a of (altRec && altRec.talts) || []) {
      if (a.side !== sd || !(a.price > 0.1 && a.price < 0.9)) continue; const L = Number(a.line), points = r1(sd === "over" ? mainLine - L : L - mainLine);
      if (!isFinite(L) || Number.isInteger(L) || !(points > 0) || points > MAX_BUY) continue;
      const t = totalRate(T, sd, L); if (!t) continue; const rate = r1(t.rate);
      rawRows.push({ side: sd, line: L, points, hit: rate, n: t.n, price: a.price, cushion: cushionOf(rate, a.price), pick: `${nm(sd)} ${L}`, first: !!plain && sd === side }); }
  }
  const rows = finishRows(rawRows), b = pickPts(plain ? rows.filter((r) => r.side === side) : rows), pts = b ? { id: "ptspick|total", kind: "total", ...b, ruleId: top ? top.id : null } : null;   // same side as the PICK (Over with Over)
  if (!plain && !rows.length) return null;
  return { kind: "total", plain, pts, rows, T };
}

export function buildCard(g, combos, poly, bk, altRec, now = Date.now()) {
  if (!g || g.started || g.final) return null;
  const spread = spreadPart(g, combos, poly, bk, altRec, now), total = totalPart(g, combos, poly, bk, altRec, now);
  return spread || total ? { spread, total } : null;
}
// the picks that get recorded and graded (lib/stack.js recordStack / noteFirstSeen): one per market, plus the points line when there is one
export function cardPicks(card) {
  const out = []; if (!card) return out;
  for (const k of ["spread", "total"]) { const p = card[k]; if (!p) continue;
    for (const x of [p.plain, p.pts]) if (x && x.line != null) out.push({ ...x, model: false, teaser: false }); }
  return out;
}
// Parlay / Best-bets legs (10/15, owner: "parlay legs should have the plain lines"): the card's PICK at Polymarket's own line, never the bought line.
const leg = (g, k, x, bought) => (x ? { game: g.key, kind: k, ...(k === "spread" ? { team: x.team } : { side: x.side }), label: x.pick, line: x.line, price: x.price > 0 && x.price < 1 ? x.price : null, prob: x.hit / 100, cushion: x.cushion ?? null,
  rule: String(x.why || "").startsWith("BEAT") || /^[A-Z][A-Z0-9 ]+:/.test(String(x.why || "")) ? String(x.why).split(":")[0] : "", ...(x.small ? { small: true } : {}), ...(bought ? { bought: true, points: x.points } : {}) } : null);
export const plainLeg = (g, k) => (g && g.card && g.card[k] ? leg(g, k, g.card[k].plain, false) : null);
