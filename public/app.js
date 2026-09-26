// NFL BETTORS dashboard. Everything comes from /api/slate (computed server-side).
// Polymarket = the only betting venue. Sportsbooks = reference prior only.
let S = null; // current slate
const $ = (id) => document.getElementById(id);
const dash = '<span class="dim">—</span>';
const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const sgn = (n) => (n > 0 ? "+" : "") + n;
const odds = (o) => (o == null ? "—" : (o > 0 ? "+" : "") + o);
function toAmerican(p) { if (!(p > 0 && p < 1)) return null; return Math.round(p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p); }
const pct = (p, d = 1) => (p == null ? "—" : (p * 100).toFixed(d) + "%");
const evStr = (ev) => (ev == null ? "—" : (ev >= 0 ? "+" : "") + (ev * 100).toFixed(1) + "%");
const tm = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const hm = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

function toast(msg, ms = 6000) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._h); if (ms) toast._h = setTimeout(() => t.classList.remove("show"), ms);
}
function gameStatus(g) {
  if (g.final) return `<span class="dim">Final${g.awayScore != null ? ` ${g.awayScore}–${g.homeScore}` : ""}</span>`;
  if (g.started) return '<span class="ev-neg">🔴 In progress</span>';
  return '<span class="dim">Not started</span>';
}
function gameCell(g, clickable = true) {
  return `<td class="full${clickable ? " clickable" : ""}" ${clickable ? `data-hist="${esc(g.key)}"` : ""}><span class="player">${g.key}</span>` +
    `<div class="game" style="margin-top:2px;">${tm(g.kickoff)} — ${gameStatus(g)}</div></td>`;
}
const LEAN = { none: ["No lean", "badge"], weak: ["Weak", "badge"], moderate: ["Moderate", "badge-pos"], strong: ["Strong", "badge-pos"],
  "strong-lt": ["Low trust", "badge-warn"], conflict: ["Conflict", "badge-neg"] };
const PICK_CLS = { none: "dim", weak: "", moderate: "ev-pos", strong: "ev-pos", "strong-lt": "", conflict: "ev-neg" };
function pickCell(p) {
  if (!p) return `<td class="pick" data-label="Model pick">${dash}</td>`;
  const [label, badge] = LEAN[p.tier] || ["", "badge"];
  const info = p.note ? ` <span class="info" title="${esc(p.note)}">ⓘ</span>` : "";
  return `<td class="pick" data-label="Model pick"><span class="${PICK_CLS[p.tier] || ""}">${p.label}</span> <span class="badge ${badge}">${label}</span>${info}` +
    `<div class="game" style="margin-top:2px;">${p.pct.toFixed(1)}% model chance</div></td>`;
}
function lockTag(g) {
  if (!g.started) return "";
  return `<div class="game" style="margin-top:2px;">🔒 ${g.final ? "Closing line" : "Locked — in progress"}</div>`;
}
const SEC_BADGE = { bet: ["Bet", "badge-pos"], recheck: ["Recheck", "badge-warn"], estimate: ["Estimate", ""] };
function betCell(g, markets) {
  if (g.started) return `<td data-label="Bet">${dash}</td>`;
  const b = S.best.filter((x) => x.game === g.key && markets.includes(x.market)).sort((a, c) => c.ev - a.ev)[0];
  if (!b) return `<td data-label="Bet"><span class="dim">No edge</span></td>`;
  const [label, cls] = SEC_BADGE[b.section] || SEC_BADGE.bet;
  const stakeStr = b.section === "bet" ? (b.stake ? "$" + b.stake : `$0 (${b.capped || "cap"})`)
    : b.section === "recheck" ? "gap too big to trust — no stake" : "no sportsbook odds yet — no stake";
  return `<td data-label="Bet"><span class="badge ${cls}">${label}</span> <b>${b.label}</b> ${odds(b.odds)}` +
    `<div class="game" style="margin-top:2px;">${evStr(b.ev)} edge · ${stakeStr}${b.agrees === true ? " · model agrees" : b.agrees === false ? " · model disagrees" : ""}</div></td>`;
}
function moved(g, kind) {
  const o = g.open, n = g.poly;
  if (!o || !n) return "";
  if (kind === "spread" && o.spread && n.spread && o.spread.homeSpread !== n.spread.homeSpread)
    return `<div class="game" style="margin-top:2px;">Open ${g.home} ${sgn(o.spread.homeSpread)} → ${sgn(n.spread.homeSpread)}</div>`;
  if (kind === "total" && o.total && n.total && o.total.line !== n.total.line)
    return `<div class="game" style="margin-top:2px;">Open ${o.total.line} → ${n.total.line}</div>`;
  return "";
}
function histRow(g, cols) {
  const rows = (g.history || []).slice().reverse().map((h) => {
    const p = h.poly || {};
    const sp = p.spread ? `${g.home} ${sgn(p.spread.homeSpread)} (${odds(toAmerican(p.spread.home))} / ${odds(toAmerican(p.spread.away))})` : "—";
    const tot = p.total ? `${p.total.line} (O ${odds(toAmerican(p.total.over))} / U ${odds(toAmerican(p.total.under))})` : "—";
    const ml = p.ml ? `${g.away} ${odds(toAmerican(p.ml.away))} · ${g.home} ${odds(toAmerican(p.ml.home))}` : "—";
    return `<tr><td>${hm(h.t)}${h.src === "kickoff" ? " 🔒" : h.src === "manual" ? " (you)" : ""}</td><td>${sp}</td><td>${tot}</td><td>${ml}</td></tr>`;
  }).join("");
  return `<tr class="hist" data-for="${esc(g.key)}"><td colspan="${cols}">` +
    (rows ? `<table><tr><th>Snapshot</th><th>Spread</th><th>Total</th><th>Moneyline</th></tr>${rows}</table>` : "No snapshots yet this week.") + `</td></tr>`;
}

// ---------- Game Lines ----------
function renderLines() {
  $("rows-lines").innerHTML = S.games.map((g) => {
    const m = g.model, p = g.poly || {}, b = g.books || {};
    const winTeam = m && m.homeWinPct != null ? (m.homeWinPct >= 50 ? `${g.home} ${m.homeWinPct.toFixed(1)}%` : `${g.away} ${(100 - m.homeWinPct).toFixed(1)}%`) : "";
    const model = m ? `${g.home} ${sgn(+(-m.homeMargin).toFixed(1))}<div class="game" style="margin-top:2px;">${winTeam} to win${m.source === "rerun" ? "" : " · earlier run"}</div>` : dash;
    const live = !g.started && p.spread ? '<span class="live-dot">●</span>' : "";
    const poly = p.spread ? `${live}${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}` +
      `<div class="game" style="margin-top:2px;">${g.away} ${sgn(-p.spread.homeSpread)} ${odds(toAmerican(p.spread.away))}${p.ml ? ` · ML ${g.away} ${odds(toAmerican(p.ml.away))} / ${g.home} ${odds(toAmerican(p.ml.home))}` : ""}</div>` +
      moved(g, "spread") + lockTag(g) : dash + lockTag(g);
    const books = b.spread ? `${g.home} ${sgn(b.spread.homeSpread)} ${odds(b.spread.home.odds)}` +
      `<div class="game" style="margin-top:2px;">no-vig ${g.home} ${odds(toAmerican(b.spread.home.fair))} / ${g.away} ${odds(toAmerican(b.spread.away.fair))}${b.ml ? ` · ML ${g.away} ${odds(b.ml.away.odds)} / ${g.home} ${odds(b.ml.home.odds)}` : ""}</div>` : dash;
    return `<tr>${gameCell(g)}<td data-label="Model">${model}</td><td data-label="Polymarket">${poly}</td><td data-label="Books">${books}</td>` +
      `${pickCell(g.spreadPick)}${betCell(g, ["spread", "ml"])}</tr>` + histRow(g, 6);
  }).join("");
}
// ---------- Totals ----------
function renderTotals() {
  $("rows-totals").innerHTML = S.games.map((g) => {
    const m = g.model, p = g.poly || {}, b = g.books || {};
    const wind = m && m.outdoor && m.wind != null ? `🌬 ${m.wind} mph` : g.outdoor ? "outdoor" : "dome/roof";
    const model = m ? `${Number(m.total).toFixed(1)}<div class="game" style="margin-top:2px;">${wind}</div>` : dash;
    const live = !g.started && p.total ? '<span class="live-dot">●</span>' : "";
    const poly = p.total ? `${live}${p.total.line}<div class="game" style="margin-top:2px;">O ${odds(toAmerican(p.total.over))} · U ${odds(toAmerican(p.total.under))}</div>` + moved(g, "total") + lockTag(g) : dash + lockTag(g);
    const books = b.total ? `${b.total.line}<div class="game" style="margin-top:2px;">O ${odds(b.total.over.odds)} · U ${odds(b.total.under.odds)}</div>` : dash;
    return `<tr>${gameCell(g)}<td class="num" data-label="Model">${model}</td><td data-label="Polymarket">${poly}</td><td data-label="Books">${books}</td>` +
      `${pickCell(g.totalPick)}${betCell(g, ["total"])}</tr>` + histRow(g, 6);
  }).join("");
}
// ---------- Anytime TD: one card per matchup, away + home sections ----------
let tdSort = "likely";
const GAME_STATUS = /out|doubtful|questionable/i; // only game-status tags; practice notes stay on the Injuries tab
// Bet bubble color = price: Underpriced green, Fair yellow, Overpriced red. Pass = gray.
const BET_CLS = { Underpriced: "badge-pos", Fair: "badge-warn", Overpriced: "badge-neg" };
const PRICE_CLS = { Underpriced: "ev-pos", Fair: "dim", Overpriced: "ev-neg" };
const MODEL_SAYS = { Underpriced: "Model says good price", Fair: "Model says fair price", Overpriced: "Model says pass on price" };
function tdMeaning(r) {
  if (r.ev == null) return '<span class="dim">No Polymarket price</span>';
  const why = `<span class="dim">: gets ${odds(r.odds)}, should be ${odds(r.fairOdds)}${r.stale ? " (old price)" : ""}</span>`;
  return `<span class="${PRICE_CLS[r.priceLabel]}">${MODEL_SAYS[r.priceLabel]}</span>${why}`;
}
function prow(r, g, showGame = false) {
  const inj = r.injury && GAME_STATUS.test(r.injury) ? `<span class="inj">${esc(r.injury)}</span>` : "";
  const lean = r.lean === "—" ? dash : r.lean === "Pass" ? '<span class="badge">Pass</span>'
    : `<span class="badge ${BET_CLS[r.priceLabel] || ""}">Bet</span>`;
  const price = r.odds == null ? dash
    : `<span class="price-link" data-market="${esc(r.market || (r.stale ? "Old screenshot price — not live" : ""))}">${odds(r.odds)}</span>`;
  const info = r.note ? ` <span class="info" title="${esc(r.note)}">ⓘ</span>` : "";
  const sub = showGame ? `${r.team} · ${r.game} · ${g ? tm(g.kickoff) : ""} · #${r.teamRank} on team` : `#${r.teamRank} on team`;
  return `<div class="prow"><div><span class="player">${r.player}</span><span class="pos-tag">${r.pos}</span>${inj}${info}` +
    `<div class="game">${sub}</div></div>` +
    `<div class="num">${r.fairOdds != null ? odds(r.fairOdds) : dash}<div class="game">${r.fair != null ? r.fair.toFixed(1) + "%" : ""} model</div></div>` +
    `<div class="num">${price}<div class="game">Polymarket</div></div><div>${lean}</div>` +
    `<div class="why">${tdMeaning(r)}</div></div>`;
}
function tdCard(g) {
  const p = g.poly || {}, hs = p.spread ? p.spread.homeSpread : null, tot = p.total ? p.total.line : null;
  const lines = hs != null && tot != null ? `${g.home} ${sgn(hs)} · O/U ${tot}` : "";
  const implied = (team) => hs == null || tot == null ? "" : `implied ${(team === g.home ? tot / 2 - hs / 2 : tot / 2 + hs / 2).toFixed(1)} pts`;
  const n = tdSort === "game2" ? 2 : tdSort === "game1" ? 1 : 99;
  const side = (team) => {
    const rows = (g.td || []).filter((r) => r.team === team && r.fair != null).sort((a, b) => b.fair - a.fair).slice(0, n);
    return `<div class="tteam"><div class="tname">${team}<span class="game">${implied(team)}</span></div>` +
      (rows.map((r) => prow(r, g)).join("") || '<div class="game">No players yet — tap ▶ Rerun model.</div>') + `</div>`;
  };
  return `<div class="gcard${g.started ? " done" : ""}"><div class="ghead"><span class="player">${g.key}</span>` +
    `<span class="game">${tm(g.kickoff)} — ${gameStatus(g)}</span><span class="game">${lines}${g.started ? " 🔒" : ""}</span></div>` +
    `<div class="gteams">${side(g.away)}${side(g.home)}</div></div>`;
}
function renderTd() {
  if (tdSort === "likely") {
    const rows = S.games.filter((g) => !g.started).flatMap((g) => (g.td || []).map((r) => ({ r, g })))
      .filter((x) => x.r.fair != null).sort((a, b) => b.r.fair - a.r.fair);
    $("td-cards").innerHTML = `<div class="gcard"><div class="tteam">` + (rows.map((x) => prow(x.r, x.g, true)).join("") ||
      '<div class="game">No players yet — tap ▶ Rerun model.</div>') + `</div></div>`;
    return;
  }
  const byKick = [...S.games].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const open = byKick.filter((g) => !g.started), done = byKick.filter((g) => g.started);
  $("td-cards").innerHTML = open.map(tdCard).join("") +
    (done.length ? `<details class="gdone"><summary>🔒 Started / final games (${done.length})</summary>${done.map(tdCard).join("")}</details>` : "");
}
document.addEventListener("click", (e) => {
  const el = e.target.closest(".price-link"); if (!el) return;
  toast(el.dataset.market ? "Polymarket market: " + el.dataset.market : "No market recorded for this price.", 8000);
});
// ---------- Best Bets ----------
function bestRow(b) {
  const g = S.games.find((x) => x.key === b.game);
  const warn = (b.warnings || []).map((w) => `<div class="warnline">⚠ ${esc(w)}</div>`).join("");
  const kind = b.market === "td" ? "TD prop" : b.market === "ml" ? "Moneyline" : b.market === "spread" ? "Spread" : "Total";
  const polyCell = b.kind === "td" && b.marketQ ? `<span class="price-link" data-market="${esc(b.marketQ)}">${odds(b.odds)}</span>` : odds(b.odds);
  return `<tr><td class="full"><span class="player">${b.label}</span><span class="pos-tag">${kind}</span>${b.injury && GAME_STATUS.test(b.injury) ? `<span class="inj">${esc(b.injury)}</span>` : ""}` +
    `<div class="game" style="margin-top:2px;">${b.game} · ${g ? tm(g.kickoff) : ""}${b.agrees === true ? " · model agrees" : b.agrees === false ? " · model disagrees" : ""}</div>${warn}</td>` +
    `<td class="num" data-label="Polymarket">${polyCell}</td><td class="num" data-label="Fair">${odds(b.fairOdds)}</td>` +
    `<td class="num ${b.section === "bet" ? "ev-pos" : "status-pending"}" data-label="Edge">${evStr(b.ev)}</td>` +
    `<td class="num" data-label="Stake"><b>${b.stake ? "$" + b.stake : "—"}</b>${b.capped ? `<div class="game">${b.capped}</div>` : ""}</td></tr>`;
}
function renderBest() {
  const all = S.best.map((b) => ({ ...b, marketQ: b.market === "td" ? null : null }));
  S.best.forEach((b, i) => { if (b.kind === "td") all[i].marketQ = b.marketName || b.market_q || null; });
  const bets = all.filter((b) => b.section === "bet"), est = all.filter((b) => b.section === "estimate"), rc = all.filter((b) => b.section === "recheck");
  $("best-note").innerHTML = `Positive-edge Polymarket plays on games that haven't kicked off, best edge first. <b>Fair</b> = sportsbook no-vig price for game lines, TD model for props. ` +
    `<b>Stake</b> = quarter Kelly on $1,000, max $50 per bet, $200 per week — best edges get money first. Same-team spread + moneyline keeps only the better one; ` +
    `correlated bets share one stake. Edges over +30% are listed under <b>Needs a recheck</b> with no stake. Game-line edges from the model alone (no sportsbook odds yet) are listed under <b>Estimate</b> with no stake.`;
  $("best-summary").innerHTML = `<b>${bets.length}</b> bets · <b>$${S.totalStake}</b> of $${S.weeklyCap} weekly cap` + (S.hasBooks ? "" : ` · <span class="status-pending">sportsbook odds not in yet</span>`);
  $("rows-best").innerHTML = bets.map(bestRow).join("") || `<tr><td colspan="5" class="dim">No bets right now.</td></tr>`;
  const sec = (title, sub, list) => !list.length ? "" : `<div class="section-title">${title}<span class="sub">${sub}</span></div>` +
    `<div class="table-scroll"><table><tbody>${list.map(bestRow).join("")}</tbody></table></div>`;
  $("best-extra").innerHTML = sec("Estimate", "model only — no stake until sportsbook odds arrive", est) + sec("Needs a recheck", "edge over +30% — something is probably off, no stake", rc);
}
// ---------- My Bets ----------
const RES = { W: ['<span class="mark ev-pos">✓</span>', "Won"], L: ['<span class="mark ev-neg">✗</span>', "Lost"], P: ['<span class="mark dim">=</span>', "Push"], pending: ['<span class="mark dim">•</span>', "Open"] };
const money = (x) => (x < 0 ? "−$" : "$") + Math.abs(x).toFixed(2);
function legLabel(l) {
  if (l.kind === "td") return `${l.player} <span class="pos-tag">${l.team}</span> TD`;
  if (l.kind === "spread") return `${l.team} ${sgn(l.line)}`;
  return `${l.side === "over" ? "Over" : "Under"} ${l.line}`;
}
function renderMyBets(d) {
  const s = d.summary;
  $("mybets-summary").innerHTML =
    `<span class="rec-big">Record <b>${s.wins}–${s.losses}${s.pushes ? "–" + s.pushes : ""}</b></span>` +
    `<span class="rec-big">P/L <b class="${s.pl > 0 ? "ev-pos" : s.pl < 0 ? "ev-neg" : ""}">${money(s.pl)}</b></span>` +
    `<span class="rec-big">ROI <b>${s.roi == null ? "—" : (s.roi * 100).toFixed(1) + "%"}</b></span>` +
    `<span class="rec-big">Avg CLV <b>${s.avgClv == null ? "—" : evStr(s.avgClv)}</b></span>` +
    `<span class="rec-big">Open <b>${money(s.openCost)}</b> of $200 this week</span>` +
    `<div class="game">${d.keysSet ? `Account sync on${d.synced ? ` · last synced ${hm(d.synced.t)} · ${d.synced.list.length} positions` : " · not synced yet"}` : "Account sync off — add POLYMARKET_KEY_ID and POLYMARKET_SECRET_KEY in Vercel"}. ` +
    `CLV = closing price vs your price (positive = you beat the close). Graded automatically once games are final.</div>`;
  const card = (b) => {
    const [icon, word] = RES[b.result];
    const legs = b.legs.map((l) => { const [m] = RES[l.result];
      return `<div class="leg">${m}<div>${legLabel(l)}<div class="game">${l.game} · ${l.kickoff ? tm(l.kickoff) : ""}</div></div>` +
        `<div class="num">${odds(toAmerican(l.price))}<div class="game">${Math.round(l.price * 1000) / 10}¢ paid</div></div>` +
        `<div class="num">${l.close != null ? odds(toAmerican(l.close)) : dash}<div class="game">${l.clv != null ? `CLV ${evStr(l.clv)}` : "close"}</div></div></div>`; }).join("");
    return `<div class="bet-card"><div class="bet-head"><div><span class="player">${b.legs.length > 1 ? `Combo · ${b.legs.length} legs` : "Single"}</span> ` +
      `<span class="badge ${b.result === "W" ? "badge-pos" : b.result === "L" ? "badge-neg" : ""}">${word}</span></div>` +
      `<div class="num"><b>${money(b.cost)}</b> → ${money(b.toWin)} <span class="dim">(${b.multiplier.toFixed(2)}x)</span>` +
      `${b.pl != null ? ` · <b class="${b.pl > 0 ? "ev-pos" : b.pl < 0 ? "ev-neg" : ""}">${money(b.pl)}</b>` : ""}</div></div>` +
      `<div class="game" style="margin-top:3px;">Pays ${(Math.abs(b.payoutVsLegs) * 100).toFixed(0)}% ${b.payoutVsLegs < 0 ? "under" : "over"} the legs multiplied (${b.legsMultiplier.toFixed(2)}x) · break-even ${(b.breakEven * 100).toFixed(1)}%` +
      `${b.clv != null ? ` · combo CLV <b>${evStr(b.clv)}</b>` : ""}</div>${legs}</div>`;
  };
  const synced = d.synced && d.synced.list.length ? `<div class="section-title">Synced from your account</div>` +
    d.synced.list.map((p) => `<div class="bet-card"><div class="bet-head"><span class="player">${esc(p.title)}${p.outcome ? ` — ${esc(p.outcome)}` : ""}</span>` +
      `<span class="num">${money(p.cost || 0)} · ${p.shares} shares${p.value != null ? ` · now ${money(p.value)}` : ""}${p.expired ? " · settled" : ""}</span></div></div>`).join("") : "";
  $("mybets-list").innerHTML = [...d.bets].sort((a, b) => (a.result === "pending") - (b.result === "pending")).reverse().map(card).join("") + synced;
  $("mybets-raw").textContent = d.raw ? JSON.stringify(d.raw, null, 1).slice(0, 20000) : "No account data yet.";
}
async function loadMyBetsTab(sync = false) {
  $("mybets-summary").textContent = sync ? "Syncing your Polymarket account…" : "Loading…";
  try {
    const d = await (await fetch(`/api/mybets${sync ? "?sync=1" : ""}`)).json();
    if (!d.ok) throw new Error(d.error);
    renderMyBets(d);
    if (sync && d.sync) toast(d.sync.ok ? `Synced ${d.sync.positions} positions from your account.` : `Sync: ${d.sync.note}`, 9000);
  } catch (e) { $("mybets-summary").textContent = "My Bets failed: " + e.message; }
}
$("sync-btn").addEventListener("click", () => loadMyBetsTab(true));
// ---------- Injuries ----------
function renderInjuries() {
  const teams = new Set(S.games.flatMap((g) => [g.away, g.home]));
  const order = { out: 0, doubtful: 1, questionable: 2 };
  const rows = Object.entries(S.injuries || {}).filter(([t]) => teams.has(t)).flatMap(([t, ps]) => ps.map((p) => ({ ...p, team: t })))
    .sort((a, b) => (order[(a.status || "").toLowerCase()] ?? 9) - (order[(b.status || "").toLowerCase()] ?? 9) || a.team.localeCompare(b.team));
  const wk = [...new Set(rows.map((p) => p.week))].sort().map((w) => "Week " + w).join(", ");
  $("injuries-status").innerHTML = S.injuries ? `<b>Injury report updated ${S.injuriesUpdated ? hm(S.injuriesUpdated) : "—"}</b> · ${wk || ""} official team reports · ${rows.length} players. Players listed Out are removed from the TD tab automatically.` : "Injury feed unavailable right now.";
  $("rows-injuries").innerHTML = rows.map((p) => `<tr><td class="player" data-label="Player">${esc(p.name)} <span class="pos-tag">${esc(p.pos || "")}</span></td>` +
    `<td data-label="Team">${p.team} <span class="game">wk ${p.week}</span></td><td data-label="Injury">${esc(p.detail || "—")}</td>` +
    `<td data-label="Status" class="${/^out$/i.test(p.status) ? "ev-neg" : /doubt|quest/i.test(p.status) ? "status-pending" : ""}">${esc(p.status)}</td></tr>`).join("");
}
// ---------- Results ----------
async function loadResults() {
  $("results-summary").textContent = "Loading…";
  try {
    await fetch("/api/results/grade");
    const d = await (await fetch("/api/results/list")).json();
    if (!d.ok) throw new Error(d.error);
    const res = d.results;
    const rec = (list) => { const c = { W: 0, L: 0, P: 0 }; list.forEach((x) => c[x.result]++); return `${c.W}–${c.L}${c.P ? "–" + c.P : ""}`; };
    const block = (title, rs) => {
      const sp = rs.filter((r) => r.spread).map((r) => r.spread), to = rs.filter((r) => r.total).map((r) => r.total);
      const byTier = ["strong", "moderate", "weak", "none"].map((t) => {
        const a = sp.filter((x) => x.tier === t), b = to.filter((x) => x.tier === t);
        return a.length || b.length ? `${LEAN[t][0]}: spreads ${rec(a)}, totals ${rec(b)}` : "";
      }).filter(Boolean).join(" · ");
      return `<div style="margin-bottom:8px;"><span class="rec"><b>${title}</b></span><span class="rec">Spreads <b>${rec(sp)}</b></span><span class="rec">Totals <b>${rec(to)}</b></span><div class="game">${byTier}</div></div>`;
    };
    const weeks = [...new Set(res.map((r) => r.week))].sort((a, b) => b - a);
    $("results-summary").innerHTML = res.length ? block("Season", res) + weeks.map((w) => block(`Week ${w}`, res.filter((r) => r.week === w))).join("") +
      `<div class="game">Graded at the closing line (last price before kickoff). CLV pts = how much the line moved your way from the week's first snapshot.</div>`
      : "No graded games yet — games are graded automatically once they're final and have a closing line.";
    const pick = (x) => !x ? dash : `${x.label} <span class="${x.result === "W" ? "ev-pos" : x.result === "L" ? "ev-neg" : "dim"}">${x.result}</span>` +
      `<div class="game">${x.pct.toFixed(1)}% · ${LEAN[x.tier] ? LEAN[x.tier][0] : x.tier}${x.clvPts != null ? ` · CLV ${sgn(x.clvPts)} pts` : ""}</div>`;
    $("rows-results").innerHTML = res.map((r) => `<tr><td class="player">${r.game}<div class="game">Week ${r.week}</div></td><td>${r.awayScore}–${r.homeScore}</td><td>${pick(r.spread)}</td><td>${pick(r.total)}</td></tr>`).join("");
  } catch (e) { $("results-summary").textContent = "Results failed: " + e.message; }
}
$("export-btn").addEventListener("click", () => (window.location.href = "/api/results/export"));
// ---------- Schedule (look-ahead) ----------
let schedGames = [];
async function loadSchedule() {
  const week = $("schedule-week-select").value;
  $("schedule-status").textContent = "Loading…";
  try {
    const d = await (await fetch(`/api/nfl-schedule?week=${week}`)).json();
    if (!d.ok) throw new Error(d.error);
    schedGames = d.games;
    $("rows-schedule").innerHTML = schedGames.map((g) => `<tr data-game="${g.game}"><td><span class="player">${g.awayName} @ ${g.homeName}</span><div class="game">${g.game}</div></td>` +
      `<td>${g.date ? hm(g.date) : "—"}</td><td class="model-preview-cell dim">—</td></tr>`).join("");
    $("schedule-status").textContent = `${schedGames.length} games — Week ${week}`;
  } catch (e) { $("schedule-status").textContent = "Failed: " + e.message; }
}
function initSchedule() {
  const sel = $("schedule-week-select");
  if (!sel.options.length) for (let w = 1; w <= 18; w++) sel.add(new Option(`Week ${w}`, w, false, w === S.week + 1));
  loadSchedule();
}
$("schedule-week-select").addEventListener("change", loadSchedule);
$("preview-model-btn").addEventListener("click", async () => {
  if (!schedGames.length) return;
  $("schedule-status").textContent = "Running model… (look-ahead, no market lines yet — rough)";
  try {
    const d = await (await fetch("/api/rerun-model", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ games: schedGames.map((g) => { const [away, home] = g.game.split(" @ "); return { away, home }; }) }) })).json();
    if (!d.ok) throw new Error(d.error);
    d.results.forEach((r) => {
      const cell = document.querySelector(`tr[data-game="${r.game}"] .model-preview-cell`); if (!cell) return;
      cell.classList.remove("dim");
      cell.innerHTML = r.error ? `<span class="ev-neg">${esc(r.error)}</span>` : `${r.game.split(" @ ")[1]} ${sgn(r.homeSpread)} · total ${r.total} · win ${r.homeWinPct}%`;
    });
    $("schedule-status").textContent = "Preview done.";
  } catch (e) { $("schedule-status").textContent = "Preview failed: " + e.message; }
});
// ---------- load / refresh / rerun ----------
function statusLine() {
  const m = S.meta || {};
  const parts = [`Week ${S.week}`];
  parts.push(m.lastSnapshot ? `Polymarket ${tm(m.lastSnapshot)}` : "no Polymarket snapshot yet");
  parts.push(S.booksAt ? `Books ${tm(S.booksAt)}` : "Books: not connected");
  parts.push(S.modelRunAt ? `Model run ${tm(S.modelRunAt)}` : "Model: earlier run");
  $("status-line").textContent = parts.join(" · ");
}
function renderAll() { statusLine(); renderBest(); renderLines(); renderTotals(); renderTd(); renderInjuries(); }
async function loadSlate() {
  const d = await (await fetch("/api/slate")).json();
  if (!d.ok) throw new Error(d.error);
  S = d; renderAll();
}
$("refresh-btn").addEventListener("click", async () => {
  const b = $("refresh-btn"); b.disabled = true; toast("Pulling current Polymarket lines…", 0);
  try {
    const d = await (await fetch("/api/snapshot?src=manual")).json();
    if (!d.ok) throw new Error(d.error);
    await loadSlate();
    toast(`Updated ${d.lines} of ${d.upcoming} upcoming games${d.locked ? ` (${d.locked} locked — started or final)` : ""}, TD prices for ${d.props}.`);
  } catch (e) { toast("Refresh failed: " + e.message, 10000); }
  b.disabled = false;
});
$("rerun-btn").addEventListener("click", async () => {
  const b = $("rerun-btn"); b.disabled = true; toast("Rerunning both models at current lines — up to a couple of minutes…", 0);
  try {
    const d = await (await fetch("/api/rerun", { method: "POST" })).json();
    if (!d.ok) throw new Error(d.error);
    await loadSlate();
    toast(`Model rerun: ${d.rerun} games, TD for ${d.td}${d.skippedTd ? ` (${d.skippedTd} had no market line yet)` : ""}.${d.errors && d.errors.length ? " Errors: " + d.errors.join("; ") : ""}`, 10000);
  } catch (e) { toast("Rerun failed: " + e.message, 12000); }
  b.disabled = false;
});
document.querySelectorAll(".tabs button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active"); $("panel-" + btn.dataset.tab).classList.add("active");
  if (btn.dataset.tab === "results") loadResults();
  if (btn.dataset.tab === "mybets") loadMyBetsTab();
  if (btn.dataset.tab === "schedule" && S) initSchedule();
}));
document.querySelectorAll("#panel-td .controls button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("#panel-td .controls button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active"); tdSort = btn.dataset.sort; renderTd();
}));
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-hist]"); if (!c) return;
  const panel = c.closest(".panel");
  panel.querySelectorAll(`tr.hist[data-for="${CSS.escape(c.dataset.hist)}"]`).forEach((r) => r.classList.toggle("open"));
});
loadSlate().catch((e) => ($("status-line").textContent = "Couldn't load this week: " + e.message));
