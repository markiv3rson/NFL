// Automated checks for the site (run: npm test). Every check here was a real bug or a number that must never drift:
// odds math, line moves with key numbers, TD math matching the Python model, name matching, the edge tracker, and the
// sentences the page shows. GitHub runs this plus the build on every push (.github/workflows/ci.yml).
import vm from "node:vm";
import { readFileSync } from "node:fs";
import RedisMock from "ioredis-mock";
globalThis.__TEST_REDIS__ = new RedisMock();
const { toProb, toAmerican, ncdf, ninv, kellyStake, isThinMarket, SD_MARGIN, shiftCover } = await import("../lib/odds.js");
const { spreadPick, totalPick, winPctAt, gameBets, priceTd, nameMatches, tdRows, rosterPosFor } = await import("../lib/picks.js");
const { twoPlus, firstTdShares, applyCalibration, buildCalibration } = await import("../lib/calibration.js");
const { logEdges, gradeEdges, edgeSummary } = await import("../lib/edges.js");
const { setJSON } = await import("../lib/redis.js");

let bad = 0, n = 0;
const ok = (c, msg, v) => { n++; if (!c) { bad++; console.log("FAIL", msg, v === undefined ? "" : JSON.stringify(v)); } };
const near = (a, b, t = 1e-3) => Math.abs(a - b) < t;

// ---------- odds math
ok(toAmerican(0.6) === -150 && toAmerican(0.4) === 150 && toAmerican(0.5) === -100, "toAmerican");
ok(near(toProb(-150), 0.6) && near(toProb(150), 0.4), "toProb");
ok(near(ncdf(1.96), 0.975, 1e-4) && near(ncdf(0), 0.5, 1e-6), "ncdf");
{ let mx = 0; for (let p = 0.001; p < 1; p += 0.001) mx = Math.max(mx, Math.abs(ncdf(ninv(p)) - p)); ok(mx < 1e-4, "ninv inverts ncdf", mx); }
ok(isFinite(ninv(0)) && isFinite(ninv(1)), "ninv safe at 0/1");
ok(kellyStake(0.6, 0.5) === 50 && kellyStake(0.55, 0.5) === 25 && kellyStake(0.4, 0.5) === 0, "quarter Kelly");
ok(isThinMarket(0.4, 0.01) && !isThinMarket(0.4, 0.37) && isThinMarket(0.07, 0.01), "thin-market rule");
// ---------- line moves (key numbers)
{ const m = { homeMargin: 3, calHomeCover: 50, mktHomeSpread: -3 }, a = spreadPick(m, -3.5, "A", "H"), c = spreadPick(m, -2.5, "A", "H");
  ok(a.side === "away" && c.side === "home" && near(a.pct, c.pct, 0.5), "spread shift direction", [a.pct, c.pct]); }
ok(0.5 - shiftCover(0.5, -2.5, -3.5) > 2 * (0.5 - shiftCover(0.5, -4.5, -5.5)), "key numbers: crossing 3 moves more than 4.5->5.5");
ok(shiftCover(0.53, -3, -3) === 0.53, "shift keeps the anchor");
{ const t = totalPick({ total: 44, calUnder: 50, mktTotal: 44 }, 45); ok(t.side === "under" && t.pct > 50, "total shift direction"); }
ok(near(winPctAt({ homeMargin: 5 }, -3), 100 / (1 + Math.exp(-(-0.0452 + 0.1464 * 3))), 1e-9), "win % == fair_line.cal_win");
{ const b = gameBets("A @ H", "A", "H", { spread: { homeSpread: -7, home: 0.35, away: 0.66 } }, null, null, null, { homeMargin: 3, calHomeCover: 49, mktHomeSpread: -3 });
  const h = b.find((x) => x.label === "H -7"); ok(!h || h.fair < 0.4, "model-only fair uses the CURRENT line (no fake edge)", h && h.fair); }
{ const b = gameBets("A @ H", "A", "H", { spread: { homeSpread: -3, home: 0.48, away: 0.53 } }, { spread: { homeSpread: -3, home: { fair: 0.5 }, away: { fair: 0.5 } } }, null, null, null);
  ok(near(b[0].fair, 0.5, 1e-6) && near(b[0].ev, 0.5 / 0.48 - 1, 1e-5), "book fair + EV"); }
// ---------- TD math (same as td_prob.py)
{ const lam = -Math.log(0.6); ok(near(twoPlus(40), Math.min(0.6, 1.035 * (1 - Math.exp(-lam) * (1 + lam))) * 100, 1e-9), "twoPlus == td_prob.two_plus"); }
{ const sh = firstTdShares([{ fair: 40 }, { fair: 20 }]), l1 = -Math.log(0.6), l2 = -Math.log(0.8), T = l1 + l2 + 0.4; ok(near(sh[0], l1 / T * (1 - Math.exp(-T)) * 100, 1e-9), "firstTdShares == td_prob.first_td"); }
{ const recs = [{ td: [...Array(60)].map((_, i) => ({ fair: 10 + (i % 10), scored: i % 3 === 0 })).concat([...Array(60)].map((_, i) => ({ fair: 38 + (i % 6), scored: i % 5 === 0 }))) }];
  const cal = buildCalibration(recs); let prev = -1, mono = true; for (let f = 1; f <= 90; f += 0.1) { const v = applyCalibration(f, cal); if (v < prev - 1e-9) mono = false; prev = v; } ok(mono, "calibration keeps order"); }
{ const r = priceTd({ fair: 30, price: 0.25, teamRank: 1 }); ok(near(r.ev, 0.2) && r.priceLabel === "Underpriced", "TD EV"); }
// ---------- names
ok(!nameMatches("Mike Williams", "Mike Williamson 1+ touchdowns"), "whole-word names");
ok(nameMatches("Travis Etienne Jr.", "Travis Etienne Jr.") && nameMatches("Travis Etienne Jr.", "Travis Etienne") && nameMatches("Amon-Ra St. Brown", "Amon-Ra St. Brown 1+"), "Jr./St. full names");
ok(nameMatches("Bi.Robinson", "Bijan Robinson 1+ touchdowns") && !nameMatches("Bi.Robinson", "Brian Robinson Jr. 1+") && nameMatches("A.J.Brown", "A.J. Brown 1+"), "play-by-play short names");
{ const snaps = { NYG: { a: { name: "Daniel Jones", pos: "QB" } }, ARI: {} };
  const px = { "Daniel Jones 1+ touchdowns": { ask: 0.15, bid: 0.14 }, "Bam Knight 1+ touchdowns": { ask: 0.3, bid: 0.29 }, "Tyrone Tracy Jr. 1+ touchdowns": { ask: 0.27, bid: 0.26 } };
  const r = Object.fromEntries(tdRows("ARI @ NYG", "ARI", "NYG", { away: [{ name: "Z.Knight", pos: "RB", fair: 30 }, { name: "T.Tracy", pos: "RB", fair: 25 }], home: [{ name: "Z.Jones", pos: "WR", fair: 18 }] }, px, {}, rosterPosFor(snaps, "ARI", "NYG")).map((x) => [x.player, x.market]));
  ok(r["Z.Jones"] == null && r["Z.Knight"] === "Bam Knight 1+ touchdowns" && r["T.Tracy"] === "Tyrone Tracy Jr. 1+ touchdowns", "nickname fallback safe", r); }
// ---------- edge tracker
{ const g = { key: "A @ H", away: "A", home: "H", homeScore: 24, awayScore: 20 }, now = new Date().toISOString();
  const poly = { ml: { home: 0.55, away: 0.47 }, spread: { homeSpread: -3.5, home: 0.45, away: 0.56 }, total: { line: 44.5, over: 0.45, under: 0.56 } };
  const bk = { ml: { home: { fair: 0.62 }, away: { fair: 0.38 } }, spread: { homeSpread: -3.5, home: { fair: 0.5 }, away: { fair: 0.5 } }, total: { line: 44.5, over: { fair: 0.5 }, under: { fair: 0.5 } } };
  ok(await logEdges(2026, 9, g, poly, bk, new Date(Date.now() - 4 * 3600e3).toISOString(), now) === 0, "stale books not used");
  ok(await logEdges(2026, 9, g, poly, bk, now, now) === 3, "3 spots logged");
  ok(await logEdges(2026, 9, g, poly, bk, now, now) === 0, "no duplicates");
  await setJSON("close:2026:9:A @ H", { poly: { ml: { home: 0.60, away: 0.42 }, spread: { homeSpread: -3.5, home: 0.50, away: 0.51 }, total: { line: 45.5, over: 0.5, under: 0.5 } } });
  await gradeEdges(2026, 9, g); const s = await edgeSummary(2026);
  ok(s.graded === 3 && s.w === 2 && s.l === 1, "edge results", s);
  ok(near(s.roi, ((1 / 0.55 - 1) + (1 / 0.45 - 1) - 1) / 3, 1e-9) && s.clvN === 2, "edge ROI + CLV only on same line", s); }
// ---------- what the page says (runs the real public/app.js)
{ const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, set innerHTML(v) {}, set textContent(v) {}, addEventListener() {} });
  const store = { lastSeen: "2026-10-01T12:00:00Z" };
  const ctx = { document: { getElementById: () => el(), querySelectorAll: () => [], addEventListener() {}, hidden: false }, fetch: () => Promise.reject(new Error("offline")),
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) }, location: { reload() {} }, window: {}, setTimeout, clearTimeout, console, Date, Math, Number, String, JSON, Promise, Set, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8") + "\n;globalThis.T={spreadReason,totalReason,leanCell,prow,betRow,changedBox,rightNowBox};", ctx);
  const T = ctx.T;
  let g = { away: "DAL", home: "PHI", model: { homeMargin: 4.2, fix: {} }, poly: { spread: { homeSpread: -3.5 } } };
  ok(/PHI winning by about 4\.2/.test(T.spreadReason(g)) && /needs PHI to win by 4\+/.test(T.spreadReason(g)), "spread wording");
  g.poly.spread.homeSpread = -3; ok(/more than 3/.test(T.spreadReason(g)), "whole-number spread wording");
  g = { away: "A", home: "H", model: { total: 44.4, fix: { dome: 2.59, pace: 0.1, div: true } }, poly: { total: { line: 45.5 } } };
  ok(/about 44\.4 total/.test(T.totalReason(g)) && /indoor game \+2\.6/.test(T.totalReason(g)), "totals wording");
  g = { away: "A", home: "H", winPct: 61.2, model: { homeMargin: 3, fix: {} }, spreadPick: { label: "H -2.5", pct: 51.1 }, poly: {} };
  ok(/No lean · about 50\/50/.test(T.leanCell(g, "spread")) && /H 61% · A 39%/.test(T.leanCell(g, "spread")), "lean wording");
  const row = T.prow({ player: "O'Neil <b>", pos: "WR", team: "H", game: "A @ H", fair: 20.1, fairIfPlays: 30, injury: "Questionable", price: 0.25, teamRank: 2 }, { started: false }, false);
  ok(/30% if he plays/.test(row) && /O&#39;Neil &lt;b>/.test(row), "Questionable row + names escaped");
  ok(/check how Polymarket settled it/.test(T.betRow({ source: "preloaded", legs: [{ result: "W", kind: "total", side: "under", line: 43 }, { result: "P", kind: "total", side: "over", line: 44 }], result: "P", pushUnconfirmed: true, cost: 5, toWin: 20, pl: null })), "combo push wording");
  vm.runInContext(`S = { games: [{ key: "DAL @ PHI", away: "DAL", home: "PHI", started: false, poly: { spread: { homeSpread: -4 }, total: { line: 45.5 }, ml: { home: 0.66 } },
    history: [{ t: "2026-10-01T10:00:00Z", poly: { spread: { homeSpread: -3 }, total: { line: 45.5 }, ml: { home: 0.60 } } }] }], edgesNow: [], edgeRule: { min: 0.03, feePct: 2, booksAgeH: 5, booksMaxAgeH: 3 } }`, ctx);
  ok(/spread PHI -3 → -4/.test(T.changedBox()) && /moneyline 60¢ → 66¢/.test(T.changedBox()), "what changed");
  ok(/5 h old/.test(T.rightNowBox()) && /after a 2% fee/.test(T.rightNowBox()), "right now box"); }

console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(bad ? 1 : 0);
