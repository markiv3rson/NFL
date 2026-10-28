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
{ const cal = buildCalibration(Array.from({ length: 4 }, (_, i) => ({ week: 4 + i, td: Array.from({ length: 60 }, (_, j) => ({ fair: 40, scored: j < 12, played: true })) })));   // 10/27: a band that scored 20% vs said 40
  const cm = await import("../lib/calibration.js");
  ok(cm.TD_CAL_ON === false && applyCalibration(40, cal) === 40 && cm.FTD_CAL_ON === false && cal.ftd.on === false, "TD calibration (10/27): the live layer is off -- a shown chance is the model's own (walk-forward: every correction strength scored worse than none)"); }
{ const { tdBlend } = await import("../lib/calibration.js");
  ok(Math.abs(tdBlend(40, 0.52, 0.50, false) - 45.5) < 1e-9 && tdBlend(40, 0.52, 0.40, false) === 40 && tdBlend(40, 0.52, 0.50, true) === 40 && tdBlend(40, 0.52, null, false) === 40 && tdBlend(40, 0.99, 0.0, false) === 40,
    "TD blend (10/27): half the model, half the market's mid on a real book (two-sided, 5c wide or less, not thin); otherwise the model's own %"); }
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
{ const { addAlert, listAlerts, alertsFromRerun, alertsFromLines } = await import("../lib/alerts.js");
  const g = { key: "PIT @ CLE", away: "PIT", home: "CLE" };
  ok(await addAlert(2026, { kind: "INJURY", game: g.key, title: "CLE: Jenkins ruled out" }) === 1 && await addAlert(2026, { kind: "INJURY", game: g.key, title: "CLE: Jenkins ruled out" }) === 0, "alerts: the same alert twice is kept once");
  const old = { homeMargin: 3.1, homeWinPct: 60, inj: { home: { players: [] }, away: { players: [] } }, fix: {}, wind: 5, outdoor: true };
  const nw = { homeMargin: 2.3, homeWinPct: 59, inj: { home: { players: [{ name: "Jenkins", status: "Out" }] }, away: { players: [] } }, fix: { awayQbFirstStart: true }, wind: 14, outdoor: true };
  const n = await alertsFromRerun(2026, g, old, nw), all = await listAlerts(2026);
  ok(n === 2 && all.some((a) => a.kind === "INJURY" && /Jenkins ruled out/.test(a.title) && a.team === "CLE" && /CLE by 2\.3 \(was CLE by 3\.1\)/.test(a.sub)), "alerts: a new injury says who and how the model moved", all);
  ok(all.some((a) => a.kind === "QB CHANGE") && !all.some((a) => a.kind === "WEATHER"), "alerts: backup QB shows; the wind alert was cut 10/15");
  ok(await alertsFromRerun(2026, g, null, nw) === 0 && await alertsFromRerun(2026, g, nw, nw) === 0, "alerts: the first run of a week, or an unchanged run, adds nothing");
  ok(await alertsFromRerun(2026, { key: "A @ B", away: "A", home: "B" }, { homeMargin: 1.2, homeWinPct: 54, inj: {}, fix: {} }, { homeMargin: -1.5, homeWinPct: 47, inj: {}, fix: {} }) === 0, "alerts: model-move alerts were cut 10/13 (the model flipping sides adds nothing)");
  const lm = await alertsFromLines(2026, g, { spread: { homeSpread: 3 }, total: { line: 38.5 }, ml: { home: 0.40 } }, { spread: { homeSpread: 2.5 }, total: { line: 38.5 }, ml: { home: 0.41 } });
  ok(lm === 1 && (await listAlerts(2026))[0].title === "PIT @ CLE spread: CLE +3 → +2.5", "alerts: a half-point spread move, but not a 1-cent price move");
  ok(await addAlert(2026, { kind: "RESULT", game: "TEN @ BAL", title: "Final: TEN 13 @ BAL 27" }) === 0 && !(await import("../lib/alerts.js")).alertResult && !(await import("../lib/alerts.js")).listResults, "alerts (cleanup 10/18): RESULT lines are no longer saved; the Final alert and the results reader are gone"); }
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
{ const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, appendChild() {}, style: {}, set innerHTML(v) {}, set textContent(v) {}, addEventListener() {} });
  const store = { lastSeen: "2026-10-01T12:00:00Z" };
  const ctx = { document: { getElementById: () => el(), querySelectorAll: () => [], addEventListener() {}, hidden: false, createElement: () => el(), body: el(), documentElement: el() }, fetch: () => Promise.reject(new Error("offline")),
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) }, location: { reload() {}, hash: "" }, history: { replaceState() {} }, setTimeout, clearTimeout, console, Date, Math, Number, String, JSON, Promise, Set, Object, Array };
  ctx.window = ctx; ctx.addEventListener = () => {}; ctx.body = undefined;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), ctx);   // 10/17: the shared menu / header script loads first, as on the page
  vm.runInContext(readFileSync(new URL("../public/app.js", import.meta.url), "utf8") + "\n;globalThis.T={pickRes,tdNameEq,recTile,tdWeekGames,injLine,mktHome,tdPct,plural,pBlock,plPay,linkedPay,plTap,plShown,plKey,PLC,sgpBox,labParlays,renderLabList,logoLabel,tdTeam,legName,moreBox,slotOf,parlayPicks,parlayStrip,lineCheck,recLine,bestBets,injTag,weakLeg,kickLine,tdNoGap,tdHead,tdWeekLine,tdDrought,tdWarn,propLast,trackedRows,renderLines,firstTdRecord,tdPlayersWithDefense,tdByPosition,tdByDefense,tdGroupRow,earlyNote,leanCell,betRow,moveBits,winnersBox,winnerOf,tile,tdRow,gameCard,totalCard,detailTop,renderMine,gbgHtml,renderLab,renderModel,renderTd,betsSummary,cardRecBox,legPct,cardBody,betsAnalysis,keepOpenState,winnersBands,mSec,legFlipped,betSlots,openBySlot,straightPicks,sgpBox,glowOf,betRow,isSingle,singleGame};", ctx);
  const T = ctx.T;
  let g = { away: "DAL", home: "PHI", model: { homeMargin: 4.2, fix: {} }, poly: { spread: { homeSpread: -3.5 } } };
  g = { away: "A", home: "H", model: { total: 44.4, fix: { dome: 2.59, pace: 0.1, div: true } }, poly: { total: { line: 45.5 } } };
  g = { away: "A", home: "H", winPct: 61.2, model: { homeMargin: 3, total: 44, fix: {} }, spreadPick: { label: "H -2.5", pct: 51.1 }, poly: {} };
{ const c = T.leanCell(g, "spread"); ok(/Model:<\/span> <b class="mod">H by 3\.0<\/b>/.test(c) && /No pick/.test(c) && /No tested edge/.test(c) && !/LEAN/.test(c), "model card: no tested pick -> No pick (the model's own side is a coin flip vs the line, not shown as a lean)");
  { const c2 = T.leanCell({ ...g, combos: [{ kind: "spread", pick: "A +2.5", hit: 54.4, why: "road dog" }] }, "spread"); ok(/Pick:<\/span> A \+2\.5 · 54%/.test(c2) && !/road dog/.test(c2) && !/LEAN/.test(c2), "model card: below 56% the best tested pick shows as a yellow PICK with no notes"); } }
  ok(/Push leg/.test(T.betRow({ source: "preloaded", legs: [{ result: "W", kind: "total", side: "under", line: 43 }, { result: "P", kind: "total", side: "over", line: 44 }], result: "P", pushUnconfirmed: true, cost: 5, toWin: 20, pl: null })), "combo push wording");
  vm.runInContext(`S = { games: [{ key: "DAL @ PHI", away: "DAL", home: "PHI", started: false, poly: { spread: { homeSpread: -4 }, total: { line: 45.5 }, ml: { home: 0.66 } },
    history: [{ t: "2026-10-01T10:00:00Z", poly: { spread: { homeSpread: -3 }, total: { line: 45.5 }, ml: { home: 0.60 } } }] }] }`, ctx);
  { const G0 = vm.runInContext("S.games[0]", ctx), bits = T.moveBits(G0); ok(bits.length === 2 && /spread PHI -3 → -4/.test(bits[0]) && /moneyline 60¢ → 66¢/.test(bits[1]) && /class="mvt"><span>spread PHI -3 → -4<\/span>/.test(T.tile(G0)), "what changed (10/18 night): the game's moves sit inside its tile, one line each"); }
  // 10/26 reason box on the page: the game's own lines with their marks sit on top of the MODEL ⓘ box, then the glossary; no lines -> the glossary alone
  vm.runInContext(`S.games[0].why = { spread: [["Pick:", "DAL -4 · 61% · TEAM MODEL rule", 1], ["Line:", "unchanged", 0]], total: [], ml: [["ML pick:", "none: a <b>test</b>", -1]] }`, ctx);
  const G0 = vm.runInContext("S.games[0]", ctx), html = T.gameCard(G0, 0), tot = T.totalCard(G0, 0);
  ok(/<div class="ibox" hidden><div class="wh">THIS GAME · \+ for the pick · − against<\/div><div><span class="wm wf">\+<\/span><b>Pick:<\/b> DAL -4 · 61% · TEAM MODEL rule<\/div><div><span class="wm">·<\/span><b>Line:<\/b> unchanged<\/div><div><span class="wm wa">−<\/span><b>ML pick:<\/b> none: a &lt;b>test&lt;\/b><\/div><div class="wsep"><\/div><div><b>Model:<\/b>/.test(html), "reason box on the spread card: marks, escaped text, then the glossary", (html.match(/<div class="ibox"[^]{0,400}/) || [html.slice(Math.max(0, html.indexOf("ibox") - 15), html.indexOf("ibox") + 500)])[0]);
  ok(/<div class="ibox" hidden><div><b>Model:<\/b>/.test(tot), "reason box: a market with no lines shows the glossary alone");
  vm.runInContext(`delete S.games[0].why`, ctx);
  globalThis.__ctx = ctx; }

// ---------- Parlay Lab (paper parlays)
{ // Best bets parlays (10/10): 56%+ straight picks (combos + angles, no teasers), one per game, priced from Polymarket
  const { buildPaper } = await import("../lib/paper.js");
  const { buildCard } = await import("../lib/cardpick.js");
  const gg = (k, home, away, combos) => { const poly = { spread: { homeSpread: -3.5, home: 0.5, away: 0.5 }, total: { line: 44.5, over: 0.5, under: 0.5 }, ml: { home: 0.6, away: 0.4 } }, g0 = { key: k, home, away, started: false, final: false, td: [], angles: [], combos, poly };
    return { ...g0, card: buildCard(g0, combos.map((c) => ({ id: "linemove|x", ...c })), poly, null, null) }; };   // 10/15: fixtures count as tested-rule picks (the card shows no chooser picks)
  const P = buildPaper({ games: [gg("A @ B", "B", "A", [{ pick: "A +3.5", hit: 62 }, { pick: "Over 40.5", hit: 80, teaser: true }]), gg("C @ D", "D", "C", [{ pick: "Under 44.5", hit: 58 }]),
    gg("E @ F", "F", "E", [{ pick: "F -3.5", hit: 52 }]), gg("G @ H", "H", "G", [{ pick: "H -3.5", hit: 70 }])] });
  const b2 = P.find((p) => p.strategy === "best_2"), b3 = P.find((p) => p.strategy === "best_3"), b4 = P.find((p) => p.strategy === "best_4");
  ok(b2 && b2.legs.map((l) => l.label).join(",") === "H -3.5,A +3.5" && b3 && b3.legs.length === 3 && !b4 && !b3.legs.some((l) => /40\.5|F -3\.5/.test(l.label)) && Math.abs(b2.pay - 4 * 0.977) < 1e-9,
    "best-bets parlays: the card's PICK at Polymarket's line, green = win % 3+ above the price, one per game, no teasers, none when too few"); }
{ const { startersOut } = await import("../lib/snaps.js");
  const sn = { "Joe QB": { name: "Joe QB", pos: "QB", weeks: { 1: 1, 2: 1 }, dweeks: { 1: 0, 2: 0 } }, "Al CB": { name: "Al CB", pos: "CB", weeks: { 1: 0, 2: 0 }, dweeks: { 1: 0.9, 2: 0.8 } },
    "Bo CB": { name: "Bo CB", pos: "CB", weeks: { 1: 0 }, dweeks: { 1: 0.3 } }, "Cy S": { name: "Cy S", pos: "S", weeks: { 1: 0, 2: 0 }, dweeks: { 1: 1, 2: 0.95 } } };
  const o = startersOut(sn, [{ name: "Joe QB Jr.", status: "Out", week: 3 }, { name: "Al CB", status: "Doubtful", week: 3 }, { name: "Bo CB", status: "Out", week: 3 }, { name: "Cy S", status: "Questionable", week: 3 }], 3);
  ok(o.qb === 1 && o.db === 1 && o.sk === 0, "starters out: Out/Doubtful 60%+ starters only, by group, names matched across suffixes"); }
{ const S5 = await import("../lib/stack.js");
  const P5 = S5.movePicks({ key: "CHI @ GB", away: "CHI", home: "GB", outdoor: true, kickoff: "2026-10-11T17:00:00Z" }, { homeMargin: -2, total: 44, wind: 0, temp: 60, fix: {}, xf: { s: { gbm: 3, ens: 3 }, t: { ens: -2 } } }, 1.5, 46.5, null, null, null, 5);
  ok(Array.isArray(P5) && P5.every((p) => p.id === "movepred|total") && !S5.tablePicks && !S5.useTable, "model picks (10/16): only TOTAL MOVE comes from the model side; the chooser and the scanned combo table are gone"); }
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
  const main = keyNumberPick(G, sp(-3.5, 0.48, 0.53), bk(-2.5)), alt = keyNumberPick(G, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.56 }]);
  const homeDog = keyNumberPick(G, sp(2.5), bk(2.5), [{ team: "LA", line: 3.5, price: 0.55 }]);
  ok(main && main.pick === "BUF +3.5" && main.price === 0.53 && alt && alt.pick === "BUF +3.5" && alt.price === 0.56 && homeDog && homeDog.pick === "LA +3.5"
    && !keyNumberPick(G, sp(-2.5), bk(-2.5)) && !keyNumberPick(G, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.95 }])
    && gradeStackPick({ ...main, home: "LA" }, 24, 21) === "W" && gradeStackPick({ ...main, home: "LA" }, 28, 21) === "L",
    "key number: books at 2.5 -> underdog +3.5 on Polymarket (main or alternate); wins when the favorite wins by exactly 3");
  const k25 = keyNumberPick(G, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.6 }]);
  ok(k25 && k25.pick === "BUF +3.5" && k25.hit === 56.9 && /books at BUF \+2\.5/.test(k25.why) && !keyNumberPick(G, sp(-2.5), bk(-3), [{ team: "BUF", line: 3.5, price: 0.6 }]) && !keyNumberPick(G, sp(-2.5), bk(-2)),
    "key number: books at 2.5 -> underdog +3.5 at 56.9% (10/19: books 3 cut -- 55.3% at the open; books 2 is not a pick)");
  const k15 = keyNumberPick(G, sp(-1.5), bk(-1.5), [{ team: "BUF", line: 3.5, price: 0.66 }]), k35 = keyNumberPick(G, sp(-3.5), bk(-3.5), [{ team: "BUF", line: 5.5, price: 0.6 }, { team: "LA", line: -2.5, price: 0.58 }]), k35f = keyNumberPick(G, sp(-3.5), bk(-3.5), [{ team: "LA", line: -2.5, price: 0.58 }]);
  ok(k15 && k15.pick === "BUF +3.5" && k15.hit === 63.0 && k15.price === 0.66 && k35 && k35.pick === "BUF +5.5" && k35.hit === 56.6 && k35.line === 5.5 && k35.price === 0.6 && /BEAT THE 5/.test(k35.why) && !k35f
    && !keyNumberPick(G, sp(-3.5), bk(-3.5), [{ team: "BUF", line: 3.5, price: 0.4 }])
    && gradeStackPick({ ...k35, home: "LA" }, 24, 21) === "W" && gradeStackPick({ ...k35, home: "LA" }, 30, 21) === "L" && gradeStackPick({ ...k15, home: "LA" }, 23, 21) === "W",
    "BEAT THE 3: books 1.5 -> dog +3.5 at 63.0%; books 3.5 -> dog +5.5 (2 points); the favorite -2.5 there is cut (10/19)");
  const k1 = keyNumberPick(G, sp(-1.5), bk(-1), [{ team: "BUF", line: 3.5, price: 0.7 }]);
  ok(k1 && k1.pick === "BUF +3.5" && k1.hit === 59.9 && !keyNumberPick(G, sp(-1.5), bk(-2), [{ team: "BUF", line: 3.5, price: 0.6 }]) && !keyNumberPick(G, sp(-3.5), bk(-4), [{ team: "LA", line: -2.5, price: 0.6 }]) && !keyNumberPick(G, sp(-3.5), bk(-5), [{ team: "LA", line: -2.5, price: 0.6 }]),
    "BEAT THE 3: books 1 -> dog +3.5 at 59.9% (buys 2.5); books 2 / 4 / 5 favorite tiers cut (10/19)");
  const { BUY_TIERS } = await import("../lib/stack.js");
  const day = { ...G, kickoff: "2026-10-18T17:00:00Z" }, snf = { ...G, kickoff: "2026-10-19T00:20:00Z" };
  { const kd = keyNumberPick(day, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.6 }]), kt = keyNumberPick(snf, sp(-2.5), bk(-2.5), [{ team: "BUF", line: 3.5, price: 0.6 }]);
    ok(kd && kt && kd.hit === 56.9 && kt.hit === 56.9 && kd.n === kt.n && !kt.night && !/night/.test(kt.why), "BEAT THE 3: a night game shows the same all-games rate as a day game (books 2.5: 56.9%)", { kd, kt }); }
  const t45 = keyNumberPick(day, sp(-4.5), bk(-4.5), [{ team: "LA", line: -2.5, price: 0.66 }]), t55 = keyNumberPick(day, sp(-5.5), bk(-5.5), [{ team: "BUF", line: 7.5, price: 0.64 }]), t135 = keyNumberPick(day, sp(-13.5), bk(-13.5), [{ team: "BUF", line: 14.5, price: 0.6 }]);
  const gone = [[-6, "BUF", 7.5], [-6.5, "BUF", 8.5], [-8, "LA", -5.5], [-6.5, "LA", -2.5], [-9, "LA", -6.5], [-7, "LA", -5.5], [-7.5, "LA", -5.5], [-6, "LA", -3.5], [-2, "LA", -0.5]].map(([b, team, line]) => keyNumberPick(day, sp(b), bk(b), [{ team, line, price: 0.6 }]));
  ok(!t45 && t55 && t55.pick === "BUF +7.5" && t55.hit === 56.1 && /BEAT THE 7/.test(t55.why)
    && !t135 && gone.every((x) => !x)
    && Object.keys(BUY_TIERS).length === 5 && Object.values(BUY_TIERS).every((T) => T.side === "dog") && Object.entries(BUY_TIERS).every(([A, T]) => Math.abs(T.line) - +A <= 3.5),
    "BEAT THE (10/19): 5 underdog tiers -- books 1, 1.5, 2.5, 3.5, 5.5; every favorite tier, books 3 and (10/20, failed a second line source) books 13.5 cut; never more than 3.5 points", { t45, t55 });
  { const { ruleRecords } = await import("../lib/stack.js"), kick = [{ id: "modelpick|total", kind: "total", hit: 51.7, week: 6, game: "A @ B", result: "W", t: "2" }, { id: "keynum|spread", hit: 58, week: 6, game: "A @ B", result: "L", t: "2" }],
      first = [{ id: "modelpick|total", kind: "total", hit: 51.7, week: 6, game: "A @ B", result: "L", t: "1" }, { id: "keynum|spread", hit: 58, week: 6, game: "A @ B", result: "W", t: "1" }], rr = ruleRecords(kick, first);
    ok(rr["MODEL SIDE · total"].w === 1 && rr["MODEL SIDE · total"].l === 0 && rr["BEAT THE"].w === 1 && rr["BEAT THE"].l === 0, "rule records (10/18 fix): card picks count as locked at kickoff (= Card picks rows); timing rules keep the first-shown pick", rr); }
  { const { ruleRecords, ruleFlag } = await import("../lib/stack.js"), mk = (g, res, t, o = {}) => ({ id: "keynum|spread", tier: 3, hit: 55.6, week: 6, game: g, result: res, t, ...o });
    const rows = Array.from({ length: 16 }, (_, i) => mk(`G${i}`, i < 4 ? "W" : "L", "2"));   // 4-12 = 25%
    const seen = [mk("G0", "L", "1", { id: "chooser|spread" })];   // chooser picks are not green rules -> ignored
    const green = Array.from({ length: 16 }, (_, i) => mk(`H${i}`, i < 4 ? "W" : "L", "2", { hit: 60 })), r = ruleRecords(green, [mk("H0", "L", "1", { hit: 60 })]);
    { const avg = ruleRecords([mk("A1", "W", "2", { hit: 57 }), mk("A2", "L", "2", { hit: 61 })], [])["BEAT THE 3 · books 3"];
      ok(avg && avg.say === 59 && avg.sn === undefined, "rule records (10/19 fix): 'card says' = the average of the picks' % (57 and 61 -> 59), not the last one", avg); }
    ok(ruleFlag(4, 12, 60) === "BELOW" && ruleFlag(9, 7, 60) === "OK" && ruleFlag(1, 5, 60) === "TOO FEW" && Object.keys(ruleRecords(rows.slice(0, 4).concat(seen), seen)).length === 1 && ruleRecords(rows, seen)["BEAT THE 3 · books 3"].say === 55.6
      && r["BEAT THE 3 · books 3"] && r["BEAT THE 3 · books 3"].w + r["BEAT THE 3 · books 3"].l === 16 && r["BEAT THE 3 · books 3"].w === 3 && r["BEAT THE 3 · books 3"].flag === "BELOW",
      "live rule records: each pick once at its first-shown line, flagged BELOW only with 15+ graded and 10+ points under the card", r); }
  { const { mode } = await import("../lib/books.js");
    ok(mode([-1.5, -1.5, -1, -1, -1, 0, 0, 0, 1]) === -1 && mode([4.5, 4.5, 4.5, 5.5, 5.5]) === 4.5 && mode([3, 3, 2.5]) === 3 && mode([-3, -3.5]) === -3 && mode([7]) === 7,
      "books consensus: most common number; a tie goes to the number nearest the middle of all books (CAR @ PHI 0 vs -1)"); }
  { const kp = keyNumberPick(day, sp(-5.5), bk(-5.5), [{ team: "BUF", line: 7.5, price: 0.64 }]);
    ok(kp && kp.plain === 54.5, "bought-point pick carries how often it wins without the extra points (54.5% at books 5.5)", { kp }); }
}
{ const { noteFirstSeen, recordStack, skey } = await import("../lib/stack.js"); const { getRedis } = await import("../lib/redis.js"); const G = { home: "DEN", away: "SEA", key: "SEA @ DEN" };
  await noteFirstSeen(2099, 6, G, [{ id: "keynumber|spread", team: "DEN", line: 3.5, kind: "spread" }], "2099-10-14T00:00:00Z");
  await noteFirstSeen(2099, 6, G, [{ id: "keynumber|spread", team: "DEN", line: 2.5, kind: "spread" }], "2099-10-15T00:00:00Z");   // later sighting must not overwrite
  await recordStack(2099, 6, G, [{ id: "keynumber|spread", team: "DEN", line: 2.5, kind: "spread", hit: 58.1 }], "2099-10-16T00:00:00Z");
  const rec = JSON.parse(await getRedis().hget(skey(2099, 6), "SEA @ DEN|keynumber|spread"));
  ok(rec.first && rec.first.line === 3.5 && rec.line === 2.5, "CLV: kickoff record keeps the line first SHOWN during the week (not the kickoff line)", rec); }
// 10/21 STACK shadow (owner, option A): the stack model's math equals the Python fit, the inputs carry the research signs, the record is rewritten until kickoff and graded
{ const { stackProb, stackInputs, stackLine, STACK_CUT } = await import("../lib/stackmodel.js"); const { STACK_MODEL } = await import("../lib/stack_model_data.js");
  const ref = { gm_edge: -5.4677, gm_tedge: -0.6743, tm_n: -0.112, td_d: -0.2037, td_s: 2.6167, tdtop_h: 0.4098, tdtop_a: 0.4102, py_d: 38.4576, py_s: 665.083, rec_yds_h: 251.6205, rec_yds_a: 169.373, r_bounce: 0, r_floordog: 0, r_beatthe: 0, mv_sp: 0.5, mv_to: -3, rest_d: 0, dome: 0, div_game: 0, spread: 7.5, total_line: 42.5 };
  ok(near(stackProb(ref), 0.418715, 2e-4) && stackProb({ ...ref, td_d: null }) === null && stackProb(null) === null, "STACK: the site's probability equals the Python fit on a training row (0.4187); a missing input gives nothing", stackProb(ref));
  ok(STACK_MODEL.cols.length === 19 && STACK_MODEL.coef.length === 19 && STACK_CUT > 0.05 && STACK_CUT < 0.2 && STACK_MODEL.bands.confident.hit > STACK_MODEL.bands.under.hit, "STACK: 19 inputs, a confidence cut, the confident band wins more than the rest (the honest % shown)");
  const G = { key: "KC @ BUF", home: "BUF", away: "KC" }, td = { home: [{ fair: 40 }, { fair: 30 }], away: [{ fair: 50 }, { fair: 10 }] }, yards = { home: { py: 380, rec: 250 }, away: { py: 340, rec: 230 } };
  const x = stackInputs({ g: G, hs: -3.5, tl: 47.5, hsOpen: -3, tlOpen: 46.5, mar: 5, tot: 49, tmP: 0.56, td, yards, picks: [{ id: "bounceback|spread", team: "KC" }, { id: "floordog|spread", team: "BUF" }], hb: -3.5, homeRest: 10, awayRest: 7, outdoor: false, div: true });
  ok(x && x.spread === 3.5 && near(x.gm_edge, 1.5) && near(x.gm_tedge, 1.5) && near(x.tm_n, 0.06) && near(x.td_d, 0.1) && near(x.td_s, 1.3) && near(x.tdtop_h, 0.4) && near(x.tdtop_a, 0.5) && x.py_d === 40 && x.rec_yds_h === 250 && x.r_bounce === -1 && x.r_floordog === 1 && x.r_beatthe === -1 && near(x.mv_sp, 0.5) && near(x.mv_to, 1) && x.rest_d === 3 && x.dome === 1 && x.div_game === 1,
    "STACK inputs: home-favored spread, model edges vs the line, TD sums in units (fair / 100), yards, BOUNCE BACK = the road side, BOUNCE BACK DOG by team, BEAT THE = the dog side, moves open -> now, rest, dome, division", x);
  ok(stackInputs({ g: G, hs: -3.5, tl: 47.5, mar: 5, tot: 49, tmP: 0.56, td, yards: null }) === null && stackInputs({ g: G, hs: 0, tl: 47.5, mar: 5, tot: 49, tmP: 0.56, td, yards }) === null && stackInputs({ g: G, hs: -3.5, tl: 47.5, mar: 5, tot: 49, tmP: null, td, yards }) === null, "STACK inputs: no yards / a pick'em / no TEAM MODEL number -> no line");
  const sl = stackLine(G, -3.5, x); ok(sl && sl.id === "stack|spread" && [G.home, G.away].includes(sl.team) && sl.line === (sl.team === G.home ? -3.5 : 3.5) && /^(BUF -3\.5|KC \+3\.5)$/.test(sl.pick) && sl.confident === (sl.conf >= STACK_CUT) && sl.pct === (sl.confident ? STACK_MODEL.bands.confident.hit : STACK_MODEL.bands.under.hit) && sl.model === true,
    "STACK line: the side it leans to at the newest line, its confidence against the cut, the band's honest %", sl);
  const { recordStackShadow, gradeTrackedWeek, trackedSummary } = await import("../lib/tracked.js"); const { getRedis } = await import("../lib/redis.js");
  const G2 = { key: "KC @ BUF", home: "BUF", away: "KC", week: 7 };
  await recordStackShadow(2096, 7, G2, { team: "BUF", line: -3.5, p: 0.61, conf: 0.11, confident: true, pct: 56.2 }, "2096-10-20T12:00:00Z");
  await recordStackShadow(2096, 7, G2, { team: "KC", line: 2.5, p: 0.47, conf: 0.03, confident: false, pct: 52.8 }, "2096-10-21T12:00:00Z");
  const sv = JSON.parse(await getRedis().hget("teaser:2096:7", "KC @ BUF|stack"));
  ok(sv.team === "KC" && sv.line === 2.5 && sv.confident === false && sv.first && sv.first.team === "BUF" && sv.first.line === -3.5, "STACK shadow: rewritten on every build until kickoff, the first sighting kept", sv);
  await gradeTrackedWeek(2096, 7, [{ key: "KC @ BUF", home: "BUF", away: "KC", homeScore: 20, awayScore: 24 }]);
  const sv2 = JSON.parse(await getRedis().hget("teaser:2096:7", "KC @ BUF|stack")); const r3 = await recordStackShadow(2096, 7, G2, { team: "BUF", line: -3.5, p: 0.6, conf: 0.1, confident: true, pct: 56.2 }, "z");
  const sm = await trackedSummary(2096);
  ok(sv2.result === "W" && r3 === 0 && sm.stack && sm.stack.n === 1 && sm.stack.w === 1 && sm.stack.rest.n === 1 && sm.stack.confident.n === 0 && sm.stack.said === 52.8, "STACK shadow: graded from the final (KC +2.5 won), never rewritten after grading, summary splits confident / rest with the said %", sm.stack);
  await getRedis().del("teaser:2096:7");
  const wk = readFileSync(new URL("../lib/week.js", import.meta.url), "utf8"), rr = readFileSync(new URL("../pages/api/rerun.js", import.meta.url), "utf8"), ap = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), gm = readFileSync(new URL("../lib/games.js", import.meta.url), "utf8"), py = readFileSync(new URL("../railway-model-service/app.py", import.meta.url), "utf8");
  ok(/G\.stackSide = await stackFor\(G\)/.test(wk) && wk.indexOf("G.stackSide = await stackFor(G)") < wk.indexOf("G.card = buildCard(G") && /recordStackShadow\(season, wk, G, sl/.test(wk) && /stackin:\$\{season\}:\$\{wk\}:\$\{G\.key\}/.test(wk) && /\/team-yards/.test(rr) && /stackin:\$\{season\}:\$\{week\}:\$\{q\.key\}/.test(rr) && /Model \(Stack\):<\/span> <b class="mod">/.test(ap) && /STACK \(shadow\)/.test(ap) && /homeRest:/.test(gm) && /@app\.route\("\/team-yards"/.test(py),
    "STACK: the slate builds the line and records the shadow, the rerun saves the prop model's team yards, the card shows the purple Model (Stack) line, Models lists the row, the schedule carries rest days, the service has the route"); }
{ // 10/27 WIDE MODEL shadow: recorded per game and rewritten until kickoff (first kept), graded with the tracked legs, summed confident / rest; one service call per build, cached while the lines hold
  const { recordWideShadow, gradeTrackedWeek, trackedSummary } = await import("../lib/tracked.js"), { widePicks, wideInputs, WIDE_TTL } = await import("../lib/wide.js"), { getRedis, getJSON } = await import("../lib/redis.js");
  const G = { key: "CAR @ GB", home: "GB", away: "CAR" };
  await recordWideShadow(2095, 8, G, { team: "CAR", line: 3.5, p: 0.37, conf: 0.13, confident: true, thr: 0.05 }, "2095-10-27T10:00:00Z");
  await recordWideShadow(2095, 8, G, { team: "CAR", line: 4.5, p: 0.36, conf: 0.14, confident: true, thr: 0.05 }, "2095-10-29T10:00:00Z");
  await recordWideShadow(2095, 8, { key: "BAL @ BUF", home: "BUF", away: "BAL" }, { team: "BUF", line: -3.5, p: 0.51, conf: 0.01, confident: false, thr: 0.05 }, "2095-10-29T10:00:00Z");
  const sv = JSON.parse(await getRedis().hget("teaser:2095:8", "CAR @ GB|wide"));
  ok(sv.wide === true && sv.kind === "spread" && sv.team === "CAR" && sv.line === 4.5 && sv.confident === true && sv.first && sv.first.line === 3.5 && sv.first.t === "2095-10-27T10:00:00Z", "WIDE shadow: the last copy before kickoff is the record, the first sighting kept", sv);
  await gradeTrackedWeek(2095, 8, [{ key: "CAR @ GB", home: "GB", away: "CAR", homeScore: 27, awayScore: 24 }, { key: "BAL @ BUF", home: "BUF", away: "BAL", homeScore: 20, awayScore: 27 }]);
  const T = await trackedSummary(2095);
  ok(T.wide && T.wide.n === 2 && T.wide.w === 1 && T.wide.l === 1 && T.wide.confident.n === 1 && T.wide.confident.w === 1 && T.wide.rest.n === 1 && T.wide.rest.l === 1, "WIDE shadow: CAR +4.5 wins (lost by 3), BUF -3.5 loses; confident 1-0, rest 0-1", T.wide);
  const g0 = { key: "CAR @ GB", home: "GB", away: "CAR", started: false, week: 8, lineNow: { hs: -3.5, tl: 47.5 }, open: { spread: { homeSpread: -2.5 }, total: { line: 46.5 } } };
  ok(JSON.stringify(wideInputs(2095, 8, [g0, { ...g0, key: "X @ Y", started: true }, { ...g0, key: "A @ B", lineNow: null }])) === JSON.stringify([{ game: "CAR @ GB", season: 2095, week: 8, away: "CAR", home: "GB", homeSpread: -3.5, total: 47.5, openHomeSpread: -2.5, openTotal: 46.5 }]), "WIDE inputs: unplayed games with a Polymarket line only; the home spread, total and the week's first lines");
  const realFetch = globalThis.fetch, oldUrl = process.env.MODEL_SERVICE_URL; process.env.MODEL_SERVICE_URL = "https://svc.test"; let calls = 0;
  globalThis.fetch = async (u, o) => { calls++; const b = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ ok: true, thr: 0.05, v: 1, games: Object.fromEntries(b.games.map((x) => [x.game, { team: x.away, line: -x.homeSpread, p: 0.4, conf: 0.1, confident: true, thr: 0.05 }])) }) }; };
  const w1 = await widePicks(2095, 8, [g0]); const w2 = await widePicks(2095, 8, [g0]); const c12 = calls; const w3 = await widePicks(2095, 8, [{ ...g0, lineNow: { hs: -4.5, tl: 47.5 } }]);
  ok(w1["CAR @ GB"] && w1["CAR @ GB"].team === "CAR" && w1["CAR @ GB"].line === 3.5 && c12 === 1 && JSON.stringify(w2) === JSON.stringify(w1) && w3["CAR @ GB"].line === 4.5 && calls === 2 && (await getJSON("wide:2095:8")).sig, "WIDE picks: one service call per build, the reply cached while the lines hold, a changed line asks again", { calls, w1, w3 });
  globalThis.fetch = realFetch; if (oldUrl === undefined) delete process.env.MODEL_SERVICE_URL; else process.env.MODEL_SERVICE_URL = oldUrl; await getRedis().del("teaser:2095:8"); await getRedis().del("wide:2095:8");
  const apx = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), wk = readFileSync(new URL("../lib/week.js", import.meta.url), "utf8"), py = readFileSync(new URL("../railway-model-service/app.py", import.meta.url), "utf8");
  ok(/WIDE \(shadow\)/.test(apx) && /return wd \+ sk \+ ie \+ tj/.test(apx) && /\["WIDE:", /.test(apx) && /await widePicks\(season, week, games\)/.test(wk) && /recordWideShadow\(season, wk, G, G\.wideSide/.test(wk) && /@app\.route\("\/wide-picks", methods=\["POST"\]\)/.test(py), "WIDE shadow: Models -> Tracked angles row + ⓘ line, the slate records it on every build, the service route exists"); }
{ const { trackedSummary, gradeTrackedWeek } = await import("../lib/tracked.js"); const { getRedis } = await import("../lib/redis.js");
  ok(!/recordShadow|bookDepth/.test(readFileSync(new URL("../pages/api/pinnaclepull.js", import.meta.url), "utf8")), "review 10/19: the Pinnacle LINE MOVE / order-book tilt shadow picks and their book reads are gone");
  { // INJURY EARLY shadow (10/16): the healthy team at the current line the first time exactly one team has its QB / 2+ DBs / 2+ OL out; once per game; graded
    const { recordInjEarly } = await import("../lib/tracked.js"); const G = { key: "KC @ BUF", home: "BUF", away: "KC", week: 7 };
    const i1 = await recordInjEarly(2097, 7, G, 2.5, { home: { inj: { qb: 1, db: 0, ol: 0 } }, away: { inj: { qb: 0, db: 0, ol: 0 } } }, "2097-10-20T12:00:00Z");
    const i2 = await recordInjEarly(2097, 7, G, 1.5, { home: { inj: { qb: 1, db: 0, ol: 0 } }, away: { inj: { qb: 0, db: 0, ol: 0 } } }, "2097-10-20T13:00:00Z");
    const i3 = await recordInjEarly(2097, 7, { ...G, key: "NE @ NYJ", home: "NYJ", away: "NE" }, -3, { home: { inj: { qb: 1 } }, away: { inj: { db: 2 } } }, "x");
    const saved = JSON.parse(await getRedis().hget("teaser:2097:7", "KC @ BUF|injearly"));
    await gradeTrackedWeek(2097, 7, [{ key: "KC @ BUF", home: "BUF", away: "KC", homeScore: 20, awayScore: 24 }]); const s2 = await trackedSummary(2097);
    // 10/20: a CONTINUING injury (the hurt team had the flag in its previous game) is saved with cont: true, and the summary splits new / continuing
    const i4 = await recordInjEarly(2097, 7, { key: "DAL @ PHI", home: "PHI", away: "DAL", week: 7 }, 4.5, { home: { inj: { qb: 1 }, injPrev: { qb: 1 } }, away: { inj: {}, injPrev: {} } }, "y");
    const sc = JSON.parse(await getRedis().hget("teaser:2097:7", "DAL @ PHI|injearly")); const s3 = await trackedSummary(2097);
    ok(i1 === 1 && i2 === 0 && i3 === 0 && saved.team === "KC" && saved.line === -2.5 && saved.out === "BUF" && saved.cont === false && s2.injearly.recorded === 1 && s2.injearly.w === 1
      && i4 === 1 && sc.cont === true && sc.team === "DAL" && s3.injearly.recorded === 2 && s3.injearly.fresh.w === 1 && s3.injearly.cont.n === 0,
      "INJURY EARLY shadow: healthy KC at -2.5 saved once (BUF's QB out), both-hurt game skipped, graded a win; a continuing injury is saved with cont: true and split in the summary", { i1, i2, i3, i4, saved, sc, ie: s3.injearly }); } }
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
    ok(nb && nb.hit === 56.5 && !nb.night, "bounce back dog: night game shows the same all-games rate (56.5%)", nb); }
  ok(a && a.pick === "TEN +6.5" && a.hit === 56.5 && b && b.pick === "IND +2.5" && !floorDogPick(G, 6.5, { away: { prevPts: 3 }, home: { prevPts: 27 } })
    && !floorDogPick(G, -6.5, { away: { prevPts: 7 }, home: { prevPts: 27 } }) && !floorDogPick(G, -6.5, { away: { prevPts: 3 }, home: { prevPts: 0 } }) && !floorDogPick(G, -6.5, null),
    "bounce back dog: scored <=3 last game AND underdog now -> that team; favorite / 7 pts / both low -> nothing", [a, b]); }
{ const { bounceBackPick } = await import("../lib/stack.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const a = bounceBackPick(G, -3.5, { away: { prevAts: -24 } }), b = bounceBackPick(G, 2.5, { away: { prevAts: -28 } });
  ok(a && a.pick === "BUF +3.5" && a.hit === 61.3 && b && b.pick === "BUF -2.5" && !bounceBackPick(G, -3.5, { away: { prevAts: -23.5 } })
    && !bounceBackPick(G, -3.5, { home: { prevAts: -30 }, away: { prevAts: 3 } }) && !bounceBackPick(G, -3.5, null) && !bounceBackPick(G, null, { away: { prevAts: -30 } }),
    "bounce back: road team missed the spread by 24+ last game -> road team at the current line; home team / under 24 -> nothing", [a, b]); }
{ const { totalMovePick } = await import("../lib/stack.js"), { predictTotalMove, UP_MOVE } = await import("../lib/upgrade.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const mv = (move) => ({ move, thr20: 0.72, thr10: 0.97, hit20: 56.8, n20: 507, hit10: 61.9, n10: 252 });
  const a = totalMovePick(G, mv(1.2), 47.5, 47.5), b = totalMovePick(G, mv(-0.8), 47.5, 47.5), c = totalMovePick(G, mv(0.5), 47.5, 47.5), d = totalMovePick(G, mv(1.2), 48.5, 47.5);
  ok(a.length === 1 && a[0].pick === "Over 47.5" && a[0].hit === 61.9 && b.length === 1 && b[0].pick === "Under 47.5" && b[0].hit === 56.8 && !c.length && !d.length
    && !totalMovePick(G, null, 47.5, 47.5).length && !totalMovePick(G, mv(1.2), 47.5, null).length, "total move pick: strong/weak/moved/none", [a, b, c, d]);
  const p = predictTotalMove(Object.fromEntries(UP_MOVE.feat.map((f, i) => [f, UP_MOVE.mean[i]])));
  ok(Math.abs(p.move - UP_MOVE.b0) < 0.01 && p.thr20 === UP_MOVE.thr20, "total move model: average game predicts the intercept", p); }
{ // 10/20 INJURY first-week rule: a hurt team that already had the flag in its previous game is a CONTINUING injury -> no pick; no previous data -> treated as new
  const { injuryPick } = await import("../lib/stack.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const cont = injuryPick(G, -3.5, -3.5, { home: { inj: { qb: 1 }, injPrev: { qb: 1 } }, away: { inj: {}, injPrev: {} } });
  const fresh = injuryPick(G, -3.5, -3.5, { home: { inj: { qb: 1 }, injPrev: { db: 1 } }, away: { inj: {}, injPrev: {} } });
  const nodata = injuryPick(G, -3.5, -3.5, { home: { inj: { ol: 2 }, injPrev: null }, away: { inj: {} } });
  const other = injuryPick(G, -3.5, -3.5, { home: { inj: { qb: 1 }, injPrev: {} }, away: { inj: {}, injPrev: { qb: 1 } } });   // the HEALTHY team's old flag does not matter
  ok(!cont && fresh && fresh.pick === "BUF +3.5" && fresh.hit === 66.7 && fresh.n === 51 && nodata && nodata.hit === 53.7 && nodata.n === 95 && other && other.pick === "BUF +3.5", "INJURY fires only on a new injury (continuing -> none; no previous data -> new)");
}
{ const { injuryPick } = await import("../lib/stack.js"); const G = { home: "LA", away: "BUF", key: "BUF @ LA" };
  const inj = (o) => ({ qb: 0, sk: 0, ol: 0, db: 0, f7: 0, ...o }), sit = (h, a) => ({ home: { inj: inj(h) }, away: { inj: inj(a) } });
  const a = injuryPick(G, -3.5, -3.5, sit({ qb: 1 }, {})), b = injuryPick(G, -3.5, -3.5, sit({}, { db: 2 })), c = injuryPick(G, -2.5, -3.5, sit({ ol: 2 }, {}));
  ok(a && a.pick === "BUF +3.5" && a.hit === 66.7 && b && b.pick === "LA -3.5" && b.hit === 53.7 && c === null && !c && !injuryPick(G, -3.5, -3.5, sit({ qb: 1 }, { qb: 1 })) && !injuryPick(G, -3.5, -3.5, sit({ db: 1 }, {}))
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
{ const { usPlayerNames } = await import("../lib/mybets.js");
  const ev = { markets: [{ slug: "astatc-nfl-lac-kc-2026-10-18-td-ladmcc-gte1", titleShort: "Ladd McConkey 1+ TD", marketSides: [{ long: true, team: { abbreviation: "lac" } }, { long: false, team: { abbreviation: "lac" } }] },
    { slug: "astatc-nfl-ari-lar-2026-10-18-td-pucnac-gte1", titleShort: "Puka Nacua 1+ TD", marketSides: [{ long: true, team: { abbreviation: "lar" } }] }, { slug: "asc-nfl-lac-kc-2026-10-18-neg-4pt5", marketSides: [] }] };
  const u = usPlayerNames(ev);
  ok(u["astatc-nfl-lac-kc-2026-10-18-td-ladmcc-gte1"].name === "Ladd McConkey" && u["astatc-nfl-lac-kc-2026-10-18-td-ladmcc-gte1"].team === "LAC" && u["astatc-nfl-ari-lar-2026-10-18-td-pucnac-gte1"].team === "LA" && !u["asc-nfl-lac-kc-2026-10-18-neg-4pt5"],
    "bets: a TD leg's real name and team come from the Polymarket US event (ladmcc -> Ladd McConkey, LAC)"); }
{ const { tdTeamFromModel } = await import("../lib/mybets.js");
  const td = { "LA @ JAX": { away: [{ name: "K.Williams" }, { name: "P.Nacua" }], home: [{ name: "T.Etienne" }] }, "BUF @ ATL": { away: [{ name: "J.Cook" }], home: [{ name: "Bi.Robinson" }] }, "X @ Y": { away: [{ name: "K.Williams" }], home: [] } };
  ok(tdTeamFromModel(td, "Bijan Robinson").team === "ATL" && tdTeamFromModel(td, "James Cook III").team === "BUF" && tdTeamFromModel(td, "Puka Nacua").game === "LA @ JAX" && tdTeamFromModel(td, "Kyren Williams") === null && tdTeamFromModel(td, "Nobody Here") === null,
    "bets: an old TD leg with no game gets its team from that week's TD lists, only when one team has him"); }
{ const m = await import("../lib/mybets.js");
  ok(m.isNbaBet("aec-nba-bos-det-2026-10-22") && m.isNbaBet("crossd-1", [{ eventSlug: "nba-bos-det-2026-10-22" }]) && !m.isNbaBet("crossd-1", [{ eventSlug: "nba-bos-det-2026-10-22" }, { eventSlug: "nfl-buf-lv-2026-10-18" }])
    && !m.isNbaBet("aec-nfl-buf-lv-2026-10-18") && !m.isNbaBet("crossd-1", null), "NFL My bets leaves out NBA bets (they list on the NBA page)"); }
{ const fs = await import("node:fs"), app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), nba = fs.readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
  ok(/const legTxt = \(r, html\) => \(r === "W" \? `<span class="g">/.test(app) && /legTxt\(p\.result, logoLabel/.test(app) && /legTxt\(l\.result, legName/.test(app) && (app.match(/legTxt\(l\.result, `/g) || []).length >= 1 && /const legCell = \(l, plain\)/.test(app) && /legTxt\(l\.result, plain\)/.test(app)
    && /const legTxt = /.test(nba) && /legTxt\(l\.result, `\$\{tlogo/.test(nba), "bets: a won leg's text is green and a lost leg's red (My bets, Model bets, Over/Under; NBA Model bets)"); }
{ const { buildPaper, gradePaper } = await import("../lib/paper.js");
  const game = (k, hs, ml, win, extra = {}) => ({ key: k, away: k.split(" @ ")[0], home: k.split(" @ ")[1], started: false, final: false, poly: { spread: { homeSpread: hs }, ml: { home: ml, away: 1 - ml } }, winPct: win, td: [], ...extra });
  const data = { games: [game("A @ B", -10.5, 0.86, 86), game("C @ D", -12, 0.9, 90), game("E @ F", -3, 0.6, 60), game("G @ H", -7, 0.8, 79),
      game("I @ J", -1, 0.5, 50, { td: [{ player: "X.Back", team: "J", price: 0.30, bid: 0.29, fair: 36, market: "X Back 1+" }, { player: "Y.Thin", team: "J", price: 0.30, bid: 0.01, thin: true, fair: 50 }] }),
      game("K @ L", -2, 0.55, 55, { td: [{ player: "Z.Wr", team: "L", price: 0.20, bid: 0.19, fair: 25 }] }), game("M @ N", 1, 0.45, 45, { td: [{ player: "Q.Te", team: "M", price: 0.10, bid: 0.09, fair: 12 }] })] };
  const P = buildPaper(data), by = (k) => P.filter((p) => p.strategy === k);
  ok(!["home_fav_95_single", "home_fav_95_2", "home_fav_95_3", "top3_home_75", "td_edge_3"].some((k) => by(k).length) && P.every((p) => ["best_2", "best_3", "td_likely_2", "td_likely_3"].includes(p.strategy)), "weekly parlays (10/19 review): only the Best Legs types are built -- the old paper types never shown anywhere are gone", P.map((p) => p.strategy));
  { const td = (player, team, fair, extra = {}) => ({ player, team, price: fair / 100 - 0.05, bid: fair / 100 - 0.06, fair, market: player + " 1+", ...extra });
    const d2 = { games: [game("A @ B", -3, 0.6, 60, { td: [td("Top.One", "A", 70), td("Top.Two", "A", 66)] }), game("C @ D", -3, 0.6, 60, { td: [td("Sit.Q", "C", 80, { injury: "Questionable" }), td("Real.Two", "D", 55)] }),
      game("E @ F", -3, 0.6, 60, { td: [td("Thin.X", "E", 90, { thin: true, bid: 0.01 }), td("Real.Three", "F", 40)] }), game("G @ H", -3, 0.6, 60, { td: [td("Late.Four", "G", 30)] })] };
    const Q = buildPaper(d2), l2 = Q.filter((p) => p.strategy === "td_likely_2"), l3 = Q.filter((p) => p.strategy === "td_likely_3");
    ok(l2.length === 1 && l2[0].legs.map((l) => l.player).join() === "Thin.X,Top.One" && l2[0].legs[0].thin === true, "likely-2: best player, one per game, injury-listed player skipped, thin markets allowed and marked", l2[0] && l2[0].legs.map((l) => l.player));
    ok(l3.length === 1 && l3[0].legs.map((l) => l.player).join() === "Thin.X,Top.One,Real.Two" && Math.abs(l3[0].prob - 0.9 * 0.7 * 0.55) < 1e-9, "likely-3: thin market allowed, chance = legs multiplied", l3[0] && l3[0].legs.map((l) => l.player));
    { const { bestLegParlays, BEST_LEGS } = await import("../lib/paper.js"), B = bestLegParlays(d2.games), bt = (k) => B.find((p) => p.strategy === k);
      ok(BEST_LEGS.join() === "best_2,best_3,td_likely_2,td_likely_3" && bt("td_likely_2") && bt("td_likely_3") && JSON.stringify(bt("td_likely_3").legs) === JSON.stringify(l3[0].legs) && JSON.stringify(bt("td_likely_2").legs) === JSON.stringify(l2[0].legs),
        "Best Legs (10/19): the live build = the saved paper parlays leg for leg", B.map((p) => p.strategy));
      ok(B.every((p) => p.stake === 10) && Q.filter((p) => BEST_LEGS.includes(p.strategy)).every((p) => p.stake === 10) && Q.filter((p) => !BEST_LEGS.includes(p.strategy)).every((p) => p.stake == null || p.strategy.startsWith("leg4_")), "Best Legs: $10 stake saved on those types only");
      const B2 = bestLegParlays(d2.games.map((g) => (g.key === "E @ F" ? { ...g, started: true } : g)));
      ok(B2.find((p) => p.strategy === "td_likely_2").legs.map((l) => l.player).join() === "Top.One,Real.Two" && !B2.some((p) => p.legs.some((l) => l.game === "E @ F")), "Best Legs: a started game drops out of the live build"); } }
  { const { comboPay } = await import("../lib/combo.js"); ok(Math.abs(comboPay([{ game: "C @ D", kind: "ml", team: "D", price: 0.9 }, { game: "A @ B", kind: "ml", team: "B", price: 0.86 }]) - 0.977 / (0.9 * 0.86)) < 1e-9, "payout = legs multiplied, minus Polymarket's cut"); }
  await setJSON("paper:2026:9", { parlays: [{ strategy: "x", legs: [{ game: "A @ B", kind: "ml", team: "B", price: 0.8 }, { game: "C @ D", kind: "ml", team: "D", price: 0.5 }] },
    { strategy: "y", legs: [{ game: "A @ B", kind: "ml", team: "B", price: 0.8 }, { game: "I @ J", kind: "td", team: "J", player: "X.Back", price: 0.3 }] }] });
  await gradePaper(2026, 9, [{ key: "A @ B", homeScore: 24, awayScore: 20 }, { key: "C @ D", homeScore: 17, awayScore: 17 }, { key: "I @ J", homeScore: 10, awayScore: 3 }],
    async () => Object.assign(["X.Back"], { teams: { "X.Back": ["J"] } }));
  const { getJSON } = await import("../lib/redis.js"); const g = await getJSON("paper:2026:9");
  ok(g.parlays[0].result === "W" && Math.abs(g.parlays[0].ret - (1 / 0.8 - 1)) < 1e-9, "pushed leg drops out, parlay pays the rest");
  ok(g.parlays[1].result === "W" && Math.abs(g.parlays[1].ret - (0.977 / (0.8 * 0.3) - 1)) < 1e-9, "TD leg graded from scorers"); }
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
  { // 10/23: a finished tile shows the locked picks with ✓ / ✗ (saved grade first, else graded from the final score)
    const fin = ctx.T.tile({ ...tg, started: true, final: true, awayScore: 24, homeScore: 30, lockedPicks: { spread: { pick: "CLE -2.5", result: null }, total: { pick: "Over 55.5", result: null }, ml: { pick: "PIT ML", result: "L" } } });
    const pr = ctx.T.pickRes;
    ok(/class="tres"/.test(fin) && /<span class="g">CLE -2\.5 ✓<\/span>/.test(fin) && /<span class="r">O 55\.5 ✗<\/span>/.test(fin) && /<span class="r">PIT ML ✗<\/span>/.test(fin) && !/class="tres"/.test(ctx.T.tile(tg))
      && pr("CLE -6", "PIT", "CLE", 24, 30) === "P" && pr("PIT +6.5", "PIT", "CLE", 24, 30) === "W" && pr("Under 54", "PIT", "CLE", 24, 30) === "P" && pr("CLE ML", "PIT", "CLE", 24, 30) === "W",
      "tile: a finished game shows its locked picks ✓ / ✗ (grade from the score when the saved grade is not in yet); upcoming tiles show none", fin); }
  ok(tl.indexOf(">PIT<") < tl.indexOf(">CLE<") && /<span class="mkt">60<\/span><span class="dim"> · <\/span><span class="dim">40<\/span>/.test(tl) && /TNF/.test(tl) && !/GAP/.test(tl), "tile: away name left, home name right, away 60 · home 40, TNF chip, no price-gap chip", tl);
  { const half = ctx.T.tile({ ...tg, winPct: 39.5 }), nums = (half.match(/<span class="(?:mkt|dim)">(\d+)<\/span><span class="dim"> · /) || [])[1], nums2 = (half.match(/ · <\/span><span class="(?:mkt|dim)">(\d+)<\/span>/) || [])[1];
    ok(Number(nums) + Number(nums2) === 100, "tile: the two percentages always add to 100 (60.5 and 39.5 do not both round up)", half); }
  ok(/LIVE/.test(ctx.T.tile({ ...tg, started: true })) && />13<\/span>/.test(ctx.T.tile({ ...tg, started: true, final: true, awayScore: 13, homeScore: 27 })) && /<span class="lv dim">FINAL<\/span>/.test(ctx.T.tile({ ...tg, started: true, final: true, awayScore: 13, homeScore: 27 })), "tile: live tag, final score with FINAL under it (10/16)");
  vm.runInContext(`LIVE_SC = { "PIT @ CLE": { a: 14, h: 10, st: "in", lbl: "Q3 4:12" } }`, ctx);
  { const lt = ctx.T.tile({ ...tg, started: true }), dt = ctx.T.detailTop({ ...tg, started: true });
    ok(/>14<\/span>/.test(lt) && />10<\/span>/.test(lt) && /LIVE · Q3 4:12/.test(lt) && !/class="bar"/.test(lt) && !/chip c-red">LIVE/.test(lt) && /class="bar"/.test(ctx.T.tile(tg)), "live tile: score, LIVE · Q3 under it, no pre-game bar (same as NBA / home); a game not started keeps its bar", lt);
    ok(/14 – 10/.test(dt) && /LIVE · Q3 4:12/.test(dt) && !/Live · locked/.test(dt), "live game page: score and quarter in the matchup card"); }
  { // 10/18 (owner): an open combo whose game is being played says ● LIVE · quarter clock, no team scores
    vm.runInContext(`LIVE_SC = { "PIT @ CLE": { a: 14, h: 10, st: "in", lbl: "Q3 4:12" }, "BUF @ LV": { a: 3, h: 0, st: "in", lbl: "Q1 2:05" }, "SEA @ DEN": { a: 20, h: 17, st: "post", lbl: "FINAL" } }`, ctx);
    const one = ctx.T.betRow({ source: "account", title: "c", week: 6, cost: 5, toWin: 50, price: 0.1, result: "pending", picks: [{ label: "PIT +3.5", game: "PIT @ CLE" }, { label: "Over 40.5 · PIT @ CLE", game: "PIT @ CLE" }] });
    ok(/class="r lvb">● LIVE · Q3 4:12</.test(one) && !/14/.test(one) && />open</.test(one) && !/wk 6/.test(one) && one.indexOf("LIVE") < one.indexOf(">open<"), "open combo, one live game: ● LIVE · Q3 4:12 where wk 6 was, open stays on the right, no score", one);
    const two = ctx.T.betRow({ source: "account", title: "c", week: 6, cost: 5, toWin: 50, price: 0.1, result: "pending", picks: [{ label: "PIT +3.5", game: "PIT @ CLE" }, { label: "BUF ML", game: "BUF @ LV" }, { label: "J.Cook 1+ TD", game: "BUF @ LV", result: "W" }] });
    ok(/class="r lvb">● LIVE</.test(two) && !/wk 6/.test(two) && /PIT \+3\.5[\s\S]*· Q3 4:12/.test(two) && /BUF ML[\s\S]*· Q1 2:05/.test(two) && (two.match(/· Q1 2:05/g) || []).length === 1, "open combo, two live games: ● LIVE on the bet, each undecided leg its own clock", two);
    const fin = ctx.T.betRow({ source: "account", title: "c", week: 6, cost: 5, toWin: 50, price: 0.1, result: "pending", picks: [{ label: "SEA +2.5", game: "SEA @ DEN" }] });
    ok(!/LIVE/.test(fin) && />open</.test(fin) && !/wk 6/.test(fin), "a finished or unstarted game: still open, no LIVE, no week tag (10/27)", fin);
    const won = ctx.T.betRow({ source: "account", title: "c", week: 6, cost: 5, toWin: 50, price: 0.1, result: "W", pl: 45, picks: [{ label: "PIT +3.5", game: "PIT @ CLE", result: "W" }] });
    ok(!/LIVE/.test(won), "a settled bet never says LIVE", won);
    const typed = ctx.T.betRow({ source: "preloaded", legs: [{ result: "pending", kind: "spread", team: "PIT", line: 3.5, game: "PIT @ CLE" }], result: "pending", cost: 5, toWin: 9, pl: null });
    ok(/● LIVE · Q3 4:12/.test(typed), "typed-in bet: LIVE · quarter too", typed); }
  { const il = ctx.T.injLine({ home: "IND", away: "TEN", model: { inj: { home: { players: [], pts: 0 }, away: { players: [{ name: "Alontae Taylor", status: "out" }, { name: "Kevin Winston Jr.", status: "out" }], pts: -1.52 }, total: 0 } } }, "spread");
    ok(il === "Injuries: IND 0 · TEN -1.5 (A.Taylor out, K.Winston out)", "injury line names players as initial + last name (A.Taylor, not a bare Taylor next to IND's J.Taylor)", il); }
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
    const P = buildPaper({ games: [gm("A1 @ H1", "H1", 90, { n: "P1", p: 58 }), gm("A2 @ H2", "H2", 80, { n: "P2", p: 70 }), gm("A3 @ H3", "H3", 78, null), gm("A4 @ H4", "H4", 76, null), gm("A5 @ H5", "H5", 60, { n: "P5", p: 30 })] });   // 10/26 night: TD legs 55%+ (P5 at 30% is out)
    ok(P.length && !P.some((p) => /model_best_4|best_4|leg4_/.test(p.strategy)) && P.every((p) => p.legs.length <= 3) && P.find((p) => p.strategy === "td_likely_2").legs.map((l) => l.player).join() === "P2,P1" && !P.some((p) => p.strategy === "td_likely_3"), "weekly parlays (10/19, owner: three legs max): no 4-leg type is built (model_best_4, best_4, leg4_*); 10/26 night: TD legs 55%+ only (no triple with a 30% third man)", P.map((p) => [p.strategy, p.legs.length])); }
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
    const sameGameParlays = (gm) => sgp0(gm.started || gm.final ? gm : { ...gm, card: bc0(gm, (gm.combos || []).map((c) => ({ id: "linemove|x", ...c })), gm.poly, null, null) });   // 10/15: legs come from the card's PICK at Polymarket's own line
    const { gradePaper, paperSummary } = await import("../lib/paper.js"); const { listAlerts } = await import("../lib/alerts.js"); const { setJSON } = await import("../lib/redis.js"); const R = globalThis.__TEST_REDIS__;
    const g = { key: "CHI @ ATL", away: "CHI", home: "ATL", started: false, final: false, poly: { spread: { homeSpread: 2.5, home: 0.47, away: 0.54 }, total: { line: 49.5, over: 0.5, under: 0.5 } },
      combos: [{ pick: "ATL +2.5", hit: 58.1, line: 2.5, why: "BOUNCE BACK: x" }, { pick: "CHI -2.5", hit: 57, line: -2.5, why: "BOUNCE BACK: y" }, { pick: "Under 49.5", hit: 52.1, line: 49.5, why: "z" }],
      td: [{ player: "Bi.Robinson", team: "ATL", fair: 62, price: null }, { player: "D.Swift", team: "CHI", fair: 49, price: 0.45 }, { player: "Hurt Guy", team: "CHI", fair: 70, injury: "Questionable" }] };
    const x = sameGameParlays(g);
    ok(x.best && x.best.legs.map((l) => l.label).join() === "Bi.Robinson TD,ATL +2.5" && Math.abs(x.best.prob - 0.62 * 0.581 * Math.pow(1.19, 0.75)) < 0.002, "same-game: best = Bijan TD + ATL +2.5 (they help each other: 62% x 58.1% x 1.19^0.75, 10/16)");
    const xo = sameGameParlays({ ...g, combos: [g.combos[0], g.combos[1], { pick: "Over 49.5", hit: 52.1, line: 49.5, why: "z" }] });
    ok(!("style" in xo) && !("linked" in xo) && Object.values(xo).every((p) => !p || typeof p !== "object" || p.legs.length <= 3), "same-game (10/19, owner: three legs max): no 4 legs / my style parlay is built", Object.keys(xo));
    const y = sameGameParlays({ ...g, combos: [{ pick: "Under 49.5", hit: 62, line: 49.5, why: "TOTAL MOVE: t" }], td: [{ player: "Bi.Robinson", team: "ATL", fair: 64 }] });
    ok(y.best === null, "same-game (10/19): two strong legs that work against each other (a TD with the Under) are not paired");
    const yy = sameGameParlays({ ...g, combos: [{ pick: "CHI -2.5", hit: 61, line: -2.5, why: "BOUNCE BACK: y" }], td: [{ player: "Bi.Robinson", team: "ATL", fair: 64 }, { player: "D.Swift", team: "CHI", fair: 56 }] });
    const y2 = sameGameParlays({ ...g, combos: [{ pick: "CHI -2.5", hit: 61, line: -2.5, why: "BOUNCE BACK: y" }], td: [{ player: "Bi.Robinson", team: "ATL", fair: 64 }] });
    ok(yy.best && yy.best.legs.map((l) => l.label).join() === "Bi.Robinson TD,D.Swift TD" && y2.best === null, "same-game (10/19): Bijan's TD is never paired with CHI -2.5 (works against it); the next pair that does not work against each other is taken", yy.best && yy.best.legs.map((l) => l.label));
    const { comboChance: cc0 } = await import("../lib/combo.js");
    ok(Math.abs(cc0([{ game: "G", kind: "td", team: "A", prob: 0.64 }, { game: "G", kind: "total", side: "under", label: "Under 49.5", prob: 0.62 }]) - 0.64 * 0.62 * 0.77) < 1e-9, "parlay chance: a TD with the Under counts the full 0.77 drag (drags are not shrunk, 10/16)");
    const z = sameGameParlays({ ...g, poly: { ...g.poly, spread: { homeSpread: 2.5, home: 0.5, away: 0.5 } }, combos: [{ pick: "ATL +2.5", hit: 51, line: 2.5, why: "x" }, { pick: "Under 49.5", hit: 52, line: 49.5, why: "y" }], td: [{ player: "Bi.Robinson", team: "ATL", fair: 48 }] });
    ok(z.best === null && z.filled, "same-game (10/19): no strong legs and no tested pair -> no 2-leg parlay (it used to fill with a 48% TD and a 51% spread)");
    { // 10/14 fix: the filler never adds a leg that works against one already in (DEN +3.5 + SEA to win = SEA by 1-3 only)
      const d = sameGameParlays({ key: "SEA @ DEN", away: "SEA", home: "DEN", started: false, final: false, poly: { spread: { homeSpread: 2.5, home: 0.53, away: 0.47 }, ml: { home: 0.43, away: 0.5725 }, total: { line: 40.5, over: 0.5, under: 0.5 } },
        combos: [{ pick: "DEN +2.5", hit: 59.6, line: 2.5, why: "BOUNCE BACK: x" }], td: [{ player: "J.Smith-Njigba", team: "SEA", fair: 45 }, { player: "J.Dobbins", team: "DEN", fair: 38 }] });
      const e2 = sameGameParlays({ key: "BAL @ CLE", away: "BAL", home: "CLE", started: false, final: false, poly: { spread: { homeSpread: 4.5, home: 0.5, away: 0.5 }, ml: { home: 0.3, away: 0.72 }, total: { line: 44.5, over: 0.5, under: 0.5 } },
        combos: [{ pick: "BAL -4.5", hit: 65.6, line: -4.5, why: "BOUNCE BACK: x" }], td: [{ player: "D.Henry", team: "BAL", fair: 55 }] });
      ok(e2.best && e2.best.legs.map((l) => l.label).join() === "BAL -4.5,D.Henry TD", "same-game: no second bet on the same game's result (BAL -4.5 + BAL ML adds nothing)", e2.best && e2.best.legs.map((l) => l.label));
      ok(d.best === null && d.three === null, "same-game (10/19): our green pick backs the underdog (DEN +2.5) -> no favorite-based parlay and no weak filler on that game", d.best && d.best.legs.map((l) => l.label));
      { // 10/19 filters: 3 legs only with the favorite 60%+, its top scorer 55%+ (10/26 night: was 50), total 45+; filled pair = favorite + its top scorer 55%+; no Upset since 10/26
        const base = { key: "A @ B", away: "A", home: "B", started: false, final: false, poly: { spread: { homeSpread: -6.5, home: 0.5, away: 0.5 }, ml: { home: 0.72, away: 0.3 }, total: { line: 47.5, over: 0.5, under: 0.5 } }, combos: [],
          td: [{ player: "B.RB", team: "B", pos: "RB", fair: 56 }, { player: "B.WR", team: "B", pos: "WR", fair: 41 }, { player: "A.RB", team: "A", pos: "RB", fair: 46 }] };
        const ok1 = sameGameParlays(base), lowFav = sameGameParlays({ ...base, poly: { ...base.poly, ml: { home: 0.56, away: 0.46 } } }), lowTd = sameGameParlays({ ...base, td: [{ player: "B.RB", team: "B", pos: "RB", fair: 49 }, { player: "B.WR", team: "B", pos: "WR", fair: 41 }, { player: "A.RB", team: "A", pos: "RB", fair: 44 }] }), lowTot = sameGameParlays({ ...base, poly: { ...base.poly, total: { line: 42.5, over: 0.5, under: 0.5 } } });
        const td54 = sameGameParlays({ ...base, td: [{ player: "B.RB", team: "B", pos: "RB", fair: 54 }, { player: "A.RB", team: "A", pos: "RB", fair: 46 }] });
        ok(ok1.three && !lowFav.three && !lowTd.three && !lowTot.three && !td54.three, "same-game (10/19, 10/26): 3 legs only when favorite 60%+, its top scorer 55%+ (54% -> none), total 45+", [!!ok1.three, !!lowFav.three, !!lowTd.three, !!lowTot.three, !!td54.three]);
        ok(ok1.best && ok1.best.strategy === "sgp_best_fill" && ok1.best.legs.map((l) => l.label).join() === "B ML,B.RB TD" && !(lowTd.best), "same-game (10/19): filled 2 legs = favorite + its top scorer only at 55%+ (49% -> none)", ok1.best && ok1.best.legs.map((l) => l.label));
        ok(!("upset" in ok1) && !ok1.upset, "same-game (10/26 night): no Upset is built any more (live 1 of 16)", Object.keys(ok1));
        const gU = sameGameParlays({ ...base, combos: [{ pick: "Under 47.5", hit: 62, line: 47.5, why: "TOTAL MOVE: t" }] }), yU = sameGameParlays({ ...base, combos: [{ pick: "Under 47.5", hit: 51.7, line: 47.5, why: "model" }] });
        const yO = sameGameParlays({ ...base, combos: [{ pick: "Over 47.5", hit: 51.7, line: 47.5, why: "model" }] });
        ok(!gU.three && !yU.three && yO.three, "same-game (10/19 agree): no Over 3 legs when the card's total PICK is an Under, green or yellow (an Over PICK keeps them)");
        const fS = sameGameParlays({ ...base, combos: [{ pick: "B -6.5", hit: 58, line: -6.5, why: "BOUNCE BACK: y" }] });
        ok(!fS.upset && !("upset" in fS), "same-game (10/26): the Upset is gone whatever the card says");
        const { comboChance: cc } = await import("../lib/combo.js");
        const heavy = cc([{ game: "G", kind: "ml", team: "B", prob: 0.8 }, { game: "G", kind: "td", team: "B", prob: 0.5 }]), long = cc([{ game: "G", kind: "ml", team: "A", prob: 0.3 }, { game: "G", kind: "td", team: "A", prob: 0.35 }]);
        ok(Math.abs(heavy - 0.4 * Math.pow(1.05, 0.75)) < 1e-12 && Math.abs(long - 0.105 * Math.pow(1.7, 0.75)) < 1e-12, "parlay chance (10/19): a team's moneyline + its own scorer uses the measured link by win chance (heavy favorite 1.05x, long-shot dog 1.7x)", { heavy, long }); }
      { const G2 = { key: "NO @ NYG", home: "NYG", away: "NO", poly: { spread: { homeSpread: 1.5, home: 0.5, away: 0.5 }, total: { line: 46.5, over: 0.5, under: 0.5 } } };
  { const pb = ctx.T.pBlock("ARI @ LA", { prob: 0.67, stake: 20, legs: [{ label: "ARI +3.5", prob: 0.55, price: 0.55 }, { label: "Over 45", prob: 0.5, price: 0.5 }, { label: "K.Williams TD", prob: 0.67, price: 0.5 }] }, false);
    const pn = ctx.T.pBlock("WAS @ SF", { prob: 0.31, legs: [{ label: "SF -7.5", prob: 0.5, price: null }, { label: "C.McCaffrey TD", prob: 0.66 }] }, false);
    ok(ctx.T.tdPct(54.6) === 54 && ctx.T.tdPct(55) === 55 && ctx.T.tdPct(54.4) === 54 && ctx.T.tdPct(61.1) === 61 && ctx.T.plural(1, "pick") === "1 pick" && ctx.T.plural(0, "pick") === "0 picks" && ctx.T.plural(2, "player") === "2 players"
      && /<span class="pbn">ARI @ LA<\/span><\/div><div class="ptb pth"><span class="pt1">LEG<\/span><span class="pt2">MODEL<\/span>/.test(pb) && /ARI \+3\.5<\/span><span class="pt2 mod">55%<\/span><span class="pt3">55¢<\/span>/.test(pb) && /K\.Williams TD<\/span><span class="pt2 mod">67%<\/span><span class="pt3">50¢<\/span>/.test(pb) && /<div class="ptb ptf"><span class="pt1"><span class="plb"[^>]*>.*<\/span><\/span><span class="pt2 mod">67%<\/span>/.test(pb) && /SF -7\.5<\/span><span class="pt2 mod">\d+%<\/span><span class="pt3">—<\/span>/.test(pn) && /PL: 7\.1x<span class="plw"> · \$20 → <\/span><span class="g">\$142<\/span>/.test(pb) && /PL: —/.test(pn) && !/hits ~|about \d|filled|Polymarket price not posted/.test(pb + pn),
      "wording + parlay block (10/22 table): LEG | MODEL | POLYMARKET heads, one row per leg with its % (purple) and price (— with none), a last row with PL and the parlay's Model %; PL: — with no price; no notes; 54.6% TD shows 54; \"1 pick\" not \"1 picks\"", { pb, pn }); }
        }
      const { comboChance } = await import("../lib/combo.js");
      const mid = comboChance([{ game: "S", kind: "spread", team: "DEN", prob: 0.596 }, { game: "S", kind: "ml", team: "SEA", prob: 0.57 }]),
        same = comboChance([{ game: "S", kind: "spread", team: "SEA", prob: 0.45 }, { game: "S", kind: "ml", team: "SEA", prob: 0.57 }]);
      ok(Math.abs(mid - 0.166) < 0.001 && Math.abs(same - 0.45) < 1e-9, "same-game chance: opposite-team spread + moneyline only in the window between them (17%, not 34%); same team = the less likely leg", { mid, same }); }
        { // Model Picks (10/15): sub-tabs, week chips, one-column lists in kickoff order with the marks, logos and the blue PL line
          const lg = (l, pr, r) => ({ label: l, prob: pr, price: 0.5, ...(r ? { result: r } : {}) }), P = (n, legs, extra = {}) => ({ legs: legs || [lg("A +1.5", 0.55), lg("Over 44.5", 0.5)], prob: n, stake: 20, ...extra });
          vm.runInContext(`S = { week: 6, games: [ { key: "SEA @ DEN", kickoff: "2026-10-16T00:15:00Z", sgp: { best: ${JSON.stringify(P(0.4))}, three: ${JSON.stringify(P(0.3))} } }, { key: "HOU @ JAX", kickoff: "2026-10-18T13:30:00Z", sgp: { best: ${JSON.stringify(P(0.27))} } }, { key: "ARI @ LA", started: true, kickoff: "2026-10-18T20:05:00Z" } ], fourLeg: [ ${JSON.stringify({ ...P(0.4), strategy: "leg4_fav" })} ] };
            MODELBETS = { ok: true, weeks: { 6: { 2: [ ${JSON.stringify(P(0.67, [lg("ARI +3.5", 0.55, "W"), lg("K.Williams TD", 0.67, "W")], { game: "ARI @ LA", result: "W" }))} ] }, 5: { 2: [ ${JSON.stringify(P(0.3, [lg("DAL -3.5", 0.55, "L"), lg("Over 44.5", 0.5, "W")], { game: "DAL @ GB", result: "L", kickoff: "2026-10-11T17:00:00Z" }))} ] } } }; LABTYPE = "2"; LABWEEK = null`, ctx);
          const cur = ctx.T.labParlays(6, "2"), past = ctx.T.labParlays(5, "2"), box = { innerHTML: "" }, sub = { innerHTML: "" }, oldGet = ctx.document.getElementById;
          ctx.document.getElementById = (id) => (id === "lab" ? box : id === "lab-sub" ? sub : oldGet(id));
          ctx.T.renderLabList(); const h = box.innerHTML;
          ok(cur.map((x) => x.game).join() === "SEA @ DEN,HOU @ JAX,ARI @ LA" && cur[2].p.result === "W" && cur[0].p.result === undefined && past.length === 1 && past[0].p.result === "L",
            "Model Picks: the current week uses the live slate (results from the saved copy once a game has started), past weeks use the saved ones", cur.map((x) => x.game));
          ok(/<select id="lab-wk"[^>]*><option value="5">Week 5<\/option><option value="6" selected>Week 6<\/option>/.test(h) && !/class="drop"/.test(h) && /class="pgrid"/.test(h) && /class="plb"/.test(h) && /✓ Won/.test(h) && !/hits ~|about \d|filled|Fewer than/.test(h) && h.indexOf("SEA") < h.indexOf("HOU") && h.indexOf("HOU") < h.indexOf("ARI")
            && sub.innerHTML === "",
            "Model Picks: week drop-down on top (first recorded week first), one list in kickoff order with the blue PL line and Won at the bottom right; no docked type strip (the types are in the menu)", { h: h.slice(0, 300) });
          ctx.document.getElementById = oldGet;
          const pb = ctx.T.pBlock("X", P(0.5, [lg("A +1.5", 0.5, "W"), lg("Over 44.5", 0.5, "L"), lg("B.Tuten TD", 0.4)]), false);
          ok(/<span class="g">✓<\/span> .*A \+1\.5/.test(pb) && /<span class="r">✗<\/span> .*Over 44\.5/.test(pb) && /• .*B\.Tuten TD/.test(pb) && /✗ Lost|✓ Won/.test(pb) === false && /class="pm"/.test(pb) && /PL: 7\.8x/.test(pb),
            "parlay block: ✓ won, ✗ lost and • pending marks on the legs, Polymarket logo on the PL line; no result until the parlay is decided"); }
    ok(sameGameParlays({ ...g, started: true }) === null, "same-game: none once the game has started");
    const L3 = { strategy: "sgp_3", stake: 15, legs: [x.best.legs.find((l) => l.kind === "spread"), { game: "CHI @ ATL", kind: "total", side: "over", label: "Over 49.5", price: 0.5, prob: 0.5 }, { game: "CHI @ ATL", kind: "td", team: "CHI", player: "D.Swift", label: "D.Swift TD", market: null, price: 0.45, prob: 0.49 }] };
    const data = { season: 2099, week: 6, games: [{ ...g, sgp: { ...x, three: L3 } }, { key: "OLD @ GAME", started: true, sgp: x }] };
    ok(await recordSgp(data, setJSON) === 1, "same-game: saved for games not yet started only");
    await gradePaper(2099, 6, [{ key: "CHI @ ATL", homeScore: 24, awayScore: 21 }], async () => ["Bi.Robinson"]);
    const sm = await paperSummary(2099, 6), b = sm.week.parlays.find((p) => p.strategy === "sgp_best"), st = sm.week.parlays.find((p) => p.strategy === "sgp_3");
    ok(b.result === "W" && b.ret === null && st.result === "L" && sm.board.sgp_best.hits === 1 && sm.board.sgp_best.roi === null && sm.board.sgp_3.graded === 1, "same-game: graded (ATL +2.5 and Bijan hit; the 3 legs lost on the Over/Swift), unpriced legs -> win/loss only");
    ok(!(await listAlerts(2099)).some((a) => /Same game · (best \(strong|your style)/.test(a.title || "")), "same-game: no bell alert");
    ok(sm.legs && sm.legs.td && sm.legs.td.w >= 1 && sm.legs.td.l >= 1 && sm.legs.spread && sm.legs.spread.w >= 1 && sm.killers.td >= 1, "scoreboard legs review: legs counted by kind; the TD leg that lost is a killer of the 3-leg parlay", { legs: sm.legs, killers: sm.killers });
    { await R.set("paper:2099:9", JSON.stringify({ season: 2099, week: 9, parlays: [
        { strategy: "leg4_fav", result: "W", legs: [{ game: "X @ Y", kind: "ml", team: "Y", label: "Y ML", result: "W" }] },
        { strategy: "leg4_fav_td", result: "W", legs: [{ game: "X @ Y", kind: "ml", team: "Y", label: "Y ML", result: "W" }] },
        { strategy: "angles_2", result: "L", legs: [{ game: "X @ Y", kind: "ml", team: "X", label: "X ML", result: "L" }] }] }));
      const before = (sm.legs.ml || { w: 0, l: 0 }), s2 = await paperSummary(2099, 6), ml = s2.legs.ml || { w: 0, l: 0 };
      ok(ml.w - before.w === 1 && ml.l - before.l === 0 && (s2.killers.ml || 0) === (sm.killers.ml || 0), "scoreboard legs review (10/18 fix): a leg in two parlays counts once; a cut parlay type (angles) is left out", { before, ml }); }
    { await R.set("paper:2099:10", JSON.stringify({ season: 2099, week: 10, parlays: [
        { strategy: "td_likely_2", result: "W", ret: 2, legs: [{ game: "X @ Y", kind: "td", label: "A TD", result: "W" }] },
        { strategy: "best_2", result: "L", ret: -1, stake: 10, legs: [{ game: "X @ Y", kind: "spread", label: "Y -2.5", result: "L" }] }] }));
      const s3 = await paperSummary(2099, 6), tl = s3.board.td_likely_2, b2 = s3.board.best_2;
      ok(tl && Math.abs(tl.money - 20) < 1e-9 && tl.staked === 10 && b2 && Math.abs(b2.money + 10) < 1e-9, "Best Legs money (10/19 fix): a week saved before the $10 stake still counts $10 (td_likely_2 +$20); a saved stake is used as is", { tl, b2 });
      await R.set("paper:2099:10:sgp|X @ Y", JSON.stringify({ season: 2099, week: 10, game: "X @ Y", parlays: [] }));
      const mbh = (await import("../pages/api/modelbets.js")).default; let out = null;
      const res = { setHeader() {}, status() { return { json: (j) => { out = j; } }; } };
      const { SEASON: SN } = await import("../lib/games.js");
      await R.set(`paper:${SN}:77`, JSON.stringify({ season: SN, week: 77, parlays: [{ strategy: "td_likely_3", legs: [{ game: "X @ Y", kind: "td", label: "A TD" }] }] }));
      await R.set(`paper:${SN}:78:sgp|X @ Y`, JSON.stringify({ season: SN, week: 78, game: "X @ Y", parlays: [{ strategy: "sgp_best", legs: [] }] }));
      await mbh({ query: {} }, res);
      ok(out && out.ok && out.saved.includes(77) && !out.saved.includes(78) && out.weeks["77"].best[0].stake === 10, "modelbets (10/19): the week's own copy marks the week saved (a same-game record does not); an old Best Legs record carries the $10 stake", out && { saved: out.saved, best: out.weeks["77"] && out.weeks["77"].best });
      await R.del(`paper:${SN}:77`); await R.del(`paper:${SN}:78:sgp|X @ Y`); }
    for (const k of await R.keys("paper:2099:*")) await R.del(k); }
  { // 10/19 (owner: "I only want three max to show anywhere now. Cut all the four legs"): no 4-leg parlay is built or shown, NFL or NBA
    const SG = await import("../lib/sgp.js"), { sameGameParlays } = SG;
    const { buildCard: bcG } = await import("../lib/cardpick.js");
    const G = (h, a, ph, extra = {}) => { const g0 = { key: `${a} @ ${h}`, away: a, home: h, started: false, final: false, poly: { ml: { home: ph, away: 1 - ph }, spread: { homeSpread: -7.5, home: 0.5, away: 0.5 }, total: { line: 44.5, over: .5, under: .5 } }, combos: [], td: [], ...extra };
      return { ...g0, card: bcG(g0, (g0.combos || []).map((c) => ({ id: "linemove|x", ...c })), g0.poly, null, null) }; };
    const one = sameGameParlays({ ...G("PHI", "NYG", .7), poly: { ...G("PHI", "NYG", .7).poly, total: { line: 47.5, over: 0.5, under: 0.5 } }, td: [{ player: "S.Barkley", team: "PHI", fair: 62 }, { player: "A.Brown", team: "PHI", fair: 40 }] });
    const shx = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), apx0 = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), nbx = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
    ok(!SG.fourLegParlays && !SG.FOUR_LEG && one.three && one.three.legs.length === 3 && !("linked" in one) && !("style" in one)
      && !/4 Leg|Different Game|Favorites"\]/.test(shx) && !/\["(4|style|diff)", /.test(apx0.match(/const LAB_TABS = [^\n]*/)[0]) && !/fav4/.test(nbx.match(/const LAB_TABS = [^\n]*/)[0]) && /out\.length === 3\) break/.test(apx0),
      "three legs max (10/19): same game 3 legs kept, no 4 legs / my style / 4 across games; NFL tabs 4 Leg, 4 Leg (My Style), Different Game Parlays and NBA Favorites gone; Parlay of the week up to 3", Object.keys(one));
    // 10/17 parlay lab UPSET (underdog ML + its lead RB): NOT built since 10/26 night (live 1 of 16, said 18%); the type name stays for the graded history
    const up = sameGameParlays({ ...G("PHI", "NYG", .7), td: [{ player: "S.Barkley", team: "PHI", pos: "RB", fair: 62 }, { player: "T.Tracy", team: "NYG", pos: "RB", fair: 46, price: 0.41 }] });
    ok(!up.upset && !("upset" in up) && !/sgp_upset/.test(JSON.stringify(up)) && !("sgp_upset" in SG.STAKES), "UPSET (10/26 night): never built, no stake entry; the old rows are history only", Object.keys(up));
    { const g0 = G("PHI", "NYG", .65), tdF = [{ player: "S.Barkley", team: "PHI", pos: "RB", fair: 62 }];
      const ws = (team) => sameGameParlays({ ...g0, td: tdF, card: { ...g0.card, spread: { ...(g0.card && g0.card.spread), plain: { id: "modelpick|spread", ruleId: "stack|spread", team, line: team === "PHI" ? -6.5 : 6.5, pick: team, hit: 52.8 } } } });
      const onFav = ws("PHI"), onDog = ws("NYG");
      ok(onFav.filled && onFav.best && onFav.best.legs.some((l) => l.label === "PHI ML") && !(onDog.best && onDog.best.legs.some((l) => l.label === "PHI ML")),
        "favorite parlays (10/23 night): favorite ML + its scorer not built when the card's PICK is STACK's side on the underdog and the favorite is priced under 70%", { onFav: onFav.best, onDog: onDog.best }); }
    const { STRATEGIES: STN, legKind } = await import("../lib/paper.js");
    ok(STN.sgp_upset && STN.leg4_td4 && legKind({ kind: "total", side: "under" }) === "under" && legKind({ kind: "total", label: "Over 44.5" }) === "over" && legKind({ kind: "td" }) === "td" && legKind({ kind: "x" }) === null, "new types named; leg kinds for the review");
    const mbj = readFileSync(new URL("../pages/api/modelbets.js", import.meta.url), "utf8"), apx = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    ok(/best_2: "best", best_3: "best", td_likely_2: "best", td_likely_3: "best"/.test(mbj) && /\["best", "Best Legs"\]/.test(apx) && /if \(type === "best"\)/.test(apx) && /S\.bestLegs/.test(apx) && /MODELBETS\.saved\.includes\(Number\(week\)\)/.test(apx) && /\(saved \? rec :/.test(apx) && /td_likely_3: "3 most likely TD scorers"/.test(apx)
      && /\.\.\.\(data\.bestLegs \|\| \[\]\)/.test(readFileSync(new URL("../pages/api/slate.js", import.meta.url), "utf8")) && /bestLegs = bestLegParlays\(games\)/.test(readFileSync(new URL("../lib/week.js", import.meta.url), "utf8")),
      "Best Legs tab (10/19): saved best_2 / best_3 / td_likely_2 / td_likely_3 grouped as \"best\", the live slate's bestLegs before the week is saved, real quotes in the background");
    { const stj = readFileSync(new URL("../lib/status.js", import.meta.url), "utf8");
    ok(/fitCheck = \{ games: c\.games, margin: \[c\.marginErr, c\.marketMarginErr/.test(stj) && /teamTotal: \[c\.teamTotalErr/.test(stj) && /\["Game model vs the line \(unseen seasons\)", fitLine\(st\.fitCheck\)\]/.test(apx) && /one\("team total", f\.teamTotal\)/.test(apx),
      "System (10/26 night): the game model's margin / total / team-total misses vs the closing line from the rebuild's own checks"); }
  ok(/leg4_td4: "diff", sgp_upset: "upset"/.test(mbj) && !/\["upset", "Upset"\]/.test(apx) && !/upset: \(g\) => g\.sgp\.upset/.test(apx) && !/\["Upset", x\.upset\]/.test(apx) && /sgp_3: 31\.4, sgp_upset: 25\.1, td_likely_2: 48\.1, td_likely_3: 33\.8 \}/.test(apx) && /LEGS · THIS SEASON/.test(apx) && /PAPER\.killers/.test(apx), "Model bets (10/26 night): no Upset tab, no Upset block on the game page; scoreboard rates = the 55% TD bar (3 legs 31.4, pair 48.1, triple 33.8); LEGS review kept"); }
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
  { // 10/16 audit: an account position with 0 / negative shares and no settlement or sale is not a bet (it showed "pays -$17.00")
    const { isHeld } = await import("../lib/mybets.js");
    ok(!isHeld(-17, null, null) && !isHeld(0, null, null) && isHeld(10, null, null) && isHeld(-17, { win: false, pl: -7.5 }, null) && isHeld(0, null, { pl: 3 }), "account bets: negative / zero shares are not a bet unless settled or sold"); }
  { // 10/16 (owner "e"): BEAT THE live record also pooled by side -- favorite tiers (minus line) vs underdog tiers -- for the Tuesday report card
    const { ruleRecords } = await import("../lib/stack.js"), mk = (g, res, line, hit) => ({ id: "keynum|spread", tier: 4, key: 3, hit, week: 6, game: g, result: res, t: "1", line });
    const R = ruleRecords([mk("A", "W", -2.5, 54.4), mk("B", "L", -2.5, 54.4), mk("C", "W", 3.5, 56.2), mk("D", "W", 3.5, 56.2)], []);
    ok(R["BEAT THE · favorite tiers"].w === 1 && R["BEAT THE · favorite tiers"].l === 1 && R["BEAT THE · underdog tiers"].w === 2 && R["BEAT THE · underdog tiers"].say === 56.2 && R["BEAT THE 3 · books 4"].w === 3, "live rule records: BEAT THE pooled by favorite / underdog side", R); }
  { // TD prices every 30 min (10/16): new players added, ordinary moves taken, a halved price left to the snapshot guard
    const { mergeTdPrices } = await import("../pages/api/pinnaclepull.js"); const { getJSON, K, getRedis } = await import("../lib/redis.js"); const G = { key: "KC @ BUF", week: 7 };
    const n1 = await mergeTdPrices(getRedis(), 2097, G, { "A 1+ TD": { ask: 0.5, bid: 0.48 }, "B 1+ TD": { ask: 0.3, bid: 0.28 } }, "t1");
    const n2 = await mergeTdPrices(getRedis(), 2097, G, { "A 1+ TD": { ask: 0.2, bid: 0.18 }, "B 1+ TD": { ask: 0.34, bid: 0.32 }, "C 1+ TD": { ask: 0.41, bid: 0.4 } }, "t2");
    const saved = await getJSON(K.tdpx(2097, 7, "KC @ BUF")), hist = await getRedis().lrange("tdpxhist:2097:7:KC @ BUF", 0, -1);
    ok(n1 === 2 && n2 === 2 && saved["A 1+ TD"].ask === 0.5 && saved["B 1+ TD"].ask === 0.34 && saved["C 1+ TD"].ask === 0.41 && hist.length === 2 && JSON.parse(hist[1]).src === "pin30",
      "30-min TD prices: first save, then C added and B moved, A's halving kept for the snapshot guard, history row written", { n1, n2, saved }); }
  { // 10/17: a player Polymarket no longer lists drops out of the saved TD prices
    const { mergeTdPrices } = await import("../pages/api/pinnaclepull.js"); const { getJSON, K, getRedis } = await import("../lib/redis.js"); const G = { key: "KC @ BUF", week: 7 };
    const n3 = await mergeTdPrices(getRedis(), 2097, G, { "A 1+ TD": { ask: 0.2, bid: 0.18 }, "B 1+ TD": { ask: 0.34, bid: 0.32 } }, "t3"), saved = await getJSON(K.tdpx(2097, 7, "KC @ BUF"));
    ok(n3 === 1 && !saved["C 1+ TD"] && saved["A 1+ TD"].ask === 0.5 && saved["B 1+ TD"].ask === 0.34, "TD prices: a player no longer listed is dropped, a held halving stays", { n3, saved }); }
  { // 10/17 (owner: "it needs to match my app"): Polymarket US markets -> the lines the card reads
    const { usMarkets } = await import("../lib/polyus.js"); const { parseGame, statPropsFromMarkets } = await import("../lib/poly.js");
    const q = (v) => ({ value: String(v), currency: "USD" }), side = (d, long, t) => ({ description: d, long, ...(t ? { team: { abbreviation: t } } : {}) });
    const sp = (line, bid, ask) => ({ slug: `asc-x-${line}`, sportsMarketType: "football_team_full_game_spread", line, bestBidQuote: q(bid), bestAskQuote: q(ask), marketSides: [side(String(line), true, "lar"), side(String(-line), false, "sea")] });
    const tot = (line, bid, ask) => ({ slug: `tsc-x-${line}`, sportsMarketType: "football_team_full_game_total", line, bestBidQuote: q(bid), bestAskQuote: q(ask), marketSides: [side("Over", true), side("Under", false)] });
    const ev = { markets: [{ slug: "aec-x", sportsMarketType: "football_team_full_game_winner", bestBidQuote: q(0.6), bestAskQuote: q(0.61), marketSides: [side("Rams", true, "lar"), side("Seahawks", false, "sea")] },
      sp(-2.5, 0.5, 0.51), sp(-3.5, 0.42, 0.43), sp(-1.5, 0.55, 0.56), { ...sp(-2.5, 0.3, 0.31), sportsMarketType: "football_team_first_half_spread", slug: "h1" },
      tot(44.5, 0.49, 0.5), tot(45.5, 0.45, 0.46), tot(43.5, 0.53, 0.54),
      { slug: "astatc-td-pucnac-gte1", sportsMarketType: "football_player_touchdowns", line: 1, titleShort: "Puka Nacua 1+ TD", bestBidQuote: q(0.59), bestAskQuote: q(0.6), marketSides: [side("Yes", true, "lar"), side("No", false, "lar")] },
      { slug: "astatc-td-pucnac-gte2", sportsMarketType: "football_player_touchdowns", line: 2, titleShort: "Puka Nacua 2+ TD", bestBidQuote: q(0.1), bestAskQuote: q(0.11), marketSides: [side("Yes", true, "lar"), side("No", false, "lar")] },
      { slug: "astatc-recyd-x", sportsMarketType: "football_player_receiving_yards", line: 60, titleShort: "Puka Nacua 60+ Rec Yds", bestBidQuote: q(0.7), bestAskQuote: q(0.72), marketSides: [side("Yes", true, "lar"), side("No", false, "lar")] }] };
    const ms = usMarkets(ev, "nfl"), g = parseGame(ms, "LA", "SEA"), td = ms.filter((m) => m.sportsMarketType === "anytime_touchdowns"), st = statPropsFromMarkets(ms);
    ok(g.ml && g.ml.away === 0.61 && g.ml.home === 0.4 && g.spread.homeSpread === 2.5 && g.spread.away === 0.51 && g.spread.home === 0.5 && g.total.line === 44.5 && g.total.over === 0.5 && g.total.under === 0.51
      && g.alts.some((a) => a.team === "SEA" && a.line === 3.5 && a.price === 0.58) && !g.alts.some((a) => a.price === 0.31) && g.talts.some((a) => a.side === "under" && a.line === 45.5 && a.price === 0.55)
      && td.length === 1 && td[0].question === "Puka Nacua 1+ touchdowns" && st[0].line === 59.5 && st[0].stat === "rec_yds",
      "Polymarket US: moneyline / spread / total at the ask (other side = 1 - bid), every alternate, no half markets, TD 1+ only, 60+ yards = Over 59.5", { g, td, st }); }
  { // 10/16 (owner's pass): ESPN "ruled out" news joins the starters-out count before the official report says Out (Hurts: official "DNP" Thursday, ESPN Out)
    const { withEspnOuts } = await import("../lib/paper.js"); const { startersOut } = await import("../lib/snaps.js");
    const at = (d) => new Date(Date.now() + d * 86400e3).toISOString();   // 10/23: dates relative to today (an ESPN entry older than 8 days is stale by design; the fixed 10/15 date crossed that line)
    const rows = [{ home: "PHI", away: "DEN", kickoff: at(-6) }], kick = at(2);
    const off = withEspnOuts([{ name: "Jalen Hurts", pos: "QB", status: "Did Not Participate In Practice", week: 6 }], [{ name: "Jalen Hurts", pos: "QB", status: "Out", date: at(-1) }, { name: "Old Guy", pos: "WR", status: "Out", date: at(-7) }], "PHI", kick, rows, 6);
    const snaps = { "00-1": { name: "Jalen Hurts", pos: "QB", weeks: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } } };
    ok(off.length === 1 && off[0].status === "Out" && startersOut(snaps, off, 6).qb === 1 && startersOut(snaps, [{ name: "Jalen Hurts", pos: "QB", status: "Did Not Participate In Practice", week: 6 }], 6).qb === 0,
      "starters out: ESPN Out overrides the official DNP (QB counted), a stale ESPN Out from before the last game is ignored", off); }
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
    { // 10/17 (owner: "why can't I see my legs"): "crossd-..." combos are read like "caoc-..."; a moneyline leg ("aec-...") is "NO ML" and graded from the final score
      const L2 = [{ slug: "aec-nfl-no-nyg-2026-10-18", eventSlug: "nfl-no-nyg-2026-10-18", title: "NO Saints vs. NY Giants", outcome: "Saints", team: { abbreviation: "no" }, state: "COMBO_LEG_STATE_PENDING" }, legs[1]];
      await saveComboLegs({ "crossd-t2": { comboLegDetails: L2 } }); const sv = await getJSON("combolegs:crossd-t2");
      const cp2 = await comboPicks({ positions: { positions: { "crossd-t2": { comboLegDetails: L2 } } } }, "crossd-t2", 2026, 6);
      ok(sv && sv.length === 2 && cp2 && cp2[0].label === "NO ML" && cp2[0].kind === "ml" && cp2[0].game === "NO @ NYG", "crossd combos: legs saved and shown; moneyline leg = NO ML", cp2);
      { // 10/21: player yard legs read as yards, not "1+ TD", and are never graded from the touchdown scorers
        const { statOf } = await import("../lib/mybets.js");
        ok(statOf("astatc-nfl-gb-det-2026-10-25-pyd-jargof-gte250").what === "250+ Pass Yds" && statOf("astatc-nfl-gb-det-2026-10-25-ryd-jahgib-gte70").what === "70+ Rush Yds" && statOf("astatc-nfl-gb-det-2026-10-25-td-jahgib-gte1").what === "1+ TD" && statOf("astatc-nfl-gb-det-2026-10-25-td-jahgib-gte1").td === true && statOf("astatc-nfl-gb-det-2026-10-25-pyd-jargof-gte250").td === false,
          "My bets (10/21): a player market's stat comes from its slug (pyd = Pass Yds, ryd = Rush Yds, td = TD)");
        const L3 = [{ slug: "astatc-nfl-gb-det-2026-10-25-pyd-jargof-gte250", eventSlug: "x", title: "GB Packers vs. DET Lions", outcome: "Yes", state: "COMBO_LEG_STATE_PENDING" }, { slug: "astatc-nfl-gb-det-2026-10-25-td-jahgib-gte1", eventSlug: "x", title: "GB Packers vs. DET Lions", outcome: "Yes", state: "COMBO_LEG_STATE_PENDING" }];
        const cp3 = await comboPicks({ positions: { positions: { "crossd-t3": { comboLegDetails: L3 } } } }, "crossd-t3", 2026, 7);
        ok(cp3 && / 250\+ Pass Yds$/.test(cp3[0].label) && cp3[0].kind === "prop" && / 1\+ TD$/.test(cp3[1].label) && cp3[1].kind === "td", "My bets (10/21): Goff's 250+ passing-yards leg reads '250+ Pass Yds' (it read '1+ TD' and could be graded from the scorers); the TD leg stays a TD", cp3); }
      const { markFromFinals } = await import("../lib/mybets.js"); const { resetGamesCache } = await import("../lib/games.js"); const realFetch = globalThis.fetch;
      const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,roof,stadium,location,surface\n";
      resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + "2026,REG,5,2026-10-05,13:00,BAL,20,ATL,27,dome,X,Home,turf\n" } : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
      const m2 = await markFromFinals([{ label: "ATL ML", game: "BAL @ ATL", kind: "ml", result: null }, { label: "BAL ML", game: "BAL @ ATL", kind: "ml", result: null }], 2026, 5);
      ok(m2[0].result === "W" && m2[1].result === "L", "crossd combos: moneyline legs graded from the final score", m2);
      { // 10/27 (owner: "fix the player props"): yard / reception legs graded from the official stats (snap counts decide a no-show), 2+ TD legs from the scorer counts, the No side inverted
        const oldUrl = process.env.MODEL_SERVICE_URL; process.env.MODEL_SERVICE_URL = "https://svc.test"; const { clearStatCache } = await import("../lib/props.js"); clearStatCache();
        globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + "2026,REG,5,2026-10-05,13:00,BAL,20,ATL,27,dome,X,Home,turf\n" }
          : String(u).includes("/player-stats") ? { ok: true, json: async () => ({ ok: true, games: { "BAL @ ATL": { "drake london": { rec_yds: 77, rec: 6, rush_yds: 0 }, "lamar jackson": { pass_yds: 240, pass_cmp: 22, pass_att: 30, rush_yds: 41 } } }, snaps: { "BAL @ ATL": ["drake london", "lamar jackson", "zay flowers"] } }) }
          : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
        await R.set("tdscorers:2026:5", JSON.stringify({ t: new Date().toISOString(), games: { "BAL @ ATL": ["D.London", "B.Robinson"] }, teams: null, counts: { "BAL @ ATL": { "D.London": 2, "B.Robinson": 1 } } }));
        const m3 = await markFromFinals([{ label: "Drake London 70+ Rec Yds", game: "BAL @ ATL", kind: "prop", result: null }, { label: "Lamar Jackson 250+ Pass Yds", game: "BAL @ ATL", kind: "prop", result: null, player: "Lamar Jackson", stat: "pyd", n: 250, side: "over" },
          { label: "Lamar Jackson under 250 Pass Yds", game: "BAL @ ATL", kind: "prop", result: null, player: "Lamar Jackson", stat: "pyd", n: 250, side: "under" }, { label: "Zay Flowers 50+ Rec Yds", game: "BAL @ ATL", kind: "prop", result: null },
          { label: "Lamar Jackson 60+ Scrimmage Yds", game: "BAL @ ATL", kind: "prop", result: null }, { label: "Drake London 2+ TD", game: "BAL @ ATL", kind: "td", result: null }, { label: "Bijan Robinson 2+ TD", game: "BAL @ ATL", kind: "td", result: null },
          { label: "Zay Flowers no TD", game: "BAL @ ATL", kind: "td", result: null }, { label: "Lamar Jackson 2+ Pass TD", game: "BAL @ ATL", kind: "prop", result: null }], 2026, 5);
        ok(m3[0].result === "W" && m3[0].actual === 77 && m3[1].result === "L" && m3[2].result === "W" && m3[3].result === "L" && m3[3].actual === 0 && m3[4].result === "L" && m3[4].actual === 41 && m3[5].result === "W" && m3[6].result === "L" && m3[7].result === "W" && m3[8].result === null,
          "10/27: prop legs graded from the week's official stats (a player with snaps but no touch = 0), scrimmage = rush + rec, 2+ TD from the counts, 'no TD' = the No side, a pass-TD leg waits for Polymarket", m3.map((x) => [x.label, x.result, x.actual]));
        clearStatCache(); if (oldUrl === undefined) delete process.env.MODEL_SERVICE_URL; else process.env.MODEL_SERVICE_URL = oldUrl; await R.del("tdscorers:2026:5"); }
      globalThis.fetch = realFetch; resetGamesCache(); await R.del("combolegs:crossd-t2"); }
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
    vm.runInContext(`COMBOS = { cardRec: { "pick|spread": { w: 3, l: 1, stk: 4, ret: 0.4 }, "ptspick|total": { w: 1, l: 2, stk: 0, ret: 0 } }, card: { clv: { n: 3, sum: -1, beat: 1, same: 1, spread: { n: 2, sum: 0.5, beat: 1, same: 1 }, total: { n: 1, sum: -1.5, beat: 0, same: 0 } } } }`, ctx);
    const h = ctx.T.cardRecBox();
    ok(/PICK · spread<\/span><span>3–1<\/span><span><b class="g">75%<\/b><\/span><span><span class="g">\+\$10<\/span>/.test(h) && /PICK · total<\/span><span><span class="dim">—/.test(h) && /PICK w\/ POINTS · total<\/span><span>1–2/.test(h) && !/MODEL SIDE/.test(h)
      && /RECORD<\/span><span>WIN %<\/span><span>PER \$100/.test(h) && /PTS<\/span><span>BETTER<\/span><span>WORSE<\/span><span>SAME/.test(h)
      && /Spread<\/span><span><b class="g">\+0\.25<\/b><\/span><span>1<\/span><span>0<\/span><span>1<\/span>/.test(h) && /Total<\/span><span><b class="r">−1\.50<\/b><\/span><span>0<\/span><span>1<\/span><span>0<\/span>/.test(h), "card picks (10/19): one PICK row per market (rule or model side), PICK w/ POINTS rows, line value split from the same picks; no separate MODEL SIDE rows", h);
    ok(ctx.T.legPct({ kind: "total", prob: 0.517 }) === 51 && ctx.T.legPct({ kind: "spread", prob: 0.597 }) === 60 && ctx.T.legPct({ kind: "spread", prob: 0.559 }) === 55 && ctx.T.legPct({ kind: "td", prob: 0.548 }) === 54 && ctx.T.legPct({ kind: "ml", prob: 0.517 }) === 52,
      "one rounding rule (10/19): spread / total under 56% round down (51.7 -> 51, as on the card), green rounds (59.7 -> 60), TD legs under 55% round down, moneyline as is");
    { const cb = ctx.T.cardBody({ key: "A @ B", away: "A", home: "B" }, "total", { plain: { pick: "Under 52.5", hit: 51.7, side: "under" }, pts: { pick: "Under 53.5", hit: 54.6, side: "under", points: 1 },
        rows: [{ side: "under", pick: "Under 52.5", points: 0, hit: 51.7, price: 0.52 }, { side: "under", pick: "Under 53.5", points: 1, hit: 54.6, price: 0.55 }, { side: "over", pick: "Over 52.5", points: 0, hit: 42.1, price: 0.49 }] });
      ok(/Pick w\/ points:<\/span> Under 53\.5 · 54%/.test(cb) && /Under 53\.5 · 1 pt · 54% · 55¢/.test(cb) && !/55%/.test(cb), "card (10/19): the chosen row and the PICK w/ POINTS line show the same % (54.6 -> 54 both; the row was rounded up to 55)", cb); }
    vm.runInContext(`COMBOS = null`, ctx);
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
  ok(!("weekRecap" in (await import("../lib/grade.js"))), "weekly recap alert removed (cleanup 10/18: RESULT lines are not saved)");
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
      const { buildCard, cardPicks, cushionOf, isGreenPick, plainLeg } = await import("../lib/cardpick.js"), { spreadRate, totalRate } = await import("../lib/linetable.js"), { gradeStackPick: gsp, ruleLabel } = await import("../lib/stack.js");
      const NE = { key: "NYJ @ NE", home: "NE", away: "NYJ", kickoff: "2026-10-18T17:00:00Z" }, ps = (hs, h) => ({ spread: { homeSpread: hs, home: h, away: +(1 - h).toFixed(3) } }), now = new Date().toISOString();
      const alts = { t: now, alts: [{ team: "NE", line: -6.5, price: 0.52 }, { team: "NE", line: -5.5, price: 0.56 }, { team: "NE", line: -4.5, price: 0.66 }, { team: "NE", line: -3.5, price: 0.7 }, { team: "NYJ", line: 8.5, price: 0.5 }] };
      const ch = [{ id: "linemove|spread", kind: "spread", team: "NE", pick: "NE -7.5", hit: 51.2, n: 2600, line: -7.5, why: "x" }];
      const c1 = buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, alts);
      { const CA = { key: "CHI @ ATL", home: "ATL", away: "CHI", kickoff: "2026-10-18T17:00:00Z" };
        const two = [{ id: "keynum|spread", kind: "spread", team: "ATL", pick: "ATL +3.5", hit: 63.9, n: 194, line: 3.5, why: "BEAT THE 3" }, { id: "bounceback|spread", kind: "spread", team: "CHI", pick: "CHI -1.5", hit: 61.3, n: 261, line: -1.5, why: "BOUNCE BACK" }];
        const cc = buildCard(CA, two, ps(1.5, 0.5), { spread: { homeSpread: 1.5 } }, null);
        ok(cc.spread.plain.team === "CHI" && cc.spread.plain.ruleId === "bounceback|spread", "card (10/18): BEAT THE's ATL +1.5 reads under 50% at Polymarket's number -> not a rule, so no split; BOUNCE BACK CHI -1.5 is the PICK", cc.spread.plain);
        const sf = { key: "WAS @ SF", home: "SF", away: "WAS", kickoff: "2026-10-19T00:15:00Z", modelUp: { margin: 4 } };
        const cs = buildCard(sf, [{ id: "keynum|spread", kind: "spread", team: "SF", pick: "SF -5.5", hit: 56.9, n: 300, line: -5.5, why: "BEAT THE 7" }], ps(-7.5, 0.5), { spread: { homeSpread: -7 } }, null);
        ok(cs.spread.plain && cs.spread.plain.id === "modelpick|spread" && cs.spread.plain.ruleId === "model|spread", "card (10/18, owner B): WAS @ SF BEAT THE side SF -7.5 under 50% at Polymarket's line -> no rule pick, the model's side instead", cs.spread.plain);
        const LK = { key: "LAC @ KC", home: "KC", away: "LAC", kickoff: "2026-10-19T00:25:00Z" };
        const ck = buildCard(LK, [{ id: "injury|spread", kind: "spread", team: "KC", pick: "KC -7.5", hit: 56.5, n: 260, line: -7.5, why: "INJURY" }], ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, { t: new Date().toISOString(), alts: [{ team: "KC", line: -6.5, price: 0.56 }, { team: "KC", line: -5.5, price: 0.6 }, { team: "LAC", line: 8.5, price: 0.55 }] });
        const kc = ck.spread.rows.filter((r) => r.team === "KC").sort((a, b) => a.points - b.points), mains = ck.spread.rows.filter((r) => r.points === 0);
        ok(ck.spread.plain.hit === 56.5 && kc[0].points === 0 && kc[0].hit === 56.5 && kc.every((r, i) => !i || r.hit >= kc[i - 1].hit) && Math.abs(mains.reduce((a, r) => a + r.hit, 0) - 100) < 0.11, "card (10/21, owner: no contradictions): the PICK's own main line in the list shows the PICK's 56.5%, the other side 43.5% (sum 100), more points never read lower", { plain: ck.spread.plain.hit, kc, mains });
        const lac = ck.spread.rows.filter((r) => r.team === "LAC").sort((a, b) => a.points - b.points);
        ok(lac.every((r, i) => !i || r.hit >= lac[i - 1].hit) && lac[0].hit === 43.5, "card (10/21): the other side's more-points lines never read under its main line either", lac);
        const TI = { key: "TEN @ IND", home: "IND", away: "TEN", kickoff: "2026-10-18T17:00:00Z" };
        const tie = [{ id: "injury|spread", kind: "spread", team: "IND", pick: "IND -6.5", hit: 56.5, n: 260, line: -6.5, why: "INJURY" }, { id: "floordog|spread", kind: "spread", team: "TEN", pick: "TEN +6.5", hit: 56.5, n: 285, line: 6.5, why: "BOUNCE BACK DOG" }];
        const ct = buildCard(TI, tie, ps(-6.5, 0.5), { spread: { homeSpread: -6.5 } }, null);
        ok(ct.spread.plain.pick === "TEN +6.5" && ct.spread.plain.ruleId === "floordog|spread", "card (owner B): TEN @ IND INJURY IND -6.5 vs BOUNCE BACK DOG TEN +6.5 -> TEN +6.5 (the underdog)", ct.spread.plain);
        const hi = buildCard(TI, [{ ...tie[0], hit: 61 }, tie[1]], ps(-6.5, 0.5), { spread: { homeSpread: -6.5 } }, null);
        ok(hi.spread.plain.team === "TEN", "card (owner B): the underdog wins even when the favorite's rule has the higher %", hi.spread.plain);
        const same = buildCard(TI, [tie[0], { ...tie[0], id: "bounceback|spread", hit: 61.3, why: "BOUNCE BACK" }], ps(-6.5, 0.5), { spread: { homeSpread: -6.5 } }, null);
        ok(same.spread.plain.team === "IND" && same.spread.plain.ruleId === "bounceback|spread", "card (owner B): rules on the SAME team keep the highest % (favorite stays)", same.spread.plain);
        { const alts = { t: new Date().toISOString(), alts: [{ team: "IND", line: -5.5, price: 0.55 }, { team: "IND", line: -4.5, price: 0.6 }, { team: "TEN", line: 7.5, price: 0.55 }, { team: "TEN", line: 8.5, price: 0.6 }],
            talts: [{ side: "under", line: 44.5, price: 0.55 }, { side: "under", line: 45.5, price: 0.58 }, { side: "over", line: 42.5, price: 0.55 }, { side: "over", line: 41.5, price: 0.58 }] };
          const one = buildCard(TI, [tie[0]], { ...ps(-6.5, 0.5), total: { line: 43.5, over: 0.5, under: 0.5 } }, { spread: { homeSpread: -6.5 }, total: { line: 43.5 } }, alts);
          const two = buildCard({ ...TI, modelUp: { total: 47 } }, [tie[0]], { ...ps(-6.5, 0.5), total: { line: 43.5, over: 0.5, under: 0.5 } }, { spread: { homeSpread: -6.5 }, total: { line: 43.5 } }, alts);
          ok(one.spread.pts && one.spread.pts.team === "IND" && one.spread.rows.some((r) => r.team === "TEN"), "card (10/18, owner: one side per game): PICK IND -6.5 -> PICK w/ POINTS on IND too (TEN rows still listed)", one.spread.pts);
          ok(two.total.plain && two.total.pts && two.total.pts.side === two.total.plain.side, "card (10/18, owner: one side per game): total PICK w/ POINTS on the PICK's side (Over with Over)", { plain: two.total.plain, pts: two.total.pts }); }
        const tt = buildCard({ ...TI }, [{ id: "linemove|total", kind: "total", pick: "Over 44.5", hit: 66.1, n: 460, line: 44.5, why: "LINE MOVE" }, { id: "movepred|total", kind: "total", pick: "Under 44.5", hit: 57.6, n: 507, line: 44.5, why: "TOTAL MOVE" }], { ...ps(-6.5, 0.5), total: { line: 44.5, over: 0.5, under: 0.5 } }, { spread: { homeSpread: -6.5 }, total: { line: 44.5 } }, null);
        ok(tt.total && tt.total.plain && /^Over/.test(tt.total.plain.pick), "card (owner B): totals keep the highest % (Over 66.1% over Under 57.6%)", tt.total && tt.total.plain); }
      const bought = c1.spread.rows.filter((x) => x.points > 0), okRows = bought.filter((x) => x.hit >= 56), minP = okRows.length ? Math.min(...okRows.map((x) => x.points)) : null;
      ok(c1.spread.plain.pick === "NE -7.5" && c1.spread.plain.hit === 51.2 && c1.spread.plain.price === 0.5 && c1.spread.plain.id === "cardpick|spread"
        && new Set(c1.spread.rows.map((x) => x.team)).size === 2 && c1.spread.rows.every((x, _, a) => x.points >= 0 && x.points <= 3.5 && (x.points <= 2 || x.hit >= Math.max(...a.filter((y) => y.points <= 2).map((y) => y.hit)) + 3)) && c1.spread.rows.some((x) => x.team === "NYJ" && x.points === 1)
        && c1.spread.rows.every((x, i, a) => i === 0 || a[i - 1].points <= x.points) && !c1.spread.rows.some((x) => x.points === 4),
        "card (10/15): one list with BOTH teams, 0 / 1 / 2 points from Polymarket's main line, a 3rd point only at 60%+; sorted by points, each with win % and price", c1.spread);
      ok(c1.spread.pts && c1.spread.pts.id === "ptspick|spread" && c1.spread.pts.points >= 1 && c1.spread.pts.points <= 2 && (minP == null ? c1.spread.pts.hit === Math.max(...bought.map((x) => x.hit)) : c1.spread.pts.points === minP && c1.spread.pts.hit === Math.max(...okRows.filter((x) => x.points === minP).map((x) => x.hit))),
        "card (10/15): PICK w/ POINTS = the fewest points (1 or 2) that reach 56%, either team; none reaching it -> the highest win rate within 2 points", { pts: c1.spread.pts });
      ok(!buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, { t: new Date(Date.now() - 4 * 3600e3).toISOString(), alts: alts.alts }).spread.pts && buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, { t: new Date(Date.now() - 4 * 3600e3).toISOString(), alts: alts.alts }).spread.rows.every((x) => x.points === 0)
        && buildCard(NE, ch, ps(-7.5, 0.5), { spread: { homeSpread: -7.5 } }, null).spread.rows.every((x) => x.points === 0) && !buildCard({ ...NE, started: true }, ch, ps(-7.5, 0.5), null, alts),
        "card: no points line when the saved alternate prices are 3+ hours old or missing; no card once the game has started");
      { const rule = [{ id: "keynum|spread", kind: "spread", team: "NYJ", pick: "NYJ +5.5", hit: 56.2, n: 536, line: 5.5, plain: 50.6, why: "BEAT THE 5: x" }, ...ch], c = buildCard(NE, rule, ps(-7.5, 0.5), { spread: { homeSpread: -3.5 } }, alts);
        ok(c.spread.plain.ruleId !== "keynum|spread" && c.spread.plain.ruleId === "linemove|spread" && c.spread.rows.some((x) => x.team === "NYJ" && x.points > 0),
          "card (10/19 rules cleanup): BEAT THE no longer names the PICK side -- the side-tested rule (LINE MOVE) does; the bought lines stay in the list", c.spread.plain);
        const only = buildCard({ ...NE, model: { homeMargin: 9 } }, [rule[0]], ps(-7.5, 0.5), { spread: { homeSpread: -3.5 } }, alts);
        ok(only.spread.plain && only.spread.plain.ruleId === "model|spread", "card (10/19 rules cleanup): a game with only BEAT THE gets the model's side, not BEAT THE's", only.spread.plain); }
      { const pm = (mar, tot) => buildCard({ ...NE, modelUp: { margin: mar, total: tot } }, [], { ...ps(-7.5, 0.5), total: { line: 42.5, over: 0.5, under: 0.5 } }, null, null);
        const a1 = pm(7.8, 44.8), a2 = pm(7.0, 40.0), a3 = pm(7.5, 42.5);
        ok(a1.spread.plain.pick === "NE -7.5" && a1.spread.plain.id === "modelpick|spread" && a1.spread.plain.hit === 50.6 && a1.total.plain.pick === "Over 42.5" && a1.total.plain.id === "modelpick|total" && a1.total.plain.hit === 51.7
          && a2.spread.plain.pick === "NYJ +7.5" && a2.total.plain.pick === "Under 42.5" && a3.spread.plain.pick === "NE -7.5",
          "card (10/15): no rule -> the model's side at the main line (NE by 7.8 vs NE -7.5 = NE -7.5; NE by 7.0 = NYJ +7.5; a tie goes to the favorite; total Over / Under by the model's number), shown at its honest 50.6% / 51.7% with its own record id", { a1: a1.spread.plain, a2: a2.spread.plain }); }
      { // 10/24 night: the model-side total's more-points lines = 51.7 + the smallest history-group step from the main line (not the general lift)
        const { totalRate } = await import("../lib/linetable.js"), T = 42.5, rec = { t: new Date().toISOString(), talts: [41.5, 40.5, 39.5].map((line) => ({ side: "over", line, price: 0.55 })) };
        const c = buildCard({ ...NE, modelUp: { margin: 7.8, total: 44.8 } }, [], { ...ps(-7.5, 0.5), total: { line: T, over: 0.5, under: 0.5 } }, { total: { line: T } }, rec);
        const t0 = totalRate(T, "over", T), want = (L) => { const t = totalRate(T, "over", L); return Math.round((51.7 + Math.min(...["c", "o", "r"].filter((k) => t0.parts[k] && t.parts[k]).map((k) => t.parts[k].raw - t0.parts[k].raw))) * 10) / 10; };
        const rows = c.total.rows.filter((r) => r.side === "over" && r.points > 0);
        ok(c.total.plain.id === "modelpick|total" && rows.length === 3 && rows.every((r) => r.hit === Math.max(want(r.line), 51.7) && !("step" in r)) && c.total.pts && c.total.pts.side === "over",
          "model-side total (10/24 night): bought lines read 51.7% + the smallest group step (leave-one-season-out: chosen lines said 59.1, won 59.2; the general lift said 60.5, won 58.8)", rows.map((r) => [r.line, r.hit, want(r.line)])); }
      { // 10/22 (owner: "fix the problems only"): no tested rule -> STACK's side (shown at its band %) when the game has a STACK line; else the game model's side; a rule still wins
        const st = (team, pct, n, yv = 2) => ({ ...NE, modelUp: { margin: 7.8, total: 44.8 }, stackSide: { team, line: team === "NE" ? -7.5 : 7.5, pct, n, confident: pct > 55, yv } });
        const P = { ...ps(-7.5, 0.5), total: { line: 42.5, over: 0.5, under: 0.5 } };
        const s1 = buildCard(st("NYJ", 52.8, 608), [], P, null, null), s2 = buildCard(st("NE", 56.2, 153), [], P, null, null), s3 = buildCard({ ...NE, modelUp: { margin: 7.8, total: 44.8 }, stackSide: { team: "XXX", pct: 52.8 } }, [], P, null, null);
        const s4 = buildCard(st("NYJ", 52.8, 608), [{ id: "bounceback|spread", kind: "spread", team: "NE", pick: "NE -7.5", hit: 61.3, n: 261, line: -7.5, why: "x" }], P, null, null);
        ok(s1.spread.plain.pick === "NYJ +7.5" && s1.spread.plain.hit === 52.8 && s1.spread.plain.n === 608 && s1.spread.plain.ruleId === "stack|spread" && s1.spread.plain.id === "modelpick|spread" && s1.total.plain.hit === 51.7
          && s2.spread.plain.pick === "NE -7.5" && s2.spread.plain.hit === 56.2 && s3.spread.plain.ruleId === "model|spread" && s3.spread.plain.pick === "NE -7.5" && s4.spread.plain.ruleId === "bounceback|spread" && buildCard(st("NYJ", 52.8, 608, null), [], P, null, null).spread.plain.ruleId === "model|spread",
          "card (10/22): no rule -> STACK's side at its band % (the game model said NE -7.5, STACK NYJ +7.5 -> NYJ +7.5 52.8%); a STACK line on neither team or from the OLD team yards (no v2) -> the game model's side; a tested rule still names the side", { s1: s1.spread.plain, s3: s3.spread.plain }); }
      { const nc = buildCard(NE, [{ id: "chooser|spread", kind: "spread", team: "NE", pick: "NE -7.5", hit: 51.2, n: 2600, line: -7.5, why: "x" }, { id: "chooser|total", kind: "total", side: "over", pick: "Over 42.5", hit: 51.5, n: 2600, line: 42.5, why: "y" }], { ...ps(-7.5, 0.5), total: { line: 42.5, over: 0.5, under: 0.5 } }, { spread: { homeSpread: -7.5 }, total: { line: 42.5 } }, { ...alts, talts: [{ side: "over", line: 41.5, price: 0.55 }, { side: "under", line: 43.5, price: 0.55 }] });
        ok(nc && nc.spread.plain === null && nc.total.plain === null && new Set(nc.spread.rows.map((x) => x.team)).size === 2 && new Set(nc.total.rows.map((x) => x.side)).size === 2 && nc.spread.rows.every((x) => x.points <= 3.5) && cardPicks(nc).every((x) => x.id.startsWith("ptspick")),
          "card (10/15): the chooser's side is not shown -- no tested rule means no PICK, but the full list (both teams, Over and Under) and PICK w/ POINTS still show, same rules as every game", nc); }
      // totals: the chooser's side; Over buys lower lines, Under higher; needs the books total for the history (Polymarket's total when none)
      const pt = { total: { line: 42.5, over: 0.5, under: 0.5 } }, talts = { t: now, talts: [{ side: "over", line: 41.5, price: 0.55 }, { side: "over", line: 39.5, price: 0.62 }, { side: "over", line: 38.5, price: 0.7 }, { side: "under", line: 43.5, price: 0.55 }] };
      const chT = [{ id: "movepred|total", kind: "total", side: "over", pick: "Over 42.5", hit: 51.5, n: 2600, line: 42.5, why: "y" }], c2 = buildCard(NE, chT, pt, { total: { line: 42.5 } }, talts);
      ok(c2.total.plain.pick === "Over 42.5" && c2.total.plain.price === 0.5 && c2.total.rows.some((x) => x.pick === "Over 41.5" && x.points === 1) && c2.total.rows.some((x) => x.pick === "Under 43.5" && x.points === 1)
        && c2.total.rows.every((x, _, a) => x.points >= 0 && x.points <= 3.5 && (x.points <= 2 || x.hit >= Math.max(...a.filter((y) => y.points <= 2).map((y) => y.hit)) + 3)) && !c2.total.rows.some((x) => x.points === 4) && Math.abs(c2.total.rows.find((x) => x.pick === "Over 41.5").hit - Math.max(51.5, totalRate(42.5, "over", 41.5).rate + 51.5 - totalRate(42.5, "over", 42.5).rate)) < 0.06,
        "card (10/15): totals -- one list with Over AND Under, 0 / 1 / 2 points from Polymarket's main total (4 points is left out), each row's win % from the line table moved by the PICK's lift (10/24)", c2.total.rows);
      { const chT2 = [{ id: "movepred|total", kind: "total", side: "over", pick: "Over 42.5", hit: 61.3, n: 253, line: 42.5, why: "y" }], c3 = buildCard(NE, chT2, pt, { total: { line: 42.5 } }, talts), R3 = (pk) => c3.total.rows.find((x) => x.pick === pk), lift = 61.3 - totalRate(42.5, "over", 42.5).rate;
        ok(R3("Over 42.5").hit === 61.3 && Math.abs(R3("Over 41.5").hit - (totalRate(42.5, "over", 41.5).rate + lift)) < 0.06 && R3("Over 41.5").hit > 61.3 && Math.abs(R3("Under 43.5").hit - Math.max(38.7, totalRate(42.5, "under", 43.5).rate - lift)) < 0.06,
          "card (10/24): a 61.3% TOTAL MOVE Over lifts its bought lines by the same amount over the table (Over 41.5 reads above 61.3, not stuck at it) and the other side down", c3.total.rows); }
      const picks = cardPicks(c1), cp = picks.find((x) => x.id === "cardpick|spread"), pp = picks.find((x) => x.id === "ptspick|spread");
      ok(cp && gsp({ ...cp, home: "NE" }, 30, 21) === "W" && gsp({ ...cp, home: "NE" }, 28, 21) === "L" && (!pp || gsp({ ...pp, home: "NE" }, 28, 21) === (7 + pp.line > 0 ? "W" : "L")) && ruleLabel({ id: "cardpick|spread", kind: "spread" }) === "PICK · spread" && /PICK w\/ POINTS · total · 2 pts/.test(ruleLabel({ id: "ptspick|total", kind: "total", points: 2 }))
        && cushionOf(58, 0.54) === 4 && cushionOf(58, null) === null && isGreenPick(58) && isGreenPick(56) && !isGreenPick(55.9),
        "card: the PICK and the points line are recorded as their own picks, graded at their own line; green = win rate 56%+");
      { // recorded at kickoff, graded, counted in the Models tab: the card's PICK and PICK w/ POINTS (10/15)
        const { recordStack, gradeStackWeek, stackSummary, noteFirstSeen, gradeFirstSeenWeek } = await import("../lib/stack.js"), RR = globalThis.__TEST_REDIS__;
        for (const k of await RR.keys("stack*:2099:7")) await RR.del(k);
        const cc = buildCard(NE, ch.concat(chT), { ...ps(-7.5, 0.5), ...pt }, { spread: { homeSpread: -7.5 } }, { ...alts, ...talts }), pk = cardPicks(cc);
        await recordStack(2099, 7, NE, pk, now); await noteFirstSeen(2099, 7, NE, pk, now);
        const fin = [{ key: "NYJ @ NE", homeScore: 31, awayScore: 20 }];   // NE wins by 11, total 51
        const n1 = await gradeStackWeek(2099, 7, fin), n2 = await gradeFirstSeenWeek(2099, 7, fin), sm = await stackSummary(2099);
        ok(pk.length >= 2 && n1 === pk.length && n2 === pk.length && sm.cardRec["pick|spread"] && sm.cardRec["pick|spread"].w === 1 && sm.cardRec["pick|total"].w === 1 && sm.cardRec["pick|spread"].stk === 1 && !sm.cardRec["cardpick|spread"] && sm.rules["PICK · spread"] && sm.rules["PICK · spread"].w === 1
          && (!cc.spread.pts || (r => r && r.w + r.l === 1)(sm.rules[`PICK w/ POINTS · spread · ${cc.spread.pts.points} pt${cc.spread.pts.points === 1 ? "" : "s"}`])) && sm.card.spread.w === 1 && sm.card.total.w === 1 && sm.recorded >= pk.length,
          "recorded + graded: the card's PICK and PICK w/ POINTS are saved at kickoff, graded when the game ends, and counted in the Models tab (by id, by rule label and in the spread / total tiles)", { n1, n2, cardRec: sm.cardRec, rules: sm.rules });
        for (const k of await RR.keys("stack*:2099:7")) await RR.del(k); }
      { const g2 = { key: "NYJ @ NE", card: c1 }, lp = plainLeg(g2, "spread");
        ok(lp && lp.label === "NE -7.5" && lp.price === 0.5 && lp.prob === 0.512 && !lp.bought, "parlay legs: the plain line only (no parlay uses a bought line since 10/19)"); }
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
    { const { recordedFor } = await import("../lib/paper.js"), RR = globalThis.__TEST_REDIS__;   // 10/19: a game whose PICK is the model's side is not "PICK missing"
      await RR.hset("stack:2097:6", "A @ B|modelpick|spread", "{}", "A @ B|ptspick|spread", "{}", "C @ D|ptspick|total", "{}");
      const rf = await recordedFor(2097, 6, [{ key: "A @ B", started: true }, { key: "C @ D", final: true }], { close: () => "x" });
      ok(rf[0].card === 1 && rf[1].card === 0, "System 'Recorded this week' (10/19): a model-side PICK counts as the card's PICK; a game with only PICK w/ POINTS still shows PICK missing", rf); await RR.del("stack:2097:6"); }
    { const { stackSummary } = await import("../lib/stack.js"), RR = globalThis.__TEST_REDIS__;   // 10/19: tiles, LINE VALUE and game by game = the card's PICK locked at kickoff, one per game and market
      await RR.hset("stack:2098:6", "A @ B|keynum|spread", JSON.stringify({ id: "keynum|spread", kind: "spread", team: "A", home: "B", game: "A @ B", week: 6, hit: 58.1, line: 3.5, first: { line: 3.5 }, result: "L" }),
        "A @ B|cardpick|spread", JSON.stringify({ id: "cardpick|spread", kind: "spread", team: "A", home: "B", game: "A @ B", week: 6, hit: 56.5, line: 2.5, first: { line: 3.5 }, result: "W" }),
        "A @ B|modelpick|total", JSON.stringify({ id: "modelpick|total", kind: "total", side: "over", game: "A @ B", week: 6, hit: 51.7, line: 44.5, first: { line: 44.5 }, result: "L", price: 0.5 }),
        "A @ B|ptspick|total", JSON.stringify({ id: "ptspick|total", kind: "total", side: "over", game: "A @ B", week: 6, hit: 57, line: 42.5, points: 2, first: { line: 42.5 }, result: "W", price: 0.6 }),
        "C @ D|chooser|spread", JSON.stringify({ id: "chooser|spread", kind: "spread", team: "C", home: "D", game: "C @ D", week: 5, hit: 52, line: 3, result: "W" }));
      const sm = await stackSummary(2098), c = sm.card;
      ok(c.from === 6 && c.spread.w === 1 && c.spread.l === 0 && c.total.w === 0 && c.total.l === 1 && c.clv.n === 2 && c.clv.spread.sum === 1 && c.clv.total.sum === 0
        && sm.cardRec["pick|spread"].w === 1 && sm.cardRec["pick|total"].l === 1 && sm.cardRec["ptspick|total"].w === 1 && !sm.cardRec["modelpick|total"]
        && c.byGame["6|A @ B"].length === 3 && c.byGame["6|A @ B"].some((x) => x.pts) && !c.byGame["6|A @ B"].some((x) => x.pick === "A +3.5") && c.byGame["5|C @ D"].length === 1,
        "card record (10/19): tiles = the card's PICK (rule or model side) from the new card's first week; BEAT THE's own record and PICK w/ POINTS are not in the tiles; line value split by market; earlier weeks keep their old card pick in game by game", { card: c, cardRec: sm.cardRec }); await RR.del("stack:2098:6"); }
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
  { // 10/19 (owner, option B): TEAM MODEL rule -- fires only when the team model is 58%+ sure, shows the tested band rate, only with this week's numbers
    const { useTeamSide, teamSideProb } = await import("../lib/teammodel.js"), { teamModelPick, TEAM_BANDS } = await import("../lib/stack.js"), { buildCard } = await import("../lib/cardpick.js");
    const ts = { season: 2026, week: 7, feat: ["d_s_marg", "hline"], mean: [0, 0], sd: [1, 1], coef: [0.5, 0], b0: 0, n: 3573, teams: { AAA: { s_marg: 1 }, BBB: { s_marg: 0 }, CCC: { s_marg: 0.2 }, DDD: { s_marg: 0 } } };
    useTeamSide(ts);
    const p = teamSideProb("AAA", "BBB", -3); ok(Math.abs(p - 1 / (1 + Math.exp(-0.5))) < 1e-9, "team model: logistic on home-minus-away numbers (standardized), as published by the rebuild", p);
    const g = { key: "BBB @ AAA", away: "BBB", home: "AAA" }, pk = teamModelPick(g, -3, 7);
    { // 10/20 owner: "Model (Team):" line on every spread card -- the side and how sure, on every game, even under 58%; recorded as teamside|spread
      const { teamSideLine, ruleLabel } = await import("../lib/stack.js");
      const a = teamSideLine(g, -3, 7), b = teamSideLine({ key: "DDD @ CCC", away: "DDD", home: "CCC" }, 2.5, 7), c = teamSideLine(g, -3, 6), d = teamSideLine(g, 0, 7);
      ok(a && a.id === "teamside|spread" && a.pick === "AAA -3" && a.pct === 62.2 && a.model === true && b && b.pick === "CCC +2.5" && b.pct === 52.5 && !teamModelPick({ key: "DDD @ CCC", away: "DDD", home: "CCC" }, 2.5, 7) && c === null && d === null
        && ruleLabel({ id: "teamside|spread" }) === "MODEL (TEAM) · spread" && /teamside/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8").match(/Model \(Team\)/) ? "teamside" : ""),
        "Model (Team) line: side + sure % on every game (52.5% shown while no TEAM MODEL pick), only this week's numbers, never on a pick'em; own record label", { a, b, c, d });
    }
    ok(pk && pk.id === "teammodel|spread" && pk.pick === "AAA -3" && pk.hit === 63.4 && pk.team === "AAA" && pk.line === -3, "team model 62% sure -> TEAM MODEL pick on that team at the line, shown at the tested 58%+ band rate (63.4%, C 0.02)", pk);
    const away = teamModelPick({ key: "AAA @ BBB", away: "AAA", home: "BBB" }, 3, 7);
    ok(away && away.pick === "AAA -3" && away.team === "AAA" && away.line === -3, "team model: the away side when it is the sure one (line from the away team's view)", away);
    ok(teamModelPick({ key: "DDD @ CCC", away: "DDD", home: "CCC" }, -3, 7) === null, "team model under 58% sure (52.5%) -> no pick (a coin flip in the test)");
    ok(teamModelPick(g, -3, 8) === null && teamModelPick(g, 0, 7) === null && teamModelPick({ key: "X @ Y", away: "X", home: "Y" }, -3, 7) === null, "team model: no pick with last week's numbers, at a pick'em, or for a team it has no numbers for");
    ok(TEAM_BANDS.length === 1 && TEAM_BANDS[0][0] === 0.58 && TEAM_BANDS[0][1] === 63.4 && /C = 4, 2011, 0\.02/.test(readFileSync(new URL("../railway-model-service/team_side.py", import.meta.url), "utf8")), "team model band rates = the tested ones (10/27, C 0.02, no spread input: 58%+ 63.4%)");
    { // 10/26 angle mix: OVERSHOOT -- the game model likes a side by 2+ vs the current line AND the line moved 1+ that way since the week's first line -> the other side
      const { overshootPick, OVERSHOOT } = await import("../lib/stack.js"), og = { key: "BBB @ AAA", away: "BBB", home: "AAA" };
      const a = overshootPick(og, 6, -3.5, -2.5, 7), b = overshootPick(og, 6, -3.5, -3, 7), c = overshootPick(og, 4.5, -3.5, -2.5, 7), d = overshootPick(og, -5, 2.5, 1.5, 7), e = overshootPick(og, 6, -3.5, -2.5, 3), f = overshootPick(og, null, -3.5, -2.5, 7);
      ok(a && a.id === "overshoot|spread" && a.pick === "BBB +3.5" && a.team === "BBB" && a.line === 3.5 && a.hit === 57 && a.n === 242 && OVERSHOOT.edge === 2 && OVERSHOOT.move === 1,
        "OVERSHOOT: AAA opened -2.5, now -3.5 (moved 1 toward AAA) and the model says AAA by 6 (2.5 over the line) -> BBB +3.5 at 57%", a);
      ok(b === null && c === null && e === null && f === null, "no OVERSHOOT when the line moved under 1 point, the model edge is under 2, before week 4, or with no model number", { b, c, e, f });
      ok(d && d.pick === "AAA +2.5" && d.team === "AAA", "OVERSHOOT the other way: BBB opened -1.5, now -2.5 (moved 1 toward BBB), model BBB by 5 (2.5 over the line) -> AAA +2.5", d);
    }
    { // 10/26 angle mix: TEAM MODEL x the line move since the week's first line (AAA home -3 now, 62.2% sure)
      const ag = teamModelPick(g, -3, 7, undefined, -4), tw = teamModelPick(g, -3, 7, undefined, -2), fl = teamModelPick(g, -3, 7, undefined, -3.5), aw = teamModelPick({ key: "AAA @ BBB", away: "AAA", home: "BBB" }, 3, 7, undefined, 4), aw2 = teamModelPick({ key: "AAA @ BBB", away: "AAA", home: "BBB" }, 3, 7, undefined, 2);
      ok(ag && ag.hit === 70.6 && ag.n === 85 && ag.mv === "against" && tw === null && fl && fl.hit === 61.3 && fl.mv === "flat" && aw && aw.mv === "against" && aw.hit === 70.6 && aw2 === null && pk.mv === null,
        "TEAM MODEL x line move (10/27, C 0.02): opened AAA -4, now -3 (1 point more for its side) -> 70.6%; opened -2 (moved its way) -> no pick; half a point -> the flat rate 61.3%; no opener -> the plain band", { ag, tw, fl, aw });
    }
    const card = buildCard({ key: "BBB @ AAA", away: "BBB", home: "AAA", poly: { spread: { homeSpread: -3, home: 0.5, away: 0.5 } } }, [pk], { spread: { homeSpread: -3, home: 0.5, away: 0.5 } }, null, null);
    ok(card && card.spread && card.spread.plain && card.spread.plain.pick === "AAA -3" && card.spread.plain.hit === 63.4 && /^teammodel/.test(card.spread.plain.ruleId || card.spread.plain.id || "teammodel"), "the card's PICK comes from the TEAM MODEL rule when it is the only rule", card && card.spread && card.spread.plain);
    { const { recordStack, gradeStackWeek, stackSummary } = await import("../lib/stack.js"), RR = globalThis.__TEST_REDIS__, now = "2099-10-25T17:00:00Z";
      for (const k of await RR.keys("stack*:2099:8")) await RR.del(k);
      await recordStack(2099, 8, g, [pk], now);
      const n = await gradeStackWeek(2099, 8, [{ key: "BBB @ AAA", homeScore: 24, awayScore: 17 }]), sm = await stackSummary(2099), r = sm.rules["TEAM MODEL"];
      ok(n === 1 && r && r.w === 1 && r.l === 0, "TEAM MODEL pick saved at kickoff is graded (AAA -3, won by 7) and counted on its own Models row", { n, r });
      for (const k of await RR.keys("stack*:2099:8")) await RR.del(k); }
    useTeamSide(null); }
  { // 10/18 (owner: "fix the gaps"): a parlay type added after the week's save is added once, before its games; a graded game missing its TD list gets it once
    const P = await import("../lib/paper.js"), { getJSON, setJSON } = await import("../lib/redis.js"), R = globalThis.__TEST_REDIS__;
    const mk = (k, a, h, fair) => ({ key: k, away: a, home: h, started: false, final: false, kickoff: "2099-10-18T17:00:00Z", poly: { ml: { home: 0.7, away: 0.32 } }, td: [{ player: a + ".RB", team: a, pos: "RB", fair, price: fair / 100, bid: fair / 100 - 0.02 }, { player: h + ".RB", team: h, pos: "RB", fair: fair - 5, price: (fair - 5) / 100, bid: (fair - 5) / 100 - 0.02 }] });
    const data = { games: [mk("A @ B", "A", "B", 60), mk("C @ D", "C", "D", 58), mk("E @ F", "E", "F", 56), mk("G @ H", "G", "H", 54), { ...mk("I @ J", "I", "J", 70), started: true }] };
    const old = { strategy: "td_likely_3", legs: [{ game: "A @ B", kind: "td", team: "B", price: 0.55 }] };
    await setJSON("paper:2097:6", { t: "2026-10-17T14:00:00Z", season: 2097, week: 6, parlays: [old] });
    const n1 = await P.recordPaper(2097, 6, data), rec1 = await getJSON("paper:2097:6"), n2 = await P.recordPaper(2097, 6, data);
    const f1 = rec1.parlays.find((p) => p.strategy === "td_likely_3");
    ok(n1 > 0 && n2 === 0 && f1 && f1.refreshedAt && f1.legs.length === 3 && rec1.parlays.some((p) => p.strategy === "td_likely_2") && rec1.parlays.every((p) => p.legs.every((l) => l.game !== "I @ J")),
      "weekly parlays (10/19): every type is rebuilt before its games start (the Saturday copy is replaced, missing types added, never a started game; a second pass changes nothing)", rec1.parlays.map((p) => p.strategy));
    const lockedOld = { strategy: "td_likely_2", legs: [{ game: "C @ D", kind: "td", team: "C", price: 0.58, label: "C.RB TD" }, { game: "A @ B", kind: "td", team: "A", price: 0.6, label: "A.RB TD" }] };
    await setJSON("paper:2097:8", { t: "2026-10-17T14:00:00Z", season: 2097, week: 8, parlays: [lockedOld] });
    const d8 = { games: data.games.map((g) => (g.key === "C @ D" ? { ...g, started: true } : g)) };
    await P.recordPaper(2097, 8, d8); const r8 = await getJSON("paper:2097:8");
    ok(JSON.stringify(r8.parlays.find((p) => p.strategy === "td_likely_2")) === JSON.stringify(lockedOld) && r8.parlays.every((p) => p === r8.parlays[0] || p.legs.every((l) => l.game !== "C @ D")),
      "weekly parlays (10/19): a type with a started leg is never changed; new types never use a started game");
    const keepOld = { strategy: "td_likely_3", legs: [{ game: "A @ B", kind: "td", team: "A", player: "A.RB", label: "A.RB TD", price: 0.6 }] };
    await setJSON("paper:2097:9", { t: "2026-10-17T14:00:00Z", season: 2097, week: 9, parlays: [keepOld] });
    await P.recordPaper(2097, 9, { games: data.games.map((g) => ({ ...g, td: [] })) }); const r9 = await getJSON("paper:2097:9");
    ok(r9.parlays.some((p) => p.strategy === "td_likely_3" && JSON.stringify(p) === JSON.stringify(keepOld)), "weekly parlays (10/19 check): a build with no parlay of a type (TD data failed to load) keeps the saved copy", r9.parlays.map((p) => p.strategy));
    for (const k of await R.keys("paper:2097:*")) await R.del(k);
    const g = await import("../lib/grade.js"), { SEASON, resetGamesCache } = await import("../lib/games.js"), realFetch = globalThis.fetch, oldUrl = process.env.MODEL_SERVICE_URL;
    process.env.MODEL_SERVICE_URL = "https://svc.test";
    const H = "season,game_type,week,gameday,gametime,away_team,away_score,home_team,home_score,spread_line,total_line,roof,stadium,location,surface\n";
    resetGamesCache(); globalThis.fetch = async (u) => (String(u).includes("games.csv") ? { ok: true, text: async () => H + `${SEASON},REG,3,2026-09-28,20:15,PHI,7,CHI,27,-3,44.5,o,s,Home,g\n` }
      : String(u).includes("/td-scorers") ? { ok: true, json: async () => ({ ok: true, games: { "PHI @ CHI": ["D.Swift"] }, teams: { "PHI @ CHI": { "D.Swift": ["CHI"] } }, counts: { "PHI @ CHI": { "D.Swift": 1 } }, first: { "PHI @ CHI": "D.Swift" } }) }
      : { ok: false, status: 404, json: async () => ({}), text: async () => "" });
    await setJSON(`model:${SEASON}:3`, { games: {}, td: { "PHI @ CHI": { away: [{ name: "S.Barkley", pos: "RB", fair: 48 }], home: [{ name: "D.Swift", pos: "RB", fair: 52 }] } } });
    const before = { v: 2, game: "PHI @ CHI", awayScore: 7, homeScore: 27, spread: { basis: "model", label: "CHI -3", result: "W", clvPts: 0 }, lineChecked: true, mlChecked: true, clvChecked: true, mlModelChecked: true };
    await setJSON(`res:${SEASON}:3:PHI @ CHI`, before);
    await g.gradeWeek(SEASON, 3); const after = await getJSON(`res:${SEASON}:3:PHI @ CHI`);
    ok(after.tdBackfill && after.td && after.td.length === 2 && after.td.find((p) => p.player === "D.Swift").scored === true && after.td.find((p) => p.player === "S.Barkley").scored === false && JSON.stringify(after.spread) === JSON.stringify(before.spread),
      "grading: a game graded without its TD list gets it once (scored / not scored), nothing else re-graded", after);
    ok(after.td.find((p) => p.player === "D.Swift").ftdHit === true && after.ftdTeam && after.ftdTeam.first === "home" && after.ftdTeam.hs === null && after.ftdTeam.home === null, "grading 10/20: the result keeps which team scored the first TD (D.Swift, CHI = home); no closing spread on this path = no team chance saved", after.ftdTeam);
    globalThis.fetch = realFetch; resetGamesCache(); if (oldUrl === undefined) delete process.env.MODEL_SERVICE_URL; else process.env.MODEL_SERVICE_URL = oldUrl;
    for (const k of await R.keys(`*${SEASON}:3*`)) await R.del(k); }
  { // Anytime TD tab (10/27): the 5 likeliest per team, no drought cut, the red note counts the games without a TD
    const box = { innerHTML: "" }, hdr = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "td" ? box : id === "td-header" ? hdr : old(id));
    const pl = (team, i) => ({ player: `${team}.P${i}`, team, pos: "RB", fair: 50 - i * 5, price: 0.5, bid: 0.48, teamRank: i + 1, game: "A @ B", flags: [] });
    vm.runInContext(`S = { week: 4, games: [ { key: "A @ B", away: "A", home: "B", started: false, td: [${[0,1,2,3,4,5].map((i) => JSON.stringify(pl("A", i))).join(",")}, ${[0,1,2,3,4,5].map((i) => JSON.stringify(pl("B", i))).join(",")}] } ] }`, ctx);
    const allScored = `TDW = { weeks: { 1: { games: S.games.map((g) => g.key), counts: Object.fromEntries(S.games.map((g) => [g.key, Object.fromEntries((g.td || []).map((r) => [r.player, 1]))])), final: true } } }; TDW_AT = Date.now();`;
    vm.runInContext(allScored, ctx); ctx.T.renderTd(); const rows = (box.innerHTML.match(/class="pbl ppr first tdr"/g) || []).length, first = box.innerHTML;
    ok(rows === 10 && !(hdr.textContent || hdr.innerHTML) && /A\.P4\b/.test(first) && !/A\.P5\b/.test(first) && !/✗/.test(first), "touchdown tab (10/27): five players per team (the likeliest), no note when all scored last game, no subtitle");
    const seg = (h, n) => (h.split('class="pbl ppr first tdr"').find((q) => q.includes(`|${n}"`)) || "");
    vm.runInContext(`delete TDW.weeks[1].counts["A @ B"]["A.P1"]; delete TDW.weeks[1].counts["A @ B"]["B.P0"];`, ctx); ctx.T.renderTd(); const cut = box.innerHTML;
    ok(/A\.P1\b/.test(cut) && /B\.P0\b/.test(cut) && !/A\.P5\b/.test(cut) && (cut.match(/class="pbl ppr first tdr"/g) || []).length === 10 && /<span class="wc r">✗ no TD last game<\/span>/.test(seg(cut, "A.P1")) && !/✗/.test(seg(cut, "A.P0")), "touchdown tab (10/27): a player with no TD is NOT cut -- he stays in the top 5 with the red note; nobody moves up");
    vm.runInContext(`TDW.weeks[2] = { games: ["A @ B"], counts: { "A @ B": { "A.P0": 1 } }, final: true }; TDW.weeks[3] = { games: ["A @ B"], counts: { "A @ B": { "A.P0": 1, "A.P3": 1 } }, final: true };`, ctx); ctx.T.renderTd(); const warn = box.innerHTML;
    ok((warn.match(/class="pbl ppr first tdr"/g) || []).length === 10 && /✗ no TD last 3 games/.test(seg(warn, "A.P1")) && /✗ no TD last 2 games/.test(seg(warn, "A.P2")) && !/✗/.test(seg(warn, "A.P3")) && !/✗/.test(seg(warn, "A.P0")) && /✗ no TD last 3 games/.test(seg(warn, "B.P0")) && /✗ no TD last 2 games/.test(seg(warn, "B.P1")) && !/straight/.test(warn),
      "touchdown tab (10/27): the note counts the games -- 'no TD last 2 games', 'last 3 games' (no TD this season = every game played); the player who just scored has none", warn.slice(0, 600));
    vm.runInContext(`TDW = null;`, ctx); ctx.T.renderTd(); ok(/Loading…/.test(box.innerHTML) && !/class="pbl ppr first tdr"/.test(box.innerHTML), "touchdown tab: no rows are drawn before the week feed is in");
    ctx.document.getElementById = old; }
  ok(playedLastGame({ missed: false, pct: 88 }) && !playedLastGame({ missed: true, pct: 60 }) && !playedLastGame({ missed: false, pct: 0 }) && !playedLastGame(null), "was-out tag: a player who played his team's last game is never tagged as out");
  { const ge = { key: "A @ B", away: "A", home: "B", early: true, spreadPick: null, totalPick: null, model: { homeMargin: 5.1, total: 44.9, homeWinPct: 66.4 } };
    const sp = ctx.T.leanCell(ge, "spread"), tt = ctx.T.leanCell(ge, "total");
    ok(/B -5\.1/.test(sp) && /B wins 66%/.test(sp) && /Early estimate/.test(sp) && /Total 44\.9/.test(tt) && !/<em>—|class="dim">—/.test(sp), "early games: the Model leans boxes show the model's own spread, win chance and total, labeled");
    ok(!/B -5/.test(ctx.T.leanCell({ ...ge, early: false }, "spread")), "not early: the boxes stay blank without a market line"); }
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
    ok(/RB · 2 players/.test(pos) && /WR · 1 player/.test(pos) && /TE · 2 players/.test(pos) && !/no position/.test(pos) && !/±/.test(pos), "by position: RB, WR and TE rows with sample size; no margin of error, no no-position line (10/19)");
    ok(ctx.T.tdByDefense([]).includes("None yet"), "by defense: rows flag small samples; empty says it fills in"); }
  { // one week only (10/6): Anytime TD and Game Lines show this week, no next-week section
    const bx = { innerHTML: "" }, hx = { innerHTML: "" }, oldG = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "td" ? bx : id === "td-header" ? hx : oldG(id));
    const pl = (team, i) => ({ player: `T.${team}${i}`, team, pos: "RB", fair: 50 - i * 5, price: 0.5, bid: 0.48, teamRank: i + 1, game: "A @ B", flags: [] });
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", away: "A", home: "B", started: false, td: ${JSON.stringify([0, 1, 2, 3].map((i) => pl("A", i)).concat([0, 1, 2, 3].map((i) => pl("B", i))))} }] }`, ctx); vm.runInContext(`TDW = { weeks: { 1: { games: S.games.map((g) => g.key), counts: Object.fromEntries(S.games.map((g) => [g.key, Object.fromEntries((g.td || []).map((r) => [r.player, 1]))])), final: true } } }; TDW_AT = Date.now();`, ctx); ctx.T.renderTd();
    ok((bx.innerHTML.match(/class="pbl ppr first tdr"/g) || []).length === 8 && !/Next week/.test(bx.innerHTML) && /T\.A3/.test(bx.innerHTML), "touchdown tab: this week's 4 scorers per team (all scored last game), no next-week section");
    { const p2 = (n, f, price) => ({ player: n, team: "A", pos: "RB", fair: f, price, bid: price - 0.02, teamRank: 1, game: "A @ B", flags: [] });
      vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", away: "A", home: "B", started: false, td: ${JSON.stringify([p2("Star.One", 64, 0.6), p2("Mid.Two", 40, 0.65), p2("Low.Three", 30, 0.3)])} }] }`, ctx); vm.runInContext(`TDW = { weeks: { 1: { games: S.games.map((g) => g.key), counts: Object.fromEntries(S.games.map((g) => [g.key, Object.fromEntries((g.td || []).map((r) => [r.player, 1]))])), final: true } } }; TDW_AT = Date.now();`, ctx); ctx.T.renderTd();
      const list = bx.innerHTML.split('class="sh labslot tdtog').pop() || "";
      ok(/Star\.One/.test(bx.innerHTML) && !/Star\.One/.test(list) && /Mid\.Two/.test(list), "touchdown tab: a Best TD pick is not repeated in the list below");
      ok(!/Market disagrees/.test(bx.innerHTML) && !/class="more"/.test(bx.innerHTML), "touchdown tab: one-line rows, no market-disagrees warning and nothing to open (owner 10/20 night)"); }
    vm.runInContext(`S = { week: 4, games: [{ key: "A @ B", started: true, td: [] }] }`, ctx); vm.runInContext(`TDW = { weeks: { 1: { games: S.games.map((g) => g.key), counts: Object.fromEntries(S.games.map((g) => [g.key, Object.fromEntries((g.td || []).map((r) => [r.player, 1]))])), final: true } } }; TDW_AT = Date.now();`, ctx); ctx.T.renderTd();
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
    const res = [{ td: [{ ftd: 20, ftdHit: true, played: true }, { ftd: 10, ftdHit: false, played: true }] }, { td: [{ ftd: 30, ftdHit: false, played: false }, { ftd: 18, ftdHit: false, played: true }] }];
    ok(/1 of 2 · 50% · exp 19%/.test(ctx.T.firstTdRecord(res)) && ctx.T.firstTdRecord([]) === "", "first TD picks: season record uses each game's top pick who played");
    const { buildFtdCalibration, applyFtdCalibration, FTD_MIN_GAMES } = await import("../lib/calibration.js");
    const recs = (n) => [...Array(n)].map(() => ({ td: [...Array(10)].map((_, i) => ({ ftd: 8, ftdHit: i === 0, played: true })) }));
    const off = { ftd: buildFtdCalibration(recs(15)) }, on = { ftd: buildFtdCalibration(recs(FTD_MIN_GAMES)) };
    ok(!off.ftd.on && applyFtdCalibration(8, off) === 8 && !on.ftd.on && applyFtdCalibration(8, on) === 8 && applyFtdCalibration(8, { ftd: { ...on.ftd, on: true } }) > 8 && applyFtdCalibration(8, { ftd: { ...on.ftd, on: true } }) <= 8 * 1.15 + 0.05, "first-TD calibration: off for good (10/27 walk-forward: worse than none), even past 100 graded games; the shrunk, capped correction is still built");
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
    ok(L.map((x) => x.name).join("") === "EBADC" && L[2].shown === "DNP (practice)" && L[3].shown === "Limited (practice)" && L[4].shown === "Full (practice)" && !L[0].shown, "injuries: Out/Questionable first, then DNP, Limited and Full practice (labeled)");
    const card = ctx.T.gameCard({ ...tg, injuries: L.map((x) => ({ ...x, team: "PIT", pos: "WR", week: 5 })) }, "x");
    ok(/Injuries 5/.test(card) && /DNP \(practice\)/.test(card) && /Full \(practice\)/.test(card), "injuries: the button shows with practice-only notes"); }
  { // 10/23: ESPN statuses posted after the official copy replace the practice tags in the Injuries box
    const { injDisplay, injWithEspn } = await import("../lib/week.js");
    const base = injDisplay([{ name: "Trent McDuffie", status: "Did Not Participate In Practice", team: "LA", week: 7 }, { name: "Quay Walker", status: "Limited Participation in Practice", team: "LV", week: 7 }, { name: "Old Guy", status: "Limited Participation in Practice", team: "LV", week: 7 }]);
    const espnT = { LA: [{ name: "Trent McDuffie", status: "Questionable", date: "2026-10-23T23:40Z" }, { name: "Nate Landman", pos: "LB", status: "Out", date: "2026-10-23T23:34Z" }, { name: "Stale Out", status: "Out", date: "2026-10-23T10:00Z" }],
      LV: [{ name: "Quay Walker", status: "Active", date: "2026-10-24T00:04Z" }, { name: "Healthy Guy", status: "Active", date: "2026-10-24T00:04Z" }, { name: "Last Week", status: "Out", date: "2026-10-17T00:00Z" }] };
    const M = injWithEspn(base, espnT, ["LA", "LV"], "2026-10-23T12:34Z", { LA: Date.parse("2026-10-12T20:00Z"), LV: Date.parse("2026-10-19T00:15Z") });
    espnT.LV.push({ name: "Dont'e Thornton Jr.", pos: "WR", status: "Injured Reserve", date: "2026-10-23T23:43Z" }, { name: "Old IR", pos: "TE", status: "Injured Reserve", date: "2026-09-20T00:00Z" }, { name: "Banned Guy", status: "Suspension", date: "2026-10-01T00:00Z" });
    const M2 = injWithEspn(base, espnT, ["LA", "LV"], "2026-10-23T12:34Z", { LA: Date.parse("2026-10-12T20:00Z"), LV: Date.parse("2026-10-19T00:15Z") });
    const b2 = Object.fromEntries(M2.list.map((x) => [x.name, x]));
    ok(b2["Dont'e Thornton Jr."].status === "Out (IR)" && b2["Old IR"].status === "Out (IR)" && b2["Banned Guy"].status === "Out (suspended)" && M2.list[0].name === "Nate Landman" && /^Out \(/.test(M2.list[1].status),
      "injuries: reserve-list / suspended players show as Out (IR) / Out (suspended) whatever the note's date, listed right after Out");
    const by = Object.fromEntries(M.list.map((x) => [x.name, x]));
    ok(by["Trent McDuffie"].status === "Questionable" && !by["Trent McDuffie"].shown && by["Nate Landman"].status === "Out" && by["Nate Landman"].team === "LA"
      && by["Quay Walker"].shown === "No designation" && by["Old Guy"].shown === "Limited (practice)" && !by["Stale Out"] && !by["Healthy Guy"] && !by["Last Week"]
      && M.list[0].name === "Nate Landman" && M.list[M.list.length - 1].name === "Quay Walker" && M.t === "2026-10-24T00:04:00.000Z",
      "injuries: newer ESPN statuses replace the official copy's practice tags (Out added, Questionable, no designation), older ESPN rows ignored");
    const card = ctx.T.gameCard({ ...tg, injuries: M.list.map((x) => ({ ...x, pos: x.pos || "LB" })), injEspnAt: M.t }, "x");
    ok(/Official report \+ ESPN/.test(card) && /No designation/.test(card), "injuries: the box says Official report + ESPN when ESPN statuses are used"); }
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
    const { overlayPolyKickoffs } = await import("../lib/games.js");   // 10/21 cleanup: polyKickoffs (Polymarket's start time) is gone -- never used since 10/8; KICK_FIX (hand-confirmed moves) still goes through overlayPolyKickoffs
    const pk = { "CHI @ GB": "2026-10-11T20:25:00.000Z", "BUF @ LA": "2026-10-13T00:15:00.000Z" };
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
    { const no = soldFrom({ type: "ACTIVITY_TYPE_TRADE", trade: { marketSlug: "aec-nfl-buf-lv-2026-10-18", price: { value: "0.9750" }, qty: "100", realizedPnl: { value: "63.08" }, effectiveRealizedPnl: { value: "-31.94" }, updateTime: "2026-10-18T23:23:24Z" } });
      ok(no && no.pl === -31.94 && no.fixed, "sold (10/18): a NO-side bet (Raiders on the Bills market) uses effectiveRealizedPnl -31.94, not the YES-side +63.08", no); }
    const row = ctx.T.betRow ? ctx.T.betRow({ source: "account", title: "caoc-1", week: 5, cost: 5, price: 0.08, toWin: 59, result: "W", pl: 14.94, sold: { pl: 14.94, proceeds: 21.03 } }) : "";
    ok(/class="g">Sold<\/span> /.test(row) && /sold early for \$19\.94/.test(row), "sold: shown as Sold with the profit; paid back = stake + profit"); }
  { // linked combo legs (10/9)
    const { comboChance, pairLift } = await import("../lib/combo.js");
    const td = { game: "A @ B", kind: "td", team: "B", prob: 0.5 }, cov = { game: "A @ B", kind: "spread", team: "B", prob: 0.5 }, opp = { game: "A @ B", kind: "spread", team: "A", prob: 0.5 },
      ov = { game: "A @ B", kind: "total", side: "over", prob: 0.5 }, un = { game: "A @ B", kind: "total", side: "under", prob: 0.5 }, other = { game: "C @ D", kind: "spread", team: "D", prob: 0.5 };
    ok(pairLift(td, cov) === 1.19 && pairLift(cov, td) === 1.19 && pairLift(td, opp) === 0.81 && pairLift(td, ov) === 1.23 && pairLift(td, un) === 0.77 && pairLift(cov, ov) === 1 && pairLift(td, other) === 1, "combo links: TD with cover/Over up, with opponent/Under down, other pairs unrelated");
    ok(Math.abs(comboChance([td, cov, ov]) - 0.125 * Math.pow(1.19 * 1.23, 0.75)) < 1e-12 && Math.abs(comboChance([td, cov]) - 0.25 * Math.pow(1.19, 0.75)) < 1e-12 && Math.abs(comboChance([td, cov, un]) - 0.125 * Math.pow(1.19, 0.75) * 0.77) < 1e-12 && comboChance([td, { ...cov, prob: null }]) === null && comboChance([{ ...td, prob: 0.9 }, { ...cov, prob: 0.9 }]) <= 0.9, "combo chance: product times the same-game touchdown links shrunk by the 0.75 power (10/16), capped at the least likely leg");
  }
  { // weakest leg of an open combo (10/9)
    const L = (n, p, m) => ({ kind: "total", side: "over", line: n, price: p, modelP: m, result: "pending" });
    const b = { result: "pending", legs: [L(40, 0.5, 0.55), L(41, 0.6, 0.4), L(42, 0.5, 0.49)] };
    ok(ctx.T.weakLeg(b) === b.legs[1] && ctx.T.weakLeg({ ...b, legs: [L(40, 0.5, 0.55), L(41, 0.5, 0.49)] }) === null && ctx.T.weakLeg({ ...b, result: "W" }) === null, "weakest leg: the leg furthest below its price, only on open combos"); }
  { // confidence: angles agreeing on one side (10/9)
    const g = { ...tg, combos: [{ pick: "TB +4.5", why: "a", hit: 58, n: 2535 }, { pick: "TB +4.5", why: "b", hit: 59, n: 2535 }, { pick: "Under 41.5", why: "c", hit: 57, n: 2580 }] };
    ok(/>TB \+4\.5</.test(ctx.T.tile(g)) && !/×2/.test(ctx.T.tile(g)), "tile chip: the game's best straight pick only"); }
  { const A = await import("../lib/alerts.js"); ok(!A.alertsTdJump && !A.alertsTdNo && !A.alertsQbJump && !A.tdNoGapServer, "alerts (cleanup 10/18): the TD JUMP, TD NO and QB TD code is gone (those kinds were cut 10/18)"); }
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
    { const PP = ctx.T.parlayPicks(); ok(PP.length === 3 && new Set(PP.map((x) => x.game)).size === 3 && PP[0].p >= PP[2].p && /Chance all 3 hit: <b>\d+%<\/b>/.test(ctx.T.parlayStrip()), "parlay of the week (10/19: three legs max): top 3 green picks, one per game, chance all hit"); }
    ok(B2.length === 10 && B2[0].p >= B2[9].p && !B2.some((x) => x.pick === "L +1") && !B2.some((x) => x.pick === "B -3.5"), "best bets: top 10 at 56%+; teasers and alt lines in their own list"); }
  {
    { const { movePicks, gradeStackPick, comboFactors } = await import("../lib/stack.js"), G = { key: "A @ B", away: "A", home: "B", outdoor: true, kickoff: "2026-10-11T17:00:00Z" };
      const F = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, fix: {} }, -8, 40, -8, 40, null, 6).F;
      const X = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, temp: 20, fix: { awayQbFirstStart: true }, xf: { homeRest: 7, awayRest: 4, homeCoach: 0.6, awayCoach: 0.4, homeAge: 27, awayAge: 25.5, awayQbRun: 7, tzdiff: 3, early: true, ptsTot: 45, s: { gbm: -0.1, logit: -0.1, rf: -0.1, ens: -0.5 }, t: { gbm: 0.1, ridge: -0.1, ens: 0.4 } } }, -8, 40, -8, 40, null, 6).F;
      ok(X.cold && X.shortwk && X["dogrest-"] && X.dogCoachBad && X.favCoachGood && X.dogNewQB && X.awayEastEarly && X.tz2P && X.dogYounger1 && X.dogQBruns && X.bigDogQBruns && X.ptsTotO3 && X.gbmDog && X.logitDog && X.rfDog && X.statDog && X.gbmO && X.ridgeU && X.statO && !X.allLeanDog && !X.homeCoachBad, "combo factors from the model service: rest, coaches, QB, travel, age, stats models");
      const C0 = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, fix: {} }, -8, 40, -8, 40, null, 6), ug = C0.up.margin - 8, ut = C0.up.total - 40;
      ok(F.wind15 && F.wind10 && F["sp>=7"] && F["tot<=41"] && F.mdlFav === (ug > 0) && F.mdlFav3 === (ug >= 3) && F.mdlO === (ut > 0) && F.mdlU === (ut < 0) && !F.prime && F.roadDog, "combo factors from the game (model leans from the upgraded model)");
      const P = movePicks(G, { homeMargin: 12, total: 41, outdoor: true, wind: 16, fix: {} }, -8, 40, -8, 40, null, 6);
      ok(Array.isArray(P) && P.every((x) => x.id === "movepred|total" && x.kind === "total"), "model picks: only TOTAL MOVE can come from the model side (chooser removed 10/16)");
      { const sit = { home: { prevOT: true, nextDiv: true, prevDiv: true, revenge: true, winPct: 0.8 }, away: { prevMon: true, prevAway: true, prev2Away: true, prevMarg: -30, winPct: 0.2 } };
        const NF = comboFactors(G, { homeMargin: 12, total: 41, outdoor: true, wind: 0, fix: { div: false }, xf: { awayRest: 14 } }, -8, 40, -8, 40, sit, 17).F;
        ok(NF.favAfterOT && NF.favLookaheadDiv && NF.favRevenge && NF.dogAfterMNF && NF.dogAfterLoss28 && NF.road2nd && NF.road3rd && NF.roadOffBye && NF.sandwichAny && NF.wk17dogLosing && !NF.divRematch, "combo factors: research factors (overtime, Monday, revenge, lookahead, road trip, bye, sandwich, late season)"); }
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
      ok(/>4 picks/.test(row) && !/Combo/.test(row) && !/caoc-x/.test(row) && /NYG \+3\.5/.test(row) && /Cam Skattebo 1\+ TD/.test(row) && /class="r">Lost<\/span>/.test(row) && /−\$10\.00/.test(row) && !/pays \$294/.test(row), "my bets (10/19): a combo with a lost leg shows Lost and its stake, not 'pays if it wins'");
      const row2 = ctx.T.betRow({ source: "account", title: "caoc-x", week: 5, cost: 10, toWin: 294, price: 0.034, result: "pending", picks: cp.map((x) => ({ ...x, result: x.result === "L" ? null : x.result })) });
      ok(/>4 picks/.test(row2) && !/Combo/.test(row2) && /pays \$294\.00 if it wins/.test(row2) && !/Lost/.test(row2), "my bets: open combo shows its picks in a list");
      const sm = ctx.T.betsSummary([{ result: "pending", cost: 10, toWin: 294, expMarket: 1, picks: cp }, { result: "pending", cost: 5, toWin: 50, expMarket: 2, picks: [{ result: "W" }] }, { result: "W", cost: 2, pl: 3 }]);
      ok(sm.losses === 1 && sm.wins === 1 && sm.openCost === 5 && sm.maxPayout === 50 && sm.expMarket === 2 && Math.abs(sm.pl - (3 - 10)) < 1e-9, "my bets summary (10/19): a combo with a lost leg counts as a loss (-stake) and leaves open money / if-everything-hits", sm); }
    { // 10/19 (owner: "after sunday games are done i need to start seeing week 7 on monday except for the week 6 monday game")
      const { pickDisplayWeek } = await import("../lib/games.js");
      const R = (key, week, kickoff, final) => ({ key, week, kickoff, final });
      const rows = [R("A @ B", 6, "2026-10-16T00:15:00Z", true), R("C @ D", 6, "2026-10-18T17:00:00Z", true), R("E @ F", 6, "2026-10-19T00:20:00Z", true), R("WAS @ SF", 6, "2026-10-20T00:15:00Z", false),
        R("G @ H", 7, "2026-10-23T00:15:00Z", false), R("I @ J", 7, "2026-10-25T17:00:00Z", false)];
      const mon = pickDisplayWeek(rows, 6, Date.parse("2026-10-19T15:00:00Z"));
      ok(mon.week === 7 && mon.carry.length === 1 && mon.carry[0] === "WAS @ SF", "week switch: Sunday games final, only the Monday game left -> pages show week 7 with the Monday game carried on top", mon);
      const sun = pickDisplayWeek(rows.map((r) => r.key === "E @ F" ? { ...r, final: false } : r), 6, Date.parse("2026-10-19T02:00:00Z"));
      ok(sun.week === 6 && !sun.carry.length, "week switch: the Sunday night game still going -> still week 6", sun);
      const two = pickDisplayWeek([...rows, R("K @ L", 6, "2026-10-19T23:00:00Z", false)], 6, Date.parse("2026-10-19T15:00:00Z"));
      ok(two.week === 7 && two.carry.length === 2, "week switch: two Monday games both carried", two);
      const noNext = pickDisplayWeek(rows.filter((r) => r.week === 6), 6, Date.parse("2026-10-19T15:00:00Z"));
      ok(noNext.week === 6, "week switch: no next week on the schedule -> stays", noNext); }
    { // 10/19 (owner: "why is my single bets not showing?"): single player bets ("astatc-" traded on their own) are bets; combo legs still are not
      const { isComboLeg, tradedSingles, propOf, resolvedFrom } = await import("../lib/mybets.js");
      const sl = "astatc-nfl-was-sf-2026-10-19-firsttd-termcl", meta = { slug: sl, title: "WAS Commanders vs. SF 49ers", outcome: "Yes", eventSlug: "nfl-was-sf-2026-10-19", subject: { name: "Terry McLaurin", image: "https://static.polymarket.us/images/teams/football/nfl/was/jerseys/17.png?v=1" } };
      const acts = { activities: [{ type: "ACTIVITY_TYPE_TRADE", trade: { marketSlug: sl } }, { type: "ACTIVITY_TYPE_TRADE", trade: { marketSlug: "crossd-abc" } }] }, sing = tradedSingles(acts);
      ok(sing.has(sl) && sing.size === 1 && !isComboLeg(sl, meta, sing) && isComboLeg("astatc-nfl-was-sf-2026-10-19-td-geokit-gte1", {}, sing) && isComboLeg(sl, { state: "COMBO_LEG_STATE_PENDING" }, sing) && isComboLeg(sl),
        "my bets: an astatc- market traded on its own is a single bet; other astatc- legs (and anything marked COMBO_LEG) stay combo legs", [...sing]);
      const pr = propOf(sl, meta), pr2 = propOf("astatc-nfl-nyg-was-2026-10-11-td-camska-gte2", { eventSlug: "nfl-nyg-was-2026-10-11", subject: { name: "Cam Skattebo", image: ".../football/nfl/nyg/jerseys/44.png" } });
      ok(pr && pr.label === "Terry McLaurin First TD" && pr.team === "WAS" && pr.game === "WAS @ SF" && pr.kind === "td" && pr2.label === "Cam Skattebo 2+ TD" && pr2.team === "NYG", "my bets: single player bet label, team and game", { pr, pr2 });
      { // 10/27 (owner: "fix the straight bets"): Polymarket's subject.name now carries the stat ("CeeDee Lamb 1+ touchdowns") -> the page read "CeeDee Lamb 1+ touchdowns 1+ TD"
        const { cleanLabel, propSpec } = await import("../lib/mybets.js");
        const p3 = propOf("astatc-nfl-dal-phi-2026-10-26-td-ceelam-gte1", { eventSlug: "nfl-dal-phi-2026-10-26", outcome: "Yes", subject: { name: "CeeDee Lamb 1+ touchdowns", image: ".../football/nfl/dal/jerseys/88.png" } });
        const p4 = propOf("astatc-nfl-gb-det-2026-10-25-pyd-jargof-gte250", { eventSlug: "nfl-gb-det-2026-10-25", outcome: "No", subject: { name: "Jared Goff 250+ passing yards", image: ".../football/nfl/det/jerseys/16.png" } });
        ok(p3.label === "CeeDee Lamb 1+ TD" && p3.kind === "td" && p3.team === "DAL" && p4.label === "Jared Goff under 250 Pass Yds" && p4.kind === "prop" && p4.side === "under" && p4.stat === "pyd" && p4.n === 250,
          "10/27: a single's name is cut at its N+; the No side reads 'under N'", { p3, p4 });
        ok(cleanLabel("CeeDee Lamb 1+ touchdowns 1+ TD") === "CeeDee Lamb 1+ TD" && cleanLabel("Jared Goff 250+ Pass Yds") === "Jared Goff 250+ Pass Yds" && cleanLabel("Tee Higgins First TD") === "Tee Higgins First TD" && cleanLabel("Amon-Ra St. Brown 1+ touchdowns 1+ TD") === "Amon-Ra St. Brown 1+ TD",
          "10/27: a saved doubled label reads right; other labels untouched");
        const q1 = propSpec({ label: "Jared Goff 250+ Pass Yds", kind: "prop" }), q2 = propSpec(p4), q3 = propSpec({ label: "Kirk Cousins 22+ Completions" }), q4 = propSpec({ label: "Kirk Cousins 2+ Pass TD" });
        ok(q1 && q1.key === "pass_yds" && q1.line === 249.5 && q1.side === "over" && q1.name === "Jared Goff" && q2 && q2.key === "pass_yds" && q2.side === "under" && q3 && q3.key === "pass_cmp" && q3.line === 21.5 && q4 === null,
          "10/27: a prop leg's grading spec from its fields or its label (pass TD has no stats field -> not graded here)", { q1, q2, q3, q4 }); }
      const resA = { positionResolution: { marketSlug: sl, beforePosition: { netPosition: "94", cost: { value: "4.999" }, realized: { value: "0" }, marketMetadata: meta }, afterPosition: { realized: { value: "94" } } } };
      const rx = resolvedFrom(resA, sing);
      ok(rx && rx.win && Math.abs(rx.pl - (94 - 4.999)) < 1e-9 && resolvedFrom(resA) === null, "my bets: a single player bet's settlement is read (a combo leg's is not)", rx);
      const row = ctx.T.betRow({ source: "account", title: "WAS Commanders vs. SF 49ers", outcome: "Yes", week: 6, cost: 5, toWin: 94, price: 0.053, result: "pending", prop: pr });
      ok(/Terry McLaurin First TD/.test(row) && /tlogo/.test(row) && !/Commanders vs/.test(row) && /pays \$94\.00 if it wins/.test(row), "my bets: a single player bet shows as its player + bet with the team logo"); }
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
    { // 10/27 (owner: "check the railway rebuild"): a deploy rebuild was invisible for up to 2 h -- now /health says which build the service holds and the site re-reads it at once
      const { getJSON, getRedis } = await import("../lib/redis.js"), { UP } = await import("../lib/upgrade.js");
      const realFetch = globalThis.fetch, oldUrl = process.env.MODEL_SERVICE_URL; process.env.MODEL_SERVICE_URL = "https://svc.test";
      const mk = (b) => ({ ok: true, tag: "t", builtAt: b, upgrade: { ...UP }, early: null, moveT: null, teamSide: { week: 8 }, checks: { games: 1 } });
      const calls = []; let svcBuild = "2026-10-27T17:23:00Z";
      globalThis.fetch = async (u) => { calls.push(String(u)); if (/\/health$/.test(String(u))) return { ok: true, status: 200, json: async () => ({ ok: true, build: { builtAt: svcBuild, tag: "t" }, rebuild: { running: false, last: { published: true } } }) };
        return { ok: true, status: 200, json: async () => mk(svcBuild) }; };
      await setJSON("combomodel:latest", { ...mk("2026-10-27T11:00:00Z"), fetchedAt: new Date().toISOString() });   // a fresh copy (inside the 2-h cache) of an OLDER build
      const { loadComboModel } = await import("../lib/combomodel.js?fresh=1"); const a = await loadComboModel(); const saved = await getJSON("combomodel:latest");
      ok(!!a && a.builtAt === "2026-10-27T17:23:00Z" && calls.some((u) => /\/health$/.test(u)) && calls.some((u) => /combo-model/.test(u)) && saved.builtAt === "2026-10-27T17:23:00Z",
        "rebuild visibility (10/27): the service holds a newer build than the site's fresh copy -> /health is asked and the build re-read at once", { calls, saved: saved && saved.builtAt });
      calls.length = 0; const { loadComboModel: load2 } = await import("../lib/combomodel.js?fresh=2"); await load2(); const s2 = await getJSON("combomodel:latest");
      ok(calls.some((u) => /\/health$/.test(u)) && !calls.some((u) => /combo-model/.test(u)) && s2.healthAt && s2.builtAt === "2026-10-27T17:23:00Z", "rebuild visibility: the same build on the service -> no re-read, the health check is stamped (asked again after HEALTH_EVERY)", calls);
      calls.length = 0; const { loadComboModel: load3 } = await import("../lib/combomodel.js?fresh=3"); await load3();
      ok(!calls.length, "rebuild visibility: a health check in the last 5 minutes is not repeated");
      const { applyComboModel: ap0 } = await import("../lib/combomodel.js"); ap0(null); globalThis.fetch = realFetch; if (oldUrl === undefined) delete process.env.MODEL_SERVICE_URL; else process.env.MODEL_SERVICE_URL = oldUrl; await getRedis().del("combomodel:latest");
      const py = readFileSync(new URL("../railway-model-service/app.py", import.meta.url), "utf8"), wr = readFileSync(new URL("../railway-model-service/weekly_rebuild.py", import.meta.url), "utf8"), stj = readFileSync(new URL("../lib/status.js", import.meta.url), "utf8"), wd = readFileSync(new URL("../lib/watchdog.js", import.meta.url), "utf8"), apx = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
      ok(/"build": _build_info\(\), "rebuild": _rebuild_info\(\)/.test(py) && /STATUS\["startedAt"\] = time/.test(wr) && /STATUS\["finishedAt"\] = time/.test(wr) && /build: \(health && health\.build\) \|\| null, rebuild: \(health && health\.rebuild\) \|\| null/.test(stj) && /\["Model rebuild \(Railway\)", rebuildLine\(st\.railway, st\.fitCheck\)\]/.test(apx) && /running since/.test(apx) && /site up to date/.test(apx) && /model rebuild on Railway FAILED/.test(wd) && /did not pass its checks/.test(wd),
        "rebuild visibility: /health carries the build + rebuild state, status keeps it, System shows running / failed / published + whether the site is up to date, the watchdog warns on a failed or unpublished rebuild"); }
  }
  ok(ctx.T.slotOf({ badge: "SNF", kickoff: "2026-10-11T12:00:00" }) === "Primetime" && ctx.T.slotOf({ kickoff: "2026-10-11T10:00:00" }) === "Morning" && ctx.T.slotOf({ kickoff: "2026-10-11T13:25:00" }) === "Afternoon", "best bets: morning / afternoon / primetime");
  { // kickoff check line in System: failures and moved games are visible
    ok(/failed: ESPN timed out/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: false, error: "ESPN timed out" })) && /moved: CHI @ GB/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: true, espnGames: 15, moved: [{ game: "CHI @ GB", was: "2026-10-11T17:00Z", now: "2026-10-11T20:25Z" }] })) && /OK/.test(ctx.T.kickLine({ t: "2026-10-08T05:00Z", ok: true, espnGames: 15, moved: [] })), "kickoff check: shows failures, moved games, or all-match");
    const { overlayEspnKickoffs, resetKickCache } = await import("../lib/espnFinals.js"); const R = globalThis.__TEST_REDIS__;
    resetKickCache(); await overlayEspnKickoffs([{ key: "CHI @ GB", final: false, kickoff: new Date(Date.now() + 86400e3).toISOString() }], Date.now(), async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
    const kc = JSON.parse(await R.get("kickcheck")); ok(kc && kc.ok === false && /timed out/.test(kc.error), "kickoff check: a failure is recorded"); await R.del("kickcheck"); resetKickCache(); }
  { // model card (the blended touchdown chance was removed with the one-line TD rows, 10/20 night)
    const G = { key: "CHI @ GB", away: "CHI", home: "GB", started: false, model: { homeMargin: -5.6, total: 46.1, fix: {} }, spreadPick: { label: "CHI -1.5", team: "CHI", side: "away", pct: 51 }, totalPick: { label: "Under 46.5", side: "under", pct: 50.5 },
      combos: [{ kind: "spread", pick: "GB +1.5", hit: 62.3, why: "model likes the favorite by 3+ · line moved 1+ toward the dog", model: true }, { kind: "total", pick: "Under 46.5", hit: 57.2, why: "wind 10+ · older teams" }, { kind: "total", pick: "Over 40.5", hit: 75, teaser: true, why: "t" }] };
    G.combos[0].rec = { w: 3, l: 1 }; G.history = [{ poly: { spread: { homeSpread: 2.5 }, total: { line: 45.5 } } }]; G.lineNow = { hs: 1.5, tl: 46.5 };
    const sp = ctx.T.leanCell(G, "spread"), to = ctx.T.leanCell(G, "total");
    ok(/Model:<\/span> <b class="mod">CHI by 5\.6<\/b>/.test(sp) && /Pick:<\/span> GB \+1\.5 · <span class="reelpct" data-v="62%">62%<\/span>/.test(sp) && /class="g pulse" style="--gl:1"/.test(sp) && !/Goes against/.test(sp) && !/Less accurate/.test(sp) && (sp.match(/Pick:/g) || []).length === 1, "model card: one pick, no extra notes");
    ok(/This season: <b>3–1<\/b>/.test(sp) && /Line moved: opened GB \+2\.5, now GB \+1\.5 · worse number now/.test(sp) && /Line moved: opened Under 45\.5, now Under 46\.5 · better number now/.test(to) && ctx.T.recLine({ w: 0, l: 0 }) === "", "model card: this season's record and the line check");
    { const out = sp.replace(/<details[\s\S]*<\/details>/, "");
      ok(/Pick:<\/span> GB \+1\.5/.test(out) && /model likes the favorite/.test(out) && !/This season/.test(out) && !/Line moved/.test(out) && /<details class="more"[^>]*><summary[^>]*>More<\/summary>[\s\S]*This season[\s\S]*Line moved/.test(sp) && ctx.T.moreBox("") === "",
        "model card (10/14 cleanup): pick + % + one reason stay on the card; record, line moved, cost and without-the-points sit behind a More tap"); }
    { // casino look (10/14): glow by strength, HIT/MISS stamps only on settled (not sold) bets, parlay card glows purple
      ok(ctx.T.glowOf(0.57) === 0.45 && ctx.T.glowOf(0.596) === 0.75 && ctx.T.glowOf(0.62) === 1, "casino: stronger green picks glow brighter");
      { // 10/27 (owner: "Remove wk 7 and also remove that hit and miss pill tag"): no stamp, no week tag on a bet row, both pages
        const won = ctx.T.betRow({ source: "account", id: "x", result: "W", pl: 5, cost: 10, toWin: 15, week: 5, title: "t", legs: [] });
        ok(!/HIT!|MISS|class="stamp/.test(won) && !/wk 5/.test(won) && /class="g">Won</.test(won) && ctx.T.stampFor === undefined && !/playStamps|coinBurst|\.stamp\b/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8")) && !/\.stamp \{|coinfx/.test(readFileSync(new URL("../public/index.html", import.meta.url), "utf8")),
          "10/27: no HIT / MISS stamp and no wk tag on a bet row; the stamp code and styles are gone", won);
        const nb = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8"), nh = readFileSync(new URL("../public/nba/index.html", import.meta.url), "utf8");
        ok(!/stampFor|playStamps|coinBurst/.test(nb) && !/\.stamp \{|coinfx/.test(nh), "10/27: NBA page the same (design = both sports)"); }
      { // 10/27 (owner: "Fix the time unknown. And put the single bets at the top of the list first then the parlays")
        vm.runInContext(`S = { games: [{ key: "DAL @ PHI", away: "DAL", home: "PHI", kickoff: "2026-10-27T00:15:00Z", td: [] }, { key: "KC @ SEA", away: "KC", home: "SEA", kickoff: "2026-10-25T20:25:00Z", td: [] }] }`, ctx);
        const single = { source: "account", id: "astatc-nfl-dal-phi-2026-10-26-td-ceelam-gte1", result: "pending", cost: 9.99, toWin: 22, price: 0.45, prop: { label: "CeeDee Lamb 1+ TD", team: "DAL", game: "DAL @ PHI", kind: "td" } };
        const ml = { source: "account", id: "aec-nfl-kc-sea-2026-10-25", title: "KC Chiefs vs. SEA Seahawks", outcome: "Seahawks", result: "pending", cost: 48, toWin: 80 };
        const combo = { source: "account", id: "crossd-1", result: "pending", cost: 25, toWin: 200, picks: [{ label: "DAL -1.5", game: "DAL @ PHI" }, { label: "Over 38.5 · DAL @ PHI", game: "DAL @ PHI" }] };
        const SG = vm.runInContext("S.games", ctx);
        ok(ctx.T.isSingle(single) && ctx.T.isSingle(ml) && !ctx.T.isSingle(combo) && ctx.T.singleGame(single, SG).key === "DAL @ PHI" && ctx.T.singleGame(ml, SG).key === "KC @ SEA" && ctx.T.betSlots(single).length === 1 && ctx.T.betSlots(ml).length === 1 && ctx.T.betSlots(single)[0] === ctx.T.betSlots(combo)[0],
          "10/27: a single bet finds its game (its prop, or its Polymarket id) and so its time slot", { s: ctx.T.betSlots(single), m: ctx.T.betSlots(ml) });
        const html = ctx.T.openBySlot([combo, single, ml]);
        ok(!/Time unknown/.test(html) && /Singles · /.test(html) && !/Combo/.test(html) && /class="sh">Prime time</.test(html) && html.indexOf("CeeDee Lamb") < html.indexOf('class="sh">Prime time<') && html.indexOf("Seahawks") < html.indexOf('class="sh">Prime time<') && html.indexOf('class="sh">Prime time<') < html.indexOf("DAL -1.5"),
          "10/27: the open list = every single bet first (by kickoff slot), then the combos; nothing under Time unknown", html.slice(0, 300)); }
      ok(/class="pgrid"/.test(ctx.T.sgpBox({ key: "A @ B", sgp: { best: { legs: [{ label: "x", prob: .6 }, { label: "y", prob: .6 }], prob: .36 } } })), "game page: the same-game parlays are one plain list (10/15)"); }
    { const pp = { legs: [{ label: "A", prob: .6, price: .5 }, { label: "B", prob: .6, price: .4 }], prob: .36 };
      const h = ctx.T.sgpBox({ key: "A @ B", sgp: { best: pp } });
      ok(/PL: 4\.9x<span class="plw"> · \$10 → <\/span><span class="g">\$49<\/span>/.test(h) && /· \$20 → <\/span><span class="g">\$98/.test(ctx.T.sgpBox({ key: "A @ B", sgp: { best: { ...pp, stake: 20 } } })) && /PL: —/.test(ctx.T.sgpBox({ key: "A @ B", sgp: { best: { ...pp, legs: [pp.legs[0], { label: "C", prob: .5, price: null }] } } })), "payout: legs' Polymarket prices multiplied minus Polymarket's cut (1/0.5 x 1/0.4 x 0.977 = 4.9x, $10 -> $49); a leg without a price says so"); }
    { const p = { legs: [{ label: "Bi.Robinson TD", prob: 0.62 }, { label: "ATL +3.5", prob: 0.581, rule: "KEY NUMBER" }], prob: 0.43 };
      const h = ctx.T.sgpBox({ key: "CHI @ ATL", sgp: { best: p, three: { ...p, prob: 0.05 } } });
      const h3 = ctx.T.sgpBox({ key: "CHI @ ATL", sgp: { best: p, three: { ...p, prob: 0.2 }, linked: { ...p, prob: 0.08 }, style: { ...p, prob: 0.05 } } });
      ok(h.includes("SAME-GAME PARLAYS") && /<span class="pbn">2 legs<\/span><\/div><div class="ptb pth">[\s\S]*?<span class="pt2 mod">43%<\/span>/.test(h) && /<span class="pbn">3 legs<\/span><\/div><div class="ptb pth">[\s\S]*?<span class="pt2 mod">5%<\/span>/.test(h) && !/KEY NUMBER|hits ~|about \d/.test(h) && /3 legs/.test(h3) && !/4 legs|my style/.test(h3), "same-game box: 2 / 3 legs as compact blocks, each with its hit %, no rule tags or notes; 10/19: never 4 legs / my style");
      ok(ctx.T.sgpBox({ key: "X @ Y", started: true, sgp: { best: p } }) === "", "same-game box: hidden once the game starts"); }
    ok(ctx.T.lineCheck({ key: "SEA @ DEN", away: "SEA", home: "DEN", history: [{ poly: { spread: { homeSpread: 2.5 } } }], lineNow: { hs: 2.5, tl: 40.5 } }, "spread", "DEN +3.5") === "", "line check: an alternate-line pick (KEY NUMBER +3.5 with the main line still +2.5) is not called a line move");
    ok(/Model:<\/span> <b class="mod">46\.1<\/b>/.test(to) && /Pick:<\/span> Under 46\.5 · <span class="reelpct" data-v="57%">57%<\/span>/.test(to) && /--gl:0\.45/.test(to) && /wind 10\+ · older teams/.test(to) && !/won 57%/.test(to) && !/40\.5/.test(to), "model card (total): one market-line pick with its reason, no teasers");
    { const U = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 } }, "spread"), V = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 } }, "total");
      ok(/Model:<\/span> <b class="mod">GB by 2\.1<\/b>/.test(U) && /No pick/.test(U) && /Model:<\/span> <b class="mod">43\.0<\/b>/.test(V) && /No pick/.test(V), "model card: shows the upgraded model's number; with no tested pick it says No pick");
      const E1 = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 }, modelEarly: 48.7, totalOpen: 46.5 }, "total"), E3 = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 46.5 }, modelEarly: 48.2, totalOpen: 46.5 }, "total"), E2 = ctx.T.leanCell({ ...G, combos: [], modelUp: { margin: 2.1, total: 43.0 }, lineNow: { hs: 1.5, tl: 44.5 }, modelEarly: 48.2, totalOpen: 46.5 }, "total");
      ok(!/Early-week/.test(E1) && !/Early-week/.test(E2) && !/Early-week/.test(E3), "total card: early-week edge is turned off (11-18 live)"); }
    { const G = { key: "CIN @ MIA", away: "CIN", home: "MIA", started: false, final: false, combos: [{ pick: "MIA +6.5", hit: 66.7, n: 3, why: "Underdog off a loss · 2–1 this season" }, { pick: "CIN -6.5", hit: 58.9, n: 73, why: "stats" }, { pick: "Over 44.5", hit: 57, n: 200, why: "x" }] };
      const P = ctx.T.straightPicks(G), G2 = { ...G, combos: [G.combos[0]] }, P2 = ctx.T.straightPicks(G2);
      ok(P[0].pick === "CIN -6.5" && !P.some((x) => x.pick === "MIA +6.5") && P2[0].pick === "MIA +6.5" && /3 games/.test(P2[0].why), "picks: a tested pick beats a small-sample one in its market; small-sample picks show their game count"); }
      { const Gm = { key: "A @ B", away: "A", home: "B", started: false, final: false, card: { spread: null, total: null, ml: { plain: { id: "stackml|ml", kind: "ml", team: "B", line: 0, pick: "B ML", hit: 69.7, price: 0.64 }, rows: [] } } };
        const SP = ctx.T.straightPicks(Gm); ok(SP.length === 1 && SP[0].pick === "B ML" && SP[0].green, "Best bets (10/23 night): the green ML pick is a straight pick", SP); }
      { const Gc = { ...G, card: { ...(G.card || {}), ml: { plain: { id: "stackml|ml", kind: "ml", team: G.home, line: 0, pick: `${G.home} ML`, hit: 69.7, price: 0.64 } } } };
        const h = ctx.T.leanCell(Gc, "spread"), ht = ctx.T.leanCell(Gc, "total");
        ok(/ML pick:<\/span> [A-Z]+ ML · 70%/.test(h) && !/ML pick/.test(ht), "the spread card renders the ML pick line (the total card does not)", h.slice(-400)); }
    { vm.runInContext(`S = { games: [{ key: "PHI @ JAX", away: "PHI", home: "JAX", kickoff: "2026-10-11T13:30:00Z", td: [{ player: "D.Cooper", team: "PHI" }] }, { key: "CHI @ GB", away: "CHI", home: "GB", kickoff: "2026-10-11T17:00:00Z", td: [{ player: "D.Swift", team: "CHI" }, { player: "J.Love", team: "GB" }] },
        { key: "SF @ SEA", away: "SF", home: "SEA", kickoff: "2026-10-11T20:25:00Z", td: [{ player: "C.McCaffrey", team: "SF" }] }, { key: "DET @ ARI", away: "DET", home: "ARI", kickoff: "2026-10-11T20:25:00Z", td: [{ player: "J.Love", team: "ARI" }] },
        { key: "BAL @ ATL", away: "BAL", home: "ATL", kickoff: "2026-10-12T00:20:00Z", badge: "SNF", td: [] }] }`, ctx);
      const sl = (labels) => ctx.T.betSlots({ picks: labels.map((label) => ({ label })) });
      ok(sl(["PHI +7.5", "Darius Cooper 1+ TD", "Over 42.5 · PHI @ JAX"]).join() === "Early (London / international)" && sl(["CHI -1.5", "D'Andre Swift 1+ TD", "Under 46.5 · CHI @ GB"]).join() === "Morning (10 AM)"
        && sl(["Christian McCaffrey 1+ TD", "ATL -3.5"]).length === 2 && sl(["Jeremiyah Love 1+ TD"]).length === 0, "bets: legs matched to kickoff slots (team, game, TD name); same short name on two teams stays unknown");
      const h = ctx.T.openBySlot([{ picks: [{ label: "CHI -1.5" }], legs: [], cost: 5, toWin: 10, price: 0.5, title: "x", result: "pending" }, { picks: [{ label: "CHI -1.5" }, { label: "BAL +3.5" }], legs: [], cost: 5, toWin: 20, price: 0.25, title: "y", result: "pending" }]);
      ok(/class="sh">Morning \(10 AM\)</.test(h) && /class="sh">Mixed times</.test(h) && !/Combo/.test(h) && !/more than one time slot/.test(h) && /Morning \(10 AM\) \+ Prime time/.test(h), "bets: open parlays listed by time slot, mixed ones in their own list, no 'Combo' word (owner 10/27)"); }
    { vm.runInContext(`S = { games: [{ key: "CHI @ GB", away: "CHI", home: "GB", started: false, final: false, angles: [], combos: [{ pick: "Under 46.5", hit: 57, why: "wind" }, { pick: "GB +1.5", hit: 52, why: "x" }] }] }`, ctx);
      ok(ctx.T.legFlipped("Over 46.5 · CHI @ GB") && !ctx.T.legFlipped("Under 46.5 · CHI @ GB") && !ctx.T.legFlipped("CHI -1.5") && !ctx.T.legFlipped("Over 40.5 · NYG @ WAS"), "bets: a leg is flagged only when the app now has a 56%+ pick on the other side"); }
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "models" ? box : id === "export-btn" ? { onclick: null } : old(id));
    const px = (fair, scored, ask, bid) => ({ team: "A", player: "P", fair, scored, played: true, ask, bid });
    vm.runInContext(`S = { week: 4, games: [], status: { ok: true, errors: [] }, weekCheck: { games: 16, withLines: 16, modelRun: true, watch: [] }, missFinder: null, winners: null }; MB = { summary: {}, bets: [] }; PAPER = { names: {}, board: {}, week: null }; PICKS = null; EDGES = null; REPLAY = null; RES = [ { game: "A @ B", week: 4, td: [ ${JSON.stringify(px(40, true, 0.30, 0.28))}, ${JSON.stringify(px(20, false, 0.25, 0.23))}, ${JSON.stringify(px(30, true, 0.33, 0.30))} ] } ]`, ctx);
    ctx.T.renderModel(); ok(/Accuracy/.test(box.innerHTML) && !/50\/50 blend|Players checked|Thin markets/.test(box.innerHTML) && /Chances vs results/.test(box.innerHTML) && /Top scorers/.test(box.innerHTML) && /Vs Polymarket/.test(box.innerHTML), "models tab: the touchdown section is three plain lists (chances vs results, top scorers, vs Polymarket); no blend / players checked / thin markets rows");
    ctx.document.getElementById = old; }
  { // snap counts not posted yet (played unset): those players are left out of every accuracy number instead of counting as misses
    const { buildCalibration } = await import("../lib/calibration.js");
    const many = (played) => ({ td: Array.from({ length: 60 }, (_, i) => ({ fair: 20, scored: i < 3, ...(played === undefined ? {} : { played }) })) });
    const cu = buildCalibration([many(undefined)]), cp = buildCalibration([many(true)]), cf = buildCalibration([many(false)]);
    const bucket = (c) => c.table.find((x) => x.lo === 15);
    ok(bucket(cu).n === 0 && bucket(cu).mult === 1 && bucket(cf).n === 0 && bucket(cp).n === 60 && bucket(cp).mult < 1, "calibration: only players known to have played count (unset and inactive are left out)");
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
    ok(al.length === 0 && (await R.lrange("alerts:2099", 0, -1)).length === 0 && JSON.parse(await R.get("paper:2099:4:IND @ WAS")).parlays[0].result === "W", "alerts (cleanup 10/18): a decided model parlay is graded and saves no RESULT line");
    for (const k of await R.keys("paper:2099:*")) await R.del(k); await R.del("alerts:2099");
    // the pick list shows the card's pick
    vm.runInContext(`S = { week: 4, games: [ { key: "LA @ PHI", away: "LA", home: "PHI", started: false, winPct: 38.1, model: { homeMargin: -3, total: 43.5, calHomeCover: 48.8, calUnder: 50.5 }, poly: { ml: { home: 0.42, away: 0.6 }, spread: { homeSpread: 3, home: 0.51, away: 0.51 }, total: { line: 43.5, over: 0.51, under: 0.51 } } } ], winners: null, picks: null }`, ctx);
    ok(!/Spread <b>LA -3<\/b> <span class="dim">\(agrees\)/.test(ctx.T.winnersBox()) && /Spread <b>—<\/b>/.test(ctx.T.winnersBox()), "pick list: shows the CARD's pick (none here), never the game model's own side (review fix 10/14)"); }
  { // 10/17 (owner): same-game payout counts the links like Polymarket's combo (NO ML + Over 46.5 + D.Vele TD + J.Johnson TD: Polymarket 33.92x, multiplied 60x)
    const { comboPay } = await import("../lib/combo.js");
    const L = [{ game: "NO @ NYG", kind: "ml", team: "NO", label: "NO ML", price: 0.5 }, { game: "NO @ NYG", kind: "total", side: "over", label: "Over 46.5", price: 0.49 },
      { game: "NO @ NYG", kind: "td", team: "NO", player: "D.Vele", label: "D.Vele TD", price: 0.25 }, { game: "NO @ NYG", kind: "td", team: "NO", player: "J.Johnson", label: "J.Johnson TD", price: 0.27 }];
    const x = comboPay(L); ok(x > 32 && x < 36 && Math.abs(ctx.T.linkedPay(L) - x) < 1e-9, "same-game payout: links counted (about 34x, Polymarket 33.92x), page = server", x);
    const D = [{ game: "A @ B", kind: "ml", team: "B", price: 0.8 }, { game: "C @ D", kind: "ml", team: "D", price: 0.7 }];
    ok(Math.abs(comboPay(D) - 0.977 / 0.56) < 1e-9 && Math.abs(ctx.T.linkedPay(D) - 0.977 / 0.56) < 1e-9, "payout across games = prices multiplied, minus Polymarket's cut");
    const PT = [{ game: "PIT @ TB", kind: "spread", team: "TB", label: "TB +2.5", price: 0.495 }, { game: "PIT @ TB", kind: "total", side: "over", label: "Over 38.5", price: 0.525 },
      { game: "PIT @ TB", kind: "td", team: "PIT", player: "J.Warren", label: "J.Warren TD", price: 0.46 }, { game: "PIT @ TB", kind: "td", team: "TB", player: "B.Irving", label: "B.Irving TD", price: 0.35 }];
    const y = comboPay(PT); ok(Math.abs(y / 14.79 - 1) < 0.03 && Math.abs(x / 33.92 - 1) < 0.03 && Math.abs(ctx.T.linkedPay(PT) - y) < 1e-9, "payout: both real Polymarket quotes within 3% (PIT @ TB 14.79x with a leg against the others, NO @ NYG 33.92x)", [x, y]);
    { // tap -> real Polymarket quote (lib/comboquote.js)
      const { legSymbol, eventSlugs, payoutAt, bestQuote, realQuote } = await import("../lib/comboquote.js");
      const side = (d, long, team) => ({ description: d, long, ...(team ? { team: { abbreviation: team } } : {}) });
      const mk = (slug, t, line, sides) => ({ slug, sportsMarketType: t, line, marketSides: sides.map((x) => ({ ...x, identifier: slug })) });
      const M = [mk("asc-nfl-pit-tb-2026-10-18-neg-2pt5", "football_team_full_game_spread", -2.5, [side("-2.50", true, "pit"), side("+2.50", false, "tb")]),
        mk("asc-nfl-pit-tb-2026-10-18-1h-neg-2pt5", "football_team_first_half_spread", -2.5, [side("-2.50", true, "pit"), side("+2.50", false, "tb")]),
        mk("tsc-nfl-pit-tb-2026-10-18-total-38pt5", "football_team_full_game_total", 38.5, [side("Over", true), side("Under", false)]),
        mk("astatc-nfl-pit-tb-2026-10-18-td-jaywar-gte1", "football_player_touchdowns", 1, [side("Yes", true, "pit"), side("No", false, "pit")]),
        mk("aec-nfl-pit-tb-2026-10-18", "football_team_full_game_winner", null, [side("Steelers", true, "pit"), side("Buccaneers", false, "tb")])];
      M[3].titleShort = "Jaylen Warren 1+ TD";
      const sym = (l) => JSON.stringify(legSymbol({ game: "PIT @ TB", ...l }, M));
      ok(sym({ kind: "spread", team: "TB", label: "TB +2.5" }) === '{"symbol":"asc-nfl-pit-tb-2026-10-18-neg-2pt5","side":"SIDE_SELL"}' && sym({ kind: "total", side: "under", label: "Under 38.5" }) === '{"symbol":"tsc-nfl-pit-tb-2026-10-18-total-38pt5","side":"SIDE_SELL"}'
        && sym({ kind: "td", team: "PIT", player: "J.Warren", label: "J.Warren TD" }) === '{"symbol":"astatc-nfl-pit-tb-2026-10-18-td-jaywar-gte1","side":"SIDE_BUY"}' && sym({ kind: "ml", team: "TB", label: "TB ML" }) === '{"symbol":"aec-nfl-pit-tb-2026-10-18","side":"SIDE_SELL"}'
        && legSymbol({ game: "PIT @ TB", kind: "total", side: "over", label: "Over 39.5" }, M) === null && legSymbol({ game: "PIT @ TB", kind: "td", team: "TB", player: "J.Warren", label: "J.Warren TD" }, M) === null,
        "real quote: legs -> Polymarket US markets (TB +2.5 = NO side of PIT -2.5, full game only, wrong team / no market -> none)");
      ok(eventSlugs("LA @ WAS", "2026-10-19T00:20:00Z")[0] === "nfl-lar-wsh-2026-10-18" && eventSlugs("PIT @ TB", "2026-10-18T17:00:00Z").join() === "nfl-pit-tb-2026-10-18", "real quote: event slug uses Polymarket team codes and the Eastern date of kickoff");
      ok(Math.abs(payoutAt(0.0263) - 33.92) < 0.01 && Math.abs(payoutAt(0.0784) - 115.17 / 9.999) < 0.01 && Math.abs(payoutAt(0.0927) - 97.73 / 9.997) < 0.01, "real quote: Polymarket's fee on a combo matches the owner's bought combos (Saints 33.92x)");
      const bq = bestQuote({ quotes: [{ status: "QUOTE_STATUS_ACTIVE", buyPrice: "0.0816", sellPrice: "0.0167", buyQtyDecimal: "110.78" }, { buyPrice: "0.41", sellPrice: "0.0001", buyQtyDecimal: "23.26" }, { buyPrice: "0", sellPrice: "0.0459", buyQtyDecimal: "0" }, { buyPrice: "0.061", sellPrice: "0", buyQtyDecimal: "147.37" }, { status: "QUOTE_STATUS_CANCELED", buyPrice: "0.03", buyQtyDecimal: "300" }] });
      ok(bq && bq.price === 0.061 && bq.qty === 147.37 && bestQuote({ quotes: [] }) === null, "real quote: best quote = the most shares for the stake at the buy price (live PIT @ TB: 0.061 -> 147.37 shares = 14.74x), the sell price ignored, closed quotes skipped", bq);
      const calls = [], fake = { get: async () => ({ event: { markets: M } }), request: async (method, path) => { calls.push(`${method} ${path.split("?")[0]}`);
        if (path === "/v1/combos") return { combo: { id: "caoc-x" } }; if (path === "/v1/rfqs") return { rfqId: "r1" }; if (method === "GET") return { quotes: [{ buyPrice: "0.0263", buyQtyDecimal: "339.16" }, { buyPrice: "0.05", buyQtyDecimal: "180" }] }; return {}; } };
      const q = await realQuote(fake, [{ game: "PIT @ TB", kind: "spread", team: "TB", label: "TB +2.5" }, { game: "PIT @ TB", kind: "td", team: "PIT", player: "J.Warren", label: "J.Warren TD" }], { "PIT @ TB": "2026-10-18T17:00:00Z" }, 10);
      ok(q.ok && Math.abs(q.pay - 33.92) < 0.01 && calls[0] === "POST /v1/combos" && calls[1] === "POST /v1/rfqs" && calls[calls.length - 1] === "DELETE /v1/rfqs/r1" && !calls.some((c) => /^PUT|accept/i.test(c)), "real quote: makes the combo, asks, reads, always closes the request, never accepts", calls);
      const n1 = calls.length, legs2 = [{ game: "PIT @ TB", kind: "spread", team: "TB", label: "TB +2.5" }, { game: "PIT @ TB", kind: "td", team: "PIT", player: "J.Warren", label: "J.Warren TD" }];
      const q2 = await realQuote(fake, legs2.slice().reverse(), { "PIT @ TB": "2026-10-18T17:00:00Z" }, 10), n2 = calls.length;
      const q3 = await realQuote(fake, legs2, { "PIT @ TB": "2026-10-18T17:00:00Z" }, 10, [], { fresh: true });
      ok(q2.cached && q2.pay === q.pay && n2 === n1 && calls[n2] === "POST /v1/rfqs" && !calls.slice(n2).includes("POST /v1/combos") && calls[calls.length - 1] === "DELETE /v1/rfqs/r1" && q3.ok && !q3.cached,
        "real quote: the same parlay is shared for 2.5 min (no Polymarket call); a refresh reuses the combo symbol and asks ONE quote", calls.slice(n1));
      const before = calls.length, miss = await realQuote(fake, [{ game: "PIT @ TB", kind: "total", side: "over", label: "Over 39.5" }, { game: "PIT @ TB", kind: "spread", team: "TB", label: "TB +2.5" }], { "PIT @ TB": "2026-10-18T17:00:00Z" }, 10);
      ok(!miss.ok && /Over 39\.5/.test(miss.why) && calls.length === before, "real quote: a leg Polymarket does not list -> no quote asked", calls);
      { // NBA (10/17, owner: "I need this for the nba also") + the background refresh
        const { saveParlayList, refreshQuotes, legsSig: legsSigOf } = await import("../lib/comboquote.js");
        const nb = [mk("asc-nba-gs-lal-2026-10-21-neg-3pt5", "basketball_team_full_game_spread", -3.5, [side("-3.50", true, "gs"), side("+3.50", false, "lal")]),
          mk("tsc-nba-gs-lal-2026-10-21-224pt5", "basketball_team_full_game_total", 224.5, [side("Over", true), side("Under", false)]),
          mk("aec-nba-gs-lal-2026-10-21", "basketball_team_full_game_winner", null, [side("Warriors", true, "gs"), side("Lakers", false, "lal")])];
        const ns = (l) => JSON.stringify(legSymbol({ game: "GSW @ LAL", ...l }, nb, "nba"));
        ok(eventSlugs("GSW @ LAL", "2026-10-22T02:00:00Z", "nba")[0] === "nba-gs-lal-2026-10-21" && ns({ market: "spread", team: "LAL", line: 3.5, label: "LAL +3.5" }) === '{"symbol":"asc-nba-gs-lal-2026-10-21-neg-3pt5","side":"SIDE_SELL"}'
          && ns({ market: "total", side: "under", line: 224.5, label: "Under 224.5" }) === '{"symbol":"tsc-nba-gs-lal-2026-10-21-224pt5","side":"SIDE_SELL"}' && ns({ market: "ml", team: "GSW", label: "GSW ML" }) === '{"symbol":"aec-nba-gs-lal-2026-10-21","side":"SIDE_BUY"}'
          && legSymbol({ game: "GSW @ LAL", kind: "spread", team: "LAL", label: "LAL +3.5" }, M, "nba") === null,
          "real quote, NBA: Polymarket's NBA codes (GSW = gs) and Eastern date of tip-off; spread / total / moneyline legs -> NBA markets; football markets never used");
        const R = globalThis.__TEST_REDIS__, soon = new Date(Date.now() + 5 * 3600e3).toISOString(), later = new Date(Date.now() + 20 * 3600e3).toISOString(), past = new Date(Date.now() - 3600e3).toISOString();
        const L1 = [{ game: "PIT @ TB", kind: "spread", team: "TB", label: "TB +2.5" }, { game: "PIT @ TB", kind: "td", team: "PIT", player: "J.Warren", label: "J.Warren TD" }];
        const n = await saveParlayList("nflx", [{ stake: 10, legs: L1, kick: { "PIT @ TB": soon } }, { stake: 5, legs: L1, kick: { "PIT @ TB": soon } }, { stake: 10, legs: [L1[0], { ...L1[1], label: "J.Warren 2+ TD" }], kick: { "PIT @ TB": later } },
          { stake: 10, legs: L1, kick: { "PIT @ TB": past } }, { stake: 10, legs: [L1[0]], kick: { "PIT @ TB": soon } }]);
        const before = calls.length, r1 = await refreshQuotes(fake, "nflx", { budgetMs: 20000 }), mid = calls.length, r2 = await refreshQuotes(fake, "nflx", { budgetMs: 20000 });
        ok(n === 4 && r1.parlays === 2 && r1.quoted === 2 && calls.slice(before, mid).filter((c) => c === "POST /v1/rfqs").length === 2 && r2.stale === 0 && calls.length === mid && !calls.some((c) => /^PUT|accept/i.test(c)),
          "background: re-quotes each parlay on the pages (games starting in the next 12 h, not started, 2+ legs), skips ones quoted in the last 4 min, never accepts", { n, r1, r2 });
        { // 10/17 (owner: "I want right Friday morning"): NFL games up to 4 days out every 30 min, NBA 1 day; near games every 5 min, first
          for (const k of await R.keys("cqq:*")) await R.del(k);   // quotes cached by the checks above
          const far = new Date(Date.now() + 50 * 3600e3).toISOString(), tooFar = new Date(Date.now() + 100 * 3600e3).toISOString();
          await saveParlayList("nfl", [{ stake: 10, legs: L1, kick: { "PIT @ TB": far } }, { stake: 5, legs: L1, kick: { "PIT @ TB": tooFar } }]);
          const b0 = calls.length, f1 = await refreshQuotes(fake, "nfl", { budgetMs: 20000 }), b1 = calls.length, f2 = await refreshQuotes(fake, "nfl", { budgetMs: 20000 });
          const ttl = await R.ttl(`cqq:nfl:${legsSigOf(L1)}|10`), f3 = await refreshQuotes(fake, "nfl", { budgetMs: 20000, now: Date.now() + 31 * 60e3 });
          await saveParlayList("nba", [{ stake: 20, legs: L1, kick: { "PIT @ TB": far } }]); const n1 = await refreshQuotes(fake, "nba", { budgetMs: 20000 });
          ok(f1.parlays === 1 && f1.quoted === 1 && f2.stale === 0 && calls.length > b1 && ttl > 1800 && f3.stale === 1 && n1.parlays === 0,
            "background: NFL parlays up to 4 days out are quoted, kept ~40 min and re-quoted after 30 min (not every 5); 4+ days out skipped; NBA only 1 day out", { f1, f2, f3, ttl, n1 }); }
        for (const k of await R.keys("cq*")) await R.del(k); }
      vm.runInContext(`S = { games: [ { key: "PIT @ TB", kickoff: "2099-01-01T00:00:00Z" }, { key: "A @ B", kickoff: "2000-01-01T00:00:00Z" } ] }`, ctx);
      const pq = { stake: 10, legs: [{ game: "PIT @ TB", kind: "spread", team: "TB", label: "TB +2.5", price: 0.5 }, { game: "PIT @ TB", kind: "td", team: "PIT", label: "J.Warren TD", price: 0.45 }] };
      const est = ctx.T.plShown(pq); ctx.T.PLC[ctx.T.plKey(pq)] = { pay: 14.713, t: Date.now() };
      ok(/PL: 4\.\d+x|PL: [3-5]\.\dx/.test(est) && /PL: 15x<span class="plw"> · \$10 → <\/span><span class="g">\$147<\/span>/.test(ctx.T.plShown(pq)) && /PL: 15x/.test(ctx.T.pBlock("PIT @ TB", pq, false)), "real quote: once Polymarket's price is in, the PL line shows it (and keeps it when the page redraws)", [est, ctx.T.plShown(pq)]);
      ok(/onclick="plQuote\(this, true\)"/.test(ctx.T.plTap({ legs: [{ game: "PIT @ TB" }, { game: "PIT @ TB" }] })) && ctx.T.plTap({ legs: [{ game: "A @ B" }, { game: "A @ B" }] }) === "" && ctx.T.plTap({ result: "W", legs: [{ game: "PIT @ TB" }, { game: "PIT @ TB" }] }) === "", "real quote: the PL line is tappable only before kickoff and before the parlay is decided"); }
    ok(comboPay([{ ...L[0] }, { ...L[2], price: null }]) == null && ctx.T.linkedPay([{ ...L[0] }, { ...L[2], price: null }]) == null && /PL: —/.test(ctx.T.plPay({ legs: [{ ...L[2], price: null }] })), "payout: a leg without a price -> none");
    let worst = 0; const kinds = ["ml", "spread", "total", "td"], teams = ["NO", "NYG"];
    for (let i = 0; i < 3000; i++) { const g = Math.random() < 0.7 ? "NO @ NYG" : "X @ Y"; const n = 2 + Math.floor(Math.random() * 4);
      const R = Array.from({ length: n }, () => { const k = kinds[Math.floor(Math.random() * 4)]; return { game: Math.random() < 0.8 ? "NO @ NYG" : g, kind: k, team: teams[Math.floor(Math.random() * 2)], side: Math.random() < 0.5 ? "over" : "under", label: k, price: 0.05 + Math.random() * 0.9 }; });
      const a = comboPay(R), b = ctx.T.linkedPay(R); worst = Math.max(worst, a == null || b == null ? (a === b ? 0 : 1) : Math.abs(a - b) / a); }
    ok(worst < 1e-9, "payout: page and server agree on 3,000 random parlays", worst); }
  { // 10/17 (owner): market's win chance from Polymarket's moneyline (fee out); a favorite flip in a coin-flip game is not a data-check jump
    const { spreadJumped } = await import("../lib/sane.js");
    const T2 = ctx.T, g1 = { winPct: 56.2, poly: { ml: { home: 0.5, away: 0.51 }, spread: { homeSpread: 1.5 } } };
    ok(Math.abs(T2.mktHome(g1) - 49.5) < 0.01 && T2.mktHome({ winPct: 56.2, poly: {} }) === 56.2 && T2.mktHome({ winPct: null, poly: { ml: { home: 0, away: 0.5 } } }) === null,
      "win chance: NO @ NYG (NYG -100 / NO -104) reads 50/50 from the moneyline, not NO 56% from the spread; no moneyline -> the spread's %");
    ok(!spreadJumped(1.5, -1.5) && !spreadJumped(-1.5, 1.5) && spreadJumped(-1.5, 2.5) && spreadJumped(-3, 0) && spreadJumped(-7, -3.5) && !spreadJumped(-2.5, -1) && !spreadJumped(null, 3),
      "data check: NYG +1.5 -> NYG -1.5 in a coin flip is not a jump; real 3+ point moves still are"); }
  { // 10/17 (owner): Model bets Over/Under tab = each game's total PICK + PICK w/ POINTS, stacked by game under the kickoff headers; tabs in the owner's order
    const box = { innerHTML: "" }, oldGet = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "lab" ? box : oldGet(id));
    const card = { plain: { pick: "Over 46.5", hit: 51.7, price: 0.49 }, pts: { pick: "Under 48.5", hit: 57.2, price: 0.61, points: 2 }, rows: [{ pick: "Under 48.5", hit: 57.2, price: 0.61, points: 2 }] };
    vm.runInContext(`S = { week: 6, games: [ { key: "NO @ NYG", away: "NO", home: "NYG", kickoff: "2026-10-18T17:00:00Z", card: { total: ${JSON.stringify(card)} } }, { key: "SEA @ DEN", away: "SEA", home: "DEN", kickoff: "2026-10-16T00:15:00Z", started: true, final: true, lockedPicks: { total: { pick: "Under 40.5", hit: 51.7, result: "W", price: 0.5, pts: { pick: "Under 42.5", hit: 58, result: "W", points: 2, price: 0.6 } } } } ] }; MODELBETS = { ok: true, weeks: {} }; LABTYPE = "ou"; LABWEEK = null`, ctx);
    ctx.T.renderLabList(); const h = box.innerHTML;
    ok(/Over 46\.5 · <span class="mod">51%<\/span> · 49¢/.test(h) && !/Under 48\.5/.test(h) && !/Under 42\.5/.test(h) && /✓<\/span> <span class="g">Under 40\.5/.test(h) && h.indexOf("SEA") < h.indexOf("NYG") && /labslot/.test(h) && !/PL:/.test(h) && !/plQuote/.test(h),
      "Model bets Over/Under: the total PICK per game (10/19: no PICK w/ POINTS row -- it stays on the card under MORE), kickoff order with slot headers, ✓ / ✗ after the game, price shown, no parlay payout or quote", h.slice(0, 400));
    ok(vm.runInContext("LAB_TABS.map(([k, t]) => t).join('|')", ctx) === "Best Legs|3 Leg|2 Leg|6 Leg|8 Leg|10 Leg", "Model bets tabs in the owner's order and names (10/19: three legs max; 10/20 night: Over/Under and Spread + Total removed; 10/21 night: + Player props 6 / 8 / 10 legs; 10/26 night: Upset gone)");
    ctx.document.getElementById = oldGet; vm.runInContext(`LABTYPE = "2"`, ctx); }
  { // earlier week: a bet that is final but waiting for touchdown data stays visible; no slate yet must not break Bets; sections keep their state
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "record-mine" ? box : old(id));
    vm.runInContext(`S = { week: 5, games: [] }; MBWEEK = 4; MB = { summary: {}, synced: null, bets: [ { id: "a", week: 4, source: "account", title: "Waiting combo", cost: 10, toWin: 100, result: "pending", waiting: true, legs: [] }, { id: "b", week: 4, source: "account", title: "Lost combo", cost: 5, toWin: 50, result: "L", pl: -5, legs: [] }, { id: "c", week: 4, cost: 8, toWin: 80, result: "pending", waiting: true, legs: [ { kind: "td", player: "Q", game: "A @ B", team: "B", result: "pending", price: 0.5 } ] } ] }`, ctx);
    ctx.T.renderMine(); ok(/Waiting combo/.test(box.innerHTML) && /waiting for TD results/.test(box.innerHTML) && /Lost combo/.test(box.innerHTML) && /3 bets<\/span>/.test(box.innerHTML) && (box.innerHTML.match(/waiting for TD results/g) || []).length === 2, "record tab: an earlier week still shows bets (typed-in and account) that are waiting for touchdown data");
    vm.runInContext(`S = null; MBWEEK = null`, ctx); let threw = false; try { ctx.T.renderMine(); } catch { threw = true; } ok(!threw && /<select id="mb-wk"/.test(box.innerHTML) && /<option value="all" selected>Season/.test(box.innerHTML), "record tab: opens fine before the slate has loaded");
    const els = { s1: { id: "s1", classList: new Set(["open"]) }, s2: { id: "s2", classList: new Set() } }; for (const e of Object.values(els)) { const c = e.classList; e.classList = { contains: (k) => c.has(k), toggle: (k, on) => (on ? c.add(k) : c.delete(k)) }; }
    const root = { querySelectorAll: () => Object.values(els) }; const g2 = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "rootX" ? root : els[id] || g2(id));
    ctx.T.keepOpenState("rootX", () => { els.s1.classList.toggle("open", false); els.s2.classList.toggle("open", true); });
    ok(els.s1.classList.contains("open") && !els.s2.classList.contains("open"), "refresh: sections keep the open/closed state you left them in");
    ctx.document.getElementById = old; vm.runInContext(`MBWEEK = null`, ctx); }
  { // Model Picks: the model's parlays only (no single-game winners list), each type says how it was chosen
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "lab" ? box : old(id));
    vm.runInContext(`S = { week: 4, games: [], winners: { all: { n: 1, w: 1, l: 0, hit: 1 } } }; MB = null; RES = null; PAPER = { names: { model_best_4: "Model's 4 most likely legs", td_likely_2: "2 likeliest", same_game_3: "Same game" }, board: {}, week: { week: 4, parlays: [ { strategy: "model_best_4", legs: [ { label: "H1 ML", game: "A @ H1", price: 0.8 }, { label: "H2 ML", game: "A @ H2", price: 0.8 } ], pay: 1.56, prob: 0.6 } ] } }`, ctx);
    ctx.T.renderLab(); ok(!/Parlay scoreboard/.test(box.innerHTML) && !/Your model's parlays/.test(box.innerHTML) && !/pays 1\.56x/.test(box.innerHTML), "model picks: the old weekly parlay list is gone and the scoreboard moved to the Models tab (10/15)");
    const sb = vm.runInContext("LAB_SB", ctx);
    ok(/THIS SEASON/.test(sb) && /PAST SEASONS/.test(sb) && /TOUCHDOWNS/.test(sb) && /2 likeliest scorers/.test(sb) && !/4 most likely legs|4 legs/.test(sb) && !/Same game<\/span>/.test(sb), "parlay scoreboard: grouped, only parlays still built (old cut ones hidden); built for the Models tab");
    ctx.document.getElementById = old; }
  { // Models tab: nine sections in order, each with a one-line meaning; the analysis helpers on real-shaped data
    const box = { innerHTML: "" }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "models" ? box : id === "export-btn" ? { onclick: null } : old(id));
    const res = [ { game: "A @ B", week: 3, ml: { pct: 82, result: "W" }, mlModel: { result: "W" }, spread: { basis: "model", result: "L" }, total: { basis: "model", result: "W" }, td: [ { team: "B", player: "P1", fair: 40, scored: true, played: true }, { team: "A", player: "P2", fair: 22, scored: false, played: true } ] },
      { game: "C @ D", week: 3, ml: { pct: 64, result: "L" }, mlModel: { result: "L" }, spread: { basis: "model", result: "W" }, total: { basis: "model", result: "W" }, td: [] },
      { game: "PIT @ CLE", week: 4, ml: { pct: 71, result: "W" }, spread: { basis: "model", result: "W" }, total: { basis: "model", result: "W" }, td: [] } ];
    vm.runInContext(`S = { week: 4, games: [], status: { ok: true, errors: [] }, weekCheck: { games: 16, withLines: 16, modelRun: true, watch: [] }, missFinder: null, winners: { all: { n: 3, w: 2, l: 1, hit: 0.67 } } }; MB = { summary: { wins: 0, losses: 0, pushes: 0, pl: 0 }, bets: [] }; PAPER = { names: {}, board: {}, week: null }; PICKS = null; EDGES = null; REPLAY = null; WINALL = false`, ctx);
    vm.runInContext(`RES = ${JSON.stringify(res)}`, ctx);
    ctx.T.renderModel(); const h = box.innerHTML;
    const order = ["1 · Card picks", "2 · Winners", "3 · Parlay scoreboard", "4 · Touchdowns", "5 · Tracked angles", "6 · System"].map((x) => h.indexOf(x));
    ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])) && !/Price gaps/.test(h) && !/Trends and analysis|Misses and every game|Scoreboard · Week|old model/.test(h), "models tab (10/19 review): six sections in order, card picks first; no old-model rows, no Past seasons", order);
    ok((h.match(/class="fold" data-drop="m-/g) || []).length === 6 && !/Past seasons|Miss finder/.test(h) && !/class="s dim" style="margin:2px 0 6px"/.test(h) && !/break-even/i.test(h), "models tab: six sections, no explanation lines, no break-even talk");
    ok(!/Hit rate by week/.test(h) && /Week 3/.test(h) && /Week 4/.test(h) && /id="gbg"/.test(h) && /Parlay scoreboard/.test(h) && /Week 4 loaded/.test(h.slice(h.indexOf("6 · System"))), "models tab: every-game list under Card picks, the week check under System");
    { const nb = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8"), oi = ["1 · Card picks", "2 · Winners", "3 · Parlay scoreboard", "4 · Accuracy", "5 · Futures", "6 · System"].map((x) => nb.indexOf(x));
      ok(oi.every((x, i) => x > 0 && (i === 0 || x > oi[i - 1])), "NBA models tab (10/19, design = both sports): card picks, winners, parlay scoreboard first, same as NFL; 10/19 review: Tested patterns gone (never picks)", oi); ok(!/Tested patterns/.test(nb), "NBA models tab: no Tested patterns section"); }
    vm.runInContext(`S.winners = { all: { n: 3, w: 2, l: 1, hit: 0.67 }, bands: [{ label: "60-70%", n: 2, w: 1, l: 1, hit: 0.5, said: 0.65 }, { label: "80%+", n: 0 }] }`, ctx);
    const bc = ctx.T.winnersBands();
    ok(/Said 60-70%<i class="tsub">2 picks<\/i><\/span><span>1–1<\/span><span><b>50%<\/b><\/span><span>65%<\/span>/.test(bc) && /RECORD<\/span><span>WON<\/span><span>SAID/.test(bc) && !/80%\+/.test(bc), "models tab: moneyline by chance = the same favorite record as the MONEYLINE tile");
    vm.runInContext(`S.winners = {}`, ctx); ok(/None yet/.test(ctx.T.winnersBands()), "models tab: empty data says so");
    ctx.document.getElementById = old; }
  { // Record tab week filter: this week by default, Season shows everything, tiles recomputed from the bets shown
    const box = { innerHTML: "", onclick: null }; const old = ctx.document.getElementById; ctx.document.getElementById = (id) => (id === "record-mine" ? box : old(id));
    vm.runInContext(`S = { week: 4, games: [] }; MBWEEK = null; MB = { summary: { wins: 9, losses: 9, pushes: 0, pl: 0, openCost: 0 }, synced: null, bets: [
      { id: "a", week: 3, cost: 10, toWin: 100, result: "L", pl: -10, legs: [] }, { id: "b", week: 3, cost: 10, toWin: 100, result: "L", pl: -10, legs: [] },
      { id: "c", week: 4, cost: 20, toWin: 130, result: "W", pl: 110, legs: [] } ] }`, ctx);
    ctx.T.renderMine(); ok(/1–0/.test(box.innerHTML) && /\+\$110/.test(box.innerHTML) && /<option value="3">Week 3<\/option><option value="4" selected>Week 4<\/option><option value="all">Season/.test(box.innerHTML), "record tab: defaults to this week's bets only; the week drop-down runs from the first recorded week, then Season");
    vm.runInContext(`MBWEEK = "all"`, ctx); ctx.T.renderMine(); ok(/1–2/.test(box.innerHTML), "record tab: Season chip shows every week");
    vm.runInContext(`MBWEEK = 3`, ctx); ctx.T.renderMine();
    ok(/class="mbhero"/.test(box.innerHTML) && /class="card mbtop"/.test(box.innerHTML) && / bets?<\/span><\/div>/.test(box.innerHTML) && !/stat"/.test(box.innerHTML) && !/Expected returns/.test(box.innerHTML) && !/Open bets/.test(box.innerHTML) && !/Live account view/.test(box.innerHTML) && /Results/.test(box.innerHTML), "record tab: an earlier week shows results only");
    vm.runInContext(`MBWEEK = null`, ctx); ctx.T.renderMine(); ok(/class="mbhero"><span class="lbl">Profit · Week \d+<\/span><b>/.test(box.innerHTML) && /\d+ open · \$/.test(box.innerHTML) && !/Your record · P\/L/.test(box.innerHTML) && !/Live account view/.test(box.innerHTML), "record tab (10/27 owner): Profit as the big number on top, the record / open / stake line under it, no repeated record");
    vm.runInContext(`MBWEEK = null`, ctx); ctx.document.getElementById = old; }
  { const base = { player: "B.Bowers", pos: "TE", team: "LV", game: "LV @ KC", fair: 34, two: 8, teamRank: 1, price: 0.3, snap: { pct: 71 }, flags: [] };
    const yes = ctx.T.tdRow({ r: { ...base, returning: "out", returningState: "practicing" }, g: {} }), dnp = ctx.T.tdRow({ r: { ...base, returning: "out", returningState: "not practicing" }, g: {} }), no = ctx.T.tdRow({ r: base, g: {} });
    ok(/RETURNING/.test(yes) && /34%/.test(yes) && !/RETURNING/.test(no), "returning label: practicing returner is labelled on the TD row, plain players are not");
    ok(/NOT PRACTICING/.test(dnp) && !/↩ RETURNING/.test(dnp), "returning label: a returner who is not practicing is flagged on the TD row"); }
  const apx = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  // 10/20 night (owner): TD by week under a tapped TD row; LAST WK column on the props rows (both sports)
  { const data = { weeks: { 1: { games: ["NE @ CHI", "X @ Y"], counts: { "NE @ CHI": { "D.Swift": 1 } }, final: true }, 2: { games: ["CHI @ Z"], counts: { "CHI @ Z": { "R.Odunze": 2 } }, final: true }, 3: { games: ["Q @ R"], counts: {}, final: true }, 4: { games: ["CHI @ K"], counts: {}, final: true }, 5: { games: ["CHI @ M"], counts: { "CHI @ M": {} }, final: false } } };
  const l = ctx.T.tdWeekLine(data, "CHI", "D.Swift");
  ok(/W1 ✓<\/b>/.test(l) && /W2 –/.test(l) && /W3 bye/.test(l) && /W4 –/.test(l) && !/W5/.test(l) && /no TD last 2 games/.test(l), "TD by week: ✓ / – / bye per week, the running week left out until final, a drought counted", l);
  ok(/W2 ✓2<\/b>/.test(ctx.T.tdWeekLine(data, "CHI", "Rome Odunze")) && /loading/.test(ctx.T.tdWeekLine(null, "CHI", "X")), "TD by week: counts 2+, matches a long name to the short one, says loading before the feed arrives");
  // 10/20 night: a week not played yet is left out (no "bye" for everyone); the drought cut -- 3+ straight played games without a TD and under 45% -> off the list
  { const d2 = { weeks: { ...data.weeks, 6: { games: [], counts: {}, final: false }, 7: { games: ["CHI @ T"], counts: {}, final: false } } };
    const l2 = ctx.T.tdWeekLine(d2, "CHI", "D.Swift");
    ok(!/W6/.test(l2) && !/W7/.test(l2) && /W3 bye/.test(l2), "TD by week: a week not played yet never reads bye; a final week the team sat out does", l2);
    ok(ctx.T.tdDrought(data, "CHI", "D.Swift") === 2 && ctx.T.tdDrought(data, "CHI", "R.Odunze") === 1 && ctx.T.tdDrought(null, "CHI", "X") === null, "TD drought: played games since the last TD, byes skipped, null before the feed");
    const d3 = { weeks: { ...data.weeks, 5: { games: ["CHI @ M"], counts: { "CHI @ M": { "Z.Other": 1 } }, final: true } } };
    ok(ctx.T.tdDrought(d3, "CHI", "D.Swift") === 3, "TD drought: counts 3 after three blanks");
    ok(ctx.T.tdWarn({ team: "CHI", player: "D.Swift" }, d3) === "✗ no TD last 3 games" && ctx.T.tdWarn({ team: "CHI", player: "D.Swift" }, data) === "✗ no TD last 2 games" && ctx.T.tdWarn({ team: "CHI", player: "R.Odunze" }, data) === "✗ no TD last game" && ctx.T.tdWarn({ team: "CHI", player: "D.Swift" }, null) === null,
      "TD note (10/27): one blank -> 'no TD last game', 2+ -> 'no TD last N games'; nothing before the feed arrives");
    const d4 = { weeks: { ...d3.weeks, 6: { games: ["CHI @ N"], counts: { "CHI @ N": { "D.Swift": 1 } }, final: true } } };
    ok(ctx.T.tdWarn({ team: "CHI", player: "D.Swift" }, d4) === null && ctx.T.tdDrought(d4, "CHI", "D.Swift") === 0, "TD caution: the week he scores the caution is gone (drought 0)");
    ok(ctx.T.tdWarn({ team: "CHI", player: "N.Body" }, data) === "✗ no TD last 3 games" && ctx.T.tdWarn({ team: "CHI", player: "R.Odunze" }, data) === "✗ no TD last game", "TD caution: a player with no TD this season counts every played game; one blank after a score reads 'no TD last game'");
    { // 10/21: only HIS played games count -- a game he sat out (no snaps while the team's snaps are posted) is "out", neither a TD nor a blank
      const dp = { weeks: { 1: { games: ["CHI @ A"], counts: { "CHI @ A": { "K.Monangai": 1 } }, final: true }, 2: { games: ["CHI @ B"], counts: { "CHI @ B": {} }, final: true }, 3: { games: ["CHI @ C"], counts: { "CHI @ C": { "Bi.Robinson": 2 } }, final: true } },
        played: { CHI: { "Kyle Monangai": [1], "Brian Robinson": [1, 2, 3], "Dan Other": [1, 2, 3] } } };
      ok(ctx.T.tdDrought(dp, "CHI", "K.Monangai") === 0 && ctx.T.tdWarn({ team: "CHI", player: "K.Monangai" }, dp) === null && /W2 out/.test(ctx.T.tdWeekLine(dp, "CHI", "K.Monangai")),
        "TD page (10/21): games he sat out are skipped -- K.Monangai scored in his last played game, stays listed with no caution; his line reads 'W2 out'", ctx.T.tdWeekLine(dp, "CHI", "K.Monangai"));
      ok(ctx.T.tdNameEq("Bi.Robinson", "Bijan Robinson") && !ctx.T.tdNameEq("Bi.Robinson", "Br.Robinson") && !ctx.T.tdNameEq("Br.Robinson", "Bijan Robinson") && ctx.T.tdNameEq("K.Walker", "Kenneth Walker III") && ctx.T.tdNameEq("A.P4", "A.P4") && !ctx.T.tdNameEq("A.P4", "A.P3"),
        "TD names (10/21): Bi.Robinson is not Br.Robinson (both ATL) -- his touchdowns are his only; suffixes ignored");
      ok(ctx.T.tdDrought(dp, "CHI", "Br.Robinson") === 3 && ctx.T.tdDrought(dp, "CHI", "Nobody.Listed") === 3, "TD page (10/21): a player with no snap row falls back to the team's games");
      ok(/>…</.test(ctx.T.recTile(undefined, "X")) && />0–0</.test(ctx.T.recTile(null, "X")) && />23–8</.test(ctx.T.recTile({ w: 23, l: 8, pct: 74.2 }, "X")), "record tile (10/21): '…' while loading (the Best TD tile flashed 0–0), 0–0 only when nothing is graded"); }
    ok(/Loading…/.test(apx.slice(apx.indexOf("function renderTd()"), apx.indexOf("function renderTd()") + 700)) && /name === "td" && S && S\.games\) renderTd\(\)/.test(apx), "TD page: nothing is drawn before the week feed lands, and opening the page draws it fresh"); }
  ok(/data-tdw="\$\{esc\(r\.team\)\}\|\$\{esc\(r\.player\)\}"/.test(apx) && /closest\("\.tdr\[data-tdw\]"\)/.test(apx) && /fetch\("\/api\/tdweeks"/.test(apx) && /loadTdWeeks\(\);/.test(apx), "TD by week: every TD row carries its player, a tap opens the week line, the feed loads with the page");
  const tw = await import("../lib/tdweeks.js"), { getRedis } = await import("../lib/redis.js"); const fake = async (w) => (w <= 2 ? { ok: true, games: { "A @ B": ["X.Y"] }, counts: { "A @ B": { "X.Y": 1 } } } : null);
  const out = await tw.tdWeeks(2099, 3, fake); ok(out.upto === 3 && out.weeks[1] && out.weeks[1].games[0] === "A @ B" && out.weeks[1].counts["A @ B"]["X.Y"] === 1 && !out.weeks[3], "TD by week feed: per week games + counts from the scorers feed, a week without data left out");
  { const o2 = await tw.tdWeeks(2099, 3, fake, async () => ({ CHI: { "Kyle Monangai": { name: "Kyle Monangai", pos: "RB", weeks: { 1: 0.5, 2: 0, 3: 0.4 } }, "Big Lineman": { name: "Big Lineman", pos: "T", weeks: { 1: 1 } } } }));
    ok(o2.played && JSON.stringify(o2.played.CHI) === JSON.stringify({ "Kyle Monangai": [1, 3] }), "TD by week feed (10/21): the weeks each skill player had offense snaps (0-snap weeks and linemen left out)", o2.played); }
  await getRedis().del(tw.K_TDWEEKS(2099, 1)); await getRedis().del(tw.K_TDWEEKS(2099, 2));
  const pl = ctx.T.propLast({ last: { week: 6, line: 49.5, side: "under", result: "W", actual: 38 } }), pn = ctx.T.propLast({ last: { week: 6, actual: 38 } }), p0 = ctx.T.propLast({});
  ok(/class="pp5 g">U 49\.5 ✓ <span class="dim">38<\/span>/.test(pl) && /class="pp5 dim">38</.test(pn) && /pp5 dim">—/.test(p0), "props LAST WK cell: line + ✓ / ✗ + the real number; the number alone without a line; — with nothing", { pl, pn });
  ok(/<span class="pp5">LAST WK<\/span>/.test(apx) && /<span class="pp5">LAST<\/span>/.test(readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8")) && /last: last\[`\$\{normName\(p\.name\)\}\|\$\{p\.stat\}`\] \|\| null/.test(readFileSync(new URL("../lib/props.js", import.meta.url), "utf8")) && /lastNbaProps\(date, null, bands\)/.test(readFileSync(new URL("../nba/lib/props.js", import.meta.url), "utf8")), "props LAST column on both sports, fed by each sport's graded rows");
  { const { lastWeekProps } = await import("../lib/props.js"); const rk = (await import("../lib/props.js")).K_PROPRES(2099, 6);
    await getRedis().hset(rk, "A @ B", JSON.stringify({ picks: [{ name: "Kyle Williams", stat: "rec_yds", line: 14.5, side: "under", chance: 0.9, price: 0.95, result: "L", actual: 12 }, { name: "Kyle Williams", stat: "rec_yds", line: 24.5, side: "under", chance: 0.8, price: 0.6, result: "W", actual: 12 }] }));   // 10/21: the 95c line was never shown -> LAST WK = the shown 24.5
    { const ga = await (await import("../lib/props.js")).propsGradedAll(getRedis(), 2099, 6, [{ key: "A @ B", final: true }]);   // 10/23: every graded line for npm run verify, shown or not
      ok(ga.graded.length === 1 && ga.graded[0].picks.length === 2 && ga.graded[0].picks.every((p) => p.result && p.actual != null) && ga.missing.length === 0, "props ?all=1 (10/23): every graded line of the week, the shown one and the tracked one", ga); }
    { const pr = await import("../lib/props.js"), bands = await pr.propCalibration(getRedis(), 2099, Date.now(), true), b = bands[pr.calBand(0.7)];   // 10/23: NFL props shown % calibrated like NBA
      const c = pr.calibrate(0.72, bands);
      ok(b && b.n === 1 && b.won === 1 && c > 0.72 && Math.abs(c - (0.72 + (1 - b.said) / (1 + pr.CAL_K))) < 1e-9 && pr.calibrate(0.95, bands) === 0.95
        && pr.groupShown("rec_yds|under|70-80") && !pr.groupShown("rec_yds|under|65-70") && !pr.groupShown("rec|over|62-65") && pr.groupShown("rec|over|65-70") && !pr.groupShown("rec|under|70-80"),
        "props calibration (10/23): the shown row's band moves toward what it won (shrunk by CAL_K); groups read 'shown' only from the family's bar", { bands, c }); }
    const lw = await lastWeekProps(getRedis(), 2099, 7); ok(lw["kyle williams|rec_yds"] && lw["kyle williams|rec_yds"].line === 24.5 && lw["kyle williams|rec_yds"].result === "W" && lw["kyle williams|rec_yds"].week === 6, "props LAST WK (10/21): the line the page SHOWED last week (not the first graded line of the ladder)", lw); await getRedis().del(rk); } }
  { // 10/20 night (owner): one line per player -- game · #N on team under the name, SNAP / 2+ TD / MODEL / PM at the far right, nothing to open; the list split by time slot; no game-page ANYTIME TD card
    const row = ctx.T.tdRow({ r: { player: "D.Swift", team: "CHI", pos: "RB", fair: 54.4, two: 20.2, price: 0.6, bid: 0.58, game: "NE @ CHI", teamRank: 1, snap: { pct: 58 }, flags: [] }, g: { key: "NE @ CHI" } });
    ok(/class="pbl ppr first tdr" data-tdw="CHI\|D\.Swift"/.test(row) && /<span class="pp1">• D\.Swift<span class="pos">RB<\/span><\/span><span class="pp2"><\/span><span class="pp3 mod">54%<\/span><span class="pp4">60¢/.test(row) && /class="tdwk"><div class="st"><b>SNAP<\/b> 58% <span class="dim">·<\/span> <b>2\+ TD<\/b> 20%<\/div><div class="wk"><\/div>/.test(row) && !/#1 on team/.test(row) && !/class="more"/.test(row), "Anytime TD row (10/22; no logo on the row since 10/28): bullet, name, NO 'Anytime TD' words (a player who scored last game has an empty middle), MODEL / POLYMARKET on the right; SNAP and 2+ TD behind the tap", row);
    const rowG = ctx.T.tdRow({ r: { player: "D.Swift", team: "CHI", pos: "RB", fair: 54.4, price: 0.6, game: "NE @ CHI", flags: [] }, g: { key: "NE @ CHI" } }, true);
    ok(/<span class="pp2"><span class="pp2t">NE @ CHI<\/span><\/span>/.test(rowG) && !/Anytime TD/.test(rowG), "Anytime TD row (10/22): a Best TD picks row carries its game in the middle, no 'Anytime TD' words");
    { const ctxW = ctx.T.tdRow({ r: { player: "D.Swift", team: "CHI", pos: "RB", fair: 54.4, price: 0.6, game: "NE @ CHI", flags: [] }, g: { key: "NE @ CHI" } }, true);
      const css = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
      ok(/\.ppr\.first\.tdr, \.ppr\.tdh \{ grid-template-columns:minmax\(0,2fr\) minmax\(0,1\.6fr\) minmax\(44px,\.6fr\) minmax\(74px,\.7fr\); \}/.test(css) && /\.tdr \.pp2 \{ text-align:center; \}/.test(css) && /\.ppr\.tdh \.pp3 \{ grid-column:3; \}/.test(css) && !/Anytime TD/.test(ctxW),
        "Anytime TD on a computer (10/22): the red caution sits centered in the middle column where 'Anytime TD' was; MODEL / POLYMARKET heads over their own columns"); }
    ok(/<div class="pbl ppr pph first tdh"><span class="pp1">PLAYER<\/span><span class="pp3">MODEL<\/span><span class="pp4"><span class="pm"><img src="\/polymarket\.png" alt=""><\/span>POLYMARKET<\/span><\/div>/.test(ctx.T.tdHead()) && !/SNAP/.test(ctx.T.tdHead()), "Anytime TD header (10/21 night): the props-page head PLAYER · MODEL · [logo] POLYMARKET");
    const apx = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    ok(/const gameCard = \(g\) => \{ const xs = shown\.filter\(\(x\) => x\.g\.key === g\.key\)/.test(apx) && /teamPart\(g\.away\)\}\$\{teamPart\(g\.home\)\}/.test(apx) && /gameLogos\(g\.key\)/.test(apx) && /labSlot\(g\.kickoff\)/.test(apx) && !/tdTop3/.test(apx) && !/function prow\(/.test(apx) && !/\.tdr"\); if \(tr/.test(apx), "Anytime TD: one card per game under each time slot, teams split inside (10/21 night); the game page has no ANYTIME TD card; no expandable card code"); }
  { const w = (m) => ctx.T.totalCard({ ...tg, poly: { total: { line: 38.5, over: 0.5, under: 0.52 } }, model: { total: 37, ...m } }, "x");
    ok(!/Tested angle/.test(w({ outdoor: true, wind: 14 })) && !/Tested angle/.test(w({ outdoor: true, wind: 20 })), "windy-under note: removed from the card (tested, not added; review fix 10/14)");
    ok(!/★/.test(w({ outdoor: true, wind: 14 })), "total card: no extra angle note next to the PICK"); }
  vm.runInContext(`S = { week: 4, games: [] }; LIVE = {}; LIVE_T = null`, ctx);
  { const fg = { key: "NE @ CHI", away: "NE", home: "CHI", kickoff: "2026-10-23T00:15:00Z", started: true, final: true, awayScore: 24, homeScore: 30, injuries: [], history: [], poly: { spread: { homeSpread: -2.5, home: 0.55, away: 0.45 }, total: { line: 50.5, over: 0.51, under: 0.49 } },
      spreadPick: { label: "NE +2.5", result: "lost" }, totalPick: { label: "Under 50.5", result: "lost" },
      lockedPicks: { spread: { pick: "CHI -2.5", hit: 52, result: "W", pts: { pick: "CHI -1.5", hit: 54, result: "W" } }, total: { pick: "Over 50.5", hit: 51, result: "W" } } };
    const sc = ctx.T.gameCard(fg, "x"), tc = ctx.T.totalCard(fg, "x");
    ok(!/leaned/.test(sc + tc) && /Pick CHI -2\.5 <span class="g">won/.test(sc) && /Pick w\/ points CHI -1\.5 <span class="g">won/.test(sc) && /Pick Over 50\.5 <span class="g">won/.test(tc) && /cover won/.test(sc), "finished cover names the stored PICK, not the old model side"); }
  const lg = { key: "PIT @ CLE", away: "PIT", home: "CLE", kickoff: "2026-10-02T00:15:00Z", started: true, final: false, injuries: [], history: [], poly: { spread: { homeSpread: 2.5, home: 0.5, away: 0.5 }, ml: { home: 0.4, away: 0.62 }, total: { line: 38.5, over: 0.5, under: 0.5 } } };
  ok(!/LIVE/.test(ctx.T.gameCard(lg, "x")), "live view: nothing live until live lines are loaded (the card shows the locked kickoff line)");
  vm.runInContext(`LIVE = { "PIT @ CLE": { spread: { homeSpread: 3.5, home: 0.48, away: 0.53 }, total: { line: 36.5, over: 0.5, under: 0.52 } } }; LIVE_T = new Date().toISOString()`, ctx);
  const lc = ctx.T.gameCard(lg, "x"), ltc = ctx.T.totalCard(lg, "x");
  ok(/LIVE/.test(lc) && /CLE \+3\.5/.test(lc) && /Kickoff: PIT -2\.5 · ML PIT -163/.test(lc) && /LIVE<\/span> · 0s ago/.test(lc) && !/locked at kickoff/.test(lc), "live view: live spread with a LIVE tag, with the locked kickoff line kept underneath", lc);
  ok(/Over 36\.5/.test(ltc) && /Kickoff: 38\.5/.test(ltc), "live view: live total, locked kickoff total kept");
  vm.runInContext(`LIVE = { "PIT @ CLE": null }`, ctx);
  ok(/paused/.test(ctx.T.gameCard(lg, "x")) && /Kickoff: PIT -2\.5/.test(ctx.T.gameCard(lg, "x")), "live view: no open lines -> says paused, not a stale number");
  ok(!/LIVE/.test(ctx.T.gameCard({ ...lg, started: false }, "x")) && !/LIVE/.test(ctx.T.gameCard({ ...lg, final: true }, "x")), "live view: not shown before kickoff or after the game ends");
  vm.runInContext(`LIVE = {}; LIVE_T = null`, ctx);
  vm.runInContext(`S = { games: [{ key: "TEN @ BAL", away: "TEN", home: "BAL", started: false, winPct: 84.4, model: { homeMargin: 12, total: 40 }, poly: { ml: { home: 0.82, away: 0.2 }, spread: { homeSpread: -10.5, home: 0.5, away: 0.51 }, total: { line: 41.5, over: 0.5, under: 0.51 } } },
    { key: "KC @ LV", away: "KC", home: "LV", started: false, winPct: 28, poly: { ml: { home: 0.3, away: 0.72 } } },
    { key: "X @ Y", away: "X", home: "Y", started: true, winPct: 60 }], winners: { all: { n: 10, w: 7, l: 3, hit: 0.7, said: 0.68 }, top4: { n: 4, w: 4, l: 0, hit: 1, said: 0.8 } } }`, ctx);
  const box = ctx.T.winnersBox();
  ok(box.indexOf("BAL") < box.indexOf("KC") && /1\. <b>BAL<\/b> over TEN/.test(box) && /2\. <b>KC<\/b> over LV/.test(box) && !/X over Y/.test(box), "page: ranked by chance, started games left out");
  vm.runInContext(`S.games[0].td = [{ player: "D.Henry", fair: 58, injury: "" }, { player: "Out.Guy", fair: 90, injury: "Out" }, { player: "L.Jackson", fair: 41 }]`, ctx);
  ok(/TD <b>D\.Henry 58%<\/b>/.test(ctx.T.winnersBox()), "page: touchdown side is the most likely scorer who is not out");
  ok(/80%/.test(box) && /82¢/.test(box) && !/7–3/.test(box) && /Favorite in every game/.test(box), "page (10/21): the favorites list shows the SAME win chance as the tile (moneyline, fee out: 80%) and the price; titled as the favorite, not a model pick");
  ok(/Spread <b>—<\/b> · Total <b>—<\/b> · TD <b>/.test(box) && !/BAL -10\.5/.test(box), "page: each game shows the card's spread / total pick (none here) and the touchdown side -- not the game model's own side");
  }
// ---------- 10/17 SLATEZZ: one site for NFL + NBA (menu, header, home lists, NBA kept separate)
{ const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), nbaHtml = readFileSync(new URL("../public/nba/index.html", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8");
  ok(!/class="tabs"/.test(html) && !/class="tabs"/.test(nbaHtml) && !/id="lever"/.test(html) && !/id="lever"/.test(nbaHtml), "no bottom tab bar and no lever on either page");
  ok(!/id="shead"|id="panel-home"/.test(html) && /class="panel on" id="panel-lines"/.test(html) && !/shead-next/.test(html) && !/id="menu-btn"/.test(html + nbaHtml) && !/renderHome|loadHome|homeClocks/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8")), "10/27: Home is the games list (no separate home page, no SLATEZZ strip, no NEXT GAME clocks), no menu button");
  ok(/src="\/shell\.js"/.test(html) && /src="\/shell\.js"/.test(nbaHtml) && /href="\/shell\.css"/.test(html) && /href="\/shell\.css"/.test(nbaHtml), "both pages load the one shared menu / header");
  ok(!/chips dock|\.chips\.dock/.test(html + nbaHtml), "no docked sub-tab strips left (cleanup 10/18: the menu holds the sub tabs)");
  const sctx = { window: {}, document: {}, location: { hash: "" }, Date, Math, Number, String, JSON, Promise, Object, Array }; sctx.window = sctx; vm.createContext(sctx); vm.runInContext(shell, sctx);
  const Sh = sctx.Shell, H = 36e5, M = 6e4;
  ok(!Sh.clockTxt && !Sh.setNext && !/setNext|clockTxt|"lever"|rerunModel|weekline/.test(shell + readFileSync(new URL("../public/app.js", import.meta.url), "utf8") + readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8")), "cleanup 10/18: no NEXT GAME header strip, lever or old header-line code left");
  const items = [...shell.matchAll(/\["(\w+)", "([^"]+)", "\w+"\]/g)].map((m) => m[2]);
  ok(/data-b="home" href="\$\{URL_\[sp\]\}#lines"[\s\S]*<span>Home<\/span>[\s\S]*data-b="bets" href="\$\{URL_\[sp\]\}#mybets"[\s\S]*<span>Bets<\/span>[\s\S]*data-b="model" href="\$\{URL_\[sp\]\}#models"[\s\S]*<span>Model<\/span><\/a><\/nav>/.test(shell) && !/bsport|hmod|data-b="lines"|data-b="props"/.test(shell) && /<header class="tbar" id="tbar"><a class="slatelogo sgrad" data-nav href="\$\{URL_\[sp\]\}#lines">SLATEZZ<\/a><span class="lgts tlg">\$\{Shell\.leagueTabs\(sp, "lines"\)\}<\/span>` \+[^\n]*\n\s*`<span class="tright"><button class="mref"[^`]*` \+[^\n]*\n\s*`<a class="tib" data-nav data-pg="alerts" href="\$\{URL_\[sp\]\}#alerts"[^`]*<b class="tcnt" id="mcnt-\$\{sp\}-alerts"><\/b><\/a><\/span><\/header>`/.test(shell) && /\.slatelogo \{ flex:none; font-family:"Bowlby One"[^}]*font-size:26px;/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /\.bnav \{ left:50%;[^}]*border-radius:28px;/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /\.bnav \.bi\.on \{ background:rgba\(255,255,255,\.14\); \}/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /leagueTabs\(sp, page\)/.test(shell) && /#panel-lines > \.phead \{ display:none !important; \}/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")), "bottom bar (owner 10/27): Home · Bets · Model as a floating pill of icons, the open one in a bubble; Home titled by the NFL | NBA sport row (Home only); no ball switch, Lines, Props or Models bar; top bar SLATEZZ + the refresh (white) + the bell");
  ok(/fetch\("\/api\/rerun", \{ method: "POST" \}\)/.test(shell) && /fetch\("\/api\/nba\/snapshot"/.test(shell), "the menu's refresh reruns both models (NFL /api/rerun, NBA /api/nba/snapshot)");
  // NBA uses ONLY its own settings
  const nbaR = await import("../nba/lib/redis.js"), nbaM = readFileSync(new URL("../nba/lib/model.js", import.meta.url), "utf8"), nbaB = readFileSync(new URL("../nba/lib/books.js", import.meta.url), "utf8");
  ok(nbaR.redisUrl({ UPSTASH_REDIS_REST_URL_REDIS_URL: "redis://nfl:1", REDIS_URL: "redis://x:2" }) === null && nbaR.redisUrl({ NBA_DB_URL_REDIS_URL: "redis://db:3" }) === "redis://db:3", "NBA reads the shared database's own setting (its keys under nba:); no other database variable is read");
  ok(/NBA_MODEL_SERVICE_URL/.test(nbaM) && !/env\.MODEL_SERVICE_URL/.test(nbaM) && /NBA_ODDS_API_KEY/.test(nbaB) && !/env\.ODDS_API_KEY/.test(nbaB), "NBA's model service and odds key are its own settings");
  const nbaApp = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
  ok(!/fetch\("\/api\/(?!nba\/)/.test(nbaApp), "the NBA page only calls /api/nba/... routes");
  // NBA live scores (home screen)
  const { parseLive } = await import("../pages/api/nba/live.js");
  const ev = (a, h, as, hs, state, period, clock, detail) => ({ competitions: [{ competitors: [{ homeAway: "away", score: String(as), team: { abbreviation: a } }, { homeAway: "home", score: String(hs), team: { abbreviation: h } }], status: { period, displayClock: clock, type: { state, detail } } }] });
  const L = parseLive({ events: [ev("BOS", "NY", 58, 61, "in", 3, "6:30", "6:30 - 3rd"), ev("LAL", "DEN", 50, 48, "in", 2, "0:00", "Halftime"), ev("GS", "PHO", 110, 104, "post", 4, "0:00", "Final"), ev("XXX", "DEN", 0, 0, "pre", 0, "12:00", "7:00 PM")] });
  ok(L["BOS @ NYK"] && L["BOS @ NYK"].a === 58 && L["BOS @ NYK"].h === 61 && L["BOS @ NYK"].lbl === "Q3 6:30" && L["LAL @ DEN"].lbl === "Half" && L["GSW @ PHX"].st === "post" && Object.keys(L).length === 3, "NBA live scores: ESPN codes mapped (NY -> NYK, GS -> GSW, PHO -> PHX), quarter + clock, halftime, final", L);
  ok(!/function (homeTile|homeSection|homeClocks|clockParts|clockRun|loadHome)\b/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8")), "10/27: the old home page code (next-game clocks, home tiles, the NBA side loaded on the NFL page) is gone"); }
// ---------- 10/17: Railway config files -- each service watches only its own folder (patterns are from the repo root; the config path is set per service)
{ const rj = (f) => JSON.parse(readFileSync(new URL("../" + f, import.meta.url), "utf8")).build.watchPatterns;
  ok(JSON.stringify(rj("railway.json")) === '["/railway-model-service/**"]' && JSON.stringify(rj("railway-model-service/railway.json")) === '["/railway-model-service/**"]', "NFL model service redeploys only on NFL model changes");
  ok(JSON.stringify(rj("nba/railway-model-service/railway.json")) === '["/nba/railway-model-service/**"]', "NBA model service redeploys only on NBA model changes"); }
// ---------- 10/17: live tiles keep their size; NFL time-slot headers stand out
{ const h = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  ok(/\.live:not\(\.tile\) \{ width:7px/.test(h) && !/\n  \.live \{ width:7px/.test(h), "the 7px 'live' dot rule never applies to a live game tile (it crushed live tiles into small circles)");
  ok(/\.labslot \{[^}]*font-size:22px;[^}]*color:#fff; \}/.test(h) && !/\.labslot \{[^}]*border-bottom/.test(h), "time-slot headers: 22px, white, no line (10/18)"); }
// ---------- 10/17: menu "Last model refresh" (newest of NFL / NBA); NBA home rows fall back to Polymarket's pre-tip line
{ const sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const sctx = { window: {}, document: {}, Date, Math, Number, String, JSON, Promise, Object, Array, isNaN }; sctx.window = sctx; vm.createContext(sctx); vm.runInContext(sh, sctx);
  const t = sctx.Shell.runTxt("2026-10-18T04:45:00Z");
  ok(/fetch\("\/api\/lastrun"/.test(sh) && /Model Refresh: /.test(sh) && !/Last model refresh/.test(sh) && /^\d{1,2}:\d{2}[ap]m \d{1,2}\/\d{1,2}$/.test(t) && sctx.Shell.runTxt(null) === "—", "menu (owner 10/17): 'Model Refresh: 9:45pm 10/17' from /api/lastrun", t);
  ok(!/mdraw|mgrip|mscrim|touchstart|mclose/.test(sh + readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /\.tbar \{ position:fixed;[^}]*top:0;/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /\.bnav \{ position:fixed;[^}]*bottom:0;/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")), "10/22: the side menu, its grip, scrim and swipes are gone; a pinned top bar and a bottom bar instead");
  const lr = readFileSync(new URL("../pages/api/lastrun.js", import.meta.url), "utf8");
  ok(/K\.model\(SEASON, w\)/.test(lr) && /status:snapshot/.test(lr) && /\.sort\(\)\.pop\(\)/.test(lr), "last refresh = the newer of NFL's last model rerun and NBA's last snapshot with a model answer");
  ok(!/\/api\/nba\/(slate|closes|live)/.test(app), "10/27: the NFL page no longer loads the NBA side (Home is each sport's own games list)"); }
{ const { addAlert, listAlerts } = await import("../lib/alerts.js"), R = globalThis.__TEST_REDIS__; await R.del("alerts:2041");
  for (const kind of ["RESULT", "TD NO", "TD JUMP", "QB TD", "WEATHER"]) await addAlert(2041, { kind, game: "A @ B", title: kind });
  const L = await listAlerts(2041), RAW = await R.lrange("alerts:2041", 0, -1);
  ok(L.length === 1 && L[0].kind === "WEATHER" && RAW.length === 1, "alerts: Alerts = Injury, QB change, Line move, Weather; RESULT, TD No, TD jump, QB TD are never added (owner 10/18, cleanup 10/18)");
  const apj = readFileSync(new URL("../pages/api/alerts.js", import.meta.url), "utf8"), nap = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
  const app0 = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  ok(!/results/.test(apj) && !/results/.test(readFileSync(new URL("../pages/api/nba/alerts.js", import.meta.url), "utf8")) && !/results=1|renderResults|resultsBlock|record-results|"results"/.test(app0) && !/results=1|renderResults|resultsBlock|record-results|"results"/.test(nap) && !/RESULT: \["Result"/.test(nap)
    && !/record-results/.test(readFileSync(new URL("../public/index.html", import.meta.url), "utf8")) && !/record-results/.test(readFileSync(new URL("../public/nba/index.html", import.meta.url), "utf8")),
    "RESULT lines (owner 10/18): no Results page, no results reader, not saved (cleanup 10/18; both sports)");
  const sh2 = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), sc2 = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8");
  for (const f of ["../public/app.js", "../public/nba/app.js"]) { const a = readFileSync(new URL(f, import.meta.url), "utf8"); ok(!/slotify|rollReels|ROLL_ON_OPEN/.test(a) && /function slotMoney\(root/.test(a) && /\/\\\$\\d\/\.test\(n\.nodeValue\)/.test(a) && /split\(\/\(\\\$\\d\[\\d,\]\*\(\?:\\\.\\d\+\)\?\)\/\)/.test(a) && /querySelectorAll\("\.reelpct\.money\[data-v\]"\)/.test(a) && (a.match(/slotMoney\(\$\(/g) || []).length === 3, `${f}: the slot roll runs only on dollar amounts (owner 10/18 night), on game open, page open and first load`); }
  for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8"); ok(/\.tile \.tmid \.mvt > span \{ display:block/.test(h) && !/\.reelpct \.rd/.test(h) && /\.reelpct\.money \.rd > span \{ display:block; transition:transform/.test(h), `${f}: move-line rule hits only its own lines; reel styles only for money`); }
  ok(/import \{ BUILD \} from "\.\.\/\.\.\/lib\/redis"/.test(readFileSync(new URL("../pages/api/build.js", import.meta.url), "utf8")) && /Cache-Control", "no-store"/.test(readFileSync(new URL("../pages/api/build.js", import.meta.url), "utf8")) && /fetch\("\/api\/build", \{ cache: "no-store" \}\)/.test(sh2) && /else if \(d\.build !== Shell\.build\) Shell\.stale = true;/.test(sh2) && /if \(Shell\.stale\) location\.reload\(\); else Shell\.buildCheck\("visible"\)/.test(sh2) && /if \(Shell\.stale\) \{ location\.replace\(u\.href\); return; \}/.test(sh2) && /setInterval\(\(\) => \{ if \(!document\.hidden\) Shell\.buildCheck\("poll"\); \}, 60e3\)/.test(sh2) && /Shell\.buildWatch\(\);/.test(sh2), "self-reload (owner 10/18 night): /api/build every minute; a newer build reloads the page when the app comes back to the front or on the next page switch");
  ok(/go\(href\) \{[\s\S]*history\.replaceState\(null, "", u\.hash \|\| "#"\); window\.dispatchEvent\(new HashChangeEvent\("hashchange"\)\)[\s\S]*else location\.replace\(u\.href\)/.test(sh2) && /closest\("a\[data-nav\]"\)[\s\S]*e\.preventDefault\(\); Shell\.go\(a\.getAttribute\("href"\)\)/.test(sh2) && !/location\.href = "\/nba/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8")), "bars (owner 10/18 night, kept 10/22): pages switch without history entries, so the phone's back swipe has nothing to walk through");
  ok(!/id="menu-grip"/.test(sh2) && !/\.mgrip|\.mbtn/.test(sc2) && /body\.bnav-on \.phead \{ position:sticky; top:calc\(var\(--stop\) \+ var\(--tbh\)\)/.test(sc2) && /--stop:calc\(env\(safe-area-inset-top,0px\) \+ 20px\)/.test(sc2), "10/22: no grip, no ☰; every page title is pinned under the top bar with a blur behind it");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"); ok(/const ALK = \{ INJURY: \["Injury", "var\(--red\)"\], "QB CHANGE": \["QB change", "#fff"\], "LINE MOVE": \["Line move", "#fff"\], WEATHER: \["Weather", "#fff"\] \};/.test(app) && /ALERTS\.filter\(\(a\) => ALK\[a\.kind\]\)/.test(app) && !/ALFILTER/.test(app), "alerts page: the four kinds; unknown kinds hidden"); await R.del("alerts:2041"); }
// ---------- 10/17: My bets and Model bets are separate pages under Bets in the menu (NFL + NBA)
{ const sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8");
  { const css = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8"), ph = css.slice(css.indexOf("@media (max-width:500px)"));
    ok(/@media \(max-width:599px\) \{ body\.bnav-on \.phead \.ptab \{ display:none; \}/.test(css) && /<i><img src="\/ball-\$\{x\}\.png\?v=1" alt=""><\/i><span>\$\{x\.toUpperCase\(\)\}<\/span>/.test(sh) && /\.lgt\.on i \{ background:rgba\(255,255,255,\.13\);/.test(css), "phones: the page title keeps the section's name (the open tab is in the sub-tab bar); the NFL | NBA row = each sport's ball over its name, the open one in a rounded square (owner 10/27)"); }
  ok(/const tabOf = \(p\) =>[\s\S]*p === "mybets" \|\| \/\^modelbets\/\.test\(p\)[\s\S]*"bets"/.test(sh) && /getElementById\("bets-sw"\), rh = document\.querySelector && document\.querySelector\("#panel-record \.phead"\)/.test(sh) && /if \(sw && rh && rh\.appendChild\) \{ rh\.appendChild\(sw\); sw\.style\.display = ""; \}/.test(sh), "10/22: Bets holds My bets | Model bets (the switch sits in the pinned Bets header); both light the Bets tab");
  // 10/20 (owner: "rename it player props and have the sub tabs ... ANYTIME TD should be a sub tab under props"): Player props heads the stat tabs on both sports, opens / closes like Bets
  ok(!/data-b="props"/.test(sh) && /home: '<path/.test(sh) && /bars: '<path/.test(sh), "bottom bar (owner 10/27): no Props button (props live in the game cards); Home and Model have their icons");
  ok(/nfl: \[\["td", "Anytime TD"\], \["props-first", "First TD"\], \["props-recyds", "Rec Yds"\], \["props-rec", "Receptions"\], \["props-rushyds", "Rush Yds"\]\]/.test(sh) && /nba: \[\["props-pts", "Points"\], \["props-reb", "Rebounds"\], \["props-ast", "Assists"\], \["props-pra", "PRA"\], \["props-stl", "Steals"\], \["props-blk", "Blocks"\]\]/.test(sh) && /const subsOf = \(sp, p\) => p === "td" \|\| \/\^props-\/\.test\(p\) \? PROPS\[sp\]/.test(sh), "sub-tab bar: NFL Anytime TD, First TD, Rec Yds, Receptions, Pass Yds; NBA Points, Rebounds, Assists, PRA, Steals, Blocks (Threes cut 10/23); Anytime TD counts as a Player props page");
  for (const f of ["../public/app.js", "../public/nba/app.js"]) { const a = readFileSync(new URL(f, import.meta.url), "utf8"), h = readFileSync(new URL(f.replace("app.js", "index.html"), import.meta.url), "utf8");
    ok(/name === "mybets" \|\| name === "modelbets"/.test(a) && /"record", "mybets", "modelbets", "props"/.test(a) && /if \(name === "props"\) \{ renderProps\(\); loadProps\(\); \}/.test(a) && /if \(\/\^props-\/\.test\(name\)\) \{ const k = name\.slice\(6\);/.test(a) && /if \(name === "props"\) sub = `props-\$\{PROPTAB\}`/.test(a) && /\.\.\.PROP_TABS\.(filter\(\(\[k\]\) => k !== "td"\)\.)?map\(\(\[k\]\) => `props-\$\{k\}`\)/.test(a) && /innerHTML = `Player props<span class="ptab"> · /.test(a) && /id="panel-props"/.test(h) && /<b id="props-title">Player props<\/b>/.test(h), `${f}: #props-<tab> opens the Player props panel on that tab (title "Player props · <tab>"); #mybets / #modelbets still open under Bets`); }
  // 10/17 (owner, option A): the Props page = receiving-yards Unders the model gives 65%+, rows with logo · player · line · % · price, ✓ / ✗ green / red; NBA page empty until Polymarket US lists NBA props
  { const pr = await import("../lib/props.js"), app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), nb = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
    ok(Object.keys(pr.PROP_PASS).every((k) => /^rec_yds\|under\||^rec\|over\|(70-80|80-90|90-100)$|^rec_yds\|over\|(65-70|80-90)$|^pass_yds\|over\|(80-90|90-100)$|^rush_yds\|under\|(70-80|80-90|90-100)$/.test(k)) && Object.keys(pr.PROP_PASS).length === 14 && pr.SHOWN_STATS.size === 4 && ["rec_yds", "rec", "pass_yds", "rush_yds"].every((x) => pr.SHOWN_STATS.has(x)) && !pr.PROP_PASS["rec|over|65-70"] && !pr.PROP_PASS["rec_yds|over|70-80"] && !pr.PROP_PASS["rush_yds|over|70-80"] && /p\.stat === "rec" \? "Rec " : p\.stat === "pass_yds" \? "Pass Yds " : p\.stat === "rush_yds" \? "Rush Yds " : ""/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8")), "props: only receiving-yards Unders (65-70, 70-80, 80-90, 90-100 bands) are shown");
    const picks = pr.propPicks([{ name: "DK Metcalf", stat: "rec_yds", line: 59.5, over: 0.28, under: 0.72, mu: 48 }, { name: "Kenneth Walker", stat: "rush_yds", line: 60.5, over: 0.7, under: 0.3 }, { name: "Jaxon Smith-Njigba", stat: "rec_yds", line: 70.5, over: 0.6, under: 0.4 }],
      { m: { "DK Metcalf|rec_yds|59.5": [0.55, 0.52, 0.47, 100, 50, 0.55, 0.47, "t"] } });
    ok(picks.length === 2 && picks[0].side === "under" && picks[0].price === 0.47 && picks[0].band === "70-80" && pr.shownProp({ ...picks[0], price: null }) && !pr.shownProp(picks[0]) && Math.abs(pr.blendChance(picks[0]) - (0.6 * 0.72 + 0.4 * 0.47)) < 1e-9 && !pr.shownProp(picks[1]), "props: a 72% Under is a pick with the Under's price (shown % = 0.6 model + 0.4 price since 10/27: at 47c it reads 62% and is not shown); a rushing Over is tracked, not shown", picks);
    // 10/20 (owner: "keep it at 62% then"): the floor is 62% on a passing family; the 62-65 band is its own record group; rushing yards / receptions Under stay out
    // 10/22 (owner: "fix the problems only"): receiving yards Under / Over start at 70% (their 65-70 band lost on real lines and live); receptions / passing stay at 65%
    ok(!pr.shownProp({ stat: "rec_yds", side: "under", chance: 0.68 }) && !pr.shownProp({ stat: "rec_yds", side: "over", chance: 0.69 }) && pr.shownProp({ stat: "rec_yds", side: "under", chance: 0.70 }) && pr.shownProp({ stat: "rec", side: "over", chance: 0.66 }) && !pr.shownProp({ stat: "pass_yds", side: "over", chance: 0.9 }), "props (10/22): receiving yards show from 70%, receptions from 65%; passing-yards Overs off the page (10/24)");
    // 10/22 (owner: "cut 62% - 65%"): the page shows 65%+; 62%+ lines are still graded in the background (TRACK_BAR) for the "62-65" record group
    ok(pr.PROP_BAR === 0.65 && pr.TRACK_BAR === 0.62 && !pr.shownProp({ stat: "rec", side: "over", chance: 0.63, band: "62-65" }) && pr.shownProp({ stat: "rec", side: "over", chance: 0.65, band: "65-70" }) && pr.propPicks([{ name: "A", stat: "rec_yds", line: 40.5, over: 0.37, under: 0.63 }], null)[0].band === "62-65", "props: 65% is the page's floor, a 63% line is graded but not shown (10/22)");
    ok(pr.bandOf(0.63) === "62-65" && pr.bandOf(0.66) === "65-70" && pr.SHOWN_FAMILIES.size === 4 && !pr.SHOWN_FAMILIES.has("pass_yds|over") && pr.shownProp({ stat: "rec", side: "over", chance: 0.66, band: "65-70" }) && pr.shownProp({ stat: "rec_yds", side: "over", chance: 0.72, band: "70-80" }) && !pr.shownProp({ stat: "rec_yds", side: "under", chance: 0.61, band: null }) && pr.shownProp({ stat: "rush_yds", side: "under", chance: 0.9, band: "90-100" }) && !pr.shownProp({ stat: "rush_yds", side: "under", chance: 0.72, band: "70-80" }) && !pr.shownProp({ stat: "rush_yds", side: "over", chance: 0.9, band: "90-100" }) && !pr.shownProp({ stat: "rec", side: "under", chance: 0.9, band: "90-100" }) && pr.propPicks([{ name: "A", stat: "rec_yds", line: 40.5, over: 0.37, under: 0.63 }], null).length === 1 && pr.propPicks([{ name: "A", stat: "rec_yds", line: 40.5, over: 0.4, under: 0.6 }], null).length === 0, "props: a 66% receptions Over and a 72% receiving-yards Over show; 61% and the failed families do not");
    { const bp = pr.propPicks([{ name: "A", stat: "rec_yds", line: 40.5, over: 0.37, under: 0.63 }, { name: "B", stat: "rec", line: 4.5, over: 0.7, under: 0.3 }], { m: { "A|rec_yds|40.5": [0.42, 0.38, 0.6, 0, 0, 0.42, 0.6, "t"], "B|rec|4.5": [0.55, 0.5, 0.47, 0, 0, 0.55, 0.47, "t"] } });
      ok(bp[0].side === "under" && bp[0].price === 0.6 && bp[0].bid === 0.58 && bp[1].side === "over" && bp[1].price === 0.55 && bp[1].bid === 0.5, "props: a pick's bid is its own side's -- Under bid = 1 - the Over ASK (0.58), Over bid = the Over bid (10/21 fix: the Under bid read 1 - the Over bid = the Under ASK)", bp.map((x) => [x.side, x.price, x.bid])); }
    { const a = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), nb = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8"), api = readFileSync(new URL("../pages/api/props.js", import.meta.url), "utf8");
      ok(/const PROP_TABS = \[\["td", "Anytime TD"\], \["first", "First TD"\], \["recyds", "Rec Yds"\], \["rec", "Receptions"\], \["rushyds", "Rush Yds"\]\]/.test(a) && /function renderFirstTd\(el\)/.test(a) && /id="props-team"/.test(a) && /\(d\.records \|\| \{\}\)\[stat\]/.test(a) && /records\[st\] = await propsRecord\(r, season, \[\.\.\.weeks\], st\)/.test(api) && /TOP PICK RECORD/.test(a),
        "NFL Player props: tabs Anytime TD / First TD / Rec Yds / Receptions (Pass Yds off 10/24), a team drop-down, a RECORD tile per stat, the First TD tab with the top-pick record");
      ok(/const PROP_TABS = \[\["pts", "Points"\], \["reb", "Rebounds"\], \["ast", "Assists"\], \["pra", "PRA"\], \["stl", "Steals"\], \["blk", "Blocks"\]\]/.test(nb) && /fetch\(`\/api\/nba\/props/.test(nb) && /id="props-day"/.test(nb) && /id="props-team"/.test(nb) && /nbaSlot\(g\.start\)/.test(nb) && /class="pbl ppr/.test(nb), "NBA Player props: the six stat tabs (Threes cut 10/23), day + team drop-downs, rows under the tip-off headers in the NFL row look"); }
    { const h = readFileSync(new URL("../pages/api/mybets.js", import.meta.url), "utf8");
      ok(/const \{ raw, \.\.\.out \} = await loadMyBets\(\);/.test(h) && /\.\.\.out, \.\.\.\(req\.query\.raw === "1" \? \{ raw \} : \{\}\)/.test(h) && !/\.raw\b/.test(app.replace(/\/\/[^\n]*/g, "")), "/api/mybets: the raw Polymarket copy (~1.2 MB) is sent only on ?raw=1; the page never read it (10/27)"); }
    ok(/fetch\(`\/api\/props/.test(app) && /class="pp1">\$\{p\.result \? legMark\(p\.result\) : "•"\} \$\{esc\(p\.name\)\}/.test(app) && /id="props-wk"/.test(app) && /labSlot\(g\.kickoff\)/.test(app) && /function renderProps\(\)/.test(nb) && /id="panel-props"/.test(readFileSync(new URL("../public/nba/index.html", import.meta.url), "utf8")), "props page: week drop-down, kickoff headers, player | line | % | price columns, green / red result; NBA has the page too");
    const rr = readFileSync(new URL("../pages/api/rerun.js", import.meta.url), "utf8"), gr = readFileSync(new URL("../lib/grade.js", import.meta.url), "utf8"), ap = readFileSync(new URL("../railway-model-service/app.py", import.meta.url), "utf8"), pm = readFileSync(new URL("../railway-model-service/prop_model.py", import.meta.url), "utf8");
    ok(/post\(base, "\/prop-probs"/.test(rr) && /K_PROPMODEL\(season, week, q\.x\.key\)/.test(rr) && /outs: x\.outs, lines/.test(rr) && /gradePropsWeek\(getRedis\(\), season, week, games\)/.test(gr), "rerun saves the prop model's chances (with the week's Out list) per game; grading runs with the week");
    ok(/@app\.route\("\/prop-probs"/.test(ap) && /@app\.route\("\/player-stats"/.test(ap) && /def chances_many\(games\)/.test(pm) && /"vac_tgt", "vac_car"/.test(pm) && /def _vacated\(x\)/.test(pm) && /last\[~last\.pid\.map\(nm\)\.isin\(outs\)\]/.test(pm) && /_bg\("props", _build_props\)/.test(readFileSync(new URL("../railway-model-service/scheduler.py", import.meta.url), "utf8")), "model service: /prop-probs + /player-stats; Out players leave the rows so vacated usage counts; weekly build"); }
  ok(!/ALERTK/.test(sh) && !/#alerts-\$\{k\}/.test(sh) && /<span class="tright"><button class="mref" aria-label="Rerun both models">\$\{REF_SVG\}<\/button>/.test(sh) && /document\.querySelector\("#tbar \.mref"\); if \(rb\) rb\.onclick = Shell\.refresh/.test(sh) && !/prefbox|REFRESH_ON/.test(sh) && !/className = "prun"/.test(sh) && /Refreshed \$\{Shell\.runTxt\(new Date\(\)\.toISOString\(\)\)\}/.test(sh) && /\.mref \{[^}]*border:0; background:none; color:#fff;/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /body\.bnav-on \.phead \.pt b \{ font-family:"Passion One"[^}]*text-transform:uppercase;[^}]*color:#e4e4e8;/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /justify-content:center; text-align:center;/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")) && /#upd-record, #upd-models \{ display:none !important; \}/.test(readFileSync(new URL("../public/shell.css", import.meta.url), "utf8")), "owner 10/21 night: the refresh = the accent-pink icon (GTA theme) with no circle and no time under it, on the title's line; the refresh time only in the bottom-right message after a tap (Lines / Player props / Model bets only); titles centered, in capitals, bold and big; no Updated / Synced line");
  { const nb = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
    ok(/innerHTML = \(S\.games\.length \? linesByDay\(\)/.test(nb) && /class="tiles stack"/.test(nb) && /function nbaSlot\(/.test(nb) && /id="mb-day"/.test(nb) && /\.tiles\.stack \{/.test(readFileSync(new URL("../public/nba/index.html", import.meta.url), "utf8")), "NBA matches NFL: Game Lines stacked under day headers, Model bets time headers, My bets day drop-down"); }
  for (const f of ["../public/app.js", "../public/nba/app.js"]) { const a2 = readFileSync(new URL(f, import.meta.url), "utf8");
    ok(!/alerts-|alSlug|ALFILTER/.test(a2) && !/al-chips/.test(a2), `${f}: one Alerts page -- no kind sub tabs, no kind filter, no docked kind strip (owner 10/18 night; cleanup 10/18)`); }
  ok(/nfl: \[\["best", "Best Legs"\], \["3", "3 Leg"\], \["2", "2 Leg"\], \["pp6", "6 Leg"\], \["pp8", "8 Leg"\], \["pp10", "10 Leg"\]\]/.test(sh) && /nba: \[\["pp6", "6 Leg"\], \["pp8", "8 Leg"\], \["pp10", "10 Leg"\], \["sgp4", "Same Game"\]\]/.test(sh) && /\/\^modelbets-\/\.test\(p\) \? TYPES\[sp\]\.map\(\(\[k, l\]\) => \[`modelbets-\$\{k\}`, l\]\)/.test(sh), "sub-tab bar: the Model bets types (NFL Best Legs, 3 Leg, 2 Leg, 6 / 8 / 10 Leg; NBA 6 / 8 / 10 Leg, Same Game)");
  { const a = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    ok(/function linesBg\(\)/.test(a) && /classList\.toggle\("lines-on"/.test(a) && /html\.lines-on \.pagewm \{ background:[^}]*url\(\/nfl-bg\.jpg\?v=7\)/.test(readFileSync(new URL("../public/index.html", import.meta.url), "utf8")), "NFL pages: the NFL RedZone picture (10/18) behind every page but home and a game page, cards see-through");
    ok(/innerHTML = linesBySlot\(\)/.test(a) && /class="sh labslot">\$\{sl\}/.test(a) && /class="tiles stack"/.test(a) && /\.tiles\.stack \{ grid-template-columns:1fr !important/.test(readFileSync(new URL("../public/index.html", import.meta.url), "utf8")), "NFL Game Lines: games stacked one per row under the time-slot headers");
    ok(/\^modelbets-/.test(a) && /LAB_TABS\.map\(\(\[k\]\) => `modelbets-\$\{k\}`\)/.test(a) && !/id="lab-sub"/.test(readFileSync(new URL("../public/index.html", import.meta.url), "utf8")), "NFL: #modelbets-<type> opens Model bets on that type; the docked type strip is gone"); }
  for (const f of ["../public/index.html", "../public/nba/index.html"]) ok(/id="bets-sw" style="display:none"/.test(readFileSync(new URL(f, import.meta.url), "utf8")), `${f}: the old My bets | Model bets switch is hidden (the menu picks)`); }
{ // 10/20 review: the "no sportsbook odds yet this week" warning waits until the week's first kickoff is under 3.3 days away (the Sunday-night switch to next week has no books until Monday 7 AM PT)
  const { computeWatch } = await import("../lib/watchdog.js"), day = 86400e3, mk = (d) => ({ season: 2099, week: 7, games: [{ key: "A @ B", kickoff: new Date(Date.now() + d * day).toISOString(), started: false, model: {}, poly: {}, td: [{ price: 0.5 }] }], booksAt: null });
  const far = await computeWatch(mk(4), null, null), near = await computeWatch(mk(2), null, null), stale = await computeWatch({ ...mk(4), booksAt: new Date(Date.now() - 31 * 3600e3).toISOString() }, null, null);
  const low = await computeWatch({ ...mk(4), booksAt: new Date().toISOString() }, { credits: "41" }, null), plenty = await computeWatch({ ...mk(4), booksAt: new Date().toISOString() }, { credits: "300" }, null);
  ok(low.some((x) => /credits low: 41/.test(x)) && !plenty.some((x) => /credits low/.test(x)), "watchdog (10/20): Odds API credits under 60 are flagged", low);
  ok(!far.some((x) => /sportsbook odds/.test(x)) && near.some((x) => /sportsbook odds yet this week/.test(x)) && stale.some((x) => /sportsbook odds in 30\+ h/.test(x)), "watchdog (10/20): no-books-yet warning only once the first kickoff is under 3.3 days away; 30 h old books still warn", { far, near }); }

// ---------- 10/18 (owner): Vegas gold, no glow -- purple only on the model's things
{ const css = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8");
  ok(!/#7cb7ff|#d9c4ff|#a9cfff|rgba\(124,183,255/.test(css) && (css.match(/(box|text)-shadow:[^;]*/g) || []).every((x) => /:none( !important)?$|^text-shadow:0 1px 2px rgba\(0,0,0,\.95\),0 -1px 1px rgba\(0,0,0,\.6\)$/.test(x)) && /--ggrad:linear-gradient\(90deg,#ffb27d,#ff5fa2 55%,#a67cff\)/.test(css) && /\.sgrad \{ background:var\(--ggrad\);/.test(css) && /\.slatelogo\.sgrad \{[^}]*-webkit-text-stroke:0; \}/.test(css) && !/#f2c14e/.test(css) && !/#b58cff/.test(css), "shell (10/22, 10/27): the sunset gradient on SLATEZZ; no filled circles; no glow; no gold; no purple in the shared bars");
  for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8");
    ok(/--blue:#ffffff/.test(h) && /--ggrad:linear-gradient\(90deg,#ffb27d,#ff5fa2 55%,#a67cff\)/.test(h) && !/var\(--ggrad\)/.test(h) && !/background-clip:text/.test(h.slice(h.indexOf("<style>"), h.indexOf("</style>")).replace(/\.sgrad[^\n]*/g, "")) && !/#b58cff|#7cb7ff|#a98bff|rgba\(181,140,255|rgba\(124,183,255/.test(h) && /--violet:#b794ff/.test(h) && /\.hd\.hm \{ color:var\(--violet\)/.test(h) && /\.mod \{ color:var\(--violet\); \}/.test(h)
      && /\.hd \{[^}]*color:#fff; border-bottom:1px solid rgba\(255,255,255,\.35\)/.test(h) && /\.tile \.bar i \{ display:block; height:4px; background:var\(--green\); \}/.test(h) && /\.dtop \.bar i \{[^}]*background:var\(--green\)/.test(h) && /\.labslot \{[^}]*font-size:22px;[^}]*color:#fff; \}/.test(h) && !/\.labslot \{[^}]*border-bottom/.test(h) && !/\.shead/.test(h) && !/\.phead::after/.test(h) && /\.phead \.pdd \{ display:flex;/.test(h)
      && /\.card\.modelglow \{ border-color:rgba\(255,255,255,\.28\); \}/.test(h) && !/@keyframes mglow|@keyframes pickpulse|animation:pickpulse/.test(h) && !/text-shadow:0 0/.test(h) && !/box-shadow:0 0 (8|14|16|18)px rgba\((183,148|181,140|255,207)/.test(h) && !/\.mcard \{/.test(h),
      `${f} (owner 10/18): numbers, headers, slot lines and underlines regular white, bars solid green, no gradient text, no purple outside the model's numbers, no glow`); } }
// ---------- 10/18 (owner): Props page = one row per player (10/20: its highest win %); priced at / above the win % = dropped
{ const pr = await import("../lib/props.js");
  const L = [{ name: "Nico Collins", stat: "rec_yds", side: "under", line: 109.5, chance: 0.86, price: 0.79 }, { name: "Nico Collins", stat: "rec_yds", side: "under", line: 99.5, chance: 0.81, price: 0.72 },
    { name: "Nico Collins", stat: "rec_yds", side: "under", line: 79.5, chance: 0.67, price: 0.56 }, { name: "Xavier Hutchinson", stat: "rec_yds", side: "under", line: 69.5, chance: 0.89, price: 0.98 },
    { name: "Josh Cameron", stat: "rec_yds", side: "under", line: 24.5, chance: 0.67, price: null }, { name: "Jaylin Noel", stat: "rec_yds", side: "under", line: 34.5, chance: 0.67, price: 0.67 }];
  const o = pr.onePerPlayer(L);
  ok(o.length === 2 && o[0].name === "Nico Collins" && o[0].line === 99.5 && o[1].name === "Josh Cameron", "props: one line per player = its highest win % under the 77c cut (10/20: Collins 99.5 81% at 72c; 109.5 at 79c is cut; price never picks a line, it only cuts); a line priced at or above its % is dropped (Hutchinson 98c, Noel 67c = 67%), no price keeps the row last", JSON.stringify(o.map((p) => p.name + " " + p.line)));
  { // 10/20: the Models prop group records count ONE line per player + stat per game, chosen like the page (priced under its %, under 85c, highest %) -- not every ladder line
    const picks = [{ name: "A", stat: "rec_yds", side: "over", band: "70-80", line: 19.5, chance: 0.78, price: 0.6, result: "W" }, { name: "A", stat: "rec_yds", side: "over", band: "70-80", line: 29.5, chance: 0.72, price: 0.55, result: "W" }, { name: "A", stat: "rec_yds", side: "over", band: "70-80", line: 39.5, chance: 0.71, price: 0.5, result: "L" },
      { name: "B", stat: "rec_yds", side: "under", band: "70-80", line: 60.5, chance: 0.75, price: 0.6, result: "L" }, { name: "B", stat: "rec_yds", side: "under", band: "80-90", line: 70.5, chance: 0.88, price: 0.9, result: "W" }, { name: "C", stat: "rec", side: "over", band: "70-80", line: 2.5, chance: 0.74, price: 0.6, result: null }];
    const fakeR = { hgetall: async () => ({ "X @ Y": JSON.stringify({ picks }) }) };
    const S = await pr.propSummary(fakeR, 2097, [7]);
    ok(S.groups["rec_yds|over|70-80"] && S.groups["rec_yds|over|70-80"].w === 1 && S.groups["rec_yds|over|70-80"].l === 0 && S.groups["rec_yds|under|70-80"].w === 0 && S.groups["rec_yds|under|70-80"].l === 1
      && !S.groups["rec_yds|under|80-90"] || (S.groups["rec_yds|under|80-90"] && S.groups["rec_yds|under|80-90"].w === 0 && S.groups["rec_yds|under|80-90"].l === 0),
      "prop group record: A's three Over lines count once (the 78% one, a win), B's 90c line is not counted, ungraded rows are skipped", S.groups);
    ok(S.groups["rec_yds|over|70-80"].shown === true && S.groups["rec_yds|under|70-80"].shown === true, "prop group record: shown = the page's families (receiving-yards Over 70-80 is a page row since 10/20)", S.groups);
    ok(S.all.w === 1 && S.all.l === 1 && S.lines.w === 3 && S.lines.l === 2, "prop record overall = one per player + stat (1-1); the every-line count stays as `lines` (3-2)", { all: S.all, lines: S.lines }); }
  const o2 = pr.onePerPlayer([{ name: "A", stat: "rec_yds", side: "under", line: 40.5, chance: 0.7, price: 0.6 }, { name: "B", stat: "rec_yds", side: "under", line: 30.5, chance: 0.9, price: 0.74 }, { name: "C", stat: "rec_yds", side: "under", line: 20.5, chance: 0.95, price: null }, { name: "D", stat: "pass_yds", side: "over", line: 199.5, chance: 0.95, price: 0.88 }, { name: "D", stat: "pass_yds", side: "over", line: 224.5, chance: 0.86, price: 0.85 },
    { name: "A", stat: "rec_yds", side: "over", line: 19.5, chance: 0.82, price: 0.78 }]);
  ok(o2.map((p) => p.name).join() === "B,A,C" && o2[1].line === 40.5 && pr.MAX_PRICE === 0.77, "props rows: priced rows by win % (highest first), unpriced last; a row at 77c or more is not shown (owner 10/20: no 90c rows, then cut 77+: D at 85-88c and A Over 19.5 at 78c are out, so A shows its Under 40.5); one row per player and stat", JSON.stringify(o2.map((p) => p.name)));
  { const c = pr.onePerPlayer([{ name: "A", stat: "rec_yds", side: "under", line: 50.5, chance: 0.8, price: 0.45 }, { name: "A", stat: "rec_yds", side: "under", line: 40.5, chance: 0.72, price: 0.58 }, { name: "B", stat: "rec", side: "over", line: 3.5, chance: 0.7, price: 0.48 }]);
    ok(pr.MIN_PRICE === 0.5 && c.length === 1 && c[0].name === "A" && c[0].line === 40.5, "props (10/22 night, owner: fix the weak spots): a row priced under 50c is not shown (real lines under 50c 8-7); the player's next line at 50c+ shows", JSON.stringify(c)); }
  { const bands = { 70: { n: 100, said: 0.72, won: 0.62 } }, rows = [{ name: "A", stat: "rec_yds", side: "under", line: 50.5, chance: 0.72, price: 0.69 }, { name: "A", stat: "rec_yds", side: "under", line: 60.5, chance: 0.82, price: 0.7 }];
    const c = pr.onePerPlayer(rows, bands), raw = pr.onePerPlayer(rows.slice(0, 1));   // 10/23: 0.72 calibrates to 0.67 < 69c -> cut; the player's 60.5 line (82%, no band) shows
    ok(raw.length === 1 && c.length === 1 && c[0].line === 60.5 && Math.abs(c[0].cal - 0.772) < 1e-9 && c[0].model === 0.82, "props (10/23): with the calibration bands a row must be priced under its calibrated (shown) %; the player's next line shows", JSON.stringify(c)); }
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), h = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  ok(/class="pbl ppr/.test(app) && /pp1[\s\S]*pp2[\s\S]*pp3[\s\S]*pp4/.test(app) && /\.ppr \{ display:grid; grid-template-columns:minmax\(0,3fr\) minmax\(max-content,1fr\)/.test(h) && /onePerPlayer\(picks, bands\)/.test(readFileSync(new URL("../lib/props.js", import.meta.url), "utf8")), "props page rows are columns: player | line | win % | price; the server list and the record use onePerPlayer"); }
// ---------- 10/20 (owner): Polymarket cents are GREEN (money) on the TD rows + head and the props rows + head, both sports
{ const h = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), nh = readFileSync(new URL("../public/nba/index.html", import.meta.url), "utf8"), app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  ok(/\.ppr \.pp4, \.ppr\.pph \.pp4 \{ color:#2e5cff; \}/.test(h) && /class="pp4">\$\{pmLogo\(\)\}POLYMARKET</.test(app) && /\.ppr \.pp4, \.ppr\.pph \.pp4 \{ color:#2e5cff; \}/.test(nh) && !/\.tdr \.pxc \{ color:var\(--blue\)/.test(h) && /src="\/polymarket\.png"/.test(app) && /src="\/polymarket\.png"/.test(readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8")) && !/polymarket\.com\/favicon/.test(app), "Polymarket cents + heads in Polymarket blue, the real logo on both sports (no favicon)"); }
// ---------- 10/18 (owner): tiles over the page photos and the home boxes carry the same 28% white outline as a game-page card (both sports)
{ for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8");
    ok(/html\.lines-on \.panel \.card, html\.lines-on \.panel \.stat \{ background:rgba\(8,8,12,\.8\); border-color:rgba\(255,255,255,\.28\);/.test(h) && /html\.lines-on \.panel \.tile \{ background:rgba\(8,8,12,\.55\); border-color:rgba\(255,255,255,\.28\);/.test(h), `${f}: cards 80% dark, game tiles 55% dark (owner 10/18 evening, sketch D), both with the 28% white outline`);
    ok(/html\.lines-on \.pagewm \{ background:linear-gradient\(rgba\(0,0,0,\.1\),rgba\(0,0,0,\.1\)\),url\(/.test(h) && !/\.tile \.wmk/.test(h), `${f}: the page picture carries only a 10% shade (owner 10/18 evening: "why is it so dark"); no faded-logo rule`);
    ok(/html\.lines-on #models \.fold \{ background:rgba\(8,8,12,\.8\); border:1px solid rgba\(255,255,255,\.28\);/.test(h) && /html\.lines-on #models \.drop\.open \{ background:rgba\(8,8,12,\.8\); border:1px solid rgba\(255,255,255,\.28\); border-top:0;/.test(h), `${f}: Models sections sit on the same 80% dark card as the stat tiles (owner 10/18 night)`);
    ok(/#detail \.card:not\(\.dtop\) \{ background:rgba\(8,8,12,\.55\); border-color:rgba\(255,255,255,\.28\);/.test(h) && (h.match(/#detail \.card:not\(\.dtop\)/g) || []).length === 1 && /\.pagewm::after \{ content:""; position:absolute; inset:0; background:rgba\(0,0,0,\.1\); \}/.test(h), `${f}: game-page cards 55% dark see-through like the tiles, the game backdrop only a 10% shade (owner 10/18 night)`);
    ok(/#detail \.card:not\(\.dtop\) \{ background:rgba\(8,8,12,\.55\); border-color:rgba\(255,255,255,\.28\);/.test(h), `${f}: game-page cards are 55% dark see-through like the tiles (owner 10/18 night)`); }
}
// ---------- 10/18 (owner): Game Lines tiles look like the game page's header card -- team colours, big logos, % in the middle, no date / time / starts-in
{ for (const f of ["../public/app.js", "../public/nba/app.js"]) { const a = readFileSync(new URL(f, import.meta.url), "utf8"), t = a.slice(a.indexOf("function tile(g)"), a.indexOf("\n}", a.indexOf("function tile(g)")));
    ok(!/style="background:linear-gradient/.test(t) && !/class="wmk/.test(t) && !/const ca = /.test(t) && /class="tmid">\$\{mid2?\}/.test(t) && (f.includes("nba") ? /\$\{tlogo\(g\.away\)\}\$\{g\.away\}/ : /\$\{thelmet\(g\.away, "right"\)\}\$\{g\.away\}.*\$\{g\.home\}\$\{thelmet\(g\.home, "left"\)\}/).test(t) && !/const foot/.test(t) && !/class="ft"/.test(t) && /class="chip tmt">\$\{esc\((tm\(g\.kickoff\)|tipTime\(g\.start\))\)\}/.test(t),
      `${f}: tile = plain card (no team colours, no faded logos -- owner 10/18 evening, sketch D), logo (NFL: helmet on the outer side of the name, facing the middle, owner 10/28) + code + record each side, the % in the middle with the time + tag under it, no foot row`); }
  for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8");
    ok(/\.tile \.t \{ font-size:24px/.test(h) && /\.tile \.tmid \{ text-align:center/.test(h), `${f}: tile names at the game-page size`); } }
// ---------- 10/18 night (owner): no NEXT GAME strip anywhere but home; line moves inside the tile; slot headers with a dark edge; bigger page titles
{ for (const f of ["../public/app.js", "../public/nba/app.js"]) { const a = readFileSync(new URL(f, import.meta.url), "utf8"), t = a.slice(a.indexOf("function tile(g)"), a.indexOf("\n}", a.indexOf("function tile(g)")));
    ok(!/changedBox/.test(a) && !/LINE MOVES/.test(a.replace(/^\s*\/\/.*$/gm, "")) && /function moveBits\(g\)/.test(a) && /\$\{moveLines\(moveBits\(g\)\)\}<\/div>/.test(t), `${f}: the LINE MOVES strip is gone; a game's move sits inside its tile`); }
  for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8");
    ok(!/\.moves \{|\.mvl \{|\.mvs \{/.test(h) && /\.tile \.tmid \.mvt \{ font-size:11px/.test(h) && /\.labslot \{[^}]*text-shadow:0 1px 2px rgba\(0,0,0,\.95\)/.test(h) && /\.phead \.pt b \{ font-size:40px/.test(h), `${f}: strip styles gone, tile move lines, slot headers with a dark edge, 40px page titles (10/21 night), no line under them`); }
  const css = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8"); ok(!/\.snext/.test(css), "shell.css: no next-game header styles left");
  for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8"); ok(/id="panel-lines"><div class="phead"><div class="pt"><b>Game Lines<\/b>/.test(h) && /body\.game-on #panel-lines \.phead \{ display:none; \}/.test(h), `${f}: Game Lines has its page title, hidden on a game page`); } }
// ---------- 10/18 (owner): game page = the game card is the header, ← Games under it; slot / day headers carry no times
{ for (const f of ["../public/app.js", "../public/nba/app.js"]) { const a = readFileSync(new URL(f, import.meta.url), "utf8");
    ok(/document\.body\.classList\.add\("game-on"\)/.test(a) && /\$\{typeof Shell !== "undefined" && Shell\.chartBlock \? detailTop\(g\)\.replace\('class="card dtop"', 'class="card dtop dblend"'\) \+ Shell\.chartBlock\(co\) : detailTop\(g\)\}<button class="back" id="back-btn">← Games<\/button>/.test(a) && /classList\.toggle\("game-on", name === "lines" && !!DETAIL\)/.test(a) && /classList\.remove\("game-on"\)/.test(a) && !/linesBySlot[\s\S]{0,1200}class="lst">· \$\{times/.test(a),
      `${f}: our team card on top of the chart (blended, no title), ← Games under it, header hidden only on a game page; Game Lines slot headers without the times list`); } }
// ---------- 10/20 review: a bet's week = the week of its games (a combo on Thursday's NE @ CHI placed during Monday night's week-6 game was filed under week 6)
{ const { gameWeekOf } = await import("../lib/placed.js");
  const rows = [{ key: "WAS @ SF", week: 6 }, { key: "NE @ CHI", week: 7 }, { key: "DAL @ PHI", week: 7 }, { key: "PHI @ DAL", week: 15 }, { key: "KC @ DEN", week: 2 }, { key: "KC @ DEN", week: 12 }];
  ok(gameWeekOf(["NE @ CHI"], rows, 6) === 7 && gameWeekOf(["WAS @ SF"], rows, 6) === 6 && gameWeekOf(["WAS @ SF", "NE @ CHI"], rows, 6) === 7 && gameWeekOf(["KC @ DEN"], rows, 10) === 12 && gameWeekOf(["KC @ DEN"], rows, 1) === 2
    && gameWeekOf(["XXX @ YYY"], rows, 6) === null && gameWeekOf([], rows, 6) === null && gameWeekOf([null, "NE @ CHI"], rows, 6) === 7,
    "bets (10/20): a bet's week = the week of its games (earliest scheduled on or after placement, latest across legs); unknown game -> placement week stays");
  ok(/const gw = gameWeekOf\(/.test(readFileSync(new URL("../lib/mybets.js", import.meta.url), "utf8")), "account bets use the game week"); }
// ---------- 10/20 (owner: "build all 8"): same-game SPREAD + TOTAL parlay (the owner's style without the TD legs); TD JUMP shadow; First TD box
{ const { sameGameParlays, STAKES } = await import("../lib/sgp.js");
  const g = { key: "A @ B", away: "A", home: "B", poly: { ml: { home: 0.6, away: 0.42 }, total: { line: 44.5, over: 0.5, under: 0.5 }, spread: { homeSpread: -3.5, home: 0.5, away: 0.5 } }, td: [],
    card: { spread: { plain: { pick: "B -3.5", team: "B", line: -3.5, hit: 50.6, price: 0.5, kind: "spread" } }, total: { plain: { pick: "Under 44.5", side: "under", line: 44.5, hit: 51.7, price: 0.5, kind: "total" } } } };
  const x = sameGameParlays(g);
  ok(x && x.st && x.st.strategy === "sgp_st" && x.st.legs.length === 2 && x.st.legs[0].label === "B -3.5" && x.st.legs[1].label === "Under 44.5" && x.st.stake === 10 && STAKES.sgp_st === 10 && Math.abs(x.st.prob - 0.506 * 0.517) < 0.02,
    "same game · spread + total: the card's two PICKs at Polymarket's lines, $10, chance = the product (independent legs)", x && x.st);
  const y = sameGameParlays({ ...g, card: { spread: g.card.spread } }); ok(y && !y.st, "no total PICK -> no spread + total parlay");
  const sg = readFileSync(new URL("../lib/sgp.js", import.meta.url), "utf8"), ap = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  ok(/g\.sgp\.three, g\.sgp\.st\]/.test(sg) && /\["Spread \+ total", x\.st\]/.test(ap) && /st: \(g\) => g\.sgp\.st/.test(ap) && /\["sgp_st", "Spread \+ total"\]/.test(ap), "spread + total is saved per game, shown on the game page, the Model bets tab and the scoreboard");
  const tr = await import("../lib/tracked.js"), R = globalThis.__TEST_REDIS__;
  const prev = { away: [{ name: "X.Back", fair: 22 }, { name: "Y.Wide", fair: 30 }], home: [{ name: "Z.End", fair: 10 }] }, next = { away: [{ name: "X.Back", fair: 41 }, { name: "Y.Wide", fair: 36 }], home: [{ name: "Z.End", fair: 24 }] };
  const n1 = await tr.recordTdJump(2099, 1, { key: "A @ B", away: "A", home: "B" }, prev, next, "2099-01-01T00:00:00Z"), n2 = await tr.recordTdJump(2099, 1, { key: "A @ B", away: "A", home: "B" }, prev, next, "2099-01-01T01:00:00Z");
  ok(n1 === 1 && n2 === 0, "TD JUMP: only a rise of 10+ points to 25%+ is recorded (X.Back 22 -> 41; Y.Wide +6 and Z.End 24% are not), once per player", { n1, n2 });
  await tr.gradeTdJumps(2099, 1, { key: "A @ B" }, [{ player: "X.Back", team: "A", scored: true }]);
  const row = JSON.parse(await R.hget(tr.tkey(2099, 1), "A @ B|tdjump|X.Back")); ok(row.result === "W" && row.prevFair === 22 && row.fair === 41, "TD JUMP graded from the game's TD list", row);
  { // 10/26: a jumped player who dropped off the kickoff TD list is decided by the outcome callback (no snap = push, snap = scored or not); undecided stays pending
    await R.hset(tr.tkey(2099, 1), "A @ B|tdjump|Off.List", JSON.stringify({ game: "A @ B", week: 1, kind: "td", tdjump: true, player: "Off.List", team: "A", fair: 37, prevFair: 18 }));
    await R.hset(tr.tkey(2099, 1), "A @ B|tdjump|Wait.Snap", JSON.stringify({ game: "A @ B", week: 1, kind: "td", tdjump: true, player: "Wait.Snap", team: "A", fair: 30, prevFair: 15 }));
    const n = await tr.gradeTdJumps(2099, 1, { key: "A @ B" }, [{ player: "X.Back", team: "A", scored: true }], async (leg) => leg.player === "Off.List" ? "P" : null);
    const a = JSON.parse(await R.hget(tr.tkey(2099, 1), "A @ B|tdjump|Off.List")), b = JSON.parse(await R.hget(tr.tkey(2099, 1), "A @ B|tdjump|Wait.Snap"));
    const gs = readFileSync(new URL("../lib/grade.js", import.meta.url), "utf8");
    ok(n === 1 && a.result === "P" && !b.result && /jumpOutcome\(season, week, g, snaps\), jumps\)/.test(gs), "TD JUMP (10/26): a player off the kickoff list is graded from snaps + scorers (no snap = push), later passes finish pending rows", { a, b }); }
  await R.del(tr.tkey(2099, 1));
  ok(!/FIRST TD · TEAM MODEL/.test(ap) && !/firstBox/.test(ap) && !/FTD_OPEN/.test(ap) && /TD JUMP \(shadow\)/.test(ap), "Anytime TD page: NO First TD box (owner 10/20 night: it lives on the First TD tab only); Models: TD JUMP row");
  // 10/20 (owner): the FIRST TD TEAM MODEL -- which team scores first from the spread, each player = his team's chance x his share of the team
  { const { teamFirstChance, firstTdShares, FTD_COEF, FTD_NONE } = await import("../lib/calibration.js");
    const pk = teamFirstChance(0), fav = teamFirstChance(-7), dog = teamFirstChance(7);
    ok(pk && near(pk.home + pk.away, 1 - FTD_NONE, 1e-9) && pk.home > pk.away && fav.home > pk.home && near(fav.home, (1 - FTD_NONE) / (1 + Math.exp(-(FTD_COEF.a + FTD_COEF.b * 7))), 1e-9) && dog.away > pk.away && dog.away < fav.home && teamFirstChance(null) === null,
      "first TD team model: home edge at a pick'em (52.1 / 47.3), a 7-point home favorite 62.7%, a 7-point road favorite less than that (home field), no chance without a spread", { pk, fav, dog });
    const pool = [{ name: "A", team: "H", fair: 50 }, { name: "B", team: "H", fair: 30 }, { name: "C", team: "V", fair: 40 }], tp = { H: 0.6, V: 0.394 };
    const sh = firstTdShares(pool, tp), lam = (f) => -Math.log(1 - f / 100), sumH = lam(50) + lam(30) + 0.4;
    ok(near(sh[0], 60 * lam(50) / sumH, 1e-9) && near(sh[1], 60 * lam(30) / sumH, 1e-9) && near(sh[2], 39.4 * lam(40) / (lam(40) + 0.4), 1e-9) && sh[0] + sh[1] < 60 && sh[2] < 39.4 && firstTdShares(pool).length === 3,
      "first TD shares with the team model: a team's listed players never add past the team's chance (0.4 of a TD per team unlisted); without team chances the old whole-game share", sh);
    const gr = readFileSync(new URL("../lib/grade.js", import.meta.url), "utf8"), wk = readFileSync(new URL("../lib/week.js", import.meta.url), "utf8");
    ok(/firstTdShares\(pool, teamP\)/.test(gr) && /rec\.ftdTeam = \{ away:/.test(gr) && /gradeTdInto\(rec, season, week, g, model, snaps, injuries, hs\)/.test(gr) && /firstTdShares\(pool, teamP\)/.test(wk) && /g\.ftdTeam = \{ away:/.test(wk) && /ftdTeam: g\.ftdTeam \|\| null/.test(wk),
      "first TD: the page and the grader use the same team split (closing spread), the game carries the team chances, the result keeps which team scored first");
    ok(/function firstTdGames\(\)/.test(ap) && !/data-ftd-toggle/.test(ap) && !/class="ftdteams"/.test(ap) && /const head = "";/.test(ap) && /First TD team \(likelier side\)/.test(ap) && /TEAM RECORD/.test(ap),
      "First TD tab: per game the two teams' chances (purple) + each team's three likeliest; no toggle box; Models + the First TD tab show the team record"); }
  // 10/20 (owner): labeled MODEL / POLYMARKET columns, rows split by team; the model % stays PURPLE (owner: "keep all model purple") -- both sports
  { const nb = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
    ok(/const tdHead = \(\) =>/.test(ap), "Anytime TD: labeled column heads");
    ok(/<span class="pp3 mod">\$\{tdPct\(r\.fair\)\}%<\/span>/.test(ap) && !/clsOf\(r\.fair\)/.test(ap) && !/clsOf\(r\.first\)/.test(ap) && /class="pp4">\$\{r\.price != null/.test(ap) && /best\.map\(\(x\) => tdRow\(x, true\)\)/.test(ap), "Anytime TD: the model % is plain purple (no win-rate colors), Best TD picks use the same one-line row with the Polymarket price at the far right");
    for (const [f, a] of [["NFL", ap], ["NBA", nb]]) ok(/<span class="pp1">PLAYER<\/span><span class="pp2">LINE<\/span>[\s\S]{0,40}<span class="pp5">LAST(?: WK)?<\/span>[\s\S]{0,6}<span class="pp3">MODEL<\/span><span class="pp4">\$\{pmLogo\(\)\}POLYMARKET<\/span>/.test(a) && /class="pbl pteam">\$\{tlogo\(t\)\}\$\{esc\(t\)\}<\/div>/.test(a) && /class="pp3 mod">/.test(a) && !/pp3 \$\{clsOf/.test(a), `${f} Player props: PLAYER / LINE / MODEL / POLYMARKET header, rows split by team, the logo beside the team label only (owner 10/28), the model % purple`);
    for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8"); ok(/\.ppr\.pph span \{ font-size:8\.5px/.test(h) && /\.pbl\.pteam \{ display:flex/.test(h) && !/\.ftdbox/.test(h) && !/\.tdr \.mp em\.g/.test(h) && /\.ppr \.pp3\.mod \{ color:var\(--violet\)/.test(h) && !/\.ftdteams|\.ftdg/.test(h), `${f}: column head, team label, no First TD box styles, model % purple`); }
    ok(!/PROP_LABEL/.test(readFileSync(new URL("../lib/props.js", import.meta.url), "utf8")) && !/BUY_OPEN/.test(readFileSync(new URL("../lib/stack.js", import.meta.url), "utf8")) && !/pct1/.test(readFileSync(new URL("../nba/lib/odds.js", import.meta.url), "utf8")) && !/NBA_STAT_LABEL/.test(readFileSync(new URL("../nba/lib/props.js", import.meta.url), "utf8")), "cleanup 10/20: unused names removed (PROP_LABEL, BUY_OPEN, pct1, NBA_STAT_LABEL)"); } }
// ---------- 10/20 night (owner): props of a game being played say LIVE, stay locked (never re-scored once started) and are graded at the final -- both sports
{ const apx = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), nbx = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8");
  ok(/g\.started && !g\.final \? ' <span class="lvb">● LIVE<\/span>'/.test(apx) && /Date\.parse\(g\.start\) <= Date\.now\(\) \? ' <span class="lvb">● LIVE<\/span>'/.test(nbx), "props LIVE mark on a started, unfinished game's block, both sports");
  ok(/games = all\.filter\(\(g\) => !started\(g\)\)/.test(readFileSync(new URL("../pages/api/rerun.js", import.meta.url), "utf8")) && /Date\.parse\(g\.start\) > now/.test(readFileSync(new URL("../nba/lib/props.js", import.meta.url), "utf8")), "props lock: the NFL rerun scores only games not started; NBA scores only games not tipped (the last copy before the start is the graded one)");
  ok(/started: !!g\.started/.test(readFileSync(new URL("../lib/props.js", import.meta.url), "utf8")) && /gradePropsWeek/.test(readFileSync(new URL("../lib/grade.js", import.meta.url), "utf8")), "props: the page knows a started game; the week's grading grades the props"); }
// ---------- 10/20: first-TD prices from Polymarket US ride in the TD price map and never count as anytime prices
{ const { toGamma } = await import("../lib/polyus.js"), pk = await import("../lib/picks.js");
  const q = (v) => ({ value: String(v) }), side = (d, long) => ({ description: d, long, team: { abbreviation: "chi" } });
  const m = toGamma({ slug: "astatc-nfl-ne-chi-2026-10-22-firsttd-abro", sportsMarketType: "football_player_first_touchdown", title: "A.J. Brown scores the first touchdown", titleShort: "A.J. Brown", bestAskQuote: q(0.09), bestBidQuote: q(0.05), marketSides: [side("Yes", true), side("No", false)] });
  ok(m && m.sportsMarketType === "first_touchdown" && m.question === "A.J. Brown first touchdown" && Math.abs(m.bestAsk - 0.09) < 1e-9, "polyus: a first-TD market becomes '<name> first touchdown'", m);
  const rows = pk.tdRows("NE @ CHI", "NE", "CHI", { away: [], home: [{ name: "A.J. Brown", pos: "WR", fair: 30, first: 9 }] }, { "A.J. Brown 1+ touchdowns": { ask: 0.33, bid: 0.3 }, "A.J. Brown first touchdown": { ask: 0.09, bid: 0.05, first: true } }, { home: [], away: [] });
  ok(rows.length === 1 && Math.abs(rows[0].price - 0.33) < 1e-9, "the anytime price matcher ignores the first-TD entry (A.J. Brown 33c, not 9c)", rows[0] && rows[0].price);
  ok(/first touchdown\$\/i\.test\(q\)/.test(readFileSync(new URL("../lib/week.js", import.meta.url), "utf8")) && /firstPrice/.test(readFileSync(new URL("../public/app.js", import.meta.url), "utf8")), "the slate attaches firstPrice; the First TD box shows it"); }
{ // 10/26 (owner: "a reason why by all factors ... why it chose this or why it doesn't choose this"): the per-game facts on top of the MODEL ⓘ box (lib/why.js)
  const { gameWhy, ptTime } = await import("../lib/why.js");
  const g = { home: "CHI", away: "NE", poly: { ml: { home: 0.62, away: 0.40 } } };
  const card = { spread: { plain: { team: "CHI", pick: "CHI -2.5", hit: 63.9, ruleId: "teammodel|spread", why: "TEAM MODEL: CHI · 58.4% sure · line moved 1+ against it" } }, total: { plain: { side: "under", pick: "Under 44.5", hit: 51.7, ruleId: "model|total" } }, ml: { plain: { pick: "CHI ML", hit: 69.7, ruleId: "stackml|ml" } } };
  const combos = [{ id: "teammodel|spread", kind: "spread", team: "CHI", pick: "CHI -2.5", hit: 63.9, why: "TEAM MODEL: CHI · 58.4% sure · line moved 1+ against it", mv: "against" }, { id: "bounceback|spread", kind: "spread", team: "NE", pick: "NE +2.5", hit: 61.3, why: "BOUNCE BACK: NE missed the spread by 26 last game" }];
  const W = gameWhy({ g, card, combos, teamSide: { team: "CHI", pct: 58.4 }, stackSide: { team: "CHI", confident: false, yv: 2 }, mar: 1.2, tot: 41.8, hs: -2.5, tl: 44.5, hsOpen: -3.5, tlOpen: 45.5, openAt: "2026-10-20T14:05:00Z",
    hist: [{ t: "2026-10-20T14:05:00Z", poly: { spread: { homeSpread: -3.5 }, total: { line: 45.5 } } }, { t: "2026-10-23T20:10:00Z", poly: { spread: { homeSpread: -2.5 }, total: { line: 44.5 } } }], bk: { spread: { homeSpread: -3 }, total: { line: 44.5 } }, bkAt: "2026-10-24T14:00:00Z",
    sit: { home: { inj: { qb: 0, ol: 0, db: 0 }, prevAts: 3 }, away: { inj: { qb: 1, ol: 0, db: 0 }, injPrev: { qb: 1, ol: 0, db: 0 }, prevAts: -26, prevPts: 3 } },
    inj: [{ team: "NE", name: "Drake Maye", pos: "QB", status: "Out", src: "espn", at: "2026-10-23T20:10:00Z", note: "Maye (ankle) was ruled out for Sunday's game." }], qb: { NE: "QB change: Drake Maye Out" },
    td: { home: [{ fair: 55 }, { fair: 40 }], away: [{ fair: 30 }] }, xf: { homeRest: 7, awayRest: 7 }, wx: { outdoor: true, wind: 14, temp: 48 }, week: 8, mvT: { move: 0.6, thr20: 1.1, thr10: 1.6 } });
  const sp = W.spread, tt = W.total, txt = JSON.stringify(W), find = (xs, k) => xs.find((x) => x[0] === k);
  ok(sp[0][0] === "Pick:" && /CHI -2\.5 · 63\.9% · TEAM MODEL rule — TEAM MODEL: CHI/.test(sp[0][1]) && sp[0][2] === 1, "reason box: the PICK line first, with its rule and the rule's own words", sp[0]);
  ok(sp.some(([k, t, s]) => /BOUNCE BACK/.test(k) && /also fired: NE \+2\.5 61\.3%/.test(t) && /the other side/.test(t) && s === -1), "reason box: a rule that fired on the other side is listed against the pick");
  ok(/opened CHI -3\.5 \(Tue .*AM\) → now -2\.5: moved 1 toward NE, last move Fri .*PM · CHI gets 1 point vs the opener/.test(find(sp, "Line:")[1]) && find(sp, "Line:")[2] === 1, "reason box: the line's move with its opening and last-move times (Pacific) and who gained", find(sp, "Line:"));
  ok(/CHI -3 \(pulled Sat .*AM\) vs Polymarket -2\.5 · the books lean CHI by 0\.5 \(under 1 point, no LINE MOVE\)/.test(find(sp, "Sportsbooks:")[1]) && find(sp, "Sportsbooks:")[2] === 1, "reason box: the books vs Polymarket and why LINE MOVE does not fire", find(sp, "Sportsbooks:"));
  ok(/^CHI by 1\.2 · vs the line it leans NE by 1\.3/.test(find(sp, "Game model:")[1]) && find(sp, "Game model:")[2] === -1, "reason box: the game model's lean vs the line, marked against the pick", find(sp, "Game model:"));
  ok(/^CHI 58\.4% sure$/.test(find(sp, "Team model:")[1]) && /^CHI · not confident/.test(find(sp, "Stack model:")[1]), "reason box: the team and Stack model lines");
  ok(/^starting QB out · D\.Maye QB Out \(ESPN Fri .*PM: “Maye \(ankle\) was ruled out for Sunday’s game\.”\)$/.test(find(sp, "NE injuries:")[1].replace("'", "’")) && find(sp, "NE injuries:")[2] === 1, "reason box: ESPN's own sentence with its date, marked for the pick (the hurt team is the opponent)", find(sp, "NE injuries:"));
  ok(/does not fire: the injury is not new/.test(find(sp, "INJURY rule:")[1]), "reason box: why INJURY did not fire (a continuing injury)");
  ok(/QB change: Drake Maye Out/.test(find(sp, "NE:")[1]) && find(sp, "NE:")[2] === 1 && /missed the spread by 26, scored 3/.test(find(sp, "NE last game:")[1]) && /wind 14 mph, 48°F/.test(find(sp, "Weather:")[1]) && /expects CHI 1\.0 TDs, NE 0\.3/.test(find(sp, "TD model:")[1]) && !find(sp, "Rest:"), "reason box: QB change, last game, weather, TD team totals; no Rest line on equal rest");
  ok(W.ml[0][0] === "ML pick:" && /^CHI ML · 69\.7% · the Stack model backs the favorite, priced 61¢/.test(W.ml[0][1]) && W.ml[0][2] === 1, "reason box: the ML pick with its band", W.ml[0]);
  ok(/^Under 44\.5 · 51\.7% · the game model.s side \(no tested rule fired\)$/.test(tt[0][1]) && /opened 45\.5 \(Tue .*\) → now 44\.5: down 1, last move Fri .* · a worse number for the Under/.test(find(tt, "Total:")[1]) && find(tt, "Total:")[2] === -1
    && /^44\.5 \(pulled .*\) vs Polymarket 44\.5 · the same number$/.test(find(tt, "Sportsbooks:")[1]) && /^41\.8 vs 44\.5 → leans Under by 2\.7/.test(find(tt, "Game model:")[1]) && find(tt, "Game model:")[2] === 1
    && /expects the total to rise 0\.6 from its opener · the total already left its opening number, so TOTAL MOVE cannot fire/.test(find(tt, "Move model:")[1]) && find(tt, "Move model:")[2] === -1
    && /wind 14 mph outdoors/.test(find(tt, "Weather:")[1]) && find(tt, "Weather:")[2] === 1 && find(tt, "NE:")[1] === "starting QB out" && /expects 1\.3 touchdowns in all/.test(find(tt, "TD model:")[1]), "reason box: the total's lines (the move, the books, the model, the move model's why-not, wind and a QB out for the Under)", tt);
  ok(!/undefined|NaN|null/.test(txt), "reason box: no undefined / NaN in any line", txt.match(/.{30}(undefined|NaN|null).{30}/g));
  const W2 = gameWhy({ g, card: { spread: { plain: { team: "NE", pick: "NE +2.5", hit: 52.8, ruleId: "stack|spread" } } }, combos: [], teamSide: { team: "CHI", pct: 59 }, stackSide: { team: "NE", yv: 2 }, hs: -2.5, hsOpen: -1.5, hist: [], inj: [], sit: { home: { inj: { qb: 0, ol: 0, db: 0 } }, away: { inj: { qb: 1, ol: 0, db: 0 } } }, week: 8 });
  ok(/^CHI 59% sure · 58%\+ but the line moved 1\+ toward it since the week’s first line \(51\.7% there\), so it does not fire$/.test(find(W2.spread, "Team model:")[1].replace("'", "’")) && find(W2.spread, "Team model:")[2] === -1, "reason box: TEAM MODEL at 58%+ that does not fire because the line already moved its way", find(W2.spread, "Team model:"));
  ok(/^none: the Stack model backs NE, the underdog/.test(W2.ml[0][1]) && /does not fire: the line already moved 1 toward CHI/.test(find(W2.spread, "INJURY rule:")[1]) && /^NE \+2\.5 · 52\.8% · the Stack model’s side \(no tested rule fired\)$/.test(W2.spread[0][1].replace("'", "’")), "reason box: the ML why-not (Stack on the underdog), INJURY why-not (line moved), the Stack fallback wording", [W2.ml[0], find(W2.spread, "INJURY rule:")]);
  const W3 = gameWhy({ g, card: null, combos: [], teamSide: { team: "CHI", pct: 55.1 }, stackSide: null, hs: -2.5, hsOpen: -2.5, hist: [], inj: [], sit: {}, week: 8 });
  ok(/none yet on this line/.test(W3.spread[0][1]) && /under 58% sure, not a pick/.test(find(W3.spread, "Team model:")[1]) && find(W3.spread, "Team model:")[2] === 0 && /unchanged since the week’s first Polymarket line/.test(find(W3.spread, "Line:")[1].replace("'", "’")) && /^none: no Stack line yet \(CHI is the favorite at 61¢\)/.test(W3.ml[0][1]), "reason box: no card -> neutral marks, TEAM MODEL under 58%, unchanged line, no Stack line", W3.spread);
  ok(gameWhy(null) === null && gameWhy({ g: { home: "A", away: "B" } }).spread.length === 0 && /^(Fri|Sat) \d/.test(ptTime("2026-10-23T20:10:00Z")), "reason box: no inputs -> no lines; times in Pacific");
  // the page: the game's lines sit on top of the MODEL ⓘ box with their marks, then the glossary; a game without them shows the glossary alone (both sports)
  const ap = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), na = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8"), wk = readFileSync(new URL("../lib/week.js", import.meta.url), "utf8"), ns = readFileSync(new URL("../nba/lib/slate.js", import.meta.url), "utf8"), sc = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8");
  ok(/\$\{whyBox\(g, "spread", MODEL_INFO\.spread\)\}/.test(ap) && /\$\{whyBox\(g, "total", MODEL_INFO\.total\)\}/.test(ap) && /\$\{whyBox\(g, kind, info\)\}\$\{modelCell\(g, kind\)\}/.test(na) && /THIS GAME · \+ for the pick · − against/.test(ap) && /THIS GAME · \+ for the pick · − against/.test(na)
    && /\.ibox \.wm\.wf \{ color:var\(--green\); \} \.ibox \.wm\.wa \{ color:var\(--red\); \}/.test(sc) && /G\.why = gameWhy\(/.test(wk) && /row\.why = row\.card && !row\.inProgress \? gameWhy\(/.test(ns) && /if \(e\.comment\) row\.note = /.test(wk), "reason box: wired on both game cards (NFL spread + total, NBA every card), the slates build it, ESPN's note and date ride on the injury row");
}
{ // 10/26 recheck: an ESPN status labels a TD row only when it was posted after the team's previous game (+6 h) -- the Monday-night inactives were tagging next week's rows
  const { espnFreshFor, espnOutFor } = await import("../lib/espn.js");
  const rows = [{ home: "PHI", away: "DAL", kickoff: "2026-10-27T00:15:00Z" }, { home: "WAS", away: "PHI", kickoff: "2026-11-02T01:20:00Z" }];
  const note = { status: "Out", date: "2026-10-26T22:45:00Z" };
  ok(espnFreshFor(note, "PHI", "2026-11-02T01:20:00Z", rows) === false && espnFreshFor(note, "PHI", "2026-10-27T00:15:00Z", rows) === true && espnFreshFor({ status: "Out" }, "PHI", "2026-11-02T01:20:00Z", rows) === true
    && espnOutFor(note, "PHI", "2026-11-02T01:20:00Z", rows, Date.parse("2026-10-27T00:00:00Z")) === false && /espnFreshFor\(e, r\.team, g\.kickoff, seasonRows\)\) r\.espn = /.test(readFileSync(new URL("../lib/week.js", import.meta.url), "utf8")),
    "ESPN status dates (10/26): a note posted before the team's previous game neither labels nor removes next week's row; an undated note still counts; the TD rows use it");
  // the NFL main total is never a one-sided stub (0.99 / 0.49)
  const { parseGame } = await import("../lib/poly.js");
  const src = readFileSync(new URL("../lib/poly.js", import.meta.url), "utf8");
  ok(/if \(!t\.prices\.every\(\(p\) => p > 0\.1 && p < 0\.9\)\) continue;/.test(src) && typeof parseGame === "function", "NFL Polymarket parser (10/26): a one-sided placeholder total is never the main total");
}
{ // 10/22 (owner): ONE ⓘ per model section, both sports -- game card MODEL header + Models Card picks / Tracked angles (NBA: Card picks / Shadow trackers); white labels
  const ap = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), nb = readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8"), sj = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), sc = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8");
  const uses = (x) => (x.match(/\$\{IBTN\}/g) || []).length;
  ok(uses(ap) === 4 && uses(nb) === 3 && (ap.match(/<div class="hd hm ihd">MODEL\$\{IBTN\}<\/div>\$\{whyBox\(g, "(spread|total)", MODEL_INFO\.(spread|total)\)\}/g) || []).length === 2 && /<div class="hd hm ihd">MODEL\$\{IBTN\}<\/div>\$\{whyBox\(g, kind, info\)\}/.test(nb)
    && /Card picks<\/b>\$\{IBTN\}/.test(ap) && /Tracked angles\$\{IBTN\}/.test(ap) && /Card picks<\/b>\$\{IBTN\}/.test(nb) && /Shadow trackers<\/b>\$\{IBTN\}/.test(nb)
    && /closest\("\.ibtn"\)/.test(sj) && /\.ibox\[hidden\] \{ display:none; \}/.test(sc) && /\.lbw \{ color:#fff; font-weight:400; \}/.test(sc) && /\.modelcell b \{ text-transform:uppercase; \}/.test(sc) && /\.modelcell b \{ font-size:13px !important; \}/.test(sc) && /\.modelcell > \.s:has\(> \.lbw\), \.modelcell \.lbw \{ font-size:13px; \}/.test(sc)
    && !/<span class="lbw">/.test(ap.replace(/<span class="lbw">(Model:|Model \(Team\):|Model \(Stack\):|Pick:|Pick w\/ points:|ML pick:)<\/span>/g, "")) && /<span class="lbw">Pick w\/ points:<\/span>/.test(nb) && /\.lbw \{ color:#fff; font-weight:400; \}/.test(sc),
    "info buttons (10/22): one ⓘ on each game card's MODEL header (NFL spread + total, NBA every card) and the Models Card picks / tracked rows, a tap opens the box under it; the card labels are white");
}
{ // 10/21 (owner): menu see-through like the Game Lines tiles; every red -> green gradient is red -> dark red (SLATEZZ, refresh ring, grip, menu lines, home clock)
  const css = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8");
  ok(/\.tbar \{[^}]*background:#0b0b10; border-bottom:1px solid rgba\(255,255,255,\.07\);/.test(css.replace(/\n/g, " ")) && /body\.tbar-on:not\(\.game-on\) \.tbar \{ display:flex; \}/.test(css) && /classList\.toggle\("tbar-on", panel === "lines"\)/.test(readFileSync(new URL("../public/shell.js", import.meta.url), "utf8")) && /\.bnav \{[^}]*background:rgba\(8,8,12,\.8\)/.test(css.replace(/\n/g, " ")) && !/#3ddc97/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "bars (10/27): a slim plain top bar (SLATEZZ + the bell) on Home only, not on a game page; the bottom bar dark; no red -> green left"); }
{ // 10/21 night (owner): no white line under page titles, titles 40px, every page drop-down on the right of the title (Shell.dd slot)
  const sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8");
  const okApp = (f) => { const a = readFileSync(new URL(f, import.meta.url), "utf8"); return /function ddSlot\(el, html\)/.test(a) && (a.match(/ddSlot\(/g) || []).length >= 4 && /set\("dd-record-mine", !m\); set\("dd-lab", m\);/.test(a); };
  ok(/dd\(el, html\) \{/.test(sh) && /slot\.className = "pdd"; slot\.id = "dd-" \+ el\.id; head\.appendChild\(slot\)/.test(sh) && okApp("../public/app.js") && okApp("../public/nba/app.js"),
    "headers (10/21 night): the week / day / team drop-downs sit on the right of the page title, one slot per block, hidden with its block; both sports"); }
{ // 10/21 night (owner): no pulsing red on live tiles (only the ● LIVE · quarter line is red); the break between quarters reads "End Q1"
  for (const f of ["../public/index.html", "../public/nba/index.html"]) { const h = readFileSync(new URL(f, import.meta.url), "utf8"); ok(!/livepulse|\.tile\.live \{/.test(h), `${f}: live tiles have no pulsing red outline / glow`); }
  const nl = readFileSync(new URL("../pages/api/nba/live.js", import.meta.url), "utf8"), fl = readFileSync(new URL("../lib/live.js", import.meta.url), "utf8");
  ok(/`End \$\{q\}`/.test(nl) && /\/end of\/i\.test\(det\) && per \? `End \$\{per > 4 \? "OT" : "Q" \+ per\}`/.test(fl), "live labels: 'End Q1' between quarters (NBA clock 0.0 / ESPN 'End of 1st Quarter'), both sports"); }
// ---------- 10/21 night (owner: "Yes build for nfl also ... We need to get these graded and picked"): NFL Player props parlays 6 / 8 / 10 legs
{ const pa = await import("../lib/paper.js"), pr = await import("../lib/props.js");
  const legs = Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, team: "NE", stat: i % 2 ? "rec" : "rec_yds", side: i % 2 ? "over" : "under", line: 40.5 + i, chance: 0.9 - i * 0.02, price: 0.6, game: `G${i % 4} @ H${i % 4}` }));
  const pp = pa.propParlays(legs);
  ok(pp.length === 3 && pp.map((p) => p.strategy).join() === "pp6,pp8,pp10" && pp.every((p) => p.stake === 5) && pp[0].legs.length === 6 && pp[2].legs.length === 10 && pp[0].legs[0].kind === "prop" && pp[0].legs[0].label === "P0 Rec Yds Under 40.5" && pp[0].legs[1].label === "P1 Receptions Over 41.5"
    && Math.abs(pp[0].prob - legs.slice(0, 6).reduce((a, l) => a * l.chance, 1)) < 1e-9 && Math.abs(pp[0].pay - Math.round(Math.pow(1 / 0.6, 6) * 100) / 100) < 1e-9, "NFL prop parlays: 6 / 8 / 10 legs from the strongest rows, $5, chance = product, payout = the prices multiplied", pp.map((p) => [p.strategy, p.legs.length, p.prob, p.pay]));
  ok(pa.propParlays(legs.slice(0, 7)).length === 1 && pa.propParlays([]).length === 0 && pa.propParlays(undefined).length === 0, "NFL prop parlays: none when there are fewer rows than legs");
  ok(pa.buildPaper({ games: [], propLegs: legs }).filter((p) => /^pp/.test(p.strategy)).length === 3 && pa.STRATEGIES.pp6 && pa.STRATEGIES.pp10 && pa.legKind({ kind: "prop" }) === "prop", "NFL prop parlays: saved with the week's paper, named on the scoreboard, counted in the legs review");
  const box = { "aj brown": { rec_yds: 38, rec: 5 } };
  ok(JSON.stringify(pr.gradePropLeg({ player: "A.J. Brown", stat: "rec_yds", side: "under", line: 49.5 }, box)) === JSON.stringify({ actual: 38, result: "W" }) && pr.gradePropLeg({ player: "A.J. Brown", stat: "rec", side: "over", line: 5.5 }, box).result === "L"
    && pr.gradePropLeg({ player: "Nobody Here", stat: "rec_yds", side: "under", line: 20.5 }, box) === null && pr.gradePropLeg({ player: "Nobody Here", stat: "rec_yds", side: "under", line: 20.5 }, box, ["nobody here"]).result === "W"
    && pr.gradePropLeg({ player: "Nobody Here", stat: "rec_yds", side: "under", line: 20.5 }, box, ["someone else"]).result === "P" && pr.gradePropLeg({ player: "x", stat: "rec", side: "over", line: 1.5 }, null) === null,
    "NFL prop parlay legs (10/23 recheck, Polymarket's rule: a player with no snap settles at the last fair price): a player with no touch waits for the snap counts, took a snap = 0 yards, no snap = push; no stats yet = not graded");
  { // the game grading: no-snap = push, no touch before snap counts = wait and graded again later, an old "did not play" row re-checked once
    const R = globalThis.__TEST_REDIS__ || (await import("../lib/redis.js")).getRedis(), rk = pr.K_PROPRES(2026, 99), g = { key: "AA @ BB", final: true };
    await R.set(pr.K_PROPMODEL(2026, 99, g.key), JSON.stringify({ runAt: "x", rows: [{ name: "Has Catch", team: "BB", stat: "rec_yds", line: 30.5, mu: 20, over: 0.25, under: 0.75 }, { name: "No Touch", team: "BB", stat: "rec_yds", line: 20.5, mu: 10, over: 0.2, under: 0.8 }, { name: "Sat Out", team: "AA", stat: "rec_yds", line: 25.5, mu: 12, over: 0.22, under: 0.78 }] }));
    const real = globalThis.fetch; let snaps = undefined;
    globalThis.fetch = async (u) => ({ json: async () => ({ ok: true, games: { "AA @ BB": { "has catch": { rec_yds: 12 } } }, ...(snaps === undefined ? {} : { snaps: { "AA @ BB": snaps } }) }) });
    process.env.MODEL_SERVICE_URL = process.env.MODEL_SERVICE_URL || "http://test";
    const n1 = await pr.gradePropsGame(R, 2026, 99, g), r1 = JSON.parse(await R.hget(rk, g.key));
    snaps = ["has catch", "no touch"]; pr.clearStatCache(); const pr2 = pr;
    const n2 = await pr2.gradePropsGame(R, 2026, 99, g), r2 = JSON.parse(await R.hget(rk, g.key)), n3 = await pr2.gradePropsGame(R, 2026, 99, g);
    // 10/26: corrected stats a day later (Has Catch 12 -> 40 yds, the Under 30.5 now loses): re-graded twice more, 20+ h apart, then never again
    let catchYds = 40; globalThis.fetch = async (u) => ({ json: async () => ({ ok: true, games: { "AA @ BB": { "has catch": { rec_yds: catchYds } } }, snaps: { "AA @ BB": ["has catch", "no touch"] } }) });
    const t0 = Date.now(); pr.clearStatCache();
    const e1 = await pr.gradePropsGame(R, 2026, 99, g, t0 + 5 * 3600e3);
    const c1 = await pr.gradePropsGame(R, 2026, 99, g, t0 + 21 * 3600e3), rc1 = JSON.parse(await R.hget(rk, g.key));
    catchYds = 12; pr.clearStatCache();
    const e2 = await pr.gradePropsGame(R, 2026, 99, g, t0 + 30 * 3600e3);
    const c2 = await pr.gradePropsGame(R, 2026, 99, g, t0 + 42 * 3600e3), rc2 = JSON.parse(await R.hget(rk, g.key));
    catchYds = 99; pr.clearStatCache();
    const c3 = await pr.gradePropsGame(R, 2026, 99, g, t0 + 90 * 3600e3), rc3 = JSON.parse(await R.hget(rk, g.key));
    globalThis.fetch = real;
    const by = (r, nm) => r.picks.find((x) => x.name === nm) || {};
    ok(e1 === 0 && c1 === 3 && rc1.rechecks === 1 && by(rc1, "Has Catch").result === "L" && by(rc1, "Has Catch").actual === 40 && rc1.fixed === 1 && by(rc1, "Sat Out").result === "P"
      && e2 === 0 && c2 === 3 && rc2.rechecks === 2 && by(rc2, "Has Catch").result === "W" && rc2.fixed === 2 && c3 === 0 && by(rc3, "Has Catch").actual === 12 && pr.PROP_RECHECKS === 2,
      "NFL props re-check (10/26): a graded game is re-graded from fresh stats twice more, 20+ h apart (a corrected number flips the row), then never again", { rc1: rc1.picks, rc2, c3 });
    { // the same for a decided prop parlay's legs (10/26): result and money follow the corrected leg
      const pk = "paper:2026:98", legs = [{ kind: "prop", player: "Has Catch", game: "AA @ BB", stat: "rec_yds", side: "under", line: 30.5, price: 0.6, result: "W", actual: 12 }, { kind: "prop", player: "Other Guy", game: "AA @ BB", stat: "rec_yds", side: "under", line: 50.5, price: 0.7, result: "W", actual: 20 }];
      await R.set(pk, JSON.stringify({ parlays: [{ strategy: "pp6", stake: 5, legs, result: "W", ret: 1 }] }));
      globalThis.fetch = async (u) => ({ json: async () => ({ ok: true, games: { "AA @ BB": { "has catch": { rec_yds: 40 }, "other guy": { rec_yds: 20 } } }, snaps: { "AA @ BB": ["has catch", "other guy"] } }) }); pr.clearStatCache();
      await pa.gradePaper(2026, 98, [], async () => null, Date.now()); const q1 = JSON.parse(await R.get(pk)).parlays[0];
      await pa.gradePaper(2026, 98, [], async () => null, Date.now() + 5 * 3600e3); const q2 = JSON.parse(await R.get(pk)).parlays[0];
      globalThis.fetch = real; await R.del(pk);
      ok(q1.result === "L" && q1.ret === -1 && q1.rechecks === 1 && q1.fixed === 1 && q1.legs[0].result === "L" && q1.legs[0].actual === 40 && q2.rechecks === 1,
        "NFL prop parlay re-check (10/26): a decided parlay's prop legs are re-graded from fresh stats (the corrected leg loses the parlay), not again within 20 h", { q1, q2 }); }
    ok(n1 === 3 && r1.wait && by(r1, "Has Catch").result === "W" && by(r1, "No Touch").result === null && by(r1, "Sat Out").result === null
      && n2 === 3 && !r2.wait && r2.snapChecked && by(r2, "No Touch").result === "W" && by(r2, "No Touch").played === true && by(r2, "Sat Out").result === "P" && by(r2, "Sat Out").played === false && n3 === 0,
      "NFL props (10/23 recheck): a player with no touch waits for the snap counts; then took a snap = graded at 0 yards, no snap = push (Polymarket refunds at the last price); a graded game is not touched again until its re-check", { r1: r1.picks, r2: r2.picks, n3 }); }
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), mb = readFileSync(new URL("../pages/api/modelbets.js", import.meta.url), "utf8"), wk = readFileSync(new URL("../lib/week.js", import.meta.url), "utf8"), gp = readFileSync(new URL("../lib/paper.js", import.meta.url), "utf8");
  ok(/\["pp6", "6 Leg"\], \["pp8", "8 Leg"\], \["pp10", "10 Leg"\]\]/.test(app) && /\["pp6", "6 Leg"\], \["pp8", "8 Leg"\], \["pp10", "10 Leg"\]\],/.test(sh) && /pp6: "pp6", pp8: "pp8", pp10: "pp10"/.test(mb) && /S\.propParlays/.test(app) && /propParlays: propParlayList/.test(wk) && /\["PLAYER PROPS", \[\["pp6", "6 legs"\]/.test(app) && /l\.kind === "prop"\) \{ const st = await weekStats/.test(gp),
    "NFL prop parlays: Model bets tabs 6 / 8 / 10 Leg (menu + page), saved weeks grouped, live build on the slate, scoreboard rows, grading wired");
  const fake = { "propmodel:2099:1:A @ B": { rows: [{ name: "X One", stat: "rec_yds", line: 40.5, over: 0.2, under: 0.8 }, { name: "Y Two", stat: "rec_yds", line: 30.5, over: 0.2, under: 0.8 }] }, "props:2099:1:A @ B": { m: { "X One|rec_yds|40.5": [0.25, 0.2, 0.7, 0, 0, 0.25, 0.7, "t"], "Y Two|rec_yds|30.5": [0.35, 0.3, 0.6, 0, 0, 0.35, 0.6, "t"] } } };
  const R = globalThis.__TEST_REDIS__; for (const [k, v] of Object.entries(fake)) await R.set(k, JSON.stringify(v));
  const L = await pr.propLegsForWeek(2099, 1, [{ key: "A @ B", kickoff: new Date(Date.now() + 864e5).toISOString() }, { key: "C @ D", kickoff: new Date(Date.now() - 36e5).toISOString(), started: true }]);
  ok(L.length === 2 && L[0].name === "X One" && L[0].chance === 0.76 && L[0].model === 0.8 && L[0].price === 0.7 && L[1].name === "Y Two" && L[0].game === "A @ B", "NFL prop parlay legs = the page's rows (Under 80% at 70c), strongest first, games not started only", L); }
{ // 10/22 (owner): a fresh start opens on home; 2+ minutes in the background resets to home and reloads; app page switches never reset (same session)
  const sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8");
  ok(/AWAY_MS: 120e3/.test(sh) && /fresh = !ss\.getItem\("slz-live"\)/.test(sh) && /if \(Shell\.homeReset\(\)\) return;/.test(sh) && /location\.replace\(Shell\.home\(\)\)/.test(sh) && /home\(\) \{ return `\$\{URL_\[Shell\.chosen\(\) \|\| "nfl"\]\}#lines`; \}/.test(sh) && /!Shell\.resetting/.test(sh), "home reset: fresh start + 2 minutes away land on home, the build reload does not fight it"); }
{ // 10/23 night: ML PICK = the favorite's moneyline when the Stack model's spread side is that favorite (walk-forward 2022-25: 71.7% of 374 priced 65.7%)
  const cpk = await import("../lib/cardpick.js"), stk = await import("../lib/stack.js");
  const g = (team, conf, yv = 2) => ({ key: "KC @ SEA", away: "KC", home: "SEA", poly: { ml: { home: 0.6, away: 0.42 } }, stackSide: { team, confident: conf, yv, pct: conf ? 56.2 : 52.8 } });
  const a = cpk.mlPart(g("SEA", false)), b = cpk.mlPart({ ...g("SEA", true), poly: { ml: { home: 0.66, away: 0.36 } } }), c = cpk.mlPart(g("KC", false)), d = cpk.mlPart(g("SEA", false, null)), e = cpk.mlPart({ ...g("SEA", false), poly: { ml: { home: 0.8, away: 0.22 } } });
  const pk = cpk.cardPicks({ spread: null, total: null, ml: a });
  ok(a && a.plain.pick === "SEA ML" && a.plain.hit === 67.7 && a.plain.id === "stackml|ml" && a.plain.price === 0.6 && b.plain.hit === 69.7 && c === null && d === null && e === null && pk.length === 1 && pk[0].kind === "ml"
    && stk.gradeStackPick({ kind: "ml", team: "SEA", home: "SEA", line: 0 }, 24, 20) === "W" && stk.gradeStackPick({ kind: "ml", team: "KC", home: "SEA", line: 0 }, 24, 20) === "L" && stk.ruleLabel({ id: "stackml|ml" }) === "ML PICK · STACK on the favorite",
    "ML PICK (10/23 night): the favorite's moneyline only when STACK backs it and the favorite is priced 50-70% (67.7 / 69.7%), never on the underdog, a 70%+ favorite or old STACK yards; saved with the card's picks, graded W / L");
  { // 10/26: ML PICK · TEAM MODEL vs the move -- the team model's side straight up when 58%+ sure and the line moved 1+ against it (a favorite 77.4% of 31, an underdog priced 30-50c 57.1% of 49; under 30c never)
    const tm = (team) => [{ id: "teammodel|spread", kind: "spread", team, pick: `${team} +3.5`, hit: 63.9, mv: "against" }];
    const f = cpk.mlPart(g("KC", false), null, tm("SEA")), dg = cpk.mlPart(g("KC", false), null, tm("KC")), lo = cpk.mlPart({ ...g("KC", false), poly: { ml: { home: 0.78, away: 0.24 } } }, null, tm("KC")), flat = cpk.mlPart(g("KC", false), null, [{ ...tm("KC")[0], mv: "flat" }]), both = cpk.mlPart(g("SEA", false), null, tm("KC"));
    ok(f && f.plain.id === "tmml|ml" && f.plain.pick === "SEA ML" && f.plain.hit === 88.9 && f.plain.n === 18 && dg && dg.plain.pick === "KC ML" && dg.plain.hit === 63.3 && dg.plain.price === 0.42 && lo === null && flat === null
      && both && both.plain.id === "stackml|ml" && both.plain.pick === "SEA ML" && both.also && both.also.id === "tmml|ml" && both.also.team === "KC" && stk.ruleLabel({ id: "tmml|ml" }) === "ML PICK · TEAM MODEL vs the move" && stk.CURRENT_RULES.test("tmml|ml")
      && cpk.cardPicks({ spread: null, total: null, ml: dg })[0].id === "tmml|ml" && /tmml/.test(readFileSync(new URL("../lib/week.js", import.meta.url), "utf8").match(/cardpick\|modelpick\|stackml\|tmml/) || ""),
      "ML PICK · TEAM MODEL vs the move (10/27, C 0.02): the team model's side when the line moved 1+ against it -- a favorite at 88.9%, an underdog priced 30-50c at 63.3%, never under 30c or without the move; two rules on different teams -> the higher win rate shows, the other rides along as `also`; locked and graded like the STACK ML pick", { f, dg, lo, flat, both });
  }
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  ok(/<span class="lbw">ML pick:<\/span>/.test(app) && /g\.lockedPicks && g\.lockedPicks\.ml/.test(app), "the spread card shows the ML pick (locked one with W / L after kickoff)");
  { const { bestLegParlays } = await import("../lib/paper.js");
    const gm = (k, home, team, hit) => ({ key: k, home, away: k.split(" @ ")[0], started: false, final: false, card: { spread: null, total: null, ml: { plain: { id: "stackml|ml", kind: "ml", team, line: 0, pick: `${team} ML`, hit, price: 0.62 } } } });
    const B = bestLegParlays([gm("A @ B", "B", "B", 67.7), gm("C @ D", "D", "D", 69.7)]), b2 = B.find((p) => p.strategy === "best_2");
    ok(b2 && b2.legs.map((l) => l.label).join() === "D ML,B ML" && b2.legs.every((l) => l.kind === "ml" && l.team), "Best Legs (10/23 night): the green ML picks are legs too (team kept, graded like any moneyline leg)", B); }
  { const stk = await import("../lib/stack.js"), cpk = await import("../lib/cardpick.js"), { getRedis } = await import("../lib/redis.js");
    const g = { key: "KC @ SEA", away: "KC", home: "SEA", poly: { ml: { home: 0.6, away: 0.42 } }, stackSide: { team: "SEA", confident: false, yv: 2, pct: 52.8 } };
    const picks = cpk.cardPicks({ spread: null, total: null, ml: cpk.mlPart(g) });
    await stk.recordStack(2099, 7, g, picks, "2099-10-25T20:00:00Z");
    await stk.gradeStackWeek(2099, 7, [{ key: "KC @ SEA", homeScore: 27, awayScore: 20 }]);
    const saved = JSON.parse(await getRedis().hget("stack:2099:7", "KC @ SEA|stackml|ml") || "null");
    ok(saved && saved.pick === "SEA ML" && saved.kind === "ml" && saved.result === "W" && saved.hit === 67.7, "ML pick end to end (10/23 night): saved at kickoff with the card's picks and graded W from the final score", saved);
    { const base = { key: "KC @ SEA", away: "KC", home: "SEA", started: false, final: false, combos: [], poly: { spread: { homeSpread: -2.5, home: 0.52, away: 0.49 }, ml: { home: 0.6, away: 0.42 } } };
      const c1 = cpk.buildCard({ ...base, stackSide: { team: "SEA", confident: false, yv: 2, pct: 52.8, n: 608 } }, [], base.poly, null, {});
      const c2 = cpk.buildCard({ ...base, poly: { ...base.poly, ml: { home: 0.8, away: 0.22 } }, stackSide: { team: "SEA", confident: false, yv: 2, pct: 52.8, n: 608 } }, [], { ...base.poly, ml: { home: 0.8, away: 0.22 } }, null, {});
      const c3 = cpk.buildCard({ ...base, stackSide: { team: "KC", confident: false, yv: 2, pct: 52.8, n: 608 } }, [], base.poly, null, {});
      ok(c1.spread.plain.hit === 57 && c1.spread.plain.n === 249 && c2.spread.plain.hit === 49.6 && c3.spread.plain.hit === 52.8, "STACK spread PICK % (10/23 night): 57.0% when it backs a 50-70% favorite, 49.6% a 70%+ favorite, the old bands on the underdog", [c1.spread.plain, c2.spread.plain, c3.spread.plain]); }
    await getRedis().del("stack:2099:7"); } }
// ---------- 10/27 (owner's pick: open chart): the game page chart -- Polymarket US's moneyline history, team-colour lines, our team card under it
{ const css = readFileSync(new URL("../public/shell.css", import.meta.url), "utf8"), sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8");
  ok(/Shell\.chartBlock = /.test(sh) && /Shell\.chartLoad = /.test(sh) && /\/api\/\$\{o\.sport === "nba" \? "nba\/" : ""\}pricehist/.test(sh) && /\.gchart \{/.test(css) && /#detail \.dtop\.dblend \{ border-color:transparent;/.test(css) && /\.gchart::before \{[^}]*background:var\(--gwash\),var\(--card\); -webkit-mask:linear-gradient/.test(css), "shell: the shared game chart (block, loader, both sports' routes, styles); the team card sits on top and its colour wash runs into the chart, fading out (owner 10/27)");
  for (const f of ["../public/app.js", "../public/nba/app.js"]) { const a = readFileSync(new URL(f, import.meta.url), "utf8"); ok(/const chartOf = \(g\)/.test(a) && /Shell\.chartLoad\(co\)/.test(a) && /Shell\.chartStop\(\)/.test(a), `${f}: the game page draws the chart and stops it on ← Games`); }
  const { cleanHistory, moneylineSlug, usCode } = await import("../lib/polyus.js");
  const pts = cleanHistory([{ timestamp: 3, longPrice: 0.4, shortPrice: 0.62 }, { timestamp: 1, longPrice: 0.9, shortPrice: 0.9 }, { timestamp: 2, longPrice: 0.42, shortPrice: 0.6 }, { timestamp: 4, longPrice: 0.02, shortPrice: 0.99 }]);
  ok(JSON.stringify(pts) === JSON.stringify([[2, 0.42, 0.6], [3, 0.4, 0.62], [4, 0.02, 0.99]]), "price history: the placeholder prices before a book are dropped from the front, the rest kept in time order");
  ok(moneylineSlug("nfl", "CAR", "GB", "2026-10-30T00:15:00Z") === "aec-nfl-car-gb-2026-10-29" && moneylineSlug("nfl", "LA", "SF", "2026-11-01T20:05:00Z") === "aec-nfl-lar-sf-2026-11-01" && moneylineSlug("nba", "SAC", "SAS", "2026-10-28T00:00:00Z") === "aec-nba-sac-sa-2026-10-27" && usCode("GSW", "nba") === "gs",
    "price history: the moneyline market name = Polymarket US's team codes + the Eastern date of the start");
  const h = (await import("../lib/pricehist.js")).default; let code = 0; await h({ query: { away: "C<A", home: "GB", start: "x" } }, { setHeader() {}, status(c) { code = c; return this; }, json() {} }, "nfl");
  ok(code === 400, "price history route: a bad team or start is refused"); }
{ // 10/28 (owner: "only add the logo next to their team name"): props / TD rows carry no logo, the team label does (Best TD picks keep theirs: no team label there)
  const a = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  ok(!/"•"\} \$\{tlogo\(p\.team/.test(a) && /• \$\{withGame \? tlogo\(r\.team\) : ""\}/.test(a) && (a.match(/class="pbl pteam">\$\{tlogo\(t\)\}/g) || []).length === 3, "NFL props / Anytime TD: the logo sits beside the team name, not on each player row"); }
{ // 10/28: the NFL 1H SPREAD pick -- model equal to the Python fit, the props rules at 58%, record / rewrite / take out, grade on ESPN's first half, page + Models
  const h = await import("../lib/h1pick.js"), tr = await import("../lib/tracked.js"), ef = await import("../lib/espnFinals.js"), { getRedis } = await import("../lib/redis.js");
  const ref = JSON.parse(readFileSync(new URL("./h1_ref.json", import.meta.url), "utf8")); let worst = 0;
  for (const c of ref) { const m = h.h1Mean(c.x); worst = Math.max(worst, Math.abs(m - c.mean)); for (const [L, v] of Object.entries(c.cover)) worst = Math.max(worst, Math.abs(h.h1HomeCover(m, Number(L)) - v)); }
  ok(worst < 1e-3, "1H model + neighbours equal the Python fit on 6 reference games", worst);
  ok(h.h1Qualifies(0.6, 0.55) && !h.h1Qualifies(0.57, 0.5) && h.h1Qualifies(0.597, 0.6) && h.h1Qualifies(0.62, 0.61) && h.h1Qualifies(0.58, 0.77) && !h.h1Qualifies(0.8, 0.78) && h.h1Qualifies(0.6, 0.65) && !h.h1Qualifies(0.6, null) && h.H1_BAR === 0.58 && h.H1_CAP === 0.77,
    "1H rule (owner 10/28): 58%+ and 77c or less, the price never drops a side (IND +7.5 59.7% at 60c stays)");
  const x = h.h1Inputs({ week: 3, roof: "outdoors", div: true, homeRest: 7, awayRest: 6, nvSpread: 3, nvTotal: 44 }, { booksHomeSpread: -3.5, booksTotal: 45.5, wind: 12, outdoor: true });
  ok(x.hfav === 3.5 && x.tl === 45.5 && x.windo === 12 && x.domeF === 0 && x.div === 1 && x.early === 1 && x.rest_d === 1, "inputs: books first, wind outdoors, early weeks, rest", x);
  const xd = h.h1Inputs({ week: 9, roof: "dome", nvSpread: -2.5, nvTotal: 48 }, { wind: 20 }); ok(xd.hfav === -2.5 && xd.windo === 0 && xd.domeF === 1 && xd.early === 0, "a dome: no wind, the schedule's line when no books", xd);
  const mean = h.h1Mean(ref[0].x), rows = [{ line: 3.5, aPrice: 0.62, hPrice: 0.40 }, { line: 1.5, aPrice: 0.5, hPrice: 0.52 }], pk = h.h1Side(mean, rows, "AW", "HM");
  const best = (() => { let b = null; for (const r of rows) { const ph = h.h1HomeCover(mean, -r.line); for (const s of [{ pc: h.h1Shown(ph, r.hPrice), px: r.hPrice }, { pc: h.h1Shown(1 - ph, r.aPrice), px: r.aPrice }]) if (h.h1Qualifies(s.pc, s.px) && (!b || s.pc > b)) b = s.pc; } return b; })();
  ok(best == null ? pk == null : pk && Math.abs(pk.pc - Math.round(best * 1000) / 1000) < 1e-9 && /^(AW|HM) [+-]\d/.test(pk.label) && / 1H$/.test(pk.label), "h1Side = the highest qualifying shown % (0.4 model + 0.6 price), labeled with its 1H line", pk);
  ok(Math.abs(h.h1Shown(0.8, 0.7) - 0.74) < 1e-9 && h.H1_PRICE_W === 0.6, "1H shown % = 0.4 model + 0.6 price (10/28 night: the model alone ran 4-6 points high on its picks at US prices)");
  ok(h.h1Side(mean, [{ line: 3.5, aPrice: 0.9, hPrice: 0.9 }], "AW", "HM") == null, "nothing qualifies at 90c -> no pick");
  const G = { key: "AW @ HM", away: "AW", home: "HM", kickoff: "2099-10-01T17:00:00Z" }, r = getRedis();
  await tr.recordH1Pick(2095, 8, G, { team: "HM", line: -1.5, px: 0.5, pc: 0.61, label: "HM -1.5 1H" }, "t1");
  await tr.recordH1Pick(2095, 8, G, { team: "AW", line: 2.5, px: 0.55, pc: 0.63, label: "AW +2.5 1H" }, "t2");
  let o = JSON.parse(await r.hget("teaser:2095:8", "AW @ HM|h1spr"));
  ok(o.team === "AW" && o.first.team === "HM" && o.t === "t2", "rewritten until kickoff, the first sighting kept", o);
  await tr.recordH1Pick(2095, 8, G, null, "t3"); ok(!(await r.hget("teaser:2095:8", "AW @ HM|h1spr")), "a side that stops qualifying is taken out");
  await tr.recordH1Pick(2095, 8, G, { team: "AW", line: 2.5, px: 0.55, pc: 0.63, label: "AW +2.5 1H" }, "t4");
  const nG = await tr.gradeH1Week(2095, 8, [{ ...G, final: true }], async () => ({ "AW @ HM": { a: 9, h: 10 } }));
  o = JSON.parse(await r.hget("teaser:2095:8", "AW @ HM|h1spr")); ok(nG === 1 && o.result === "W" && o.h1.h === 10, "graded on the first half: AW +2.5 with a 9-10 half wins (7-10 would lose)", o);
  await tr.recordH1Pick(2095, 8, G, null, "t5"); ok(!!(await r.hget("teaser:2095:8", "AW @ HM|h1spr")), "a graded pick is never taken out");
  const S = await tr.trackedSummary(2095); ok(S.h1spr.w === 1 && S.h1spr.l === 0 && S.h1spr.said === 63 && Math.abs(S.h1spr.per100 - (100 / 0.55 - 100)) < 0.2, "summary: record, said %, money per $100", S.h1spr);
  await r.del("teaser:2095:8");
  const sb = { events: [{ status: { type: { completed: true, state: "post" } }, competitions: [{ competitors: [
    { homeAway: "home", team: { displayName: "Chicago Bears" }, linescores: [{ value: 7 }, { value: 13 }, { value: 0 }, { value: 3 }], score: "23" },
    { homeAway: "away", team: { displayName: "New England Patriots" }, linescores: [{ value: 0 }, { value: 14 }, { value: 7 }, { value: 0 }], score: "21" }] }] }] };
  ok(JSON.stringify(ef.firstHalvesFromScoreboard(sb)) === JSON.stringify({ "NE @ CHI": { a: 14, h: 20 } }), "ESPN first half = quarters 1 + 2", ef.firstHalvesFromScoreboard(sb));
  const pp = readFileSync(new URL("../pages/api/pinnaclepull.js", import.meta.url), "utf8"), gr = readFileSync(new URL("../lib/grade.js", import.meta.url), "utf8"), wk = readFileSync(new URL("../lib/week.js", import.meta.url), "utf8");
  const sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), ap = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  ok(/h1PickNow\(getRedis\(\), SEASON, g, pin, p, gm\)/.test(pp) && /recordGameMarkets\(getRedis\(\), SEASON, g, gm, t\)/.test(pp) && /gradeH1Week\(season, week, games, espnFirstHalves\)/.test(gr) && /G\.h1pick = \{/.test(wk), "the 15-min pull records the pick + every game-market price; grading and the slate read it");
  ok(/h1pick: g\.h1pick \|\| null/.test(ap) && /h1Row\(\) \+/.test(ap), "Models -> Card picks has the 1H SPREAD row");
  // 10/28 (owner: "do not put all of the market on here ... just choose our pick"): the game page shows the 1H pick alone, never a market's price list; no Game Props tab
  const mk = /Shell\.mktLines = \(o\) => \(o && o\.h1pick \? `[^`]*h1Line\(o\.h1pick\)[^`]*` : ""\);/.test(sh);
  ok(mk && !/Shell\.mktProps|Shell\.mktLoad|gamemarkets\?away|class="mkx/.test(sh) && !/"gprops"/.test(readFileSync(new URL("../public/nba/app.js", import.meta.url), "utf8")) && !(await import("node:fs")).existsSync(new URL("../pages/api/gamemarkets.js", import.meta.url)),
    "game page: the 1H pick line only (no price lists, no /api/gamemarkets), both sports"); }
{ // 10/28 night: the GAME PROPS pick (lib/gameprops.js) -- the history chance, the rule, the parse, the labels, recording, grading, the page
  const G = await import("../lib/gameprops.js"), tr = await import("../lib/tracked.js"), { getRedis } = await import("../lib/redis.js"), r = getRedis();
  const ref = JSON.parse(readFileSync(new URL("./gp_ref.json", import.meta.url), "utf8")); let worst = 0, fams = new Set();
  for (const c of ref) { const p = G.gpParse(c.m, c.away, c.home); if (p) fams.add(p.fam); worst = Math.max(worst, p ? Math.abs(G.gpChance(p, c.hfav, c.tl) - c.chance) : 1); }
  ok(worst <= 0.005 && fams.size === 21, "GAME PROPS chance = an independent Python re-implementation on 21 real markets, one per type (within 1 game of 600 at a tie)", { worst, n: fams.size });
  ok(G.GP_BAR === 0.7 && G.GP_CAP === 0.77 && G.GP_MIN === 0.3 && G.GP_EDGE === 0.06 && G.GP_PRICE_W === 0.2, "GAME PROPS rule: 70%+, 30-77c, 6+ points over the price, shown = 0.8 history + 0.2 price");
  ok(G.gpQualifies(0.70, 0.64) && !G.gpQualifies(0.69, 0.5) && !G.gpQualifies(0.75, 0.70) && G.gpQualifies(0.83, 0.77) && !G.gpQualifies(0.9, 0.78) && !G.gpQualifies(0.9, 0.29), "the rule's edges: 70% bar, 6-point edge, 77c cap, 30c floor");
  ok(Math.abs(G.gpShown(0.9, 0.6) - 0.84) < 1e-9, "shown % = 0.8 history + 0.2 price");
  const side = (d, long, team) => ({ description: d, long, team: team ? { abbreviation: team } : null });
  const mk = (type, q, extra = {}) => ({ sportsMarketType: type, question: q, slug: extra.slug || "x", marketSides: extra.sides || [side("Yes", true, extra.team), side("No", false, extra.team)], bestAskQuote: { value: extra.ask ?? 0.6 }, bestBidQuote: { value: extra.bid ?? 0.58 } });
  const P = (m) => G.gpParse(m, "SF", "LA");
  ok(JSON.stringify(P(mk("football_game_total_pass_touchdowns", "Total Passing Touchdowns: Over 5.5"))) === JSON.stringify({ fam: "ptd_t", kind: "over", col: "ptd_t", line: 5.5 }), "parse: game total passing TDs");
  ok(P(mk("football_team_total_defensive_special_teams_touchdowns", "Team Total Defensive/Special Teams Touchdowns: Over 0.5", { team: "lar" })).s === "h", "parse: a team prop finds its team (Polymarket's lar = the app's LA)");
  ok(P(mk("football_game_race_to_points", "Race to 35 Points: San Francisco 49ers", { team: "sf" })).val === "a" && P(mk("football_game_race_to_points", "Race to 10 Points: San Francisco 49ers", { team: "sf" })) == null, "parse: race to points (only the tested races)");
  ok(P({ ...mk("football_game_double_result", "Halftime / Full Time: SF 1H / Tie"), slug: "astatc-nfl-sf-lar-2026-09-10-htft-away-tie" }).ft === "tie" && P(mk("football_game_exact_margin", "Exact Margin of Victory: San Francisco by 19-24")).hi === 24 && P(mk("football_game_exact_margin", "Exact Margin of Victory: San Francisco by 25+")).hi === 999, "parse: half / full and exact margin");
  ok(P(mk("football_team_full_game_spread", "x")) == null && P(mk("football_game_first_half_total", "x")) == null && P(mk("football_team_points_full_game_total", "x")) == null && P(mk("football_player_passing_yards", "x")) == null, "never parsed: main lines, halves / quarters, team totals, player props (no edge there)");
  ok(JSON.stringify(G.gpPrices(mk("t", "q", { ask: 0.6, bid: 0.57 }))) === JSON.stringify({ pl: 0.6, ps: 0.43 }) && G.gpPrices(mk("t", "q", { ask: 0.6, bid: 0.5 })) == null && G.gpPrices(mk("t", "q", { ask: 0.995, bid: 0.9 })) == null && G.gpPrices({ ...mk("t", "q"), bestBidQuote: null }) == null, "prices: a real two-sided book only (98-106c), else no price");
  const L = (m, long) => G.gpLabel(P(m), long, "SF", "LA");
  ok(L(mk("football_game_total_pass_touchdowns", "Total Passing Touchdowns: Over 5.5"), false) === "Total passing TDs Under 5.5" && L(mk("football_team_total_defensive_special_teams_touchdowns", "Team Total Defensive/Special Teams Touchdowns: Over 0.5", { team: "lar" }), false) === "LA D/ST TD No"
    && L(mk("football_game_overtime", "Overtime?: Over 0.5"), false) === "Overtime No" && L(mk("football_team_total_offensive_yards", "Team Total Offensive Yards: Over 350.5", { team: "sf" }), true) === "SF total yards Over 350.5", "labels in plain words");
  const ev = { markets: [mk("football_game_total_pass_touchdowns", "Total Passing Touchdowns: Over 7.5", { slug: "a", ask: 0.40, bid: 0.37 }), mk("football_game_total_pass_touchdowns", "Total Passing Touchdowns: Over 6.5", { slug: "b", ask: 0.45, bid: 0.42 }), mk("football_game_overtime", "Overtime?: Over 0.5", { slug: "c", ask: 0.4, bid: 0.37 })] };
  const pk = G.gpPicks(ev, "SF", "LA", 3, 44.5);
  ok(pk.length === 2 && pk.every((x) => !x.long) && pk.find((x) => x.fam === "ptd_t").slug === "a" && pk.every((x) => G.gpQualifies(x.said, x.price)) && pk[0].said >= pk[1].said, "one pick per market type, the highest shown %, every one qualifying", pk);
  const res = (o, c = true) => ({ closed: c, outcomePrices: o, marketSides: [{ long: false }, { long: true }] });
  ok(G.gpResult(res('["0","1"]'), true) === "W" && G.gpResult(res('["0","1"]'), false) === "L" && G.gpResult(res('["0.5","0.5"]'), true) === "P" && G.gpResult(res('["0","1"]', false), true) == null && G.gpResult(null, true) == null, "graded by Polymarket's settlement in the sides' order (long side found, not the first one); open = not graded");
  const g = { key: "SF @ LA", away: "SF", home: "LA", week: 8, kickoff: "2095-10-01T20:00:00Z", final: true };
  await tr.recordGameProps(2095, 8, g, pk, "t1"); await tr.recordGameProps(2095, 8, g, pk.slice(0, 1), "t2");
  let all = await r.hgetall("teaser:2095:8"); const gp = Object.keys(all).filter((f) => f.startsWith("SF @ LA|gp|"));
  ok(gp.length === 1 && JSON.parse(all[gp[0]]).first.t === "t1" && JSON.parse(all[gp[0]]).t === "t2", "rewritten until kickoff (first sighting kept), a type that stops qualifying is taken out", gp);
  const f0 = gp[0], slug0 = JSON.parse(all[f0]).slug;
  const nG = await tr.gradeGamePropsWeek(2095, 8, [g], async () => ({ markets: [{ slug: slug0, closed: true, outcomePrices: '["0","1"]', marketSides: [{ long: true }, { long: false }] }] }));
  all = await r.hgetall("teaser:2095:8"); ok(nG === 1 && JSON.parse(all[f0]).result === "W", "graded: we took the short side (No / Under) and it paid", JSON.parse(all[f0]));
  await tr.recordGameProps(2095, 8, g, [], "t3"); ok(!!(await r.hget("teaser:2095:8", f0)), "a graded pick is never taken out");
  const S = await tr.trackedSummary(2095); ok(S.gprops.w === 1 && S.gprops.l === 0 && S.gprops.recorded === 1, "Models summary: the GAME PROPS record", S.gprops);
  await r.del("teaser:2095:8");
  const pp = readFileSync(new URL("../pages/api/pinnaclepull.js", import.meta.url), "utf8"), gr = readFileSync(new URL("../lib/grade.js", import.meta.url), "utf8"), wk = readFileSync(new URL("../lib/week.js", import.meta.url), "utf8");
  const sh = readFileSync(new URL("../public/shell.js", import.meta.url), "utf8"), ap = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  ok(/gamePropsNow\(SEASON, g, pin, p, ev\)/.test(pp) && /gradeGamePropsWeek\(season, week, games,/.test(gr) && /G\.gprops = gp/.test(wk), "the 15-min pull records the picks; grading and the slate read them");
  ok(/tabsOf = \(g\) => GTABS\.filter\(\(\[k\]\) => k !== "gprops" \|\| \(g && g\.gprops && g\.gprops\.length\)\)/.test(ap) && /Shell\.gpLines = \(o\) => \(o && o\.gprops && o\.gprops\.length \?/.test(sh) && /pickRow\("GAME PROPS · PICK"/.test(ap),
    "GAME PROPS tab only on a game with a pick, picks only; Models -> Card picks row");
  ok(ap.includes(`(${Math.round(G.GP_BAR * 100)}%+ on ${Math.round((1 - G.GP_PRICE_W) * 10)} parts history + ${Math.round(G.GP_PRICE_W * 10)} parts price, ${Math.round(G.GP_EDGE * 100)}+ points over the price, ${Math.round(G.GP_MIN * 100)}–${Math.round(G.GP_CAP * 100)}¢)`), "Models ⓘ: the GAME PROPS text carries the code's numbers"); }
{ // 10/28: both sports on one paid database (NBA_DB_URL_REDIS_URL), no fallback (the old databases were deleted); the NFL backup leaves NBA's keys to NBA
  const { DB_URL } = await import("../lib/redis.js");
  ok(DB_URL({ NBA_DB_URL_REDIS_URL: "redis://new", UPSTASH_REDIS_REST_URL_REDIS_URL: "redis://old" }) === "redis://new" && DB_URL({ UPSTASH_REDIS_REST_URL_REDIS_URL: "redis://old" }) == null, "NFL reads the shared database only (the old one was deleted 10/28)");
  const bk = readFileSync(new URL("../pages/api/backup.js", import.meta.url), "utf8"); ok(/!k\.startsWith\("nba:"\)/.test(bk), "the NFL backup leaves NBA's keys to NBA's own backup"); }
{ // 10/28 line-by-line check: the ⓘ texts quote the code's own numbers (ML PICK team-model rates, the 1H SPREAD rule)
  const a = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), { TM_ML } = await import("../lib/cardpick.js"), h = await import("../lib/h1pick.js");
  ok(a.includes(`favorites won ${TM_ML.fav.hit}% of ${TM_ML.fav.n}, underdogs priced ${TM_ML.dog.lo * 100}–50¢ won ${TM_ML.dog.hit}% of ${TM_ML.dog.n}`) && a.includes(`(${Math.round(h.H1_BAR * 100)}%+ on ${Math.round((1 - h.H1_PRICE_W) * 10)} parts model + ${Math.round(h.H1_PRICE_W * 10)} parts price, ${Math.round(h.H1_CAP * 100)}¢ max)`),
    "Models ⓘ: the ML PICK and 1H SPREAD texts carry the code's numbers"); }
console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} checks passed`);
process.exit(bad ? 1 : 0);
