// 10/26 (owner, design = both sports: "a little information button on the models cards where it tells us a reason why by all factors ... why it
// chose this or why it doesn't choose this"): the per-game facts behind the NBA MODEL ⓘ box, from the slate row itself -- the rule that named the
// PICK and the ones that did not (and why), Pinnacle's and Polymarket's moves, the sportsbooks vs Polymarket, rest / fatigue, ATS form, shot quality,
// the model vs the line, injuries with points per game, and the moneyline pick. Every line is [label, words, mark]: +1 = for the PICK's side,
// -1 = against it, 0 = neither. Display only.
const sg = (x) => (x > 0 ? "+" : "") + x;
const r1 = (x) => Math.round(Number(x) * 10) / 10;
const fin = (x) => x != null && x !== "" && isFinite(Number(x));
export const RULE_WORDS = { "linemove|spread": "LINE MOVE rule", "bookgap|spread": "BOOK GAP rule", "fatigue|spread": "FATIGUE rule", "atsreg|spread": "ATS REGRESSION rule", "model|spread": "the model's side (no tested rule fired; about a coin flip, 49.4%)",
  "linemove|total": "TOTAL MOVE rule", "bookgap|total": "BOOK GAP rule", "shotq|total": "SHOT QUALITY rule", "model|total": "the model's side (no tested rule fired; 50.4%)" };
export function ptTime(iso) { if (!iso) return ""; try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return ""; } }
const BGAP_SP = [1, 4], BGAP_TOT = [2, 6], BGAP_FRESH_MS = 6 * 3600e3;
function injWords(rows) {   // the listed players of one team by points a game: "L.James Questionable (24.1 ppg)"
  const xs = (rows || []).filter((x) => x && x.name).slice().sort((a, b) => Number(b.ppg || 0) - Number(a.ppg || 0));
  const nm = (n) => { const p = String(n).trim().split(/\s+/).filter((x) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); return p.length > 1 ? `${p[0][0]}.${p[p.length - 1]}` : p[0] || ""; };
  return { n: xs.length, text: xs.slice(0, 4).map((x) => `${nm(x.name)} ${x.status || "listed"}${fin(x.ppg) ? ` (${r1(x.ppg)} ppg)` : ""}`).join("; ") + (xs.length > 4 ? ` +${xs.length - 4} more` : "") };
}
export function gameWhy(g, now = Date.now()) {
  if (!g || !g.home || !g.away) return null;
  const H = g.home, A = g.away, out = { spread: [], total: [] }, C = g.card || {}, ctx = g.context || {}, ch = ctx.home || {}, ca = ctx.away || {};
  const px = g.poly || {}, hs = px.spread && fin(px.spread.homeSpread) ? Number(px.spread.homeSpread) : null, tl = px.total && fin(px.total.line) ? Number(px.total.line) : null;
  const P = C.spread && C.spread.plain, pickTeam = P ? P.team : null, forTeam = (t) => (pickTeam ? (t === pickTeam ? 1 : -1) : 0);
  const T = C.total && C.total.plain, pickSide = T ? T.side : null, forSide = (s) => (pickSide ? (s === pickSide ? 1 : -1) : 0);
  const mv = g.move || {}, sig = mv.signal || {}, bk = g.books || null, bkFresh = !!(g.booksAt && now - Date.parse(g.booksAt) <= BGAP_FRESH_MS);
  // ---- spread
  if (P) out.spread.push(["Pick:", `${P.pick} · ${r1(P.hit)}% · ${RULE_WORDS[P.ruleId] || P.ruleId || "the card"}${P.ruleId === "linemove|spread" ? (P.atOpen ? " (Polymarket still at Pinnacle's opening number: 67.9%)" : " (after the move: 56.3%)") : ""}${P.why && !/^model/.test(P.ruleId || "") ? ` — ${P.why}` : ""}`, 1]);
  else if (hs != null) out.spread.push(["Pick:", "none yet on this line", 0]);
  if (sig.spread && sig.spread.team) { const s = sig.spread; out.spread.push(["Pinnacle:", `moved ${r1(s.pts)} point${Math.abs(s.pts) === 1 ? "" : "s"} toward ${s.team} since its first line${fin(s.open) ? ` (opened ${s.team} ${sg(r1(s.open))})` : ""}`, forTeam(s.team)]); }
  if (mv.spread && fin(mv.spread.open) && fin(mv.spread.now)) { const d = Number(mv.spread.now) - Number(mv.spread.open), gain = pickTeam ? (pickTeam === H ? d : -d) : 0;
    out.spread.push(["Polymarket line:", `opened ${H} ${sg(Number(mv.spread.open))} → now ${sg(Number(mv.spread.now))}: moved ${Math.abs(r1(d))} toward ${d < 0 ? H : A}${pickTeam ? ` · ${pickTeam} ${gain > 0 ? "gets" : "gives up"} ${Math.abs(r1(gain))}` : ""}`, gain >= 1 ? 1 : gain <= -1 ? -1 : 0]); }
  else if (hs != null) out.spread.push(["Polymarket line:", `${H} ${sg(hs)}, unchanged since first seen`, 0]);
  if (bk && bk.spread && fin(bk.spread.homeSpread) && hs != null) { const B = Number(bk.spread.homeSpread), gap = Math.abs(B - hs); let note = "";
    if (gap === 0) note = " · the same number"; else if (gap < BGAP_SP[0]) note = " · under 1 point apart, no BOOK GAP"; else if (gap > BGAP_SP[1]) note = " · over 4 points apart: a bad read, no rule"; else note = bkFresh ? ` · ${r1(gap)} off → BOOK GAP${P && P.ruleId === "bookgap|spread" ? "" : " (a stronger rule named the side)"}` : ` · ${r1(gap)} off, but the books are older than 6 h, so BOOK GAP is off`;
    out.spread.push(["Sportsbooks:", `${H} ${sg(B)}${g.booksAt ? ` (pulled ${ptTime(g.booksAt)})` : ""} vs Polymarket ${sg(hs)}${note}`, gap === 0 ? 0 : forTeam(B < hs ? H : A)]); }
  { const f = g.fatigue || {}, bits = [];
    if (fin(ch.rest) && fin(ca.rest)) bits.push(`${H} ${ch.rest} day${Number(ch.rest) === 1 ? "" : "s"} rest, ${A} ${ca.rest}`);
    let tired = null;
    for (const [side, team] of [["home", H], ["away", A]]) { const x = f[side]; if (!x) continue; if (x.ot) { bits.push(`${team} on a back-to-back after overtime`); tired = tired ? "both" : team; } else if (x.far && side === "away") { bits.push(`${A} flew ${fin(ca.trav_km) ? Math.round(ca.trav_km) + " km" : "1,500+ km"} on a back-to-back`); tired = tired ? "both" : team; } }
    if (!tired && ((Number(ch.rest) === 1) !== (Number(ca.rest) === 1))) bits.push(`a plain back-to-back for ${Number(ch.rest) === 1 ? H : A} (priced by the market, 50.9%: no rule)`);
    if (tired === "both") bits.push("both tired, FATIGUE names no side");
    if (bits.length) out.spread.push(["Rest:", bits.join(" · "), tired && tired !== "both" ? forTeam(tired === H ? A : H) : 0]); }
  if (fin(ca.ats_n) && fin(ca.ats_pct)) { const n = Number(ca.ats_n), p = Number(ca.ats_pct), fires = n >= 20 && p <= 0.35;
    out.spread.push(["ATS:", `${A} covered ${Math.round(p * 100)}% of ${n} lined games${fires ? " → ATS REGRESSION (bet the cold road team, 57.3%)" : n < 20 ? " (the rule needs 20+)" : p <= 0.4 ? " (the rule needs 35% or less)" : ""}`, fires ? forTeam(A) : 0]); }
  if (g.model && fin(g.model.margin) && hs != null) { const m = Number(g.model.margin), d = m + hs, likes = d > 0 ? H : d < 0 ? A : null;
    out.spread.push(["Model:", `${m >= 0 ? H : A} by ${Math.abs(r1(m))} · vs the line it leans ${likes ? `${likes} by ${Math.abs(r1(d))}` : "nowhere"}${g.model.injuryShift ? ` · injuries moved it ${r1(g.model.injuryShift)}` : ""}`, likes && Math.abs(d) >= 1 ? forTeam(likes) : 0]); }
  if (g.model && g.model.teamSide && g.model.teamSide.team) out.spread.push(["Team model:", `${g.model.teamSide.team} ${g.model.teamSide.pct}% · data only on NBA (50.7% walk-forward, never a pick)`, 0]);
  for (const [team, side] of [[H, "home"], [A, "away"]]) { const w = injWords((g.injuries || {})[side]), star = g.starOut && g.starOut[side];
    if (!w.n && !star) continue;
    out.spread.push([`${team} injuries:`, `${star ? "top scorer out · " : ""}${w.text || "nobody listed"}`, pickTeam ? (team === pickTeam ? -1 : 1) : 0]); }
  { const k = g.ml && g.ml.pick, mk = g.model && fin(g.model.marketWinPct) ? Number(g.model.marketWinPct) : null, favPct = mk == null ? null : Math.max(mk, 100 - mk), fav = mk == null ? null : mk >= 50 ? H : A;
    if (k && (k.tier === "pick" || k.tier === "lean")) out.spread.push(["ML pick:", `${k.label} · ${k.pct}% = the market's own chance with the fee out${k.tier === "lean" ? " (lean, under 56%)" : ""}`, 1]);
    else if (favPct != null) out.spread.push(["ML pick:", `none: ${fav} is the favorite at ${r1(favPct)}% with the fee out, under the 56% bar`, 0]); }
  // ---- total
  if (T) out.total.push(["Pick:", `${T.pick} · ${r1(T.hit)}% · ${RULE_WORDS[T.ruleId] || T.ruleId || "the card"}${T.why && !/^model/.test(T.ruleId || "") ? ` — ${T.why}` : ""}`, 1]);
  else if (tl != null) out.total.push(["Pick:", "none yet on this total", 0]);
  if (sig.total && sig.total.side) { const s = sig.total; out.total.push(["Pinnacle:", `moved the total ${r1(s.pts)} toward the ${s.side === "over" ? "Over" : "Under"} since its first number${fin(s.open) ? ` (opened ${s.open})` : ""}${T && T.ruleId === "linemove|total" ? "" : " · TOTAL MOVE fires only while Polymarket still has the opening number"}`, forSide(s.side)]); }
  if (mv.total && fin(mv.total.open) && fin(mv.total.now)) { const d = Number(mv.total.now) - Number(mv.total.open), better = pickSide ? (pickSide === "over" ? d < 0 : d > 0) : null;
    out.total.push(["Polymarket total:", `opened ${mv.total.open} → now ${mv.total.now}: ${d > 0 ? "up" : "down"} ${Math.abs(r1(d))}${pickSide ? ` · a ${better ? "better" : "worse"} number for the ${pickSide === "over" ? "Over" : "Under"}` : ""}`, better == null ? 0 : better ? 1 : -1]); }
  else if (tl != null) out.total.push(["Polymarket total:", `${tl}, unchanged since first seen`, 0]);
  if (bk && bk.total && fin(bk.total.line) && tl != null) { const B = Number(bk.total.line), gap = Math.abs(B - tl); let note = "";
    if (gap === 0) note = " · the same number"; else if (gap < BGAP_TOT[0]) note = " · under 2 points apart, no BOOK GAP"; else if (gap > BGAP_TOT[1]) note = " · over 6 apart: a bad read, no rule"; else note = bkFresh ? ` · ${r1(gap)} off → BOOK GAP${T && T.ruleId === "bookgap|total" ? "" : " (a stronger rule named the side)"}` : ` · ${r1(gap)} off, but the books are older than 6 h, so BOOK GAP is off`;
    out.total.push(["Sportsbooks:", `${B}${g.booksAt ? ` (pulled ${ptTime(g.booksAt)})` : ""} vs Polymarket ${tl}${note}`, gap === 0 ? 0 : forSide(B > tl ? "over" : "under")]); }
  { const hl = ch.sq_l20, al = ca.sq_l20, hx = ch.sq_x10, ax = ca.sq_x10, cmu = ch.sq_cold_mu, smu = ch.sq_mu;
    if (fin(hl) && fin(al) && fin(cmu) && tl != null) { const cold = Number(hl) + Number(al) - Number(cmu), sq = fin(hx) && fin(ax) && fin(smu) ? (Number(hx) + Number(ax)) / 2 - tl - Number(smu) : null, fires = cold <= -6.9 || (sq != null && sq >= 10.9);
      out.total.push(["Shot quality:", `both teams' shooting ran ${cold <= 0 ? "cold" : "hot"} by ${Math.abs(r1(cold))} over 20 games (Over at -6.9 or colder)${sq != null ? ` · their shots are worth ${sq >= 0 ? "+" : ""}${r1(sq)} vs the total (Over at +10.9)` : ""}${fires ? " → SHOT QUALITY" : ", no rule"}`, fires ? forSide("over") : 0]); } }
  if (g.model && fin(g.model.total) && tl != null) { const d = Number(g.model.total) - tl;
    out.total.push(["Model:", `${r1(g.model.total)} vs ${tl} → leans ${d > 0 ? "Over" : d < 0 ? "Under" : "neither"} by ${Math.abs(r1(d))}`, Math.abs(d) >= 1 ? forSide(d > 0 ? "over" : "under") : 0]); }
  for (const [team, side] of [[H, "home"], [A, "away"]]) if (g.starOut && g.starOut[side]) out.total.push([`${team}:`, "top scorer out", forSide("under")]);
  return out;
}
