// SLATEZZ shell (10/17, owner): the side menu for NFL + NBA ("Menu A · Neon"), the refresh button (reruns BOTH models), the header's next-game
// clock and the logo helpers. Loaded by /index.html (NFL + home) and /nba/index.html before each page's app.js.
// Pages: NFL #home (no hash) #alerts #lines #td #mybets #modelbets #models on /index.html; NBA #alerts #lines #mybets #modelbets #models on /nba/index.html.
// (10/17, owner: My bets and Model bets are separate pages, listed under Bets in the menu.)
(function () {
  const ICON = {
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    grid: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 12h17M12 4.5v15"/>',
    td: '<circle cx="12" cy="7" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
    bets: '<path d="M4 7a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17v-2.5a2.5 2.5 0 0 0 0-5z"/>',
    bars: '<path d="M6 20V11M12 20V5M18 20v-6"/>',
  };
  const svg = (k, w = 17) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  const ITEMS = {
    nfl: [["alerts", "Alerts", "bell"], ["lines", "Game Lines", "grid"], ["td", "Anytime TD", "td"], ["record", "Bets", "bets"]],
    nba: [["alerts", "Alerts", "bell"], ["lines", "Game Lines", "grid"], ["record", "Bets", "bets"]],
  };
  const URL_ = { nfl: "/index.html", nba: "/nba/index.html" };
  const SUB = [["mybets", "My bets"], ["modelbets", "Model bets"]];
  // 10/17 (owner): the Model bets parlay types are sub tabs under Model bets in the menu (both sports)
  const TYPES = { nfl: [["2", "2 legs"], ["3", "3 legs"], ["4", "4 legs"], ["style", "My style"], ["pts", "Bought"], ["diff", "Diff"]],
    nba: [["sgp", "Same game"], ["sgp_pts", "Bought"], ["best4", "Parlay"], ["fav4", "Favorites"]] };
  // 10/17 (owner): the alert kinds are sub tabs under Alerts too (ids match the pages' ALK keys, lower case without spaces)
  const ALERTK = { nfl: [["all", "All"], ["injury", "Injury"], ["qbchange", "QB change"], ["linemove", "Line move"], ["weather", "Weather"], ["result", "Result"], ["tdno", "TD No"], ["tdjump", "TD jump"], ["qbtd", "QB TD"]],
    nba: [["all", "All"], ["pick", "New pick"], ["linemove", "Line move"], ["injury", "Injury"], ["result", "Result"]] };
  // 10/17 (owner): Alerts, Bets and Model bets open and close their lists (closed to start); tapping them only opens / closes
  const car = '<i class="car">▾</i>';
  const group = (key, inner) => `<div class="msubs" data-grp="${key}">${inner}</div>`;
  const types = (sp) => group(`${sp}-mb`, (TYPES[sp] || []).map(([k, label]) => `<a class="mi ${sp} msub2" data-msp="${sp}" data-mp="modelbets-${k}" href="${URL_[sp]}#modelbets-${k}">${label}</a>`).join(""));
  const sub = (sp, id, label) => id === "modelbets" ? `<div class="mi ${sp} msub mtog" data-tog="${sp}-mb" data-msp="${sp}" data-mp="modelbets"><i></i>${label}${car}</div>` + types(sp)
    : `<a class="mi ${sp} msub" data-msp="${sp}" data-mp="${id}" href="${URL_[sp]}#${id}"><i></i>${label}</a>`;
  const subs = (sp) => `<div class="mi ${sp} mpar mtog" data-tog="${sp}-bets"><span class="ic">${svg("bets")}</span>Bets${car}</div>` + group(`${sp}-bets`, SUB.map(([id, label]) => sub(sp, id, label)).join(""));
  const alerts = (sp) => `<div class="mi ${sp} mpar mtog" data-tog="${sp}-alerts" data-msp="${sp}" data-mp="alerts"><span class="ic">${svg("bell")}</span>Alerts${car}<b class="cnt" id="mcnt-${sp}-alerts"></b></div>` +
    group(`${sp}-alerts`, ALERTK[sp].map(([k, label]) => `<a class="mi ${sp} msub" data-msp="${sp}" data-mp="alerts-${k}" href="${URL_[sp]}#alerts-${k}"><i></i>${label}${k === "all" ? "" : `<b class="cnt" id="mcnt-${sp}-alerts-${k}"></b>`}</a>`).join(""));   // 10/17 (owner): each kind shows its own unread number
  const item = (sp, id, label, ic) => id === "record" ? subs(sp) : id === "alerts" ? alerts(sp) : `<a class="mi ${sp}" data-msp="${sp}" data-mp="${id}" href="${URL_[sp]}#${id}"><span class="ic">${svg(ic)}</span>${label}<b class="cnt" id="mcnt-${sp}-${id}"></b></a>`;
  const NFL_LOGO_FIX = { WSH: "wsh", WAS: "wsh", LA: "lar", LAR: "lar" };
  const Shell = {
    sport: "nfl", panel: "home",
    nflLogo: (t) => (t ? `https://a.espncdn.com/i/teamlogos/nfl/500/${NFL_LOGO_FIX[t] || String(t).toLowerCase()}.png` : ""),
    nbaLogo: (t, teams) => (teams && teams[t] && teams[t].logo) || (t ? `https://a.espncdn.com/i/teamlogos/nba/500/${String(t).toLowerCase()}.png` : ""),
    img: (src) => (src ? `<img src="${src}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="nl"></span>'),
    // countdown text: "1d 1h 7m", "2h 14m", "26m", "45s"
    clockTxt(ms) {
      if (!(ms > 0)) return "0s";
      const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
      return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
    },
    // header on every page but home: [away logo] vs [home logo]  NEXT GAME  clock
    setNext(awayLogo, homeLogo, ms) {
      const el = document.getElementById("shead-next"); if (!el) return;
      if (awayLogo == null) { if (el.dataset.k !== "none") { el.dataset.k = "none"; el.innerHTML = '<span class="none">No upcoming games</span>'; } return; }
      const k = awayLogo + "|" + homeLogo;
      if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = `${Shell.img(awayLogo)}<span class="vs">vs</span>${Shell.img(homeLogo)}<span class="nglab">NEXT GAME</span><b class="ngclk sgrad" id="shead-clk"></b>`; }
      const c = document.getElementById("shead-clk"); if (c) { const t = Shell.clockTxt(ms); if (c.textContent !== t) c.textContent = t; }
    },
    setActive(panel) {
      Shell.panel = panel;
      const par = String(panel).split("-")[0];   // "modelbets-2": the type is on, Model bets above it is marked as its parent
      document.querySelectorAll(".mi").forEach((a) => { const me = a.dataset.msp === Shell.sport; a.classList.toggle("on", me && a.dataset.mp === panel); a.classList.toggle("pon", me && par !== panel && a.dataset.mp === par); });
      const home = Shell.sport === "nfl" && panel === "home";
      document.body.classList.toggle("home-on", home); document.documentElement.classList.toggle("home-on", home);
      const h = document.getElementById("shead-home"), n = document.getElementById("shead-next");
      if (h) h.style.display = home ? "" : "none"; if (n) n.style.display = home ? "none" : "";
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
    // "Last model refresh · Sat 10/17 9:45 PM" under SLATEZZ: the newer of the NFL and NBA model runs (10/17, owner: one line, newest time)
    runTxt(iso) {
      const d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return "—";
      return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    },
    async loadRun() {
      const e = document.getElementById("mrun"); if (!e) return;
      try { const d = await (await fetch("/api/lastrun", { cache: "no-store" })).json(); e.textContent = "Last model refresh · " + Shell.runTxt(d && d.newest); } catch {}
    },
    init(sport) {
      Shell.sport = sport;
      const d = document.createElement("div");
      d.innerHTML = `<div class="mscrim" id="mscrim"></div><nav class="mdraw" id="mdraw" aria-label="Main menu">` +
        `<div class="mtop"><a class="mlogo sgrad" href="/index.html#home">SLATEZZ</a><div class="mbts">` +
        `<button class="mref" id="mref" aria-label="Rerun both models"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>` +
        `<button class="mclose" id="mclose" aria-label="Close menu"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>` +
        `<div class="mrun" id="mrun">Last model refresh · —</div>` +
        `<div class="msec nfl"><span>NFL</span><span class="ml"></span></div>${ITEMS.nfl.map((x) => item("nfl", ...x)).join("")}` +
        `<div class="msec nba gap"><span>NBA</span><span class="ml"></span></div>${ITEMS.nba.map((x) => item("nba", ...x)).join("")}` +
        `<div class="mspace"></div><div class="msec mod"><span>MODEL ANALYSIS</span><span class="ml"></span></div>${item("nfl", "models", "NFL", "bars")}${item("nba", "models", "NBA", "bars")}</nav>`;
      while (d.firstChild) document.body.appendChild(d.firstChild);
      const mb = document.getElementById("menu-btn"); if (mb) mb.onclick = Shell.open;
      document.getElementById("mclose").onclick = Shell.close; document.getElementById("mscrim").onclick = Shell.close;
      document.getElementById("mref").onclick = Shell.refresh;
      Shell.loadRun(); document.getElementById("menu-btn") && document.getElementById("menu-btn").addEventListener("click", Shell.loadRun);   // fresh each time the menu opens
      document.getElementById("mdraw").addEventListener("click", (e) => {
        const t = e.target.closest(".mtog");
        if (t) { const g = document.querySelector(`.msubs[data-grp="${t.dataset.tog}"]`); const open = !(g && g.classList.contains("open")); t.classList.toggle("open", open); if (g) g.classList.toggle("open", open); return; }
        if (e.target.closest("a")) Shell.close();   // same-page links change the hash; the page switches
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") Shell.close(); });
    },
  };
  window.Shell = Shell;
})();
