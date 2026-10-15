// LINE MATRIX (10/14, owner: "I want all the lines measured so we can always find the advantage").
// For EVERY books number and EVERY half-point line you could buy or sell on Polymarket, the WIN RATE of each side, in day and night games,
// at the CLOSING books number (1999-2025) and the OPENING one (2014-26). Spreads and totals. A cell passes the app's bar when the side wins
// 56%+ on 100+ games and 52%+ in EVERY period (99-05 / 06-13 / 14-19 / 20-26). `points bought` = how far the line is moved in the side's favor
// (a favorite at -2.5 when the books say -4.5 buys 2; an underdog at +7.5 when the books say +5.5 buys 2). More points bought always wins more
// -- and costs more -- so the list is capped at 6 points bought. Prices are NOT judged here (owner rule: win rate). Only half-point lines are
// tested, like Polymarket (no pushes). Run: node --import ./tests/register.mjs tests/line_matrix.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { parseCSV } from "../lib/injuries.js";
import { kickoffISO } from "../lib/games.js";
// day / night is only used in this research file (the app dropped the split 10/15): Thursday, Monday, Sunday 7 PM ET+
const ETF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" });
const isNightGame = (kickoff) => { const d = kickoff ? new Date(kickoff) : null; if (!d || isNaN(d)) return false; const o = {}; for (const x of ETF.formatToParts(d)) o[x.type] = x.value; return o.weekday === "Thu" || o.weekday === "Mon" || (o.weekday === "Sun" && Number(o.hour) % 24 >= 19); };

const r = await fetch("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", { signal: AbortSignal.timeout(60000) });
const [h, ...rows] = parseCSV(await r.text()), ix = (k) => h.indexOf(k);
const games = rows.filter((c) => c[ix("game_type")] === "REG" && c[ix("home_score")] !== "" && c[ix("spread_line")] !== "")
  .map((c) => ({ id: c[ix("game_id")], season: +c[ix("season")], m: +c[ix("home_score")] - +c[ix("away_score")], tot: +c[ix("home_score")] + +c[ix("away_score")],
    sp: +c[ix("spread_line")], tl: c[ix("total_line")] === "" ? null : +c[ix("total_line")], night: isNightGame(kickoffISO(c[ix("gameday")], c[ix("gametime")])) }));
const opens = Object.fromEntries(parseCSV(readFileSync(new URL("../railway-model-service/data/opens.csv", import.meta.url), "utf8")).slice(1).filter((x) => x[0]).map((x) => [x[0], { so: +x[1], to: +x[2] }]));
const period = (y) => (y <= 2005 ? 0 : y <= 2013 ? 1 : y <= 2019 ? 2 : 3);   // 99-05 / 06-13 / 14-19 / 20-26

// one record per game and "version" (close / open): books number, the favorite's margin, the total, the period, day or night
const recs = { close: [], open: [] };
for (const g of games) {
  if (g.sp !== 0) recs.close.push({ B: Math.abs(g.sp), X: g.sp > 0 ? g.m : -g.m, T: g.tl, tot: g.tot, p: period(g.season), n: g.night });
  const o = opens[g.id]; if (o && isFinite(o.so) && o.so !== 0 && g.season >= 2014) recs.open.push({ B: Math.abs(o.so), X: o.so > 0 ? g.m : -g.m, T: isFinite(o.to) ? o.to : null, tot: g.tot, p: period(g.season), n: g.night });
}
const MINN = 100, BAR = 56, PERBAR = 52, MAXBUY = 6;
function build(list, kind) {
  const cells = {};
  for (const x of list) {
    const bk = kind === "total" ? Math.round(x.T * 2) / 2 : x.B; if (kind === "total" && !isFinite(bk)) continue;
    const v = kind === "spread" ? x.X : x.tot - bk;
    const add = (key, win) => { const c = (cells[key] = cells[key] || { w: [0, 0, 0, 0], l: [0, 0, 0, 0] }); if (win) c.w[x.p]++; else c.l[x.p]++; };
    if (kind === "spread") { for (let L = -15.5; L <= 15.5; L += 0.5) { if (Number.isInteger(L)) continue;   // L = the favorite's own line (-2.5 = gives 2.5)
        if (Math.abs(L + x.B) > MAXBUY) continue; for (const dn of ["all", x.n ? "night" : "day"]) add(`${x.B}|${L}|${dn}`, v + L > 0); } }
    else { for (let k2 = -MAXBUY; k2 <= MAXBUY; k2 += 0.5) { if (Number.isInteger(bk + k2)) continue;
        add(`${bk >= 48 ? "48+" : bk >= 42 ? "42-47" : "<=41"}|${k2}|all`, v > k2); } }
  }
  return cells;
}
function judge(c) {
  const sum = (a) => a.reduce((s, x) => s + x, 0), w = sum(c.w), l = sum(c.l), n = w + l; if (n < MINN) return null;
  const per = c.w.map((x, i) => (x + c.l[i] >= 15 ? (100 * x) / (x + c.l[i]) : null)).filter((x) => x != null), rate = (100 * w) / n;
  const fav = { side: "A", rate, per }, dog = { side: "B", rate: 100 - rate, per: per.map((p) => 100 - p) };
  const pass = (z) => z.rate >= BAR && z.per.every((p) => p >= PERBAR);
  return { n, fav, dog, favOk: pass(fav), dogOk: pass(dog) };
}
const out = [], say = (s = "") => { console.log(s); out.push(s); };
const sgn = (x) => (x > 0 ? "+" : "") + x;
for (const ver of ["close", "open"]) {
  const list = recs[ver], cells = build(list, "spread"), J = {}; for (const [k, c] of Object.entries(cells)) { const j = judge(c); if (j) J[k] = j; }
  const passes = [];
  for (const [k, j] of Object.entries(J)) { const [B, L, dn] = k.split("|"), s2 = +L + +B;   // s2 > 0: the favorite buys s2 points; s2 < 0: the underdog buys -s2
    if (j.favOk && s2 !== 0) passes.push({ B: +B, dn, team: "favorite", line: +L, bought: Math.max(s2, 0), sold: Math.max(-s2, 0), z: j.fav, n: j.n });
    if (j.dogOk && s2 !== 0) passes.push({ B: +B, dn, team: "underdog", line: -L, bought: Math.max(-s2, 0), sold: Math.max(s2, 0), z: j.dog, n: j.n }); }
  say(`\n=== SPREAD WIN RATES · ${ver === "close" ? "CLOSING books number (1999-2025)" : "OPENING books number (2014-26)"} · ${list.length} games · ${Object.keys(J).length} cells with 100+ games ===`);
  say(`Passing cells (56%+, 100+ games, every period 52%+, up to ${MAXBUY} points bought or given up): ${passes.length}. Cells that BUY points (the useful kind): ${passes.filter((x) => x.bought > 0).length}.`);
  say(`\nLADDER, all games: for each books number, the favorite's win rate and the underdog's, at each line (points bought -> win %). * = passes the bar`);
  const Bs = [...new Set(Object.keys(J).map((k) => +k.split("|")[0]))].sort((a, b) => a - b);
  for (const B of Bs) { const g = (team) => { const r = []; for (let b = 0.5; b <= 6; b += 0.5) { const L = team === "fav" ? -B + b : -(B + b); if (Number.isInteger(L)) continue;   // L = favorite's own line
        const j = J[`${B}|${L}|all`]; if (!j) continue; const z = team === "fav" ? j.fav : j.dog; r.push(`${b}:${z.rate.toFixed(0)}${(team === "fav" ? j.favOk : j.dogOk) ? "*" : ""}`); } return r.join(" "); };
    const n = Math.max(...["all"].map(() => (J[`${B}|${-B + 0.5}|all`] || J[`${B}|${-B + 1}|all`] || { n: 0 }).n));
    say(`  books ${String(B).padEnd(4)} (${n || "?"} games)  favorite buys: ${g("fav") || "—"}`); say(`${"".padEnd(26)}underdog buys: ${g("dog") || "—"}`); }
  say(`\nPASSING CELLS that buy points, best first (day / night / all shown as separate rows):`);
  for (const x of passes.filter((y) => y.bought > 0).sort((a, b) => b.z.rate - a.z.rate).slice(0, 120))
    say(`  books ${String(x.B).padEnd(4)} ${x.team.padEnd(8)} ${sgn(x.line).padEnd(6)} buys ${String(x.bought).padEnd(3)} ${x.dn.padEnd(5)} wins ${x.z.rate.toFixed(1)}% (${x.n}) periods ${x.z.per.map((p) => p.toFixed(0)).join("/")}`);
}
// RARE 2.5-3 POINT BUYS (owner 10/14: "3 should be the max but only on rare situations"): a 2.5 or 3 point buy is listed only when it wins 60%+ on
// BOTH the closing and the opening numbers (100+ games each) and every period wins 56%+. Day and night games together.
{ const C = build(recs.close, "spread"), O = build(recs.open, "spread"); say("\nRARE 2.5-3 POINT BUYS (60%+ at the close AND the open, every period 56%+):");
  for (const k of Object.keys(C)) { const [B, L, dn] = k.split("|"); if (dn !== "all" || !O[k]) continue; const jc = judge(C[k]), jo = judge(O[k]); if (!jc || !jo) continue; const s2 = +L + +B; if (Math.abs(s2) < 2.5 || Math.abs(s2) > 3) continue;
    const z = (j, c) => (s2 > 0 ? j.fav : j.dog); const a = z(jc), b = z(jo); if (a.rate >= 60 && b.rate >= 60 && a.per.every((p) => p >= 56) && b.per.every((p) => p >= 56))
      say(`  books ${B}: ${s2 > 0 ? "favorite" : "underdog"} at ${sgn(s2 > 0 ? +L : -L)} buys ${Math.abs(s2)} · close ${a.rate.toFixed(1)}% (${jc.n}) ${a.per.map((p) => p.toFixed(0)).join("/")} · open ${b.rate.toFixed(1)}% (${jo.n}) ${b.per.map((p) => p.toFixed(0)).join("/")}`); } }
// TOTALS: Over / Under at the books total plus or minus points, by total size
for (const ver of ["close", "open"]) {
  const list = recs[ver].filter((x) => x.T != null), cells = build(list, "total"), rowsT = [];
  for (const [k, c] of Object.entries(cells)) { const j = judge(c); if (!j) continue; const [bucket, k2] = k.split("|");
    if (j.favOk) rowsT.push({ bucket, side: "Over", off: +k2, rate: j.fav.rate, n: j.n, per: j.fav.per }); if (j.dogOk) rowsT.push({ bucket, side: "Under", off: +k2, rate: j.dog.rate, n: j.n, per: j.dog.per }); }
  say(`\n=== TOTALS WIN RATES · ${ver === "close" ? "CLOSING (1999-2025)" : "OPENING (2014-26)"} · ${list.length} games · passing cells: ${rowsT.length} (Over at books ${"-"}x = buys x points; Under at books +x = buys x points) ===`);
  for (const x of rowsT.filter((y) => (y.side === "Over" ? y.off < 0 : y.off > 0)).sort((a, b) => b.rate - a.rate).slice(0, 40))
    say(`  total ${x.bucket.padEnd(6)} ${x.side} at books ${sgn(x.off).padEnd(5)} buys ${Math.abs(x.off)} wins ${x.rate.toFixed(1)}% (${x.n}) periods ${x.per.map((p) => p.toFixed(0)).join("/")}`);
}
writeFileSync(new URL("./line_matrix_results.txt", import.meta.url), out.join("\n") + "\n");
