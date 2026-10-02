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
// ---------- phone setup (home-screen app)
{ const fs = await import("node:fs"); const root = new URL("../public/", import.meta.url);
  const man = JSON.parse(fs.readFileSync(new URL("manifest.webmanifest", root), "utf8")), html = fs.readFileSync(new URL("index.html", root), "utf8"), mw = fs.readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  ok(man.display === "standalone" && man.icons.length >= 2 && man.icons.every((i) => fs.existsSync(new URL("." + i.src, root))), "phone: manifest is standalone and every icon file exists");
  ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable/.test(html) && /viewport-fit=cover/.test(html) && /rel="manifest"/.test(html) && /safe-area-inset-top/.test(html), "phone: home-screen meta tags, full-screen viewport and safe areas");
  ok(["manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png"].every((f) => mw.includes(f)), "phone: icon and manifest are reachable before login"); }
// ---------- live lines (display only)
{ const { liveLines } = await import("../lib/live.js");
  const mk = (t, q, o, px, line) => ({ sportsMarketType: t, question: q, outcomes: JSON.stringify(o), outcomePrices: JSON.stringify(px), bestAsk: px[0] + 0.01, bestBid: px[0] - 0.01, ...(line != null ? { line } : {}) });
  const ev = { title: "Pittsburgh Steelers vs. Cleveland Browns", markets: [mk("moneyline", "Steelers vs. Browns", ["Steelers", "Browns"], [0.55, 0.45]), mk("spreads", "Spread: Steelers (-2.5)", ["Steelers", "Browns"], [0.5, 0.5], -2.5), mk("totals", "Steelers vs. Browns: O/U 38.5", ["Over", "Under"], [0.5, 0.5], 38.5)] };
  const past = new Date(Date.now() - 3600e3).toISOString(), future = new Date(Date.now() + 86400e3).toISOString();
  const out = await liveLines([{ key: "PIT @ CLE", away: "PIT", home: "CLE", kickoff: past, final: false }, { key: "IND @ WAS", away: "IND", home: "WAS", kickoff: future, final: false },
    { key: "TEN @ BAL", away: "TEN", home: "BAL", kickoff: past, final: true }, { key: "NE @ BUF", away: "NE", home: "BUF", kickoff: past, final: false }], [ev]);
  ok(out["PIT @ CLE"] && out["PIT @ CLE"].spread.homeSpread === 2.5 && out["PIT @ CLE"].total.line === 38.5 && out["PIT @ CLE"].ml, "live lines: a game in progress gets Polymarket's current lines", out);
  ok(!("IND @ WAS" in out) && !("TEN @ BAL" in out), "live lines: games not started or already final are left out");
  ok(out["NE @ BUF"] === null, "live lines: no open Polymarket event -> null (shown as paused), not a stale number"); }
// ---------- alerts feed
{ const { addAlert, listAlerts, alertsFromRerun, alertsFromLines, alertResult } = await import("../lib/alerts.js");
  const g = { key: "PIT @ CLE", away: "PIT", home: "CLE" };
  ok(await addAlert(2026, { kind: "INJURY", game: g.key, title: "CLE: Jenkins ruled out" }) === 1 && await addAlert(2026, { kind: "INJURY", game: g.key, title: "CLE: Jenkins ruled out" }) === 0, "alerts: the same alert twice is kept once");
  const old = { homeMargin: 3.1, homeWinPct: 60, inj: { home: { players: [] }, away: { players: [] } }, fix: {}, wind: 5, outdoor: true };
  const nw = { homeMargin: 2.3, homeWinPct: 59, inj: { home: { players: [{ name: "Jenkins", status: "Out" }] }, away: { players: [] } }, fix: { awayQbFirstStart: true }, wind: 14, outdoor: true };
  const n = await alertsFromRerun(2026, g, old, nw), all = await listAlerts(2026);
  ok(n === 3 && all.some((a) => a.kind === "INJURY" && /Jenkins ruled out/.test(a.title) && a.team === "CLE" && /CLE by 2\.3 \(was CLE by 3\.1\)/.test(a.sub)), "alerts: a new injury says who and how the model moved", all);
  ok(all.some((a) => a.kind === "QB CHANGE") && all.some((a) => a.kind === "WEATHER" && /14 mph/.test(a.title)), "alerts: backup QB and wind crossing 12 mph");
  ok(await alertsFromRerun(2026, g, null, nw) === 0 && await alertsFromRerun(2026, g, nw, nw) === 0, "alerts: the first run of a week, or an unchanged run, adds nothing");
  ok(await alertsFromRerun(2026, { key: "A @ B", away: "A", home: "B" }, { homeMargin: 1.2, homeWinPct: 54, inj: {}, fix: {} }, { homeMargin: -1.5, homeWinPct: 47, inj: {}, fix: {} }) === 1, "alerts: the model flipping sides is one alert");
  const lm = await alertsFromLines(2026, g, { spread: { homeSpread: 3 }, total: { line: 38.5 }, ml: { home: 0.40 } }, { spread: { homeSpread: 2.5 }, total: { line: 38.5 }, ml: { home: 0.41 } });
  ok(lm === 1 && (await listAlerts(2026))[0].title === "PIT @ CLE spread: CLE +3 → +2.5", "alerts: a half-point spread move, but not a 1-cent price move");
  await alertResult(2026, { key: "TEN @ BAL", away: "TEN", home: "BAL", awayScore: 13, homeScore: 27 }, { ml: { label: "BAL ML", result: "W" }, spread: { label: "BAL -10.5", result: "W" } });
  ok((await listAlerts(2026))[0].title === "Final: TEN 13 @ BAL 27" && /Moneyline pick BAL won/.test((await listAlerts(2026))[0].sub), "alerts: a final result", (await listAlerts(2026))[0]); }
// ---------- returning-from-injury label: last week's Out/Doubtful list comes from the same injury file
{ const { parseInjuryText } = await import("../lib/injuries.js");
  const csv = ["season,season_type,team,week,full_name,position,report_primary_injury,report_status,practice_primary_injury,practice_status",
    "2026,REG,LV,3,Brock Bowers,TE,Knee,Out,Knee,Did Not Participate",
    "2026,REG,LV,3,Jakobi Meyers,WR,Ankle,Questionable,Ankle,Limited Participation",
    "2026,REG,LV,4,Brock Bowers,TE,,,Knee,Full Participation",
    "2026,REG,LV,4,Jakobi Meyers,WR,Ankle,Doubtful,Ankle,Limited Participation",
    "2026,REG,SEA,2,Old Out,WR,Back,Out,Back,Did Not Participate", "2026,REG,SEA,3,Cooper Kupp,WR,Hamstring,Doubtful,Hamstring,Limited Participation"].join("\n");
  const v = parseInjuryText(csv);
  ok(v.prev.LV.length === 1 && v.prev.LV[0].name === "Brock Bowers" && v.prev.LV[0].status === "Out" && v.prev.SEA.length === 1 && v.prev.SEA[0].name === "Old Out", "returning label data: last week's Out/Doubtful list (the week before each team's latest report)", v.prev);
  ok(v.teams.LV.some((x) => x.name === "Jakobi Meyers" && x.status === "Doubtful") && !v.teams.LV.some((x) => x.name === "Brock Bowers" && /out/i.test(x.status)), "latest report is still each team's newest week", v.teams.LV); }
// ---------- replay (history table): the verdict rule, the maths on a tiny schedule, the card
{ const { verdict, computeReplay } = await import("../lib/replay.js");
  const per = (...v) => v.map((x) => ({ n: 60, value: x }));
  ok(verdict("ats", 300, 0.54, per(0.55, 0.53, 0.54)) === "YES" && verdict("ats", 300, 0.54, per(0.60, 0.50, 0.55)) === "UNSTABLE" && verdict("ats", 300, 0.50, per(0.5, 0.5, 0.5)) === "NO EDGE" && verdict("ats", 99, 0.7, per(0.7, 0.7, 0.7)) === "TOO FEW" && verdict("win", 5000, 0.67, []) === "INFO", "replay verdicts: YES needs every period above break-even");
  ok(verdict("ml", 300, 0.02, per(0.05, 0.01, 0.02)) === "YES" && verdict("ml", 300, 0.02, per(0.05, -0.01, 0.02)) === "UNSTABLE" && verdict("ml", 300, -0.01, per(0.05, -0.01, 0.02)) === "NO EDGE", "replay verdicts: moneyline rows use return, not 52.4%");
  const gm = (season, week, away, home, as, hs, spread, extra = {}) => ({ season, week, away, home, as, hs, spread, total: 44, roof: "outdoors", wind: 5, hml: -400, ...extra });
  const rows = [gm(2010, 1, "A", "B", 20, 10, 4), gm(2010, 2, "C", "D", 17, 20, 5), gm(2010, 3, "E", "F", 10, 30, 3), gm(2010, 4, "G", "H", 24, 28, 4), gm(2010, 5, "I", "J", 10, 31, 10, { hml: -500 })];
  const R = computeReplay(rows), by = (id) => R.rows.find((r) => r.id === id);
  ok(by("dog").n === 3 && Math.abs(by("dog").hit - 2 / 3) < 1e-9, "replay: road dogs +3..6.5 — covers counted, push dropped", [by("dog").n, by("dog").hit]);
  ok(by("homefav").n === 1 && Math.abs(by("homefav").roi - 0.2) < 1e-9, "replay: home fav 9.5+ moneyline return from the closing price", by("homefav"));
  ok(R.rows.length === 9 && R.rows[1].id === "spread_model" && R.rows[0].id === "favorite", "replay: nine rows, favorite first, model rows fixed"); }
// ---------- live scores (ESPN scoreboard -> per-game score + clock)
{ const { parseScoreboard } = await import("../lib/live.js");
  const ev = (away, home, as, hs, state, period, clock, detail, completed = false) => ({ competitions: [{ competitors: [{ homeAway: "home", score: String(hs), team: { displayName: home } }, { homeAway: "away", score: String(as), team: { displayName: away } }] }],
    status: { period, displayClock: clock, type: { state, shortDetail: detail, completed } } });
  const j = { events: [ev("Pittsburgh Steelers", "Cleveland Browns", 14, 10, "in", 3, "4:12", "4:12 - 3rd"), ev("Los Angeles Rams", "Philadelphia Eagles", 7, 7, "in", 2, "0:00", "Halftime"),
    ev("Denver Broncos", "San Francisco 49ers", 20, 17, "in", 5, "2:10", "2:10 - OT"), ev("Detroit Lions", "Carolina Panthers", 30, 10, "post", 4, "0:00", "Final", true), ev("Atlanta Falcons", "New Orleans Saints", 0, 0, "pre", 0, "15:00", "Sun 1:00 PM"), ev("Buffalo Bills", "Miami Dolphins", 3, 0, "in", 1, "9:00", "9:00 - 1st")] };
  const r = parseScoreboard(j, ["PIT @ CLE", "LA @ PHI", "DEN @ SF", "DET @ CAR", "ATL @ NO"]);
  ok(r["PIT @ CLE"] && r["PIT @ CLE"].a === 14 && r["PIT @ CLE"].h === 10 && r["PIT @ CLE"].lbl === "Q3 4:12" && r["PIT @ CLE"].st === "in", "live score: quarter and clock", r["PIT @ CLE"]);
  ok(r["LA @ PHI"].lbl === "HALFTIME" && r["DEN @ SF"].lbl === "OT 2:10" && r["DET @ CAR"].lbl === "FINAL", "live score: halftime, overtime, final", [r["LA @ PHI"], r["DEN @ SF"], r["DET @ CAR"]]);
  ok(!r["ATL @ NO"] && !r["BUF @ MIA"], "live score: not-started games and games we did not ask for are left out", r);
  ok(Object.keys(parseScoreboard({ events: [{ competitions: [] }, {}] }, ["A @ B"])).length === 0 && Object.keys(parseScoreboard(null, ["A @ B"])).length === 0 && Object.keys(parseScoreboard({ injuries: [] }, ["A @ B"])).length === 0, "live score: unreadable feeds give nothing"); }
// ---------- what the page says (runs the real public/app.js)
{ const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, set innerHTML(v) {}, set textContent(v) {}, addEventListener() {} });
  const store = { lastSeen: "2026-10-01T12:00:00Z" };
  const ctx = { document: { getElementById: () => el(), querySelectorAll: () => [], addEventListener() {}, hidden: false }, fetch: () => Promise.reject(new Error("offline")),
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) }, location: { reload() {} }, window: {}, setTimeout, clearTimeout, console, Date, Math, Number, String, JSON, Promise, Set, Object, Array };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8") + "\n;globalThis.T={spreadReason,totalReason,leanCell,prow,betRow,changedBox,rightNowBox,winnersBox,winnerOf,tile,tdTop3,tdRow,gapStrip,gameCard,totalCard,detailTop,replayBox,renderMine,gbgHtml,renderLab,renderModel,keepOpenState,modelsByWeek,modelsByConfidence,tdCalibration,mSec};", ctx);
  const T = ctx.T;
  let g = { away: "DAL", home: "PHI", model: { homeMargin: 4.2, fix: {} }, poly: { spread: { homeSpread: -3.5 } } };
  ok(/PHI winning by about 4\.2/.test(T.spreadReason(g)) && /needs PHI to win by 4\+/.test(T.spreadReason(g)), "spread wording");
  g.poly.spread.homeSpread = -3; ok(/more than 3/.test(T.spreadReason(g)), "whole-number spread wording");
  g = { away: "A", home: "H", model: { total: 44.4, fix: { dome: 2.59, pace: 0.1, div: true } }, poly: { total: { line: 45.5 } } };
  ok(/about 44\.4 total/.test(T.totalReason(g)) && /indoor game \+2\.6/.test(T.totalReason(g)), "totals wording");
  g = { away: "A", home: "H", winPct: 61.2, model: { homeMargin: 3, fix: {} }, spreadPick: { label: "H -2.5", pct: 51.1 }, poly: {} };
  ok(/No lean · about 50\/50/.test(T.leanCell(g, "spread")) && !/market-based/.test(T.leanCell(g, "spread")), "lean wording");
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
  { const td = (player, team, fair, extra = {}) => ({ player, team, price: fair / 100 - 0.05, bid: fair / 100 - 0.06, fair, market: player + " 1+", ...extra });
    const d2 = { games: [game("A @ B", -3, 0.6, 60, { td: [td("Top.One", "A", 70), td("Top.Two", "A", 66)] }), game("C @ D", -3, 0.6, 60, { td: [td("Sit.Q", "C", 80, { injury: "Questionable" }), td("Real.Two", "D", 55)] }),
      game("E @ F", -3, 0.6, 60, { td: [td("Thin.X", "E", 90, { thin: true, bid: 0.01 }), td("Real.Three", "F", 40)] }), game("G @ H", -3, 0.6, 60, { td: [td("Late.Four", "G", 30)] })], edgesNow: [] };
    const Q = buildPaper(d2), l2 = Q.filter((p) => p.strategy === "td_likely_2"), l3 = Q.filter((p) => p.strategy === "td_likely_3");
    ok(l2.length === 1 && l2[0].legs.map((l) => l.player).join() === "Top.One,Real.Two", "likely-2: best player, one per game, injury-listed player skipped", l2[0] && l2[0].legs.map((l) => l.player));
    ok(l3.length === 1 && l3[0].legs.map((l) => l.player).join() === "Top.One,Real.Two,Real.Three" && Math.abs(l3[0].prob - 0.7 * 0.55 * 0.4) < 1e-9, "likely-3: thin market skipped, chance = legs multiplied", l3[0] && l3[0].legs.map((l) => l.player)); }
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
  const p = picksFor(g, poly, { homeMargin: 3.1, total: 37.1 }).filter((x) => x.market === "spread" || x.market === "total");
  ok(p.length === 2 && p[0].label === "CLE +2.5" && Math.abs(p[0].gap - 5.6) < 1e-9 && p[0].price === 0.48, "spread: model side is CLE +2.5, differs by 5.6, priced at CLE's price", p[0]);
  ok(p[1].label === "Under 38.5" && Math.abs(p[1].gap - 1.4) < 1e-9 && p[1].price === 0.51, "total: model side is Under 38.5", p[1]);
  const q = picksFor(g, { spread: { homeSpread: -6.5, home: 0.5, away: 0.51 } }, { homeMargin: 3.0, total: 40 });
  ok(q.length === 2 && q[0].market === "spread" && q[0].label === "PIT +6.5" && q[0].price === 0.51, "home favorite the model likes less -> road team with the points", q);
  ok(q[1].market === "dog" && q[1].label === "PIT +6.5" && picksFor(g, { spread: { homeSpread: -7, home: 0.5, away: 0.51 } }, { homeMargin: 3.0 }).every((x) => x.market !== "dog") && picksFor(g, { spread: { homeSpread: -2.5, home: 0.5, away: 0.51 } }, { homeMargin: 3.0 }).every((x) => x.market !== "dog"), "road dog +3 to +6.5 is recorded, +7 and +2.5 are not");
  ok(picksFor(g, poly, { homeMargin: 3.1 }).some((x) => x.market === "away3" && x.label === "PIT -2.5" && x.price === 0.53) && !picksFor(g, { spread: { homeSpread: -3.5, home: 0.5, away: 0.5 } }, { homeMargin: 1 }).some((x) => x.market === "away3"), "road team in a close game (spread 3 or less) is recorded, 3.5 is not");
  { const w = picksFor(g, poly, { homeMargin: 3.1, total: 37.1, outdoor: true, wind: 14 }).find((x) => x.market === "wind");
    ok(w && w.label === "Under 38.5" && w.price === 0.51 && !picksFor(g, poly, { homeMargin: 3.1, total: 37.1, outdoor: true, wind: 11 }).some((x) => x.market === "wind") && !picksFor(g, poly, { homeMargin: 3.1, total: 37.1, outdoor: false, wind: 20 }).some((x) => x.market === "wind"), "windy under: outdoor and 12+ mph only"); }
  { const sit = { home: { prevPts: 20, prevLost: false, preBye: true }, away: { prevPts: 6, prevLost: true, preBye: false } };
    const a = picksFor({ ...g, week: 9 }, poly, { homeMargin: 3.1 }, sit), b = picksFor({ ...g, week: 6 }, poly, { homeMargin: 3.1 }, sit);
    const dog = picksFor({ ...g, week: 9 }, { spread: { homeSpread: -3.5, home: 0.5, away: 0.52 } }, { homeMargin: 1 }, sit);
    ok(a.some((x) => x.market === "prebye" && x.label === "CLE +2.5") && !b.some((x) => x.market === "prebye"), "home team before its bye is recorded from week 8 on");
    ok(dog.some((x) => x.market === "lowloss" && x.label === "PIT +3.5" && x.price === 0.52) && !a.some((x) => x.market === "lowloss"), "underdog off a loss scoring 10 or fewer is recorded (home dog here lost nothing, so no pick)"); }
  ok(picksFor(g, poly, { homeMargin: -2.5, total: 38.5 }).filter((x) => x.market !== "away3").length === 0, "model exactly on the line -> no pick");
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
  for (const x of [["A @ B", -10.5], ["C @ D", -7], ["E @ F", -3], ["G @ H", -1], ["I @ J", 3], ["K @ L", -2]]) await recordWinner(2026, 7, gm(x[0]), { spread: { homeSpread: x[1] } }, "t", x[0] === "A @ B" ? { homeMargin: -4 } : x[0] === "C @ D" ? { homeMargin: -5 } : null);
  await gradeWinnersWeek(2026, 7, [{ key: "A @ B", homeScore: 30, awayScore: 10 }, { key: "C @ D", homeScore: 10, awayScore: 20 }, { key: "E @ F", homeScore: 20, awayScore: 17 },
    { key: "G @ H", homeScore: 14, awayScore: 14 }, { key: "I @ J", homeScore: 17, awayScore: 24 }, { key: "K @ L", homeScore: 6, awayScore: 9 }]);
  const w = await winnersSummary(2026);
  ok(w.recorded === 6 && w.all.n === 5 && w.all.w === 3 && w.all.l === 2, "record: 6 recorded, the tie is left out, 3 right and 2 wrong", w.all);
  ok(w.stats.n === 2 && w.stats.w === 1 && w.stats.l === 1, "stats-only winner graded on its own: A (model said away, home won) wrong, C (model said away, away won) right; games with no model margin are left out", w.stats);
  ok(w.top4.n === 4 && w.top4.w === 3 && w.top4.l === 1, "each week's top 4 by chance (A, C, I, E): A, I, E right and C wrong", w.top4);
  ok(w.bands.find((x) => x.label === "80%+").n === 1 && w.bands.find((x) => x.label === "50-60%").n >= 1, "bands by confidence", w.bands.map((x) => `${x.label}:${x.n}`));
  // new layout (10/1): tiles, scorers, price-gap strip
  vm.runInContext(`S = { games: [], edgesNow: [{ game: "PIT @ CLE", label: "CLE ML", price: 0.37, fair: 0.42, evNet: 0.134 }] }`, ctx);
  const tg = { key: "PIT @ CLE", away: "PIT", home: "CLE", kickoff: "2026-10-02T00:15:00Z", started: false, final: false, winPct: 40, badge: "TNF", td: [] };
  const tl = ctx.T.tile(tg);
  ok(tl.indexOf(">PIT<") < tl.indexOf(">CLE<") && /<span class="mkt">60<\/span><span class="dim"> · <\/span><span class="dim">40<\/span>/.test(tl) && /TNF/.test(tl) && /GAP \+13\.4%/.test(tl), "tile: away name left, home name right, away 60 · home 40, TNF and price-gap chips", tl);
  { const half = ctx.T.tile({ ...tg, winPct: 39.5 }), nums = (half.match(/<span class="(?:mkt|dim)">(\d+)<\/span><span class="dim"> · /) || [])[1], nums2 = (half.match(/ · <\/span><span class="(?:mkt|dim)">(\d+)<\/span>/) || [])[1];
    ok(Number(nums) + Number(nums2) === 100, "tile: the two percentages always add to 100 (60.5 and 39.5 do not both round up)", half); }
  ok(/LIVE/.test(ctx.T.tile({ ...tg, started: true })) && />13<\/span>/.test(ctx.T.tile({ ...tg, started: true, final: true, awayScore: 13, homeScore: 27 })) && /Final/.test(ctx.T.tile({ ...tg, started: true, final: true, awayScore: 13, homeScore: 27 })), "tile: live tag, final score");
  vm.runInContext(`LIVE_SC = { "PIT @ CLE": { a: 14, h: 10, st: "in", lbl: "Q3 4:12" } }`, ctx);
  { const lt = ctx.T.tile({ ...tg, started: true }), dt = ctx.T.detailTop({ ...tg, started: true });
    ok(/>14<\/span>/.test(lt) && />10<\/span>/.test(lt) && /LIVE · Q3 4:12/.test(lt) && lt.indexOf('class="ft"') < lt.indexOf('class="bar"') && !/chip c-red">LIVE/.test(lt), "live tile: score, LIVE · Q3 under it, bar at the bottom", lt);
    ok(/14 – 10/.test(dt) && /LIVE · Q3 4:12/.test(dt) && !/Live · locked/.test(dt), "live game page: score and quarter in the matchup card"); }
  vm.runInContext(`LIVE_SC = {}`, ctx);
  ok(!/LIVE · Q/.test(ctx.T.tile({ ...tg, started: true })) && /class="chip c-red">LIVE/.test(ctx.T.tile({ ...tg, started: true })), "live tile: no score yet -> still just the LIVE tag, never a made-up score");
  vm.runInContext(`REPLAY = { seasons: [2007, 2025], rows: [ { id: "dog", name: "Road dogs +3 to +6.5", kind: "ats", n: 1424, hit: 0.535, periods: [{ label: "2007–12", n: 445, hit: 0.557 }, { label: "2013–18", n: 457, hit: 0.501 }, { label: "2019–25", n: 506, hit: 0.547 }], verdict: "UNSTABLE" }, { id: "wind", name: "Under, wind 12+ mph", kind: "ats", n: 792, hit: 0.562, periods: [], verdict: "YES" }, { id: "favorite", name: "Moneyline · market favorite wins", kind: "win", n: 4973, hit: 0.669, periods: [], verdict: "INFO" } ] }; PICKS = { dog: { graded: 4, w: 3, l: 1, hit: 0.75 }, wind: { graded: 0, recorded: 2 } }; S.winners = { all: { n: 10, w: 7, l: 3, hit: 0.7 } }`, ctx);
  { // same-game paper parlay (Thursday etc.): best spread/total edge + TD edge, linked legs claim no hit rate
    const { buildSameGame } = await import("../lib/paper.js");
    const data = { games: [{ key: "PIT @ CLE", started: false, final: false, td: [{ player: "Q.Judkins", team: "CLE", market: "m", price: 0.4, bid: 0.38, fair: 47 }, { player: "X.Thin", team: "PIT", price: 0.2, bid: 0.01, fair: 40, thin: true }] }],
      edgesNow: [{ game: "PIT @ CLE", market: "spread", label: "CLE +2.5", price: 0.5, evNet: 0.06 }, { game: "PIT @ CLE", market: "ml", label: "CLE ML", price: 0.4, evNet: 0.05 }, { game: "PIT @ CLE", market: "total", label: "Over 37.5", price: 0.5, evNet: 0.04 }, { game: "OTHER @ G", market: "total", label: "Under 40", price: 0.5, evNet: 0.2 }] };
    const sg = buildSameGame(data, "PIT @ CLE");
    ok(sg && sg.strategy === "same_game_3" && sg.legs.length === 3 && sg.legs.map((l) => l.label).join("|") === "CLE +2.5|Over 37.5|Q.Judkins TD" && sg.prob === null, "same-game parlay: best spread/total + TD, no hit rate claimed");
    ok(buildSameGame({ games: [{ key: "A @ B", started: true, td: [] }], edgesNow: [] }, "A @ B") === null && buildSameGame({ games: [{ key: "A @ B", started: false, td: [] }], edgesNow: [] }, "A @ B") === null, "same-game parlay: none once started or with fewer than 2 legs"); }
  { // Game-by-game results: newest week by default, chips per week, All shows everything
    vm.runInContext(`GBG_RES = [ { game: "A @ B", week: 3, awayScore: 1, homeScore: 2, gradedAt: "1" }, { game: "C @ D", week: 3, awayScore: 3, homeScore: 4, gradedAt: "2" }, { game: "PIT @ CLE", week: 4, awayScore: 24, homeScore: 27, gradedAt: "3", spread: { label: "CLE +2.5", result: "W" } } ]; GBGWEEK = null`, ctx);
    const a = ctx.T.gbgHtml(); ok(/PIT @ CLE/.test(a) && !/A @ B/.test(a) && /Week 4 \(1\)/.test(a) && /Week 3 \(2\)/.test(a), "game-by-game: opens on the newest week with counts");
    vm.runInContext(`GBGWEEK = "all"`, ctx); const b = ctx.T.gbgHtml(); ok(/PIT @ CLE/.test(b) && /A @ B/.test(b) && /C @ D/.test(b), "game-by-game: All shows every week");
    vm.runInContext(`GBGWEEK = null; GBG_RES = []`, ctx); ok(ctx.T.gbgHtml() === "", "game-by-game: empty when nothing is graded"); }
  { // model_best_4: the 4 most likely legs, one per game, mixing winners and scorers, real combined chance kept
    const { buildPaper } = await import("../lib/paper.js");
    const gm = (key, home, win, td) => ({ key, home, away: "X", started: false, final: false, winPct: win, poly: { spread: { homeSpread: -3 }, ml: { home: 0.8 } }, td: td ? [{ player: td.n, team: home, market: "m", price: 0.5, bid: 0.48, fair: td.p }] : [] });
    const P = buildPaper({ games: [gm("A1 @ H1", "H1", 90, { n: "P1", p: 40 }), gm("A2 @ H2", "H2", 80, { n: "P2", p: 70 }), gm("A3 @ H3", "H3", 78, null), gm("A4 @ H4", "H4", 76, null), gm("A5 @ H5", "H5", 60, { n: "P5", p: 30 })], edgesNow: [] });
    const mb = P.find((p) => p.strategy === "model_best_4");
    ok(mb && mb.legs.length === 4 && new Set(mb.legs.map((l) => l.game)).size === 4 && mb.legs.map((l) => l.label).join("|") === "H1 ML|H2 ML|H3 ML|H4 ML" && Math.abs(mb.prob - 0.9 * 0.8 * 0.78 * 0.76) < 1e-9 && Math.abs(mb.prob - mb.legs.reduce((a, l) => a * l.prob, 1)) < 1e-9, "model_best_4: top legs, one per game, product chance"); }
  { // Lab review: the fixed rule that judges each parlay type from its own graded results
    const { labReview } = await import("../lib/paper.js");
    const mk = (graded, hits, said, ret = 0) => ({ graded, hits, hitRate: graded ? hits / graded : null, expRate: said, expN: graded, roi: ret });
    ok(labReview(mk(0, 0, null)).verdict === "WAITING" && labReview(mk(12, 6, 0.5)).verdict === "TOO FEW", "lab review: nothing judged before 30 graded");
    ok(labReview(mk(100, 50, 0.5)).verdict === "HOLDS" && labReview(mk(100, 30, 0.5)).verdict === "OVERSTATED" && labReview(mk(100, 70, 0.5)).verdict === "UNDERSTATED", "lab review: HOLDS / OVERSTATED / UNDERSTATED from the hit rate vs what the model said");
    ok(labReview({ graded: 40, hits: 5, hitRate: 0.125, expRate: null, expN: 0, roi: -0.2 }).verdict === "LOSING" && labReview({ graded: 40, hits: 9, hitRate: 0.225, expRate: null, expN: 0, roi: 0.3 }).verdict === "PAYING", "lab review: linked-leg parlays are judged by return only"); }
  { // My Bets end to end on a mock Redis: settlement overrides, combo legs ignored, earlier weeks never open, twins listed once
    const realFetch = globalThis.fetch; const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n";
    globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + "2026,REG,4,2099-10-01,20:15,PIT,,CLE,,outdoors,Huntington,Home,grass\n2026,REG,5,2099-10-08,20:15,AAA,,BBB,,outdoors,X,Home,grass\n" } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    const R = globalThis.__TEST_REDIS__, { loadMyBets } = await import("../lib/mybets.js"), { SEASON, resetGamesCache } = await import("../lib/games.js"); resetGamesCache();   // use the mock schedule, not a cached real one
    await R.set("mybets:ledger", JSON.stringify({
      "caoc-twin": { id: "caoc-twin", season: SEASON, week: 4, cost: 20, shares: 130.32, closedAt: "t", resolved: { win: true, pl: 110.32, t: "2026-10-02T05:00:00Z" } },
      "astatc-leg": { id: "astatc-leg", season: SEASON, week: 4, cost: 5, shares: 9, closedAt: "t" },
      "caoc-old": { id: "caoc-old", season: SEASON, week: 2, cost: 7, shares: 70 },
      "caoc-loss": { id: "caoc-loss", season: SEASON, week: 4, cost: 10, shares: 100, closedAt: "t", resolved: { win: false, pl: -10, t: "2026-10-02T05:00:00Z" } } }));
    const mb = await loadMyBets(SEASON), byId = Object.fromEntries(mb.bets.map((b) => [b.id, b]));
    ok(byId["w4-c1"] && byId["w4-c1"].result === "W" && Math.abs(byId["w4-c1"].pl - 110.32) < 1e-9 && !byId["caoc-twin"], "my bets: Polymarket's settlement decides a typed-in combo, listed once");
    ok(!byId["astatc-leg"], "my bets: combo legs are never bets");
    ok(byId["caoc-old"] && byId["caoc-old"].result === "settled", "my bets: an unresolved bet from an earlier week is not open");
    ok(byId["caoc-loss"] && byId["caoc-loss"].result === "L" && byId["caoc-loss"].pl === -10, "my bets: a settled loss counts with its P/L");
    ok(byId["w4-c1"] && byId["w4-c1"].waiting === false, "my bets: a bet whose games are not all final is not marked waiting");
    // every game final (nflverse or ESPN) but the touchdown data is not posted: pending and marked waiting, with the line legs already graded
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + "2026,REG,4,2026-10-01,20:15,PIT,24,CLE,27,outdoors,Huntington,Home,grass\n" } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await R.del("mybets:ledger"); const mb2 = await loadMyBets(SEASON), w4 = mb2.bets.find((b) => b.id === "w4-c1");
    ok(w4 && w4.result === "pending" && w4.waiting === true && w4.legs[0].result === "W" && w4.legs[2].result === "W" && w4.legs[1].result === "pending", "my bets: all games final but touchdown data missing -> waiting, line legs already graded");
    globalThis.fetch = realFetch; resetGamesCache(); await R.del("mybets:ledger"); }
  { // same-game record: built lazily, once per game, never overwritten, graded and shown in the week's list
    const { recordSameGame, gradePaper, paperSummary } = await import("../lib/paper.js"); const R = globalThis.__TEST_REDIS__;
    const kick = new Date(Date.now() + 10 * 3600e3).toISOString(), later = new Date(Date.now() + 200 * 3600e3).toISOString();
    const gs = [{ key: "PIT @ CLE", kickoff: kick }, { key: "FAR @ AWAY", kickoff: later }];
    let built = 0; const data = { games: [{ key: "PIT @ CLE", started: false, final: false, td: [] }], edgesNow: [{ game: "PIT @ CLE", market: "spread", label: "CLE +2.5", price: 0.5, evNet: 0.06 }, { game: "PIT @ CLE", market: "total", label: "Over 37.5", price: 0.5, evNet: 0.04 }] };
    const get = async () => { built++; return data; };
    const n1 = await recordSameGame(2099, 4, gs, get), n2 = await recordSameGame(2099, 4, gs, get);
    ok(n1 === 1 && n2 === 0 && built === 1, "same-game record: once per game, only the game inside 26 h, week built only when needed");
    await gradePaper(2099, 4, [{ key: "PIT @ CLE", homeScore: 27, awayScore: 24 }], async () => null);
    const sm = await paperSummary(2099, 4); const ps = sm.week.parlays;
    ok(ps.length === 1 && ps[0].strategy === "same_game_3" && ps[0].result === "W" && sm.board.same_game_3.graded === 1 && sm.board.same_game_3.review.verdict === "TOO FEW", "same-game record: graded, listed in the week, reviewed");
    for (const k of await R.keys("paper:2099:*")) await R.del(k); }
  { // ESPN final scores for games nflverse has not posted; waiting label on bets; only recent errors listed
    const { finalsFromScoreboard, overlayEspnFinals } = await import("../lib/espnFinals.js");
    const ev = (away, home, a, h, done) => ({ status: { type: { state: done ? "post" : "in", completed: done } }, competitions: [{ competitors: [ { homeAway: "away", score: String(a), team: { displayName: away } }, { homeAway: "home", score: String(h), team: { displayName: home } } ] }] });
    const f = finalsFromScoreboard({ events: [ev("Pittsburgh Steelers", "Cleveland Browns", 24, 27, true), ev("Indianapolis Colts", "Washington Commanders", 3, 0, false), { status: {}, competitions: [] }] });
    ok(Object.keys(f).join() === "PIT @ CLE" && f["PIT @ CLE"].a === 24 && f["PIT @ CLE"].h === 27, "espn finals: only completed games, with their scores");
    const now = Date.now(), rows = [ { key: "PIT @ CLE", kickoff: new Date(now - 5 * 3600e3).toISOString(), final: false }, { key: "IND @ WAS", kickoff: new Date(now - 1 * 3600e3).toISOString(), final: false }, { key: "OLD @ GAME", kickoff: new Date(now - 9 * 86400e3).toISOString(), final: false }, { key: "PIT @ CLE", kickoff: new Date(now - 5 * 3600e3).toISOString(), final: true, awayScore: 1, homeScore: 2 } ];
    const fetcher = async () => ({ ok: true, json: async () => ({ events: [ev("Pittsburgh Steelers", "Cleveland Browns", 24, 27, true), ev("Indianapolis Colts", "Washington Commanders", 3, 0, true)] }) });
    const n = await overlayEspnFinals(rows, now, fetcher);
    ok(n === 1 && rows[0].final && rows[0].awayScore === 24 && rows[0].espnFinal && !rows[1].final && !rows[2].final && rows[3].awayScore === 1, "espn finals: only games that kicked off 3h15+ ago and nflverse lacks; nflverse rows untouched");
    ok((await overlayEspnFinals(rows.map((r) => ({ ...r, final: false })), now, async () => { throw new Error("down"); })) === 0, "espn finals: a failed fetch changes nothing");
    const { getStatus } = await import("../lib/status.js"); const R = globalThis.__TEST_REDIS__; await R.del("errors");
    await R.lpush("errors", JSON.stringify({ t: new Date(now - 4 * 86400e3).toISOString(), where: "old", msg: "x" })); await R.lpush("errors", JSON.stringify({ t: new Date(now - 3600e3).toISOString(), where: "new", msg: "y" }));
    const stt = await getStatus(2026, 4, {}, null); ok(stt.errors.length === 1 && stt.errors[0].where === "new" && stt.ok === false, "status: only errors from the last 48 hours are listed"); await R.del("errors"); }
  { const rb = ctx.T.replayBox();
    ok(/Road dogs \+3 to \+6\.5/.test(rb) && /53\.5%/.test(rb) && /UNSTABLE/.test(rb) && /<b>YES<\/b>/.test(rb) && /3–1/.test(rb) && /2 saved/.test(rb) && /7–3/.test(rb) && /2007–25/.test(rb), "replay card: history, live record, verdict, season range", rb.slice(0, 400));
    vm.runInContext(`REPLAY = null`, ctx); ok(ctx.T.replayBox() === "", "replay card: leaves itself out when the history is not loaded"); }
  { // dead toss-up on the raw numbers still gets a side from the calibrated chance; same-game parlay filled from the model's own sides; result alerts
    const { spreadPick, totalPick } = await import("../lib/picks.js"); const { buildSameGame, picksFor, gradePaper } = await import("../lib/paper.js"); const { listAlerts } = await import("../lib/alerts.js"); const R = globalThis.__TEST_REDIS__;
    ok(spreadPick({ homeMargin: -3, calHomeCover: 52 }, 3, "AWY", "HOM").team === "HOM" && spreadPick({ homeMargin: -3, calHomeCover: 48 }, 3, "AWY", "HOM").team === "AWY" && spreadPick({ homeMargin: -3, calHomeCover: 50 }, 3, "AWY", "HOM") === null && spreadPick({ homeMargin: -3 }, 3, "AWY", "HOM") === null && spreadPick({ homeMargin: -5 }, 3, "AWY", "HOM").team === "AWY", "tie-break: spread side from the calibrated chance, none only with no lean at all, real gaps unchanged");
    ok(totalPick({ total: 43.5, calUnder: 50.5 }, 43.5).side === "under" && totalPick({ total: 43.5, calUnder: 49 }, 43.5).side === "over" && totalPick({ total: 43.5, calUnder: 50 }, 43.5) === null && totalPick({ total: 46 }, 43.5).side === "over", "tie-break: total side from the calibrated chance");
    const pf = picksFor({ key: "LA @ PHI", away: "LA", home: "PHI" }, { spread: { homeSpread: 3, home: 0.5, away: 0.5 }, total: { line: 43.5, over: 0.5, under: 0.5 } }, { homeMargin: -3, total: 43.5, calHomeCover: 48.8, calUnder: 50.5 });
    const pfm = pf.filter((x) => x.market === "spread" || x.market === "total"); ok(pfm.length === 2 && pfm[0].label === "LA -3" && pfm[1].label === "Under 43.5", "tie-break: the saved picks (Pick Lab) use the same rule");
    const G = { key: "IND @ WAS", started: false, final: false, poly: { spread: { homeSpread: -3.5, home: 0.5, away: 0.52 }, total: { line: 47.5, over: 0.5, under: 0.5 } }, spreadPick: { side: "away", label: "IND +3.5" }, totalPick: { side: "over", label: "Over 47.5" },
      td: [ { player: "Q.Scorer", team: "IND", market: "m", price: 0.55, bid: 0.5, fair: 50 }, { player: "O.Out", team: "WAS", market: "m", price: 0.4, bid: 0.35, fair: 70, injury: "Out" }, { player: "T.Thin", team: "WAS", price: 0.2, bid: 0.01, fair: 80, thin: true } ] };
    const sg = buildSameGame({ games: [G], edgesNow: [] }, "IND @ WAS");
    ok(sg && sg.legs.map((l) => l.label).join("|") === "IND +3.5|Over 47.5|Q.Scorer TD" && sg.legs.every((l) => l.src === "model") && sg.prob === null, "same-game parlay: with no sportsbook gaps it is built from the model's own spread side, total side and best scorer");
    const sg2 = buildSameGame({ games: [G], edgesNow: [{ game: "IND @ WAS", market: "total", label: "Under 47.5", price: 0.48, evNet: 0.05 }] }, "IND @ WAS");
    ok(sg2.legs[0].label === "Under 47.5" && sg2.legs[0].src === "gap" && sg2.legs.some((l) => l.label === "IND +3.5") && sg2.legs.length === 3, "same-game parlay: a sportsbook gap wins its slot, the model fills the rest");
    await R.del("alerts:2099"); await R.set("paper:2099:4:IND @ WAS", JSON.stringify({ season: 2099, week: 4, game: "IND @ WAS", parlays: [sg] }));
    await gradePaper(2099, 4, [{ key: "IND @ WAS", homeScore: 24, awayScore: 26 }], async () => ["Q.Scorer"]); await gradePaper(2099, 4, [{ key: "IND @ WAS", homeScore: 24, awayScore: 26 }], async () => ["Q.Scorer"]);
    const al = (await listAlerts(2099)).filter((a) => a.kind === "RESULT");
    ok(al.length === 1 && /Model parlay hit/.test(al[0].title) && /IND \+3\.5/.test(al[0].sub), "alerts: a decided model parlay posts one RESULT alert, not repeated");
    for (const k of await R.keys("paper:2099:*")) await R.del(k); await R.del("alerts:2099");
    // the Pick Lab list uses the tie rule too
    vm.runInContext(`S = { week: 4, games: [ { key: "LA @ PHI", away: "LA", home: "PHI", started: false, winPct: 38.1, model: { homeMargin: -3, total: 43.5, calHomeCover: 48.8, calUnder: 50.5 }, poly: { ml: { home: 0.42, away: 0.6 }, spread: { homeSpread: 3, home: 0.51, away: 0.51 }, total: { line: 43.5, over: 0.51, under: 0.51 } } } ], winners: null, picks: null }`, ctx);
    ok(/Spread <b>LA -3<\/b> · Total <b>Under 43\.5<\/b>/.test(ctx.T.winnersBox()), "pick list: a toss-up game still shows its spread side and total side"); }
  { // earlier week: a bet that is final but waiting for touchdown data stays visible; no slate yet must not break Bets; sections keep their state
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "record-mine" ? box : old(id));
    vm.runInContext(`S = { week: 5, games: [] }; MBWEEK = 4; MB = { summary: {}, synced: null, bets: [ { id: "a", week: 4, source: "account", title: "Waiting combo", cost: 10, toWin: 100, result: "pending", waiting: true, legs: [] }, { id: "b", week: 4, source: "account", title: "Lost combo", cost: 5, toWin: 50, result: "L", pl: -5, legs: [] }, { id: "c", week: 4, cost: 8, toWin: 80, result: "pending", waiting: true, legs: [ { kind: "td", player: "Q", game: "A @ B", team: "B", result: "pending", price: 0.5 } ] } ] }`, ctx);
    ctx.T.renderMine(); ok(/Waiting combo/.test(box.innerHTML) && /waiting for touchdown results/.test(box.innerHTML) && /Lost combo/.test(box.innerHTML) && /BETS[\s\S]*>3</.test(box.innerHTML) && (box.innerHTML.match(/waiting for touchdown results/g) || []).length === 2, "record tab: an earlier week still shows bets (typed-in and account) that are waiting for touchdown data");
    vm.runInContext(`S = null; MBWEEK = null`, ctx); let threw = false; try { ctx.T.renderMine(); } catch { threw = true; } ok(!threw && /data-mbw="all"/.test(box.innerHTML), "record tab: opens fine before the slate has loaded");
    const els = { s1: { id: "s1", classList: new Set(["open"]) }, s2: { id: "s2", classList: new Set() } }; for (const e of Object.values(els)) { const c = e.classList; e.classList = { contains: (k) => c.has(k), toggle: (k, on) => (on ? c.add(k) : c.delete(k)) }; }
    const root = { querySelectorAll: () => Object.values(els) }; const g2 = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "rootX" ? root : els[id] || g2(id));
    ctx.T.keepOpenState("rootX", () => { els.s1.classList.toggle("open", false); els.s2.classList.toggle("open", true); });
    ok(els.s1.classList.contains("open") && !els.s2.classList.contains("open"), "refresh: sections keep the open/closed state you left them in");
    ctx.document.getElementById = old; vm.runInContext(`MBWEEK = null`, ctx); }
  { // weekly budget: each bet once, never combo legs, week from when it settled
    const { placedThisWeek } = await import("../lib/placed.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    resetGamesCache(); const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n";
    globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + `${SEASON},REG,3,2026-09-27,13:00,X,10,Y,20,o,s,Home,g\n${SEASON},REG,4,2026-10-01,20:15,PIT,24,CLE,27,o,s,Home,g\n${SEASON},REG,5,2026-10-08,20:15,AAA,,BBB,,o,s,Home,g\n` } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await R.set("mybets:ledger", JSON.stringify({ twin: { id: "caoc-twin", season: SEASON, week: 4, cost: 20, shares: 130.32 }, leg: { id: "astatc-x", season: SEASON, week: 4, cost: 7, shares: 9 },
      oldBet: { id: "caoc-old", season: SEASON, week: 4, cost: 11, shares: 99, resolved: { win: false, pl: -11, t: "2026-09-27T20:00:00Z" } }, fresh: { id: "caoc-new", season: SEASON, week: 5, cost: 13, shares: 80 } }));
    const w4 = await placedThisWeek(SEASON, 4), w5 = await placedThisWeek(SEASON, 5);
    ok(Math.abs(w4 - 20) < 1e-9, "budget: the typed-in combo counts once (not again as its account copy), no combo legs, a bet settled in an earlier week is not this week's");
    ok(Math.abs(w5 - 13) < 1e-9, "budget: a new account bet counts in its own week");
    globalThis.fetch = realFetch; resetGamesCache(); await R.del("mybets:ledger"); }
  { // Pick Lab: the model's parlays only (no single-game winners list), each type says how it was chosen
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "lab" ? box : old(id));
    vm.runInContext(`S = { week: 4, games: [], winners: { all: { n: 1, w: 1, l: 0, hit: 1 } } }; MB = null; RES = null; PAPER = { names: { model_best_4: "Model's 4 most likely legs", same_game_3: "Same game" }, board: {}, week: { week: 4, parlays: [ { strategy: "model_best_4", legs: [ { label: "H1 ML", game: "A @ H1", price: 0.8 }, { label: "H2 ML", game: "A @ H2", price: 0.8 } ], pay: 1.56, prob: 0.6 } ] } }`, ctx);
    ctx.T.renderLab(); ok(!/Model's pick on every game/.test(box.innerHTML) && /Your model's parlays/.test(box.innerHTML) && /Rule: the 4 legs the model rates most likely/.test(box.innerHTML) && /H1 ML/.test(box.innerHTML) && /Parlay scoreboard/.test(box.innerHTML), "pick lab: parlays and their scoreboard only, with how each parlay was chosen");
    ctx.document.getElementById = old; }
  { // Models tab: nine sections in order, each with a one-line meaning; the analysis helpers on real-shaped data
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "models" ? box : id === "export-btn" ? { onclick: null } : old(id));
    const res = [ { game: "A @ B", week: 3, ml: { pct: 82, result: "W" }, mlModel: { result: "W" }, spread: { basis: "model", result: "L" }, total: { basis: "model", result: "W" }, td: [ { team: "B", player: "P1", fair: 40, scored: true, played: true }, { team: "A", player: "P2", fair: 22, scored: false, played: true } ] },
      { game: "C @ D", week: 3, ml: { pct: 64, result: "L" }, mlModel: { result: "L" }, spread: { basis: "model", result: "W" }, total: { basis: "model", result: "W" }, td: [] },
      { game: "PIT @ CLE", week: 4, ml: { pct: 71, result: "W" }, spread: { basis: "model", result: "W" }, total: { basis: "model", result: "W" }, td: [] } ];
    vm.runInContext(`S = { week: 4, games: [], status: { ok: true, errors: [] }, weekCheck: { games: 16, withLines: 16, modelRun: true, watch: [] }, missFinder: null, winners: { all: { n: 3, w: 2, l: 1, hit: 0.67 } } }; MB = { summary: { wins: 0, losses: 0, pushes: 0, pl: 0 }, bets: [] }; PAPER = { names: {}, board: {}, week: null }; PICKS = null; EDGES = null; REPLAY = null; WINALL = false`, ctx);
    vm.runInContext(`RES = ${JSON.stringify(res)}`, ctx);
    ctx.T.renderModel(); const h = box.innerHTML;
    const order = ["1 · Scoreboard", "2 · Winners", "3 · Spreads and totals", "4 · Touchdowns", "5 · Tracked angles", "6 · Price gaps", "7 · Trends and analysis", "8 · Misses and every game", "9 · System"].map((x) => h.indexOf(x));
    ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), "models tab: nine sections, in order");
    ok((h.match(/class="s dim" style="margin:2px 0 6px"/g) || []).length === 9, "models tab: every section opens with a one-line meaning");
    ok(/Hit rate by week/.test(h) && /Week 3/.test(h) && /Week 4/.test(h) && /Touchdown chances vs what happened/.test(h) && /Game-by-game results|id="gbg"/.test(h) && !/Parlay scoreboard/.test(h), "models tab: trends and every-game list present, parlay scoreboard kept out");
    const bw = ctx.T.modelsByWeek(res), bc = ctx.T.modelsByConfidence(res), tc = ctx.T.tdCalibration(res.flatMap((r) => r.td));
    ok(/Moneyline[\s\S]*50%[\s\S]*Spread[\s\S]*Total/.test(bw) && /Week 3/.test(bw), "models tab: hit rate by week");
    ok(/Said 80\+% · 1 picks/.test(bc) && /Said 60–70% · 1 picks/.test(bc) && /100%/.test(bc), "models tab: confidence buckets use the chance the model said");
    ok(/Said 35–50% · 1 players/.test(tc) && /Said 15–25% · 1 players/.test(tc), "models tab: touchdown calibration bands");
    ok(/Fills in as games go final/.test(ctx.T.modelsByConfidence([])) && /Fills in as games go final/.test(ctx.T.tdCalibration([])), "models tab: empty data says so");
    ctx.document.getElementById = old; }
  { // Record tab week filter: this week by default, Season shows everything, tiles recomputed from the bets shown
    const box = { innerHTML: "", onclick: null }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "record-mine" ? box : old(id));
    vm.runInContext(`S = { week: 4, games: [] }; MBWEEK = null; MB = { summary: { wins: 9, losses: 9, pushes: 0, pl: 0, openCost: 0 }, synced: null, bets: [
      { id: "a", week: 3, cost: 10, toWin: 100, result: "L", pl: -10, legs: [] }, { id: "b", week: 3, cost: 10, toWin: 100, result: "L", pl: -10, legs: [] },
      { id: "c", week: 4, cost: 20, toWin: 130, result: "W", pl: 110, legs: [] } ] }`, ctx);
    ctx.T.renderMine(); ok(/1–0/.test(box.innerHTML) && /\+\$110/.test(box.innerHTML) && /data-mbw="3"/.test(box.innerHTML) && /data-mbw="all"/.test(box.innerHTML), "record tab: defaults to this week's bets only");
    vm.runInContext(`MBWEEK = "all"`, ctx); ctx.T.renderMine(); ok(/1–2/.test(box.innerHTML), "record tab: Season chip shows every week");
    vm.runInContext(`MBWEEK = 3`, ctx); ctx.T.renderMine();
    ok(/BETS/.test(box.innerHTML) && /RECORD/.test(box.innerHTML) && !/OPEN BETS/.test(box.innerHTML) && !/Expected returns/.test(box.innerHTML) && !/Open bets/.test(box.innerHTML) && !/Live account view/.test(box.innerHTML) && /Results/.test(box.innerHTML), "record tab: an earlier week shows results only");
    vm.runInContext(`MBWEEK = null`, ctx); ctx.T.renderMine(); ok(/OPEN BETS/.test(box.innerHTML) && /Expected returns/.test(box.innerHTML), "record tab: this week keeps open bets and expected returns");
    vm.runInContext(`MBWEEK = null`, ctx); ctx.document.getElementById = old; }
  { const base = { player: "B.Bowers", pos: "TE", team: "LV", game: "LV @ KC", fair: 34, two: 8, first: 9, teamRank: 1, price: 0.3, flags: [] };
    const yes = ctx.T.prow({ ...base, returning: "out", returningState: "practicing" }, { started: false }, true), dnp = ctx.T.prow({ ...base, returning: "out", returningState: "not practicing" }, { started: false }, true), no = ctx.T.prow(base, { started: false }, true);
    ok(/RETURNING/.test(yes) && /was out on last week/.test(yes) && /assumes he plays/.test(yes) && /34%/.test(yes) && !/RETURNING/.test(no), "returning label: practicing returner is labelled, plain players are not");
    ok(/NOT PRACTICING/.test(dnp) && /NOT treated as playing/.test(dnp) && !/↩ RETURNING/.test(dnp), "returning label: a returner who is not practicing is flagged, not treated as playing"); }
  { const w = (m) => ctx.T.totalCard({ ...tg, poly: { total: { line: 38.5, over: 0.5, under: 0.52 } }, model: { total: 37, ...m } }, "x");
    ok(/Tested angle: Under 38\.5 \(wind forecast 14 mph\)/.test(w({ outdoor: true, wind: 14 })) && !/Tested angle: Under/.test(w({ outdoor: true, wind: 8 })) && !/Tested angle: Under/.test(w({ outdoor: false, wind: 20 })) && !/Tested angle: Under/.test(ctx.T.totalCard({ ...tg, final: true, poly: { total: { line: 38.5 } }, model: { total: 37, outdoor: true, wind: 20 } }, "x")), "windy-under note: only for an outdoor game with 12+ mph forecast, not finished"); }
  vm.runInContext(`S = { week: 4, games: [], edgesNow: [{ game: "PIT @ CLE", label: "CLE ML", price: 0.37, fair: 0.42, evNet: 0.134 }] }; LIVE = {}; LIVE_T = null`, ctx);
  const lg = { key: "PIT @ CLE", away: "PIT", home: "CLE", kickoff: "2026-10-02T00:15:00Z", started: true, final: false, injuries: [], history: [], poly: { spread: { homeSpread: 2.5, home: 0.5, away: 0.5 }, ml: { home: 0.4, away: 0.62 }, total: { line: 38.5, over: 0.5, under: 0.5 } } };
  ok(!/LIVE/.test(ctx.T.gameCard(lg, "x")), "live view: nothing live until live lines are loaded (the card shows the locked kickoff line)");
  vm.runInContext(`LIVE = { "PIT @ CLE": { spread: { homeSpread: 3.5, home: 0.48, away: 0.53 }, total: { line: 36.5, over: 0.5, under: 0.52 } } }; LIVE_T = new Date().toISOString()`, ctx);
  const lc = ctx.T.gameCard(lg, "x"), ltc = ctx.T.totalCard(lg, "x");
  ok(/LIVE/.test(lc) && /CLE \+3\.5/.test(lc) && /Kickoff line \(locked\): CLE \+2\.5/.test(lc) && /updated 0s ago/.test(lc), "live view: live spread with a LIVE tag, with the locked kickoff line kept underneath", lc);
  ok(/Over 36\.5/.test(ltc) && /Kickoff line \(locked\): 38\.5/.test(ltc), "live view: live total, locked kickoff total kept");
  vm.runInContext(`LIVE = { "PIT @ CLE": null }`, ctx);
  ok(/paused/.test(ctx.T.gameCard(lg, "x")) && /Kickoff line \(locked\): CLE \+2\.5/.test(ctx.T.gameCard(lg, "x")), "live view: no open lines -> says paused, not a stale number");
  ok(!/LIVE/.test(ctx.T.gameCard({ ...lg, started: false }, "x")) && !/LIVE/.test(ctx.T.gameCard({ ...lg, final: true }, "x")), "live view: not shown before kickoff or after the game ends");
  vm.runInContext(`LIVE = {}; LIVE_T = null`, ctx);
  const sc = ctx.T.tdTop3({ away: "PIT", home: "CLE", td: ["A", "B", "C", "D"].map((n, i) => ({ team: "PIT", player: "P." + n, pos: "RB", fair: 40 - i * 5, price: 0.3 })).concat([{ team: "CLE", player: "Q.X", pos: "WR", fair: 22, price: 0.2, two: 5, first: 4 }]) });
  ok((sc.match(/class="p"/g) || []).length === 4 && /P\.A/.test(sc) && !/P\.D/.test(sc) && /2\+ 5% · 1st 4%/.test(sc), "scorers: top 3 per team side by side, best first", sc);
  ok(/Price gaps · 1 right now/.test(ctx.T.gapStrip()), "price-gap strip");
  vm.runInContext(`S = { games: [{ key: "TEN @ BAL", away: "TEN", home: "BAL", started: false, winPct: 84.4, model: { homeMargin: 12, total: 40 }, poly: { ml: { home: 0.82, away: 0.2 }, spread: { homeSpread: -10.5, home: 0.5, away: 0.51 }, total: { line: 41.5, over: 0.5, under: 0.51 } } },
    { key: "KC @ LV", away: "KC", home: "LV", started: false, winPct: 28, poly: { ml: { home: 0.3, away: 0.72 } } },
    { key: "X @ Y", away: "X", home: "Y", started: true, winPct: 60 }], winners: { all: { n: 10, w: 7, l: 3, hit: 0.7, said: 0.68 }, top4: { n: 4, w: 4, l: 0, hit: 1, said: 0.8 } },
    picks: { spread: { recorded: 11, graded: 11, w: 6, l: 5, hit: 6 / 11 }, total: { recorded: 11, graded: 10, w: 4, l: 6, hit: 0.4 } } }`, ctx);
  const box = ctx.T.winnersBox(), recs = ctx.T.winnersBox("records");   // Picks tab = the picks; Results tab = the records
  ok(box.indexOf("BAL") < box.indexOf("KC") && /1\. <b>BAL<\/b> over TEN/.test(box) && /2\. <b>KC<\/b> over LV/.test(box) && !/X over Y/.test(box), "page: ranked by chance, started games left out");
  vm.runInContext(`S.games[0].td = [{ player: "D.Henry", fair: 58, injury: "" }, { player: "Out.Guy", fair: 90, injury: "Out" }, { player: "L.Jackson", fair: 41 }]`, ctx);
  ok(/TD <b>D\.Henry 58%<\/b>/.test(ctx.T.winnersBox()), "page: touchdown side is the most likely scorer who is not out");
  ok(/84%/.test(box) && /82¢/.test(box) && !/7–3/.test(box) && /7–3 · right 70%/.test(recs) && /top 4/i.test(recs), "page: picks show chance and price; the season record is on the Results tab");
  ok(/Spread <b>BAL -10\.5<\/b> · Total <b>Under 41\.5<\/b> · TD <b>/.test(box), "page: each game shows labeled spread side, total side and touchdown side");
  ok(/Spreads[\s\S]*6–5 · covered 55%/.test(recs) && /Totals[\s\S]*4–6 · right 40%/.test(recs), "page: separate season records for winners, spreads and totals"); }
console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(bad ? 1 : 0);
