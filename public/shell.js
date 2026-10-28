// SLATEZZ shell (10/17, owner; 10/22: a pinned top bar + a bottom bar instead of the side menu), the refresh button (reruns BOTH models), the
// drop-down slot of the page titles and the logo helpers. Loaded by /index.html (NFL + home) and /nba/index.html before each page's app.js.
// Pages: #lines (= Home; none = Home) #alerts #td #props-<tab> #mybets #modelbets #models on /index.html (NFL) and /nba/index.html (NBA).
// (10/22: Bets holds My bets | Model bets; the Model bets types and the Player props tabs are the sub-tab bar above the bottom bar.)
// 10/27 (owner: "New order for the bottom tab: Home -- Game Lines should be in here split by NFL and NBA, make it like Polymarket ... remove the football
// and basketball switch" + "Home / Bets / Model. remove the model tabs in home and make it its own"): the bottom bar is Home · Bets · Model; Home is the
// games list with NFL | NBA tabs as its title, Model the Models page with the same tabs; the ball switch, Lines and Props buttons and the Models bar are gone.
(function () {
  const ICON = {
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    grid: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 12h17M12 4.5v15"/>',
    td: '<circle cx="12" cy="7" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
    bets: '<path d="M4 7a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17v-2.5a2.5 2.5 0 0 0 0-5z"/>',
    bars: '<path d="M6 20V11M12 20V5M18 20v-6"/>',
    props: '<path d="M4 17l5-6 4 4 7-9"/><path d="M15 6h5v5"/>',
    model: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  };
  const svg = (k, w = 17) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  // 10/21 night (owner: "Bold the title across the top and remove the buttons"): the top bar is SLATEZZ (as big as fits) + the bell at the right; the refresh
  // icon moved to the right of the page headers over its time, Models to a two-half NFL | NBA bar on Home only.
  // 10/22 (owner: "make it like a real app" -> option K + Home, sketches claude.ai/artifact/2BKAuErJmQaTMpCR8JrmJj): the side menu is gone. A pinned bar
  // on top (SLATEZZ, the bell, Models, the refresh ring) and a bar at the bottom: Home · Lines · [NFL / NBA] · Props · Bets; the round button in the
  // middle switches the sport. Pages with sub tabs (Player props, Model bets) get their tabs in a bar right above it. Both sports.
  // 10/20 (owner: "rename it player props and have the sub tabs ... ANYTIME TD should be a sub tab under props"): the stat tabs, one page each
  const PROPS = { nfl: [["td", "Anytime TD"], ["props-first", "First TD"], ["props-recyds", "Rec Yds"], ["props-rec", "Receptions"], ["props-rushyds", "Rush Yds"]],
    nba: [["props-pts", "Points"], ["props-reb", "Rebounds"], ["props-ast", "Assists"], ["props-pra", "PRA"], ["props-stl", "Steals"], ["props-blk", "Blocks"]] };
  const URL_ = { nfl: "/index.html", nba: "/nba/index.html" };
  // the Model bets parlay types (10/20 night: Over/Under and Spread + Total removed; 10/21: NBA Prop Parlays 6 / 8 / 10 legs + Same Game; 3 legs at most elsewhere)
  const TYPES = { nfl: [["best", "Best Legs"], ["3", "3 Leg"], ["2", "2 Leg"], ["pp6", "6 Leg"], ["pp8", "8 Leg"], ["pp10", "10 Leg"]],
    nba: [["pp6", "6 Leg"], ["pp8", "8 Leg"], ["pp10", "10 Leg"], ["sgp4", "Same Game"]] };
  const OTHER = { nfl: "nba", nba: "nfl" };
  const REF_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  // which bottom tab a page belongs to; the sub tabs a page shows
  const tabOf = (p) => p === "home" || p === "lines" ? "home" : p === "models" ? "model" : p === "mybets" || /^modelbets/.test(p) || p === "record" ? "bets" : "";
  const subsOf = (sp, p) => p === "td" || /^props-/.test(p) ? PROPS[sp].map(([id, l]) => [id, l]) : /^modelbets-/.test(p) ? TYPES[sp].map(([k, l]) => [`modelbets-${k}`, l]) : null;
  const NFL_LOGO_FIX = { WSH: "wsh", WAS: "wsh", LA: "lar", LAR: "lar" };
  const Shell = {
    sport: "nfl", panel: "lines",
    nflLogo: (t) => (String(t || "").toUpperCase() === "KC" ? "/kc.png?v=1" : t ? `https://a.espncdn.com/i/teamlogos/nfl/500/${NFL_LOGO_FIX[t] || String(t).toLowerCase()}.png` : ""),
    nbaLogo: (t, teams) => (teams && teams[t] && teams[t].logo) || (t ? `https://a.espncdn.com/i/teamlogos/nba/500/${String(t).toLowerCase()}.png` : ""),
    img: (src) => (src ? `<img src="${src}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="nl"></span>'),
    // 10/21 night (owner: "If there's a drop down menu, put it on the right side"): a page's drop-downs (week / day / team) go in a slot on the
    // right of its title, one slot per content block (My bets and Model bets share a panel), shown only while that block is shown
    dd(el, html) {
      if (!el || !el.id) return; const head = el.closest(".panel") && el.closest(".panel").querySelector(".phead"); if (!head) return;
      let slot = document.getElementById("dd-" + el.id);
      if (!slot) { slot = document.createElement("div"); slot.className = "pdd"; slot.id = "dd-" + el.id; head.appendChild(slot); }
      slot.innerHTML = html || ""; slot.style.display = el.style.display === "none" ? "none" : "";
    },
    // countdown text: "1d 1h 7m", "2h 14m", "26m", "45s"
    setActive(panel) {
      Shell.panel = panel; const sp = Shell.sport, t = tabOf(panel);
      if (typeof setTimeout === "function") setTimeout(() => { if (TOPS) TOPS.forEach(topSize); }, 60);
      if (!document.querySelectorAll) return;
      document.querySelectorAll("#bnav [data-b]").forEach((a) => a.classList.toggle("on", a.dataset.b === t));
      document.querySelectorAll("#tbar [data-pg]").forEach((a) => a.classList.toggle("on", a.dataset.pg === panel));
      // 10/27 (owner: "organize or fix these ... change the layout if you need to"): the Model bets types and the Player props tabs are chips under the
      // page title (like the game page's), no longer a strip behind the bottom bar
      const subs = subsOf(sp, panel), html = subs ? subs.map(([id, l]) => `<a class="gchip${id === panel ? " on" : ""}" data-nav href="${URL_[sp]}#${id}">${l}</a>`).join("") : "";
      document.querySelectorAll(".phead").forEach((h) => { let c = h.querySelector(".phchips"); if (!c && html) { c = document.createElement("div"); c.className = "gchips phchips"; h.appendChild(c); } if (c) { c.innerHTML = html; c.style.display = html ? "" : "none"; } });
      // the NFL | NBA row opens Home on the other sport
      const same = panel === "home" ? "lines" : /^modelbets/.test(panel) ? "modelbets" : panel === "record" ? "mybets" : panel;
      document.querySelectorAll(".lgt[data-sp]").forEach((a) => a.setAttribute("href", `${URL_[a.dataset.sp]}#${same}`));
      Shell.choose(sp);   // Home and Model open on the sport last chosen
      document.body.classList.toggle("tbar-on", panel === "lines");   // 10/27 (owner): the SLATEZZ bar is on Home only
    },
    counts: {},
    setCount(sp, id, n) { Shell.counts[`${sp}-${id}`] = n; const e = document.getElementById(`mcnt-${sp}-${id}`); if (!e) return; e.textContent = n > 9 ? "9+" : String(n || ""); e.style.display = n ? "flex" : "none"; },
    // the sport last chosen is kept per phone (a fresh start lands on its Home); the alerts "read" mark is kept per sport
    SPORT_KEY: "slz-sport", seenKey: (sp) => (sp === "nba" ? "alSeen:nba" : "alSeen"),
    chosen() { try { const v = localStorage.getItem(Shell.SPORT_KEY); return v === "nba" || v === "nfl" ? v : null; } catch { return null; } },
    choose(sp) { try { localStorage.setItem(Shell.SPORT_KEY, sp); } catch {} },
    // the NFL | NBA tabs that title Home and Model (10/27): the same page on each sport, the one open in white
    // (owner 10/27, Polymarket's phone app: the category row -- an icon over its name, the open one in a rounded square)
    leagueTabs(sp, page) { return ["nfl", "nba"].map((x) => `<a class="lgt${x === sp ? " on" : ""}" data-sp="${x}" data-nav href="${URL_[x]}#${page}"><i><img src="/ball-${x}.png?v=1" alt=""></i><span>${x.toUpperCase()}</span></a>`).join(""); },
    open() {}, close() {},   // (the side menu is gone 10/22)
    // the hash names the page ("#lines"); none = Home (the games list)
    hashPanel(valid, fallback) { const h = (location.hash || "").replace("#", ""); return valid.includes(h) ? h : fallback; },
    onRefreshed: null,
    async refresh() {
      const rs = document.querySelectorAll ? [...document.querySelectorAll(".mref")] : []; if (!rs.length || rs[0].disabled) return;
      rs.forEach((b) => { b.disabled = true; b.classList.add("spin"); });
      const say = (m, ms) => { if (typeof window.toast === "function") window.toast(m, ms); };
      say("Rerunning the NFL and NBA models…", 0);
      const nfl = fetch("/api/rerun", { method: "POST" }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));
      const nba = fetch("/api/nba/snapshot", { cache: "no-store" }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));
      const [a, c] = await Promise.all([nfl, nba]);
      const t1 = a.ok ? (a.note && !a.rerun ? `NFL: ${a.note}` : `NFL: ${a.rerun || 0} game${a.rerun === 1 ? "" : "s"}, TD ${a.td ?? 0}`) : `NFL failed: ${a.error || "no answer"}`;
      const t2 = c.ok ? (c.modelOk === false ? "NBA: lines refreshed, model did not answer" : `NBA: ${c.games ?? 0} game${c.games === 1 ? "" : "s"}`) : `NBA failed: ${c.error || "no answer"}`;
      say(`${t1} · ${t2} · Refreshed ${Shell.runTxt(new Date().toISOString())}`, 9000);   // the bottom-right message is the only place the refresh time shows (owner 10/21 night)
      rs.forEach((b) => { b.disabled = false; b.classList.remove("spin"); });
      Shell.loadRun();
      if (typeof Shell.onRefreshed === "function") { try { await Shell.onRefreshed(); } catch {} }
    },
    // "Model Refresh: 4:10pm 10/17" at the bottom right of the page header (10/21 night; was under SLATEZZ): the newer of the NFL and NBA model runs (10/17, owner: one short line, newest time)
    runTxt(iso) {
      const d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return "—";
      return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP]M)$/, (m, x) => x.toLowerCase())} ${d.getMonth() + 1}/${d.getDate()}`;
    },
    // just the time under the refresh icon: the one row under the title has no room for words (owner 10/21 night)
    async loadRun() {
      const es = document.querySelectorAll ? document.querySelectorAll(".prun") : []; if (!es.length) return;
      try { const d = await (await fetch("/api/lastrun", { cache: "no-store" })).json(); const t = Shell.runTxt(d && d.newest); es.forEach((e) => { e.textContent = t; }); } catch {}
    },
    // a link of the top / bottom / sub-tab bars: switch pages WITHOUT adding history (10/18 night: a back swipe must have nothing to walk through)
    go(href) {
      if (!href) return; const u = new URL(href, location.href), norm = (p) => p.replace(/\/index\.html$/, "/");
      if (Shell.stale) { location.replace(u.href); return; }   // a newer build is live: this page switch loads it
      if (norm(u.pathname) === norm(location.pathname)) { history.replaceState(null, "", u.hash || "#"); window.dispatchEvent(new HashChangeEvent("hashchange")); }   // always redraw (Lines on a game page goes back to the games)
      else location.replace(u.href);
    },
    // 10/22 (owner: "Every time I open the app can it land me on the home page" + "background for more than 2 [minutes] reset"; both sports):
    // a fresh start of the app (a new session: nothing in sessionStorage yet) opens on home; coming back after 2+ minutes in the background
    // lands on home and reloads everything; back sooner keeps the page. Switches inside the app (NFL <-> NBA) keep the session, so they never reset.
    AWAY_MS: 120e3, resetting: false,
    home() { return `${URL_[Shell.chosen() || "nfl"]}#lines`; },   // Home = the games list of the sport last chosen
    isHome() { return /^\/(nba\/)?(index\.html)?$/.test(location.pathname) && ["", "#", "#home", "#lines"].includes(location.hash || ""); },
    homeReset() {
      let ss = null; try { ss = window.sessionStorage; } catch {}
      if (!ss || typeof document === "undefined" || !document.addEventListener) return false;
      let fresh = false; try { fresh = !ss.getItem("slz-live"); ss.setItem("slz-live", "1"); } catch { return false; }
      if (fresh && !Shell.isHome()) { Shell.resetting = true; location.replace(Shell.home()); return true; }
      document.addEventListener("visibilitychange", () => { try {
        if (document.hidden) { ss.setItem("slz-away", String(Date.now())); return; }
        const t = Number(ss.getItem("slz-away") || 0); ss.removeItem("slz-away");
        if (t && Date.now() - t >= Shell.AWAY_MS) { Shell.resetting = true; location.replace(Shell.home()); }
      } catch {} });
      return false;
    },
    init(sport) {
      if (Shell.homeReset()) return;   // a fresh start on another page: home is loading instead
      Shell.sport = sport; const sp = sport;
      const d = document.createElement("div");
      d.innerHTML = `<header class="tbar" id="tbar"><a class="slatelogo sgrad" data-nav href="${URL_[sp]}#lines">SLATEZZ</a><span class="lgts tlg">${Shell.leagueTabs(sp, "lines")}</span>` +   // 10/27 (owner): the NFL | NBA switch right next to SLATEZZ
        `<span class="tright"><button class="mref" aria-label="Rerun both models">${REF_SVG}</button>` +   // 10/27 (owner): the refresh sits next to the bell, white
        `<a class="tib" data-nav data-pg="alerts" href="${URL_[sp]}#alerts" aria-label="Alerts">${svg("bell", 28)}<b class="tcnt" id="mcnt-${sp}-alerts"></b></a></span></header>` +   // 10/21 night (owner): the bell at the top right
        `<nav class="bnav" id="bnav" aria-label="Main menu">` +
        `<a class="bi" data-nav data-b="home" href="${URL_[sp]}#lines" aria-label="Home">${svg("home", 23)}<span>Home</span></a>` +
        `<a class="bi" data-nav data-b="bets" href="${URL_[sp]}#mybets" aria-label="Bets">${svg("bets", 23)}<span>Bets</span></a>` +
        `<a class="bi" data-nav data-b="model" href="${URL_[sp]}#models" aria-label="Model">${svg("bars", 23)}<span>Model</span></a></nav>`;   // (owner 10/27: like Polymarket's phone app -- a floating pill, icons only, the open one in a round bubble)
      while (d.firstChild) document.body.appendChild(d.firstChild);
      { const rb = document.querySelector && document.querySelector("#tbar .mref"); if (rb) rb.onclick = Shell.refresh; }
      if (document.body.classList) document.body.classList.add("bnav-on");
      // My bets | Model bets sit inside Bets, under its title in the pinned header (10/22, sketch L)
      const sw = document.getElementById("bets-sw"), rh = document.querySelector && document.querySelector("#panel-record .phead");
      if (sw && rh && rh.appendChild) { rh.appendChild(sw); sw.style.display = ""; }
      if (document.addEventListener) document.addEventListener("click", (e) => {
        const a = e.target.closest && e.target.closest("a[data-nav]"); if (!a) return;
        e.preventDefault(); Shell.go(a.getAttribute("href"));
      });
      Shell.loadRun();
      Shell.buildWatch();
    },
    // 10/18 night (owner: "I always have to close it then reopen"): the page asks /api/build every minute; when a newer build is live it reloads
    // itself the next time the app comes back to the front or the next page switch -- never in the middle of reading.
    build: null, stale: false,
    async buildCheck(why) {
      try { const d = await (await fetch("/api/build", { cache: "no-store" })).json(); if (!d || !d.build) return;
        if (!Shell.build) Shell.build = d.build; else if (d.build !== Shell.build) Shell.stale = true;
        if (Shell.stale && why === "visible" && !Shell.resetting) location.reload(); } catch {}
    },
    buildWatch() {
      if (typeof fetch !== "function" || typeof setInterval !== "function") return;   // (the test harness has no timers)
      Shell.buildCheck("init");
      setInterval(() => { if (!document.hidden) Shell.buildCheck("poll"); }, 60e3);
      document.addEventListener("visibilitychange", () => { if (!document.hidden && !Shell.resetting) { if (Shell.stale) location.reload(); else Shell.buildCheck("visible"); } });
    },
  };
  // GAME PAGE CHART (10/27, owner: "inside the card to look like theirs but catered to ours", sketch A claude.ai/artifact/5y2kVMTo7ru4xrJNdWr24q; both sports):
  // each team's Polymarket US win price over time (moneyline history, /api/pricehist or /api/nba/pricehist), a line per team in
  // its team colour with the current % at the end, 1D / 1W / 1M / ALL under it (LIVE while the game is on, redrawn every 30 s).
  // o: { key, sport, away, home, start, live, title, ca, ch }. The chosen window is kept per phone (gRange); the data per game + window for the session.
  const CH = { data: {}, timer: null, cur: null };
  const lsG = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); const n = m ? parseInt(m[1], 16) : 0x888888; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  // a team colour that reads on the black page: dark ones are lifted toward white; two near-equal colours -> the home line goes light gray
  function chartColors(ca, ch) {
    const lift = (h) => { let c = hexRgb(h); for (let i = 0; i < 8 && lum(c) < 0.42; i++) c = c.map((v) => v + (255 - v) * 0.18); return c; };
    const a = lift(ca), h = lift(ch), d = Math.hypot(a[0] - h[0], a[1] - h[1], a[2] - h[2]);
    return [toHex(a), d < 70 ? "#e4e4e8" : toHex(h)];
  }
  const chartRange = (o) => (o.live ? (CH.liveRange || "live") : lsG("gRange", "all"));
  function chartSvg(o, pts, range, w) {
    const H = 84, P = { l: 30, r: 58, t: 12, b: 20 };   // 10/28 (owner: compact the part that does not move): 172 -> 84 px
    if (!pts || pts.length < 2) return `<div class="gcempty">${pts ? "No price history yet." : "Loading…"}</div>`;
    const [ca, ch] = chartColors(o.ca, o.ch), x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    const vals = pts.flatMap((p) => [p[1], p[2]]);
    let lo = Math.max(0, Math.floor((Math.min(...vals) - 0.05) * 10) / 10), hi = Math.min(1, Math.ceil((Math.max(...vals) + 0.05) * 10) / 10); if (hi - lo < 0.2) { lo = Math.max(0, lo - 0.1); hi = Math.min(1, hi + 0.1); }
    const X = (t) => P.l + ((t - x0) / (x1 - x0 || 1)) * (w - P.l - P.r), Y = (v) => P.t + ((hi - v) / (hi - lo)) * (H - P.t - P.b);
    const path = (i) => pts.map((p, k) => (k ? `H${X(p[0]).toFixed(1)}V` : `M${X(p[0]).toFixed(1)},`) + Y(p[i]).toFixed(1)).join("");
    let g = "";
    const step = hi - lo > 0.5 ? 0.2 : 0.1;
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) g += `<line x1="${P.l}" x2="${w - P.r + 4}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="gl"/><text x="${P.l - 5}" y="${(Y(v) + 3).toFixed(1)}" class="ga" text-anchor="end">${Math.round(v * 100)}%</text>`;
    const span = x1 - x0, short = span < 2 * 86400, n = 4, fmt = (t) => new Date(t * 1000).toLocaleString(undefined, short ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
    for (let i = 0; i <= n; i++) { const t = x0 + (span * i) / n; g += `<text x="${X(t).toFixed(1)}" y="${H - 5}" class="ga" text-anchor="${i === 0 ? "start" : i === n ? "end" : "middle"}">${fmt(t)}</text>`; }
    const last = pts[pts.length - 1]; let ya = Y(last[1]), yh = Y(last[2]);
    if (Math.abs(ya - yh) < 30) { const mid = (ya + yh) / 2, up = ya <= yh ? -1 : 1; ya = mid + up * 15; yh = mid - up * 15; }
    const lab = (v, y, col, code, cy) => `<circle cx="${X(x1).toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="${col}"/><text x="${(X(x1) + 8).toFixed(1)}" y="${(y - 3).toFixed(1)}" fill="${col}" class="gn">${code}</text><text x="${(X(x1) + 8).toFixed(1)}" y="${(y + 12).toFixed(1)}" fill="${col}" class="gp">${Math.round(v * 100)}%</text>`;
    return `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-label="${o.away} and ${o.home} win price over time">${g}<path d="${path(2)}" fill="none" stroke="${ch}" stroke-width="2"/><path d="${path(1)}" fill="none" stroke="${ca}" stroke-width="2"/>${lab(last[2], yh, ch, o.home, Y(last[2]))}${lab(last[1], ya, ca, o.away, Y(last[1]))}</svg>`;
  }
  const chartKey = (o, r) => `${o.key}|${r}`;
  function chartFill(o) {
    const el = document.getElementById("gcv"); if (!el || CH.cur !== o.key) return;
    const r = chartRange(o), d = CH.data[chartKey(o, r)];
    el.innerHTML = chartSvg(o, d ? d.pts : null, r, Math.max(280, Math.min(1000, Math.round(el.clientWidth || 360))));
  }
  // 10/27 (owner, Polymarket's game screen: "put [the game card] on top of the chart but blend it nicely together" / "remove this title"): our team
  // card (no border, square bottom corners), then the chart on the same team-colour wash fading into the page, the windows and Polymarket's mark under it
  // OTHER MARKETS (10/27, owner: Polymarket's game page -- halves, quarters, team totals, game / team props; "add everything else if it passes our 65%
  // rule"): Polymarket US's prices from /api/gamemarkets (NBA /api/nba/gamemarkets). 10/28: the NFL first-half spread is the one market with a tested
  // pick (the "Pick:" line under the 1st Half spread rows); every other market failed its test and shows prices only. Game Lines gets HALVES & QUARTERS (period chips) and TEAM TOTALS (team chips), GAME PROPS its own tab.
  const MK = { data: {}, busy: {} }, PERL = { "1h": "1st Half", "2h": "2nd Half", q1: "1st Q", q2: "2nd Q", q3: "3rd Q", q4: "4th Q" }, TTL = { full: "Full game", "1h": "1st half", "2h": "2nd half" };
  const mkKey = (o) => `${o.sport}|${o.key}`, cents = (x) => (x == null ? "—" : `${Math.round(x * 100)}¢`), sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x);
  const lsS = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  Shell.onMkt = null;
  Shell.mktLoad = (o) => {
    const k = mkKey(o), c = MK.data[k]; if ((c && Date.now() - c.t < 120e3) || MK.busy[k] || typeof fetch !== "function") return;
    MK.busy[k] = true;
    fetch(`/api/${o.sport === "nba" ? "nba/" : ""}gamemarkets?away=${encodeURIComponent(o.away)}&home=${encodeURIComponent(o.home)}&start=${encodeURIComponent(o.start)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { MK.data[k] = { t: Date.now(), d: d && d.ok ? d : null }; }).catch(() => { MK.data[k] = { t: Date.now(), d: null }; })
      .finally(() => { MK.busy[k] = false; if (typeof Shell.onMkt === "function") Shell.onMkt(o.key); });
  };
  const mkHead = (a, b, c) => `<div class="mkx mkh"><span>${a}</span><span>${b}</span><span>${c}</span></div>`;
  const mkRow = (a, b, c) => `<div class="mkx"><span>${a}</span><span class="v">${b}</span><span class="v">${c}</span></div>`;
  const chips = (attr, list, on) => `<div class="gchips">${list.map(([k, l]) => `<button class="gchip${k === on ? " on" : ""}" type="button" ${attr}="${k}">${l}</button>`).join("")}</div>`;
  const pmh = '<img class="mkpm" src="/polymarket.png" alt="">';
  // Game Lines extras: "" until loaded (the cards above show first), nothing when Polymarket lists none
  // 10/28: the NFL 1H SPREAD pick (lib/h1pick.js), under the first-half spread rows: "Pick: CAR +3.5 1H · 66% · 57¢", ✓ / ✗ once graded
  const h1Line = (k) => { const res = k.result === "W" ? ' <b class="g">✓</b>' : k.result === "L" ? ' <b class="r">✗</b>' : k.result === "P" ? ' <span class="dim">push</span>' : "";
    return `<div class="s mkpick"><span class="lbw">Pick:</span> <b class="${k.said >= 56 ? "g" : k.said >= 53 ? "lg" : "y"}">${String(k.label).toUpperCase().replace(/[<>&"]/g, "")} · ${Math.floor(k.said)}%</b> <span class="mkp">· ${cents(k.price)}</span>${res}</div>`; };
  Shell.mktLines = (o) => {
    const c = MK.data[mkKey(o)]; Shell.mktLoad(o); const d = c && c.d;
    const lone = o.h1pick ? `<div class="trow"><div class="sh">HALVES &amp; QUARTERS</div></div><div class="card mkc"><div class="mks">1st Half spread</div>${h1Line(o.h1pick)}</div>` : "";   // no first-half lines listed (yet / any more)
    if (!d) return lone;
    let out = "";
    const pk = Object.keys(PERL).filter((k) => d.periods && d.periods[k]);
    if (o.h1pick && !(d.periods && d.periods["1h"] && d.periods["1h"].spread.length)) out += lone;
    if (pk.length) {
      let per = lsG("gPer", "1h"); if (!pk.includes(per)) per = pk[0]; const P = d.periods[per];
      out += `<div class="trow"><div class="sh">HALVES &amp; QUARTERS</div></div><div class="card mkc">${chips("data-gper", pk.map((k) => [k, PERL[k]]), per)}` +
        (P.spread.length ? `<div class="mks">Spread</div>${mkHead(`${pmh}LINE`, o.away, o.home)}${P.spread.map((r) => mkRow(`${o.away} ${sgn(r.line)} · ${o.home} ${sgn(-r.line)}`, cents(r.aPrice), cents(r.hPrice))).join("")}` : "") +
        (per === "1h" && o.h1pick ? h1Line(o.h1pick) : "") +
        (P.total.length ? `<div class="mks">Total</div>${mkHead(`${pmh}LINE`, "OVER", "UNDER")}${P.total.map((r) => mkRow(String(r.line), cents(r.over), cents(r.under))).join("")}` : "") +
        (P.winner.length ? `<div class="mks">Winner</div>${mkHead(`${pmh}`, "YES", "")}${P.winner.map((r) => mkRow(r.label, cents(r.price), "")).join("")}` : "") + `</div>`;
    }
    const tt = d.teamTotals || {}, teams = [o.away, o.home].filter((t) => tt[t] && Object.keys(tt[t]).length);
    if (teams.length) {
      let tm = lsG("gTT", o.away); if (!teams.includes(tm)) tm = teams[0];
      out += `<div class="trow"><div class="sh">TEAM TOTALS</div></div><div class="card mkc">${chips("data-gtt", teams.map((t) => [t, t]), tm)}` +
        Object.keys(TTL).filter((k) => tt[tm][k]).map((k) => `<div class="mks">${TTL[k]}</div>${mkHead(`${pmh}LINE`, "OVER", "UNDER")}${tt[tm][k].map((r) => mkRow(`${tm} ${r.line}`, cents(r.over), cents(r.under))).join("")}`).join("") + `</div>`;
    }
    return out;
  };
  // GAME PROPS tab: Game | Team chips, each market group with its rows
  Shell.mktProps = (o, none) => {
    const c = MK.data[mkKey(o)]; Shell.mktLoad(o); if (!c) return '<div class="s dim" style="margin:12px 2px">Loading…</div>';
    const d = c.d, pr = (d && d.props) || {}, has = (x) => x && Object.keys(x).length, kinds = [["game", "Game"], ["team", "Team"]].filter(([k]) => has(pr[k]));
    if (!kinds.length) return none;
    let kd = lsG("gPx", "game"); if (!kinds.some(([k]) => k === kd)) kd = kinds[0][0];
    return chips("data-gpx", kinds, kd) + Object.entries(pr[kd]).map(([g, rows]) => `<div class="card mkc"><div class="mks">${g}</div>${mkHead(pmh, "YES", "NO")}${rows.map((r) => mkRow(r.label, cents(r.yes), cents(r.no))).join("")}</div>`).join("");
  };
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-gper],[data-gtt],[data-gpx]"); if (!b) return;
    if (b.dataset.gper) lsS("gPer", b.dataset.gper); else if (b.dataset.gtt) lsS("gTT", b.dataset.gtt); else lsS("gPx", b.dataset.gpx);
    if (typeof Shell.onMkt === "function") Shell.onMkt(null);
  });
  Shell.chartBlock = (o) => {
    CH.cur = o.key; const r = chartRange(o), keys = o.live ? ["live", "1d", "1w", "all"] : ["1d", "1w", "1m", "all"];
    const btn = (k) => `<button type="button" class="${k === r ? "on" : ""}" data-grange="${k}">${k === "live" ? "LIVE" : k.toUpperCase()}</button>`;
    const wash = `linear-gradient(90deg,${o.ca}40 0%,${o.ca}14 50%,${o.ch}14 50%,${o.ch}40 100%)`;
    return `<div class="gchart" style="--gwash:${wash}"><div class="gcv" id="gcv"></div>` +
      `<div class="grng"><span class="gpm"><img src="/polymarket.png" alt="">Polymarket${o.live ? ' · <span class="r">● LIVE</span>' : ""}</span><span class="gb">${keys.map(btn).join("")}</span></div></div>`;
  };
  Shell.chartLoad = async (o, force) => {
    CH.cur = o.key; CH.o = o; chartFill(o);
    const r = chartRange(o), k = chartKey(o, r), have = CH.data[k], age = have ? Date.now() - have.t : Infinity;
    if (!force && age < (r === "live" ? 25e3 : 120e3)) return;
    const url = `/api/${o.sport === "nba" ? "nba/" : ""}pricehist?away=${encodeURIComponent(o.away)}&home=${encodeURIComponent(o.home)}&start=${encodeURIComponent(o.start)}&range=${r}`;
    try { const d = await (await fetch(url)).json(); CH.data[k] = { pts: d && d.ok ? d.pts : [], t: Date.now() }; } catch { if (!have) CH.data[k] = { pts: [], t: Date.now() }; }
    chartFill(o);
    clearTimeout(CH.timer);
    if (typeof setTimeout === "function") CH.timer = setTimeout(() => { if (CH.cur === o.key && document.getElementById("gcv") && !document.hidden) Shell.chartLoad(CH.o); }, o.live ? 30e3 : 300e3);
  };
  Shell.chartStop = () => { CH.cur = null; clearTimeout(CH.timer); };
  // 10/28 (owner: "Do not make this part scroll ... DO NOT MAKE THE EXIT PAGE GAMES AND THE GAME SUB TABS MOVE"): on a game page the top part (.gtop: team
  // card, chart, ← Games, tabs) stays put and only .grest scrolls, sized to the screen under it; the page background (helmets / logos) is centered in
  // the space between the bottom of .gtop and the bottom of the screen. Both sports.
  const PIN = { el: null, ro: null };
  function pinSize() {
    const d = PIN.el; if (!d || !d.isConnected) return; const rest = d.querySelector(".grest"); if (!rest) return;
    const z = parseFloat(getComputedStyle(document.body).getPropertyValue("--z")) || 1, y = rest.getBoundingClientRect().top;
    rest.style.height = Math.max(120, (window.innerHeight - y) / z) + "px";
    const bg = document.getElementById("bgwm"); if (bg) bg.style.paddingTop = Math.max(0, y) + "px";
  }
  Shell.pinGame = (d, y) => {
    if (!d || typeof document === "undefined") return;
    document.documentElement.classList.add("gpin"); PIN.el = d; if (window.scrollTo) window.scrollTo(0, 0); pinSize();
    const r = d.querySelector(".grest"); if (r && y) r.scrollTop = y;
    if (typeof ResizeObserver === "function") { if (PIN.ro) PIN.ro.disconnect(); PIN.ro = new ResizeObserver(() => pinSize()); const t = d.querySelector(".gtop"); if (t) PIN.ro.observe(t); }
  };
  Shell.unpinGame = () => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.remove("gpin"); PIN.el = null; if (PIN.ro) { PIN.ro.disconnect(); PIN.ro = null; }
    const bg = document.getElementById("bgwm"); if (bg) bg.style.paddingTop = "";
  };
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", () => pinSize());
  // 10/28 (owner, My bets: "Don't make this part scroll up"): a block that stays put right under the page's pinned title (position:sticky, its top = where
  // the title's solid band ends)
  var TOPS = new Set();   // var: setActive (above) reads it
  function topSize(el) {
    if (!el || !el.isConnected) { TOPS.delete(el); return; }
    const panel = el.closest(".panel"), ph = panel && panel.querySelector(".phead"); if (!ph || !ph.offsetParent) return;
    const z = parseFloat(getComputedStyle(document.body).getPropertyValue("--z")) || 1, pb = parseFloat(getComputedStyle(ph).paddingBottom) || 0;
    const top = ph.getBoundingClientRect().bottom - pb * z;
    el.style.top = Math.max(0, top / z) + "px";
  }
  let TOPRO = null;
  Shell.pinTop = (el) => {
    if (!el) return; TOPS.add(el); topSize(el); if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => topSize(el));
    // re-measure whenever a page title changes size (fonts landing, the drop-downs filling in) -- a stale measure left the card too low
    if (typeof ResizeObserver === "function" && !TOPRO) { TOPRO = new ResizeObserver(() => TOPS.forEach(topSize)); document.querySelectorAll(".phead").forEach((h) => TOPRO.observe(h)); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => TOPS.forEach(topSize));
  };
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", () => TOPS.forEach(topSize));
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest("[data-grange]"); if (!b || !CH.o) return;
    const r = b.dataset.grange;
    if (CH.o.live) CH.liveRange = r; else { try { localStorage.setItem("gRange", r); } catch {} }
    const box = b.closest(".gchart"); if (box) box.querySelectorAll("[data-grange]").forEach((x) => x.classList.toggle("on", x === b));
    Shell.chartLoad(CH.o);
  });
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", () => { if (CH.o && CH.cur) chartFill(CH.o); });
  // 10/22 (owner): the one ⓘ next to a model header opens / closes the short box right under that header (both sports)
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest(".ibtn"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const h = b.closest(".ihd"), x = h && h.nextElementSibling; if (!x || !x.classList.contains("ibox")) return;
    x.hidden = !x.hidden; b.classList.toggle("on", !x.hidden);
  }, true);
  window.Shell = Shell;
})();
