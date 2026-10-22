// SLATEZZ shell (10/17, owner; 10/22: a pinned top bar + a bottom bar instead of the side menu), the refresh button (reruns BOTH models), the
// drop-down slot of the page titles and the logo helpers. Loaded by /index.html (NFL + home) and /nba/index.html before each page's app.js.
// Pages: NFL #home (no hash) #alerts #lines #td #props-<tab> #mybets #modelbets #models on /index.html; NBA #alerts #lines #props-<tab> #mybets #modelbets #models on /nba/index.html.
// (10/22: Bets holds My bets | Model bets; the Model bets types and the Player props tabs are the sub-tab bar above the bottom bar.)
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
  const PROPS = { nfl: [["td", "Anytime TD"], ["props-first", "First TD"], ["props-recyds", "Rec Yds"], ["props-rec", "Receptions"], ["props-passyds", "Pass Yds"]],
    nba: [["props-pts", "Points"], ["props-reb", "Rebounds"], ["props-ast", "Assists"], ["props-pra", "PRA"], ["props-3pm", "Threes"], ["props-stl", "Steals"], ["props-blk", "Blocks"]] };
  const URL_ = { nfl: "/index.html", nba: "/nba/index.html" };
  // the Model bets parlay types (10/20 night: Over/Under and Spread + Total removed; 10/21: NBA Prop Parlays 6 / 8 / 10 legs + Same Game; 3 legs at most elsewhere)
  const TYPES = { nfl: [["best", "Best Legs"], ["3", "3 Leg"], ["2", "2 Leg"], ["upset", "Upset"]],
    nba: [["pp6", "6 Leg"], ["pp8", "8 Leg"], ["pp10", "10 Leg"], ["sgp4", "Same Game"]] };
  const OTHER = { nfl: "nba", nba: "nfl" };
  // 10/21 night (owner): a white curved arrow on each side of the ball -- left one up, right one down (the switch)
  const SWAP_ARROW = '<svg viewBox="0 0 16 26" aria-hidden="true"><path d="M11.5 24C4.5 20.5 3.2 12 6.8 6.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M2.6 8.6L7.6 1.4L11 9.6Z" fill="currentColor"/></svg>';
  const REF_SVG = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  const REFRESH_ON = (p) => p === "lines" || p === "td" || /^props/.test(p) || /^modelbets/.test(p);   // the pages the refresh button matters on
  // which bottom tab a page belongs to; the sub tabs a page shows
  const tabOf = (p) => p === "home" ? "home" : p === "lines" ? "lines" : p === "td" || /^props/.test(p) ? "props" : p === "mybets" || /^modelbets/.test(p) || p === "record" ? "bets" : "";
  const subsOf = (sp, p) => p === "td" || /^props-/.test(p) ? PROPS[sp].map(([id, l]) => [id, l]) : /^modelbets-/.test(p) ? TYPES[sp].map(([k, l]) => [`modelbets-${k}`, l]) : null;
  // the same page on the other sport (the middle button); home goes to the other sport's Game Lines
  const otherHash = (p, sp) => { const o = OTHER[sp], t = tabOf(p);
    return t === "props" ? PROPS[o][0][0] : t === "bets" ? (/^modelbets/.test(p) ? `modelbets-${TYPES[o][0][0]}` : "mybets") : ["alerts", "models"].includes(p) ? p : "lines"; };
  const NFL_LOGO_FIX = { WSH: "wsh", WAS: "wsh", LA: "lar", LAR: "lar" };
  const Shell = {
    sport: "nfl", panel: "home",
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
      if (!document.querySelectorAll) return;
      document.querySelectorAll("#bnav [data-b]").forEach((a) => a.classList.toggle("on", a.dataset.b === t));
      document.querySelectorAll("#tbar [data-pg]").forEach((a) => a.classList.toggle("on", a.dataset.pg === panel));
      const subs = subsOf(sp, panel), sb = document.getElementById("sbar");
      if (sb) { sb.innerHTML = subs ? subs.map(([id, l]) => `<a class="si${id === panel ? " on" : ""}" data-nav href="${URL_[sp]}#${id}">${l}</a>`).join("") : "";
        const on = sb.querySelector && sb.querySelector(".si.on"); if (on && on.scrollIntoView && sb.scrollWidth > sb.clientWidth) { try { on.scrollIntoView({ block: "nearest", inline: "center" }); } catch {} } }
      document.body.classList.toggle("sbar-on", !!subs);
      document.body.classList.toggle("ref-on", REFRESH_ON(panel));
      const sw = document.getElementById("bsport"); if (sw) sw.dataset.href = `${URL_[OTHER[sp]]}#${otherHash(panel, sp)}`;
      const home = sp === "nfl" && panel === "home";
      document.body.classList.toggle("home-on", home); document.documentElement.classList.toggle("home-on", home);
      const sh = document.getElementById("shead"); if (sh) sh.style.display = "none";   // 10/22: SLATEZZ lives in the pinned top bar on every page
    },
    setCount(sp, id, n) { const e = document.getElementById(`mcnt-${sp}-${id}`); if (!e) return; e.textContent = n > 9 ? "9+" : String(n || ""); e.style.display = n ? "flex" : "none"; },
    open() {}, close() {},   // (the side menu is gone 10/22)
    // the hash names the page ("#lines"); none = home on the NFL page, Game Lines on the NBA page
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
    init(sport) {
      Shell.sport = sport; const sp = sport, o = OTHER[sp];
      const d = document.createElement("div");
      d.innerHTML = `<header class="tbar" id="tbar"><a class="slatelogo sgrad" data-nav href="/index.html#home">SLATEZZ</a>` +
        `<a class="tib" data-nav data-pg="alerts" href="${URL_[sp]}#alerts" aria-label="Alerts">${svg("bell", 28)}<b class="tcnt" id="mcnt-${sp}-alerts"></b></a></header>` +   // 10/21 night (owner): the bell at the top right
        `<nav class="hmod" id="hmod" aria-label="Model analysis"><a data-nav href="/index.html#models">${svg("bars", 22)}<span>NFL</span></a><a data-nav href="/nba/index.html#models">${svg("bars", 22)}<span>NBA</span></a></nav>` +
        `<nav class="sbar" id="sbar" aria-label="Tabs"></nav>` +
        `<nav class="bnav" id="bnav" aria-label="Main menu">` +
        `<a class="bi" data-nav data-b="home" href="/index.html#home">${svg("home", 22)}<span>Home</span></a>` +
        `<a class="bi" data-nav data-b="lines" href="${URL_[sp]}#lines">${svg("grid", 22)}<span>Lines</span></a>` +
        `<button class="bsport ${sp}" id="bsport" aria-label="Switch to ${o.toUpperCase()}"><i class="barr up">${SWAP_ARROW}</i><img src="/ball-${sp}.png?v=1" alt="${sp.toUpperCase()}"><i class="barr dn">${SWAP_ARROW}</i></button>` +   // 10/21 night (owner): just the ball of the sport you are on (cut out of the owner's photos); a tap switches sport
        `<a class="bi" data-nav data-b="props" href="${URL_[sp]}#${PROPS[sp][0][0]}">${svg("props", 22)}<span>Props</span></a>` +
        `<a class="bi" data-nav data-b="bets" href="${URL_[sp]}#mybets">${svg("bets", 22)}<span>Bets</span></a></nav>`;
      while (d.firstChild) document.body.appendChild(d.firstChild);
      if (document.body.classList) document.body.classList.add("bnav-on");
      // My bets | Model bets sit inside Bets, under its title in the pinned header (10/22, sketch L)
      const sw = document.getElementById("bets-sw"), rh = document.querySelector && document.querySelector("#panel-record .phead");
      if (sw && rh && rh.appendChild) { rh.appendChild(sw); sw.style.display = ""; }
      // 10/21 night (owner): the refresh ring sits next to the page title on the pages it matters for (Lines, Player props, Model bets), and
      // "Model Refresh: <time>" at the bottom right of that header
      if (document.querySelectorAll) document.querySelectorAll(".panel .phead").forEach((h) => {
        if (!h.querySelector(".pt") || h.querySelector(".mref")) return;
        // right next to the title on its line, vertically centered with it: the refresh icon (owner 10/21 night)
        const box = document.createElement("div"); box.className = "prefbox";
        const b = document.createElement("button"); b.className = "mref"; b.setAttribute("aria-label", "Rerun both models"); b.innerHTML = REF_SVG; b.onclick = Shell.refresh;
        // (10/21 night, owner: no time under it -- the refresh time shows in the message at the bottom right after a tap)
        box.appendChild(b); const tb = h.querySelector(".pt b"); if (tb && tb.after) tb.after(box); else h.appendChild(box);   // on the title's line, right after the title (owner 10/21 night)
      });
      const bs = document.getElementById("bsport");
      if (bs) bs.onclick = (e) => Shell.go(e.currentTarget.dataset.href || `${URL_[o]}#lines`);
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
        if (Shell.stale && why === "visible") location.reload(); } catch {}
    },
    buildWatch() {
      if (typeof fetch !== "function" || typeof setInterval !== "function") return;   // (the test harness has no timers)
      Shell.buildCheck("init");
      setInterval(() => { if (!document.hidden) Shell.buildCheck("poll"); }, 60e3);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) { if (Shell.stale) location.reload(); else Shell.buildCheck("visible"); } });
    },
  };
  // 10/22 (owner): the one ⓘ next to a model header opens / closes the short box right under that header (both sports)
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest && e.target.closest(".ibtn"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const h = b.closest(".ihd"), x = h && h.nextElementSibling; if (!x || !x.classList.contains("ibox")) return;
    x.hidden = !x.hidden; b.classList.toggle("on", !x.hidden);
  }, true);
  window.Shell = Shell;
})();
