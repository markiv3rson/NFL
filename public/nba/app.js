// NBA Slate — front end. The NFL app's current layout (10/15), NBA data only.
// Data (merged site: every NBA route lives under /api/nba): /api/slate (Polymarket lines + model + cards + parlays), /api/models, /api/mybets, /api/modelbets, /api/alerts.
let S = null, TEAMS = {}, DETAIL = null, LASTY = 0, MODELS = null, BETS = null, MODELBETS = null, FUT = null, MBDAY = null;
const $ = (id) => document.getElementById(id);
const dash = '<span class="dim">—</span>';
const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const sgn = (n) => (n > 0 ? "+" : "") + n;
const odds = (o) => (o == null ? "—" : (o > 0 ? "+" : "") + o);
const toAm = (p) => { if (!(p > 0 && p < 1)) return null; return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p); };
const cents = (p) => (p > 0 && p < 1 ? Math.round(p * 100) + "¢" : "—");
const money = (v) => (v == null ? "—" : (v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(2));
const cMoney = (v) => (v == null ? "—" : `<span class="${v >= 0 ? "g" : "r"}">${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}</span>`);
const tm = (iso) => (!iso || isNaN(new Date(iso)) ? "TBD" : new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }));
const hm = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const clock = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");
const dayName = (d) => (d ? new Date(d + "T12:00:00").toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function toast(msg, ms = 7000) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._h); if (ms) toast._h = setTimeout(() => t.classList.remove("show"), ms); }
const REDUCE = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();
// Computer or phone: a wide screen with a mouse marks the page html.desktop (the stylesheet lines the bars up with the content column there);
// a phone, or a narrow window, keeps the phone layout exactly as it is. Re-checked when the window changes.
const DESK_Q = "(min-width: 760px) and (pointer: fine)";
function markDesktop() { try { const on = matchMedia(DESK_Q).matches; document.documentElement.classList.toggle("desktop", on); return on; } catch { return false; } }
markDesktop(); try { matchMedia(DESK_Q).addEventListener("change", markDesktop); } catch {}
const started = (g) => Date.now() >= Date.parse(g.start);
const logoUrl = (a) => (TEAMS[a] ? TEAMS[a].logo : "");
const tlogo = (a) => (a ? `<img class="tlogo" src="${esc(logoUrl(a))}" alt="" onerror="this.style.display='none'">` : "");
const teamColor = (a) => (TEAMS[a] && TEAMS[a].bright) || "#444";
const pmLogo = () => '<span class="pm"><img src="https://polymarket.com/favicon.ico" alt="" onerror="this.parentNode.textContent=\'P\'"></span>';
const recOf = (g, t) => { const c = g.context && g.context[t === g.home ? "home" : "away"]; if (!c) return ""; const w = c.gp ? Math.round(c.win_pct * c.gp) : 0; return `<small class="rec">${w}–${(c.gp || 0) - w}</small>`; };
const mktWin = (g) => { const m = g.poly && g.poly.ml; if (!m) return null; return { away: m.midAway / (m.midAway + m.midHome), home: m.midHome / (m.midAway + m.midHome) }; };
// colors by win rate (owner 10/15): green 56%+, light green 53-55%, yellow below
const clsOf = (hit) => (hit >= 56 ? "g" : hit >= 53 ? "lg" : "y");
const hitTxt = (hit, cls) => `${cls === "g" ? Math.round(hit) : Math.floor(hit)}%`;
const glowOf = (p) => (p >= 0.61 ? 1 : p >= 0.58 ? 0.75 : 0.45);
const ptsWord = (n) => (n === 0 ? "main" : `${n} pt${n === 1 ? "" : "s"}`);

// ---------- casino look (same as the NFL app): slot-reel numbers, coins, stamps
function rollReels(root) {
  if (!root || !root.querySelectorAll || REDUCE) return;
  root.querySelectorAll(".reelpct[data-v]").forEach((el) => {
    const v = el.dataset.v; el.innerHTML = "";
    [...v].forEach((ch, i) => { const d = document.createElement("span"); d.className = "rd";
      if (!/\d/.test(ch)) { d.innerHTML = `<span><b>${ch}</b></span>`; el.appendChild(d); return; }
      const seq = []; for (let k = 0; k < 16 + i * 6; k++) seq.push(k % 10); seq.push(+ch);
      d.innerHTML = `<span>${seq.map((x) => `<b>${x}</b>`).join("")}</span>`; el.appendChild(d);
      const inner = d.firstChild; requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transform = `translateY(-${(seq.length - 1) * 1.25}em)`; })); });
    setTimeout(() => { if (el.parentNode && el.dataset.keep == null && el.replaceWith) el.replaceWith(document.createTextNode(v)); else el.textContent = v; }, 1700);
  });
}
const SLOT_SKIP = ".reelpct,.cdn,.stamp,.mreel,script,style,input,textarea,select,svg,.lever";
function slotify(root, max = 250) {
  if (REDUCE || !root || !document.createTreeWalker) return;
  const walk = document.createTreeWalker(root, 4), nodes = [];
  while (walk.nextNode()) { const n = walk.currentNode; if (/\d/.test(n.nodeValue) && n.parentElement && !n.parentElement.closest(SLOT_SKIP)) nodes.push(n); }
  let used = 0;
  for (const n of nodes) {
    if (used >= max) break;
    const parts = n.nodeValue.split(/(\d+(?:\.\d+)?)/); if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    parts.forEach((t, i) => { if (i % 2 && used < max) { const sp = document.createElement("span"); sp.className = "reelpct"; sp.dataset.v = t; sp.textContent = t; frag.appendChild(sp); used++; } else frag.appendChild(document.createTextNode(t)); });
    n.parentNode.replaceChild(frag, n);
  }
  rollReels(root);
}
function coinBurst(el) {
  if (REDUCE || !el || !el.getBoundingClientRect) return;
  const e = el.getBoundingClientRect(), cv = document.createElement("canvas"); cv.className = "coinfx"; document.body.appendChild(cv);
  const W = innerWidth, H = innerHeight, dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; const cx = cv.getContext("2d"); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const P = Array.from({ length: 30 }, () => ({ x: e.left + e.width / 2, y: e.top + e.height / 2, vx: (Math.random() - .5) * 8, vy: -Math.random() * 7 - 2, s: 4 + Math.random() * 4 })); let t = 0;
  (function f() { cx.clearRect(0, 0, W, H); P.forEach((q) => { q.x += q.vx; q.y += q.vy; q.vy += .35; cx.fillStyle = "#ffcf4a"; cx.beginPath(); cx.ellipse(q.x, q.y, q.s, q.s * Math.abs(Math.cos(t / 4 + q.s)), 0, 0, 7); cx.fill(); });
    if (++t < 60) requestAnimationFrame(f); else cv.remove(); })();
}
function playStamps() {
  try { if (!$("panel-record").classList.contains("on")) return; } catch { return; }
  let seen = []; try { seen = JSON.parse(localStorage.getItem("stampSeen") || "[]"); } catch {}
  const set = new Set(seen); let added = false;
  document.querySelectorAll("#record-mine .stamp[data-sid]").forEach((st) => { const id = st.dataset.sid; if (set.has(id)) return;
    set.add(id); added = true; st.classList.add("go"); if (st.classList.contains("hit")) setTimeout(() => coinBurst(st), 250); });
  if (added) { try { localStorage.setItem("stampSeen", JSON.stringify([...set].slice(-500))); } catch {} }
}

// ---------- header: dates line, countdown, lever (reruns lines + model)
function weekline() {
  const dates = [...new Set(S.games.map((g) => g.date))].sort(), f = (d) => new Date(d + "T12:00:00").toLocaleString(undefined, { month: "short", day: "numeric" });
  const range = !dates.length ? "" : dates.length === 1 ? f(dates[0]) : `${f(dates[0])}–${new Date(dates[dates.length - 1] + "T12:00:00").getDate()}`;
  const live = S.games.some((g) => !started(g) && g.poly), pre = S.games.some((g) => g.preseason);
  if ($("hero-wk")) $("hero-wk").textContent = `${live ? "Lines live · " : ""}${pre ? "Preseason · " : ""}${range || "No games"}`.toUpperCase();
  const hu = $("hero-upd"); if (!hu) return; const detail = `Lines + model ${clock(S.now)} · injuries ${clock(S.injuriesUpdated)} · fitted through ${S.fitThrough || "—"}`;
  hu.textContent = `Model ${clock(S.now)} ›`; hu.onclick = () => toast(detail, 8000);
}
function tickCd() {   // 10/17 (merged site): the header shows [away logo] vs [home logo] · NEXT GAME · clock
  clearTimeout(tickCd._h);
  if (!S) return;
  const nxt = S.games.filter((g) => !started(g)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (!nxt) { Shell.setNext(null); tickCd._cur = null; }
  else Shell.setNext(logoUrl(nxt.away), logoUrl(nxt.home), Date.parse(nxt.start) - Date.now());
  if (nxt && tickCd._cur && tickCd._cur !== nxt.key && Date.now() - (tickCd._last || 0) > 15000) { tickCd._last = Date.now(); setTimeout(() => loadSlate().catch(() => {}), 4000); }
  tickCd._cur = nxt ? nxt.key : null;
  tickCd._h = setTimeout(tickCd, 1000);
}
let REFRESHING = false;
async function rerunModel() {
  if (REFRESHING) return; REFRESHING = true; toast("Rerunning the model…", 0);
  try { const d = await (await fetch("/api/nba/snapshot", { cache: "no-store" })).json(); if (!d.ok) throw new Error(d.error); await loadSlate();
    toast(d.modelOk ? `Model updated: ${plural(d.games, "game")}.` : "Lines refreshed; the model service did not answer.", 7000);
  } catch (e) { toast("Rerun failed: " + e.message, 12000); }
  REFRESHING = false;
}
if ($("lever")) {
  const lv = $("lever");
  const pull = async () => {
    if (lv.disabled || REFRESHING) return; lv.disabled = true; lv.classList.add("pull"); setTimeout(() => lv.classList.remove("pull"), 260);
    const hu = $("hero-upd"); hu.innerHTML = `Model <span class="mreel">7</span><span class="mreel">7</span>:<span class="mreel">7</span><span class="mreel">7</span>`;
    const iv = setInterval(() => hu.querySelectorAll(".mreel").forEach((m) => { m.textContent = Math.floor(Math.random() * 10); }), 70);
    try { await rerunModel(); } finally { clearInterval(iv); if (S) weekline(); lv.disabled = false; }
  };
  lv.onclick = pull; let y0 = null;
  lv.addEventListener("pointerdown", (e) => { y0 = e.clientY; }); lv.addEventListener("pointermove", (e) => { if (y0 != null && e.clientY - y0 > 25) { y0 = null; pull(); } }); lv.addEventListener("pointerup", () => { y0 = null; });
}

// ---------- the card's picks (lib/cardpick.js output on each game)
const okN = (x) => typeof x === "number" && isFinite(x);
const okPick = (x) => !!x && typeof x === "object" && typeof x.pick === "string" && okN(x.hit);
function cardOf(g, kind) {
  const c = g && g.card && typeof g.card === "object" ? g.card[kind] : null;
  if (!c || typeof c !== "object") return null;
  const price = (x) => (okN(x.price) && x.price > 0 && x.price < 1 ? x.price : null);
  const fix = (x) => ({ ...x, price: price(x) });
  const rows = (Array.isArray(c.rows) ? c.rows : []).filter((r) => okPick(r) && okN(r.points) && okN(r.price) && r.price > 0 && r.price < 1).map(fix);
  if (!okPick(c.plain) && !rows.length) return null;
  return { ...c, plain: okPick(c.plain) ? fix(c.plain) : null, pts: okPick(c.pts) && okN(c.pts.points) ? fix(c.pts) : null, rows, test: !!(g.card && g.card.test) };
}
// straight green picks of a game: the card's PICK at Polymarket's own line + the moneyline PICK, 56%+ (win rate decides)
function greenPicks(g) {
  if (!g || g.inProgress || g.preseason) return [];
  const out = [];
  for (const k of ["spread", "total"]) { const C = cardOf(g, k); if (C && C.plain && C.plain.hit >= 56) out.push({ pick: C.plain.pick, p: C.plain.hit / 100, market: k, price: C.plain.price, why: C.plain.why || "" }); }
  const ml = g.ml && g.ml.pick; if (ml && (ml.tier === "pick" || ml.tier === "lean") && ml.pct >= 56) out.push({ pick: ml.label, p: ml.pct / 100, market: "ml", price: g.poly && g.poly.ml ? g.poly.ml[ml.team === g.home ? "home" : "away"] : null, why: "" });
  return out.sort((a, b) => b.p - a.p);
}

// ---------- Game Lines: line-move chips, tiles
let LAST_SEEN = null; try { LAST_SEEN = localStorage.getItem("lastSeen"); } catch {}
function changedBox() {
  const out = [];
  for (const g of S.games.filter((x) => !x.inProgress && x.move)) {
    const bits = [];
    if (g.move.spread) bits.push(`spread ${g.home} ${sgn(g.move.spread.open)} → ${sgn(g.move.spread.now)}`);
    if (g.move.total) bits.push(`total ${g.move.total.open} → ${g.move.total.now}`);
    if (bits.length) out.push(`<span class="mv" data-game="${esc(g.key)}"><b>${esc(g.key)}</b> ${bits.map(esc).join(" · ")}</span>`);
  }
  if (!out.length) return "";
  return `<div class="moves"><div class="mvl">LINE MOVES <span>since the first line seen</span></div><div class="mvs">${out.join("")}</div></div>`;
}
// Live scores (10/17): ESPN's scoreboard via /api/nba/live -- a started game shows its score + clock, a finished one its final score
// (before, a game counted as "live" from tip-off until the slate dropped it, so last night's games stayed LIVE).
let NBL = {};
const scOf = (g) => (g.inProgress ? NBL[g.key] || null : null), isFinal = (g) => { const sc = scOf(g); return !!(sc && sc.st === "post"); };
async function loadLiveScores() {
  if (!S || !S.games.some((g) => g.inProgress)) return;
  try { const d = await (await fetch("/api/nba/live", { cache: "no-store" })).json(); if (d && d.ok) { NBL = d.scores || {}; if ($("panel-lines").classList.contains("on") && !DETAIL) renderLines(); } } catch {}
}
function tile(g) {
  const sc = scOf(g), fin = isFinal(g), live = g.inProgress && !fin;
  const hp0 = mktWin(g), hp = hp0 ? hp0.home * 100 : null, ap = hp == null ? null : 100 - hp;
  const lead = (v, o) => (v >= o ? "mkt" : "dim");
  const green = greenPicks(g)[0];
  const chips = [g.preseason ? '<span class="chip c-amb">PRESEASON</span>' : "", green ? `<span class="chip c-grn">${esc(green.pick)}</span>` : "", live && !sc ? '<span class="chip c-red">LIVE</span>' : ""].filter(Boolean).join('<span style="display:inline-block;width:6px"></span>');
  const mid0 = hp == null ? '<span class="mid dim">—</span>' : `<span class="mid"><span class="${lead(ap, hp)}">${Math.round(ap)}</span><span class="dim"> · </span><span class="${lead(hp, ap)}">${100 - Math.round(ap)}</span><span class="dim" style="font-size:11px">%</span></span>`;
  const mid = sc && (sc.st === "in" || sc.st === "post") ? `<span class="mid lvmid"><span class="sr"><span class="${sc.a > sc.h ? "g" : "dim"}">${sc.a}</span><span class="dim"> – </span><span class="${sc.h > sc.a ? "g" : "dim"}">${sc.h}</span></span><span class="lv ${fin ? "dim" : "r"}">${fin ? "FINAL" : "● LIVE · " + esc(sc.lbl)}</span></span>` : mid0;
  const foot = live ? "In progress" : tm(g.start);
  return `<button class="tile${live ? " live" : ""}" data-game="${esc(g.key)}"><img class="wmk l" loading="lazy" decoding="async" src="${esc(logoUrl(g.away))}" alt="" onerror="this.style.display='none'"><img class="wmk r" loading="lazy" decoding="async" src="${esc(logoUrl(g.home))}" alt="" onerror="this.style.display='none'">` +
    `<div class="in"><div class="nm"><span class="t">${g.away}${recOf(g, g.away)}</span>${mid}<span class="t hm">${g.home}${recOf(g, g.home)}</span></div><div class="ft"><span>${foot}</span><span>${chips}</span></div>${hp == null || sc ? "" : `<div class="bar"><i style="width:${ap}%"></i></div>`}</div></button>`;
}
function renderLines() {
  if (!S) { $("lines").innerHTML = '<div class="s dim center">Loading…</div>'; return; }
  if (DETAIL) { const g = S.games.find((x) => x.key === DETAIL); if (g) return renderDetail(g); DETAIL = null; }
  setBg(null); linesBg();
  $("detail").style.display = "none"; $("lines").style.display = "";
  $("lines").innerHTML = changedBox() + (S.games.length ? linesByDay() : '<div class="tiles"><div class="s dim">No NBA games on Polymarket right now.</div></div>');
}
// 10/17 (owner: "make everything consistent"): Game Lines stacked one game per row under a header per day with its tip times, like NFL's time slots
const tipTime = (iso) => (!iso || isNaN(new Date(iso)) ? "TBD" : new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
function linesByDay() {
  const days = [], by = {};
  for (const g of [...S.games].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0))) { const d = g.date || "TBD"; if (!by[d]) { by[d] = []; days.push(d); } by[d].push(g); }
  return days.map((d) => { const times = [...new Set(by[d].filter((g) => g.start).map((g) => tipTime(g.start)))];
    return `<div class="sh labslot">${esc(dayName(d).toUpperCase())}${times.length ? ` <span class="lst">· ${times.map(esc).join(" · ")}</span>` : ""}</div><div class="tiles stack">${by[d].map(tile).join("")}</div>`; }).join("");
}
// Model bets headers inside a day (Eastern tip time): EARLY before 7 PM, NIGHT 7-9:59 PM, LATE 10 PM on
function nbaSlot(iso) { const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(new Date(iso))); return h < 19 ? "EARLY GAMES" : h < 22 ? "NIGHT GAMES" : "LATE GAMES"; }

// ---------- the game page: MONEYLINE / SPREAD / TOTALS, each MARKET left, MODEL right
function startsIn(g) {
  const ms = Date.parse(g.start) - Date.now(); if (!(ms > 0)) return "";
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `starts in ${d}d ${h}h` : h ? `starts in ${h}h ${m}m` : `starts in ${m}m`;
}
function setBg(g) {
  const el = document.getElementById("bgwm"); if (!el) return;
  if (!g) { el.style.background = ""; el.innerHTML = ""; el.dataset.k = ""; return; }
  const k = g.away + g.home; if (el.dataset.k === k) return; el.dataset.k = k;
  const ca = teamColor(g.away), ch = teamColor(g.home);
  el.style.background = `linear-gradient(90deg, ${ca}3d 0%, ${ca}1f 50%, ${ch}1f 50%, ${ch}3d 100%)`;
  el.innerHTML = `<img src="${esc(logoUrl(g.away))}" alt="" onerror="this.style.display='none'"><img src="${esc(logoUrl(g.home))}" alt="" onerror="this.style.display='none'">`;
}
function detailTop(g) {
  const w = mktWin(g), ap = w ? Math.round(w.away * 100) : null, hr = ap == null ? null : 100 - ap;
  const st = g.inProgress ? '<span class="r">Live · locked</span>' : startsIn(g);
  const ca = teamColor(g.away), ch = teamColor(g.home), badge = g.inProgress ? '<span class="chip c-red">LIVE</span>' : g.preseason ? '<span class="chip c-amb">PRESEASON</span>' : "";
  return `<div class="card dtop" style="background:linear-gradient(90deg,${ca}40 0%,${ca}14 50%,${ch}14 50%,${ch}40 100%),var(--card)"><img class="dwm l" src="${esc(logoUrl(g.away))}" alt="" onerror="this.style.display='none'"><img class="dwm r" src="${esc(logoUrl(g.home))}" alt="" onerror="this.style.display='none'"><div class="inner"><div class="nm"><span class="t">${tlogo(g.away)}${g.away}${recOf(g, g.away)}</span>` +
    `<div class="mid">${badge}<div class="s2">${tm(g.start)}</div><div class="s3">${st}</div></div><span class="t hm">${g.home}${tlogo(g.home)}${recOf(g, g.home)}</span></div>` +
    (w ? `<div class="wc"><div class="wl"><b class="mkt">${ap}%</b><span class="mkt">MARKET’S WIN CHANCE</span><span class="dim">${hr}%</span></div><div class="bar"><i style="width:${ap}%"></i></div></div>` : "") + `</div></div>`;
}
const row = (k, v, c, mt) => `<div class="prl${mt ? " mt" : ""}"><span class="s">${k}</span><span class="${c || ""}">${v}</span></div>`;
// 10/16 (the NFL app's game page, ported): the section title sits on its own row outside the card with the Injuries pill next to it; inside the card
// MARKET = SPORTSBOOKS | POLYMARKET side by side, MODEL below it full width (no box); the injuries drop-down opens at the top of the card
const secRow = (title, pills = "") => `<div class="trow"><div class="sh">${title}</div>${pills}</div>`;
function moreBox(inner) { return inner ? `<details class="more" style="margin-top:6px"><summary class="dim" style="font-size:12px;cursor:pointer">More</summary>${inner}</details>` : ""; }
// spread / total card: Model + PICK on top; PICK w/ POINTS and the one list (both teams, 0 / 1 / 2 points) under MORE; only the chosen row is green
function cardBody(g, kind, C) {
  const x = C.plain, p = C.pts, TEST = C.test;
  let l1;
  if (x) { const c1 = clsOf(x.hit), tx = hitTxt(x.hit, c1), lab = TEST ? "TEST" : "PICK";
    l1 = TEST ? `<b style="font-size:13px;color:#b9a8ff">${lab}: ${esc(x.pick)} · ${tx}</b>`
      : c1 === "g" ? `<b class="g pulse" style="--gl:${glowOf(x.hit / 100)};font-size:13px">PICK: ${esc(x.pick)} · <span class="reelpct" data-v="${tx}">${tx}</span></b>` : `<b class="${c1}" style="font-size:13px">PICK: ${esc(x.pick)} · ${tx}</b>`; }
  else l1 = `<b class="dim" style="font-size:13px">No pick</b>`;
  const why = x && x.why ? `<div class="s" style="margin-top:2px">${esc(x.why)}</div>` : "";
  let l2;
  if (p) { const c2 = clsOf(p.hit); l2 = `<b class="${TEST ? "" : c2}" style="font-size:13px${TEST ? ";color:#b9a8ff" : ""}">${TEST ? "TEST" : "PICK"} w/ POINTS: ${esc(p.pick)} · ${hitTxt(p.hit, c2)}</b>`; }
  else l2 = `<span class="dim" style="font-size:13px">PICK w/ POINTS: none</span>`;
  const grp = (r) => r.team || (r.side === "over" ? "Over" : "Under"), first = x ? x.team || (x.side === "over" ? "Over" : "Under") : null;
  const names = [...new Set(C.rows.map(grp))].sort((a, b) => (a === first ? -1 : 0) - (b === first ? -1 : 0));
  const rows = names.map((nm, i) => `<div style="margin-top:${i ? 8 : 2}px">` + C.rows.filter((r) => grp(r) === nm).map((r) => { const pk = !!(p && r.pick === p.pick);
    return `<div class="s${pk && !TEST ? " g" : ""}" style="margin-top:2px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.pick)} · ${ptsWord(r.points)} · ${hitTxt(r.hit, pk ? "g" : "lg")} · ${Math.round(r.price * 100)}¢</div>`; }).join("") + "</div>").join("");
  return `<div style="margin-top:6px">${l1}</div>${why}` + moreBox(`<div style="margin-top:4px">${l2}</div>` + (rows ? `<div style="margin-top:6px">${rows}</div>` : ""));
}
function lockedBody(g, kind) {   // after tip-off: the picks saved before it, with W / L once graded
  const L = g.locked && g.locked[kind]; if (!L) return `<div style="margin-top:6px"><b class="dim" style="font-size:13px">Game in progress</b></div>`;
  const rs = (x) => (x.result === "win" ? ' · <span class="g">W</span>' : x.result === "loss" ? ' · <span class="r">L</span>' : x.result === "push" ? " · push" : x.result === "void" ? ' · <span class="dim">void</span>' : ' · <span class="dim">live</span>');
  return (L.plain ? `<div style="margin-top:6px"><b class="${clsOf(L.plain.pct)}" style="font-size:13px">PICK: ${esc(L.plain.label)} · ${hitTxt(L.plain.pct, clsOf(L.plain.pct))}</b>${rs(L.plain)}</div>` : "") +
    (L.pts ? `<div style="margin-top:4px"><b style="font-size:13px">PICK w/ POINTS: ${esc(L.pts.label)} · ${Math.floor(L.pts.pct)}%</b>${rs(L.pts)}</div>` : "");
}
function modelCell(g, kind) {
  const m = g.model, k = g[kind];
  const wrap = (inner) => `<div class="modelcell">${inner}</div>`;
  if (!m || !k) return wrap(dash);
  const H = g.home, A = g.away;
  const line = kind === "total" ? `Model: <b class="mod">${m.total.toFixed(1)}</b>` : kind === "spread" ? `Model: <b class="mod">${m.margin >= 0 ? H : A} by ${Math.abs(m.margin).toFixed(1)}</b>`
    : `Model: <b class="mod">${k.side} ${Math.max(k.modelWinPct[H], k.modelWinPct[A])}%</b>`;
  let body = "";
  if (kind === "ml") {
    const pick = k.pick;
    if (g.inProgress) body = lockedBody(g, "ml");
    else if (pick && (pick.tier === "pick" || pick.tier === "lean")) { const c = clsOf(pick.pct), tx = hitTxt(pick.pct, c);
      body = c === "g" ? `<div style="margin-top:6px"><b class="g pulse" style="--gl:${glowOf(pick.pct / 100)};font-size:13px">PICK: ${esc(pick.label)} · <span class="reelpct" data-v="${tx}">${tx}</span></b></div>` : `<div style="margin-top:6px"><b class="${c}" style="font-size:13px">PICK: ${esc(pick.label)} · ${tx}</b></div>`; }
    else if (pick && pick.tier === "test") body = `<div style="margin-top:6px"><b style="font-size:13px;color:#b9a8ff">TEST: ${esc(pick.label)} · ${pick.pct}%</b></div>`;
    else body = `<div style="margin-top:6px"><b class="dim" style="font-size:13px">No pick</b></div>`;
    if (k.marketWinPct) body += moreBox(`<div class="s" style="font-size:11px">${H} ${k.marketWinPct[H]}% · ${A} ${k.marketWinPct[A]}%</div>`);
  } else {
    const C = g.inProgress ? null : cardOf(g, kind);
    body = g.inProgress ? lockedBody(g, kind) : C ? cardBody(g, kind, C) : `<div style="margin-top:6px"><b class="dim" style="font-size:13px">No pick</b></div>`;
  }
  return wrap(`<div class="s">${line}</div>${body}`);
}
const injList = (g) => { const j = g.injuries || {}; return [...(j.away || []).map((p) => ({ t: g.away, ...p })), ...(j.home || []).map((p) => ({ t: g.home, ...p }))]; };
function injPill(g, id) { const n = injList(g).length; return n ? `<div class="btns"><button class="tag" data-drop="${id}">Injuries ${n} ▾</button></div>` : ""; }
function injDrop(g, id) {
  const inj = injList(g); if (!inj.length) return "";
  return `<div class="drop" id="${id}">` + inj.map((p) => `<div class="drow"><span>${tlogo(p.t)}${esc(p.name)} <span class="dim">· ${esc(p.t)}</span></span><span class="${/out|doubtful/i.test(p.status) ? "r" : "y"}">${esc(p.status)} · ${p.ppg} ppg</span></div>`).join("") + `</div>`;
}
const booksBlock = (g, kind) => {
  const b = g.books && g.books[kind]; if (!b) return `<div><div class="k">SPORTSBOOKS</div>${dash}</div>`;
  const rows = kind === "ml" ? row("Moneyline", `${g.away} ${odds(b.away)}`, "mlc") + row("", `${g.home} ${odds(b.home)}`, "mlc")
    : kind === "spread" ? row("Spread", `${g.home} ${sgn(b.homeSpread)} ${odds(b.home)}`, "mkt") + row("", `${g.away} ${sgn(-b.homeSpread)} ${odds(b.away)}`, "mkt")
    : row(`Over ${b.line}`, odds(b.over), "mkt") + row(`Under ${b.line}`, odds(b.under), "mkt");
  return `<div><div class="k">SPORTSBOOKS</div>${rows}</div>`;
};
function marketCard(g, kind, id) {
  const p = g.poly || {}, live = !g.inProgress ? '<span class="live"></span>' : "";
  const poly = kind === "ml" ? (p.ml ? live + row("Moneyline", `${g.away} ${odds(toAm(p.ml.away))}`, "mlc") + row("", `${g.home} ${odds(toAm(p.ml.home))}`, "mlc") : dash)
    : kind === "spread" ? (p.spread ? live + row("Spread", `${g.home} ${sgn(p.spread.homeSpread)} ${odds(toAm(p.spread.home))}`, "mkt") + row("", `${g.away} ${sgn(-p.spread.homeSpread)} ${odds(toAm(p.spread.away))}`, "mkt") : dash)
    : (p.total ? live + row(`Over ${p.total.line}`, odds(toAm(p.total.over)), "mkt") + row(`Under ${p.total.line}`, odds(toAm(p.total.under)), "mkt") : dash);
  return `<div class="card"><div class="inner">${id ? injDrop(g, id) : ""}<div class="hd">MARKET</div><div class="mk">${booksBlock(g, kind)}<div><div class="k">${pmLogo()}POLYMARKET</div>${poly}</div></div><div class="hd hm">MODEL</div>${modelCell(g, kind)}</div></div>`;
}
// same-game parlays of this game (lib/parlays.js): 2 legs on Polymarket's lines, 2 legs on bought lines
function sgpBox(g) {
  if (g.inProgress || g.preseason || !S.parlays) return "";
  const blocks = S.parlays.filter((p) => p.game === g.key).map((p) => pBlock(esc(PTYPES[p.type] || p.type), p, false)).join("");
  return blocks ? secRow("SAME-GAME PARLAYS") + `<div class="pgrid" style="margin-top:6px">${blocks}</div>` : "";
}
// 10/17 (owner): the NBA photo behind every NBA page (a game page keeps its team colours)
function linesBg() { const p = $("panel-lines"); document.documentElement.classList.toggle("lines-on", !(p && p.classList.contains("on") && DETAIL)); }
function renderDetail(g) {
  $("lines").style.display = "none"; $("detail").style.display = ""; linesBg();
  $("detail").innerHTML = `<button class="back" id="back-btn">← Games</button>${detailTop(g)}` +
    secRow("MONEYLINE", injPill(g, "inj")) + `<div class="grid">${marketCard(g, "ml", "inj")}</div>` +
    secRow("SPREAD") + `<div class="grid">${marketCard(g, "spread")}</div>` +
    secRow("TOTALS") + `<div class="grid">${marketCard(g, "total")}</div>` + sgpBox(g);
  $("back-btn").onclick = closeGame;
  if (ROLL_ON_OPEN) { ROLL_ON_OPEN = false; slotify($("detail")); }
  setBg($("panel-lines").classList.contains("on") ? g : null);
}
let ROLL_ON_OPEN = false;
function openGame(key) { ROLL_ON_OPEN = true; LASTY = window.scrollY || 0; DETAIL = key; renderLines(); window.scrollTo(0, 0); }
function closeGame() { DETAIL = null; renderLines(); window.scrollTo(0, LASTY); }

// ---------- Best bets + Parlay: two gold tickets at the top of the Bets tab (tap one to open its list)
function bestBets() { return S ? S.bestBets || [] : []; }
function parlayPicks() { return S && S.parlay && S.parlay.length >= 2 ? S.parlay : []; }
const legLabel = (x) => `${tlogo(x.team || "")}${esc(x.label)}`;
function ticketRow() {
  const B = bestBets(), P = parlayPicks(); if (!B.length && !P.length) return "";
  const ch = P.length ? Math.round(P.reduce((a, x) => a * (x.pct / 100), 1) * 100) : null;
  const t = (drop, k, big, sub) => `<button class="ticket" data-drop="${drop}"><span class="tk">${k}</span><b class="tb">${big}</b><span class="ts">${sub}</span></button>`;
  const bb = (x) => `<div class="bb"><div class="t1"><b class="g">${legLabel(x)}</b><span style="white-space:nowrap">wins <b class="g">${Math.round(x.pct)}%</b></span></div><div class="t2">${esc(x.game)} · ${tm(x.start)}${x.price ? ` · ${cents(x.price)}` : ""}</div></div>`;
  return `<div class="jrow">${B.length ? t("bestdrop", "BEST BETS", B.length, `green pick${B.length === 1 ? "" : "s"} · tap to open`) : ""}${P.length ? t("parlaydrop", "PARLAY", `${ch}%`, `chance all ${P.length} hit · tap to open`) : ""}</div>` +
    (B.length ? `<div class="drop" id="bestdrop"><div class="card modelglow"><div class="inner">${B.map(bb).join("")}</div></div></div>` : "") +
    (P.length ? `<div class="drop" id="parlaydrop"><div class="card modelglow"><div class="inner">${P.map(bb).join("")}</div></div></div>` : "");
}

// ---------- Bets: My bets | Model bets
let BETSVIEW = (() => { try { return ["model", "props"].includes(localStorage.getItem("betsView")) ? localStorage.getItem("betsView") : "mine"; } catch { return "mine"; } })();
function applyBetsView() {
  const bt = $("bets-title"); if (bt) bt.textContent = BETSVIEW === "model" ? `Model bets · ${(LAB_TABS.find(([k]) => k === LABTYPE) || [, ""])[1]}` : BETSVIEW === "props" ? "Props" : "My bets";
  const m = BETSVIEW === "model", pr = BETSVIEW === "props", set = (id, on) => { const e = $(id); if (e) e.style.display = on ? "" : "none"; };
  set("record-mine", !m && !pr); set("lab", m); set("props", pr);   // 10/17 (owner): the parlay types are menu sub tabs under Model bets (the docked strip is gone)
  document.querySelectorAll("#bets-sw [data-bv]").forEach((b) => b.classList.toggle("on", b.dataset.bv === BETSVIEW));
  if (m) renderLabList();
  if (pr) renderProps();
}
// Props (10/17, owner: the same page as NFL's, both sports): Polymarket US lists no NBA player props yet, so the list is empty until it does
function renderProps() { const el = $("props"); if (el) el.innerHTML = '<div class="s dim" style="margin-top:12px">None yet.</div>'; }
async function loadBets() {
  try { BETS = await (await fetch("/api/nba/mybets", { cache: "no-store" })).json(); } catch { BETS = { ok: false }; }
  try { const d = await (await fetch("/api/nba/modelbets", { cache: "no-store" })).json(); if (d && d.ok) MODELBETS = d; } catch {}
  renderBets(); renderLabList(); setTimeout(playStamps, 50);
}
const stampFor = (e) => (e.result === "win" || e.result === "loss" ? `<span class="stamp ${e.result === "win" ? "hit" : "miss"}" data-sid="${esc(String(e.id || ""))}">${e.result === "win" ? "HIT!" : "MISS"}</span>` : "");
function renderBets() {
  const j = BETS; if (!j || !j.ok) { $("record-mine").innerHTML = ticketRow() + '<div class="card" style="margin-top:10px"><div class="inner"><div class="s dim">Bets unavailable right now.</div></div></div>'; return; }
  $("upd-record").textContent = j.syncedAt ? "Synced " + hm(j.syncedAt) : j.keysSet ? "Not synced yet" : "Polymarket keys not set";
  const rc = j.record || {};
  // 10/17 (owner): a Polymarket combo lists its legs under it like NFL's (✓ / ✗, team logo, won leg green, lost leg red)
  const legRow = (p) => `<div class="s" style="padding:0 0 0 16px">${p.result ? legMark(p.result) + " " : "• "}${legTxt(p.result, `${p.team ? tlogo(p.team) : ""}${esc(p.label)}`)}${p.kind === "total" && p.game ? ` <span class="dim">${gameLogos(p.game)}</span>` : ""}</div>`;
  const betName = (e) => (e.picks && e.picks.length ? `Combo · ${e.picks.length} picks` : `${esc(e.title)}${e.outcome ? ` — ${esc(e.outcome)}` : ""}`);
  const rowsOf = (a, settled) => a.map((e) => `<div class="betwrap"><div class="row"><span>${betName(e)}</span><span>${settled ? (e.result === "win" ? '<span class="g">Won</span>' : e.result === "loss" ? '<span class="r">Lost</span>' : '<span class="y">Sold</span>') + " " + cMoney(e.pl) : e.value != null ? "$" + e.value.toFixed(2) : ""}</span></div>` +
    `${(e.picks || []).map(legRow).join("")}<div class="s" style="padding:0 0 6px 8px">${money(e.cost)}${e.price ? ` at ${Math.round(e.price * 100)}¢` : ""}${e.shares ? ` · ${e.shares} shares` : ""}</div>${stampFor(e)}</div>`).join("");
  const open = [...document.querySelectorAll("#record-mine .drop.open")].map((e) => e.id);
  // 10/17 (owner: "make everything consistent"): a day drop-down like NFL's week drop-down; it picks which settled bets show (open bets always show)
  const dayOf = (e) => { const t = e.closedAt || (e.resolved && e.resolved.t) || (e.sold && e.sold.t); return t ? new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null; };
  const days = [...new Set((j.settled || []).map(dayOf).filter(Boolean))].sort();
  const sel = MBDAY === "all" || days.includes(MBDAY) ? MBDAY : (days[days.length - 1] || "all");
  const settled = (j.settled || []).filter((e) => sel === "all" || dayOf(e) === sel);
  const dayPick = `<div class="wksel"><select id="mb-day" aria-label="Day">${days.map((d) => `<option value="${d}"${sel === d ? " selected" : ""}>${dayName(d)}</option>`).join("")}<option value="all"${sel === "all" ? " selected" : ""}>Season</option></select></div>`;
  $("record-mine").innerHTML = dayPick + ticketRow() + `<div class="stats" style="margin-top:10px"><div class="stat"><div class="k">RECORD</div><div class="v ${rc.pct >= 55 ? "g" : rc.pct >= 50 ? "y" : "r"}">${rc.w || 0}–${rc.l || 0}</div><div class="k2">${rc.pct == null ? "—" : rc.pct + "% won"}</div></div>` +
    `<div class="stat"><div class="k">PROFIT</div><div class="v ${(rc.pl || 0) >= 0 ? "g" : "r"}">${(rc.pl || 0) >= 0 ? "+" : "−"}$${Math.abs(rc.pl || 0).toFixed(2)}</div><div class="k2">settled</div></div>` +
    `<div class="stat"><div class="k">STAKED</div><div class="v">$${(rc.staked || 0).toFixed(2)}</div><div class="k2">settled</div></div></div>` +
    `<div class="card" style="margin-top:10px"><div class="sec"><div class="sh">Open</div>${(j.open || []).length ? rowsOf(j.open, false) : '<div class="s dim">None.</div>'}</div>` +
    `<div class="fold" data-drop="settled"><span>Settled bets</span><span>▾</span></div><div class="drop" id="settled">${settled.length ? rowsOf(settled, true) : '<div class="s dim">None yet.</div>'}</div></div>` +
    `<div class="center"><button class="btn" id="sync-btn">↻ Sync account</button></div>`;
  for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
  const md = $("mb-day"); if (md && md.tagName === "SELECT") md.onchange = () => { MBDAY = md.value; renderBets(); };
  $("sync-btn").onclick = async () => { toast("Syncing…", 0); try { const d = await (await fetch("/api/nba/mybets?sync=1", { cache: "no-store" })).json(); BETS = d; renderBets(); toast(d.sync && d.sync.ok ? `Synced ${d.sync.positions} positions.` : `Sync: ${(d.sync && d.sync.note) || "done"}`); } catch (e) { toast("Sync failed: " + e.message, 10000); } };
}
// Model bets: day tabs at the top, type sub-tabs docked above the bottom bar, one list in tip-off order (lib/parlays.js)
const PTYPES = { sgp: "Same game · 2 legs", sgp_pts: "Same game · bought lines", best4: "Parlay · top 4 picks", fav4: "4 biggest favorites" };
const LAB_TABS = [["sgp", "Same game"], ["sgp_pts", "Bought"], ["best4", "Parlay"], ["fav4", "Favorites"]];
let LABTYPE = "sgp", LABDAY = null;
const plText = (x, st) => `PL: ${x >= 10 ? Math.round(x) : x.toFixed(1)}x<span class="plw"> · $${st} → </span><span class="g">$${Math.round(st * x)}</span>`;
const plPay = (p) => {
  if (!p || !p.legs || !p.legs.length || !p.legs.every((l) => l.price > 0 && l.price < 1)) return "PL: —";
  return plText(p.legs.reduce((a, l) => a / l.price, 1), p.stake || 10);
};
// Real Polymarket price (10/17, owner: "I need this for the nba also", same as the NFL page): every PL line on screen asks Polymarket for a live quote
// of its exact legs by itself (/api/nba/comboquote: asks and closes the request, never buys), one parlay after another, again every 3 minutes, and
// the server's background job keeps them fresh even with no page open. A tap asks again right away. Only before tip-off, 2+ legs.
const PLQ = {}, PLC = {}, PL_FRESH = 180e3;
const plKey = (p) => p.legs.map((l) => [l.game, l.market || l.kind || "", l.team || "", l.side || "", l.line ?? "", l.label].join("|")).sort().join("~") + "|" + (p.stake || 10);
function plQuotable(p) {
  if (!p || p.result || !Array.isArray(p.legs) || p.legs.length < 2) return false;
  const games = (S && S.games) || [], gs = p.legs.map((l) => games.find((g) => g.key === l.game));
  return !gs.some((g) => !g || !g.start || g.inProgress || Date.now() >= new Date(g.start).getTime());
}
function plTap(p) { if (!plQuotable(p)) return ""; const k = plKey(p); PLQ[k] = p; return ` data-q="${encodeURIComponent(k)}" onclick="plQuote(this, true)" style="cursor:pointer"`; }
function plShown(p) { const c = plQuotable(p) ? PLC[plKey(p)] : null; return c && c.pay > 1 ? plText(c.pay, p.stake || 10) : plPay(p); }
const PLBUSY = new Set();
async function plQuote(el, fresh) {
  const k = decodeURIComponent(el.dataset.q || ""), p = PLQ[k]; if (!p || PLBUSY.has(k)) return; PLBUSY.add(k);
  const same = () => [...document.querySelectorAll(".plb[data-q]")].filter((x) => x.dataset.q === el.dataset.q);
  if (fresh) same().forEach((x) => { x.style.opacity = ".5"; });
  try {
    const kick = {}; for (const g of (S && S.games) || []) if (p.legs.some((l) => l.game === g.key)) kick[g.key] = g.start;
    const legs = p.legs.map((l) => ({ game: l.game, market: l.market || l.kind || null, team: l.team || null, side: l.side || null, line: l.line ?? null, label: l.label }));
    const r = await fetch("/api/nba/comboquote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legs, kick, stake: p.stake || 10, fresh: !!fresh }) }).then((x) => x.json());
    if (r && r.ok && r.pay > 1) { PLC[k] = { pay: r.pay, t: Date.now() }; same().forEach((x) => { x.innerHTML = `${pmLogo()} ${plText(r.pay, p.stake || 10)}`; x.title = ""; }); }
    else { PLC[k] = { ...(PLC[k] && PLC[k].pay ? PLC[k] : {}), fail: (r && r.why) || "no quote", t: Date.now() }; same().forEach((x) => { x.title = PLC[k].fail; }); }
  } catch { PLC[k] = { ...(PLC[k] || {}), t: Date.now() }; } finally { same().forEach((x) => { x.style.opacity = ""; }); PLBUSY.delete(k); }
}
let PLAUTO = false;
async function plAuto() {
  if (PLAUTO) return; PLAUTO = true;
  for (;;) {
    let el = null;
    if (!document.hidden) for (const x of document.querySelectorAll(".plb[data-q]")) {
      if (!x.offsetParent) continue;
      const c = PLC[decodeURIComponent(x.dataset.q)]; if (!c || Date.now() - c.t > PL_FRESH) { el = x; break; }
    }
    if (el) { await plQuote(el, false); await new Promise((r) => setTimeout(r, 300)); } else await new Promise((r) => setTimeout(r, 3000));
  }
}
const legMark = (r) => (r === "W" ? '<span class="g">✓</span>' : r === "L" ? '<span class="r">✗</span>' : r === "P" ? '<span class="dim">–</span>' : "•");
// 10/17 (owner): a won leg's text is green and a lost leg's red, like its ✓ / ✗ (logos keep their colors)
const legTxt = (r, html) => (r === "W" ? `<span class="g">${html}</span>` : r === "L" ? `<span class="r">${html}</span>` : html);
const gameLogos = (key) => { const m = String(key || "").match(/^([A-Z]{2,4}) @ ([A-Z]{2,4})$/); return m ? `${tlogo(m[1])}${esc(m[1])} @ ${tlogo(m[2])}${esc(m[2])}` : esc(key); };
function pBlock(title, p, showGame) {
  if (!p || !Array.isArray(p.legs) || !p.legs.length) return "";
  const pr = typeof p.prob === "number" && isFinite(p.prob) ? p.prob : null;
  const legs = p.legs.map((l) => `<div class="pbl">${legMark(l.result)} ${legTxt(l.result, `${tlogo(l.team || "")}${esc(l.label)}${l.bought ? ` · ${l.points} pt${l.points === 1 ? "" : "s"}` : ""} · ${Math.round((l.prob || 0) * 100)}%`)}${showGame && l.game ? ` <span class="dim">${gameLogos(l.game)}</span>` : ""}</div>`).join("");
  const res = p.result === "W" ? '<span class="g">✓ Won</span>' : p.result === "L" ? '<span class="r">✗ Lost</span>' : p.result === "P" ? '<span class="dim">Push</span>' : "";
  return `<div class="par"><div class="pbh"><span class="pbn">${title}${pr == null ? "" : ` <span class="${pr >= 0.3 ? "g" : pr >= 0.15 ? "lg" : "y"}">· ${Math.round(pr * 100)}%</span>`}</span><span class="plb"${plTap(p)}>${pmLogo()} ${plShown(p)}</span></div>${legs}<div class="pbr">${res}</div></div>`;
}
function labParlays(day, type) {
  const rec = (MODELBETS && MODELBETS.days && MODELBETS.days[day] && MODELBETS.days[day][type]) || [];
  const today = S && S.dates && S.dates.includes(day);
  const live = today ? (S.parlays || []).filter((p) => p.type === type && (p.game ? S.games.some((g) => g.key === p.game && g.date === day && !g.inProgress) : day === S.dates[0])) : [];
  const out = live.map((p) => ({ p, start: p.start || (p.legs[0] && (S.games.find((g) => g.key === p.legs[0].game) || {}).start) || null, title: p.game ? gameLogos(p.game) : esc(PTYPES[type] || type), across: !p.game }));
  for (const r of rec) if (!out.some((x) => x.p.game === r.game && (r.game || x.p.type === r.type))) out.push({ p: r, start: r.start || null, title: r.game ? gameLogos(r.game) : esc(PTYPES[type] || type), across: !r.game });
  return out.sort((a, b) => (Date.parse(a.start || 0) || 0) - (Date.parse(b.start || 0) || 0));
}
function renderLabList() {
  if (!$("lab")) return;
  const days = [...new Set([...Object.keys((MODELBETS && MODELBETS.days) || {}), ...((S && S.dates) || [])])].sort().reverse();
  // opens on the first day that has parlays of this type: today, then the next days, then the most recent past day (never an empty day when a full one exists)
  const order = [...((S && S.dates) || []), ...days.filter((d) => !(S && S.dates && S.dates.includes(d)))];
  const sel = LABDAY && days.includes(LABDAY) ? LABDAY : order.find((d) => labParlays(d, LABTYPE).length) || (S && S.dates && S.dates[0]) || days[0];
  const chips = `<div class="wksel"><select id="lab-wk" aria-label="Day">${[...days].reverse().map((d) => `<option value="${esc(d)}"${sel === d ? " selected" : ""}>${dayName(d)}</option>`).join("")}</select></div>`;   // 10/17 (owner): a drop-down, first recorded day first
  const xs = sel ? labParlays(sel, LABTYPE) : [];
  const slotTimes = {}; for (const x of xs) if (x.start && !x.across) { const sl = nbaSlot(x.start), tt = tipTime(x.start); (slotTimes[sl] = slotTimes[sl] || []).includes(tt) || slotTimes[sl].push(tt); }
  let lastSlot = null; const blocks = xs.map((x) => { const sl = x.start && !x.across ? nbaSlot(x.start) : null, h = sl && sl !== lastSlot ? `<div class="sh labslot">${sl} <span class="lst">· ${slotTimes[sl].map(esc).join(" · ")}</span></div>` : ""; if (sl) lastSlot = sl; return h + pBlock(x.title, x.p, x.across); });
  $("lab").innerHTML = chips + (xs.length ? `<div class="pgrid" style="margin-top:6px">${blocks.join("")}</div>` : '<div class="s dim" style="margin-top:12px">None yet.</div>');
  const lw = $("lab-wk"); if (lw && lw.tagName === "SELECT") lw.onchange = () => { LABDAY = lw.value; renderLabList(); };
}

// ---------- Models: four tiles, then flat sections (headers with a line, rows two across)
async function loadModels() {
  try { MODELS = await (await fetch("/api/nba/models", { cache: "no-store" })).json(); } catch { MODELS = { ok: false }; }
  if (!FUT || !FUT.ok) loadFutures(); else renderModels();
}
async function loadFutures() {
  try { FUT = await (await fetch("/api/nba/futures", { cache: "no-store" })).json(); } catch { FUT = { ok: false, error: "couldn't load" }; }
  renderModels();
}
function mSec(id, title, body, warn = 0, open = false) {
  return `<div class="fold" data-drop="${id}"><span><b>${esc(title)}</b>${warn ? ` <span class="y">⚠ ${warn}</span>` : ""}</span><span>▾</span></div><div class="drop${open ? " open" : ""}" id="${id}">${body}</div>`;
}
const hitCls = (h) => (h == null ? "dim" : h >= 0.55 ? "g" : h >= 0.5 ? "y" : "r");
function statTile(label, e, sub) {
  const hit = e && e.w + e.l ? e.w / (e.w + e.l) : null;
  return `<div class="stat"><div class="k">${label}</div><div class="v ${hitCls(hit)}">${hit == null ? "—" : `${e.w}–${e.l}`}</div><div class="k2">${hit == null ? "—" : `${Math.round(hit * 100)}% ${sub}`}</div></div>`;
}
function labStats(rc, clv) {
  const V = clv || { n: 0 }, av = V.n ? V.avg : null;
  const clvTile = `<div class="stat" style="grid-column:1/-1"><div class="k">LINE VALUE</div><div class="v ${av == null ? "dim" : av > 0 ? "g" : av < 0 ? "r" : "y"}">${av == null ? "—" : `${av > 0 ? "+" : ""}${av.toFixed(2)}`}</div><div class="k2">${av == null ? "—" : `pts vs close · beat it ${V.beatPct}% · ${plural(V.n, "pick")}`}</div></div>`;
  return `<div class="stats">${statTile("MONEYLINE", rc.ml, "right")}${statTile("SPREAD PICKS", rc.spread, "covered")}${statTile("TOTAL PICKS", rc.total, "right")}${clvTile}</div>`;
}
const recRow = (lab, e, said = false) => (e ? `<div class="row"><span class="dim">${lab}</span><span>${e.w + e.l ? `${e.w}–${e.l}${e.push ? "–" + e.push : ""} · <b>${e.pct}%</b>` : ""}${said && e.said != null ? ` <span class="dim">said ${e.said}%</span>` : ""}${e.per100 != null ? ` · <span class="${e.per100 >= 0 ? "g" : "r"}">${e.per100 >= 0 ? "+" : "−"}$${Math.abs(e.per100)} per $100</span>` : ""}${e.pending ? ` <span class="dim">(${e.pending} pending)</span>` : ""}${!(e.w + e.l) && !e.pending ? '<span class="dim">waiting</span>' : ""}</span></div>` : "");
function paint(html) {
  return html.replace(/>([^<>]+)</g, (all, t) => ">" + t
    .replace(/(^|[^\d/.])(\d{1,4})–(\d{1,4})(?![\d/%])/g, (m, pre, w, l) => { const n = +w + +l; if (!n) return m; const r = +w / n; return `${pre}<b class="${r >= 0.55 ? "g" : r >= 0.5 ? "y" : "r"}">${w}–${l}</b>`; })
    .replace(/\b(OK|all clear|saved|answering|published|none)\b/g, '<span class="g">$1</span>') + "<");
}
function winnersBox() {
  const list = (S ? S.games : []).filter((g) => !g.inProgress).map((g) => { const w = mktWin(g); if (!w || w.home === 0.5) return null; const home = w.home > 0.5; return { team: home ? g.home : g.away, opp: home ? g.away : g.home, p: home ? w.home : w.away, price: g.poly.ml[home ? "home" : "away"] }; }).filter(Boolean).sort((a, b) => b.p - a.p);
  return list.map((x, i) => `<div class="row"><span>${i + 1}. ${tlogo(x.team)}<b>${esc(x.team)}</b> <span class="dim">over ${esc(x.opp)}</span></span><span>${Math.round(x.p * 100)}%${x.price ? ` <span class="dim">· ${cents(x.price)}</span>` : ""}</span></div>`).join("") || '<div class="s dim">No lines yet.</div>';
}
function futuresRows() {
  const f = FUT;
  if (!f) return '<div class="s dim">Loading…</div>';
  if (!f.ok) return `<div class="s dim">${f.loading ? "Building…" : esc(f.error || "Not available right now.")}</div>`;
  const tabs = [...f.sections.map((s) => [s.id, s.title]), ["wins", "Season wins"]];
  const chips = `<div class="chips" style="margin-top:0;grid-column:1/-1">${tabs.map(([id, t]) => `<button data-fut="${id}" class="${FUTSEC === id ? "on" : ""}">${esc(t)}</button>`).join("")}</div>`;
  if (FUTSEC === "wins") return chips + f.wins.map((w) => `<div class="row"><span>${tlogo(w.team)}<b>${esc(w.team)}</b></span><span><b class="mod">${w.ew}</b> <span class="dim">${w.low}–${w.high}</span>${w.line != null ? ` · line <b class="mkt">${w.line}</b>` : ""}</span></div>`).join("");
  const sec = f.sections.find((x) => x.id === FUTSEC) || f.sections[0];
  return chips + sec.rows.filter((r) => (r.model || 0) >= 0.1 || (r.market || 0) >= 0.5).map((r) => `<div class="row"><span>${tlogo(r.team)}<b>${esc(r.team)}</b></span><span>model <b class="mod">${r.model}%</b>${sec.market ? ` · market <b class="mkt">${r.market == null ? "—" : r.market + "%"}</b>` : ""}</span></div>`).join("");
}
let FUTSEC = "champion";
function renderModels() {
  const j = MODELS; if (!j || !j.ok) { $("models").innerHTML = '<div class="s dim" style="margin-top:12px">Models unavailable right now.</div>'; return; }
  const r = j.report, p = j.patterns, rb = j.rebuild, rc = j.record || {}, mv = j.moves || {}, pl = j.parlays || {}, sy = j.system || null;
  $("upd-models").textContent = `Updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const open = [...document.querySelectorAll("#models .drop.open")].map((e) => e.id);
  // parlay scoreboard (first, closed): this season's W-L, hit %, said %, money; past = tested history
  const PH = { fav4: "36.4%", best4: null, sgp: null, sgp_pts: null };
  const board = `<div class="s"><b>This season · hit vs said · money · past</b></div>` + Object.entries(PTYPES).map(([k, lab]) => { const b = pl[k];
    return `<div class="row"><span>${esc(lab)}</span><span>${b && b.decided ? `${b.hits}–${b.decided - b.hits} · ${b.pct}% <span class="dim">said ${b.said}%</span> <span class="${b.money >= 0 ? "g" : "r"}">${b.money >= 0 ? "+" : "−"}$${Math.abs(Math.round(b.money))}</span>` : b && b.pending ? `<span class="dim">${plural(b.pending, "open")}</span>` : '<span class="dim">waiting</span>'}${PH[k] ? ` · <span class="dim">${PH[k]}</span>` : ""}</span></div>`; }).join("");
  // card picks: PICK (rule / model side), PICK w/ POINTS, moneyline; shadow trackers below
  const cardRows = `<div class="s"><b>Card picks</b></div>` + recRow("PICK · spread", rc["cardpick|spread"]) + recRow("LINE MOVE · spread", rc["rule:linemove|spread"]) + recRow("FATIGUE · spread", rc["rule:fatigue|spread"]) + recRow("ATS REGRESSION · spread", rc["rule:atsreg|spread"]) + recRow("PICK w/ POINTS · spread", rc["ptspick|spread"]) + recRow("PICK · total", rc["cardpick|total"]) + recRow("TOTAL MOVE · total", rc["rule:linemove|total"]) + recRow("SHOT QUALITY · total", rc["rule:shotq|total"]) + recRow("PICK w/ POINTS · total", rc["ptspick|total"]) +
    recRow("MODEL SIDE · spread", rc["modelpick|spread"]) + recRow("MODEL SIDE · total", rc["modelpick|total"]) + recRow("MONEYLINE", rc.ml) + recRow("GREEN · 56%+", rc.green, true) + recRow("PRESEASON TEST", rc.test, true) +
    `<div class="s"><b>Shadow trackers</b></div>` + recRow("LINE MOVE · at the open", mv.all) + recRow("LINE MOVE · at the number seen", mv["now:all"]) + recRow("INJURY · at the open", mv.inj) + recRow("INJURY · at the number seen", mv["now:inj"]) + recRow("Pinnacle vs Polymarket gap", mv.gap) + recRow("Books vs Polymarket gap", mv.bgap) +
    (j.clv && j.clv.n ? `<div class="row"><span class="dim">Closing-line value</span><span>${j.clv.avg > 0 ? "+" : ""}${j.clv.avg} pts · beat the close ${j.clv.beatPct}% of ${j.clv.n}</span></div>` : "");
  const accRows = r ? r.rows.map((x) => `<div class="row"><span class="dim">${esc(x.model)}</span><span>ours <b>${x.ours_same_games}</b> · market <b class="mkt">${x.market}</b> <span class="${x.ours_same_games <= x.market ? "g" : "r"}">${x.ours_same_games <= x.market ? "better" : "worse"}</span></span></div>`).join("") +
    (r.spread_side ? `<div class="row"><span class="dim">Model's spread side</span><span>${r.spread_side.overall}% <span class="dim">break-even ${r.spread_side.break_even}%</span></span></div>` : "") + (r.total_side ? `<div class="row"><span class="dim">Model's total side</span><span>${r.total_side.overall}%</span></div>` : "") +
    `<div class="row" style="grid-column:1/-1"><span class="dim">Win chance check</span><span>${r.win_calibration.map((x) => `said ${x.said}: won ${x.home_won}% (${x.games})`).join(" · ")}</span></div>` +
    `<div class="row"><span class="dim">Trained on</span><span>${esc(r.trained_on)}</span></div><div class="row"><span class="dim">Injuries from</span><span>${esc(r.injury_basis || "who actually sat")}</span></div>` : '<div class="s dim">No report yet.</div>';
  const patRows = p ? Object.entries(p.kinds).map(([k, v]) => `<div class="row"><span class="dim">${k === "moneyline" ? "Moneyline" : k === "spread" ? "Spread" : "Total"}</span><span>${v.tested} tested · ${v.kept} kept</span></div>` +
    (v.unseen ? `<div class="row"><span class="dim">· on unseen seasons</span><span><b>${v.unseen.win_rate}%</b> of ${v.unseen.games} · ${v.unseen.seasons_above_50}/${v.unseen.seasons} seasons</span></div>` : "") +
    `<div class="row"><span class="dim">· luck alone passes</span><span>${v.luck_only_mean} (up to ${v.luck_only_max})</span></div>`).join("") : '<div class="s dim">No pattern summary yet.</div>';
  const when = (t) => (t ? hm(t) : "—"), snapAge = sy && sy.lastSnapshot ? Date.now() - new Date(sy.lastSnapshot.t) : null;
  const watch = sy ? sy.watch || [] : [];
  const sysRows = sy ? watch.map((x) => `<div class="s y" style="grid-column:1/-1">⚠ ${esc(x)}</div>`).join("") + [
    ["Last snapshot", sy.lastSnapshot ? `${when(sy.lastSnapshot.t)} · ${plural(sy.lastSnapshot.games, "game")}${snapAge > 10 * 3600e3 ? ' <span class="y">(stale)</span>' : ""}` : '<span class="y">none yet</span>'],
    ["Model service (Railway)", sy.railway && sy.railway.ok ? `answering · ${sy.railway.ms} ms` : `<span class="r">NOT answering${sy.railway && sy.railway.code ? " (HTTP " + sy.railway.code + ")" : ""}</span>`],
    ["Pinnacle lines", sy.pinnacle ? when(sy.pinnacle) : '<span class="y">no good pull yet</span>'],
    ["Lined games this season", sy.railway && sy.railway.lines ? `${sy.railway.lines.lined} of ${sy.railway.lines.games} · ${sy.railway.lines.polymarket} from Polymarket` : "—"],
    ["Stored items", sy.keys != null ? String(sy.keys) : "—"],
    ["Last backup", sy.backup ? `${when(sy.backup.t)} · ${sy.backup.where === "volume" ? "saved" : sy.backup.where === "failed" ? '<span class="r">failed</span>' : '<span class="y">temporary</span>'}` : '<span class="y">none yet</span>'],
    ["Sportsbook credits left", S && S.books && S.books.remaining != null ? String(S.books.remaining) : "—"],
    ["Last rebuild", rb ? `${when(rb.at)} · ${rb.published ? "published" : `<span class="y">held: ${esc((rb.failed_checks || []).join("; "))}</span>`}` : "not yet"],
    ["Errors (last 2 days)", (sy.errors || []).length ? sy.errors.slice(0, 6).map((e) => `<div class="y">${when(e.t)} · ${esc(e.where)}: ${esc(e.msg)}</div>`).join("") : "none"],
  ].map(([a, b]) => `<div class="row"${/<div/.test(String(b)) ? ' style="grid-column:1/-1"' : ""}><span class="dim">${a}</span><span>${b}</span></div>`).join("") : '<div class="s dim">Status unavailable.</div>';
  const sysBad = !sy || !sy.railway || !sy.railway.ok || (sy.errors || []).length > 0 || watch.length > 0;
  $("models").innerHTML = labStats(rc, j.clv) +
    mSec("m-board", "★ Parlay scoreboard · this season", board) +
    mSec("m-win", "1 · Winners · moneyline", winnersBox()) +
    mSec("m-line", "2 · Spreads and totals", cardRows) +
    mSec("m-acc", "3 · Accuracy vs the market", accRows) +
    mSec("m-pat", "4 · Tested patterns", patRows) +
    mSec("m-fut", `5 · Futures · ${FUT && FUT.ok ? FUT.season : "season simulation"}`, futuresRows()) +
    mSec("m-sys", "6 · System", sysRows, watch.length, sysBad);
  $("models").innerHTML = paint($("models").innerHTML);
  for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
}

// ---------- Alerts
let ALERTS = [], ALFILTER = "all", ALPREV = null;
const ALK = { PICK: ["New pick", "var(--green)"], "LINE MOVE": ["Line move", "var(--blue)"], INJURY: ["Injury", "var(--red)"], RESULT: ["Result", "var(--gold)"] };
const alSlug = (k) => String(k).toLowerCase().replace(/ /g, "");   // "QB CHANGE" -> "qbchange" (menu: #alerts-qbchange)
const alSeen = () => { try { return localStorage.getItem("alSeen") || ""; } catch { return ""; } };
async function loadAlerts() {
  try { const d = await (await fetch("/api/nba/alerts", { cache: "no-store" })).json(); if (d.ok) { ALERTS = d.alerts || []; renderAlerts(); } } catch {}
}
function renderAlerts() {
  const dots = ALPREV != null ? ALPREV : alSeen(), unread = ALERTS.filter((a) => a.t > alSeen()).length;
  Shell.setCount("nba", "alerts", unread);
  for (const k of Object.keys(ALK)) Shell.setCount("nba", `alerts-${alSlug(k)}`, ALERTS.filter((a) => a.kind === k && a.t > alSeen()).length);   // 10/17 (owner): the unread number on each kind's own line   // 10/17: the unread count sits on the menu's NBA Alerts row
  const list = ALERTS.filter((a) => ALFILTER === "all" || a.kind === ALFILTER);
  $("alerts").innerHTML = list.length ? list.map((a) => { const [lab, col] = ALK[a.kind] || [a.kind, "var(--dim)"];
    const ic = a.kind === "INJURY" && a.team ? tlogo(a.team) : a.kind === "LINE MOVE" ? pmLogo() : "";
    return `<div class="card al${a.t > dots ? " un" : ""}" data-algame="${esc(a.game || "")}"><span class="dot"></span><div style="flex:1"><div class="kd" style="color:${col}"><span>${ic}${lab.toUpperCase()}</span><span class="dim" style="font-weight:600;letter-spacing:0">${hm(a.t)}</span></div>` +
      `<div class="ti">${esc(a.title)}</div>${a.sub ? `<div class="su">${esc(a.sub)}</div>` : ""}${a.game ? `<div style="font-size:11px;font-weight:700;margin-top:6px;color:var(--blue)">${esc(a.game)} ›</div>` : ""}</div></div>`; }).join("") :
    '<div class="card" style="margin-top:10px"><div class="inner"><div class="s dim">No alerts.</div></div></div>';
}

// ---------- plumbing
async function loadSlate() {
  const r = await fetch("/api/nba/slate", { cache: "no-store" }), j = await r.json();
  if (!j.ok) throw new Error(j.error || "error");
  const build = r.headers.get("x-build"); if (window.__build && build && build !== window.__build) return location.reload(); window.__build = build;
  S = j; TEAMS = j.teams || TEAMS;
  const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean);
  weekline(); tickCd(); renderLines(); loadLiveScores(); if ($("panel-record").classList.contains("on")) { renderBets(); renderLabList(); }
  for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
  try { localStorage.setItem("lastSeen", new Date().toISOString()); } catch {}
}
function showPanel(name) {
  let sub = null;   // 10/17 (owner): My bets and Model bets are separate pages under Bets in the menu
  if (/^alerts-/.test(name)) { const k = name.slice(7); ALFILTER = k === "all" ? "all" : Object.keys(ALK).find((x) => alSlug(x) === k) || "all"; name = "alerts"; }   // 10/17 (owner): the alert kinds are menu sub tabs under Alerts
  if (name === "alerts") sub = `alerts-${ALFILTER === "all" ? "all" : alSlug(ALFILTER)}`;
  if (/^modelbets-/.test(name)) { const k = name.slice(10); if (LAB_TABS.some(([t]) => t === k)) LABTYPE = k; name = "modelbets"; }   // 10/17 (owner): the parlay types are menu sub tabs under Model bets
  if (name === "modelbets") sub = `modelbets-${LABTYPE}`;
  if (name === "mybets" || name === "modelbets" || name === "props") { sub = sub || name; BETSVIEW = name === "modelbets" ? "model" : name === "props" ? "props" : "mine"; try { localStorage.setItem("betsView", BETSVIEW); } catch {} name = "record"; }   // 10/17: Props is the third page under Bets
  if (name === "record" && !sub) sub = BETSVIEW === "model" ? `modelbets-${LABTYPE}` : BETSVIEW === "props" ? "props" : "mybets";
  if (!$("panel-" + name)) name = "lines";
  Shell.setActive(sub || name);   // 10/17: the menu replaces the tab bar
  if (name === "alerts") { ALPREV = alSeen(); if (ALERTS.length) { try { localStorage.setItem("alSeen", ALERTS[0].t); } catch {} } }
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on")); $("panel-" + name).classList.add("on");
  if (name === "alerts") renderAlerts();
  try { window.scrollTo(0, 0); } catch {}
  if (name === "models") loadModels();
  if (name === "record") { loadBets(); applyBetsView(); }
  setTimeout(() => slotify($("panel-" + name)), 60);
  if (S) setBg(name === "lines" && DETAIL ? S.games.find((x) => x.key === DETAIL) : null);
  linesBg();
}
// 10/17: pages switch by the address' #name (the menu links set it): #alerts, #lines, #record, #models; #game=KEY opens a game (from the home screen)
const PANELS = ["alerts", "lines", "record", "mybets", "modelbets", "props", ...LAB_TABS.map(([k]) => `modelbets-${k}`), "alerts-all", ...Object.keys(ALK).map((k) => `alerts-${alSlug(k)}`), "models"];
let OPEN_GAME = null;
function routeHash() {
  const h = location.hash || "";
  if (h.startsWith("#game=")) { OPEN_GAME = decodeURIComponent(h.slice(6)); history.replaceState(null, "", "#lines"); }
  const name = Shell.hashPanel(PANELS, "lines");
  if (name === "lines" && DETAIL && $("panel-lines").classList.contains("on")) closeGame();
  showPanel(name);
  if (OPEN_GAME && S && S.games.some((x) => x.key === OPEN_GAME)) { const k = OPEN_GAME; OPEN_GAME = null; openGame(k); }
}
window.addEventListener("hashchange", routeHash);
$("al-read").onclick = () => { ALPREV = ALERTS.length ? ALERTS[0].t : ""; renderAlerts(); };
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-drop]"); if (d) { const el = $(d.dataset.drop); if (el) el.classList.toggle("open"); return; }
  const gt = e.target.closest("[data-game]"); if (gt) { if (!$("panel-lines").classList.contains("on")) showPanel("lines"); openGame(gt.dataset.game); return; }
  const al = e.target.closest("[data-algame]"); if (al) { const k = al.dataset.algame; if (k && S && S.games.some((x) => x.key === k)) { showPanel("lines"); openGame(k); } return; }
  const bv = e.target.closest("[data-bv]"); if (bv) { BETSVIEW = bv.dataset.bv === "model" ? "model" : "mine"; try { localStorage.setItem("betsView", BETSVIEW); } catch {} applyBetsView(); try { window.scrollTo(0, 0); } catch {} return; }
  const fu = e.target.closest("[data-fut]"); if (fu) { FUTSEC = fu.dataset.fut; renderModels(); const el = $("m-fut"); if (el) el.classList.add("open"); }
});
function catchUp() { fetch("/api/nba/results/grade", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d && (d.graded || d.parlays) && ($("panel-record").classList.contains("on") || $("panel-models").classList.contains("on"))) { loadBets(); loadModels(); } }).catch(() => {}); }
setInterval(() => { if (!document.hidden) loadLiveScores(); }, 30000);   // scores every 30 s while a game is on
function autoRefresh() { setTimeout(async () => { if (!document.hidden) { try { await loadSlate(); await loadAlerts(); } catch {} } autoRefresh(); }, 120e3); }
loadAlerts(); setInterval(() => { if (!document.hidden) loadAlerts(); }, 120e3);
Shell.init("nba");
document.querySelectorAll("[data-mp]").forEach((a) => a.addEventListener("click", () => { if (a.dataset.msp === "nba" && location.hash === "#" + a.dataset.mp) setTimeout(routeHash, 0); }));
Shell.onRefreshed = () => loadSlate();
routeHash();
loadSlate().then(() => { autoRefresh(); catchUp(); plAuto(); setTimeout(() => slotify($("panel-lines")), 60); if (OPEN_GAME) routeHash(); }).catch((e) => toast("Couldn't load: " + e.message, 12000));
