// NFL SLATEZZZ — everything comes from /api/slate (lines, TD, flags) and /api/mybets + /api/results/list (Record).
let tdShowAll = false, WINALL = false;
let PAPER = null, PICKS = null;
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
const tm = (iso) => (!iso || isNaN(new Date(iso)) ? "TBD" : new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }));
const hm = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const clock = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");
function toast(msg, ms = 7000) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._h); if (ms) toast._h = setTimeout(() => t.classList.remove("show"), ms); }

// ---------- shared card parts ----------
function status(g) {
  if (g.final) return `Final ${g.awayScore != null && g.homeScore != null ? `${g.awayScore}–${g.homeScore}` : ""}`;
  if (g.started) return '<span class="r">Live · locked</span>';
  return "not started";
}
function headButtons(g, id, extra = "", noWarn = false) {
  const n = noWarn ? 0 : (g.injuries || []).length;
  return `<div class="top"><div><div class="gh">${matchup(g)}${g.badge ? `<span class="badge">${esc(g.badge)}</span>` : ""}</div><div class="sub">${tm(g.kickoff)} · ${status(g)}${extra}</div>` +
    (!noWarn && g.qb && g.qb.length && !g.final ? `<div class="warn">⚠ ${esc(g.qb.join(" · "))} · ${qbAdjusted(g) ? "model adjusted (estimate)" : "not in the model yet — it adjusts once this week's injury report lists the starter Out/Doubtful (Wed–Fri report, then the Thu/Sat reruns)"}</div>` : "") +
    (!noWarn && g.dataCheck ? `<div class="warn">⚠ ${esc(g.dataCheck)}</div>` : "") + `</div>` +
    `<div class="btns" style="margin-top:0;flex-shrink:0">${n ? `<button class="tag" data-drop="inj-${id}">Injuries ${n} ▾</button>` : ""}<button class="tag" data-drop="his-${id}">History ▾</button></div></div>` +
    `<div class="drop" id="inj-${id}"><div class="s" style="margin-bottom:4px">Official report${(() => { const w = [...new Set((g.injuries || []).map((x) => x.week))]; return w.length ? ` · Week ${w.join("/")}` + (w.every((x) => Number(x) !== Number(S.week)) ? " (last week's — this week's first report comes out Wednesday)" : "") : ""; })()} · updated ${S.injuriesUpdated ? hm(S.injuriesUpdated) : "—"}</div>` +
    (g.injuries || []).map((x) => `<div class="drow"><span>${injBadge(x.team)}${esc(x.name)} <span class="dim">${esc(x.pos || "")} · ${x.team}</span></span><span class="${/out/i.test(x.status) ? "r" : /doubt/i.test(x.status) ? "r" : "y"}">${esc(x.status)}</span></div>`).join("") + `</div>` +
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
    `<div class="drow dim"><span>Since</span><span>SPREAD</span><span>TOTAL</span><span>MONEYLINE</span></div>` +
    rows.slice().reverse().map((r, i) => `<div class="drow"><span>${hm(r.from.t)}${r.from.src === "kickoff" ? " 🔒" : ""}` +
      `${r.last !== r.from ? `<br><span class="dim">last checked ${hm(r.last.t)}</span>` : ""}${i === rows.length - 1 ? '<br><span class="dim">opening line</span>' : ""}</span>${cell(r.from.poly)}</div>`).join("");
}
const HDR = `<div class="hd">MARKET</div><div class="hd hm">MODEL</div>`;
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
  const wrap = (inner) => `<div class="modelcell" style="grid-row:span 2">${head}${inner}</div>`;
  if (!p) return wrap(dash);
  // finished games hide warnings under the cover
  if (p.warn && g.final) p = { ...p, warn: null };
  const reason = kind === "total" ? totalReason(g) : spreadReason(g), adj = injLine(g, kind);
  const m = g.model, wind = kind === "total" && m ? (m.outdoor && m.wind != null ? `wind ${m.wind} mph` : g.outdoor ? "outdoor" : "dome / roof") : "";
  // Protocol 3.3: calibrated cover/Under near 50% is the correct output, NOT a lean. Before 9/28 the card still printed
  // the >50% side as the pick (e.g. "GB -1.5 · 52.1%") even when "Model sees TB by 4.6" sat right under it, because the
  // calibration slightly fades the model. Within 2.5 pts of 50% it now says so; the tilt stays visible in small text.
  const coin = Math.abs(p.pct - 50) < 2.5;
  return wrap((coin ? `<span>No lean · about 50/50</span><div class="s">Model's side: <b class="mod">${esc(p.label)}</b> (${p.gap != null ? p.gap.toFixed(1) : "?"} pts off the line; ~${Math.round(p.pct)}% historically)</div>` :
    `<span>${p.label}</span><div class="s">${p.pct.toFixed(1)}% model chance</div>`) +
    (reason ? `<div class="s" style="margin-top:6px">${esc(reason)}</div>` : "") +
    (wind ? `<div class="s">${wind}</div>` : "") +
    (adj ? `<div class="s r" style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px">${injBadgeFor(g)}${esc(adj)}</div>` : "") +
    (p.warn ? `<div class="s y">${esc(p.warn)}</div>` : ""));
}
function cover(g, pick) {
  if (!g.final) return "";
  return `<div class="cover"><b>GAME FINISHED</b><div style="font-size:12.5px;color:#c9c9cf">${g.away} ${g.awayScore ?? ""} – ${g.home} ${g.homeScore ?? ""}` +
    (pick && pick.result ? ` · Model leaned ${pick.label} <span class="${pick.result === "won" ? "g" : pick.result === "lost" ? "r" : "dim"}">${pick.result}</span>` : "") + `</div></div>`;
}
const order = (a, b) => (a.final - b.final) || (a.started - b.started) || (new Date(a.kickoff) - new Date(b.kickoff));

// ---------- Game Lines ----------
// "Most likely winners" (9/30): the favorite in every upcoming game, ranked by chance to WIN the game (straight up, not the spread).
// Chance = the app's market-based win chance (g.winPct = home chance); moneyline prices are the fallback. The server records
// each game's favorite at kickoff and grades it, so the record below is real, not a backtest.
function winnerOf(g) {
  let ph = g.winPct != null ? g.winPct / 100 : null;
  if (ph == null && g.poly && g.poly.ml && g.poly.ml.home > 0 && g.poly.ml.away > 0) ph = g.poly.ml.home / (g.poly.ml.home + g.poly.ml.away);
  if (ph == null || ph === 0.5) return null;
  const home = ph > 0.5, price = g.poly && g.poly.ml ? (home ? g.poly.ml.home : g.poly.ml.away) : null;
  return { game: g.key, team: home ? g.home : g.away, opp: home ? g.away : g.home, where: home ? "home" : "away", p: home ? ph : 1 - ph, price };
}
function winnersBox(mode = "picks") {
  const P = S.picks || {}, pcx = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const pickRec = (m, name) => { const x = P[m]; return x && x.graded ? `<div class="row"><span class="dim">${name} (model's side)</span><span>${x.w}–${x.l} · ${m === "spread" ? "covered" : "right"} ${pcx(x.hit)}</span></div>` : `<div class="row"><span class="dim">${name} (model's side)</span><span class="dim">none graded yet</span></div>`; };
  const list = S.games.filter((g) => !g.started).map(winnerOf).filter(Boolean).sort((a, b) => b.p - a.p);
  const W = S.winners, pc = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const rec = W && W.all && W.all.n ? `<div class="row"><span class="dim">MONEYLINE · all picks</span><span>${W.all.w}–${W.all.l} · right ${pc(W.all.hit)} <span class="dim">(said ${pc(W.all.said)})</span></span></div>` +
    (W.top4 && W.top4.n ? `<div class="row"><span class="dim">MONEYLINE · each week's top 4</span><span>${W.top4.w}–${W.top4.l} · right ${pc(W.top4.hit)} <span class="dim">(said ${pc(W.top4.said)})</span></span></div>` : "") : '<div class="s dim">The record starts after this week\'s games: each pick is saved at kickoff and graded when the game ends.</div>';
  if (mode === "records") return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Records · model's side</div>${rec}${W && W.stats && W.stats.n ? `<div class="row"><span class="dim">Moneyline · stats-only model (no market)</span><span>${W.stats.w}–${W.stats.l} · right ${pc(W.stats.hit)}</span></div>` : ""}${pickRec("spread", "Spreads")}${pickRec("total", "Totals")}</div></div>`;
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Moneyline side · who wins the game</div>` +
    (list.slice(0, WINALL ? 99 : 8).map((x, i) => { const g = S.games.find((y) => y.key === x.game), sides = g ? modelSide(g) : [], sp = sides.find((s) => s.market === "Spread"), tt = sides.find((s) => s.market === "Total");
      return `<div class="row"><span>${i + 1}. <b>${esc(x.team)}</b> over ${esc(x.opp)} <span class="dim">· ${sp ? esc(sp.label) : "—"} · ${tt ? esc(tt.label) : "—"}</span></span><span>${Math.round(x.p * 100)}%${x.price ? ` <span class="dim">· ${Math.round(x.price * 100)}¢</span>` : ""}</span></div>`; }).join("") || '<div class="s">No lines yet.</div>') +
    (list.length > 8 ? `<div class="center" style="margin-top:6px"><button class="btn" id="win-all">${WINALL ? "Show top 8 only" : `Show all ${list.length} games`}</button></div>` : "") + `</div></div>`;
}
// "Right now" (9/30): Polymarket prices 3%+ better than fresh sportsbook fair prices -- the one realistic edge source.
function rightNowBox() {
  const E = S.edgesNow || [], R = S.edgeRule || {};
  const lim = R.booksMaxAgeEarlyH || R.booksMaxAgeH;
  const why = R.booksAgeH == null ? "no sportsbook odds yet this week" : R.booksAgeH > lim ? `sportsbook odds are ${Math.round(R.booksAgeH)} h old — the next scheduled pull refreshes them` : "none right now";
  const fee = R.feePct ? `after a ${R.feePct}% fee` : "before fees";
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Right now · Polymarket cheaper than the sportsbooks</div>` +
    (E.length ? E.map((b) => `<div class="row"><span>${esc(b.label)} <span class="dim">${esc(b.game)}</span>${b.held ? ` <span class="y">(${esc(b.held)} — hold)</span>` : ""}</span>` +
      `<span>${Math.round(b.price * 100)}¢ vs fair ${Math.round(b.fair * 100)}¢ · <span class="g">+${(b.evNet * 100).toFixed(1)}%</span></span></div>`).join("") : `<div class="s">No gap of 3%+ (${why}).</div>`) +
    `<div class="s dim" style="margin-top:4px">Gap = fair chance ÷ price − 1, ${fee}; book odds under ${R.booksMaxAgeEarlyH || 8} h old. Tracked on Record → Model.</div></div></div>`;
}
// "What changed" (9/30): Polymarket line moves since your last visit on this device.
let LAST_SEEN = null;
try { LAST_SEEN = localStorage.getItem("lastSeen"); } catch {}
function changedBox() {
  if (!LAST_SEEN) return "";
  const since = new Date(LAST_SEEN), out = []; let newWeek = 0;
  for (const g of S.games.filter((x) => !x.started)) {
    const before = [...(g.history || [])].filter((h) => h.poly && new Date(h.t) <= since).pop(), now = g.poly;
    if (!before || !now) { if (now) newWeek++; continue; }
    const a = before.poly, bits = [];
    if (a.spread && now.spread && a.spread.homeSpread !== now.spread.homeSpread) bits.push(`spread ${g.home} ${sgn(a.spread.homeSpread)} → ${sgn(now.spread.homeSpread)}`);
    if (a.total && now.total && a.total.line !== now.total.line) bits.push(`total ${a.total.line} → ${now.total.line}`);
    if (a.ml && now.ml && Math.abs(a.ml.home - now.ml.home) >= 0.05) bits.push(`${g.home} moneyline ${Math.round(a.ml.home * 100)}¢ → ${Math.round(now.ml.home * 100)}¢`);
    if (bits.length) out.push(`<div class="row"><span>${esc(g.key)}</span><span>${bits.join(" · ")}</span></div>`);
  }
  if (!out.length && !newWeek) return "";   // nothing to say: no card
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Changed since your last visit (${hm(LAST_SEEN)})</div>` +
    (out.join("") || `<div class="s">${newWeek} new game line${newWeek === 1 ? "" : "s"} opened — see each card's History.</div>`) + `</div></div>`;
}
function gameCard(g, i) {
  {
    const lv = liveFor(g), p = (lv && lv.poly) || g.poly || {}, b = g.books || {};   // live numbers for a game in progress; model and kickoff line stay locked
    const live = !g.started && p.spread ? '<span class="live"></span>' : "";
    const row = (k, v, mt, c) => `<div class="prl${mt ? " mt" : ""}"><span class="s">${k}</span><span class="${c || ""}">${v}</span></div>`;
    const poly = liveHead(g, lv) + (p.spread || p.ml ? `${live}` +
      (p.spread ? row("Spread", `${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}`, false, "mkt") + row("", `${g.away} ${sgn(-p.spread.homeSpread)} ${odds(toAmerican(p.spread.away))}`, false, "mkt") : "") +
      (p.ml ? row("Moneyline", `${g.home} ${odds(toAmerican(p.ml.home))}`, !!p.spread, "mlc") + row("", `${g.away} ${odds(toAmerican(p.ml.away))}`, false, "mlc") : "") : dash) + liveTail(g, lv);
    // Tested angle (9/30): home favorites of 9.5+ on the moneyline, the one game-line angle that held up on unseen years
    const hsNow = p.spread ? p.spread.homeSpread : b.spread ? b.spread.homeSpread : null;
    const angle = !g.final && hsNow != null && hsNow <= -9.5 ? `<div class="s g" style="margin:6px 0 0">★ Tested angle: ${g.home} moneyline (home favorite 9.5+). 2007–25: won ~88%, +2.6% per bet at sportsbook prices overall, but not steady (2007–12 +5.4%, 2013–18 −2.3%, 2019–25 +3.5%). Small edge at best, check Polymarket's price.</div>` : "";
    return `<div class="card${g.final ? " fin" : ""}"><div class="inner">${headButtons(g, "l" + i)}${angle}<div class="f">${HDR}` +
      `<div><div class="k">SPORTSBOOK</div>${b.spread ? `${g.home} ${sgn(b.spread.homeSpread)} ${odds(b.spread.home.odds)}<div class="s">fair (vig removed) ${g.home} ${odds(toAmerican(b.spread.home.fair))} / ${g.away} ${odds(toAmerican(b.spread.away.fair))}</div>` : dash}</div>` +
      leanCell(g, "spread") +
      `<div><div class="k">${pmLogo()}POLYMARKET</div>${poly}</div>` +
      `</div></div>${cover(g, g.spreadPick)}</div>`;
  }
}
// ---------- Totals ----------
function totalCard(g, i) {
  {
    const lv = liveFor(g), p = (lv && lv.poly) || g.poly || {}, b = g.books || {};
    const live = !g.started && p.total ? '<span class="live"></span>' : "";
    const row = (k, v) => `<div class="prl"><span class="s">${k}</span><span class="mkt">${v}</span></div>`;
    const poly = liveHead(g, lv, "total") + (p.total ? `${live}` + row(`Over ${p.total.line}`, odds(toAmerican(p.total.over))) + row(`Under ${p.total.line}`, odds(toAmerican(p.total.under))) : dash) + liveTail(g, lv, "total");
    // Tested angle (10/1): outdoor games with 12+ mph wind went Under the closing total 56.1% of the time, 2007-25 (786 games), and it
    // beat break-even in all three periods (53.7 / 58.1 / 56.7%). The slope is real too: each mph takes ~0.18 pts off what the line allows for.
    const wd = g.model && g.model.outdoor && g.model.wind != null && g.model.wind >= 12 && !g.final && p.total ? `<div class="s g" style="margin:6px 0 0">★ Tested angle: Under ${p.total.line} (wind forecast ${Math.round(g.model.wind)} mph). 2007–25: outdoor games with 12+ mph wind went Under 56.1% (786 games) and beat break-even (52.4%) in all three periods. History uses the recorded wind, and forecasts can miss.</div>` : "";
    return `<div class="card${g.final ? " fin" : ""}"><div class="inner">${headButtons(g, "t" + i, "", true)}${wd}<div class="f">${HDR}` +
      `<div><div class="k">SPORTSBOOK</div>${b.total ? `${b.total.line}<div class="s">O ${odds(b.total.over.odds)} · U ${odds(b.total.under.odds)}</div>` : dash}</div>` +
      leanCell(g, "total") +
      `<div><div class="k">${pmLogo()}POLYMARKET</div>${poly}</div>` +
      `</div></div>${cover(g, g.totalPick)}</div>`;
  }
}
// ---------- Anytime TD ----------
const GAME_STATUS = /out|doubtful|questionable/i;
// team logo, transparent PNG, keyed off the same team code the row already carries. WAS/KC have no
// clean current mark on the ESPN CDN, so those two come from a community alt-logo set instead.
const LOGO_OVERRIDES = { WAS: "https://raw.githubusercontent.com/ajreinhard/data-viz/master/alt-logo/WAS.png", KC: "https://raw.githubusercontent.com/ajreinhard/data-viz/master/alt-logo/KC.png" };
const logoUrl = (team) => (team ? LOGO_OVERRIDES[team] || `https://a.espncdn.com/i/teamlogos/nfl/500/${team}.png` : "");
// Team logo next to team names on every card (game header + TD team headers). Same logo source as the TD rows.
function tlogo(team) { return team ? `<img class="tlogo" src="${logoUrl(team)}" alt="" onerror="this.style.display='none'">` : ""; }
function matchup(g) { return `${g.away} @ ${g.home}`; }
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
function tdRow(x, i) {
  const r = x.r, g = x.g;
  return `<div class="tdr"><img class="wmc" loading="lazy" decoding="async" src="${logoUrl(r.team)}" alt="" onerror="this.style.display='none'"><div class="in"><span class="rk">${i + 1}</span>` +
    `<div class="nmx"><b>${esc(r.player)}</b><span class="pos">${esc(r.pos)}</span>${r.injury && GAME_STATUS.test(r.injury) ? ` <span class="pill ${/out|doubt/i.test(r.injury) ? "p-r" : "p-y"}" style="padding:0 6px;font-size:10px">${esc(r.injury)}</span>` : ""}<div class="g2">${esc(r.game)}</div></div>` +
    `<div class="mp"><em>${Math.round(r.fair)}%</em><div class="bar"><i style="width:${Math.min(100, r.fair)}%"></i></div></div><div class="pxc">${r.price != null ? Math.round(r.price * 100) + "¢" : "—"}</div></div>` +
    `<div class="more" style="--tc:${TEAM_COLOR[r.team] || "#444"};--logo:url(${logoUrl(r.team)})">${prow(r, g, true)}</div></div>`;
}
function renderTd() {
  const wk = S.week ? ` · Week ${S.week}` : "";
  $("td-header").innerHTML = `<b style="color:#d3d8e0">Anytime TD${wk}</b> · top 30 · most likely first`;
  const rows = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).map((r) => ({ r, g })))
    .filter((x) => x.r.fair != null && usable(x.r)).sort((a, b) => b.r.fair - a.r.fair);
  const moves = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).filter((r) => r.move).map((r) => r)).sort((a, b) => Math.abs(b.move) - Math.abs(a.move)).slice(0, 10);
  const moveBox = moves.length ? `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Price moves (5¢+, real markets)</div>${moves.map((r) => `<div class="row"><span>${esc(r.player)} <span class="dim">${esc(r.game)}</span></span><span class="${r.move > 0 ? "g" : "r"}">${r.move > 0 ? "▲ +" : "▼ "}${r.move}¢</span></div>`).join("")}</div></div>` : "";
  const shown = tdShowAll ? rows : rows.slice(0, 30);
  if (!rows.length) { $("td").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">No players yet — tap Model (the ▶ button on the right).</div></div>'; return; }
  $("td").innerHTML = moveBox + `<div class="card tdl"><div class="tdh"><span style="flex:1;padding-left:28px">PLAYER</span><span style="width:74px;text-align:right">MODEL</span><span style="width:60px;text-align:right;white-space:nowrap">${pmLogo()}PRICE</span></div>${shown.map(tdRow).join("")}</div>` +
    (rows.length > 30 ? `<div class="center"><button class="btn" id="td-all">${tdShowAll ? "Show top 30 only" : `Show all ${rows.length} players`}</button></div>` : "") +
    '<div class="s dim" style="text-align:center;margin-top:8px">Tap a row for snaps, 2+ TDs and first TD.</div>';
  if ($("td-all")) $("td-all").onclick = () => { tdShowAll = !tdShowAll; renderTd(); };
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
  const nOpen = open.length, tot = s.wins + s.losses;
  const tiles = `<div class="stats">` + `<div class="stat"><div class="k">OPEN BETS</div><div class="v mkt">${nOpen}</div><div class="k2">${money(s.openCost)} staked</div></div>` +
    `<div class="stat"><div class="k">RECORD</div><div class="v ${tot ? (s.wins / tot >= 0.5 ? "g" : "r") : "dim"}">${tot ? `${s.wins}–${s.losses}` : "—"}</div><div class="k2">settled</div></div>` +
    `<div class="stat"><div class="k">PROFIT</div><div class="v">${cMoney(s.pl)}</div><div class="k2">this season</div></div></div>`;
  $("record-mine").innerHTML = tiles + `<div class="card" style="margin-top:10px">` +
    `<div class="sec"><div class="sh">Summary</div>` +
    `<div class="row"><span class="dim">Your record · P/L</span><span>${MB.summary.wins}–${MB.summary.losses}${MB.summary.pushes ? "–" + MB.summary.pushes : ""} · ${cMoney(MB.summary.pl)}</span></div>` +
    `<div class="row"><span class="dim">Return · avg price move your way</span><span>${cPct(MB.summary.roi)} · ${cPct(MB.summary.avgClv)}</span></div>` +
    `<div class="row"><span class="dim">Open this week</span><span>${money(MB.summary.openCost)} of $200</span></div></div>` +
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
// Past seasons (10/1, regular season, every game graded the same way the live record is): % right per year. [season, spread side, total side, market favorite wins, stats-only winner]
const PAST = [[2013, 53.0, 56.8, 71.2, 69.4], [2014, 49.1, 59.6, 68.0, 67.4], [2015, 47.6, 56.8, 63.7, 64.9], [2016, 54.7, 52.7, 67.6, 65.9], [2017, 55.0, 48.0, 71.4, 64.8], [2018, 44.9, 49.2, 67.2, 65.6], [2019, 48.9, 52.1, 65.1, 65.1], [2020, 43.3, 50.2, 66.8, 65.9], [2021, 46.8, 47.1, 63.7, 63.7], [2022, 44.7, 52.9, 68.5, 61.7], [2023, 53.1, 50.5, 69.6, 65.6], [2024, 56.1, 48.9, 74.1, 69.6], [2025, 44.4, 53.6, 63.2, 59.2]];
function pastBox() {
  const f = (x) => x.toFixed(1) + "%", avg = (i) => PAST.reduce((a, r) => a + r[i], 0) / PAST.length;
  const col = (v) => (v >= 65 ? "var(--green)" : v >= 62 ? "var(--yellow)" : "var(--red)");
  const bars = PAST.map((r) => `<div class="pb"><i style="height:${Math.round(((r[3] - 40) / 35) * 52) + 6}px;background:${col(r[3])}"></i></div>`).join("");
  const yrs = PAST.map((r) => `<span>${String(r[0]).slice(2)}</span>`).join("");
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Past seasons · favorite won %</div><div class="pbars">${bars}</div><div class="pyrs">${yrs}</div>` +
    `<div class="s dim" style="margin-top:6px">Green 65%+, amber 62–65%, red below. Average: winners ${f(avg(3))} · spreads ${f(avg(1))} · totals ${f(avg(2))}.</div>` +
    `<div class="fold" data-drop="pasttbl"><span>Full table by season</span><span>▾</span></div><div class="drop" id="pasttbl">` +
    `<div class="row"><span class="dim">Season</span><span class="dim">WINNER (MARKET) · WINNER (STATS) · SPREAD · TOTAL</span></div>` +
    PAST.slice().reverse().map((r) => `<div class="row"><span>${r[0]}</span><span>${f(r[3])} · ${f(r[4])} · ${f(r[1])} · ${f(r[2])}</span></div>`).join("") +
    `<div class="row"><b>Average</b><b>${f(avg(3))} · ${f(avg(4))} · ${f(avg(1))} · ${f(avg(2))}</b></div>` +
    `<div class="s dim" style="margin-top:4px">Winner = the team picked to win straight up. Spread and total = the model's side of the closing line. The model's settings were fit on these same years, so treat the older totals with caution; this season's live record is the clean test.</div></div></div></div>`;
}
// Results page: every section collapses to one tappable heading, so the page is a short list instead of a wall of rows.
// Watchdog warnings stay visible above the list. All sections start closed; a ⚠ count shows next to a heading that has warnings.
function foldSections(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(".card > .sec").forEach((sec, i) => {
    const sh = sec.querySelector(":scope > .sh"); if (!sh) return;
    const warns = [...sec.querySelectorAll(".warn, .y")].filter((e) => /⚠/.test(e.textContent)).length;
    const title = sh.textContent, drop = document.createElement("div"); drop.className = "drop"; drop.id = "rsec" + i;
    [...sec.childNodes].forEach((n) => { if (n !== sh) drop.appendChild(n); });
    const head = document.createElement("div"); head.className = "fold"; head.setAttribute("data-drop", drop.id);
    head.innerHTML = `<span><b>${esc(title)}</b>${warns ? ` <span class="y">⚠ ${warns}</span>` : ""}</span><span>▾</span>`;
    sec.replaceWith(head, drop);
  });
}
function renderModel() {
  if (!MB || !RES) { $("lab-results").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">Loading…</div></div>'; return; }
  const s = MB.summary, res = RES;
  const weeks = [...new Set(res.map((r) => r.week))].sort((a, b) => b - a), lw = weeks[0];
  const wk = res.filter((r) => r.week === lw);
  // Spread/total picks before 9/30 used a different rule (the "side" was always the away team), so only model-side records count.
  const pick = (k, list) => list.filter((r) => r[k] && ((k !== "spread" && k !== "total") || r[k].basis === "model")).map((r) => r[k]);
  // Tier labels (Weak/Moderate/Strong) were removed from the cards: calibrated spread/total chances sit ~50%, so every
  // pick would land in one bucket. Season record is shown plain instead.
  const seasonRec = pick("spread", res).length || pick("total", res).length
    ? `<div class="row"><span class="dim">SPREAD · TOTAL leans (~50/50 by design)</span><span>${rec(pick("spread", res))} · ${rec(pick("total", res))}</span></div>` +
      '<div class="s dim">Spread/total picks sit near 50% by design (the model has no measured edge there), so expect about .500. Picks before 9/30 used a different rule and are not counted here.</div>' : "";
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
  const avail = (p) => (!p.rep ? 1 : p.played === true ? 1 : p.played === false ? 0.01 :   // closing prices come after inactives
    /^(out|doubtful)$/i.test(p.rep) ? 0.01 : /^questionable$/i.test(p.rep) ? 0.669 : 1);
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
          .map((p) => (p.bid + p.ask) / 2 / ((p.openAsk + p.openBid) / 2) - 1);   // mid vs mid (was closing mid vs opening ASK: read negative with no move)
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
  $("lab-results").innerHTML = labResultsTop() + pastBox() + `<div class="card" style="margin-top:10px">` +
    `<div class="sec"><div class="sh">Week ${lw ?? S.week} recap</div>` +
    (wk.length ? `<div class="row"><span class="dim">Tilts: spreads · totals · moneyline</span><span>${rec(pick("spread", wk))} · ${rec(pick("total", wk))} · ${rec(pick("ml", wk))}</span></div>` +
    (pick("mlModel", wk).length ? `<div class="row"><span class="dim">MONEYLINE (stats-only model)</span><span>${rec(pick("mlModel", wk))}</span></div>` : "") + `` : '<div class="s">No finished games graded yet.</div>') +
    // Tuesday recap (added 9/29): the finished week's TD results and your bets, next to the line tilts.
    (() => { const tdW = wk.flatMap((r) => r.td || []), td = tdW.filter((p) => p.played !== false); if (!tdW.length) return "";
      const exp = td.reduce((a, p) => a + p.fair, 0) / 100, hit = td.filter((p) => p.scored).length;
      const real = tdW.filter((p) => p.ask > 0 && p.bid > 0 && p.ask - p.bid <= Math.min(0.05, 0.4 * p.ask)), y = (p) => (p.scored ? 1 : 0);
      const bm = real.length ? real.reduce((a, p) => a + (mp(p) - y(p)) ** 2, 0) / real.length : null, bp = real.length ? real.reduce((a, p) => a + ((p.ask + p.bid) / 2 - y(p)) ** 2, 0) / real.length : null;
      const mine = (MB.bets || []).filter((b) => b.week === lw && b.result !== "pending"), mpl = mine.reduce((a, b) => a + (b.pl || 0), 0);
      return `<div class="row"><span class="dim">TD model</span><span>${hit} scored · model expected ${exp.toFixed(1)} (${td.length} players who played${tdW.length > td.length ? `; ${tdW.length - td.length} inactive left out` : ""})</span></div>` +
        (bm != null ? `<div class="row"><span class="dim">TD vs Polymarket (real markets)</span><span>${real.length} players · model ${bm.toFixed(3)} · Polymarket ${bp.toFixed(3)}</span></div>` : "") +
        ""; })() +
    `<div class="row"><span class="dim">Week ${S.week} loaded</span><span>${wc.games} games · lines ${wc.withLines}/${wc.games} · model ${wc.modelRun ? '<span class="g">✓</span>' : '<span class="y">not run yet</span>'}</span></div>` +
    ((wc.watch || []).length ? `<div class="s" style="margin-top:6px"><b class="y">Watchdog</b>${wc.watch.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}</div>` : '<div class="s dim" style="margin-top:6px">Watchdog: nothing missing or stale.</div>') + `</div>` +
    `<div class="sec"><div class="sh">Season record</div>${seasonRec || '<div class="s">No graded picks yet.</div>'}` +
    `<div class="row"><span class="dim">MONEYLINE (market-based)</span><span>${rec(pick("ml", res))}</span></div>` +
    `<div class="row"><span class="dim">MONEYLINE (stats-only model)</span><span>${pick("mlModel", res).length ? rec(pick("mlModel", res)) : "—"}</span></div>` +
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
          e.byMarket.filter((m) => m.n).map((m) => `<div class="row"><span class="dim">${{ spread: "SPREADS", ml: "MONEYLINES", total: "TOTALS" }[m.market]}</span><span>${m.w} of ${m.n} won · ${pct(m.roi)}</span></div>`).join("") +
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
  foldSections($("lab-results"));
}
function renderRecord() { renderMine(); renderModel(); }
async function loadRecord(sync = false) {
  if (sync) toast("Syncing your Polymarket account…", 0);
  try {
    const [mb, rl, rp] = await Promise.all([fetch(`/api/mybets${sync ? "?sync=1" : ""}`, { cache: "no-store" }).then((r) => r.json()), fetch("/api/results/list", { cache: "no-store" }).then((r) => r.json()), fetch("/api/replay", { cache: "no-store" }).then((r) => r.json()).catch(() => null)]);
    if (rp && rp.ok) REPLAY = rp.replay;   // history table; a failed fetch just leaves the card out
    if (!mb.ok) throw new Error(mb.error); MB = mb; RES = rl.ok ? rl.results : []; EDGES = rl.ok ? rl.edges : null; PAPER = rl.ok ? rl.paper : null; PICKS = rl.ok ? rl.picks : null; renderLab();
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
  $("hero-wk").textContent = `${round || `Week ${S.week}`} · ${range}`.toUpperCase();
  const hu = $("hero-upd"), detail = `Updated (your time): Polymarket ${clock(m.lastSnapshot)} · sportsbooks ${clock(S.booksAt)} · model ${clock(S.modelRunAt)}`;
  hu.textContent = `Updated ${clock(m.lastSnapshot)} ›`; hu.onclick = () => toast(detail, 8000);   // short line; tap for the three times
}
// ---------- Pick Lab: the model's side on every game (paper singles) + Parlay Lab ----------
function modelSide(g) {   // same rule as lib/paper.js picksFor (the server records it at kickoff)
  const p = g.poly, m = g.model, out = []; if (!p || !m) return out;
  if (p.spread && m.homeMargin != null) { const hs = p.spread.homeSpread, gap = m.homeMargin + hs;
    if (Math.abs(gap) >= 0.05) out.push({ game: g.key, market: "Spread", label: gap > 0 ? `${g.home} ${sgn(hs)}` : `${g.away} ${sgn(-hs)}`, price: gap > 0 ? p.spread.home : p.spread.away, gap: Math.abs(gap) }); }
  if (p.total && m.total != null) { const gap = m.total - p.total.line;
    if (Math.abs(gap) >= 0.05) out.push({ game: g.key, market: "Total", label: `${gap > 0 ? "Over" : "Under"} ${p.total.line}`, price: gap > 0 ? p.total.over : p.total.under, gap: Math.abs(gap) }); }
  return out;
}
const hitCls = (h) => (h == null ? "dim" : h >= 0.55 ? "g" : h >= 0.5 ? "y" : "r");   // green 55%+, amber 50-55%, red under 50%
function statTile(label, w, l, hit, sub) {
  return `<div class="stat"><div class="k">${label}</div><div class="v ${hitCls(hit)}">${hit == null ? "—" : `${w}–${l}`}</div><div class="k2">${hit == null ? "none graded yet" : `${Math.round(hit * 100)}% ${sub}`}</div></div>`;
}
function labStats() {
  const P = PICKS || {}, W = (S && S.winners && S.winners.all) || {};
  const g = (m) => { const x = P[m] || {}; return [x.w, x.l, x.graded ? x.hit : null]; };
  const sp = g("spread"), tt = g("total");
  return `<div class="stats">${statTile("MONEYLINE", W.w, W.l, W.n ? W.hit : null, "right")}${statTile("SPREAD SIDE", sp[0], sp[1], sp[2], "covered")}${statTile("TOTAL SIDE", tt[0], tt[1], tt[2], "right")}</div>`;
}
function pickLabBox() {
  const pc = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`), P = PICKS || {};
  const arow = (m, name) => { const x = P[m];
    return `<div class="arow"><span class="nm">${name}</span><span class="dim rc">${x && x.graded ? `${x.w}–${x.l}` : x && x.recorded ? `${x.recorded} saved` : "none yet"}</span><b class="${hitCls(x && x.graded ? x.hit : null)}">${x && x.graded ? Math.round(x.hit * 100) + "%" : "—"}</b></div>`; };
  const bands = ["spread", "total"].map((m) => (P[m] && P[m].bands || []).filter((b) => b.graded).map((b) => `<div class="row"><span class="dim">${m === "spread" ? "Spread" : "Total"} · model differs by ${b.label}</span><span>${b.w}–${b.l} · ${pc(b.hit)}</span></div>`).join("")).join("");
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Tracked angles · paper only</div>` +
    arow("spread", "SPREADS · model side") + arow("total", "TOTALS · model side") + arow("dog", "Road dogs +3 to +6.5") + arow("away3", "Road team, spread 3 or less") + arow("wind", "Under, wind 12+ mph") + arow("lowloss", "Underdog off a loss scoring 10 or fewer") + arow("prebye", "Home team before its bye (wk 8+)") +
    `<div class="s dim" style="margin-top:6px">Saved at kickoff, graded after. Green 55%+, amber 50–55%, red under 50%. Tested: ~51% on spreads (break-even 52.4%), ~50% on totals. Judge after 100+ picks.</div>` +
    (bands ? `<div class="fold" data-drop="labbands"><span>By how far the model differs from the line</span><span>▾</span></div><div class="drop" id="labbands">${bands}</div>` : "") + `</div></div>`;
}
// Results tab top: every record in one place (model side by market, tracked angles, parlay scoreboard)
let LAB_SB = "", REPLAY = null;
// Replay: every tracked pick rule on past seasons next to its live record; "YES" only when it beat break-even in all three periods.
function replayBox() {
  if (!REPLAY || !REPLAY.rows) return "";
  const P = PICKS || {}, W = (S && S.winners && S.winners.all) || {}, hf = PAPER && PAPER.board && PAPER.board.home_fav_95_single;
  const live = (r) => { let w, l, hit, saved;
    if (r.id === "favorite") { w = W.w; l = W.l; hit = W.n ? W.hit : null; }
    else if (r.id === "homefav") { if (hf && hf.graded) { w = hf.hits; l = hf.graded - hf.hits; hit = hf.hitRate; } }
    else { const x = P[r.id === "spread_model" ? "spread" : r.id === "total_model" ? "total" : r.id]; if (x) { if (x.graded) { w = x.w; l = x.l; hit = x.hit; } else saved = x.recorded; } }
    return hit != null ? `<span>${w}–${l}</span><span class="dim"> · ${Math.round(hit * 100)}%</span>` : saved ? `<span class="dim">${saved} saved</span>` : '<span class="dim">—</span>'; };
  const cls = { YES: "g", UNSTABLE: "y", "NO EDGE": "r", "TOO FEW": "dim", INFO: "dim" };
  const pc = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
  return `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Replay · every pick on ${REPLAY.seasons[0]}–${String(REPLAY.seasons[1]).slice(2)}</div>
    <div class="rp rph"><span>PICK</span><span>HISTORY</span><span>LIVE</span><span>HOLDS?</span></div>` +
    REPLAY.rows.map((r) => `<div class="rp"><span>${esc(r.name)}${r.note ? `<span class="dim rn">${esc(r.note)}</span>` : ""}</span><span class="${r.kind === "win" ? "dim" : r.hit > 0.524 || (r.kind === "ml" && r.roi > 0) ? "g" : "r"}">${pc(r.hit)}<span class="dim rn"> n=${r.n}</span></span><span>${live(r)}</span><span class="${cls[r.verdict] || "dim"}"><b>${esc(r.verdict)}</b></span></div>`).join("") +
    `<div class="fold" data-drop="replayper"><span>By period</span><span>▾</span></div><div class="drop" id="replayper">` +
    REPLAY.rows.filter((r) => r.kind !== "win").map((r) => `<div class="row"><span>${esc(r.name)}</span><span class="dim">${r.periods.map((p) => `${esc(p.label)} ${pc(p.hit)}`).join(" · ")}</span></div>`).join("") + `</div>
    <div class="s dim" style="margin-top:6px">Break-even is 52.4% on spreads and totals (positive return on moneylines). YES = beat it in all three periods; UNSTABLE = beat it overall but not in every period; TOO FEW = under 100 games. Closing lines from sportsbooks, not Polymarket prices. The two model rows are a fixed 2013–25 backtest of the core ratings.</div></div></div>`;
}
const labResultsTop = () => (S ? labStats() + winnersBox("records") + replayBox() + pickLabBox() : "") + LAB_SB;
function renderLab() {
  if (!$("lab")) return;
  if (!PAPER) { $("lab").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">Loading…</div></div>'; return; }
  const names = PAPER.names || {}, wk = PAPER.week, board = PAPER.board || {};
  const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);
  const intro = "";
  const legLine = (l) => `${esc(l.label)} <span class="dim">${esc(l.game)}</span> · ${Math.round(l.price * 100)}¢${l.result ? ` <span class="${l.result === "W" ? "g" : l.result === "L" ? "r" : "dim"}">${l.result}</span>` : ""}`;
  const thisWeek = !wk ? '<div class="s dim">Recorded about a day before Sunday.</div>' :
    Object.keys(names).map((k) => { const ps = wk.parlays.filter((p) => p.strategy === k);
      return `<div class="sec"><div class="sh">${esc(names[k])}</div>` + (ps.length ? ps.map((p) =>
        `<div class="row" style="display:block"><div>${p.legs.map(legLine).join("<br>")}</div><div class="s">pays ${p.pay.toFixed(2)}x${p.prob != null ? ` · market chance ${pct(p.prob)}` : ""}${p.result ? ` · <b class="${p.result === "W" ? "g" : p.result === "L" ? "r" : ""}">${p.result === "W" ? "HIT" : p.result === "L" ? "missed" : "push"}</b>` : ""}</div></div>`).join("") :
        '<div class="s">No qualifying legs this week.</div>') + `</div>`; }).join("");
  const rows = !Object.keys(names).some((k) => board[k] && board[k].graded) ? '<div class="s dim">No graded parlays yet.</div>' : Object.keys(names).map((k) => { const b = board[k]; return `<div class="row"><span class="dim">${esc(names[k])}</span><span>${b ? `${b.hits} of ${b.graded} hit${b.graded ? ` (${pct(b.hitRate)}, market said ${pct(b.expRate)})` : ""} · return ${b.roi == null ? "—" : cPct(b.roi)}` : "—"}</span></div>`; }).join("");
  $("lab").innerHTML = (S ? winnersBox("picks") : "") + intro + `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Parlay Lab · week ${wk ? wk.week : S ? S.week : ""} (paper only)</div>${thisWeek}</div></div>`;
  LAB_SB = `<div class="card" style="margin-top:10px"><div class="inner"><div class="sh">Parlay scoreboard · this season</div>${rows}<div class="s dim" style="margin-top:4px">Return per $1, before fees. Parlays are streaky.</div></div></div>`;
  if (MB && RES) renderModel();   // the Results tab shows the scoreboard
  if ($("win-all")) $("win-all").onclick = () => { WINALL = !WINALL; renderLab(); };
}

// ---------- v2: tiles, tap-a-game view, countdown, alerts ----------
// Live Polymarket lines for a game in progress (10/1). Display only: the model, picks, kickoff line and grades stay locked.
let LIVE = {}, LIVE_T = null, LIVE_SC = {};
const ago = (iso) => { const sec = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return sec < 60 ? sec + "s ago" : Math.round(sec / 60) + " min ago"; };
const liveFor = (g) => (g.started && !g.final && Object.prototype.hasOwnProperty.call(LIVE, g.key) ? { poly: LIVE[g.key] } : null);
function lockedLine(g, kind) {
  const p = g.poly || {};
  if (kind === "total") return p.total ? `${p.total.line} (O ${odds(toAmerican(p.total.over))} · U ${odds(toAmerican(p.total.under))})` : "—";
  return `${p.spread ? `${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}` : "—"}${p.ml ? ` · ML ${g.home} ${odds(toAmerican(p.ml.home))}` : ""}`;
}
const liveHas = (lv, kind) => !!(lv && lv.poly && (kind === "total" ? lv.poly.total : lv.poly.spread || lv.poly.ml));
const lockedNote = (g, kind) => `<div class="s dim" style="margin-top:6px">Kickoff line (locked): ${lockedLine(g, kind)}</div>`;
function liveHead(g, lv, kind) {
  if (!lv) return "";
  return liveHas(lv, kind) ? `<div class="s"><span class="chip c-red">LIVE</span> <span class="dim">updated ${LIVE_T ? ago(LIVE_T) : "just now"}</span></div>`
    : `<div class="s y"><span class="chip c-red">LIVE</span> Polymarket has no open ${kind === "total" ? "total" : "lines"} for this game right now (paused).</div>${lockedNote(g, kind)}`;
}
const liveTail = (g, lv, kind) => (liveHas(lv, kind) ? lockedNote(g, kind) : "");
function refreshDetail() { const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean); renderLines(); for (const id of open) { const e = $(id); if (e) e.classList.add("open"); } }
const anyLive = () => !!(S && S.games && S.games.some((g) => g.started && !g.final));
async function loadLive() {
  if (!anyLive() || document.hidden || !$("panel-lines").classList.contains("on")) return;
  try { const d = await (await fetch("/api/live", { cache: "no-store" })).json();
    if (d.ok) { LIVE = d.games || {}; LIVE_SC = d.scores || {}; LIVE_T = d.t; if (DETAIL) refreshDetail(); else renderLines(); } } catch {}
}
function liveLoop() { clearTimeout(liveLoop._h); loadLive().finally(() => { liveLoop._h = setTimeout(liveLoop, 30000); }); }
let DETAIL = null, LASTY = 0, ALERTS = [], ALFILTER = "all", ALPREV = null;
const pmLogo = () => '<span class="pm"><img src="https://polymarket.com/favicon.ico" alt="" onerror="this.parentNode.textContent=\'P\'"></span>';
const injBadge = (team) => `<span class="injb"><img src="${logoUrl(team)}" alt="" onerror="this.style.visibility='hidden'"><u>+</u></span>`;
const injBadgeFor = (g) => { const inj = g.model && g.model.inj; if (!inj) return ""; const t = inj.home.players.length ? g.home : inj.away.players.length ? g.away : null; return t ? injBadge(t) : ""; };
function tile(g) {
  const sc = g.started && !g.final ? LIVE_SC[g.key] : null;   // live score from ESPN (display only)
  const eg = (S.edgesNow || []).filter((b) => b.game === g.key);
  const hp = g.winPct != null && isFinite(g.winPct) ? Number(g.winPct) : null, ap = hp == null ? null : 100 - hp;
  const lead = (v, o) => (v >= o ? "mkt" : "dim");
  const chips = [g.badge ? `<span class="chip c-amb">${esc(g.badge)}</span>` : "", eg.length ? `<span class="chip c-cy">GAP +${(Math.max(...eg.map((b) => b.evNet)) * 100).toFixed(1)}%</span>` : "", g.started && !g.final && !sc ? '<span class="chip c-red">LIVE</span>' : ""].join("");
  const mid = g.final && g.awayScore != null && g.homeScore != null ? `<span class="mid"><span class="${g.awayScore > g.homeScore ? "g" : "dim"}">${g.awayScore}</span><span class="dim"> – </span><span class="${g.homeScore > g.awayScore ? "g" : "dim"}">${g.homeScore}</span></span>`
    : hp == null ? '<span class="mid dim">—</span>' : `<span class="mid"><span class="${lead(ap, hp)}">${Math.round(ap)}</span><span class="dim"> · </span><span class="${lead(hp, ap)}">${100 - Math.round(ap)}</span><span class="dim" style="font-size:11px">%</span></span>`;
  const mid2 = sc ? `<span class="mid lvmid"><span class="sr"><span class="${sc.a > sc.h ? "g" : "dim"}">${sc.a}</span><span class="dim"> – </span><span class="${sc.h > sc.a ? "g" : "dim"}">${sc.h}</span></span><span class="lv ${sc.st === "post" ? "dim" : "r"}">${sc.st === "post" ? "FINAL" : "● LIVE · " + esc(sc.lbl)}</span></span>` : mid;
  const foot = g.final ? "Final" : g.started ? "In progress" : tm(g.kickoff);
  return `<button class="tile" data-game="${esc(g.key)}"><img class="wmk l" loading="lazy" decoding="async" src="${logoUrl(g.away)}" alt="" onerror="this.style.display='none'"><img class="wmk r" loading="lazy" decoding="async" src="${logoUrl(g.home)}" alt="" onerror="this.style.display='none'">` +
    `<div class="in"><div class="nm"><span class="t">${g.away}</span>${mid2}<span class="t">${g.home}</span></div><div class="ft"><span>${foot}</span><span>${chips}</span></div>${g.final || hp == null ? "" : `<div class="bar"><i style="width:${ap}%"></i></div>`}</div></button>`;
}
function gapStrip() {
  const E = S.edgesNow || [];
  return `<div class="gapstrip" data-drop="gaplist"><div class="t">${pmLogo()}Price gaps · ${E.length ? E.length + " right now" : "none right now"} ›</div></div><div class="drop" id="gaplist">${rightNowBox()}</div>`;
}
function tdTop3(g) {
  const side = (team) => { const rows = (g.td || []).filter((r) => r.team === team && r.fair != null && usable(r)).sort((a, b) => b.fair - a.fair).slice(0, 3);
    return `<div class="sc card mcard"><div class="in"><div class="hh">${team} top scorers</div>` +
      (rows.map((r, i) => `<div class="p"><div class="a"><span class="dim" style="font-size:11px;width:16px">#${i + 1}</span><b>${esc(r.player)}<span class="pos">${esc(r.pos)}</span></b><em class="mod">${Math.round(r.fair)}%</em></div>` +
        `<div class="b">${r.price != null ? Math.round(r.price * 100) + "¢" : "—"}${r.two != null ? ` · 2+ ${Math.round(r.two)}%` : ""}${r.first != null ? ` · 1st ${Math.round(r.first)}%` : ""}</div></div>`).join("") || '<div class="s">No players yet.</div>') + `</div></div>`; };
  return `<div class="scorers">${side(g.away)}${side(g.home)}</div>`;
}
function startsIn(g) {
  const ms = new Date(g.kickoff) - Date.now(); if (!(ms > 0)) return "";
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `starts in ${d}d ${h}h` : h ? `starts in ${h}h ${m}m` : `starts in ${m}m`;
}
const TEAM_COLOR = { ARI: "#97233f", ATL: "#a71930", BAL: "#5c2d91", BUF: "#00338d", CAR: "#0085ca", CHI: "#e64100", CIN: "#fb4f14", CLE: "#ff3c00", DAL: "#2a5db0", DEN: "#fb4f14", DET: "#0076b6", GB: "#2f7d4f", HOU: "#c8102e", IND: "#2a6ebb", JAX: "#00a3b5", KC: "#e31837", LV: "#a5acaf", LAC: "#0080c6", LA: "#2a6ebb", LAR: "#2a6ebb", MIA: "#00a6a6", MIN: "#6a3fb0", NE: "#2a5db0", NO: "#d3bc8d", NYG: "#2a5db0", NYJ: "#2f7d4f", PHI: "#00898a", PIT: "#ffb612", SF: "#c8102e", SEA: "#4a8f2a", TB: "#d50a0a", TEN: "#4b92db", WAS: "#7a2236" };
function detailTop(g) {
  const dsc = g.started && !g.final ? LIVE_SC[g.key] : null;
  const hp = g.winPct != null && isFinite(g.winPct) ? Number(g.winPct) : null, ap = hp == null ? null : Math.round(100 - hp), hr = ap == null ? null : 100 - ap;
  const st = g.final ? `Final ${g.awayScore != null && g.homeScore != null ? `${g.awayScore}–${g.homeScore}` : ""}` : g.started ? '<span class="r">Live · locked</span>' : startsIn(g);
  const ca = TEAM_COLOR[g.away] || "#444", ch = TEAM_COLOR[g.home] || "#444";
  return `<div class="card dtop" style="background:linear-gradient(90deg,${ca}40 0%,${ca}14 50%,${ch}14 50%,${ch}40 100%),var(--card)"><img class="dwm l" src="${logoUrl(g.away)}" alt="" onerror="this.style.display='none'"><img class="dwm r" src="${logoUrl(g.home)}" alt="" onerror="this.style.display='none'"><div class="inner"><div class="nm"><span class="t">${tlogo(g.away)}${g.away}</span><div class="mid">${g.badge ? `<span class="chip c-amb">${esc(g.badge)}</span>` : ""}${dsc ? `<div class="s2"><b>${dsc.a} – ${dsc.h}</b></div><div class="s3 r">${dsc.st === "post" ? "FINAL" : "● LIVE · " + esc(dsc.lbl)}</div>` : `<div class="s2">${tm(g.kickoff)}</div><div class="s3">${st}</div>`}</div><span class="t">${g.home}${tlogo(g.home)}</span></div>` +
    (hp == null || g.final ? "" : `<div class="wc"><div class="wl"><b class="mkt">${ap}%</b><span class="mkt">MARKET’S WIN CHANCE</span><span class="dim">${hr}%</span></div><div class="bar"><i style="width:${ap}%"></i></div></div>`) + `</div></div>`;
}
// page background on a game page only: team colors in halves with the split logos (away left, home right)
function setBg(g) {
  const el = document.getElementById("bgwm"); if (!el) return;
  if (!g) { el.style.background = ""; el.innerHTML = ""; el.dataset.k = ""; return; }
  const k = g.away + g.home; if (el.dataset.k === k) return; el.dataset.k = k;
  const ca = TEAM_COLOR[g.away] || "#444", ch = TEAM_COLOR[g.home] || "#444";
  el.style.background = `linear-gradient(90deg, ${ca}3d 0%, ${ca}1f 50%, ${ch}1f 50%, ${ch}3d 100%)`;
  el.innerHTML = `<img src="${logoUrl(g.away)}" alt="" onerror="this.style.display='none'"><img src="${logoUrl(g.home)}" alt="" onerror="this.style.display='none'">`;
}
function renderDetail(g) {
  $("lines").style.display = "none"; $("detail").style.display = "";
  $("detail").innerHTML = `<button class="back" id="back-btn">← Games</button>${detailTop(g)}<div class="sh" style="margin:16px 2px 0">SPREAD &amp; ML</div><div class="grid">${gameCard(g, "x")}</div><div class="sh" style="margin:16px 2px 0">TOTALS</div><div class="grid">${totalCard(g, "x")}</div>${tdTop3(g)}`;
  $("back-btn").onclick = closeGame;
  setBg(g);
}
function renderLines() {
  if (DETAIL) { const g = S.games.find((x) => x.key === DETAIL); if (g) return renderDetail(g); DETAIL = null; }
  setBg(null);
  $("detail").style.display = "none"; $("lines").style.display = "";
  $("lines").innerHTML = gapStrip() + changedBox() + `<div class="tiles">${[...S.games].sort(order).map(tile).join("")}</div>` +
    '<div class="s dim" style="text-align:center;margin-top:10px">Tap a game for everything on it. Percent = market-based win chance (away · home).</div>';
}
function openGame(key) { LASTY = (typeof window !== "undefined" && window.scrollY) || 0; DETAIL = key; renderLines(); if (window.scrollTo) window.scrollTo(0, 0); const g = S.games.find((x) => x.key === key); if (g && g.started && !g.final) liveLoop(); }
function closeGame() { DETAIL = null; renderLines(); if (window.scrollTo) window.scrollTo(0, LASTY); }
// countdown to the next game that has not started
function tickCd() {
  clearTimeout(tickCd._h);
  if (!S) return;
  const set = (id, v) => { $(id).textContent = v; }, p2 = (n) => String(n).padStart(2, "0");
  const nxt = S.games.filter((g) => !g.started && g.kickoff && new Date(g.kickoff) > Date.now()).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];   // by the clock, so it moves on at kickoff even before the next data load
  if (!nxt) { ["d", "h", "m", "s"].forEach((k) => set("cd-" + k, "--")); set("cd-g", "No upcoming games this week"); tickCd._cur = null; return; }
  const ms = Math.max(0, new Date(nxt.kickoff) - Date.now());
  set("cd-d", p2(Math.floor(ms / 864e5))); set("cd-h", p2(Math.floor((ms % 864e5) / 36e5))); set("cd-m", p2(Math.floor((ms % 36e5) / 6e4))); set("cd-s", p2(Math.floor((ms % 6e4) / 1e3)));
  $("cd-g").innerHTML = `${tlogo(nxt.away)}${nxt.away} @ ${tlogo(nxt.home)}${nxt.home} · ${tm(nxt.kickoff)}`;
  if (tickCd._cur && tickCd._cur !== nxt.key && Date.now() - (tickCd._last || 0) > 15000) { tickCd._last = Date.now(); setTimeout(() => loadSlate().catch(() => {}), 4000); }   // the game we were counting to just kicked off: refresh once
  tickCd._cur = nxt.key;
  tickCd._h = setTimeout(tickCd, 1000);
}
// alerts: built on the server from changes it already sees between pulls (injuries, lines, price gaps, model moves, results)
const ALK = { INJURY: ["Injury", "var(--red)"], "PRICE GAP": ["Price gap", "var(--cyan)"], "QB CHANGE": ["QB change", "var(--gold)"], "LINE MOVE": ["Line move", "var(--blue)"], WEATHER: ["Weather", "#7fd1ff"], MODEL: ["Model", "var(--violet)"], RESULT: ["Result", "var(--green)"] };
const alSeen = () => { try { return localStorage.getItem("alSeen") || ""; } catch { return ""; } };
async function loadAlerts() {
  try { const d = await (await fetch("/api/alerts", { cache: "no-store" })).json(); if (d.ok) { ALERTS = d.alerts || []; renderAlerts(); } } catch {}
}
function renderAlerts() {
  const dots = ALPREV != null ? ALPREV : alSeen(), unread = ALERTS.filter((a) => a.t > alSeen()).length;
  $("bell-cnt").textContent = unread > 9 ? "9+" : String(unread); $("bell-cnt").style.display = unread ? "flex" : "none";
  const kinds = ["all", ...Object.keys(ALK).filter((k) => ALERTS.some((a) => a.kind === k))];
  $("al-chips").innerHTML = kinds.map((k) => `<button data-alk="${k}" class="${ALFILTER === k ? "on" : ""}">${k === "all" ? "All" : ALK[k][0]}</button>`).join("");
  const list = ALERTS.filter((a) => ALFILTER === "all" || a.kind === ALFILTER);
  $("alerts").innerHTML = list.map((a) => { const [lab, col] = ALK[a.kind] || [a.kind, "var(--dim)"];
    const ic = a.kind === "INJURY" && a.team ? injBadge(a.team) : a.kind === "PRICE GAP" || a.kind === "LINE MOVE" ? pmLogo() : "";
    return `<div class="card al${a.t > dots ? " un" : ""}" data-algame="${esc(a.game || "")}"><span class="dot"></span><div style="flex:1"><div class="kd" style="color:${col}"><span>${ic}${lab.toUpperCase()}</span><span class="dim" style="font-weight:600;letter-spacing:0">${hm(a.t)}</span></div>` +
      `<div class="ti">${esc(a.title)}</div>${a.sub ? `<div class="su">${esc(a.sub)}</div>` : ""}${a.game ? `<div style="font-size:11px;font-weight:700;margin-top:6px;color:var(--blue)">${esc(a.game)} ›</div>` : ""}</div></div>`; }).join("") ||
    '<div class="card" style="margin-top:10px"><div class="s">Nothing yet. Alerts appear as injuries, line moves, price gaps and results come in.</div></div>';
}
function renderAll() { weekline(); renderLines(); renderTd(); if (PAPER) renderLab(); if (MB) renderRecord(); tickCd(); renderAlerts(); }
// Newest version all the time (9/30): if a new deploy went live while this page was open (or sat in a phone tab),
// reload once to pick it up; data refreshes on its own when you come back to the tab after 2+ minutes.
let BUILD = null, LOADED_AT = 0, LOAD_SEQ = 0;
async function loadSlate() {
  const seq = ++LOAD_SEQ, r = await fetch("/api/slate", { cache: "no-store" }), build = r.headers.get("x-build"), d = await r.json();
  if (!d.ok) throw new Error(d.error);
  if (seq !== LOAD_SEQ) return;                                         // a newer request already answered: never show older data
  if (BUILD && build && build !== BUILD) { location.reload(); return; }  // a new version went live while this page was open
  BUILD = BUILD || build; LOADED_AT = Date.now(); S = d;
  if (anyLive() && !liveLoop._on) { liveLoop._on = true; liveLoop(); }   // scores + live lines every 30 s while a game is on
  const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean);   // keep your open dropdowns
  const openTd = [...document.querySelectorAll(".tdr")].map((e, i) => (e.classList.contains("open") ? i : -1)).filter((i) => i >= 0);   // and open player rows
  renderAll(); for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
  if (openTd.length) { const rows = document.querySelectorAll(".tdr"); for (const i of openTd) if (rows[i]) rows[i].classList.add("open"); }
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
function showPanel(name) {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === name));
  $("bell").classList.toggle("on", name === "alerts");
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on")); $("panel-" + name).classList.add("on");
  if (name === "record" || name === "lab") loadRecord();
  if (S && S.games) setBg(name === "lines" && DETAIL ? S.games.find((x) => x.key === DETAIL) : null);   // game background only on an open game page
}
document.querySelectorAll(".tabs button").forEach((btn) => btn.addEventListener("click", () => {
  if (btn.dataset.tab === "lines" && DETAIL && $("panel-lines").classList.contains("on")) closeGame();   // tapping the tab you are on goes back to the tiles
  showPanel(btn.dataset.tab);
}));
$("bell").onclick = () => { ALPREV = alSeen(); if (ALERTS.length) { try { localStorage.setItem("alSeen", ALERTS[0].t); } catch {} } showPanel("alerts"); renderAlerts(); };
$("al-read").onclick = () => { ALPREV = ALERTS.length ? ALERTS[0].t : ""; renderAlerts(); };
document.querySelectorAll("#labsw button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("#labsw button").forEach((x) => x.classList.remove("on")); btn.classList.add("on");
  const r = btn.dataset.lv === "results"; $("lab").style.display = r ? "none" : ""; $("lab-results").style.display = r ? "" : "none";
}));
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-drop]"); if (d) { const el = $(d.dataset.drop); if (el) el.classList.toggle("open"); return; }
  const gt = e.target.closest("[data-game]"); if (gt) { openGame(gt.dataset.game); return; }
  const al = e.target.closest("[data-algame]"); if (al) { const k = al.dataset.algame; if (k) { showPanel("lines"); openGame(k); } return; }
  const ch = e.target.closest("[data-alk]"); if (ch) { ALFILTER = ch.dataset.alk; renderAlerts(); return; }
  const tr = e.target.closest(".tdr"); if (tr && !e.target.closest(".price-link") && !e.target.closest(".more")) { tr.classList.toggle("open"); return; }
  const p = e.target.closest(".price-link"); if (p) toast(p.dataset.market ? "Polymarket market: " + p.dataset.market : "No market recorded for this price.", 8000);
});
// Everything refreshes by itself while the page is open and visible: lines, model, injuries, alerts, and the Pick Lab / Record data.
const onRecordTab = () => ["panel-record", "panel-lab"].some((id) => $(id) && $(id).classList.contains("on"));
async function refreshAll() { try { await loadSlate(); await loadAlerts(); if (onRecordTab()) await loadRecord(); } catch {} }
function autoRefresh() { setTimeout(async () => { if (!document.hidden) await refreshAll(); autoRefresh(); }, 120e3); }
loadSlate().then(loadAlerts).then(autoRefresh).catch((e) => ($("hero-upd").textContent = "Couldn't load this week: " + e.message));
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - LOADED_AT > 60e3) refreshAll(); });
