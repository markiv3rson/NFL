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
  vm.runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8") + "\n;globalThis.T={spreadReason,totalReason,leanCell,prow,betRow,changedBox,rightNowBox,winnersBox,winnerOf};", ctx);
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
  ok(/5 h old/.test(T.rightNowBox()) && /after a 2% fee/.test(T.rightNowBox()), "right now box");
  globalThis.__ctx = ctx; }

// ---------- Parlay Lab (paper parlays)
{ const { buildPaper, gradePaper } = await import("../lib/paper.js");
  const { booksMaxAgeH } = await import("../lib/edges.js");
  const game = (k, hs, ml, win, extra = {}) => ({ key: k, away: k.split(" @ ")[0], home: k.split(" @ ")[1], started: false, final: false, poly: { spread: { homeSpread: hs }, ml: { home: ml, away: 1 - ml } }, winPct: win, td: [], ...extra });
  const data = { games: [game("A @ B", -10.5, 0.86, 86), game("C @ D", -12, 0.9, 90), game("E @ F", -3, 0.6, 60), game("G @ H", -7, 0.8, 79),
      game("I @ J", -1, 0.5, 50, { td: [{ player: "X.Back", team: "J", price: 0.30, bid: 0.29, fair: 36, market: "X Back 1+" }, { player: "Y.Thin", team: "J", price: 0.30, bid: 0.01, thin: true, fair: 50 }] }),
      game("K @ L", -2, 0.55, 55, { td: [{ player: "Z.Wr", team: "L", price: 0.20, bid: 0.19, fair: 25 }] }), game("M @ N", 1, 0.45, 45, { td: [{ player: "Q.Te", team: "M", price: 0.10, bid: 0.09, fair: 12 }] })],
    edgesNow: [{ game: "E @ F", market: "ml", label: "F ML", price: 0.5, fair: 0.6, evNet: 0.2 }] };
  const P = buildPaper(data), by = (k) => P.filter((p) => p.strategy === k);
  ok(by("home_fav_95_single").length === 2 && by("home_fav_95_2").length === 1 && by("home_fav_95_3").length === 0, "home favorites 9.5+: singles + 2-leg, no 3-leg with only two qualifying", P.map((p) => p.strategy));
  ok(by("top3_home_75").length === 1 && by("top3_home_75")[0].legs.map((l) => l.team).join() === "D,B,H", "top-3 home favorites 75%+ in order");
  ok(by("td_edge_3").length === 1 && !by("td_edge_3")[0].legs.some((l) => l.player === "Y.Thin"), "TD edge parlay uses real markets only");
  ok(by("right_now_3").length === 0, "Right-now parlay needs 3 games");
  ok(Math.abs(by("home_fav_95_2")[0].pay - 1 / (0.9 * 0.86)) < 1e-9, "payout = legs multiplied");
  await setJSON("paper:2026:9", { parlays: [{ strategy: "x", legs: [{ game: "A @ B", kind: "ml", team: "B", price: 0.8 }, { game: "C @ D", kind: "ml", team: "D", price: 0.5 }] },
    { strategy: "y", legs: [{ game: "A @ B", kind: "ml", team: "B", price: 0.8 }, { game: "I @ J", kind: "td", team: "J", player: "X.Back", price: 0.3 }] }] });
  await gradePaper(2026, 9, [{ key: "A @ B", homeScore: 24, awayScore: 20 }, { key: "C @ D", homeScore: 17, awayScore: 17 }, { key: "I @ J", homeScore: 10, awayScore: 3 }],
    async () => Object.assign(["X.Back"], { teams: { "X.Back": ["J"] } }));
  const { getJSON } = await import("../lib/redis.js"); const g = await getJSON("paper:2026:9");
  ok(g.parlays[0].result === "W" && Math.abs(g.parlays[0].ret - (1 / 0.8 - 1)) < 1e-9, "pushed leg drops out, parlay pays the rest");
  ok(g.parlays[1].result === "W" && Math.abs(g.parlays[1].ret - (1 / (0.8 * 0.3) - 1)) < 1e-9, "TD leg graded from scorers");
  ok(booksMaxAgeH(new Date(Date.now() + 48 * 3600e3).toISOString()) === 8 && booksMaxAgeH(new Date(Date.now() + 5 * 3600e3).toISOString()) === 3, "sportsbook-odds age: 8 h early week, 3 h on game day"); }
// ---------- Pick Lab (model's side on every game)
{ const { picksFor, recordPicks, gradePicksWeek, picksSummary } = await import("../lib/paper.js");
  const g = { key: "PIT @ CLE", away: "PIT", home: "CLE" };
  // CLE is a +2.5 underdog at home; the model has CLE winning by 3.1 -> model side is CLE +2.5; total 37.1 vs 38.5 -> Under
  const poly = { spread: { homeSpread: 2.5, home: 0.48, away: 0.53 }, total: { line: 38.5, over: 0.5, under: 0.51 } };
  const p = picksFor(g, poly, { homeMargin: 3.1, total: 37.1 });
  ok(p.length === 2 && p[0].label === "CLE +2.5" && Math.abs(p[0].gap - 5.6) < 1e-9 && p[0].price === 0.48, "spread: model side is CLE +2.5, differs by 5.6, priced at CLE's price", p[0]);
  ok(p[1].label === "Under 38.5" && Math.abs(p[1].gap - 1.4) < 1e-9 && p[1].price === 0.51, "total: model side is Under 38.5", p[1]);
  const q = picksFor(g, { spread: { homeSpread: -6.5, home: 0.5, away: 0.51 } }, { homeMargin: 3.0, total: 40 });
  ok(q.length === 2 && q[0].market === "spread" && q[0].label === "PIT +6.5" && q[0].price === 0.51, "home favorite the model likes less -> road team with the points", q);
  ok(q[1].market === "dog" && q[1].label === "PIT +6.5" && picksFor(g, { spread: { homeSpread: -7, home: 0.5, away: 0.51 } }, { homeMargin: 3.0 }).every((x) => x.market !== "dog") && picksFor(g, { spread: { homeSpread: -2.5, home: 0.5, away: 0.51 } }, { homeMargin: 3.0 }).every((x) => x.market !== "dog"), "road dog +3 to +6.5 is recorded, +7 and +2.5 are not");
  ok(picksFor(g, poly, { homeMargin: -2.5, total: 38.5 }).length === 0, "model exactly on the line -> no pick");
  ok(picksFor(g, null, { homeMargin: 3 }).length === 0 && picksFor(g, poly, null).length === 0, "no lines or no model -> no pick");
  await recordPicks(2026, 4, g, poly, { homeMargin: 3.1, total: 37.1 }, "t");
  await recordPicks(2026, 4, g, poly, { homeMargin: 3.4, total: 37.0 }, "t2");          // a later (closer to kickoff) write replaces the earlier one
  await gradePicksWeek(2026, 4, [{ key: "PIT @ CLE", homeScore: 20, awayScore: 19 }]);      // CLE wins by 1 -> CLE +2.5 covers; 39 total -> Under 38.5 loses
  const sm = await picksSummary(2026);
  ok(sm.spread.w === 1 && sm.spread.l === 0 && Math.abs(sm.spread.roi - (1 / 0.48 - 1)) < 1e-9, "spread graded W, return = 1/price - 1", sm.spread);
  ok(sm.total.l === 1 && sm.total.roi === -1, "total graded L, return -1", sm.total);
  ok(sm.spread.bands.find((x) => x.label === "4 and up").graded === 1 && sm.spread.need === 0.48, "disagreement bands + break-even price", sm.spread.bands); }
// ---------- Most likely winners
{ const ctx = globalThis.__ctx, { winnerFor, recordWinner, gradeWinnersWeek, winnersSummary } = await import("../lib/paper.js");
  const home = winnerFor({ key: "TEN @ BAL", away: "TEN", home: "BAL" }, { spread: { homeSpread: -10.5 } }), road = winnerFor({ key: "KC @ LV", away: "KC", home: "LV" }, { spread: { homeSpread: 7 } });
  ok(home.team === "BAL" && home.where === "home" && Math.abs(home.p - 1 / (1 + Math.exp(-(-0.0452 + 0.1464 * 10.5)))) < 1e-9, "home favorite -10.5: BAL, chance from the calibrated formula", home);
  ok(road.team === "KC" && road.where === "away" && Math.abs(road.p - (1 - 1 / (1 + Math.exp(-(-0.0452 - 0.1464 * 7))))) < 1e-9 && road.p > 0.7, "road favorite (home +7): KC", road);
  ok(winnerFor({ key: "A @ B", away: "A", home: "B" }, { ml: { home: 0.6, away: 0.45 } }).team === "B" && winnerFor({ key: "A @ B", away: "A", home: "B" }, null) === null, "moneyline fallback, and no lines -> no pick");
  const gm = (k, hs) => ({ key: k, away: k.split(" @ ")[0], home: k.split(" @ ")[1], hs });
  for (const x of [["A @ B", -10.5], ["C @ D", -7], ["E @ F", -3], ["G @ H", -1], ["I @ J", 3], ["K @ L", -2]]) await recordWinner(2026, 7, gm(x[0]), { spread: { homeSpread: x[1] } }, "t");
  await gradeWinnersWeek(2026, 7, [{ key: "A @ B", homeScore: 30, awayScore: 10 }, { key: "C @ D", homeScore: 10, awayScore: 20 }, { key: "E @ F", homeScore: 20, awayScore: 17 },
    { key: "G @ H", homeScore: 14, awayScore: 14 }, { key: "I @ J", homeScore: 17, awayScore: 24 }, { key: "K @ L", homeScore: 6, awayScore: 9 }]);
  const w = await winnersSummary(2026);
  ok(w.recorded === 6 && w.all.n === 5 && w.all.w === 3 && w.all.l === 2, "record: 6 recorded, the tie is left out, 3 right and 2 wrong", w.all);
  ok(w.top4.n === 4 && w.top4.w === 3 && w.top4.l === 1, "each week's top 4 by chance (A, C, I, E): A, I, E right and C wrong", w.top4);
  ok(w.bands.find((x) => x.label === "80%+").n === 1 && w.bands.find((x) => x.label === "50-60%").n >= 1, "bands by confidence", w.bands.map((x) => `${x.label}:${x.n}`));
  vm.runInContext(`S = { games: [{ key: "TEN @ BAL", away: "TEN", home: "BAL", started: false, winPct: 84.4, model: { homeMargin: 12, total: 40 }, poly: { ml: { home: 0.82, away: 0.2 }, spread: { homeSpread: -10.5, home: 0.5, away: 0.51 }, total: { line: 41.5, over: 0.5, under: 0.51 } } },
    { key: "KC @ LV", away: "KC", home: "LV", started: false, winPct: 28, poly: { ml: { home: 0.3, away: 0.72 } } },
    { key: "X @ Y", away: "X", home: "Y", started: true, winPct: 60 }], winners: { all: { n: 10, w: 7, l: 3, hit: 0.7, said: 0.68 }, top4: { n: 4, w: 4, l: 0, hit: 1, said: 0.8 } },
    picks: { spread: { recorded: 11, graded: 11, w: 6, l: 5, hit: 6 / 11 }, total: { recorded: 11, graded: 10, w: 4, l: 6, hit: 0.4 } } }`, ctx);
  const box = ctx.T.winnersBox();
  ok(box.indexOf("BAL") < box.indexOf("KC") && /1\. <b>BAL<\/b> over TEN/.test(box) && /2\. <b>KC<\/b> over LV/.test(box) && !/X over Y/.test(box), "page: ranked by chance, started games left out");
  ok(/84%/.test(box) && /82¢/.test(box) && /7–3 · right 70%/.test(box) && /top 4/i.test(box), "page: chance, price and the season record shown");
  ok(/BAL -10\.5 · Under 41\.5/.test(box), "page: each game also shows the model's spread side and total side");
  ok(/Spreads[\s\S]*6–5 · covered 55%/.test(box) && /Totals[\s\S]*4–6 · right 40%/.test(box), "page: separate season records for winners, spreads and totals"); }
console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(bad ? 1 : 0);
