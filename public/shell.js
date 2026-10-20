// SLATEZZ shell (10/17, owner): the side menu for NFL + NBA ("Menu A · Neon"), the refresh button (reruns BOTH models), the header's next-game
// clock and the logo helpers. Loaded by /index.html (NFL + home) and /nba/index.html before each page's app.js.
// Pages: NFL #home (no hash) #alerts #lines #td #props-<tab> #mybets #modelbets #models on /index.html; NBA #alerts #lines #props-<tab> #mybets #modelbets #models on /nba/index.html.
// (10/17, owner: My bets and Model bets are separate pages, listed under Bets in the menu.)
(function () {
  const ICON = {
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    grid: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 12h17M12 4.5v15"/>',
    td: '<circle cx="12" cy="7" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
    bets: '<path d="M4 7a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17v-2.5a2.5 2.5 0 0 0 0-5z"/>',
    bars: '<path d="M6 20V11M12 20V5M18 20v-6"/>',
    props: '<path d="M4 17l5-6 4 4 7-9"/><path d="M15 6h5v5"/>',
  };
  const svg = (k, w = 17) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const ITEMS = {
    nfl: [["alerts", "Alerts", "bell"], ["lines", "Game Lines", "grid"], ["props", "Player props", "props"], ["record", "Bets", "bets"]],   // 10/20 (owner): "Player props" heads its sub tabs; Anytime TD is one of them (NFL)
    nba: [["alerts", "Alerts", "bell"], ["lines", "Game Lines", "grid"], ["props", "Player props", "props"], ["record", "Bets", "bets"]],
  };
  // 10/20 (owner: "rename it player props and have the sub tabs ... ANYTIME TD should be a sub tab under props"): the stat tabs, one page each
  const PROPS = { nfl: [["td", "Anytime TD"], ["props-first", "First TD"], ["props-recyds", "Rec Yds"], ["props-rec", "Receptions"], ["props-passyds", "Pass Yds"]],
    nba: [["props-pts", "Points"], ["props-reb", "Rebounds"], ["props-ast", "Assists"], ["props-pra", "PRA"], ["props-3pm", "Threes"], ["props-stl", "Steals"], ["props-blk", "Blocks"]] };
  const URL_ = { nfl: "/index.html", nba: "/nba/index.html" };
  const SUB = [["mybets", "My bets"], ["modelbets", "Model bets"]];   // 10/18 (owner): the Results sub tab was built and then deleted the same day ("I don't need it")
  // 10/17 (owner): the Model bets parlay types are sub tabs under Model bets in the menu (both sports)
  const TYPES = { nfl: [["best", "Best Legs"], ["3", "3 Leg"], ["2", "2 Leg"], ["upset", "Upset"]],   // 10/20 night (owner): Over/Under and Spread + Total removed from the menu
    nba: [["sgp", "Same game"], ["best4", "Parlay"]] };   // 10/19 (owner): 3 legs at most -- the 4-leg tabs are gone on both sports
  // 10/18 night (owner): Alerts is ONE menu item on both sports -- no kind sub tabs
  // 10/17 (owner): Alerts, Bets and Model bets open and close their lists (closed to start); tapping them only opens / closes
  const car = '<i class="car">▾</i>';
  const group = (key, inner) => `<div class="msubs" data-grp="${key}">${inner}</div>`;
  const types = (sp) => group(`${sp}-mb`, (TYPES[sp] || []).map(([k, label]) => `<a class="mi ${sp} msub2" data-msp="${sp}" data-mp="modelbets-${k}" href="${URL_[sp]}#modelbets-${k}">${label}</a>`).join(""));
  const sub = (sp, id, label) => id === "modelbets" ? `<div class="mi ${sp} msub mtog" data-tog="${sp}-mb" data-msp="${sp}" data-mp="modelbets"><i></i>${label}${car}</div>` + types(sp)
    : `<a class="mi ${sp} msub" data-msp="${sp}" data-mp="${id}" href="${URL_[sp]}#${id}"><i></i>${label}</a>`;
  const subs = (sp) => `<div class="mi ${sp} mpar mtog" data-tog="${sp}-bets"><span class="ic">${svg("bets")}</span>Bets${car}</div>` + group(`${sp}-bets`, SUB.map(([id, label]) => sub(sp, id, label)).join(""));
  const propsMenu = (sp) => `<div class="mi ${sp} mpar mtog" data-tog="${sp}-props"><span class="ic">${svg("props")}</span>Player props${car}</div>` + group(`${sp}-props`, PROPS[sp].map(([id, label]) => `<a class="mi ${sp} msub" data-msp="${sp}" data-mp="${id}" href="${URL_[sp]}#${id}"><i></i>${label}</a>`).join(""));
  const item = (sp, id, label, ic) => id === "record" ? subs(sp) : id === "props" ? propsMenu(sp) : `<a class="mi ${sp}" data-msp="${sp}" data-mp="${id}" href="${URL_[sp]}#${id}"><span class="ic">${svg(ic)}</span>${label}<b class="cnt" id="mcnt-${sp}-${id}"></b></a>`;
  const NFL_LOGO_FIX = { WSH: "wsh", WAS: "wsh", LA: "lar", LAR: "lar" };
  const Shell = {
    sport: "nfl", panel: "home",
    nflLogo: (t) => (String(t || "").toUpperCase() === "KC" ? "/kc.png?v=1" : t ? `https://a.espncdn.com/i/teamlogos/nfl/500/${NFL_LOGO_FIX[t] || String(t).toLowerCase()}.png` : ""),
    nbaLogo: (t, teams) => (teams && teams[t] && teams[t].logo) || (t ? `https://a.espncdn.com/i/teamlogos/nba/500/${String(t).toLowerCase()}.png` : ""),
    img: (src) => (src ? `<img src="${src}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="nl"></span>'),
    // countdown text: "1d 1h 7m", "2h 14m", "26m", "45s"
    setActive(panel) {
      Shell.panel = panel;
      const par = panel === "td" ? "props" : String(panel).split("-")[0];   // "modelbets-2": the type is on, Model bets above it is marked as its parent; Anytime TD sits under Player props (10/20)
      document.querySelectorAll(".mi").forEach((a) => { const me = a.dataset.msp === Shell.sport; a.classList.toggle("on", me && a.dataset.mp === panel); a.classList.toggle("pon", me && par !== panel && a.dataset.mp === par); });
      const home = Shell.sport === "nfl" && panel === "home";
      document.body.classList.toggle("home-on", home); document.documentElement.classList.toggle("home-on", home);
      const sh = document.getElementById("shead"); if (sh) sh.style.display = home ? "" : "none";   // 10/18 night (owner): the header strip shows on home only (SLATEZZ); the NEXT GAME strip is gone
    },
    setCount(sp, id, n) { const e = document.getElementById(`mcnt-${sp}-${id}`); if (!e) return; e.textContent = n > 9 ? "9+" : String(n || ""); e.style.display = n ? "flex" : "none"; },
    open() { document.body.classList.add("menu-open"); },
    close() { document.body.classList.remove("menu-open"); },
    // the hash names the page ("#lines"); none = home on the NFL page, Game Lines on the NBA page
    hashPanel(valid, fallback) { const h = (location.hash || "").replace("#", ""); return valid.includes(h) ? h : fallback; },
    onRefreshed: null,
    async refresh() {
      const b = document.getElementById("mref"); if (!b || b.disabled) return;
      b.disabled = true; b.classList.add("spin");
      const say = (m, ms) => { if (typeof window.toast === "function") window.toast(m, ms); };
      say("Rerunning the NFL and NBA models…", 0);
      const nfl = fetch("/api/rerun", { method: "POST" }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));
      const nba = fetch("/api/nba/snapshot", { cache: "no-store" }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));
      const [a, c] = await Promise.all([nfl, nba]);
      const t1 = a.ok ? (a.note && !a.rerun ? `NFL: ${a.note}` : `NFL: ${a.rerun || 0} game${a.rerun === 1 ? "" : "s"}, TD ${a.td ?? 0}`) : `NFL failed: ${a.error || "no answer"}`;
      const t2 = c.ok ? (c.modelOk === false ? "NBA: lines refreshed, model did not answer" : `NBA: ${c.games ?? 0} game${c.games === 1 ? "" : "s"}`) : `NBA failed: ${c.error || "no answer"}`;
      say(`${t1} · ${t2}`, 9000);
      b.disabled = false; b.classList.remove("spin");
      Shell.loadRun();
      if (typeof Shell.onRefreshed === "function") { try { await Shell.onRefreshed(); } catch {} }
    },
    // "Model Refresh: 4:10pm 10/17" under SLATEZZ: the newer of the NFL and NBA model runs (10/17, owner: one short line, newest time)
    runTxt(iso) {
      const d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return "—";
      return `${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP]M)$/, (m, x) => x.toLowerCase())} ${d.getMonth() + 1}/${d.getDate()}`;
    },
    async loadRun() {
      const e = document.getElementById("mrun"); if (!e) return;
      try { const d = await (await fetch("/api/lastrun", { cache: "no-store" })).json(); e.textContent = "Model Refresh: " + Shell.runTxt(d && d.newest); } catch {}
    },
    init(sport) {
      Shell.sport = sport;
      const d = document.createElement("div");
      d.innerHTML = `<div class="mscrim" id="mscrim"></div><nav class="mdraw" id="mdraw" aria-label="Main menu">` +
        `<div class="mtop"><a class="mlogo sgrad" href="/index.html#home">SLATEZZ</a><div class="mbts">` +
        `<button class="mref" id="mref" aria-label="Rerun both models"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>` +
        `</div></div>` +   // 10/17 (owner): no X button -- the menu closes with a swipe to the left, a tap outside it, or Escape; it opens with a swipe from the left edge
        `<div class="mrun" id="mrun">Model Refresh: —</div>` +
        `<div class="msec nfl"><span>NFL</span><span class="ml"></span></div>${ITEMS.nfl.map((x) => item("nfl", ...x)).join("")}` +
        `<div class="msec nba gap"><span>NBA</span><span class="ml"></span></div>${ITEMS.nba.map((x) => item("nba", ...x)).join("")}` +
        `<div class="mspace"></div><div class="msec mod"><span>MODEL ANALYSIS</span><span class="ml"></span></div>${item("nfl", "models", "NFL", "bars")}${item("nba", "models", "NBA", "bars")}</nav>`;
      // 10/18 (owner): no ☰ in the header -- a thin grip on the left edge opens the menu (tap or slide it right); SLATEZZ sits centered
      d.innerHTML += `<button class="mgrip" id="menu-grip" aria-label="Menu"><i></i></button>`;
      while (d.firstChild) document.body.appendChild(d.firstChild);
      const mb = document.getElementById("menu-btn"); if (mb) mb.onclick = Shell.open;
      document.getElementById("menu-grip").onclick = () => { Shell.open(); Shell.loadRun(); };
      document.getElementById("mscrim").onclick = Shell.close;
      // 10/17 (owner: "I should just be able to slide it"): swipe from the left edge opens the menu, a swipe to the left on it closes it
      let sx = null, sy = null, edge = false;
      document.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; edge = sx <= 44 && !document.body.classList.contains("menu-open"); }, { passive: true });   // the left edge = the grip's strip
      document.addEventListener("touchend", (e) => { if (sx == null) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy); sx = null;
        if (dy > Math.abs(dx)) return;
        if (edge && dx > 40) { Shell.open(); Shell.loadRun(); }
        else if (document.body.classList.contains("menu-open") && dx < -40) Shell.close(); }, { passive: true });
      document.getElementById("mref").onclick = Shell.refresh;
      Shell.loadRun(); document.getElementById("menu-btn") && document.getElementById("menu-btn").addEventListener("click", Shell.loadRun);   // fresh each time the menu opens
      document.getElementById("mdraw").addEventListener("click", (e) => {
        const t = e.target.closest(".mtog");
        if (t) { const g = document.querySelector(`.msubs[data-grp="${t.dataset.tog}"]`); const open = !(g && g.classList.contains("open")); t.classList.toggle("open", open); if (g) g.classList.toggle("open", open); return; }
        const a = e.target.closest("a"); if (!a) return;
        // 10/18 night (owner: a swipe "changes pages ... brings me back to a different page"): that was the phone's back / forward gesture walking
        // through history. Pages now switch WITHOUT adding history (replaceState on this page, location.replace to the other sport's page), so a
        // swipe has nothing to go back to; only the left grip moves.
        const href = a.getAttribute("href") || ""; if (!href || /^https?:/.test(href)) { Shell.close(); return; }
        e.preventDefault(); Shell.close();
        const u = new URL(href, location.href), norm = (p) => p.replace(/\/index\.html$/, "/");
        if (Shell.stale) { location.replace(u.href); return; }   // a newer build is live: this page switch loads it
        if (norm(u.pathname) === norm(location.pathname)) { if (u.hash !== location.hash) { history.replaceState(null, "", u.hash || "#"); window.dispatchEvent(new HashChangeEvent("hashchange")); } }
        else location.replace(u.href);
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") Shell.close(); });
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
  window.Shell = Shell;
})();
