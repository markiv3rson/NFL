// The Model card's two answers (10/15, owner: "build now"):
//   PICK            -- the side a TESTED rule likes (the chooser's yellow side is not shown, 10/15), at Polymarket's own line, with its win %;
//                      a BEAT THE rule names the side only; the PICK is on Polymarket's own line and every line up to 3.5 points better is listed (1, 2, 3 points) under MORE
//   PICK w/ POINTS  -- the same side on a bought line (up to 3.5 points), chosen by CUSHION = win % minus Polymarket's price (owner:
//                      "win rate must beat the price"); the fewest points on a tie; none when no line has a positive cushion or no price is posted
//   rows            -- every line you could buy (shown under MORE)
// Win rates come from lib/linetable.js (counts, lowest of closing / opening / recent years), never below the plain pick's own %.
// The SIDE: the best-tested rule pick (BEAT THE 3, LINE MOVE, INJURY, BOUNCE BACK ...). No tested rule -> no PICK (owner 10/15: cut the chooser's PICK).
import { spreadRate, totalRate, MAX_BUY } from "./linetable";

const isTot = (p) => /^(Over|Under)\b/.test(p), STALE_H = 3, TESTED = /^(keynum|bounceback|floordog|injury|linemove|movepred)\|/;
const sg = (x) => (x > 0 ? "+" : "") + x;
const r1 = (x) => Math.round(x * 10) / 10;
// colors by win rate (owner 10/15): green 56%+, light green 53-55%, yellow below; cushion (win % minus price) is data only
export const cushionOf = (hit, price) => (hit != null && price > 0 && price < 1 ? r1(hit - price * 100) : null);
export const isGreenPick = (hit) => hit >= 56;   // 10/15 (owner): by win rate, price is only shown

const fresh = (rec, now) => !rec || !rec.t || now - Date.parse(rec.t) <= STALE_H * 3600e3;
// 10/15 (owner: "we are not trying to beat the market, I just need to win"): judged by WIN RATE, fewest points. The list holds lines 0, 1 and 2 points from Polymarket's main line
// for BOTH teams; a 3rd point only when it is rare (60%+ and no line within 2 points reaches 60%). PICK w/ POINTS = the fewest points (1 or 2) that reach 56%, either side; none reaching it -> the highest win rate within 2 points.
export const PTS_BAR = 56, RARE_BAR = 60, RULE_POINTS = 2;
function finishRows(rows) {
  const cheapMax = Math.max(0, ...rows.filter((r) => r.points <= RULE_POINTS).map((r) => r.hit));
  return rows.filter((r) => r.points <= RULE_POINTS || (r.hit >= RARE_BAR && cheapMax < RARE_BAR)).sort((x, y) => x.points - y.points || (y.first ? 1 : 0) - (x.first ? 1 : 0) || y.hit - x.hit).map(({ first, ...r }) => r);
}
function pickPts(rows) {
  const b = rows.filter((r) => r.points > 0); if (!b.length) return null;
  const ok = b.filter((r) => r.hit >= PTS_BAR);
  if (ok.length) { const m = Math.min(...ok.map((r) => r.points)); return ok.filter((r) => r.points === m).sort((x, y) => y.hit - x.hit)[0]; }
  return b.slice().sort((x, y) => y.hit - x.hit || x.points - y.points)[0];
}

// the rule / chooser pick that decides the side of one market (tested picks first, then the highest %)
function topPick(combos, kind) {
  let top = null;
  for (const c of combos || []) { if (!c || c.teaser || !c.hit || !TESTED.test(c.id || "") || / ML$/.test(c.pick || "")) continue; if ((kind === "total") !== isTot(c.pick)) continue;
    const small = c.n != null && c.n < 60;
    if (!top || (top.small !== small ? !small : c.hit > top.hit)) top = { ...c, small }; }
  return top;
}

function spreadPart(g, combos, poly, bk, altRec, now) {
  const top = topPick(combos, "spread"); if (!top) return null;
  const team = top.team || String(top.pick).split(" ")[0], home = team === g.home, ps = poly && poly.spread;
  const mainLine = ps && isFinite(ps.homeSpread) && ps.homeSpread != null ? (home ? ps.homeSpread : -ps.homeSpread) : null, mainPrice = ps ? (home ? ps.home : ps.away) : null;
  const hsB = bk && bk.spread && isFinite(bk.spread.homeSpread) ? bk.spread.homeSpread : null, A = hsB != null && hsB !== 0 ? Math.abs(hsB) : mainLine != null ? Math.abs(mainLine) : null;
  const fav = hsB != null && hsB !== 0 ? (home ? hsB < 0 : hsB > 0) : mainLine != null ? mainLine < 0 : null;
  const tab = (L) => (A != null && fav != null ? spreadRate(A, fav, L) : null);
  // PICK: a bought-point rule (BEAT THE 3) names the side; the pick itself sits on Polymarket's own line with the table's rate there
  const bought = top.id === "keynum|spread";
  const line = mainLine != null ? mainLine : isFinite(top.line) ? top.line : null;
  let hit = r1(top.hit), n = top.n ?? null;
  if (bought) { const t = mainLine != null ? tab(mainLine) : null; hit = t ? r1(t.rate) : top.plain != null ? top.plain : null; n = t ? t.n : null; }
  if (!isFinite(hit) || line == null || !isFinite(line)) return null;
  const price = mainPrice > 0 && mainPrice < 1 ? mainPrice : null;
  const plain = { id: "cardpick|spread", kind: "spread", team, line, pick: `${team} ${sg(line)}`, hit, n, price, cushion: cushionOf(hit, price), ruleId: top.id, why: top.why, ...(top.small ? { small: true } : {}) };
  const rawRows = [], opp = home ? g.away : g.home;
  for (const [T, isHome] of [[team, home], [opp, !home]]) {
    const mainT = ps && ps.homeSpread != null && isFinite(ps.homeSpread) ? (isHome ? ps.homeSpread : -ps.homeSpread) : null, pT = ps ? (isHome ? ps.home : ps.away) : null;
    const favT = hsB != null && hsB !== 0 ? (isHome ? hsB < 0 : hsB > 0) : mainT != null ? mainT < 0 : null, tabT = (L) => (A != null && favT != null ? spreadRate(A, favT, L) : null);
    if (mainT == null || !(pT > 0.1 && pT < 0.9)) continue;
    const t0 = T === team ? null : tabT(mainT);
    if (T === team) rawRows.push({ team: T, line: mainT, points: 0, hit, n, price: pT, cushion: cushionOf(hit, pT), pick: `${T} ${sg(mainT)}`, first: true });
    else if (t0) rawRows.push({ team: T, line: mainT, points: 0, hit: r1(t0.rate), n: t0.n, price: pT, cushion: cushionOf(r1(t0.rate), pT), pick: `${T} ${sg(mainT)}` });
    if (!fresh(altRec, now)) continue;
    for (const a of (altRec && altRec.alts) || []) {
      if (a.team !== T || !(a.price > 0.1 && a.price < 0.9)) continue; const L = Number(a.line), points = r1(L - mainT);
      if (!isFinite(L) || Number.isInteger(L) || !(points > 0) || points > MAX_BUY) continue;
      const t = tabT(L); if (!t) continue; const rate = r1(t.rate);
      rawRows.push({ team: T, line: L, points, hit: rate, n: t.n, price: a.price, cushion: cushionOf(rate, a.price), pick: `${T} ${sg(L)}`, first: T === team }); }
  }
  const rows = finishRows(rawRows), b = pickPts(rows), pts = b ? { id: "ptspick|spread", kind: "spread", ...b, ruleId: top.id } : null;
  return { kind: "spread", plain, pts, rows, A, fav };
}

function totalPart(g, combos, poly, bk, altRec, now) {
  const top = topPick(combos, "total"); if (!top) return null;
  const side = top.side || (/^Over/.test(top.pick) ? "over" : "under"), pt = poly && poly.total;
  const mainLine = pt && pt.line != null && isFinite(pt.line) ? Number(pt.line) : top.line, mainPrice = pt ? (side === "over" ? pt.over : pt.under) : null;
  const T = bk && bk.total && bk.total.line != null && isFinite(bk.total.line) ? Number(bk.total.line) : mainLine;
  if (mainLine == null || !isFinite(mainLine)) return null;
  const price = mainPrice > 0 && mainPrice < 1 ? mainPrice : null, hit = r1(top.hit); if (!isFinite(hit)) return null;
  const plain = { id: "cardpick|total", kind: "total", side, line: mainLine, pick: `${side === "over" ? "Over" : "Under"} ${mainLine}`, hit, n: top.n ?? null, price, cushion: cushionOf(hit, price), ruleId: top.id, why: top.why, ...(top.small ? { small: true } : {}) };
  const rawRows = [], other = side === "over" ? "under" : "over", nm = (sd) => (sd === "over" ? "Over" : "Under");
  for (const sd of [side, other]) {
    const pm = pt ? (sd === "over" ? pt.over : pt.under) : null; if (!(pm > 0.1 && pm < 0.9)) continue;
    if (sd === side) rawRows.push({ side: sd, line: mainLine, points: 0, hit, n: top.n ?? null, price: pm, cushion: cushionOf(hit, pm), pick: `${nm(sd)} ${mainLine}`, first: true });
    else { const t0 = totalRate(T, sd, mainLine); if (t0) rawRows.push({ side: sd, line: mainLine, points: 0, hit: r1(t0.rate), n: t0.n, price: pm, cushion: cushionOf(r1(t0.rate), pm), pick: `${nm(sd)} ${mainLine}` }); }
    if (!fresh(altRec, now)) continue;
    for (const a of (altRec && altRec.talts) || []) {
      if (a.side !== sd || !(a.price > 0.1 && a.price < 0.9)) continue; const L = Number(a.line), points = r1(sd === "over" ? mainLine - L : L - mainLine);
      if (!isFinite(L) || Number.isInteger(L) || !(points > 0) || points > MAX_BUY) continue;
      const t = totalRate(T, sd, L); if (!t) continue; const rate = r1(t.rate);
      rawRows.push({ side: sd, line: L, points, hit: rate, n: t.n, price: a.price, cushion: cushionOf(rate, a.price), pick: `${nm(sd)} ${L}`, first: sd === side }); }
  }
  const rows = finishRows(rawRows), b = pickPts(rows), pts = b ? { id: "ptspick|total", kind: "total", ...b, ruleId: top.id } : null;
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
// ptsLeg = the PICK w/ POINTS line, used only by "4 legs · my style · bought lines".
const leg = (g, k, x, bought) => (x ? { game: g.key, kind: k, ...(k === "spread" ? { team: x.team } : { side: x.side }), label: x.pick, line: x.line, price: x.price > 0 && x.price < 1 ? x.price : null, prob: x.hit / 100, cushion: x.cushion ?? null,
  rule: String(x.why || "").startsWith("BEAT") || /^[A-Z][A-Z0-9 ]+:/.test(String(x.why || "")) ? String(x.why).split(":")[0] : "", ...(x.small ? { small: true } : {}), ...(bought ? { bought: true, points: x.points } : {}) } : null);
export const plainLeg = (g, k) => (g && g.card && g.card[k] ? leg(g, k, g.card[k].plain, false) : null);
export const ptsLeg = (g, k) => (g && g.card && g.card[k] && g.card[k].pts ? leg(g, k, g.card[k].pts, true) : null);
