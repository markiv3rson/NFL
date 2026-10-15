// Automated checks for the site (run: npm test). Every check here was a real bug or a number that must never drift:
// odds math, line moves with key numbers, TD math matching the Python model, name matching, the edge tracker, and the
// sentences the page shows. GitHub runs this plus the build on every push (.github/workflows/ci.yml).
import vm from "node:vm";
import { readFileSync } from "node:fs";
import RedisMock from "ioredis-mock";
globalThis.__TEST_REDIS__ = new RedisMock();
const { toProb, toAmerican, ncdf, ninv, isThinMarket, SD_MARGIN, shiftCover } = await import("../lib/odds.js");
const { playedLastGame } = await import("../lib/snaps.js");
const { spreadPick, totalPick, winPctAt, winPctMarket, priceTd, nameMatches, tdRows, rosterPosFor } = await import("../lib/picks.js");
const { twoPlus, firstTdShares, applyCalibration, buildCalibration } = await import("../lib/calibration.js");
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
ok(isThinMarket(0.4, 0.01) && !isThinMarket(0.4, 0.37) && isThinMarket(0.07, 0.01), "thin-market rule");
// ---------- line moves (key numbers)
{ const m = { homeMargin: 3, calHomeCover: 50, mktHomeSpread: -3 }, a = spreadPick(m, -3.5, "A", "H"), c = spreadPick(m, -2.5, "A", "H");
  ok(a.side === "away" && c.side === "home" && near(a.pct, c.pct, 0.5), "spread shift direction", [a.pct, c.pct]); }
ok(0.5 - shiftCover(0.5, -2.5, -3.5) > 2 * (0.5 - shiftCover(0.5, -4.5, -5.5)), "key numbers: crossing 3 moves more than 4.5->5.5");
// 10/14 bug hunt: a NaN / missing line never becomes a pick; no leftover references to removed things
ok(spreadPick({ homeMargin: 3 }, NaN, "A", "H") === null && spreadPick({ homeMargin: NaN }, -3, "A", "H") === null && totalPick({ total: 44 }, NaN) === null && winPctMarket(NaN) === null && winPctAt({ homeMargin: 3, homeWinPct: 61 }, NaN) === 61, "picks: a NaN line gives no pick (not 'A NaN')");
{ const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  ok(/body::before\s*\{[^}]*env\(safe-area-inset-top/.test(src("../public/index.html")), "page: a solid strip sits behind the iPhone status bar (the clock no longer draws over the content)");
  ok(!/of \$200/.test(src("../public/app.js")) && !/↻ Lines/.test(src("../lib/watchdog.js")), "no leftover $200 weekly budget text or removed Lines button reference"); }
ok(shiftCover(0.53, -3, -3) === 0.53, "shift keeps the anchor");
{ const t = totalPick({ total: 44, calUnder: 50, mktTotal: 44 }, 45); ok(t.side === "under" && t.pct > 50, "total shift direction"); }
ok(near(winPctAt({ homeMargin: 5 }, -3), 100 * (1 / (1 + Math.exp(-(-0.0470 + 0.1187 * (3) + 0.0334 * (3) * Math.abs(3) / 10)))), 1e-9), "win % == fair_line.cal_win");
// ---------- TD math (same as td_prob.py)
{ const lam = -Math.log(0.6); ok(near(twoPlus(40), Math.min(0.6, 1.044 * (1 - Math.exp(-lam) * (1 + lam))) * 100, 1e-9), "twoPlus == td_prob.two_plus"); }
{ const sh = firstTdShares([{ fair: 40 }, { fair: 20 }]), l1 = -Math.log(0.6), l2 = -Math.log(0.8), T = l1 + l2 + 0.4; ok(near(sh[0], l1 / T * (1 - Math.exp(-T)) * 100, 1e-9), "firstTdShares == td_prob.first_td"); }
{ const recs = [{ td: [...Array(60)].map((_, i) => ({ fair: 10 + (i % 10), scored: i % 3 === 0 })).concat([...Array(60)].map((_, i) => ({ fair: 38 + (i % 6), scored: i % 5 === 0 }))) }];
  const cal = buildCalibration(recs); let prev = -1, mono = true; for (let f = 1; f <= 90; f += 0.1) { const v = applyCalibration(f, cal); if (v < prev - 1e-9) mono = false; prev = v; } ok(mono, "calibration keeps order"); }
{ const r = priceTd({ fair: 30, price: 0.25, teamRank: 1 }); ok(near(r.ev, 0.2), "TD EV"); }
// ---------- names
ok(!nameMatches("Mike Williams", "Mike Williamson 1+ touchdowns"), "whole-word names");
ok(nameMatches("Travis Etienne Jr.", "Travis Etienne Jr.") && nameMatches("Travis Etienne Jr.", "Travis Etienne") && nameMatches("Amon-Ra St. Brown", "Amon-Ra St. Brown 1+"), "Jr./St. full names");
ok(nameMatches("Bi.Robinson", "Bijan Robinson 1+ touchdowns") && !nameMatches("Bi.Robinson", "Brian Robinson Jr. 1+") && nameMatches("A.J.Brown", "A.J. Brown 1+"), "play-by-play short names");
{ const snaps = { NYG: { a: { name: "Daniel Jones", pos: "QB" } }, ARI: {} };
  const px = { "Daniel Jones 1+ touchdowns": { ask: 0.15, bid: 0.14 }, "Bam Knight 1+ touchdowns": { ask: 0.3, bid: 0.29 }, "Tyrone Tracy Jr. 1+ touchdowns": { ask: 0.27, bid: 0.26 } };
  const r = Object.fromEntries(tdRows("ARI @ NYG", "ARI", "NYG", { away: [{ name: "Z.Knight", pos: "RB", fair: 30 }, { name: "T.Tracy", pos: "RB", fair: 25 }], home: [{ name: "Z.Jones", pos: "WR", fair: 18 }] }, px, {}, rosterPosFor(snaps, "ARI", "NYG")).map((x) => [x.player, x.market]));
  ok(r["Z.Jones"] == null && r["Z.Knight"] === "Bam Knight 1+ touchdowns" && r["T.Tracy"] === "Tyrone Tracy Jr. 1+ touchdowns", "nickname fallback safe", r); }
// ---------- phone setup (home-screen app)
{ const fs = await import("node:fs"); const root = new URL("../public/", import.meta.url);
  const man = JSON.parse(fs.readFileSync(new URL("manifest.webmanifest", root), "utf8")), html = fs.readFileSync(new URL("index.html", root), "utf8"), mw = fs.readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  ok(man.display === "standalone" && man.icons.length >= 2 && man.icons.every((i) => fs.existsSync(new URL("." + i.src, root))), "phone: manifest is standalone and every icon file exists");
  ok(/apple-touch-icon/.test(html) && /apple-mobile-web-app-capable/.test(html) && /viewport-fit=cover/.test(html) && /rel="manifest"/.test(html) && /safe-area-inset-top/.test(html), "phone: home-screen meta tags, full-screen viewport and safe areas");
  ok(["manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png"].every((f) => mw.includes(f)), "phone: icon and manifest are reachable before login");
  ok(/nfl_remember/.test(mw) && /maxAge: YEAR/.test(mw) && /httpOnly: true/.test(mw) && /sameSite: "lax"/.test(mw) && /cross-site/.test(mw), "phone: one sign-in is remembered for a year (hashed cookie), cross-site guard kept"); }
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
  ok(await alertsFromRerun(2026, { key: "A @ B", away: "A", home: "B" }, { homeMargin: 1.2, homeWinPct: 54, inj: {}, fix: {} }, { homeMargin: -1.5, homeWinPct: 47, inj: {}, fix: {} }) === 0, "alerts: model-move alerts were cut 10/13 (the model flipping sides adds nothing)");
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
  vm.runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8") + "\n;globalThis.T={tdPct,plural,sgpChance,moreBox,plainNote,slotOf,parlayPicks,parlayStrip,lineCheck,recLine,bestBets,injTag,weakLeg,kickLine,tdNoGap,trackedRows,renderLines,firstTdPick,firstTdLine,firstTdRecord,tdPlayersWithDefense,tdByPosition,tdByDefense,tdGroupRow,tdGradeMap,tdMark,tdGameLine,earlyNote,leanCell,prow,betRow,changedBox,winnersBox,winnerOf,tile,tdTop3,tdRow,gameCard,totalCard,detailTop,renderMine,gbgHtml,renderLab,renderModel,renderTd,tdBlend,betsSummary,clvSummary,betsAnalysis,keepOpenState,modelsByConfidence,mSec,legFlipped,betSlots,openBySlot,straightPicks,splitNote,sgpBox,glowOf,stampFor,betRow,costNote,middleNote};", ctx);
  const T = ctx.T;
  let g = { away: "DAL", home: "PHI", model: { homeMargin: 4.2, fix: {} }, poly: { spread: { homeSpread: -3.5 } } };
  g = { away: "A", home: "H", model: { total: 44.4, fix: { dome: 2.59, pace: 0.1, div: true } }, poly: { total: { line: 45.5 } } };
  g = { away: "A", home: "H", winPct: 61.2, model: { homeMargin: 3, total: 44, fix: {} }, spreadPick: { label: "H -2.5", pct: 51.1 }, poly: {} };
{ const c = T.leanCell(g, "spread"); ok(/Model: <b class="mod">H by 3\.0<\/b>/.test(c) && /No pick/.test(c) && /No tested edge/.test(c) && !/LEAN/.test(c), "model card: no tested pick -> No pick (the model's own side is a coin flip vs the line, not shown as a lean)");
  { const c2 = T.leanCell({ ...g, combos: [{ kind: "spread", pick: "A +2.5", hit: 54.4, why: "road dog" }] }, "spread"); ok(/PICK: A \+2\.5 · 54%/.test(c2) && !/road dog/.test(c2) && !/LEAN/.test(c2), "model card: below 56% the best tested pick shows as a yellow PICK with no notes"); } }
  const row = T.prow({ player: "O'Neil <b>", pos: "WR", team: "H", game: "A @ H", fair: 20.1, fairIfPlays: 30, injury: "Questionable", price: 0.25, teamRank: 2 }, { started: false }, false);
  ok(/30% if he plays/.test(row) && /O&#39;Neil &lt;b>/.test(row), "Questionable row + names escaped");
  ok(/Push leg/.test(T.betRow({ source: "preloaded", legs: [{ result: "W", kind: "total", side: "under", line: 43 }, { result: "P", kind: "total", side: "over", line: 44 }], result: "P", pushUnconfirmed: true, cost: 5, toWin: 20, pl: null })), "combo push wording");
  vm.runInContext(`S = { games: [{ key: "DAL @ PHI", away: "DAL", home: "PHI", started: false, poly: { spread: { homeSpread: -4 }, total: { line: 45.5 }, ml: { home: 0.66 } },
    history: [{ t: "2026-10-01T10:00:00Z", poly: { spread: { homeSpread: -3 }, total: { line: 45.5 }, ml: { home: 0.60 } } }] }] }`, ctx);
  ok(/spread PHI -3 → -4/.test(T.changedBox()) && /moneyline 60¢ → 66¢/.test(T.changedBox()), "what changed");
  globalThis.__ctx = ctx; }

// ---------- Parlay Lab (paper parlays)
{ // Best bets parlays (10/10): 56%+ straight picks (combos + angles, no teasers), one per game, priced from Polymarket
  const { buildPaper } = await import("../lib/paper.js");
  const { buildCard } = await import("../lib/cardpick.js");
  const gg = (k, home, away, combos) => { const poly = { spread: { homeSpread: -3.5, home: 0.5, away: 0.5 }, total: { line: 44.5, over: 0.5, under: 0.5 }, ml: { home: 0.6, away: 0.4 } }, g0 = { key: k, home, away, started: false, final: false, td: [], angles: [], combos, poly };
    return { ...g0, card: buildCard(g0, combos, poly, null, null) }; };
  const P = buildPaper({ games: [gg("A @ B", "B", "A", [{ pick: "A +3.5", hit: 62 }, { pick: "Over 40.5", hit: 80, teaser: true }]), gg("C @ D", "D", "C", [{ pick: "Under 44.5", hit: 58 }]),
    gg("E @ F", "F", "E", [{ pick: "F -3.5", hit: 52 }]), gg("G @ H", "H", "G", [{ pick: "H -3.5", hit: 70 }])] });
  const b2 = P.find((p) => p.strategy === "best_2"), b3 = P.find((p) => p.strategy === "best_3"), b4 = P.find((p) => p.strategy === "best_4");
  ok(b2 && b2.legs.map((l) => l.label).join(",") === "H -3.5,A +3.5" && b3 && b3.legs.length === 3 && !b4 && !b3.legs.some((l) => /40\.5|F -3\.5/.test(l.label)) && Math.abs(b2.pay - 4) < 1e-9,
    "best-bets parlays: the card's PICK at Polymarket's line, green = win % 3+ above the price, one per game, no teasers, none when too few"); }
{ const { startersOut } = await import("../lib/snaps.js");
  const sn = { "Joe QB": { name: "Joe QB", pos: "QB", weeks: { 1: 1, 2: 1 }, dweeks: { 1: 0, 2: 0 } }, "Al CB": { name: "Al CB", pos: "CB", weeks: { 1: 0, 2: 0 }, dweeks: { 1: 0.9, 2: 0.8 } },
    "Bo CB": { name: "Bo CB", pos: "CB", weeks: { 1: 0 }, dweeks: { 1: 0.3 } }, "Cy S": { name: "Cy S", pos: "S", weeks: { 1: 0, 2: 0 }, dweeks: { 1: 1, 2: 0.95 } } };
  const o = startersOut(sn, [{ name: "Joe QB Jr.", status: "Out", week: 3 }, { name: "Al CB", status: "Doubtful", week: 3 }, { name: "Bo CB", status: "Out", week: 3 }, { name: "Cy S", status: "Questionable", week: 3 }], 3);
  ok(o.qb === 1 && o.db === 1 && o.sk === 0, "starters out: Out/Doubtful 60%+ starters only, by group, names matched across suffixes"); }
{ const S5 = await import("../lib/stack.js");
  const P5 = S5.tablePicks({ key: "CHI @ GB", away: "CHI", home: "GB", outdoor: true, kickoff: "2026-10-11T17:00:00Z" }, { homeMargin: -2, total: 44, wind: 0, temp: 60, fix: {}, xf: { s: { gbm: 3, ens: 3 }, t: { ens: -2 } } }, 1.5, 46.5, null, null, null, 5);
  const sp5 = P5.find((p) => p.kind === "spread"), to5 = P5.find((p) => p.kind === "total");
  ok(sp5 && to5 && !/\b(Over|Under)\b/.test(sp5.why) && !/likes? the (dog|favorite)/.test(to5.why) && P5.every((p) => !/likes the dog \(fade it\)/.test(p.why) || (p.kind === "spread" && p.team === "CHI")) && P5.every((p) => !/likes the favorite \(fade it\)/.test(p.why) || (p.kind === "spread" && p.team === "GB")),
    "chooser reasons: spread reasons skip Over/Under leans, total reasons skip dog/favorite leans, and a lean pointing away from the pick says (fade it)"); }
{ const { lineMovePick } = await import("../lib/stack.js"); const G = { key: "BUF @ LA", away: "BUF", home: "LA", kickoff: new Date(Date.now() + 3600e3).toISOString() };
  const pm = (P, h = 0.5, a = 0.5) => ({ spread: { homeSpread: P, home: h, away: a } }), now = new Date().toISOString(), old = new Date(Date.now() - 30 * 3600e3).toISOString();
  const a = lineMovePick(G, pm(-3.5), pm(-5)), b = lineMovePick(G, pm(-6.5), pm(-5.5)), c = lineMovePick(G, pm(-2.5), pm(-3)), d = lineMovePick(G, pm(-3.5), pm(-4)), e = lineMovePick(G, pm(-1), pm(-4.5));
  const f = lineMovePick(G, pm(-6.5), pm(-7)), h = lineMovePick(G, pm(-2.5), pm(-3.5)), k = lineMovePick(G, pm(-4.5), pm(-6.5)), j = lineMovePick(G, pm(-4.5), pm(-7.5));
  ok(!a && !b && !c && !d && !f && !k && e && e.pick === "LA -1" && e.hit === 63.5 && /crossed 3/.test(e.why) && h && h.pick === "LA -2.5" && h.hit === 63.5 && j && j.pick === "LA -4.5" && j.hit === 63.5 && lineMovePick(G, pm(-8.5), pm(-11.5)).hit === 60.3,
    "line move: only crossing 3 or 7 by 1+ point (63.2%) or a 3+ point move (58.5%); half-point rounding (books 7 vs Polymarket 6.5) and small moves are nothing");
  { const { nextBooksPull, booksFresh } = await import("../lib/books.js"), pt = (d) => new Date(d).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false });
    const ptm = (d) => new Date(d).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit", hour12: false });
    ok(ptm(nextBooksPull("2026-10-14T02:00:00Z")) === "Wed 07:00" && ptm(nextBooksPull("2026-10-14T14:10:00Z")) === "Wed 15:00" && ptm(nextBooksPull("2026-10-14T22:30:00Z")) === "Wed 19:00"
      && ptm(nextBooksPull("2026-10-18T02:00:00Z")) === "Sun 05:00" && ptm(nextBooksPull("2026-10-18T15:05:00Z")) === "Sun 09:30" && ptm(nextBooksPull("2026-10-18T16:30:00Z")) === "Sun 12:00"
      && ptm(nextBooksPull("2026-10-18T19:10:00Z")) === "Sun 16:00" && ptm(nextBooksPull("2026-10-18T23:00:00Z")) === "Mon 07:00",
      "books: next pull follows the owner's times (Mon-Sat 7 AM, 3 PM, 7 PM; Sun 5, 8, 9:30 AM, 12, 4 PM)");
    { const { BOOK_PULLS } = await import("../lib/books.js"), py = readFileSync(new URL("../railway-model-service/scheduler.py", import.meta.url), "utf8");
      const mins = (name) => [...(py.match(new RegExp("^" + name + " = \\[(.*)\\]", "m")) || ["", ""])[1].matchAll(/\((\d+), (\d+)\)/g)].map((m) => +m[1] * 60 + +m[2]);
      ok(JSON.stringify(mins("SUNDAY")) === JSON.stringify(BOOK_PULLS.sun) && JSON.stringify(mins("WEEKDAY")) === JSON.stringify(BOOK_PULLS.wk),
        "books: the site's pull times match the scheduler's SUNDAY / WEEKDAY", { py: [mins("SUNDAY"), mins("WEEKDAY")], site: BOOK_PULLS }); }
    ok(booksFresh("2026-10-14T02:00:00Z", Date.parse("2026-10-14T14:30:00Z")) && !booksFresh("2026-10-14T02:00:00Z", Date.parse("2026-10-14T15:00:00Z")), "books: current until the next pull (+45 min)"); }
  ok(lineMovePick(G, pm(-2.5), pm(-3.5), { booksT: now, polyT: now }) && !lineMovePick(G, pm(-2.5), pm(-3.5), { booksT: old, polyT: now }) && !lineMovePick(G, pm(-2.5), pm(-3.5), { booksT: now, polyT: old }),
    "line move: only when both the sportsbook and Polymarket readings are recent");
  ok(!lineMovePick(G, pm(17.5, 0.505, 0.99), pm(-11.5)) && !lineMovePick(G, pm(-2.5, 0.95, 0.06), pm(-3.5)) && lineMovePick(G, pm(-2.5, 0.53, 0.48), pm(-3.5)),
    "line move: never on a dead one-sided Polymarket book (10/4 BAL +17.5 at 0.99)"); }
{ const { lineMoveTotalPick, gradeStackPick } = await import("../lib/stack.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const pt = (line, o = 0.5, u = 0.5) => ({ total: { line, over: o, under: u } }), bt = (line) => ({ total: { line } });
  const up = lineMoveTotalPick(G, pt(44.5), bt(47.5)), dn = lineMoveTotalPick(G, pt(47.5), bt(44));
  ok(up && up.pick === "Over 44.5" && up.hit === 66.1 && dn && dn.pick === "Under 47.5" && !lineMoveTotalPick(G, pt(44.5), bt(47)) && !lineMoveTotalPick(G, pt(44.5, 0.97, 0.04), bt(48))
    && gradeStackPick({ ...up, home: "LA" }, 24, 21) === "W" && gradeStackPick({ ...dn, home: "LA" }, 30, 20) === "L",
    "line move on totals: books 3+ off Polymarket -> the books' direction at Polymarket's number; under 3 or a dead book -> nothing"); }
{ const { keyNumberPick, gradeStackPick } = await import("../lib/stack.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const sp = (hs, h = 0.5, a = 0.5, alts) => ({ spread: { homeSpread: hs, home: h, away: a }, ...(alts ? { alts } : {}) }), bk = (hs) => ({ spread: { homeSpread: hs } });
  const main = keyNumberPick(G, sp(-3.5, 0.48, 0.53), bk(-3)), alt = keyNumberPick(G, sp(-2.5), bk(-3), [{ team: "BUF", line: 3.5, price: 0.56 }]);
  const homeDog = keyNumberPick(G, sp(2.5), bk(3), [{ team: "LA", line: 3.5, price: 0.55 }]);
  ok(main && main.pick === "BUF +3.5" && main.price === 0.53 && alt && alt.pick === "BUF +3.5" && alt.price === 0.56 && homeDog && homeDog.pick === "LA +3.5"
    && !keyNumberPick(G, sp(-2.5), bk(-3)) && !keyNumberPick(G, sp(-2.5), bk(-3), [{ team: "BUF", line: 3.5, price: 0.95 }])
    && gradeStackPick({ ...main, home: "LA" }, 24, 21) === "W" && gradeStackPick({ ...main, home: "LA" }, 28, 21) === "L",
    "key number: books at exactly 3 -> underdog +3.5 on Polymarket (main or alternate); wins when the favorite wins by exactly 3");
  const k25 = keyNumberPick(G, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.6 }]);
  ok(k25 && k25.pick === "BUF +3.5" && k25.hit === 58.3 && /books at BUF \+2\.5/.test(k25.why) && main.hit === 55.6 && !keyNumberPick(G, sp(-2.5), bk(-2)),
    "key number: books at 2.5 -> underdog +3.5 at 58.3% (books at 3: 55.6%, opening-line rates; books at 2 is not a pick)");
  const k15 = keyNumberPick(G, sp(-1.5), bk(-1.5), [{ team: "BUF", line: 3.5, price: 0.66 }]), k35 = keyNumberPick(G, sp(-3.5), bk(-3.5), [{ team: "BUF", line: 5.5, price: 0.6 }, { team: "LA", line: -2.5, price: 0.58 }]), k35f = keyNumberPick(G, sp(-3.5), bk(-3.5), [{ team: "LA", line: -2.5, price: 0.58 }]);   // books 3.5: the dog at +5.5 (2 points) or the favorite at -2.5 (1 point) -- the higher card % wins
  ok(k15 && k15.pick === "BUF +3.5" && k15.hit === 62.6 && k15.price === 0.66 && k35 && k35.pick === "BUF +5.5" && k35.hit === 56.2 && k35.line === 5.5 && k35.price === 0.6 && /BEAT THE 5/.test(k35.why) && k35f && k35f.pick === "LA -2.5" && k35f.hit === 51.2 && k35f.bought === 1
    && !keyNumberPick(G, sp(-3.5), bk(-3.5), [{ team: "BUF", line: 3.5, price: 0.4 }])
    && gradeStackPick({ ...k35, home: "LA" }, 24, 21) === "W" && gradeStackPick({ ...k35, home: "LA" }, 30, 21) === "L" && gradeStackPick({ ...k15, home: "LA" }, 23, 21) === "W",
    "BEAT THE 3: books 1.5 -> dog +3.5 at 62.6%; books 3.5 -> dog +5.5 (2 points) or favorite -2.5 (1 point), the higher card % wins");
  const k1 = keyNumberPick(G, sp(-1.5), bk(-1), [{ team: "BUF", line: 3.5, price: 0.7 }]);
  ok(k1 && k1.pick === "BUF +3.5" && k1.hit === 60.7 && !keyNumberPick(G, sp(-1.5), bk(-2), [{ team: "BUF", line: 3.5, price: 0.6 }]) && !keyNumberPick(G, sp(-3.5), bk(-4), [{ team: "LA", line: -2.5, price: 0.6 }]) && !keyNumberPick(G, sp(-3.5), bk(-5), [{ team: "LA", line: -2.5, price: 0.6 }]),
    "BEAT THE 3: books 1 -> dog +3.5 at 60.7% (buys 2.5); books 2, 4 and 5 are not picks (10/15: books 4 left the tier list)");
  // 10/14: new tested tiers (day and night rates) and the MIDDLE check
  const { isNightGame, middleCheck, BUY_TIERS } = await import("../lib/stack.js");
  const day = { ...G, kickoff: "2026-10-18T17:00:00Z" }, thu = { ...G, kickoff: "2026-10-16T00:15:00Z" }, snf = { ...G, kickoff: "2026-10-19T00:20:00Z" }, mon = { ...G, kickoff: "2026-10-20T00:15:00Z" };
  ok(!isNightGame(day.kickoff) && isNightGame(thu.kickoff) && isNightGame(snf.kickoff) && isNightGame(mon.kickoff) && !isNightGame(null), "night games: Thursday, Sunday 7 PM ET+, Monday");
  { const kd = keyNumberPick(day, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.6 }]), kt = keyNumberPick(thu, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.6 }]),
      ks = keyNumberPick(snf, sp(-1.5), bk(-1.5), [{ team: "BUF", line: 3.5, price: 0.7 }]);
    ok(kd && kd.hit === 58.3 && !kd.night && kt && kt.hit === 51.1 && kt.night && /night game \(60¢\)$/.test(kt.why) && ks && ks.hit === 71 && ks.n === 31,
      "BEAT THE 3: night games show the NIGHT win rate (books 2.5: 58.3% day, 51.1% night; books 1.5 night 71%)", { kt, ks }); }
  const t45 = keyNumberPick(day, sp(-4.5), bk(-4.5), [{ team: "LA", line: -2.5, price: 0.66 }]), t55 = keyNumberPick(day, sp(-5.5), bk(-5.5), [{ team: "BUF", line: 7.5, price: 0.64 }]), t135 = keyNumberPick(day, sp(-13.5), bk(-13.5), [{ team: "BUF", line: 14.5, price: 0.6 }]);
  const gone = [[-4, "LA", -2.5], [-6, "BUF", 7.5], [-6.5, "BUF", 8.5], [-7.5, "LA", -5.5], [-7, "LA", -5.5], [-5, "LA", -2.5]].map(([b, team, line]) => keyNumberPick(day, sp(b), bk(b), [{ team, line, price: 0.6 }]));
  ok(t45 && t45.pick === "LA -2.5" && t45.hit === 65.4 && t55 && t55.pick === "BUF +7.5" && t55.hit === 58.3 && /BEAT THE 7/.test(t55.why)
    && t135 && t135.pick === "BUF +14.5" && t135.hit === 68 && /BEAT THE 14/.test(t135.why) && gone.every((x) => !x)
    && Object.keys(BUY_TIERS).length === 8 && Object.entries(BUY_TIERS).every(([A, T]) => (T.side === "fav" ? +A - Math.abs(T.line) : Math.abs(T.line) - +A) <= 3.5),
    "BEAT THE 3 side rule (10/15): books 1, 1.5, 2.5, 3, 3.5, 4.5, 5.5, 13.5 only, never more than 3.5 points; books 4, 6, 6.5, 7.5 left the list", { t45, t55 });
  { const { ruleRecords, ruleFlag } = await import("../lib/stack.js"), mk = (g, res, t, o = {}) => ({ id: "keynum|spread", tier: 3, hit: 55.6, week: 6, game: g, result: res, t, ...o });
    const rows = Array.from({ length: 16 }, (_, i) => mk(`G${i}`, i < 4 ? "W" : "L", "2"));   // 4-12 = 25%
    const seen = [mk("G0", "L", "1", { id: "chooser|spread" })];   // chooser picks are not green rules -> ignored
    const green = Array.from({ length: 16 }, (_, i) => mk(`H${i}`, i < 4 ? "W" : "L", "2", { hit: 60 })), r = ruleRecords(green, [mk("H0", "L", "1", { hit: 60 })]);
    ok(ruleFlag(4, 12, 60) === "BELOW" && ruleFlag(9, 7, 60) === "OK" && ruleFlag(1, 5, 60) === "TOO FEW" && Object.keys(ruleRecords(rows.slice(0, 4).concat(seen), seen)).length === 1 && ruleRecords(rows, seen)["BEAT THE 3 · books 3"].say === 55.6
      && r["BEAT THE 3 · books 3"] && r["BEAT THE 3 · books 3"].w + r["BEAT THE 3 · books 3"].l === 16 && r["BEAT THE 3 · books 3"].w === 3 && r["BEAT THE 3 · books 3"].flag === "BELOW",
      "live rule records: each pick once at its first-shown line, flagged BELOW only with 15+ graded and 10+ points under the card", r); }
  { const { mode } = await import("../lib/books.js");
    ok(mode([-1.5, -1.5, -1, -1, -1, 0, 0, 0, 1]) === -1 && mode([4.5, 4.5, 4.5, 5.5, 5.5]) === 4.5 && mode([3, 3, 2.5]) === 3 && mode([-3, -3.5]) === -3 && mode([7]) === 7,
      "books consensus: most common number; a tie goes to the number nearest the middle of all books (CAR @ PHI 0 vs -1)"); }
  { const kp = keyNumberPick(day, sp(-4.5), bk(-4.5), [{ team: "LA", line: -2.5, price: 0.64 }]), kn = keyNumberPick(snf, sp(-4.5), bk(-4.5), [{ team: "LA", line: -2.5, price: 0.64 }]);
    ok(kp && kp.plain === 51.4 && kn && kn.plain === 43.5, "bought-point pick carries how often it wins without the extra points (day 51.4%, night 43.5% at books 4.5)", { kp, kn }); }
  const cheap = middleCheck(day, sp(-2.5, 0.50, 0.50), bk(-3), [{ team: "BUF", line: 3.5, price: 0.56 }]), dear = middleCheck(day, sp(-2.5, 0.54, 0.46), bk(-3), [{ team: "BUF", line: 3.5, price: 0.58 }]);
  ok(cheap && cheap.fav === "LA" && cheap.dog === "BUF" && Math.abs(cheap.cost - 1.06) < 1e-9 && Math.abs(cheap.back - 1.091) < 1e-9 && !dear && middleCheck(thu, sp(-2.5, 0.5, 0.5), bk(-3), [{ team: "BUF", line: 3.5, price: 0.56 }]).exact3 === 0.094
    && !middleCheck(day, sp(-6.5, 0.5, 0.5), bk(-6.5), []), "middle: fav -2.5 + dog +3.5 shown only when the two prices add up to less than the history payback (1 + exact-3 share, night share at night); books 2.5-3.5 only");
  { const { recordMiddle, gradeTrackedWeek, trackedSummary } = await import("../lib/tracked.js"), GG = { key: "BUF @ LA", home: "LA", away: "BUF" };
    await recordMiddle(2096, 6, GG, cheap, "t"); await recordMiddle(2096, 6, GG, { ...cheap, cost: 2 }, "t2");   // saved once
    await gradeTrackedWeek(2096, 6, [{ key: "BUF @ LA", home: "LA", away: "BUF", homeScore: 24, awayScore: 21 }]); const sm = await trackedSummary(2096);
    ok(sm.middle && sm.middle.recorded === 1 && sm.middle.w === 1 && Math.abs(sm.middle.money - (2 - 1.06)) < 1e-9, "middle: saved once, graded (LA by exactly 3 = both sides won)", sm.middle);
    for (const k of await globalThis.__TEST_REDIS__.keys("teaser:2096:*")) await globalThis.__TEST_REDIS__.del(k); } }
{ const { noteFirstSeen, recordStack, skey } = await import("../lib/stack.js"); const { getRedis } = await import("../lib/redis.js"); const G = { home: "DEN", away: "SEA", key: "SEA @ DEN" };
  await noteFirstSeen(2099, 6, G, [{ id: "keynumber|spread", team: "DEN", line: 3.5, kind: "spread" }], "2099-10-14T00:00:00Z");
  await noteFirstSeen(2099, 6, G, [{ id: "keynumber|spread", team: "DEN", line: 2.5, kind: "spread" }], "2099-10-15T00:00:00Z");   // later sighting must not overwrite
  await recordStack(2099, 6, G, [{ id: "keynumber|spread", team: "DEN", line: 2.5, kind: "spread", hit: 58.1 }], "2099-10-16T00:00:00Z");
  const rec = JSON.parse(await getRedis().hget(skey(2099, 6), "SEA @ DEN|keynumber|spread"));
  ok(rec.first && rec.first.line === 3.5 && rec.line === 2.5, "CLV: kickoff record keeps the line first SHOWN during the week (not the kickoff line)", rec); }
{ const { recordShadow } = await import("../pages/api/pinnaclepull.js"); const { trackedSummary, gradeTrackedWeek } = await import("../lib/tracked.js"); const { getRedis } = await import("../lib/redis.js");
  const G = { home: "DEN", away: "SEA", key: "SEA @ DEN", week: 7 }, p = { spread: { homeSpread: 2.5, home: 0.5, away: 0.5 }, total: { line: 40.5, over: 0.5, under: 0.5 } };
  const n = await recordShadow(getRedis(), 2097, G, p, { hs: 3.5, tl: 44 }, { bd: 9000, ad: 1500 }, { bd: 800, ad: 600 }, "t");
  const n2 = await recordShadow(getRedis(), 2097, G, p, { hs: 3.5, tl: 44 }, { bd: 9000, ad: 1500 }, null, "t2");   // second sighting: no new rows
  await gradeTrackedWeek(2097, 7, [{ key: "SEA @ DEN", home: "DEN", away: "SEA", homeScore: 20, awayScore: 24 }]); const s = await trackedSummary(2097);
  ok(n === 3 && n2 === 0 && s.pinlm && s.pinlm.recorded === 2 && s.tilt.recorded === 1,
    "shadow picks: Pinnacle LINE MOVE (crossed 3 -> SEA side; total 3.5 apart -> Over) + order-book tilt 6x -> DEN; saved once, graded, kept out of other records", { n, n2, pinlm: s.pinlm, tilt: s.tilt }); }
{ const { recordFloor, gradeTrackedWeek, trackedSummary, tkey } = await import("../lib/tracked.js"); const { getRedis } = await import("../lib/redis.js"); const G = { home: "ATL", away: "CHI", key: "CHI @ ATL" };
  const n0 = await recordFloor(2098, 6, G, 3.5, { home: { prevPts: 10 }, away: { prevPts: 10 } }, "t"), n1 = await recordFloor(2098, 6, G, 3.5, { home: { prevPts: 17 }, away: { prevPts: 0 } }, "t");
  const leg = JSON.parse(await getRedis().hget(tkey(2098, 6), "CHI @ ATL|floor"));
  await gradeTrackedWeek(2098, 6, [{ key: "CHI @ ATL", home: "ATL", away: "CHI", homeScore: 20, awayScore: 24 }]); const s = await trackedSummary(2098);
  ok(n0 === 0 && n1 === 1 && leg.team === "CHI" && leg.line === -3.5 && leg.shut && leg.road && s.floor && s.floor.w === 1 && s.floor.shut.w === 1,
    "offensive floor paper: one team scored <=3 last week -> that team at the kickoff spread; graded", { leg, floor: s.floor }); }
{ const { clvOf } = await import("../lib/stack.js");
  ok(clvOf({ kind: "spread", line: 2.5, first: { line: 3.5 } }) === 1 && clvOf({ kind: "spread", line: -4, first: { line: -3 } }) === 1 && clvOf({ kind: "spread", line: 4, first: { line: 3 } }) === -1
    && clvOf({ kind: "total", side: "over", line: 46, first: { line: 44.5 } }) === 1.5 && clvOf({ kind: "total", side: "under", line: 44, first: { line: 45 } }) === 1 && clvOf({ kind: "spread", line: 3 }) === null,
    "CLV: points gained from the first number shown to the closing number, by side"); }
{ const { noteFirstSeen, gradeFirstSeenWeek, stackRecords } = await import("../lib/stack.js"); const G = { home: "CLE", away: "BAL", key: "BAL @ CLE" };
  await noteFirstSeen(2096, 6, G, [{ id: "movepred|total", kind: "total", side: "under", line: 42.5, hit: 61.9, pick: "Under 42.5" }], "2096-10-14T00:00:00Z");   // vanishes before kickoff: never in stack:
  await gradeFirstSeenWeek(2096, 6, [{ key: "BAL @ CLE", home: "CLE", away: "BAL", homeScore: 17, awayScore: 20 }]); const rec = await stackRecords(2096);
  ok(rec["movepred|total"] && rec["movepred|total"].w === 1 && rec["movepred|total"].l === 0, "a pick that vanished before kickoff is graded at the line it was first shown (Under 42.5, final 37)", rec); }
{ const { floorDogPick } = await import("../lib/stack.js"); const G = { home: "IND", away: "TEN", key: "TEN @ IND" };
  const a = floorDogPick(G, -6.5, { away: { prevPts: 3 }, home: { prevPts: 27 } }), b = floorDogPick(G, 2.5, { home: { prevPts: 0 }, away: { prevPts: 20 } });
  { const nG = { ...G, kickoff: "2026-10-20T00:15:00Z" }, nb = floorDogPick(nG, -6.5, { away: { prevPts: 3 }, home: { prevPts: 27 } });
    ok(nb && nb.hit === 53.1 && nb.night, "bounce back dog: night game shows the night rate (53.1%)", nb); }
  ok(a && a.pick === "TEN +6.5" && a.hit === 56.9 && b && b.pick === "IND +2.5" && !floorDogPick(G, 6.5, { away: { prevPts: 3 }, home: { prevPts: 27 } })
    && !floorDogPick(G, -6.5, { away: { prevPts: 7 }, home: { prevPts: 27 } }) && !floorDogPick(G, -6.5, { away: { prevPts: 3 }, home: { prevPts: 0 } }) && !floorDogPick(G, -6.5, null),
    "bounce back dog: scored <=3 last game AND underdog now -> that team; favorite / 7 pts / both low -> nothing", [a, b]); }
{ const { bounceBackPick } = await import("../lib/stack.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const a = bounceBackPick(G, -3.5, { away: { prevAts: -24 } }), b = bounceBackPick(G, 2.5, { away: { prevAts: -21 } });
  ok(a && a.pick === "BUF +3.5" && a.hit === 58.8 && b && b.pick === "BUF -2.5" && !bounceBackPick(G, -3.5, { away: { prevAts: -20.5 } })
    && !bounceBackPick(G, -3.5, { home: { prevAts: -30 }, away: { prevAts: 3 } }) && !bounceBackPick(G, -3.5, null) && !bounceBackPick(G, null, { away: { prevAts: -30 } }),
    "bounce back: road team missed the spread by 21+ last game -> road team at the current line; home team / under 21 -> nothing", [a, b]); }
{ const { totalMovePick } = await import("../lib/stack.js"), { predictTotalMove, UP_MOVE } = await import("../lib/upgrade.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const mv = (move) => ({ move, thr20: 0.72, thr10: 0.97, hit20: 56.8, n20: 507, hit10: 61.9, n10: 252 });
  const a = totalMovePick(G, mv(1.2), 47.5, 47.5), b = totalMovePick(G, mv(-0.8), 47.5, 47.5), c = totalMovePick(G, mv(0.5), 47.5, 47.5), d = totalMovePick(G, mv(1.2), 48.5, 47.5);
  ok(a.length === 1 && a[0].pick === "Over 47.5" && a[0].hit === 61.9 && b.length === 1 && b[0].pick === "Under 47.5" && b[0].hit === 56.8 && !c.length && !d.length
    && !totalMovePick(G, null, 47.5, 47.5).length && !totalMovePick(G, mv(1.2), 47.5, null).length, "total move pick: strong/weak/moved/none", [a, b, c, d]);
  const p = predictTotalMove(Object.fromEntries(UP_MOVE.feat.map((f, i) => [f, UP_MOVE.mean[i]])));
  ok(Math.abs(p.move - UP_MOVE.b0) < 0.01 && p.thr20 === UP_MOVE.thr20, "total move model: average game predicts the intercept", p); }
{ const { injuryPick } = await import("../lib/stack.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const inj = (o) => ({ qb: 0, sk: 0, ol: 0, db: 0, f7: 0, ...o }), sit = (h, a) => ({ home: { inj: inj(h) }, away: { inj: inj(a) } });
  const a = injuryPick(G, -3.5, -3.5, sit({ qb: 1 }, {})), b = injuryPick(G, -3.5, -3.5, sit({}, { db: 2 })), c = injuryPick(G, -2.5, -3.5, sit({ ol: 2 }, {}));
  ok(a && a.pick === "BUF +3.5" && a.hit === 56.5 && b && b.pick === "LA -3.5" && !c && !injuryPick(G, -3.5, -3.5, sit({ qb: 1 }, { qb: 1 })) && !injuryPick(G, -3.5, -3.5, sit({ db: 1 }, {}))
    && !injuryPick(G, -3.5, null, sit({ qb: 1 }, {})) && injuryPick(G, -4, -3.5, sit({ qb: 1 }, {})) && !injuryPick(G, -4.5, -3.5, sit({}, { qb: 1 })),
    "injury pick: one team has its QB / 2+ DBs / 2+ OL out -> the other team at the current line, only while the line hasn't moved 1+ toward it; both hurt or one DB -> nothing"); }
{ const { parseBooks } = await import("../lib/books.js");
  const ev = [{ away_team: "Buffalo Bills", home_team: "Los Angeles Rams", bookmakers: [
    { key: "draftkings", markets: [{ key: "spreads", outcomes: [{ name: "Los Angeles Rams", point: -3.5, price: -110 }, { name: "Buffalo Bills", point: 3.5, price: -110 }] }, { key: "totals", outcomes: [{ name: "Over", point: 54.5, price: -110 }, { name: "Under", point: 54.5, price: -110 }] }] },
    { key: "fanduel", markets: [{ key: "spreads", outcomes: [{ name: "Los Angeles Rams", point: -3, price: -120 }, { name: "Buffalo Bills", point: 3, price: 100 }] }] }] }];
  const b = parseBooks(ev)["BUF @ LA"]; ok(b && b.byBook.draftkings.hs === -3.5 && b.byBook.draftkings.tl === 54.5 && b.byBook.fanduel.hs === -3 && b.spread && b.spread.n === 1,
    "books: each sportsbook's own line is kept on every pull (consensus unchanged)"); }
{ const { parsePinnacle } = await import("../lib/pinnacle.js");   // shapes as pasted from Pinnacle's guest feed 10/13
  const mu = [{ id: 1637432964, startTime: "2026-10-13T00:15:00Z", participants: [{ alignment: "home", name: "Los Angeles Rams" }, { alignment: "away", name: "Buffalo Bills" }] },
    { id: 1638113662, parentId: 1637432964, special: { category: "Player Props" }, participants: [{ alignment: "neutral", name: "Over" }],
      parent: { id: 1637497657, participants: [{ alignment: "home", name: "Denver Broncos" }, { alignment: "away", name: "Seattle Seahawks" }] } }];
  const mk = [{ matchupId: 1637432964, period: 0, isAlternate: false, status: "open", type: "spread", prices: [{ designation: "home", points: -3.5, price: 103 }, { designation: "away", points: 3.5, price: -113 }] },
    { matchupId: 1637432964, period: 0, isAlternate: true, status: "open", type: "spread", prices: [{ designation: "home", points: -1, price: -166 }, { designation: "away", points: 1, price: 144 }] },
    { matchupId: 1637432964, period: 1, isAlternate: false, status: "open", type: "spread", prices: [{ designation: "home", points: -1.5, price: -115 }, { designation: "away", points: 1.5, price: 102 }] },
    { matchupId: 1637432964, period: 0, isAlternate: false, status: "open", type: "total", prices: [{ designation: "over", points: 55.5, price: 100 }, { designation: "under", points: 55.5, price: -113 }] },
    { matchupId: 1637497657, period: 0, isAlternate: false, status: "open", type: "spread", prices: [{ designation: "home", points: 3, price: -112 }, { designation: "away", points: -3, price: -101 }] },
    { matchupId: 1638113662, period: 0, key: "s;0;ou", type: "total", prices: [{ participantId: 1, points: 0.5, price: -135 }] }];
  const r = parsePinnacle(mu, mk), b = r["BUF @ LA"] || {}, s = r["SEA @ DEN"] || {};
  ok(b.hs === -3.5 && b.hp === 103 && b.ap === -113 && b.tl === 55.5 && s.hs === 3 && s.tl == null && Object.keys(r).length === 2 && Object.keys(parsePinnacle(null, null)).length === 0,
    "Pinnacle: full-game main spread + total per game (alt lines, halves and player props skipped)"); }
{ const { tdCodeName } = await import("../lib/mybets.js"); const N = ["D'Andre Swift", "Cam Skattebo", "Jacory Croskey-Merritt", "Caleb Williams", "Darnell Mooney", "Dan Moore"];
  ok(tdCodeName("dswi", N) === "D'Andre Swift" && tdCodeName("camska", N) === "Cam Skattebo" && tdCodeName("jacomer", N) === "Jacory Croskey-Merritt" && tdCodeName("dmoo", N) === null && tdCodeName("darmoo", N) === "Darnell Mooney",
    "bets: Polymarket TD codes map to names (1-letter first names too); a tie keeps the code"); }
{ const { buildPaper, gradePaper } = await import("../lib/paper.js");
  const game = (k, hs, ml, win, extra = {}) => ({ key: k, away: k.split(" @ ")[0], home: k.split(" @ ")[1], started: false, final: false, poly: { spread: { homeSpread: hs }, ml: { home: ml, away: 1 - ml } }, winPct: win, td: [], ...extra });
  const data = { games: [game("A @ B", -10.5, 0.86, 86), game("C @ D", -12, 0.9, 90), game("E @ F", -3, 0.6, 60), game("G @ H", -7, 0.8, 79),
      game("I @ J", -1, 0.5, 50, { td: [{ player: "X.Back", team: "J", price: 0.30, bid: 0.29, fair: 36, market: "X Back 1+" }, { player: "Y.Thin", team: "J", price: 0.30, bid: 0.01, thin: true, fair: 50 }] }),
      game("K @ L", -2, 0.55, 55, { td: [{ player: "Z.Wr", team: "L", price: 0.20, bid: 0.19, fair: 25 }] }), game("M @ N", 1, 0.45, 45, { td: [{ player: "Q.Te", team: "M", price: 0.10, bid: 0.09, fair: 12 }] })] };
  const P = buildPaper(data), by = (k) => P.filter((p) => p.strategy === k);
  ok(by("home_fav_95_single").length === 2 && by("home_fav_95_2").length === 1 && by("home_fav_95_3").length === 0, "home favorites 9.5+: singles + 2-leg, no 3-leg with only two qualifying", P.map((p) => p.strategy));
  ok(by("top3_home_75").length === 1 && by("top3_home_75")[0].legs.map((l) => l.team).join() === "D,B,H", "top-3 home favorites 75%+ in order");
  ok(by("td_edge_3").length === 1 && !by("td_edge_3")[0].legs.some((l) => l.player === "Y.Thin"), "TD edge parlay uses real markets only");
  { const td = (player, team, fair, extra = {}) => ({ player, team, price: fair / 100 - 0.05, bid: fair / 100 - 0.06, fair, market: player + " 1+", ...extra });
    const d2 = { games: [game("A @ B", -3, 0.6, 60, { td: [td("Top.One", "A", 70), td("Top.Two", "A", 66)] }), game("C @ D", -3, 0.6, 60, { td: [td("Sit.Q", "C", 80, { injury: "Questionable" }), td("Real.Two", "D", 55)] }),
      game("E @ F", -3, 0.6, 60, { td: [td("Thin.X", "E", 90, { thin: true, bid: 0.01 }), td("Real.Three", "F", 40)] }), game("G @ H", -3, 0.6, 60, { td: [td("Late.Four", "G", 30)] })] };
    const Q = buildPaper(d2), l2 = Q.filter((p) => p.strategy === "td_likely_2"), l3 = Q.filter((p) => p.strategy === "td_likely_3");
    ok(l2.length === 1 && l2[0].legs.map((l) => l.player).join() === "Thin.X,Top.One" && l2[0].legs[0].thin === true, "likely-2: best player, one per game, injury-listed player skipped, thin markets allowed and marked", l2[0] && l2[0].legs.map((l) => l.player));
    ok(l3.length === 1 && l3[0].legs.map((l) => l.player).join() === "Thin.X,Top.One,Real.Two" && Math.abs(l3[0].prob - 0.9 * 0.7 * 0.55) < 1e-9, "likely-3: thin market allowed, chance = legs multiplied", l3[0] && l3[0].legs.map((l) => l.player)); }
  ok(Math.abs(by("home_fav_95_2")[0].pay - 1 / (0.9 * 0.86)) < 1e-9, "payout = legs multiplied");
  await setJSON("paper:2026:9", { parlays: [{ strategy: "x", legs: [{ game: "A @ B", kind: "ml", team: "B", price: 0.8 }, { game: "C @ D", kind: "ml", team: "D", price: 0.5 }] },
    { strategy: "y", legs: [{ game: "A @ B", kind: "ml", team: "B", price: 0.8 }, { game: "I @ J", kind: "td", team: "J", player: "X.Back", price: 0.3 }] }] });
  await gradePaper(2026, 9, [{ key: "A @ B", homeScore: 24, awayScore: 20 }, { key: "C @ D", homeScore: 17, awayScore: 17 }, { key: "I @ J", homeScore: 10, awayScore: 3 }],
    async () => Object.assign(["X.Back"], { teams: { "X.Back": ["J"] } }));
  const { getJSON } = await import("../lib/redis.js"); const g = await getJSON("paper:2026:9");
  ok(g.parlays[0].result === "W" && Math.abs(g.parlays[0].ret - (1 / 0.8 - 1)) < 1e-9, "pushed leg drops out, parlay pays the rest");
  ok(g.parlays[1].result === "W" && Math.abs(g.parlays[1].ret - (1 / (0.8 * 0.3) - 1)) < 1e-9, "TD leg graded from scorers"); }
// ---------- Most likely winners
{ const ctx = globalThis.__ctx, { winnerFor, recordWinner, gradeWinnersWeek, winnersSummary } = await import("../lib/paper.js");
  const home = winnerFor({ key: "TEN @ BAL", away: "TEN", home: "BAL" }, { spread: { homeSpread: -10.5 } }), road = winnerFor({ key: "KC @ LV", away: "KC", home: "LV" }, { spread: { homeSpread: 7 } });
  ok(home.team === "BAL" && home.where === "home" && Math.abs(home.p - (1 / (1 + Math.exp(-(-0.0470 + 0.1187 * (10.5) + 0.0334 * (10.5) * Math.abs(10.5) / 10))))) < 1e-9, "home favorite -10.5: BAL, chance from the calibrated formula", home);
  ok(road.team === "KC" && road.where === "away" && Math.abs(road.p - (1 - (1 / (1 + Math.exp(-(-0.0470 + 0.1187 * (-7) + 0.0334 * (-7) * Math.abs(-7) / 10)))))) < 1e-9 && road.p > 0.7, "road favorite (home +7): KC", road);
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
  vm.runInContext(`S = { games: [] }`, ctx);
  const tg = { key: "PIT @ CLE", away: "PIT", home: "CLE", kickoff: "2026-10-02T00:15:00Z", started: false, final: false, winPct: 40, badge: "TNF", td: [] };
  const tl = ctx.T.tile(tg);
  ok(tl.indexOf(">PIT<") < tl.indexOf(">CLE<") && /<span class="mkt">60<\/span><span class="dim"> · <\/span><span class="dim">40<\/span>/.test(tl) && /TNF/.test(tl) && !/GAP/.test(tl), "tile: away name left, home name right, away 60 · home 40, TNF chip, no price-gap chip", tl);
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
  { // Game-by-game results: newest week by default, chips per week, All shows everything
    vm.runInContext(`GBG_RES = [ { game: "A @ B", week: 3, awayScore: 1, homeScore: 2, gradedAt: "1" }, { game: "C @ D", week: 3, awayScore: 3, homeScore: 4, gradedAt: "2" }, { game: "PIT @ CLE", week: 4, awayScore: 24, homeScore: 27, gradedAt: "3", spread: { label: "CLE +2.5", result: "W" } } ]; GBGWEEK = null`, ctx);
    const a = ctx.T.gbgHtml(); ok(/PIT @ CLE/.test(a) && !/A @ B/.test(a) && /Week 4 \(1\)/.test(a) && /Week 3 \(2\)/.test(a), "game-by-game: opens on the newest week with counts");
    vm.runInContext(`GBGWEEK = "all"`, ctx); const b = ctx.T.gbgHtml(); ok(/PIT @ CLE/.test(b) && /A @ B/.test(b) && /C @ D/.test(b), "game-by-game: All shows every week");
    vm.runInContext(`GBGWEEK = null; GBG_RES = []`, ctx); ok(ctx.T.gbgHtml() === "", "game-by-game: empty when nothing is graded"); }
  { // model_best_4: the 4 most likely legs, one per game, mixing winners and scorers, real combined chance kept
    const { buildPaper } = await import("../lib/paper.js");
    const gm = (key, home, win, td) => ({ key, home, away: "X", started: false, final: false, winPct: win, poly: { spread: { homeSpread: -3 }, ml: { home: 0.8 } }, td: td ? [{ player: td.n, team: home, market: "m", price: 0.5, bid: 0.48, fair: td.p }] : [] });
    const P = buildPaper({ games: [gm("A1 @ H1", "H1", 90, { n: "P1", p: 40 }), gm("A2 @ H2", "H2", 80, { n: "P2", p: 70 }), gm("A3 @ H3", "H3", 78, null), gm("A4 @ H4", "H4", 76, null), gm("A5 @ H5", "H5", 60, { n: "P5", p: 30 })] });
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
  { // same-game parlays (10/14): best = strong legs that don't work against each other; your style = spread + total + a TD each team; saved, graded, no bell
    const { sameGameParlays: sgp0, recordSgp } = await import("../lib/sgp.js"), { buildCard: bc0 } = await import("../lib/cardpick.js");
    const sameGameParlays = (gm) => sgp0(gm.started || gm.final ? gm : { ...gm, card: bc0(gm, gm.combos, gm.poly, null, null) });   // 10/15: legs come from the card's PICK at Polymarket's own line
    const { gradePaper, paperSummary } = await import("../lib/paper.js"); const { listAlerts } = await import("../lib/alerts.js"); const { setJSON } = await import("../lib/redis.js"); const R = globalThis.__TEST_REDIS__;
    const g = { key: "CHI @ ATL", away: "CHI", home: "ATL", started: false, final: false, poly: { spread: { homeSpread: 2.5, home: 0.47, away: 0.54 }, total: { line: 49.5, over: 0.5, under: 0.5 } },
      combos: [{ pick: "ATL +2.5", hit: 58.1, line: 2.5, why: "BOUNCE BACK: x" }, { pick: "CHI -2.5", hit: 57, line: -2.5, why: "BOUNCE BACK: y" }, { pick: "Under 49.5", hit: 52.1, line: 49.5, why: "z" }],
      td: [{ player: "Bi.Robinson", team: "ATL", fair: 62, price: null }, { player: "D.Swift", team: "CHI", fair: 49, price: 0.45 }, { player: "Hurt Guy", team: "CHI", fair: 70, injury: "Questionable" }] };
    const x = sameGameParlays(g);
    ok(x.best && x.best.legs.map((l) => l.label).join() === "Bi.Robinson TD,ATL +2.5" && Math.abs(x.best.prob - 0.429) < 0.002, "same-game: best = Bijan TD + ATL +2.5 (they help each other: 62% x 58.1% x 1.19)");
    ok(x.style && x.style.legs.map((l) => l.label).join() === "ATL +2.5,Under 49.5,D.Swift TD,Bi.Robinson TD" && x.style.pay == null, "same-game: your style = spread + total + top TD each team (a Questionable player skipped; unpriced TD -> no payout shown)");
    const y = sameGameParlays({ ...g, combos: [{ pick: "Under 49.5", hit: 62, line: 49.5, why: "TOTAL MOVE: t" }], td: [{ player: "Bi.Robinson", team: "ATL", fair: 64 }] });
    ok(y.best && y.best.strategy === "sgp_best" && y.best.legs.map((l) => l.label).join() === "Bi.Robinson TD,Under 49.5" && Math.abs(y.best.prob - 0.64 * 0.62 * 0.77) < 0.002, "same-game: a TD with the Under is kept (owner: test everything); the chance counts the 0.77 link");
    const z = sameGameParlays({ ...g, poly: { ...g.poly, spread: { homeSpread: 2.5, home: 0.5, away: 0.5 } }, combos: [{ pick: "ATL +2.5", hit: 51, line: 2.5, why: "x" }, { pick: "Under 49.5", hit: 52, line: 49.5, why: "y" }], td: [{ player: "Bi.Robinson", team: "ATL", fair: 48 }] });
    ok(z.best && z.best.strategy === "sgp_best_fill" && z.filled && z.best.legs.map((l) => l.label).join() === "Bi.Robinson TD,ATL +2.5", "same-game: no strong legs -> 2 legs filled (no moneyline here: a TD, then the same team's spread that goes with it), its own record");
    { // 10/14 fix: the filler never adds a leg that works against one already in (DEN +3.5 + SEA to win = SEA by 1-3 only)
      const d = sameGameParlays({ key: "SEA @ DEN", away: "SEA", home: "DEN", started: false, final: false, poly: { spread: { homeSpread: 2.5, home: 0.53, away: 0.47 }, ml: { home: 0.43, away: 0.5725 }, total: { line: 40.5, over: 0.5, under: 0.5 } },
        combos: [{ pick: "DEN +2.5", hit: 59.6, line: 2.5, why: "BOUNCE BACK: x" }], td: [{ player: "J.Smith-Njigba", team: "SEA", fair: 45 }, { player: "J.Dobbins", team: "DEN", fair: 38 }] });
      const e2 = sameGameParlays({ key: "BAL @ CLE", away: "BAL", home: "CLE", started: false, final: false, poly: { spread: { homeSpread: 4.5, home: 0.5, away: 0.5 }, ml: { home: 0.3, away: 0.72 }, total: { line: 44.5, over: 0.5, under: 0.5 } },
        combos: [{ pick: "BAL -4.5", hit: 65.6, line: -4.5, why: "BOUNCE BACK: x" }], td: [{ player: "D.Henry", team: "BAL", fair: 55 }] });
      ok(e2.best && e2.best.legs.map((l) => l.label).join() === "BAL -4.5,D.Henry TD", "same-game: no second bet on the same game's result (BAL -4.5 + BAL ML adds nothing)", e2.best && e2.best.legs.map((l) => l.label));
      ok(d.best && d.best.legs.map((l) => l.label).join() === "DEN +2.5,J.Dobbins TD" && !d.best.legs.some((l) => l.label === "SEA ML"), "same-game: DEN +2.5 is filled with DEN's own top TD, never SEA to win", d.best && d.best.legs.map((l) => l.label));
      { const G2 = { key: "NO @ NYG", home: "NYG", away: "NO", poly: { spread: { homeSpread: 1.5, home: 0.5, away: 0.5 }, total: { line: 46.5, over: 0.5, under: 0.5 } } };
        ok(ctx.T.plainNote({ p: 0.656, plain: 51.4 }) === '<div class="s" style="margin-top:4px">Without the extra points it wins about 51% · with them 66%.</div>' && ctx.T.plainNote({ p: 0.52, plain: 51 }) === "" && ctx.T.plainNote({ p: 0.6 }) === "", "card: says how often the pick wins without the extra points (only when the points add 2+)");
  { ok(ctx.T.tdPct(54.6) === 54 && ctx.T.tdPct(55) === 55 && ctx.T.tdPct(54.4) === 54 && ctx.T.tdPct(61.1) === 61 && ctx.T.plural(1, "pick") === "1 pick" && ctx.T.plural(0, "pick") === "0 picks" && ctx.T.plural(2, "player") === "2 players" && /about 7 in 10/.test(ctx.T.sgpChance({ prob: 0.67 })) && /about 5 in 10/.test(ctx.T.sgpChance({ prob: 0.48 })) && /about 4 in 10/.test(ctx.T.sgpChance({ prob: 0.4 })) && /about 1 in 4/.test(ctx.T.sgpChance({ prob: 0.26 })) && /about 1 in 33/.test(ctx.T.sgpChance({ prob: 0.03 })) && !/1 in 1\b/.test(ctx.T.sgpChance({ prob: 0.6 })),
      "wording + TD %: 54.6% shows 54 (not 55) because it is not a 55%+ pick; \"1 pick\" not \"1 picks\"; a parlay of 30% or more reads \"about 7 in 10\", never \"about 1 in 1\""); }
        ok(/Costs 63¢ but wins 59\.9%/.test(ctx.T.costNote(G2, { pick: "NYG +3.5", p: 0.599, price: 0.63 })) && ctx.T.costNote(G2, { pick: "NYG +3.5", p: 0.599, price: 0.59 }) === ""
          && /Costs 52¢/.test(ctx.T.costNote(G2, { pick: "NYG +1.5", p: 0.51, price: null, poly: null }) || "") === false && ctx.T.costNote(G2, { pick: "Under 46.5", p: 0.574 }) === "",
          "card: warns only when the price is above the win rate (bought line's own price, or the main line's)");
        const mn = ctx.T.middleNote({ ...G2, middle: { fav: "NO", dog: "NYG", favPrice: 0.5, dogPrice: 0.56, cost: 1.06, back: 1.093, exact3: 0.093 } });
        ok(/MIDDLE:<\/b> NO -2\.5 \(50¢\) \+ NYG \+3\.5 \(56¢\)/.test(mn) && /Costs 106¢, pays back 109¢/.test(mn) && ctx.T.middleNote(G2) === "", "card: middle note shows both prices, cost and average payback"); }
      const { comboChance } = await import("../lib/combo.js");
      const mid = comboChance([{ game: "S", kind: "spread", team: "DEN", prob: 0.596 }, { game: "S", kind: "ml", team: "SEA", prob: 0.57 }]),
        same = comboChance([{ game: "S", kind: "spread", team: "SEA", prob: 0.45 }, { game: "S", kind: "ml", team: "SEA", prob: 0.57 }]);
      ok(Math.abs(mid - 0.166) < 0.001 && Math.abs(same - 0.45) < 1e-9, "same-game chance: opposite-team spread + moneyline only in the window between them (17%, not 34%); same team = the less likely leg", { mid, same }); }
    ok(sameGameParlays({ ...g, started: true }) === null, "same-game: none once the game has started");
    const data = { season: 2099, week: 6, games: [{ ...g, sgp: x }, { key: "OLD @ GAME", started: true, sgp: x }] };
    ok(await recordSgp(data, setJSON) === 1, "same-game: saved for games not yet started only");
    await gradePaper(2099, 6, [{ key: "CHI @ ATL", homeScore: 24, awayScore: 21 }], async () => ["Bi.Robinson"]);
    const sm = await paperSummary(2099, 6), b = sm.week.parlays.find((p) => p.strategy === "sgp_best"), st = sm.week.parlays.find((p) => p.strategy === "sgp_style");
    ok(b.result === "W" && b.ret === null && st.result === "L" && sm.board.sgp_best.hits === 1 && sm.board.sgp_best.roi === null && sm.board.sgp_style.graded === 1, "same-game: graded (ATL +3.5 and Bijan hit; your style lost on the Under/Swift), unpriced legs -> win/loss only");
    ok(!(await listAlerts(2099)).some((a) => /Same game · (best \(strong|your style)/.test(a.title || "")), "same-game: no bell alert");
    for (const k of await R.keys("paper:2099:*")) await R.del(k); }
  { // 4-leg parlays (10/14 research): 4 biggest favorites skip a game where a green pick backs the dog; green+3 favs; 3 favs + top TD; linked same-game 4
    const { fourLegParlays, sameGameParlays } = await import("../lib/sgp.js");
    const { buildCard: bcG } = await import("../lib/cardpick.js");
    const G = (h, a, ph, extra = {}) => { const g0 = { key: `${a} @ ${h}`, away: a, home: h, started: false, final: false, poly: { ml: { home: ph, away: 1 - ph }, spread: { homeSpread: -7.5, home: 0.5, away: 0.5 }, total: { line: 44.5, over: .5, under: .5 } }, combos: [], td: [], ...extra };
      return { ...g0, card: bcG(g0, g0.combos, g0.poly, null, null) }; };
    const gs = [G("KC", "LV", .85), G("BUF", "NYJ", .8), G("DET", "CHI", .75), G("SF", "ARI", .7, { combos: [{ pick: "ARI +7.5", hit: 57.1, line: 7.5, why: "BOUNCE BACK DOG: x" }] }), G("PHI", "NYG", .65, { td: [{ player: "S.Barkley", team: "PHI", fair: 62 }] }), G("BAL", "CLE", .6)];
    const F = fourLegParlays(gs), by = Object.fromEntries(F.map((f) => [f.strategy, f]));
    ok(by.leg4_fav && by.leg4_fav.legs.map((l) => l.label).join() === "KC ML,BUF ML,DET ML,PHI ML" && Math.abs(by.leg4_fav.prob - .85 * .8 * .75 * .65) < .002 && by.leg4_fav.hist === 42.5 && by.leg4_fav.strong === false, "4-leg: 4 biggest favorites, skipping SF (our green pick backs ARI); PHI at 65% -> not a strong week");
    ok(by.leg4_green_fav && by.leg4_green_fav.legs[0].label === "ARI +7.5" && by.leg4_green_fav.legs.slice(1).map((l) => l.label).join() === "KC ML,BUF ML,DET ML", "4-leg: best green pick + 3 biggest favorites in other games");
    ok(by.leg4_fav_td && by.leg4_fav_td.legs[3].label === "S.Barkley TD", "4-leg: 3 favorites + the top TD scorer from another game");
    const thu = fourLegParlays([G("KC", "LV", .85), G("BUF", "NYJ", .8), G("DET", "CHI", .75), G("SF", "ARI", .7), G("SEA", "DEN", .68, { kickoff: "2026-10-16T00:15:00Z" })]).find((f) => f.strategy === "leg4_fav");
    ok(thu && thu.legs.map((l) => l.label).join() === "KC ML,BUF ML,DET ML,SEA ML" && thu.legs[3].thu && Math.abs(thu.legs[3].prob - .72) < 1e-9, "4-leg: a Thursday favorite counts 4 points stronger (SEA 68% -> 72% passes SF 70%)");
    const one = sameGameParlays({ ...G("PHI", "NYG", .7), td: [{ player: "S.Barkley", team: "PHI", fair: 62 }, { player: "A.Brown", team: "PHI", fair: 40 }, { player: "N.Out", team: "PHI", fair: 70, injury: "Out" }] });
    ok(one.linked && one.linked.legs.map((l) => l.label).join() === "PHI ML,Over 44.5,S.Barkley TD,A.Brown TD", "linked 4: favorite wins + Over + its top 2 scorers (Out player skipped)"); }
  { // 10/14 risk fix: capped history lists keep the week's first readings (opening lines) and the newest
    const { pushCapped } = await import("../lib/redis.js"); const R = globalThis.__TEST_REDIS__; await R.del("cap:test");
    for (let i = 0; i < 30; i++) await pushCapped(R, "cap:test", String(i), 20, 5);
    const L = await R.lrange("cap:test", 0, -1);
    ok(L.length === 20 && L.slice(0, 5).join() === "0,1,2,3,4" && L[L.length - 1] === "29" && L[5] === "15", "capped list: first 5 readings kept, newest 15 kept, the middle trimmed");
    await R.del("cap:test"); }
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
    const stt = await getStatus(2026, 4, {}, null); ok(stt.errors.length === 1 && stt.errors[0].where === "new" && stt.ok === false, "status: only errors from the last 48 hours are listed"); await R.del("errors");
    await R.lpush("errors", JSON.stringify({ t: new Date(now - 5 * 3600e3).toISOString(), where: "pinnacle", msg: "403" })); await R.lpush("errors", JSON.stringify({ t: new Date(now - 3600e3).toISOString(), where: "books", msg: "z" }));
    const { pinnacleOk } = await import("../lib/pinnacle.js"); await pinnacleOk(R);
    const st2 = await getStatus(2026, 4, {}, null); ok(st2.errors.length === 1 && st2.errors[0].where === "books", "status: an error is hidden once the same job worked again after it (Pinnacle)", st2.errors);
    await R.del("errors"); await R.del("ok:pinnacle"); }
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
  { // old combo legs (10/14): legs found anywhere in a reply; legs saved at sync are used after Polymarket drops them
    const { findLegs } = await import("../pages/api/combolegs.js"); const { saveComboLegs, comboPicks } = await import("../lib/mybets.js"); const { getJSON } = await import("../lib/redis.js"); const R = globalThis.__TEST_REDIS__;
    const legs = [{ slug: "asc-nfl-sea-den-2026-10-15-neg-3pt5", eventSlug: "nfl-sea-den-2026-10-15", outcome: "+3.50", team: { abbreviation: "den", logo: "x" }, state: "" }, { slug: "tsc-nfl-sea-den-2026-10-15-total-40pt5", eventSlug: "nfl-sea-den-2026-10-15", outcome: "Under", state: "MARKET_STATE_WON" }];
    ok(findLegs({ market: { combo: { legs } } }).length === 2 && findLegs({ market: { slug: "caoc-1", outcomes: ["Yes"] } }) === null, "old combos: legs found deep in a reply; a plain market is not legs");
    await saveComboLegs({ "caoc-t1": { comboLegDetails: legs }, "plain-mkt": { comboLegDetails: legs } });
    const saved = await getJSON("combolegs:caoc-t1"); ok(saved && saved.length === 2 && !saved[0].team.logo && !(await getJSON("combolegs:plain-mkt")), "old combos: account sync saves each combo's legs (slimmed), combos only");
    const ps = await comboPicks({ positions: {} }, "caoc-t1", 2026, 6, saved);
    ok(ps && ps[0].label === "DEN +3.5" && ps[0].kind === "spread" && ps[1].label === "Under 40.5 · SEA @ DEN" && ps[1].result === "W" && ps[1].game === "SEA @ DEN", "old combos: saved legs become picks after Polymarket drops them");
    { const { markFromFinals } = await import("../lib/mybets.js"); const { resetGamesCache } = await import("../lib/games.js"); const realFetch = globalThis.fetch;
      const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n";
      resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + "2026,REG,5,2026-10-05,13:00,BAL,20,ATL,27,dome,X,Home,turf\n" } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
      await R.set("tdscorers:2026:5", JSON.stringify({ t: new Date().toISOString(), games: { "BAL @ ATL": ["D.London", "B.Robinson"] }, teams: null }));
      const m = await markFromFinals([{ label: "Drake London 1+ TD", result: null }, { label: "Zay Flowers 1+ TD", result: null }, { label: "BAL +3.5", result: null }], 2026, 5);
      ok(m[0].result === "W" && m[1].result === "L" && m[2].result === "L", "old combos: TD legs saved without a game are graded from that week's scorers (whole week over)");
      globalThis.fetch = realFetch; resetGamesCache(); await R.del("tdscorers:2026:5"); }
    await R.del("combolegs:caoc-t1"); }
  { // bets analysis: hand-worked numbers
    const L = (kind, result, price) => ({ kind, result, price });
    const bets = [ { source: "preloaded", cost: 10, result: "L", pl: -10, legs: [L("td", "W", 0.4), L("td", "L", 0.4), L("spread", "W", 0.5)] },
      { source: "preloaded", cost: 5, result: "L", pl: -5, legs: [L("td", "L", 0.5), L("total", "W", 0.5)] },
      { source: "preloaded", cost: 8, result: "pending", legs: [L("td", "pending", 0.3), L("spread", "L", 0.5)] },
      { source: "account", cost: 99, result: "L", pl: -99, legs: [] } ];
    const h = ctx.T.betsAnalysis(bets);
    ok(/Touchdowns <span class="dim">· 1–2<\/span>[\s\S]*hit <b>33%<\/b> · paid 43¢ · <b class="r">−10 pts/.test(h), "bets analysis: touchdown legs hit 1 of 3 against an average 43¢ price = −10 points");
    ok(/Spreads <span class="dim">· 1–1/.test(h) && /Totals <span class="dim">· 1–0/.test(h) && !/99/.test(h), "bets analysis: legs of unfinished combos count once graded; an account bet without saved legs is left out");
    const h2 = ctx.T.betsAnalysis([...bets, { source: "account", cost: 10, result: "L", pl: -10, legs: [], picks: [{ label: "DEN +3.5", result: "W" }, { label: "Emanuel Wilson 1+ TD", result: "L" }, { label: "Under 40.5 · SEA @ DEN", result: "W" }] }]);
    ok(/Touchdowns <span class="dim">· 1–3/.test(h2) && /Spreads <span class="dim">· 2–1/.test(h2) && /Totals <span class="dim">· 2–0/.test(h2) && /3-leg combos <span class="dim">· 2<\/span>/.test(h2), "bets analysis: Polymarket account combos count from their saved legs");
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
  { // settlement cross-check: scores decide two all-line combos; Polymarket agrees on one, disagrees on the other
    const { loadMyBets } = await import("../lib/mybets.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n", g = (a, as, h, hs) => `${SEASON},REG,3,2026-09-27,13:00,${a},${as},${h},${hs},o,s,Home,g\n`;
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + g("CAR", 18, "CLE", 21) + g("LAC", 16, "BUF", 24) + g("NE", 6, "JAX", 35) + g("NYJ", 24, "DET", 31) } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await R.set("mybets:ledger", JSON.stringify({ a: { id: "caoc-spreads", season: SEASON, week: 3, cost: 10, shares: 121.86, closedAt: "t", resolved: { win: true, pl: 111.86, t: "2026-09-28T04:00:00Z" } }, b: { id: "caoc-totals", season: SEASON, week: 3, cost: 10, shares: 132.89, closedAt: "t", resolved: { win: false, pl: -10, t: "2026-09-28T04:00:00Z" } } }));
    const mb = await loadMyBets(SEASON), c4 = mb.bets.find((b) => b.id === "w3-c4"), c5 = mb.bets.find((b) => b.id === "w3-c5");
    ok(c4.result === "L" && c4.settleCheck === "disagree" && c5.result === "L" && c5.settleCheck === "agree" && mb.summary.settleCheck.agree === 1 && mb.summary.settleCheck.disagree === 1, "settlement check: scores decide the combo, Polymarket's verdict is compared and a disagreement is flagged");
    await R.set("mybets:ledger", JSON.stringify({ s1: { id: "caoc-stale1", season: SEASON, week: 3, cost: 4.47, shares: 110, closedAt: "t", resolved: { win: false, pl: -5.0018, t: "2026-09-28T04:00:00Z" } },
      s2: { id: "caoc-stale2", season: SEASON, week: 3, cost: 4.47, shares: 110, closedAt: "t", resolved: { win: true, pl: 118, cost: 5, shares: 123, t: "2026-09-28T04:00:00Z" } } }));
    { const mbs = await loadMyBets(SEASON), a1 = mbs.bets.find((b) => b.id === "caoc-stale1"), a2 = mbs.bets.find((b) => b.id === "caoc-stale2");
      ok(a1 && a1.cost === 5.0018 && a1.result === "L" && Math.abs(a1.pl / a1.cost + 1) < 1e-9 && a2 && a2.cost === 5 && a2.toWin === 123 && a2.result === "W" && Math.abs(a2.pl - (a2.toWin - a2.cost)) < 1e-9,
        "bets: a settled bet's stake comes from its settlement (a loss never shows more than -100% of its stake)", { a1, a2 }); }
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
    { const pk = parseGame([mk("moneyline", "Saints vs. Giants", ["New Orleans Saints", "New York Giants"], ["0.515", "0.485"]),
        mk("spreads", "Spread: New York Giants (-1.5)", ["New York Giants", "New Orleans Saints"], ["0.48", "0.52"], { bestBid: 0.47, bestAsk: 0.49 }),
        mk("spreads", "Spread: New Orleans Saints (-1.5)", ["New Orleans Saints", "New York Giants"], ["0.475", "0.525"], { bestBid: 0.46, bestAsk: 0.49 })], "NO", "NYG");
      ok(pk.spread && pk.spread.homeSpread === 1.5, "poly parse: pick'em with both teams at -1.5 -> the moneyline favorite's line (NO -1.5), not the one a hair nearer 50%", pk.spread); }
    const ga = parseGame([...mkts, mk("spreads", "Spread: Minnesota Vikings (-1.5)", ["Minnesota Vikings", "Miami Dolphins"], ["0.79", "0.21"], { bestBid: 0.78, bestAsk: 0.8 })], "MIA", "MIN");
    const alt = (t, l) => (ga.alts || []).find((x) => x.team === t && x.line === l);
    ok(alt("MIN", -1.5).price === 0.8 && Math.abs(alt("MIA", 1.5).price - 0.22) < 1e-9 && alt("MIA", 10) && !alt("MIN", 19.5) && !alt("MIA", -19.5), "poly parse: alternate spreads keep both sides at the buy price; an unpriced placeholder is left out");
    { // bought-point totals (10/14, owner: "by confidence"): alternate total lines parse with both sides' buy prices; the pick needs the chooser's confidence
      const tm = (line, bid, ask, mid) => mk("totals", `O/U ${line}`, ["Over", "Under"], [String(mid), String(1 - mid)], { line, bestBid: bid, bestAsk: ask });
      const gt = parseGame([tm(50.5, 0.60, 0.61, 0.605), tm(52.5, 0.52, 0.53, 0.525), tm(54.5, 0.45, 0.46, 0.455), tm(56.5, 0.38, 0.39, 0.385), tm(60.5, 0.2, 0.21, 0.205)], "MIA", "MIN");
      const ta = (side, l) => (gt.talts || []).find((x) => x.side === side && x.line === l);
      ok(gt.total && gt.total.line === 52.5 && Math.abs(ta("over", 50.5).price - 0.61) < 1e-9 && Math.abs(ta("under", 54.5).price - 0.55) < 1e-9 && Math.abs(ta("under", 56.5).price - 0.62) < 1e-9 && !ta("over", 60.5) && !ta("under", 60.5),
        "poly parse: alternate totals keep both sides at the buy price (Under = 1 - the Over bid), within 6 points of the main total", gt.talts);
      // the card's PICK / PICK w/ POINTS (10/15, lib/cardpick.js): side from the best rule (else the chooser), bought line by CUSHION = win % - price, never more than 3.5 points
      const { buildCard, cardPicks, cushionOf, isGreenPick, plainLeg, ptsLeg } = await import("../lib/cardpick.js"), { spreadRate, totalRate } = await import("../lib/linetable.js"), { gradeStackPick: gsp, ruleLabel } = await import("../lib/stack.js");
      const NE = { key: "NYJ @ NE", home: "NE", away: "NYJ", kickoff: "2026-10-18T17:00:00Z" }, ps = (hs, h) => ({ spread: { homeSpread: hs, home: h, away: +(1 - h).toFixed(3) } }), now = new Date().toISOString();
      const alts = { t: now, alts: [{ team: "NE", line: -6.5, price: 0.52 }, { team: "NE", line: -5.5, price: 0.56 }, { team: "NE", line: -4.5, price: 0.66 }, { team: "NE", line: -3.5, price: 0.7 }, { team: "NYJ", line: 8.5, price: 0.5 }] };
      const ch = [{ id: "chooser|spread", kind: "spread", team: "NE", pick: "NE -7.5", hit: 51.2, n: 2600, line: -7.5, why: "x" }];
      const c1 = buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, alts);
      const r = (L) => Math.max(spreadRate(7.5, true, L, false).rate, 51.2), cu = (L, pr) => Math.round((r(L) - pr * 100) * 10) / 10;
      ok(c1.spread.plain.pick === "NE -7.5" && c1.spread.plain.hit === 51.2 && c1.spread.plain.price === 0.5 && c1.spread.plain.cushion === 1.2 && c1.spread.plain.id === "cardpick|spread"
        && c1.spread.rows.map((x) => x.pick).join() === "NE -6.5,NE -5.5,NE -4.5" && c1.spread.rows.every((x) => x.points <= 3.5 && x.points > 0) && c1.spread.rows[0].points === 1 && c1.spread.rows[2].points === 3,
        "card: PICK sits on Polymarket's line with its win % and cushion; the rows are only lines up to 3.5 points better, each with its points, win % and price", c1.spread);
      const want = [[-6.5, 0.52], [-5.5, 0.56], [-4.5, 0.66]].map(([L, pr]) => ({ L, c: cu(L, pr) })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c || b.L - a.L)[0];
      ok((want ? c1.spread.pts && c1.spread.pts.line === want.L && c1.spread.pts.cushion === want.c : !c1.spread.pts) && (!c1.spread.pts || c1.spread.pts.id === "ptspick|spread" && c1.spread.pts.hit >= c1.spread.plain.hit),
        "card: PICK w/ POINTS = the line with the best cushion (win % - price); never below the plain pick's win %; none when no line has a positive cushion", { pts: c1.spread.pts, want });
      ok(!buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, { t: new Date(Date.now() - 4 * 3600e3).toISOString(), alts: alts.alts }).spread.pts && buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, { t: new Date(Date.now() - 4 * 3600e3).toISOString(), alts: alts.alts }).spread.rows.length === 0
        && buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, null).spread.rows.length === 0 && !buildCard({ ...NE, started: true }, ch, ps(-7.5, 0.5), null, alts),
        "card: no points line when the saved alternate prices are 3+ hours old or missing; no card once the game has started");
      { const rule = [{ id: "keynum|spread", kind: "spread", team: "NYJ", pick: "NYJ +5.5", hit: 56.2, n: 536, line: 5.5, plain: 50.6, why: "BEAT THE 5: x" }, ...ch], c = buildCard(NE, rule, ps(-7.5, 0.5), { spread: { homeSpread: -3.5 } }, alts);
        ok(c.spread.plain.team === "NYJ" && c.spread.plain.pick === "NYJ +7.5" && c.spread.plain.ruleId === "keynum|spread" && c.spread.plain.hit === Math.round(spreadRate(3.5, false, 7.5, false).rate * 10) / 10 && c.spread.rows.every((x) => x.team === "NYJ" && x.line > 7.5),
          "card: a BEAT THE rule names the side, but the PICK is on Polymarket's own line (never the bought +5.5) and uses the line table's win % there", c.spread.plain); }
      // totals: the chooser's side; Over buys lower lines, Under higher; needs the books total for the history (Polymarket's total when none)
      const pt = { total: { line: 42.5, over: 0.5, under: 0.5 } }, talts = { t: now, talts: [{ side: "over", line: 41.5, price: 0.55 }, { side: "over", line: 39.5, price: 0.62 }, { side: "over", line: 38.5, price: 0.7 }, { side: "under", line: 43.5, price: 0.55 }] };
      const chT = [{ id: "chooser|total", kind: "total", side: "over", pick: "Over 42.5", hit: 51.5, n: 2600, line: 42.5, why: "y" }], c2 = buildCard(NE, chT, pt, { total: { line: 42.5 } }, talts);
      ok(c2.total.plain.pick === "Over 42.5" && c2.total.plain.price === 0.5 && c2.total.rows.map((x) => x.pick).join() === "Over 41.5,Over 39.5" && c2.total.rows.map((x) => x.points).join() === "1,3"
        && c2.total.rows.every((x) => x.points > 0 && x.points <= 3.5 && x.side === "over") && c2.total.rows.length === 2 && Math.abs(c2.total.rows[0].hit - Math.max(totalRate(42.5, "over", 41.5, false).rate, 51.5)) < 0.06,
        "card: totals -- Over buys lower lines up to 3.5 points (4 points is left out), each row's win % from the line table", c2.total.rows);
      const picks = cardPicks(c1), cp = picks.find((x) => x.id === "cardpick|spread"), pp = picks.find((x) => x.id === "ptspick|spread");
      ok(cp && gsp({ ...cp, home: "NE" }, 30, 21) === "W" && gsp({ ...cp, home: "NE" }, 28, 21) === "L" && (!pp || gsp({ ...pp, home: "NE" }, 28, 21) === (7 + pp.line > 0 ? "W" : "L")) && ruleLabel({ id: "cardpick|spread", kind: "spread" }) === "PICK · spread" && /PICK w\/ POINTS · total · 2 pts/.test(ruleLabel({ id: "ptspick|total", kind: "total", points: 2 }))
        && cushionOf(58, 0.54) === 4 && cushionOf(58, null) === null && isGreenPick(58, 0.54) && !isGreenPick(58, 0.56) && isGreenPick(56, null) && !isGreenPick(55, null),
        "card: the PICK and the points line are recorded as their own picks, graded at their own line; green = cushion +3 or better (no price yet: 56%+)");
      { // recorded at kickoff, graded, counted in the Models tab: the card's PICK and PICK w/ POINTS (10/15)
        const { recordStack, gradeStackWeek, stackSummary, noteFirstSeen, gradeFirstSeenWeek } = await import("../lib/stack.js"), RR = globalThis.__TEST_REDIS__;
        for (const k of await RR.keys("stack*:2099:7")) await RR.del(k);
        const cc = buildCard(NE, ch.concat(chT), { ...ps(-7.5, 0.5), ...pt }, { spread: { homeSpread: -7.5 } }, { ...alts, ...talts }), pk = cardPicks(cc);
        await recordStack(2099, 7, NE, pk, now); await noteFirstSeen(2099, 7, NE, pk, now);
        const fin = [{ key: "NYJ @ NE", homeScore: 31, awayScore: 20 }];   // NE wins by 11, total 51
        const n1 = await gradeStackWeek(2099, 7, fin), n2 = await gradeFirstSeenWeek(2099, 7, fin), sm = await stackSummary(2099);
        ok(pk.length >= 2 && n1 === pk.length && n2 === pk.length && sm.byId["cardpick|spread"] && sm.byId["cardpick|spread"].w === 1 && sm.byId["cardpick|total"].w === 1 && sm.rules["PICK · spread"] && sm.rules["PICK · spread"].w === 1
          && (!cc.spread.pts || sm.rules[`PICK w/ POINTS · spread · ${cc.spread.pts.points} pt${cc.spread.pts.points === 1 ? "" : "s"}`].w === 1) && sm.card.spread.w === 1 && sm.card.total.w === 1 && sm.recorded >= pk.length,
          "recorded + graded: the card's PICK and PICK w/ POINTS are saved at kickoff, graded when the game ends, and counted in the Models tab (by id, by rule label and in the spread / total tiles)", { n1, n2, byId: sm.byId, rules: sm.rules });
        for (const k of await RR.keys("stack*:2099:7")) await RR.del(k); }
      { const g2 = { key: "NYJ @ NE", card: c1 }, lp = plainLeg(g2, "spread"), pl = ptsLeg(g2, "spread");
        ok(lp && lp.label === "NE -7.5" && lp.price === 0.5 && lp.prob === 0.512 && !lp.bought && (!pl || pl.bought && pl.label !== lp.label), "parlay legs: the plain line only; the bought line is a separate leg used only by 'my style · bought lines'"); }
    }
    { // database space (10/14): a finished, fully graded week's TD price history shrinks to first + last; its rerun log to 5 runs; once
      const { compactOldWeeks } = await import("../lib/compact.js"); const { SEASON: SZ, resetGamesCache: rgc } = await import("../lib/games.js"); const RR = globalThis.__TEST_REDIS__, rf = globalThis.fetch;
      const HH = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,spread_line,total_line,roof,stadium,location,surface\n";
      rgc(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => HH + `${SZ},REG,1,2020-09-13,13:00,AAA,10,BBB,20,3,40,o,s,Home,g\n${SZ},REG,2,2099-09-20,13:00,AAA,,BBB,,3,40,o,s,Home,g\n` } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
      const hk = `tdpxhist:${SZ}:1:AAA @ BBB`; await RR.del(hk); await RR.rpush(hk, "a", "b", "c", "d"); await RR.del(`rerunlog:${SZ}:1`); for (let i = 0; i < 9; i++) await RR.lpush(`rerunlog:${SZ}:1`, String(i));
      const before = await compactOldWeeks(SZ);   // week 1 not graded yet -> untouched
      await RR.set(`res:${SZ}:1:AAA @ BBB`, "{}"); const after = await compactOldWeeks(SZ), again = await compactOldWeeks(SZ);
      ok(!before.length && after.join() === "1" && !again.length && (await RR.lrange(hk, 0, -1)).join() === "a,d" && (await RR.llen(`rerunlog:${SZ}:1`)) === 5,
        "database space: a finished, fully graded week's logs shrink once (TD prices first + last, 5 reruns); ungraded weeks untouched");
      globalThis.fetch = rf; rgc(); }
    { // Pinnacle (10/14): one blocked pull is not an error; the 2nd in a row is; a success resets the count
      const { pinnacleFailed, pinnacleOk } = await import("../lib/pinnacle.js"), RR = globalThis.__TEST_REDIS__, logs = []; const lg = async (w, m) => logs.push(m);
      await pinnacleOk(RR); await pinnacleFailed(RR, "403", lg); const one = logs.length; await pinnacleFailed(RR, "403", lg); const two = logs.length;
      await pinnacleOk(RR); await pinnacleFailed(RR, "403", lg);
      ok(one === 0 && two === 1 && logs.length === 1 && /2 times in a row/.test(logs[0]), "pinnacle: logged only on the 2nd failure in a row"); }
    { const { stackSummary } = await import("../lib/stack.js"), RR = globalThis.__TEST_REDIS__;   // LINE VALUE leaves KEY NUMBER out (its line never moves)
      await RR.hset("stack:2098:6", "A @ B|keynum|spread", JSON.stringify({ id: "keynum|spread", kind: "spread", team: "A", home: "B", game: "A @ B", week: 6, hit: 58.1, line: 3.5, first: { line: 3.5 }, result: "W" }),
        "C @ D|linemove|spread", JSON.stringify({ id: "linemove|spread", kind: "spread", team: "C", home: "D", game: "C @ D", week: 6, hit: 63.2, line: 2.5, first: { line: 3.5 }, result: "W" }));
      const sm = await stackSummary(2098); ok(sm.card.clv.n === 1 && sm.card.clv.sum === 1, "line value: KEY NUMBER (fixed +3.5) left out; a real line move counts", sm.card.clv); await RR.del("stack:2098:6"); }
    // grading removes a bad stored pick but keeps the good one in the result record
    const { gradeWeek } = await import("../lib/grade.js"); const { SEASON, resetGamesCache } = await import("../lib/games.js"); const R = globalThis.__TEST_REDIS__; const realFetch = globalThis.fetch;
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,spread_line,total_line,roof,stadium,location,surface\n";
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + `${SEASON},REG,4,2026-10-04,13:00,MIA,10,MIN,15,10,38.5,o,s,Home,g\n` } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await R.set(`res:${SEASON}:4:MIA @ MIN`, JSON.stringify({ v: 2, game: "MIA @ MIN", spread: { basis: "model", label: "MIN +19.5", result: "W", clvPts: 0 }, total: { basis: "model", label: "Over 38.5", result: "L", clvPts: 0 }, ml: { label: "MIA ML", result: "L" }, td: [], tdPx: true, tdScorerV2: true, repChecked: true, mlModelChecked: true }));
    await gradeWeek(SEASON, 4);
    const rec = JSON.parse(await R.get(`res:${SEASON}:4:MIA @ MIN`));
    ok(!rec.spread && rec.total && rec.total.result === "L" && rec.ml && rec.lineDropped === true, "grading: a result saved with an absurd spread loses that part only (the total and moneyline stay)");
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
  { // Anytime TD tab: the four likeliest scorers per team, everyone one tap away
    const box = { innerHTML: "" }, hdr = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "td" ? box : id === "td-header" ? hdr : old(id));
    const pl = (team, i) => ({ player: `${team}.P${i}`, team, pos: "RB", fair: 50 - i * 5, price: 0.5, bid: 0.48, teamRank: i + 1, game: "A @ B", flags: [] });
    vm.runInContext(`S = { week: 4, games: [ { key: "A @ B", away: "A", home: "B", started: false, td: [${[0,1,2,3,4,5].map((i) => JSON.stringify(pl("A", i))).join(",")}, ${[0,1,2,3,4,5].map((i) => JSON.stringify(pl("B", i))).join(",")}] } ] }`, ctx);
    ctx.T.renderTd(); const rows = (box.innerHTML.match(/class="tdr"/g) || []).length, ownA = (box.innerHTML.match(/A\.P\d/g) || []);
    ok(rows === 6 && /top 3 per team/.test(hdr.textContent || hdr.innerHTML) && !/Show everyone/.test(box.innerHTML) && !/A\.P3/.test(box.innerHTML) && /A\.P2/.test(box.innerHTML), "touchdown tab: three players per team, no 'Show everyone' button");
    ctx.document.getElementById = old; }
  { // touchdown row: a "+N vs price" mark only when the blended chance beats the price by 5+; calibration rows show their noise
    const mk = (fair, price) => ctx.T.tdRow({ r: { player: "X.Y", team: "A", pos: "WR", fair, price, bid: price - 0.02, game: "A @ B", flags: [] }, g: { key: "A @ B", away: "A", home: "B" } }, 0);
    ok(/\+\d+ vs price/.test(mk(60, 0.40)) && !/vs price/.test(mk(40, 0.40)), "touchdown row: marks a player only when the blend beats the price by 5+");
    }
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
    ok(/RB · 2 players/.test(pos) && /WR · 1 player/.test(pos) && /TE · 2 players/.test(pos) && /1 with no position/.test(pos), "by position: RB, WR and TE rows with sample size, margin and a no-position note");
    ok(ctx.T.tdByDefense([]).includes("None yet"), "by defense: rows flag small samples; empty says it fills in"); }
  { // one week only (10/6): Anytime TD and Game Lines show this week, no next-week section
    const bx = { innerHTML: "" }, hx = { innerHTML: "" }, oldG = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "td" ? bx : id === "td-header" ? hx : oldG(id));
    const pl = (team, i) => ({ player: `T.${team}${i}`, team, pos: "RB", fair: 50 - i * 5, price: 0.5, bid: 0.48, teamRank: i + 1, game: "A @ B", flags: [] });
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", away: "A", home: "B", started: false, td: ${JSON.stringify([0, 1, 2, 3].map((i) => pl("A", i)).concat([0, 1, 2, 3].map((i) => pl("B", i))))} }] }`, ctx); ctx.T.renderTd();
    ok((bx.innerHTML.match(/class="tdr"/g) || []).length === 6 && !/Next week/.test(bx.innerHTML) && !/T\.A3/.test(bx.innerHTML), "touchdown tab: this week's top 3 per team only, no next-week section");
    { const p2 = (n, f, price) => ({ player: n, team: "A", pos: "RB", fair: f, price, bid: price - 0.02, teamRank: 1, game: "A @ B", flags: [] });
      vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", away: "A", home: "B", started: false, td: ${JSON.stringify([p2("Star.One", 64, 0.6), p2("Mid.Two", 40, 0.65), p2("Low.Three", 30, 0.3)])} }] }`, ctx); ctx.T.renderTd();
      const list = bx.innerHTML.split('class="card tdl"')[1] || "";
      ok(/Star\.One/.test(bx.innerHTML) && !/Star\.One/.test(list) && /Mid\.Two/.test(list), "touchdown tab: a Best TD pick is not repeated in the list below");
      ok(/Market disagrees: Polymarket 65¢ vs model 40%/.test(list) && !/class="sh">⚠ Market disagrees/.test(bx.innerHTML), "touchdown tab: market-disagrees warning sits on the player's row, no separate box"); }
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", started: true, td: [] }] }`, ctx); ctx.T.renderTd();
    ok(/No games left this week/.test(bx.innerHTML), "touchdown tab: when every game has started it says no games are left");
    ctx.document.getElementById = oldG;
    const ln = { innerHTML: "", style: {} }, dt = { innerHTML: "", style: {} };
    ctx.document.getElementById = (id) => (id === "lines" ? ln : id === "detail" ? dt : id === "bgwm" ? { style: {}, dataset: {}, innerHTML: "" } : id === "back-btn" ? { onclick: null } : oldG(id));
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", away: "A", home: "B", started: false, final: false, kickoff: "2099-01-01T18:00:00Z", winPct: null, td: [], history: [] }], changed: [] }; DETAIL = null`, ctx);
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
    if (d) ok(!/SOS/.test(d), "SOS: no longer shown (owner 10/14)"); }
  { // Polymarket kickoff (10/8: CHI @ GB 1:00 ET in the schedule and ESPN, 4:25 on Polymarket)
    const { polyKickoffs } = await import("../lib/poly.js"); const { overlayPolyKickoffs } = await import("../lib/games.js");
    const ev = [{ title: "Bears vs. Packers", startTime: "2026-10-11T20:25:00Z", markets: [] }, { title: "Bills vs. Rams", markets: [{ gameStartTime: "2026-10-13 00:15:00+00" }] }];
    const pk = polyKickoffs(ev, [{ key: "CHI @ GB", away: "CHI", home: "GB" }, { key: "BUF @ LA", away: "BUF", home: "LA" }, { key: "X @ Y", away: "X", home: "Y" }]);
    ok(pk["CHI @ GB"] === "2026-10-11T20:25:00.000Z" && pk["BUF @ LA"] === "2026-10-13T00:15:00.000Z" && !pk["X @ Y"], "Polymarket kickoff: event start time, else market game start");
    const rows = [{ key: "CHI @ GB", kickoff: "2026-10-11T13:00:00-04:00" }, { key: "CHI @ GB", kickoff: "2025-10-12T13:00:00-04:00", final: true }, { key: "BUF @ LA", kickoff: "2026-10-12T20:15:00-04:00" }];
    ok(overlayPolyKickoffs(rows, pk) === 1 && rows[0].kickoff === "2026-10-11T20:25:00.000Z" && rows[0].kickoffFrom === "polymarket" && rows[1].kickoff.startsWith("2025") && rows[2].kickoff === "2026-10-12T20:15:00-04:00", "Polymarket kickoff: replaces a stale time, leaves matching times and other seasons"); }
  { const { overlayPolyKickoffs, KICK_FIX } = await import("../lib/games.js"); const r = [{ key: "CHI @ GB", kickoff: "2026-10-11T13:00:00-04:00" }]; overlayPolyKickoffs(r, KICK_FIX);
    ok(new Date(r[0].kickoff).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }) === "10:00 AM", "CHI @ GB stays at the official noon CT (10:00 AM Pacific)"); }
  { // proven angles flagged on the game (10/8)
    const g = { ...tg, combos: [{ id: "c1", pick: "TB +4.5", why: "Road team off a loss vs 3-game win streak", hit: 59, n: 283 }] };
    const lo = { ...tg, combos: [{ pick: "Over 46.5", why: "x", hit: 53, n: 2580 }, { pick: "Under 46.5", why: "y", hit: 56.8, n: 2580 }, { pick: "Under 46.5", why: "z", hit: 56.1, n: 2580 }] };
    ok(/>TB \+4\.5</.test(ctx.T.tile(g)) && lo, "tile chip: the game's green pick");
    ok(!/anglesBox/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8")), "game page: the old BEST PICK box code is gone (it repeated the Model cards)"); }
  { // proven angles in Model Picks parlays (10/8)
    const { buildPaper } = await import("../lib/paper.js");
    const G = (k, angles, winPct, ml) => ({ key: k, home: k.split(" @ ")[1], away: k.split(" @ ")[0], started: false, final: false, angles, winPct, poly: ml ? { ml: { home: ml }, spread: { homeSpread: -3 } } : null, td: [] });
    const P = buildPaper({ games: [G("A @ B", [{ id: "streakfade", pick: "A +4.5", price: 0.48, hit: 59, n: 283 }]), G("C @ D", [{ id: "winddiv", pick: "Under 41.5", price: 0.5, hit: 56.8, n: 426 }]), G("E @ F", [], 80, 0.78), G("H @ I", [], 77, 0.75)] });
    const by = Object.fromEntries(P.map((p) => [p.strategy, p]));
    ok(!by.angles_2 && !by.angles_3 && !by.angles_fav_3, "angle parlays are no longer built (their rates were never checked on unseen games)"); }
  { // road ML angle: flagged with its return, used as an ML leg in angle parlays (10/8)
    const g = { ...tg, angles: [{ id: "roadml3", pick: "BUF ML", price: 0.45, name: "Road team · moneyline · spread ~3, total 48+", hit: 57.2, n: 382, roi: 12.9 }] };
    const { buildPaper } = await import("../lib/paper.js");
    const P = buildPaper({ games: [{ key: "BUF @ LA", home: "LA", away: "BUF", started: false, final: false, angles: g.angles, td: [] }, { key: "A @ B", home: "B", away: "A", started: false, final: false, angles: [{ id: "winddiv", pick: "Under 41.5", price: 0.5, hit: 56.8, n: 426 }], td: [] }] });
    ok(!P.some((p) => p.strategy === "angles_2"), "road ML angle: no angle parlay built"); }
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
  }
  { // weakest leg of an open combo (10/9)
    const L = (n, p, m) => ({ kind: "total", side: "over", line: n, price: p, modelP: m, result: "pending" });
    const b = { result: "pending", legs: [L(40, 0.5, 0.55), L(41, 0.6, 0.4), L(42, 0.5, 0.49)] };
    ok(ctx.T.weakLeg(b) === b.legs[1] && ctx.T.weakLeg({ ...b, legs: [L(40, 0.5, 0.55), L(41, 0.5, 0.49)] }) === null && ctx.T.weakLeg({ ...b, result: "W" }) === null, "weakest leg: the leg furthest below its price, only on open combos"); }
  { // confidence: angles agreeing on one side (10/9)
    const g = { ...tg, combos: [{ pick: "TB +4.5", why: "a", hit: 58, n: 2535 }, { pick: "TB +4.5", why: "b", hit: 59, n: 2535 }, { pick: "Under 41.5", why: "c", hit: 57, n: 2580 }] };
    ok(/>TB \+4\.5</.test(ctx.T.tile(g)) && !/×2/.test(ctx.T.tile(g)), "tile chip: the game's best straight pick only"); }
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
  ok(/>Q</.test(ctx.T.injTag({ espn: "Questionable — limited Thursday" })) && />OUT</.test(ctx.T.injTag({ injury: "Out" })) && />D</.test(ctx.T.injTag({ injury: "Doubtful" })) && ctx.T.injTag({}) === "", "injury tag: Q / D / OUT from the report, ESPN before Friday");
  { // decision model (10/9)
    vm.runInContext(`S = { games: [{ key: "A @ B", started: false, combos: [{ pick: "A +4.5", why: "x", hit: 59, n: 2535 }] }, { key: "C @ D", started: true, combos: [{ pick: "C +3", why: "y", hit: 70, n: 2535 }] }], teaserLegs: [{ team: "E", line: 8.5, price: 0.7, game: "E @ F" }] }`, ctx);
    const B = ctx.T.bestBets();
    ok(B.length === 1 && B[0].pick === "A +4.5" && !B.some((x) => x.pick === "C +3"), "best bets: straight picks only, started games skipped");
    vm.runInContext(`S.games.push(...Array.from({ length: 12 }, (_, i) => ({ key: "G" + i, started: false, combos: [{ pick: "T" + i + " +3", why: "x", hit: 57 + i, n: 2535 }] })), { key: "L", started: false, combos: [{ pick: "L +1", why: "x", hit: 53, n: 2535 }] })`, ctx);
    const B2 = ctx.T.bestBets();
    { const PP = ctx.T.parlayPicks(); ok(PP.length === 4 && new Set(PP.map((x) => x.game)).size === 4 && PP[0].p >= PP[3].p && /Chance all 4 hit: <b>\d+%<\/b>/.test(ctx.T.parlayStrip()), "parlay of the week: top 4 green picks, one per game, chance all hit"); }
    ok(B2.length === 10 && B2[0].p >= B2[9].p && !B2.some((x) => x.pick === "L +1") && !B2.some((x) => x.pick === "B -3.5"), "best bets: top 10 at 56%+; teasers and alt lines in their own list"); }
  {
    { const { tablePicks, gradeStackPick, comboFactors } = await import("../lib/stack.js"), G = { key: "A @ B", away: "A", home: "B", outdoor: true, kickoff: "2026-10-11T17:00:00Z" };
      const F = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, fix: {} }, -8, 40, -8, 40, null, 6).F;
      const X = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, temp: 20, fix: { awayQbFirstStart: true }, xf: { homeRest: 7, awayRest: 4, homeCoach: 0.6, awayCoach: 0.4, homeAge: 27, awayAge: 25.5, awayQbRun: 7, tzdiff: 3, early: true, ptsTot: 45, s: { gbm: -0.1, logit: -0.1, rf: -0.1, ens: -0.5 }, t: { gbm: 0.1, ridge: -0.1, ens: 0.4 } } }, -8, 40, -8, 40, null, 6).F;
      ok(X.cold && X.shortwk && X["dogrest-"] && X.dogCoachBad && X.favCoachGood && X.dogNewQB && X.awayEastEarly && X.tz2P && X.dogYounger1 && X.dogQBruns && X.bigDogQBruns && X.ptsTotO3 && X.gbmDog && X.logitDog && X.rfDog && X.statDog && X.gbmO && X.ridgeU && X.statO && !X.allLeanDog && !X.homeCoachBad, "combo factors from the model service: rest, coaches, QB, travel, age, stats models");
      const C0 = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, fix: {} }, -8, 40, -8, 40, null, 6), ug = C0.up.margin - 8, ut = C0.up.total - 40;
      ok(F.wind15 && F.wind10 && F["sp>=7"] && F["tot<=41"] && F.mdlFav === (ug > 0) && F.mdlFav3 === (ug >= 3) && F.mdlO === (ut > 0) && F.mdlU === (ut < 0) && !F.prime && F.roadDog, "combo factors from the game (model leans from the upgraded model)");
      const P = tablePicks(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, fix: {} }, -8, 40, -8, 40, null, 6);
      ok(P.length === 2 && P.every((x) => x.hit > 50 && x.why) && !(P.some((x) => x.kind === "total" && x.side === "under") && P.some((x) => x.kind === "total" && x.side === "over")), "chooser picks: one side per market, with reasons");
      { const sit = { home: { prevOT: true, nextDiv: true, prevDiv: true, revenge: true, winPct: 0.8 }, away: { prevMon: true, prevAway: true, prev2Away: true, prevMarg: -30, winPct: 0.2 } };
        const NF = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 0, fix: { div: false }, xf: { awayRest: 14 } }, -8, 40, -8, 40, sit, 17).F;
        ok(NF.favAfterOT && NF.favLookaheadDiv && NF.favRevenge && NF.dogAfterMNF && NF.dogAfterLoss28 && NF.road2nd && NF.road3rd && NF.roadOffBye && NF.sandwichAny && NF.wk17dogLosing && !NF.divRematch, "combo factors: research factors (overtime, Monday, revenge, lookahead, road trip, bye, sandwich, late season)"); }
      { const K = tablePicks({ key: "MIA @ GB", away: "MIA", home: "GB", outdoor: true, kickoff: "2026-12-20T18:00:00Z" }, { homeMargin: 3, total: 40, temp: 20, fix: {} }, -3, 40);
        ok(K.length === 2 && K.some((x) => x.id === "chooser|spread" && /^(MIA \+3|GB -3)$/.test(x.pick)) && K.some((x) => x.id === "chooser|total" && /^(Over|Under) 40$/.test(x.pick)) && K.every((x) => x.hit > 50 && x.hit < 60 && x.n >= 2000 && !x.teaser && x.why) && !K.some((x) => /^keeper/.test(x.id)),
          "chooser: one spread and one total pick per game, honest rate (50-60%), tested on 2,000+ unseen games; no keeper angles"); }
      ok(gradeStackPick({ kind: "spread", team: "A", home: "B", line: 8.5 }, 24, 17) === "W" && gradeStackPick({ kind: "total", side: "over", line: 34 }, 20, 13) === "L", "combo picks: grading"); }
    { // combo picks from Polymarket's position data (10/9)
      const { comboPicks } = await import("../lib/mybets.js"), { setJSON: sj, K: KK } = await import("../lib/redis.js");
      await sj(KK.tdpx(2026, 5, "NYG @ WAS"), { "Cam Skattebo: Anytime Touchdown": 0.41, "Jacory Croskey-Merritt: Anytime Touchdown": 0.4 });
      const raw = { positions: { positions: { "caoc-x": { comboLegDetails: [
        { slug: "asc-nfl-nyg-was-2026-10-11-pos-3pt5", outcome: "+3.50", team: { abbreviation: "nyg" }, eventSlug: "nfl-nyg-was-2026-10-11", state: "COMBO_LEG_STATE_WON" },
        { slug: "astatc-nfl-nyg-was-2026-10-11-td-camska-gte1", outcome: "Yes", eventSlug: "nfl-nyg-was-2026-10-11", state: "COMBO_LEG_STATE_PENDING" },
        { slug: "astatc-nfl-nyg-was-2026-10-11-td-jacomer-gte1", outcome: "Yes", eventSlug: "nfl-nyg-was-2026-10-11", state: "COMBO_LEG_STATE_LOST" },
        { slug: "tsc-nfl-nyg-was-2026-10-11-total-42pt5", outcome: "Over", eventSlug: "nfl-nyg-was-2026-10-11" }] } } } };
      const cp = await comboPicks(raw, "caoc-x", 2026, 5);
      const lar = await comboPicks({ positions: { positions: { r: { comboLegDetails: [{ slug: "asc-nfl-lar-den-2026-10-11-pos-2pt5", outcome: "+2.50", team: { abbreviation: "lar" }, eventSlug: "nfl-lar-den-2026-10-11" }, { slug: "tsc-nfl-lar-den-2026-10-11-total-44pt5", outcome: "Under", eventSlug: "nfl-lar-den-2026-10-11" }] } } } }, "r", 2026, 5);
      ok(lar[0].label === "LA +2.5" && lar[1].label === "Under 44.5 · LA @ DEN", "my bets: Polymarket's LAR shows as the app's LA");
      ok(cp.map((x) => x.label).join("|") === "NYG +3.5|Cam Skattebo 1+ TD|Jacory Croskey-Merritt 1+ TD|Over 42.5 · NYG @ WAS" && cp[0].result === "W" && cp[2].result === "L" && cp[1].result === null && (await comboPicks(raw, "caoc-y", 2026, 5)) === null, "my bets: combo picks read from Polymarket (spread, TD names, total, won/lost)");
      const row = ctx.T.betRow({ source: "account", title: "caoc-x", week: 5, cost: 10, toWin: 294, price: 0.034, result: "pending", picks: cp });
      ok(/Combo · 4 picks/.test(row) && !/caoc-x/.test(row) && /NYG \+3\.5/.test(row) && /Cam Skattebo 1\+ TD/.test(row) && /pays \$294\.00 if it wins/.test(row), "my bets: open combo shows its picks in a list"); }
    { // kickoff save: the card picks are recorded at kickoff, then graded
      const { writePrelog } = await import("../pages/api/snapshot.js"), { getRedis: gr, K: KK, setJSON: sj } = await import("../lib/redis.js"), R = gr();
      const G = { key: "A @ B", away: "A", home: "B", week: 5, kickoff: "2026-10-11T17:00:00Z" };
      await R.rpush(KK.snaps(2026, 5, G.key), JSON.stringify({ t: 1, poly: { spread: { homeSpread: -3 }, total: { line: 48 } } }));
      const poly = { spread: { homeSpread: -2, home: 0.5, away: 0.5 }, total: { line: 44, over: 0.5, under: 0.5 }, ml: { home: 0.55, away: 0.45 } };
      const model = { games: { [G.key]: { homeMargin: 6, total: 41, calHomeCover: 55, calUnder: 60, outdoor: true, wind: 16, fix: { turf: true } } }, td: {} };
      await writePrelog(2026, 5, G, "2026-10-11T16:55:00Z", poly, null, model);
      const S = await R.hgetall("stack:2026:5");
      ok(Object.keys(S).length > 0, "kickoff save: card picks recorded");
      const { gradeStackWeek } = await import("../lib/stack.js");
      const fin = [{ key: G.key, home: "B", away: "A", homeScore: 20, awayScore: 17 }];
      await gradeStackWeek(2026, 5, fin);
      const S2 = Object.values(await R.hgetall("stack:2026:5")).map((x) => JSON.parse(x));
      ok(S2.every((x) => ["W", "L", "P"].includes(x.result)), "kickoff save: every recorded pick is graded after the final"); }
    { // weekly rebuild (10/9): a published set switches the table and coefficients; a bad or missing one falls back to the built-in copies
      const { applyComboModel } = await import("../lib/combomodel.js"), { upgraded, UP } = await import("../lib/upgrade.js");
      const base = upgraded({ mm: 3, km: 3, mt: 44, kt: 44 });
      const fake = { table: Array.from({ length: 300 }, () => ["Dog ATS", ["homeDog"], 99.9, 100]), upgrade: { ...UP, mi: UP.mi + 5 }, early: null };
      ok(applyComboModel(fake) && Math.abs(upgraded({ mm: 3, km: 3, mt: 44, kt: 44 }).margin - base.margin - 5) < 0.11, "weekly rebuild: a published set is used");
      ok(!applyComboModel({ table: [] }) && Math.abs(upgraded({ mm: 3, km: 3, mt: 44, kt: 44 }).margin - base.margin) < 0.01, "weekly rebuild: a bad set falls back to the built-in model"); }
  }
  ok(ctx.T.slotOf({ badge: "SNF", kickoff: "2026-10-11T12:00:00" }) === "Primetime" && ctx.T.slotOf({ kickoff: "2026-10-11T10:00:00" }) === "Morning" && ctx.T.slotOf({ kickoff: "2026-10-11T13:25:00" }) === "Afternoon", "best bets: morning / afternoon / primetime");
  { // without him (10/8): top 3 TD scorers in games a listed-Out regular missed
    const h = ctx.T.tdTop3({ ...tg, td: [], without: { [tg.away]: [{ out: "A.Kamara", games: 7, top: [{ name: "C.Olave", td: 5 }, { name: "D.Vele", td: 2 }] }], [tg.home]: [{ out: "X.Y", games: 1, top: [] }] } });
    ok(/Without A\.Kamara<\/b> <span class="dim">\(7 games\)<\/span>: C\.Olave 5 · D\.Vele 2/.test(h) && /\(1 game\)<\/span>: no TDs/.test(h), "without him: scorers listed under the team's top 3"); }
  { // kickoff check line in System: failures and moved games are visible
    ok(/failed: ESPN timed out/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: false, error: "ESPN timed out" })) && /moved: CHI @ GB/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: true, espnGames: 15, moved: [{ game: "CHI @ GB", was: "2026-10-11T17:00Z", now: "2026-10-11T20:25Z" }] })) && /OK/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: true, espnGames: 15, moved: [] })), "kickoff check: shows failures, moved games, or all-match");
    const { overlayEspnKickoffs, resetKickCache } = await import("../lib/espnFinals.js"); const R = globalThis.__TEST_REDIS__;
    resetKickCache(); await overlayEspnKickoffs([{ key: "CHI @ GB", final: false, kickoff: new Date(Date.now() + 86400e3).toISOString() }], Date.now(), async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    const kc = JSON.parse(await R.get("kickcheck")); ok(kc && kc.ok === false && /timed out/.test(kc.error), "kickoff check: a failure is recorded"); await R.del("kickcheck"); resetKickCache(); }
  { // signal alerts: TD "No" mark, starting QB's TD chance jumping
    const { alertsTdNo, alertsQbJump, listAlerts } = await import("../lib/alerts.js"), R = globalThis.__TEST_REDIS__;
    const g = { key: "TB @ DAL", away: "TB", home: "DAL" };
    await alertsTdNo(2032, g, [{ player: "G.Pickens", team: "DAL", fair: 30, price: 0.42, bid: 0.4 }, { player: "C.Lamb", team: "DAL", fair: 46, price: 0.49, bid: 0.47 }]);
    await alertsQbJump(2032, g, { away: [{ name: "B.Mayfield", pos: "QB", fair: 13 }], home: [{ name: "D.Prescott", pos: "QB", fair: 10 }] }, { away: [{ name: "J.Daniels", pos: "QB", fair: 25 }], home: [{ name: "D.Prescott", pos: "QB", fair: 12 }] });
    const L = await listAlerts(2032), k = (x) => L.filter((a) => a.kind === x);
    ok(k("TD NO").length === 1 && /G\.Pickens/.test(k("TD NO")[0].title), "alerts: a TD 'No' mark alerts (model 10 under the bid), a close one doesn't");
    ok(k("QB TD").length === 1 && /J\.Daniels TD chance now 25%/.test(k("QB TD")[0].title), "alerts: a new starting QB at 20%+ alerts; a 2-point move doesn't");
    for (const kk of await R.keys("*2032*")) await R.del(kk); }
  { // blended touchdown chance and "agrees with the market"
    const b1 = ctx.T.tdBlend({ fair: 40, price: 0.30, bid: 0.28 }), b2 = ctx.T.tdBlend({ fair: 40, price: 0.30, bid: 0.01, thin: true });
    ok(b1 && Math.abs(b1.mid - 29) < 1e-9 && Math.abs(b1.blend - 34.5) < 1e-9 && b2 === null && ctx.T.tdBlend({ fair: 40, price: 0.3, bid: 0.28, stale: true }) === null && ctx.T.tdBlend({ fair: 40, price: null }) === null, "touchdown blend: half the model, half the market mid, only on a real market");
    const G = { key: "CHI @ GB", away: "CHI", home: "GB", started: false, model: { homeMargin: -5.6, total: 46.1, fix: {} }, spreadPick: { label: "CHI -1.5", team: "CHI", side: "away", pct: 51 }, totalPick: { label: "Under 46.5", side: "under", pct: 50.5 },
      combos: [{ kind: "spread", pick: "GB +1.5", hit: 62.3, why: "model likes the favorite by 3+ · line moved 1+ toward the dog", model: true }, { kind: "total", pick: "Under 46.5", hit: 57.2, why: "wind 10+ · older teams" }, { kind: "total", pick: "Over 40.5", hit: 75, teaser: true, why: "t" }] };
    G.combos[0].rec = { w: 3, l: 1 }; G.history = [{ poly: { spread: { homeSpread: 2.5 }, total: { line: 45.5 } } }]; G.lineNow = { hs: 1.5, tl: 46.5 };
    const sp = ctx.T.leanCell(G, "spread"), to = ctx.T.leanCell(G, "total");
    ok(/Model: <b class="mod">CHI by 5\.6<\/b>/.test(sp) && /PICK: GB \+1\.5 · <span class="reelpct" data-v="62%">62%<\/span>/.test(sp) && /class="g pulse" style="--gl:1"/.test(sp) && !/Goes against/.test(sp) && !/Less accurate/.test(sp) && (sp.match(/PICK:/g) || []).length === 1, "model card: one pick, no extra notes");
    ok(/This season: <b>3–1<\/b>/.test(sp) && /Line moved: opened GB \+2\.5, now GB \+1\.5 · worse number now/.test(sp) && /Line moved: opened Under 45\.5, now Under 46\.5 · better number now/.test(to) && ctx.T.recLine({ w: 0, l: 0 }) === "", "model card: this season's record and the line check");
    { const out = sp.replace(/<details[\s\S]*<\/details>/, "");
      ok(/PICK: GB \+1\.5/.test(out) && /model likes the favorite/.test(out) && !/This season/.test(out) && !/Line moved/.test(out) && /<details class="more"[^>]*><summary[^>]*>More<\/summary>[\s\S]*This season[\s\S]*Line moved/.test(sp) && ctx.T.moreBox("") === "",
        "model card (10/14 cleanup): pick + % + one reason stay on the card; record, line moved, cost and without-the-points sit behind a More tap"); }
    { // casino look (10/14): glow by strength, HIT/MISS stamps only on settled (not sold) bets, parlay card glows purple
      ok(ctx.T.glowOf(0.57) === 0.45 && ctx.T.glowOf(0.596) === 0.75 && ctx.T.glowOf(0.62) === 1, "casino: stronger green picks glow brighter");
      ok(/stamp hit/.test(ctx.T.stampFor({ id: "a", result: "W" })) && /MISS/.test(ctx.T.stampFor({ id: "b", result: "L" })) && ctx.T.stampFor({ id: "c", result: "W", sold: { pl: 3 } }) === "" && ctx.T.stampFor({ id: "d", result: "pending" }) === "", "casino: HIT on a won bet, MISS on a lost one, nothing on open or cashed-out bets");
      ok(/class="betwrap"[\s\S]*HIT!/.test(ctx.T.betRow({ source: "account", id: "x", result: "W", pl: 5, cost: 10, toWin: 15, week: 5, title: "t", legs: [] })), "casino: the stamp sits on the bet row");
      ok(/card modelglow/.test(ctx.T.sgpBox({ key: "A @ B", sgp: { best: { legs: [{ label: "x", prob: .6 }, { label: "y", prob: .6 }], prob: .36 } } })), "casino: the same-game parlay card glows purple"); }
    { const pp = { legs: [{ label: "A", prob: .6, price: .5 }, { label: "B", prob: .6, price: .4 }], prob: .36 };
      const h = ctx.T.sgpBox({ key: "A @ B", sgp: { best: pp } });
      ok(/Polymarket 5\.0x · \$10 → \$50/.test(h) && /\$20 → \$100/.test(ctx.T.sgpBox({ key: "A @ B", sgp: { best: { ...pp, stake: 20 } } })) && /price not posted yet/.test(ctx.T.sgpBox({ key: "A @ B", sgp: { best: { ...pp, legs: [pp.legs[0], { label: "C", prob: .5, price: null }] } } })), "payout: legs' Polymarket prices multiplied (1/0.5 x 1/0.4 = 5x, $10 -> $50); a leg without a price says so"); }
    { const p = { legs: [{ label: "Bi.Robinson TD", prob: 0.62 }, { label: "ATL +3.5", prob: 0.581, rule: "KEY NUMBER" }], prob: 0.43 };
      const h = ctx.T.sgpBox({ key: "CHI @ ATL", sgp: { best: p, style: { ...p, prob: 0.05 } } });
      const h3 = ctx.T.sgpBox({ key: "CHI @ ATL", sgp: { best: p, three: { ...p, prob: 0.2 }, linked: { ...p, prob: 0.08 }, style: { ...p, prob: 0.05 } } });
      ok(h.includes("SAME-GAME PARLAYS") && /2 LEGS<\/div><div class="s" style="margin-bottom:3px"><b class="g">hits ~43%/.test(h) && h.includes("4 LEGS · MY STYLE") && h.includes("1 in 20") && h.includes("KEY NUMBER") && /3 LEGS[\s\S]*4 LEGS ·[\s\S]*MY STYLE/.test(h3), "same-game box: 2 / 3 / 4 legs and my style, each with its chance");
      ok(ctx.T.sgpBox({ key: "X @ Y", started: true, sgp: { best: p } }) === "", "same-game box: hidden once the game starts"); }
    { const g = { combos: [{ pick: "ATL +3.5", hit: 58.1, why: "KEY NUMBER: books at ATL +3" }, { pick: "CHI -2.5", hit: 57, why: "BOUNCE BACK: CHI missed" }, { pick: "ATL +2.5", hit: 50.2, why: "x" }, { pick: "Over 49.5", hit: 60, why: "y" }] };
      const n = ctx.T.splitNote(g, "spread", "ATL +3.5");
      ok(n.includes("CHI -2.5") && n.includes("BOUNCE BACK") && n.includes("57%"), "rules split: a green rule on the other side is named on the card");
      ok(ctx.T.splitNote({ combos: [g.combos[0], g.combos[2]] }, "spread", "ATL +3.5") === "", "rules split: no note when the other side is under 56%");
      ok(ctx.T.splitNote(g, "total", "Over 49.5") === "", "rules split: totals not mixed with spreads"); }
    ok(ctx.T.lineCheck({ key: "SEA @ DEN", away: "SEA", home: "DEN", history: [{ poly: { spread: { homeSpread: 2.5 } } }], lineNow: { hs: 2.5, tl: 40.5 } }, "spread", "DEN +3.5") === "", "line check: an alternate-line pick (KEY NUMBER +3.5 with the main line still +2.5) is not called a line move");
    ok(/Model: <b class="mod">46\.1<\/b>/.test(to) && /PICK: Under 46\.5 · <span class="reelpct" data-v="57%">57%<\/span>/.test(to) && /--gl:0\.45/.test(to) && /wind 10\+ · older teams/.test(to) && !/won 57%/.test(to) && !/40\.5/.test(to), "model card (total): one market-line pick with its reason, no teasers");
    { const U = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 } }, "spread"), V = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 } }, "total");
      ok(/Model: <b class="mod">GB by 2\.1<\/b>/.test(U) && /No pick/.test(U) && /Model: <b class="mod">43\.0<\/b>/.test(V) && /No pick/.test(V), "model card: shows the upgraded model's number; with no tested pick it says No pick");
      const E1 = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 }, modelEarly: 48.7, totalOpen: 46.5 }, "total"), E3 = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 }, modelEarly: 48.2, totalOpen: 46.5 }, "total"), E2 = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 44.5 }, modelEarly: 48.2, totalOpen: 46.5 }, "total");
      ok(!/Early-week/.test(E1) && !/Early-week/.test(E2) && !/Early-week/.test(E3), "total card: early-week edge is turned off (11-18 live)"); }
    { const G = { key: "CIN @ MIA", away: "CIN", home: "MIA", started: false, final: false, combos: [{ pick: "MIA +6.5", hit: 66.7, n: 3, why: "Underdog off a loss · 2–1 this season" }, { pick: "CIN -6.5", hit: 58.9, n: 73, why: "stats" }, { pick: "Over 44.5", hit: 57, n: 200, why: "x" }] };
      const P = ctx.T.straightPicks(G), G2 = { ...G, combos: [G.combos[0]] }, P2 = ctx.T.straightPicks(G2);
      ok(P[0].pick === "CIN -6.5" && !P.some((x) => x.pick === "MIA +6.5") && P2[0].pick === "MIA +6.5" && /3 games/.test(P2[0].why), "picks: a tested pick beats a small-sample one in its market; small-sample picks show their game count"); }
    { vm.runInContext(`S = { games: [{ key: "PHI @ JAX", away: "PHI", home: "JAX", kickoff: "2026-10-11T13:30:00Z", td: [{ player: "D.Cooper", team: "PHI" }] }, { key: "CHI @ GB", away: "CHI", home: "GB", kickoff: "2026-10-11T17:00:00Z", td: [{ player: "D.Swift", team: "CHI" }, { player: "J.Love", team: "GB" }] },
        { key: "SF @ SEA", away: "SF", home: "SEA", kickoff: "2026-10-11T20:25:00Z", td: [{ player: "C.McCaffrey", team: "SF" }] }, { key: "DET @ ARI", away: "DET", home: "ARI", kickoff: "2026-10-11T20:25:00Z", td: [{ player: "J.Love", team: "ARI" }] },
        { key: "BAL @ ATL", away: "BAL", home: "ATL", kickoff: "2026-10-12T00:20:00Z", badge: "SNF", td: [] }] }`, ctx);
      const sl = (labels) => ctx.T.betSlots({ picks: labels.map((label) => ({ label })) });
      ok(sl(["PHI +7.5", "Darius Cooper 1+ TD", "Over 42.5 · PHI @ JAX"]).join() === "Early (London / international)" && sl(["CHI -1.5", "D'Andre Swift 1+ TD", "Under 46.5 · CHI @ GB"]).join() === "Morning (10 AM)"
        && sl(["Christian McCaffrey 1+ TD", "ATL -3.5"]).length === 2 && sl(["Jeremiyah Love 1+ TD"]).length === 0, "bets: legs matched to kickoff slots (team, game, TD name); same short name on two teams stays unknown");
      const h = ctx.T.openBySlot([{ picks: [{ label: "CHI -1.5" }], legs: [], cost: 5, toWin: 10, price: 0.5, title: "x", result: "pending" }, { picks: [{ label: "CHI -1.5" }, { label: "BAL +3.5" }], legs: [], cost: 5, toWin: 20, price: 0.25, title: "y", result: "pending" }]);
      ok(/Open · Morning \(10 AM\)/.test(h) && /Open · Mixed times/.test(h) && /more than one time slot/.test(h) && /Morning \(10 AM\) \+ Prime time/.test(h), "bets: open bets listed by time slot, mixed ones in their own list with a warning"); }
    { vm.runInContext(`S = { games: [{ key: "CHI @ GB", away: "CHI", home: "GB", started: false, final: false, angles: [], combos: [{ pick: "Under 46.5", hit: 57, why: "wind" }, { pick: "GB +1.5", hit: 52, why: "x" }] }] }`, ctx);
      ok(ctx.T.legFlipped("Over 46.5 · CHI @ GB") && !ctx.T.legFlipped("Under 46.5 · CHI @ GB") && !ctx.T.legFlipped("CHI -1.5") && !ctx.T.legFlipped("Over 40.5 · NYG @ WAS"), "bets: a leg is flagged only when the app now has a 56%+ pick on the other side"); }
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
    const { spreadPick, totalPick } = await import("../lib/picks.js"); const { gradePaper } = await import("../lib/paper.js"); const { listAlerts } = await import("../lib/alerts.js"); const R = globalThis.__TEST_REDIS__;
    ok(spreadPick({ homeMargin: -3, calHomeCover: 52 }, 3, "AWY", "HOM").team === "HOM" && spreadPick({ homeMargin: -3, calHomeCover: 48 }, 3, "AWY", "HOM").team === "AWY" && spreadPick({ homeMargin: -3, calHomeCover: 50 }, 3, "AWY", "HOM") === null && spreadPick({ homeMargin: -3 }, 3, "AWY", "HOM") === null && spreadPick({ homeMargin: -5 }, 3, "AWY", "HOM").team === "AWY", "tie-break: spread side from the calibrated chance, none only with no lean at all, real gaps unchanged");
    ok(totalPick({ total: 43.5, calUnder: 50.5 }, 43.5).side === "under" && totalPick({ total: 43.5, calUnder: 49 }, 43.5).side === "over" && totalPick({ total: 43.5, calUnder: 50 }, 43.5) === null && totalPick({ total: 46 }, 43.5).side === "over", "tie-break: total side from the calibrated chance");
    const G = { key: "IND @ WAS", started: false, final: false, poly: { spread: { homeSpread: -3.5, home: 0.5, away: 0.52 }, total: { line: 47.5, over: 0.5, under: 0.5 } }, spreadPick: { side: "away", label: "IND +3.5" }, totalPick: { side: "over", label: "Over 47.5" },
      td: [ { player: "Q.Scorer", team: "IND", market: "m", price: 0.55, bid: 0.5, fair: 50 }, { player: "O.Out", team: "WAS", market: "m", price: 0.4, bid: 0.35, fair: 70, injury: "Out" }, { player: "T.Thin", team: "WAS", price: 0.2, bid: 0.01, fair: 80, thin: true } ] };
    const sg = { strategy: "best_2", legs: [{ game: "IND @ WAS", kind: "spread", team: "IND", label: "IND +3.5", price: 0.52 }, { game: "IND @ WAS", kind: "td", team: "IND", player: "Q.Scorer", label: "Q.Scorer TD", price: 0.55 }], pay: 3.5, prob: null };
    await R.del("alerts:2099"); await R.set("paper:2099:4:IND @ WAS", JSON.stringify({ season: 2099, week: 4, game: "IND @ WAS", parlays: [sg] }));
    await gradePaper(2099, 4, [{ key: "IND @ WAS", homeScore: 24, awayScore: 26 }], async () => ["Q.Scorer"]); await gradePaper(2099, 4, [{ key: "IND @ WAS", homeScore: 24, awayScore: 26 }], async () => ["Q.Scorer"]);
    const al = (await listAlerts(2099)).filter((a) => a.kind === "RESULT");
    ok(al.length === 1 && /Model parlay hit/.test(al[0].title) && /IND \+3\.5/.test(al[0].sub), "alerts: a decided model parlay posts one RESULT alert, not repeated");
    for (const k of await R.keys("paper:2099:*")) await R.del(k); await R.del("alerts:2099");
    // the pick list shows the card's pick
    vm.runInContext(`S = { week: 4, games: [ { key: "LA @ PHI", away: "LA", home: "PHI", started: false, winPct: 38.1, model: { homeMargin: -3, total: 43.5, calHomeCover: 48.8, calUnder: 50.5 }, poly: { ml: { home: 0.42, away: 0.6 }, spread: { homeSpread: 3, home: 0.51, away: 0.51 }, total: { line: 43.5, over: 0.51, under: 0.51 } } } ], winners: null, picks: null }`, ctx);
    ok(!/Spread <b>LA -3<\/b> <span class="dim">\(agrees\)/.test(ctx.T.winnersBox()) && /Spread <b>—<\/b>/.test(ctx.T.winnersBox()), "pick list: shows the CARD's pick (none here), never the game model's own side (review fix 10/14)"); }
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
  { // Model Picks: the model's parlays only (no single-game winners list), each type says how it was chosen
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "lab" ? box : old(id));
    vm.runInContext(`S = { week: 4, games: [], winners: { all: { n: 1, w: 1, l: 0, hit: 1 } } }; MB = null; RES = null; PAPER = { names: { model_best_4: "Model's 4 most likely legs", same_game_3: "Same game" }, board: {}, week: { week: 4, parlays: [ { strategy: "model_best_4", legs: [ { label: "H1 ML", game: "A @ H1", price: 0.8 }, { label: "H2 ML", game: "A @ H2", price: 0.8 } ], pay: 1.56, prob: 0.6 } ] } }`, ctx);
    ctx.T.renderLab(); ok(!/Parlay scoreboard/.test(box.innerHTML) && !/Your model's parlays/.test(box.innerHTML) && !/pays 1\.56x/.test(box.innerHTML), "model picks: the old weekly parlay list is gone and the scoreboard moved to the Models tab (10/15)");
    const sb = vm.runInContext("LAB_SB", ctx);
    ok(/THIS SEASON/.test(sb) && /PAST SEASONS/.test(sb) && /TOUCHDOWNS/.test(sb) && /4 most likely legs/.test(sb) && !/Same game<\/span>/.test(sb), "parlay scoreboard: grouped, only parlays still built (old cut ones hidden); built for the Models tab");
    ctx.document.getElementById = old; }
  { // Models tab: nine sections in order, each with a one-line meaning; the analysis helpers on real-shaped data
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "models" ? box : id === "export-btn" ? { onclick: null } : old(id));
    const res = [ { game: "A @ B", week: 3, ml: { pct: 82, result: "W" }, mlModel: { result: "W" }, spread: { basis: "model", result: "L" }, total: { basis: "model", result: "W" }, td: [ { team: "B", player: "P1", fair: 40, scored: true, played: true }, { team: "A", player: "P2", fair: 22, scored: false, played: true } ] },
      { game: "C @ D", week: 3, ml: { pct: 64, result: "L" }, mlModel: { result: "L" }, spread: { basis: "model", result: "W" }, total: { basis: "model", result: "W" }, td: [] },
      { game: "PIT @ CLE", week: 4, ml: { pct: 71, result: "W" }, spread: { basis: "model", result: "W" }, total: { basis: "model", result: "W" }, td: [] } ];
    vm.runInContext(`S = { week: 4, games: [], status: { ok: true, errors: [] }, weekCheck: { games: 16, withLines: 16, modelRun: true, watch: [] }, missFinder: null, winners: { all: { n: 3, w: 2, l: 1, hit: 0.67 } } }; MB = { summary: { wins: 0, losses: 0, pushes: 0, pl: 0 }, bets: [] }; PAPER = { names: {}, board: {}, week: null }; PICKS = null; EDGES = null; REPLAY = null; WINALL = false`, ctx);
    vm.runInContext(`RES = ${JSON.stringify(res)}`, ctx);
    ctx.T.renderModel(); const h = box.innerHTML;
    const order = ["★ Parlay scoreboard", "★ Picks recorded and graded", "1 · Scoreboard", "2 · Winners", "3 · Spreads and totals", "4 · Touchdowns", "5 · Tracked angles", "6 · Trends and analysis", "7 · Misses and every game", "8 · System"].map((x) => h.indexOf(x));
    ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])) && !/Price gaps/.test(h), "models tab: the parlay scoreboard and the recorded-picks list first, then the eight sections in order (Price gaps cut 10/13)");
    ok((h.match(/class="fold" data-drop="m-/g) || []).length === 10 && !/class="s dim" style="margin:2px 0 6px"/.test(h) && !/break-even/i.test(h), "models tab: ten sections (parlay scoreboard + recorded picks + the eight), no explanation lines, no break-even talk");
    ok(!/Hit rate by week/.test(h) && /Week 3/.test(h) && /Week 4/.test(h) && /Game-by-game results|id="gbg"/.test(h) && /Parlay scoreboard/.test(h), "models tab: every-game list present, the parlay scoreboard is in it (10/15), Hit rate by week cut 10/13");
    const bc = ctx.T.modelsByConfidence(res);
    ok(/Said 80\+% · 1 pick/.test(bc) && /Said 60–70% · 1 pick/.test(bc) && /100%/.test(bc), "models tab: confidence buckets use the chance the model said");
    ok(/None yet/.test(ctx.T.modelsByConfidence([])), "models tab: empty data says so");
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
    ok(!/Tested angle/.test(w({ outdoor: true, wind: 14 })) && !/Tested angle/.test(w({ outdoor: true, wind: 20 })), "windy-under note: removed from the card (tested, not added; review fix 10/14)");
    ok(!/★/.test(w({ outdoor: true, wind: 14 })), "total card: no extra angle note next to the PICK"); }
  vm.runInContext(`S = { week: 4, games: [] }; LIVE = {}; LIVE_T = null`, ctx);
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
  vm.runInContext(`S = { games: [{ key: "TEN @ BAL", away: "TEN", home: "BAL", started: false, winPct: 84.4, model: { homeMargin: 12, total: 40 }, poly: { ml: { home: 0.82, away: 0.2 }, spread: { homeSpread: -10.5, home: 0.5, away: 0.51 }, total: { line: 41.5, over: 0.5, under: 0.51 } } },
    { key: "KC @ LV", away: "KC", home: "LV", started: false, winPct: 28, poly: { ml: { home: 0.3, away: 0.72 } } },
    { key: "X @ Y", away: "X", home: "Y", started: true, winPct: 60 }], winners: { all: { n: 10, w: 7, l: 3, hit: 0.7, said: 0.68 }, top4: { n: 4, w: 4, l: 0, hit: 1, said: 0.8 } } }`, ctx);
  const box = ctx.T.winnersBox();
  ok(box.indexOf("BAL") < box.indexOf("KC") && /1\. <b>BAL<\/b> over TEN/.test(box) && /2\. <b>KC<\/b> over LV/.test(box) && !/X over Y/.test(box), "page: ranked by chance, started games left out");
  vm.runInContext(`S.games[0].td = [{ player: "D.Henry", fair: 58, injury: "" }, { player: "Out.Guy", fair: 90, injury: "Out" }, { player: "L.Jackson", fair: 41 }]`, ctx);
  ok(/TD <b>D\.Henry 58%<\/b>/.test(ctx.T.winnersBox()), "page: touchdown side is the most likely scorer who is not out");
  ok(/84%/.test(box) && /82¢/.test(box) && !/7–3/.test(box), "page: picks show chance and price");
  ok(/Spread <b>—<\/b> · Total <b>—<\/b> · TD <b>/.test(box) && !/BAL -10\.5/.test(box), "page: each game shows the card's spread / total pick (none here) and the touchdown side -- not the game model's own side");
  }
console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(bad ? 1 : 0);
