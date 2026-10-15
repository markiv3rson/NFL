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
export const GREEN_CUSHION = 3;   // green at +3 or better, light green 0 to +3, yellow below 0 (no price posted -> the old 56% / 53% lines)
export const cushionOf = (hit, price) => (hit != null && price > 0 && price < 1 ? r1(hit - price * 100) : null);
export const isGreenPick = (hit, price) => { const c = cushionOf(hit, price); return c != null ? c >= GREEN_CUSHION : hit >= 56; };

const fresh = (rec, now) => !rec || !rec.t || now - Date.parse(rec.t) <= STALE_H * 3600e3;
const best = (rows) => rows.filter((x) => x.cushion != null && x.cushion > 0).sort((a, b) => b.cushion - a.cushion || a.points - b.points)[0] || null;

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
  const rows = [];
  if (price != null && mainLine != null && fresh(altRec, now))
    for (const a of (altRec && altRec.alts) || []) {
      if (a.team !== team || !(a.price > 0.1 && a.price < 0.9)) continue; const L = Number(a.line), points = r1(L - mainLine);
      if (!isFinite(L) || Number.isInteger(L) || !(points > 0) || points > MAX_BUY) continue;
      const t = tab(L); if (!t) continue; const rate = r1(Math.max(t.rate, hit));
      rows.push({ team, line: L, points, hit: rate, n: t.n, price: a.price, cushion: cushionOf(rate, a.price), pick: `${team} ${sg(L)}` }); }
  rows.sort((a, b) => a.points - b.points);
  const b = best(rows), pts = b ? { id: "ptspick|spread", kind: "spread", ...b, ruleId: top.id } : null;
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
  const rows = [];
  if (price != null && fresh(altRec, now))
    for (const a of (altRec && altRec.talts) || []) {
      if (a.side !== side || !(a.price > 0.1 && a.price < 0.9)) continue; const L = Number(a.line), points = r1(side === "over" ? mainLine - L : L - mainLine);
      if (!isFinite(L) || Number.isInteger(L) || !(points > 0) || points > MAX_BUY) continue;
      const t = totalRate(T, side, L); if (!t) continue; const rate = r1(Math.max(t.rate, hit));
      rows.push({ side, line: L, points, hit: rate, n: t.n, price: a.price, cushion: cushionOf(rate, a.price), pick: `${side === "over" ? "Over" : "Under"} ${L}` }); }
  rows.sort((a, b) => a.points - b.points);
  const b = best(rows), pts = b ? { id: "ptspick|total", kind: "total", ...b, ruleId: top.id } : null;
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
