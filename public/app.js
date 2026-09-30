// NFL SLATEZZZ — everything comes from /api/slate (lines, TD, flags) and /api/mybets + /api/results/list (Record).
let tdShowAll = false;
let S = null, RES = null, EDGES = null, MB = null, tdSort = "likely", recView = "mine";
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
const tm = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const hm = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const clock = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");
function toast(msg, ms = 7000) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._h); if (ms) toast._h = setTimeout(() => t.classList.remove("show"), ms); }

// ---------- shared card parts ----------
function status(g) {
  if (g.final) return `Final ${g.awayScore != null ? `${g.awayScore}–${g.homeScore}` : ""}`;
  if (g.started) return '<span class="r">Live · locked</span>';
  return "not started";
}
function headButtons(g, id, extra = "") {
  const n = (g.injuries || []).length;
  return `<div class="top"><div><div class="gh">${matchup(g)}${g.badge ? `<span class="badge">${esc(g.badge)}</span>` : ""}</div><div class="sub">${tm(g.kickoff)} · ${status(g)}${extra}</div>` +
    (g.qb && g.qb.length && !g.final ? `<div class="warn">⚠ ${esc(g.qb.join(" · "))} · ${qbAdjusted(g) ? "model adjusted (estimate)" : "not in the model yet — it adjusts once this week's injury report lists the starter Out/Doubtful (Wed–Fri report, then the Thu/Sat reruns)"}</div>` : "") +
    (g.dataCheck ? `<div class="warn">⚠ ${esc(g.dataCheck)}</div>` : "") + `</div>` +
    `<div class="btns" style="margin-top:0;flex-shrink:0">${n ? `<button class="tag" data-drop="inj-${id}">Injuries ${n} ▾</button>` : ""}<button class="tag" data-drop="his-${id}">History ▾</button></div></div>` +
    `<div class="drop" id="inj-${id}"><div class="s" style="margin-bottom:4px">Official report${(() => { const w = [...new Set((g.injuries || []).map((x) => x.week))]; return w.length ? ` · Week ${w.join("/")}` + (w.every((x) => Number(x) !== Number(S.week)) ? " (last week's — this week's first report comes out Wednesday)" : "") : ""; })()} · updated ${S.injuriesUpdated ? hm(S.injuriesUpdated) : "—"}</div>` +
    (g.injuries || []).map((x) => `<div class="drow"><span>${esc(x.name)} <span class="dim">${esc(x.pos || "")} · ${x.team}</span></span><span class="${/out/i.test(x.status) ? "r" : /doubt/i.test(x.status) ? "r" : "y"}">${esc(x.status)}</span></div>`).join("") + `</div>` +
    `<div class="drop" id="his-${id}">${historyRows(g)}</div>`;
}
// History dropdown (reworked 9/29): it already resets each week (stored per week), but it listed EVERY snapshot, so a
// quiet week showed a dozen identical rows. Now: the opening line, then only real moves (spread or total line changed,
// or a price moved 3¢+), then the latest -- with a count of how many checks were quiet.
function historyRows(g) {
  const hs = (g.history || []).filter((h) => h.poly);
  if (!hs.length) return '<div class="s">No snapshots yet this week.</div>';
  // One row per set of numbers: a new row only when the spread/total line changes or a price moves 3¢+. While the
  // numbers stay the same, the row keeps its start time and just updates "last checked".
  const key = (p) => ({ sl: p.spread ? p.spread.homeSpread : null, sp: p.spread ? p.spread.home : null, tl: p.total ? p.total.line : null, tp: p.total ? p.total.over : null, ml: p.ml ? p.ml.home : null });
  const moved = (a, b) => a.sl !== b.sl || a.tl !== b.tl || ["sp", "tp", "ml"].some((x) => a[x] != null && b[x] != null && Math.abs(a[x] - b[x]) >= 0.03);
  const rows = [{ from: hs[0], last: hs[0] }];
  for (const h of hs.slice(1)) { const cur = rows[rows.length - 1]; if (moved(key(h.poly), key(cur.from.poly))) rows.push({ from: h, last: h }); else cur.last = h; }
  const cell = (p) => `<span>${p.spread ? `${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}` : "—"}</span><span>${p.total ? `${p.total.line} (O ${odds(toAmerican(p.total.over))})` : "—"}</span><span>${p.ml ? `${g.home} ${odds(toAmerican(p.ml.home))}` : "—"}</span>`;
  return `<div class="s" style="margin-bottom:4px">How the line moved this week (Polymarket) · resets every week · ${rows.length === 1 ? "no change yet" : `${rows.length - 1} move${rows.length === 2 ? "" : "s"}`}</div>` +
    `<div class="drow dim"><span>Since</span><span>Spread</span><span>Total</span><span>Moneyline</span></div>` +
    rows.slice().reverse().map((r, i) => `<div class="drow"><span>${hm(r.from.t)}${r.from.src === "kickoff" ? " 🔒" : ""}` +
      `${r.last !== r.from ? `<br><span class="dim">last checked ${hm(r.last.t)}</span>` : ""}${i === rows.length - 1 ? '<br><span class="dim">opening line</span>' : ""}</span>${cell(r.from.poly)}</div>`).join("");
}
const HDR = `<div class="hd">MARKET · what you can bet</div><div class="hd hm">MODEL · our math</div>`;
const qbAdjusted = (g) => !!(g.model && g.model.inj && [g.model.inj.home, g.model.inj.away].some((t) => t && (t.players || []).some((q) => q.group === "QB1")));
const lastName = (n) => String(n || "").replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").split(" ").slice(-1)[0];
const favOf = (g, mg) => (mg >= 0 ? g.home : g.away);
function spreadReason(g) {
  const m = g.model; if (!m || m.homeMargin == null) return "";
  const say = (x) => (Math.abs(x) < 0.05 ? "a toss-up" : `${favOf(g, x)} winning by about ${Math.abs(x).toFixed(1)}`);
  let s = `Model sees ${say(m.homeMargin)}`;
  if (m.inj && m.rawMargin != null && Math.abs(m.rawMargin - m.homeMargin) >= 0.05)
    s += ` after injuries (${Math.abs(m.rawMargin) < 0.05 ? "a toss-up" : `${favOf(g, m.rawMargin)} by ${Math.abs(m.rawMargin).toFixed(1)}`} before)`;
  s += ".";
  if (m.fix && m.fix.neutral) s += " Neutral-site game, so no home-field edge is counted.";
  // (division-game and road-bye notes removed 9/30: those margin terms were dropped after testing worse out of sample)
  if (m.fix && m.fix.awayElim) s += ` ${g.away} is all but out of the playoff race.`;
  if (m.fix && m.fix.homeQbFirstStart) s += ` ${g.home}'s backup QB is making his first start.`;
  if (m.fix && m.fix.awayQbFirstStart) s += ` ${g.away}'s backup QB is making his first start.`;
  const hs = g.poly && g.poly.spread ? g.poly.spread.homeSpread : null;
  if (hs != null) {
    if (hs === 0) s += " Polymarket has it as a pick'em.";
    else { const n = Math.abs(hs); s += ` Polymarket needs ${hs < 0 ? g.home : g.away} to win by ${Number.isInteger(n) ? "more than " + n : Math.ceil(n) + "+"} to cover.`; }
  }
  return s;
}
function totalReason(g) {
  const m = g.model; if (!m || m.total == null) return "";
  let s = `Model sees about ${Number(m.total).toFixed(1)} total points`;
  if (m.inj && m.rawTotal != null && Math.abs(m.rawTotal - m.total) >= 0.05) s += ` after injuries (${Number(m.rawTotal).toFixed(1)} before)`;
  s += ".";
  if (m.fix) {
    const bits = [];
    if (m.fix.dome) bits.push(`indoor game +${Number(m.fix.dome).toFixed(1)}`);
    if (Math.abs(m.fix.pace || 0) >= 0.3) bits.push(`pace ${m.fix.pace > 0 ? "+" : ""}${Number(m.fix.pace).toFixed(1)}`);
    if (m.fix.div) bits.push("division game");
    if (m.fix.turf) bits.push("turf field");
    if (bits.length) s += ` Includes ${bits.join(", ")}.`;
  }
  const tl = g.poly && g.poly.total ? g.poly.total.line : null;
  return tl != null ? s + ` Polymarket's line is ${tl}.` : s;
}
// "Injury adjustment: GB -1.6 (Reed out, Banks out). ATL 0."  (only when the estimate actually moved something)
function injLine(g, kind) {
  const inj = g.model && g.model.inj; if (!inj) return "";
  const who = (t, key) => t.players.filter((p) => (key ? p[key] : true) && (key ? p[key] !== 0 : true)).map((p) => `${lastName(p.name)} ${p.status}`).join(", ");
  if (kind === "total") {
    if (Math.abs(inj.total || 0) < 0.05) return "";
    return `Injury adjustment: ${inj.total.toFixed(1)} on the total (${[who(inj.home, "total"), who(inj.away, "total")].filter(Boolean).join(", ")}).`;
  }
  if (!inj.home.players.length && !inj.away.players.length) return "";
  const one = (team, t) => (t.pts ? `${team} ${t.pts.toFixed(1)} (${who(t)}${t.capped ? ", capped" : ""})` : `${team} 0`);
  return `Injury adjustment: ${one(g.home, inj.home)}. ${one(g.away, inj.away)}.`;
}
const injApplied = (g, kind) => !!(g.model && g.model.inj && (kind === "total" ? Math.abs(g.model.inj.total || 0) >= 0.05 : (g.model.inj.home.players.length || g.model.inj.away.players.length)));
// Right-hand "Model leans" cell: the lean, its strength, and in plain words WHY.
function leanCell(g, kind) {
  let p = kind === "total" ? g.totalPick : g.spreadPick;
  const head = `<div class="k">Model leans${injApplied(g, kind) ? ' <span class="pill p-y" style="padding:0 6px;font-size:10px">Estimate</span>' : ""}</div>`;
  const wrap = (inner) => `<div style="grid-row:span 2">${head}${inner}</div>`;
  if (!p) return wrap(dash);
  // finished games hide warnings under the cover
  if (p.warn && g.final) p = { ...p, warn: null };
  const reason = kind === "total" ? totalReason(g) : spreadReason(g), adj = injLine(g, kind);
  const m = g.model, wind = kind === "total" && m ? (m.outdoor && m.wind != null ? `wind ${m.wind} mph` : g.outdoor ? "outdoor" : "dome / roof") : "";
  // Protocol 3.3: calibrated cover/Under near 50% is the correct output, NOT a lean. Before 9/28 the card still printed
  // the >50% side as the pick (e.g. "GB -1.5 · 52.1%") even when "Model sees TB by 4.6" sat right under it, because the
  // calibration slightly fades the model. Within 2.5 pts of 50% it now says so; the tilt stays visible in small text.
  const coin = Math.abs(p.pct - 50) < 2.5;
  return wrap((coin ? `<span>No lean · about 50/50</span><div class="s">slight side: ${p.label} ${p.pct.toFixed(1)}%</div>` :
    `<span>${p.label}</span><div class="s">${p.pct.toFixed(1)}% model chance</div>`) +
    // Win chance (calibrated cal_win). Its accuracy comes from the MARKET spread; the model's own disagreement enters
    // with a small NEGATIVE weight (tested 2006-25: when the model likes a team more than the market does, that team
    // wins slightly LESS often than the line says). So this number can point the other way from "Model sees..." above.
    (kind !== "total" && g.winPct != null ? `<div class="s">Win chance (market-based): ${g.home} ${Number(g.winPct).toFixed(0)}% · ${g.away} ${(100 - g.winPct).toFixed(0)}%</div>` : "") +
    (reason ? `<div class="s" style="margin-top:6px">${esc(reason)}</div>` : "") +
    (wind ? `<div class="s">${wind}</div>` : "") +
    (adj ? `<div class="s" style="margin-top:6px;border-top:0.5px solid var(--border);padding-top:6px">${esc(adj)}</div>` : "") +
    (p.warn ? `<div class="s y">${esc(p.warn)}</div>` : ""));
}
function cover(g, pick) {
  if (!g.final) return "";
  return `<div class="cover"><b>GAME FINISHED</b><div style="font-size:12.5px;color:#c9c9cf">${g.away} ${g.awayScore ?? ""} – ${g.home} ${g.homeScore ?? ""}` +
    (pick && pick.result ? ` · Model leaned ${pick.label} <span class="${pick.result === "won" ? "g" : pick.result === "lost" ? "r" : "dim"}">${pick.result}</span>` : "") + `</div></div>`;
}
const order = (a, b) => (a.final - b.final) || (a.started - b.started) || (new Date(a.kickoff) - new Date(b.kickoff));

// ---------- Game Lines ----------
// "Right now" (9/30): Polymarket prices 3%+ better than fresh sportsbook fair prices -- the one realistic edge source.
function rightNowBox() {
  const E = S.edgesNow || [], R = S.edgeRule || {};
  const why = R.booksAgeH == null ? "no sportsbook odds yet this week" : R.booksAgeH > R.booksMaxAgeH ? `sportsbook odds are ${Math.round(R.booksAgeH)} h old — the next scheduled pull refreshes them` : "none right now";
  const fee = R.feePct ? `after a ${R.feePct}% fee` : "before fees";
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Right now · Polymarket cheaper than the sportsbooks</div>` +
    (E.length ? E.map((b) => `<div class="row"><span>${esc(b.label)} <span class="dim">${esc(b.game)}</span>${b.held ? ` <span class="y">(${esc(b.held)} — hold)</span>` : ""}</span>` +
      `<span>${Math.round(b.price * 100)}¢ vs fair ${Math.round(b.fair * 100)}¢ · <span class="g">+${(b.evNet * 100).toFixed(1)}%</span></span></div>`).join("") : `<div class="s">No gap of 3%+ (${why}).</div>`) +
    `<div class="s dim" style="margin-top:4px">Gap = sportsbook fair chance ÷ Polymarket price − 1, ${fee}. Sportsbook odds must be under ${R.booksMaxAgeH || 3} h old. Results are tracked on Record → Model.</div></div></div>`;
}
// "What changed" (9/30): Polymarket line moves since your last visit on this device.
let LAST_SEEN = null;
try { LAST_SEEN = localStorage.getItem("lastSeen"); } catch {}
function changedBox() {
  if (!LAST_SEEN) return "";
  const since = new Date(LAST_SEEN), out = [];
  for (const g of S.games.filter((x) => !x.started)) {
    const before = [...(g.history || [])].filter((h) => h.poly && new Date(h.t) <= since).pop(), now = g.poly;
    if (!before || !now) continue;
    const a = before.poly, bits = [];
    if (a.spread && now.spread && a.spread.homeSpread !== now.spread.homeSpread) bits.push(`spread ${g.home} ${sgn(a.spread.homeSpread)} → ${sgn(now.spread.homeSpread)}`);
    if (a.total && now.total && a.total.line !== now.total.line) bits.push(`total ${a.total.line} → ${now.total.line}`);
    if (a.ml && now.ml && Math.abs(a.ml.home - now.ml.home) >= 0.05) bits.push(`${g.home} moneyline ${Math.round(a.ml.home * 100)}¢ → ${Math.round(now.ml.home * 100)}¢`);
    if (bits.length) out.push(`<div class="row"><span>${esc(g.key)}</span><span>${bits.join(" · ")}</span></div>`);
  }
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">What changed since your last visit (${hm(LAST_SEEN)})</div>` +
    (out.join("") || '<div class="s">No Polymarket line moves.</div>') + `<div class="s dim" style="margin-top:4px">TD price moves are on the Anytime TD tab.</div></div></div>`;
}
function renderLines() {
  $("lines").innerHTML = rightNowBox() + changedBox() + [...S.games].sort(order).map((g, i) => {
    const p = g.poly || {}, b = g.books || {};
    const live = !g.started && p.spread ? '<span class="live"></span>' : "";
    const row = (k, v, mt) => `<div class="prl${mt ? " mt" : ""}"><span class="s">${k}</span><span>${v}</span></div>`;
    const poly = p.spread || p.ml ? `${live}` +
      (p.spread ? row("Spread", `${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}`) + row("", `${g.away} ${sgn(-p.spread.homeSpread)} ${odds(toAmerican(p.spread.away))}`) : "") +
      (p.ml ? row("Moneyline", `${g.home} ${odds(toAmerican(p.ml.home))}`, !!p.spread) + row("", `${g.away} ${odds(toAmerican(p.ml.away))}`) : "") : dash;
    return `<div class="card${g.final ? " fin" : ""}"><div class="inner">${headButtons(g, "l" + i)}<div class="f">${HDR}` +
      `<div><div class="k">Sportsbooks (reference only)</div>${b.spread ? `${g.home} ${sgn(b.spread.homeSpread)} ${odds(b.spread.home.odds)}<div class="s">fair (vig removed) ${g.home} ${odds(toAmerican(b.spread.home.fair))} / ${g.away} ${odds(toAmerican(b.spread.away.fair))}</div>` : dash}</div>` +
      leanCell(g, "spread") +
      `<div><div class="k">Polymarket (where you bet)</div>${poly}</div>` +
      `</div></div>${cover(g, g.spreadPick)}</div>`;
  }).join("");
}
// ---------- Totals ----------
function renderTotals() {
  $("totals").innerHTML = [...S.games].sort(order).map((g, i) => {
    const p = g.poly || {}, b = g.books || {};
    const live = !g.started && p.total ? '<span class="live"></span>' : "";
    const row = (k, v) => `<div class="prl"><span class="s">${k}</span><span>${v}</span></div>`;
    const poly = p.total ? `${live}` + row(`Over ${p.total.line}`, odds(toAmerican(p.total.over))) + row(`Under ${p.total.line}`, odds(toAmerican(p.total.under))) : dash;
    return `<div class="card${g.final ? " fin" : ""}"><div class="inner">${headButtons(g, "t" + i)}<div class="f">${HDR}` +
      `<div><div class="k">Sportsbooks (reference only)</div>${b.total ? `${b.total.line}<div class="s">O ${odds(b.total.over.odds)} · U ${odds(b.total.under.odds)}</div>` : dash}</div>` +
      leanCell(g, "total") +
      `<div><div class="k">Polymarket (where you bet)</div>${poly}</div>` +
      `</div></div>${cover(g, g.totalPick)}</div>`;
  }).join("");
}
// ---------- Anytime TD ----------
const PRICE_CLS = { Underpriced: "g", Fair: "y", Overpriced: "r" };
const PRICE_WORD = { Underpriced: "Good price", Fair: "Fair price", Overpriced: "Bad price" };
const GAME_STATUS = /out|doubtful|questionable/i;
// team logo, transparent PNG, keyed off the same team code the row already carries. WAS/KC have no
// clean current mark on the ESPN CDN, so those two come from a community alt-logo set instead.
const LOGO_OVERRIDES = { WAS: "https://raw.githubusercontent.com/ajreinhard/data-viz/master/alt-logo/WAS.png", KC: "https://raw.githubusercontent.com/ajreinhard/data-viz/master/alt-logo/KC.png" };
const logoUrl = (team) => (team ? LOGO_OVERRIDES[team] || `https://a.espncdn.com/i/teamlogos/nfl/500/${team}.png` : "");
// Team logo next to team names on every card (game header + TD team headers). Same logo source as the TD rows.
function tlogo(team) { return team ? `<img class="tlogo" src="${logoUrl(team)}" alt="" onerror="this.style.display='none'">` : ""; }
function matchup(g) { return `${tlogo(g.away)}${g.away} @ ${tlogo(g.home)}${g.home}`; }
function prow(r, g, showGame) {
  const inj = r.injury && GAME_STATUS.test(r.injury) ? ` <span class="pill ${/out|doubt/i.test(r.injury) ? "p-r" : "p-y"}" style="padding:0 6px;font-size:10px">${esc(r.injury)}</span>` : "";
  // Model's chance (big, left) and Polymarket's price (right), each with its plain label directly underneath. No verdict, no edge, no stake.
  const chance = r.fair != null ? `${Math.round(r.fair)}%` : dash;
  const cents = r.price != null ? `<span class="price-link" data-market="${esc(r.market || (r.stale ? "Old screenshot price — not live" : ""))}">${Math.round(r.price * 100)}¢</span>` : dash;
  const snap = r.snap ? ` · ${r.snap.pct}% snaps${r.snap.missed ? ` <span class="warn-t">⚠ didn't play last game (last played week ${r.snap.lastWeek})${r.lastWeekOut ? ` · ${esc(r.lastWeekOut)}` : ""} — check status</span>` : r.snap.early ? ` <span class="warn-t">⚠ left last game early? (usually ${r.snap.avg}%) — check injury news</span>` : r.snap.trend === "up" ? ' <span class="g">↑</span>' : r.snap.trend === "down" ? ' <span class="r">↓ role shrinking</span>' : ""}` : "";
  // team code dropped from the subtitle when the logo is shown (showGame) — the logo already carries it
  const sub = `${showGame ? `${esc(r.game)} · ` : ""}#${r.teamRank} on team${snap}`;
  const more = r.fair != null && (r.two != null || r.first != null) ? `2+ TDs ${r.two != null ? Math.round(r.two) + "%" : "—"} · first TD of the game ${r.first != null ? Math.round(r.first) + "%" : "—"}` : "";
  const flags = (r.flags || []).map((f) => `<div class="y" style="font-size:11.5px">⚠ ${esc(f)}</div>`).join("") +
    // Game-day inactives come out ~90 min before kickoff and are NOT in the injury feed; an inactive player's TD market
    // settles No. Reminder on every Questionable player until kickoff.
    (r.espn ? `<div style="font-size:11.5px" class="dim">ESPN: ${esc(r.espn)}</div>` : "") +
    (/^questionable$/i.test(r.injury || "") && !g.started ? `<div class="y" style="font-size:11.5px">⚠ Questionable — ${r.fairIfPlays != null ? `chance includes the 1-in-3 risk he sits (${Math.round(r.fairIfPlays)}% if he plays). ` : ""}Check the inactive list ~90 min before kickoff (inactive = TD market settles No)</div>` : "") +
    (r.depthNote ? `<div style="font-size:11.5px" class="${/up|new/.test(r.depthNote) ? "g" : "r"}">${/up|new/.test(r.depthNote) ? "▲" : "▼"} ${esc(r.depthNote)}</div>` : "") +
    (r.move ? `<div style="font-size:11.5px" class="${r.move > 0 ? "g" : "r"}">Price ${r.move > 0 ? "▲ +" : "▼ "}${r.move}¢ ${r.moveSince || "in the last day"}</div>` : "");
  const logo = r.team ? `<img class="logo" src="${logoUrl(r.team)}" alt="${r.team}">` : "";
  return `<div class="prow"><div>${logo}<b style="font-weight:600">${esc(r.player)}</b><span class="pos">${esc(r.pos)}</span>${inj}<div class="s">${sub}</div></div>` +
    `<div class="n"><span class="big">${chance}</span><span class="lbl">model's<br>chance</span></div>` +
    `<div class="n"><span class="px">${cents}</span><span class="lbl">Polymarket<br>price${r.stale ? " (old)" : r.thin ? '<br><span class="warn-t">thin market (no real bidder)</span>' : ""}${r.open != null && r.price != null && Math.round(r.open * 100) !== Math.round(r.price * 100) ? `<br><span class="dim">opened ${Math.round(r.open * 100)}¢</span>` : ""}</span></div>` +
    `<div class="why">${more}${flags}</div></div>`;
}
const usable = (r) => !(r.odds != null && r.odds <= -600 && !r.thin);   // a real -600 price is broken data; never hide a player over a thin placeholder
function tdCard(g, id) {
  const p = g.poly || {}, hs = p.spread ? p.spread.homeSpread : null, tot = p.total ? p.total.line : null;
  const lines = hs != null && tot != null ? ` · ${g.home} ${sgn(hs)} · O/U ${tot}` : "";
  const implied = (team) => (hs == null || tot == null ? "" : `implied ${(team === g.home ? tot / 2 - hs / 2 : tot / 2 + hs / 2).toFixed(1)} pts`);
  const n = { game1: 1, game2: 2, game3: 3 }[tdSort] || 99;
  const side = (team) => { const rows = (g.td || []).filter((r) => r.team === team && r.fair != null && usable(r)).sort((a, b) => b.fair - a.fair).slice(0, n);
    const gp = g.tdGroups && g.tdGroups[team], groups = gp ? ["RB", "WR", "TE"].filter((k) => gp[k] != null).map((k) => `${k} ${Math.round(gp[k])}%`).join(" · ") : "";
    return `<div><div class="sh" style="color:#c9c9cf">${tlogo(team)}${team} <span class="s" style="font-weight:400">${implied(team)}</span></div>${groups ? `<div class="s" style="margin-bottom:2px">Chance any one of them scores: ${groups}</div>` : ""}${rows.map((r) => prow(r, g, false)).join("") || '<div class="s">No players yet — tap ▶ Rerun model.</div>'}</div>`; };
  return `<div class="card${g.final ? " fin" : ""}" style="margin-top:10px"><div class="inner">${headButtons(g, id, lines)}<div class="teams">${side(g.away)}${side(g.home)}</div>${(g.espnRemoved || []).length ? `<div class="s r" style="margin-top:6px">Removed — ESPN lists them out for this game: ${esc(g.espnRemoved.join(", "))}</div>` : ""}${(g.tdUnmodeled || []).length ? `<div class="s" style="margin-top:6px">Also on Polymarket with a real market, <b>not in the model</b> (QBs, returners, new or dropped players — check before buying): ${g.tdUnmodeled.map((u) => `${esc(u.player)} ${Math.round(u.price * 100)}¢${u.thin ? " (thin)" : ""}`).join(" · ")}</div>` : ""}</div>${cover(g, null)}</div>`;
}
function renderTd() {
  const wk = S.week ? ` — Week ${S.week}` : "";
  $("td-header").textContent = `Anytime TD${wk}`;
  if (tdSort === "likely") {
    const rows = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).map((r) => ({ r, g })))
      .filter((x) => x.r.fair != null && usable(x.r)).sort((a, b) => b.r.fair - a.r.fair);
    const moves = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).filter((r) => r.move).map((r) => r)).sort((a, b) => Math.abs(b.move) - Math.abs(a.move)).slice(0, 10);
    const moveBox = moves.length ? `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Price moves (5¢+, real markets)</div>${moves.map((r) => `<div class="row"><span>${esc(r.player)} <span class="dim">${esc(r.game)}</span></span><span class="${r.move > 0 ? "g" : "r"}">${r.move > 0 ? "+" : ""}${r.move}¢ → ${Math.round(r.price * 100)}¢</span></div>`).join("")}</div></div>` : "";
    const shown = tdShowAll ? rows : rows.slice(0, 40);   // top 40 by default (9/30): 300+ rows was hard to use on a phone
    $("td").innerHTML = moveBox + shown.map((x) => `<div class="card" style="margin-top:10px">${prow(x.r, x.g, true)}</div>`).join("") +
      (rows.length > 40 ? `<div class="center"><button class="btn" id="td-all">${tdShowAll ? "Show top 40 only" : `Show all ${rows.length} players`}</button></div>` : "") ||
      '<div class="card" style="margin-top:10px"><div class="s">No players yet — tap ▶ Rerun model.</div></div>';
    if ($("td-all")) $("td-all").onclick = () => { tdShowAll = !tdShowAll; renderTd(); };
    return;
  }
  // What moves a player up or down vs a given opponent (tested 2023-25): the team's implied points from the betting line
  // (a lead RB ~39% at 17 implied points vs ~50% at 27). Opponent "TDs allowed" stats barely matter once the line is known.
  $("td").innerHTML = `<div class="s dim" style="margin-top:8px">Top ${{ game1: 1, game2: 2, game3: 3 }[tdSort] || ""} per team. Order comes from each player's own usage (targets, red-zone and goal-line work, snaps) times his team's implied points against this opponent — the betting line already prices how good the defense is.</div>` +
    [...S.games].sort(order).map((g, i) => tdCard(g, "d" + i)).join("");
}
// ---------- Record: Mine ----------
const RESMARK = { W: '<span class="g">✓</span>', L: '<span class="r">✗</span>', P: '<span class="dim">=</span>', pending: '<span class="dim">•</span>' };
function legName(l) { return esc(l.kind === "td" ? `${l.player} TD` : l.kind === "spread" ? `${l.team} ${sgn(l.line)}` : `${l.side === "over" ? "Over" : "Under"} ${l.line}`); }
function betRow(b) {
  if (b.source === "account") {   // bet recorded automatically from your Polymarket account
    const st = b.result === "W" ? '<span class="g">Won</span>' : b.result === "L" ? '<span class="r">Lost</span>' : b.result === "P" ? "Even" : b.result === "settled" ? '<span class="y">settled — P/L not reported</span>' : '<span class="dim">open</span>';
    return `<div class="row"><span>${esc(b.title)}${b.outcome ? ` — ${esc(b.outcome)}` : ""} <span class="dim">wk ${b.week ?? "?"}</span></span><span>${st}${b.pl != null ? ` ${cMoney(b.pl)}` : ""}</span></div>` +
      `<div class="s" style="padding:0 0 6px 8px">${money(b.cost)}${b.price != null ? ` at ${Math.round(b.price * 100)}¢` : ""} · pays ${money(b.toWin)} if it wins · auto-recorded from your account</div>`;
  }
  const hit = b.legs.filter((l) => l.result === "W").length;
  const state = b.result === "W" ? '<span class="g">Won</span>' : b.result === "L" ? '<span class="r">Lost</span>' : b.result === "P" ? (b.pushUnconfirmed ? '<span class="y">Push leg — check how Polymarket settled it</span>' : "Push") : `<span class="dim">${hit} of ${b.legs.length} hit</span>`;
  return `<div class="row"><span>${b.legs.length > 1 ? "Combo" : "Single"} · ${money(b.cost)} → ${money(b.toWin)}</span><span>${state}${b.pl != null ? ` ${cMoney(b.pl)}` : ""}</span></div>` +
    `<div class="s" style="padding:0 0 6px 8px">${b.legs.map((l) => `${RESMARK[l.result]} ${legName(l)}${l.clv != null ? ` <span class="${signCls(l.clv)}">(${(l.clv * 100).toFixed(0)}%)</span>` : ""}`).join(" · ")}</div>`;
}
function renderMine() {
  if (!MB) { $("record-mine").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">Loading…</div></div>'; return; }
  const s = MB.summary, open = MB.bets.filter((b) => b.result === "pending"), done = MB.bets.filter((b) => b.result !== "pending");   // includes auto-recorded account bets
  const settledPl = done.reduce((a, b) => a + (b.pl || 0), 0);
  const synced = MB.synced && MB.synced.list ? MB.synced.list : [];
  const syncedRows = synced.map((p) => {
    const pl = p.realized != null ? p.realized : p.value != null && p.cost != null ? p.value - p.cost : null;
    return `<div class="row"><span>${esc(p.title)}${p.outcome ? ` — ${esc(p.outcome)}` : ""}${p.expired ? " (settled)" : ""}</span>` +
      `<span>${p.shares} sh · ${money(p.cost || 0)}${p.value != null ? ` → ${money(p.value)}` : ""}${pl != null ? ` ${cMoney(pl)}` : ""}</span></div>`;
  }).join("");
  $("record-mine").innerHTML = `<div class="card" style="margin-top:10px">` +
    `<div class="sec"><div class="sh">Open bets</div>${open.map(betRow).join("") || '<div class="s">No open bets.</div>'}</div>` +
    `<div class="sec"><div class="sh">Expected returns</div>` +
    `<div class="row"><span class="dim">If everything hits</span><span>${money(s.maxPayout)} (${cMoney(s.maxPayout - s.openCost)})</span></div>` +
    `<div class="row"><span class="dim">Expected · market</span><span>${money(s.expMarket)} (${cMoney(s.expMarket - s.openCost)})</span></div>` +
    `<div class="row"><span class="dim">Expected · your model</span><span>${s.modelCovered ? `${money(s.expModel)} (${cMoney(s.expModel - s.expModelCost)})` : "—"}</span></div></div>` +
    `<div class="fold" data-drop="settled"><span>Settled bets${done.length ? ` · ${cMoney(settledPl)}` : ""}</span><span>▾</span></div>` +
    `<div class="drop" id="settled">${done.map(betRow).join("") || '<div class="s">Nothing settled yet — bets grade automatically when games go final.</div>'}</div>` +
    `<div class="fold" data-drop="synced"><span>Live account view${synced.length ? ` · ${synced.length}` : ""} <span class="dim">(already counted in your bets above)</span></span><span>▾</span></div>` +
    `<div class="drop open" id="synced">${syncedRows || '<div class="s">No synced positions yet — tap ↻ Sync account.</div>'}</div></div>` +
    `<div class="center"><button class="btn" id="sync-btn">↻ Sync account</button></div>`;
  $("sync-btn").onclick = () => loadRecord(true);
}
// ---------- Record: Model ----------
function rec(list) { const c = { W: 0, L: 0, P: 0 }; list.forEach((x) => c[x.result]++); return `${c.W}–${c.L}${c.P ? "–" + c.P : ""}`; }
function renderModel() {
  if (!MB || !RES) { $("record-model").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">Loading…</div></div>'; return; }
  const s = MB.summary, res = RES;
  const weeks = [...new Set(res.map((r) => r.week))].sort((a, b) => b - a), lw = weeks[0];
  const wk = res.filter((r) => r.week === lw);
  const pick = (k, list) => list.filter((r) => r[k]).map((r) => r[k]);
  // Tier labels (Weak/Moderate/Strong) were removed from the cards: calibrated spread/total chances sit ~50%, so every
  // pick would land in one bucket. Season record is shown plain instead.
  const seasonRec = pick("spread", res).length || pick("total", res).length
    ? `<div class="row"><span class="dim">Spread · total leans (~50/50 by design)</span><span>${rec(pick("spread", res))} · ${rec(pick("total", res))}</span></div>` +
      '<div class="s dim">Spread/total picks sit near 50% by design (the model has no measured edge there), so expect about .500. Picks before 9/28 used the old uncalibrated numbers.</div>' : "";
  // Model accuracy (TD model check, Top picks, recap) uses players who PLAYED; the model's % assumes he plays. The
  // Polymarket comparison below uses everyone, because an inactive player's market really does settle No.
  const tdAllAny = res.flatMap((r) => r.td || []), tdAll = tdAllAny.filter((p) => p.played !== false);
  const buckets = [[10, 20], [20, 30], [30, 40], [40, 50], [50, 101]].map(([lo, hi]) => {
    const xs = tdAll.filter((p) => p.fair >= lo && p.fair < hi); if (!xs.length) return "";
    const rate = xs.filter((p) => p.scored).length / xs.length * 100, mid = xs.reduce((a, p) => a + p.fair, 0) / xs.length;
    // "too high/low" only when the gap is bigger than chance alone would produce (2 standard errors), not just 5 points:
    // 28% of 29 vs a 35% forecast is normal luck (±18 pts), and calling it "too high" was a false signal.
    const se2 = 2 * Math.sqrt(mid * (100 - mid) / xs.length), gap = rate - mid;
    const verdict = xs.length < 20 ? '<span class="dim">small sample</span>' : Math.abs(gap) <= 5 ? '<span class="g">on target</span>' :
      Math.abs(gap) <= se2 ? '<span class="dim">within normal luck</span>' : gap < 0 ? '<span class="r">too high</span>' : '<span class="y">too low</span>';
    return `<div class="row"><span class="dim">Said ${lo}–${hi > 100 ? "+" : hi}%</span><span>scored ${rate.toFixed(0)}% of ${xs.length} · ${verdict}</span></div>`;
  }).join("");
  // TD model vs Polymarket: same graded players, scored against the closing price. Brier = average squared miss
  // (lower is better). Market chance = middle of bid/ask when there is a bid (the ask alone includes the spread).
  // Only REAL markets count: someone bidding within 5¢ of the ask (40% of it for cheap long shots). A thin market (e.g. 40¢ ask, 1¢ bid) has no
  // real price, and averaging its bid/ask invented a fake "market chance" that made Polymarket look worse (Week 3:
  // 170 of 258 players were thin; on real markets model and market were ~tied).
  const priced = tdAllAny.filter((p) => p.ask > 0 && p.ask < 1);
  // Model chance as the TD tab showed it: the model's % assumes he plays, so a player listed Questionable/Out that week
  // is scaled by his chance to play (same rule as the tab, 9/30). The market's price already includes that risk.
  const avail = (p) => (/^(out|doubtful)$/i.test(p.rep || "") ? 0.01 : /^questionable$/i.test(p.rep || "") ? 0.669 : 1);
  const mp = (p) => (p.fair / 100) * avail(p);
  const isThin = (p) => !(p.bid > 0) || p.ask - p.bid > Math.min(0.05, 0.4 * p.ask);   // same rule as lib/odds.js isThinMarket
  const tdPx = priced.filter((p) => !isThin(p)), thinN = priced.length - tdPx.length;
  let vsMkt = "";
  if (tdPx.length) {
    const y = (p) => (p.scored ? 1 : 0), mk = (p) => (p.bid ? (p.bid + p.ask) / 2 : p.ask);
    const bM = tdPx.reduce((a, p) => a + (mp(p) - y(p)) ** 2, 0) / tdPx.length;
    const bP = tdPx.reduce((a, p) => a + (mk(p) - y(p)) ** 2, 0) / tdPx.length;
    const buys = tdPx.filter((p) => mp(p) > p.ask);
    const pl = buys.reduce((a, p) => a + (p.scored ? 1 / p.ask - 1 : -1), 0);
    const hits = buys.filter((p) => p.scored).length;
    const small = tdPx.length < 200 ? ' <span class="dim">· small sample (needs ~200+)</span>' : "";
    vsMkt = `<div class="row"><span class="dim">Players checked (real markets)</span><span>${tdPx.length}${small}</span></div>` +
      (thinN ? `<div class="row"><span class="dim">Thin markets skipped</span><span>${thinN} <span class="dim">· no real bid</span></span></div>` : "") +
      `<div class="row"><span class="dim">Accuracy score (lower is better)</span><span>Model ${bM.toFixed(3)} · Polymarket ${bP.toFixed(3)} ` +
      (bM < bP ? '<span class="g">model ahead</span>' : '<span class="r">market ahead</span>') + `</span></div>` +
      `<div class="row"><span class="dim">$1 on Yes when model &gt; price</span><span>${hits} of ${buys.length} scored · ${cMoney(pl)} ${buys.length ? `(${cPct(pl / buys.length)})` : ""}</span></div>` +
      // The other side of the same markets: most of the model's disagreements are "less likely than the price says"
      // (Week 3: model below market on 67 of 83 real markets), and a Yes-only check ignored all of them. Buying No
      // costs 1 − bid. Tracked here, not recommended, until it has a real sample.
      (() => { const no = tdPx.filter((p) => 1 - mp(p) > 1 - p.bid);
        const plNo = no.reduce((a, p) => a + (!p.scored ? 1 / (1 - p.bid) - 1 : -1), 0);
        return `<div class="row"><span class="dim">$1 on No when model &lt; price</span><span>${no.filter((p) => !p.scored).length} of ${no.length} won · ${cMoney(plNo)} ${no.length ? `(${cPct(plNo / no.length)})` : ""}</span></div>`; })() +
      `<div class="row"><span class="dim">Scored vs priced</span><span>${(tdPx.filter((p) => p.scored).length / tdPx.length * 100).toFixed(0)}% scored · Polymarket priced ${(tdPx.reduce((a, p) => a + mk(p), 0) / tdPx.length * 100).toFixed(0)}% · model ${(tdPx.reduce((a, p) => a + mp(p) * 100, 0) / tdPx.length).toFixed(0)}%</span></div>` +
      // TD model CLV (added 9/29): for players where the model was above the OPENING price (first snapshot of the week),
      // did the closing price move toward the model? The fastest signal of real edge, long before win/loss means anything.
      (() => { const c = tdPx.filter((p) => p.openAsk > 0 && p.openBid > 0 && p.openAsk - p.openBid <= Math.min(0.05, 0.4 * p.openAsk) && mp(p) > p.openAsk)   /* opening price must be a real market too */
          .map((p) => (p.bid + p.ask) / 2 / p.openAsk - 1);
        return `<div class="row"><span class="dim">Did prices move toward the model? (model above the opening price)</span><span>${c.length ? `${cPct(c.reduce((a, x) => a + x, 0) / c.length)} avg · ${c.length} players` : "starts Week 4 (needs opening prices)"}</span></div>`; })() +
      '<div class="s dim">Closing prices, before fees, real markets only. The test of whether the TD model beats Polymarket.</div>';
  }
  const st = S.status, wc = S.weekCheck || { games: 0, withLines: 0, modelRun: false, watch: [] };
  const stOk = st && st.ok && !st.creditWarning;
  const stRows = st ? [
    ["Last automatic run", st.auto ? `${hm(st.auto.t)} · ${esc(st.auto.what)}` + (Date.now() - new Date(st.auto.t) > 9 * 3600e3 ? ' <span class="y">(stale — scheduler not reaching the site)</span>' : "") : '<span class="y">none recorded — scheduler not reaching the site</span>'],
    ["Last snapshot", st.lastSnapshot ? hm(st.lastSnapshot) + (S.meta && S.meta.lastSrc === "manual" ? " · you" : "") : "—"], ["Last model run", st.modelRunAt ? hm(st.modelRunAt) : "—"],
    ["Last self-check", st.selfcheck ? `${hm(st.selfcheck.t)} · ${st.selfcheck.items.length ? `<span class="y">${st.selfcheck.items.length} issue(s) — see Watchdog</span>` : '<span class="g">all clear</span>'}` : "— (Thu 12:05 PM, Fri 5:05 PM, Sun 7:35 AM)"],
    ["Pre-logged at kickoff", `${st.prelogged || 0} of ${(S.games || []).length} games this week`],
    ["Last backup", st.backup ? `${hm(st.backup.t)} · ${st.backup.where === "volume" ? "saved" : st.backup.where === "failed" ? '<span class="r">failed — check Railway logs</span>' : '<span class="y">temporary — add a Railway volume</span>'}` : '<span class="y">none yet</span>'],
    ["Last TD retrain", st.retrain ? `${hm(st.retrain.t)} · ${esc(st.retrain.summary)}` : '<span class="dim">not run yet — runs every Tuesday</span>'],
    ["Database used", st.usedMb != null ? `${st.usedMb.toFixed(1)} of ${st.capMb} MB` : "—"],
    ["Sportsbook credits left", st.creditWarning ? `<span class="y">${st.credits ?? "—"}</span>` : (st.credits ?? "—")],
  ].map(([a, b]) => `<div class="row"><span class="dim">${a}</span><span>${b}</span></div>`).join("") +
    (st.creditWarning ? `<div class="s y">⚠ ${esc(st.creditWarning)}</div>` : "") +
    ((st.errors || []).length ? st.errors.map((e) => `<div class="s y">⚠ ${hm(e.t)} · ${esc(e.where)}: ${esc(e.msg)}</div>`).join("") : '<div class="s g">No errors this week.</div>') : "";
  const games = res.map((r) => `<div class="row"><span>${esc(r.game)} <span class="dim">wk ${r.week} · ${r.awayScore}–${r.homeScore}</span></span><span>` +
    [r.spread, r.total, r.ml].filter(Boolean).map((x) => `${esc(x.label)} ${x.result === "W" ? '<span class="g">W</span>' : x.result === "L" ? '<span class="r">L</span>' : "P"}`).join(" · ") + `</span></div>`).join("");
  $("record-model").innerHTML = `<div class="card" style="margin-top:10px">` +
    `<div class="sec"><div class="sh">Summary</div>` +
    `<div class="row"><span class="dim">Your record · P/L</span><span>${s.wins}–${s.losses}${s.pushes ? "–" + s.pushes : ""} · ${cMoney(s.pl)}</span></div>` +
    `<div class="row"><span class="dim">Return · avg price move your way</span><span>${cPct(s.roi)} · ${cPct(s.avgClv)}${s.clvCount != null ? ` <span class="dim">(${s.clvCount} bet${s.clvCount === 1 ? "" : "s"} with closing prices)</span>` : ""}</span></div>` +
    `<div class="row"><span class="dim">Open this week</span><span>${money(s.openCost)} of $200</span></div></div>` +
    `<div class="sec"><div class="sh">Week ${lw ?? S.week} recap</div>` +
    (wk.length ? `<div class="row"><span class="dim">Tilts: spreads · totals · moneyline</span><span>${rec(pick("spread", wk))} · ${rec(pick("total", wk))} · ${rec(pick("ml", wk))}</span></div>` +
    (pick("mlModel", wk).length ? `<div class="row"><span class="dim">Moneyline (stats-only model)</span><span>${rec(pick("mlModel", wk))}</span></div>` : "") + `` : '<div class="s">No finished games graded yet.</div>') +
    // Tuesday recap (added 9/29): the finished week's TD results and your bets, next to the line tilts.
    (() => { const tdW = wk.flatMap((r) => r.td || []), td = tdW.filter((p) => p.played !== false); if (!tdW.length) return "";
      const exp = td.reduce((a, p) => a + p.fair, 0) / 100, hit = td.filter((p) => p.scored).length;
      const real = tdW.filter((p) => p.ask > 0 && p.bid > 0 && p.ask - p.bid <= Math.min(0.05, 0.4 * p.ask)), y = (p) => (p.scored ? 1 : 0);
      const bm = real.length ? real.reduce((a, p) => a + (mp(p) - y(p)) ** 2, 0) / real.length : null, bp = real.length ? real.reduce((a, p) => a + ((p.ask + p.bid) / 2 - y(p)) ** 2, 0) / real.length : null;
      const mine = (MB.bets || []).filter((b) => b.week === lw && b.result !== "pending"), mpl = mine.reduce((a, b) => a + (b.pl || 0), 0);
      return `<div class="row"><span class="dim">TD model</span><span>${hit} scored · model expected ${exp.toFixed(1)} (${td.length} players who played${tdW.length > td.length ? `; ${tdW.length - td.length} inactive left out` : ""})</span></div>` +
        (bm != null ? `<div class="row"><span class="dim">TD vs Polymarket (real markets)</span><span>${real.length} players · model ${bm.toFixed(3)} · Polymarket ${bp.toFixed(3)}</span></div>` : "") +
        `<div class="row"><span class="dim">Your bets</span><span>${mine.length ? `${mine.filter((b) => b.result === "W").length}–${mine.filter((b) => b.result === "L").length} · ${cMoney(mpl)}` : "none settled"}</span></div>`; })() +
    `<div class="row"><span class="dim">Week ${S.week} loaded</span><span>${wc.games} games · lines ${wc.withLines}/${wc.games} · model ${wc.modelRun ? '<span class="g">✓</span>' : '<span class="y">not run yet</span>'}</span></div>` +
    ((wc.watch || []).length ? `<div class="s" style="margin-top:6px"><b class="y">Watchdog</b>${wc.watch.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}</div>` : '<div class="s dim" style="margin-top:6px">Watchdog: nothing missing or stale.</div>') + `</div>` +
    `<div class="sec"><div class="sh">Season record</div>${seasonRec || '<div class="s">No graded picks yet.</div>'}` +
    `<div class="row"><span class="dim">Moneyline (market-based)</span><span>${rec(pick("ml", res))}</span></div>` +
    `<div class="row"><span class="dim">Moneyline (stats-only model)</span><span>${pick("mlModel", res).length ? rec(pick("mlModel", res)) : "—"}</span></div>` +
    `</div>` +
    `<div class="sec"><div class="sh">TD model check</div>${buckets || '<div class="s">Fills in as games go final.</div>'}</div>` +
    // Top picks: the model's #1 and #2 per team each game, scored vs how many the model itself expected to hit.
    // A 40% pick misses 6 times in 10, so "most picks missed" is normal; the test is actual vs expected.
    (() => { const byTeam = {}; for (const r of res) for (const p of (r.td || []).filter((x) => x.played !== false)) (byTeam[r.game + "|" + p.team] = byTeam[r.game + "|" + p.team] || []).push(p);
      const top = (n) => Object.values(byTeam).flatMap((ps) => ps.slice().sort((a, b) => b.fair - a.fair).slice(0, n));
      const line = (lab, L) => L.length ? `<div class="row"><span class="dim">${lab}</span><span>${L.filter((p) => p.scored).length} of ${L.length} scored · model expected ${(L.reduce((a, p) => a + p.fair, 0) / 100).toFixed(1)}</span></div>` : "";
      const t1 = top(1), t2 = top(2);
      const all = Object.values(byTeam).flat();
      const two = all.filter((p) => p.two != null), ftd = all.filter((p) => p.ftd != null);
      const extra = (two.length ? `<div class="row"><span class="dim">2+ TDs</span><span>${two.filter((p) => p.twoHit).length} players did it · model expected ${(two.reduce((a, p) => a + p.two, 0) / 100).toFixed(1)}</span></div>` : "") +
        (ftd.length ? `<div class="row"><span class="dim">First TD of the game</span><span>${ftd.filter((p) => p.ftdHit).length} listed players scored first · model expected ${(ftd.reduce((a, p) => a + p.ftd, 0) / 100).toFixed(1)}</span></div>` : "");
      return t1.length ? `<div class="sec"><div class="sh">Top TD picks</div>${line("#1 per team", t1)}${line("Top 2 per team", t2)}${extra}</div>` : ""; })() +
    // Polymarket-vs-sportsbooks tracker (9/30): spots where Polymarket was 3%+ better than fresh no-vig sportsbook prices.
    (() => { const e = EDGES; const pct = (x) => (x == null ? "—" : cPct(x));
      const body = !e || !e.logged ? '<div class="s">Logs itself from the next snapshots (needs fresh sportsbook odds); grades as games go final.</div>' :
        `<div class="row"><span class="dim">Spots logged · graded</span><span>${e.logged} · ${e.graded}</span></div>` +
        (e.graded ? `<div class="row"><span class="dim">Record · return per $1</span><span>${e.w}–${e.l}${e.p ? "–" + e.p : ""} · ${pct(e.roi)} <span class="dim">(claimed edge ${pct(e.avgEv)})</span></span></div>` +
          `<div class="row"><span class="dim">Beat the closing price (price moved your way)</span><span>${pct(e.avgClv)} <span class="dim">(${e.clvN} with a same-line close)</span></span></div>` +
          e.byMarket.filter((m) => m.n).map((m) => `<div class="row"><span class="dim">${{ spread: "Spreads", ml: "Moneylines", total: "Totals" }[m.market]}</span><span>${m.w} of ${m.n} won · ${pct(m.roi)}</span></div>`).join("") +
          `<div class="s dim">Real edge shows up first as prices moving your way after you'd have bet; win/loss needs ~200+ graded spots before it means much.</div>` : "");
      return `<div class="sec"><div class="sh">Polymarket vs sportsbooks (edge tracker)</div>${body}</div>`; })() +
    `<div class="sec"><div class="sh">TD model vs Polymarket</div>${vsMkt || '<div class="s">Fills in as games go final (needs closing TD prices).</div>'}</div>` +
    `<div class="fold" data-drop="miss"><span>Miss finder</span><span>▾</span></div>` +
    `<div class="drop" id="miss">${(S.missFinder && S.missFinder.misses && S.missFinder.misses.length) ?
      S.missFinder.misses.map((m) => `<div class="row" style="display:block"><b>${esc(m.pattern)}</b><div class="s">${esc(m.note)}</div></div>`).join("") :
      '<div class="s">No consistent misses found yet this season.</div>'}</div>` +
    `<div class="fold" data-drop="gbg"><span>Game-by-game results</span><span>▾</span></div><div class="drop" id="gbg">${games || '<div class="s">None yet.</div>'}</div>` +
    `<div class="fold" data-drop="sys"><span>System status ${stOk ? '<span class="g">all good</span>' : '<span class="y">check</span>'}</span><span>▾</span></div>` +
    `<div class="drop${!stOk ? " open" : ""}" id="sys">${stRows}</div></div>` +
    `<div class="center"><button class="btn" id="export-btn">Export data</button></div>`;
  $("export-btn").onclick = () => (window.location.href = "/api/results/export");
}
function renderRecord() { renderMine(); renderModel(); $("record-mine").style.display = recView === "mine" ? "" : "none"; $("record-model").style.display = recView === "model" ? "" : "none"; }
async function loadRecord(sync = false) {
  if (sync) toast("Syncing your Polymarket account…", 0);
  try {
    const [mb, rl] = await Promise.all([fetch(`/api/mybets${sync ? "?sync=1" : ""}`).then((r) => r.json()), fetch("/api/results/list").then((r) => r.json())]);
    if (!mb.ok) throw new Error(mb.error); MB = mb; RES = rl.ok ? rl.results : []; EDGES = rl.ok ? rl.edges : null;
    renderRecord();
    if (sync && mb.sync) toast(mb.sync.ok ? `Synced ${mb.sync.positions} positions.` : `Sync: ${mb.sync.note}`);
  } catch (e) { toast("Record failed: " + e.message, 10000); }
}
// ---------- header / load / buttons ----------
function weekline() {
  const ks = S.games.map((g) => new Date(g.kickoff)).sort((a, b) => a - b), f = (d) => d.toLocaleString(undefined, { month: "short", day: "numeric" });
  // Week spanning two months (e.g. Sep 28 – Oct 2): repeat the month; before, it read "Sep 28–2".
  const a = ks[0], z = ks[ks.length - 1];
  const range = ks.length ? (a.getMonth() === z.getMonth() ? `${f(a)}–${z.getDate()}` : `${f(a)} – ${f(z)}`) : "";
  const m = S.meta || {};
  const round = { 19: "Wild Card", 20: "Divisional round", 21: "Conference Championships", 22: "Super Bowl" }[S.week];
  $("weekline").innerHTML = `${round || `Week ${S.week}`} · ${range} · updated: Polymarket ${clock(m.lastSnapshot)} · sportsbooks ${clock(S.booksAt)} · model ${clock(S.modelRunAt)} <span class="dim">(your time)</span>`;
}
function renderAll() { weekline(); renderLines(); renderTotals(); renderTd(); if (MB) renderRecord(); }
async function loadSlate() { const d = await (await fetch("/api/slate")).json(); if (!d.ok) throw new Error(d.error); S = d; renderAll();
  try { localStorage.setItem("lastSeen", new Date().toISOString()); } catch {} }   // next visit's "What changed" starts from now
$("refresh-btn").onclick = async () => {
  const b = $("refresh-btn"); b.disabled = true; toast("Pulling current Polymarket lines…", 0);
  try { const d = await (await fetch("/api/snapshot?src=manual")).json(); if (!d.ok) throw new Error(d.error); await loadSlate();
    toast(`Updated ${d.lines} of ${d.upcoming} upcoming games${d.locked ? ` (${d.locked} locked)` : ""}, TD prices for ${d.props}.`);
  } catch (e) { toast("Refresh failed: " + e.message, 10000); }
  b.disabled = false;
};
$("rerun-btn").onclick = async () => {
  const b = $("rerun-btn"); b.disabled = true; toast("Rerunning both models at current lines — up to a couple of minutes…", 0);
  try { const d = await (await fetch("/api/rerun", { method: "POST" })).json(); if (!d.ok) throw new Error(d.error); await loadSlate();
    toast(`Model rerun: ${d.rerun} games, TD for ${d.td}.${d.errors && d.errors.length ? " Errors: " + d.errors.join("; ") : ""}`, 10000);
  } catch (e) { toast("Rerun failed: " + e.message, 12000); }
  b.disabled = false;
};
document.querySelectorAll(".tabs button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("on")); btn.classList.add("on");
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on")); $("panel-" + btn.dataset.tab).classList.add("on");
  if (btn.dataset.tab === "record") loadRecord();
}));
document.querySelectorAll("#panel-td .controls button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("#panel-td .controls button").forEach((x) => x.classList.remove("on")); btn.classList.add("on"); tdSort = btn.dataset.sort; renderTd();
}));
document.querySelectorAll(".sw button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll(".sw button").forEach((x) => x.classList.remove("on")); btn.classList.add("on"); recView = btn.dataset.view; renderRecord();
}));
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-drop]"); if (d) { const el = $(d.dataset.drop); if (el) el.classList.toggle("open"); return; }
  const p = e.target.closest(".price-link"); if (p) toast(p.dataset.market ? "Polymarket market: " + p.dataset.market : "No market recorded for this price.", 8000);
});
loadSlate().catch((e) => ($("weekline").textContent = "Couldn't load this week: " + e.message));
