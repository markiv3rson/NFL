// NFL SLATEZZZ — everything comes from /api/slate (lines, TD, flags) and /api/mybets + /api/results/list (Record).
let S = null, RES = null, MB = null, tdSort = "likely", recView = "mine";
const $ = (id) => document.getElementById(id);
const dash = '<span class="dim">—</span>';
const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
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
  return `<div class="top"><div><div class="gh">${g.key}${g.badge ? `<span class="badge">${g.badge}</span>` : ""}</div><div class="sub">${tm(g.kickoff)} · ${status(g)}${extra}</div>` +
    (g.qb && g.qb.length && !g.final ? `<div class="warn">⚠ ${esc(g.qb.join(" · "))} · ${qbAdjusted(g) ? "model adjusted (estimate)" : "model can't see this"}</div>` : "") +
    (g.dataCheck ? `<div class="warn">⚠ ${esc(g.dataCheck)}</div>` : "") + `</div>` +
    `<div class="btns" style="margin-top:0;flex-shrink:0">${n ? `<button class="tag" data-drop="inj-${id}">Injuries ${n} ▾</button>` : ""}<button class="tag" data-drop="his-${id}">History ▾</button>${(g.news || []).length ? `<button class="tag" data-drop="news-${id}">News ${g.news.length} ▾</button>` : ""}</div></div>` +
    `<div class="drop" id="news-${id}"><div class="s" style="margin-bottom:4px">ESPN headlines, last 4 days — verify before acting (never changes the model)</div>` +
    (g.news || []).map((a) => `<div class="drow"><span>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.headline)}</a>` : esc(a.headline)}</span><span class="dim">${a.published ? hm(a.published) : ""}</span></div>`).join("") + `</div>` +
    `<div class="drop" id="inj-${id}"><div class="s" style="margin-bottom:4px">Official report · updated ${S.injuriesUpdated ? hm(S.injuriesUpdated) : "—"}</div>` +
    (g.injuries || []).map((x) => `<div class="drow"><span>${esc(x.name)} <span class="dim">${esc(x.pos || "")} · ${x.team}</span></span><span class="${/out/i.test(x.status) ? "r" : /doubt/i.test(x.status) ? "r" : "y"}">${esc(x.status)}</span></div>`).join("") + `</div>` +
    `<div class="drop" id="his-${id}"><div class="s" style="margin-bottom:4px">How the line moved this week (Polymarket)</div>` +
    `<div class="drow dim"><span>When</span><span>Spread</span><span>Total</span></div>` +
    ((g.history || []).filter((h) => h.poly).slice().reverse().map((h) => { const p = h.poly;
      return `<div class="drow"><span>${hm(h.t)}${h.src === "kickoff" ? " 🔒" : ""}</span><span>${p.spread ? `${g.home} ${sgn(p.spread.homeSpread)}` : "—"}</span><span>${p.total ? p.total.line : "—"}</span></div>`; }).join("") ||
      '<div class="s">No snapshots yet this week.</div>') + `</div>`;
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
  if (m.fix && m.fix.div) s += " Division game (these play closer than the ratings say).";
  if (m.fix && m.fix.awayBye) s += ` ${g.away} is off a bye.`;
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
  return wrap((coin ? `<span>No lean · about 50/50</span><div class="s">tilt: ${p.label} ${p.pct.toFixed(1)}%</div>` :
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
function renderLines() {
  $("lines").innerHTML = [...S.games].sort(order).map((g, i) => {
    const p = g.poly || {}, b = g.books || {};
    const live = !g.started && p.spread ? '<span class="live"></span>' : "";
    const row = (k, v, mt) => `<div class="prl${mt ? " mt" : ""}"><span class="s">${k}</span><span>${v}</span></div>`;
    const poly = p.spread || p.ml ? `${live}` +
      (p.spread ? row("Spread", `${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}`) + row("", `${g.away} ${sgn(-p.spread.homeSpread)} ${odds(toAmerican(p.spread.away))}`) : "") +
      (p.ml ? row("Moneyline", `${g.home} ${odds(toAmerican(p.ml.home))}`, !!p.spread) + row("", `${g.away} ${odds(toAmerican(p.ml.away))}`) : "") : dash;
    return `<div class="card${g.final ? " fin" : ""}"><div class="inner">${headButtons(g, "l" + i)}<div class="f">${HDR}` +
      `<div><div class="k">Sportsbooks (reference only)</div>${b.spread ? `${g.home} ${sgn(b.spread.homeSpread)} ${odds(b.spread.home.odds)}<div class="s">no-vig ${g.home} ${odds(toAmerican(b.spread.home.fair))} / ${g.away} ${odds(toAmerican(b.spread.away.fair))}</div>` : dash}</div>` +
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
function prow(r, g, showGame) {
  const inj = r.injury && GAME_STATUS.test(r.injury) ? ` <span class="pill ${/out|doubt/i.test(r.injury) ? "p-r" : "p-y"}" style="padding:0 6px;font-size:10px">${esc(r.injury)}</span>` : "";
  // Model's chance (big, left) and Polymarket's price (right), each with its plain label directly underneath. No verdict, no edge, no stake.
  const chance = r.fair != null ? `${Math.round(r.fair)}%` : dash;
  const cents = r.price != null ? `<span class="price-link" data-market="${esc(r.market || (r.stale ? "Old screenshot price — not live" : ""))}">${Math.round(r.price * 100)}¢</span>` : dash;
  const snap = r.snap ? ` · ${r.snap.pct}% snaps${r.snap.missed ? ` <span class="warn-t">⚠ didn't play last game (last played week ${r.snap.lastWeek}) — check status</span>` : r.snap.early ? ` <span class="warn-t">⚠ left last game early? (usually ${r.snap.avg}%) — check injury news</span>` : r.snap.trend === "up" ? ' <span class="g">↑</span>' : r.snap.trend === "down" ? ' <span class="r">↓ role shrinking</span>' : ""}` : "";
  // team code dropped from the subtitle when the logo is shown (showGame) — the logo already carries it
  const sub = `${showGame ? `${r.game} · ` : ""}#${r.teamRank} on team${snap}`;
  const more = r.fair != null && (r.two != null || r.first != null) ? `2+ TDs ${r.two != null ? Math.round(r.two) + "%" : "—"} · first TD of the game ${r.first != null ? Math.round(r.first) + "%" : "—"}` : "";
  const flags = (r.flags || []).map((f) => `<div class="y" style="font-size:11.5px">⚠ ${esc(f)}</div>`).join("");
  const logo = r.team ? `<img class="logo" src="${logoUrl(r.team)}" alt="${r.team}">` : "";
  return `<div class="prow"><div>${logo}<b style="font-weight:600">${r.player}</b><span class="pos">${r.pos}</span>${inj}<div class="s">${sub}</div></div>` +
    `<div class="n"><span class="big">${chance}</span><span class="lbl">model's<br>chance</span></div>` +
    `<div class="n"><span class="px">${cents}</span><span class="lbl">Polymarket<br>price${r.stale ? " (old)" : r.thin ? '<br><span class="warn-t">thin market</span>' : ""}</span></div>` +
    `<div class="why">${more}${flags}</div></div>`;
}
const usable = (r) => !(r.odds != null && r.odds <= -600);   // drop broken/illiquid prices (-600 or shorter)
function tdCard(g, id) {
  const p = g.poly || {}, hs = p.spread ? p.spread.homeSpread : null, tot = p.total ? p.total.line : null;
  const lines = hs != null && tot != null ? ` · ${g.home} ${sgn(hs)} · O/U ${tot}` : "";
  const implied = (team) => (hs == null || tot == null ? "" : `implied ${(team === g.home ? tot / 2 - hs / 2 : tot / 2 + hs / 2).toFixed(1)} pts`);
  const n = tdSort === "game2" ? 2 : tdSort === "game1" ? 1 : 99;
  const side = (team) => { const rows = (g.td || []).filter((r) => r.team === team && r.fair != null && usable(r)).sort((a, b) => b.fair - a.fair).slice(0, n);
    const gp = g.tdGroups && g.tdGroups[team], groups = gp ? ["RB", "WR", "TE"].filter((k) => gp[k] != null).map((k) => `${k} ${Math.round(gp[k])}%`).join(" · ") : "";
    return `<div><div class="sh" style="color:#c9c9cf">${team} <span class="s" style="font-weight:400">${implied(team)}</span></div>${groups ? `<div class="s" style="margin-bottom:2px">Chance any one of them scores: ${groups}</div>` : ""}${rows.map((r) => prow(r, g, false)).join("") || '<div class="s">No players yet — tap ▶ Rerun model.</div>'}</div>`; };
  return `<div class="card${g.final ? " fin" : ""}" style="margin-top:10px"><div class="inner">${headButtons(g, id, lines)}<div class="teams">${side(g.away)}${side(g.home)}</div>${(g.tdUnmodeled || []).length ? `<div class="s" style="margin-top:6px">Also on Polymarket, <b>not in the model</b> (QBs, returners, new players, or players the model dropped as IR / exempt / released — check before buying): ${g.tdUnmodeled.map((u) => `${esc(u.player)} ${Math.round(u.price * 100)}¢${u.thin ? " (thin)" : ""}`).join(" · ")}</div>` : ""}</div>${cover(g, null)}</div>`;
}
function renderTd() {
  const wk = S.week ? ` — Week ${S.week}` : "";
  $("td-header").textContent = `Anytime TD${wk}`;
  if (tdSort === "likely") {
    const rows = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).map((r) => ({ r, g })))
      .filter((x) => x.r.fair != null && usable(x.r)).sort((a, b) => b.r.fair - a.r.fair);
    $("td").innerHTML = rows.map((x) => `<div class="card" style="margin-top:10px">${prow(x.r, x.g, true)}</div>`).join("") ||
      '<div class="card" style="margin-top:10px"><div class="s">No players yet — tap ▶ Rerun model.</div></div>';
    return;
  }
  $("td").innerHTML = [...S.games].sort(order).map((g, i) => tdCard(g, "d" + i)).join("");
}
// ---------- Record: Mine ----------
const RESMARK = { W: '<span class="g">✓</span>', L: '<span class="r">✗</span>', P: '<span class="dim">=</span>', pending: '<span class="dim">•</span>' };
function legName(l) { return l.kind === "td" ? `${l.player} TD` : l.kind === "spread" ? `${l.team} ${sgn(l.line)}` : `${l.side === "over" ? "Over" : "Under"} ${l.line}`; }
function betRow(b) {
  const hit = b.legs.filter((l) => l.result === "W").length;
  const state = b.result === "W" ? '<span class="g">Won</span>' : b.result === "L" ? '<span class="r">Lost</span>' : b.result === "P" ? "Push" : `<span class="dim">${hit} of ${b.legs.length} hit</span>`;
  return `<div class="row"><span>${b.legs.length > 1 ? "Combo" : "Single"} · ${money(b.cost)} → ${money(b.toWin)}</span><span>${state}${b.pl != null ? ` ${cMoney(b.pl)}` : ""}</span></div>` +
    `<div class="s" style="padding:0 0 6px 8px">${b.legs.map((l) => `${RESMARK[l.result]} ${legName(l)}${l.clv != null ? ` <span class="${signCls(l.clv)}">(${(l.clv * 100).toFixed(0)}%)</span>` : ""}`).join(" · ")}</div>`;
}
function renderMine() {
  if (!MB) { $("record-mine").innerHTML = '<div class="card" style="margin-top:10px"><div class="s">Loading…</div></div>'; return; }
  const s = MB.summary, open = MB.bets.filter((b) => b.result === "pending"), done = MB.bets.filter((b) => b.result !== "pending");
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
    `<div class="fold" data-drop="synced"><span>Synced from your Polymarket account${synced.length ? ` · ${synced.length}` : ""}</span><span>▾</span></div>` +
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
    ? `<div class="row"><span class="dim">Spread · total tilts (~50/50)</span><span>${rec(pick("spread", res))} · ${rec(pick("total", res))}</span></div>` +
      '<div class="s dim">Spread/total picks sit near 50% by design (the model has no measured edge there), so expect about .500. Picks before 9/28 used the old uncalibrated numbers.</div>' : "";
  const tdAll = res.flatMap((r) => r.td || []);
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
  const priced = tdAll.filter((p) => p.ask > 0 && p.ask < 1);
  const isThin = (p) => !(p.bid > 0) || p.ask - p.bid > Math.min(0.05, 0.4 * p.ask);   // same rule as lib/odds.js isThinMarket
  const tdPx = priced.filter((p) => !isThin(p)), thinN = priced.length - tdPx.length;
  let vsMkt = "";
  if (tdPx.length) {
    const y = (p) => (p.scored ? 1 : 0), mk = (p) => (p.bid ? (p.bid + p.ask) / 2 : p.ask);
    const bM = tdPx.reduce((a, p) => a + (p.fair / 100 - y(p)) ** 2, 0) / tdPx.length;
    const bP = tdPx.reduce((a, p) => a + (mk(p) - y(p)) ** 2, 0) / tdPx.length;
    const buys = tdPx.filter((p) => p.fair / 100 > p.ask);
    const pl = buys.reduce((a, p) => a + (p.scored ? 1 / p.ask - 1 : -1), 0);
    const hits = buys.filter((p) => p.scored).length;
    const small = tdPx.length < 200 ? ' <span class="dim">· small sample (needs ~200+)</span>' : "";
    vsMkt = `<div class="row"><span class="dim">Players checked (real markets)</span><span>${tdPx.length}${small}</span></div>` +
      (thinN ? `<div class="row"><span class="dim">Thin markets skipped</span><span>${thinN} <span class="dim">· no real bid</span></span></div>` : "") +
      `<div class="row"><span class="dim">Accuracy (lower wins)</span><span>Model ${bM.toFixed(3)} · Polymarket ${bP.toFixed(3)} ` +
      (bM < bP ? '<span class="g">model ahead</span>' : '<span class="r">market ahead</span>') + `</span></div>` +
      `<div class="row"><span class="dim">$1 on Yes when model &gt; price</span><span>${hits} of ${buys.length} scored · ${cMoney(pl)} ${buys.length ? `(${cPct(pl / buys.length)})` : ""}</span></div>` +
      // The other side of the same markets: most of the model's disagreements are "less likely than the price says"
      // (Week 3: model below market on 67 of 83 real markets), and a Yes-only check ignored all of them. Buying No
      // costs 1 − bid. Tracked here, not recommended, until it has a real sample.
      (() => { const no = tdPx.filter((p) => 1 - p.fair / 100 > 1 - p.bid);
        const plNo = no.reduce((a, p) => a + (!p.scored ? 1 / (1 - p.bid) - 1 : -1), 0);
        return `<div class="row"><span class="dim">$1 on No when model &lt; price</span><span>${no.filter((p) => !p.scored).length} of ${no.length} won · ${cMoney(plNo)} ${no.length ? `(${cPct(plNo / no.length)})` : ""}</span></div>`; })() +
      `<div class="row"><span class="dim">Scored vs priced</span><span>${(tdPx.filter((p) => p.scored).length / tdPx.length * 100).toFixed(0)}% scored · Polymarket priced ${(tdPx.reduce((a, p) => a + mk(p), 0) / tdPx.length * 100).toFixed(0)}% · model ${(tdPx.reduce((a, p) => a + p.fair, 0) / tdPx.length).toFixed(0)}%</span></div>` +
      '<div class="s dim">Closing prices, before fees, real markets only. The test of whether the TD model beats Polymarket.</div>';
  }
  const st = S.status, wc = S.weekCheck;
  const stOk = st && st.ok && !st.creditWarning;
  const stRows = st ? [
    ["Last snapshot", st.lastSnapshot ? hm(st.lastSnapshot) : "—"], ["Last model run", st.modelRunAt ? hm(st.modelRunAt) : "—"],
    ["Last backup", st.backup ? `${hm(st.backup.t)} · ${st.backup.where === "volume" ? "saved" : '<span class="y">temporary — add a Railway volume</span>'}` : '<span class="y">none yet</span>'],
    ["Last TD retrain", st.retrain ? `${hm(st.retrain.t)} · ${esc(st.retrain.summary)}` : '<span class="dim">not run yet — runs every Tuesday</span>'],
    ["Database used", st.usedMb != null ? `${st.usedMb.toFixed(1)} of ${st.capMb} MB` : "—"],
    ["Sportsbook credits left", st.creditWarning ? `<span class="y">${st.credits ?? "—"}</span>` : (st.credits ?? "—")],
  ].map(([a, b]) => `<div class="row"><span class="dim">${a}</span><span>${b}</span></div>`).join("") +
    (st.creditWarning ? `<div class="s y">⚠ ${esc(st.creditWarning)}</div>` : "") +
    (st.errors.length ? st.errors.map((e) => `<div class="s y">⚠ ${hm(e.t)} · ${esc(e.where)}: ${esc(e.msg)}</div>`).join("") : '<div class="s g">No errors this week.</div>') : "";
  const games = res.map((r) => `<div class="row"><span>${r.game} <span class="dim">wk ${r.week} · ${r.awayScore}–${r.homeScore}</span></span><span>` +
    [r.spread, r.total, r.ml].filter(Boolean).map((x) => `${x.label} ${x.result === "W" ? '<span class="g">W</span>' : x.result === "L" ? '<span class="r">L</span>' : "P"}`).join(" · ") + `</span></div>`).join("");
  $("record-model").innerHTML = `<div class="card" style="margin-top:10px">` +
    `<div class="sec"><div class="sh">Summary</div>` +
    `<div class="row"><span class="dim">Your record · P/L</span><span>${s.wins}–${s.losses}${s.pushes ? "–" + s.pushes : ""} · ${cMoney(s.pl)}</span></div>` +
    `<div class="row"><span class="dim">ROI · Avg CLV</span><span>${cPct(s.roi)} · ${cPct(s.avgClv)}</span></div>` +
    `<div class="row"><span class="dim">Open this week</span><span>${money(s.openCost)} of $200</span></div></div>` +
    `<div class="sec"><div class="sh">Week ${lw ?? S.week} recap</div>` +
    (wk.length ? `<div class="row"><span class="dim">Tilts: spreads · totals · moneyline</span><span>${rec(pick("spread", wk))} · ${rec(pick("total", wk))} · ${rec(pick("ml", wk))}</span></div>` : '<div class="s">No finished games graded yet.</div>') +
    `<div class="row"><span class="dim">Week ${S.week} loaded</span><span>${wc.games} games · lines ${wc.withLines}/${wc.games} · model ${wc.modelRun ? '<span class="g">✓</span>' : '<span class="y">not run yet</span>'}</span></div>` +
    ((wc.watch || []).length ? `<div class="s" style="margin-top:6px"><b class="y">Watchdog</b>${wc.watch.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}</div>` : '<div class="s dim" style="margin-top:6px">Watchdog: nothing missing or stale.</div>') + `</div>` +
    `<div class="sec"><div class="sh">Season record</div>${seasonRec || '<div class="s">No graded picks yet.</div>'}` +
    `<div class="row"><span class="dim">Moneyline (market-based)</span><span>${rec(pick("ml", res))}</span></div>` +
    `</div>` +
    `<div class="sec"><div class="sh">TD model check</div>${buckets || '<div class="s">Fills in as games go final.</div>'}</div>` +
    // Top picks: the model's #1 and #2 per team each game, scored vs how many the model itself expected to hit.
    // A 40% pick misses 6 times in 10, so "most picks missed" is normal; the test is actual vs expected.
    (() => { const byTeam = {}; for (const r of res) for (const p of r.td || []) (byTeam[r.game + "|" + p.team] = byTeam[r.game + "|" + p.team] || []).push(p);
      const top = (n) => Object.values(byTeam).flatMap((ps) => ps.slice().sort((a, b) => b.fair - a.fair).slice(0, n));
      const line = (lab, L) => L.length ? `<div class="row"><span class="dim">${lab}</span><span>${L.filter((p) => p.scored).length} of ${L.length} scored · model expected ${(L.reduce((a, p) => a + p.fair, 0) / 100).toFixed(1)}</span></div>` : "";
      const t1 = top(1), t2 = top(2);
      const all = Object.values(byTeam).flat();
      const two = all.filter((p) => p.two != null), ftd = all.filter((p) => p.ftd != null);
      const extra = (two.length ? `<div class="row"><span class="dim">2+ TDs</span><span>${two.filter((p) => p.twoHit).length} players did it · model expected ${(two.reduce((a, p) => a + p.two, 0) / 100).toFixed(1)}</span></div>` : "") +
        (ftd.length ? `<div class="row"><span class="dim">First TD of the game</span><span>${ftd.filter((p) => p.ftdHit).length} listed players scored first · model expected ${(ftd.reduce((a, p) => a + p.ftd, 0) / 100).toFixed(1)}</span></div>` : "");
      return t1.length ? `<div class="sec"><div class="sh">Top TD picks</div>${line("#1 per team", t1)}${line("Top 2 per team", t2)}${extra}</div>` : ""; })() +
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
    if (!mb.ok) throw new Error(mb.error); MB = mb; RES = rl.ok ? rl.results : [];
    renderRecord();
    if (sync && mb.sync) toast(mb.sync.ok ? `Synced ${mb.sync.positions} positions.` : `Sync: ${mb.sync.note}`);
  } catch (e) { toast("Record failed: " + e.message, 10000); }
}
// ---------- header / load / buttons ----------
function weekline() {
  const ks = S.games.map((g) => new Date(g.kickoff)).sort((a, b) => a - b), f = (d) => d.toLocaleString(undefined, { month: "short", day: "numeric" });
  const range = ks.length ? `${f(ks[0])}–${ks[ks.length - 1].getDate()}` : "";
  const m = S.meta || {};
  $("weekline").innerHTML = `Week ${S.week} · ${range} · ↻ Poly ${clock(m.lastSnapshot)} · Books ${clock(S.booksAt)} · Model ${clock(S.modelRunAt)}`;
}
function renderAll() { weekline(); renderLines(); renderTotals(); renderTd(); if (MB) renderRecord(); }
async function loadSlate() { const d = await (await fetch("/api/slate")).json(); if (!d.ok) throw new Error(d.error); S = d; renderAll(); }
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
