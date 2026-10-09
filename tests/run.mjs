// Automated checks for the site (run: npm test). Every check here was a real bug or a number that must never drift:
// odds math, line moves with key numbers, TD math matching the Python model, name matching, the edge tracker, and the
// sentences the page shows. GitHub runs this plus the build on every push (.github/workflows/ci.yml).
import vm from "node:vm";
import { readFileSync } from "node:fs";
import RedisMock from "ioredis-mock";
globalThis.__TEST_REDIS__ = new RedisMock();
const { toProb, toAmerican, ncdf, ninv, kellyStake, isThinMarket, SD_MARGIN, shiftCover } = await import("../lib/odds.js");
const { playedLastGame } = await import("../lib/snaps.js");
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
  ok(R.rows.length === 14 && R.rows[1].id === "spread_model" && R.rows[0].id === "favorite", "replay: fourteen rows, favorite first, model rows fixed"); }
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
  vm.runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8") + "\n;globalThis.T={slotOf,saferSide,bestBets,injTag,topAngle,weakLeg,anglesBox,kickLine,openMove,tdNoGap,teaserRow,teaserStrip,renderLines,firstTdPick,firstTdLine,firstTdRecord,tdPlayersWithDefense,tdByPosition,tdByDefense,tdGroupRow,tdGradeMap,tdMark,tdGameLine,earlyNote,spreadReason,totalReason,leanCell,prow,betRow,changedBox,rightNowBox,winnersBox,winnerOf,tile,tdTop3,tdRow,gapStrip,gameCard,totalCard,detailTop,replayBox,renderMine,gbgHtml,renderLab,renderModel,renderTd,tdBlend,betsSummary,clvSummary,betsAnalysis,keepOpenState,modelsByWeek,modelsByConfidence,tdCalibration,mSec};", ctx);
  const T = ctx.T;
  let g = { away: "DAL", home: "PHI", model: { homeMargin: 4.2, fix: {} }, poly: { spread: { homeSpread: -3.5 } } };
  ok(/Model: PHI by 4\.2/.test(T.spreadReason(g)) && !/needs/.test(T.spreadReason(g)), "spread wording");
  g.poly.spread.homeSpread = -3; ok(!/\./.test(T.spreadReason(g).replace(/\d\.\d/g, "")), "spread wording: no sentences");
  g = { away: "A", home: "H", model: { total: 44.4, fix: { dome: 2.59, pace: 0.1, div: true } }, poly: { total: { line: 45.5 } } };
  ok(/Model: 44\.4/.test(T.totalReason(g)) && /dome \+2\.6/.test(T.totalReason(g)), "totals wording");
  g = { away: "A", home: "H", winPct: 61.2, model: { homeMargin: 3, fix: {} }, spreadPick: { label: "H -2.5", pct: 51.1 }, poly: {} };
  ok(/weak lean/.test(T.leanCell(g, "spread")) && !/about 50\/50/.test(T.leanCell(g, "spread")) && /historically/.test(T.leanCell(g, "spread")) && !/this close/.test(T.leanCell(g, "spread")) && !/market-based/.test(T.leanCell(g, "spread")), "lean wording");
  const row = T.prow({ player: "O'Neil <b>", pos: "WR", team: "H", game: "A @ H", fair: 20.1, fairIfPlays: 30, injury: "Questionable", price: 0.25, teamRank: 2 }, { started: false }, false);
  ok(/30% if he plays/.test(row) && /O&#39;Neil &lt;b>/.test(row), "Questionable row + names escaped");
  ok(/Push leg/.test(T.betRow({ source: "preloaded", legs: [{ result: "W", kind: "total", side: "under", line: 43 }, { result: "P", kind: "total", side: "over", line: 44 }], result: "P", pushUnconfirmed: true, cost: 5, toWin: 20, pl: null })), "combo push wording");
  vm.runInContext(`S = { games: [{ key: "DAL @ PHI", away: "DAL", home: "PHI", started: false, poly: { spread: { homeSpread: -4 }, total: { line: 45.5 }, ml: { home: 0.66 } },
    history: [{ t: "2026-10-01T10:00:00Z", poly: { spread: { homeSpread: -3 }, total: { line: 45.5 }, ml: { home: 0.60 } } }] }], edgesNow: [], edgeRule: { min: 0.03, feePct: 2, booksAgeH: 5, booksMaxAgeH: 3 } }`, ctx);
  ok(/spread PHI -3 → -4/.test(T.changedBox()) && /moneyline 60¢ → 66¢/.test(T.changedBox()), "what changed");
  ok(!/Gap = fair chance/.test(T.rightNowBox()), "right now box: no explanation line");
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
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + `2026,REG,4,${new Date(Date.now() - 86400e3).toISOString().slice(0, 10)},13:00,PIT,24,CLE,27,outdoors,Huntington,Home,grass\n` } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
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
    const { resetEspnFailure } = await import("../lib/espnFinals.js"); resetEspnFailure(); const n = await overlayEspnFinals(rows, now, fetcher);
    ok(n === 1 && rows[0].final && rows[0].awayScore === 24 && rows[0].espnFinal && !rows[1].final && !rows[2].final && rows[3].awayScore === 1, "espn finals: only games that kicked off 3h15+ ago and nflverse lacks; nflverse rows untouched");
    ok((await overlayEspnFinals(rows.map((r) => ({ ...r, final: false })), now, async () => { throw new Error("down"); })) === 0, "espn finals: a failed fetch changes nothing");
    let calls = 0; ok((await overlayEspnFinals(rows.map((r) => ({ ...r, final: false })), now, async () => { calls++; return { ok: true, json: async () => ({ events: [] }) }; })) === 0 && calls === 0, "espn finals: after a failure ESPN is left alone for a minute"); resetEspnFailure();
    const { getStatus } = await import("../lib/status.js"); const R = globalThis.__TEST_REDIS__; await R.del("errors");
    await R.lpush("errors", JSON.stringify({ t: new Date(now - 4 * 86400e3).toISOString(), where: "old", msg: "x" })); await R.lpush("errors", JSON.stringify({ t: new Date(now - 3600e3).toISOString(), where: "new", msg: "y" }));
    const stt = await getStatus(2026, 4, {}, null); ok(stt.errors.length === 1 && stt.errors[0].where === "new" && stt.ok === false, "status: only errors from the last 48 hours are listed"); await R.del("errors"); }
  { // parlay history: hand-worked week of three home favorites (A -400 wins, B -500 wins, C -300 loses)
    const { parlayHistory } = await import("../lib/replay.js");
    const gm = (home, spread, hml, aml, hs, as) => ({ season: 2010, week: 1, home, away: "Z", spread, hml, aml, hs, as });
    const rows = [gm("A", 10, -400, 300, 30, 10), gm("B", 12, -500, 350, 28, 3), gm("C", 9.5, -300, 240, 7, 17), { season: 2010, week: 1, home: "T", away: "Z", spread: 10, hml: -400, aml: 300, hs: 20, as: 20 }];
    const by = (id) => parlayHistory(rows).find((p) => p.id === id);
    const s1 = by("home_fav_95_single"), s2 = by("home_fav_95_2"), s3 = by("home_fav_95_3"), t3 = by("top3_home_75");
    ok(s1.n === 3 && Math.abs(s1.hit - 2 / 3) < 1e-9 && Math.abs(s1.roi - ((0.25 + 0.2 - 1) / 3)) < 1e-9, "parlay history: singles (tie dropped, win pays 1/price - 1)");
    ok(s2.n === 1 && s2.hit === 1 && Math.abs(s2.roi - (1.2 * 1.25 - 1)) < 1e-9, "parlay history: 2-leg takes the best-priced two, pays the product");
    ok(s3.n === 1 && s3.hit === 0 && s3.roi === -1 && t3.n === 0 && t3.hit === null, "parlay history: a lost leg loses the parlay; top-3 needs three games at 75%+ no-vig");
    ok(s1.periods.length === 3 && s1.periods[0].n === 3 && s1.periods[1].n === 0 && s1.periods[2].n === 0, "parlay history: split into the three periods");
    ok(parlayHistory([]).every((p) => p.n === 0), "parlay history: empty schedule gives empty rows"); }
  { // bets analysis: hand-worked numbers
    const L = (kind, result, price) => ({ kind, result, price });
    const bets = [ { source: "preloaded", cost: 10, result: "L", pl: -10, legs: [L("td", "W", 0.4), L("td", "L", 0.4), L("spread", "W", 0.5)] },
      { source: "preloaded", cost: 5, result: "L", pl: -5, legs: [L("td", "L", 0.5), L("total", "W", 0.5)] },
      { source: "preloaded", cost: 8, result: "pending", legs: [L("td", "pending", 0.3), L("spread", "L", 0.5)] },
      { source: "account", cost: 99, result: "L", pl: -99, legs: [] } ];
    const h = ctx.T.betsAnalysis(bets);
    ok(/Touchdowns <span class="dim">· 3 legs<\/span>[\s\S]*hit <b>33%<\/b> · paid 43¢ · <b class="r">−10 pts/.test(h), "bets analysis: touchdown legs hit 1 of 3 against an average 43¢ price = −10 points");
    ok(/Spreads <span class="dim">· 2 legs/.test(h) && /Totals <span class="dim">· 1 legs/.test(h) && !/99/.test(h), "bets analysis: legs of unfinished combos count once graded; account bets are left out");
    ok(/3-leg combos <span class="dim">· 1<\/span>/.test(h) && /2-leg combos <span class="dim">· 1<\/span>/.test(h) && !/settled legs of your typed-in combos/.test(h), "bets analysis: by combo size, no explanation footnote");
    ok(/None yet/.test(ctx.T.betsAnalysis([])) && /None yet/.test(ctx.T.betsAnalysis([{ source: "preloaded", legs: [L("td", "pending", 0.4)], result: "pending" }])), "bets analysis: says so when nothing has settled"); }
  { // closing-line value: hand-worked, and the grading helper
    const mk = (k, c) => ({ [k]: { basis: "model", clvPts: c } });
    const h = ctx.T.clvSummary([mk("spread", 0.5), mk("spread", -0.5), mk("spread", 1), mk("spread", 0), mk("total", -1), { spread: { basis: "stats", clvPts: 9 } }, { spread: { basis: "model", clvPts: null } }]);
    ok(/SPREAD side[\s\S]*\+0\.25 pts<\/b> avg · 2 better, 1 worse, 1 same/.test(h) && /TOTAL side[\s\S]*−1\.00 pts<\/b> avg · 0 better, 1 worse, 0 same/.test(h), "closing line: average points and better/worse/same counts, ignoring non-model and missing values");
    ok(ctx.T.clvSummary([]) === "", "closing line: nothing to show with no data");
    const { clvPtsFor } = await import("../lib/grade.js");
    const op = { spread: { homeSpread: -3 }, total: { line: 44 } };
    ok(clvPtsFor("spread", "CLE +2.5", "CLE", { spread: { homeSpread: 3 } }) === 0.5 && clvPtsFor("spread", "PIT -3", "CLE", { spread: { homeSpread: 2.5 } }) === 0.5 && clvPtsFor("spread", "CLE -3.5", "CLE", op) === 0.5 && clvPtsFor("spread", "CLE -3.5", "CLE", { spread: { homeSpread: -4 } }) === -0.5, "closing line: spread points from the open (underdog +3 open, +2.5 close = +0.5; favorite −3 open, −3.5 close = +0.5; favorite −4 open, −3.5 close = −0.5)");
    ok(clvPtsFor("total", "Over 45.5", "CLE", op) === 1.5 && clvPtsFor("total", "Under 42.5", "CLE", op) === 1.5 && clvPtsFor("total", "Under 45.5", "CLE", op) === -1.5 && clvPtsFor("total", "Over 44", "CLE", null) === null && clvPtsFor("spread", "garbage", "CLE", op) === null, "closing line: total points (over wants a higher close, under a lower one), null when unknown"); }
  { // the numbers add up: every week's record and profit sum to the season's, for 200 random bet sets
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; let bad = 0;
    for (let i = 0; i < 200; i++) {
      const bets = Array.from({ length: 1 + Math.floor(rnd() * 25) }, () => { const r = rnd(), cost = 1 + Math.floor(rnd() * 30), toWin = cost * (2 + rnd() * 20), week = 1 + Math.floor(rnd() * 6);
        const result = r < 0.1 ? "P" : r < 0.2 ? "pending" : r < 0.3 ? "W" : "L"; return { week, cost, toWin, result, pl: result === "W" ? toWin - cost : result === "L" ? -cost : result === "P" ? 0 : null, clv: rnd() < 0.3 ? rnd() - 0.5 : null, expMarket: cost * rnd(), expModel: rnd() < 0.5 ? cost * rnd() : null }; });
      const all = ctx.T.betsSummary(bets), parts = [1, 2, 3, 4, 5, 6].map((w) => ctx.T.betsSummary(bets.filter((b) => b.week === w)));
      const sum = (k) => parts.reduce((a, p) => a + p[k], 0);
      if (all.wins !== sum("wins") || all.losses !== sum("losses") || all.pushes !== sum("pushes") || Math.abs(all.pl - sum("pl")) > 1e-6 || Math.abs(all.openCost - sum("openCost")) > 1e-6 || Math.abs(all.maxPayout - sum("maxPayout")) > 1e-6) bad++;
      if (all.wins + all.losses + all.pushes + bets.filter((b) => b.result === "pending").length !== bets.length) bad++;
    }
    ok(bad === 0, "bets numbers: each week's record, profit and open money add up to the season's (200 random sets)", bad); }
  { // the weekly budget and the Bets tab count the same dollars: 60 random ledgers, every week
    const { placedThisWeek } = await import("../lib/placed.js"); const { loadMyBets } = await import("../lib/mybets.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n";
    globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + `${SEASON},REG,3,2026-09-27,13:00,X,10,Y,20,o,s,Home,g\n${SEASON},REG,4,2026-10-01,20:15,PIT,24,CLE,27,o,s,Home,g\n${SEASON},REG,5,2099-10-08,20:15,AAA,,BBB,,o,s,Home,g\n` } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    let seed = 777; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; let bad = 0, checked = 0;
    for (let i = 0; i < 60; i++) {
      resetGamesCache(); const led = {};
      for (let j = 0; j < 1 + Math.floor(rnd() * 12); j++) { const kind = rnd(), id = (kind < 0.2 ? "astatc-" : "caoc-") + i + "-" + j, twin = rnd() < 0.15, cost = twin ? 20 : 1 + Math.floor(rnd() * 25);
        led[id] = { id, season: SEASON, week: [3, 4, 5, null][Math.floor(rnd() * 4)], cost, shares: twin ? 130.32 : cost * (3 + rnd() * 30), ...(rnd() < 0.4 ? { closedAt: "t" } : {}), ...(rnd() < 0.4 ? { resolved: { win: rnd() < 0.3, pl: -cost, t: ["2026-09-28T04:00:00Z", "2026-10-02T05:00:00Z", "2026-10-09T05:00:00Z"][Math.floor(rnd() * 3)] } } : {}) }; }
      await R.set("mybets:ledger", JSON.stringify(led)); const mb = await loadMyBets(SEASON);
      for (const w of [3, 4, 5]) { const tab = mb.bets.filter((b) => Number(b.week) === w).reduce((a, b) => a + b.cost, 0), budget = await placedThisWeek(SEASON, w); checked++; if (Math.abs(tab - budget) > 1e-6) { bad++; if (bad < 3) console.log("MISMATCH", i, w, tab, budget); } }
    }
    ok(bad === 0 && checked === 180, "budget vs Bets tab: the same dollars in every week (60 random ledgers x 3 weeks)", bad);
    globalThis.fetch = realFetch; resetGamesCache(); await R.del("mybets:ledger"); }
  { // settlement cross-check: scores decide two all-line combos; Polymarket agrees on one, disagrees on the other
    const { loadMyBets } = await import("../lib/mybets.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n", g = (a, as, h, hs) => `${SEASON},REG,3,2026-09-27,13:00,${a},${as},${h},${hs},o,s,Home,g\n`;
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + g("CAR", 18, "CLE", 21) + g("LAC", 16, "BUF", 24) + g("NE", 6, "JAX", 35) + g("NYJ", 24, "DET", 31) } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await R.set("mybets:ledger", JSON.stringify({ a: { id: "caoc-spreads", season: SEASON, week: 3, cost: 10, shares: 121.86, closedAt: "t", resolved: { win: true, pl: 111.86, t: "2026-09-28T04:00:00Z" } }, b: { id: "caoc-totals", season: SEASON, week: 3, cost: 10, shares: 132.89, closedAt: "t", resolved: { win: false, pl: -10, t: "2026-09-28T04:00:00Z" } } }));
    const mb = await loadMyBets(SEASON), c4 = mb.bets.find((b) => b.id === "w3-c4"), c5 = mb.bets.find((b) => b.id === "w3-c5");
    ok(c4.result === "L" && c4.settleCheck === "disagree" && c5.result === "L" && c5.settleCheck === "agree" && mb.summary.settleCheck.agree === 1 && mb.summary.settleCheck.disagree === 1, "settlement check: scores decide the combo, Polymarket's verdict is compared and a disagreement is flagged");
    globalThis.fetch = realFetch; resetGamesCache(); await R.del("mybets:ledger"); }
  { // weekly recap text, hand-worked
    const { weekRecap } = await import("../lib/grade.js");
    const recs = [ { ml: { result: "W" }, spread: { basis: "model", result: "L" }, total: { basis: "model", result: "W" }, td: [ { fair: 40, scored: true, played: true }, { fair: 20, scored: false, played: true }, { fair: 90, scored: true, played: false }, { fair: 50, scored: false } ] },
      { ml: { result: "L" }, spread: { basis: "model", result: "W" }, total: { basis: "stats", result: "L" }, td: [] }, { ml: { result: "W" }, spread: null, total: { basis: "model", result: "P" }, td: [{ fair: 10, scored: false, played: true }] } ];
    const r = weekRecap(4, recs);
    ok(r.title === "Week 4 recap: moneyline 2–1 · spread side 1–1 · total side 1–0" && r.sub === "TDs: 1 of 3 · exp 0.7", "weekly recap: records by model, touchdowns vs expected (players who did not play left out)");
    ok(weekRecap(4, []) === null && weekRecap(4, null) === null, "weekly recap: nothing graded gives no recap"); }
  { // final but ungraded games are reported with the reason
    const { ungradedFinals } = await import("../lib/grade.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n", g = (a, as, h, hs, d) => `${SEASON},REG,4,${d},13:00,${a},${as},${h},${hs},o,s,Home,g\n`;
    const day = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + g("AAA", 10, "BBB", 20, day(2)) + g("CCC", 10, "DDD", 20, day(2)) + g("EEE", 10, "FFF", 20, day(2)) + g("GGG", 10, "HHH", 20, day(2)) + g("KKK", 10, "LLL", 20, day(2)) + g("III", 10, "JJJ", 20, day(0)) } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await R.set(`close:${SEASON}:4:CCC @ DDD`, JSON.stringify({ poly: {} })); await R.set(`close:${SEASON}:4:EEE @ FFF`, JSON.stringify({ poly: {} })); await R.set(`model:${SEASON}:4`, JSON.stringify({ games: { "EEE @ FFF": { homeMargin: 1 } }, td: {} }));
    await R.set(`res:${SEASON}:4:GGG @ HHH`, JSON.stringify({ v: 2, spread: { result: "W" }, td: [] })); await R.set(`res:${SEASON}:4:KKK @ LLL`, JSON.stringify({ v: 2, ml: { result: "W" } })); const u = await ungradedFinals(SEASON); const by = Object.fromEntries(u.map((x) => [x.key, x.reason]));
    ok(u.length === 4 && by["KKK @ LLL"] === "missing lines, TDs" && by["AAA @ BBB"] === "no closing line" && by["CCC @ DDD"] === "no model numbers" && by["EEE @ FFF"] === "waiting for TD data" && !by["GGG @ HHH"] && !by["III @ JJJ"], "ungraded finals: reason per game; graded games and games under 12 h old are left out");
    globalThis.fetch = realFetch; resetGamesCache(); for (const k of await R.keys(`*${SEASON}:4*`)) await R.del(k); }
  { // moneyline sanity (10/4: "MIA ML 95%" at MIN, "LAC ML 95%" at SEA, from a corrupt read) and the old-record watchdog
    const { mlOk, homeWinFromSpread } = await import("../lib/sane.js");
    ok(!mlOk("MIA ML", 95, "MIN", 10) && !mlOk("LAC ML", 95, "SEA", 7) && mlOk("MIN ML", 77, "MIN", 10) && mlOk("CHI ML", 53, "CHI", 3.5) && mlOk("BAL ML", 82, "BAL", 9.5) && mlOk("X ML", 95, "Y", null) && mlOk("X ML", null, "Y", 3), "moneyline sanity: a pick whose chance doesn't fit the closing spread is dropped, a real one (even a big favorite) is kept");
    ok(Math.abs(homeWinFromSpread(0) - 50) < 0.01 && homeWinFromSpread(10) > 70 && homeWinFromSpread(-10) < 30 && Math.abs(homeWinFromSpread(3) + homeWinFromSpread(-3) - 100) < 0.01, "moneyline sanity: the spread-to-win-chance curve is symmetric and sensible");
    const { ungradedFinals } = await import("../lib/grade.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n", day = (n) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + `${SEASON},REG,4,${day(2)},13:00,OOO,10,PPP,20,o,s,Home,g\n` + `${SEASON},REG,4,${day(2)},13:00,QQQ,10,RRR,20,o,s,Home,g\n` } : { ok: false, text: async () => "" });
    await R.set(`res:${SEASON}:4:OOO @ PPP`, JSON.stringify({ v: 2, ml: { result: "W" }, gradedAt: new Date(Date.now() - 10 * 86400e3).toISOString() })); await R.set(`res:${SEASON}:4:QQQ @ RRR`, JSON.stringify({ v: 2, ml: { result: "W" }, gradedAt: new Date().toISOString() }));
    const u = await ungradedFinals(SEASON);
    ok(u.length === 1 && u[0].key === "QQQ @ RRR", "watchdog: a game graded long ago without a part (it can never be completed) stops warning; a recent one still warns");
    globalThis.fetch = realFetch; resetGamesCache(); for (const k of await R.keys(`*${SEASON}:4*`)) await R.del(k); }
  { // absurd Polymarket lines (10/4: "MIN +19.5" when the real line was MIN -10, "SEA +20.5" vs SEA -7)
    const { spreadOk, totalOk, sanePoly, pickHomeSpread } = await import("../lib/sane.js"); const { parseGame } = await import("../lib/poly.js");
    ok(spreadOk(-10, 10) && spreadOk(2.5, -2.5) && spreadOk(-9, 10) && !spreadOk(19.5, 10) && !spreadOk(20.5, 7) && spreadOk(null, 10) && spreadOk(3, null) && totalOk(38.5, 38.5) && !totalOk(50.5, 38.5) && totalOk(40, null), "line sanity: a spread/total within 6 points of the sportsbook closing line passes; MIN +19.5 vs the real MIN -10 does not");
    const sp = sanePoly({ spread: { homeSpread: 19.5, home: 0.5, away: 0.5 }, total: { line: 38.5, over: 0.5, under: 0.5 }, ml: { home: 0.7, away: 0.32 } }, 10, 38.5);
    ok(!sp.poly.spread && sp.poly.total && sp.poly.ml && sp.dropped.length === 1 && pickHomeSpread("MIN +19.5", "MIN") === 19.5 && pickHomeSpread("IND -4.5", "WAS") === 4.5 && pickHomeSpread("junk", "WAS") === null, "line sanity: only the absurd part is dropped; pick labels map to the home spread");
    const mk = (type, q, outcomes, prices, extra = {}) => ({ sportsMarketType: type, question: q, outcomes: JSON.stringify(outcomes), outcomePrices: JSON.stringify(prices), ...extra });
    const mkts = [ mk("moneyline", "Dolphins vs Vikings", ["Miami Dolphins", "Minnesota Vikings"], ["0.30", "0.72"]),
      mk("spreads", "Spread: Minnesota Vikings (-10)", ["Minnesota Vikings", "Miami Dolphins"], ["0.53", "0.49"], { bestBid: 0.52, bestAsk: 0.53 }),
      mk("spreads", "Spread: Minnesota Vikings (+19.5)", ["Minnesota Vikings", "Miami Dolphins"], ["0.5", "0.5"]) ];
    const g1 = parseGame(mkts, "MIA", "MIN"), g2 = parseGame([mkts[0], mkts[2]], "MIA", "MIN"), g3 = parseGame([mkts[1]], "MIA", "MIN");
    ok(g1.spread && g1.spread.homeSpread === -10, "poly parse: the main spread wins over an unpriced alternate that sits at 50%");
    ok(g2.spread === undefined && g3.spread && g3.spread.homeSpread === -10, "poly parse: an alternate that does not fit the moneyline is never taken as the game spread; with no moneyline the one real line is used");
    const ga = parseGame([...mkts, mk("spreads", "Spread: Minnesota Vikings (-1.5)", ["Minnesota Vikings", "Miami Dolphins"], ["0.79", "0.21"], { bestBid: 0.78, bestAsk: 0.8 })], "MIA", "MIN");
    const alt = (t, l) => (ga.alts || []).find((x) => x.team === t && x.line === l);
    ok(alt("MIN", -1.5).price === 0.8 && Math.abs(alt("MIA", 1.5).price - 0.22) < 1e-9 && alt("MIA", 10) && !alt("MIN", 19.5) && !alt("MIA", -19.5), "poly parse: alternate spreads keep both sides at the buy price; an unpriced placeholder is left out");
    // grading removes a bad stored pick but keeps the good one, in the result record and the Pick Lab picks
    const { gradeWeek } = await import("../lib/grade.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,spread_line,total_line,roof,stadium,location,surface\n";
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + `${SEASON},REG,4,2026-10-04,13:00,MIA,10,MIN,15,10,38.5,o,s,Home,g\n` } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await R.set(`res:${SEASON}:4:MIA @ MIN`, JSON.stringify({ v: 2, game: "MIA @ MIN", spread: { basis: "model", label: "MIN +19.5", result: "W", clvPts: 0 }, total: { basis: "model", label: "Over 38.5", result: "L", clvPts: 0 }, ml: { label: "MIA ML", result: "L" }, td: [], tdPx: true, tdScorerV2: true, repChecked: true, mlModelChecked: true }));
    await R.hset(`picks:${SEASON}:4`, "MIA @ MIN|spread", JSON.stringify({ game: "MIA @ MIN", market: "spread", label: "MIN +19.5", line: 19.5, price: 0.5 }));
    await R.hset(`picks:${SEASON}:4`, "MIA @ MIN|total", JSON.stringify({ game: "MIA @ MIN", market: "total", label: "Over 38.5", line: 38.5, price: 0.5 }));
    await gradeWeek(SEASON, 4);
    const rec = JSON.parse(await R.get(`res:${SEASON}:4:MIA @ MIN`)), pk = await R.hgetall(`picks:${SEASON}:4`);
    ok(!rec.spread && rec.total && rec.total.result === "L" && rec.ml && rec.lineDropped === true, "grading: a result saved with an absurd spread loses that part only (the total and moneyline stay)");
    ok(!pk["MIA @ MIN|spread"] && pk["MIA @ MIN|total"] && JSON.parse(pk["MIA @ MIN|total"]).result === "L", "grading: the Pick Lab spread pick with an absurd line is removed; the good total pick is graded");
    // the edge tracker: a spot logged at an absurd line is removed, a normal one is graded
    const { gradeEdges } = await import("../lib/edges.js");
    await R.hset(`edgelog:${SEASON}:4`, "MIA @ MIN|MIN +19.5", JSON.stringify({ game: "MIA @ MIN", market: "spread", label: "MIN +19.5", team: "MIN", line: 19.5, price: 0.5, fair: 0.98 }));
    await R.hset(`edgelog:${SEASON}:4`, "MIA @ MIN|Over 38.5", JSON.stringify({ game: "MIA @ MIN", market: "total", label: "Over 38.5", side: "over", line: 38.5, price: 0.5, fair: 0.55 }));
    await gradeEdges(SEASON, 4, { key: "MIA @ MIN", home: "MIN", away: "MIA", homeScore: 15, awayScore: 10, nvSpread: 10, nvTotal: 38.5 });
    const el = await R.hgetall(`edgelog:${SEASON}:4`);
    ok(!el["MIA @ MIN|MIN +19.5"] && el["MIA @ MIN|Over 38.5"] && JSON.parse(el["MIA @ MIN|Over 38.5"]).result === "L", "edge tracker: a spot logged at an absurd line is removed, the normal one is graded");
    // moneyline: a spot / winner built from the same corrupt read (MIA 95% at MIN) is removed or replaced; a real one is kept
    await R.hset(`edgelog:${SEASON}:4`, "MIA @ MIN|MIA ML", JSON.stringify({ game: "MIA @ MIN", market: "ml", label: "MIA ML", team: "MIA", price: 0.95, fair: 0.99 }));
    await R.hset(`edgelog:${SEASON}:4`, "MIA @ MIN|MIN ML", JSON.stringify({ game: "MIA @ MIN", market: "ml", label: "MIN ML", team: "MIN", price: 0.77, fair: 0.82 }));
    await gradeEdges(SEASON, 4, { key: "MIA @ MIN", home: "MIN", away: "MIA", homeScore: 15, awayScore: 10, nvSpread: 10, nvTotal: 38.5 });
    const el2 = await R.hgetall(`edgelog:${SEASON}:4`);
    ok(!el2["MIA @ MIN|MIA ML"] && el2["MIA @ MIN|MIN ML"] && JSON.parse(el2["MIA @ MIN|MIN ML"]).result === "W", "edge tracker: a moneyline spot at an impossible price is removed, the real one is graded");
    const { gradeEdgesWeek } = await import("../lib/edges.js");
    await R.hset(`edgelog:${SEASON}:4`, "LAC @ SEA|LAC ML", JSON.stringify({ game: "LAC @ SEA", market: "ml", label: "LAC ML", team: "LAC", price: 0.95, fair: 0.99, result: "L", pl: -1 }));
    await R.hset(`edgelog:${SEASON}:4`, "LAC @ SEA|SEA ML", JSON.stringify({ game: "LAC @ SEA", market: "ml", label: "SEA ML", team: "SEA", price: 0.7, fair: 0.75, result: "W", pl: 0.43 }));
    await gradeEdgesWeek(SEASON, 4, [{ key: "LAC @ SEA", home: "SEA", away: "LAC", homeScore: 30, awayScore: 23, nvSpread: 7, nvTotal: 44 }]);
    const el3 = await R.hgetall(`edgelog:${SEASON}:4`);
    ok(!el3["LAC @ SEA|LAC ML"] && el3["LAC @ SEA|SEA ML"], "edge tracker: an already-graded spot from a corrupt read is removed too; a real graded one stays");
    const { recordWinner, gradeWinnersWeek } = await import("../lib/paper.js");
    await recordWinner(SEASON, 4, { key: "MIA @ MIN", away: "MIA", home: "MIN", nvSpread: 10 }, { spread: { homeSpread: 19.5 } }, "t");
    const w1 = JSON.parse(await R.hget(`winners:${SEASON}:4`, "MIA @ MIN"));
    ok(w1.team === "MIN" && w1.p > 0.7 && w1.p < 0.85, "winners: a pick built from an absurd spread is replaced by the sportsbook spread's favorite", w1);
    await R.hset(`winners:${SEASON}:4`, "LAC @ SEA", JSON.stringify({ game: "LAC @ SEA", team: "LAC", where: "away", p: 0.95, week: 4 }));
    await R.hset(`winners:${SEASON}:4`, "DEN @ SF", JSON.stringify({ game: "DEN @ SF", team: "SF", where: "home", p: 0.62, week: 4 }));
    await gradeWinnersWeek(SEASON, 4, [{ key: "LAC @ SEA", home: "SEA", away: "LAC", homeScore: 30, awayScore: 23, nvSpread: 7 }, { key: "DEN @ SF", home: "SF", away: "DEN", homeScore: 24, awayScore: 14, nvSpread: 2.5 }]);
    const wk = await R.hgetall(`winners:${SEASON}:4`);
    ok(!wk["LAC @ SEA"] && JSON.parse(wk["DEN @ SF"]).result === "W", "winners: a stored 95% road pick that doesn't fit the closing spread is removed; a real one is graded");
    globalThis.fetch = realFetch; resetGamesCache(); for (const k of await R.keys(`*${SEASON}:4*`)) await R.del(k); }
  { const rb = ctx.T.replayBox();
    ok(/Road dogs \+3 to \+6\.5/.test(rb) && /53\.5%/.test(rb) && /UNSTABLE/.test(rb) && /<b>YES<\/b>/.test(rb) && /3–1/.test(rb) && /2 saved/.test(rb) && /7–3/.test(rb) && /2007–25/.test(rb), "replay card: history, live record, verdict, season range", rb.slice(0, 400));
    vm.runInContext(`REPLAY = null`, ctx); ok(ctx.T.replayBox() === "", "replay card: leaves itself out when the history is not loaded"); }
  { // Anytime TD tab: the four likeliest scorers per team, everyone one tap away
    const box = { innerHTML: "" }, hdr = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "td" ? box : id === "td-header" ? hdr : old(id));
    const pl = (team, i) => ({ player: `${team}.P${i}`, team, pos: "RB", fair: 60 - i * 5, price: 0.5, bid: 0.48, teamRank: i + 1, game: "A @ B", flags: [] });
    vm.runInContext(`S = { week: 4, games: [ { key: "A @ B", away: "A", home: "B", started: false, td: [${[0,1,2,3,4,5].map((i) => JSON.stringify(pl("A", i))).join(",")}, ${[0,1,2,3,4,5].map((i) => JSON.stringify(pl("B", i))).join(",")}] } ] }`, ctx);
    ctx.T.renderTd(); const rows = (box.innerHTML.match(/class="tdr"/g) || []).length, ownA = (box.innerHTML.match(/A\.P\d/g) || []);
    ok(rows === 6 && /top 3 per team/.test(hdr.innerHTML) && !/Show everyone/.test(box.innerHTML) && !/A\.P3/.test(box.innerHTML) && /A\.P2/.test(box.innerHTML), "touchdown tab: three players per team, no 'Show everyone' button");
    ctx.document.getElementById = old; }
  { // touchdown row: a "+N vs price" mark only when the blended chance beats the price by 5+; calibration rows show their noise
    const mk = (fair, price) => ctx.T.tdRow({ r: { player: "X.Y", team: "A", pos: "WR", fair, price, bid: price - 0.02, game: "A @ B", flags: [] }, g: { key: "A @ B", away: "A", home: "B" } }, 0);
    ok(/\+\d+ vs price/.test(mk(60, 0.40)) && !/vs price/.test(mk(40, 0.40)), "touchdown row: marks a player only when the blend beats the price by 5+");
    const cal = ctx.T.tdCalibration([...Array(24)].map((_, i) => ({ fair: 40, scored: i < 7 })));
    ok(/scored 29% ±9/.test(cal) && !/too few to trust/.test(cal), "calibration rows: show the margin of error and flag small samples"); }
  ok(playedLastGame({ missed: false, pct: 88 }) && !playedLastGame({ missed: true, pct: 60 }) && !playedLastGame({ missed: false, pct: 0 }) && !playedLastGame(null), "was-out tag: a player who played his team's last game is never tagged as out");
  { const ge = { key: "A @ B", away: "A", home: "B", early: true, spreadPick: null, totalPick: null, model: { homeMargin: 5.1, total: 44.9, homeWinPct: 66.4 } };
    const sp = ctx.T.leanCell(ge, "spread"), tt = ctx.T.leanCell(ge, "total");
    ok(/B -5\.1/.test(sp) && /B wins 66%/.test(sp) && /Early estimate/.test(sp) && /Total 44\.9/.test(tt) && !/<em>—|class="dim">—/.test(sp), "early games: the Model leans boxes show the model's own spread, win chance and total, labeled");
    ok(!/B -5/.test(ctx.T.leanCell({ ...ge, early: false }, "spread")), "not early: the boxes stay blank without a market line"); }
  { // finished game: touchdown cards are graded (scored / no TD / inactive / waiting), with a one-line summary
    const mk = (n, team, fair) => ({ team, player: n, pos: "RB", fair, price: 0.3 });
    const g = { key: "A @ B", away: "A", home: "B", final: true, td: [mk("P.One", "A", 60), mk("P.Two", "A", 40), mk("P.Three", "A", 30), mk("Q.One", "B", 50), mk("Q.Two", "B", 30), mk("Q.Three", "B", 20)] };
    vm.runInContext(`S = { week: 4, games: [] }; RES = [{ game: "A @ B", week: 4, td: [{ player: "P.One", team: "A", fair: 60, scored: true, played: true }, { player: "P.Two", team: "A", fair: 40, scored: false, played: true }, { player: "P.Three", team: "A", fair: 30, scored: false, played: false }, { player: "Q.One", team: "B", fair: 50, scored: true, played: true }, { player: "Q.Two", team: "B", fair: 30, scored: false }] }]`, ctx);
    const h = ctx.T.tdTop3(g);
    ok(/✓ scored/.test(h) && /✗ no TD/.test(h) && /inactive/.test(h) && /waiting for snaps/.test(h) && /not graded/.test(h), "finished game: each top scorer is marked scored, no TD, inactive, waiting or not graded");
    ok(/model's top 3 · 2 scored · expected 1\.5/.test(h), "finished game: the summary counts only graded players who played (inactive and waiting left out)");
    ok(!/✓|✗/.test(ctx.T.tdTop3({ ...g, final: false })), "unfinished game: no grades shown");
    vm.runInContext(`RES = null; GRADES = null`, ctx); ok(!/✓|✗/.test(ctx.T.tdTop3(g)), "finished game: no marks until the graded results are loaded");
    vm.runInContext(`RES = null`, ctx); }
  { // touchdown model by position and by opponent defense
    const P = (team, name, pos, fair, scored, played = true) => ({ team, player: name, pos, fair, scored, played });
    const res = [
      { game: "A @ B", awayScore: 10, homeScore: 40, td: [P("A", "A.RB", "RB", 40, false), P("B", "B.WR", "WR", 40, true), P("B", "B.RB", "RB", 30, true), P("B", "B.out", "WR", 30, false, false)] },
      { game: "C @ A", awayScore: 17, homeScore: 20, td: [P("C", "C.TE", "TE", 20, false), P("A", "A.TE", "TE", 20, true), P("C", "C.nopos", null, 20, false)] },
    ];
    const pl = ctx.T.tdPlayersWithDefense(res);
    ok(pl.length === 6 && !pl.some((p) => p.player === "B.out"), "by position/defense: inactive players are left out");
    const by = Object.fromEntries(pl.map((p) => [p.player, p.def]));
    ok(by["B.WR"] === "strong" && by["C.TE"] === "weak" && by["A.RB"] === null && by["A.TE"] === null, "by defense: the opponent is judged on its OTHER games (A allowed 17 elsewhere -> strong for B.WR, 40 elsewhere -> weak for C.TE; no other game -> no group)");
    const lone = ctx.T.tdPlayersWithDefense([{ game: "A @ B", awayScore: 10, homeScore: 40, td: [P("A", "A.RB", "RB", 40, false)] }]);
    ok(lone.length === 1 && lone[0].def === null, "by defense: an opponent with no OTHER graded game has no group (the game itself never counts)");
    const pos = ctx.T.tdByPosition(pl);
    ok(/RB · 2 players/.test(pos) && /WR · 1 players/.test(pos) && /TE · 2 players/.test(pos) && /1 with no position/.test(pos), "by position: RB, WR and TE rows with sample size, margin and a no-position note");
    ok(ctx.T.tdByDefense([]).includes("None yet"), "by defense: rows flag small samples; empty says it fills in"); }
  { // one week only (10/6): Anytime TD and Game Lines show this week, no next-week section
    const bx = { innerHTML: "" }, hx = { innerHTML: "" }, oldG = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "td" ? bx : id === "td-header" ? hx : oldG(id));
    const pl = (team, i) => ({ player: `T.${team}${i}`, team, pos: "RB", fair: 60 - i * 5, price: 0.5, bid: 0.48, teamRank: i + 1, game: "A @ B", flags: [] });
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", away: "A", home: "B", started: false, td: ${JSON.stringify([0, 1, 2, 3].map((i) => pl("A", i)).concat([0, 1, 2, 3].map((i) => pl("B", i))))} }] }`, ctx); ctx.T.renderTd();
    ok((bx.innerHTML.match(/class="tdr"/g) || []).length === 6 && !/Next week/.test(bx.innerHTML) && !/T\.A3/.test(bx.innerHTML), "touchdown tab: this week's top 3 per team only, no next-week section");
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", started: true, td: [] }] }`, ctx); ctx.T.renderTd();
    ok(/No games left this week/.test(bx.innerHTML), "touchdown tab: when every game has started it says no games are left");
    ctx.document.getElementById = oldG;
    const ln = { innerHTML: "", style: {} }, dt = { innerHTML: "", style: {} };
    ctx.document.getElementById = (id) => (id === "lines" ? ln : id === "detail" ? dt : id === "bgwm" ? { style: {}, dataset: {}, innerHTML: "" } : id === "back-btn" ? { onclick: null } : oldG(id));
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", away: "A", home: "B", started: false, final: false, kickoff: "2099-01-01T18:00:00Z", winPct: null, td: [], history: [] }], edgesNow: [], changed: [] }; DETAIL = null`, ctx);
    ctx.T.renderLines(); ok(/data-game="A @ B"/.test(ln.innerHTML) && !/Next week/.test(ln.innerHTML), "game lines: this week's tiles only");
    ctx.document.getElementById = oldG; }
  { // first TD pick: the highest first-TD chance from either team; graded after the game; season record
    const r = (player, team, first, fair = 40, extra = {}) => ({ player, team, pos: "RB", first, fair, price: 0.4, ...extra });
    const g = { key: "A @ B", away: "A", home: "B", final: false, td: [r("A.one", "A", 14), r("B.one", "B", 22), r("B.out", "B", 30, 50, { injury: "Out" })] };
    ok(ctx.T.firstTdPick(g).player === "B.one" && /First TD pick:<\/b> B\.one/.test(ctx.T.firstTdLine(g, null)) && /22%/.test(ctx.T.firstTdLine(g, null)), "first TD pick: the highest first-TD chance from either team (an Out player is skipped)");
    const gr = { found: true, map: new Map([["B|bone", { ftdHit: true }]]) }, grMiss = { found: true, map: new Map([["B|bone", { ftdHit: false }]]) };
    ok(/✓ scored first/.test(ctx.T.firstTdLine({ ...g, final: true }, gr)) && /✗/.test(ctx.T.firstTdLine({ ...g, final: true }, grMiss)) && !/✓|✗/.test(ctx.T.firstTdLine(g, gr)), "first TD pick: ✓ / ✗ only after the game");
    const res = [{ td: [{ ftd: 20, ftdHit: true, played: true }, { ftd: 10, ftdHit: false, played: true }] }, { td: [{ ftd: 30, ftdHit: false, played: false }, { ftd: 18, ftdHit: false, played: true }] }];
    ok(/1 of 2 · 50% · exp 19%/.test(ctx.T.firstTdRecord(res)) && ctx.T.firstTdRecord([]) === "", "first TD picks: season record uses each game's top pick who played");
    const { buildFtdCalibration, applyFtdCalibration, FTD_MIN_GAMES } = await import("../lib/calibration.js");
    const recs = (n) => [...Array(n)].map(() => ({ td: [...Array(10)].map((_, i) => ({ ftd: 8, ftdHit: i === 0, played: true })) }));
    const off = { ftd: buildFtdCalibration(recs(15)) }, on = { ftd: buildFtdCalibration(recs(FTD_MIN_GAMES)) };
    ok(!off.ftd.on && applyFtdCalibration(8, off) === 8 && on.ftd.on && applyFtdCalibration(8, on) > 8 && applyFtdCalibration(8, on) <= 8 * 1.15 + 0.05, "first-TD calibration: off under 100 graded games; then a shrunk, capped correction");
  }
  { // "No" mark on Anytime TD: real market, model 5+ points under the bid
    ok(ctx.T.tdNoGap({ fair: 30, price: 0.4, bid: 0.38 }) === 8 && ctx.T.tdNoGap({ fair: 35, price: 0.4, bid: 0.38 }) === null && ctx.T.tdNoGap({ fair: 20, price: 0.9, bid: 0.1, thin: true }) === null && ctx.T.tdNoGap({ fair: 20, price: 0.5, bid: 0.3 }) === null, "No mark: only a real market where the model is 5+ under the bid");
    const row = ctx.T.tdRow({ r: { player: "X.Y", team: "A", pos: "WR", fair: 30, price: 0.4, bid: 0.38, game: "A @ B", flags: [] }, g: { key: "A @ B", away: "A", home: "B" } }, 0);
    ok(/No · 8 under/.test(row) && !/vs price/.test(row), "No mark: shows on the touchdown row"); }
  { // first-TD shares in the app: with a QB listed, "someone else" drops to defense/special teams (0.28), like the model service
    const { firstTdShares } = await import("../lib/calibration.js");
    const base = [{ name: "a", fair: 50 }, { name: "b", fair: 30 }], withQb = [...base, { name: "q", pos: "QB", fair: 40 }];
    const s0 = firstTdShares(base), s1 = firstTdShares(withQb), tot = (xs) => xs.reduce((a, b) => a + b, 0);
    ok(s1[0] < s0[0] && tot(s1) > tot(s0) && tot(s1) < 100, "first TD: a listed QB takes a share; listed players cover more of the first TDs"); }
  { // touchdown correction after a retrain: games graded under the old model count half
    const { buildCalibration, OLD_MODEL_W } = await import("../lib/calibration.js");
    const recs = (week, hitEvery) => ({ season: 2026, week, td: [...Array(100)].map((_, i) => ({ fair: 40, scored: i % hitEvery === 0, played: true })) });
    const R0 = [recs(3, 5), recs(4, 2)];   // week 3 scored 20% of the time, week 4 50%
    const b40 = (c) => c.table.find((x) => x.lo === 35).mult;
    const plain = buildCalibration(R0), after = buildCalibration(R0, { season: 2026, week: 4 });
    ok(OLD_MODEL_W === 0.5 && b40(after) > b40(plain) && after.switchWeek === 4 && plain.switchWeek === undefined, "calibration: after a model switch in week 4, the older week-3 games count half (the correction leans toward the new model's games)");
    const R = globalThis.__TEST_REDIS__, { default: status } = await import("../pages/api/status.js"), res = { status() { return this; }, json() { return this; } };
    await status({ query: { retrain: "kept current model: candidate 0.1 vs active 0.1" } }, res); ok(!(await R.get("tdmodel:switch")), "status: a kept model records no switch");
    await status({ query: { retrain: "went live: candidate 0.1 vs active 0.2" } }, res); const sw = JSON.parse(await R.get("tdmodel:switch") || "null");
    ok(sw && sw.t && "week" in sw, "status: a model that went live records the switch week"); await R.del("tdmodel:switch"); }
  { // injury dropdown: game statuses first; practice-only notes (Wed-Thu) show too so it never vanishes midweek
    const { injDisplay } = await import("../lib/week.js");
    const L = injDisplay([{ name: "A", status: "Did Not Participate In Practice" }, { name: "B", status: "Questionable" }, { name: "C", status: "Full Participation in Practice" }, { name: "D", status: "Limited Participation in Practice" }, { name: "E", status: "Out" }]);
    ok(L.map((x) => x.name).join("") === "EBAD" && L[2].shown === "DNP (practice)" && L[3].shown === "Limited (practice)" && !L[0].shown, "injuries: Out/Questionable first, then DNP and Limited (labeled); full practice left out");
    const card = ctx.T.gameCard({ ...tg, injuries: L.map((x) => ({ ...x, team: "PIT", pos: "WR", week: 5 })) }, "x");
    ok(/Injuries 4/.test(card) && /DNP \(practice\)/.test(card), "injuries: the button shows with practice-only notes"); }
  { // opening line vs now, from the model side
    const g = { key: "TB @ DAL", away: "TB", home: "DAL", history: [{ poly: { spread: { homeSpread: -8.5 }, total: { line: 46.5 } } }] };
    ok(/Opened TB \+8\.5 · moved 1 toward the model/.test(ctx.T.openMove(g, "spread", { team: "TB", line: 7.5 })), "open line: TB +8.5 to +7.5 moved toward a TB pick");
    ok(/moved 1 toward/.test(ctx.T.openMove(g, "total", { side: "over", line: 47.5 })) && /away from/.test(ctx.T.openMove(g, "total", { side: "under", line: 47.5 })), "open line: totals from the pick's side");
    ok(ctx.T.openMove(g, "spread", { team: "TB", line: 8.5 }) === "" && ctx.T.openMove({ ...g, final: true }, "spread", { team: "TB", line: 7.5 }) === "", "open line: nothing when unmoved or final"); }
  { // ESPN kickoff overrides a stale schedule time (10/7: CHI @ GB moved to 4:25 ET; nflverse still said 1:00)
    const { overlayEspnKickoffs, kickoffsFromScoreboard, resetKickCache } = await import("../lib/espnFinals.js");
    const sb = { events: [{ date: "2026-10-11T20:25Z", competitions: [{ competitors: [{ homeAway: "home", team: { displayName: "Green Bay Packers" } }, { homeAway: "away", team: { displayName: "Chicago Bears" } }] }] },
      { date: "2026-10-11T17:00Z", competitions: [{ competitors: [{ homeAway: "home", team: { displayName: "Miami Dolphins" } }, { homeAway: "away", team: { displayName: "Cincinnati Bengals" } }] }] }] };
    ok(kickoffsFromScoreboard(sb)["CHI @ GB"] === "2026-10-11T20:25:00.000Z", "ESPN kickoffs: parsed by team");
    resetKickCache(); const now = Date.parse("2026-10-08T03:00Z");
    const rows = [{ key: "CHI @ GB", final: false, kickoff: "2026-10-11T13:00:00-04:00" }, { key: "CIN @ MIA", final: false, kickoff: "2026-10-11T13:00:00-04:00" }, { key: "A @ B", final: true, kickoff: "2026-10-04T13:00:00-04:00" }];
    const n = await overlayEspnKickoffs(rows, now, async () => ({ ok: true, json: async () => sb }));
    ok(n === 1 && rows[0].kickoff === "2026-10-11T20:25:00.000Z" && rows[0].kickoffFrom === "espn" && rows[0].kickoffWas && rows[1].kickoff === "2026-10-11T13:00:00-04:00" && !rows[1].kickoffFrom, "ESPN kickoffs: a moved game takes ESPN's time; a matching one is left alone");
    resetKickCache(); const r2 = [{ key: "CHI @ GB", final: false, kickoff: "2026-10-11T13:00:00-04:00" }];
    ok((await overlayEspnKickoffs(r2, now, async () => { throw new Error("down"); })) === 0 && r2[0].kickoff === "2026-10-11T13:00:00-04:00", "ESPN kickoffs: ESPN down keeps the schedule's time"); resetKickCache(); }
  { // season record under each team code (10/8)
    const { teamRecord } = await import("../lib/week.js");
    const rows = [{ week: 1, final: true, away: "CHI", home: "GB", awayScore: 20, homeScore: 17 }, { week: 2, final: true, away: "DET", home: "CHI", awayScore: 24, homeScore: 24 },
      { week: 3, final: true, away: "CHI", home: "MIN", awayScore: 10, homeScore: 27 }, { week: 5, final: true, away: "CHI", home: "TB", awayScore: 30, homeScore: 3 }, { week: 4, final: false, away: "CHI", home: "LV" }];
    ok(teamRecord(rows, "CHI", 5) === "1–1–1" && teamRecord(rows, "GB", 5) === "0–1" && teamRecord(rows, "SEA", 5) === "0–0", "season record: earlier weeks' finals only, ties shown");
    const tl = ctx.T.tile({ ...tg, rec: { [tg.away]: "3–1", [tg.home]: "2–2" } });
    ok(/class="rec">3–1</.test(tl) && /class="rec">2–2</.test(tl) && !/class="t r"/.test(tl), "season record: shown under both team codes on the tile"); }
  { // strength of schedule (10/8)
    const { schedStrength } = await import("../lib/week.js");
    const rows = [{ week: 1, final: true, away: "A", home: "B", awayScore: 10, homeScore: 7 }, { week: 1, final: true, away: "C", home: "D", awayScore: 3, homeScore: 7 },
      { week: 2, final: true, away: "A", home: "D", awayScore: 1, homeScore: 7 }, { week: 3, final: true, away: "B", home: "C", awayScore: 9, homeScore: 3 }];
    const s = schedStrength(rows, 3);   // week 3 game not counted: A 1-1, B 0-1, C 0-1, D 2-0
    ok(s.A.pct === 0.667 && s.C.rank === 1 && s.A.rank === 2 && s.B.pct === 0.5 && s.D.rank === 4 && !s.E, "SOS: opponents' win share from earlier weeks, ranked hardest first");
    ok(s.C.rank === 1 || s.C.pct >= s.A.pct, "SOS: rank follows win share");
    const g = { ...tg, sos: { [tg.away]: { pct: 0.6, rank: 2 }, [tg.home]: { pct: 0.4, rank: 23 } } };
    const d = ctx.T.detailTop ? ctx.T.detailTop(g) : null;
    if (d) ok(/SOS 2nd/.test(d) && /SOS 23rd/.test(d), "SOS: shown on the game page"); }
  { // Polymarket kickoff (10/8: CHI @ GB 1:00 ET in the schedule and ESPN, 4:25 on Polymarket)
    const { polyKickoffs } = await import("../lib/poly.js"); const { overlayPolyKickoffs } = await import("../lib/games.js");
    const ev = [{ title: "Bears vs. Packers", startTime: "2026-10-11T20:25:00Z", markets: [] }, { title: "Bills vs. Rams", markets: [{ gameStartTime: "2026-10-13 00:15:00+00" }] }];
    const pk = polyKickoffs(ev, [{ key: "CHI @ GB", away: "CHI", home: "GB" }, { key: "BUF @ LA", away: "BUF", home: "LA" }, { key: "X @ Y", away: "X", home: "Y" }]);
    ok(pk["CHI @ GB"] === "2026-10-11T20:25:00.000Z" && pk["BUF @ LA"] === "2026-10-13T00:15:00.000Z" && !pk["X @ Y"], "Polymarket kickoff: event start time, else market game start");
    const rows = [{ key: "CHI @ GB", kickoff: "2026-10-11T13:00:00-04:00" }, { key: "CHI @ GB", kickoff: "2025-10-12T13:00:00-04:00", final: true }, { key: "BUF @ LA", kickoff: "2026-10-12T20:15:00-04:00" }];
    ok(overlayPolyKickoffs(rows, pk) === 1 && rows[0].kickoff === "2026-10-11T20:25:00.000Z" && rows[0].kickoffFrom === "polymarket" && rows[1].kickoff.startsWith("2025") && rows[2].kickoff === "2026-10-12T20:15:00-04:00", "Polymarket kickoff: replaces a stale time, leaves matching times and other seasons"); }
  { const { overlayPolyKickoffs, KICK_FIX } = await import("../lib/games.js"); const r = [{ key: "CHI @ GB", kickoff: "2026-10-11T13:00:00-04:00" }]; overlayPolyKickoffs(r, KICK_FIX);
    ok(new Date(r[0].kickoff).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }) === "10:00 AM", "CHI @ GB stays at the official noon CT (10:00 AM Pacific)"); }
  { // combos (10/8): road dog after a blowout, road team off a loss vs a 3-game streak, windy division under
    const { picksFor } = await import("../lib/paper.js");
    const poly = { spread: { homeSpread: -4.5, home: 0.5, away: 0.5 }, total: { line: 44.5, over: 0.5, under: 0.5 } }, m = { outdoor: true, wind: 14, fix: { div: true } };
    const mk = (sit) => picksFor({ key: "A @ H", away: "A", home: "H", week: 9 }, poly, m, sit).map((p) => p.market);
    const a = mk({ away: { prevLost: true, prevMarg: -20, prevPts: 3 }, home: { prevMarg: 3, won3: true } });
    ok(a.includes("dogblow") && a.includes("streakfade") && a.includes("winddiv") && a.includes("wind"), "combos: all three fire when they apply");
    const b = picksFor({ key: "A @ H", away: "A", home: "H", week: 9 }, poly, { outdoor: true, wind: 14, fix: { div: false } }, { away: { prevLost: false, prevMarg: 7 }, home: { prevMarg: 10, won3: false } }).map((p) => p.market);
    ok(!b.includes("dogblow") && !b.includes("streakfade") && !b.includes("winddiv"), "combos: none fire when they don't apply"); }
  { // proven angles flagged on the game (10/8)
    const g = { ...tg, angles: [{ id: "streakfade", pick: "TB +4.5", price: 0.48, name: "Road team off a loss vs 3-game win streak", hit: 59, n: 283 }] };
    ok(/PICK TB \+4\.5/.test(ctx.T.tile(g)) && /PICK TB \+4\.5<\/b>/.test(ctx.T.anglesBox(g)) && /wins 59%/.test(ctx.T.anglesBox(g)) && /283 games/.test(ctx.T.anglesBox(g)) && ctx.T.anglesBox(tg) === "", "angles: chip on the tile, rule and record on the game page"); }
  { // proven angles in Model Picks parlays (10/8)
    const { buildPaper } = await import("../lib/paper.js");
    const G = (k, angles, winPct, ml) => ({ key: k, home: k.split(" @ ")[1], away: k.split(" @ ")[0], started: false, final: false, angles, winPct, poly: ml ? { ml: { home: ml }, spread: { homeSpread: -3 } } : null, td: [] });
    const P = buildPaper({ games: [G("A @ B", [{ id: "streakfade", pick: "A +4.5", price: 0.48, hit: 59, n: 283 }]), G("C @ D", [{ id: "winddiv", pick: "Under 41.5", price: 0.5, hit: 56.8, n: 426 }]), G("E @ F", [], 80, 0.78), G("H @ I", [], 77, 0.75)] });
    const by = Object.fromEntries(P.map((p) => [p.strategy, p]));
    ok(by.angles_2 && by.angles_2.legs.map((l) => l.label).join(",") === "A +4.5,Under 41.5" && by.angles_2.legs[1].kind === "total" && Math.abs(by.angles_2.prob - 0.59 * 0.568) < 1e-9 && !by.angles_3, "angle parlays: one per game, rule hit rates as the chance, no 3-leg without 3 angles");
    ok(by.angles_fav_3 && by.angles_fav_3.legs.map((l) => l.label).join(",") === "A +4.5,F ML,I ML", "angle + favorites parlay: best angle plus the two strongest home favorites"); }
  { // road ML angle: flagged with its return, used as an ML leg in angle parlays (10/8)
    const g = { ...tg, angles: [{ id: "roadml3", pick: "BUF ML", price: 0.45, name: "Road team · moneyline · spread ~3, total 48+", hit: 55.2, n: 382, roi: 12.9 }] };
    ok(/wins 55\.2%/.test(ctx.T.anglesBox(g)) && !/per \$1/.test(ctx.T.anglesBox(g)), "road ML angle: win rate shown, no money");
    const { buildPaper } = await import("../lib/paper.js");
    const P = buildPaper({ games: [{ key: "BUF @ LA", home: "LA", away: "BUF", started: false, final: false, angles: g.angles, td: [] }, { key: "A @ B", home: "B", away: "A", started: false, final: false, angles: [{ id: "winddiv", pick: "Under 41.5", price: 0.5, hit: 56.8, n: 426 }], td: [] }] });
    const l = P.find((p) => p.strategy === "angles_2").legs.find((x) => x.label === "BUF ML");
    ok(l && l.kind === "ml" && l.team === "BUF", "road ML angle: graded as a moneyline leg on the road team"); }
  { // coach fade (10/8)
    const { picksFor } = await import("../lib/paper.js");
    const poly = { spread: { homeSpread: -6, home: 0.5, away: 0.5 } }, G = { key: "A @ H", away: "A", home: "H", week: 6 };
    ok(picksFor(G, poly, {}, { home: {}, away: {}, homeCoachAts: { n: 50, rate: 0.42 } }).some((p) => p.market === "coachfade" && p.label === "A +6") &&
      !picksFor(G, poly, {}, { home: {}, away: {}, homeCoachAts: { n: 50, rate: 0.5 } }).some((p) => p.market === "coachfade"), "coach fade: road team only when the home coach is 44% or worse"); }
  { // sold combos (10/9): profit read from the selling trade
    const { soldFrom } = await import("../lib/mybets.js");
    const x = soldFrom({ type: "ACTIVITY_TYPE_TRADE", trade: { marketSlug: "caoc-1", price: { value: "0.4980" }, qty: "-50", realizedPnl: { value: "19.90" }, updateTime: "2026-10-09T02:00:00Z" } });
    ok(x && x.slug === "caoc-1" && x.pl === 19.9 && Math.abs(x.proceeds - 24.9) < 1e-9 && soldFrom({ trade: { marketSlug: "b", price: { value: "0.1" }, qty: "50", realizedPnl: { value: "0" } } }) === null, "sold: profit from the selling trade, buys ignored");
    const row = ctx.T.betRow ? ctx.T.betRow({ source: "account", title: "caoc-1", week: 5, cost: 5, price: 0.08, toWin: 59, result: "W", pl: 14.94, sold: { pl: 14.94, proceeds: 21.03 } }) : "";
    ok(/class="g">Sold<\/span> /.test(row) && /sold early for \$19\.94/.test(row), "sold: shown as Sold with the profit; paid back = stake + profit"); }
  { // linked combo legs (10/9)
    const { comboChance, pairLift } = await import("../lib/combo.js");
    const td = { game: "A @ B", kind: "td", team: "B", prob: 0.5 }, cov = { game: "A @ B", kind: "spread", team: "B", prob: 0.5 }, opp = { game: "A @ B", kind: "spread", team: "A", prob: 0.5 },
      ov = { game: "A @ B", kind: "total", side: "over", prob: 0.5 }, un = { game: "A @ B", kind: "total", side: "under", prob: 0.5 }, other = { game: "C @ D", kind: "spread", team: "D", prob: 0.5 };
    ok(pairLift(td, cov) === 1.19 && pairLift(cov, td) === 1.19 && pairLift(td, opp) === 0.81 && pairLift(td, ov) === 1.23 && pairLift(td, un) === 0.77 && pairLift(cov, ov) === 1 && pairLift(td, other) === 1, "combo links: TD with cover/Over up, with opponent/Under down, other pairs unrelated");
    ok(Math.abs(comboChance([td, cov, ov]) - 0.125 * 1.19 * 1.23) < 1e-12 && comboChance([td, { ...cov, prob: null }]) === null && comboChance([{ ...td, prob: 0.9 }, { ...cov, prob: 0.9 }]) <= 0.9, "combo chance: product times same-game links, capped at the least likely leg");
    const { buildPaper } = await import("../lib/paper.js");
    const P = buildPaper({ games: [{ key: "A @ B", home: "B", away: "A", started: false, final: false, poly: { spread: { homeSpread: -6.5, home: 0.5, away: 0.5 }, total: { line: 44.5, over: 0.5, under: 0.5 } },
      td: [{ team: "B", player: "B.Star", fair: 55, price: 0.5, bid: 0.48, market: "m" }, { team: "A", player: "A.Guy", fair: 60, price: 0.5, bid: 0.48 }] }] });
    const l = P.find((p) => p.strategy === "linked_sgp_3");
    ok(l && l.legs.map((x) => x.label).join(",") === "B -6.5,Over 44.5,B.Star TD" && Math.abs(l.prob - 0.5 * 0.5 * 0.55 * 1.19 * 1.23) < 1e-9, "linked combo parlay: favorite covers + Over + the favorite's top scorer, links counted"); }
  { // weakest leg of an open combo (10/9)
    const L = (n, p, m) => ({ kind: "total", side: "over", line: n, price: p, modelP: m, result: "pending" });
    const b = { result: "pending", legs: [L(40, 0.5, 0.55), L(41, 0.6, 0.4), L(42, 0.5, 0.49)] };
    ok(ctx.T.weakLeg(b) === b.legs[1] && ctx.T.weakLeg({ ...b, legs: [L(40, 0.5, 0.55), L(41, 0.5, 0.49)] }) === null && ctx.T.weakLeg({ ...b, result: "W" }) === null, "weakest leg: the leg furthest below its price, only on open combos"); }
  { // confidence: angles agreeing on one side (10/9)
    const g = { ...tg, angles: [{ id: "dogblow", pick: "TB +4.5", hit: 58 }, { id: "streakfade", pick: "TB +4.5", hit: 59 }, { id: "winddiv", pick: "Under 41.5", hit: 57 }] };
    ok(ctx.T.topAngle(g).pick === "TB +4.5" && ctx.T.topAngle(g).n === 2 && /PICK TB \+4\.5 ×2/.test(ctx.T.tile(g)), "confidence: chip shows the side most angles agree on, with the count"); }
  { // news lag alert (10/9)
    const { alertsTdJump } = await import("../lib/alerts.js"), { SEASON } = await import("../lib/games.js"); const { getRedis: gR } = await import("../lib/redis.js"); await gR().del(`alerts:${SEASON}`).catch(() => {});
    const g = { key: "A @ B", away: "A", home: "B" };
    const n = await alertsTdJump(SEASON, g, { away: [], home: [{ name: "B.Back", pos: "RB", fair: 20 }, { name: "B.QB", pos: "QB", fair: 10 }] }, { away: [], home: [{ name: "B.Back", pos: "RB", fair: 35 }, { name: "B.QB", pos: "QB", fair: 30 }] },
      { "B.Back anytime touchdown?": { ask: 0.22 } });
    const n2 = await alertsTdJump(SEASON, g, { away: [], home: [{ name: "B.Back", pos: "RB", fair: 20 }] }, { away: [], home: [{ name: "B.Back", pos: "RB", fair: 35 }] }, { "B.Back anytime touchdown?": { ask: 0.33 } });
    ok(n === 1 && n2 === 0, "news lag: alert when a player's chance jumps 8+ and the price lags 5+, not for QBs or caught-up prices"); }
  { // export includes line history (10/9)
    const R = globalThis.__TEST_REDIS__;
    await R.rpush("snap:2026:5:A @ B", JSON.stringify({ t: "2026-10-06T12:00:00Z", src: "schedule", poly: { spread: { homeSpread: -6.5, home: 0.5, away: 0.5, extra: 1 }, total: { line: 44.5, over: 0.5, under: 0.5 } } }),
      JSON.stringify({ t: "2026-10-11T16:00:00Z", poly: { spread: { homeSpread: -7.5, home: 0.5, away: 0.5 } }, books: { spread: { homeSpread: -8, home: { odds: -110, fair: 0.5 }, away: { odds: -110, fair: 0.5 } } } }));
    await R.set("close:2026:5:A @ B", JSON.stringify({ t: "2026-10-11T17:00:00Z", poly: { spread: { homeSpread: -7.5, home: 0.51, away: 0.49 } } }));
    await R.set("model:2026:5", JSON.stringify({ games: { "A @ B": { homeMargin: 9.7, total: 44.8, homeWinPct: 76, junk: 1 } } }));
    const { default: h } = await import("../pages/api/results/export.js"); let out = null;
    await h({ query: {} }, { setHeader() {}, status() { return { json(x) { out = x; } }; } });
    const L = out && out.lines && out.lines["2026:5:A @ B"];
    ok(L && L.snaps.length === 2 && L.snaps[0].spread.homeSpread === -6.5 && !("extra" in L.snaps[0].spread) && L.close.spread.homeSpread === -7.5 && L.snaps[1].books.spread.homeSpread === -8 && L.snaps[1].books.spread.home === 0.5 && out.models["2026:5"]["A @ B"].homeMargin === 9.7 && !("junk" in out.models["2026:5"]["A @ B"]),
      "export: every line snapshot, the closing line and the model numbers per game");
    await R.del("snap:2026:5:A @ B", "close:2026:5:A @ B", "model:2026:5"); }
  { // Polymarket ML vs its own spread (10/9)
    const { picksFor } = await import("../lib/paper.js"); const G = { key: "A @ H", away: "A", home: "H", week: 6 };
    const p1 = picksFor(G, { spread: { homeSpread: -7, home: 0.5, away: 0.5 }, ml: { home: 0.62, away: 0.38 } }, {}, null).find((p) => p.market === "mlgap");   // -7 implies ~70% home
    const p2 = picksFor(G, { spread: { homeSpread: -7, home: 0.5, away: 0.5 }, ml: { home: 0.70, away: 0.30 } }, {}, null).find((p) => p.market === "mlgap");
    ok(p1 && p1.label === "H ML" && p1.price === 0.62 && !p2, "ML vs spread: takes the moneyline priced 3+ pts under its spread's win chance, nothing when they agree"); }
  { // alt-line fair prices (10/9)
    const { altFair, altValues } = await import("../lib/altfair.js"); const g = { key: "A @ H", away: "A", home: "H" };
    const dog65 = altFair(g, -3, "A", 6.5), fav35 = altFair(g, -7, "H", -3.5), tease = altFair(g, 2.5, "H", 8.5);
    ok(dog65 > 0.62 && dog65 < 0.68 && fav35 > 0.58 && fav35 < 0.64 && tease > 0.7 && tease < 0.8 && altFair(g, -3, "A", 7) === null, "alt fair: fav 3 -> dog +6.5 ~65%, fav 7 -> fav -3.5 ~60%, teaser leg ~77%, whole lines skipped");
    const v = altValues(g, { spread: { homeSpread: -3 }, alts: [{ team: "A", line: 6.5, price: 0.58 }, { team: "A", line: 9.5, price: 0.74 }, { team: "H", line: -6.5, price: 0.36 }] }, null);
    ok(v.length === 2 && v[0].hist >= v[1].hist && v.every((x) => x.hist >= 0.6 && x.hist <= 0.85), "alt lines: the two that covered most often (60-85%), price ignored"); }
  { const g = { ...tg, altValue: [{ team: "TB", line: 6.5, price: 0.58, hist: 0.644 }] };
    ok(/ALT TB \+6\.5<\/b>/.test(ctx.T.anglesBox(g)) && /covers 64%/.test(ctx.T.anglesBox(g)) && /ALT TB \+6\.5/.test(ctx.T.tile(g)), "alt value: chip on the tile, line, price and history on the game page"); }
  ok(/>Q</.test(ctx.T.injTag({ espn: "Questionable — limited Thursday" })) && />OUT</.test(ctx.T.injTag({ injury: "Out" })) && />D</.test(ctx.T.injTag({ injury: "Doubtful" })) && ctx.T.injTag({}) === "", "injury tag: Q / D / OUT from the report, ESPN before Friday");
  { // every tracked angle is summarized (10/9)
    const R = globalThis.__TEST_REDIS__, { picksSummary } = await import("../lib/paper.js");
    await R.hset("picks:2099:5", "A @ B|booksmove", JSON.stringify({ market: "booksmove", result: "W", ret: 0.9, price: 0.5 }), "C @ D|mlgap", JSON.stringify({ market: "mlgap", result: "L", ret: -1, price: 0.4 }));
    const P = await picksSummary(2099); await R.del("picks:2099:5");
    ok(P.booksmove && P.booksmove.w === 1 && P.mlgap && P.mlgap.l === 1 && P.dogblow && P.dogblow.recorded === 0, "angle summary: new angles (books moved, ML vs spread, combos) get their records"); }
  { // ALT parlays (10/9)
    const { buildPaper } = await import("../lib/paper.js");
    const G = (k, extra) => ({ key: k, home: k.split(" @ ")[1], away: k.split(" @ ")[0], started: false, final: false, td: [], ...extra });
    const P = buildPaper({ games: [G("A @ B", { altValue: [{ team: "A", line: 6.5, price: 0.6, hist: 0.66 }] }), G("C @ D", { altValue: [{ team: "D", line: -3.5, price: 0.55, hist: 0.8 }] }),
      G("E @ F", { angles: [{ id: "dogblow", pick: "E +4.5", price: 0.5, hist: 58, hit: 58 }] })] });
    const a2 = P.find((p) => p.strategy === "alt_2"), a3 = P.find((p) => p.strategy === "alt_pick_3");
    ok(a2 && a2.legs.map((l) => l.label).join(",") === "D -3.5,A +6.5" && Math.abs(a2.prob - 0.8 * 0.66) < 1e-9 && a3 && a3.legs.length === 3 && a3.legs[2].label === "E +4.5", "ALT parlays: two best ALT lines, plus a PICK from another game"); }
  { // decision model (10/9)
    vm.runInContext(`S = { games: [{ key: "A @ B", started: false, angles: [{ pick: "A +4.5", name: "x", hit: 59, price: 0.5 }], altValue: [{ team: "B", line: -3.5, price: 0.7, hist: 0.62 }] }, { key: "C @ D", started: true, angles: [{ pick: "C +3", hit: 70, price: 0.4 }] }], teaserLegs: [{ team: "E", line: 8.5, price: 0.7, game: "E @ F" }] }`, ctx);
    const B = ctx.T.bestBets();
    ok(B.length === 3 && B[0].pick === "E +8.5" && B[1].pick === "B -3.5" && B[2].pick === "A +4.5" && !B.some((x) => "ev" in x || x.pick === "C +3"), "decision model: win rate only (no price), highest first, started games skipped"); }
  { const sp = ctx.T.saferSide({ teaser: { team: "E", line: 8.5 } }, "spread"), to = ctx.T.saferSide({ books: { total: { line: 44.5 } } }, "total", { side: "over" });
    ok(/E \+8\.5<\/b> · wins 76%/.test(sp) && /Under 50\.5<\/b> · wins 70%/.test(to) && ctx.T.saferSide({ final: true, teaser: { team: "E", line: 8.5 } }, "spread") === "", "safer side: dog moved 6 and total moved 6 on the cards");
    ok(/Under 50\.5<\/b> · wins 86%/.test(ctx.T.saferSide({ model: { outdoor: true, wind: 18 }, books: { total: { line: 44.5 } } }, "total", { side: "over" })) && /Over 38\.5<\/b> · wins 70%/.test(ctx.T.saferSide({ outdoor: false, books: { total: { line: 44.5 } } }, "total", { side: "under" })) && /wins 77%/.test(ctx.T.saferSide({ spreadPick: { team: "E" }, teaser: { team: "E", line: 8.5 } }, "spread")) && /wins 73%/.test(ctx.T.saferSide({ spreadPick: { team: "F" }, teaser: { team: "E", line: 8.5 } }, "spread")) && /wins 78%/.test(ctx.T.saferSide({ model: { turf: true }, spreadPick: { team: "F" }, teaser: { team: "E", line: 8.5 } }, "spread")) && /wins 83%/.test(ctx.T.saferSide({ model: { outdoor: true, wind: 16 }, teaser: { team: "E", line: 8.5 } }, "spread")) && /wins 70%/.test(ctx.T.saferSide({ teaser: { team: "E", line: 8.5 }, books: { total: { line: 48 } } }, "spread")), "safer side: wind and dome pick the total side; dog leg rate by wind and total");
    const { teaserLeg } = await import("../lib/teaser.js"), L = teaserLeg({ key: "A @ B", away: "A", home: "B" }, { spread: { homeSpread: -2.5 } }, null);
    ok(L && L.team === "A" && L.line === 8.5 && L.ladder.length === 5 && L.ladder.every((x, i) => i === 0 || x.hist >= L.ladder[i - 1].hist) && L.ladder[2].hist > 0.7 && /\+6\.5 \d+% · \+7\.5/.test(ctx.T.saferSide({ teaser: L }, "spread")), "dog leg: win rate at every line +6.5 to +10.5");
    const gm = { key: "A @ B", history: [{ poly: { total: { line: 47.5 } } }], books: { total: { line: 44 } } };
    const st = ctx.T.saferSide(gm, "total", { side: "under" });
    ok(/Under 50<\/b> · wins 75%/.test(st) && /Total fell 47\.5 → 44: <b>Under 44<\/b> · wins 64%/.test(st) && !/Total fell/.test(ctx.T.saferSide(gm, "total", { side: "over" })) && !/Total fell/.test(ctx.T.saferSide({ ...gm, books: { total: { line: 45 } } }, "total")), "total moved 3+: that side +6 (75%), straight Under after a 3+ drop only with the model's Under (64%)");
    { const { stackPicks, gradeStackPick } = await import("../lib/stack.js"), G = { key: "A @ B", away: "A", home: "B", outdoor: true };
      // home B favored by 8, total 40, model likes B by 3+ (homeMargin 12), wind 16: favorite in wind, big fav + low total Over -6
      const P = stackPicks(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, fix: {} }, -8, 40, -8, 40), ids = P.map((x) => x.id);
      ok(ids.includes("favwind") && P.find((x) => x.id === "favwind").pick === "B -8" && !ids.includes("bigfavlow") && !ids.includes("roaddog6"), "combo picks: wind favorite (luck-checked list only)");
      const Q = stackPicks(G, { homeMargin: -1, total: 44, fix: {} }, -2.5, 40, -3.5, 44), q = Q.map((x) => x.id);
      ok(q.includes("roaddog6") && Q.find((x) => x.id === "roaddog6").pick === "A +8.5" && !q.includes("lowmovefav6"), "combo picks: road dog +6");
      ok(gradeStackPick({ kind: "spread", team: "A", home: "B", line: 8.5 }, 24, 17) === "W" && gradeStackPick({ kind: "total", side: "over", line: 34 }, 20, 13) === "L", "combo picks: grading"); }
    const { totalMove } = await import("../lib/teaser.js"); ok(totalMove(47.5, 44).under && totalMove(44, 47).under === false && totalMove(44, 46.5) === null, "total move: 3+ points from the open"); }
  ok(ctx.T.slotOf({ badge: "SNF", kickoff: "2026-10-11T12:00:00" }) === "Primetime" && ctx.T.slotOf({ kickoff: "2026-10-11T10:00:00" }) === "Morning" && ctx.T.slotOf({ kickoff: "2026-10-11T13:25:00" }) === "Afternoon", "best bets: morning / afternoon / primetime");
  { // TD-based total fade (10/9)
    const { tdTotal, picksFor } = await import("../lib/paper.js");
    const td = { away: [{ pos: "RB", fair: 50 }, { pos: "QB", fair: 30 }], home: [{ pos: "WR", fair: 40 }] }, tt = tdTotal(td);
    ok(Math.abs(tt - (20.976 + 5.727 * (Math.log(2) - Math.log(0.6)))) < 1e-9 && tdTotal({ away: [], home: [] }) === null, "TD total: 10.5 + 5.7 x expected RB/WR/TE TDs per team");
    const p = picksFor({ key: "A @ B", away: "A", home: "B", week: 6 }, { total: { line: 30, over: 0.5, under: 0.5 } }, { tdTotal: 25 }, null).find((x) => x.market === "tdfade");
    ok(p && p.label === "Over 30", "TD total fade: bets the opposite side of the TD-based total"); }
  { // without him (10/8): top 3 TD scorers in games a listed-Out regular missed
    const h = ctx.T.tdTop3({ ...tg, td: [], without: { [tg.away]: [{ out: "A.Kamara", games: 7, top: [{ name: "C.Olave", td: 5 }, { name: "D.Vele", td: 2 }] }], [tg.home]: [{ out: "X.Y", games: 1, top: [] }] } });
    ok(/Without A\.Kamara<\/b> <span class="dim">\(7 games\)<\/span>: C\.Olave 5 · D\.Vele 2/.test(h) && /\(1 game\)<\/span>: no TDs/.test(h), "without him: scorers listed under the team's top 3"); }
  { // kickoff check line in System: failures and moved games are visible
    ok(/failed: ESPN timed out/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: false, error: "ESPN timed out" })) && /moved: CHI @ GB/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: true, espnGames: 15, moved: [{ game: "CHI @ GB", was: "2026-10-11T17:00Z", now: "2026-10-11T20:25Z" }] })) && /OK/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: true, espnGames: 15, moved: [] })), "kickoff check: shows failures, moved games, or all-match");
    const { overlayEspnKickoffs, resetKickCache } = await import("../lib/espnFinals.js"); const R = globalThis.__TEST_REDIS__;
    resetKickCache(); await overlayEspnKickoffs([{ key: "CHI @ GB", final: false, kickoff: new Date(Date.now() + 86400e3).toISOString() }], Date.now(), async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    const kc = JSON.parse(await R.get("kickcheck")); ok(kc && kc.ok === false && /timed out/.test(kc.error), "kickoff check: a failure is recorded"); await R.del("kickcheck"); resetKickCache(); }
  { // signal alerts: teaser leg priced right, TD "No" mark, starting QB's TD chance jumping
    const { alertTeaser, alertsTdNo, alertsQbJump, listAlerts } = await import("../lib/alerts.js"), R = globalThis.__TEST_REDIS__;
    const g = { key: "TB @ DAL", away: "TB", home: "DAL" };
    await alertTeaser(2032, g, { team: "TB", base: 2.5, line: 8.5, price: 0.7, value: true }); await alertTeaser(2032, g, { team: "TB", base: 2.5, line: 8.5, price: 0.7, value: true });
    await alertTeaser(2032, g, { team: "TB", base: 2, line: 8, price: 0.8, value: false });
    await alertsTdNo(2032, g, [{ player: "G.Pickens", team: "DAL", fair: 30, price: 0.42, bid: 0.4 }, { player: "C.Lamb", team: "DAL", fair: 46, price: 0.49, bid: 0.47 }]);
    await alertsQbJump(2032, g, { away: [{ name: "B.Mayfield", pos: "QB", fair: 13 }], home: [{ name: "D.Prescott", pos: "QB", fair: 10 }] }, { away: [{ name: "J.Daniels", pos: "QB", fair: 25 }], home: [{ name: "D.Prescott", pos: "QB", fair: 12 }] });
    const L = await listAlerts(2032), k = (x) => L.filter((a) => a.kind === x);
    ok(k("TEASER").length === 1 && /TB \+8\.5 at 70¢/.test(k("TEASER")[0].title), "alerts: a teaser leg priced right alerts once; one priced too high doesn't");
    ok(k("TD NO").length === 1 && /G\.Pickens/.test(k("TD NO")[0].title), "alerts: a TD 'No' mark alerts (model 10 under the bid), a close one doesn't");
    ok(k("QB TD").length === 1 && /J\.Daniels TD chance now 25%/.test(k("QB TD")[0].title), "alerts: a new starting QB at 20%+ alerts; a 2-point move doesn't");
    for (const kk of await R.keys("*2032*")) await R.del(kk); }
  { // teaser legs: underdog +1.5..+2.5 at +7.5..+8.5 (lib + page)
    const { teaserLeg, recordTeaser, gradeTeasersWeek, teaserSummary, TEASE_MAX_PRICE } = await import("../lib/teaser.js");
    const g = { key: "A @ B", away: "A", home: "B" };
    const l1 = teaserLeg(g, { alts: [{ team: "B", line: 8.5, price: 0.7 }] }, { spread: { homeSpread: 2.5 } });
    ok(l1.team === "B" && l1.base === 2.5 && l1.line === 8.5 && l1.price === 0.7 && l1.value, "teaser: home dog +2.5 -> +8.5, priced under the cap is a value leg");
    const l2 = teaserLeg(g, { spread: { homeSpread: -1.5 }, alts: [{ team: "A", line: 7.5, price: 0.8 }, { team: "B", line: 7.5, price: 0.6 }] }, null);
    ok(l2.team === "A" && l2.line === 7.5 && l2.price === 0.8 && !l2.value, "teaser: road dog from Polymarket's line when no book line; the right side's price, too high is not value");
    ok(teaserLeg(g, {}, { spread: { homeSpread: -3.5 } }) === null && teaserLeg(g, {}, { spread: { homeSpread: 1 } }) === null && teaserLeg(g, {}, null) === null, "teaser: only +1.5 to +2.5 dogs");
    ok(TEASE_MAX_PRICE === 0.73, "teaser: price cap is 73¢");
    const R = globalThis.__TEST_REDIS__;
    await recordTeaser(2031, 3, g, { alts: [{ team: "B", line: 8.5, price: 0.7 }] }, { spread: { homeSpread: 2.5 } }, "t");
    await recordTeaser(2031, 3, { key: "C @ D", away: "C", home: "D" }, { alts: [] }, { spread: { homeSpread: -2 } }, "t");
    await gradeTeasersWeek(2031, 3, [{ key: "A @ B", away: "A", home: "B", homeScore: 20, awayScore: 27 }, { key: "C @ D", away: "C", home: "D", homeScore: 31, awayScore: 21 }]);
    const sm = await teaserSummary(2031);
    ok(sm.all.n === 2 && sm.all.w === 1 && sm.all.priced === 1 && Math.abs(sm.all.roi - (1 / 0.7 - 1)) < 1e-9 && sm.value.n === 1, "teaser: B +8.5 losing by 7 covers (paid 70¢), C +8 losing by 10 doesn't; return only counts priced legs", sm);
    vm.runInContext(`TEASERS = ${JSON.stringify(sm)}; S = { week: 3, games: [], teaserLegs: [${JSON.stringify(l1)}, ${JSON.stringify({ ...l2, price: null, value: false })}] }`, ctx);
    const row = ctx.T.teaserRow(), strip = ctx.T.teaserStrip();
    ok(/Underdog \+1\.5–2\.5 teased to \+7\.5–8\.5/.test(row) && /1–1/.test(row) && /76\.1% of 616/.test(row), "teaser: tracked-angles row shows record and history");
    ok(/Teaser legs · 2 this week · 1 priced right/.test(strip) && /B \+8\.5/.test(strip) && /70¢/.test(strip) && /✓ good price/.test(strip) && /no price yet/.test(strip), "teaser: Game Lines strip lists each leg and its price");
    vm.runInContext(`TEASERS = null; S = { week: 3, games: [] }`, ctx); ok(ctx.T.teaserRow() === "" && ctx.T.teaserStrip() === "", "teaser: nothing shown without data");
    for (const k of await R.keys("teaser:2031:*")) await R.del(k); }
  { // blended touchdown chance and "agrees with the market"
    const b1 = ctx.T.tdBlend({ fair: 40, price: 0.30, bid: 0.28 }), b2 = ctx.T.tdBlend({ fair: 40, price: 0.30, bid: 0.01, thin: true });
    ok(b1 && Math.abs(b1.mid - 29) < 1e-9 && Math.abs(b1.blend - 34.5) < 1e-9 && b2 === null && ctx.T.tdBlend({ fair: 40, price: 0.3, bid: 0.28, stale: true }) === null && ctx.T.tdBlend({ fair: 40, price: null }) === null, "touchdown blend: half the model, half the market mid, only on a real market");
    const g = (gap, pct) => ({ key: "A @ B", away: "A", home: "B", started: false, model: {}, spreadPick: { label: "A +3", gap, pct, side: "away" }, totalPick: { label: "Over 44", gap, pct, side: "over" } });
    const a1 = ctx.T.leanCell(g(0.4, 50.8), "spread"), a2 = ctx.T.leanCell(g(2.2, 50.8), "spread"), a3 = ctx.T.leanCell(g(0.4, 50.8), "total");
    ok(/Agrees with the market/.test(a1) && /Agrees with the market/.test(a3) && /weak lean/.test(a2) && !/Agrees with the market/.test(a2), "lean box: within a point of the line says it agrees with the market; a bigger gap keeps 'no lean'");
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "models" ? box : id === "export-btn" ? { onclick: null } : old(id));
    const px = (fair, scored, ask, bid) => ({ team: "A", player: "P", fair, scored, played: true, ask, bid });
    vm.runInContext(`S = { week: 4, games: [], status: { ok: true, errors: [] }, weekCheck: { games: 16, withLines: 16, modelRun: true, watch: [] }, missFinder: null, winners: null }; MB = { summary: {}, bets: [] }; PAPER = { names: {}, board: {}, week: null }; PICKS = null; EDGES = null; REPLAY = null; RES = [ { game: "A @ B", week: 4, td: [ ${JSON.stringify(px(40, true, 0.30, 0.28))}, ${JSON.stringify(px(20, false, 0.25, 0.23))}, ${JSON.stringify(px(30, true, 0.33, 0.30))} ] } ]`, ctx);
    ctx.T.renderModel(); ok(/50\/50 blend/.test(box.innerHTML), "models tab: the touchdown check scores the 50/50 blend next to the model and the market");
    ctx.document.getElementById = old; }
  { // snap counts not posted yet (played unset): those players are left out of every accuracy number instead of counting as misses
    const { buildCalibration } = await import("../lib/calibration.js"); const { findMisses } = await import("../lib/missfinder.js");
    const many = (played) => ({ td: Array.from({ length: 60 }, (_, i) => ({ fair: 20, scored: i < 3, ...(played === undefined ? {} : { played }) })) });
    const cu = buildCalibration([many(undefined)]), cp = buildCalibration([many(true)]), cf = buildCalibration([many(false)]);
    const bucket = (c) => c.table.find((x) => x.lo === 15);
    ok(bucket(cu).n === 0 && bucket(cu).mult === 1 && bucket(cf).n === 0 && bucket(cp).n === 60 && bucket(cp).mult < 1, "calibration: only players known to have played count (unset and inactive are left out)");
    const hi = (played) => ({ td: Array.from({ length: 14 }, () => ({ fair: 60, scored: false, ...(played === undefined ? {} : { played }) })) });
    ok(!findMisses([hi(undefined)]).some((m) => /High-confidence TD misses/.test(m.pattern)) && findMisses([hi(true)]).some((m) => /High-confidence TD misses/.test(m.pattern)), "miss finder: players with unknown played status are not model misses");
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "models" ? box : id === "export-btn" ? { onclick: null } : old(id));
    vm.runInContext(`S = { week: 4, games: [], status: { ok: true, errors: [] }, weekCheck: { games: 16, withLines: 16, modelRun: true, watch: [] }, missFinder: null, winners: null }; MB = { summary: {}, bets: [] }; PAPER = { names: {}, board: {}, week: null }; PICKS = null; EDGES = null; REPLAY = null; RES = [ { game: "A @ B", week: 4, td: [ { team: "A", player: "P1", fair: 40, scored: true, played: true }, { team: "A", player: "P2", fair: 30, scored: false }, { team: "B", player: "P3", fair: 30, scored: false } ] } ]`, ctx);
    ctx.T.renderModel(); ok(/2 waiting for snap counts/.test(box.innerHTML), "models tab: says how many touchdown players are waiting for snap counts");
    ctx.document.getElementById = old; }
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
    ok(/Spread <b>LA -3<\/b> <span class="dim">\(agrees\)<\/span> · Total <b>Under 43\.5<\/b> <span class="dim">\(agrees\)<\/span>/.test(ctx.T.winnersBox()), "pick list: a toss-up game still shows its spread and total side, marked as agreeing with the market"); }
  { // earlier week: a bet that is final but waiting for touchdown data stays visible; no slate yet must not break Bets; sections keep their state
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "record-mine" ? box : old(id));
    vm.runInContext(`S = { week: 5, games: [] }; MBWEEK = 4; MB = { summary: {}, synced: null, bets: [ { id: "a", week: 4, source: "account", title: "Waiting combo", cost: 10, toWin: 100, result: "pending", waiting: true, legs: [] }, { id: "b", week: 4, source: "account", title: "Lost combo", cost: 5, toWin: 50, result: "L", pl: -5, legs: [] }, { id: "c", week: 4, cost: 8, toWin: 80, result: "pending", waiting: true, legs: [ { kind: "td", player: "Q", game: "A @ B", team: "B", result: "pending", price: 0.5 } ] } ] }`, ctx);
    ctx.T.renderMine(); ok(/Waiting combo/.test(box.innerHTML) && /waiting for TD results/.test(box.innerHTML) && /Lost combo/.test(box.innerHTML) && /BETS[\s\S]*>3</.test(box.innerHTML) && (box.innerHTML.match(/waiting for TD results/g) || []).length === 2, "record tab: an earlier week still shows bets (typed-in and account) that are waiting for touchdown data");
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
    ctx.T.renderLab(); ok(/pays 1\.56x · market chance 64% · model 60%/.test(box.innerHTML) && !/Model's pick on every game/.test(box.innerHTML) && /Your model's parlays/.test(box.innerHTML) && !/Rule:/.test(box.innerHTML) && /H1 ML/.test(box.innerHTML) && /Parlay scoreboard/.test(box.innerHTML), "pick lab: parlays and their scoreboard only, with how each parlay was chosen");
    ok(/THIS SEASON/.test(box.innerHTML) && /2007–25/.test(box.innerHTML) && /MIXED/.test(box.innerHTML) && /4 best legs/.test(box.innerHTML) && !/graded before it is judged/.test(box.innerHTML), "parlay scoreboard: one line per parlay, grouped, season and history columns");
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
    ok((h.match(/class="fold" data-drop="m-/g) || []).length === 9 && !/class="s dim" style="margin:2px 0 6px"/.test(h) && !/break-even/i.test(h), "models tab: nine sections, no explanation lines, no break-even talk");
    ok(/Hit rate by week/.test(h) && /Week 3/.test(h) && /Week 4/.test(h) && /Game-by-game results|id="gbg"/.test(h) && !/Parlay scoreboard/.test(h), "models tab: trends and every-game list present, parlay scoreboard kept out");
    const bw = ctx.T.modelsByWeek(res), bc = ctx.T.modelsByConfidence(res), tc = ctx.T.tdCalibration(res.flatMap((r) => r.td));
    ok(/Moneyline[\s\S]*50%[\s\S]*Spread[\s\S]*Total/.test(bw) && /Week 3/.test(bw), "models tab: hit rate by week");
    ok(/Said 80\+% · 1 picks/.test(bc) && /Said 60–70% · 1 picks/.test(bc) && /100%/.test(bc), "models tab: confidence buckets use the chance the model said");
    ok(/Said 35–50% · 1 players/.test(tc) && /Said 15–25% · 1 players/.test(tc), "models tab: touchdown calibration bands");
    ok(/None yet/.test(ctx.T.modelsByConfidence([])) && /None yet/.test(ctx.T.tdCalibration([])), "models tab: empty data says so");
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
    vm.runInContext(`MBWEEK = null`, ctx); ctx.T.renderMine(); ok(/OPEN BETS/.test(box.innerHTML) && !/Your record · P\/L/.test(box.innerHTML) && !/Live account view/.test(box.innerHTML), "record tab: this week keeps the open-bets box, no repeated record");
    vm.runInContext(`MBWEEK = null`, ctx); ctx.document.getElementById = old; }
  { const base = { player: "B.Bowers", pos: "TE", team: "LV", game: "LV @ KC", fair: 34, two: 8, first: 9, teamRank: 1, price: 0.3, flags: [] };
    const yes = ctx.T.prow({ ...base, returning: "out", returningState: "practicing" }, { started: false }, true), dnp = ctx.T.prow({ ...base, returning: "out", returningState: "not practicing" }, { started: false }, true), no = ctx.T.prow(base, { started: false }, true);
    ok(/RETURNING/.test(yes) && /was out last week/.test(yes) && /34%/.test(yes) && !/RETURNING/.test(no), "returning label: practicing returner is labelled, plain players are not");
    ok(/NOT PRACTICING/.test(dnp) && /treated as out/.test(dnp) && !/↩ RETURNING/.test(dnp), "returning label: a returner who is not practicing is flagged, not treated as playing"); }
  { const w = (m) => ctx.T.totalCard({ ...tg, poly: { total: { line: 38.5, over: 0.5, under: 0.52 } }, model: { total: 37, ...m } }, "x");
    ok(/Tested angle: Under 38\.5 \(wind forecast 14 mph\)/.test(w({ outdoor: true, wind: 14 })) && !/Tested angle: Under/.test(w({ outdoor: true, wind: 8 })) && !/Tested angle: Under/.test(w({ outdoor: false, wind: 20 })) && !/Tested angle: Under/.test(ctx.T.totalCard({ ...tg, final: true, poly: { total: { line: 38.5 } }, model: { total: 37, outdoor: true, wind: 20 } }, "x")), "windy-under note: only for an outdoor game with 12+ mph forecast, not finished")
    ok(!/Tested angle/.test(w({ outdoor: true, wind: 14 }) && ctx.T.totalCard({ ...tg, totalPick: { side: "over", line: 38.5, label: "Over 38.5", pct: 50.5, gap: 4 }, poly: { total: { line: 38.5, over: 0.5, under: 0.52 } }, model: { total: 43, outdoor: true, wind: 14 } }, "x")) && /Tested angle/.test(ctx.T.totalCard({ ...tg, totalPick: { side: "under", line: 38.5, label: "Under 38.5", pct: 50.5, gap: 1.5 }, poly: { total: { line: 38.5, over: 0.5, under: 0.52 } }, model: { total: 37, outdoor: true, wind: 14 } }, "x")), "windy-under note: hidden when the model leans Over, shown when the model agrees (Under)"); }
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
  ok(/84%/.test(box) && /82¢/.test(box) && !/7–3/.test(box) && !/all picks/.test(recs) && /top 4/i.test(recs), "page: picks show chance and price; the season record is on the Results tab");
  ok(/Spread <b>BAL -10\.5<\/b> · Total <b>Under 41\.5<\/b> · TD <b>/.test(box), "page: each game shows labeled spread side, total side and touchdown side");
  ok(/Spreads[\s\S]*6–5 · covered 55%/.test(recs) && /Totals[\s\S]*4–6 · right 40%/.test(recs), "page: separate season records for winners, spreads and totals"); }
console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(bad ? 1 : 0);
