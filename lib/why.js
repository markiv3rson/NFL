// 10/26 (owner: "a little information button on the models cards where it tells us a reason why by all factors ... why it chose this or why it
// doesn't choose this"): the per-game facts behind the MODEL ⓘ box, built from what the slate already holds -- the rules that fired and the ones
// that did not (and why), the line's moves with their times, the sportsbooks vs Polymarket, the game / team / Stack models, injuries with ESPN's
// own sentences and their dates, QB changes, last game, rest, the TD model's team totals, weather, and the ML pick. Every line is
// [label, words, mark]: mark +1 = for the card's PICK side, -1 = against it, 0 = neither. Display only: nothing here picks, records or grades.
const sg = (x) => (x > 0 ? "+" : "") + x;
const r1 = (x) => Math.round(Number(x) * 10) / 10;
const fin = (x) => x != null && isFinite(Number(x));
export const RULE_WORDS = { "teammodel|spread": "TEAM MODEL rule", "overshoot|spread": "OVERSHOOT rule", "movepred|total": "TOTAL MOVE rule", "bounceback|spread": "BOUNCE BACK rule", "floordog|spread": "BOUNCE BACK DOG rule",
  "injury|spread": "INJURY rule", "linemove|spread": "LINE MOVE rule", "linemove|total": "LINE MOVE rule", "keynum|spread": "BEAT THE",
  "stack|spread": "the Stack model's side (no tested rule fired)", "model|spread": "the game model's side (no tested rule, no Stack line)", "model|total": "the game model's side (no tested rule fired)" };
export function ptTime(iso) {   // "Fri 1:10 PM" in Pacific (owner rule 12)
  if (!iso) return ""; try { return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return ""; }
}
const shortName = (n) => { const p = String(n || "").trim().split(/\s+/).filter((x) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); return p.length > 1 ? `${p[0][0]}.${p[p.length - 1]}` : p[0] || ""; };
const GAME_STATUS = /^(out|doubtful|questionable)/i;
const flag = (i) => !!i && (i.qb >= 1 || i.db >= 2 || i.ol >= 2);
const flagWords = (i) => [i && i.qb >= 1 ? "starting QB out" : "", i && i.ol >= 2 ? `${i.ol} linemen out` : "", i && i.db >= 2 ? `${i.db} DBs out` : ""].filter(Boolean).join(", ");
// the last time the Polymarket spread / total changed in the saved snapshots
function lastMove(hist, kind) {
  const v = (s) => (s && s.poly ? (kind === "total" ? (s.poly.total ? s.poly.total.line : null) : (s.poly.spread ? s.poly.spread.homeSpread : null)) : null);
  let prev = null, at = null, from = null, to = null;
  for (const s of hist || []) { const x = v(s); if (x == null) continue; if (prev != null && x !== prev) { at = s.t; from = prev; to = x; } prev = x; }
  return at ? { at, from, to } : null;
}
function injWords(rows, team) {   // Out / Doubtful / Questionable players of one team, ESPN's sentence and its time when there is one (4 names, then a count)
  const xs = (rows || []).filter((x) => x.team === team && !x.shown && GAME_STATUS.test(String(x.status))).sort((a, b) => rank(a) - rank(b));
  const one = (x) => `${shortName(x.name)}${x.pos ? " " + x.pos : ""} ${String(x.status)}${x.note ? ` (ESPN${x.at ? " " + ptTime(x.at) : ""}: “${String(x.note).slice(0, 90)}${String(x.note).length > 90 ? "…" : ""}”)` : x.src === "espn" && x.at ? ` (ESPN ${ptTime(x.at)})` : ""}`;
  return { n: xs.length, text: xs.slice(0, 4).map(one).join("; ") + (xs.length > 4 ? ` +${xs.length - 4} more` : "") };
}
const rank = (x) => { const s = String(x.status).toLowerCase(); return /^out/.test(s) ? 0 : /^doubt/.test(s) ? 1 : 2; };

export function gameWhy(I) {
  const { g, card, combos = [], teamSide, stackSide, mar, tot, hs, tl, hsOpen, tlOpen, openAt, hist = [], bk, bkAt, sit, inj = [], qb = {}, td, xf, wx, week, mvT } = I || {};
  if (!g) return null;
  const H = g.home, A = g.away, out = { spread: [], total: [], ml: [] };
  const P = card && card.spread && card.spread.plain, pickTeam = P ? P.team : null, pickHome = pickTeam === H;
  const forTeam = (team) => (pickTeam ? (team === pickTeam ? 1 : -1) : 0);
  const T = card && card.total && card.total.plain, pickSide = T ? T.side : null;
  const forSide = (side) => (pickSide ? (side === pickSide ? 1 : -1) : 0);
  const S = sit || {}, SH = S.home || {}, SA = S.away || {};
  // ---- spread
  if (P) out.spread.push(["Pick:", `${P.pick} · ${r1(P.hit)}% · ${RULE_WORDS[P.ruleId] || P.ruleId || "the card"}${P.why && P.ruleId !== "stack|spread" ? ` — ${P.why}` : ""}`, 1]);
  else if (hs != null) out.spread.push(["Pick:", "none yet on this line", 0]);
  for (const c of combos) { if (!c || c.kind !== "spread" || (P && c.id === P.ruleId)) continue;
    const team = c.team || String(c.pick || "").split(" ")[0];
    if (c.id === "keynum|spread") out.spread.push(["BEAT THE:", `${c.why} · names no side; its bought line sits in the MORE list`, 0]);
    else out.spread.push([`${(RULE_WORDS[c.id] || c.id).replace(" rule", "")}:`, `also fired: ${c.pick} ${r1(c.hit)}% — ${c.why}${pickTeam && team !== pickTeam ? " · the other side (the underdog's rule wins a split)" : ""}`, forTeam(team)]);
  }
  if (fin(hs)) {
    if (fin(hsOpen) && Number(hsOpen) !== Number(hs)) { const mv = Number(hs) - Number(hsOpen), gain = pickTeam ? (pickHome ? mv : -mv) : 0, lm = lastMove(hist, "spread");
      out.spread.push(["Line:", `opened ${H} ${sg(Number(hsOpen))}${openAt ? ` (${ptTime(openAt)})` : ""} → now ${sg(Number(hs))}: moved ${Math.abs(mv)} toward ${mv < 0 ? H : A}${lm ? `, last move ${ptTime(lm.at)}` : ""}${pickTeam ? ` · ${pickTeam} ${gain > 0 ? "gets" : "gives up"} ${Math.abs(gain)} point${Math.abs(gain) === 1 ? "" : "s"} vs the opener` : ""}`, gain >= 1 ? 1 : gain <= -1 ? -1 : 0]); }
    else out.spread.push(["Line:", `${H} ${sg(Number(hs))}, unchanged since the week's first Polymarket line${openAt ? ` (${ptTime(openAt)})` : ""}`, 0]);
  }
  if (bk && bk.spread && fin(bk.spread.homeSpread) && fin(hs)) { const B = Number(bk.spread.homeSpread), d = B - Number(hs);
    out.spread.push(["Sportsbooks:", `${H} ${sg(B)}${bkAt ? ` (pulled ${ptTime(bkAt)})` : ""} vs Polymarket ${sg(Number(hs))}${d === 0 ? " · the same number, so no LINE MOVE" : ` · the books lean ${d < 0 ? H : A} by ${Math.abs(d)}${Math.abs(d) < 1 ? " (under 1 point, no LINE MOVE)" : ""}`}`, d === 0 ? 0 : forTeam(d < 0 ? H : A)]); }
  if (fin(mar) && fin(hs)) { const edge = Number(mar) + Number(hs), likes = edge > 0 ? H : edge < 0 ? A : null;
    out.spread.push(["Game model:", `${Number(mar) >= 0 ? H : A} by ${Math.abs(r1(mar))} · vs the line it leans ${likes ? `${likes} by ${Math.abs(r1(edge))}` : "nowhere"} (a coin flip on its own: 50.6% in history)`, likes && Math.abs(edge) >= 1 ? forTeam(likes) : 0]); }
  if (teamSide && teamSide.team) { const sure = Number(teamSide.pct), fired = combos.some((c) => c && c.id === "teammodel|spread"); let why = "";
    if (!fired) { if (sure < 58) why = " · under 58% sure, not a pick (49-53% there)"; else if (fin(hsOpen) && fin(hs)) { const gain = (teamSide.team === H ? 1 : -1) * (Number(hs) - Number(hsOpen)); if (gain <= -1) why = " · 58%+ but the line moved 1+ toward it since the week's first line (51.7% there), so it does not fire"; } }
    out.spread.push(["Team model:", `${teamSide.team} ${sure}% sure${why}`, forTeam(teamSide.team)]); }
  if (stackSide && stackSide.team) out.spread.push(["Stack model:", `${stackSide.team}${stackSide.confident ? " · confident (its top fifth, 56.2% in history)" : " · not confident (52.8%)"}${Number(stackSide.yv) >= 2 ? "" : " · built on the old team yards, not used for the PICK"}`, forTeam(stackSide.team)]);
  for (const [team, X] of [[H, SH], [A, SA]]) { const w = injWords(inj, team), fw = flagWords(X.inj);
    if (!w.n && !fw) continue;
    out.spread.push([`${team} injuries:`, `${fw ? fw + " · " : ""}${w.text || "none Out / Doubtful / Questionable"}`, pickTeam ? (team === pickTeam ? -1 : 1) : 0]); }
  { const h = flag(SH.inj), a = flag(SA.inj), fired = combos.some((c) => c && c.id === "injury|spread");
    if (h !== a && !fired) { const healthy = a ? H : A, hurtPrev = a ? SA.injPrev : SH.injPrev; let why = "";
      if (fin(week) && Number(week) < 4) why = "the rule starts in week 4";
      else if (flag(hurtPrev)) why = "the injury is not new (the same starters were out last week too, 54.4% there)";
      else if (fin(hs) && fin(hsOpen)) { const moved = a ? Number(hsOpen) - Number(hs) : Number(hs) - Number(hsOpen); if (moved >= 1) why = `the line already moved ${moved} toward ${healthy} (the edge is before the move)`; }
      if (why) out.spread.push(["INJURY rule:", `${a ? A : H} has starters out but it does not fire: ${why}`, 0]); }
    else if (h && a && !fired) out.spread.push(["INJURY rule:", "both teams have starters out, so it names no side", 0]); }
  for (const team of [A, H]) if (qb && qb[team]) out.spread.push([`${team}:`, String(qb[team]), pickTeam ? (team === pickTeam ? -1 : 1) : 0]);
  for (const [team, X] of [[A, SA], [H, SH]]) { const bits = [];
    if (fin(X.prevAts) && Math.abs(X.prevAts) >= 14) bits.push(`${X.prevAts < 0 ? "missed the spread by" : "covered by"} ${Math.abs(Math.round(X.prevAts))}`);
    if (fin(X.prevPts) && X.prevPts <= 10) bits.push(`scored ${X.prevPts}`);
    if (fin(X.prevMarg) && Math.abs(X.prevMarg) >= 17) bits.push(`${X.prevMarg > 0 ? "won" : "lost"} by ${Math.abs(X.prevMarg)}`);
    if (bits.length) out.spread.push([`${team} last game:`, bits.join(", "), 0]); }
  if (xf && fin(xf.homeRest) && fin(xf.awayRest) && Math.abs(xf.homeRest - xf.awayRest) >= 3) { const rested = xf.homeRest > xf.awayRest ? H : A;
    out.spread.push(["Rest:", `${H} ${xf.homeRest} days, ${A} ${xf.awayRest}${xf.homeRest >= 13 ? ` · ${H} off a bye` : xf.awayRest >= 13 ? ` · ${A} off a bye` : ""}`, forTeam(rested)]); }
  if (td && Array.isArray(td.home) && Array.isArray(td.away)) { const sum = (xs) => xs.reduce((a, r) => a + (fin(r.fair) ? Number(r.fair) / 100 : 0), 0), th = sum(td.home), ta = sum(td.away);
    if (th + ta > 0) out.spread.push(["TD model:", `expects ${H} ${th.toFixed(1)} TDs, ${A} ${ta.toFixed(1)}`, 0]); }
  if (wx && wx.outdoor && ((fin(wx.wind) && wx.wind >= 12) || (fin(wx.temp) && wx.temp <= 32))) out.spread.push(["Weather:", `outdoors${fin(wx.wind) ? `, wind ${Math.round(wx.wind)} mph` : ""}${fin(wx.temp) ? `, ${Math.round(wx.temp)}°F` : ""}`, 0]);
  // ---- ML pick (shown under the spread lines)
  { const M = card && card.ml && card.ml.plain, pm = g.poly && g.poly.ml, pH = pm && pm.home > 0 && pm.away > 0 ? pm.home / (pm.home + pm.away) : null;
    const fav = pH == null ? null : pH > 0.5 ? H : pH < 0.5 ? A : null, pf = pH == null ? null : Math.max(pH, 1 - pH);
    const also = card && card.ml && card.ml.also;
    if (M && M.ruleId === "tmml|ml") out.ml.push(["ML pick:", `${M.pick} · ${r1(M.hit)}% · the team model is 58%+ sure of ${M.team} and the line moved 1+ against it since the week's first line; ${M.team} is priced ${Math.round((M.team === fav ? pf : 1 - pf) * 100)}¢ with the fee out (${M.team === fav ? "favorites" : "underdogs priced 30-50¢"} in that spot won ${r1(M.hit)}% straight up in 2014-25)${also ? ` · the Stack model also backs ${also.team} (${r1(also.hit)}%)` : ""}`, 1]);
    else if (M) out.ml.push(["ML pick:", `${M.pick} · ${r1(M.hit)}% · the Stack model backs the favorite, priced ${Math.round(pf * 100)}¢ with the fee out (the 50-70¢ band won ${r1(M.hit)}% in 2022-25)${also ? ` · the team model vs the move backs ${also.team} (${r1(also.hit)}%)` : ""}`, 1]);
    else if (!fav) out.ml.push(["ML pick:", "none: a pick'em on the moneyline", 0]);
    else if (!stackSide || !stackSide.team || !(Number(stackSide.yv) >= 2)) out.ml.push(["ML pick:", `none: no Stack line yet (${fav} is the favorite at ${Math.round(pf * 100)}¢)`, 0]);
    else if (stackSide.team !== fav) out.ml.push(["ML pick:", `none: the Stack model backs ${stackSide.team}, the underdog (favorites won 64% priced 66% in those games)`, 0]);
    else if (pf >= 0.7) out.ml.push(["ML pick:", `none: ${fav} is priced ${Math.round(pf * 100)}¢, above the 50-70¢ band (70%+ favorites won 73% priced 75%, no edge)`, 0]);
    else out.ml.push(["ML pick:", `none: ${fav} at ${Math.round(pf * 100)}¢`, 0]); }
  // ---- total
  if (T) out.total.push(["Pick:", `${T.pick} · ${r1(T.hit)}% · ${RULE_WORDS[T.ruleId] || T.ruleId || "the card"}${T.why ? ` — ${T.why}` : ""}`, 1]);
  else if (tl != null) out.total.push(["Pick:", "none yet on this total", 0]);
  for (const c of combos) { if (!c || c.kind !== "total" || (T && c.id === T.ruleId)) continue;
    out.total.push([`${(RULE_WORDS[c.id] || c.id).replace(" rule", "")}:`, `also fired: ${c.pick} ${r1(c.hit)}% — ${c.why}`, forSide(c.side)]); }
  if (fin(tl)) {
    if (fin(tlOpen) && Number(tlOpen) !== Number(tl)) { const mv = Number(tl) - Number(tlOpen), lm = lastMove(hist, "total"), better = pickSide ? (pickSide === "over" ? mv < 0 : mv > 0) : null;
      out.total.push(["Total:", `opened ${tlOpen}${openAt ? ` (${ptTime(openAt)})` : ""} → now ${tl}: ${mv > 0 ? "up" : "down"} ${Math.abs(r1(mv))}${lm ? `, last move ${ptTime(lm.at)}` : ""}${pickSide ? ` · a ${better ? "better" : "worse"} number for the ${pickSide === "over" ? "Over" : "Under"}` : ""}`, better == null ? 0 : better ? 1 : -1]); }
    else out.total.push(["Total:", `${tl}, unchanged since the week's first Polymarket total${openAt ? ` (${ptTime(openAt)})` : ""}`, 0]);
  }
  if (bk && bk.total && fin(bk.total.line) && fin(tl)) { const B = Number(bk.total.line), d = B - Number(tl);
    out.total.push(["Sportsbooks:", `${B}${bkAt ? ` (pulled ${ptTime(bkAt)})` : ""} vs Polymarket ${tl}${d === 0 ? " · the same number" : ` · the books sit ${Math.abs(r1(d))} ${d > 0 ? "higher (Over lean)" : "lower (Under lean)"}${Math.abs(d) < 3 ? ", under the 3-point LINE MOVE bar" : ""}`}`, d === 0 ? 0 : forSide(d > 0 ? "over" : "under")]); }
  if (fin(tot) && fin(tl)) { const d = Number(tot) - Number(tl);
    out.total.push(["Game model:", `${r1(tot)} vs ${tl} → leans ${d > 0 ? "Over" : d < 0 ? "Under" : "neither"} by ${Math.abs(r1(d))} (51.7% on its own in history)`, Math.abs(d) >= 1 ? forSide(d > 0 ? "over" : "under") : 0]); }
  if (mvT && fin(mvT.move)) { const fired = combos.some((c) => c && c.id === "movepred|total"), dir = mvT.move > 0 ? "rise" : "fall", side = mvT.move > 0 ? "over" : "under"; let why = "";
    if (!fired) { if (fin(week) && Number(week) < 4) why = " · the rule starts in week 4"; else if (fin(tl) && fin(tlOpen) && Math.abs(Number(tl) - Number(tlOpen)) >= 0.5) why = " · the total already left its opening number, so TOTAL MOVE cannot fire"; else if (fin(mvT.thr20) && Math.abs(mvT.move) < mvT.thr20) why = ` · under the rule's bar (${r1(mvT.thr20)}), no pick`; }
    out.total.push(["Move model:", `expects the total to ${dir} ${Math.abs(r1(mvT.move))} from its opener${why}`, forSide(side)]); }
  if (wx && wx.outdoor && fin(wx.wind) && wx.wind >= 12) out.total.push(["Weather:", `wind ${Math.round(wx.wind)} mph outdoors${fin(wx.temp) ? `, ${Math.round(wx.temp)}°F` : ""} (the market already prices wind; 10+ mph games went Under 58.7% at the close in history)`, forSide("under")]);
  else if (wx && wx.outdoor && fin(wx.temp) && wx.temp <= 32) out.total.push(["Weather:", `${Math.round(wx.temp)}°F outdoors`, 0]);
  for (const [team, X] of [[A, SA], [H, SH]]) if (X.inj && X.inj.qb >= 1) out.total.push([`${team}:`, "starting QB out", forSide("under")]);
  if (td && Array.isArray(td.home) && Array.isArray(td.away)) { const sum = (xs) => xs.reduce((a, r) => a + (fin(r.fair) ? Number(r.fair) / 100 : 0), 0), all = sum(td.home) + sum(td.away);
    if (all > 0) out.total.push(["TD model:", `expects ${all.toFixed(1)} touchdowns in all`, 0]); }
  return out;
}
