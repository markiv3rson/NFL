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
function betCell(g, markets) {
  if (g.started) return `<td data-label="Bet">${dash}</td>`;
  const b = S.best.filter((x) => x.game === g.key && markets.includes(x.market)).sort((a, c) => c.ev - a.ev)[0];
  if (!b) return `<td data-label="Bet"><span class="dim">No edge</span></td>`;
  return `<td data-label="Bet"><span class="badge badge-pos">Bet</span> <b>${b.label}</b> ${odds(b.odds)}` +
    `<div class="game" style="margin-top:2px;">${evStr(b.ev)} edge · ${b.stake ? "$" + b.stake : "$0 (" + (b.capped || "cap") + ")"}${b.estimate ? " · Estimate" : ""}${b.agrees === true ? " · model agrees" : b.agrees === false ? " · model disagrees" : ""}${b.recheck ? " · ⚠ recheck (>30%)" : ""}</div></td>`;
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
// ---------- Anytime TD ----------
let tdSort = "ev";
function meaning(r) {
  if (r.fair == null || r.ev == null) return dash;
  const rank = r.rank === 1 ? "Most likely to score in this game" : r.rank === 2 ? "2nd most likely" : r.rank === 3 ? "3rd most likely" : `${r.rank}th of ${r.of}`;
  const ev = r.ev * 100;
  const [txt, cls] = ev <= -20 ? ["way overpriced", "ev-neg"] : ev <= -5 ? ["overpriced", "ev-neg"] : ev < 5 ? ["priced about right", ""] : ev < 20 ? ["underpriced, good value", "ev-pos"] : ["way underpriced — recheck", "ev-pos"];
  return `<span class="${cls}">${rank}, ${txt}</span><div class="game" style="margin-top:2px;">(${evStr(r.ev)} value)</div>`;
}
const note = (r) => (r.note ? `<div class="warnline">${esc(r.note)}</div>` : "");
function tdRowHtml(r, g, inj, noteHtml, lean) {
  return `<tr><td class="full"><span class="player">${r.player}</span><span class="pos-tag">${r.pos}</span><span class="pos-tag">${r.team}</span>${inj}` +
    `<div class="game" style="margin-top:2px;">${r.game} · ${g ? tm(g.kickoff) + " — " + gameStatus(g) : ""}</div>${noteHtml}</td>` +
    `<td class="num" data-label="Model">${r.fairOdds != null ? odds(r.fairOdds) : dash}<div class="game" style="margin-top:2px;">${r.fair != null ? r.fair.toFixed(1) + "%" : ""}${r.rank ? ` · #${r.rank} of ${r.of}` : ""}</div></td>` +
    `<td class="num" data-label="Polymarket">${r.odds != null ? odds(r.odds) : dash}${r.stale ? '<div class="game">old</div>' : ""}${g && g.started ? '<div class="game">🔒</div>' : ""}</td>` +
    `<td class="wide" data-label="What it means">${r.stale ? '<span class="dim">Waiting for a live price</span>' : meaning(r)}</td><td data-label="Lean">${lean}</td></tr>`;
}
function tdRow(r) {
  const g = S.games.find((x) => x.key === r.game);
  const inj = r.injury ? `<span class="inj${/^out$/i.test(r.injury) ? " out" : ""}">${esc(r.injury)}</span>` : "";
  const leanCls = r.lean === "Bet" ? "badge-pos" : r.lean === "Pass" ? "badge-neg" : "";
  if (r.lean === "Old price") return tdRowHtml(r, g, inj, note(r), `<span class="dim" title="Last seen on a screenshot earlier in the week — not live. Tap ↻ to pull live prices.">old price</span>`);
  const lean = r.lean === "—" ? dash : `<span class="badge ${leanCls}">${r.lean}${r.lean === "Bet" && r.stake ? ` $${r.stake}` : ""}</span>`;
  return tdRowHtml(r, g, inj, note(r), lean);
}
function renderTd() {
  let rows = S.games.flatMap((g) => g.td || []);
  if (tdSort === "ev") rows.sort((a, b) => (b.ev ?? -9) - (a.ev ?? -9));
  else if (tdSort === "fair") rows.sort((a, b) => (b.fair ?? -1) - (a.fair ?? -1));
  else {
    const n = tdSort === "game2" ? 2 : 1, out = [];
    S.games.forEach((g) => ["away", "home"].forEach((side) => {
      const team = side === "away" ? g.away : g.home;
      out.push(...(g.td || []).filter((r) => r.team === team && r.fair != null).sort((a, b) => b.fair - a.fair).slice(0, n));
    }));
    rows = out;
  }
  $("rows-td").innerHTML = rows.map(tdRow).join("") || `<tr><td colspan="5" class="dim">No TD numbers yet — tap Rerun model.</td></tr>`;
}
// ---------- Best Bets ----------
function renderBest() {
  const lines = S.best;
  const cap = ` Total $${S.totalStake} of your $${S.weeklyCap} weekly cap — best edges get money first; same-team spread + moneyline keeps only the better one; correlated bets share one stake.`;
  $("best-note").innerHTML = `Only positive-edge Polymarket plays on games that haven't kicked off. Fair = sportsbook no-vig for game lines (model = Estimate if no book line), TD model for props. ` +
    `Stakes = quarter Kelly on $1,000, max $50.${cap}` + (S.hasBooks ? "" : ` <span class="status-pending">No sportsbook odds yet — game-line edges use the model and are labeled Estimate.</span>`);
  $("rows-best").innerHTML = lines.map((b) => {
    const g = S.games.find((x) => x.key === b.game);
    const warn = (b.warnings || []).map((w) => `<div class="warnline">⚠ ${esc(w)}</div>`).join("");
    const kind = b.market === "td" ? "TD prop" : b.market === "ml" ? "Moneyline" : b.market === "spread" ? "Spread" : "Total";
    return `<tr><td class="full"><span class="player">${b.label}</span><span class="pos-tag">${kind}</span>${b.injury ? `<span class="inj">${esc(b.injury)}</span>` : ""}` +
      `<div class="game" style="margin-top:2px;">${b.game} · ${g ? tm(g.kickoff) : ""}${b.agrees === true ? " · model agrees" : b.agrees === false ? " · model disagrees" : ""}${b.recheck ? " · ⚠ recheck (>30%)" : ""}</div>${warn}</td>` +
      `<td class="num" data-label="Polymarket">${odds(b.odds)}</td><td class="num" data-label="Fair">${odds(b.fairOdds)}</td>` +
      `<td class="num ev-pos" data-label="Edge">${evStr(b.ev)}${b.estimate ? '<div class="game">Estimate</div>' : ""}</td>` +
      `<td class="num" data-label="Stake"><b>${b.stake ? "$" + b.stake : "$0"}</b>${b.capped ? `<div class="game">${b.capped}</div>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="dim">No positive-edge bets right now.</td></tr>`;
}
// ---------- Injuries ----------
function renderInjuries() {
  const teams = new Set(S.games.flatMap((g) => [g.away, g.home]));
  const order = { out: 0, doubtful: 1, questionable: 2 };
  const rows = Object.entries(S.injuries || {}).filter(([t]) => teams.has(t)).flatMap(([t, ps]) => ps.map((p) => ({ ...p, team: t })))
    .sort((a, b) => (order[(a.status || "").toLowerCase()] ?? 9) - (order[(b.status || "").toLowerCase()] ?? 9) || a.team.localeCompare(b.team));
  $("injuries-status").textContent = S.injuries ? `Official team injury reports — ${rows.length} players on this week's teams. Players listed Out are left out of the TD model automatically.` : "Injury feed unavailable right now.";
  $("rows-injuries").innerHTML = rows.map((p) => `<tr><td class="player">${esc(p.name)} <span class="pos-tag">${esc(p.pos || "")}</span></td><td>${p.team}</td><td>${esc(p.detail || "—")}</td>` +
    `<td class="${/^out$/i.test(p.status) ? "ev-neg" : /doubt/i.test(p.status) ? "status-pending" : ""}">${esc(p.status)}</td></tr>`).join("");
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
