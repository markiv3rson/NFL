// NBA Slate — front end. The NFL app's current layout (10/15), NBA data only.
// Data (merged site: every NBA route lives under /api/nba): /api/slate (Polymarket lines + model + cards + parlays), /api/models, /api/mybets, /api/modelbets, /api/alerts.
// A bet's average price: whole cents from 10c, else one decimal (1.6c, not "2c": $2 at 1.6c pays $125), two under 0.1c.
const betCents = (p) => { const c = p * 100; return c >= 9.95 ? String(Math.round(c)) : c >= 0.095 ? c.toFixed(1) : c >= 0.005 ? c.toFixed(2) : "<0.01"; };
let S = null, TEAMS = {}, DETAIL = null, LASTY = 0, MODELS = null, BETS = null, MODELBETS = null, FUT = null, MBDAY = null;
const $ = (id) => document.getElementById(id);
const dash = '<span class="dim">—</span>';
const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const sgn = (n) => (n > 0 ? "+" : "") + n;
const odds = (o) => (o == null ? "—" : (o > 0 ? "+" : "") + o);
const toAm = (p) => { if (!(p > 0 && p < 1)) return null; return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p); };
const cents = (p) => (p > 0 && p < 1 ? Math.round(p * 100) + "¢" : "—");
const money = (v) => (v == null ? "—" : (v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(2));
const cMoney = (v) => (v == null ? "—" : `<span class="${Math.abs(v) < 0.005 ? "" : v > 0 ? "g" : "r"}">${Math.abs(v) < 0.005 ? "$" : v > 0 ? "+$" : "−$"}${Math.abs(v).toFixed(2)}</span>`);   // zero reads "$0.00", no sign, no colour (same as NFL)
const tm = (iso) => (!iso || isNaN(new Date(iso)) ? "TBD" : new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }));
const hm = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
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
// 10/20 night (owner: "where is the logos?"): the Player props and Alerts pages can draw before the slate (which carries TEAMS) has loaded,
// so a team without a slate entry falls back to ESPN's NBA logo (its codes differ for a few teams).
const ESPN_NBA = { GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh", PHX: "phx" };
const logoUrl = (a) => (TEAMS[a] && TEAMS[a].logo ? TEAMS[a].logo : a ? `https://a.espncdn.com/i/teamlogos/nba/500/${ESPN_NBA[a] || String(a).toLowerCase()}.png` : "");
const tlogo = (a) => (a ? `<img class="tlogo" src="${esc(logoUrl(a))}" alt="" onerror="this.style.display='none'">` : "");
const teamColor = (a) => (TEAMS[a] && TEAMS[a].bright) || "#444";
const pmLogo = () => '<span class="pm"><img src="/polymarket.png" alt=""></span>';   // 10/20 night (owner): the real Polymarket logo everywhere
const recOf = (g, t) => { const c = g.context && g.context[t === g.home ? "home" : "away"]; if (!c) return ""; const w = c.gp ? Math.round(c.win_pct * c.gp) : 0; return `<small class="rec">${w}–${(c.gp || 0) - w}</small>`; };
const mktWin = (g) => { const m = g.poly && g.poly.ml; if (!m) return null; return { away: m.midAway / (m.midAway + m.midHome), home: m.midHome / (m.midAway + m.midHome) }; };
// colors by win rate (owner 10/15): green 56%+, light green 53-55%, yellow below
const clsOf = (hit) => (hit >= 56 ? "g" : hit >= 53 ? "lg" : "y");
const hitTxt = (hit, cls) => `${cls === "g" ? Math.round(hit) : Math.floor(hit)}%`;
const glowOf = (p) => (p >= 0.61 ? 1 : p >= 0.58 ? 0.75 : 0.45);
const ptsWord = (n) => (n === 0 ? "main" : `${n} pt${n === 1 ? "" : "s"}`);

// ---------- casino look (same as the NFL app): slot-reel numbers, coins, stamps
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
const SLOT_SKIP = ".reelpct,.fclk,script,style,input,textarea,select,svg";
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

function tickCd() {   // refreshes the slate once when the next game tips off
  clearTimeout(tickCd._h);
  if (!S) return;
  const nxt = S.games.filter((g) => !started(g)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  if (nxt && tickCd._cur && tickCd._cur !== nxt.key && Date.now() - (tickCd._last || 0) > 15000) { tickCd._last = Date.now(); setTimeout(() => loadSlate().catch(() => {}), 4000); }
  tickCd._cur = nxt ? nxt.key : null;
  tickCd._h = setTimeout(tickCd, 1000);
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
// 10/18 night (owner): the LINE MOVES strip is gone -- a game's own move since the first line seen sits inside its tile (one line each)
function moveBits(g) {
  if (g.inProgress || !g.move) return [];
  const bits = [];
  if (g.move.spread) bits.push(`spread ${g.home} ${sgn(g.move.spread.open)} → ${sgn(g.move.spread.now)}`);
  if (g.move.total) bits.push(`total ${g.move.total.open} → ${g.move.total.now}`);
  return bits;
}
const moveLines = (bits) => (bits.length ? `<div class="mvt">${bits.map((b) => `<span>${esc(b)}</span>`).join("")}</div>` : "");
// Live scores (10/17): ESPN's scoreboard via /api/nba/live -- a started game shows its score + clock, a finished one its final score
// (before, a game counted as "live" from tip-off until the slate dropped it, so last night's games stayed LIVE).
let NBL = {};
const scOf = (g) => (g.inProgress ? NBL[g.key] || null : null), isFinal = (g) => { const sc = scOf(g); return !!(sc && sc.st === "post"); };
async function loadLiveScores() {
  if (!S || !S.games.some((g) => g.inProgress)) return;
  try { const d = await (await fetch("/api/nba/live", { cache: "no-store" })).json(); if (d && d.ok) { NBL = d.scores || {}; if ($("panel-lines").classList.contains("on")) { const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean); renderLines(); for (const id of open) { const e = $(id); if (e) e.classList.add("open"); } } else if ($("panel-record").classList.contains("on") && BETS) renderBets(); } } catch {}
}
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
function tile(g) {
  const sc = scOf(g), fin = isFinal(g), live = g.inProgress && !fin;
  const hp0 = mktWin(g), hp = hp0 ? hp0.home * 100 : null, ap = hp == null ? null : 100 - hp;
  const lead = (v, o) => (v >= o ? "mkt" : "dim");
  const green = greenPicks(g)[0];
  const chips = [!g.inProgress && !fin && g.start ? `<span class="chip tmt">${esc(tipTime(g.start))}</span>` : "", g.preseason ? '<span class="chip c-amb">PRESEASON</span>' : "", green ? `<span class="chip c-grn">${esc(green.pick)}</span>` : "", live && !sc ? '<span class="chip c-red">LIVE</span>' : ""].filter(Boolean).join('<span style="display:inline-block;width:6px"></span>');
  const mid0 = hp == null ? '<span class="mid dim">—</span>' : `<span class="mid"><span class="${lead(ap, hp)}">${Math.round(ap)}</span><span class="dim"> · </span><span class="${lead(hp, ap)}">${100 - Math.round(ap)}</span><span class="dim" style="font-size:11px">%</span></span>`;
  const mid = sc && (sc.st === "in" || sc.st === "post") ? `<span class="mid lvmid"><span class="sr"><span class="${sc.a > sc.h ? "g" : "dim"}">${sc.a}</span><span class="dim"> – </span><span class="${sc.h > sc.a ? "g" : "dim"}">${sc.h}</span></span><span class="lv ${fin ? "dim" : "r"}">${fin ? "FINAL" : "● LIVE · " + esc(sc.lbl)}</span></span>` : mid0;
  // 10/18 (owner, same as NFL): logo + code + record each side, the % (or score) in the middle with the tip time + the pick / PRESEASON tag under it, the bar.
  // 10/18 evening (owner, sketch D): NO big faded logos and NO team colours behind the tile -- a plain 55% dark card so the page picture shows through.
  const L = fin && g.locked, res = L ? resLine(["spread", "total", "ml"].map((k) => L[k] && L[k].plain), g.away, g.home, Number(sc.a), Number(sc.h)) : "";   // NBA: the card's PICK (spread, total) + the ML pick, locked at tip-off
  return `<button class="tile${live ? " live" : ""}" data-game="${esc(g.key)}">` +
    `<div class="in"><div class="nm"><span class="t">${tlogo(g.away)}${g.away}${recOf(g, g.away)}</span><div class="tmid">${mid}${res}${chips ? `<div class="s2">${chips}</div>` : ""}${moveLines(moveBits(g))}</div><span class="t hm">${g.home}${tlogo(g.home)}${recOf(g, g.home)}</span></div>${hp == null || sc ? "" : `<div class="bar"><i style="width:${ap}%"></i></div>`}</div></button>`;
}
function renderLines() {
  if (!S) { $("lines").innerHTML = '<div class="s dim center">Loading…</div>'; return; }
  if (DETAIL) { const g = S.games.find((x) => x.key === DETAIL); if (g) return renderDetail(g); DETAIL = null; }
  setBg(null); linesBg(); document.body.classList.remove("game-on"); if (typeof Shell !== "undefined" && Shell.unpinGame) Shell.unpinGame();
  $("detail").style.display = "none"; $("lines").style.display = "";
  $("lines").innerHTML = (S.games.length ? linesByDay() : '<div class="tiles"><div class="s dim">No NBA games on Polymarket right now.</div></div>');
}
// 10/17 (owner: "make everything consistent"): Game Lines stacked one game per row under a header per day with its tip times, like NFL's time slots
const tipTime = (iso) => (!iso || isNaN(new Date(iso)) ? "TBD" : new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
function linesByDay() {
  const days = [], by = {};
  for (const g of [...S.games].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0))) { const d = g.date || "TBD"; if (!by[d]) { by[d] = []; days.push(d); } by[d].push(g); }
  return days.map((d) => `<div class="sh labslot">${esc(dayName(d).toUpperCase())}</div><div class="tiles stack">${by[d].map(tile).join("")}</div>`).join("");   // 10/18 (owner): just the day -- the tip time sits on each tile
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
  const st = g.inProgress ? '<span class="r">● LIVE</span>' : startsIn(g), dsc = scOf(g);   // 10/23 (owner, = NFL): a game being played shows its score + quarter clock
  const ca = teamColor(g.away), ch = teamColor(g.home), badge = g.preseason && !g.inProgress ? '<span class="chip c-amb">PRESEASON</span>' : "";
  return `<div class="card dtop" style="background:linear-gradient(90deg,${ca}40 0%,${ca}14 50%,${ch}14 50%,${ch}40 100%),var(--card)"><img class="dwm l" src="${esc(logoUrl(g.away))}" alt="" onerror="this.style.display='none'"><img class="dwm r" src="${esc(logoUrl(g.home))}" alt="" onerror="this.style.display='none'"><div class="inner"><div class="nm"><span class="t">${g.away}${recOf(g, g.away)}</span>` +
    `<div class="mid">${badge}${dsc && (dsc.st === "in" || dsc.st === "post") ? `<div class="s2"><b>${dsc.a} – ${dsc.h}</b></div><div class="s3 r">${dsc.st === "post" ? "FINAL" : "● LIVE · " + esc(dsc.lbl)}</div>` : `<div class="s2">${tm(g.start)}</div><div class="s3">${st}</div>`}</div><span class="t hm">${g.home}${recOf(g, g.home)}</span></div>` +
    (w && !isFinal(g) ? `<div class="wc"><div class="wl"><b class="mkt">${ap}%</b><span class="mkt">MARKET’S WIN CHANCE</span><span class="dim">${hr}%</span></div><div class="bar"><i style="width:${ap}%"></i></div></div>` : "") + `</div></div>`;
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
  if (x) { const c1 = clsOf(x.hit), tx = hitTxt(x.hit, c1), lab = TEST ? "Test" : "Pick";
    l1 = TEST ? `<b style="font-size:13px;color:#b9a8ff"><span class="lbw">${lab}:</span> ${esc(x.pick)} · ${tx}</b>`
      : c1 === "g" ? `<b class="g pulse" style="--gl:${glowOf(x.hit / 100)};font-size:13px"><span class="lbw">Pick:</span> ${esc(x.pick)} · <span class="reelpct" data-v="${tx}">${tx}</span></b>` : `<b class="${c1}" style="font-size:13px"><span class="lbw">Pick:</span> ${esc(x.pick)} · ${tx}</b>`; }
  else l1 = `<b class="dim" style="font-size:13px">No pick</b>`;
  const why = x && x.why ? `<div class="s" style="margin-top:2px">${esc(x.why)}</div>` : "";
  let l2;
  if (p) { const c2 = clsOf(p.hit); l2 = `<b class="${TEST ? "" : c2}" style="font-size:13px${TEST ? ";color:#b9a8ff" : ""}"><span class="lbw">${TEST ? "Test" : "Pick"} w/ points:</span> ${esc(p.pick)} · ${hitTxt(p.hit, c2)}</b>`; }
  else l2 = `<span class="dim" style="font-size:13px"><span class="lbw">Pick w/ points:</span> none</span>`;
  const grp = (r) => r.team || (r.side === "over" ? "Over" : "Under"), first = x ? x.team || (x.side === "over" ? "Over" : "Under") : null;
  const names = [...new Set(C.rows.map(grp))].sort((a, b) => (a === first ? -1 : 0) - (b === first ? -1 : 0));
  const rows = names.map((nm, i) => `<div style="margin-top:${i ? 8 : 2}px">` + C.rows.filter((r) => grp(r) === nm).map((r) => { const pk = !!(p && r.pick === p.pick);
    return `<div class="s${pk && !TEST ? " g" : ""}" style="margin-top:2px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.pick)} · ${ptsWord(r.points)} · ${hitTxt(r.hit, clsOf(r.hit))} · ${Math.round(r.price * 100)}¢</div>`; }).join("") + "</div>").join("");
  return `<div style="margin-top:6px">${l1}</div>${why}` + moreBox(`<div style="margin-top:4px">${l2}</div>` + (rows ? `<div style="margin-top:6px">${rows}</div>` : ""));
}
function lockedBody(g, kind) {   // after tip-off: the picks saved before it, with W / L once graded
  const L = g.locked && g.locked[kind]; if (!L) return `<div style="margin-top:6px"><b class="dim" style="font-size:13px">Game in progress</b></div>`;
  const rs = (x) => (x.result === "win" ? ' · <span class="g">W</span>' : x.result === "loss" ? ' · <span class="r">L</span>' : x.result === "push" ? " · push" : x.result === "void" ? ' · <span class="dim">void</span>' : "");   // 10/23 (owner): no "live" on the model lines
  return (L.plain ? `<div style="margin-top:6px"><b class="${clsOf(L.plain.pct)}" style="font-size:13px"><span class="lbw">Pick:</span> ${esc(L.plain.label)} · ${hitTxt(L.plain.pct, clsOf(L.plain.pct))}</b>${rs(L.plain)}</div>` : "") +
    (L.pts ? `<div style="margin-top:4px"><b style="font-size:13px"><span class="lbw">Pick w/ points:</span> ${esc(L.pts.label)} · ${hitTxt(L.pts.pct, clsOf(L.pts.pct))}</b>${rs(L.pts)}</div>` : "");
}
function modelCell(g, kind) {
  const m = g.model, k = g[kind];
  const wrap = (inner) => `<div class="modelcell">${inner}</div>`;
  if (!m || !k) return wrap(dash);
  const H = g.home, A = g.away;
  const line = kind === "total" ? `<span class="lbw">Model:</span> <b class="mod">${m.total.toFixed(1)}</b>` : `<span class="lbw">Model:</span> <b class="mod">${m.margin >= 0 ? H : A} by ${Math.abs(m.margin).toFixed(1)}</b>`;
  const C = g.inProgress ? null : cardOf(g, kind);
  const body = g.inProgress ? lockedBody(g, kind) : C ? cardBody(g, kind, C) : `<div style="margin-top:6px"><b class="dim" style="font-size:13px">No pick</b></div>`;
  const ts = kind === "spread" && m.teamSide && !g.inProgress ? `<div class="s"><span class="lbw">Model (Team):</span> <b class="mod">${esc(m.teamSide.team)} ${sgn(m.teamSide.line)} · ${m.teamSide.pct}%</b></div>` : "";   // 10/20 owner: the team model's side on every spread card, both sports (NBA: data only)
  return wrap(`<div class="s">${line}</div>${ts}${body}${kind === "spread" ? mlPickLine(g) : ""}`);
}
const injList = (g) => { const j = g.injuries || {}; return [...(j.away || []).map((p) => ({ t: g.away, ...p })), ...(j.home || []).map((p) => ({ t: g.home, ...p }))]; };
function injPill(g, id) { const n = injList(g).length; return n ? `<div class="btns"><button class="tag" data-drop="${id}">Injuries ${n} ▾</button></div>` : ""; }
function injDrop(g, id) {
  const inj = injList(g); if (!inj.length) return "";
  // 10/23 (design = both sports): the same header line as the NFL box -- where the list came from and when
  const src = S && S.injuriesSource === "nba-official" ? "Official report + ESPN" : "ESPN";
  return `<div class="drop" id="${id}"><div class="s" style="margin-bottom:4px">${src} · updated ${hm(S && S.injuriesUpdated)}</div>` + inj.map((p) => `<div class="drow"><span>${tlogo(p.t)}${esc(p.name)} <span class="dim">· ${esc(p.t)}</span></span><span class="${/out|doubtful/i.test(p.status) ? "r" : "y"}">${esc(p.status)} · ${p.ppg} ppg</span></div>`).join("") + `</div>`;
}
// 10/22 (owner: "only 1 information button next to the model header and it will explain everything in it"): one ⓘ per model section,
// a tap opens a short box right under the header (the tap is handled in public/shell.js). Model lines read white labels + colored numbers.
const IBTN = `<button class="ibtn" type="button" aria-label="What is this?"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.6"/><line x1="8" y1="7.2" x2="8" y2="11.4"/><circle cx="8" cy="4.8" r=".6" fill="currentColor"/></svg></button>`;
const ibox = (lines, st) => `<div class="ibox" hidden${st ? ` style="${st}"` : ""}>${lines.map(([k, t]) => `<div><b>${k}</b> ${t}</div>`).join("")}</div>`;
// 10/26 (owner, design = both sports): the game's own facts (nba/lib/why.js, `g.why`) on top of the MODEL ⓘ box -- + for the PICK's side, − against, · neither -- then the glossary
const whyMark = (s) => `<span class="wm${s > 0 ? " wf" : s < 0 ? " wa" : ""}">${s > 0 ? "+" : s < 0 ? "−" : "·"}</span>`;
function whyBox(g, kind, info) {
  const W = g && g.why ? g.why[kind] || [] : [];
  const own = W.length ? `<div class="wh">THIS GAME · + for the pick · − against</div>` + W.map(([k, t, s]) => `<div>${whyMark(s)}<b>${esc(k)}</b> ${esc(t)}</div>`).join("") + `<div class="wsep"></div>` : "";
  return `<div class="ibox" hidden>${own}${info.map(([k, t]) => `<div><b>${k}</b> ${t}</div>`).join("")}</div>`;
}
const MODEL_INFO = {
  spread: [["Model:", "the game model’s score guess. Data only."], ["Model (Team):", "team-stats model at Polymarket’s line. Data only on NBA, never the pick."],
    ["Pick:", "the bet at Polymarket’s main line, from a tested rule, else the model’s side. Green 56%+, light green 53–55%, yellow below."],
    ["Pick w/ points:", "same side with bought points that won 56%+."], ["MORE list:", "every line, both teams: points bought · history win % · Polymarket price."]],
  total: [["Model:", "the game model’s total points guess. Data only."], ["Pick:", "Over or Under at Polymarket’s main total, from a tested rule, else the model’s side. Green 56%+, light green 53–55%, yellow below."],
    ["Pick w/ points:", "same side with bought points that won 56%+."], ["MORE list:", "every line, Over and Under: points bought · history win % · Polymarket price."]],
  ml: [["Model:", "the model’s own chance each team wins."], ["PICK:", "the market’s favorite and its chance with Polymarket’s fee taken out."]],
};
const CARD_INFO = [["PICK:", "the card’s bet at Polymarket’s main line, locked at tip-off."], ["LINE MOVE / BOOK GAP / FATIGUE / ATS REGRESSION / SHOT QUALITY:", "the tested rules that named a PICK."],
  ["PICK w/ POINTS:", "the same side with bought points that won 56%+; none on the model-side total."], ["MODEL SIDE:", "no rule fired; the model’s side (about 50%)."],
  ["MONEYLINE:", "the market’s favorite to win."], ["GREEN 56%+:", "every pick shown green; “said” = the average % shown."], ["PRESEASON TEST:", "preseason games, not in the season record."]];
const SHADOW_INFO = [["Test picks,", "never shown on a card: recorded and graded live. One becomes a pick only after it holds 56%+ over about 100 games."],
  ["LINE MOVE:", "Pinnacle moved 3+ points; that side at the first number / at the number when seen."], ["INJURY:", "a star newly out; the healthy side at the open / when seen."],
  ["Gaps:", "Pinnacle or the sportsbooks 1+ point off Polymarket; their side at Polymarket’s number."],
  ["1H SPREAD:", "the first-half margin from the full-game line vs Polymarket’s first-half spreads, props rules (56%+ under 60¢, 65%+ from 60¢, 77¢ cap, priced under its %); last look before tip-off."],
  ["Props · 77¢+:", "prop rows at 65%+ the page hides because they cost 77¢ or more."], ["Props · star out:", "a 20+ ppg player out; his teammates’ points Over at the ~50¢ line."], ["Closing-line value:", "points gained vs the line at tip-off."]];
// 10/23 (owner: "make all the layout consistent"): the NFL game page -- SPREAD & ML in one card (Polymarket spread + moneyline, the sportsbook line,
// the model's spread lines, then the moneyline PICK), TOTALS in the other; POLYMARKET header with LIVE · 1s ago on its right; the tip-off line under it
const pmHead = (g) => `<div class="k pmk"><span>${pmLogo()}POLYMARKET</span>${g.inProgress && !isFinal(g) ? `<span class="pmt"><span class="r">LIVE</span>${S && S.now ? ` · ${ago(S.now)}` : ""}</span>` : ""}</div>`;
const ago = (iso) => { const sec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return sec < 60 ? sec + "s ago" : Math.round(sec / 60) + " min ago"; };
function tipLine(g, kind) {
  const c = g.inProgress && g.close; if (!c) return "";
  if (kind === "total") return c.tl != null ? `<div class="s dim" style="margin-top:6px">Tip-off: ${c.tl}</div>` : "";
  const sp = c.hs != null ? (c.hs <= 0 ? `${g.home} ${sgn(c.hs)}` : `${g.away} ${sgn(-c.hs)}`) : null;
  const ml = c.mlHome > 0 && c.mlHome < 1 ? (c.mlHome >= 0.5 ? `ML ${g.home} ${odds(toAm(c.mlHome))}` : `ML ${g.away} ${odds(toAm(1 - c.mlHome))}`) : null;
  return sp || ml ? `<div class="s dim" style="margin-top:6px">Tip-off: ${[sp, ml].filter(Boolean).join(" · ")}</div>` : "";
}
function mlPickLine(g) {   // the moneyline PICK under the spread lines (the market's chance, fee out)
  const k = g.ml; if (!k) return "";
  if (g.inProgress) { const L = g.locked && g.locked.ml && g.locked.ml.plain; if (!L) return "";
    const rs = L.result === "win" ? ' · <span class="g">W</span>' : L.result === "loss" ? ' · <span class="r">L</span>' : L.result === "push" ? " · push" : "";
    return `<div style="margin-top:4px"><b class="${clsOf(L.pct)}" style="font-size:13px"><span class="lbw">ML pick:</span> ${esc(L.label)} · ${hitTxt(L.pct, clsOf(L.pct))}</b>${rs}</div>`; }
  const pick = k.pick; if (!pick) return "";
  if (pick.tier === "test") return `<div style="margin-top:4px"><b style="font-size:13px;color:#b9a8ff"><span class="lbw">Test:</span> ${esc(pick.label)} · ${pick.pct}%</b></div>`;
  if (pick.tier !== "pick" && pick.tier !== "lean") return "";
  const c = clsOf(pick.pct), tx = hitTxt(pick.pct, c);
  return `<div style="margin-top:4px"><b class="${c}" style="font-size:13px"><span class="lbw">ML pick:</span> ${esc(pick.label)} · ${tx}</b></div>`;
}
// 10/28 (owner's game-page sketch, design = both sports): SPORTSBOOK | POLYMARKET side by side with the same rows -- SPREAD (one team per line) then
// MONEYLINE, OVER / UNDER on totals -- each sportsbook row on the line of its Polymarket row; no MARKET word (a blurred band in its place)
const mkGrid = (cells) => `<div class="mk mk3">${cells.map((c) => `<div>${c}</div>`).join("")}</div>`;
function marketCard(g, kind, id) {
  const p = g.poly || {}, B = g.books || {};
  const sp = (hs, ho, ao) => row("Spread", `${g.home} ${sgn(hs)} ${ho}`, "mkt") + row("", `${g.away} ${sgn(-hs)} ${ao}`, "mkt");
  const ml = (ho, ao) => row("Moneyline", `${g.home} ${ho}`, "mlc") + row("", `${g.away} ${ao}`, "mlc");
  const ou = (ln, o, u) => row(`Over ${ln}`, o, "mkt") + row(`Under ${ln}`, u, "mkt");
  const cells = kind === "spread"
    ? [`<div class="k">SPORTSBOOK</div>`, pmHead(g),
      B.spread ? sp(B.spread.homeSpread, odds(B.spread.home), odds(B.spread.away)) : row("Spread", "—", "mkt"), p.spread ? sp(p.spread.homeSpread, odds(toAm(p.spread.home)), odds(toAm(p.spread.away))) : row("Spread", "—", "mkt"),
      B.ml ? ml(odds(B.ml.home), odds(B.ml.away)) : row("Moneyline", "—", "mlc"), p.ml ? ml(odds(toAm(p.ml.home)), odds(toAm(p.ml.away))) : row("Moneyline", "—", "mlc")]
    : [`<div class="k">SPORTSBOOK</div>`, pmHead(g),
      B.total ? ou(B.total.line, odds(B.total.over), odds(B.total.under)) : row("Total", "—", "mkt"), p.total ? ou(p.total.line, odds(toAm(p.total.over)), odds(toAm(p.total.under))) : row("Total", "—", "mkt")];
  const info = kind === "spread" ? MODEL_INFO.spread.concat([["ML pick:", MODEL_INFO.ml[1][1]]]) : MODEL_INFO.total;
  return `<div class="card"><div class="inner">${id ? injDrop(g, id) : ""}<div class="bband"></div>${mkGrid(cells)}${tipLine(g, kind)}<div class="hd hm ihd">MODEL${IBTN}</div>${whyBox(g, kind, info)}${modelCell(g, kind)}</div></div>`;
}
// 10/17 (owner): the NBA photo behind every NBA page (a game page keeps its team colours)
function linesBg() { const p = $("panel-lines"); document.documentElement.classList.toggle("lines-on", !(p && p.classList.contains("on") && DETAIL)); }
// GAME PAGE TABS (10/27, owner; design = both sports, same as NFL): GAME LINES · PLAYER PROPS · PARLAYS under the game card, the prop kinds as plain-text sub tabs
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const GTABS = [["lines", "Game Lines"], ["props", "Player Props"], ["parlays", "Parlays"]];   // 10/28: GAME PROPS tab out -- only winning picks show, none of those markets has one
const GPROP_TABS = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["pra", "PRA"], ["stl", "Steals"], ["blk", "Blocks"]];
let GTAB = lsGet("gTab", "lines"), GPROP = lsGet("gProp:nba", "pts");
if (!GTABS.some(([k]) => k === GTAB)) GTAB = "lines";
if (!GPROP_TABS.some(([k]) => k === GPROP)) GPROP = "pts";
const gameTabs = () => `<div class="gtabs">${GTABS.map(([k, t]) => `<button class="gtab${GTAB === k ? " on" : ""}" type="button" data-gtab="${k}">${t}</button>`).join("")}</div>`;
const gameChips = () => `<div class="gchips">${GPROP_TABS.map(([k, t]) => `<button class="gchip${GPROP === k ? " on" : ""}" type="button" data-gprop="${k}">${t}</button>`).join("")}</div>`;
const gNone = (t) => `<div class="card" style="margin-top:10px"><div class="inner"><div class="s dim">${t}</div></div></div>`;
const etDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
let GPROPS = {}, GPROPS_LOADING = {};
function refreshDetail() { const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean); renderLines(); for (const id of open) { const e = $(id); if (e) e.classList.add("open"); } }
function loadGameProps(day) {
  if (GPROPS_LOADING[day]) return; GPROPS_LOADING[day] = true;
  fetch(`/api/nba/props?date=${day}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d && d.ok) GPROPS[day] = { d, t: Date.now() }; })
    .catch(() => {}).finally(() => { GPROPS_LOADING[day] = false; if (DETAIL && GTAB === "props") refreshDetail(); });
}
function gamePropsBody(g) {
  const day = g.start ? etDay(g.start) : null; if (!day) return gNone("None for this game.");
  const c = GPROPS[day]; if (!c || Date.now() - c.t > 5 * 60e3) loadGameProps(day);
  if (!c) return gNone("Loading…");
  const pg = (c.d.games || []).find((x) => x.game === g.key), picks = pg ? (pg.picks || []).filter((p) => p.stat === GPROP) : [];
  if (!picks.length) return gNone("None for this game.");
  const row = (p) => `<div class="pbl ppr${p.result === "W" ? " g" : p.result === "L" ? " r" : ""}"><span class="pp1">${p.result ? legMark(p.result) : "•"} ${esc(p.name)}</span><span class="pp2">${PROP_SHORT[p.stat] || ""} ${p.side === "over" ? "Over" : "Under"} ${p.line}</span>${propLast(p)}<span class="pp3 mod">${Math.round((p.cal ?? p.chance) * 100)}%</span><span class="pp4">${p.price != null ? `${Math.round(p.price * 100)}¢` : "—"}</span></div>`;
  const head = `<div class="pbl ppr pph"><span class="pp1">PLAYER</span><span class="pp2">LINE</span><span class="pp5">LAST</span><span class="pp3">MODEL</span><span class="pp4">${pmLogo()}POLYMARKET</span></div>`;
  const part = (t) => { const rs = picks.filter((p) => (p.team || "") === t); return rs.length ? `${t ? `<div class="pbl pteam">${tlogo(t)}${esc(t)}</div>` : ""}${rs.map(row).join("")}` : ""; };
  return `<div class="pgrid" style="margin-top:6px"><div class="par">${head}${[...new Set([g.away, g.home, ...picks.map((p) => p.team || "")])].map(part).join("")}</div></div>`;
}
function gameParlaysBody(g) {
  if (g.inProgress) return gNone("Same-game parlays close at tip-off; they are on Model bets with their results.");
  const blocks = (S.parlays || []).filter((p) => p.game === g.key).map((p) => pBlock(esc(PTYPES[p.type] || p.type), p, false)).join("");
  return blocks ? `<div class="pgrid" style="margin-top:6px">${blocks}</div>` : gNone("No same-game parlay for this game.");
}
// the game page chart (10/27, owner's pick: open chart, = NFL): Polymarket US's moneyline history for both teams, drawn by the shared shell
const chartOf = (g) => ({ key: g.key, sport: "nba", away: g.away, home: g.home, start: g.start, live: !!(g.inProgress && !isFinal(g)), ca: teamColor(g.away), ch: teamColor(g.home) });
function renderDetail(g) {
  $("lines").style.display = "none"; $("detail").style.display = ""; linesBg();
  document.body.classList.add("game-on");   // 10/18 (owner, same as NFL): the game card is the header; ← Games under it
  const co = chartOf(g), mk = typeof Shell !== "undefined" && Shell.mktLines;   // 10/27: the other Polymarket markets (halves, quarters, team totals, game / team props)
  const body = GTAB === "props" ? gameChips() + gamePropsBody(g) : GTAB === "parlays" ? gameParlaysBody(g)
    : secRow("SPREAD &amp; ML", injPill(g, "inj")) + marketCard(g, "spread", "inj") + secRow("TOTALS") + marketCard(g, "total") + (mk ? Shell.mktLines(co) : "");
  const was = $("detail").querySelector ? $("detail").querySelector(".grest") : null, keepY = was ? was.scrollTop : 0;
  // 10/28 (owner, design = both sports): the team card, the chart, ← Games and the tabs stay put (.gtop); only the part under them scrolls (.grest, Shell.pinGame)
  $("detail").innerHTML = `<div class="gtop">${typeof Shell !== "undefined" && Shell.chartBlock ? detailTop(g).replace('class="card dtop"', 'class="card dtop dblend"') + Shell.chartBlock(co) : detailTop(g)}<button class="back" id="back-btn">← Games</button>${gameTabs()}</div><div class="grest">${body}</div>`;
  if (typeof Shell !== "undefined" && Shell.chartLoad) Shell.chartLoad(co);
  $("back-btn").onclick = closeGame;
  setBg($("panel-lines").classList.contains("on") ? g : null);
  if (typeof Shell !== "undefined" && Shell.pinGame) Shell.pinGame($("detail"), keepY);
}
function openGame(key) { LASTY = window.scrollY || 0; DETAIL = key; renderLines(); window.scrollTo(0, 0); setTimeout(() => slotMoney($("detail")), 60); }
function closeGame() { if (typeof Shell !== "undefined" && Shell.chartStop) Shell.chartStop(); DETAIL = null; renderLines(); window.scrollTo(0, LASTY); }

// ---------- Best bets + Parlay: two gold tickets at the top of the Bets tab (tap one to open its list)
function bestBets() { return S ? S.bestBets || [] : []; }
function parlayPicks() { return S && S.parlay && S.parlay.length >= 2 ? S.parlay : []; }
const legLabel = (x) => `${tlogo(x.team || "")}${esc(x.label)}`;
function ticketRows() {   // 10/22 (owner: "Make all of this its own card ... No columns one card"): Best bets / Parlay as rows of the My bets top card; a tap opens the list under the card
  const B = bestBets(), P = parlayPicks(); if (!B.length && !P.length) return { rows: "", drops: "" };
  const ch = P.length ? Math.round(P.reduce((a, x) => a * (x.pct / 100), 1) * 100) : null;
  const bb = (x) => `<div class="bb"><div class="t1"><b class="g">${legLabel(x)}</b><span style="white-space:nowrap">wins <b class="g">${Math.round(x.pct)}%</b></span></div><div class="t2">${esc(x.game)} · ${tm(x.start)}${x.price ? ` · ${cents(x.price)}` : ""}</div></div>`;
  return { rows: (B.length ? `<div class="row mbt" data-drop="bestdrop"><span class="dim">Best bets</span><span>${B.length} green pick${B.length === 1 ? "" : "s"} <i class="car">▾</i></span></div>` : "") +
      (P.length ? `<div class="row mbt" data-drop="parlaydrop"><span class="dim">Parlay</span><span>${ch}% · all ${P.length} hit <i class="car">▾</i></span></div>` : ""),
    drops: (B.length ? `<div class="drop" id="bestdrop"><div class="card modelglow"><div class="inner">${B.map(bb).join("")}</div></div></div>` : "") +
      (P.length ? `<div class="drop" id="parlaydrop"><div class="card modelglow"><div class="inner">${P.map(bb).join("")}</div></div></div>` : "") };
}
// 10/27 (owner, = NFL): Profit as one big number on top, the record / open / stake line under it, then Best bets and the Parlay as plain rows
// 10/28 (owner): the profit and the top rows = one see-through card that stays put under the page title (.mbpin, Shell.pinTop)
const topCard = (rows, hero = "") => { const T = ticketRows(); return `<div class="mbpin">${hero}<div class="card mbtop"><div class="sec">${T.rows}${rows}</div></div></div>${T.drops}`; };

// ---------- Bets: My bets | Model bets
let BETSVIEW = (() => { try { return localStorage.getItem("betsView") === "model" ? "model" : "mine"; } catch { return "mine"; } })();
// 10/21 night (owner): a page's drop-downs go to the right of its title (Shell.dd); without the shell (tests) they stay on top of the block
function ddSlot(el, html) { if (typeof Shell !== "undefined" && Shell.dd && el && el.closest) { Shell.dd(el, html); return ""; } return html; }
function applyBetsView() {
  const bt = $("bets-title"); if (bt) bt.innerHTML = BETSVIEW === "model" ? "Model bets" : "My bets";   // 10/27: the parlay type is the chip under the switch
  const m = BETSVIEW === "model", set = (id, on) => { const e = $(id); if (e) e.style.display = on ? "" : "none"; };
  set("record-mine", !m); set("lab", m); set("dd-record-mine", !m); set("dd-lab", m);   // 10/17 (owner): the parlay types are menu sub tabs under Model bets

  document.querySelectorAll("#bets-sw [data-bv]").forEach((b) => b.classList.toggle("on", b.dataset.bv === BETSVIEW));
  if (m) renderLabList();
}
// Props (10/17, owner: its own page in the menu, between Game Lines and Bets, same as NFL's): Polymarket US lists no NBA player props yet, so the list is empty until it does
// PLAYER PROPS (10/20, owner: "Player props", same page as NFL's, design = both sports; bar 65%+ since 10/21, was 62%): one page per stat tab (Points, Rebounds, Assists, PRA,
// Threes, Steals, Blocks) -- /api/nba/props: the side the NBA prop model gives 65%+ on each recorded Polymarket line, one row per player and stat (its
// highest %), under the tip-off headers game by game, a day and a team drop-down, RECORD tile = this tab's graded rows, ✓ / ✗ green / red once graded.
let PROPS = null, PROPDAY = null, PROPTAB = "pts", PROPTEAM = "all";
const PROP_TABS = [["pts", "Points"], ["reb", "Rebounds"], ["ast", "Assists"], ["pra", "PRA"], ["stl", "Steals"], ["blk", "Blocks"]];
const PROP_SHORT = { pts: "Pts", reb: "Reb", ast: "Ast", pra: "PRA", "3pm": "3PM", stl: "Stl", blk: "Blk" };
async function loadProps() {
  try { const d = await (await fetch(`/api/nba/props${PROPDAY ? `?date=${PROPDAY}` : ""}`, { cache: "no-store" })).json(); if (d && d.ok) { PROPS = d; renderProps(); } } catch {}
}
// 10/20 night (owner): LAST = the player's most recent graded line of the same stat (U 29.5 ✓ 24)
const propLast = (p) => { const l = p.last; if (!l) return '<span class="pp5 dim">—</span>';
  if (l.line == null) return `<span class="pp5 dim">${l.actual != null ? Math.round(l.actual * 10) / 10 : "—"}</span>`;
  return `<span class="pp5 ${l.result === "W" ? "g" : "r"}">${l.side === "over" ? "O" : "U"} ${l.line} ${l.result === "W" ? "✓" : "✗"}${l.actual != null ? ` <span class="dim">${Math.round(l.actual * 10) / 10}</span>` : ""}</span>`; };
function renderProps() {
  const el = $("props"); if (!el) return;
  const tt = $("props-title"); if (tt) tt.innerHTML = `Player props<span class="ptab"> · ${esc((PROP_TABS.find(([k]) => k === PROPTAB) || [, "Points"])[1])}</span>`;
  const d = PROPS; if (!d) { el.innerHTML = '<div class="s dim" style="margin-top:12px">Loading…</div>'; return; }
  const days = d.days && d.days.length ? d.days : [d.date];
  const dsel = `<div class="wksel"><select id="props-day" aria-label="Day">${days.map((x) => `<option value="${x}"${x === d.date ? " selected" : ""}>${dayName(x)}</option>`).join("")}</select></div>`;
  const all = (d.games || []).map((g) => ({ ...g, picks: (g.picks || []).filter((p) => p.stat === PROPTAB) })).filter((g) => g.picks.length);
  const teams = [...new Set(all.flatMap((g) => g.picks.map((p) => p.team).filter(Boolean)))].sort();
  if (PROPTEAM !== "all" && !teams.includes(PROPTEAM)) PROPTEAM = "all";   // 10/27: a team chosen on another day / tab with no rows here would leave "None yet." under a drop-down reading "All teams"
  const tsel = `<div class="wksel"><select id="props-team" aria-label="Team"><option value="all"${PROPTEAM === "all" ? " selected" : ""}>All teams</option>${teams.map((t) => `<option value="${esc(t)}"${PROPTEAM === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
  const games = all.map((g) => ({ ...g, picks: PROPTEAM === "all" ? g.picks : g.picks.filter((p) => p.team === PROPTEAM) })).filter((g) => g.picks.length);
  const rc = (d.record || {})[PROPTAB] || null;
  const tile = `<div class="stats" style="margin-top:10px"><div class="stat"><div class="k">RECORD</div><div class="v ${rc && rc.pct >= 56 ? "g" : rc && rc.pct >= 53 ? "lg" : !rc || rc.pct == null ? "" : "y"}">${rc ? rc.w || 0 : 0}–${rc ? rc.l || 0 : 0}</div><div class="k2">${!rc || rc.pct == null ? "—" : rc.pct + "% won"}</div></div></div>`;
  // 10/20 (owner: "label these by Models Chance and Polymarket Prices ... separate them by teams"; the model % stays purple, owner: "keep all model purple"; design = both sports)
  const row = (p) => `<div class="pbl ppr${p.result === "W" ? " g" : p.result === "L" ? " r" : ""}"><span class="pp1">${p.result ? legMark(p.result) : "•"} ${esc(p.name)}</span><span class="pp2">${PROP_SHORT[p.stat] || ""} ${p.side === "over" ? "Over" : "Under"} ${p.line}</span>${propLast(p)}<span class="pp3 mod">${Math.round((p.cal ?? p.chance) * 100)}%</span><span class="pp4">${p.price != null ? `${Math.round(p.price * 100)}¢` : "—"}</span></div>`;
  const head = `<div class="pbl ppr pph"><span class="pp1">PLAYER</span><span class="pp2">LINE</span><span class="pp5">LAST</span><span class="pp3">MODEL</span><span class="pp4">${pmLogo()}POLYMARKET</span></div>`;
  const teamRows = (g) => [...new Set([g.away, g.home, ...g.picks.map((p) => p.team || "")])].map((t) => { const rs = g.picks.filter((p) => (p.team || "") === t); return rs.length ? `${t ? `<div class="pbl pteam">${tlogo(t)}${esc(t)}</div>` : ""}${rs.map(row).join("")}` : ""; }).join("");
  const slotTimes = {}; for (const g of games) if (g.start) { const sl = nbaSlot(g.start), t = tipTime(g.start); (slotTimes[sl] = slotTimes[sl] || []).includes(t) || slotTimes[sl].push(t); }
  let lastSlot = null;
  const blocks = games.map((g) => { const sl = g.start ? nbaSlot(g.start) : null, h = sl && sl !== lastSlot ? `<div class="sh labslot">${sl} <span class="lst">· ${slotTimes[sl].map(esc).join(" · ")}</span></div>` : ""; if (sl) lastSlot = sl;
    // 10/20 night (owner): a game being played says LIVE on its props block -- its rows are the copy locked at tip-off (a started game is never re-scored), graded from the box score
    return h + `<div class="par"><div class="pbh c"><span class="pbn">${gameLogos(g.game)}${g.start && !g.final && Date.parse(g.start) <= Date.now() ? ' <span class="lvb">● LIVE</span>' : ""}</span></div>${head}${teamRows(g)}</div>`; });
  el.innerHTML = ddSlot(el, dsel + tsel) + tile + (games.length ? `<div class="pgrid" style="margin-top:6px">${blocks.join("")}</div>` : '<div class="s dim empty" style="margin-top:12px">None yet.</div>');
  const pd = $("props-day"); if (pd && pd.tagName === "SELECT") pd.onchange = () => { PROPDAY = pd.value; loadProps(); };
  const ps = $("props-team"); if (ps && ps.tagName === "SELECT") ps.onchange = () => { PROPTEAM = ps.value; renderProps(); };
}
// 10/18 (owner): a Results page under Bets (the RESULT alert lines) was built and deleted the same day -- RESULT lines are saved (lib alerts listResults) but shown nowhere.
async function loadBets() {
  try { BETS = await (await fetch("/api/nba/mybets", { cache: "no-store" })).json(); } catch { BETS = { ok: false }; }
  try { const d = await (await fetch("/api/nba/modelbets", { cache: "no-store" })).json(); if (d && d.ok) MODELBETS = d; } catch {}
  renderBets(); renderLabList();
}
function renderBets() {
  const j = BETS; if (!j || !j.ok) { $("record-mine").innerHTML = topCard('<div class="s dim">Bets unavailable right now.</div>'); return; }
  $("upd-record").textContent = j.syncedAt ? "Synced " + hm(j.syncedAt) : j.keysSet ? "Not synced yet" : "Polymarket keys not set";
  // 10/17 (owner): a Polymarket combo lists its legs under it like NFL's (✓ / ✗, team logo, won leg green, lost leg red)
  // 10/18 (owner, same as NFL): an open bet whose game is being played says ● LIVE · Q3 6:30 (no scores); with 2+ live games each undecided leg carries its clock
  const liveSc = (k) => { const sc = k && NBL[k]; return sc && sc.st === "in" ? sc : null; };
  const liveOf = (e) => [...new Set((e.picks || []).map((p) => p.game).concat(e.prop && e.prop.game ? [e.prop.game] : []).filter((k) => liveSc(k)))];
  const legLost = (e) => !e.sold && !e.resolved && (e.picks || []).some((p) => p && p.result === "L");   // same as NFL: a combo with a lost leg is done
  const legRow = (p, lk = []) => `<div class="s" style="padding:0 0 0 16px">${p.result ? legMark(p.result) + " " : "• "}${legTxt(p.result, `${p.team ? tlogo(p.team) : ""}${esc(p.label)}`)}${p.kind === "total" && p.game ? ` <span class="dim">${gameLogos(p.game)}</span>` : ""}${lk.length > 1 && !p.result && liveSc(p.game) ? ` <span class="r lvb">· ${esc(liveSc(p.game).lbl || "")}</span>` : ""}</div>`;
  const betName = (e) => (e.picks && e.picks.length ? `${e.picks.length} picks` : e.prop ? `${e.prop.result ? legMark(e.prop.result) + " " : ""}${e.prop.team ? tlogo(e.prop.team) : ""}${esc(e.prop.label)}` : `${esc(e.title)}${e.outcome ? ` — ${esc(e.outcome)}` : ""}`);   // 10/27: a single player bet = the player + the bet
  const isSingle = (e) => !(e.picks && e.picks.length), firstSingles = (a) => [...a.filter(isSingle), ...a.filter((e) => !isSingle(e))];   // 10/27 (owner): singles on top, then the combos
  // 10/27 (owner: "make everything consistent"): the rows read like NFL's -- right side open / Won +$ / Lost −$ / Sold, under it "$cost at N¢ · pays $X if it wins"
  const state = (e, settled) => settled ? (e.result === "win" ? '<span class="g">Won</span>' : e.result === "loss" ? '<span class="r">Lost</span>' : `<span class="${e.pl >= 0 ? "g" : "r"}">Sold</span>`) + " " + cMoney(e.pl) : legLost(e) ? `<span class="r">Lost</span> ${cMoney(-(e.cost || 0))}` : '<span class="dim">open</span>';
  const sub = (e, settled) => `${money(e.cost)}${e.price ? ` at ${betCents(e.price)}¢` : ""} · ${settled && e.result === "sold" ? `sold early for ${money(Math.max(0, (e.cost || 0) + (e.pl || 0)))}` : !settled && legLost(e) ? `−${money(e.cost)}` : `pays ${money(e.shares)} if it wins`}`;
  const rowsOf = (a, settled) => a.map((e) => { const lk = settled ? [] : liveOf(e), lv = lk.length === 1 ? `<span class="r lvb">● LIVE · ${esc(liveSc(lk[0]).lbl || "")}</span> ` : lk.length ? '<span class="r lvb">● LIVE</span> ' : "";
    return `<div class="betwrap"><div class="row"><span>${betName(e)}${lv ? " " + lv.trim() : ""}</span><span>${state(e, settled)}</span></div>` +
    `${(e.picks || []).map((p) => legRow(p, lk)).join("")}<div class="s" style="padding:0 0 6px 8px">${sub(e, settled)}</div></div>`; }).join("");
  const open = [...document.querySelectorAll("#record-mine .drop.open")].map((e) => e.id);
  // 10/17 (owner: "make everything consistent"): a day drop-down like NFL's week drop-down.
  // 10/27 (owner: "This pop up don't even work"): it picked only which SETTLED bets sat inside the closed Settled fold, so a tap changed nothing on screen. Now
  // it works like NFL's week picker: the day's bets (open ones by their game day, settled ones by the day they closed), the record / profit / staked of
  // that day, a past day lists its results open, "Season" = all. The default is today.
  const etDay = (t) => (t ? new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null), today = etDay(new Date());
  const dayOf = (e) => (e.result ? etDay(e.closedAt || (e.resolved && e.resolved.t) || (e.sold && e.sold.t)) : ((e.picks || []).map((p) => p.date).filter(Boolean).sort()[0] || (e.prop && e.prop.date) || etDay(e.firstSeen)));
  const all = [...(j.open || []), ...(j.settled || [])];
  const days = [...new Set(all.map(dayOf).filter(Boolean).concat([today]))].sort();
  const sel = MBDAY === "all" || days.includes(MBDAY) ? MBDAY : today;
  const shown = all.filter((e) => sel === "all" || dayOf(e) === sel), openB = shown.filter((e) => !e.result && !legLost(e)), done = shown.filter((e) => e.result || legLost(e));
  const past = sel !== "all" && sel < today;
  const w = done.filter((e) => e.result === "win").length, l = done.filter((e) => e.result === "loss" || (!e.result && legLost(e))).length, sold = done.filter((e) => e.result === "sold").length;
  const pl = done.reduce((a, e) => a + (e.result ? e.pl : -(e.cost || 0)), 0), staked = done.reduce((a, e) => a + (e.cost || 0), 0), tot = w + l;
  const dayPick = `<div class="wksel"><select id="mb-day" aria-label="Day">${days.map((d) => `<option value="${d}"${sel === d ? " selected" : ""}>${dayName(d)}</option>`).join("")}<option value="all"${sel === "all" ? " selected" : ""}>Season</option></select></div>`;
  $("record-mine").innerHTML = ddSlot($("record-mine"), dayPick) + topCard(`<div class="row"><span class="dim">Staked</span><span>${money(staked)} · settled</span></div>`,
    `<div class="mbhero"><span class="lbl">Profit · ${sel === "all" ? "this season" : dayName(sel)}</span><b>${cMoney(pl)}</b>` +
    `<span class="sub"><span class="${tot ? (w / tot >= 0.5 ? "g" : "r") : "dim"}">${tot ? `${w}–${l}` : "0–0"}</span>${sold ? ` · ${sold} sold` : ""} · ${past ? `${shown.length} bet${shown.length === 1 ? "" : "s"}` : `${openB.length} open · ${money(openB.reduce((a, e) => a + (e.cost || 0), 0))} staked`}</span></div>`) +
    `<div class="card" style="margin-top:10px">` + (past || !openB.length ? "" : `<div class="sec"><div class="sh">Open</div>${rowsOf(firstSingles(openB), false)}</div>`) +
    `<div class="fold" data-drop="settled"><span>${past ? "Results" : "Settled bets"}</span><span>▾</span></div><div class="drop${past ? " open" : ""}" id="settled">${done.length ? rowsOf(done, true) : '<div class="s dim empty">None yet.</div>'}</div></div>` +
    `<div class="center"><button class="btn" id="sync-btn">↻ Sync account</button></div>`;
  for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
  const md = $("mb-day"); if (md && md.tagName === "SELECT") md.onchange = () => { MBDAY = md.value; renderBets(); };
  if (typeof Shell !== "undefined" && Shell.pinTop && $("record-mine").querySelector) Shell.pinTop($("record-mine").querySelector(".mbpin"));
  $("sync-btn").onclick = async () => { toast("Syncing…", 0); try { const d = await (await fetch("/api/nba/mybets?sync=1", { cache: "no-store" })).json(); BETS = d; renderBets(); toast(d.sync && d.sync.ok ? `Synced ${d.sync.positions} positions.` : `Sync: ${(d.sync && d.sync.note) || "done"}`); } catch (e) { toast("Sync failed: " + e.message, 10000); } };
}
// Model bets: day drop-down at the top, the types are menu sub tabs, one list in tip-off order (lib/parlays.js)
const PTYPES = { sgp: "Same game · 2 legs", best4: "Parlay · top picks", pp6: "Prop Parlays · 6 legs", pp8: "Prop Parlays · 8 legs", pp10: "Prop Parlays · 10 legs", sgp4: "Same Game · 4 legs" };   // 10/21 (owner): Prop Parlays, $5 each   // 10/19 review: bought lines (sgp_pts, not built since 10/19) off the scoreboard   // 10/19: 3 legs at most, the 4 biggest favorites (fav4) is no longer built
// 10/21 (owner): Model bets = Prop Parlays (6 Leg / 8 Leg / 10 Leg) then Same Game; the Parlay tab is gone (still saved and graded, on the scoreboard)
const LAB_TABS = [["pp6", "Prop Parlays · 6 Leg"], ["pp8", "Prop Parlays · 8 Leg"], ["pp10", "Prop Parlays · 10 Leg"], ["sgp4", "Same Game"]];   // 10/21: Same Game = the 4-leg same-game parlays (sgp4)
const isLabType = (tab, t) => t === tab;   // 10/19: the Bought tab left (PICK w/ POINTS only on the card)
let LABTYPE = "pp6", LABDAY = null;
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
  if (!p || p.result || !Array.isArray(p.legs) || p.legs.length < 2 || p.legs.some((l) => l.market === "prop")) return false;   // prop legs: no Polymarket combo quote, the PL line is the legs' prices
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
// 10/21 (the NFL page's one rounding rule, 10/19): a spread / total leg at 56%+ rounds, below 56 it rounds DOWN (a 55.6% leg never reads "56%"); a moneyline leg rounds
const legPct = (l) => { const v = (l.prob || 0) * 100, k = l.market || l.kind; return k === "spread" || k === "total" ? (v >= 56 ? Math.round(v) : Math.floor(v)) : Math.round(v); };
// 10/17 (owner): a won leg's text is green and a lost leg's red, like its ✓ / ✗ (logos keep their colors)
const legTxt = (r, html) => (r === "W" ? `<span class="g">${html}</span>` : r === "L" ? `<span class="r">${html}</span>` : html);
const gameLogos = (key) => { const m = String(key || "").match(/^([A-Z]{2,4}) @ ([A-Z]{2,4})$/); return m ? `<span class="gl">${tlogo(m[1])}${esc(m[1])} @ ${tlogo(m[2])}${esc(m[2])}</span>` : esc(key); };   // 10/22: one unit, never split across lines (NBA "CLE @" / "PHI")
// 10/22 (owner: "make this into a table format", design = both sports): every parlay is a small table -- LEG | MODEL | POLYMARKET heads, one row per leg,
// a last row with the payout (PL), the parlay's Model % and its result
// a player prop leg reads like the props rows: the player on top, the bet small under him ("Jaylen Brown" / "PRA Over 19.5")
const legCell = (l, plain) => { const nm = l.name || l.player, lb = String(l.label || "");
  return nm && lb.startsWith(nm + " ") && !/ TD$/.test(lb) ? legTxt(l.result, `${tlogo(l.team || "")}${esc(nm)}`) + `<div class="ptsub">${esc(lb.slice(nm.length + 1))}</div>` : legTxt(l.result, plain); };
const centsOf = (x) => (x > 0 && x < 1 ? `${Math.round(x * 100)}¢` : "—");
function pBlock(title, p, showGame) {
  if (!p || !Array.isArray(p.legs) || !p.legs.length) return "";
  const pr = typeof p.prob === "number" && isFinite(p.prob) ? p.prob : null;
  const head = `<div class="ptb pth"><span class="pt1">LEG</span><span class="pt2">MODEL</span><span class="pt3">${pmLogo()} POLYMARKET</span></div>`;
  const legs = p.legs.map((l) => `<div class="ptb${l.result === "W" || l.result === "win" ? " g" : l.result === "L" || l.result === "loss" ? " r" : ""}"><span class="pt1">${legMark(l.result)} ${legCell(l, `${tlogo(l.team || "")}${esc(l.label)}${l.bought ? ` · ${l.points} pt${l.points === 1 ? "" : "s"}` : ""}`)}${showGame && l.game ? ` <span class="dim">${gameLogos(l.game)}</span>` : ""}</span><span class="pt2 mod">${legPct(l)}%</span><span class="pt3">${centsOf(l.price)}</span></div>`).join("");
  const res = p.result === "W" ? '<span class="g">✓ Won</span>' : p.result === "L" ? '<span class="r">✗ Lost</span>' : p.result === "P" ? '<span class="dim">Push</span>' : "";
  const foot = `<div class="ptb ptf"><span class="pt1"><span class="plb"${plTap(p)}>${pmLogo()} ${plShown(p)}</span></span><span class="pt2 mod">${pr == null ? "—" : `${Math.round(pr * 100)}%`}</span><span class="pt3">${res}</span></div>`;
  return `<div class="par"><div class="pbh"><span class="pbn">${title}</span></div>${head}${legs}${foot}</div>`;
}
function labParlays(day, type) {
  const D = (MODELBETS && MODELBETS.days && MODELBETS.days[day]) || {}, rec = Object.keys(D).filter((t) => isLabType(type, t)).flatMap((t) => D[t]);
  const today = S && S.dates && S.dates.includes(day);
  const live = today ? (S.parlays || []).filter((p) => isLabType(type, p.type) && (p.game ? S.games.some((g) => g.key === p.game && g.date === day && !g.inProgress) : p.date ? p.date === day : day === S.dates[0])) : [];
  const out = live.map((p) => ({ p, start: p.start || (p.legs[0] && (S.games.find((g) => g.key === p.legs[0].game) || {}).start) || null, title: p.game ? gameLogos(p.game) : esc(PTYPES[p.type] || p.type), across: !p.game }));
  for (const r of rec) if (!out.some((x) => x.p.game === r.game && (r.game || x.p.type === r.type))) out.push({ p: r, start: r.start || null, title: r.game ? gameLogos(r.game) : esc(PTYPES[r.type] || r.type), across: !r.game });
  return out.sort((a, b) => (Date.parse(a.start || 0) || 0) - (Date.parse(b.start || 0) || 0) || a.p.legs.length - b.p.legs.length);
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
  $("lab").innerHTML = ddSlot($("lab"), chips) + (xs.length ? `<div class="pgrid" style="margin-top:6px">${blocks.join("")}</div>` : '<div class="s dim empty" style="margin-top:12px">None yet.</div>');
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
  const clvTile = `<div class="stat" style="grid-column:1/-1"><div class="k">LINE VALUE</div><div class="v ${av == null ? "dim" : av > 0 ? "g" : av < 0 ? "r" : "y"}">${av == null ? "—" : `${av > 0 ? "+" : av < 0 ? "−" : ""}${Math.abs(av).toFixed(2)}`}</div><div class="k2">${av == null ? "—" : `pts vs close · beat it ${V.beatPct}% · ${plural(V.n, "pick")}`}</div></div>`;
  return `<div class="stats">${statTile("MONEYLINE", rc.ml, "right")}${statTile("SPREAD PICKS", rc.spread, "covered")}${statTile("TOTAL PICKS", rc.total, "right")}${clvTile}</div>`;
}
// 10/22 (owner: "MAKE IT LOOK LIKE A TABLE LIST ... words on one side and numbers on the other ... percentages in a vertical line"): a Models row = the
// name on the LEFT (+ a small line under it), its numbers in fixed columns on the right under a small header, like the Player props rows. Both sports.
const tHead = (h, cls = "") => `<div class="row trow th t${h.length} ${cls}"><span></span>${h.map((x) => `<span>${x}</span>`).join("")}</div>`;
const tRow = (lab, sub, cells, cls = "") => `<div class="row trow t${cells.length} ${cls}"><span>${lab}${sub ? `<i class="tsub">${sub}</i>` : ""}</span>${cells.map((c) => `<span>${c}</span>`).join("")}</div>`;
const recRow = (lab, e, said = false) => (e ? tRow(lab, [said && e.said != null ? `said ${e.said}%` : "", e.pending ? `${e.pending} pending` : "", !(e.w + e.l) && !e.pending ? "waiting" : ""].filter(Boolean).join(" · "),
  [e.w + e.l ? `${e.w}–${e.l}${e.push ? "–" + e.push : ""}` : '<span class="dim">—</span>', e.w + e.l ? `<b>${e.pct}%</b>` : '<span class="dim">—</span>', e.per100 != null ? `<span class="${e.per100 >= 0 ? "g" : "r"}">${e.per100 >= 0 ? "+" : "−"}$${Math.abs(e.per100)}</span>` : '<span class="dim">—</span>']) : "");
const REC_HEAD = tHead(["RECORD", "WIN %", "PER $100"]);
function paint(html) {
  return html.replace(/>([^<>]+)</g, (all, t) => ">" + t
    .replace(/(^|[^\d/.])(\d{1,4})–(\d{1,4})(?![\d/%])/g, (m, pre, w, l) => { const n = +w + +l; if (!n) return m; const r = +w / n; return `${pre}<b class="${r >= 0.55 ? "g" : r >= 0.5 ? "y" : "r"}">${w}–${l}</b>`; })
    .replace(/\b(OK|all clear|saved|answering|published|none)\b/g, '<span class="g">$1</span>') + "<");
}
function winnersBox() {
  const list = (S ? S.games : []).filter((g) => !g.inProgress).map((g) => { const w = mktWin(g); if (!w || w.home === 0.5) return null; const home = w.home > 0.5; return { team: home ? g.home : g.away, opp: home ? g.away : g.home, p: home ? w.home : w.away, price: g.poly.ml[home ? "home" : "away"] }; }).filter(Boolean).sort((a, b) => b.p - a.p);
  return list.length ? tHead(["WIN", "PRICE"]) + list.map((x, i) => tRow(`${i + 1}. ${tlogo(x.team)}<b>${esc(x.team)}</b> <span class="dim">over ${esc(x.opp)}</span>`, "", [`${Math.round(x.p * 100)}%`, x.price ? cents(x.price) : "—"])).join("") : '<div class="s dim">No lines yet.</div>';
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
// 10/28 (owner: "If there's a time and date. Put it last"): a System line that starts with a date / time ("Mon, 10/26, 5:40 PM · ...") gets the date moved to its end
const dateLast = (v) => { const one = (x) => { const m = /^((?:[A-Za-z]{3}, )?\d{1,2}\/\d{1,2},? \d{1,2}:\d{2}\s?[AP]M) · ([\s\S]+)$/.exec(x); return m ? `${m[2]} · ${m[1]}` : x; };
  const s = String(v); return /<div/.test(s) ? s.replace(/(<div[^>]*>)([\s\S]*?)(<\/div>)/g, (_, a, b, c) => a + one(b) + c) : one(s); };
function renderModels() {
  const j = MODELS; if (!j || !j.ok) { $("models").innerHTML = '<div class="s dim" style="margin-top:12px">Models unavailable right now.</div>'; return; }
  const r = j.report, rb = j.rebuild, rc = j.record || {}, mv = j.moves || {}, pl = j.parlays || {}, sy = j.system || null;
  $("upd-models").textContent = `Updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const open = [...document.querySelectorAll("#models .drop.open")].map((e) => e.id);
  // parlay scoreboard (first, closed): this season's W-L, hit %, said %, money; past = tested history
  const PH = { best4: null, sgp: null };
  const board = `<div class="s"><b>This season · hit vs said · money · past</b></div>` + Object.entries(PTYPES).map(([k, lab]) => { const b = pl[k];
    return `<div class="row"><span>${esc(lab)}</span><span>${b && b.decided ? `${b.hits}–${b.decided - b.hits} · ${b.pct}% <span class="dim">said ${b.said}%</span> <span class="${b.money >= 0 ? "g" : "r"}">${b.money >= 0 ? "+" : "−"}$${Math.abs(Math.round(b.money))}</span>` : b && b.pending ? `<span class="dim">${plural(b.pending, "open")}</span>` : '<span class="dim">waiting</span>'}${PH[k] ? ` · <span class="dim">${PH[k]}</span>` : ""}</span></div>`; }).join("");
  // card picks: PICK (rule / model side), PICK w/ POINTS, moneyline; shadow trackers below
  const cardRows = `<div class="s ihd"><b>Card picks</b>${IBTN}</div>` + ibox(CARD_INFO) + REC_HEAD + recRow("PICK · spread", rc["cardpick|spread"]) + recRow("LINE MOVE · spread", rc["rule:linemove|spread"]) + recRow("BOOK GAP · spread", rc["rule:bookgap|spread"]) + recRow("FATIGUE · spread", rc["rule:fatigue|spread"]) + recRow("ATS REGRESSION · spread", rc["rule:atsreg|spread"]) + recRow("PICK w/ POINTS · spread", rc["ptspick|spread"]) + recRow("PICK · total", rc["cardpick|total"]) + recRow("TOTAL MOVE · total", rc["rule:linemove|total"]) + recRow("BOOK GAP · total", rc["rule:bookgap|total"]) + recRow("SHOT QUALITY · total", rc["rule:shotq|total"]) + recRow("PICK w/ POINTS · total", rc["ptspick|total"]) +
    recRow("MODEL SIDE · spread", rc["modelpick|spread"]) + recRow("MODEL SIDE · total", rc["modelpick|total"]) + recRow("MONEYLINE", rc.ml) + recRow("GREEN · 56%+", rc.green, true) + recRow("PRESEASON TEST", rc.test, true) +
    `<div class="s ihd"><b>Shadow trackers</b>${IBTN}</div>` + ibox(SHADOW_INFO) + REC_HEAD + recRow("LINE MOVE · at the open", mv.all) + recRow("LINE MOVE · at the number seen", mv["now:all"]) + recRow("INJURY · at the open", mv.inj) + recRow("INJURY · at the number seen", mv["now:inj"]) + recRow("Pinnacle vs Polymarket gap", mv.gap) + recRow("Books vs Polymarket gap", mv.bgap) + recRow("TIRED + STAR OUT · fade", mv.tired) + recRow("BIG DOG vs a tired favorite", mv.dogvtired) + recRow("RESTED vs STAR OUT", mv.restvstar) + recRow("RESTED road favorite", mv.restfav) + recRow("RESTED · from mid-February", mv.restlate) + recRow("MODEL TOTAL 8+ · from March", mv.mtotlate) + recRow("MODEL TOTAL 8+ under · star out", mv.mtotstar) + recRow("1H SPREAD · props rules", mv.h1spr) +
    recRow("Props · 77¢+ hidden rows", (j.props || {}).dear || { w: 0, l: 0 }) + recRow("Props · star out → teammates Over", (j.props || {}).star || { w: 0, l: 0 }) +
    (j.clv && j.clv.n ? `<div class="row"><span class="dim">Closing-line value</span><span>${j.clv.avg > 0 ? "+" : ""}${j.clv.avg} pts · beat the close ${j.clv.beatPct}% of ${j.clv.n}</span></div>` : "");
  const accRows = r ? r.rows.map((x) => `<div class="row"><span class="dim">${esc(x.model)}</span><span>ours <b>${x.ours_same_games}</b> · market <b class="mkt">${x.market}</b> <span class="${x.ours_same_games <= x.market ? "g" : "r"}">${x.ours_same_games <= x.market ? "better" : "worse"}</span></span></div>`).join("") +
    (r.spread_side ? `<div class="row"><span class="dim">Model's spread side</span><span>${r.spread_side.overall}% <span class="dim">break-even ${r.spread_side.break_even}%</span></span></div>` : "") + (r.total_side ? `<div class="row"><span class="dim">Model's total side</span><span>${r.total_side.overall}%</span></div>` : "") +
    `<div class="row" style="grid-column:1/-1"><span class="dim">Win chance check</span><span>${r.win_calibration.map((x) => `said ${x.said}: won ${x.home_won}% (${x.games})`).join(" · ")}</span></div>` +
    `<div class="row"><span class="dim">Trained on</span><span>${esc(r.trained_on)}</span></div><div class="row"><span class="dim">Injuries from</span><span>${esc(r.injury_basis || "who actually sat")}</span></div>` : '<div class="s dim">No report yet.</div>';
  const when = (t) => (t ? hm(t) : "—"), snapAge = sy && sy.lastSnapshot ? Date.now() - new Date(sy.lastSnapshot.t) : null;
  const watch = sy ? sy.watch || [] : [];
  const sysRows = sy ? watch.map((x) => `<div class="s y" style="grid-column:1/-1">⚠ ${esc(x)}</div>`).join("") + [
    ["Last snapshot", sy.lastSnapshot ? `${when(sy.lastSnapshot.t)} · ${plural(sy.lastSnapshot.games, "game")}${snapAge > 10 * 3600e3 ? ' <span class="y">(stale)</span>' : ""}` : '<span class="y">none yet</span>'],
    ["Model service (Railway)", sy.railway && sy.railway.ok ? `answering · ${sy.railway.ms} ms` : `<span class="r">NOT answering${sy.railway && sy.railway.code ? " (HTTP " + sy.railway.code + ")" : ""}</span>`],
    ["Pinnacle lines", sy.pinnacle ? when(sy.pinnacle) : '<span class="y">no good pull yet</span>'],
    ["Lined games this season", sy.railway && sy.railway.lines ? `${sy.railway.lines.lined} of ${sy.railway.lines.games} · ${sy.railway.lines.polymarket} from Polymarket${sy.railway.lines.last ? " · newest " + sy.railway.lines.last : ""}` : "—"],
    ["Database", sy.db ? (sy.db.writeOk === false ? `<span class="r">refusing writes: ${esc(sy.db.err || "")}</span>` : `${sy.db.usedMb != null ? sy.db.usedMb + (sy.db.capMb ? " of " + sy.db.capMb : "") + " MB" : "—"} · ${sy.db.writeOk ? "saving" : "—"}`) : "—"],
    ["Stored items", sy.keys != null ? String(sy.keys) : "—"],
    ["Last backup", sy.backup ? `${when(sy.backup.t)} · ${sy.backup.where === "volume" ? "saved" : sy.backup.where === "failed" ? '<span class="r">failed</span>' : '<span class="y">temporary</span>'}` : '<span class="y">none yet</span>'],
    ["Sportsbook credits left", S && S.books && S.books.remaining != null ? String(S.books.remaining) : "—"],
    ["Player prop lines recorded", sy.props && sy.props.days ? `${plural(sy.props.days, "game day")} · last ${when(sy.props.latest || sy.props.lastDay)}` : "none yet"],   // 10/20: nba/lib/props.js background recorder (nothing shown yet)
    ["Last rebuild", rb ? `${when(rb.at)} · ${rb.published ? "published" : `<span class="y">held: ${esc((rb.failed_checks || []).join("; "))}</span>`}` : "not yet"],
    ["Errors (last 2 days)", (sy.errors || []).length ? sy.errors.slice(0, 6).map((e) => `<div class="y">${when(e.t)} · ${esc(e.where)}: ${esc(e.msg)}</div>`).join("") : "none"],
  ].map(([a, b]) => `<div class="row"${/<div/.test(String(b)) ? ' style="grid-column:1/-1"' : ""}><span class="dim">${a}</span><span>${dateLast(b)}</span></div>`).join("") : '<div class="s dim">Status unavailable.</div>';
  const sysBad = !sy || !sy.railway || !sy.railway.ok || (sy.errors || []).length > 0 || watch.length > 0;
  $("models").innerHTML = labStats(rc, j.clv) +
    mSec("m-line", "1 · Card picks", cardRows) +   // 10/19: same order as NFL -- card picks, winners, parlays first
    mSec("m-win", "2 · Winners · moneyline", winnersBox()) +
    mSec("m-board", "3 · Parlay scoreboard", board) +
    mSec("m-acc", "4 · Accuracy vs the market", accRows) +
    mSec("m-fut", `5 · Futures · ${FUT && FUT.ok ? FUT.season : "season simulation"}`, futuresRows()) +
    mSec("m-sys", "6 · System", sysRows, watch.length, sysBad);
  $("models").innerHTML = paint($("models").innerHTML);
  for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
}

// ---------- Alerts
let ALERTS = [], ALPREV = null;
const ALK = { PICK: ["New pick", "var(--green)"], "LINE MOVE": ["Line move", "#fff"], INJURY: ["Injury", "var(--red)"] };   // injury red, line move white; Result is cut (10/18)
// 10/23: NBA keeps its own "read" mark -- one shared key let opening the NFL alerts mark the NBA ones read (and back); the old shared mark seeds it once
const AL_KEY = "alSeen:nba";
const alSeen = () => { try { let v = localStorage.getItem(AL_KEY); if (v == null) { v = localStorage.getItem("alSeen") || ""; localStorage.setItem(AL_KEY, v); } return v; } catch { return ""; } };
async function loadAlerts() {
  try { const d = await (await fetch("/api/nba/alerts", { cache: "no-store" })).json(); if (d.ok) { ALERTS = d.alerts || []; renderAlerts(); } } catch {}
}
// 10/20 night (owner: "add the logos here too ... make the app consistent"): the alert's game line carries both team logos, like the parlay headers
const alGameLogos = (game) => { const m = /^(\S+) @ (\S+)$/.exec(String(game || "")); return m ? `${tlogo(m[1])}${esc(m[1])} @ ${tlogo(m[2])}${esc(m[2])}` : esc(game); };
function renderAlerts() {
  const dots = ALPREV != null ? ALPREV : alSeen(), unread = ALERTS.filter((a) => a.t > alSeen()).length;
  Shell.setCount("nba", "alerts", unread);
  const list = ALERTS.filter((a) => ALK[a.kind]);
  $("alerts").innerHTML = list.length ? list.map((a) => { const [lab, col] = ALK[a.kind] || [a.kind, "var(--dim)"];
    const ic = a.kind === "INJURY" && a.team ? tlogo(a.team) : a.kind === "LINE MOVE" ? pmLogo() : "";
    return `<div class="card al${a.t > dots ? " un" : ""}" data-algame="${esc(a.game || "")}"><span class="dot"></span><div style="flex:1"><div class="kd" style="color:${col}"><span>${ic}${lab.toUpperCase()}</span><span class="dim" style="font-weight:600;letter-spacing:0">${hm(a.t)}</span></div>` +
      `<div class="ti">${esc(a.title)}</div>${a.sub ? `<div class="su">${esc(a.sub)}</div>` : ""}${a.game ? `<div class="algame">${alGameLogos(a.game)} ›</div>` : ""}</div></div>`; }).join("") :
    '<div class="card" style="margin-top:10px"><div class="inner"><div class="s dim">No alerts.</div></div></div>';
}

// ---------- plumbing
async function loadSlate() {
  const r = await fetch("/api/nba/slate", { cache: "no-store" }), j = await r.json();
  if (!j.ok) throw new Error(j.error || "error");
  const build = r.headers.get("x-build"); if (window.__build && build && build !== window.__build) return location.reload(); window.__build = build;
  S = j; TEAMS = j.teams || TEAMS;
  const open = [...document.querySelectorAll(".drop.open")].map((e) => e.id).filter(Boolean);
  tickCd(); renderLines(); loadLiveScores(); if ($("panel-record").classList.contains("on")) { renderBets(); renderLabList(); }
  if ($("panel-props") && $("panel-props").classList.contains("on") && typeof renderProps === "function") renderProps();   // 10/20 night: logos come with the slate's team list
  for (const id of open) { const e = $(id); if (e) e.classList.add("open"); }
  try { localStorage.setItem("lastSeen", new Date().toISOString()); } catch {}
}
function showPanel(name) {
  setTimeout(() => slotMoney($("panel-" + String(name).split("-")[0])), 80);   // dollar amounts roll in when a page opens (owner 10/18 night)
  let sub = null;   // 10/17 (owner): My bets and Model bets are separate pages under Bets in the menu
  if (/^modelbets-/.test(name)) { const k = name.slice(10); if (LAB_TABS.some(([t]) => t === k)) LABTYPE = k; name = "modelbets"; }   // 10/17 (owner): the parlay types are menu sub tabs under Model bets
  if (name === "modelbets") sub = `modelbets-${LABTYPE}`;
  if (/^props-/.test(name)) { const k = name.slice(6); if (PROP_TABS.some(([t]) => t === k)) PROPTAB = k; name = "props"; }   // 10/20 (owner): the Player props stat tabs are menu sub tabs
  if (name === "props") sub = `props-${PROPTAB}`;
  if (name === "mybets" || name === "modelbets") { sub = sub || name; BETSVIEW = name === "modelbets" ? "model" : "mine"; try { localStorage.setItem("betsView", BETSVIEW); } catch {} name = "record"; }
  if (name === "record" && !sub) sub = BETSVIEW === "model" ? `modelbets-${LABTYPE}` : "mybets";
  if (!$("panel-" + name)) name = "lines";
  Shell.setActive(sub || name);   // 10/17: the menu replaces the tab bar
  document.body.classList.toggle("game-on", name === "lines" && !!DETAIL);
  if (name === "alerts") { ALPREV = alSeen(); if (ALERTS.length) { try { localStorage.setItem(AL_KEY, ALERTS[0].t); } catch {} } }
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("on")); $("panel-" + name).classList.add("on");
  if (name === "alerts") renderAlerts();
  try { window.scrollTo(0, 0); } catch {}
  if (name === "models") loadModels();
  if (name === "record") { loadBets(); applyBetsView(); }
  if (name === "props") { renderProps(); loadProps(); }   // 10/20 (owner): Player props, one page per stat tab
  if (S) setBg(name === "lines" && DETAIL ? S.games.find((x) => x.key === DETAIL) : null);
  linesBg();
}
// 10/17: pages switch by the address' #name (the menu links set it): #alerts, #lines, #record, #models; #game=KEY opens a game (from the home screen)
const PANELS = ["alerts", "lines", "record", "mybets", "modelbets", "props", ...LAB_TABS.map(([k]) => `modelbets-${k}`), ...PROP_TABS.map(([k]) => `props-${k}`), "models"];
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
  const gtb = e.target.closest("[data-gtab]"); if (gtb) { GTAB = gtb.dataset.gtab; lsSet("gTab", GTAB); refreshDetail(); return; }   // 10/27: game page tabs
  const gpr = e.target.closest("[data-gprop]"); if (gpr) { GPROP = gpr.dataset.gprop; lsSet("gProp:nba", GPROP); refreshDetail(); return; }
  const gt = e.target.closest("[data-game]"); if (gt) { if (!$("panel-lines").classList.contains("on")) showPanel("lines"); openGame(gt.dataset.game); return; }
  const al = e.target.closest("[data-algame]"); if (al) { const k = al.dataset.algame; if (k && S && S.games.some((x) => x.key === k)) { showPanel("lines"); openGame(k); } return; }
  const bv = e.target.closest("[data-bv]"); if (bv) { history.replaceState(null, "", bv.dataset.bv === "model" ? "#modelbets" : "#mybets"); routeHash(); return; }   // 10/22: My bets | Model bets inside Bets -- the page key follows, so the sub-tab bar does too
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
loadSlate().then(() => { autoRefresh(); catchUp(); plAuto(); setTimeout(() => slotMoney($("panel-lines")), 120); if (OPEN_GAME) routeHash(); }).catch((e) => toast("Couldn't load: " + e.message, 12000));
