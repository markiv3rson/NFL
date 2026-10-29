// LOOK CHECK (10/29, owner: "How do I make you recheck your work so everything stays consistent ... Make sure it locks"): opens every page of both
// sports at phone size (390 x 844) in a real browser and fails when
//   - anything runs off the screen,
//   - a one-line piece (team name on a tile, slot header, tab chip, column heading, MODEL / POLYMARKET cell, record tile label) wraps or is cut off,
//   - the columns of a table row overlap,
//   - the same kind of text looks different on NFL and NBA (size, weight, capitals, font, colour).
// Runs on saved copies of the live data (tests/look/*.json, the clock frozen at the moment they were saved) so it gives the same answer every time.
// npm run test:look          check (exit 1 + the list when anything fails)
// npm run test:look -- --record   save fresh copies of the live data first (needs the network)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."), PUB = join(ROOT, "public"), FIX = join(ROOT, "tests", "look");
const RECORD = process.argv.includes("--record"), LIVE = "https://nfl-nfl9.vercel.app";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(execSync("npm root -g").toString().trim() + "/playwright"); }
const exe = ["/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell"].find((p) => existsSync(p));

if (RECORD) { mkdirSync(FIX, { recursive: true }); for (const f of readdirSync(FIX)) if (f.endsWith(".json")) unlinkSync(join(FIX, f)); writeFileSync(join(FIX, "meta.json"), JSON.stringify({ t: Date.now() })); }
const meta = JSON.parse(readFileSync(join(FIX, "meta.json"), "utf8"));
const fixName = (p, q) => join(FIX, (p.replace(/^\/api\//, "") + (q ? "_" + q : "")).replace(/[^\w.-]+/g, "_").slice(0, 150) + ".json");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const type = (p) => (p.endsWith(".js") || p.endsWith(".mjs") ? "text/javascript" : p.endsWith(".html") ? "text/html" : p.endsWith(".css") ? "text/css" : p.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(p) ? "image/jpeg" : p.endsWith(".webp") ? "image/webp" : p.endsWith(".svg") ? "image/svg+xml" : p.endsWith(".json") ? "application/json" : "application/octet-stream");

// the pages: [sport, name, hash, then-click]
const PAGES = [
  ["nfl", "home", "", null], ["nba", "home", "", null],
  ["nfl", "game", "", ".tile"], ["nba", "game", "", ".tile"],
  ["nfl", "mybets", "mybets", null], ["nba", "mybets", "mybets", null],
  ["nfl", "modelbets-lines", "modelbets-lines", null], ["nba", "modelbets-lines", "modelbets-lines", null],
  ["nfl", "modelbets-props", "modelbets-props", null], ["nba", "modelbets-props", "modelbets-props", null],
  ["nfl", "modelbets-halves", "modelbets-halves", null], ["nfl", "modelbets-gprops", "modelbets-gprops", null],
  ["nfl", "props", "td", null], ["nba", "props", "props-pts", null],
  ["nfl", "models", "models", null], ["nba", "models", "models", null],
  ["nfl", "alerts", "alerts", null], ["nba", "alerts", "alerts", null],
  ["nfl", "game-props", "", [".tile", '[data-gtab="props"]']], ["nba", "game-props", "", [".tile", '[data-gtab="props"]']],
  ["nfl", "game-parlays", "", [".tile", '[data-gtab="parlays"]']], ["nba", "game-parlays", "", [".tile", '[data-gtab="parlays"]']],
  ["nfl", "props-2", "props-recyds", null], ["nba", "props-2", "props-reb", null], ["nfl", "props-first", "props-first", null],
  ["nfl", "mybets-settled", "mybets", ['[data-drop="settled"]']], ["nba", "mybets-settled", "mybets", ['[data-drop="settled"]']],
  ["nfl", "props-3", "props-rec", null], ["nfl", "props-4", "props-rushyds", null], ["nba", "props-3", "props-ast", null], ["nba", "props-4", "props-pra", null],
  ["nba", "props-5", "props-stl", null], ["nba", "props-6", "props-blk", null],
  ["nfl", "modelbets-td", "modelbets-props", ['[data-mbprop="td"]']], ["nfl", "modelbets-first", "modelbets-props", ['[data-mbprop="first"]']],
  ["nfl", "modelbets-recyds", "modelbets-props", ['[data-mbprop="recyds"]']], ["nba", "modelbets-reb", "modelbets-props", ['[data-mbprop="reb"]']],
];
const WIDTHS = [390, 430, 375, 1440];   // phone (every check), the owner's iPhone 15 Pro Max (430), a small phone (375) and computer (off the screen / wraps / cut / overlap)
// one-line pieces (never wrap, never cut)
const ONE_LINE = [".tile .nm > .t", ".sh", ".gchip", ".pph > span", ".ppr .pp3", ".ppr .pp4", ".stat .k", ".mbhero .lbl", ".pbn"];
// kinds of text compared NFL vs NBA
const KINDS = { "page title": ".phead h1, .phead .ttl, h1", "slot header": ".sh", "tab chip": ".gchip", "column heading": ".pph > span", "pick cell": ".ppr .pp1", "model %": ".ppr .pp3", "price": ".ppr .pp4",
  "tile team": ".tile .nm > .t", "tile middle": ".tile .mid", "record tile label": ".stat .k", "record tile number": ".stat .v", "row": ".card .row > span:first-child", "profit": ".mbhero b", "fold": ".fold > span:first-child", "game tab": ".gtab", "game team": "#detail .t" };

const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, timezoneId: "America/Los_Angeles", locale: "en-US" });
await ctx.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname !== "look.test") return /\.(png|jpe?g|webp|svg|gif)$/i.test(u.pathname) || route.request().resourceType() === "image" ? route.fulfill({ body: PNG, contentType: "image/png" }) : route.abort();
  let p = u.pathname;
  if (p.startsWith("/api/")) {
    if (route.request().method() !== "GET" || /sync|grade|rerun|snapshot|comboquote/.test(p)) return route.fulfill({ contentType: "application/json", body: '{"ok":false}' });
    const f = fixName(p, u.search.slice(1));
    if (RECORD && !existsSync(f)) { let body = '{"ok":false}'; try { body = execSync(`curl -s -m 60 '${LIVE}${p}${u.search}'`, { maxBuffer: 64e6 }).toString() || body; } catch {} writeFileSync(f, body); }
    return route.fulfill({ contentType: "application/json", body: existsSync(f) ? readFileSync(f) : '{"ok":false}' });
  }
  if (p === "/") p = "/index.html";
  try { return route.fulfill({ body: readFileSync(join(PUB, decodeURIComponent(p))), contentType: type(p) }); } catch { return route.fulfill({ status: 404, body: "" }); }
});

const fails = [], styles = {};
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;   // ONLY=regex runs just the pages whose "sport name" matches (a quick rerun)
for (const W of WIDTHS) for (const [sp, name, hash, click] of PAGES) {
  if (ONLY && !ONLY.test(`${sp} ${name}`)) continue;
  const page = await ctx.newPage(), errs = [];
  await page.setViewportSize({ width: W, height: W > 600 ? 900 : 844 });
  page.on("pageerror", (e) => errs.push(String(e).split("\n")[0]));
  await page.clock.setFixedTime(meta.t);
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem("slz-live", "1"); } catch {} });   // slz-live: the page opens on its own hash, not Home
  await page.goto(`http://look.test/${sp === "nba" ? "nba/" : ""}index.html${hash ? "#" + hash : ""}`);
  await page.waitForTimeout(3500);
  for (const c of [].concat(click || [])) { await page.evaluate((s) => { const t = [...document.querySelectorAll(s)].find((e) => e.offsetParent); if (t) t.click(); }, c); await page.waitForTimeout(1800); }
  const r = await page.evaluate(({ ONE_LINE, KINDS }) => {
    const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && e.textContent.trim() !== ""; };
    const lines = (e) => { const tops = [...e.querySelectorAll("*"), e].flatMap((n) => [...n.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim() && !c.parentElement.closest(".rec")).flatMap((c) => { const rg = document.createRange(); rg.selectNodeContents(c); return [...rg.getClientRects()]; })).filter((x) => x.width > 1 && x.height > 4).map((x) => Math.round(x.top + x.height / 2)); const u = []; for (const t of tops.sort((a, b) => a - b)) if (!u.length || t - u[u.length - 1] > 6) u.push(t); return u.length; };
    const lbl = (e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 40);
    const out = { over: document.documentElement.scrollWidth > innerWidth + 1, wrap: [], cut: [], overlap: [], style: {} };
    for (const s of ONE_LINE) for (const e of document.querySelectorAll(s)) { if (!vis(e)) continue;
      if (lines(e) > 1) out.wrap.push(`${s} "${lbl(e)}"`);
      const cs = getComputedStyle(e); if (cs.overflow !== "visible" && e.scrollWidth > e.clientWidth + 1) out.cut.push(`${s} "${lbl(e)}"`); }
    for (const row of document.querySelectorAll(".ppr")) { if (!vis(row)) continue;
      const cells = [...row.children].filter((c) => /^pp\d/.test(c.className.split(" ")[0] || "") && vis(c)).map((c) => { const rg = document.createRange(); rg.selectNodeContents(c); const rs = [...rg.getClientRects()].filter((x) => x.width > 1); const cb = c.getBoundingClientRect(), clip = getComputedStyle(c).overflow !== "visible";   // a cell that cuts its text with … only shows what fits in its box
        return { c, l: Math.max(Math.min(...rs.map((x) => x.left)), clip ? cb.left : -1e9), r: Math.min(Math.max(...rs.map((x) => x.right)), clip ? cb.right : 1e9), t: Math.min(...rs.map((x) => x.top)), b: Math.max(...rs.map((x) => x.bottom)) }; }).filter((x) => isFinite(x.l));
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) { const a = cells[i], b = cells[j];
        if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.overlap.push(`"${lbl(a.c)}" / "${lbl(b.c)}" in "${lbl(row)}"`); } }
    for (const [k, s] of Object.entries(KINDS)) { const e = [...document.querySelectorAll(s)].find(vis); if (!e) continue; const cs = getComputedStyle(e);
      out.style[k] = { size: cs.fontSize, weight: cs.fontWeight, caps: cs.textTransform, font: cs.fontFamily.split(",")[0].trim(), colour: cs.color, sample: lbl(e) }; }
    return out;
  }, { ONE_LINE, KINDS });
  const tag = `${sp.toUpperCase()} ${name}${W === 390 ? "" : ` (${W} px)`}`;
  if (errs.length) fails.push(`${tag}: page error ${errs[0]}`);
  if (r.over) fails.push(`${tag}: runs off the screen (sideways scroll)`);
  for (const w of [...new Set(r.wrap)]) fails.push(`${tag}: wraps onto 2 lines -- ${w}`);
  for (const w of [...new Set(r.cut)]) fails.push(`${tag}: cut off -- ${w}`);
  for (const w of [...new Set(r.overlap)]) fails.push(`${tag}: columns overlap -- ${w}`);
  if (W === 390) (styles[name] = styles[name] || {})[sp] = r.style;
  await page.close();
}
for (const [name, s] of Object.entries(styles)) { if (!s.nfl || !s.nba) continue;
  for (const k of Object.keys(s.nfl)) { const a = s.nfl[k], b = s.nba[k]; if (!b) continue;
    const diff = ["size", "weight", "caps", "font", ...(/record tile number|pick cell|tile middle|profit/.test(k) ? [] : ["colour"])].filter((f) => a[f] !== b[f]);   // those colours come from the win rate / result, not the design
    if (diff.length) fails.push(`${name}: ${k} differs NFL vs NBA -- ${diff.map((f) => `${f} ${a[f]} vs ${b[f]}`).join(", ")} ("${a.sample}" / "${b.sample}")`); } }
await browser.close();
if (fails.length) { console.log(fails.join("\n")); console.log(`LOOK CHECK FAILED: ${fails.length}`); process.exit(1); }
console.log(`look check passed: ${PAGES.length} pages x ${WIDTHS.length} widths (${WIDTHS.join(" / ")} px), both sports`);
