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
    (g.qb && g.qb.length && !g.final ? `<div class="warn">⚠ ${esc(g.qb.join(" · "))} · model can't see this</div>` : "") +
    (g.dataCheck ? `<div class="warn">⚠ ${esc(g.dataCheck)}</div>` : "") + `</div>` +
    `<div class="btns" style="margin-top:0;flex-shrink:0">${n ? `<button class="tag" data-drop="inj-${id}">Injuries ${n} ▾</button>` : ""}<button class="tag" data-drop="his-${id}">History ▾</button></div></div>` +
    `<div class="drop" id="inj-${id}"><div class="s" style="margin-bottom:4px">Official report · updated ${S.injuriesUpdated ? hm(S.injuriesUpdated) : "—"}</div>` +
    (g.injuries || []).map((x) => `<div class="drow"><span>${esc(x.name)} <span class="dim">${esc(x.pos || "")} · ${x.team}</span></span><span class="${/out/i.test(x.status) ? "r" : /doubt/i.test(x.status) ? "r" : "y"}">${esc(x.status)}</span></div>`).join("") + `</div>` +
    `<div class="drop" id="his-${id}"><div class="s" style="margin-bottom:4px">How the line moved this week (Polymarket)</div>` +
    `<div class="drow dim"><span>When</span><span>Spread</span><span>Total</span></div>` +
    ((g.history || []).filter((h) => h.poly).slice().reverse().map((h) => { const p = h.poly;
      return `<div class="drow"><span>${hm(h.t)}${h.src === "kickoff" ? " 🔒" : ""}</span><span>${p.spread ? `${g.home} ${sgn(p.spread.homeSpread)}` : "—"}</span><span>${p.total ? p.total.line : "—"}</span></div>`; }).join("") ||
      '<div class="s">No snapshots yet this week.</div>') + `</div>`;
}
const TIER = { none: "No lean", weak: "Weak", moderate: "Moderate", strong: "Strong", "strong-lt": "", conflict: "" };
function pickCell(p, g) {
  if (!p) return `<div><div class="k">Model pick</div>${dash}</div>`;
  // QB warnings already show in the card header; finished games hide warnings under the cover
  if (p.warn && (g.final || /^QB change/.test(p.warn))) p = { ...p, warn: null };
  const cls = p.warn ? "" : p.tier === "moderate" || p.tier === "strong" ? "g" : p.tier === "none" ? "dim" : "";
  return `<div><div class="k">Model pick</div><span class="${cls}">${p.label}</span>${!p.warn && TIER[p.tier] ? ` <span class="s">${TIER[p.tier]}</span>` : ""}` +
    `<div class="s">${p.pct.toFixed(1)}% model chance</div>${p.warn ? `<div class="s y">${esc(p.warn)}</div>` : ""}</div>`;
}
const SEC = { bet: ["Bet", "p-g"], held: ["Held", "p-y"], recheck: ["Recheck", "p-y"], estimate: ["Estimate", "p-n"] };
function betCell(g, markets) {
  if (g.started) return `<div><div class="k">Bet</div>${dash}</div>`;
  const b = S.best.filter((x) => x.game === g.key && markets.includes(x.market)).sort((a, c) => c.ev - a.ev)[0];
  if (!b) return `<div><div class="k">Bet</div><span class="dim">No edge</span></div>`;
  const [label, cls] = SEC[b.section] || SEC.bet;
  const why = b.section === "bet" ? (b.stake ? `$${b.stake}` : `$0 (${b.capped || "cap"})`) : b.section === "held" ? `held: ${b.held}` : b.section === "recheck" ? "gap too big to trust" : "no sportsbook odds yet";
  return `<div><div class="k">Bet</div><span class="pill ${cls}">${label}</span> <span style="font-size:13px">${b.label} ${odds(b.odds)}</span>` +
    `<div class="s">${cPct(b.ev)} edge · ${why}</div></div>`;
}
function cover(g, pick) {
  if (!g.final) return "";
  return `<div class="cover"><b>GAME FINISHED</b><div style="font-size:12.5px;color:#c9c9cf">${g.away} ${g.awayScore ?? ""} – ${g.home} ${g.homeScore ?? ""}` +
    (pick && pick.result ? ` · Model pick ${pick.label} <span class="${pick.result === "won" ? "g" : pick.result === "lost" ? "r" : "dim"}">${pick.result}</span>` : "") + `</div></div>`;
}
const order = (a, b) => (a.final - b.final) || (a.started - b.started) || (new Date(a.kickoff) - new Date(b.kickoff));

// ---------- Game Lines ----------
function renderLines() {
  $("lines").innerHTML = [...S.games].sort(order).map((g, i) => {
    const m = g.model, p = g.poly || {}, b = g.books || {};
    const win = m && m.homeWinPct != null ? (m.homeWinPct >= 50 ? `${g.home} ${m.homeWinPct.toFixed(1)}%` : `${g.away} ${(100 - m.homeWinPct).toFixed(1)}%`) : "";
    const live = !g.started && p.spread ? '<span class="live"></span>' : "";
    return `<div class="card${g.final ? " fin" : ""}"><div class="inner">${headButtons(g, "l" + i)}<div class="f">` +
      `<div><div class="k">Books</div>${b.spread ? `${g.home} ${sgn(b.spread.homeSpread)} ${odds(b.spread.home.odds)}<div class="s">no-vig ${g.home} ${odds(toAmerican(b.spread.home.fair))} / ${g.away} ${odds(toAmerican(b.spread.away.fair))}</div>` : dash}</div>` +
      `<div><div class="k">Model</div>${m ? `${g.home} ${sgn(+(-m.homeMargin).toFixed(1))}<div class="s">${win} to win</div>` : dash}</div>` +
      `<div><div class="k">Polymarket</div>${p.spread ? `${live}${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAmerican(p.spread.home))}` +
        `<div class="s">${g.away} ${sgn(-p.spread.homeSpread)} ${odds(toAmerican(p.spread.away))}${p.ml ? ` · ML ${g.away} ${odds(toAmerican(p.ml.away))} / ${g.home} ${odds(toAmerican(p.ml.home))}` : ""}</div>` : dash}</div>` +
      pickCell(g.spreadPick, g) + `</div>${betCell(g, ["spread", "ml"])}</div>${cover(g, g.spreadPick)}</div>`;
  }).join("");
}
// ---------- Totals ----------
function renderTotals() {
  $("totals").innerHTML = [...S.games].sort(order).map((g, i) => {
    const m = g.model, p = g.poly || {}, b = g.books || {};
    const wind = m && m.outdoor && m.wind != null ? `wind ${m.wind} mph` : g.outdoor ? "outdoor" : "dome / roof";
    const live = !g.started && p.total ? '<span class="live"></span>' : "";
    return `<div class="card${g.final ? " fin" : ""}"><div class="inner">${headButtons(g, "t" + i)}<div class="f">` +
      `<div><div class="k">Books</div>${b.total ? `${b.total.line}<div class="s">O ${odds(b.total.over.odds)} · U ${odds(b.total.under.odds)}</div>` : dash}</div>` +
      `<div><div class="k">Model</div>${m ? `${Number(m.total).toFixed(1)}<div class="s">${wind}</div>` : dash}</div>` +
      `<div><div class="k">Polymarket</div>${p.total ? `${live}${p.total.line}<div class="s">O ${odds(toAmerican(p.total.over))} · U ${odds(toAmerican(p.total.under))}</div>` : dash}</div>` +
      pickCell(g.totalPick, g) + `</div>${betCell(g, ["total"])}</div>${cover(g, g.totalPick)}</div>`;
  }).join("");
}
// ---------- Anytime TD ----------
const PRICE_CLS = { Underpriced: "g", Fair: "y", Overpriced: "r" };
const PRICE_WORD = { Underpriced: "Good price", Fair: "Fair price", Overpriced: "Bad price" };
const GAME_STATUS = /out|doubtful|questionable/i;
const ORDINAL = (n) => (n === 1 ? "Most likely to score" : n === 2 ? "Very likely to score" : n === 3 ? "Least likely to score" : n === 4 ? "Unlikely to score" : "Very unlikely to score");
function prow(r, g, showGame) {
  const inj = r.injury && GAME_STATUS.test(r.injury) ? ` <span class="pill ${/out|doubt/i.test(r.injury) ? "p-r" : "p-y"}" style="padding:0 6px;font-size:10px">${esc(r.injury)}</span>` : "";
  const cls = r.ev == null ? "" : PRICE_CLS[r.priceLabel];
  const price = r.odds == null ? dash : `<span class="price-link" data-market="${esc(r.market || (r.stale ? "Old screenshot price — not live" : ""))}">${odds(r.odds)}</span>`;
  const verdict = r.ev == null ? '<span class="dim">no Polymarket price</span>' : `<span class="${cls}">${PRICE_WORD[r.priceLabel]} against &#8594; Polymarket${r.stale ? " (old)" : ""}</span>`;
  const snap = r.snap ? ` · snaps ${r.snap.pct}%${r.snap.trend === "up" ? ' <span class="g">↑</span>' : r.snap.trend === "down" ? ' <span class="r">↓ role shrinking</span>' : ""}` : "";
  const sub = `${showGame ? `${r.team} · ${r.game} · ` : ""}#${r.teamRank} on team${snap}`;
  const rank = `${ORDINAL(r.teamRank)}${r.fair != null ? ` — model reads ${r.fair.toFixed(1)}% chance` : ""}`;
  const flags = (r.flags || []).map((f) => `<div class="y" style="font-size:11.5px">⚠ ${esc(f)}</div>`).join("");
  return `<div class="prow"><div><b style="font-weight:600">${r.player}</b><span class="pos">${r.pos}</span>${inj}<div class="s">${sub}</div></div>` +
    `<div class="n"><span class="${cls}">Model ${r.fairOdds != null ? odds(r.fairOdds) : dash}</span></div>` +
    `<div class="n">${price}<div class="s">${verdict}</div></div>` +
    `<div class="why">${rank}${flags}</div></div>`;
}
const usable = (r) => !(r.odds != null && r.odds <= -600);   // drop broken/illiquid prices (-600 or shorter)
function tdCard(g, id) {
  const p = g.poly || {}, hs = p.spread ? p.spread.homeSpread : null, tot = p.total ? p.total.line : null;
  const lines = hs != null && tot != null ? ` · ${g.home} ${sgn(hs)} · O/U ${tot}` : "";
  const implied = (team) => (hs == null || tot == null ? "" : `implied ${(team === g.home ? tot / 2 - hs / 2 : tot / 2 + hs / 2).toFixed(1)} pts`);
  const n = tdSort === "game2" ? 2 : tdSort === "game1" ? 1 : 99;
  const side = (team) => { const rows = (g.td || []).filter((r) => r.team === team && r.fair != null && usable(r)).sort((a, b) => b.fair - a.fair).slice(0, n);
    return `<div><div class="sh" style="color:#c9c9cf">${team} <span class="s" style="font-weight:400">${implied(team)}</span></div>${rows.map((r) => prow(r, g, false)).join("") || '<div class="s">No players yet — tap ▶ Rerun model.</div>'}</div>`; };
  return `<div class="card${g.final ? " fin" : ""}" style="margin-top:10px"><div class="inner">${headButtons(g, id, lines)}<div class="teams">${side(g.away)}${side(g.home)}</div></div>${cover(g, null)}</div>`;
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
  $("record-mine").innerHTML = `<div class="card" style="margin-top:10px">` +
    `<div class="sec"><div class="sh">Open bets</div>${open.map(betRow).join("") || '<div class="s">No open bets.</div>'}</div>` +
    `<div class="sec"><div class="sh">Expected returns</div>` +
    `<div class="row"><span class="dim">If everything hits</span><span>${money(s.maxPayout)} (${cMoney(s.maxPayout - s.openCost)})</span></div>` +
    `<div class="row"><span class="dim">Expected · market</span><span>${money(s.expMarket)} (${cMoney(s.expMarket - s.openCost)})</span></div>` +
    `<div class="row"><span class="dim">Expected · your model</span><span>${s.modelCovered ? `${money(s.expModel)} (${cMoney(s.expModel - s.expModelCost)})` : "—"}</span></div></div>` +
    `<div class="fold" data-drop="settled"><span>Settled bets${done.length ? ` · ${cMoney(settledPl)}` : ""}</span><span>▾</span></div>` +
    `<div class="drop" id="settled">${done.map(betRow).join("") || '<div class="s">Nothing settled yet — bets grade automatically when games go final.</div>'}</div></div>` +
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
  const tiers = ["strong", "moderate", "weak", "none"].map((t) => {
    const a = pick("spread", res).filter((x) => x.tier === t), b = pick("total", res).filter((x) => x.tier === t);
    return a.length || b.length ? `<div class="row"><span class="dim">${TIER[t] || t}</span><span>Spreads ${rec(a)} · Totals ${rec(b)}</span></div>` : "";
  }).join("");
  const tdAll = res.flatMap((r) => r.td || []);
  const buckets = [[10, 20], [20, 30], [30, 40], [40, 50], [50, 101]].map(([lo, hi]) => {
    const xs = tdAll.filter((p) => p.fair >= lo && p.fair < hi); if (!xs.length) return "";
    const rate = xs.filter((p) => p.scored).length / xs.length * 100, mid = xs.reduce((a, p) => a + p.fair, 0) / xs.length;
    const verdict = xs.length < 20 ? '<span class="dim">small sample</span>' : Math.abs(rate - mid) <= 5 ? '<span class="g">on target</span>' : rate < mid ? '<span class="r">too high</span>' : '<span class="y">too low</span>';
    return `<div class="row"><span class="dim">Said ${lo}–${hi > 100 ? "+" : hi}%</span><span>scored ${rate.toFixed(0)}% of ${xs.length} · ${verdict}</span></div>`;
  }).join("");
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
    (wk.length ? `<div class="row"><span class="dim">Spreads · Totals · Moneyline</span><span>${rec(pick("spread", wk))} · ${rec(pick("total", wk))} · ${rec(pick("ml", wk))}</span></div>` : '<div class="s">No finished games graded yet.</div>') +
    `<div class="row"><span class="dim">Week ${S.week} loaded</span><span>${wc.games} games · lines ${wc.withLines}/${wc.games} · model ${wc.modelRun ? '<span class="g">✓</span>' : '<span class="y">not run yet</span>'}</span></div></div>` +
    `<div class="sec"><div class="sh">Season record</div>${tiers || '<div class="s">No graded picks yet.</div>'}` +
    `<div class="row"><span class="dim">Moneyline</span><span>${rec(pick("ml", res))}</span></div>` +
    `<div class="row"><span class="dim">Blend (logged)</span><span>Spreads ${rec(pick("blendSpread", res))} · Totals ${rec(pick("blendTotal", res))}</span></div></div>` +
    `<div class="sec"><div class="sh">TD model check</div>${buckets || '<div class="s">Fills in as games go final.</div>'}</div>` +
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
