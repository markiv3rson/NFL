// NFL SLATEZZZ — everything comes from /api/slate (lines, TD, flags) and /api/mybets + /api/results/list (Record).
// A bet's average price: whole cents from 10c, else one decimal (1.6c, not "2c": $2 at 1.6c pays $125), two under 0.1c.
const betCents = (p) => { const c = p * 100; return c >= 9.95 ? String(Math.round(c)) : c >= 0.095 ? c.toFixed(1) : c >= 0.005 ? c.toFixed(2) : "<0.01"; };
let WINALL = false;
let PAPER = null, TRACKED = null, COMBOS = null;
let S = null, RES = null, MB = null;
const $ = (id) => document.getElementById(id);
const dash = '<span class="dim">—</span>';
const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const sgn = (n) => (n > 0 ? "+" : "") + n;
const odds = (o) => (o == null ? "—" : (o > 0 ? "+" : "") + o);
function toAmerican(p) { if (!(p > 0 && p < 1)) return null; return Math.round(p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p); }
const signCls = (x) => (x == null || Math.abs(x) < 1e-9 ? "" : x > 0 ? "g" : "r");
const cMoney = (x) => (x == null ? "—" : `<span class="${signCls(x)}">${x < 0 ? "−$" : x > 0 ? "+$" : "$"}${Math.abs(x).toFixed(2)}</span>`);
const money = (x) => (x < 0 ? "−$" : "$") + Math.abs(x).toFixed(2);
const cPct = (x, d = 1) => (x == null ? "—" : `<span class="${signCls(x)}">${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%</span>`);
const tm = (iso) => (!iso || isNaN(new Date(iso)) ? "TBD" : new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }));
const hm = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
function toast(msg, ms = 7000) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._h); if (ms) toast._h = setTimeout(() => t.classList.remove("show"), ms); }

// ---------- shared card parts ----------
// 10/16 (owner): the Injuries / History pills sit on the section-title line (SPREAD & ML, TOTALS), outside the card; the drop-downs open at the top of the card
function headPills(g, id, noWarn = false) {
  const n = noWarn ? 0 : (g.injuries || []).length;
  return `<div class="btns">${n ? `<button class="tag" data-drop="inj-${id}">Injuries ${n} ▾</button>` : ""}<button class="tag" data-drop="his-${id}">History ▾</button></div>`;
}
const secRow = (title, pills = "") => `<div class="trow"><div class="sh">${title}</div>${pills}</div>`;
function headDrops(g, id, noWarn = false) {
  // 10/19 (owner rule: no warnings on the cards): the "⚠ QB change ... not in the model yet" line is gone; a QB change is an alert (Alerts -> QB change)
  return (!noWarn && g.dataCheck ? `<div class="warn">⚠ ${esc(g.dataCheck)}</div>` : "") +
    `<div class="drop" id="inj-${id}"><div class="s" style="margin-bottom:4px">Official report${(g.injuries || []).some((x) => x.src === "espn") ? " + ESPN" : ""}${(() => { const w = [...new Set((g.injuries || []).map((x) => x.week).filter((x) => x != null))]; return w.length ? ` · Week ${w.join("/")}` + (w.every((x) => Number(x) !== Number(g.week ?? S.week)) ? " (last week's)" : "") : ""; })()} · updated ${(() => { const t = [S.injuriesUpdated, g.injEspnAt].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0]; return t ? hm(t) : "—"; })()}</div>` +
    (g.injuries || []).map((x) => `<div class="drow"><span>${injBadge(x.team)}${esc(x.name)} <span class="dim">${esc(x.pos || "")} · ${x.team}</span></span><span class="${x.shown ? "dim" : /out/i.test(x.status) ? "r" : /doubt/i.test(x.status) ? "r" : "y"}">${esc(x.shown || x.status)}</span></div>`).join("") + `</div>` +
    `<div class="drop" id="his-${id}">${historyRows(g)}</div>`;
}
// History dropdown (reworked 9/29): it already resets each week (stored per week), but it listed EVERY snapshot, so a
// quiet week showed a dozen identical rows. Now: the opening line, then only real moves (spread or total line changed,
// or a price moved 3¢+), then the latest -- with a count of how many checks were quiet.
function historyRows(g) {
  const hs = (g.history || []).filter((h) => h.poly);
  if (!hs.length) return '<div class="s empty">None yet.</div>';
  // One row per set of numbers: a new row only when the spread/total line changes or a price moves 3¢+. While the
  // numbers stay the same, the row keeps its start time and just updates "last checked".
  const key = (p) => ({ sl: p.spread ? p.spread.homeSpread : null, sp: p.spread ? p.spread.home : null, tl: p.total ? p.total.line : null, tp: p.total ? p.total.over : null, ml: p.ml ? p.ml.home : null });
  const moved = (a, b) => a.sl !== b.sl || a.tl !== b.tl || ["sp", "tp", "ml"].some((x) => a[x] != null && b[x] != null && Math.abs(a[x] - b[x]) >= 0.03);
  const rows = [{ from: hs[0], last: hs[0] }];
  for (const h of hs.slice(1)) { const cur = rows[rows.length - 1]; if (moved(key(h.poly), key(cur.from.poly))) rows.push({ from: h, last: h }); else cur.last = h; }
  const cell = (p) => `<span>${p.spread ? `${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}` : "—"}</span><span>${p.total ? `${p.total.line} (O ${odds(toAmerican(p.total.over))})` : "—"}</span><span>${p.ml ? `${g.home} ${odds(toAmerican(p.ml.home))}` : "—"}</span>`;
  return `<div class="s" style="margin-bottom:4px">${rows.length === 1 ? "no change yet" : `${rows.length - 1} move${rows.length === 2 ? "" : "s"}`}</div>` +
    `<div class="drow dim"><span>Since</span><span>SPREAD</span><span>TOTAL</span><span>MONEYLINE</span></div>` +
    rows.slice().reverse().map((r, i) => `<div class="drow"><span>${hm(r.from.t)}${r.from.src === "kickoff" ? " 🔒" : ""}` +
      `${r.last !== r.from ? `<br><span class="dim">last checked ${hm(r.last.t)}</span>` : ""}${i === rows.length - 1 ? '<br><span class="dim">opening line</span>' : ""}</span>${cell(r.from.poly)}</div>`).join("");
}
// 10/18: first initial + last name ("A.Taylor"), the same as the TD list -- a bare "Taylor out" on TEN @ IND read as IND's J.Taylor
const lastName = (n) => { const w = String(n || "").replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim().split(/\s+/); return w.length > 1 ? `${w[0][0]}.${w[w.length - 1]}` : w[0] || ""; };
// "Injuries: GB -1.6 (J.Reed out, D.Banks out) · ATL 0"  (only when the estimate actually moved something)
function injLine(g, kind) {
  const inj = g.model && g.model.inj; if (!inj) return "";
  const who = (t, key) => t.players.filter((p) => (key ? p[key] : true) && (key ? p[key] !== 0 : true)).map((p) => `${lastName(p.name)} ${p.status}`).join(", ");
  if (kind === "total") {
    if (Math.abs(inj.total || 0) < 0.05) return "";
    return `Injuries: total ${inj.total.toFixed(1)} (${[who(inj.home, "total"), who(inj.away, "total")].filter(Boolean).join(", ")})`;
  }
  if (!inj.home.players.length && !inj.away.players.length) return "";
  const one = (team, t) => (t.pts ? `${team} ${t.pts.toFixed(1)} (${who(t)}${t.capped ? ", capped" : ""})` : `${team} 0`);
  return `Injuries: ${one(g.home, inj.home)} · ${one(g.away, inj.away)}`;
}
// This season's record for the pick's type (10/9).
function recLine(r) { return r && r.w + r.l ? `<div class="s" style="margin-top:6px">This season: <b>${r.w}–${r.l}</b></div>` : ""; }   // nothing until a pick of this kind is graded (10/12: "0–0" was noise)
// Line check (10/9): the pick's line vs the week's first saved line for the same side; better or worse number since it opened.
function lineCheck(g, kind, pick) {
  const h0 = (g.history || []).find((h) => h.poly && (kind === "total" ? h.poly.total : h.poly.spread)); if (!h0) return "";
  const m = /^(Over|Under) ([\d.]+)/.exec(pick), t = /^([A-Z]{2,3}) ([+-][\d.]+)/.exec(pick);
  let open, now, better;
  // 10/14 fix: compare the MAIN line then vs the MAIN line now. A pick on an alternate line (KEY NUMBER's DEN +3.5 while the main line
  // is DEN +2.5) said "Line moved: opened +2.5, now +3.5" when nothing had moved.
  const LN = g.lineNow || {}, mainNow = kind === "total" ? (LN.tl ?? (g.poly && g.poly.total ? g.poly.total.line : null)) : (LN.hs ?? (g.poly && g.poly.spread ? g.poly.spread.homeSpread : null));
  if (kind === "total" && m) { open = h0.poly.total.line; now = Number(m[2]); if (mainNow == null || now !== mainNow) return ""; better = m[1] === "Over" ? now < open : now > open; }
  else if (kind === "spread" && t) { const hs0 = h0.poly.spread.homeSpread; open = t[1] === g.home ? hs0 : -hs0; now = Number(t[2]); if (mainNow == null || now !== (t[1] === g.home ? mainNow : -mainNow)) return ""; better = now > open; }
  else return "";
  if (!isFinite(open) || Math.abs(now - open) < 0.5) return "";
  const lab = (x) => (kind === "total" ? `${m[1]} ${x}` : `${t[1]} ${x > 0 ? "+" : ""}${x}`);
  return `<div class="s ${better ? "g" : "y"}" style="margin-top:4px">${better ? "✓" : "⚠"} Line moved: opened ${esc(lab(open))}, now ${esc(lab(now))} · ${better ? "better number now" : "worse number now"}</div>`;
}
// 10/14 (owner: "organize the cards, too much noise"): the card keeps the model number, the PICK + %, one short reason;
// everything else (without-the-points %, this rule's record, line moved, cost warning) sits behind a "More" tap.
function moreBox(inner) { return inner ? `<details class="more" style="margin-top:6px"><summary class="dim" style="font-size:12px;cursor:pointer">More</summary>${inner}</details>` : ""; }
// 10/15 (owner: "build now"): the spread / total card shows MODEL, the model's number, PICK (the side at Polymarket's own line) and PICK w/ POINTS (the same side on a
// bought line, fewest points that reach 56%, either team). Everything else sits under MORE. Green 56%+, light green 53-55%, yellow below (owner 10/15: win rate, not price).
// 10/15 hardening: a malformed card part (missing / non-number pieces) is treated as no card instead of breaking the page
const okN = (x) => typeof x === "number" && isFinite(x);
const okPick = (x) => !!x && typeof x === "object" && typeof x.pick === "string" && okN(x.hit);
function cardOf(g, kind) {
  const c = g && g.card && typeof g.card === "object" ? g.card[kind] : null;
  if (!c || typeof c !== "object") return null;
  const price = (x) => (okN(x.price) && x.price > 0 && x.price < 1 ? x.price : null);
  const fix = (x) => ({ ...x, price: price(x), cushion: okN(x.cushion) ? x.cushion : null });
  const rows = (Array.isArray(c.rows) ? c.rows : []).filter((r) => okPick(r) && okN(r.points) && okN(r.price) && r.price > 0 && r.price < 1).map(fix);
  if (!okPick(c.plain) && !rows.length) return null;   // 10/15: a game with no tested rule still shows its list (PICK says "No pick")
  return { ...c, plain: okPick(c.plain) ? fix(c.plain) : null, pts: okPick(c.pts) && okN(c.pts.points) ? fix(c.pts) : null, rows };
}
const clsOf = (hit) => (hit >= 56 ? "g" : hit >= 53 ? "lg" : "y");   // 10/15 (owner): colors by win rate only
const hitTxt = (hit, cls) => `${cls === "g" ? Math.round(hit) : Math.floor(hit)}%`;
// 10/19: one rounding rule for every shown chance -- green (56%+) rounds, below green rounds DOWN (card, Over/Under, parlay legs); TD legs use the TD list's rule
const legPct = (l) => { const v = (l.prob || 0) * 100; return l.kind === "td" ? tdPct(v) : l.kind === "spread" || l.kind === "total" ? (v >= 56 ? Math.round(v) : Math.floor(v)) : Math.round(v); };
const ptsWord = (n) => (n === 0 ? "main" : `${n} pt${n === 1 ? "" : "s"}`);   // short, so a list row fits on one line (owner 10/15)
function cardBody(g, kind, C) {
  const x = C.plain, p = C.pts;
  let l1;
  if (x) { const c1 = clsOf(x.hit), tx = hitTxt(x.hit, c1);
    l1 = c1 === "g" ? `<b class="g pulse" style="--gl:${glowOf(x.hit / 100)};font-size:13px;white-space:nowrap"><span class="lbw">Pick:</span> ${esc(x.pick)} · <span class="reelpct" data-v="${tx}">${tx}</span></b>` : `<b class="${c1}" style="font-size:13px;white-space:nowrap"><span class="lbw">Pick:</span> ${esc(x.pick)} · ${tx}</b>`; }
  else l1 = `<b class="dim" style="font-size:13px">No pick</b>`;
  let l2;
  if (p) { const c2 = clsOf(p.hit); l2 = `<b class="${c2}" style="font-size:13px;white-space:nowrap"><span class="lbw">Pick w/ points:</span> ${esc(p.pick)} · ${hitTxt(p.hit, c2)}</b>`; }
  else l2 = `<span class="dim" style="font-size:13px;white-space:nowrap"><span class="lbw">Pick w/ points:</span> none</span>`;
  const grp = (r) => r.team || (r.side === "over" ? "Over" : "Under"), first = x ? x.team || (x.side === "over" ? "Over" : "Under") : null;
  const names = [...new Set(C.rows.map(grp))].sort((a, b) => (a === first ? -1 : 0) - (b === first ? -1 : 0));
  // one list split by team with a gap, no titles (owner 10/15); only the model's chosen row is green, all the way across
  const rows = names.map((nm, i) => `<div style="margin-top:${i ? 8 : 2}px">` + C.rows.filter((r) => grp(r) === nm).map((r) => { const pk = !!(p && r.pick === p.pick);
    return `<div class="s${pk ? " g" : ""}" style="margin-top:2px;font-size:11px;white-space:nowrap">${esc(r.pick)} · ${ptsWord(r.points)} · ${hitTxt(r.hit, clsOf(r.hit))} · ${Math.round(r.price * 100)}¢</div>`; }).join("") + "</div>").join("");
  return `<div style="margin-top:6px">${l1}</div>` + moreBox(`<div style="margin-top:4px">${l2}</div>` + (rows ? `<div style="margin-top:6px">${rows}</div>` : ""));
}
function leanCell(g, kind) {
  let p = kind === "total" ? g.totalPick : g.spreadPick;
  const wrap = (inner) => `<div class="modelcell">${inner}</div>`;   // 10/15 (owner): no "MODEL ESTIMATE" title; 10/16 (owner): no box -- the model lines sit under the market, full width
  if (!p && g.early && g.model && g.model.homeMargin != null) {   // next week before any market line: the model's own numbers, labeled
    const m = g.model, side = m.homeMargin >= 0 ? `${g.home} -${m.homeMargin.toFixed(1)}` : `${g.away} -${(-m.homeMargin).toFixed(1)}`, wp = m.homeWinPct != null ? Math.round(m.homeWinPct >= 50 ? m.homeWinPct : 100 - m.homeWinPct) : null;
    return wrap(`${earlyNote(g)}<div style="margin-top:6px"><b class="mod">${kind === "total" ? `Total ${m.total.toFixed(1)}` : side}</b></div>` +
      `<div class="s">${kind === "total" ? "Model total" : `Model line${wp != null ? ` · ${m.homeWinPct >= 50 ? g.home : g.away} wins ${wp}%` : ""}`}</div>`);
  }
  // One answer per card (10/9): the model's number, then the ONE pick the decision layer chose for this market (best tested win rate,
  // 56%+), and why. When the pick goes against the model, it says so in plain words. No pick -> "No pick".
  const m = g.model; if (!m || m.homeMargin == null || m.total == null) return wrap(dash);
  const isTot = (x) => /^(Over|Under)\b/.test(x);   // 10/28 (owner: "Remove the lines and injury warnings"): the red Injuries line under the model is gone (injLine stays for the reason box data)
  // Upgraded model (10/9) when the slate has it: the game model corrected with everything else known before kickoff.
  const U = g.modelUp, LN = g.lineNow || {}, mm = U ? U.margin : m.homeMargin, mt = U ? U.total : m.total;
  const mline = kind === "total" ? `<span class="lbw">Model:</span> <b class="mod">${mt.toFixed(1)}</b>` : `<span class="lbw">Model:</span> <b class="mod">${mm >= 0 ? g.home : g.away} by ${Math.abs(mm).toFixed(1)}</b>`;
  const tline = kind === "spread" && g.teamSide && !g.started && !g.final ? `<div class="s"><span class="lbw">Model (Team):</span> <b class="mod">${esc(g.teamSide.pick)} · ${g.teamSide.pct}%</b></div>` : "";   // 10/20 owner: the team model's side on every spread card
  const sline = kind === "spread" && g.stackSide && !g.started && !g.final ? `<div class="s"><span class="lbw">Model (Stack):</span> <b class="mod">${esc(g.stackSide.pick)} · ${(g.card && g.card.spread && g.card.spread.plain && g.card.spread.plain.ruleId === "stack|spread" && g.card.spread.plain.team === g.stackSide.team ? g.card.spread.plain.hit : g.stackSide.pct)}%</b></div>` : "";   // 10/21 owner (option A): the STACK shadow's side on every spread card, data only
  if (U && LN.hs != null && LN.tl != null) {   // the model's side vs the current line, from the upgraded numbers
    const homeSide = mm + LN.hs > 0, t = homeSide ? g.home : g.away, ln = homeSide ? LN.hs : -LN.hs;
    p = kind === "total" ? { side: mt > LN.tl ? "over" : "under", label: `${mt > LN.tl ? "Over" : "Under"} ${LN.tl}`, warn: p && p.warn } : { team: t, label: `${t} ${sgn(ln)}`, warn: p && p.warn };
  }
  const P = g.final || (!g.started && cardOf(g, "spread") && cardOf(g, "total")) ? null : straightPicks(g).find((x) => (kind === "total" ? isTot(x.pick) : !isTot(x.pick) && !/\bML\b/.test(x.pick)));
  const CC = !g.final && !g.started ? cardOf(g, kind) : null;
  let body = "";
  const LP = (g.started || g.final) && g.lockedPicks ? g.lockedPicks[kind === "total" ? "total" : "spread"] : null;
  if (LP) {   // 10/13: after kickoff, the pick that was locked in at kickoff and how it did
    const cls = LP.hit >= 56 ? "g" : LP.hit >= 53 ? "lg" : "y", pc = cls === "g" ? Math.round(LP.hit) : Math.floor(LP.hit), rs = LP.result === "W" ? ' · <span class="g">W</span>' : LP.result === "L" ? ' · <span class="r">L</span>' : LP.result === "P" ? " · push" : liveBit(liveMark(g, { kind: "line", label: LP.pick }));   // 10/28 late: live grading
    const lp = LP.pts, lrs = lp ? (lp.result === "W" ? ' · <span class="g">W</span>' : lp.result === "L" ? ' · <span class="r">L</span>' : lp.result === "P" ? " · push" : liveBit(liveMark(g, { kind: "line", label: lp.pick }))) : "";
    body = `<div style="margin-top:6px"><b class="${cls}" style="font-size:16px"><span class="lbw">Pick:</span> ${esc(LP.pick)} · ${pc}%</b>${rs}</div>` + (lp ? `<div style="margin-top:4px"><b><span class="lbw">Pick w/ points:</span> ${esc(lp.pick)} · ${lp.hit >= 56 ? Math.round(lp.hit) : Math.floor(lp.hit)}%</b>${lrs}</div>` : "");
  }
  else if (!g.final && CC) body = cardBody(g, kind, CC);
  else if (!g.final) {
    if (!P) {   // nothing at 56%+: a yellow PICK from the best tested pick above 50%. 10/11: the game model's own side was dropped as a fallback --
      // tested on 2,531 games 2014-26 it won 50.6% against the spread and 51.7% on totals (a coin flip), so it is not shown as a lean.
      const L = straightPicks(g, 0).find((x) => (kind === "total" ? isTot(x.pick) : !isTot(x.pick) && !/\bML\b/.test(x.pick)) && !isSmall(x));
      const lp = L && L.p > 0.5 ? L : null;
      // 10/12 (owner: "I want a pick, not a lean"): every game gets a PICK. Below 56% it stays yellow and says its real tested rate.
      // 10/13 (owner): 53-55% shows light green, below 53% yellow; no notes under either
      // 10/14: color from the real rate and the % rounded DOWN below green (55.6% used to read "56%" in light green)
      body = lp ? `<div style="margin-top:6px"><b class="${lp.p >= 0.53 ? "lg" : "y"}" style="font-size:16px"><span class="lbw">Pick:</span> ${esc(lp.pick)} · ${Math.floor(lp.p * 100)}%</b></div>`
        : `<div style="margin-top:6px"><b class="dim">No pick</b></div><div class="s" style="margin-top:4px">No tested edge on this one.</div>`;
    }
    else {
      const pc = Math.round(P.p * 100);
      // 10/14 casino look (owner): the green pick is the same size as the card's other text and only GLOWS (no growing), glows brighter the stronger it is, and its % rolls in like a slot reel
      body = `<div style="margin-top:6px"><b class="g pulse" style="--gl:${glowOf(P.p)}"><span class="lbw">Pick:</span> ${esc(P.pick)} · <span class="reelpct" data-v="${pc}%">${pc}%</span></b></div>` +
        // 10/13 (owner: fewer notes): just the green pick's own reason (e.g. the LINE MOVE numbers)
        `<div class="s" style="margin-top:4px">${esc(P.why)}</div>` +
        moreBox(recLine(P.rec) + lineCheck(g, kind, P.pick));
    }
  }
  // 10/12 (owner: the number must be honest). Tested on 2,578 games 2014-26, each season predicted without it: margin off by 9.99
  // points vs the line's 9.89, total 10.52 vs 10.47; the model beat the line in only 3 of 13 seasons on each. So it is shown as an
  // opinion, never as a pick.
  // 10/23 night: the moneyline PICK (the favorite when STACK's spread side is the favorite), before kickoff from the card, after it the locked one with W / L
  const MLc = kind === "spread" ? (!g.started && !g.final ? g.card && g.card.ml && g.card.ml.plain : g.lockedPicks && g.lockedPicks.ml) : null;
  const mlLine = MLc ? `<div style="margin-top:4px"><b class="${clsOf(MLc.hit)}" style="font-size:13px;white-space:nowrap"><span class="lbw">ML pick:</span> ${esc(MLc.pick)} · ${hitTxt(MLc.hit, clsOf(MLc.hit))}</b>${MLc.result === "W" ? ' · <span class="g">W</span>' : MLc.result === "L" ? ' · <span class="r">L</span>' : MLc.result === "P" ? " · push" : g.started ? liveBit(liveMark(g, { kind: "line", label: MLc.pick })) : ""}</div>` : "";
  return wrap(`<div class="s">${mline}</div>${tline}${sline}` + body + mlLine + 
    (p && p.warn && !g.final ? `<div class="s y">${esc(p.warn)}</div>` : ""));   // e.g. QB change the model can't see
}
// 10/16 (owner): a finished card turns GREEN when the PICK locked at kickoff won, red when it lost ("won" / "lost" / "" when there was no pick)
function finClass(g, kind) { const LP = g.final && g.lockedPicks ? g.lockedPicks[kind] : null; return LP && LP.result === "W" ? "won" : LP && LP.result === "L" ? "lost" : ""; }
// 10/23 (owner: "Keep the stored pick"): the finished cover names the PICK locked at kickoff (and its PICK w/ POINTS), never the old game model's side
function cover(g, kind) {
  if (!g.final) return "";
  const LP = g.lockedPicks ? g.lockedPicks[kind] : null;
  const res = (r) => r === "W" ? '<span class="g">won</span>' : r === "L" ? '<span class="r">lost</span>' : r === "P" ? '<span class="dim">push</span>' : "";
  const line = (lb, x) => x && x.pick && x.result ? `<div>${lb} ${esc(x.pick)} ${res(x.result)}</div>` : "";
  return `<div class="cover ${finClass(g, kind)}"><b>GAME FINISHED</b><div style="font-size:12.5px;color:#c9c9cf">${g.away} ${g.awayScore ?? ""} – ${g.home} ${g.homeScore ?? ""}</div>` +
    (LP ? `<div style="font-size:12.5px;color:#c9c9cf">${line("Pick", LP)}${line("Pick w/ points", LP.pts)}</div>` : "") + `</div>`;
}
const order = (a, b) => (a.final - b.final) || (a.started - b.started) || (new Date(a.kickoff) - new Date(b.kickoff));

// ---------- Game Lines ----------
// "Most likely winners" (9/30): the favorite in every upcoming game, ranked by chance to WIN the game (straight up, not the spread).
// Chance = the app's market-based win chance (g.winPct = home chance); moneyline prices are the fallback. The server records
// each game's favorite at kickoff and grades it, so the record below is real, not a backtest.
// 10/21: the SAME win chance as the game's tile (mktHome: Polymarket's moneyline with the fee taken out, else the spread's) -- the list read the spread's
// chance while the tile read the moneyline, so one game showed two numbers (MIA @ NYJ 64% here, 68% on the tile)
function winnerOf(g) {
  const hm = mktHome(g); let ph = hm != null ? hm / 100 : null;
  if (ph == null || ph === 0.5) return null;
  const home = ph > 0.5, price = g.poly && g.poly.ml ? (home ? g.poly.ml.home : g.poly.ml.away) : null;
  return { game: g.key, team: home ? g.home : g.away, opp: home ? g.away : g.home, where: home ? "home" : "away", p: home ? ph : 1 - ph, price };
}
// 10/22 (owner: "MAKE IT LOOK LIKE A TABLE LIST ... words on one side and numbers on the other ... percentages in a vertical line"): a Models row = the
// name on the LEFT (+ a small line under it), its numbers in fixed columns on the right under a small header, like the Player props rows. Both sports.
const tHead = (h, cls = "") => `<div class="row trow th t${h.length} ${cls}"><span></span>${h.map((x) => `<span>${x}</span>`).join("")}</div>`;
const tRow = (lab, sub, cells, cls = "") => `<div class="row trow t${cells.length} ${cls}"><span>${lab}${sub ? `<i class="tsub">${sub}</i>` : ""}</span>${cells.map((c) => `<span>${c}</span>`).join("")}</div>`;
function winnersBox() {
  const list = S.games.filter((g) => !g.started).map(winnerOf).filter(Boolean).sort((a, b) => b.p - a.p);
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Favorite in every game</div>` + (list.length ? tHead(["WIN", "PRICE"]) : "") +
    (list.slice(0, WINALL ? 99 : 8).map((x, i) => { const g = S.games.find((y) => y.key === x.game), cp = g && !g.started ? straightPicks(g, 0) : [], sp0 = cp.find((c) => !/^(Over|Under)\b/.test(c.pick) && !/\bML\b/.test(c.pick)), tt0 = cp.find((c) => /^(Over|Under)\b/.test(c.pick)),
        sp = sp0 ? { label: sp0.pick, gap: 99 } : null, tt = tt0 ? { label: tt0.pick, gap: 99 } : null;   // review fix 10/14: the CARD's pick (CLAUDE.md: never show the game model's own side as a pick)
      const tdp = g ? (g.td || []).filter((r) => r.fair != null && !/^(out|doubtful)$/i.test(r.injury || "")).sort((a, b) => b.fair - a.fair)[0] : null;   // the game's most likely scorer
      return tRow(`${i + 1}. <b>${esc(x.team)}</b> over ${esc(x.opp)}`, `Spread <b>${sp ? esc(sp.label) : "—"}</b> · Total <b>${tt ? esc(tt.label) : "—"}</b> · TD <b>${tdp ? `${esc(tdp.player)} ${Math.round(tdp.fair)}%` : "—"}</b>`,
        [`${Math.round(x.p * 100)}%`, x.price ? `${Math.round(x.price * 100)}¢` : "—"]); }).join("") || '<div class="s">No lines yet.</div>') +
    (list.length > 8 ? `<div class="center" style="margin-top:6px"><button class="btn" id="win-all">${WINALL ? "Show top 8 only" : `Show all ${list.length} games`}</button></div>` : "") + `</div></div>`;
}
// "What changed" (9/30): Polymarket line moves since your last visit on this device.
let LAST_SEEN = null;
try { LAST_SEEN = localStorage.getItem("lastSeen"); } catch {}
// 10/18 night (owner): the LINE MOVES strip is gone -- a game's own moves since your last visit sit inside its tile (one line each)
function moveBits(g) {
  if (!LAST_SEEN || g.started) return [];
  const since = new Date(LAST_SEEN), before = [...(g.history || [])].filter((h) => h.poly && new Date(h.t) <= since).pop(), now = g.poly;
  if (!before || !now) return [];
  const a = before.poly, bits = [];
  if (a.spread && now.spread && a.spread.homeSpread !== now.spread.homeSpread) bits.push(`spread ${g.home} ${sgn(a.spread.homeSpread)} → ${sgn(now.spread.homeSpread)}`);
  if (a.total && now.total && a.total.line !== now.total.line) bits.push(`total ${a.total.line} → ${now.total.line}`);
  if (a.ml && now.ml && Math.abs(a.ml.home - now.ml.home) >= 0.05) bits.push(`${g.home} moneyline ${Math.round(a.ml.home * 100)}¢ → ${Math.round(now.ml.home * 100)}¢`);
  return bits;
}
const moveLines = (bits) => (bits.length ? `<div class="mvt">${bits.map((b) => `<span>${esc(b)}</span>`).join("")}</div>` : "");
// 10/28 (owner's sketch, "make it consistent"): SPORTSBOOK | POLYMARKET side by side with the SAME rows -- SPREAD (one team per line) then
// MONEYLINE on the spread card, OVER / UNDER on the totals card -- each sportsbook row on the same line as its Polymarket row (grid cells in
// pairs); no MARKET word (a blurred band in its place), no fair line
const mrow = (k, v, c) => `<div class="prl"><span class="s">${k}</span><span class="${c}">${v}</span></div>`;
const mkGrid = (cells) => `<div class="mk mk3">${cells.map((c) => `<div>${c}</div>`).join("")}</div>`;
function gameCard(g, i) {
  {
    const lv = liveFor(g), p = (lv && lv.poly) || g.poly || {}, b = g.books || {};   // live numbers for a game in progress; model and kickoff line stay locked
    const sp = (hs, ho, ao) => mrow("Spread", `${g.home} ${sgn(hs)} ${ho}`, "mkt") + mrow("", `${g.away} ${sgn(-hs)} ${ao}`, "mkt");
    const ml = (ho, ao) => mrow("Moneyline", `${g.home} ${ho}`, "mlc") + mrow("", `${g.away} ${ao}`, "mlc");
    const bSp = b.spread ? sp(b.spread.homeSpread, odds(b.spread.home.odds), odds(b.spread.away.odds)) : mrow("Spread", "—", "mkt");
    const bMl = b.ml && b.ml.home && b.ml.away ? ml(odds(b.ml.home.odds), odds(b.ml.away.odds)) : mrow("Moneyline", "—", "mlc");
    const pSp = p.spread ? sp(p.spread.homeSpread, odds(toAmerican(p.spread.home)), odds(toAmerican(p.spread.away))) : mrow("Spread", "—", "mkt");
    const pMl = p.ml ? ml(odds(toAmerican(p.ml.home)), odds(toAmerican(p.ml.away))) : mrow("Moneyline", "—", "mlc");
    return secRow("SPREAD &amp; ML", headPills(g, "l" + i)) + `<div class="card${g.final ? " fin " + finClass(g, "spread") : ""}" style="margin-top:10px"><div class="inner">${headDrops(g, "l" + i)}<div class="bband"></div>` +
      mkGrid([`<div class="k">SPORTSBOOK</div>`, pmHead(g, lv), bSp, pSp, bMl, pMl]) + liveHead(g, lv) + liveTail(g, lv) +
      `<div class="hd hm ihd">MODEL${IBTN}</div>${whyBox(g, "spread", MODEL_INFO.spread)}` + leanCell(g, "spread") +
      `</div>${cover(g, "spread")}</div>`;
  }
}
// ---------- Totals ----------
function totalCard(g, i) {
  {
    const lv = liveFor(g), p = (lv && lv.poly) || g.poly || {}, b = g.books || {};
    const ou = (ln, o, u) => mrow(`Over ${ln}`, o, "mkt") + mrow(`Under ${ln}`, u, "mkt");
    const bT = b.total ? ou(b.total.line, odds(b.total.over.odds), odds(b.total.under.odds)) : mrow("Total", "—", "mkt");
    const pT = p.total ? ou(p.total.line, odds(toAmerican(p.total.over)), odds(toAmerican(p.total.under))) : mrow("Total", "—", "mkt");
    return secRow("TOTALS", headPills(g, "t" + i, true)) + `<div class="card${g.final ? " fin " + finClass(g, "total") : ""}" style="margin-top:10px"><div class="inner">${headDrops(g, "t" + i, true)}<div class="bband"></div>` +
      mkGrid([`<div class="k">SPORTSBOOK</div>`, pmHead(g, lv, "total"), bT, pT]) + liveHead(g, lv, "total") + liveTail(g, lv, "total") +
      `<div class="hd hm ihd">MODEL${IBTN}</div>${whyBox(g, "total", MODEL_INFO.total)}` + leanCell(g, "total") +
      `</div>${cover(g, "total")}</div>`;
  }
}
// ---------- Anytime TD ----------
const GAME_STATUS = /out|doubtful|questionable/i;
// team logo, transparent PNG, keyed off the same team code the row already carries. WAS/KC have no
// clean current mark on the ESPN CDN, so those two come from a community alt-logo set instead.
const LOGO_OVERRIDES = { WAS: "https://raw.githubusercontent.com/ajreinhard/data-viz/master/alt-logo/WAS.png", KC: "/kc.png?v=1" };   // KC = the owner's logo (10/17)
const logoUrl = (team) => (team ? LOGO_OVERRIDES[team] || `https://a.espncdn.com/i/teamlogos/nfl/500/${team}.png` : "");
// Team logo next to team names on every card (game header + TD team headers). Same logo source as the TD rows.
function tlogo(team) { return team ? `<img class="tlogo" src="${logoUrl(team)}" alt="" onerror="this.style.display='none'">` : ""; }
// 10/28 (owner: "instead of the team logos put the helmets"; 10/28 later: moved after the name, then back on the owner's word): the Home tiles carry each team's helmet on the outer side of its name, facing the middle (away faces right, home left; public/helmets/sm = the matchup helmets cropped, 96 px tall)
function thelmet(team, dir) { return team ? `<img class="thlm" src="/helmets/sm/${dir}/${team}.webp" alt="" onerror="this.onerror=null;this.src='${logoUrl(team)}'">` : ""; }
const retPill = (r) => (r.returning ? (r.returningState === "practicing" ? ' <span class="pill p-g" style="padding:0 6px;font-size:10px">↩ RETURNING</span>' : ' <span class="pill p-y" style="padding:0 6px;font-size:10px">↩ WAS OUT · NOT PRACTICING</span>') : "");
function tdNoGap(r) {
  if (!r || r.fair == null || !(r.bid > 0) || !(r.price > 0) || r.stale || r.thin || r.price - r.bid > Math.min(0.05, 0.4 * r.price)) return null;
  const gap = r.bid * 100 - r.fair; return gap >= 5 ? Math.round(gap) : null;
}
const usable = (r) => !(r.odds != null && r.odds <= -600 && !r.thin);   // a real -600 price is broken data; never hide a player over a thin placeholder
// Injury tag next to the name (10/9): official report first, ESPN's status before Friday. Q yellow, D orange, OUT red.
function injTag(r) {
  const st = r.injury && GAME_STATUS.test(r.injury) ? r.injury : (String(r.espn || "").match(/^(Out|Doubtful|Questionable)/i) || [])[1];
  if (!st) return "";
  const k = /^out/i.test(st) ? ["OUT", "var(--red)"] : /^doubt/i.test(st) ? ["D", "#ff9f43"] : ["Q", "var(--yellow)"];
  return ` <span class="pill" style="padding:0 6px;font-size:10px;font-weight:800;color:${k[1]};border:1px solid ${k[1]}">${k[0]}</span>`;
}
// 10/17 (owner): practice status as a short tag (DNP / LP / FP), never the long sentence that wrapped onto a second line
function practTag(r) {
  const t = String(r.injury || ""), k = /did not|dnp|not participate/i.test(t) ? "DNP" : /limited/i.test(t) ? "LP" : /full/i.test(t) ? "FP" : "";
  return k ? ` <span class="pill" style="padding:0 6px;font-size:10px;font-weight:800;color:var(--faint);border:1px solid var(--line2)">${k}</span>` : "";
}
// 10/20 night (owner's sketch): ONE line per player, nothing to open -- [logo] name pos / game · #N on team | SNAP | 2+ TD | MODEL (purple) | PM (far right)
function tdRow(x, withGame) {
  const r = x.r, snap = r.snap && r.snap.pct != null ? `${Math.round(r.snap.pct)}%` : "—", two = r.two != null ? `${Math.round(r.two)}%` : "—", warn = tdWarn(r, TDW);
  // 10/21 night (owner: "Make it like the first td layout"): the First TD page's row -- bullet, small logo, name (+ position / injury tags), MODEL % (purple) and the Polymarket cents
  // on the right; a tap opens SNAP · 2+ TD, then the week marks on their own line. 10/22 (owner: "remove the word Anytime TD ... replace it with the no touchdown"): the middle holds only
  // the red caution (Best TD picks add their game before it) -- centered in its own column on a computer, under the name on a phone.
  return `<div class="pbl ppr first tdr" data-tdw="${esc(r.team)}|${esc(r.player)}"><span class="pp1">• ${withGame ? tlogo(r.team) : ""}${esc(r.player)}<span class="pos">${esc(r.pos || "")}</span>${injTag(r) || practTag(r)}${retPill(r)}</span>` +
    `<span class="pp2">${withGame && r.game ? `<span class="pp2t">${esc(r.game)}</span>` : ""}${warn ? `<span class="wc r">${warn}</span>` : ""}</span><span class="pp3 mod">${tdPct(r.fair)}%</span><span class="pp4">${r.price != null ? Math.round(r.price * 100) + "¢" : "—"}${tdNoGap(r) != null ? ` <span class="y nogap" title="No · ${tdNoGap(r)} under">⚠</span>` : ""}</span>` +
    `<div class="tdwk"><div class="st"><b>SNAP</b> ${snap} <span class="dim">·</span> <b>2+ TD</b> ${two}</div><div class="wk"></div></div></div>`;
}
const tdHead = () => `<div class="pbl ppr pph first tdh"><span class="pp1">PLAYER</span><span class="pp3">MODEL</span><span class="pp4">${pmLogo()}POLYMARKET</span></div>`;
const earlyNote = (g) => (g && g.early ? '<span class="pill p-y" style="padding:0 6px;font-size:10px">Early estimate</span>' : "");
// One Anytime TD section for the slate in S: price moves, then the top 3 per team, most likely first.
const BEST_TD = 55;
// 10/14 audit: a player at 54.6% is NOT a "55%+" Best TD pick, so he must not be shown as 55% either (below the line the % rounds down, like the card picks)
const tdPct = (v) => (v < BEST_TD && Math.round(v) >= BEST_TD ? BEST_TD - 1 : Math.round(v));
// every game not started: the team split (away % / home %) and each team's three likeliest first scorers (the model's first-TD chance, Polymarket's price)
function firstTdGames() {
  return (S && S.games ? S.games : []).filter((g) => !g.started).map((g) => {
    const rows = (g.td || []).filter((r) => r.first != null && usable(r) && !/^(out|doubtful)$/i.test(r.injury || "")).sort((a, b) => b.first - a.first);
    const picks = [g.away, g.home].flatMap((t) => rows.filter((r) => r.team === t).slice(0, 3));
    // 10/21 night (owner: "take out the second row names and %. Like what is even that percentage for?"): no team-split row on the First TD blocks; the team chances stay recorded and graded (Models -> Touchdowns)
    const head = "";
    return { game: g.key, kickoff: g.kickoff, away: g.away, home: g.home, head, rows: picks, picks: picks.map((r) => ({ name: r.player, team: r.team, pos: r.pos, chance: r.first / 100, price: r.firstPrice ?? null, first: true })) };
  }).filter((x) => x.rows.length);
}
// TD BY WEEK (10/20 night, owner: "click on it and it will show me each week that the last time they made a TD"): one line per player under his row,
// week by week this season -- ✓ (with the count when 2+), – for a game without one, bye when his team did not play; the running week only once its game is final.
let TDW = null, TDW_AT = 0, TDW_LOADING = null;
// 10/21: the first-name parts must start alike ("Bi" / "Bijan", "J" / "Jahmyr"), not just share a letter -- "Bi.Robinson" matched "Br.Robinson" (both ATL)
// and took his touchdowns; suffixes (Jr., III) are dropped from the last name
const tdNameEq = (a, b) => { const n = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""); if (n(a) === n(b)) return true;
  const sp = (x) => String(x || "").replace(/\b(Jr|Sr|II|III|IV|V)\b\.?/g, "").split(/[\s.]+/).filter(Boolean), la = sp(a), lb = sp(b);
  if (la.length < 2 || lb.length < 2 || la[la.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "") !== lb[lb.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "")) return false;
  const fa = la[0].toLowerCase().replace(/[^a-z]/g, ""), fb = lb[0].toLowerCase().replace(/[^a-z]/g, ""); return !!fa && !!fb && (fa.startsWith(fb) || fb.startsWith(fa)); };
// the weeks he was on the field (the feed's snap counts), or null when the feed has no row for him (then the team's games count)
function tdPlayedWeeks(data, team, player) { const t = data && data.played && data.played[team]; if (!t) return null;
  const hits = Object.keys(t).filter((nm) => tdNameEq(player, nm)); return hits.length === 1 ? new Set(t[hits[0]]) : null; }
// One entry per PLAYED week: { w, n } (n = his TDs that week), "bye" for a final week his team did not play; a week not played yet is left out
// (the running week counts a game only once its scorers are posted -- 10/20 night fix: week 7 read "bye" on everyone before it was played).
function tdWeekGames(data, team, player) {
  if (!data || !data.weeks) return null;
  const pw = tdPlayedWeeks(data, team, player), teamSnapWks = new Set(Object.values((data.played || {})[team] || {}).flat());
  const out = [], ws = Object.keys(data.weeks).map(Number).sort((a, b) => a - b);
  for (const w of ws) { const d = data.weeks[w], key = (d.games || []).find((k) => k.split(" @ ").includes(team));
    if (!key) { if (d.final) out.push({ w, bye: true }); continue; }
    if (!d.final && !Object.keys((d.counts || {})[key] || {}).length) continue;
    const c = (d.counts || {})[key] || {}, n = Object.entries(c).filter(([nm]) => tdNameEq(player, nm)).reduce((a, [, v]) => a + Number(v || 0), 0);
    // a week his team played with snap counts posted but no snaps for him = he sat out ("out"): skipped like a bye (a TD that week still counts)
    if (!n && pw && teamSnapWks.has(w) && !pw.has(w)) { out.push({ w, out: true }); continue; }
    out.push({ w, n }); }
  return out;
}
// Played games in a row without a TD, counted back from his last played game (byes skipped); null before the feed arrives
function tdDrought(data, team, player) { const gs = tdWeekGames(data, team, player); if (!gs) return null; let k = 0; for (const g of gs.filter((x) => !x.bye && !x.out)) k = g.n > 0 ? 0 : k + 1; return k; }
function tdWeekLine(data, team, player) {
  const gs = tdWeekGames(data, team, player); if (!gs) return '<span class="dim">loading…</span>';
  const parts = gs.map((g) => g.bye ? `<span class="dim">W${g.w} bye</span>` : g.out ? `<span class="dim">W${g.w} out</span>` : g.n > 0 ? `<b class="g">W${g.w} ✓${g.n > 1 ? g.n : ""}</b>` : `<span class="r">W${g.w} –</span>`), drought = tdDrought(data, team, player);
  if (!parts.length) return '<span class="dim">no games yet</span>';
  return parts.join(' <span class="dim">·</span> ') + (drought >= 2 ? ` <span class="dim">· no TD last ${drought} games</span>` : "");
}
// 10/27 (owner, on PHI @ WAS / CHI @ SEA showing 3 a team: "show me top 4 of each team and make note of how many td weeks they missed" / "like no TD last 2 games
// or 3 4 5 6 7 games"; SUPERSEDES the 10/21 "scored in his last 2 or off" cut): the page lists the TD_POOL (5 since the owner's later 10/27 ask) likeliest scorers per team, nobody is cut for a
// drought; a player who did not score last game carries the red note with the count -- "✗ no TD last game", "✗ no TD last 2 games", "... last 5 games" (a player
// with no TD this season counts every game he played). The page is still drawn only once the week feed is in. Model lists, parlays and grading unchanged.
const TD_WARN = 1, TD_POOL = 5;   // 10/27 later (owner: "for anytime td's show me the top 5 players on each team")
// the note text for a row, or null (scored last game, no feed yet, or no played games)
function tdWarn(r, data) { if (data == null || !r) return null; const d = tdDrought(data, r.team, r.player); return d == null || d < TD_WARN ? null : d === 1 ? "✗ no TD last game" : `✗ no TD last ${d} games`; }
async function loadTdWeeks() {
  if (TDW && Date.now() - TDW_AT < 600000) return TDW;
  if (!TDW_LOADING) TDW_LOADING = fetch("/api/tdweeks", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j && j.ok) { TDW = j; TDW_AT = Date.now(); } return TDW; }).catch(() => TDW).finally(() => { TDW_LOADING = null; });
  return TDW_LOADING;
}
function fillTdWeeks(row) { const box = row.querySelector(".tdwk .wk"); if (!box) return; const [team, player] = String(row.dataset.tdw || "").split("|");
  box.innerHTML = tdWeekLine(TDW, team, player); if (!TDW) loadTdWeeks().then(() => { if (row.classList.contains("open")) box.innerHTML = tdWeekLine(TDW, team, player); }); }
let TD_OPEN = null;
const tdOpenMap = () => { if (TD_OPEN) return TD_OPEN; try { TD_OPEN = JSON.parse(localStorage.getItem("tdSlots") || "{}") || {}; } catch (e) { TD_OPEN = {}; } return TD_OPEN; };
const tdSlotOpen = (sl) => { const m = tdOpenMap(); return sl in m ? !!m[sl] : /PRIME TIME/.test(sl); };
function tdToggleSlot(el) { const sl = el.dataset.slot, m = tdOpenMap(), open = !tdSlotOpen(sl); m[sl] = open; try { localStorage.setItem("tdSlots", JSON.stringify(m)); } catch (e) {}
  el.classList.toggle("open", open); const card = el.nextElementSibling; if (card) card.classList.toggle("closed", !open); }
function tdBody() {
  const rows = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).map((r) => ({ r, g })))
    .filter((x) => x.r.fair != null && usable(x.r)).sort((a, b) => b.r.fair - a.r.fair);
  if (!rows.length) return `<div class="card" style="margin-top:10px"><div class="s">${S.games.length && S.games.every((g) => g.started) ? "No games left this week." : "No players yet."}</div></div>`;
  const moves = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).filter((r) => r.move).map((r) => r)).sort((a, b) => Math.abs(b.move) - Math.abs(a.move)).slice(0, 10);
  const moveBox = moves.length ? `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Price moves (5¢+, real markets)</div>${moves.map((r) => `<div class="row"><span>${esc(r.player)} <span class="dim">${esc(r.game)}</span></span><span class="${r.move > 0 ? "g" : "r"}">${r.move > 0 ? "▲ +" : "▼ "}${r.move}¢</span></div>`).join("")}</div></div>` : "";
  // Best TD picks (10/14, owner: "build now"): only the players the model gives 55%+ (shown chance, after injury discounts). Graded weeks 3-5:
  // 55%+ players scored 17 of 21 (said 65%) vs 22% for every listed player -- the model's most confident tier, not a smarter model.
  // 10/27 (owner): the 4 likeliest scorers per team (Best TD picks count toward the 4), no drought cut; the red note carries the count
  const perTeam = {}, pool = rows.filter((x) => { const k = x.r.team, n = perTeam[k] || 0; if (n >= TD_POOL) return false; perTeam[k] = n + 1; return true; });
  const best = pool.filter((x) => x.r.fair >= BEST_TD);
  // 10/21 night (owner: sketch claude.ai/artifact/DHrUxtRDfn7qY2PnxGgXge, "Make it like the first td layout. With anytime td labels"): Best TD picks = one block in the props-page row
  // look (the game on each row's sub-line); then, under each time-slot header (with its kickoff times), ONE card per game -- [logo] NE @ [logo] CHI, the PLAYER · MODEL · POLYMARKET heads,
  // the away team's rows under its label, then the home team's; rows inside a team in model order, games in kickoff order. Slot lists still open / close on their header.
  const bestBox = `<div class="sh labslot">BEST TD PICKS · MODEL ${BEST_TD}%+</div><div class="pgrid tdl"><div class="par">${tdHead()}${best.length ? best.map((x) => tdRow(x, true)).join("") : '<div class="s dim">None right now.</div>'}</div></div>`;
  // Players already in Best TD picks are left out of the list below (no repeats, owner 10/14).
  const shown = pool.filter((x) => x.r.fair < BEST_TD);
  const gs = S.games.filter((g) => !g.started).sort(order), slots = [], by = {}, times = {};
  for (const g of gs) { const sl = (g.carry ? `WEEK ${g.week} · ` : "") + (g.kickoff ? labSlot(g.kickoff) : "GAMES"); if (!by[sl]) { by[sl] = []; slots.push(sl); times[sl] = []; } by[sl].push(g);
    if (g.kickoff) { const tt = tm(g.kickoff); times[sl].includes(tt) || times[sl].push(tt); } }
  const gameCard = (g) => { const xs = shown.filter((x) => x.g.key === g.key); if (!xs.length) return "";
    const teamPart = (t) => { const rs = xs.filter((x) => x.r.team === t); return rs.length ? `<div class="pbl pteam">${tlogo(t)}${esc(t)}</div>${rs.map((x) => tdRow(x)).join("")}` : ""; };
    return `<div class="par"><div class="pbh c"><span class="pbn">${gameLogos(g.key)}</span></div>${tdHead()}${teamPart(g.away)}${teamPart(g.home)}</div>`; };
  const list = slots.map((sl) => { const cards = by[sl].map(gameCard).join(""); if (!cards) return ""; const open = tdSlotOpen(sl);
    return `<div class="sh labslot tdtog${open ? " open" : ""}" data-slot="${esc(sl)}">${sl}${times[sl].length ? ` <span class="lst">· ${times[sl].map(esc).join(" · ")}</span>` : ""}<i class="car">▾</i></div><div class="pgrid tdl${open ? "" : " closed"}">${cards}</div>`; }).join("");
  return bestBox + moveBox + list;
}
function renderTd() {
  $("td-header").textContent = "";   // 10/17 (owner): no subtitle
  // the cut needs the week feed: before it lands the page says loading and is redrawn when it arrives (10/20 night: an uncut list was drawn first
  // and stayed when the page was opened later); a failed load is retried on the next draw
  if (!TDW) { $("td").innerHTML = '<div class="card" style="margin-top:10px"><div class="s dim">Loading…</div></div>'; loadTdWeeks().then((d) => { if (d) renderTd(); }); return; }
  loadTdWeeks();
  // 10/21 night (owner's sketch): a record tile on top like the First TD page -- the Best TD picks (55%+ at kickoff) graded this season
  const picks = (RES || []).flatMap((r) => (r.td || []).filter((p) => p.fair >= BEST_TD && p.played !== false && typeof p.scored === "boolean")), hit = picks.filter((p) => p.scored).length;
  const rc = !RES && !renderTd.tried ? undefined : picks.length ? { w: hit, l: picks.length - hit, pct: Math.round((hit / picks.length) * 1000) / 10 } : null;
  $("td").innerHTML = recTile(rc, "BEST TD PICKS RECORD") + tdBody();
  if (!RES && !renderTd.tried) { renderTd.tried = true; loadRecord().catch(() => {}).finally(() => { if (RES && S && S.games) renderTd(); }); }   // one load for the tile; a failed load leaves 0–0
}
// ---------- Record: Mine ----------
const RESMARK = { W: '<span class="g">✓</span>', L: '<span class="r">✗</span>', P: '<span class="dim">=</span>', pending: '<span class="dim">•</span>' };
// 10/17 (owner): a won leg's text is green and a lost leg's red, like its ✓ / ✗ (logos keep their colors)
const legTxt = (r, html) => (r === "W" ? `<span class="g">${html}</span>` : r === "L" ? `<span class="r">${html}</span>` : html);
function legName(l) { return l.kind === "td" ? `${tlogo(l.team || tdTeam(l.player))}${esc(`${l.player} TD`)}` : l.kind === "spread" ? `${tlogo(l.team)}${esc(`${l.team} ${sgn(l.line)}`)}` : esc(`${l.side === "over" ? "Over" : "Under"} ${l.line}`); }
// Weakest leg of an open combo (10/9): the leg where the model is furthest below the price paid, if it is below at all.
function weakLeg(b) {
  if (b.result !== "pending" || !b.legs || b.legs.length < 2) return null;
  const xs = b.legs.filter((l) => l.result === "pending" && l.modelP != null && l.price > 0).map((l) => ({ l, gap: l.modelP - l.price })).sort((a, c) => a.gap - c.gap);
  return xs.length && xs[0].gap < -0.03 ? xs[0].l : null;
}
// Pick flipped (10/10): an open bet leg (spread or total) where the app now has a PICK (56%+) on the other side --
// lines and weather move during the week (CHI @ GB: Over at the open, Under after the total rose and the wind came in).
function legFlipped(label) {
  const games = ((S && S.games) || []).filter((g) => !g.started && !g.final);
  const tot = String(label).match(/^(Over|Under)\s+[\d.]+\s+·\s+(.+)$/), sp = String(label).match(/^([A-Z]{2,3})\s+[+-][\d.]+$/);
  if (tot) { const g = games.find((x) => x.key === tot[2]); if (!g) return false;
    const t = straightPicks(g).find((x) => /^(Over|Under)\b/.test(x.pick)); return !!t && !t.pick.startsWith(tot[1]); }
  if (sp) { const g = games.find((x) => x.away === sp[1] || x.home === sp[1]); if (!g) return false;
    const t = straightPicks(g).find((x) => !/^(Over|Under)\b/.test(x.pick) && !/\bML\b/.test(x.pick)); return !!t && !t.pick.startsWith(sp[1] + " "); }
  return false;
}
// ---------- casino look (10/14, owner) ----------
const glowOf = (p) => (p >= 0.61 ? 1 : p >= 0.58 ? 0.75 : 0.45);   // stronger pick -> brighter glow
const REDUCE = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
// 10/18 night (owner: "Only put the slot roll if there's a $. The rest no"): the slot-reel roll (10/14 casino look) runs ONLY on dollar amounts
// ($33, +$101, -$1 per $100) when a page or game opens; every other number just appears.
function rollMoney(root) {
  if (!root || !root.querySelectorAll || REDUCE) return;
  root.querySelectorAll(".reelpct.money[data-v]").forEach((el) => {
    const v = el.dataset.v; el.innerHTML = "";
    [...v].forEach((ch, i) => { const d = document.createElement("span"); d.className = "rd";
      if (!/\d/.test(ch)) { d.innerHTML = `<span><b>${ch}</b></span>`; el.appendChild(d); return; }
      const seq = []; for (let k = 0; k < 16 + i * 6; k++) seq.push(k % 10); seq.push(+ch);
      d.innerHTML = `<span>${seq.map((x) => `<b>${x}</b>`).join("")}</span>`; el.appendChild(d);
      const inner = d.firstChild; requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transform = `translateY(-${(seq.length - 1) * 1.25}em)`; })); });
    setTimeout(() => { if (el.parentNode && el.replaceWith) el.replaceWith(document.createTextNode(v)); else el.textContent = v; }, 1700);   // back to plain text once it lands
  });
}
const SLOT_SKIP = ".reelpct,script,style,input,textarea,select,svg";
function slotMoney(root, max = 120) {
  if (REDUCE || !root || typeof document === "undefined" || !document.createTreeWalker) return;
  const walk = document.createTreeWalker(root, 4), nodes = [];
  while (walk.nextNode()) { const n = walk.currentNode; if (/\$\d/.test(n.nodeValue) && n.parentElement && !n.parentElement.closest(SLOT_SKIP)) nodes.push(n); }
  let used = 0;
  for (const n of nodes) {
    if (used >= max) break;
    const parts = n.nodeValue.split(/(\$\d[\d,]*(?:\.\d+)?)/); if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    parts.forEach((t, i) => { if (i % 2 && used < max) { const sp = document.createElement("span"); sp.className = "reelpct money"; sp.dataset.v = t; sp.textContent = t; frag.appendChild(sp); used++; } else frag.appendChild(document.createTextNode(t)); });
    n.parentNode.replaceChild(frag, n);
  }
  rollMoney(root);
}
// 10/27 (owner): the HIT / MISS stamp and its coins are gone from the bet rows
// 10/15 (owner): team logos next to team names in the Bets tab -- spread legs ("DEN +3.5"), totals ("Under 40.5 · SEA @ DEN") and touchdown legs
// (the player's team, found from this week's touchdown lists; no logo when it can't be told).
const normNm = (x) => String(x || "").toLowerCase().replace(/[^a-z\- ]/g, " ").replace(/\s+/g, " ").trim();
function tdTeam(name) {
  const t = normNm(name).split(" "), ini = (t[0] || "")[0], last = t.slice(1).join(" "), hits = new Set();
  for (const g of (S && S.games) || []) for (const r of g.td || []) { const m = String(r.player || "").match(/^([A-Za-z])[A-Za-z]*\.\s*(.+)$/), full = normNm(r.player);
    if ((m && m[1].toLowerCase() === ini && normNm(m[2]) === last) || full === normNm(name)) hits.add(r.team); }
  return hits.size === 1 ? [...hits][0] : null;
}
function logoLabel(label, team = null) {
  const L = String(label || "");
  let m = L.match(/^([A-Z]{2,4}) ([+-]\d[\d.]*)(.*)$/); if (m) return `${tlogo(m[1])}${esc(m[1])} ${esc(m[2])}${esc(m[3])}`;
  m = L.match(/^([A-Z]{2,4}) ML$/); if (m) return `${tlogo(m[1])}${esc(L)}`;
  m = L.match(/^(.*?)(\b[A-Z]{2,4}\b) @ ([A-Z]{2,4})\b(.*)$/); if (m) return `${esc(m[1])}${tlogo(m[2])}${esc(m[2])} @ ${tlogo(m[3])}${esc(m[3])}${esc(m[4])}`;
  m = L.match(/^(.+?) \d\+ TD(.*)$/); if (m) { const tm0 = team || tdTeam(m[1]); return `${tlogo(tm0)}${esc(L)}`; }
  return esc(L);
}
// 10/18 (owner: "just put live and the quarter time"): an open bet whose game is being played says ● LIVE · Q3 8:42 (no scores).
// It sits where "wk 6" was (owner 10/18); one live game -> the clock is there; two or more -> ● LIVE there and each undecided leg of a live game carries its own clock.
const liveSc = (k) => { const sc = k && LIVE_SC[k]; return sc && sc.st === "in" ? sc : null; };
function liveOf(legs) { const ks = [...new Set(legs.map((l) => l.game).filter((k) => liveSc(k)))]; return ks; }
const liveHeadTxt = (ks) => (ks.length === 1 ? `<span class="r lvb">● LIVE · ${esc(liveSc(ks[0]).lbl || "")}</span>` : '<span class="r lvb">● LIVE</span>');
const liveLegTxt = (ks, l, done) => (ks.length > 1 && !done && liveSc(l.game) ? ` <span class="r lvb">· ${esc(liveSc(l.game).lbl || "")}</span>` : "");
function betRow(b) { return `<div class="betwrap">${betRowInner(b)}</div>`; }
function betRowInner(b) {
  if (b.source === "account") {   // bet recorded automatically from your Polymarket account
    const lk = !b.sold && (!b.result || b.result === "pending") ? liveOf(b.picks || (b.prop ? [b.prop] : [])) : [];
    const st = b.sold ? `<span class="${b.pl >= 0 ? "g" : "r"}">Sold</span>` : legLost(b) ? '<span class="r">Lost</span>' : b.result === "W" ? '<span class="g">Won</span>' : b.result === "L" ? '<span class="r">Lost</span>' : b.result === "P" ? "Even" : b.result === "settled" ? '<span class="y">settled — P/L not reported</span>' : (b.waiting ? '<span class="y">waiting for TD results</span>' : '<span class="dim">open</span>');
    const name = b.picks && b.picks.length ? `${b.picks.length} picks` : b.prop ? `${tlogo(b.prop.team)}${esc(b.prop.label)}` : `${esc(b.title)}${b.outcome ? ` — ${esc(b.outcome)}` : ""}`;   // 10/19: single player bet
    const picks = b.picks && b.picks.length ? b.picks.map((p) => `<div class="s" style="padding:0 0 0 16px">${p.result ? RESMARK[p.result] + " " : "• "}${legTxt(p.result, logoLabel(p.label, p.team))}${liveLegTxt(lk, p, !!p.result)}${!p.result && legFlipped(p.label) ? ' <span class="y">⚠ app now picks the other side</span>' : ""}</div>`).join("") : "";
    return `<div class="row"><span>${name}${lk.length ? " " + liveHeadTxt(lk) : ""}</span><span>${st}${b.pl != null ? ` ${cMoney(b.pl)}` : ""}</span></div>` +
      `<div class="s" style="padding:0 0 ${picks ? 2 : 6}px 8px">${money(b.cost)}${b.price != null ? ` at ${betCents(b.price)}¢` : ""} · ${b.sold ? `sold early for ${money(Math.max(0, (b.cost || 0) + (b.pl || 0)))}` : legLost(b) ? `−${money(b.cost)}` : `pays ${money(b.toWin)} if it wins`}</div>` + (picks ? `<div style="padding-bottom:6px">${picks}</div>` : "");
  }
  const hit = b.legs.filter((l) => l.result === "W").length, lk = !b.sold && b.result === "pending" ? liveOf(b.legs) : [];
  const state = b.sold ? `<span class="${b.pl >= 0 ? "g" : "r"}">Sold</span>` : b.result === "W" ? '<span class="g">Won</span>' : b.result === "L" ? '<span class="r">Lost</span>' : b.result === "P" ? (b.pushUnconfirmed ? '<span class="y">Push leg</span>' : "Push") : (b.waiting ? '<span class="y">waiting for TD results</span>' : b.result === "settled" ? '<span class="y">settled — P/L not reported</span>' : `<span class="dim">${hit} of ${b.legs.length} hit</span>`);
  return `<div class="row"><span>${b.legs.length > 1 ? `${b.legs.length} picks` : "Single"} · ${money(b.cost)} → ${money(b.toWin)}${lk.length ? " " + liveHeadTxt(lk) : ""}</span><span>${state}${b.pl != null ? ` ${cMoney(b.pl)}` : ""}</span></div>` +
    `<div class="s" style="padding:0 0 6px 8px">${b.legs.map((l) => `${RESMARK[l.result]} ${weakLeg(b) === l ? '<b class="y">⚠</b> ' : ""}${legTxt(l.result, legName(l))}${liveLegTxt(lk, l, l.result !== "pending")}${l.clv != null ? ` <span class="${signCls(l.clv)}">(${(l.clv * 100).toFixed(0)}%)</span>` : ""}`).join(" · ")}</div>`;
}
// Re-rendering a tab must not close what you opened (auto-refresh every 2 min, "Show all games", Sync): remember each section's state
// by id, run the render, put the state back.
function keepOpenState(rootId, render) {
  const root = $(rootId), st = {};
  if (root && root.querySelectorAll) root.querySelectorAll(".drop[id]").forEach((d) => { st[d.id] = d.classList.contains("open"); });
  render();
  for (const id of Object.keys(st)) { const e = $(id); if (e && e.classList) e.classList.toggle("open", st[id]); }
}
let MBWEEK = null;   // Record tab week filter: null = this week, "all" = whole season
// Game-by-game results: week chips (default = newest week with results, "All" = every week), games in kickoff order.
let GBG_RES = [], GBGWEEK = null;
function gbgHtml() {
  const wks = [...new Set(GBG_RES.map((r) => r.week))].sort((a, b) => b - a); if (!wks.length) return "";
  const sel = GBGWEEK && (GBGWEEK === "all" || wks.includes(GBGWEEK)) ? GBGWEEK : wks[0];
  const list = GBG_RES.filter((r) => sel === "all" || r.week === sel).sort((a, b) => b.week - a.week || String(a.gradedAt || "").localeCompare(String(b.gradedAt || "")));
  // 10/19 (owner: "organize it better"): each game shows the card's PICK (rule or model side) and PICK w/ POINTS as locked at kickoff, the same
  // picks as the tiles and the Card picks rows; earlier weeks show what their card showed then. The old game model's own side is never shown.
  const res1 = (x) => (x.result === "W" ? '<span class="g">W</span>' : x.result === "L" ? '<span class="r">L</span>' : x.result === "P" ? "P" : '<span class="dim">…</span>');
  const row = (r) => { const cp = ((COMBOS && COMBOS.card && COMBOS.card.byGame) || {})[`${r.week}|${r.game}`];
    // 10/22 (owner: table list): the game + its final score as a small heading, then two rows (PICK, w/ POINTS) in SPREAD | TOTAL columns
    const cell = (pts, kind) => { const x = (cp || []).find((y) => !!y.pts === pts && (y.kind === "total") === (kind === "total")); return x ? `${esc(x.pick)} ${res1(x)}` : '<span class="dim">—</span>'; };
    return `<div class="s tgame">${esc(r.game)} <span class="dim">wk ${r.week} · ${r.awayScore}-${r.homeScore}</span></div>` +
      tRow("PICK", "", [cell(false, "spread"), cell(false, "total")], "tg") + tRow("w/ POINTS", "", [cell(true, "spread"), cell(true, "total")], "tg"); };
  return `<div class="chips" id="gbg-chips">${wks.map((w) => `<button data-gbw="${w}" class="${String(sel) === String(w) ? "on" : ""}">Week ${w} (${GBG_RES.filter((r) => r.week === w).length})</button>`).join("")}<button data-gbw="all" class="${sel === "all" ? "on" : ""}">All</button></div>` + tHead(["SPREAD", "TOTAL"], "tg") + list.map(row).join("");
}
// Bets analysis (10/2): where your money wins and loses, from the legs of your typed-in combos (account bets do not list legs).
// Per leg type: how often it hit against the price you paid (hit rate minus price, in points); per combo size: record and return.
function betsAnalysis(bets) {
  const LK = { td: "Touchdowns", spread: "Spreads", total: "Totals" }, byKind = {}, bySize = {};
  let nLegs = 0;
  // 10/14 (owner): Polymarket account combos count too, from their saved legs (picks: label + result, no per-leg price)
  const kindOf = (p) => p.kind && p.kind !== "other" ? p.kind : / TD$/.test(p.label || "") ? "td" : /^(Over|Under) /.test(p.label || "") ? "total" : "spread";
  for (const b of bets || []) {
    const legs = b.legs && b.legs.length ? b.legs : b.source === "account" && b.picks && b.picks.length ? b.picks.map((p) => ({ kind: kindOf(p), result: p.result })) : null;
    if (!legs) continue;
    for (const l of legs) { if (l.result !== "W" && l.result !== "L") continue; const k = byKind[l.kind] = byKind[l.kind] || { n: 0, w: 0, price: 0, pn: 0 }; k.n++; k.w += l.result === "W" ? 1 : 0; if (Number(l.price) > 0) { k.price += Number(l.price); k.pn++; } nLegs++; }
    if (b.result === "W" || b.result === "L") { const z = bySize[legs.length] = bySize[legs.length] || { n: 0, w: 0, cost: 0, pl: 0 }; z.n++; z.w += b.result === "W" ? 1 : 0; z.cost += b.cost; z.pl += b.pl || 0; }
  }
  if (!nLegs) return '<div class="s empty">None yet.</div>';
  const small = (n) => (n < 30 ? '' : "");
  const legRows = Object.keys(byKind).sort().map((kk) => { const k = byKind[kk], hit = k.w / k.n * 100, paid = k.pn ? k.price / k.pn * 100 : null, d = paid == null ? null : hit - paid;
    return `<div class="row"><span>${LK[kk] || kk} <span class="dim">· ${k.w}–${k.n - k.w}</span></span><span>hit <b>${Math.round(hit)}%</b>${paid == null ? "" : ` · paid ${Math.round(paid)}¢ · <b class="${d > 3 ? "g" : d < -3 ? "r" : "dim"}">${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)} pts</b>`}${small(k.n)}</span></div>`; }).join("");
  const sizeRows = Object.keys(bySize).map(Number).sort((a, b) => a - b).map((z) => { const k = bySize[z];
    return `<div class="row"><span>${z === 1 ? "Singles" : z + "-leg combos"} <span class="dim">· ${k.n}</span></span><span>${k.w} won · ${cMoney(k.pl)}${k.cost ? ` <span class="dim">(${cPct(k.pl / k.cost)})</span>` : ""}${small(k.n)}</span></div>`; }).join("");
  return `<div class="s"><b>By leg type</b></div>${legRows}<div class="s" style="margin-top:8px"><b>By number of picks</b></div>${sizeRows || '<div class="s dim empty">None yet.</div>'}` +
    "";
}
// The numbers in the Bets tiles and Summary, from the bets being shown. One function so a week's numbers and the season's always add up.
// 10/19: a combo with a lost leg can't win -- it counts as lost right away (record, profit), not as open money, even before Polymarket settles it
const legLost = (b) => !b.sold && (!b.result || b.result === "pending") && [...(b.picks || []), ...(b.legs || [])].some((p) => p && p.result === "L");
function betsSummary(shown) {
  const dead = shown.filter(legLost), open = shown.filter((b) => b.result === "pending" && !legLost(b)), gr = shown.filter((b) => b.pl != null).concat(dead.map((b) => ({ ...b, pl: -(b.cost || 0) }))), stk = gr.reduce((a, b) => a + b.cost, 0), cl = shown.filter((b) => b.clv != null).map((b) => b.clv);
  const wm = open.filter((b) => b.expModel != null);
  return { wins: shown.filter((b) => b.result === "W").length, losses: shown.filter((b) => b.result === "L").length + dead.length, pushes: shown.filter((b) => b.result === "P").length,
    openCost: open.reduce((a, b) => a + b.cost, 0), pl: gr.reduce((a, b) => a + b.pl, 0), roi: stk ? gr.reduce((a, b) => a + b.pl, 0) / stk : null,
    avgClv: cl.length ? cl.reduce((a, b) => a + b, 0) / cl.length : null, maxPayout: open.reduce((a, b) => a + b.toWin, 0), expMarket: open.reduce((a, b) => a + b.expMarket, 0),
    expModel: wm.reduce((a, b) => a + b.expModel, 0), expModelCost: wm.reduce((a, b) => a + b.cost, 0), modelCovered: wm.length };
}
// Open bets by kickoff time (10/10): every leg is matched to its game (team code, "· AWAY @ HOME", or a TD player's name); a bet whose
// legs fall in more than one slot goes in its own "Mixed times" list with a warning (it isn't settled until its last game ends).
const BET_SLOTS = ["Early (London / international)", "Morning (10 AM)", "Afternoon (1 PM)", "Prime time"];
function kickSlot(g) {
  if (!g || !g.kickoff) return null;
  if (/TNF|SNF|MNF/.test(g.badge || "")) return BET_SLOTS[3];
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" }).format(new Date(g.kickoff)));
  return h < 9 ? BET_SLOTS[0] : h < 12 ? BET_SLOTS[1] : h < 17 ? BET_SLOTS[2] : BET_SLOTS[3];
}
function legGame(label, games) {
  const L = String(label), at = L.match(/·\s+(.+ @ .+)$/); if (at) return games.find((g) => g.key === at[1]) || null;
  const sp = L.match(/^([A-Z]{2,3})\s+(?:[+-][\d.]+|ML)$/); if (sp) return games.find((g) => g.away === sp[1] || g.home === sp[1]) || null;
  const td = L.match(/^(.+?)\s+\d\+\s+TD$/); if (!td) return null;
  const w = td[1].replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/), first = (w[0] || "")[0], last = w.slice(1).join(" ").toLowerCase();
  const hit = games.filter((g) => (g.td || []).some((r) => { const [a, ...b] = String(r.player).split("."); return b.join(".").toLowerCase() === last && (a || "")[0] === first; }));
  return hit.length === 1 ? hit[0] : null;   // two players with the same short name on different teams: unknown
}
const PM_CODE = { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" }, pmCode = (t) => PM_CODE[String(t || "").toUpperCase()] || String(t || "").toUpperCase();
// 10/27 (owner: "Fix the time unknown"): a single bet's game comes from its prop ("DAL @ PHI") or its Polymarket id ("aec-nfl-kc-sea-2026-10-25")
function singleGame(b, games) {
  if (b.prop && b.prop.game) return games.find((x) => x.key === b.prop.game) || null;
  const m = /^[a-z]+-nfl-([a-z]+)-([a-z]+)-\d{4}-\d\d-\d\d/.exec(String(b.id || "")); if (!m) return null;
  return games.find((x) => x.key === `${pmCode(m[1])} @ ${pmCode(m[2])}`) || null;
}
const isSingle = (b) => !(b.picks && b.picks.length) && !(b.legs && b.legs.length);
function betSlots(b) {
  const games = (S && S.games) || [], out = new Set();
  for (const p of b.picks || []) { const g = legGame(p.label, games), sl = kickSlot(g); if (sl) out.add(sl); }
  for (const l of b.legs || []) { const g = games.find((x) => x.key === l.game), sl = kickSlot(g); if (sl) out.add(sl); }
  if (isSingle(b)) { const sl = kickSlot(singleGame(b, games)); if (sl) out.add(sl); }
  return [...out];
}
// 10/27 (owner: "put the single bets at the top of the list first then the parlays"): the open list = every single bet (by kickoff slot), then the combos
function openBySlot(open) {
  const block = (list, word) => {   // 10/27 (owner: "Remove the word Combo in Bets"): the singles keep their word, the parlays' headers are the time slot alone
    const groups = Object.fromEntries(BET_SLOTS.map((k) => [k, []])), mixed = [], other = [], head = (k) => (word ? `${word} · ${k}` : k);
    for (const b of list) { const sl = betSlots(b); if (sl.length === 1) groups[sl[0]].push(b); else if (sl.length > 1) mixed.push({ b, sl }); else other.push(b); }
    return BET_SLOTS.filter((k) => groups[k].length).map((k) => `<div class="sec"><div class="sh">${head(k)}</div>${groups[k].map(betRow).join("")}</div>`).join("") +
      (mixed.length ? `<div class="sec"><div class="sh">${head("Mixed times")}</div>${mixed.map(({ b, sl }) => `<div class="s dim" style="margin-top:6px">${sl.sort((x, y) => BET_SLOTS.indexOf(x) - BET_SLOTS.indexOf(y)).join(" + ")}</div>${betRow(b)}`).join("")}</div>` : "") +
      (other.length ? `<div class="sec"><div class="sh">${head("Time unknown")}</div>${other.map(betRow).join("")}</div>` : "");
  };
  return block(open.filter(isSingle), "Singles") + block(open.filter((b) => !isSingle(b)), "");
}
function renderMineNow() {
  if (!MB) { $("record-mine").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">Loading…</div></div>'; return; }
  // Week filter: default is this week; "All" is the season. The summary is recomputed from the bets shown.
  const SW = S && S.week, wks = [...new Set(MB.bets.map((b) => b.week).filter((w) => w != null).concat(SW == null ? [] : [SW]))].sort((a, b) => a - b), sel = MBWEEK || SW || "all";
  const shown = MB.bets.filter((b) => sel === "all" || Number(b.week) === Number(sel) || (SW != null && Number(sel) === Number(SW) && b.result === "pending" && !legLost(b)));   // 10/19: open bets on last week's Monday game stay in view
  const open = shown.filter((b) => b.result === "pending" && !legLost(b)), done = shown.filter((b) => b.result !== "pending" || legLost(b));   // includes auto-recorded account bets; a combo with a lost leg is done
  const s = betsSummary(shown);
  // 10/17 (owner): the week picker is a drop-down, from the first recorded week to this week, then Season
  const wkChips = `<div class="wksel"><select id="mb-wk" aria-label="Week">${wks.map((w) => `<option value="${w}"${String(sel) === String(w) ? " selected" : ""}>Week ${w}</option>`).join("")}<option value="all"${sel === "all" ? " selected" : ""}>Season</option></select></div>`;
  const past = sel !== "all" && SW != null && Number(sel) < Number(SW);   // an earlier week: results only (no open bets / expected returns / live account)
  const nOpen = open.length, tot = s.wins + s.losses;
  // 10/22 (owner: "Make all of this its own card ... No columns one card"; "a little darker"): Best bets, Parlay of the week, the open bets / record / profit
  // tiles and the summary are ONE card, one row each (name left, number right); a tap on Best bets / Parlay opens its list under the card
  const T = ticketRows(), recCls = tot ? (s.wins / tot >= 0.5 ? "g" : "r") : "dim";
  // 10/27 (owner: "organize or fix these ... change the layout if you need to"): Profit as one big number on top (like Polymarket's portfolio), the record,
  // open bets and stake on one line under it; then Best bets, Parlay of the week, Return · CLV as plain rows
  const hero = `<div class="mbhero"><span class="lbl">Profit · ${sel === "all" ? "this season" : "Week " + sel}</span><b>${cMoney(s.pl)}</b>` +
    `<span class="sub"><span class="${recCls}">${tot ? `${s.wins}–${s.losses}` : "0–0"}</span> · ${past ? `${shown.length} bet${shown.length === 1 ? "" : "s"}` : `${nOpen} open · ${money(s.openCost)} staked`}</span></div>`;
  // 10/28 (owner: "Don't make this part scroll up and make it into a card with like 20% opacity"): the profit, its line and the top rows are one see-through
  // card that stays put under the page title (.mbpin, Shell.pinTop); the lists they open sit under it
  const top = `<div class="mbpin">` + hero + `<div class="card mbtop"><div class="sec">${T.rows}` +
    `<div class="row"><span class="dim">Return · CLV</span><span>${cPct(s.roi)} · ${cPct(s.avgClv)}</span></div>` +
    (() => { const sc = MB.summary && MB.summary.settleCheck; if (!sc || !(sc.agree + sc.disagree)) return "";
      return sc.disagree ? `<div class="s y">⚠ Settlement mismatch on ${sc.disagree} combo${sc.disagree === 1 ? "" : "s"}</div>`
        : ""; })() +
    `</div></div></div>` + T.drops;
  $("record-mine").innerHTML = ddSlot($("record-mine"), wkChips) + top + `<div class="card" style="margin-top:10px">` +
    (past || !open.length ? "" : openBySlot(open) +
    `<div class="sec"><div class="sh">Expected returns</div>` +
    `<div class="row"><span class="dim">If everything hits</span><span>${money(s.maxPayout)} (${cMoney(s.maxPayout - s.openCost)})</span></div>` +
    `<div class="row"><span class="dim">Expected · market</span><span>${money(s.expMarket)} (${cMoney(s.expMarket - s.openCost)})</span></div>` +
    `<div class="row"><span class="dim">Expected · your model</span><span>${s.modelCovered ? `${money(s.expModel)} (${cMoney(s.expModel - s.expModelCost)})` : "—"}</span></div></div>`) +
    `<div class="fold" data-drop="settled"><span>${past ? "Results" : "Settled bets"}</span><span>▾</span></div>` +
    `<div class="drop${past ? " open" : ""}" id="settled">${(past ? shown : done).map(betRow).join("") || '<div class="s empty">None yet.</div>'}</div>` +
    `<div class="fold" data-drop="ban"><span>Analysis</span><span>▾</span></div><div class="drop" id="ban">${betsAnalysis(MB.bets)}</div>` +
    `</div>` +
    `<div class="center"><button class="btn" id="sync-btn">↻ Sync account</button></div>`;
  $("sync-btn").onclick = () => loadRecord(true);
  if (typeof Shell !== "undefined" && Shell.pinTop && $("record-mine").querySelector) Shell.pinTop($("record-mine").querySelector(".mbpin"));
  const mw = $("mb-wk"); if (mw) mw.onchange = () => { MBWEEK = mw.value === "all" ? "all" : Number(mw.value); renderMine(); };
}
// 10/18 (owner): a Results page under Bets was built and deleted the same day; RESULT lines are no longer saved (CLEANUP 10/18).
// ---------- Record: Model ----------

// ---------- Models tab: analysis helpers (pure, tested) ----------
const bar = (pct, color, label) => `<span style="display:inline-block;width:64px;height:7px;border-radius:4px;background:rgba(255,255,255,.1);vertical-align:middle"><i style="display:block;height:7px;border-radius:4px;width:${Math.max(2, Math.min(100, Math.round(pct)))}%;background:${color}"></i></span>${label ? ` <span class="dim">${label}</span>` : ""}`;
const hitColor = (pct, line) => (pct >= line + 3 ? "var(--green)" : pct >= line - 3 ? "var(--yellow)" : "var(--red)");
// Moneyline record by the chance the market gave the favorite at kickoff -- the SAME picks as the MONEYLINE tile (S.winners), split by chance
function winnersBands() {
  const B = (S && S.winners && S.winners.bands) || [];
  const rows = B.filter((x) => x.n).map((x) => { const hit = x.hit * 100, said = x.said * 100;
    return tRow(`Said ${esc(x.label)}`, plural(x.n, "pick"), [`${x.w}–${x.l}`, `<b>${Math.round(hit)}%</b>`, `${Math.round(said)}%`]); }).join("");
  return rows ? tHead(["RECORD", "WON", "SAID"]) + rows : '<div class="s empty">None yet.</div>';
}
// Touchdown chances split by position and by opponent defense (10/5). Same rule as the calibration rows: only players who played,
// "said" vs "scored" with a margin of error, and "too few to trust" under 30. Opponent strength = the opponent's average points allowed in its OTHER
// graded games (weak = 3+ above the league average, strong = 3+ below); it is descriptive, not a prediction.
function tdGroupRow(label, xs) {
  if (!xs.length) return "";
  const said = xs.reduce((a, p) => a + p.fair, 0) / xs.length, hit = xs.filter((p) => p.scored).length / xs.length * 100, n = xs.length;
  return `<div class="row" style="display:block"><div class="dim">${esc(label)} · ${plural(n, "player")} · scored ${Math.round(hit)}%</div><div class="s" style="display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:center"><span class="dim">said</span><span>${bar(said, "var(--cyan, #5ec8e5)", Math.round(said) + "%")}</span><span class="dim">scored</span><span>${bar(hit, hitColor(hit, said), Math.round(hit) + "%")}</span></div></div>`;
}
// Played players of every graded game, each with the opponent's strength attached.
function tdPlayersWithDefense(res) {
  // Each team's points allowed, game by game. A player's opponent is judged on its OTHER games only, so the game being graded can't make a
  // defense look weak just because that game had a lot of scoring.
  const allowed = {}; let tot = 0, cnt = 0;
  for (const r of res || []) { const m = String(r.game || "").split(" @ "); if (m.length !== 2 || r.awayScore == null || r.homeScore == null) continue;
    (allowed[m[0]] = allowed[m[0]] || []).push({ id: r.game + "|" + r.week, pts: r.homeScore }); (allowed[m[1]] = allowed[m[1]] || []).push({ id: r.game + "|" + r.week, pts: r.awayScore }); tot += r.homeScore + r.awayScore; cnt += 2; }
  const lg = cnt ? tot / cnt : null;
  const avgOther = (t, id) => { const xs = (allowed[t] || []).filter((x) => x.id !== id); return xs.length ? xs.reduce((a, x) => a + x.pts, 0) / xs.length : null; };
  const out = [];
  for (const r of res || []) { const m = String(r.game || "").split(" @ "); if (m.length !== 2) continue;
    for (const p of r.td || []) { if (p.played !== true || p.fair == null) continue;
      const opp = p.team === m[0] ? m[1] : m[0], oa = avgOther(opp, r.game + "|" + r.week), d = oa == null || lg == null ? null : oa - lg;
      out.push({ ...p, opp, def: d == null ? null : d >= 3 ? "weak" : d <= -3 ? "strong" : "middle" }); } }
  return out;
}
function tdByPosition(players) {
  const rows = ["RB", "WR", "TE", "QB"].map((pos) => tdGroupRow(pos, players.filter((p) => p.pos === pos))).join("");
  return rows || '<div class="s empty">None yet.</div>';
}
function tdByDefense(players) {
  const rows = [["weak", "vs weak defenses"], ["middle", "Against average defenses"], ["strong", "vs strong defenses"]].map(([k, lab]) => tdGroupRow(lab, players.filter((p) => p.def === k))).join("");
  return rows || '<div class="s empty">None yet.</div>';
}
// One collapsible section: a heading, one plain line saying what it means, then the content. warn = a count shown next to the heading.
function mSec(id, title, body, warn = 0, open = false) {
  return `<div class="fold" data-drop="${id}"><span><b>${esc(title)}</b>${warn ? ` <span class="y">⚠ ${warn}</span>` : ""}</span><span>▾</span></div>` +
    `<div class="drop${open ? " open" : ""}" id="${id}">${body}</div>`;
}
// 10/15: how the card's PICK and PICK w/ POINTS are doing (saved at kickoff, graded when the game ends), with money per $100 at the price saved with each pick
// 10/22 (owner: "only 1 information button next to the model header and it will explain everything in it"): one ⓘ per model section,
// a tap opens a short box right under the header (the tap is handled in public/shell.js). Model lines read white labels + colored numbers.
const IBTN = `<button class="ibtn" type="button" aria-label="What is this?"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.6"/><line x1="8" y1="7.2" x2="8" y2="11.4"/><circle cx="8" cy="4.8" r=".6" fill="currentColor"/></svg></button>`;
const ibox = (lines, st) => `<div class="ibox" hidden${st ? ` style="${st}"` : ""}>${lines.map(([k, t]) => `<div><b>${k}</b> ${t}</div>`).join("")}</div>`;
// 10/26 (owner: "a reason why by all factors ... why it chose this or why it doesn't choose this"): the game's own facts (lib/why.js, `g.why`) sit on top
// of the MODEL ⓘ box -- one line per factor, + for the PICK's side, − against, · neither -- then the glossary. Still opens only on the tap.
const whyMark = (s) => `<span class="wm${s > 0 ? " wf" : s < 0 ? " wa" : ""}">${s > 0 ? "+" : s < 0 ? "−" : "·"}</span>`;
function whyBox(g, kind, info) {
  const W = g && g.why ? (g.why[kind] || []).concat(kind === "spread" ? g.why.ml || [] : []) : [];
  const own = W.length ? `<div class="wh">THIS GAME · + for the pick · − against</div>` + W.map(([k, t, s]) => `<div>${whyMark(s)}<b>${esc(k)}</b> ${esc(t)}</div>`).join("") + `<div class="wsep"></div>` : "";
  return `<div class="ibox" hidden>${own}${info.map(([k, t]) => `<div><b>${k}</b> ${t}</div>`).join("")}</div>`;
}
const MODEL_INFO = {
  spread: [["Model:", "the game model’s score guess. Data only."], ["Model (Team):", "team-stats model at Polymarket’s line; it becomes the PICK at 58%+ sure, but not once the line has moved 1+ point its way."],
    ["Model (Stack):", "everything the app knows in one model. With no tested rule it names the PICK."], ["Pick:", "the bet at Polymarket’s main line, from a tested rule (LINE MOVE, TEAM MODEL, OVERSHOOT, INJURY, BOUNCE BACK), else the Stack model’s side. Green 56%+, light green 53–55%, yellow below."], ["OVERSHOOT:", "the line moved 1+ point toward a side the game model still likes by 2+; the other side won 57% (242 games 2014-25)."], ["ML pick:", "the favorite’s moneyline when the Stack model backs the favorite and is priced 50–70% (won 67.7–69.7% in 2022-25, priced 56–65%); or the team model’s side when it is 58%+ sure and the line moved 1+ point against it (favorites won 88.9% of 18, underdogs priced 30–50¢ won 63.3% of 30, 2014-25)."],
    ["Pick w/ points:", "same side, the fewest bought points (1–2) that won 56%+."], ["MORE list:", "every line within 2 points: points bought · history win % · Polymarket price."]],
  total: [["Model:", "the game model’s total points guess. Data only."], ["Pick:", "Over or Under at Polymarket’s main total, from a tested rule, else the model’s side. Green 56%+, light green 53–55%, yellow below."],
    ["Pick w/ points:", "same side, the fewest bought points (1–2) that won 56%+."], ["MORE list:", "every line within 2 points: points bought · history win % · Polymarket price."]],
};
const CARD_INFO = [["PICK:", "the card’s bet at Polymarket’s main line (a tested rule, else the model’s side), locked at kickoff."],
  ["PICK w/ POINTS:", "the same side with the fewest bought points (1–2) that won 56%+."], ["1H SPREAD:", "the first-half model’s side on Polymarket’s first-half spread lines (58%+ on the model’s chance less 11.4 points, 77¢ max, steady books), graded on the first-half score."],
  ["GAME PROPS:", "game and team props where the 600 past games nearest this spread and total beat Polymarket’s price (70%+ on 8 parts history + 2 parts price, 6+ points over the price, 30–77¢), graded on Polymarket’s result."],
  ["PASSING TDs:", "the game’s total passing TDs where the two QBs’ own passing-TD prices disagree with it by 8+ points: the side the QBs point to (30–77¢, one per game), graded on Polymarket’s result."],
  ["Line value:", "points better (+) or worse than the line at kickoff."]];
const TRACK_INFO = [["Test picks,", "never shown on a card: recorded and graded live. One becomes a pick only after it holds 56%+ over about 100 games."],
  ["INJURY EARLY:", "a starter newly out; the healthy team at the line of that moment."], ["TD JUMP:", "a player’s TD chance up 10+ points between reruns; did he score?"],
  ["STACK:", "everything the app knows in one model; confident = its top fifth."], ["WIDE:", "every situation flag on both teams in one boosted-tree model; confident = its top fifth."]];
// 10/28: the 1H SPREAD pick's record (lib/tracked.js trackedSummary.h1spr); 10/28 night: the GAME PROPS pick's (trackedSummary.gprops)
function pickRow(lab, h) {
  if (!h || !h.recorded) return tRow(lab, "", ['<span class="dim">—</span>', '<span class="dim">—</span>', '<span class="dim">—</span>']);
  const sub = [h.said != null ? `said ${h.said}%` : "", h.pending ? `${h.pending} pending` : ""].filter(Boolean).join(" · ");
  if (!h.n) return tRow(lab, sub, ['<span class="dim">—</span>', '<span class="dim">—</span>', '<span class="dim">—</span>']);
  const pc = Math.round(100 * h.hit);
  return tRow(lab, sub, [`${h.w}–${h.l}`, `<b class="${pc >= 56 ? "g" : pc >= 50 ? "y" : "r"}">${pc}%</b>`, h.per100 != null ? `<span class="${h.per100 >= 0 ? "g" : "r"}">${h.per100 >= 0 ? "+" : "−"}$${Math.abs(Math.round(h.per100))}</span>` : '<span class="dim">—</span>']);
}
const h1Row = () => pickRow("1H SPREAD · PICK", TRACKED && TRACKED.h1spr) + pickRow("GAME PROPS · PICK", TRACKED && TRACKED.gprops) + pickRow("PASSING TDs · PICK", TRACKED && TRACKED.ptdqb);
function cardRecBox() {
  const R = (COMBOS && COMBOS.cardRec) || {};
  const row = (lab, k) => { const b = R[k]; if (!b || !(b.w + b.l)) return tRow(lab, "", ['<span class="dim">—</span>', '<span class="dim">—</span>', '<span class="dim">—</span>']);
    const pc = Math.round((100 * b.w) / (b.w + b.l)); return tRow(lab, "", [`${b.w}–${b.l}`, `<b class="${pc >= 56 ? "g" : pc >= 50 ? "y" : "r"}">${pc}%</b>`, b.stk ? `<span class="${b.ret >= 0 ? "g" : "r"}">${b.ret >= 0 ? "+" : "−"}$${Math.abs(Math.round((b.ret / b.stk) * 100))}</span>` : '<span class="dim">—</span>']); };
  const V = (COMBOS && COMBOS.card && COMBOS.card.clv) || {};
  const lv = (lab, x) => { if (!x || !x.n) return ""; const av = x.sum / x.n;
    return tRow(lab, "", [`<b class="${av > 0.05 ? "g" : av < -0.05 ? "r" : "dim"}">${av > 0 ? "+" : av < 0 ? "−" : ""}${Math.abs(av).toFixed(2)}</b>`, x.beat, x.n - x.beat - x.same, x.same]); };
  return `<div class="s ihd" style="grid-column:1/-1"><b>Card picks</b>${IBTN}</div>` + ibox(CARD_INFO, "grid-column:1/-1") + tHead(["RECORD", "WIN %", "PER $100"]) +
    row("PICK · spread", "pick|spread") + row("PICK · total", "pick|total") + row("PICK w/ POINTS · spread", "ptspick|spread") + row("PICK w/ POINTS · total", "ptspick|total") + h1Row() +
    (V.n ? `<div class="s" style="margin-top:8px;grid-column:1/-1"><b>Line value · PICK vs the closing line</b></div>` + tHead(["PTS", "BETTER", "WORSE", "SAME"]) + lv("Spread", V.spread) + lv("Total", V.total) : "");
}
function renderModelNow() {
  if (!MB || !RES || !S) { $("models").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">Loading…</div></div>'; return; }   // no slate yet: renderAll draws it when the slate lands
  const res = RES;
  const weeks = [...new Set(res.map((r) => r.week))].sort((a, b) => b - a), lw = weeks[0];
  const wk = res.filter((r) => r.week === lw);
  // Tier labels (Weak/Moderate/Strong) were removed from the cards: calibrated spread/total chances sit ~50%, so every
  // pick would land in one bucket. Season record is shown plain instead.
  // Model accuracy (TD model check, Top picks, recap) uses players who PLAYED; the model's % assumes he plays. The
  // Polymarket comparison below uses everyone, because an inactive player's market really does settle No.
  const tdAllAny = res.flatMap((r) => r.td || []), tdAll = tdAllAny.filter((p) => p.played === true), tdWaiting = tdAllAny.filter((p) => p.played === undefined).length;   // played unset = the week's snap counts are not posted yet (a few hours after games): left out, not counted as misses
  const buckets = [[10, 20], [20, 30], [30, 40], [40, 50], [50, 101]].map(([lo, hi]) => {
    const xs = tdAll.filter((p) => p.fair >= lo && p.fair < hi); if (!xs.length) return "";
    const rate = xs.filter((p) => p.scored).length / xs.length * 100, mid = xs.reduce((a, p) => a + p.fair, 0) / xs.length;
    // "too high/low" only when the gap is bigger than chance alone would produce (2 standard errors), not just 5 points:
    // 28% of 29 vs a 35% forecast is normal luck (±18 pts), and calling it "too high" was a false signal.
    const gap = rate - mid;   // 10/19: one rule, no luck allowance (owner rule 6) -- within 5 points = on target, else too high / too low
    const verdict = Math.abs(gap) <= 5 ? '<span class="g">on target</span>' : gap < 0 ? '<span class="r">too high</span>' : '<span class="y">too low</span>';
    return tRow(`Said ${hi > 100 ? lo + "+" : lo + "–" + hi}%`, plural(xs.length, "player"), [`${Math.round(mid)}%`, `${rate.toFixed(0)}%`, verdict], "tv");
  }).join("");
  // TD model vs Polymarket: same graded players, scored against the closing price. Brier = average squared miss
  // (lower is better). Market chance = middle of bid/ask when there is a bid (the ask alone includes the spread).
  // Only REAL markets count: someone bidding within 5¢ of the ask (40% of it for cheap long shots). A thin market (e.g. 40¢ ask, 1¢ bid) has no
  // real price, and averaging its bid/ask invented a fake "market chance" that made Polymarket look worse (Week 3:
  // 170 of 258 players were thin; on real markets model and market were ~tied).
  const priced = tdAllAny.filter((p) => p.ask > 0 && p.ask < 1 && p.played !== undefined);   // the market already prices who sat; the model's number only counts once we know who played
  // Model chance as the TD tab showed it: the model's % assumes he plays, so a player listed Questionable/Out that week
  // is scaled by his chance to play (same rule as the tab, 9/30). The market's price already includes that risk.
  const avail = (p) => (!p.rep ? 1 : p.played === true ? 1 : p.played === false ? 0.01 :   // closing prices come after inactives
    /^(out|doubtful)$/i.test(p.rep) ? 0.01 : /^questionable$/i.test(p.rep) ? 0.669 : 1);
  const mp = (p) => (p.fair / 100) * avail(p);
  const isThin = (p) => !(p.bid > 0) || p.ask - p.bid > Math.min(0.05, 0.4 * p.ask);   // same rule as lib/odds.js isThinMarket
  const tdPx = priced.filter((p) => !isThin(p));
  let vsMkt = "";
  if (tdPx.length) {
    const y = (p) => (p.scored ? 1 : 0), mk = (p) => (p.bid ? (p.bid + p.ask) / 2 : p.ask);
    const bM = tdPx.reduce((a, p) => a + (mp(p) - y(p)) ** 2, 0) / tdPx.length;
    const bP = tdPx.reduce((a, p) => a + (mk(p) - y(p)) ** 2, 0) / tdPx.length;
    const buys = tdPx.filter((p) => mp(p) > p.ask);
    const pl = buys.reduce((a, p) => a + (p.scored ? 1 / p.ask - 1 : -1), 0);
    const hits = buys.filter((p) => p.scored).length;
    vsMkt = `<div class="row plain"><span class="dim">Accuracy</span><span>${bM < bP ? '<span class="g">' : '<span class="r">'}Model ${bM.toFixed(3)}</span> · Poly ${bP.toFixed(3)}</span></div>` +
      `<div class="row plain"><span class="dim">Yes bets</span><span>${hits} of ${buys.length} scored · ${cMoney(pl)} ${buys.length ? `(${cPct(pl / buys.length)})` : ""}</span></div>` +
      (() => { const no = tdPx.filter((p) => 1 - mp(p) > 1 - p.bid), plNo = no.reduce((a, p) => a + (!p.scored ? 1 / (1 - p.bid) - 1 : -1), 0);   // buying No costs 1 - bid
        return `<div class="row plain"><span class="dim">No bets</span><span>${no.filter((p) => !p.scored).length} of ${no.length} won · ${cMoney(plNo)} ${no.length ? `(${cPct(plNo / no.length)})` : ""}</span></div>`; })();
  }
  const fitLine = (f) => { if (!f) return "— (after the next Tuesday rebuild)";
    const one = (nm, [a, b]) => a == null ? `${nm} —` : `${nm} ours <b>${Number(a).toFixed(2)}</b>${b == null ? "" : ` · line <b>${Number(b).toFixed(2)}</b> <span class="${a <= b ? "g" : "r"}">${a <= b ? "better" : "worse"}</span>`}`;
    return `${one("margin", f.margin)} · ${one("total", f.total)} · ${one("team total", f.teamTotal)} (${f.games} games)`; };
  // 10/27: the service's rebuild state from /health -- running since, failed (why), or the published build's time; "site copy" = the build the site reads now
  const rebuildLine = (rw, f) => { if (!rw) return "—"; const rb = rw.rebuild || {}, b = rw.build || {}, last = rb.last || {};
    if (rb.running) return `<span class="y">running since ${hm(rb.startedAt)}</span>`;
    if (last.error) return `<span class="r">failed ${rb.finishedAt ? hm(rb.finishedAt) : ""} · ${esc(String(last.error).slice(0, 80))}</span>` + (b.builtAt ? ` · keeps the build of ${hm(b.builtAt)}` : "");
    if (!b.builtAt) return rw.ok ? "no build published yet" : "—";
    const site = f && f.builtAt ? (f.builtAt === b.builtAt ? '<span class="g">site up to date</span>' : `<span class="y">site copy ${hm(f.builtAt)} · updates on the next build</span>`) : "";
    return `${hm(b.builtAt)} · ${last.published === false ? '<span class="y">did not pass its checks</span>' : "published"}${site ? " · " + site : ""}`; };
  const st = S.status, wc = S.weekCheck || { games: 0, withLines: 0, modelRun: false, watch: [] };
  const stOk = st && st.ok && !st.creditWarning;
  const stRows = st ? [
    ["Last automatic run", st.auto ? `${hm(st.auto.t)} · ${esc(st.auto.what)}` + (Date.now() - new Date(st.auto.t) > 9 * 3600e3 ? ' <span class="y">(stale)</span>' : "") : '<span class="y">none recorded</span>'],
    ["Recorded this week", (wc.recorded || []).length ? (wc.recorded || []).map((x) => `<div>${esc(x.game)} · ${x.close ? '<span class="g">closing line ✓</span>' : '<span class="y">closing line missing</span>'} · ${x.picks ? `<span class="g">${x.picks} picks saved ✓</span>` : '<span class="dim">no card pick</span>'}${x.card ? "" : x.picks ? ' <span class="y">· PICK missing</span>' : ""} · ${x.winner ? '<span class="g">winner ✓</span>' : '<span class="y">winner missing</span>'}</div>`).join("") : "—"],
    ["Last snapshot", st.lastSnapshot ? hm(st.lastSnapshot) + (S.meta && S.meta.lastSrc === "manual" ? " · you" : "") : "—"], ["Last model run", st.modelRunAt ? hm(st.modelRunAt) : "—"],
    ["Last self-check", st.selfcheck ? `${hm(st.selfcheck.t)} · ${st.selfcheck.items.length ? `<span class="y">${st.selfcheck.items.length} issue(s) — see Watchdog</span>` : '<span class="g">all clear</span>'}` : "— (Thu 12:05 PM, Fri 5:05 PM, Sun 7:35 AM)"],
    ["Pre-logged at kickoff", `${st.prelogged || 0} of ${(S.games || []).length} games this week`],
    ["Last backup", st.backup ? `${hm(st.backup.t)} · ${st.backup.where === "volume" ? "saved" : st.backup.where === "failed" ? '<span class="r">failed</span>' : '<span class="y">temporary</span>'}` : '<span class="y">none yet</span>'],
    ["Last TD retrain", st.retrain ? `${hm(st.retrain.t)} · ${/kept/i.test(st.retrain.summary || "") ? "kept current" : /switch|new model|live/i.test(st.retrain.summary || "") ? "new model live" : esc(String(st.retrain.summary || "").slice(0, 40))}` : '<span class="dim">not run yet</span>'],
    ["Kickoff check (ESPN)", kickLine(st.kickcheck)],
    ["Game model vs the line (unseen seasons)", fitLine(st.fitCheck)],   // 10/26 night (owner): margin, total and each team's points -- the model's miss next to the closing line's
    ["Model rebuild (Railway)", rebuildLine(st.railway, st.fitCheck)],   // 10/27 (owner: "check the railway rebuild"): running / failed / published, and whether the site holds that build
    ["Errors (last 2 days)", (st.errors || []).length ? st.errors.map((e) => `<div class="y">${hm(e.t)} · ${esc(e.msg)}</div>`).join("") : '<span class="g">none</span>'],
    ["Model service (Railway)", st.railway ? (st.railway.ok ? `answering · ${st.railway.ms} ms` : `<span class="r">NOT answering${st.railway.code ? " (HTTP " + st.railway.code + ")" : st.railway.err ? " (" + esc(st.railway.err) + ")" : ""}</span>`) : "—"],
    ["Database used", st.usedMb != null ? `${st.usedMb.toFixed(1)} of ${st.capMb} MB` : "—"],
    ["Sportsbook credits left", st.creditWarning ? `<span class="y">${st.credits ?? "—"}</span>` : (st.credits ?? "—")],
  ].map(([a, b]) => `<div class="row"${/<div/.test(String(b)) ? ' style="grid-column:1/-1"' : ""}><span class="dim">${a}</span><span>${dateLast(b)}</span></div>`).join("") +
    (st.creditWarning ? `<div class="s y">⚠ ${esc(st.creditWarning)}</div>` : "") +
    "" : "";
  GBG_RES = res; const games = gbgHtml();
  // 10/19: every listed player except those known to have sat (snap counts post a day or two later; until then everyone listed counts)
  const recapTd = (() => { const tdW = wk.flatMap((r) => r.td || []), td = tdW.filter((p) => p.played !== false && p.fair != null); if (!tdW.length) return "";
      const exp = td.reduce((a, p) => a + p.fair, 0) / 100, hit = td.filter((p) => p.scored).length;
      return `<div class="row"><span class="dim">Listed players</span><span>${hit} of ${td.length} scored · model expected ${exp.toFixed(1)}</span></div>`; })();
  const topTd = (() => { const byTeam = {}; for (const r of res) for (const p of (r.td || []).filter((x) => x.played === true)) (byTeam[r.game + "|" + p.team] = byTeam[r.game + "|" + p.team] || []).push(p);
      const top = (n) => Object.values(byTeam).flatMap((ps) => ps.slice().sort((a, b) => b.fair - a.fair).slice(0, n));
      const line = (lab, L) => L.length ? `<div class="row plain"><span class="dim">${lab}</span><span>${L.filter((p) => p.scored).length} of ${L.length} scored · exp ${(L.reduce((a, p) => a + p.fair, 0) / 100).toFixed(1)}</span></div>` : "";
      const t1 = top(1), t2 = top(2);
      const all = Object.values(byTeam).flat();
      const two = all.filter((p) => p.two != null), ftd = all.filter((p) => p.ftd != null);
      const extra = (two.length ? `<div class="row plain"><span class="dim">2+ TDs</span><span>${two.filter((p) => p.twoHit).length} · exp ${(two.reduce((a, p) => a + p.two, 0) / 100).toFixed(1)}</span></div>` : "") +
        (ftd.length ? `<div class="row plain"><span class="dim">First TD</span><span>${ftd.filter((p) => p.ftdHit).length} · exp ${(ftd.reduce((a, p) => a + p.ftd, 0) / 100).toFixed(1)}</span></div>` : "") + firstTdRecord(res);
      return t1.length ? `${line("#1 per team", t1)}${line("Top 2 per team", t2)}${extra}` : '<div class="s empty">None yet.</div>'; })();
  const wcRows = `<div class="row"><span class="dim">Week ${S.week} loaded</span><span>${plural(wc.games, "game")} · lines ${wc.withLines}/${wc.games} · model ${wc.modelRun ? '<span class="g">✓</span>' : '<span class="y">not run yet</span>'}</span></div>` +
    ((wc.watch || []).length ? `<div class="s" style="margin-top:6px"><b class="y">Watchdog</b>${wc.watch.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}</div>` : '<div class="s dim" style="margin-top:6px"></div>');
  $("models").innerHTML = labStats() +
    mSec("m-line", "1 · Card picks", cardRecBox() + `<div class="s" style="margin-top:8px;grid-column:1/-1"><b>Game by game</b></div><div id="gbg" style="grid-column:1/-1">${games || '<div class="s empty">None yet.</div>'}</div>`) +
    mSec("m-win", "2 · Winners · moneyline", `<div class="s"><b>By chance at kickoff</b></div>` + winnersBands() + winnersBox()) +
    mSec("m-board", "3 · Parlay scoreboard", LAB_SB || '<div class="s">Loading…</div>') +
    mSec("m-td", "4 · Touchdowns", (recapTd ? `<div class="s"><b>Week ${lw ?? S.week}</b></div>` + recapTd : "") + `<div class="s" style="margin-top:8px"><b>Chances vs results</b></div>` + (tdWaiting ? `<div class="s y">${tdWaiting} waiting for snap counts</div>` : "") + (buckets ? tHead(["AVG SAID", "SCORED", "CHECK"], "tv") + buckets : '<div class="s empty">None yet.</div>') + `<div class="s" style="margin-top:8px"><b>Top scorers</b></div>` + topTd +
      (() => { const pl = tdPlayersWithDefense(res); return `<div class="s" style="margin-top:8px"><b>By position</b></div>` + tdByPosition(pl) + `<div class="s" style="margin-top:8px"><b>By opponent defense</b></div>` + tdByDefense(pl); })() +
      `<div class="s" style="margin-top:8px"><b>Vs Polymarket</b></div>` + (vsMkt || '<div class="s empty">None yet.</div>')) +
    mSec("m-ang", "5 · Tracked angles", pickLabBox()) +
    mSec("m-sys", "6 · System", wcRows + stRows, (wc.watch || []).length + (stOk ? 0 : 1)) +   // 10/28 late (owner: "Keep system close when I open this tab"): never opens by itself, the ⚠ count says it
    `<div class="center"><button class="btn" id="export-btn">Export data</button></div>`;
  paintBox($("models"));
  $("export-btn").onclick = () => (window.location.href = "/api/results/export");
  if ($("win-all")) $("win-all").onclick = () => { WINALL = !WINALL; renderModel(); };
}
// Color code (10/9): records green at 55%+ won, yellow 50-55%, red under 50%; status words green; dates and times dimmed.
function paint(html) {
  return html.replace(/>([^<>]+)</g, (all, t) => ">" + t
    .replace(/(^|[^\d/.])(\d{1,4})–(\d{1,4})(?![\d/%])/g, (m, pre, w, l) => { const n = +w + +l; if (!n) return m; const r = +w / n; return `${pre}<b class="${r >= 0.55 ? "g" : r >= 0.5 ? "y" : "r"}">${w}–${l}</b>`; })
    .replace(/\b(OK|all clear|saved|kept current|new model live)\b/g, '<span class="g">$1</span>')
    .replace(/\b((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2}\/\d{1,2}, \d{1,2}:\d{2}\s?(?:AM|PM))/g, '<span class="dim">$1</span>') + "<");
}
function paintBox(el) { if (el) el.innerHTML = paint(el.innerHTML); }
// What ESPN said about kickoff times on the last check (10/8): which games it moved, or why the check failed.
// 10/28 (owner: "If there's a time and date. Put it last"): a System line that starts with a date / time ("Mon, 10/26, 5:40 PM · ...") gets the date moved to its end
const dateLast = (v) => { const one = (x) => { const m = /^((?:[A-Za-z]{3}, )?\d{1,2}\/\d{1,2},? \d{1,2}:\d{2}\s?[AP]M) · ([\s\S]+)$/.exec(x); return m ? `${m[2]} · ${m[1]}` : x; };
  const s = String(v); return /<div/.test(s) ? s.replace(/(<div[^>]*>)([\s\S]*?)(<\/div>)/g, (_, a, b, c) => a + one(b) + c) : one(s); };
function kickLine(k) {
  if (!k) return '<span class="dim">not run yet</span>';
  if (!k.ok) return `<span class="r">${hm(k.t)} · failed: ${esc(k.error || "")}</span>`;
  const mv = (k.moved || []).map((m) => `${esc(m.game)} ${tm(m.was)} → ${tm(m.now)}`).join(" · ");
  return `${hm(k.t)} · ${plural(k.espnGames, "game")} from ESPN · ${mv ? `<span class="y">moved: ${mv}</span>` : "OK"}`;
}
function renderMine() { keepOpenState("record-mine", renderMineNow); }
function renderModel() { keepOpenState("models", renderModelNow); }
function renderRecord() { renderMine(); renderModel(); }
// "Updated" line at the top of Models and Bets, so you can tell the numbers are fresh (they reload every 2 minutes while you are on the tab).
function stampUpdated() { const t = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); for (const id of ["upd-record", "upd-models"]) { const e = $(id); if (e) e.textContent = `Updated ${t}`; } }
async function loadRecord(sync = false) {
  if (sync) toast("Syncing…", 0);
  try {
    const [mb, rl] = await Promise.all([fetch(`/api/mybets${sync ? "?sync=1" : ""}`, { cache: "no-store" }).then((r) => r.json()), fetch("/api/results/list", { cache: "no-store" }).then((r) => r.json())]);
    if (!mb.ok) throw new Error(mb.error); stampUpdated(); MB = mb; RES = rl.ok ? rl.results : []; PAPER = rl.ok ? rl.paper : null; TRACKED = rl.ok ? rl.tracked || null : null; COMBOS = rl.ok ? rl.combos || null : null; renderLab();
    renderRecord();
    if (sync && mb.sync) toast(mb.sync.ok ? `Synced ${mb.sync.positions} positions.` : `Sync: ${mb.sync.note}`);
  } catch (e) { toast("Record failed: " + e.message, 10000); }
}
const hitCls = (h) => (h == null ? "dim" : h >= 0.55 ? "g" : h >= 0.5 ? "y" : "r");   // green 55%+, amber 50-55%, red under 50%
function statTile(label, w, l, hit, sub) {
  return `<div class="stat"><div class="k">${label}</div><div class="v ${hitCls(hit)}">${hit == null ? "—" : `${w}–${l}`}</div><div class="k2">${hit == null ? "—" : `${Math.round(hit * 100)}% ${sub}`}</div></div>`;
}
function labStats() {
  const W = (S && S.winners && S.winners.all) || {};
  // 10/19: the spread/total tiles = the card's PICK locked at kickoff (rule or model side) from the week the new card started -- the same picks as
  // "1 · Card picks" and game by game; LINE VALUE = those picks' kickoff line vs the line they were first shown at.
  const C = (COMBOS && COMBOS.card) || { spread: { w: 0, l: 0 }, total: { w: 0, l: 0 } }, cs = C.spread, ct = C.total;
  const ch = (x) => (x.w + x.l ? x.w / (x.w + x.l) : null);
  // 10/13 CLV tracker: points gained vs the closing line on graded card picks (first number shown vs the number at kickoff)
  const V = C.clv || { n: 0 }, av = V.n ? V.sum / V.n : null;
  const clvTile = `<div class="stat" style="grid-column:1/-1"><div class="k">LINE VALUE</div><div class="v ${av == null ? "dim" : av > 0 ? "g" : av < 0 ? "r" : "y"}">${av == null ? "—" : `${av > 0 ? "+" : av < 0 ? "−" : ""}${Math.abs(av).toFixed(2)}`}</div><div class="k2">${av == null ? "starts this week" : `pts vs close · beat it ${Math.round((100 * V.beat) / V.n)}% · ${plural(V.n, "pick")}`}</div></div>`;
  const fw = C.from ? ` · wk ${C.from}+` : "";
  return `<div class="stats">${statTile("MONEYLINE", W.w, W.l, W.n ? W.hit : null, "right")}${statTile("SPREAD PICKS", cs.w, cs.l, ch(cs), "covered" + fw)}${statTile("TOTAL PICKS", ct.w, ct.l, ch(ct), "right" + fw)}${clvTile}</div>`;
}
function pickLabBox() {
  // paper tests recorded and graded live, not picks: INJURY EARLY, TD JUMP, STACK (the Pinnacle LINE MOVE / order-book tilt shadows were cut 10/19)
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh ihd">Tracked angles${IBTN}</div>${ibox(TRACK_INFO)}${trackedRows()}</div></div>`;
}
function trackedRows() {
  const T = TRACKED; if (!T) return "";
  const rr = (x) => (x && x.n ? `${x.w}–${x.l}` : "—");
  const tj = T.tdjump && (T.tdjump.n || T.tdjump.recorded) ? `<div class="row"><span class="dim">TD JUMP (shadow) · chance up 10+ pts</span><span>${T.tdjump.n ? `${T.tdjump.w}–${T.tdjump.l} · ${Math.round(100 * T.tdjump.hit)}%${T.tdjump.said != null ? ` · said ${Math.round(T.tdjump.said)}%` : ""}` : `${T.tdjump.recorded} recorded`}</span></div>` : "";
  const ie = T.injearly && (T.injearly.n || T.injearly.recorded) ? `<div class="row"><span class="dim">INJURY EARLY (shadow)${(T.injearly.fresh && T.injearly.fresh.n) || (T.injearly.cont && T.injearly.cont.n) ? ` · new injury ${rr(T.injearly.fresh)} · continuing ${rr(T.injearly.cont)}` : ""}</span><span>${T.injearly.n ? `${T.injearly.w}–${T.injearly.l} · ${Math.round(100 * T.injearly.hit)}%` : `${T.injearly.recorded} saved`}</span></div>` : "";
  const wd = T.wide && (T.wide.n || T.wide.recorded) ? `<div class="row"><span class="dim">WIDE (shadow)${T.wide.confident && (T.wide.confident.n || (T.wide.rest && T.wide.rest.n)) ? ` · confident ${rr(T.wide.confident)} · rest ${rr(T.wide.rest)}` : ""}</span><span>${T.wide.n ? `${T.wide.w}–${T.wide.l} · ${Math.round(100 * T.wide.hit)}%` : `${T.wide.recorded} saved`}</span></div>` : "";   // 10/27 WIDE shadow
  const sk = T.stack && (T.stack.n || T.stack.recorded) ? `<div class="row"><span class="dim">STACK (shadow)${T.stack.confident && T.stack.confident.n ? ` · confident ${rr(T.stack.confident)} · rest ${rr(T.stack.rest)}` : ""}</span><span>${T.stack.n ? `${T.stack.w}–${T.stack.l} · ${Math.round(100 * T.stack.hit)}%` : `${T.stack.recorded} saved`}</span></div>` : "";   // 10/21 STACK shadow
  return wd + sk + ie + tj || '<div class="s dim empty">None yet.</div>';
}
// Decision model (10/9): straight bets only (no teasers, no alt lines), ONE pick per game per market (spread, total): the one
// with the best record. Two angles on opposite sides of the same total no longer both show.
// Small samples (10/11): a pick resting on fewer than SMALL_N games (the this-season-only angles, e.g. "2-1 this season") shows its
// game count and never outranks a long-tested pick: in each market the tested pick wins, and a small-sample pick is used only when the
// market has no tested pick at all. Week 5: MIA +6.5 "67%" (3 games) beat CIN -6.5 55% (tested since 2014) to the top; CIN covered.
const SMALL_N = 60;
const isSmall = (x) => x.n != null && x.n < SMALL_N;
function straightPicks(g, min = BEST_MIN) {
  if (!g || g.started || g.final) return [];
  const out = [], games = (n) => (n != null && n < SMALL_N ? ` · ${n} game${n === 1 ? "" : "s"}` : "");
  if (cardOf(g, "spread") || cardOf(g, "total") || cardOf(g, "ml")) {   // 10/15 (owner): Best bets / Parlay of the week / winners use the card's PICK at Polymarket's own line; green = win rate 56%+
    for (const k of ["spread", "total", "ml"]) { const x = (cardOf(g, k) || {}).plain; if (!x) continue; const r = (g.combos || []).find((c) => c.id === x.ruleId);   // 10/23 night: the ML pick too
      out.push({ pick: x.pick, game: g.key, why: (x.why || "") + games(x.n), p: x.hit / 100, rec: r ? r.rec : null, n: x.n ?? null, price: x.price ?? null, cushion: x.cushion ?? null, plain: null, green: clsOf(x.hit) === "g" }); }
    return out.filter((x) => (min > 0 ? x.green : x.p > min)).sort((a, b) => (isSmall(a) - isSmall(b)) || b.p - a.p);
  }
  // 10/12: picks come from g.combos (the tested rules since 10/16; the chooser before that). Angles and the "total fell" rule
  // were dropped as picks: their rates were measured on the same games they were chosen from.
  for (const c of g.combos || []) if (!c.teaser) out.push({ pick: c.pick, game: g.key, why: c.why + games(c.n), p: c.hit / 100, rec: c.rec, n: c.n ?? null, price: c.price ?? null, plain: c.plain ?? null });
  const best = {}, better = (x, y) => (isSmall(x) !== isSmall(y) ? !isSmall(x) : x.p > y.p);
  for (const x of out) { const k = /^(Over|Under)\b/.test(x.pick) ? "total" : /\bML\b/.test(x.pick) ? "ml" : "spread"; if (!best[k] || better(x, best[k])) best[k] = x; }
  return Object.values(best).filter((x) => x.p >= min).sort((a, b) => (isSmall(a) - isSmall(b)) || b.p - a.p);
}
// Only picks that won 56%+ (a coin flip is 50%), and only the top 10 of the week, so the list stays short.
const BEST_MIN = 0.56, BEST_MAX = 10;
function bestBets() {
  const out = [];
  for (const g of (S && S.games) || []) for (const x of straightPicks(g)) out.push({ ...x, slot: slotOf(g) });
  return out.sort((a, b) => (isSmall(a) - isSmall(b)) || b.p - a.p).slice(0, BEST_MAX);   // tested picks first (10/11)
}
// Parlay of the week (10/9): the strongest green picks, one per game (up to 3 -- 10/19 owner: "three max"), and the chance all of them hit.
function parlayPicks() {
  const seen = new Set(), out = [];
  for (const x of bestBets()) { if (seen.has(x.game)) continue; seen.add(x.game); out.push(x); if (out.length === 3) break; }
  return out.length >= 2 ? out : [];
}
function parlayStrip() {
  const P = parlayPicks(); if (!P.length) return "";
  const ch = P.reduce((a, x) => a * x.p, 1);
  const rows = P.map((x) => `<div class="bb"><div class="t1"><b class="g">${esc(x.pick)}</b><span style="white-space:nowrap">${Math.round(x.p * 100)}%</span></div><div class="t2">${esc(x.game)}</div></div>`).join("");
  return `<div id="parlaylist"><div class="card modelglow"><div class="inner">${rows}<div class="s" style="margin-top:8px">Chance all ${P.length} hit: <b>${Math.round(ch * 100)}%</b> · one pick per game</div></div></div></div>`;
}
// Morning / afternoon / primetime (10/9): TNF/SNF/MNF and anything starting 5 PM or later (your time) is primetime.
function slotOf(g) {
  if (!g || !g.kickoff) return "Afternoon";
  if (/TNF|SNF|MNF/.test(g.badge || "")) return "Primetime";
  const h = new Date(g.kickoff).getHours();
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Primetime";
}
// Remembered open/closed (10/9): the page redraws every few seconds during games, which kept reopening the list.
let GAMEBEST_OPEN = (() => { try { return localStorage.getItem("gameBestOpen") !== "0"; } catch { return true; } })();
let BEST_OPEN = (() => { try { return localStorage.getItem("bestOpen") !== "0"; } catch { return true; } })();
function ticketRows() {   // 10/22 (owner): Best bets / Parlay of the week as rows of the My bets top card; a tap opens the list under the card
  const B = bestBets(), P = parlayPicks(); if (!B.length && !P.length) return { rows: "", drops: "" };
  const ch = P.length ? Math.round(P.reduce((a, x) => a * x.p, 1) * 100) : null;
  return { rows: (B.length ? `<div class="row mbt" data-drop="bestdrop"><span class="dim">Best bets</span><span>${B.length} green pick${B.length === 1 ? "" : "s"} <i class="car">▾</i></span></div>` : "") +
      (P.length ? `<div class="row mbt" data-drop="parlaydrop"><span class="dim">Parlay of the week</span><span>${ch}% · all ${P.length} hit <i class="car">▾</i></span></div>` : ""),
    drops: (B.length ? `<div class="drop" id="bestdrop">${bestStrip()}</div>` : "") + (P.length ? `<div class="drop" id="parlaydrop">${parlayStrip()}</div>` : "") };
}
function bestStrip() {
  const B = bestBets(); if (!B.length) return "";
  const row = (x) => `<div class="bb"><div class="t1"><b class="g">${esc(x.pick)}</b><span style="white-space:nowrap">wins <b class="g">${Math.round(x.p * 100)}%</b></span></div><div class="t2">${esc(x.game)} · ${esc(x.why)}</div></div>`;
  const rows = ["Morning", "Afternoon", "Primetime"].map((sl) => { const xs = B.filter((x) => x.slot === sl); return xs.length ? `<div class="sh" style="margin:8px 0 4px">${sl.toUpperCase()}</div>${xs.map(row).join("")}` : ""; }).join("");
  return `<div id="bestlist"><div class="card modelglow"><div class="inner">${rows}</div></div></div>`;   // 10/14 owner: model picks glow purple
}
let LAB_SB = "";
function renderLab() {
  if (!$("lab")) return;
  if (!PAPER) { renderLabList(); return; }
  const names = PAPER.names || {}, board = PAPER.board || {};
  // Scoreboard (10/14, owner: "organize it"): the parlays still built, grouped; this season W-L and hit %, then the tested history.
  const GROUPS = [["SAME GAME", [["sgp_best", "2 legs"], ["sgp_best_fill", "2 legs · filled"], ["sgp_3", "3 legs"], ["sgp_upset", "Upset · dog wins + its RB scores"], ["sgp_st", "Spread + total"]]],
    ["BEST BETS", [["best_2", "Top 2 picks"], ["best_3", "Top 3 picks"]]],
    ["TOUCHDOWNS", [["td_likely_2", "2 likeliest scorers"], ["td_likely_3", "3 likeliest scorers"]]],
    ["PLAYER PROPS", [["pp6", "6 legs"], ["pp8", "8 legs"], ["pp10", "10 legs"]]]];   // 10/19: 3 legs at most (the 4-leg rows are gone; their saved records stay)
  const TESTED = { sgp_best_fill: 49.5, sgp_3: 31.4, sgp_upset: 25.1, td_likely_2: 48.1, td_likely_3: 33.8 };   // research (CLAUDE.md); same-game rates = the 10/19 filters with the 10/26 55% scorer bar, 2019-25; TD pair / triple = walk-forward TD model 2021-25 with the 55% bar (79 / 68 weeks); Upset = history only (not built since 10/26)
  const hist = (k) => (TESTED[k] != null ? `${TESTED[k]}%` : "—");
  const now = (k) => { const b = board[k]; if (!b || !b.decided) return '<span class="dim">waiting</span>'; const l = b.decided - b.hits;
    return `${b.hits}–${l} · ${Math.round((b.hits / b.decided) * 100)}%${b.money != null ? ` <span class="${b.money >= 0 ? "g" : "r"}">${b.money >= 0 ? "+" : "−"}$${Math.abs(Math.round(b.money))}</span>` : ""}`; };
  const tag = (k) => { const rv = board[k] && board[k].review; if (!rv || /TOO FEW|WAITING/i.test(rv.verdict)) return ""; const c = { HOLDS: "g", UNDERSTATED: "g", PAYING: "g", OVERSTATED: "r", LOSING: "r" }[rv.verdict] || "dim"; return ` <b class="${c}" style="font-size:10px">${esc(rv.verdict)}</b>`; };
  const grid = "display:grid;grid-template-columns:1fr auto auto;gap:4px 14px;align-items:baseline";
  const rows = `<div style="${grid};margin-bottom:6px"><span></span><span class="dim" style="font-size:11px;text-align:right">THIS SEASON</span><span class="dim" style="font-size:11px;text-align:right">PAST SEASONS</span></div>` +
    GROUPS.map(([title, ks]) => { const live = ks.filter(([k]) => names[k]); return live.length ? `<div class="dim" style="font-size:11px;letter-spacing:.06em;margin:10px 0 4px">${title}</div><div style="${grid}">` +
      live.map(([k, label]) => `<span>${esc(label)}${tag(k)}</span><span style="text-align:right">${now(k)}</span><span class="dim" style="text-align:right">${hist(k)}</span>`).join("") + `</div>` : ""; }).join("");
  // 10/17 (owner: "are you learning from it"): every graded leg this season by kind, and which kind lost the parlays
  const LK = [["td", "TD"], ["spread", "Spread"], ["ml", "Moneyline"], ["over", "Over"], ["under", "Under"]], lg = PAPER.legs || {}, kl = PAPER.killers || {};
  const legRows = LK.filter(([k]) => lg[k] && lg[k].w + lg[k].l).map(([k, lab]) => { const x = lg[k], n = x.w + x.l, pct = Math.round((x.w / n) * 100); return `<span>${lab} legs</span><span style="text-align:right">${x.w}–${x.l} · <span class="${pct >= 56 ? "g" : pct >= 50 ? "y" : "r"}">${pct}%</span></span><span class="dim" style="text-align:right">${kl[k] ? `lost ${kl[k]} parlay${kl[k] === 1 ? "" : "s"}` : "—"}</span>`; }).join("");
  const legBlock = legRows ? `<div class="dim" style="font-size:11px;letter-spacing:.06em;margin:0 0 4px">LEGS · THIS SEASON</div><div style="${grid};margin-bottom:12px">${legRows}</div>` : "";
  LAB_SB = `${legBlock}${rows}`;   // 10/15 (owner): lives in the Models tab, closed until you open it
  renderLabList();
  if (MB && RES) renderModel();   // the Models tab reads the same data
}

// ---------- v2: tiles, tap-a-game view, countdown, alerts ----------
// Live Polymarket lines for a game in progress (10/1). Display only: the model, picks, kickoff line and grades stay locked.
let LIVE = {}, LIVE_T = null, LIVE_SC = {};
const ago = (iso) => { const sec = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return sec < 60 ? sec + "s ago" : Math.round(sec / 60) + " min ago"; };
const liveFor = (g) => (g.started && !g.final && Object.prototype.hasOwnProperty.call(LIVE, g.key) ? { poly: LIVE[g.key] } : null);
// 10/23 (owner: "the kick off line. Just the spread and ml numbers"): the line and the moneyline, no prices
function lockedLine(g, kind) {
  const p = g.poly || {};
  if (kind === "total") return p.total ? `${p.total.line}` : "—";
  const fav = p.spread ? (p.spread.homeSpread <= 0 ? [g.home, p.spread.homeSpread] : [g.away, -p.spread.homeSpread]) : null;
  const mlf = p.ml ? (p.ml.home >= p.ml.away ? [g.home, p.ml.home] : [g.away, p.ml.away]) : null;
  return `${fav ? `${fav[0]} ${sgn(fav[1])}` : "—"}${mlf ? ` · ML ${mlf[0]} ${odds(toAmerican(mlf[1]))}` : ""}`;
}
const liveHas = (lv, kind) => !!(lv && lv.poly && (kind === "total" ? lv.poly.total : lv.poly.spread || lv.poly.ml));
const lockedNote = (g, kind) => `<div class="s dim" style="margin-top:6px">Kickoff: ${lockedLine(g, kind)}</div>`;
// 10/23 (owner): LIVE · 1s ago sits on the right of the POLYMARKET header (no "updated"); a game not started shows nothing there
const pmHead = (g, lv, kind) => `<div class="k pmk"><span>${pmLogo()}POLYMARKET</span>${lv ? `<span class="pmt"><span class="r">LIVE</span>${liveHas(lv, kind) ? ` · ${LIVE_T ? ago(LIVE_T) : "0s ago"}` : ""}</span>` : ""}</div>`;
function liveHead(g, lv, kind) {
  if (!lv) return "";
  return liveHas(lv, kind) ? "" : `<div class="s y">Lines paused.</div>${lockedNote(g, kind)}`;
}
const liveTail = (g, lv, kind) => (liveHas(lv, kind) ? lockedNote(g, kind) : "");
function refreshDetail() { const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean); renderLines(); for (const id of open) { const e = $(id); if (e) e.classList.add("open"); } }
const anyLive = () => !!(S && S.games && S.games.some((g) => g.started && !g.final));
async function loadLive() {
  const rec = $("panel-record").classList.contains("on");
  if (!anyLive() || document.hidden || !($("panel-lines").classList.contains("on") || rec)) return;
  try { const d = await (await fetch("/api/live", { cache: "no-store" })).json();
    if (d.ok) { LIVE = d.games || {}; LIVE_SC = d.scores || {}; LIVE_T = d.t; if (rec) { if (MB) renderMine(); } else if (DETAIL) refreshDetail(); else renderLines(); } } catch {}
}
function liveLoop() { clearTimeout(liveLoop._h); loadLive().finally(() => { liveLoop._h = setTimeout(liveLoop, 30000); }); }
let DETAIL = null, LASTY = 0, ALERTS = [], ALPREV = null;
const pmLogo = () => '<span class="pm"><img src="/polymarket.png" alt=""></span>';   // 10/20 night (owner): the real Polymarket logo everywhere
const injBadge = (team) => `<span class="injb"><img src="${logoUrl(team)}" alt="" onerror="this.style.visibility='hidden'"><u>+</u></span>`;
const injBadgeFor = (g) => { const inj = g.model && g.model.inj; if (!inj) return ""; const t = inj.home.players.length ? g.home : inj.away.players.length ? g.away : null; return t ? injBadge(t) : ""; };
const recOf = (g, t) => (g.rec && g.rec[t] ? `<small class="rec">${esc(g.rec[t])}</small>` : "");   // season record under the team code (10/8)
// Market's win chance (home %) on the tile and the game page (10/17, owner): Polymarket's moneyline with its fee taken out (each side's price / both),
// its own win price. It used to come from the spread, so a coin flip with NO -1.5 read NO 56% while the moneyline said 50/50. No moneyline -> the spread.
const mktHome = (g) => { const m = g.poly && g.poly.ml; return m && m.home > 0 && m.home < 1 && m.away > 0 && m.away < 1 ? (100 * m.home) / (m.home + m.away) : g.winPct != null && isFinite(g.winPct) ? Number(g.winPct) : null; };
// 10/23 (owner: "If the game is done can you put the models win/lost?"): a finished tile shows the card's picks locked at kickoff / tip-off,
// ✓ green / ✗ red / push gray. The saved grade when there is one, else graded here from the final score (the grade run comes later at night).
const normRes = (r) => (r === "W" || r === "win" ? "W" : r === "L" || r === "loss" ? "L" : r === "P" || r === "push" ? "P" : r === "void" ? "V" : null);
function pickRes(label, away, home, as, hs) {
  const s = String(label || "").replace(/−/g, "-").trim(), num = (x) => (/^pk$/i.test(x) ? 0 : Number(x));
  if (!isFinite(as) || !isFinite(hs)) return null;
  let m = s.match(/^(Over|Under) ([\d.]+)$/i);
  if (m) { const d = as + hs - Number(m[2]); return d === 0 ? "P" : (d > 0) === /^o/i.test(m[1]) ? "W" : "L"; }
  m = s.match(/^(\S+) ML$/i);
  if (m) { const mine = m[1] === away ? as : m[1] === home ? hs : null; if (mine == null) return null; const o = m[1] === away ? hs : as; return mine === o ? "P" : mine > o ? "W" : "L"; }
  m = s.match(/^(\S+) ([+-]?[\d.]+|pk)$/i);
  if (m) { const mine = m[1] === away ? as : m[1] === home ? hs : null; if (mine == null) return null; const d = mine + num(m[2]) - (m[1] === away ? hs : as); return d === 0 ? "P" : d > 0 ? "W" : "L"; }
  return null;
}
function resLine(picks, away, home, as, hs) {
  const out = (picks || []).filter((p) => p && p.label).map((p) => {
    const r = normRes(p.result) || pickRes(p.label, away, home, as, hs), lbl = String(p.label).replace(/^Over /, "O ").replace(/^Under /, "U ");
    return `<span class="${r === "W" ? "g" : r === "L" ? "r" : "dim"}">${esc(lbl)} ${r === "W" ? "✓" : r === "L" ? "✗" : r === "P" ? "push" : r === "V" ? "void" : ""}</span>`;
  });
  return out.length ? `<div class="tres">${out.join('<span class="dim"> · </span>')}</div>` : "";
}
// NFL: the card's PICK (spread, total) + the ML pick, locked at kickoff
const nflRes = (g, as, hs) => { const L = g.lockedPicks; return L ? resLine(["spread", "total", "ml"].map((k) => L[k] && { label: L[k].pick, result: L[k].result }), g.away, g.home, as, hs) : ""; };
function tile(g) {
  const sc = g.started && !g.final ? LIVE_SC[g.key] : null;   // live score from ESPN (display only)
  const hp = mktHome(g), ap = hp == null ? null : 100 - hp;
  const lead = (v, o) => (v >= o ? "mkt" : "dim");
  const chips = [!g.started && g.kickoff ? `<span class="chip tmt">${esc(tm(g.kickoff))}</span>` : "", g.badge ? `<span class="chip c-amb">${esc(g.badge)}</span>` : "", straightPicks(g).length ? `<span class="chip c-grn">${esc(straightPicks(g)[0].pick)}</span>` : "", g.started && !g.final && !sc ? '<span class="chip c-red">LIVE</span>' : ""].filter(Boolean).join('<span style="display:inline-block;width:6px"></span>');   // 10/14 audit: the "London" and pick pills touched
  const mid = g.final && g.awayScore != null && g.homeScore != null ? `<span class="mid lvmid"><span class="sr"><span class="${g.awayScore > g.homeScore ? "g" : "dim"}">${g.awayScore}</span><span class="dim"> – </span><span class="${g.homeScore > g.awayScore ? "g" : "dim"}">${g.homeScore}</span></span><span class="lv dim">FINAL</span></span>`
    : hp == null ? '<span class="mid dim">—</span>' : `<span class="mid"><span class="${lead(ap, hp)}">${Math.round(ap)}</span><span class="dim"> · </span><span class="${lead(hp, ap)}">${100 - Math.round(ap)}</span><span class="dim" style="font-size:11px">%</span></span>`;
  const mid2 = sc ? `<span class="mid lvmid"><span class="sr"><span class="${sc.a > sc.h ? "g" : "dim"}">${sc.a}</span><span class="dim"> – </span><span class="${sc.h > sc.a ? "g" : "dim"}">${sc.h}</span></span><span class="lv ${sc.st === "post" ? "dim" : "r"}">${sc.st === "post" ? "FINAL" : "● LIVE · " + esc(sc.lbl)}</span></span>` : mid;
  // 10/18 (owner): logo + code + record each side, the % (or score) in the middle with the kickoff time + the pick / London tag under it, the bar; no "starts in".
  // A live tile with its score drops the bar (10/18, same as NBA and home): the bar is the pre-game % the score replaced.
  // 10/18 evening (owner, sketch D): NO big faded logos and NO team colours behind the tile -- a plain 55% dark card so the page picture shows through.
  const res = g.final && g.awayScore != null && g.homeScore != null ? nflRes(g, Number(g.awayScore), Number(g.homeScore)) : sc && sc.st === "post" ? nflRes(g, Number(sc.a), Number(sc.h)) : "";
  return `<button class="tile${g.started && !g.final ? " live" : ""}" data-game="${esc(g.key)}">` +
    `<div class="in"><div class="nm"><span class="t">${thelmet(g.away, "right")}${g.away}${recOf(g, g.away)}</span><div class="tmid">${mid2}${res}${chips ? `<div class="s2">${chips}</div>` : ""}${moveLines(moveBits(g))}</div><span class="t hm">${g.home}${thelmet(g.home, "left")}${recOf(g, g.home)}</span></div>${g.final || sc || hp == null ? "" : `<div class="bar"><i style="width:${ap}%"></i></div>`}</div></button>`;
}
// Graded touchdown results for a finished game (same records the Models tab uses). Loaded once, only when a finished game page opens.
let GRADES = null, GRADES_AT = 0;
async function ensureGrades() {
  if (RES || (GRADES && Date.now() - GRADES_AT < 120000)) return;
  try { const rl = await (await fetch("/api/results/list", { cache: "no-store" })).json(); if (rl && rl.ok) { GRADES = rl.results || []; GRADES_AT = Date.now(); if (DETAIL) { const g = S && S.games.find((x) => x.key === DETAIL); if (g && g.final) renderDetail(g); } } } catch {}
}
// Season record of the first-TD pick: in each graded game, the listed player (who played) with the highest first-TD chance.
function firstTdRecord(res) {
  const picks = (res || []).map((r) => (r.td || []).filter((p) => p.ftd != null && p.played !== false).sort((a, b) => b.ftd - a.ftd)[0]).filter(Boolean);
  if (!picks.length) return "";
  const hit = picks.filter((p) => p.ftdHit).length, said = picks.reduce((a, p) => a + p.ftd, 0) / picks.length;
  const tt = (res || []).map((r) => r.ftdTeam).filter((t) => t && (t.first === "home" || t.first === "away") && t.home != null), th = tt.filter((t) => (t.home >= t.away ? "home" : "away") === t.first).length;
  const teamRow = tt.length ? `<div class="row plain"><span class="dim">First TD team (likelier side)</span><span>${th} of ${tt.length} · ${Math.round(th / tt.length * 100)}% · exp ${Math.round(tt.reduce((a, t) => a + Math.max(t.home, t.away), 0) / tt.length)}%</span></div>` : "";
  return `<div class="row plain"><span class="dim">First TD picks</span><span>${hit} of ${picks.length} · ${Math.round(hit / picks.length * 100)}% · exp ${Math.round(said)}%</span></div>${teamRow}`;
}
function startsIn(g) {
  const ms = new Date(g.kickoff) - Date.now(); if (!(ms > 0)) return "";
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `starts in ${d}d ${h}h` : h ? `starts in ${h}h ${m}m` : `starts in ${m}m`;
}
const TEAM_COLOR = { ARI: "#97233f", ATL: "#a71930", BAL: "#5c2d91", BUF: "#00338d", CAR: "#0085ca", CHI: "#e64100", CIN: "#fb4f14", CLE: "#ff3c00", DAL: "#2a5db0", DEN: "#fb4f14", DET: "#0076b6", GB: "#2f7d4f", HOU: "#c8102e", IND: "#2a6ebb", JAX: "#00a3b5", KC: "#e31837", LV: "#a5acaf", LAC: "#0080c6", LA: "#2a6ebb", LAR: "#2a6ebb", MIA: "#00a6a6", MIN: "#6a3fb0", NE: "#2a5db0", NO: "#d3bc8d", NYG: "#2a5db0", NYJ: "#2f7d4f", PHI: "#00898a", PIT: "#ffb612", SF: "#c8102e", SEA: "#4a8f2a", TB: "#d50a0a", TEN: "#4b92db", WAS: "#7a2236" };
function detailTop(g) {
  const dsc = g.started && !g.final ? LIVE_SC[g.key] : null;
  const hp = mktHome(g), ap = hp == null ? null : Math.round(100 - hp), hr = ap == null ? null : 100 - ap;
  const st = g.final ? `Final ${g.awayScore != null && g.homeScore != null ? `${g.awayScore}–${g.homeScore}` : ""}` : g.started ? '<span class="r">● LIVE</span>' : startsIn(g);
  const ca = TEAM_COLOR[g.away] || "#444", ch = TEAM_COLOR[g.home] || "#444";
  return `<div class="card dtop" style="background:linear-gradient(90deg,${ca}40 0%,${ca}14 50%,${ch}14 50%,${ch}40 100%),var(--card)"><img class="dwm l" src="${logoUrl(g.away)}" alt="" onerror="this.style.display='none'"><img class="dwm r" src="${logoUrl(g.home)}" alt="" onerror="this.style.display='none'"><div class="inner"><div class="nm"><span class="t">${g.away}${recOf(g, g.away)}</span><div class="mid">${g.badge ? `<span class="chip c-amb">${esc(g.badge)}</span>` : ""}${dsc ? `<div class="s2"><b>${dsc.a} – ${dsc.h}</b></div><div class="s3 r">${dsc.st === "post" ? "FINAL" : "● LIVE · " + esc(dsc.lbl)}</div>` : `<div class="s2">${tm(g.kickoff)}</div><div class="s3">${st}</div>`}</div><span class="t hm">${g.home}${recOf(g, g.home)}</span></div>` +
    (hp == null || g.final ? "" : `<div class="wc"><div class="wl"><b class="mkt">${ap}%</b><span class="mkt">MARKET’S WIN CHANCE</span><span class="dim">${hr}%</span></div><div class="bar"><i style="width:${ap}%"></i></div></div>`) + `</div></div>`;
}
// page background on a game page only: team colors in halves with the split logos (away left, home right)
function setBg(g) {
  const el = document.getElementById("bgwm"); if (!el) return;
  if (!g) { el.style.background = ""; el.innerHTML = ""; el.dataset.k = ""; return; }
  const k = g.away + g.home; if (el.dataset.k === k) return; el.dataset.k = k;
  const ca = TEAM_COLOR[g.away] || "#444", ch = TEAM_COLOR[g.home] || "#444";
  el.style.background = `linear-gradient(90deg, ${ca}3d 0%, ${ca}1f 50%, ${ch}1f 50%, ${ch}3d 100%)`;
  // 10/28 (owner: "add the helmets here in the background instead of the logo"): each team's helmet (perthirtysix's matchup helmets, public/helmets),
  // the away helmet facing right on the left, the home one facing left on the right; centered between the pinned top and the bottom of the screen (pinGame)
  el.innerHTML = `<img class="hlm" src="/helmets/right/${g.away}.webp" alt="" onerror="this.src='${logoUrl(g.away)}'"><img class="hlm" src="/helmets/left/${g.home}.webp" alt="" onerror="this.src='${logoUrl(g.home)}'">`;
}
// 10/15 (owner): every parlay is the same block, in one column, like the Bets list:
//   [logo] ARI @ [logo] LA · 67%              [P] PL: 1.7x · $20 → $33   (blue)
//     ✓ ARI +3.5 · 55%        (✓ won, ✗ lost, • pending)
//     • K.Williams TD · 67%
//                                                         ✓ Won / ✗ Lost
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;   // 10/14 audit: "1 picks" / "1 players" / "1 games"
// Polymarket's payout (10/17; same math as lib/combo.js comboPay -- tests check they agree): the links where legs HELP each other count, legs that
// work AGAINST each other add nothing (Polymarket does not pay for them), minus Polymarket's small cut (0.977, fitted on the owner's two real quotes).
const LIFT_FE = { tdCover: 1.19, tdOppCover: 0.81, tdOver: 1.23, tdUnder: 0.77 };
function linkedPay(legs) {
  if (!legs || !legs.length || !legs.every((l) => l.price > 0 && l.price < 1)) return null;
  const side = (l) => l.kind === "spread" || l.kind === "ml";
  let c = legs.reduce((a, l) => a * l.price, 1), up = 1;
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const a = legs[i], b = legs[j]; let f = 1;
    if (a.game && a.game === b.game) {
      if (side(a) && side(b)) { c *= (a.team === b.team ? Math.min(a.price, b.price) : Math.max(0, a.price + b.price - 1)) / (a.price * b.price); continue; }
      const [x, y] = a.kind === "td" ? [a, b] : [b, a];
      if (x.kind === "td") f = side(y) ? (y.team === x.team ? LIFT_FE.tdCover : LIFT_FE.tdOppCover) : y.kind === "total" ? (y.side === "under" || /^Under/.test(y.label || "") ? LIFT_FE.tdUnder : LIFT_FE.tdOver) : 1;
    }
    if (f > 1) up *= f;
  }
  c = Math.min(c * Math.pow(up, 0.75), ...legs.map((l) => l.price));
  return c > 0 ? (legs.length > 1 ? 0.977 : 1) / c : null;
}
const plText = (x, st) => `PL: ${x >= 10 ? Math.round(x) : x.toFixed(1)}x<span class="plw"> · $${st} → </span><span class="g">$${Math.round(st * x)}</span>`;   // owner 10/15: logo + "PL: 7.7x" blue, "$10 →" white, payout green
const plPay = (p) => {
  const x = p && linkedPay(p.legs); if (x == null) return "PL: —";
  return plText(x, p.stake || 10);   // the owner's stake for this parlay type (lib/sgp.js STAKES)
};
// Real Polymarket price (10/17, owner: "I need the real price" / "I need it to update automatically"): every PL line on screen asks Polymarket for a
// live quote of its exact legs by itself (/api/comboquote: asks and closes the request, never buys), one parlay after another, and again every
// 3 minutes while the page is open; the line shows Polymarket's real payout as soon as it comes back (kept across page refreshes). A tap asks
// again right away. Only before kickoff, 2+ legs. Until the first quote (or when Polymarket has none) the line is the estimate above.
const PLQ = {}, PLC = {}, PL_FRESH = 180e3;   // parlays and their real quotes ({ pay, t } or { fail, t }) by legs + stake
const plKey = (p) => p.legs.map((l) => [l.game, l.kind, l.team || "", l.side || "", l.label].join("|")).sort().join("~") + "|" + (p.stake || 10);
function plQuotable(p) {
  if (!p || p.result || !Array.isArray(p.legs) || p.legs.length < 2) return false;
  const games = (S && S.games) || [], gs = p.legs.map((l) => games.find((g) => g.key === l.game));
  return !gs.some((g) => !g || !g.kickoff || g.started || g.final || Date.now() >= new Date(g.kickoff).getTime());
}
function plTap(p) {
  if (!plQuotable(p)) return "";
  const k = plKey(p); PLQ[k] = p; return ` data-q="${encodeURIComponent(k)}" onclick="plQuote(this, true)" style="cursor:pointer"`;
}
// the PL line: Polymarket's real payout once it has come back, else the estimate
function plShown(p) { const c = plQuotable(p) ? PLC[plKey(p)] : null; return c && c.pay > 1 ? plText(c.pay, p.stake || 10) : plPay(p); }
const PLBUSY = new Set();
async function plQuote(el, fresh) {
  const k = decodeURIComponent(el.dataset.q || ""), p = PLQ[k]; if (!p || PLBUSY.has(k)) return; PLBUSY.add(k);
  const same = () => [...document.querySelectorAll(".plb[data-q]")].filter((x) => x.dataset.q === el.dataset.q);
  if (fresh) same().forEach((x) => { x.style.opacity = ".5"; });
  try {
    const kick = {}; for (const g of (S && S.games) || []) if (p.legs.some((l) => l.game === g.key)) kick[g.key] = g.kickoff;
    const legs = p.legs.map((l) => ({ game: l.game, kind: l.kind, team: l.team || null, side: l.side || null, label: l.label, player: l.player || null }));
    const r = await fetch("/api/comboquote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legs, kick, stake: p.stake || 10, fresh: !!fresh }) }).then((x) => x.json());
    if (r && r.ok && r.pay > 1) { PLC[k] = { pay: r.pay, t: Date.now() }; same().forEach((x) => { x.innerHTML = `${pmLogo()} ${plText(r.pay, p.stake || 10)}`; x.title = ""; }); }
    else { PLC[k] = { ...(PLC[k] && PLC[k].pay ? PLC[k] : {}), fail: (r && r.why) || "no quote", t: Date.now() }; same().forEach((x) => { x.title = PLC[k].fail; }); }
  } catch { PLC[k] = { ...(PLC[k] || {}), t: Date.now() }; } finally { same().forEach((x) => { x.style.opacity = ""; }); PLBUSY.delete(k); }
}
// one parlay at a time: the first PL line on screen whose quote is missing or older than 3 minutes
let PLAUTO = false;
async function plAuto() {
  if (PLAUTO) return; PLAUTO = true;
  for (;;) {
    let el = null;
    if (!document.hidden) for (const x of document.querySelectorAll(".plb[data-q]")) {
      if (!x.offsetParent) continue;   // on a page that is not open
      const c = PLC[decodeURIComponent(x.dataset.q)]; if (!c || Date.now() - c.t > PL_FRESH) { el = x; break; }
    }
    if (el) { await plQuote(el, false); await new Promise((r) => setTimeout(r, 300)); } else await new Promise((r) => setTimeout(r, 3000));
  }
}
const legMark = (r) => (r === "W" ? '<span class="g">✓</span>' : r === "L" ? '<span class="r">✗</span>' : r === "P" ? '<span class="dim">–</span>' : "•");
const gameLogos = (key) => { const m = String(key || "").match(/^([A-Z]{2,4}) @ ([A-Z]{2,4})$/); return m ? `<span class="gl">${tlogo(m[1])}${esc(m[1])} @ ${tlogo(m[2])}${esc(m[2])}</span>` : esc(key); };   // 10/22: one unit, never split across lines (NBA "CLE @" / "PHI")
// 10/16 (owner, final): NO logo on any leg line -- logos sit only on the parlay's header (the game names). Plain text legs.
function legLogoLabel(l) { return esc(l.label); }
// title = HTML for the left of the top line; p = the parlay; showGame = show each leg's game (parlays across games)
// 10/22 (owner: "make this into a table format"): every parlay is a small table -- the game / name on top, then LEG | MODEL | POLYMARKET column heads,
// one row per leg (its % purple, its price blue), and a last row with the payout (PL), the parlay's Model % and its result, all in the same columns
// a player prop leg reads like the props rows: the player on top, the bet small under him ("Jaylen Brown" / "PRA Over 19.5")
const legCell = (l, plain) => { const nm = l.name || l.player, lb = String(l.label || "");
  return nm && lb.startsWith(nm + " ") && !/ TD$/.test(lb) ? legTxt(l.result, esc(nm)) + `<div class="ptsub">${esc(lb.slice(nm.length + 1))}</div>` : legTxt(l.result, plain); };
const centsOf = (x) => (x > 0 && x < 1 ? `${Math.round(x * 100)}¢` : "—");
function pBlock(title, p, showGame) {
  if (!p || !Array.isArray(p.legs) || !p.legs.length) return "";
  const pr = typeof p.prob === "number" && isFinite(p.prob) ? p.prob : null;
  const head = `<div class="ptb pth"><span class="pt1">LEG</span><span class="pt2">MODEL</span><span class="pt3">${pmLogo()} POLYMARKET</span></div>`;
  const legs = p.legs.map((l) => `<div class="ptb${l.result === "W" ? " g" : l.result === "L" ? " r" : ""}"><span class="pt1">${legMark(l.result)} ${legCell(l, `${legLogoLabel(l)}${l.bought ? ` · ${l.points} pt${l.points === 1 ? "" : "s"}` : ""}`)}${showGame && l.game ? ` <span class="dim">${gameLogos(l.game)}</span>` : ""}</span><span class="pt2 mod">${legPct(l)}%</span><span class="pt3">${centsOf(l.price)}</span></div>`).join("");
  const res = p.result === "W" ? '<span class="g">✓ Won</span>' : p.result === "L" ? '<span class="r">✗ Lost</span>' : p.result === "P" ? '<span class="dim">Push</span>' : "";
  const foot = `<div class="ptb ptf"><span class="pt1"><span class="plb"${plTap(p)}>${pmLogo()} ${plShown(p)}</span></span><span class="pt2 mod">${pr == null ? "—" : `${Math.round(pr * 100)}%`}</span><span class="pt3">${res}</span></div>`;
  return `<div class="par"><div class="pbh"><span class="pbn">${title}</span></div>${head}${legs}${foot}</div>`;
}
function sgpBox(g) {
  const x = g.sgp; if (!x || g.started || g.final) return "";
  const blocks = [["2 legs", x.best], ["3 legs", x.three], ["Spread + total", x.st]].map(([t, p]) => pBlock(esc(t), p, false)).join("");   // 10/26 night: no Upset
  return blocks ? `<div class="sh" style="margin:16px 2px 0">SAME-GAME PARLAYS</div><div class="pgrid" style="margin-top:6px">${blocks}</div>` : "";
}
// MODEL BETS (10/28 late, owner: "Remove all the sub tabs under models bets and I need sub tabs for all the models picks in the card. SubTab 1. All Game Line
// Picks for all games split by their time. SubTab 2. All Halves and [quarters] ... Do this for player props and game props also" / "I don't want no parlays in
// there no more" / "The sub tabs should look the same as the card layout"): four pick tabs, no parlays. Each = every game's picks of that kind under the
// kickoff-time headers, in the game page's own look (Game Lines / Halves & Quarters / Game Props = the card's Pick lines; Player Props = the props rows + the
// Best TD picks). This week before kickoff from the live slate, after kickoff the copies locked at kickoff; past weeks /api/modelpicks + /api/props.
// ✓ / ✗ once graded; while a game is on (and until its official grade) the live state from ESPN's box score (liveMark, /api/livebox).
const LAB_TABS = [["lines", "Game Lines"], ["halves", "Halves & Quarters"], ["props", "Player Props"], ["gprops", "Game Props"]];
let LABTYPE = "lines", LABWEEK = null, MPICKS = {}, LIVE_BOX = {}, LIVE_BOX_T = 0;
// 10/29 (owner: "Player props need a sub tab for the others. Keep everything separated"): Player Props has its own stat chips -- the game page's, without First TD (not a pick)
const MB_PROPS = [["td", "Anytime TD"], ["recyds", "Rec Yds"], ["rec", "Receptions"], ["rushyds", "Rush Yds"]];
let MBPROP = (() => { try { const v = localStorage.getItem("mbProp:nfl"); return MB_PROPS.some(([k]) => k === v) ? v : "td"; } catch { return "td"; } })();
const mbChips = () => `<div class="gchips mbchips">${MB_PROPS.map(([k, t]) => `<button class="gchip${MBPROP === k ? " on" : ""}" type="button" data-mbprop="${k}">${t}</button>`).join("")}</div>`;
// 10/15 (owner): ONE Bets tab -- My bets on the left (the list as before), Model bets on the right (the model's parlays). The choice is remembered.
let BETSVIEW = (() => { try { return localStorage.getItem("betsView") === "model" ? "model" : "mine"; } catch { return "mine"; } })();
// 10/21 night (owner): a page's drop-downs go to the right of its title (Shell.dd); without the shell (tests) they stay on top of the block
function ddSlot(el, html) { if (typeof Shell !== "undefined" && Shell.dd && el && el.closest) { Shell.dd(el, html); return ""; } return html; }
function applyBetsView() {
  const bt = $("bets-title"); if (bt) bt.innerHTML = BETSVIEW === "model" ? "Model bets" : "My bets";   // 10/27: the parlay type is the chip under the switch
  const m = BETSVIEW === "model", set = (id, on) => { const e = $(id); if (e) e.style.display = on ? "" : "none"; };
  set("record-mine", !m); set("lab", m); set("dd-record-mine", !m); set("dd-lab", m);

  document.querySelectorAll("#bets-sw [data-bv]").forEach((b) => b.classList.toggle("on", b.dataset.bv === BETSVIEW));
  if (m) renderLabList();
}
// PLAYER PROPS (10/20, owner: "rename it player props and have the sub tabs for the best available for all teams grouped up by their games"; bar 62%+, 65%+ since 10/22):
// one page per stat tab -- Anytime TD (the #td page), First TD (the model's first-TD share per game, with Polymarket's price), Rec Yds, Receptions,
// Pass Yds (/api/props: the side the model gives 65%+ in a family that passed the real-line test, one row per player and stat, its highest %).
// Rows sit under the kickoff headers, game by game; a team drop-down filters them; RECORD tile = this tab's graded rows; ✓ / ✗ green / red once graded.
let PROPS = null, PROPWEEK = null, PROPTAB = "recyds", PROPTEAM = "all";
const PROP_TABS = [["td", "Anytime TD"], ["first", "First TD"], ["recyds", "Rec Yds"], ["rec", "Receptions"], ["rushyds", "Rush Yds"]];
const PROP_STAT = { recyds: "rec_yds", rec: "rec", passyds: "pass_yds", rushyds: "rush_yds" };
const tabStats = (st) => (st === "rush_yds" ? ["rush_yds", "scrim_yds"] : [st]);   // 10/28 night: scrimmage-yards Unders ride the Rush Yds tab
const propTabLabel = (k) => (PROP_TABS.find(([t]) => t === k) || [, "Rec Yds"])[1];
async function loadProps() {
  try { const d = await (await fetch(`/api/props${PROPWEEK ? `?week=${PROPWEEK}` : ""}`, { cache: "no-store" })).json(); if (d && d.ok) { PROPS = d; renderProps(); } } catch {}
}
// 10/21: rc === undefined = still loading -> "…" (the Best TD tile read 0–0 for ~7 s before the graded results arrived); null = nothing graded = 0–0
const tileOnly = (h) => h.replace(/^<div class="stats"[^>]*>/, "").replace(/<\/div>$/, "");   // one tile without its row (10/21 night: two record tiles share ONE centered row)
const recTile = (rc, label = "RECORD") => `<div class="stats" style="margin-top:10px"><div class="stat"><div class="k">${label}</div><div class="v ${rc && rc.pct >= 56 ? "g" : rc && rc.pct >= 53 ? "lg" : !rc || rc.pct == null ? "" : "y"}">${rc === undefined ? "…" : `${rc ? rc.w || 0 : 0}–${rc ? rc.l || 0 : 0}`}</div><div class="k2">${!rc || rc.pct == null ? "—" : rc.pct + "% won"}</div></div></div>`;
const teamSel = (teams) => `<div class="wksel"><select id="props-team" aria-label="Team"><option value="all"${PROPTEAM === "all" ? " selected" : ""}>All teams</option>${teams.map((t) => `<option value="${esc(t)}"${PROPTEAM === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
// 10/20 (owner: "label these by Models Chance and Polymarket Prices"; later the same night: "keep all model purple"): the MODEL column is the model's number, purple
// 10/20 night (owner): LAST WK = the player's most recent graded line of the same stat (U 49.5 ✓ 38), or just his number last week when he had no line
const propLast = (p, tag) => { const l = p.last; if (!l) return '<span class="pp5 dim">—</span>';
  if (l.line == null) return `<span class="pp5 dim">${l.actual != null ? Math.round(l.actual * 10) / 10 : "—"}</span>`;
  return `<span class="pp5 ${l.result === "W" ? "g" : "r"}">${l.side === "over" ? "O" : "U"} ${l.line} ${l.result === "W" ? "✓" : "✗"}${l.actual != null ? ` <span class="dim">${Math.round(l.actual * 10) / 10}</span>` : ""}</span>`; };
const propRow = (p) => { const r = p.result || (p.live && p.live.res) || null; return `<div class="pbl ppr${p.first ? " first" : ""}${r === "W" ? " g" : r === "L" ? " r" : ""}"><span class="pp1">${r ? legMark(r) : "•"} ${esc(p.name)}${p.result ? "" : liveBit(p.live && !p.live.res ? p.live : null)}</span><span class="pp2">${p.first ? "First TD" : p.stat === "td" ? "Anytime TD" : `${p.full && p.stat === "rec_yds" ? "Rec Yds " : p.stat === "rec" ? "Rec " : p.stat === "pass_yds" ? "Pass Yds " : p.stat === "rush_yds" ? "Rush Yds " : p.stat === "scrim_yds" ? "Scrim Yds " : ""}${p.side === "over" ? "Over" : "Under"} ${p.line}`}</span>${p.first ? "" : propLast(p)}<span class="pp3 mod">${Math.round((p.cal ?? p.chance) * 100)}%</span><span class="pp4">${p.price != null ? `${Math.round(p.price * 100)}¢` : "—"}</span></div>` };
// 10/28 late: + the Best TD picks ("Anytime TD"), the live state (the stat so far after the name, ✓ / ✗ the moment it can no longer change), p.full = every stat named (Model bets mixes them)
// 10/20 night (owner): the POLYMARKET head carries the Polymarket logo on every props page (both sports); the First TD tab has NO LAST WK column (nothing to grade there)
const propHead = (first) => `<div class="pbl ppr pph${first ? " first" : ""}"><span class="pp1">PLAYER</span><span class="pp2">LINE</span>${first ? "" : '<span class="pp5">LAST WK</span>'}<span class="pp3">MODEL</span><span class="pp4">${pmLogo()}POLYMARKET</span></div>`;
// the rows of one game, split by team (away first, then home, then anyone with no team), each team with its small label (owner: "separate them by teams")
function teamRows(g, row) {
  const teams = [...new Set([g.away, g.home, ...g.picks.map((p) => p.team || "")])].filter((t) => t != null);
  return teams.map((t) => { const rs = g.picks.filter((p) => (p.team || "") === t); return rs.length ? `${t ? `<div class="pbl pteam">${tlogo(t)}${esc(t)}</div>` : ""}${rs.map(row).join("")}` : ""; }).join("");
}
// games (with kickoff + picks) -> blocks under the kickoff headers, like Model bets
function propBlocks(games, row, first) {
  const gs = [...games].sort((a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0));
  const slotTimes = {}; for (const g of gs) if (g.kickoff) { const sl = labSlot(g.kickoff), tt = tm(g.kickoff); (slotTimes[sl] = slotTimes[sl] || []).includes(tt) || slotTimes[sl].push(tt); }
  let lastSlot = null;
  return gs.map((g) => { const sl = g.kickoff ? labSlot(g.kickoff) : null, h = sl && sl !== lastSlot ? `<div class="sh labslot">${sl} <span class="lst">· ${slotTimes[sl].map(esc).join(" · ")}</span></div>` : ""; if (sl) lastSlot = sl;
    // 10/20 night (owner): a game being played says LIVE on its props block -- its rows are the copy locked at kickoff (the rerun never re-scores a started game), graded at the final
    return h + `<div class="par"><div class="pbh c"><span class="pbn">${gameLogos(g.game)}${g.started && !g.final ? ' <span class="lvb">● LIVE</span>' : ""}</span></div>${g.head || ""}${propHead(!!first)}${teamRows(g, row)}</div>`; }).join("");
}
function renderProps() {
  const el = $("props"); if (!el) return;
  const tt = $("props-title"); if (tt) tt.innerHTML = `Player props<span class="ptab"> · ${esc(propTabLabel(PROPTAB))}</span>`;
  if (PROPTAB === "first") return renderFirstTd(el);
  const d = PROPS; if (!d) { el.innerHTML = '<div class="s dim" style="margin-top:12px">Loading…</div>'; return; }
  const stat = PROP_STAT[PROPTAB] || "rec_yds", weeks = d.weeks && d.weeks.length ? d.weeks : [d.week], sel = Number(d.week);
  const wk = `<div class="wksel"><select id="props-wk" aria-label="Week">${weeks.map((w) => `<option value="${w}"${sel === Number(w) ? " selected" : ""}>Week ${w}</option>`).join("")}</select></div>`;
  const all = (d.games || []).map((g) => ({ ...g, picks: (g.picks || []).filter((p) => tabStats(stat).includes(p.stat)) })).filter((g) => g.picks.length);
  const teams = [...new Set(all.flatMap((g) => g.picks.map((p) => p.team).filter(Boolean)))].sort();
  if (PROPTEAM !== "all" && !teams.includes(PROPTEAM)) PROPTEAM = "all";   // 10/27: a team chosen on another week / tab with no rows here would leave "None yet." under a drop-down reading "All teams"
  const games = all.map((g) => ({ ...g, picks: PROPTEAM === "all" ? g.picks : g.picks.filter((p) => p.team === PROPTEAM) })).filter((g) => g.picks.length);
  el.innerHTML = ddSlot(el, wk + teamSel(teams)) + recTile((d.records || {})[stat] || d.record) + (games.length ? `<div class="pgrid" style="margin-top:6px">${propBlocks(games, propRow)}</div>` : '<div class="s dim empty" style="margin-top:12px">None yet.</div>');
  const pw = $("props-wk"); if (pw && pw.tagName === "SELECT") pw.onchange = () => { PROPWEEK = Number(pw.value); loadProps(); };
  const ps = $("props-team"); if (ps && ps.tagName === "SELECT") ps.onchange = () => { PROPTEAM = ps.value; renderProps(); };
}
// First TD tab: each game's three likeliest first scorers (the model's first-TD share, purple) with Polymarket's first-TD price; RECORD = the top pick per game
// (graded in the results as ftd / ftdHit: live 6 of 45 said 17%, history 13.7% of 1,860 said 15.4 -- data, no edge claimed).
function renderFirstTd(el) {
  if (!S || !S.games) { el.innerHTML = '<div class="s dim" style="margin-top:12px">Loading…</div>'; return; }
  const all = firstTdGames();
  const teams = [...new Set(all.flatMap((g) => g.picks.map((p) => p.team).filter(Boolean)))].sort();
  if (PROPTEAM !== "all" && !teams.includes(PROPTEAM)) PROPTEAM = "all";
  const games = all.map((g) => ({ ...g, picks: PROPTEAM === "all" ? g.picks : g.picks.filter((p) => p.team === PROPTEAM) })).filter((g) => g.picks.length);
  const picks = (RES || []).map((r) => (r.td || []).filter((p) => p.ftd != null && p.played !== false).sort((a, b) => b.ftd - a.ftd)[0]).filter(Boolean), hit = picks.filter((p) => p.ftdHit).length;
  const rc = picks.length ? { w: hit, l: picks.length - hit, pct: Math.round((hit / picks.length) * 1000) / 10 } : null;
  const tt = (RES || []).map((r) => r.ftdTeam).filter((t) => t && (t.first === "home" || t.first === "away") && t.home != null), th = tt.filter((t) => (t.home >= t.away ? "home" : "away") === t.first).length;
  const trc = tt.length ? { w: th, l: tt.length - th, pct: Math.round((th / tt.length) * 1000) / 10 } : null;
  el.innerHTML = ddSlot(el, teamSel(teams)) + `<div class="stats" style="margin-top:10px">${tileOnly(recTile(trc, "TEAM RECORD"))}${tileOnly(recTile(rc, "TOP PICK RECORD"))}</div>` + (games.length ? `<div class="pgrid" style="margin-top:6px">${propBlocks(games, propRow, true)}</div>` : '<div class="s dim empty" style="margin-top:12px">None yet.</div>');
  const ps = $("props-team"); if (ps && ps.tagName === "SELECT") ps.onchange = () => { PROPTEAM = ps.value; renderProps(); };
  if (!RES && !renderFirstTd.loading) { renderFirstTd.loading = true; loadRecord().catch(() => {}).finally(() => { renderFirstTd.loading = false; if (PROPTAB === "first") renderProps(); }); }
}
// Time slot of a kickoff for the Model bets headers (your clock): Sunday before 9 = EARLY (London), before noon = 10 AM, before 4 PM = 1 PM, the rest and every weeknight = PRIME TIME
function labSlot(kick) {   // same cutoffs as the Bets tab's kickSlot (Pacific clock): before 9 EARLY, before noon 10 AM, before 5 PM 1 PM, the rest and every weeknight PRIME TIME
  const d = new Date(kick), fmt = (o) => new Intl.DateTimeFormat("en-US", { ...o, timeZone: "America/Los_Angeles" }).format(d), h = Number(fmt({ hour: "numeric", hourCycle: "h23" })), day = fmt({ weekday: "short" }).toUpperCase();
  if (!/SUN|SAT/.test(day)) return `PRIME TIME · ${day}`;
  return h < 9 ? "EARLY" : h < 12 ? "10 AM GAMES" : h < 17 ? "1 PM GAMES" : `PRIME TIME · ${day}`; }
const isCurWk = (wk) => !!(S && Number(wk) === Number(S.week));
function loadModelPicks(wk) {
  if (loadModelPicks[wk]) return; loadModelPicks[wk] = true;
  fetch(`/api/modelpicks?week=${wk}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { MPICKS[wk] = { d: d && d.ok ? d : null, t: Date.now() }; })
    .catch(() => { MPICKS[wk] = { d: null, t: Date.now() }; }).finally(() => { loadModelPicks[wk] = false; if (labOn()) renderLabList(); });
}
const labOn = () => BETSVIEW === "model" && !!$("panel-record") && $("panel-record").classList.contains("on");
// the Best TD picks of a game (55%+, the Anytime TD page's own rule) as prop rows
const tdPicksOf = (g) => (g.td || []).filter((r) => r.fair != null && usable(r) && r.fair >= BEST_TD).map((r) => ({ player: r.player, team: r.team, fair: r.fair, price: r.price ?? null, scored: null }));
// the week's games with their picks: { key, away, home, kickoff, started, final, lines: { spread, total, ml } (each { pick, hit, price, result, pts }), h1pick, gprops, td }
function labGames(wk) {
  const saved = (k) => { const c = MPICKS[k]; return c && c.d ? c.d.games || [] : []; };
  if (!isCurWk(wk)) return saved(wk);
  return ((S && S.games) || []).map((g) => {
    const sv = saved(g.week || S.week).find((x) => x.key === g.key) || {}, pre = !g.started && !g.final;
    const card = (k) => { const C = cardOf(g, k); return C && C.plain ? { pick: C.plain.pick, hit: C.plain.hit, price: C.plain.price, pts: C.pts ? { pick: C.pts.pick, hit: C.pts.hit, price: C.pts.price } : null } : null; };
    const mlc = g.card && g.card.ml && okPick(g.card.ml.plain) ? g.card.ml.plain : null;
    const lines = pre ? { spread: card("spread"), total: card("total"), ml: mlc ? { pick: mlc.pick, hit: mlc.hit, price: okN(mlc.price) ? mlc.price : null } : null } : g.lockedPicks || sv.lines || {};
    return { key: g.key, away: g.away, home: g.home, kickoff: g.kickoff, week: g.week || S.week, started: !!g.started, final: !!g.final, lines,
      h1pick: g.h1pick || sv.h1pick || null, gprops: (g.gprops && g.gprops.length ? g.gprops : sv.gprops) || [], td: !pre && sv.td && sv.td.length ? sv.td : tdPicksOf(g) };
  });
}

const liveTag = (g) => { const b = LIVE_BOX[g.key]; return b && !b.final ? ` <span class="lvb">● LIVE · ${esc(b.lbl || "")}</span>` : !b && g.started && !g.final ? ' <span class="lvb">● LIVE</span>' : ""; };
// 10/29 (owner, Game Lines screenshot: "Make this into a table format"): every Model bets tab is a table like Player Props -- PICK (the bet on top, what kind
// under it) · MODEL (the % in its win-rate colour) · POLYMARKET (the price); ✓ / ✗ in front and the row green / red once graded, the live state after the pick
const pickHead = () => `<div class="pbl ppr pph first"><span class="pp1">PICK</span><span class="pp2">BET</span><span class="pp3">MODEL</span><span class="pp4">${pmLogo()}POLYMARKET</span></div>`;
const pickTr = (x) => { const r = normRes(x.result) || (x.live && x.live.res) || null, h = Number(x.hit), c = h >= 56 ? "g" : h >= 53 ? "lg" : "y";
  return `<div class="pbl ppr first${r === "W" ? " g" : r === "L" ? " r" : ""}"><span class="pp1">${r ? legMark(r) : "•"} ${esc(x.pick)}${r ? "" : liveBit(x.live && !x.live.res ? x.live : null)}</span><span class="pp2">${esc(x.kind)}</span>` +
    `<span class="pp3 ${c}">${isFinite(h) ? `${h >= 56 ? Math.round(h) : Math.floor(h)}%` : "—"}</span><span class="pp4">${x.price > 0 && x.price < 1 ? `${Math.round(x.price * 100)}¢` : "—"}</span></div>`; };
const pickTable = (rows) => (rows.length ? pickHead() + rows.map(pickTr).join("") : "");
// a GAME PROPS label -> the market (on top) and the side (under it): "Total touchdowns Under 5.5" -> ["Total touchdowns", "Under 5.5"]
const gpSplit = (lb) => { const m = /^(.*?) ((?:Over|Under) [\d.]+|Yes|No)$/.exec(String(lb || "")); return m ? [m[1], m[2]] : [String(lb || ""), ""]; };
const LAB_BODY = {
  lines: (g) => { const L = g.lines || {}, row = (x, kind) => (x && x.pick ? { pick: x.pick, kind, hit: x.hit, price: x.price, result: x.result, live: normRes(x.result) ? null : liveMark(g, { kind: "line", label: x.pick }) } : null);
    return pickTable([row(L.spread, "Spread"), row(L.spread && L.spread.pts, "Spread · w/ points"), row(L.ml, "Moneyline"), row(L.total, "Total"), row(L.total && L.total.pts, "Total · w/ points")].filter(Boolean)); },
  halves: (g) => { const k = g.h1pick; return k && k.label ? pickTable([{ pick: k.label, kind: "1st Half spread", hit: k.said, price: k.price, result: k.result, live: k.result ? null : liveMark(g, { kind: "h1", team: k.team, line: k.line }) }]) : ""; },
  gprops: (g) => pickTable((g.gprops || []).map((k) => { const [mk, side] = gpSplit(k.label);
    return { pick: mk, kind: k.fam === "ptd_qb" ? `${side} · passing TDs pick` : side, hit: k.said, price: k.price, result: k.result, live: k.result ? null : liveMark(g, { kind: "gp", cond: k.cond, long: k.long !== false }) }; })),
  props: (g) => { const c = GPROPS[Number(g.week)], pg = c && c.d ? (c.d.games || []).find((x) => x.game === g.key) : null;
    const want = MBPROP === "td" ? ["td"] : tabStats(PROP_STAT[MBPROP] || "rec_yds");
    const picks = [...((pg && pg.picks) || []), ...(g.td || []).map((t) => ({ name: t.player, team: t.team, stat: "td", side: "over", line: 0.5, chance: t.fair / 100, cal: tdPct(t.fair) / 100, price: t.price, result: t.scored === true ? "W" : t.scored === false ? "L" : null }))]
      .filter((p) => want.includes(p.stat)).map((p) => ({ ...p, full: true, live: p.result ? null : liveMark(g, { kind: p.stat === "td" ? "td" : "prop", name: p.name, team: p.team, stat: p.stat, side: p.side, line: p.line }) }));
    return picks.length ? `${propHead(false)}${teamRows({ away: g.away, home: g.home, picks }, propRow)}` : ""; },
};
// RECORDS (10/29, owner: "I need records at the top of every tab in models bets. Of the record of the picks on there winning and losing"): a row of record tiles on
// each tab, the Models tiles' look -- the season's W-L of that tab's picks (/api/modelpicks?rec=1, props from /api/props) and, under it, the week on screen.
// The colour is the win rate (green 56%+, light green 53-55%, yellow below). Pushes count neither way.
let MPRECS = null, MPRECS_T = 0;
function loadModelRecs() {
  if (loadModelRecs.busy || (MPRECS && Date.now() - MPRECS_T < 5 * 60e3)) return; loadModelRecs.busy = true;
  fetch(`/api/modelpicks?rec=1`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d && d.ok && d.records) MPRECS = d.records; MPRECS_T = Date.now(); }).catch(() => { MPRECS_T = Date.now(); })
    .finally(() => { loadModelRecs.busy = false; if (labOn()) renderLabList(); });
}
const wl = (xs) => { const r = { w: 0, l: 0 }; for (const x of xs) { const v = x === true ? "W" : x === false ? "L" : normRes(x); if (v === "W") r.w++; else if (v === "L") r.l++; } return r; };
const recTileMb = (label, season, week) => { const n = season ? season.w + season.l : 0, pc = n ? (100 * season.w) / n : null, c = pc == null ? "" : pc >= 56 ? "g" : pc >= 53 ? "lg" : "y";
  return `<div class="stat"><div class="k">${label}</div><div class="v ${c}">${season ? `${season.w}–${season.l}` : "…"}</div><div class="k2">${pc == null ? "—" : `${pc >= 56 ? Math.round(pc) : Math.floor(pc)}% won`}${week && week.w + week.l ? ` · wk ${week.w}–${week.l}` : ""}</div></div>`; };
function labRecords(games, sel) {
  const R = MPRECS || null, g = (k) => (R ? R[k] : null), L = (f) => games.map((x) => f(x.lines || {})).filter(Boolean);
  if (LABTYPE === "lines") return [recTileMb("SPREAD PICKS", g("spread"), wl(L((l) => l.spread && l.spread.result))), recTileMb("TOTAL PICKS", g("total"), wl(L((l) => l.total && l.total.result))),
    recTileMb("ML PICKS", g("ml"), wl(L((l) => l.ml && l.ml.result))), recTileMb("W/ POINTS", R ? { w: R.spreadPts.w + R.totalPts.w, l: R.spreadPts.l + R.totalPts.l } : null, wl([...L((l) => l.spread && l.spread.pts && l.spread.pts.result), ...L((l) => l.total && l.total.pts && l.total.pts.result)]))];
  if (LABTYPE === "halves") return [recTileMb("1H SPREAD", g("h1"), wl(games.map((x) => x.h1pick && x.h1pick.result)))];
  if (LABTYPE === "gprops") { const gp = games.flatMap((x) => x.gprops || []);
    return [recTileMb("GAME PROPS", g("gp"), wl(gp.filter((k) => k.fam !== "ptd_qb").map((k) => k.result))), recTileMb("PASSING TDs", g("ptd"), wl(gp.filter((k) => k.fam === "ptd_qb").map((k) => k.result)))]; }
  const lab = (MB_PROPS.find(([k]) => k === MBPROP) || [, ""])[1].toUpperCase();
  if (MBPROP === "td") return [recTileMb(lab, g("td"), wl(games.flatMap((x) => (x.td || []).map((t) => t.scored))))];
  const st = PROP_STAT[MBPROP] || "rec_yds", c = GPROPS[sel], rc = c && c.d && c.d.records ? c.d.records[st] : null, want = tabStats(st);
  const wk = wl(games.flatMap((x) => { const pg = c && c.d ? (c.d.games || []).find((y) => y.game === x.key) : null; return ((pg && pg.picks) || []).filter((p) => want.includes(p.stat)).map((p) => p.result); }));
  return [recTileMb(lab, rc ? { w: rc.w || 0, l: rc.l || 0 } : c ? { w: 0, l: 0 } : null, wk)];
}
function renderLabList() {
  if (!$("lab")) return;
  loadModelRecs();
  const cur = S && S.week != null ? Number(S.week) : null, sel = Number(LABWEEK || cur || 1), weeks = []; for (let w = cur || sel; w >= 1; w--) weeks.push(w);
  const chips = `<div class="wksel"><select id="lab-wk" aria-label="Week">${[...weeks].reverse().map((w) => `<option value="${w}"${sel === w ? " selected" : ""}>Week ${w}</option>`).join("")}</select></div>`;
  const wks = isCurWk(sel) ? [...new Set(((S && S.games) || []).map((g) => Number(g.week || S.week)))] : [sel];
  for (const w of wks) { const c = MPICKS[w]; if (!c || Date.now() - c.t > (isCurWk(w) ? 120e3 : 30 * 60e3)) loadModelPicks(w); }
  if (LABTYPE === "props") for (const w of new Set([sel, ...wks])) { const c = GPROPS[w]; if (!c || Date.now() - c.t > 5 * 60e3) loadGameProps(w); }
  const waiting = (!isCurWk(sel) && !MPICKS[sel]) || (LABTYPE === "props" && !GPROPS[sel]);
  const games = labGames(sel).sort((a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0)), body = LAB_BODY[LABTYPE] || LAB_BODY.lines;
  const xs = games.map((g) => ({ g, html: body(g) })).filter((x) => x.html);
  const slotTimes = {}; for (const { g } of xs) if (g.kickoff) { const sl = labSlot(g.kickoff), tt = tm(g.kickoff); (slotTimes[sl] = slotTimes[sl] || []).includes(tt) || slotTimes[sl].push(tt); }
  let lastSlot = null; const blocks = xs.map(({ g, html }) => { const sl = g.kickoff ? (g.week && cur && Number(g.week) !== sel ? `WEEK ${g.week} · ` : "") + labSlot(g.kickoff) : null, h = sl && sl !== lastSlot ? `<div class="sh labslot">${sl} <span class="lst">· ${(slotTimes[labSlot(g.kickoff)] || []).map(esc).join(" · ")}</span></div>` : ""; if (sl) lastSlot = sl;
    return h + `<div class="par"><div class="pbh c"><span class="pbn">${gameLogos(g.key)}${liveTag(g)}</span></div>${html}</div>`; });
  $("lab").innerHTML = ddSlot($("lab"), chips) + (LABTYPE === "props" ? mbChips() : "") + `<div class="stats mbrec">${labRecords(games, sel).join("")}</div>` + (xs.length ? `<div class="pgrid" style="margin-top:6px">${blocks.join("")}</div>` : `<div class="s dim empty" style="margin-top:12px">${waiting ? "Loading…" : "None yet."}</div>`);
  const lw = $("lab-wk"); if (lw && lw.tagName === "SELECT") lw.onchange = () => { LABWEEK = Number(lw.value); renderLabList(); };
  kickBox();
}
// ---------- live grading (10/28 late, owner: "Can you do live grading?"): ESPN's live box score of the games of the last 12 hours (lib/livebox.js) -> each
// pick's live state: { res: "W" / "L" / "P" } once it can no longer change (an Over reached, an Under passed, a TD scored, a first score, halftime for the 1H
// pick, the final whistle), else { now: "win" / "lose", txt: the live number }. Display only -- the records still come from the official grading.
const boxWanted = () => !!(S && (S.games || []).some((g) => g.started && g.kickoff && Date.now() - Date.parse(g.kickoff) < 12 * 3600e3));
async function loadLiveBox() {
  if ((typeof document !== "undefined" && document.hidden) || loadLiveBox.busy) return; const lab = labOn(); if (!lab && !DETAIL) return;
  loadLiveBox.busy = true;
  try { const d = await (await fetch("/api/livebox", { cache: "no-store" })).json(); if (d && d.ok) { LIVE_BOX = d.games || {}; LIVE_BOX_T = Date.now(); if (labOn()) renderLabList(); else if (DETAIL) refreshDetail(); } } catch {}
  finally { loadLiveBox.busy = false; }
}
function boxLoop() { clearTimeout(boxLoop._h); if (!boxWanted()) { boxLoop._on = false; return; } boxLoop._on = true; loadLiveBox().finally(() => { boxLoop._h = setTimeout(boxLoop, 30000); }); }
// a page that shows picks (Model bets, a game page) pulls the live box score at once when the last pull is 30+ s old, and keeps the 30-s loop going
const kickBox = () => { if (!boxWanted()) return; if (!boxLoop._on) boxLoop(); else if (Date.now() - LIVE_BOX_T > 30e3) loadLiveBox(); };
const boxPlayer = (b, name, team) => (b.pl || []).find((p) => (!team || !p.t || p.t === team) && tdNameEq(p.n, name)) || null;
const STAT_LIVE = { rec_yds: (p) => p.recYds, rec: (p) => p.rec, rush_yds: (p) => p.rushYds, scrim_yds: (p) => p.rushYds + p.recYds };
function liveMark(g, x) {
  const b = g && LIVE_BOX[g.key]; if (!b || !x) return null;
  const fin = !!b.final, mv = (r) => (r === "W" ? "win" : r === "L" ? "lose" : null);
  if (x.kind === "line") { const r = pickRes(x.label, g.away, g.home, b.a, b.h); return !r ? null : fin ? { res: r } : { now: mv(r) }; }
  if (x.kind === "h1") { const cur = b.h1 || (b.per <= 2 ? { a: b.a, h: b.h } : null); if (!cur || x.team == null) return null;
    const m = (x.team === g.home ? cur.h - cur.a : cur.a - cur.h) + Number(x.line), r = m > 0 ? "W" : m < 0 ? "L" : "P"; return b.h1 ? { res: r } : { now: mv(r) }; }
  if (x.kind === "td") { const p = boxPlayer(b, x.name, x.team); if (p && p.recTd + p.rushTd > 0) return { res: "W" }; return fin ? (p ? { res: "L" } : null) : { now: "lose", txt: "0 TD" }; }
  if (x.kind === "prop") { const f = STAT_LIVE[x.stat]; if (!f) return null; const p = boxPlayer(b, x.name, x.team), v = p ? f(p) : 0, L = Number(x.line), over = x.side === "over", txt = String(v);   // the number alone (it sits next to the player's name; the line under it names the stat)
    if (v > L) return { res: over ? "W" : "L", txt }; if (fin) return p ? { res: over ? "L" : "W", txt } : null;   // never in the box score at the end: the official grade decides (no snap = push)
    return { now: over ? "lose" : "win", txt }; }
  if (x.kind === "gp") return x.cond ? gpLive(x.cond, x.long, b, fin) : null;
  return null;
}
// a GAME PROPS condition (lib/gameprops.js gpParse) on the live box score, for the side we took (long = Yes / Over)
function gpLive(c, long, b, fin) {
  const sp = b.sp || [], cnt = (f) => sp.filter(f).length, dec = (yes) => (yes === long ? "W" : "L"), now = (yes) => ({ now: yes === long ? "win" : "lose" });
  const over = (v, line) => (v == null ? null : v > line ? { res: dec(true), txt: String(v) } : fin ? { res: dec(false), txt: String(v) } : { ...now(false), txt: String(v) });
  const res3 = (m) => (m > 0 ? "home" : m < 0 ? "away" : "tie");
  switch (c.kind) {
    case "over": {
      if (c.col === "tie") return fin ? { res: dec(b.a === b.h) } : now(b.a === b.h);
      if (c.col === "ot") return b.per >= 5 ? { res: dec(true) } : fin ? { res: dec(false) } : now(false);
      const f = { td_t: (x) => x.ty === "td", ptd_t: (x) => x.ty === "td" && x.how === "pass", rtd_t: (x) => x.ty === "td" && x.how === "rush", dst_t: (x) => x.ty === "td" && x.how === "dst", twopt: (x) => x.two, safety: (x) => x.ty === "sf" }[c.col];
      return f ? over(cnt(f), c.line) : null; }
    case "tstat": { const k = c.s, f = { td: (x) => x.t === k && x.ty === "td", fg: (x) => x.t === k && x.ty === "fg", dst: (x) => x.t === k && x.ty === "td" && x.how === "dst" }[c.stat];
      return over(f ? cnt(f) : c.stat === "yds" && b.yds ? b.yds[k] : null, c.line); }
    case "cat": {
      if (c.col === "first_score" || c.col === "first_td") { const f = sp.find((x) => c.col === "first_score" || x.ty === "td"); return f ? { res: dec(f.t === c.val) } : fin ? { res: dec(c.val === "none") } : null; }
      const N = Number(String(c.col).replace(/^race/, "")); if (!N) return null;
      const f = sp.find((x) => x.a >= N || x.h >= N); if (!f) return fin ? { res: dec(false) } : now(false);
      return f.a >= N && f.h >= N ? null : { res: dec((f.a >= N ? "a" : "h") === c.val) }; }
    case "htft": { if (b.h1 && res3(b.h1.h - b.h1.a) !== c.h1) return { res: dec(false) }; return fin && b.h1 ? { res: dec(res3(b.h - b.a) === c.ft) } : null; }
    case "margin": { if (!fin) return null; const mg = (c.s === "h" ? 1 : -1) * (b.h - b.a); return { res: dec(mg >= c.lo && mg <= c.hi) }; }
    case "margtie": return fin ? { res: dec(b.a === b.h) } : null;
  }
  return null;
}
// the live bit after a pick on the game card / a props row: "· winning" / "· 22 yds" (green / red), or the W / L once it can no longer change
const liveBit = (l) => (!l ? "" : l.res ? (l.res === "W" ? ' · <span class="g">W</span>' : l.res === "L" ? ' · <span class="r">L</span>' : " · push") : l.now ? ` <span class="lvx ${l.now === "win" ? "g" : "r"}">· ${esc(l.txt || (l.now === "win" ? "winning" : "losing"))}</span>` : "");
// 10/17 (owner): the NFL logo photo behind every NFL page but home (home keeps the Raiders photo); a game page keeps its team colours
function linesBg() { const on = (id) => { const p = $(id); return !!(p && p.classList.contains("on")); };
  document.documentElement.classList.toggle("lines-on", !(on("panel-lines") && DETAIL)); }
// GAME PAGE TABS (10/27, owner's Polymarket screenshots: "make our cards look like this where it has all of the sub tabs on 1 page ... catered to our designs"; design = both sports):
// under the game card, three tab words -- GAME LINES · PLAYER PROPS · PARLAYS -- and on Player Props the prop kinds as plain-text sub tabs (no pills, accent underline).
// Game Lines = the spread & ML and totals cards as before; Player Props = THIS game's rows in the props-page look; Parlays = the same-game parlays. The choice is kept per phone.
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const GTABS = [["lines", "Game Lines"], ["props", "Player Props"], ["gprops", "Game Props"], ["parlays", "Parlays"]];   // 10/28 night: GAME PROPS only on a game with a GAME PROPS pick (tabsOf)
const tabsOf = (g) => GTABS.filter(([k]) => k !== "gprops" || (g && g.gprops && g.gprops.length));
let GTAB = lsGet("gTab", "lines"), GPROP = lsGet("gProp:nfl", "td");
if (!GTABS.some(([k]) => k === GTAB)) GTAB = "lines";
if (!PROP_TABS.some(([k]) => k === GPROP)) GPROP = "td";
const gameTabs = (g) => { const ts = tabsOf(g), on = ts.some(([k]) => k === GTAB) ? GTAB : "lines";
  return `<div class="gtabs">${ts.map(([k, t]) => `<button class="gtab${on === k ? " on" : ""}" type="button" data-gtab="${k}">${t}</button>`).join("")}</div>`; };
const gameChips = () => `<div class="gchips">${PROP_TABS.map(([k, t]) => `<button class="gchip${GPROP === k ? " on" : ""}" type="button" data-gprop="${k}">${t}</button>`).join("")}</div>`;
const gNone = (t) => `<div class="card" style="margin-top:10px"><div class="inner"><div class="s dim">${t}</div></div></div>`;
let GPROPS = {}, GPROPS_LOADING = {};
function loadGameProps(week) {
  if (GPROPS_LOADING[week]) return; GPROPS_LOADING[week] = true;
  fetch(`/api/props?week=${week}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { GPROPS[week] = { d: d && d.ok ? d : { games: [] }, t: Date.now() }; })
    .catch(() => { GPROPS[week] = { d: { games: [] }, t: Date.now() - 4 * 60e3 }; }).finally(() => { GPROPS_LOADING[week] = false; if (labOn()) renderLabList(); else if (DETAIL && GTAB === "props") refreshDetail(); });
}
function gamePropsBody(g) {
  if (GPROP === "td") {
    if (!TDW) loadTdWeeks().then((d) => { if (d && DETAIL === g.key && GTAB === "props") refreshDetail(); });
    const rows = (g.td || []).filter((r) => r.fair != null && usable(r)).sort((a, b) => b.fair - a.fair);
    const per = {}, pool = rows.filter((r) => { const n = per[r.team] || 0; if (n >= TD_POOL) return false; per[r.team] = n + 1; return true; });
    const part = (t) => { const rs = pool.filter((r) => r.team === t); return rs.length ? `<div class="pbl pteam">${tlogo(t)}${esc(t)}</div>${rs.map((r) => tdRow({ r, g })).join("")}` : ""; };
    return pool.length ? `<div class="pgrid tdl" style="margin-top:6px"><div class="par">${tdHead()}${part(g.away)}${part(g.home)}</div></div>` : gNone("No touchdown chances for this game yet.");
  }
  if (GPROP === "first") {
    const rows = (g.td || []).filter((r) => r.first != null && usable(r) && !/^(out|doubtful)$/i.test(r.injury || "")).sort((a, b) => b.first - a.first);
    const picks = [g.away, g.home].flatMap((t) => rows.filter((r) => r.team === t).slice(0, 3)).map((r) => ({ name: r.player, team: r.team, chance: r.first / 100, price: r.firstPrice ?? null, first: true }));
    return picks.length ? `<div class="pgrid" style="margin-top:6px"><div class="par">${propHead(true)}${teamRows({ away: g.away, home: g.home, picks }, propRow)}</div></div>` : gNone("No first-touchdown chances for this game yet.");
  }
  const wk = Number(g.week || (S && S.week)), c = GPROPS[wk];
  if (!c || Date.now() - c.t > 5 * 60e3) loadGameProps(wk);
  if (!c) return gNone("Loading…");
  const pg = (c.d.games || []).find((x) => x.game === g.key), stat = PROP_STAT[GPROP] || "rec_yds", picks = pg ? (pg.picks || []).filter((p) => tabStats(stat).includes(p.stat))
    .map((p) => ({ ...p, live: p.result ? null : liveMark(g, { kind: "prop", name: p.name, team: p.team, stat: p.stat, side: p.side, line: p.line }) })) : [];   // 10/28 late: live grading
  return picks.length ? `<div class="pgrid" style="margin-top:6px"><div class="par">${propHead(false)}${teamRows({ away: g.away, home: g.home, picks }, propRow)}</div></div>` : gNone("None for this game.");
}
function gameParlaysBody(g) { const b = sgpBox(g); return b ? b.replace('<div class="sh" style="margin:16px 2px 0">SAME-GAME PARLAYS</div>', "") : gNone(g.started || g.final ? "Same-game parlays close at kickoff; they are on Model bets with their results." : "No same-game parlay for this game."); }
// the game page chart (10/27, owner's pick: open chart, sketch A; later: the team card on top of it, blended): Polymarket US's moneyline history for both teams, drawn by the shared shell (Shell.chartBlock)
const chartOf = (g) => ({ key: g.key, sport: "nfl", away: g.away, home: g.home, start: g.kickoff, live: !!(g.started && !g.final), ca: TEAM_COLOR[g.away] || "#888888", ch: TEAM_COLOR[g.home] || "#888888", h1pick: g.h1pick ? { ...g.h1pick, live: g.h1pick.result ? null : liveMark(g, { kind: "h1", team: g.h1pick.team, line: g.h1pick.line }) } : null,
  gprops: g.gprops ? g.gprops.map((k) => ({ ...k, live: k.result ? null : liveMark(g, { kind: "gp", cond: k.cond, long: k.long !== false }) })) : null });   // 10/28 late: + the live state   // 10/28: + the 1H SPREAD pick; night: + the GAME PROPS picks
function renderDetail(g) {
  $("lines").style.display = "none"; $("detail").style.display = ""; linesBg();
  document.body.classList.add("game-on");   // 10/18 (owner): on a game page the game card IS the header -- the NEXT GAME strip is hidden, ← Games sits under the card
  const early = g.early && g.model ? `<div class="card" style="margin-top:10px"><div class="inner"><div class="s">${earlyNote(g)} Model's own line: <b>${esc(g.model.homeMargin >= 0 ? g.home + " -" + g.model.homeMargin.toFixed(1) : g.away + " -" + (-g.model.homeMargin).toFixed(1))}</b> · total <b>${g.model.total.toFixed(1)}</b>.</div></div></div>` : "";
  const co = chartOf(g), mk = typeof Shell !== "undefined" && Shell.mktLines;   // 10/27: the other Polymarket markets (halves, quarters, team totals, game / team props)
  const tab = tabsOf(g).some(([k]) => k === GTAB) ? GTAB : "lines";   // a game without a GAME PROPS pick shows Game Lines
  const body = tab === "props" ? gameChips() + gamePropsBody(g) : tab === "parlays" ? gameParlaysBody(g) : tab === "gprops" ? Shell.gpLines(co)
    : `${early}${gameCard(g, "x")}${totalCard(g, "x")}${mk ? Shell.mktLines(co) : ""}`;
  const was = $("detail").querySelector ? $("detail").querySelector(".grest") : null, keepY = was ? was.scrollTop : 0;
  // 10/28 (owner: "Do not make this part scroll ... DO NOT MAKE THE EXIT PAGE GAMES AND THE GAME SUB TABS MOVE"): the team card, the chart, ← Games and the tabs stay put (.gtop);
  // only the part under them scrolls (.grest, its own scroll box sized by Shell.pinGame)
  $("detail").innerHTML = `<div class="gtop">${typeof Shell !== "undefined" && Shell.chartBlock ? detailTop(g).replace('class="card dtop"', 'class="card dtop dblend"') + Shell.chartBlock(co) : detailTop(g)}<button class="back" id="back-btn">← Games</button>${gameTabs(g)}</div><div class="grest">${body}</div>`;
  if (typeof Shell !== "undefined" && Shell.chartLoad) Shell.chartLoad(co);
  $("back-btn").onclick = closeGame;
  if (g.final) ensureGrades();
  setBg($("panel-lines").classList.contains("on") ? g : null);   // 10/14 fix: the background redraw ran while another tab was showing (SEA/DEN logos on Models)
  if (typeof Shell !== "undefined" && Shell.pinGame) Shell.pinGame($("detail"), keepY);
}
function renderLines() {
  if (DETAIL) { const g = S.games.find((x) => x.key === DETAIL); if (g) return renderDetail(g); DETAIL = null; }
  setBg(null); linesBg(); document.body.classList.remove("game-on"); if (typeof Shell !== "undefined" && Shell.unpinGame) Shell.unpinGame();
  $("detail").style.display = "none"; $("lines").style.display = "";
  $("lines").innerHTML = linesBySlot();
}
// 10/17 (owner): Game Lines stacked one per row, grouped under the time-slot headers (same slots and header look as Model bets);
// the slots keep the old order (upcoming first, then live, then finished), games inside a slot by kickoff
function linesBySlot() {
  const slots = [], by = {};
  for (const g of [...S.games].sort(order)) { const sl = (g.carry ? `WEEK ${g.week} · ` : "") + (g.kickoff ? labSlot(g.kickoff) : "GAMES"); if (!by[sl]) { by[sl] = []; slots.push(sl); } by[sl].push(g); }   // 10/19: the Monday game left from last week keeps its week in its header
  return slots.map((sl) => `<div class="sh labslot">${sl}</div><div class="tiles stack">${by[sl].map(tile).join("")}</div>`).join("");   // 10/18 (owner): just the slot name -- the time sits on each tile
}
function openGame(key) { LASTY = (typeof window !== "undefined" && window.scrollY) || 0; DETAIL = key; renderLines(); if (window.scrollTo) window.scrollTo(0, 0); setTimeout(() => slotMoney($("detail")), 60); const g = S.games.find((x) => x.key === key); if (g && g.started && !g.final) liveLoop(); kickBox(); }
function closeGame() { if (typeof Shell !== "undefined" && Shell.chartStop) Shell.chartStop(); DETAIL = null; renderLines(); if (window.scrollTo) window.scrollTo(0, LASTY); }
// the next game that has not started: refreshes the slate once when it kicks off
function tickCd() {
  clearTimeout(tickCd._h);
  if (!S) return;
  const nxt = S.games.filter((g) => !g.started && g.kickoff && new Date(g.kickoff) > Date.now()).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];   // by the clock, so it moves on at kickoff even before the next data load
  if (nxt && tickCd._cur && tickCd._cur !== nxt.key && Date.now() - (tickCd._last || 0) > 15000) { tickCd._last = Date.now(); setTimeout(() => loadSlate().catch(() => {}), 4000); }   // the game we were counting to just kicked off: refresh once
  tickCd._cur = nxt ? nxt.key : null;
  tickCd._h = setTimeout(tickCd, 1000);
}
// alerts: built on the server from changes it already sees between pulls (injuries, QB changes, lines, weather)
const ALK = { INJURY: ["Injury", "var(--red)"], "QB CHANGE": ["QB change", "#fff"], "LINE MOVE": ["Line move", "#fff"], WEATHER: ["Weather", "#fff"] };   // injury red, the rest white (owner 10/18 night); TD No, TD jump, QB TD and Result are cut (lib/alerts.js CUT_KINDS)
const alSeen = () => { try { return localStorage.getItem("alSeen") || ""; } catch { return ""; } };
async function loadAlerts() {
  try { const d = await (await fetch("/api/alerts", { cache: "no-store" })).json(); if (d.ok) { ALERTS = d.alerts || []; renderAlerts(); } } catch {}
}
// 10/20 night (owner: "add the logos here too ... make the app consistent"): the alert's game line carries both team logos, like the parlay headers
const alGameLogos = (game) => { const m = /^(\S+) @ (\S+)$/.exec(String(game || "")); return m ? `${tlogo(m[1])}${esc(m[1])} @ ${tlogo(m[2])}${esc(m[2])}` : esc(game); };
function renderAlerts() {
  const dots = ALPREV != null ? ALPREV : alSeen(), unread = ALERTS.filter((a) => a.t > alSeen()).length;
  Shell.setCount("nfl", "alerts", unread);
  const list = ALERTS.filter((a) => ALK[a.kind]);   // only the kept kinds show
  $("alerts").innerHTML = list.map((a) => { const [lab, col] = ALK[a.kind] || [a.kind, "var(--dim)"];
    const ic = a.kind === "INJURY" && a.team ? injBadge(a.team) : a.kind === "LINE MOVE" ? pmLogo() : "";
    return `<div class="card al${a.t > dots ? " un" : ""}" data-algame="${esc(a.game || "")}"><span class="dot"></span><div style="flex:1"><div class="kd" style="color:${col}"><span>${ic}${lab.toUpperCase()}</span><span class="dim" style="font-weight:600;letter-spacing:0">${hm(a.t)}</span></div>` +
      `<div class="ti">${esc(a.title)}</div>${a.sub ? `<div class="su">${esc(a.sub)}</div>` : ""}${a.game ? `<div class="algame">${alGameLogos(a.game)} ›</div>` : ""}</div></div>`; }).join("") ||
    '<div class="card" style="margin-top:10px"><div class="s">No alerts.</div></div>';
}
// 10/22: renderAll also redraws the First TD tab (built from the slate -- opened before the slate landed it sat on "Loading…")
function renderAll() { renderLines(); renderTd(); if (PROPTAB === "first" && $("panel-props") && $("panel-props").classList.contains("on")) renderProps(); if (PAPER) renderLab(); else renderLabList(); if (MB) renderRecord(); applyBetsView(); tickCd(); renderAlerts(); }
// Newest version all the time (9/30): if a new deploy went live while this page was open (or sat in a phone tab),
// reload once to pick it up; data refreshes on its own when you come back to the tab after 2+ minutes.
let BUILD = null, LOADED_AT = 0, LOAD_SEQ = 0;
async function loadSlate() {
  const seq = ++LOAD_SEQ, r = await fetch("/api/slate", { cache: "no-store" }), build = r.headers.get("x-build"), d = await r.json();
  if (!d.ok) throw new Error(d.error);
  if (seq !== LOAD_SEQ) return;                                         // a newer request already answered: never show older data
  if (BUILD && build && build !== BUILD) { location.reload(); return; }  // a new version went live while this page was open
  BUILD = BUILD || build; LOADED_AT = Date.now(); S = d;
  if (!loadSlate._rolled) { loadSlate._rolled = true; setTimeout(() => slotMoney($("panel-lines")), 120); }
  if (anyLive() && !liveLoop._on) { liveLoop._on = true; liveLoop(); }   // scores + live lines every 30 s while a game is on
  const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean);   // keep your open dropdowns
  renderAll(); for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
  try { localStorage.setItem("lastSeen", new Date().toISOString()); } catch {} }   // next visit's "What changed" starts from now
function showPanel(name) {
  setTimeout(() => slotMoney($("panel-" + String(name).split("-")[0])), 80);   // dollar amounts roll in when a page opens (owner 10/18 night)
  let sub = null;   // 10/17 (owner): My bets and Model bets are separate pages under Bets in the menu
  if (/^modelbets-/.test(name)) { const k = name.slice(10); if (LAB_TABS.some(([t]) => t === k)) LABTYPE = k; name = "modelbets"; }   // 10/17 (owner): the parlay types are menu sub tabs under Model bets
  if (name === "modelbets") sub = `modelbets-${LABTYPE}`;
  if (/^props-/.test(name)) { const k = name.slice(6); if (PROP_STAT[k] || k === "first") PROPTAB = k; name = "props"; }   // 10/20 (owner): the Player props stat tabs are menu sub tabs
  if (name === "props") sub = `props-${PROPTAB}`;
  if (name === "mybets" || name === "modelbets") { sub = sub || name; BETSVIEW = name === "modelbets" ? "model" : "mine"; try { localStorage.setItem("betsView", BETSVIEW); } catch {} name = "record"; }
  if (name === "record" && !sub) sub = BETSVIEW === "model" ? `modelbets-${LABTYPE}` : "mybets";
  if (name === "home" || !$("panel-" + name)) name = "lines";   // 10/27: Home is the games list (an old #home link lands there)
  Shell.setActive(sub || name);   // 10/17: the menu replaces the tab bar
  document.body.classList.toggle("game-on", name === "lines" && !!DETAIL);   // a game page is open (the game card sits at the top)
  if (name === "alerts") { ALPREV = alSeen(); if (ALERTS.length) { try { localStorage.setItem("alSeen", ALERTS[0].t); } catch {} } }   // opening Alerts marks them read (was the bell)
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on")); $("panel-" + name).classList.add("on");
  if (name === "alerts") renderAlerts();
  if (name === "lines") liveLoop();
  try { if (window.scrollTo) window.scrollTo(0, 0); } catch {}   // 10/14 (owner): every tab change starts at the top of the page
  if (name === "record" || name === "models") loadRecord();
  if (name === "record") applyBetsView();
  if (name === "props") { renderProps(); loadProps(); }   // 10/17 (owner): Props is its own page
  if (name === "td" && S && S.games) renderTd();   // 10/20 night: the Anytime TD page is drawn fresh when opened (the cut and the week feed)
  if (S && S.games) setBg(name === "lines" && DETAIL ? S.games.find((x) => x.key === DETAIL) : null);   // game background only on an open game page
  linesBg();
}
// 10/17: pages switch by the address' #name (the bar links set it): #lines (or none = Home), #alerts, #td, #record, #models
const PANELS = ["home", "alerts", "lines", "td", "record", "mybets", "modelbets", "props", ...LAB_TABS.map(([k]) => `modelbets-${k}`), ...PROP_TABS.filter(([k]) => k !== "td").map(([k]) => `props-${k}`), "models"];
function routeHash() {
  const name = Shell.hashPanel(PANELS, "lines");
  if (name === "lines" && DETAIL && $("panel-lines").classList.contains("on")) closeGame();   // choosing Game Lines while on a game goes back to the games
  showPanel(name);
}
window.addEventListener("hashchange", routeHash);
$("al-read").onclick = () => { ALPREV = ALERTS.length ? ALERTS[0].t : ""; renderAlerts(); };
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-drop]"); if (d) { const el = $(d.dataset.drop); if (el) { el.classList.toggle("open"); if (d.dataset.drop === "bestlist") { BEST_OPEN = el.classList.contains("open"); try { localStorage.setItem("bestOpen", BEST_OPEN ? "1" : "0"); } catch {} }
      if (d.dataset.drop === "gamebest") { GAMEBEST_OPEN = el.classList.contains("open"); try { localStorage.setItem("gameBestOpen", GAMEBEST_OPEN ? "1" : "0"); } catch {} } } return; }
  const gtb = e.target.closest("[data-gtab]"); if (gtb) { GTAB = gtb.dataset.gtab; lsSet("gTab", GTAB); refreshDetail(); return; }   // 10/27: game page tabs
  const mbp = e.target.closest("[data-mbprop]"); if (mbp) { MBPROP = mbp.dataset.mbprop; lsSet("mbProp:nfl", MBPROP); renderLabList(); return; }   // Model bets -> Player Props stat chips
  const gpr = e.target.closest("[data-gprop]"); if (gpr) { GPROP = gpr.dataset.gprop; lsSet("gProp:nfl", GPROP); refreshDetail(); return; }
  const gt = e.target.closest("[data-game]"); if (gt) { if (!$("panel-lines").classList.contains("on")) { history.replaceState(null, "", "#lines"); showPanel("lines"); } openGame(gt.dataset.game); return; }
  const al = e.target.closest("[data-algame]"); if (al) { const k = al.dataset.algame; if (k) { history.replaceState(null, "", "#lines"); showPanel("lines"); openGame(k); } return; }
  const bv = e.target.closest("[data-bv]"); if (bv) { history.replaceState(null, "", bv.dataset.bv === "model" ? "#modelbets" : "#mybets"); routeHash(); return; }   // 10/22: My bets | Model bets inside Bets -- the page key follows, so the sub-tab bar does too
  const lw = e.target.closest("[data-labw]"); if (lw) { LABWEEK = Number(lw.dataset.labw); renderLabList(); return; }
  const gb = e.target.closest("[data-gbw]"); if (gb) { GBGWEEK = gb.dataset.gbw === "all" ? "all" : Number(gb.dataset.gbw); $("gbg").innerHTML = gbgHtml(); return; }
  const ts = e.target.closest(".labslot.tdtog"); if (ts) { tdToggleSlot(ts); return; }   // 10/20 night (owner): open / close a time-slot list
  const tw = e.target.closest(".tdr[data-tdw]"); if (tw && !e.target.closest(".nogap")) { tw.classList.toggle("open"); if (tw.classList.contains("open")) fillTdWeeks(tw); return; }   // 10/20 night (owner): TD by week under the row
  const p = e.target.closest(".price-link"); if (p) toast(p.dataset.market ? "Polymarket market: " + p.dataset.market : "No market recorded for this price.", 8000);
});
// Everything refreshes by itself while the page is open and visible: lines, model, injuries, alerts, and the records.
const onRecordTab = () => ["panel-record", "panel-models"].some((id) => $(id) && $(id).classList.contains("on"));
// Grades finished games and syncs the Polymarket account while the page is open (the server allows one run per 5 minutes),
// then reloads the Record data if a run happened, so results and bets show up without waiting for the scheduler.
function catchUp() { fetch("/api/results/grade?lock=1", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d && d.ran && onRecordTab()) loadRecord(); }).catch(() => {}); }
async function refreshAll() { try { catchUp(); await loadSlate(); await loadAlerts(); if (onRecordTab()) await loadRecord(); } catch {} }
function autoRefresh() { setTimeout(async () => { if (!document.hidden) await refreshAll(); autoRefresh(); }, 120e3); }
Shell.init("nfl");
document.querySelectorAll("[data-mp]").forEach((a) => a.addEventListener("click", () => { if (a.dataset.msp === "nfl" && location.hash === "#" + a.dataset.mp) setTimeout(routeHash, 0); }));   // same item again: still go back from a game page
Shell.onRefreshed = async () => { await loadSlate(); };
routeHash();
loadSlate().then(loadAlerts).then(() => { catchUp(); autoRefresh(); plAuto(); }).catch((e) => toast("Couldn't load this week: " + e.message, 12000));
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - LOADED_AT > 60e3) refreshAll(); });
