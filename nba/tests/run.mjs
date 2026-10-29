import { existsSync } from "node:fs";
// Automated checks for the site (run: npm test). "Tests pass" only means the code runs the way it was written — accuracy numbers
// for the predictions live on the Models tab. GitHub runs this plus the build on every push (.github/workflows/ci.yml).
import { readFileSync, readdirSync, statSync } from "node:fs";
import RedisMock from "ioredis-mock";
const __rm = new RedisMock(); globalThis.__REDIS_COUNT__ = { n: 0 };   // every Redis command is counted (the live plan has a daily command budget)
globalThis.__TEST_REDIS__ = new Proxy(__rm, { get(t, k) { const v = t[k]; if (typeof v === "function" && typeof k === "string" && !k.startsWith("_") && k !== "then") return (...a) => { globalThis.__REDIS_COUNT__.n++; return v.apply(t, a); }; return v; } });
const { toProb, toAmerican, ncdf, ninv, isThinMarket } = await import("../lib/odds.js");
const { parseGame, polyGames, eventGame, etDate } = await import("../lib/poly.js");
const { TEAMS, ABBRS } = await import("../lib/teams.js");
const { parseInjuries, teamAbbr } = await import("../lib/injuries.js");
const { parseScoreboard, espnAbbr } = await import("../lib/espn.js");
const slate = await import("../lib/slate.js");
const rec = await import("../lib/record.js");
const mb = await import("../lib/mybets.js");
const cl = await import("../lib/closes.js");
const { redisUrl } = await import("../lib/redis.js");
const injLib = await import("../lib/injuries.js");

let bad = 0, n = 0;
const whyLib = await import("../lib/why.js");
const ok = (c, msg, v) => { n++; if (!c) { bad++; console.log("FAIL", msg, v === undefined ? "" : JSON.stringify(v)); } };
const near = (a, b, t = 1e-3) => Math.abs(a - b) < t;
async function getRedisClear() { await globalThis.__TEST_REDIS__.del("injuries:nba:v2"); }
const events = JSON.parse(readFileSync(new URL("./fixtures/poly_nba_events.json", import.meta.url), "utf8"));

// ---------- odds math
ok(toAmerican(0.6) === -150 && toAmerican(0.4) === 150 && toAmerican(0.5) === -100, "toAmerican");
ok(near(toProb(-150), 0.6) && near(toProb(150), 0.4), "toProb");
ok(near(ncdf(1.96), 0.975, 1e-4) && near(ncdf(0), 0.5, 1e-6), "ncdf");
{ let mx = 0; for (let p = 0.001; p < 1; p += 0.001) mx = Math.max(mx, Math.abs(ncdf(ninv(p)) - p)); ok(mx < 1e-4, "ninv inverts ncdf", mx); }
ok(isFinite(ninv(0)) && isFinite(ninv(1)), "ninv safe at 0/1");
ok(isThinMarket(0.4, 0.01) && !isThinMarket(0.4, 0.37), "thin-market rule");

// ---------- teams
ok(ABBRS.length === 30, "30 NBA teams", ABBRS.length);
ok(ABBRS.every((a) => TEAMS[a].name && TEAMS[a].nick && /^#[0-9a-f]{6}$/i.test(TEAMS[a].color) && /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/nba\//.test(TEAMS[a].logo)), "every team has name, colour, ESPN logo");
{ const j = JSON.parse(readFileSync(new URL("../railway-model-service/data/teams.json", import.meta.url), "utf8"));
  ok(JSON.stringify(Object.keys(j).sort()) === JSON.stringify([...ABBRS].sort()) && ABBRS.every((a) => j[a].name === TEAMS[a].name), "lib/teams.js matches the model service's teams.json"); }

// ---------- Polymarket lines (real NBA events saved from the live API)
{ const gs = polyGames(events), by = Object.fromEntries(gs.map((g) => [g.key, g]));
  ok(gs.length === 3 && by["OKC @ ATL"] && by["BKN @ WAS"] && by["CLE @ ORL"], "three games, away @ home from the event's own ordering", gs.map((g) => g.key));
  const o = by["OKC @ ATL"].poly;
  ok(o.ml && o.ml.away < o.ml.home, "moneyline: ATL favoured", o.ml);
  ok(o.spread && o.spread.homeSpread === -8.5, "spread: ATL -8.5 is the main line (nearest 50/50, consistent with the moneyline)", o.spread);
  ok(o.total && o.total.line === 223.5, "total main line", o.total);
  ok(o.alts.length >= 6 && o.alts.some((a) => a.team === "ATL" && a.line === -4.5) && o.alts.some((a) => a.team === "OKC" && a.line === 4.5), "alternate spreads listed for both sides", o.alts.length);
  ok(o.totalAlts.length >= 3 && o.totalAlts.every((t, i, a) => !i || a[i - 1].line < t.line), "alternate totals sorted", o.totalAlts);
  ok(by["CLE @ ORL"].poly && by["CLE @ ORL"].poly.ml && !by["CLE @ ORL"].poly.spread && !by["CLE @ ORL"].poly.total, "a game with only a moneyline still parses");
  ok(o.alts.every((a) => a.price > 0 && a.price < 1), "alt prices are probabilities");
  ok(eventGame({ teams: [{ abbreviation: "xxx", ordering: "away" }, { abbreviation: "tor", ordering: "home" }], startTime: "2026-10-20T00:00:00Z" }) === null, "unknown team -> skipped");
  ok(etDate("2026-10-21T02:30:00Z") === "2026-10-20" && etDate("2026-10-20T23:00:00Z") === "2026-10-20", "a late tip-off still belongs to that evening (US Eastern)"); }
ok(!JSON.stringify(events).toLowerCase().includes("player props") && !readFileSync(new URL("../lib/poly.js", import.meta.url), "utf8").match(/player-props|tdProps/), "no player-prop code (Polymarket has none for NBA)");

// ---------- injuries + scoreboard parsers
ok(teamAbbr("LA Clippers") === "LAC" && teamAbbr("Los Angeles Clippers") === "LAC" && teamAbbr("Toronto Raptors") === "TOR", "injury team names");
{ const t = parseInjuries({ injuries: [{ displayName: "Toronto Raptors", injuries: [{ status: "Out", athlete: { displayName: "A Player" } }, { status: "Questionable", athlete: { displayName: "B Player" } }] }, { displayName: "Nowhere Ghosts", injuries: [] }] });
  ok(t.TOR && t.TOR.length === 2 && t.TOR[0].status === "Out" && !t.GHO, "injury parse", t); }
ok(espnAbbr("NY") === "NYK" && espnAbbr("UTAH") === "UTA" && espnAbbr("WSH") === "WAS" && espnAbbr("TOR") === "TOR" && espnAbbr("ZZZ") === null, "ESPN abbreviations");
{ const s = parseScoreboard({ events: [{ competitions: [{ status: { type: { completed: true, state: "post" } }, competitors: [{ homeAway: "home", score: "110", team: { abbreviation: "NY" } }, { homeAway: "away", score: "104", team: { abbreviation: "BOS" } }] }] }] });
  ok(s["BOS @ NYK"] && s["BOS @ NYK"].home === 110 && s["BOS @ NYK"].final === true, "scoreboard parse", s); }

// ---------- the card (lib/cardpick.js): PICK, PICK w/ POINTS, every buyable line; best bets; parlays; recording
const tipLater = "2026-10-21T23:00:00Z", NOW = Date.parse("2026-10-21T15:00:00Z");
const cp = await import("../lib/cardpick.js"), pl = await import("../lib/parlays.js");
// lines the model service sends (railway-model-service live._lines): main line both teams / both sides + alternates in the team's favour
const LINES = (away, home) => [
  { market: "spread", team: away, line: 8.5, points: 0, hist: 49.0, n: 6000, price: 0.49, label: `${away} +8.5` }, { market: "spread", team: home, line: -8.5, points: 0, hist: 51.0, n: 6000, price: 0.51, label: `${home} -8.5` },
  { market: "spread", team: away, line: 10.5, points: 2, hist: 57.0, n: 6000, price: 0.62, label: `${away} +10.5` }, { market: "spread", team: home, line: -6.5, points: 2, hist: 56.5, n: 6000, price: 0.6, label: `${home} -6.5` },
  { market: "spread", team: home, line: -5.5, points: 3, hist: 60.0, n: 6000, price: 0.66, label: `${home} -5.5` }, { market: "spread", team: home, line: -4.5, points: 4, hist: 64.0, n: 6000, price: 0.7, label: `${home} -4.5` },
  { market: "total", side: "over", line: 223.5, points: 0, hist: 49.0, n: 4000, price: 0.5, label: "Over 223.5" }, { market: "total", side: "under", line: 223.5, points: 0, hist: 51.0, n: 4000, price: 0.5, label: "Under 223.5" },
  { market: "total", side: "under", line: 225.5, points: 2, hist: 54.0, n: 4000, price: 0.55, label: "Under 225.5" }, { market: "total", side: "over", line: 221.5, points: 2, hist: 53.0, n: 4000, price: 0.55, label: "Over 221.5" }];
const mk = (away, home, over = {}) => ({ key: `${away} @ ${home}`, away, home, date: "2026-10-21", start: tipLater, poly: { ml: { away: 0.26, home: 0.74, midAway: 0.26, midHome: 0.74 }, spread: { homeSpread: -8.5, home: 0.51, away: 0.49 }, total: { line: 223.5, over: 0.5, under: 0.5 } }, model: { margin: 3, total: 225 }, lines: LINES(away, home), ...over });
{ const g = mk("OKC", "ATL"), c = cp.buildCard(g);
  ok(c && c.spread.plain.id === "modelpick|spread" && c.spread.plain.pick === "OKC +8.5" && c.spread.plain.hit === 49.4 && c.spread.plain.price === 0.49, "no rule: PICK = the model's side at Polymarket's own line, at the model's honest rate (49.4%)", c && c.spread.plain);
  ok(c.spread.rows.map((r) => `${r.pick}·${r.points}`).join("|") === "OKC +8.5·0|ATL -8.5·0|OKC +10.5·2|ATL -6.5·2|ATL -5.5·3|ATL -4.5·4", "list: both teams, the main line and every alternate up to 7 points (owner 10/16)", c.spread.rows.map((r) => r.pick));
  { const deep = mk("OKC", "ATL", { lines: [...LINES("OKC", "ATL"), { market: "spread", team: "ATL", line: -1.5, points: 7, hist: 73.0, n: 6000, price: 0.8, label: "ATL -1.5" }, { market: "spread", team: "ATL", line: -0.5, points: 8, hist: 76.0, n: 6000, price: 0.84, label: "ATL -0.5" }] }), cd = cp.buildCard(deep);
    ok(cd.spread.rows.some((r) => r.points === 7) && !cd.spread.rows.some((r) => r.points === 8) && cd.spread.pts.pick === "OKC +10.5" && cp.MAX_LIST === 7 && cp.MAX_BUY === 3.5, "a 7-point line is listed, 8 points never; PICK w/ POINTS never goes past 3.5 points (the market prices every point)", cd.spread.pts); }
  ok(c.spread.pts && c.spread.pts.pick === "OKC +10.5" && c.spread.pts.hit === 57 && c.spread.pts.id === "ptspick|spread", "PICK w/ POINTS (10/19): on the PICK's team (OKC), never the other side", c.spread.pts);
  { const cf = cp.buildCard(mk("OKC", "ATL", { model: { margin: 12, total: 225 } }));
    ok(cf.spread.plain.pick === "ATL -8.5" && cf.spread.pts.pick === "ATL -5.5" && cf.spread.pts.hit === 60, "PICK w/ POINTS: the far line that clearly wins more (on the PICK's team)", cf.spread.pts);
    const cn = cp.buildCard(mk("OKC", "ATL", { model: null }));
    ok(!cn.spread.plain && cn.spread.pts.pick === "ATL -5.5", "PICK w/ POINTS with no PICK at all: either side", cn.spread.pts); }
  ok(c.total.plain.pick === "Over 223.5" && c.total.plain.hit === 50.4 && c.total.pts === null && c.total.rows.some((r) => r.pick === "Over 221.5" && r.hit === 53), "total (10/26 night): model's side at the main total, NO PICK w/ POINTS on it (a coin flip; live 18-21); the MORE list still shows every line", c.total);
  const g2 = mk("OKC", "ATL", { lines: LINES("OKC", "ATL").filter((x) => x.points <= 2) }), c2 = cp.buildCard(g2);
  ok(c2.spread.pts.pick === "OKC +10.5" && c2.spread.pts.hit === 57, "PICK w/ POINTS: the fewest points that reach 56%, either team", c2.spread.pts);
  const g1p = mk("OKC", "ATL", { lines: [...LINES("OKC", "ATL").filter((x) => x.points <= 2), { market: "spread", team: "OKC", line: 9.5, points: 1, hist: 58.0, n: 6000, price: 0.55, label: "OKC +9.5" }] }), c4 = cp.buildCard(g1p);
  ok(cp.MIN_BUY === 2 && c4.spread.rows.some((r) => r.pick === "OKC +9.5" && r.points === 1 && r.hit === 58) && c4.spread.pts.pick === "OKC +10.5" && c4.spread.pts.points === 2, "PICK w/ POINTS: 2 points is the first buy; a 1-point line is listed, never chosen (owner 10/16)", c4.spread.pts);
  const g3 = mk("OKC", "ATL", { move: { signal: { spread: { team: "OKC", open: 8.5, pts: 3 } } } }), c3 = cp.buildCard(g3);
  ok(c3.spread.plain.id === "cardpick|spread" && c3.spread.plain.ruleId === "linemove|spread" && c3.spread.plain.pick === "OKC +8.5" && c3.spread.plain.hit === 67.9, "LINE MOVE names the side: PICK at Polymarket's line, 67.9% while Polymarket still has the opening number", c3.spread.plain);
  // 10/24: the bought lines carry the PICK's lift (LINE MOVE 67.9% over a table main line of 49.0 -> +18.9): OKC +10.5 = 57.0 + 18.9 = 75.9, never under
  // the PICK; the other team's lines move down the same amount, floored at 100 - 67.9; PICK w/ POINTS = the fewest points (2) on OKC
  { const r = c3.spread.rows, okc2 = r.find((x) => x.pick === "OKC +10.5"), atl2 = r.find((x) => x.pick === "ATL -6.5"), atl0 = r.find((x) => x.pick === "ATL -8.5");
    ok(okc2 && okc2.hit > 67.9 && Math.abs(okc2.hit - (57 + 67.9 - LINES("OKC", "ATL").find((x) => x.team === "OKC" && x.points === 0).hist)) < 0.11 && atl0.hit === 32.1 && atl2.hit >= 32.1 && atl2.hit < 56.5 && c3.spread.pts.pick === "OKC +10.5" && c3.spread.pts.hit === okc2.hit,
      "LINE MOVE: lines with more points on the PICK's team carry its lift (never read under the PICK); the other team's move down the same", { r, pts: c3.spread.pts }); }
  const g4 = mk("OKC", "ATL", { move: { signal: { spread: { team: "OKC", open: 5.5, pts: 3 } } } });
  ok(cp.buildCard(g4).spread.plain.hit === 56.3, "LINE MOVE after Polymarket moved too: the closing-number rate (56.3%)");
  const g5 = mk("OKC", "ATL", { move: { signal: { total: { side: "under", open: 223.5, pts: 3 } } } });
  ok(cp.buildCard(g5).total.plain.ruleId === "linemove|total" && cp.buildCard(g5).total.plain.pick === "Under 223.5" && cp.buildCard(g5).total.plain.hit === 61.8, "TOTAL MOVE while Polymarket still has the opening total");
  { const sq = (h, a) => ({ context: { home: { sq_cold_mu: 0, sq_mu: 0, ...h }, away: { sq_cold_mu: 0, sq_mu: 0, ...a } } });
    const cold = cp.buildCard(mk("OKC", "ATL", sq({ sq_l20: -5, sq_x10: 200, sq_gp: 12 }, { sq_l20: -3, sq_x10: 200, sq_gp: 12 }))).total.plain;
    ok(cold.ruleId === "shotq|total" && cold.id === "cardpick|total" && cold.pick === "Over 223.5" && cold.hit === 55.2 && cold.why === "SHOT QUALITY" && cold.price === 0.5, "SHOT QUALITY: both teams' games ran cold (-8 vs the season, 10+ games each) -> Over at Polymarket's total, 55.2%", cold);
    const shots = cp.buildCard(mk("OKC", "ATL", sq({ sq_l20: 0, sq_x10: 235, sq_gp: 6 }, { sq_l20: 0, sq_x10: 235, sq_gp: 6 }))).total.plain;
    ok(shots.ruleId === "shotq|total" && shots.pick === "Over 223.5", "SHOT QUALITY: their shots are worth 11.5 points more than the total (5+ games each) -> Over", shots);
    const few = cp.buildCard(mk("OKC", "ATL", sq({ sq_l20: -9, sq_x10: 235, sq_gp: 4 }, { sq_l20: -9, sq_x10: 235, sq_gp: 4 }))).total.plain;
    const none = cp.buildCard(mk("OKC", "ATL", sq({ sq_l20: null, sq_x10: null, sq_gp: 0, sq_cold_mu: null, sq_mu: null }, { sq_l20: null, sq_x10: null, sq_gp: 0, sq_cold_mu: null, sq_mu: null }))).total.plain;
    const near = cp.buildCard(mk("OKC", "ATL", sq({ sq_l20: -3, sq_x10: 230, sq_gp: 12 }, { sq_l20: -3, sq_x10: 230, sq_gp: 12 }))).total.plain;
    ok(few.ruleId === "model|total" && none.ruleId === "model|total" && near.ruleId === "model|total", "no SHOT QUALITY with under 5 games, with no shot numbers (preseason), or short of both cut-offs (-6 and +6.5): the model's side", [few.ruleId, none.ruleId, near.ruleId]);
    const both = cp.buildCard(mk("OKC", "ATL", { ...sq({ sq_l20: -5, sq_x10: 200, sq_gp: 12 }, { sq_l20: -3, sq_x10: 200, sq_gp: 12 }), move: { signal: { total: { side: "under", open: 223.5, pts: 3 } } } })).total.plain;
    ok(both.ruleId === "linemove|total" && both.pick === "Under 223.5" && both.hit === 61.8, "TOTAL MOVE at the open (61.8%) outranks SHOT QUALITY (55.2%)", both);
    const rs2 = rec.summarize([{ id: "cardpick|total", market: "total", ruleId: "shotq|total", pct: 55.2, result: "win", price: 0.5 }]);
    ok(rs2["rule:shotq|total"].w === 1, "the record keeps a SHOT QUALITY row", Object.keys(rs2)); }
  ok(cp.buildCard({ ...g, inProgress: true }) === null && cp.buildCard({ ...g, preseason: true }).test === true, "no card once the game is under way; a preseason card is a TEST");
  // best bets + parlay from cards: green (56%+) straight picks only; the moneyline PICK counts
  const games = [
    { ...mk("LAC", "TOR"), card: { spread: { plain: { id: "cardpick|spread", ruleId: "linemove|spread", team: "LAC", line: 4.5, pick: "LAC +4.5", hit: 67.9, n: 483, price: 0.5 } }, total: null }, ml: { pick: { label: "TOR ML", pct: 70, tier: "pick", team: "TOR", source: "market win chance" } } },
    { ...mk("BOS", "NYK"), card: { spread: { plain: { id: "modelpick|spread", team: "BOS", line: 3.5, pick: "BOS +3.5", hit: 50.3, price: 0.5 } }, total: { plain: { id: "cardpick|total", ruleId: "linemove|total", side: "over", line: 220.5, pick: "Over 220.5", hit: 61.8, price: 0.5 } } }, ml: { pick: { label: "BOS ML", pct: 54, tier: "lean", team: "BOS" } } },
    { ...mk("MIA", "ORL"), card: { spread: { plain: { id: "modelpick|spread", team: "MIA", line: -1.5, pick: "MIA -1.5", hit: 50.3, price: 0.5 } }, total: null }, ml: { pick: { label: "ORL ML", pct: 60, tier: "pick", team: "ORL" } } },
  ];
  const picks = slate.collectPicks(games);
  ok(picks.map((p) => p.label).join("|") === "TOR ML|LAC +4.5|Over 220.5|ORL ML", "collectPicks keeps only green picks (56%+), best first; the model's 50% side is not a best bet", picks.map((p) => p.label));
  const many = Array.from({ length: 14 }, (_, i) => ({ game: `G${i % 7}`, label: `P${i}`, pct: 80 - i }));
  ok(slate.bestBets(many).length === 10, "best bets capped at 10");
  const par = slate.parlay(many); ok(par.length === 4 && new Set(par.map((p) => p.game)).size === 4, "parlay: top 4, one per game", par.map((p) => p.game));
  ok(slate.polyPrice(games[0], "spread", { team: "LAC" }) === 0.49 && slate.polyPrice(games[0], "ml", { team: "TOR" }) === 0.74 && slate.polyPrice(games[1], "total", { side: "over" }) === 0.5, "price of the pick on Polymarket");
  // parlays (lib/parlays.js): the Parlay (top 4 picks, one per game), 4 biggest favorites, same game 2 legs, same game bought lines
  const four = [mk("A1", "H1", { ml: { pick: { label: "H1 ML", pct: 74, tier: "pick", team: "H1" } } }), mk("A2", "H2"), mk("A3", "H3"), mk("A4", "H4"), mk("A5", "H5", { poly: { ml: { away: 0.5, home: 0.5, midAway: 0.5, midHome: 0.5 }, spread: { homeSpread: -8.5, home: 0.51, away: 0.49 }, total: { line: 223.5, over: 0.5, under: 0.5 } } })].map((g) => ({ ...g, card: cp.buildCard(g) }));
  const P = pl.buildParlays(four, slate.collectPicks([...games, ...four]));
  const fav = P.find((p) => p.type === "fav4"), sg = P.filter((p) => p.type === "sgp"), sgp = P.filter((p) => p.type === "sgp_pts");
  ok(!fav && P.every((p) => p.legs.length <= 3), "three legs max (10/19, owner: \"cut all the four legs\"): the 4 biggest favorites is no longer built; no NBA parlay has more than 3 legs", P.map((p) => [p.type, p.legs.length]));
  ok(sg.length === 0, "same game 2 legs (10/19): none when the legs are the model's 49-50% sides", sg.length);
  { const gG = (k, sp, tt) => ({ key: k, away: k.split(" @ ")[0], home: k.split(" @ ")[1], start: "2026-11-01T23:00:00Z", poly: { ml: { away: 0.4, home: 0.62, midAway: 0.39, midHome: 0.61 } }, card: { spread: { plain: { team: k.split(" @ ")[0], line: 4.5, pick: `${k.split(" @ ")[0]} +4.5`, hit: sp, price: 0.5 } }, total: { plain: { side: "over", line: 220.5, pick: "Over 220.5", hit: tt, price: 0.5 } } } });
    const G2 = pl.buildParlays([gG("X1 @ Y1", 61, 58), gG("X2 @ Y2", 61, 50.4)], []).filter((p) => p.type === "sgp");
    ok(G2.length === 0, "same game 2 legs: no longer built (10/21: replaced by the 4-leg Same Game, buildSameGame4)", G2);
    { // 10/21 (owner): 4-leg Same Game per game, $5: the game's 4 strongest legs among the green card PICKs and its prop rows; fewer than 4 -> none
      const pr = await import("../lib/props.js"), R = globalThis.__TEST_REDIS__, D = "2027-01-07", st = "2027-01-08T00:00:00Z", now = Date.parse("2027-01-07T20:00:00Z");
      const A = { ...gG("X1 @ Y1", 61, 58), date: D, start: st }, B = { ...gG("X2 @ Y2", 61, 50.4), date: D, start: st };
      const put = async (k, ps) => { const rows = [], m = {}; for (const [n, tm, c] of ps) { rows.push({ name: n, team: tm, stat: "pts", line: 12.5, mu: 15, over: c, under: 1 - c }); m[`${n}|pts|12.5`] = [0.64, 0.62, 0.38, 0.64, "t"]; }   // 10/23: an Over's % = 0.4 model + 0.6 price (priced 2+ under it)
        await R.set(pr.K_NBAPROPMODEL(D, k), JSON.stringify({ rows })); await R.set(pr.K_NBAPROPS(D, k), JSON.stringify({ m })); };
      await put("X1 @ Y1", [["Amos", "X1", 0.74], ["Boyd", "Y1", 0.72], ["Cruz", "Y1", 0.70]]); await put("X2 @ Y2", [["Dunn", "X2", 0.74], ["Earl", "Y2", 0.73]]);
      const S4 = await pl.buildSameGame4(D, [A, B], now);
      for (const k of ["X1 @ Y1", "X2 @ Y2"]) { await R.del(pr.K_NBAPROPMODEL(D, k)); await R.del(pr.K_NBAPROPS(D, k)); }
      ok(S4.length === 1 && S4[0].type === "sgp4" && S4[0].game === "X1 @ Y1" && S4[0].stake === 5 && S4[0].legs.map((l) => l.label).join() === "Amos Pts Over 12.5,Boyd Pts Over 12.5,Cruz Pts Over 12.5,X1 +4.5"
        && S4[0].legs.slice(0, 3).every((l, i) => Math.abs(l.prob - [0.68, 0.672, 0.664][i]) < 0.015) && Math.abs(S4[0].prob - S4[0].legs.reduce((a, l) => a * l.prob, 1) * 1.03 * 0.97 * 0.97) < 0.002, "Same Game 4 legs (10/21): the 4 strongest (3 props 66-70% + the 61% spread; the 58% total left out), $5; a game with only 3 good legs gets none; chance = product x the links (X1 +4.5 with X1's Amos 1.03, with Y1's Boyd / Cruz 0.97 each)", S4); }
    { // 10/23: same-game links between a game leg and a player's Over (measured 2024-26, 26,223 65%+ Overs)
      const sp = { game: "A @ B", market: "spread", team: "A", prob: 0.6 }, ov = { game: "A @ B", market: "total", side: "over", prob: 0.56 }, un = { ...ov, side: "under" };
      const pA = { game: "A @ B", market: "prop", team: "A", stat: "pts", side: "over", prob: 0.7 }, pB = { ...pA, team: "B" }, rB = { ...pB, stat: "reb" }, other = { ...pA, game: "C @ D" };
      ok(pl.linkOf(sp, pA) === 1.03 && pl.linkOf(sp, pB) === 0.97 && pl.linkOf({ ...sp, market: "ml" }, pB) === 0.97 && pl.linkOf(ov, pA) === 1.04 && pl.linkOf(ov, rB) === 0.98 && pl.linkOf(un, pA) === 0.96 && pl.linkOf(un, rB) === 1.02
        && pl.linkOf(sp, other) === 1 && pl.linkOf(pA, pB) === 1 && pl.linkOf(sp, { ...pA, team: null }) === 1
        && Math.abs(pl.chanceOf([sp, pA, pB]) - 0.6 * 0.7 * 0.7 * 1.03 * 0.97) < 1e-9 && Math.abs(pl.chanceOf([pA, other]) - 0.49) < 1e-9 && pl.chanceOf([{ ...sp, prob: 0.9 }, { ...pA, prob: 0.92 }, { ...ov, prob: 0.95 }]) <= 0.9,
        "NBA parlay chance (10/23): spread / ML with the player's own team 1.03x, the other team 0.97x; total Over with points 1.04x, rebounds 0.98x, the Under the mirror; props with each other and legs of other games stay independent; never above the weakest leg"); }
    const fourG = ["A @ B", "C @ D", "E @ F", "G @ H", "I @ J"].map((k, i) => ({ ...gG(k, 50, 50), poly: { ml: { away: 0.2 + i * 0.02, home: 0.82 - i * 0.02, midAway: 0.2 + i * 0.02, midHome: 0.8 - i * 0.02 } } }));
    fourG[0].card.spread.plain.hit = 62;   // our green spread pick backs A, the underdog
    ok(!pl.buildParlays(fourG, []).some((p) => p.type === "fav4"), "4 biggest favorites (10/19): no longer built (three legs max)"); }
  ok(sgp.length === 0, "same game bought lines (10/19): not built any more -- PICK w/ POINTS stays only on the card under MORE", sgp.length);
  { // 10/19 (owner: "I don't want the pick with points ... pick the right side"): the Parlay = the 4 strongest green side PICKs (the card's PICK), one per game; bought lines never
    const gP = (k, sp, tt, ptsHit = 70) => ({ key: k, away: k.split(" @ ")[0], home: k.split(" @ ")[1], start: "2026-11-01T23:00:00Z", card: {
      spread: { plain: { team: k.split(" @ ")[0], line: 4.5, pick: `${k.split(" @ ")[0]} +4.5`, hit: sp, price: 0.52 }, pts: { team: k.split(" @ ")[0], line: 6.5, points: 2, pick: `${k.split(" @ ")[0]} +6.5`, hit: ptsHit, price: 0.6 } },
      total: { plain: { side: "under", line: 224.5, pick: "Under 224.5", hit: tt, price: 0.52 }, pts: { side: "under", line: 226.5, points: 2, pick: "Under 226.5", hit: ptsHit, price: 0.6 } } } });
    const G = [gP("A @ B", 58, 57), gP("C @ D", 55, 60), gP("E @ F", 61, 50), gP("G @ H", 57, 56.5), gP("I @ J", 56.2, 52), gP("K @ L", 54, 55)];
    const b4 = pl.buildParlays(G, []).find((p) => p.type === "best4");
    ok(b4 && b4.legs.map((l) => l.label).join() === "E +4.5,Under 224.5,A +4.5" && b4.legs.every((l) => !l.bought && l.market !== "ml") && b4.stake === 10, "the Parlay (10/19, three legs max): 3 strongest green side PICKs (56%+), one per game, never a bought line (the 70% PICK w/ POINTS lines are ignored), no moneylines", b4 && b4.legs.map((l) => l.label));
    const b3 = pl.buildParlays(G.slice(2), []).find((p) => p.type === "best4");
    ok(b3 && b3.legs.map((l) => l.label).join() === "E +4.5,G +4.5,I +4.5" && Math.abs(b3.prob - 0.61 * 0.57 * 0.562) < 0.002, "the Parlay (10/19): 3 green side PICKs -> a 3-leg Parlay", b3 && b3.legs.map((l) => l.label));
    ok(!pl.buildParlays(G.slice(4), []).some((p) => p.type === "best4"), "the Parlay (10/19): 1 green side PICK -> no Parlay (a green PICK w/ POINTS does not count)");
    const tk = slate.parlayTicket([{ type: "fav4", legs: [] }, b4], G);
    ok(tk.map((x) => x.label).join() === b4.legs.map((l) => l.label).join() && tk[0].pct === 61 && tk[0].start === G[2].start && slate.parlayTicket([], G).length === 0, "My bets PARLAY ticket = the same legs as the Parlay tab (10/19)", tk); }
  ok(pl.buildParlays(four.slice(0, 3), []).every((p) => p.type !== "fav4"), "fewer than 4 games: no 4 biggest favorites (the Parlay takes 2-4 legs since 10/19)");
  // grading a parlay: every leg must win; a push leg drops out
  const f = { away: 100, home: 90 };
  ok(pl.gradeLeg({ market: "spread", team: "A1", line: 8.5 }, "A1", "H1", f) === "W" && pl.gradeLeg({ market: "ml", team: "H1" }, "A1", "H1", f) === "L" && pl.gradeLeg({ market: "total", side: "under", line: 190 }, "A1", "H1", f) === "P", "parlay legs graded like picks"); }
{ // full build with a stubbed model service
  const model = { ok: true, builtAt: "x", fitThrough: "2026-04-12", patternsBuilt: "2026-10-12", games: [{ key: "OKC @ ATL", away: "OKC", home: "ATL", model: { margin: 3, total: 225 }, spread: { line: -8.5 }, ml: { pick: { label: "ATL ML", pct: 74, tier: "pick", team: "ATL", source: "market win chance" } }, total: { line: 223.5 }, lines: LINES("OKC", "ATL"), injuries: { home: [], away: [] }, context: {}, preseason: false }] };
  const t0 = Date.parse("2026-10-12T20:00:00Z");   // before the 23:00Z tip
  const s1 = await slate.buildSlate({ now: t0, events, injuries: { teams: {}, t: "2026-10-12T19:00:00Z" }, model });
  ok(s1.ok && s1.games.length >= 2 && s1.modelOk && s1.teams && s1.teams.TOR, "slate builds with teams for the page", s1.games.length);
  const g1 = s1.games.find((g) => g.key === "OKC @ ATL");
  ok(g1.card && g1.card.spread.plain.pick === "OKC +8.5" && g1.card.spread.pts.pick === "OKC +10.5" && g1.card.total.plain.pick === "Over 223.5" && g1.card.total.pts === null, "the card is built on every game with model numbers (no PICK w/ POINTS on the model-side total)", g1.card && g1.card.spread);
  ok(s1.bestBets.length === 1 && s1.bestBets[0].label === "ATL ML" && s1.bestBets[0].price > 0.7, "best bets: the green moneyline PICK, with its price; the model's 50% sides are not in it", s1.bestBets.map((p) => p.label));
  ok(!s1.parlays.some((p) => p.type === "sgp" || p.type === "sgp_pts" || p.type === "fav4"), "no 2-leg parlay from the model's 50% sides, no bought-lines parlay (10/19), no 4-favorites parlay with 3 games", s1.parlays.map((p) => p.type));
  const stored = await rec.loadPicks(); ok(stored.length === 4 && stored.every((p) => p.date === "2026-10-12") && stored.map((p) => p.id).sort().join("|") === "ml|modelpick|spread|modelpick|total|ptspick|spread" && stored.find((p) => p.id === "ml").price > 0.7, "every card pick is saved before tip-off with its id and price (no ptspick|total on a model-side total)", stored.map((p) => [p.id, p.price]));
  globalThis.__NBA_SGP__ = { type: "sgp", game: "OKC @ ATL", start: g1.start, stake: 20, legs: [{ game: "OKC @ ATL", market: "spread", team: "OKC", line: 8.5, label: "OKC +8.5", prob: 0.6 }, { game: "OKC @ ATL", market: "total", side: "over", line: 223.5, label: "Over 223.5", prob: 0.6 }], prob: 0.36 };
  await pl.recordParlays("2026-10-12", [globalThis.__NBA_SGP__], s1.games, t0);
  const sp = await pl.loadParlays(); ok(sp.length === 1 && sp.every((p) => p.date === "2026-10-12" && p.game === "OKC @ ATL"), "a parlay is saved before tip-off", sp.length);
  await pl.recordParlays("2026-10-12", [], s1.games, t0 + 30e3); ok((await pl.loadParlays()).length === 0, "a saved parlay the build no longer makes leaves the record before tip-off");
  await pl.recordParlays("2026-10-12", [globalThis.__NBA_SGP__], s1.games, t0 + 31e3);
  // the first sighting stands: same game again with a different pct does not overwrite
  model.games[0].ml.pick.pct = 99; await slate.buildSlate({ now: t0 + 60e3, events, injuries: { teams: {}, t: "x" }, model });
  ok((await rec.loadPicks()).find((p) => p.id === "ml").pct === 74, "first sighting of a pick stands");
  // after tip-off nothing new is recorded
  const before = (await rec.loadPicks()).length; model.games[0].lines.push({ market: "total", side: "over", line: 219.5, points: 4, hist: 70, n: 4000, price: 0.7, label: "Over 219.5" });
  await slate.buildSlate({ now: Date.parse("2026-10-12T23:30:00Z"), events, injuries: { teams: {}, t: "x" }, model });
  ok((await rec.loadPicks()).length === before, "no pick is recorded after tip-off");
  // line move: first-seen line is kept, a change shows up
  const ev2 = JSON.parse(JSON.stringify(events)); const m = ev2[0].markets.find((x) => x.sportsMarketType === "spreads" && x.line === -8.5); m.line = -9.5; m.question = m.question.replace("-8.5", "-9.5");
  const s3 = await slate.buildSlate({ now: t0 + 120e3, events: ev2, injuries: { teams: {}, t: "x" }, model: null, record: false });
  ok(s3.modelOk === false && s3.modelError && s3.games.length >= 2 && s3.bestBets.length === 0 && s3.games.every((g) => !g.card), "model offline: lines still load, no cards, reason given", s3.modelError);
  const g3 = s3.games.find((g) => g.key === "OKC @ ATL"); ok(!g3.move || g3.move.spread, "line-move field is well-formed"); }

// ---------- a game already under way: no card, not in best bets; the picks saved before tip-off are shown locked
{ const model = { ok: true, builtAt: "x", games: [{ key: "OKC @ ATL", away: "OKC", home: "ATL", model: { margin: 3, total: 225 }, spread: { line: -8.5 }, ml: { pick: { label: "ATL ML", pct: 74, tier: "pick", team: "ATL" } }, total: { line: 223.5 }, lines: LINES("OKC", "ATL"), injuries: { home: [], away: [] }, context: {}, preseason: false }] };
  const live = await slate.buildSlate({ now: Date.parse("2026-10-12T23:40:00Z"), events, injuries: { teams: {}, t: "x" }, model, record: false });
  const g = live.games.find((x) => x.key === "OKC @ ATL");
  ok(g && g.inProgress === true && !g.card && g.ml.pick.tier === "none", "game in progress: no card, moneyline pick switched off", g && g.ml);
  ok(!live.bestBets.some((p) => p.game === "OKC @ ATL") && !live.parlays.some((p) => p.game === "OKC @ ATL"), "game in progress: not in best bets or parlays");
  ok(g.locked && g.locked.spread.plain.label === "OKC +8.5" && g.locked.spread.pts.label === "OKC +10.5" && g.locked.ml.plain.label === "ATL ML" && g.locked.total.plain.label === "Over 223.5" && !g.locked.total.pts, "the picks saved before tip-off are shown locked", g.locked); }

// ---------- which environment variable holds the Redis address
ok(redisUrl({}) === null && redisUrl({ NBA_REDIS_URL: "not a url" }) === null, "no NBA Redis address -> in-memory stand-in");
ok(redisUrl({ NBA_DB_URL_REDIS_URL: " rediss://default:pw@host:6379 " }) === "rediss://default:pw@host:6379" && redisUrl({ NBA_REDIS_URL: "redis://old:2" }) === null, "10/28: NBA reads only the shared database's NBA_DB_URL_REDIS_URL (the old NBA_REDIS_URL database was deleted)");
ok(redisUrl({ UPSTASH_REDIS_REST_URL_REDIS_URL: "redis://a:1", REDIS_URL: "redis://b:2", KV_URL: "redis://c:3" }) === null, "the NFL database's variables are NEVER used by NBA (separate databases)");

{ const { withPrefix, sharedDb } = await import("../lib/redis.js"), RM = (await import("ioredis-mock")).default, m = new RM({ host: "shared-db", port: 7010 });
  await m.set("nba:alerts", "1"); await m.set("nba:pick:2026-10-28:A @ B:ml", "2"); await m.set("alerts", "nfl"); await m.set("stack:2026:8", "nfl");
  const w = withPrefix(m); let c = "0", ks = []; do { const [n, k] = await w.scan(c, "MATCH", "*", "COUNT", 50); c = n; ks.push(...k); } while (c !== "0");
  let c2 = "0", ks2 = []; do { const [n, k] = await w.scan(c2, "MATCH", "pick:*"); c2 = n; ks2.push(...k); } while (c2 !== "0");
  ok(ks.sort().join() === "alerts,pick:2026-10-28:A @ B:ml" && ks2.join() === "pick:2026-10-28:A @ B:ml" && (await w.dbsize()) === 2 && sharedDb({ NBA_DB_URL_REDIS_URL: "redis://x:1" }) && !sharedDb({ NBA_REDIS_URL: "redis://x:1" }),
    "shared database: NBA's SCAN sees only its own nba: keys, names come back without the label, DBSIZE counts NBA only", { ks, ks2 }); }

// ---------- closing-line recorder
{ const G = (over = {}) => ({ key: "OKC @ ATL", away: "OKC", home: "ATL", date: "2026-10-30", start: "2026-10-30T23:00:00Z", poly: { ml: { midAway: 0.26, midHome: 0.74 }, spread: { homeSpread: -8.5 }, total: { line: 223.5 } }, ...over });
  const before = Date.parse("2026-10-30T20:00:00Z"), after = Date.parse("2026-10-30T23:30:00Z");
  ok((await cl.recordCloses([G()], before)) === 1, "a line seen before tip-off is saved");
  ok((await cl.recordCloses([G({ poly: { ml: { midAway: 0.3, midHome: 0.7 }, spread: { homeSpread: -7.5 }, total: null } })], before + 3600e3)) === 1, "the latest pre-tip line replaces the earlier one");
  ok((await cl.recordCloses([G({ poly: { ml: { midAway: 0.99, midHome: 0.01 }, spread: { homeSpread: 30 }, total: { line: 1 } } })], after)) === 0, "a line seen after tip-off (live line) is NOT saved");
  const c = (await cl.loadCloses({ now: after })).find((x) => x.game === "OKC @ ATL" && x.date === "2026-10-30");
  ok(c && c.hs === -7.5 && c.tl === 223.5 && Math.abs(c.mlHome - 0.7) < 1e-9, "the close is the last pre-tip line; a market that disappeared keeps its last value", c);
  ok((await cl.loadCloses({ now: before })).filter((x) => x.date === "2026-10-30").length === 0, "closes are only listed once the game has started");
  ok((await cl.loadCloses({ now: after, since: "2026-11-01" })).length === 0, "since= filters by date"); }
{ const model = { ok: true, builtAt: "x", games: [] };
  const before = Date.parse("2026-10-12T20:00:00Z");
  await slate.buildSlate({ now: before, events, injuries: { teams: {}, t: "x" }, model: null });   // model offline
  const later = await cl.loadCloses({ now: Date.parse("2026-10-13T12:00:00Z") });
  ok(later.some((x) => x.game === "OKC @ ATL" && x.hs === -8.5), "closing lines are saved even when the model service is down", later.length); }

// ---------- injuries: official report first, ESPN as the fallback
{ const real = globalThis.fetch;
  const official = { ok: true, source: "nba-official", asOf: "2026-10-20T17:30:00", dates: { "2026-10-20": { TOR: [{ name: "A Player", status: "Out" }] } } };
  globalThis.fetch = async (u) => (String(u).includes("svc.test/injuries") ? { ok: true, status: 200, json: async () => official } : { ok: false, status: 500, json: async () => ({}) });
  process.env.NBA_MODEL_SERVICE_URL = "http://svc.test";
  await getRedisClear();
  const a = await injLib.loadInjuries({ maxAgeMs: 0 });
  ok(a.source === "nba-official" && injLib.injuriesFor(a, "2026-10-20", "TOR")[0].name === "A Player" && injLib.injuriesFor(a, "2026-10-21", "TOR").length === 0, "official report used, by game day (a day it doesn't cover has no entries)", a);
  globalThis.fetch = async (u) => (String(u).includes("svc.test/injuries") ? { ok: false, status: 502, json: async () => ({ ok: false, error: "no report" }) }
    : { ok: true, status: 200, json: async () => ({ injuries: [{ displayName: "Toronto Raptors", injuries: [{ status: "Out", athlete: { displayName: "B Player" } }] }] }) });
  const b = await injLib.loadInjuries({ maxAgeMs: 0 });
  ok(b.source === "espn" && injLib.injuriesFor(b, "2026-10-20", "TOR")[0].name === "B Player", "ESPN used when the official report can't be read", b);
  globalThis.fetch = async () => { throw new Error("offline"); };
  const c = await injLib.loadInjuries({ maxAgeMs: 0 });
  ok(c.stale === true && c.source === "espn", "both down: the last copy is used and marked stale");
  await getRedisClear();
  const d = await injLib.loadInjuries({ maxAgeMs: 0 });
  ok(d.t === null && d.error, "nothing at all: the page is told, never 'healthy'", d);
  globalThis.fetch = real; delete process.env.NBA_MODEL_SERVICE_URL; await getRedisClear(); }

// ---------- grading
{ const f = { away: 104, home: 110 };
  ok(rec.gradePick({ market: "ml", team: "NYK" }, "BOS", "NYK", f) === "win" && rec.gradePick({ market: "ml", team: "BOS" }, "BOS", "NYK", f) === "loss", "grade moneyline");
  ok(rec.gradePick({ market: "spread", team: "NYK", line: -5.5 }, "BOS", "NYK", f) === "win" && rec.gradePick({ market: "spread", team: "NYK", line: -6.5 }, "BOS", "NYK", f) === "loss" && rec.gradePick({ market: "spread", team: "NYK", line: -6 }, "BOS", "NYK", f) === "push" && rec.gradePick({ market: "spread", team: "BOS", line: 6.5 }, "BOS", "NYK", f) === "win", "grade spread incl. push");
  ok(rec.gradePick({ market: "total", side: "over", line: 213.5 }, "BOS", "NYK", f) === "win" && rec.gradePick({ market: "total", side: "under", line: 213.5 }, "BOS", "NYK", f) === "loss" && rec.gradePick({ market: "total", side: "over", line: 214 }, "BOS", "NYK", f) === "push", "grade total incl. push");
  const g = await rec.gradeAll(async () => ({ "OKC @ ATL": { away: 100, home: 90, final: true }, "BKN @ WAS": { away: 1, home: 2, final: false } }));
  const all = await rec.loadPicks(), done = all.filter((p) => p.result), by = (id) => all.find((p) => p.id === id);
  ok(g === 4 && done.length === 4 && by("ml").result === "loss" && by("modelpick|spread").result === "win" && by("ptspick|spread").result === "win" && by("modelpick|total").result === "loss" && !by("ptspick|total"), "gradeAll grades finished games only, every saved id", all.map((p) => [p.id, p.result]));
  const sm = rec.summarize(all);
  ok(sm.all.w === 1 && sm.all.l === 2 && sm.ml.l === 1 && sm.spread.w === 1 && sm.total.l === 1 && sm.pts.w === 1 && sm.pts.l === 0 && sm.model.w === 1 && sm["ptspick|spread"].w === 1 && !sm["ptspick|total"] && !sm.green.w && sm.green.l === 1, "record summary: by id, by market, bought lines apart, green picks (56%+) apart", sm);
  ok(sm.ml.per100 === -100 && sm.pts.per100 != null && sm["ptspick|spread"].per100 === Math.round(100 / 0.62 - 100), "money per $100 at the saved price", [sm.ml.per100, sm["ptspick|spread"].per100]);
  if (!(await pl.loadParlays()).length) { const R0 = globalThis.__TEST_REDIS__, k = "parlay:2026-10-12:sgp:OKC @ ATL"; await R0.set(k, JSON.stringify({ ...globalThis.__NBA_SGP__, date: "2026-10-12" })); await R0.sadd("parlay:ids", k); }   // the builds in between left it out (no green sides): put the saved copy back for the grading check
  const gp = await pl.gradeParlays(async () => ({ "OKC @ ATL": { away: 100, home: 90, final: true } }));
  const sps = await pl.loadParlays(); ok(gp === 1 && sps.find((p) => p.type === "sgp").result === "L" && sps.every((p) => p.ret === -p.stake), "parlays graded: a lost leg loses the parlay and its stake", sps.map((p) => [p.type, p.result, p.ret]));
  const ps = pl.summarizeParlays(sps); ok(ps.sgp.decided === 1 && ps.sgp.hits === 0 && ps.sgp.money === -20, "parlay scoreboard numbers", ps); }
{ // 10/19 (owner: "the same" as the NFL fix): a saved parlay is rebuilt until its first leg tips off; one the build no longer makes leaves the record (kept under removed:*)
  const R = globalThis.__TEST_REDIS__, D = "2026-11-03", G = [{ key: "Q1 @ W1", start: "2026-11-03T23:00:00Z" }, { key: "Q2 @ W2", start: "2026-11-04T01:00:00Z" }];
  const P = (lab, game) => ({ type: "sgp_pts", game, start: G.find((g) => g.key === game).start, stake: 5, legs: [{ game, label: lab, line: 1.5 }, { game, label: "Under 220.5", line: 220.5 }], prob: 0.3 });
  const t0 = Date.parse("2026-11-03T12:00:00Z");
  await pl.recordParlays(D, [P("Q1 +1.5", "Q1 @ W1"), P("Q2 +1.5", "Q2 @ W2")], G, t0);
  await pl.recordParlays(D, [P("W1 -1.5", "Q1 @ W1")], G, t0 + 3600e3);
  const a = JSON.parse(await R.get(`parlay:${D}:sgp_pts:Q1 @ W1`)), gone = await R.get(`parlay:${D}:sgp_pts:Q2 @ W2`), kept = JSON.parse(await R.get(`removed:parlay:${D}:sgp_pts:Q2 @ W2`));
  ok(a.legs[0].label === "W1 -1.5" && a.first && !gone && kept && kept.legs[0].label === "Q2 +1.5" && !(await R.smembers("parlay:ids")).includes(`parlay:${D}:sgp_pts:Q2 @ W2`), "parlays (10/19): rebuilt before tip-off; a parlay the build no longer makes leaves the record (kept under removed:*)", { a: a.legs[0].label, gone });
  await pl.recordParlays(D, [P("Q1 +9.5", "Q1 @ W1")], G, Date.parse("2026-11-03T23:30:00Z"));
  ok(JSON.parse(await R.get(`parlay:${D}:sgp_pts:Q1 @ W1`)).legs[0].label === "W1 -1.5", "parlays (10/19): never changed once the first leg has tipped off");
  const PP = (labs) => ({ type: "pp6", game: null, start: labs.some((l) => l[1] === "Q1 @ W1") ? G[0].start : G[1].start, stake: 5, legs: labs.map(([lab, game]) => ({ game, label: lab, market: "prop", line: 4.5 })), prob: 0.4 });
  await pl.recordParlays(D, [PP([["A Pts Under 4.5", "Q1 @ W1"], ["B Pts Under 4.5", "Q2 @ W2"]])], G, t0);
  await pl.recordParlays(D, [PP([["B Pts Under 4.5", "Q2 @ W2"], ["C Pts Under 4.5", "Q2 @ W2"]])], G, Date.parse("2026-11-03T23:30:00Z"));   // built after Q1 tipped: Q1's legs are left out
  ok(JSON.parse(await R.get(`parlay:${D}:pp6`)).legs[0].label === "A Pts Under 4.5", "parlays (10/21): an across-game parlay stays locked once its first leg tipped, even when the new build starts later");
  await R.del(`parlay:${D}:pp6`); await R.srem("parlay:ids", `parlay:${D}:pp6`);
  for (const k of await R.keys(`*parlay:${D}*`)) await R.del(k); await R.srem("parlay:ids", `parlay:${D}:sgp_pts:Q1 @ W1`); }

// ---------- my bets
{ ok(mb.isNba("aec-nba-tor-det-2026-10-16", {}) && mb.isNba("x", { title: "Raptors vs. Pistons" }) && !mb.isNba("aec-nfl-dal-phi", { title: "Cowboys vs Eagles" }), "NBA bets only");
  const win = mb.resolvedFrom({ positionResolution: { marketSlug: "nba-x", beforePosition: { netPosition: "10", cost: { value: "4.00" }, realized: { value: "0" } }, afterPosition: { realized: { value: "10" } } } });
  const loss = mb.resolvedFrom({ positionResolution: { marketSlug: "nba-x", beforePosition: { netPosition: "10", cost: { value: "4.00" }, realized: { value: "0" } }, afterPosition: { realized: { value: "0" } } } });
  ok(win && win.win && near(win.pl, 6) && loss && !loss.win && near(loss.pl, -4), "resolved bet win / loss P&L", [win, loss]);
  ok(near(mb.soldFrom({ trade: { marketSlug: "nba-y", realizedPnl: { value: "1.25" }, qty: "5", price: { value: "0.6" } } }).pl, 1.25) && mb.soldFrom({ trade: { marketSlug: "z", realizedPnl: { value: "0" } } }) === null, "sold bet P&L");
  { const no = mb.soldFrom({ trade: { marketSlug: "aec-nba-bos-det-2026-10-20", realizedPnl: { value: "63.08" }, effectiveRealizedPnl: { value: "-31.94" }, qty: "100", price: { value: "0.975" } } });
    ok(no && near(no.pl, -31.94) && no.fixed && !mb.soldFrom({ trade: { marketSlug: "nba-y", realizedPnl: { value: "1.25" }, qty: "5", price: { value: "0.6" } } }).fixed, "sold (10/19): a NO-side sale uses effectiveRealizedPnl, not the YES side's realizedPnl"); }
  const s = mb.summarizeLedger({ a: { id: "a", cost: 4, resolved: { win: true, pl: 6, t: "2026-10-20" } }, b: { id: "b", cost: 5, resolved: { win: false, pl: -5, t: "2026-10-21" } }, c: { id: "c", cost: 2, sold: { pl: 0.5, t: "2026-10-22" } }, d: { id: "d", cost: 3 } });
  ok(s.record.w === 1 && s.record.l === 1 && s.record.sold === 1 && near(s.record.pl, 1.5) && s.record.staked === 11 && s.open.length === 1 && s.settled[0].id === "c", "ledger summary", s.record); }
// 10/17: a Polymarket account combo with NBA legs is an NBA bet; its legs are labeled (spread / moneyline / total) and listed under it
{ const L = [{ slug: "asc-nba-gs-sa-2026-10-22-neg-4pt5", eventSlug: "nba-gs-sa-2026-10-22", outcome: "+4.50", state: "COMBO_LEG_STATE_WON", team: { abbreviation: "gs" } },
    { slug: "aec-nba-bos-det-2026-10-22", eventSlug: "nba-bos-det-2026-10-22", outcome: "Pistons", state: "", team: { abbreviation: "det" } },
    { slug: "tsc-nba-bos-det-2026-10-22-total-221pt5", eventSlug: "nba-bos-det-2026-10-22", outcome: "Over", state: "COMBO_LEG_STATE_LOST" }];
  ok(mb.isAcctCombo("crossd-1") && mb.isAcctCombo("caoc-1") && !mb.isAcctCombo("aec-nba-x") && mb.nbaLegs(L) && !mb.nbaLegs([...L, { eventSlug: "nfl-buf-lv-2026-10-18" }]) && !mb.nbaLegs([]), "NBA combo = every leg an NBA game");
  const P = mb.comboPicks(mb.slimLegs(L));
  ok(P[0].label === "GSW +4.5" && P[0].team === "GSW" && P[0].result === "W" && P[0].game === "GSW @ SAS" && P[1].label === "DET ML" && P[1].result === null
    && P[2].label === "Over 221.5" && P[2].kind === "total" && !P[2].team && P[2].result === "L" && P[2].date === "2026-10-22", "NBA combo legs labeled", P);
  const f = { away: 110, home: 115, final: true };
  ok(mb.markLeg(P[1], f).result === "W" && mb.markLeg({ ...P[0], result: null }, f).result === "L" && mb.markLeg({ ...P[2], result: null }, f).result === "W"
    && mb.markLeg({ label: "Under 230.5", game: "BOS @ DET" }, f).result === "W" && mb.markLeg(P[1], { ...f, final: false }).result === null, "unmarked NBA legs graded from the final score");
  const s2 = mb.summarizeLedger({ "crossd-1": { id: "crossd-1", title: "", cost: 5, legs: mb.slimLegs(L) } });
  ok(s2.open[0].picks.length === 3, "ledger combo carries its legs");
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/`\$\{e\.picks\.length\} picks`/.test(app) && !/Combo · /.test(app) && /\(e\.picks \|\| \[\]\)\.map\(\(p\) => legRow\(p, lk\)\)/.test(app) && /legTxt\(p\.result, `\$\{p\.team \? tlogo/.test(app), "NBA My bets lists a combo's legs (✓ / ✗, logo, green / red)");
  ok(/sc\.st === "in"/.test(app) && /● LIVE · \$\{esc\(liveSc\(lk\[0\]\)\.lbl/.test(app) && /const lk = settled \? \[\] : liveOf\(e\)/.test(app) && /\$\{betName\(e\)\}\$\{lv \? " " \+ lv\.trim\(\) : ""\}/.test(app) && /panel-record"\)\.classList\.contains\("on"\) && BETS\) renderBets\(\)/.test(app), "NBA My bets: an open bet in a live game says ● LIVE · quarter clock (no score), refreshed with the live scores"); }
// 10/27 (owner: "Fix the player props ... Also fix the straight bets"): prop legs named and graded, totals carry their number, singles are bets
{ const R = globalThis.__TEST_REDIS__, real = globalThis.fetch;
  const ps = mb.propStat("astatc-nba-atl-hou-2026-10-26-pra-ametho-gte25");
  ok(ps && ps.game === "ATL @ HOU" && ps.date === "2026-10-26" && ps.stat === "pra" && ps.code === "ametho" && ps.n === 25 && ps.line === 24.5 && ps.what === "25+ PRA" && mb.propStat("asc-nba-atl-hou-2026-10-26-pos-2pt5") === null, "NBA prop slug read (stat, code, N+ = line N - 0.5)", ps);
  const L = [{ slug: "astatc-nba-atl-hou-2026-10-26-pra-ametho-gte25", eventSlug: "nba-atl-hou-2026-10-26", title: "ATL Hawks vs. HOU Rockets", outcome: "Yes", state: "COMBO_LEG_STATE_PENDING", team: { abbreviation: "hou" }, player: "Amen Thompson" },
    { slug: "astatc-nba-min-cle-2026-10-26-reb-donmit-gte4", eventSlug: "nba-min-cle-2026-10-26", title: "MIN Timberwolves vs. CLE Cavaliers", outcome: "No", state: "", team: { abbreviation: "cle" } },
    { slug: "tsc-nba-gs-den-2026-10-26-241pt5", eventSlug: "nba-gs-den-2026-10-26", title: "GS Warriors vs. DEN Nuggets", outcome: "Under", state: "" }];
  const P = mb.comboPicks(mb.slimLegs(L));
  ok(P[0].label === "Amen Thompson 25+ PRA" && P[0].kind === "prop" && P[0].team === "HOU" && P[0].game === "ATL @ HOU" && P[0].player === "Amen Thompson" && P[0].stat === "pra" && P[0].line === 24.5 && P[0].side === "over"
    && P[1].label === "donmit under 4 Reb" && P[1].side === "under" && P[1].team === "CLE" && P[2].label === "Under 241.5" && P[2].kind === "total" && P[2].game === "GSW @ DEN", "NBA combo prop legs read the player + the bet (a nameless leg keeps its code until the name is found); an NBA total leg carries its number", P);
  const box = { final: true, players: { "amen thompson": { pts: 18, reb: 9, ast: 4, pra: 31 }, "donovan mitchell": { pts: 30, reb: 3, ast: 5, pra: 38 } } };
  ok(mb.markProp(P[0], box).result === "W" && mb.markProp(P[0], box).actual === 31 && mb.markProp({ ...P[1], player: "Donovan Mitchell" }, box).result === "W" && mb.markProp({ ...P[0], line: 34.5 }, box).result === "L"
    && mb.markProp({ ...P[0], player: "Nobody Here" }, box).result === "P" && mb.markProp(P[0], { ...box, final: false }).result === null && mb.markProp({ ...P[0], result: "L" }, box).result === "L" && mb.markProp(P[2], box) === P[2],
    "NBA prop legs graded from the box score: over / under, a player not in a final game's box = push, an unfinished game or a marked leg untouched");
  const names = mb.usPlayerNames({ markets: [{ slug: "astatc-nba-atl-hou-2026-10-26-pra-ametho-gte25", titleShort: "Amen Thompson 25+ Pts + Reb + Ast", marketSides: [{ team: { abbreviation: "hou" } }] }, { slug: "asc-nba-atl-hou-2026-10-26-pos-2pt5", titleShort: "ATL +2.5" }] });
  ok(names["astatc-nba-atl-hou-2026-10-26-pra-ametho-gte25"].name === "Amen Thompson" && names["astatc-nba-atl-hou-2026-10-26-pra-ametho-gte25"].team === "HOU" && Object.keys(names).length === 1, "Polymarket US event -> player name + team per prop market", names);
  ok(mb.codeName("ametho", ["Amen Thompson", "Alperen Sengun", "Kevin Durant"]) === "Amen Thompson" && mb.codeName("donmit", ["Donovan Mitchell", "Dean Wade"]) === "Donovan Mitchell" && mb.codeName("jamhar", ["James Harden", "Jaylon Tyson"]) === "James Harden" && mb.codeName("zzz", ["Amen Thompson"]) === null, "player code -> name among the game's recorded names");
  // nameLegs: the event names a leg's player (one gateway read, cached 7 days); a leg the event does not list falls back to the recorded prop names
  globalThis.fetch = async (u) => (String(u).includes("gateway.polymarket.us/v1/events/slug/nba-atl-hou-2026-10-26") ? { ok: true, json: async () => ({ event: { markets: [{ slug: "astatc-nba-atl-hou-2026-10-26-pra-ametho-gte25", titleShort: "Amen Thompson 25+ Pts + Reb + Ast", marketSides: [{ team: { abbreviation: "hou" } }] }] } }) } : { ok: false, status: 404, json: async () => ({}) });
  await R.set("nbaprops:2026-10-26:MIN @ CLE", JSON.stringify({ first: "t", t: "t", m: { "Donovan Mitchell|reb|3.5": [0.6, 0.5, 0.5, 0.6, "t"], "James Harden|reb|3.5": [0.6, 0.5, 0.5, 0.6, "t"] } }));
  const L2 = mb.slimLegs(L.map((l) => ({ ...l, player: undefined })));
  const changed = await mb.nameLegs(L2);
  ok(changed && L2[0].player === "Amen Thompson" && L2[1].player === "Donovan Mitchell" && !L2[2].player && (await R.get("usnames:nba:nba-atl-hou-2026-10-26")) && mb.comboPicks(L2)[1].label === "Donovan Mitchell under 4 Reb", "nameLegs: names from the event (cached) or the recorded prop names; the total leg untouched", L2);
  globalThis.fetch = real; await R.del("usnames:nba:nba-atl-hou-2026-10-26"); await R.del("nbaprops:2026-10-26:MIN @ CLE");
  // singles: an "astatc-" market traded on its own is a bet (NFL's rule); the rest are combo legs
  const sl = "astatc-nba-atl-hou-2026-10-26-pts-kevdur-gte25", acts = { activities: [{ type: "ACTIVITY_TYPE_TRADE", trade: { marketSlug: sl } }, { type: "ACTIVITY_TYPE_TRADE", trade: { marketSlug: "crossd-abc" } }] }, sing = mb.tradedSingles(acts);
  ok(sing.has(sl) && sing.size === 1 && !mb.isComboLeg(sl, {}, sing) && mb.isComboLeg("astatc-nba-atl-hou-2026-10-26-pra-ametho-gte25", {}, sing) && mb.isComboLeg(sl) && mb.isComboLeg("x", { state: "COMBO_LEG_STATE_PENDING" }, sing) && !mb.isComboLeg("aec-nba-atl-hou-2026-10-26", {}, sing),
    "NBA singles: an astatc- market traded on its own is a bet; other astatc- markets and anything marked COMBO_LEG stay legs", [...sing]);
  const pr = mb.propOf(sl, { outcome: "Yes", subject: { name: "Kevin Durant 25+ points", image: "https://static.polymarket.us/images/teams/basketball/nba/hou/jerseys/7.png" } });
  const pr2 = mb.propOf(sl, { outcome: "No" }, { name: "Kevin Durant", team: "HOU" });
  ok(pr && pr.label === "Kevin Durant 25+ Pts" && pr.team === "HOU" && pr.game === "ATL @ HOU" && pr.date === "2026-10-26" && pr.kind === "prop" && pr.stat === "pts" && pr.line === 24.5 && pr.side === "over" && pr2.label === "Kevin Durant under 25 Pts" && pr2.side === "under" && pr2.team === "HOU",
    "NBA single player bet: player + bet, team, game, date; the No side reads under", { pr, pr2 });
  ok(mb.markProp(pr, { final: true, players: { "kevin durant": { pts: 27 } } }).result === "W" && mb.markProp(pr2, { final: true, players: { "kevin durant": { pts: 27 } } }).result === "L", "a single prop bet is graded from the box score too");
  // loadMyBets: a settled combo's unmarked prop leg and total leg are graded from ESPN (one scoreboard + one summary read per game day)
  const comp = { competitors: [{ homeAway: "away", team: { abbreviation: "ATL" } }, { homeAway: "home", team: { abbreviation: "HOU" } }], status: { type: { completed: true } } };
  const summary = { header: { competitions: [comp] }, boxscore: { players: [{ statistics: [{ names: ["MIN", "PTS", "REB", "AST", "3PT", "STL", "BLK"], athletes: [{ athlete: { displayName: "Amen Thompson" }, stats: ["34", "18", "9", "4", "1-3", "2", "1"] }] }] }] } };
  const sb = { events: [{ id: "401", status: { type: { completed: true, state: "post" } }, competitions: [{ ...comp, competitors: comp.competitors.map((c) => ({ ...c, score: c.homeAway === "away" ? "110" : "121" })) }] }] };
  globalThis.fetch = async (u) => (/scoreboard\?dates=20261026/.test(String(u)) ? { ok: true, json: async () => sb } : /summary\?event=401/.test(String(u)) ? { ok: true, json: async () => summary } : { ok: false, status: 404, json: async () => ({}) });
  await R.set("mybets:nba:ledger", JSON.stringify({ "crossd-p1": { id: "crossd-p1", title: "", cost: 7, shares: 36, legs: [L[0], { slug: "tsc-nba-atl-hou-2026-10-26-230pt5", eventSlug: "nba-atl-hou-2026-10-26", title: "ATL Hawks vs. HOU Rockets", outcome: "Over", state: "" }], closedAt: "2026-10-27T05:00:00Z", resolved: { win: true, pl: 29, t: "2026-10-27T04:00:00Z" } },
    [sl]: { id: sl, title: "ATL Hawks vs. HOU Rockets", outcome: "Yes", cost: 5, shares: 10, single: true, prop: { ...pr, player: "Amen Thompson", stat: "pra", line: 24.5, label: "Amen Thompson 25+ PRA" } } }));
  let sbReads = 0; const fx0 = globalThis.fetch; globalThis.fetch = async (u) => { if (/scoreboard\?dates=20261026/.test(String(u))) sbReads++; return fx0(u); };
  const out = await mb.loadMyBets();
  const c1 = out.settled.find((e) => e.id === "crossd-p1"), s1 = out.open.find((e) => e.id === sl);
  ok(c1 && c1.picks[0].result === "W" && c1.picks[0].actual === 31 && c1.picks[1].label === "Over 230.5" && c1.picks[1].result === "W" && s1 && s1.prop.result === "W", "loadMyBets: an unmarked prop leg graded from the box score, the total from the final score, an open single's prop graded too", { c1: c1 && c1.picks, s1: s1 && s1.prop });
  // 10/27: ONE scoreboard read for the day (the promise is shared, not four reads at once), and the grades are written back to the ledger so the next load needs no ESPN at all
  const led = JSON.parse(await R.get("mybets:nba:ledger"));
  ok(sbReads === 2 && led["crossd-p1"].legs[0].result === "W" && led["crossd-p1"].legs[0].actual === 31 && led["crossd-p1"].legs[1].result === "W" && led[sl].prop.result === "W", "loadMyBets: the day's box score is read once per day (two days -> 2 reads, not one per leg) and the grades are saved on the ledger's legs", { sbReads, legs: led["crossd-p1"].legs.map((l) => [l.result, l.actual]), prop: led[sl].prop.result });
  globalThis.fetch = async () => { throw new Error("ESPN down"); };
  const out2 = await mb.loadMyBets(); const c2 = out2.settled.find((e) => e.id === "crossd-p1"), s2 = out2.open.find((e) => e.id === sl);
  ok(c2 && c2.picks[0].result === "W" && c2.picks[0].actual === 31 && c2.picks[1].result === "W" && s2 && s2.prop.result === "W", "loadMyBets: with ESPN down the saved grades still show (nothing is re-read)");
  // a resync carries the saved grades onto the fresh legs Polymarket sends (it already carried the names)
  const fresh = mb.slimLegs([{ slug: L[0].slug, eventSlug: L[0].eventSlug, title: L[0].title, outcome: "Yes", state: "COMBO_LEG_STATE_PENDING", team: { abbreviation: "hou" } }]);
  ok(!fresh[0].player && !fresh[0].result, "slimLegs: Polymarket's leg carries no name and no grade");
  globalThis.fetch = real; await R.del("mybets:nba:ledger");
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/e\.prop \? `\$\{e\.prop\.result \? legMark\(e\.prop\.result\) \+ " " : ""\}\$\{e\.prop\.team \? tlogo\(e\.prop\.team\) : ""\}\$\{pnm\(e\.prop\.label\)\}`/.test(app) && /openBySlot\(openB\)/.test(app) && /return block\(list\.filter\(isSingle\), "SINGLES"\) \+ block\(/.test(app) && /firstSingles = \(a\) => \[\.\.\.a\.filter\(isSingle\), \.\.\.a\.filter\(\(e\) => !isSingle\(e\)\)\]/.test(app) && !/stampFor|playStamps/.test(app),
    "NBA My bets page: a single shows the player + bet with the logo and its mark, singles sit on top of the open list, no HIT / MISS stamp (10/27)");
  ok(/const cMoney = \(v\) => \(v == null \? "—" : `<span class="\$\{Math\.abs\(v\) < 0\.005 \? "" : v > 0 \? "g" : "r"\}">\$\{Math\.abs\(v\) < 0\.005 \? "\$" : v > 0 \? "\+\$" : "−\$"\}/.test(app), "NBA page: a zero amount reads $0.00 with no sign and no colour, like the NFL page (10/27)");
  ok(/if \(PROPTEAM !== "all" && !teams\.includes\(PROPTEAM\)\) PROPTEAM = "all";/.test(app) && /if \(PROPTEAM !== "all" && !teams\.includes\(PROPTEAM\)\) PROPTEAM = "all";/.test(readFileSync(new URL("../../public/app.js", import.meta.url), "utf8")),
    "Player props, both sports: a team chosen on another day / week / tab with no rows here falls back to All teams instead of an empty list under a drop-down reading All teams (10/27)"); }

// ---------- sign-in (same as the NFL app: Basic login, then a 1-year "remember this phone" cookie of its own)
if (existsSync(new URL("../middleware.ts", import.meta.url))) { const ts = (await import("typescript")).default, { writeFileSync, mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "mw-")), src = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(join(dir, "next-server.mjs"), `
    export class NextResponse { constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.headers = new Map(Object.entries(init.headers || {})); this.cookieJar = {}; this.cookies = { set: (n, v, o) => { this.cookieJar[n] = { value: v, ...o }; } }; this.next_ = false; }
      static next() { const r = new NextResponse(null); r.next_ = true; return r; } }
    export class NextRequest {}`);
  writeFileSync(join(dir, "mw.mjs"), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('"next/server"', '"./next-server.mjs"'));
  const mw = await import(join(dir, "mw.mjs"));
  process.env.SITE_USERNAME = " me "; process.env.SITE_PASSWORD = "p:ss word ";
  const req = ({ auth, cookie, path = "/index.html", site } = {}) => ({ nextUrl: { pathname: path }, headers: { get: (h) => ({ authorization: auth, "sec-fetch-site": site }[h.toLowerCase()] || null) }, cookies: { get: (n) => (n === "nba_remember" && cookie ? { value: cookie } : undefined) } });
  const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
  const none = await mw.middleware(req());
  ok(none.status === 401 && /NBA BETTORS/.test(none.headers.get("WWW-Authenticate")), "no sign-in -> asked to sign in");
  const good = await mw.middleware(req({ auth: basic("me", "p:ss word") }));
  const ck = good.cookieJar.nba_remember;
  ok(good.next_ && ck && /^[0-9a-f]{64}$/.test(ck.value) && ck.maxAge === 365 * 24 * 3600 && ck.httpOnly && ck.secure && ck.sameSite === "lax", "good sign-in lets you in and remembers this phone for a year (cookie is a hash, never the password)", ck);
  ok(!ck.value.includes("p:ss"), "the cookie does not contain the password");
  ok((await mw.middleware(req({ auth: basic("me", "wrong") }))).status === 401 && (await mw.middleware(req({ auth: basic("you", "p:ss word") }))).status === 401, "wrong password or user -> refused");
  ok((await mw.middleware(req({ cookie: ck.value }))).next_ === true, "a remembered phone gets in with no sign-in");
  ok((await mw.middleware(req({ cookie: "0".repeat(64) }))).status === 401 && (await mw.middleware(req({ cookie: "x" }))).status === 401, "a wrong cookie is refused");
  process.env.SITE_PASSWORD = "changed";
  ok((await mw.middleware(req({ cookie: ck.value }))).status === 401, "changing the password signs every remembered phone out");
  process.env.SITE_PASSWORD = "p:ss word ";
  ok((await mw.middleware(req({ auth: basic("me", "p:ss word"), path: "/api/snapshot", site: "cross-site" }))).status === 403, "cross-site requests to /api are blocked");
  ok((await mw.middleware(req({ auth: basic("me", "p:ss word"), path: "/api/snapshot", site: "same-origin" }))).next_ === true, "the scheduler's own request gets through");
  delete process.env.SITE_USERNAME; delete process.env.SITE_PASSWORD;
  const unset = await mw.middleware(req({ auth: basic("", "") }));
  ok(unset.status === 503 && !unset.next_ && /SITE_USERNAME and SITE_PASSWORD/.test(unset.body), "no username/password set on the server -> nobody gets in, and the page says why (not a sign-in box nothing can pass)", unset.status);
  ok((await mw.middleware(req({ cookie: "0".repeat(64) }))).status === 503 && (await mw.middleware(req({ auth: basic("me", "p:ss word") }))).status === 503, "unset: no cookie or password opens it either");
  const nfl = src.match(/REMEMBER = "(\w+)"/)[1]; ok(nfl === "nba_remember" && !/nfl[_|-]/i.test(src), "its own cookie name and hash salt (an NFL sign-in does not carry over)", nfl); }

// ---------- page structure: the stylesheet is well-formed, every tab has a panel, only one panel starts open
{ const html = readFileSync(new URL("../../public/nba/index.html", import.meta.url), "utf8");
  const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0, min = 0, buf = "", stray = [];
  for (const ch of css) { if (ch === "{") { depth++; buf = ""; } else if (ch === "}") { depth--; min = Math.min(min, depth); buf = ""; } else { buf += ch; if (depth === 0 && ch === ";") { stray.push(buf.trim().slice(0, 60)); buf = ""; } } }
  ok(depth === 0 && min === 0 && stray.length === 0, "stylesheet is well-formed (no half-cut rules; a stray fragment once hid the 'panel' rule and showed every tab at once)", { depth, min, stray });
  ok(/\.panel\s*\{\s*display:\s*none;?\s*\}/.test(css) && /\.panel\.on\s*\{\s*display:\s*block;?\s*\}/.test(css), "inactive panels are hidden, the active one shown");
  const panels = [...html.matchAll(/class="panel( on)?" id="panel-(\w+)"/g)].map((m) => [m[2], !!m[1]]), tabs = ["lines", "record", "models", "alerts"];
  ok(!/class="tabs"/.test(html) && !/id="menu-btn"/.test(html) && !/shead/.test(html) && /src="\/shell\.js"/.test(html) && /href="\/shell\.css"/.test(html), "merged site (10/17): no bottom tab bar, no menu button; 10/18 night: no NEXT GAME header strip");
  ok(tabs.every((t) => panels.some(([n]) => n === t)) && panels.length === 5 && panels.some(([n]) => n === "props") && panels.some(([n]) => n === "alerts") && panels.filter(([, on]) => on).length === 1 && panels.find(([, on]) => on)[0] === "lines", "every tab has a panel (plus the alerts panel) and only Game Lines starts open", panels);
  ok(/id="bets-sw"/.test(html) && /data-bv="mine"/.test(html) && /data-bv="model"/.test(html) && !/id="lab-sub"/.test(html) && /id="lab"/.test(html), "Bets tab: My bets | Model bets toggle and the model-bets list; the types are menu sub tabs (no docked strip)");
  ok(!/panel-td|Anytime TD|panel-lab/i.test(html) && /id="al-read"/.test(html) && !/id="al-chips"/.test(html), "no Anytime-TD / Model Picks panel; Alerts has Mark all read; the kinds are menu sub tabs (no docked strip) chips");
  const nfl = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  if (nfl) { const sel = (h) => new Set([...h.slice(h.indexOf("<style>"), h.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2].trim()));
    const miss = [...sel(nfl)].filter((x) => !sel(html).has(x) && !/tdr|\.td|scorers|\.sc\b|prow|pos\b|injb|gapstrip|labslot|wksel|\.stack|lines-on|thlm/.test(x));   // thlm = the NFL helmets on the tiles (10/28)
    ok(miss.length === 0, "the stylesheet carries every rule of the NFL app's current look (only TD-page rules may differ)", miss.slice(0, 8)); } }

// ---------- front end: the NFL app's card and layout, NBA only, no notes
{ const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/recRow\("SHOT QUALITY · total", rc\["rule:shotq\|total"\]\)/.test(app), "Models tab: a SHOT QUALITY record row");
  ok(/PICK w\/ POINTS/.test(app) && /cardBody\(/.test(app) && /moreBox\(/.test(app) && /pBlock\(/.test(app) && /plPay/.test(app) && /applyBetsView/.test(app) && /labStats\(/.test(app) && /mSec\(/.test(app), "page: PICK / PICK w/ POINTS card with MORE, parlay blocks, Bets toggle, Models tiles + flat sections");
  ok(/const legPct = \(l\) => \{ const v = \(l\.prob \|\| 0\) \* 100, k = l\.market \|\| l\.kind; return k === "spread" \|\| k === "total" \? \(v >= 56 \? Math\.round\(v\) : Math\.floor\(v\)\) : Math\.round\(v\); \};/.test(app) && /<span class="pt2 mod">\$\{legPct\(l\)\}%<\/span>/.test(app) && !/mod">\$\{Math\.round\(\(l\.prob \|\| 0\) \* 100\)\}%/.test(app) && /<div class="ptb pth"><span class="pt1">LEG<\/span><span class="pt2">MODEL<\/span>/.test(app), "page: a parlay leg's % follows the NFL rounding rule -- a spread / total leg under 56% rounds DOWN (10/21: a 55.6% leg read 56%)");
  ok(!/LEAN/.test(app) && !/TEASER/.test(app) && !/Anytime TD|anytime-td/i.test(app), "page: no LEAN, no teasers, no TD");
  ok(!/has not beaten the market|Watching only|not a pick\b|Tested on 2024-26 only|Saved and graded to|what the model counted|can't see/i.test(app), "page: no explanatory notes (owner 10/15: show data only)");
  ok(/secRow\("SPREAD &amp; ML", injPill\(g, "inj"\)\)/.test(app) && !/secRow\("MONEYLINE"/.test(app) && /secRow\("TOTALS"\)/.test(app) && /class="trow"><div class="sh">\$\{title\}<\/div>\$\{pills\}/.test(app), "game page (10/23, = NFL): SPREAD & ML + TOTALS section rows, the Injuries pill on the SPREAD & ML row");
  ok(/<div class="bband"><\/div>\$\{mkGrid\(cells\)\}\$\{tipLine\(g, kind\)\}<div class="hd hm ihd">MODEL\$\{IBTN\}<\/div>\$\{whyBox\(g, kind, info\)\}\$\{modelCell\(g, kind\)\}/.test(app) && /\[`<div class="k">SPORTSBOOK<\/div>`, pmHead\(g\)/.test(app) && !/<div class="hd">MARKET<\/div>/.test(app) && !/class="live"/.test(app) && !/class="f"/.test(app) && !/grid-row:span 2/.test(app), "game page card (10/28, = NFL sketch): SPORTSBOOK | POLYMARKET in row pairs (no MARKET word, a blurred band), the tip-off line under it, MODEL below it full width; the injuries drop-down opens at the top of the card"); }
{ // NBA information only: no NFL words anywhere in the shipped code
  const files = []; const walk = (d) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (["node_modules", ".next", ".git", "fixtures", "data", "__pycache__"].includes(f)) continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(js|mjs|ts|tsx|py|html|json)$/.test(f) && f !== "package-lock.json" && f !== "run.mjs" && f !== "tests_service.py") files.push(p); } };
  walk(new URL("..", import.meta.url).pathname);
  const hits = files.filter((p) => /nflverse|touchdown|quarterback|\bTD\b|anytime td|\bChiefs\b|\bCowboys\b|\bEagles\b|\bPackers\b/i.test(readFileSync(p, "utf8")));
  ok(hits.length === 0, "no NFL data sources, football terms or NFL teams in the NBA code", hits); }


// ---------- sportsbook odds (made-up Odds API replies: the shape is from its documentation, not from a live pull)
{ const bks = await import("../lib/books.js");
  const name = (a) => TEAMS[a].name;
  const mk = (away, home, bookies) => ({ away_team: name(away), home_team: name(home), bookmakers: bookies.map((b) => ({ key: b.k, markets: [
    { key: "h2h", outcomes: [{ name: name(home), price: b.ml[1] }, { name: name(away), price: b.ml[0] }] },
    { key: "spreads", outcomes: [{ name: name(home), price: -110, point: b.sp }, { name: name(away), price: -110, point: -b.sp }] },
    { key: "totals", outcomes: [{ name: "Over", price: -110, point: b.tl }, { name: "Under", price: -110, point: b.tl }] }] })) });
  const sample = [mk("OKC", "ATL", [{ k: "a", ml: [-200, 170], sp: 5.5, tl: 228.5 }, { k: "b", ml: [-190, 160], sp: 5.5, tl: 228.5 }, { k: "c", ml: [-210, 175], sp: 6, tl: 229 }])];
  const pb = bks.parseBooks(sample)["OKC @ ATL"];
  ok(pb && pb.ml.n === 3 && pb.ml.away < 0 && pb.ml.home > 0, "books: moneyline consensus", pb && pb.ml);
  ok(pb.spread.homeSpread === 5.5 && pb.spread.n === 2 && pb.spread.home === -100 && pb.spread.away === -100, "books: spread (margin removed: -110 both sides = -100) uses the most common line and only books on it", pb.spread);
  ok(pb.total.line === 228.5 && pb.total.n === 2, "books: total uses the most common line", pb.total);
  ok(Object.keys(bks.parseBooks([{ away_team: "Nobody", home_team: "Else", bookmakers: [] }])).length === 0, "books: unknown teams skipped");

  const T = (iso) => Date.parse(iso);
  const night = [{ key: "OKC @ ATL", start: "2026-11-10T23:00:00Z" }, { key: "A @ B", start: "2026-11-11T02:00:00Z" }];   // 4 PM and 7 PM Pacific, Nov 10
  ok(bks.booksDue(night, T("2026-11-10T14:59:00Z")) === null, "books: nothing before 7 AM Pacific");
  ok(bks.booksDue(night, T("2026-11-10T15:00:00Z")).slot === "am", "books: 7 AM pull on a game day");
  ok(bks.booksDue(night, T("2026-11-10T19:59:00Z")).slot === "am", "books: still the morning pull until 3 hours before the first tip");
  ok(bks.booksDue(night, T("2026-11-10T21:00:00Z")) === null, "books: inside 3 hours of the first tip the morning pull waits for the pre-tip pull (one paid pull, not two)");
  { const d = bks.booksDue(night, T("2026-11-10T22:00:00Z")); ok(d.slot === "tip" && d.markets === "spreads,totals", "books (10/29): a spreads + totals pull within the hour before a tip-off", d); }
  ok(bks.booksDue(night, T("2026-11-10T22:30:00Z"), "2026-11-10T22:00:00Z") === null, "books: no second pull for the same tip-off once a fresh one exists");
  { const d = bks.booksDue(night, T("2026-11-11T01:30:00Z"), "2026-11-10T22:00:00Z"); ok(d && d.slot === "tip" && d.id === "tip:2026-11-11T02:00:00Z", "books: the next tip-off wave gets its own pull", d); }
  { const mat = [{ key: "M", start: "2026-12-25T17:00:00Z" }, { key: "N", start: "2026-12-26T01:00:00Z" }];   // Christmas: first tip 9 AM Pacific
    ok(bks.booksDue(mat, T("2026-12-25T15:00:00Z")) === null && bks.booksDue(mat, T("2026-12-25T16:00:00Z")).slot === "tip", "books: a matinee day gets the pre-tip pull only, no separate 7 AM pull"); }
  ok(bks.booksDue([{ key: "X", start: "2026-11-12T03:00:00Z" }], T("2026-11-10T15:30:00Z")) === null, "books: no 7 AM pull on a day without games");
  ok(bks.booksDue(night, T("2026-11-11T05:00:00Z")) === null, "books: nothing once every game has started");

  let calls = 0, lastUrl = "";
  const fake = (body, status = 200, left = "348") => async (url) => { calls++; lastUrl = url; return { ok: status === 200, status, json: async () => body, headers: { get: (h) => (h === "x-requests-remaining" ? left : null) } }; };
  const d1 = T("2026-11-10T16:00:00Z");
  const r1 = await bks.pullBooksIfDue(night, { now: d1, apiKey: "SECRET123", fetcher: fake(sample) });
  ok(r1.pulled && r1.slot === "am" && r1.remaining === 348 && calls === 1, "books: due pull runs once and reads the credits left", r1);
  ok(/basketball_nba/.test(lastUrl) && /markets=h2h%2Cspreads%2Ctotals/.test(lastUrl) && /regions=us/.test(lastUrl), "books: asks for NBA moneyline + spread + total, US books", lastUrl);
  const r2 = await bks.pullBooksIfDue(night, { now: d1 + 600e3, apiKey: "SECRET123", fetcher: fake(sample) });
  ok(!r2.pulled && calls === 1, "books: a slot is only pulled once (no second spend)", r2);
  const r3 = await bks.pullBooksIfDue(night, { now: T("2026-11-10T22:05:00Z"), apiKey: "SECRET123", fetcher: fake(sample, 200, "345") });
  ok(r3.pulled && r3.slot === "tip" && calls === 2 && /markets=spreads%2Ctotals/.test(lastUrl), "books: the pre-tip pull is its own slot (spreads + totals, 2 credits)", r3);
  const stored = await bks.loadBooks();
  ok(stored && stored.remaining === 345 && stored.games["OKC @ ATL"] && stored.slot === "tip" && stored.games["OKC @ ATL"].ml, "books: last pull is kept for the page (the morning moneyline kept)", stored && stored.slot);
  { let n = 0; const seq = async () => { n++; return n === 1 ? { ok: false, status: 502, json: async () => ({}), headers: { get: () => null } } : { ok: true, status: 200, json: async () => sample, headers: { get: () => "300" } }; };
    const b = await bks.fetchBooks("K", seq, "spreads,totals", 0); ok(n === 2 && b.remaining === 300 && b.games["OKC @ ATL"], "books (10/29): a 502 is asked once more before giving up", { n }); }
  const night2 = [{ key: "Q @ R", start: "2026-11-12T01:00:00Z" }];
  const bad = await bks.pullBooksIfDue(night2, { now: T("2026-11-11T16:00:00Z"), apiKey: "SECRET123", fetcher: fake([], 401) });
  ok(!bad.pulled && /401/.test(bad.note) && !/SECRET123/.test(bad.note), "books: a failed pull says why and never prints the key", bad);
  const retry = await bks.pullBooksIfDue(night2, { now: T("2026-11-11T16:30:00Z"), apiKey: "SECRET123", fetcher: fake(sample) });
  ok(retry.pulled, "books: a failed pull gives its slot back, so the next snapshot retries", retry);
  const nokey = await bks.pullBooksIfDue([{ key: "Z", start: "2026-11-20T03:00:00Z" }], { now: T("2026-11-19T16:00:00Z"), apiKey: "", fetcher: fake(sample) });
  ok(!nokey.pulled && /ODDS_API_KEY/.test(nokey.note), "books: no key -> says so, spends nothing", nokey);

  const c0 = calls;
  const fz = await bks.pullBooksIfDue([{ key: "Z", start: "2026-12-20T03:00:00Z" }], { now: T("2026-12-19T09:00:00Z"), apiKey: "SECRET123", fetcher: fake(sample, 200, "340"), force: true });
  ok(fz.pulled && fz.slot === "manual" && calls === c0 + 1, "books: a person can ask for a pull right now (outside the daily slots)", fz);
  // through the slate: the snapshot pulls, the page build only reads
  const before = calls;
  const sPage = await slate.buildSlate({ now: Date.parse("2026-10-12T22:00:00Z"), events, injuries: { teams: {}, t: "x" }, model: null, record: false });
  ok(calls === before, "books: building the page never spends credits");
  process.env.NBA_ODDS_API_KEY = "SECRET123";
  { // a slate that is all preseason never spends credits (the Odds API doesn't list preseason games)
    const before2 = calls;
    const preModel = { ok: true, builtAt: "x", fitThrough: "2026-04-12", patternsBuilt: "x", games: Object.values(Object.fromEntries(polyGames(events).map((g) => [g.key, { key: g.key, away: g.away, home: g.home, preseason: true, model: null, spread: null, total: null, ml: null, injuries: { home: [], away: [] }, teasers: [] }]))) };
    process.env.NBA_ODDS_API_KEY = "SECRET123";
    const sp = await slate.buildSlate({ now: Date.parse("2026-10-12T22:00:00Z"), events, injuries: { teams: {}, t: "x" }, model: preModel, record: false, pullBooks: true, booksFetch: fake(sample) });
    delete process.env.NBA_ODDS_API_KEY;
    ok(calls === before2 && sp.booksPull && !sp.booksPull.pulled, "books: an all-preseason slate spends no credits", sp.booksPull); }
  process.env.NBA_ODDS_API_KEY = "SECRET123";
  const sSnap = await slate.buildSlate({ now: Date.parse("2026-10-12T22:00:00Z"), events, injuries: { teams: {}, t: "x" }, model: null, record: false, pullBooks: true, booksFetch: fake(sample) });
  delete process.env.NBA_ODDS_API_KEY;
  ok(sSnap.booksPull && sSnap.booksPull.pulled && sSnap.books && sSnap.books.remaining === 348, "books: the snapshot pulls when one is due", sSnap.booksPull);
  const og = sSnap.games.find((g) => g.key === "OKC @ ATL");
  ok(og && og.books && og.books.spread && og.books.spread.homeSpread === 5.5, "books: game rows carry the sportsbook lines", og && og.books);
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/SPORTSBOOK/.test(app) && !/marketCard\(g, "ml"/.test(app) && /marketCard\(g, "spread"/.test(app) && /marketCard\(g, "total"/.test(app) && /B\.ml \? ml\(odds\(B\.ml\.home\), odds\(B\.ml\.away\)\)/.test(app) && /B\.spread \? sp\(B\.spread\.homeSpread, odds\(B\.spread\.home\), odds\(B\.spread\.away\)\)/.test(app), "page shows sportsbook lines in both cards (spread rows then moneyline rows, like Polymarket's side)"); }


// ---------- System status ("is everything running?")
{ const st = await import("../lib/status.js");
  const T0 = Date.parse("2026-11-01T12:00:00Z");
  process.env.NBA_MODEL_SERVICE_URL = "https://model.example"; process.env.NBA_MODEL_SERVICE_TOKEN = "tok";
  let seenHeader = null;
  const up = async (url, o) => { seenHeader = o.headers["X-Model-Token"]; return { ok: true, status: 200, json: async () => ({ ok: true, engine: true }) }; };
  const loading = async () => ({ ok: false, status: 503, json: async () => ({ ok: false, engine: false }) });
  const down = async () => { throw new Error("connect ECONNREFUSED"); };
  const h1 = await st.railwayHealth(up); ok(h1.ok && h1.code === 200 && seenHeader === "tok", "status: model service answering, token sent", h1);
  ok(!(await st.railwayHealth(loading)).ok, "status: a loading / 503 model service is NOT 'answering'");
  const hd = await st.railwayHealth(down); ok(!hd.ok && /ECONNREFUSED/.test(hd.err), "status: unreachable model service says why", hd);
  await st.markSnapshot({ games: 9, modelOk: true }, T0);
  await st.logError("model", "old problem", T0 - 3 * 86400e3);
  await st.logError("books", "Odds API answered 401", T0 - 3600e3);
  const g = await st.getStatus({ now: T0, fetcher: up });
  ok(g.lastSnapshot && g.lastSnapshot.games === 9 && g.railway.ok, "status: last snapshot and Railway reported", g);
  ok(g.errors.length === 1 && g.errors[0].where === "books", "status: only errors from the last 2 days are shown", g.errors);
  { const { getRedis: gr } = await import("../lib/redis.js"); await st.logError("pinnacle", "Pinnacle 5270 returned 403", T0 - 7200e3); await gr().set("ok:pinnacle", new Date(T0 - 3600e3).toISOString());
    const g2 = await st.getStatus({ now: T0, fetcher: up });
    ok(!g2.errors.some((e) => e.where === "pinnacle") && g2.errors.some((e) => e.where === "books"), "status (10/20): a Pinnacle error from before a later good pull is hidden, others stay", g2.errors);
    await gr().del("ok:pinnacle"); }
  delete process.env.NBA_MODEL_SERVICE_URL; delete process.env.NBA_MODEL_SERVICE_TOKEN;
  ok(!(await st.railwayHealth(up)).ok, "status: no MODEL_SERVICE_URL -> not answering");
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/m-sys/.test(app) && /Errors \(last 2 days\)/.test(app) && /Last snapshot/.test(app) && /sy\.watch/.test(app), "Models tab has the System section with the watchdog list"); }


// ---------- preseason TEST picks: shown as TEST, saved and graded, but never a pick, best bet or parlay leg
{ const model = { ok: true, builtAt: "x", fitThrough: "2026-04-12", patternsBuilt: "x", games: [{ key: "BKN @ WAS", away: "BKN", home: "WAS", preseason: true, model: { margin: 3, total: 225 },
    spread: { line: -8.5 }, ml: { pick: { label: "WAS ML", pct: 70, tier: "test", testTier: "pick", team: "WAS", source: "market win chance" } }, total: { line: 223.5 }, lines: LINES("BKN", "WAS"), injuries: { home: [], away: [] } }] };
  const sp = await slate.buildSlate({ now: Date.parse("2026-10-12T20:00:00Z"), events, injuries: { teams: {}, t: "x" }, model });
  const g = sp.games.find((x) => x.key === "BKN @ WAS");
  ok(g.card && g.card.test === true && sp.bestBets.length === 0 && sp.parlay.length === 0 && !sp.parlays.some((p) => p.game === "BKN @ WAS"), "preseason: the card is a TEST; nothing reaches best bets or parlays", sp.bestBets);
  ok(sp.tests.length === 3 && sp.tests[0].label === "WAS ML" && sp.tests[0].testTier === "pick", "preseason: the TEST picks are listed, best first", sp.tests);
  const saved = (await rec.loadPicks()).filter((p) => p.tier === "test");
  ok(saved.length === 4 && saved.every((p) => p.game === "BKN @ WAS") && !saved.some((p) => p.id === "ptspick|total"), "preseason: TEST picks are saved before tip-off (no PICK w/ POINTS on the model-side total)", saved.map((p) => p.id));
  const res = await rec.gradeAll(async () => ({ "BKN @ WAS": { away: 100, home: 105, final: true } }));
  ok(res === 4, "preseason: TEST picks are graded like any other pick", res);
  const sm = rec.summarize(await rec.loadPicks());
  ok(sm.test && sm.test.w + sm.test.l === 4 && sm["test:ml"] && sm["test:modelpick|spread"], "preseason: the record has a separate TEST line (by id too)", sm.test);
  const noTest = rec.summarize((await rec.loadPicks()).filter((p) => p.tier === "test"));
  ok(!noTest.all && !noTest.green && noTest.test.w + noTest.test.l === 4, "preseason: TEST picks never count toward the pick numbers", noTest);
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/TEST\b/.test(app) && /c-amb">PRESEASON/.test(app), "page shows TEST picks and the PRESEASON chip"); }

// ---------- alerts (the bell)
{ const al = await import("../lib/alerts.js");
  const T0 = Date.parse("2026-11-03T20:00:00Z");
  const game = (over = {}) => ({ key: "BOS @ NYK", away: "BOS", home: "NYK", date: "2026-11-03", inProgress: false, poly: { spread: { homeSpread: -3.5 }, total: { line: 220.5 }, ml: { midHome: 0.62, midAway: 0.38 } },
    spread: null, total: null, ml: null, injuries: { home: [], away: [] }, ...over });
  const before = (await al.listAlerts()).length;
  ok(await al.alertsFromSlate([game()], T0) === 0, "alerts: the first look at a game stores a baseline and says nothing");
  ok(await al.alertsFromSlate([game({ poly: { spread: { homeSpread: -4 }, total: { line: 221 }, ml: { midHome: 0.64, midAway: 0.36 } } })], T0 + 60e3) === 0, "alerts: small moves (spread 0.5, total 0.5, moneyline 2¢) stay quiet");
  const n0 = await al.alertsFromSlate([game({ poly: { spread: { homeSpread: -5 }, total: { line: 223 }, ml: { midHome: 0.7, midAway: 0.3 } } })], T0 + 120e3), T1 = T0 + 120e3 + al.MOVE_HOLD_MIN * 60e3;
  ok(n0 === 0, "alerts (10/23): a move first seen waits -- it alerts only if it still holds MOVE_HOLD_MIN later");
  const n1 = await al.alertsFromSlate([game({ poly: { spread: { homeSpread: -5 }, total: { line: 223 }, ml: { midHome: 0.7, midAway: 0.3 } } })], T1);
  const L = (await al.listAlerts()).filter((a) => a.kind === "LINE MOVE");
  ok(n1 === 3 && L.length === 3 && L.some((a) => /spread: NYK -3.5 → -5/.test(a.title)) && L.some((a) => /total: 220.5 → 223/.test(a.title)) && L.some((a) => /moneyline 62¢ → 70¢/.test(a.title)), "alerts: spread 1+, total 2+ and moneyline 5¢+ moves each alert once they held 20 min, measured against the first line", L.map((a) => a.title));
  ok(await al.alertsFromSlate([game({ poly: { spread: { homeSpread: -5 }, total: { line: 223 }, ml: { midHome: 0.7, midAway: 0.3 } } })], T1 + 180e3) === 0, "alerts: the same move never alerts twice");
  { const fg = (hs) => game({ key: "LAL @ GSW", away: "LAL", home: "GSW", poly: { spread: { homeSpread: hs }, total: { line: 230.5 }, ml: { midHome: 0.6, midAway: 0.4 } } });
    const a = await al.alertsFromSlate([fg(-4.5)], T0), b = await al.alertsFromSlate([fg(-1.5)], T0 + 5 * 60e3), c = await al.alertsFromSlate([fg(-4.5)], T0 + 12 * 60e3), d = await al.alertsFromSlate([fg(-4.5)], T0 + 40 * 60e3);
    ok(a + b + c + d === 0, "alerts (10/23): a line that flickers and snaps back (GSW -4.5 -> -1.5 -> -4.5 within minutes) never alerts", [a, b, c, d]); }
  { const src = (await import("fs")).readFileSync(new URL("../lib/alerts.js", import.meta.url), "utf8"); const h = Number((src.match(/kind: "PICK"[^\n]*ttlH: (\d+)/) || [])[1]);
    ok(h >= 72, "alerts: a PICK is remembered past the 2-day record window (36 h re-alerted the same pick on game day, 10/21)", h); }
  const withInj = (list) => game({ poly: { spread: { homeSpread: -5 }, total: { line: 223 }, ml: { midHome: 0.7, midAway: 0.3 } }, injuries: { home: list, away: [] } });
  ok(await al.alertsFromSlate([withInj([{ name: "Star Guy", status: "Out", ppg: 24 }])], T1 + 240e3) === 1, "alerts: a rotation player newly listed Out alerts");
  ok(await al.alertsFromSlate([withInj([{ name: "Star Guy", status: "Out", ppg: 24 }, { name: "Bench Guy", status: "Out", ppg: 4 }])], T1 + 300e3) === 0, "alerts: bench players (under 10 ppg) and repeats stay quiet");
  const I = (await al.listAlerts()).find((a) => a.kind === "INJURY");
  ok(I && I.team === "NYK" && /Star Guy ruled out/.test(I.title) && /24 points a game/.test(I.sub), "alerts: injury text", I);
  const pickGame = (pre) => game({ date: "2026-11-04", key: "MIA @ ORL", away: "MIA", home: "ORL", preseason: pre, card: { spread: { plain: { id: "cardpick|spread", pick: "MIA +3", hit: 59.1, team: "MIA", line: 3 } }, total: { plain: { id: "modelpick|total", pick: "Over 220.5", hit: 50.5 } } } });
  ok(await al.alertsFromSlate([pickGame(true)], T1 + 400e3) === 0, "alerts: a preseason TEST pick never alerts");
  ok(await al.alertsFromSlate([pickGame(false)], T1 + 460e3) === 1 && await al.alertsFromSlate([pickGame(false)], T1 + 520e3) === 0, "alerts: a new green PICK alerts once (the model's 50% side does not)");
  ok(await al.alertsFromSlate([{ ...pickGame(false), key: "X @ Y", inProgress: true }], T1 + 580e3) === 0, "alerts: games already under way are skipped");
  ok(!al.alertForResult && !al.listResults, "alerts (cleanup 10/18): graded picks save no RESULT line and there is no results reader");
  const all = await al.listAlerts(); ok(all.length - before === 5 && !all.some((a) => a.kind === "RESULT") && all[0].t > all[1].t, "alerts: newest first, no RESULT lines", all.slice(0, 3).map((a) => a.kind));
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/\/api\/nba\/alerts/.test(app) && /Shell\.setCount\("nba", "alerts"/.test(app) && /alSeen/.test(app), "page: bell counts unread alerts and opens the Alerts panel"); }


// ---------- futures: the simulation next to Polymarket's own prices (real events saved from the live API; the simulation file is the real shipped one)
{ const fu = await import("../lib/futures.js");
  const evs = JSON.parse(readFileSync(new URL("./fixtures/poly_futures_events.json", import.meta.url), "utf8"));
  const sim = JSON.parse(readFileSync(new URL("../railway-model-service/data/futures_live.json", import.meta.url), "utf8"));
  sim.report = JSON.parse(readFileSync(new URL("../railway-model-service/data/futures_report.json", import.meta.url), "utf8"));
  ok(fu.abbrOfName("Los Angeles Clippers") === "LAC" && fu.abbrOfName("LA Clippers") === "LAC" && fu.abbrOfName("Portland Trail Blazers") === "POR" && fu.abbrOfName("Philadelphia 76ers") === "PHI" && fu.abbrOfName("Team A") === null, "futures: Polymarket and model-service team names both map to our abbreviations");
  const f = fu.buildFutures(sim, evs);
  ok(f.ok && f.sections.length === 6 && f.wins.length === 30, "futures: six sections and 30 teams of win totals", { s: f.sections.length, w: f.wins.length });
  const ch = f.sections.find((x) => x.id === "champion");
  ok(ch.rows.length === 30 && ch.rows.every((r) => r.model != null && r.market != null) && ch.rows[0].model >= ch.rows[29].model, "futures: every team has a model chance and a Polymarket price for the title, best first", ch.rows.slice(0, 2));
  ok(Math.abs(ch.rows.reduce((a, r) => a + r.model, 0) - 100) < 1.5, "futures: title chances add to 100%", ch.rows.reduce((a, r) => a + r.model, 0));
  const ea = f.sections.find((x) => x.id === "east");
  ok(ea.rows.filter((r) => r.market != null).length === 15 && ea.rows.filter((r) => r.market != null).every((r) => ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"].includes(r.team)), "futures: the East market matches the 15 East teams", ea.rows.filter((r) => r.market != null).map((r) => r.team));
  { const EAST = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"], we = f.sections.find((x) => x.id === "west");
    ok(ea.rows.length === 15 && ea.rows.every((r) => EAST.includes(r.team)) && we.rows.length === 15 && we.rows.every((r) => !EAST.includes(r.team)) && Math.abs(ea.rows.reduce((a, r) => a + r.model, 0) - 100) < 1.5, "futures (10/19 check): East champion lists only the 15 East teams, West only the West, each adding to 100%", { e: ea.rows.length, w: we.rows.length }); }
  const s1 = f.sections.find((x) => x.id === "seed1");
  ok(s1.market && s1.rows.filter((r) => r.market != null).length >= 28, "futures: #1-seed prices come from each team's own conference market", s1.rows.filter((r) => r.market != null).length);
  const w1 = f.wins.find((w) => w.team === "BOS");
  ok(w1 && w1.line === 50.5 && w1.modelOver > 0 && w1.modelOver < 100 && w1.marketOver === null, "futures: win-total line (Celtics 50.5) with the model's chance of the over; an empty order book shows no market price", w1);
  ok(f.wins.every((w) => w.low <= w.ew && w.ew <= w.high), "futures: expected wins sit inside the 10-90% range");
  ok(fu.priceOf({ outcomePrices: '["0.5","0.5"]', bestBid: 0.01, bestAsk: 0.99 }).thin === true && fu.priceOf({ outcomePrices: '["0.2","0.8"]', bestBid: 0.19, bestAsk: 0.21 }).thin === false, "futures: a wide or empty order book is marked thin");
  const none = fu.buildFutures(sim, []);
  ok(none.ok && none.sections.every((x) => x.rows.every((r) => r.market === null)) && none.polymarket === false, "futures: still works when Polymarket can't be read (model numbers only)");
  const rp = sim.report; ok(rp.vs_market["2025"] && rp.champion.avg_chance_given_to_real_champion_pct > rp.champion.uniform_pct && rp.wins.mae_prior_with_roster <= rp.wins.mae_prior_without_roster, "futures: the shipped backtest beats guessing, and the roster term helps", rp.champion);
  { // 10/17: Polymarket US futures events -> the same sections (title from Polymarket US, "Boston 51+ wins" = Over 50.5, no quote = no price)
    const q = (v) => ({ value: String(v) }), mk = (slug, t, bid, ask, line) => ({ slug, line: line ?? null, bestBidQuote: bid == null ? null : q(bid), bestAskQuote: ask == null ? null : q(ask), marketSides: [{ long: true, team: { abbreviation: t } }, { long: false, team: { abbreviation: t } }] });
    const us = fu.usFutures([{ slug: "nba-champ-2027-06-18-w", markets: [mk("a", "okc", 0.23, 0.24), mk("b", "sa", 0.22, 0.23), mk("c", "atl", null, null)] },
      { slug: "nba-2027-04-11-wintotals", markets: [mk("d", "bos", 0.55, 0.57, 51)] }, { slug: "nba-mvp-2027-05-17-w", markets: [mk("e", "okc", 0.3, 0.31)] }, { slug: "nba-bos-det-2026-10-20", markets: [] }]);
    const g = fu.buildFutures(sim, us), chU = g.sections.find((x) => x.id === "champion"), okc = chU.rows.find((r) => r.team === "OKC"), sas = chU.rows.find((r) => r.team === "SAS"), atl = chU.rows.find((r) => r.team === "ATL");
    const bos = g.wins.find((w) => w.team === "BOS");
    ok(us.length === 2 && chU.market && okc.market === 23.5 && sas.market === 22.5 && atl.market === null && bos.line === 50.5 && bos.marketOver === 56,
      "futures: Polymarket US events read (champion midpoints, GS/SA codes mapped, 51+ wins = Over 50.5, no quote = no price; MVP and games skipped)", { okc, sas, atl, bos }); }
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/\/api\/nba\/futures/.test(app) && /m-fut/.test(app) && /futuresRows\(/.test(app), "page: Futures section on the Models tab (rows, no notes)"); }


// ---------- closing-line value
{ const rc = await import("../lib/record.js");
  const P = (o) => ({ tier: "pick", game: "BOS @ NYK", date: "2026-11-05", ...o });
  const close = { date: "2026-11-05", game: "BOS @ NYK", hs: -3.5, tl: 222 };         // home NYK -3.5 at the close
  ok(rc.clvOf(P({ market: "spread", team: "BOS", line: 4.5 }), close) === 1, "clv: took BOS +4.5, closed +3.5 -> +1 point");
  ok(rc.clvOf(P({ market: "spread", team: "NYK", line: -2.5 }), close) === 1 && rc.clvOf(P({ market: "spread", team: "NYK", line: -4.5 }), close) === -1, "clv: home side -2.5 beats a -3.5 close; -4.5 does not");
  ok(rc.clvOf(P({ market: "total", side: "over", line: 220.5 }), close) === 1.5 && rc.clvOf(P({ market: "total", side: "under", line: 220.5 }), close) === -1.5, "clv: over gains when the total closes higher, under when lower");
  ok(rc.clvOf(P({ market: "ml", team: "BOS", line: null }), close) === null && rc.clvOf(P({ market: "total", side: "over", line: 220.5, tier: "test" }), close) === null && rc.clvOf(P({ market: "spread", team: "BOS", line: 4.5 }), null) === null, "clv: moneyline, TEST picks and picks with no close yet are left out");
  const sm = rc.clvSummary([P({ market: "spread", team: "BOS", line: 4.5 }), P({ market: "total", side: "under", line: 220.5 }), P({ market: "spread", team: "BOS", line: 3.5 })], [close]);
  ok(sm.n === 3 && sm.beat === 1 && sm.same === 1 && sm.worse === 1 && sm.avg === Math.round(((1 - 1.5 + 0) / 3) * 100) / 100 && sm.beatPct === 33.3, "clv: summary counts beat / same / worse and the average", sm);
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/Closing-line value/.test(app) && /LINE VALUE/.test(app) && /j\.clv/.test(app), "page: closing-line value in the Models tiles and rows"); }


// ---------- Pinnacle recorder + LINE MOVE signal (real preseason feed saved as fixtures 10/14)
{ const pn = await import("../lib/pinnacle.js");
  const o = pn.parsePinnacle(JSON.parse(readFileSync(new URL("./fixtures/pinnacle_matchups.json", import.meta.url), "utf8")), JSON.parse(readFileSync(new URL("./fixtures/pinnacle_markets.json", import.meta.url), "utf8")));
  ok(Object.keys(o).length === 7 && o["CHI @ MIL"].hs === 2 && o["CHI @ MIL"].tl === 232 && o["CHI @ MIL"].mh === 107, "Pinnacle real feed parses (7 preseason games, spread / total / moneyline)", Object.keys(o).length);
  const s = pn.signalFrom({ hs: -2, tl: 220 }, { hs: -5.5, tl: 216 }, "BOS", "NYK");
  ok(s && s.spread.team === "BOS" && s.spread.open === -2 && s.total.side === "under" && s.total.open === 220, "LINE MOVE 3+: names the side and the opening number");
  const s2 = pn.signalFrom({ hs: 4, tl: 220 }, { hs: 0.5, tl: 221 }, "BOS", "NYK");
  ok(s2 && s2.spread.team === "BOS" && s2.spread.open === 4 && !s2.total, "home dog +4 shrinks to +0.5 -> moved toward the HOME team; take BOS +4 at the open");
  const s3 = pn.signalFrom({ hs: -2, tl: 220 }, { hs: 1.5, tl: 220 }, "BOS", "NYK");
  ok(s3 && s3.spread.team === "NYK" && s3.spread.open === 2, "home spread rises -> moved toward the AWAY team; NYK +2 at the open");
  ok(pn.signalFrom({ hs: -2, tl: 220 }, { hs: -4.5, tl: 222 }, "BOS", "NYK") === null, "moves under 3 points give no signal");
  const g = [{ key: "CHI @ MIL", date: "2026-10-14", start: "2026-10-15T00:10:00Z" }];
  const t = Date.parse("2026-10-14T18:00:00Z");
  const nAll = await pn.savePinnacle(g, t, o), nOther = Object.values(o).filter((p) => p.start && Date.parse(p.start) > t).length - 1;
  ok(nAll === 1 + nOther && nOther >= 1 && (await pn.loadPinOpen("2026-10-14", "CHI @ MIL")).hs === 2, `Pinnacle line saved before tip-off for the slate game and the ${nOther} other not-started games the feed lists`, nAll);
  const o2 = JSON.parse(JSON.stringify(o)); o2["CHI @ MIL"].hs = -1.5; o2["CHI @ MIL"].tl = 228;
  await pn.savePinnacle(g, t + 3600e3, o2);
  const sig = await pn.moveSignal("2026-10-14", "CHI @ MIL", t + 3600e3);
  ok(sig && sig.spread.team === "MIL" && sig.spread.open === 2 && sig.total && sig.total.side === "under", "open stays the first sighting; later pull makes the signal", JSON.stringify(sig));
  // shadow record of LINE MOVE signals: first sighting stands, graded on the opening number
  { const g2 = [{ key: "CHI @ MIL", date: "2026-10-14", start: "2026-10-15T00:10:00Z" }];
    ok((await pn.recordMoves(g2, t + 7200e3)) === 2, "LINE MOVE signals saved (spread + total) before tip-off");
    ok((await pn.recordMoves(g2, t + 7300e3)) === 0, "a signal already saved is not saved twice");
    const gr = await pn.gradeMoves(async () => ({ "CHI @ MIL": { final: true, away: 100, home: 110 } }), rec.gradePick);
    const sm = pn.summarizeMoves(await pn.loadMoves());
    ok(gr === 2 && sm.spread.w === 1 && sm.total.w === 1 && sm["now:spread"] && sm["now:spread"].w === 1 && sm["now:total"].w === 1, "signals graded on the opening number AND the number when seen", JSON.stringify(sm)); }
  { const gp = pn.gapFrom({ hs: -3, tl: 220, poly: { hs: -1.5, tl: 221 } }, "BOS", "NYK");
    ok(gp && gp.spread.team === "BOS" && gp.spread.line === -1.5 && gp.spread.pinLine === -3 && !gp.total, "Pinnacle likes home more than Polymarket: bet BOS at Polymarket's -1.5");
    const gq = pn.gapFrom({ hs: -1.5, tl: 224, poly: { hs: -3, tl: 221 } }, "BOS", "NYK");
    ok(gq && gq.spread.team === "NYK" && gq.spread.line === 3 && gq.total.side === "over" && gq.total.line === 221, "Pinnacle likes away more / higher total: NYK +3, over 221");
    const gg = [{ key: "DET @ NYK", date: "2026-10-14", start: "2026-10-15T01:00:00Z", poly: { spread: { homeSpread: -1 }, total: { line: 215 } } }];
    await pn.savePinnacle(gg, t, { "DET @ NYK": { hs: -3, tl: 219, mh: -150, ma: 130 } });
    ok((await pn.recordGaps(gg, t)) === 2, "gap rows saved (spread + total)");
    const gr2 = await pn.gradeMoves(async () => ({ "DET @ NYK": { final: true, away: 100, home: 105 } }), rec.gradePick);
    const gs = pn.summarizeMoves(await pn.loadMoves()).gap;
    ok(gr2 === 2 && gs.w === 1 && gs.l === 1, "gap rows graded and kept apart from LINE MOVE", gr2); }
  { // review fixes: the opening row is completed when a market shows up later, stale rows give no signal, one slow feed cannot hang the pull
    const g9 = [{ key: "ORL @ CLE", date: "2026-10-14", start: "2026-10-15T01:00:00Z" }], t9 = Date.parse("2026-10-14T10:00:00Z");
    await pn.savePinnacle(g9, t9, { "ORL @ CLE": { hs: -2 } });
    await pn.savePinnacle(g9, t9 + 600e3, { "ORL @ CLE": { hs: -2, tl: 220 } });
    const op = await pn.loadPinOpen("2026-10-14", "ORL @ CLE");
    ok(op.hs === -2 && op.tl === 220, "opening row gets the total once Pinnacle posts it (spread came first)", JSON.stringify(op));
    await pn.savePinnacle(g9, t9 + 1200e3, { "ORL @ CLE": { hs: -6, tl: 220 } });
    ok((await pn.moveSignal("2026-10-14", "ORL @ CLE", t9 + 6 * 3600e3)) === null, "a Pinnacle row from hours ago is not live: no signal from it");
    const slow = () => new Promise(() => {});
    let err = null; try { await pn.fetchPinnacle(slow, 200); } catch (e) { err = String(e.message); }
    ok(err && /took longer/.test(err), "a hung Pinnacle feed gives up at the deadline", err);
    const half = async (url) => url.includes("/487/") ? { ok: false, status: 403, json: async () => ({}) } : { ok: true, json: async () => [] };
    const r9 = await pn.fetchPinnacle(half, 20000); ok(r9._fails === 1 && Object.keys(r9).length === 0, "one league failing while the other answers is reported as a partial failure");
    const asked = []; const spy = async (url) => { asked.push(url); return { ok: true, json: async () => [] }; };
    await pn.pullPinnacle([{ key: "A @ B", preseason: false }], Date.now(), spy); const reg = asked.splice(0);
    await pn.pullPinnacle([{ key: "A @ B", preseason: true }], Date.now(), spy);
    ok(reg.length === 2 && reg.every((u) => u.includes("/487/")) && asked.some((u) => u.includes("/5270/")), "Pinnacle (10/19): the preseason league is asked only while the slate has preseason games", reg); }
  const late = Date.parse("2026-10-15T00:30:00Z"), stillAhead = Object.values(o).filter((p) => p.start && Date.parse(p.start) > late).length;
  ok((await pn.savePinnacle(g, late, o)) === stillAhead && !(await globalThis.__TEST_REDIS__.lindex(pn.pinKey("2026-10-14", "CHI @ MIL"), 0).then((x) => JSON.parse(x).t === new Date(late).toISOString())), "nothing saved for a game after its tip-off (only the feed's games still ahead)"); }

{ const st = await import("../lib/status.js"); const noon = Date.parse("2026-10-21T19:00:00Z");   // noon Pacific
  const fine = { snap: { t: new Date(noon - 20 * 60e3).toISOString(), games: 8, modelOk: true }, railway: { ok: true }, pinnacle: new Date(noon - 25 * 60e3).toISOString(), now: noon };
  ok(st.computeWatch(fine).length === 0, "watchdog: nothing to say when everything is fresh");
  const late = st.computeWatch({ ...fine, snap: { ...fine.snap, t: new Date(noon - 3 * 3600e3).toISOString() } });
  ok(late.length === 1 && /No snapshot in 180 minutes/.test(late[0]), "watchdog: a 3-hour gap in the daytime is reported", late);
  ok(st.computeWatch({ ...fine, now: Date.parse("2026-10-22T09:30:00Z"), snap: { ...fine.snap, t: "2026-10-22T04:30:00Z" }, pinnacle: "2026-10-22T04:30:00Z" }).length === 0, "watchdog: the overnight gap (2:30 AM Pacific) is not an alarm");
  const bad = st.computeWatch({ ...fine, railway: { ok: false }, snap: { ...fine.snap, modelOk: false }, pinnacle: null });
  ok(bad.length === 3 && /Railway/.test(bad[0]) && /did not answer/.test(bad[1]) && /Pinnacle/.test(bad[2]), "watchdog: Railway down, model silent and no Pinnacle are each named", bad.length);
  ok(st.computeWatch({ ...fine, snap: null }).some((x) => /No snapshot has run/.test(x)), "watchdog: no snapshot at all is reported"); }
{ // 10/17: NBA nightly backup (the NBA database had none after the move into the combined site)
  const st = await import("../lib/status.js"), now = Date.parse("2026-12-01T20:00:00Z"), base = { snap: { t: new Date(now).toISOString(), games: 0, modelOk: true }, railway: { ok: true }, pinnacle: new Date(now).toISOString(), now };
  ok(st.computeWatch({ ...base, backup: null }).some((x) => /No backup/.test(x)) && st.computeWatch({ ...base, backup: { t: new Date(now - 40 * 3600e3).toISOString(), where: "volume" } }).some((x) => /No backup/.test(x))
    && st.computeWatch({ ...base, backup: { t: new Date(now - 3600e3).toISOString(), where: "failed" } }).some((x) => /failed/.test(x)) && st.computeWatch({ ...base, backup: { t: new Date(now - 3600e3).toISOString(), where: "volume" } }).length === 0,
    "watchdog: NBA backup missing / older than 26 h / failed is reported, a fresh one is silent");
  ok(st.computeWatch({ ...base, backup: { t: new Date(now - 27 * 3600e3).toISOString(), where: "volume" } }).some((x) => /No backup/.test(x)) && !st.computeWatch({ ...base, backup: { t: new Date(now - 20 * 3600e3).toISOString(), where: "volume" } }).some((x) => /No backup/.test(x)), "watchdog: one missed nightly backup (27 h) shows, last night's (20 h) does not");
  { const sch = readFileSync(new URL("../railway-model-service/scheduler.py", import.meta.url), "utf8"), i = sch.indexOf("SITE_API"), j = sch.indexOf("for attempt in range(1, tries + 1):");
    ok(i > 0 && j > i, "scheduler: /api -> /api/nba is rewritten once, before the retries (a retry asked /api/nba/nba/... and always failed)"); }
  const { getRedis } = await import("../lib/redis.js"); await getRedis().set("bk:test", "1"); await getRedis().rpush("bk:list", "a", "b");
  const h = (await import("../../pages/api/nba/backup.js")).default, call = async (q) => { let out = null; await h({ query: q }, { status: () => ({ json: (j) => { out = j; } }) }); return out; };
  let cur = "0", keys = {}, pages = 0; do { const pg = await call({ cursor: cur }); Object.assign(keys, pg.data); cur = String(pg.next); pages++; } while (cur !== "0" && pages < 50);
  await call({ mark: "volume", files: "3" }); const mk = JSON.parse(await getRedis().get("status:backup"));
  ok(keys["bk:test"] && keys["bk:test"].v === "1" && keys["bk:list"].type === "list" && keys["bk:list"].v.join() === "a,b" && mk.where === "volume" && mk.files === 3, "backup: every NBA key paged out (strings and lists), the save is reported", { pages, n: Object.keys(keys).length, mk });
  const sch = readFileSync(new URL("../railway-model-service/scheduler.py", import.meta.url), "utf8");
  ok(/h == 0 and m == 10/.test(sch) && /"backup", _backup/.test(sch) && /\/api\/backup\?cursor=/.test(sch) && /files\[:-30\]/.test(sch), "scheduler: NBA backup every night at 12:10 AM, last 30 kept"); }

{ const pn2 = await import("../lib/pinnacle.js");
  const g1 = { key: "BOS @ NYK", date: "2026-10-22", start: "2026-10-23T00:00:00Z", poly: { spread: { homeSpread: -3 }, total: { line: 220 } }, books: { spread: { homeSpread: -5 }, total: { line: 223.5 } } };
  const bgp = pn2.bookGapFrom(g1, "NYK", "BOS");
  ok(bgp.spread.team === "NYK" && bgp.spread.line === -3 && bgp.spread.pinLine === -5 && bgp.total.side === "over" && bgp.total.line === 220, "books moved toward NYK and the total up: NYK at Polymarket's -3, over 220");
  ok(pn2.bookGapFrom({ ...g1, books: { spread: { homeSpread: -3.5 }, total: { line: 221 } } }, "NYK", "BOS") === null, "books within 1 pt / 2 pts of Polymarket give nothing");
  const t0 = Date.parse("2026-10-22T18:00:00Z");
  ok((await pn2.recordBookGaps([g1], new Date(t0 - 3600e3).toISOString(), t0)) === 2, "books gap saved (spread + total) when the books reading is fresh");
  ok((await pn2.recordBookGaps([{ ...g1, key: "LAL @ DEN" }], new Date(t0 - 8 * 3600e3).toISOString(), t0)) === 0, "a books reading older than 6 hours is not used");
  const grB = await pn2.gradeMoves(async () => ({ "BOS @ NYK": { final: true, away: 100, home: 108 } }), rec.gradePick);
  const smB = pn2.summarizeMoves(await pn2.loadMoves());
  ok(grB >= 2 && smB.bgap.w === 1 && smB.bgap.l === 1 && smB.all.w + smB.all.l >= 1, "books gap graded (NYK -3 wins by 8, over 220 loses at 208) and kept apart from LINE MOVE and GAP", JSON.stringify(smB.bgap)); }

{ const pn3 = await import("../lib/pinnacle.js");
  const t1 = Date.parse("2026-10-23T18:00:00Z"), gI = { key: "LAL @ DEN", date: "2026-10-23", start: "2026-10-24T01:00:00Z", starOut: { home: 0, away: 1 }, poly: { spread: { homeSpread: -4.5 } } };
  await pn3.savePinnacle([gI], t1, { "LAL @ DEN": { hs: -3.5, tl: 225 } });
  ok((await pn3.recordInjuryShadow([gI], t1 + 60e3)) === 1, "INJURY shadow saved: LAL's star is out, so the other team (DEN) is the side");
  ok((await pn3.recordInjuryShadow([{ ...gI, key: "X @ Y", starOut: { home: 1, away: 1 } }], t1)) === 0 && (await pn3.recordInjuryShadow([{ ...gI, key: "X @ Y", starOut: { home: 0, away: 0 } }], t1)) === 0, "both teams (or neither) missing a star: no INJURY signal");
  const rI = (await pn3.loadMoves()).find((x) => x.kind === "inj" && x.game === "LAL @ DEN");
  ok(rI.team === "DEN" && rI.line === -3.5 && rI.nowLine === -4.5, "INJURY row: DEN at Pinnacle's opening -3.5, and at the -4.5 Polymarket has now", JSON.stringify(rI));
  await pn3.gradeMoves(async () => ({ "LAL @ DEN": { final: true, away: 100, home: 104 } }), rec.gradePick);
  const sI = pn3.summarizeMoves(await pn3.loadMoves());
  ok(sI.inj.w === 1 && sI["now:inj"].l === 1, "INJURY graded at the opening number (DEN -3.5 wins by 4) and at the number when seen (-4.5 loses)", JSON.stringify([sI.inj, sI["now:inj"]])); }

// ---------- FATIGUE rule (10/16): a back-to-back after overtime, or an away team on a back-to-back after a 1,500+ km flight -> the other side
{ const sb = parseScoreboard({ events: [{ status: { period: 5, type: { completed: true, state: "post" } }, competitions: [{ competitors: [{ homeAway: "home", score: "120", team: { abbreviation: "NY" } }, { homeAway: "away", score: "118", team: { abbreviation: "BOS" } }] }] },
    { status: { period: 4, type: { completed: true, state: "post" } }, competitions: [{ competitors: [{ homeAway: "home", score: "100", team: { abbreviation: "LAL" } }, { homeAway: "away", score: "90", team: { abbreviation: "DEN" } }] }] },
    { status: { period: 6, type: { completed: false, state: "in" } }, competitions: [{ competitors: [{ homeAway: "home", score: "100", team: { abbreviation: "MIA" } }, { homeAway: "away", score: "100", team: { abbreviation: "ORL" } }] }] }] });
  const { otTeams } = await import("../lib/espn.js");
  ok(sb["BOS @ NYK"].ot === true && sb["BOS @ NYK"].period === 5 && sb["DEN @ LAL"].ot === false && [...otTeams(sb)].sort().join() === "BOS,NYK", "ESPN: overtime = period 5+, finished games only, both teams listed", [...otTeams(sb)]);
  const base = mk("BOS", "NYK");
  const F = (fat) => cp.buildCard({ ...base, fatigue: fat });
  const c1 = F({ home: { ot: true, far: false }, away: null });
  ok(c1.spread.plain.ruleId === "fatigue|spread" && c1.spread.plain.team === "BOS" && c1.spread.plain.hit === 57.8 && c1.spread.plain.why === "FATIGUE OT" && c1.spread.plain.pick === "BOS +8.5", "home team played overtime yesterday on a back-to-back -> PICK the away team at Polymarket's line, 57.8%", c1.spread.plain);
  const c2 = F({ home: null, away: { ot: false, far: true } });
  ok(c2.spread.plain.ruleId === "fatigue|spread" && c2.spread.plain.team === "NYK" && c2.spread.plain.hit === 56.3 && c2.spread.plain.why === "FATIGUE TRAVEL", "away team flew 1,500+ km onto a back-to-back -> PICK the home team, 56.3%", c2.spread.plain);
  ok(F({ home: { ot: false, far: true }, away: null }).spread.plain.ruleId === "model|spread", "a HOME team after a long flight is not a rule (50.9% in history): the model's side shows");
  ok(F({ home: { ot: true, far: false }, away: { ot: true, far: false } }).spread.plain.ruleId === "model|spread", "both teams tired: no rule");
  const c3 = cp.buildCard({ ...base, fatigue: { home: { ot: true, far: false }, away: null }, move: { signal: { spread: { team: "NYK", open: -8.5, pts: 3 } } } });
  ok(c3.spread.plain.ruleId === "linemove|spread" && c3.spread.plain.hit === 67.9, "LINE MOVE at the opening number (67.9%) outranks FATIGUE (57.8%)");
  const c4 = cp.buildCard({ ...base, fatigue: { home: { ot: true, far: false }, away: null }, move: { signal: { spread: { team: "NYK", open: -5.5, pts: 3 } } } });
  ok(c4.spread.plain.ruleId === "fatigue|spread" && c4.spread.plain.team === "BOS", "FATIGUE (57.8%) outranks LINE MOVE after the number moved (56.3%)");
  ok(slate.fatigueOf({ rest: 1, trav_km: 2100 }, "BOS", new Set()).far === true && slate.fatigueOf({ rest: 1, trav_km: 300 }, "BOS", new Set(["BOS"])).ot === true && slate.fatigueOf({ rest: 2, trav_km: 2100 }, "BOS", new Set(["BOS"])) === null && slate.fatigueOf({ rest: 1, trav_km: 300 }, "BOS", new Set()) === null, "fatigue needs a back-to-back plus overtime or a long flight; a plain back-to-back is not fatigue");
  ok(slate.dayBefore("2026-10-21") === "2026-10-20" && slate.dayBefore("2026-11-01") === "2026-10-31", "the day before a slate date");
  // through the slate: the service's context (rest, travel) + yesterday's overtime set
  const model = { ok: true, builtAt: "x", games: [{ key: "OKC @ ATL", away: "OKC", home: "ATL", model: { margin: 3, total: 225 }, spread: { line: -8.5 }, ml: { pick: { label: "ATL ML", pct: 74, tier: "pick", team: "ATL" } }, total: { line: 223.5 }, lines: LINES("OKC", "ATL"),
    context: { home: { rest: 3, trav_km: 0 }, away: { rest: 1, trav_km: 1900 } }, injuries: { home: [], away: [] }, preseason: false }] };
  const s1 = await slate.buildSlate({ now: Date.parse("2026-10-12T20:00:00Z"), events, injuries: { teams: {}, t: "x" }, model, record: false, otSets: { "2026-10-11": ["OKC"] } });
  const g1 = s1.games.find((g) => g.key === "OKC @ ATL");
  ok(g1.fatigue && g1.fatigue.away.ot === true && g1.fatigue.away.far === true && !g1.fatigue.home && g1.card.spread.plain.ruleId === "fatigue|spread" && g1.card.spread.plain.team === "ATL" && g1.card.spread.plain.hit === 57.8, "slate: OKC on a back-to-back after overtime -> the card PICKs ATL -8.5 (FATIGUE OT), green", g1.fatigue);
  ok(s1.bestBets.some((p) => p.label === "ATL -8.5" && p.pct === 57.8), "a FATIGUE pick is a green pick, so it reaches the best bets", s1.bestBets.map((p) => p.label)); }

// ---------- ATS REGRESSION rule (10/16): an away team covering 35% or less of 20+ lined games this season -> bet the away team at Polymarket's line
{ const base = mk("BOS", "NYK");
  const A = (ctx) => cp.buildCard({ ...base, context: ctx });
  const a1 = A({ home: { ats_pct: 0.5, ats_n: 24 }, away: { ats_pct: 0.3, ats_n: 24 } });
  ok(a1.spread.plain.ruleId === "atsreg|spread" && a1.spread.plain.team === "BOS" && a1.spread.plain.pick === "BOS +8.5" && a1.spread.plain.hit === 57.3 && a1.spread.plain.n === 358 && a1.spread.plain.why === "ATS 30%", "away team at 30% ATS over 24 lined games -> PICK the away team at Polymarket's line, 57.3%", a1.spread.plain);
  ok(A({ home: { ats_pct: 0.3, ats_n: 24 }, away: { ats_pct: 0.5, ats_n: 24 } }).spread.plain.ruleId === "model|spread", "the home version does not hold (50.3%) -> no rule, the model's side");
  ok(A({ home: {}, away: { ats_pct: 0.3, ats_n: 19 } }).spread.plain.ruleId === "model|spread" && A({ home: {}, away: { ats_pct: 0.36, ats_n: 30 } }).spread.plain.ruleId === "model|spread", "needs 20+ lined games and 35% or less");
  ok(A({ home: {}, away: { ats_pct: 0.35, ats_n: 20 } }).spread.plain.ruleId === "atsreg|spread" && A(null).spread.plain.ruleId === "model|spread" && A({ home: {}, away: { rest: 2 } }).spread.plain.ruleId === "model|spread", "exactly 35% of 20 counts; no context or no ATS numbers -> no rule");
  const a2 = cp.buildCard({ ...base, context: { home: {}, away: { ats_pct: 0.3, ats_n: 24 } }, fatigue: { home: { ot: true, far: false }, away: null } });
  ok(a2.spread.plain.ruleId === "fatigue|spread" && a2.spread.plain.team === "BOS", "FATIGUE OT (57.8%) outranks ATS REGRESSION (57.3%); both like BOS here");
  const a3 = cp.buildCard({ ...base, context: { home: {}, away: { ats_pct: 0.3, ats_n: 24 } }, fatigue: { home: null, away: { ot: false, far: true } } });
  ok(a3.spread.plain.ruleId === "atsreg|spread" && a3.spread.plain.team === "BOS", "ATS REGRESSION (57.3%) outranks FATIGUE TRAVEL (56.3%) when they disagree", a3.spread.plain);
  const a4 = cp.buildCard({ ...base, context: { home: {}, away: { ats_pct: 0.3, ats_n: 24 } }, move: { signal: { spread: { team: "NYK", open: -8.5, pts: 3 } } } });
  ok(a4.spread.plain.ruleId === "linemove|spread" && a4.spread.plain.team === "NYK", "LINE MOVE at the open (67.9%) outranks ATS REGRESSION");
  // each rule keeps its own record row
  const rs = rec.summarize([{ id: "cardpick|spread", market: "spread", ruleId: "atsreg|spread", pct: 57.3, result: "win", price: 0.5 }, { id: "cardpick|spread", market: "spread", ruleId: "fatigue|spread", pct: 57.8, result: "loss", price: 0.5 }, { id: "cardpick|total", market: "total", ruleId: "linemove|total", pct: 61.8, result: "win", price: 0.5 }]);
  ok(rs["rule:atsreg|spread"].w === 1 && rs["rule:fatigue|spread"].l === 1 && rs["rule:linemove|total"].w === 1 && rs["cardpick|spread"].w === 1 && rs["cardpick|spread"].l === 1 && rs.rule.w === 2, "the record keeps a row per tested rule and the combined PICK row", Object.keys(rs));
  // through the slate: the service's context carries ats_pct / ats_n
  const model = { ok: true, builtAt: "x", games: [{ key: "OKC @ ATL", away: "OKC", home: "ATL", model: { margin: 3, total: 225 }, spread: { line: -8.5 }, ml: { pick: { label: "ATL ML", pct: 74, tier: "pick", team: "ATL" } }, total: { line: 223.5 }, lines: LINES("OKC", "ATL"),
    context: { home: { rest: 3, trav_km: 0, ats_pct: 0.55, ats_n: 22 }, away: { rest: 3, trav_km: 0, ats_pct: 0.318, ats_n: 22 } }, injuries: { home: [], away: [] }, preseason: false }] };
  const s2 = await slate.buildSlate({ now: Date.parse("2026-10-12T20:00:00Z"), events, injuries: { teams: {}, t: "x" }, model, record: false, otSets: {} });
  const g2 = s2.games.find((g) => g.key === "OKC @ ATL");
  ok(g2.card.spread.plain.ruleId === "atsreg|spread" && g2.card.spread.plain.pick === "OKC +8.5" && g2.card.spread.plain.hit === 57.3 && g2.card.spread.plain.why === "ATS 32%" && s2.bestBets.some((p) => p.label === "OKC +8.5"), "slate: OKC at 32% ATS -> the card PICKs OKC +8.5 (ATS 32%), green, in the best bets", g2.card.spread.plain); }

// ---------- 10/16 gap fixes: overtime lookup saved only for finished days, never today; ESPN failures noted; the rule pick wins after tip-off
{ const R = globalThis.__TEST_REDIS__; for (const k of ["otset:2026-10-20", "otset:2026-10-19", "status:espn"]) await R.del(k);
  const now = Date.parse("2026-10-21T15:00:00Z"); let calls = 0;   // 11 AM ET on 10/21
  const fin = (ot, final) => ({ "BOS @ NYK": { final, ot, period: ot ? 5 : 4 }, "DEN @ LAL": { final: true, ot: false, period: 4 } });
  const s0 = await slate.otSetFor("2026-10-21", null, now, async () => { calls++; return fin(true, true); });
  ok(s0.size === 0 && calls === 0, "today's date is never looked up (its games are not over)");
  const s1 = await slate.otSetFor("2026-10-20", null, now, async () => { calls++; return fin(true, false); });
  ok(s1.size === 0 && calls === 1 && !(await R.get("otset:2026-10-20")), "a day still being played: an unfinished game gives no overtime yet and nothing is saved");
  const s2 = await slate.otSetFor("2026-10-20", null, now, async (d, o) => { calls++; return o && o.timeoutMs === 6000 ? fin(true, true) : {}; });
  ok([...s2].sort().join() === "BOS,NYK" && calls === 2 && JSON.parse(await R.get("otset:2026-10-20")).length === 2, "every game final -> the overtime teams are saved for 12 h (6-second ESPN timeout)");
  const s3 = await slate.otSetFor("2026-10-20", null, now, async () => { calls++; return fin(false, true); });
  ok([...s3].sort().join() === "BOS,NYK" && calls === 2 && JSON.parse(await R.get("status:espn")).ok === true, "the saved set is reused, ESPN is not asked again; a good answer is noted");
  const s4 = await slate.otSetFor("2026-10-19", null, now, async () => { throw new Error("503 on scoreboard"); });
  const es = JSON.parse(await R.get("status:espn"));
  ok(s4.size === 0 && es.ok === false && /503/.test(es.msg) && !(await R.get("otset:2026-10-19")), "ESPN failing: no overtime, nothing saved, the failure is noted");
  const { computeWatch } = await import("../lib/status.js"), snapOk = { snap: { t: new Date(now).toISOString(), games: 5, modelOk: true }, railway: { ok: true }, pinnacle: new Date(now).toISOString(), now };
  ok(computeWatch({ ...snapOk, espn: es }).some((x) => /ESPN/.test(x)) && !computeWatch({ ...snapOk, espn: { ok: true } }).some((x) => /ESPN/.test(x)) && !computeWatch(snapOk).some((x) => /ESPN/.test(x)), "watchdog names a failed ESPN overtime check, silent when it answered or never ran");
  const { allFinal } = await import("../lib/espn.js");
  ok(allFinal({}) === true && allFinal(fin(true, true)) === true && allFinal(fin(true, false)) === false, "a day is finished when every game is final (a day with no games counts as finished)");
  // after tip-off the card prefers the rule pick when a model pick was saved first and the rule pick later (same market)
  const base = mk("BOS", "NYK", { key: "BOS @ NYK", date: "2026-12-22", start: "2026-12-23T00:00:00Z" });
  const g1 = { ...base, card: cp.buildCard(base) }, b2 = { ...base, fatigue: { home: { ot: true, far: false }, away: null } }, g2 = { ...b2, card: cp.buildCard(b2) };
  ok(g1.card.spread.plain.id === "modelpick|spread" && g1.card.spread.plain.pick === "BOS +8.5" && g2.card.spread.plain.id === "cardpick|spread", "fixture: the model and the FATIGUE rule both like BOS +8.5, at 50.3% and 57.8%");
  await rec.recordPicks([g1], Date.parse("2026-12-22T14:00:00Z")); await rec.recordPicks([g2], Date.parse("2026-12-22T16:00:00Z"));
  const L = await rec.lockedFor("2026-12-22", "BOS @ NYK");
  ok(L && L.spread && L.spread.plain && L.spread.plain.pct === 57.8 && L.total && L.total.plain, "after tip-off the card shows the rule pick (57.8%), not the earlier model pick (50.3%); the total keeps its model pick", L && L.spread);
  ok(typeof slate.OT_TIMEOUT_MS === "number" && slate.OT_TIMEOUT_MS <= 8000, "the overtime lookup waits at most a few seconds so a hung ESPN cannot cost a snapshot"); }

// ---------- Redis load (10/16): the record is read in batches and a pick is saved with one command, so the daily command budget holds all season
{ const C = globalThis.__REDIS_COUNT__, R = globalThis.__TEST_REDIS__; const n0 = (await R.smembers("pick:ids")).length;
  C.n = 0; const all = await rec.loadPicks(); ok(all.length >= 1 && n0 >= 1 && C.n <= 1 + Math.ceil(n0 / 200), `loading ${n0} saved picks takes ${C.n} Redis commands (one batch per 200), not one per pick`);
  C.n = 0; await pl.loadParlays(); ok(C.n <= 2, "parlays load in one batch", C.n);
  C.n = 0; await rec.lockedFor("2026-12-22", "BOS @ NYK"); ok(C.n === 1, "after tip-off the card's saved picks come in one Redis command", C.n);
  const base = mk("BOS", "NYK", { key: "BOS @ NYK", date: "2026-12-24", start: "2026-12-25T00:00:00Z" }), g = { ...base, card: cp.buildCard(base) };
  C.n = 0; const n1 = await rec.recordPicks([g], Date.parse("2026-12-24T14:00:00Z")); ok(n1 >= 3 && C.n === 2 * n1 + 1, `a new pick costs 2 commands (save + index), plus one one-side check per game: ${n1} picks -> ${C.n}`);
  C.n = 0; const n2 = await rec.recordPicks([g], Date.parse("2026-12-24T15:00:00Z")); ok(n2 === 0 && C.n === n1 + 1, "a repeat snapshot costs one command per pick (+ one one-side check per game) and saves nothing (first sighting stands)", C.n);
  const { getRedis: gr } = await import("../lib/redis.js"); const { mgetAll } = await import("../lib/redis.js");
  await R.set("mg:a", "1"); await R.set("mg:b", "2"); const vals = await mgetAll(gr(), ["mg:a", "mg:zz", "mg:b"]); ok(vals[0] === "1" && vals[1] === null && vals[2] === "2", "batch read keeps order and gives null for a missing key", vals); }

// ---------- Pinnacle openers for games not yet on the slate (10/16): the feed lists games days ahead, so the first sighting is the real open
{ const pn = await import("../lib/pinnacle.js"), t0 = Date.parse("2026-10-16T15:00:00Z"), start = "2026-10-21T23:30:00Z";
  const n1 = await pn.savePinnacle([], t0, { "LAL @ GSW": { start, hs: -4.5, hp: -108, ap: -112, tl: 229.5 }, "BOS @ NYK": { hs: -3 } });
  const open = await pn.loadPinOpen("2026-10-21", "LAL @ GSW");
  ok(n1 === 1 && open && open.hs === -4.5 && open.poly === null && !(await pn.loadPinOpen("2026-10-16", "BOS @ NYK")), "a game Pinnacle lists five days ahead is saved as its opening line before the slate shows it; one without a start time is not", open);
  const g = { key: "LAL @ GSW", date: "2026-10-21", start, poly: { spread: { homeSpread: -2.5 }, total: { line: 230.5 } } }, t1 = Date.parse("2026-10-21T15:00:00Z");
  await pn.savePinnacle([g], t1, { "LAL @ GSW": { start, hs: -1.5, tl: 230.5 } });
  const o2 = await pn.loadPinOpen("2026-10-21", "LAL @ GSW"), sig = await pn.moveSignal("2026-10-21", "LAL @ GSW", t1);
  ok(o2.hs === -4.5 && o2.poly && o2.poly.hs === -2.5 && sig && sig.spread && sig.spread.team === "LAL" && sig.spread.pts === 3 && sig.spread.open === 4.5, "once on the slate the open stays -4.5, Polymarket's line is filled in, and the 3-point move toward LAL is a LINE MOVE at LAL +4.5", { o2, sig }); }

// ---------- deep gap hunt 10/16: audit fixes on the site
{ const R = globalThis.__TEST_REDIS__, al = await import("../lib/alerts.js"), pl = await import("../lib/parlays.js"), pn = await import("../lib/pinnacle.js");
  // one row per game even when Polymarket lists it twice (the fuller listing wins)
  const twice = [...events, { ...events[0], markets: (events[0].markets || []).slice(0, 1) }];
  const gs = polyGames(twice); ok(gs.length === polyGames(events).length && gs.filter((g) => g.key === polyGames(events)[0].key).length === 1, "a game listed twice gives one row", gs.map((g) => g.key));
  // LINE MOVES baseline: a market posted after the first look gets its first line, so a later move shows
  { const g = { key: "DAL @ MEM", date: "2026-12-01", start: "2026-12-02T01:00:00Z", poly: { spread: { homeSpread: -3 }, total: null } }, t = Date.parse("2026-12-01T15:00:00Z");
    await slate.lineMoves([g], t); await slate.lineMoves([{ ...g, poly: { spread: { homeSpread: -3 }, total: { line: 230 } } }], t + 60e3);
    const mv = await slate.lineMoves([{ ...g, poly: { spread: { homeSpread: -3 }, total: { line: 233 } } }], t + 120e3);
    ok(mv["DAL @ MEM"] && mv["DAL @ MEM"].total && mv["DAL @ MEM"].total.open === 230 && mv["DAL @ MEM"].total.now === 233, "a total posted after the first look gets its baseline, and its later move is shown", mv); }
  // PICK alerts: one per side, not one per half point; LINE MOVE baseline fills a late market
  { const mkg = (hs, tl) => ({ key: "DAL @ MEM", date: "2026-12-03", start: "2026-12-04T01:00:00Z", home: "MEM", away: "DAL", preseason: false, poly: { spread: { homeSpread: hs, home: 0.5, away: 0.5 }, total: tl ? { line: tl, over: 0.5, under: 0.5 } : null, ml: { midHome: 0.6, midAway: 0.4 } },
      card: { spread: { plain: { pick: `DAL ${hs > 0 ? "-" : "+"}${Math.abs(hs)}`, hit: 57.8, team: "DAL" } }, total: null } }), t = Date.parse("2026-12-03T15:00:00Z");
    const a1 = await al.alertsFromSlate([mkg(-8.5, null)], t), a2 = await al.alertsFromSlate([mkg(-9, null)], t + 60e3), a3 = await al.alertsFromSlate([mkg(-9, 231)], t + 120e3), a4a = await al.alertsFromSlate([mkg(-9, 234)], t + 180e3), a4 = a4a + await al.alertsFromSlate([mkg(-9, 234)], t + 180e3 + al.MOVE_HOLD_MIN * 60e3);   // 10/23: a move alerts once it held 20 min
    ok(a1 === 1 && a2 === 0 && a3 === 0 && a4a === 0 && a4 === 1, "one PICK alert per side (not again at -9), a total posted later gets a baseline and alerts only on its next 2+ move", [a1, a2, a3, a4]); }
  // injuries: a day the official report covers = its rows (none listed = healthy); a day it does not cover = ESPN's team list
  { const inj = { dates: { "2026-12-01": { BOS: [{ name: "A", status: "Out" }] } }, teams: { BOS: [{ name: "B", status: "Day-To-Day" }], NYK: [{ name: "C", status: "Out" }] } };
    ok(injLib.injuriesFor(inj, "2026-12-01", "BOS").length === 1 && injLib.injuriesFor(inj, "2026-12-01", "NYK").length === 0 && injLib.injuriesFor(inj, "2026-12-02", "NYK")[0].name === "C", "official rows for a covered day, ESPN's list for a day the report has not reached yet"); }
  // grading: a game not final 3 days after its date is void (postponed), kept out of every record row and worth $0
  { const base = mk("BOS", "NYK", { key: "BOS @ NYK", date: "2026-09-01", start: "2026-09-02T00:00:00Z" }), g = { ...base, card: cp.buildCard(base) };   // a date well in the past: stale by the real clock
    await rec.recordPicks([g], Date.parse("2026-09-01T14:00:00Z"));
    const fin = async (d) => (d === "2026-09-01" ? {} : { "ZZ @ YY": { final: true } });
    const graded = await rec.gradeAll(fin); const rows = (await rec.loadPicks()).filter((p) => p.date === "2026-09-01");
    ok(rows.length >= 3 && rows.every((p) => p.result === "void") && graded >= rows.length, "a postponed game's picks are voided after 3 days", rows.map((p) => p.result));
    const sm = rec.summarize(rows); ok(!sm.all && !sm["modelpick|spread"], "void picks appear in no record row (not pushes)", Object.keys(sm));
    ok(rec.retOf({ result: "void", price: 0.5 }) === 0 && pn.staleDate("2026-11-20", Date.parse("2026-11-24T12:00:00Z")) && !pn.staleDate("2026-11-22", Date.parse("2026-11-24T12:00:00Z")), "void = $0; stale means 3+ days old"); }
  // parlays: a pushed leg drops out of the payout; a leg whose game never happened is a push
  { const P = { type: "sgp", date: "2026-11-20", stake: 20, pay: 4, legs: [{ game: "BOS @ NYK", market: "spread", team: "BOS", line: 8.5, price: 0.5 }, { game: "BOS @ NYK", market: "total", side: "over", line: 220, price: 0.5 }] };
    await R.set("parlay:2026-11-20:sgp:BOS @ NYK", JSON.stringify(P)); await R.sadd("parlay:ids", "parlay:2026-11-20:sgp:BOS @ NYK");
    await pl.gradeParlays(async () => ({ "BOS @ NYK": { final: true, away: 110, home: 110 } }));   // BOS +8.5 wins, total 220 lands exactly on 220: push
    const got = JSON.parse(await R.get("parlay:2026-11-20:sgp:BOS @ NYK"));
    ok(got.result === "W" && got.legs[1].result === "P" && got.ret === 20, "a 2-leg parlay with one push pays the single winning leg ($20 -> +$20 at 0.50), not the full 4x", got);
    const Q = { type: "sgp", date: "2026-09-03", stake: 20, pay: 4, legs: [{ game: "LAL @ GSW", market: "spread", team: "LAL", line: 4.5, price: 0.5 }, { game: "LAL @ GSW", market: "total", side: "over", line: 220, price: 0.5 }] };
    await R.set("parlay:2026-09-03:sgp:LAL @ GSW", JSON.stringify(Q)); await R.sadd("parlay:ids", "parlay:2026-09-03:sgp:LAL @ GSW");
    await pl.gradeParlays(async () => ({}));
    const q2 = JSON.parse(await R.get("parlay:2026-09-03:sgp:LAL @ GSW")); ok(q2.result === "P" && q2.ret === 0, "a parlay on a game that never happened is a push after 3 days", q2.result); }
  // snapshot status: a failed snapshot is a watchdog line; nothing to send is not a model failure
  { const { computeWatch } = await import("../lib/status.js"), now = Date.parse("2026-12-01T20:00:00Z");
    ok(computeWatch({ snap: { t: new Date(now).toISOString(), games: 0, modelOk: null, failed: "fetch failed" }, railway: { ok: true }, pinnacle: new Date(now).toISOString(), now }).some((x) => /snapshot failed/.test(x)), "a snapshot that threw shows as a failed snapshot, not as a silent scheduler");
    ok(!computeWatch({ snap: { t: new Date(now).toISOString(), games: 0, modelOk: null }, railway: { ok: true }, pinnacle: new Date(now).toISOString(), now }).some((x) => /model service did not answer/.test(x)), "a day with no lined games is not a model failure"); }
  // the slate: parlays carry their day; preseason falls back to the remembered season start when the model is down; modelOk null when nothing was sent
  { const s0 = await slate.buildSlate({ now: Date.parse("2026-10-12T20:00:00Z"), events, injuries: { teams: {}, t: "x" }, model: { ok: true, builtAt: "x", seasonStart: "2026-10-20", games: [] }, record: false, otSets: {} });
    ok(s0.seasonStart === "2026-10-20" && s0.games.every((g) => g.preseason === true) && (await R.get("season:start")) === "2026-10-20", "the service's season start is remembered; games before it are preseason even with no per-game flag", s0.seasonStart);
    const s1 = await slate.buildSlate({ now: Date.parse("2026-10-12T20:00:00Z"), events: events.map((e) => ({ ...e, markets: [] })), injuries: { teams: {}, t: "x" }, model: null, record: false, otSets: {} });
    ok(s1.modelOk === null, "no game with lines -> nothing sent -> modelOk is null, not false", s1.modelOk);
    const model = { ok: true, builtAt: "x", seasonStart: "2026-10-01", games: polyGames(events).map((g) => ({ key: g.key, away: g.away, home: g.home, model: { margin: 3, total: 225 }, spread: { line: -8.5 }, ml: { pick: { label: `${g.home} ML`, pct: 74, tier: "pick", team: g.home } }, total: { line: 223.5 }, lines: LINES(g.away, g.home), injuries: { home: [], away: [] }, preseason: false })) };
    const s2 = await slate.buildSlate({ now: Date.parse("2026-10-12T20:00:00Z"), events, injuries: { teams: {}, t: "x" }, model, record: false, otSets: {} });
    ok(s2.parlays.every((p) => s2.dates.includes(p.date)) && !s2.parlays.some((p) => p.type === "sgp_pts") && s2.parlays.filter((p) => p.type === "fav4").every((p) => p.legs.every((l) => s2.games.find((g) => g.key === l.game).date === p.date)), "every parlay carries its day and the 4 favorites of a day are that day's games", s2.parlays.map((p) => [p.type, p.date])); } }

// ---------- watchdog: the service's stale downloads and reload errors are named
{ const { computeWatch, railwayHealth } = await import("../lib/status.js"), now = Date.parse("2026-12-01T20:00:00Z"), snap = { t: new Date(now).toISOString(), games: 5, modelOk: true };
  const envWas = process.env.NBA_MODEL_SERVICE_URL; process.env.NBA_MODEL_SERVICE_URL = "http://model.test";
  const h = await railwayHealth(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, engine: true, stale: { team_box_2027: "github down" }, error: "reload failed: x" }) }));
  if (envWas === undefined) delete process.env.NBA_MODEL_SERVICE_URL; else process.env.NBA_MODEL_SERVICE_URL = envWas;
  ok(h.ok && h.stale && h.stale.team_box_2027 && /reload failed/.test(h.error), "health reply carries stale files and the engine's last error", h);
  const w = computeWatch({ snap, railway: h, pinnacle: new Date(now).toISOString(), now });
  ok(w.some((x) => /could not download team_box_2027/.test(x)) && w.some((x) => /reload failed/.test(x)), "watchdog names the stale download and the reload error", w);
  ok(!computeWatch({ snap, railway: { ok: true, stale: null, error: null }, pinnacle: new Date(now).toISOString(), now }).some((x) => /download|reports/.test(x)), "silent when the service is healthy");
  const wp = computeWatch({ snap, railway: { ok: true, stale: { play_by_play_2027: "play-by-play ends 2026-11-20, box scores reach 2026-11-24" }, error: null }, pinnacle: new Date(now).toISOString(), now });
  ok(wp.some((x) => /ESPN's play-by-play is behind \(play-by-play ends 2026-11-20.*SHOT QUALITY picks are off/.test(x)) && !wp.some((x) => /could not download/.test(x)), "late play-by-play gets its own watchdog line (SHOT QUALITY off), not the download line", wp); }

// ---------- record window (10/16): picks, parlays and alerts are saved from the day before tip-off, not when a game first appears on the slate
{ const R = globalThis.__TEST_REDIS__, al = await import("../lib/alerts.js");
  ok([...slate.recordWindow(Date.parse("2026-10-16T20:00:00Z"))].join() === "2026-10-16,2026-10-17" && [...slate.recordWindow(Date.parse("2026-10-17T03:30:00Z"))].join() === "2026-10-16,2026-10-17", "the window is today and tomorrow, Eastern (11:30 PM ET is still today)");
  ok(slate.dayAfter("2026-10-31") === "2026-11-01" && slate.dayAfter("2026-12-31") === "2027-01-01", "the day after a date");
  const gs = polyGames(events), model = { ok: true, builtAt: "x", seasonStart: "2026-10-01", games: gs.map((g) => ({ key: g.key, away: g.away, home: g.home, model: { margin: 3, total: 225 }, spread: { line: -8.5 }, ml: { pick: { label: `${g.home} ML`, pct: 74, tier: "pick", team: g.home } }, total: { line: 223.5 }, lines: LINES(g.away, g.home), injuries: { home: [], away: [] }, preseason: false })) };
  const clear = async () => { for (const k of [...(await R.keys("pick:2026-10-12:*")), ...(await R.keys("parlay:2026-10-12*")), ...(await R.keys("alertbase:2026-10-12:*"))]) await R.del(k); };
  const picks12 = async () => (await rec.loadPicks()).filter((p) => p.date === "2026-10-12").length, parlays12 = async () => (await R.keys("parlay:2026-10-12*")).length;
  await clear(); const a0 = (await al.listAlerts(500)).length;
  const far = await slate.buildSlate({ now: Date.parse("2026-10-08T20:00:00Z"), events, injuries: { teams: {}, t: "x" }, model, record: true, otSets: {} });   // four days out
  ok(far.games.length === gs.length && far.bestBets.length > 0 && (await picks12()) === 0 && (await parlays12()) === 0 && (await al.listAlerts(500)).length === a0, "four days out: the games and their picks show, nothing is saved (no picks, parlays or alerts)", [far.games.length, far.bestBets.length]);
  const cl0 = (await cl.loadCloses({ now: Date.parse("2026-10-13T12:00:00Z") })).filter((c) => c.date === "2026-10-12").length;
  ok(cl0 >= 1, "closing lines are still saved for a game days out", cl0);
  const dayB = await slate.buildSlate({ now: Date.parse("2026-10-11T20:00:00Z"), events, injuries: { teams: {}, t: "x" }, model, record: true, otSets: {} });   // the day before
  ok((await picks12()) > 0 && (await parlays12()) === dayB.parlays.filter((p) => p.date === "2026-10-12").length && (await al.listAlerts(500)).length > a0, "the day before tip-off: picks, every parlay built and PICK alerts are saved (10/19: no bought-lines parlay, so this slate builds none)", [await picks12(), await parlays12()]); }

// ---------- admin actions (10/16): clear a day's early rows (kept under removed:*), start the rebuild
{ const R = globalThis.__TEST_REDIS__, adm = await import("../lib/admin.js");
  const base = mk("BOS", "NYK", { key: "BOS @ NYK", date: "2026-12-20", start: "2026-12-21T00:00:00Z" }), g = { ...base, card: cp.buildCard(base) };
  await rec.recordPicks([g], Date.parse("2026-12-20T14:00:00Z"));
  await R.set("parlay:2026-12-20:fav4", JSON.stringify({ type: "fav4", date: "2026-12-20", legs: [] })); await R.sadd("parlay:ids", "parlay:2026-12-20:fav4");
  const before = (await rec.loadPicks()).filter((p) => p.date === "2026-12-20").length;
  const refused = await adm.unrecordDay("2026-12-20", Date.parse("2026-12-19T20:00:00Z"));
  ok(refused.ok === false && (await rec.loadPicks()).filter((p) => p.date === "2026-12-20").length === before, "a day inside the record window (tomorrow) cannot be cleared");
  const done = await adm.unrecordDay("2026-12-20", Date.parse("2026-12-10T20:00:00Z"));
  ok(done.ok && done.picks === before && done.parlays === 1 && before >= 3 && (await rec.loadPicks()).filter((p) => p.date === "2026-12-20").length === 0 && !(await R.get("parlay:2026-12-20:fav4")) && !(await R.smembers("parlay:ids")).includes("parlay:2026-12-20:fav4"), "a day outside the window: its picks and parlays leave the record and the id lists", done);
  ok((await R.keys("removed:pick:2026-12-20:*")).length === before && JSON.parse(await R.get("removed:parlay:2026-12-20:fav4")).type === "fav4", "nothing is deleted: every row is kept under removed:*");
  const envWas = process.env.NBA_MODEL_SERVICE_URL, tokWas = process.env.NBA_MODEL_SERVICE_TOKEN; process.env.NBA_MODEL_SERVICE_URL = "http://model.test"; process.env.NBA_MODEL_SERVICE_TOKEN = "t"; let hit = null;
  const rb = await adm.startRebuild(async (url, o) => { hit = { url, method: o.method, token: o.headers["X-Model-Token"] === "t" }; return { status: 200, json: async () => ({ ok: true, started: true }) }; });
  if (envWas === undefined) delete process.env.NBA_MODEL_SERVICE_URL; else process.env.NBA_MODEL_SERVICE_URL = envWas;
  if (tokWas === undefined) delete process.env.NBA_MODEL_SERVICE_TOKEN; else process.env.NBA_MODEL_SERVICE_TOKEN = tokWas;
  ok(rb.ok && rb.started && hit && hit.url === "http://model.test/rebuild" && hit.method === "POST" && hit.token, "the rebuild is started with one POST to the service, with the token", { rb, hit });
  const { default: handler } = await import("../../pages/api/nba/admin.js"); let out = null;
  const res = { setHeader() {}, status(c) { return { json(j) { out = { c, j }; } }; } };
  await handler({ query: { do: "nothing" } }, res); ok(out && out.c === 400, "an unknown action is refused");
  await handler({ query: { do: "unrecord", date: "2026-12-20" } }, res); ok(out && out.c === 200 && out.j.ok && out.j.picks === 0, "the route runs the action and reports counts", out && out.j); }

// ---------- computer layout (10/16): the page marks itself desktop on a wide screen with a mouse; the app fits the whole screen there
{ const html = readFileSync(new URL("../../public/nba/index.html", import.meta.url), "utf8"), js = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/html\.desktop \.wrap \{[^}]*max-width:none/.test(html) && !/\.tabs\b|chips\.dock/.test(html) && /html\.desktop \.tiles \{[^}]*auto-fit, minmax\(300px, 1fr\)/.test(html), "on a computer the content spans the whole screen and the game tiles use every column that fits (owner: fit the whole screen); no tab bar or docked strip styles left");
  ok(/html\.desktop \.mk \.prl \{[^}]*flex-start/.test(html) && /html\.desktop \.mk \.prl > \.s \{[^}]*flex:0 0 118px/.test(html), "on a computer the market numbers sit next to their labels (fixed label width), not at the far right");
  ok(/\.trow \{ display:flex; justify-content:space-between/.test(html) && /\.mk \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html) && /#detail \.card \.inner > \.drop\.open \{/.test(html) && /\.hd\.hm \{[^}]*margin-top:14px/.test(html) && !/\.f \{/.test(html), "game page v3 styles: title row, two-column market grid, drop-down at the top of the card, MODEL header spaced below the market");
  ok(/html\.desktop \.fab, html\.desktop \.toast \{[^}]*right:24px/.test(html) && !/980px/.test(html.slice(html.indexOf("html.desktop"))), "the lever and toast sit at the window's right edge on a computer; no 980px column remains in the computer rules");
  ok(/const DESK_Q = "\(min-width: 760px\) and \(pointer: fine\)"/.test(js) && /classList\.toggle\("desktop", on\)/.test(js) && /addEventListener\("change", markDesktop\)/.test(js), "app.js sets html.desktop from the screen width + a mouse and re-checks on change");
  ok(!/@media \(min-width: ?760px\)[^}]*\.tabs/.test(html), "the phone layout rules are untouched (no width-based override of the tab bar outside html.desktop)"); }

// ---------- 10/17: live tiles keep their size; started games show ESPN's score, finished ones FINAL (not LIVE forever)
{ const h = readFileSync(new URL("../../public/nba/index.html", import.meta.url), "utf8"), app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/\.live:not\(\.tile\) \{ width:7px/.test(h), "the 7px 'live' dot rule never applies to a live game tile");
  ok(/fetch\("\/api\/nba\/live"/.test(app) && /fin \? "FINAL" : "● LIVE · "/.test(app) && /tile\$\{live \? " live" : ""\}/.test(app), "NBA tiles: live score + clock, finished games FINAL with the score, no live glow once final"); }
{ // 10/20 review: a PICK w/ POINTS saved on the other side of the saved PICK (before the 10/19 one-side rule) is replaced before tip-off; the old row is kept
  const R = globalThis.__TEST_REDIS__, D = "2026-12-30", G = "BOS @ DET", K = (id) => `pick:${D}:${G}:${id}`;
  await R.set(K("modelpick|spread"), JSON.stringify({ date: D, game: G, id: "modelpick|spread", market: "spread", team: "DET", line: 1.5, label: "DET +1.5" }));
  await R.set(K("ptspick|spread"), JSON.stringify({ date: D, game: G, id: "ptspick|spread", market: "spread", team: "BOS", line: 1.5, label: "BOS +1.5" })); await R.sadd("pick:ids", K("ptspick|spread"));
  const g = { key: G, date: D, start: "2026-12-31T00:00:00Z", card: { spread: { plain: { id: "modelpick|spread", team: "DET", line: 1.5, pick: "DET +1.5", hit: 49.4 }, pts: { id: "ptspick|spread", team: "DET", line: 3.5, pick: "DET +3.5", hit: 53.4, points: 2 } } } };
  await rec.recordPicks([g], Date.parse("2026-12-30T14:00:00Z"));
  const now = JSON.parse(await R.get(K("ptspick|spread"))), kept = JSON.parse(await R.get(`removed:${K("ptspick|spread")}`));
  ok(now.label === "DET +3.5" && kept.label === "BOS +1.5", "record (10/20): a saved PICK w/ POINTS on the other side of the PICK is replaced by the one-side line before tip-off; the old one is kept under removed:", { now, kept });
  const g2 = { ...g, card: { spread: { plain: g.card.spread.plain } } };
  await R.set(K("ptspick|spread"), JSON.stringify({ date: D, game: G, id: "ptspick|spread", market: "spread", team: "BOS", line: 1.5, label: "BOS +1.5" }));
  await rec.recordPicks([g2], Date.parse("2026-12-30T15:00:00Z"));
  ok(!(await R.get(K("ptspick|spread"))) && !(await R.smembers("pick:ids")).includes(K("ptspick|spread")), "record (10/20): with no one-side line on the card the opposite one leaves the record");
  // the card's PICK flips to BOS later (the saved PICK DET +1.5 stands): its BOS PICK w/ POINTS is never saved, on any build -- no save / remove churn,
  // and the removed: copy keeps the FIRST replaced row
  const g3 = { ...g, card: { spread: { plain: { id: "modelpick|spread", team: "BOS", line: -1.5, pick: "BOS -1.5", hit: 49.4 }, pts: { id: "ptspick|spread", team: "BOS", line: 0.5, pick: "BOS +0.5", hit: 55.1, points: 2 } } } };
  for (const t of ["2026-12-30T16:00:00Z", "2026-12-30T17:00:00Z"]) await rec.recordPicks([g3], Date.parse(t));
  ok(!(await R.get(K("ptspick|spread"))) && JSON.parse(await R.get(`removed:${K("ptspick|spread")}`)).label === "BOS +1.5" && JSON.parse(await R.get(K("modelpick|spread"))).label === "DET +1.5",
    "record (10/20): a PICK w/ POINTS on the other side of the SAVED PICK is never saved (no churn); the removed: copy keeps the first row");
  // 10/26 night: a ptspick|total saved under a model-side total before the change leaves the record before tip-off (kept under removed:); a rule total's buy stays
  await R.set(K("modelpick|total"), JSON.stringify({ date: D, game: G, id: "modelpick|total", market: "total", side: "under", line: 230.5, label: "Under 230.5" }));
  await R.set(K("ptspick|total"), JSON.stringify({ date: D, game: G, id: "ptspick|total", market: "total", side: "under", line: 232.5, label: "Under 232.5", points: 2 })); await R.sadd("pick:ids", K("ptspick|total"));
  const gT = { key: G, date: D, start: "2026-12-31T00:00:00Z", card: { total: { plain: { id: "modelpick|total", side: "under", line: 230.5, pick: "Under 230.5", hit: 50.4 }, pts: null } } };
  await rec.recordPicks([gT], Date.parse("2026-12-30T18:00:00Z"));
  ok(!(await R.get(K("ptspick|total"))) && !(await R.smembers("pick:ids")).includes(K("ptspick|total")) && /model-side total/.test(JSON.parse(await R.get(`removed:${K("ptspick|total")}`)).why),
    "record (10/26 night): a saved PICK w/ POINTS under a model-side total leaves the record before tip-off (kept under removed:)");
  await R.del(`removed:${K("ptspick|total")}`); await R.set(K("cardpick|total"), JSON.stringify({ date: D, game: G, id: "cardpick|total", market: "total", side: "under", line: 230.5, label: "Under 230.5", ruleId: "bookgap|total" }));
  await R.set(K("ptspick|total"), JSON.stringify({ date: D, game: G, id: "ptspick|total", market: "total", side: "under", line: 232.5, label: "Under 232.5", points: 2 })); await R.sadd("pick:ids", K("ptspick|total"));
  const gR = { key: G, date: D, start: "2026-12-31T00:00:00Z", card: { total: { plain: { id: "cardpick|total", ruleId: "bookgap|total", side: "under", line: 230.5, pick: "Under 230.5", hit: 64.1 }, pts: { id: "ptspick|total", side: "under", line: 232.5, pick: "Under 232.5", hit: 66.7, points: 2 } } } };
  await rec.recordPicks([gR], Date.parse("2026-12-30T18:30:00Z"));
  ok(JSON.parse(await R.get(K("ptspick|total"))).label === "Under 232.5" && !(await R.get(`removed:${K("ptspick|total")}`)), "record (10/26 night): a rule total's PICK w/ POINTS stays");
  for (const k of await R.keys(`*pick:${D}*`)) await R.del(k); }
{ // 10/20 review: sportsbook lines only while current (36 h): opening night showed the 10/14 pull as today's
  const { booksCurrent } = await import("../lib/slate.js"), now = Date.parse("2026-10-20T02:00:00Z");
  ok(!booksCurrent({ t: "2026-10-14T07:58:33Z" }, now) && booksCurrent({ t: "2026-10-19T14:00:00Z" }, now) && !booksCurrent(null, now) && !booksCurrent({}, now), "books: a pull older than 36 h is not shown on the cards (opening night: six days old)"); }
{ // 10/20: NBA player props (Polymarket US lists them now) are RECORDED in the background, nothing shown
  const { nbaPropsFromEvent, recordNbaProps, K_NBAPROPS } = await import("../lib/props.js"), R = globalThis.__TEST_REDIS__;
  const ev = { rawProps: [{ sportsMarketType: "basketball_player_assists", line: 3, title: "John Collins 3+ assists", bestAskQuote: { value: "0.97" }, bestBidQuote: { value: "0.95" } },
    { sportsMarketType: "basketball_player_points", line: 15, titleShort: "Jayson Tatum 15+ Pts", bestAskQuote: { value: "0.62" } }, { sportsMarketType: "basketball_game_overtime", line: 1, title: "Overtime" }, { sportsMarketType: "basketball_player_rebounds", line: 6, title: "Jalen Duren 6+ rebounds", closed: true }] };
  const rows = nbaPropsFromEvent(ev);
  ok(rows.length === 2 && rows[0].name === "John Collins" && rows[0].stat === "ast" && rows[0].line === 2.5 && rows[0].oa === 0.97 && rows[0].ub === undefined && rows[0].ua === 0.05 && rows[1].name === "Jayson Tatum" && rows[1].stat === "pts" && rows[1].line === 14.5 && rows[1].ob === null, "NBA props: 'N+' = Over N-0.5, name from the title, no game markets, no closed ones", rows);
  await recordNbaProps("2026-12-30", "BOS @ DET", rows, "2026-12-30T10:00:00Z"); await recordNbaProps("2026-12-30", "BOS @ DET", [{ ...rows[0], oa: 0.9 }], "2026-12-30T11:00:00Z");
  const saved = JSON.parse(await R.get(K_NBAPROPS("2026-12-30", "BOS @ DET")));
  ok(saved.first === "2026-12-30T10:00:00Z" && saved.m["John Collins|ast|2.5"][0] === 0.9 && saved.m["John Collins|ast|2.5"][3] === 0.97 && saved.m["Jayson Tatum|pts|14.5"], "NBA props: the first price stays next to the latest; one key per game and day");
  await R.del(K_NBAPROPS("2026-12-30", "BOS @ DET")); }
{ // 10/20: System shows the NBA prop recorder's footprint
  const { getStatus } = await import("../lib/status.js"), R = globalThis.__TEST_REDIS__;
  await R.set("nbaprops:2026-12-30:BOS @ DET", JSON.stringify({ first: "2026-12-30T10:00:00Z", t: "2026-12-30T11:00:00Z", m: {} }));
  const st = await getStatus({ fetcher: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) });
  ok(st.props && st.props.days === 1 && st.props.lastDay === "2026-12-30" && st.props.latest === "2026-12-30T11:00:00Z", "NBA status: prop recorder days + newest write", st.props);
  ok(/Player prop lines recorded/.test(readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8")), "NBA System row for the prop recorder");
  await R.del("nbaprops:2026-12-30:BOS @ DET"); }

{ // 10/20 owner: "Model (Team):" line on the NBA spread card (same as NFL); NBA's team model is data only (walk-forward 50.7%), so no rule reads it
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8"), svc = readFileSync(new URL("../railway-model-service/live.py", import.meta.url), "utf8"), mod = readFileSync(new URL("../railway-model-service/team_side.py", import.meta.url), "utf8");
  ok(/Model \(Team\):<\/span> <b class="mod">\$\{esc\(m\.teamSide\.team\)\} \$\{sgn\(m\.teamSide\.line\)\} · \$\{m\.teamSide\.pct\}%/.test(app) && /teamSide/.test(svc) && /def prob_home_covers/.test(mod) && /never a pick/.test(mod)
    && !/teamSide|teammodel/.test(readFileSync(new URL("../lib/cardpick.js", import.meta.url), "utf8")),
    "NBA card: Model (Team) line under Model (team, line, sure %), fed by the service's team-numbers fit; data only -- the NBA card picker never reads it");
}
{ // 10/27 night research: a PRA Over's % = 0.8 x the model + 0.2 x the price (Polymarket underprices PRA); every other stat stays 0.4 / 0.6
  const pr = await import("../lib/props.js");
  ok(Math.abs(pr.effChance({ side: "over", stat: "pra", chance: 0.8, price: 0.6 }) - 0.76) < 1e-9 && Math.abs(pr.effChance({ side: "over", stat: "pts", chance: 0.8, price: 0.6 }) - 0.68) < 1e-9
    && pr.effChance({ side: "under", stat: "pra", chance: 0.8, price: 0.6 }) === 0.8, "NBA props: PRA Overs blend 0.8 model, other stats 0.4, Unders the model's own %");
}
{ // 10/20 (owner: "Player props", bar 62%): NBA prop picks, one row per player and stat, scoring saved per game, grading from ESPN's box score
  const pr = await import("../lib/props.js"), { parseBox } = await import("../lib/espn.js"), R = globalThis.__TEST_REDIS__;
  const rows = [{ name: "Jaylen Brown", team: "BOS", stat: "pts", line: 19.5, mu: 24.9, over: 0.73, under: 0.27 }, { name: "Jaylen Brown", team: "BOS", stat: "pts", line: 24.5, mu: 24.9, over: 0.5, under: 0.5 },
    { name: "Cade Cunningham", team: "DET", stat: "pra", line: 39.5, mu: 34, over: 0.28, under: 0.72 }, { name: "Jalen Duren", team: "DET", stat: "reb", line: 9.5, mu: 9.2, over: 0.45, under: 0.55 }, { name: "Derrick White", team: "BOS", stat: "3pm", line: 2.5, mu: 2.3, over: 0.39, under: 0.61 }];
  const saved = { m: { "Jaylen Brown|pts|19.5": [0.67, 0.65, 0.33, 0.67, "t"], "Cade Cunningham|pra|39.5": [0.4, 0.38, 0.62, 0.4, "t"] } };
  const picks = pr.nbaPropPicks(rows, saved);
  ok(pr.nbaPropPicks([{ name: "Paul George", team: null, stat: "pts", line: 14.5, mu: 9, over: 0.2, under: 0.8 }], saved).length === 0, "NBA props: a player the model puts on neither team (Polymarket listed him under the wrong game) is not a row");
  ok(pr.NBA_PROP_BAR === 0.65 && pr.MAX_PRICE === 0.82 && picks.length === 2 && picks[0].side === "over" && picks[0].price === 0.67 && picks[0].band === "70-80" && picks[1].side === "under" && picks[1].price === 0.62 && picks[1].band === "70-80" && !picks.some((p) => p.stat === "3pm"), "NBA props: the side the model likes more, only at 65%+ (10/21; a 61% Under and a 55% Under are not picks), with that side's price", picks);
  const one = pr.onePerPlayer([{ name: "A", stat: "pts", chance: 0.8, price: 0.9 }, { name: "A", stat: "pts", chance: 0.7, price: 0.6 }, { name: "A", stat: "pts", chance: 0.8, price: 0.82 }, { name: "A", stat: "reb", chance: 0.65, price: null }, { name: "B", stat: "pts", chance: 0.66, price: 0.66 }]);
  ok(one.length === 1 && one[0].name === "A" && one[0].chance === 0.7, "NBA props: one row per player and stat = the highest % priced under its % and under 82c (80% at 90c and 80% at 82c are out, owner 10/29: cap 82c); no price = not a row (10/21); a line priced at its % is dropped", one);
  const two = pr.onePerPlayer([{ name: "Jayson Tatum", stat: "pra", chance: 0.985, price: null }, { name: "Jayson Tatum", stat: "pra", chance: 0.74, price: 0.6 }]);
  ok(two.length === 1 && two[0].chance === 0.74, "NBA props: an unpriced 98.5% rung never pushes the player's priced line off the page (10/21 recheck)", two);
  // scoring: a not-started game with recorded lines is sent to the service, the answer saved per game; a started game is not
  await R.set(pr.K_NBAPROPS("2026-12-30", "BOS @ DET"), JSON.stringify(saved));
  let sent = null; const post = async (b) => { sent = b; return { ok: true, built: "x", results: [{ game: "BOS @ DET", rows }] }; };
  const now = Date.parse("2026-12-30T20:00:00Z"), games = [{ key: "BOS @ DET", away: "BOS", home: "DET", date: "2026-12-30", start: "2026-12-31T00:00:00Z", injuries: { away: [{ name: "Jayson Tatum", status: "Out" }, { name: "Al Horford", status: "Questionable" }], home: [] } },
    { key: "LAL @ GSW", away: "LAL", home: "GSW", date: "2026-12-30", start: "2026-12-30T19:00:00Z" }];
  process.env.NBA_MODEL_SERVICE_URL = process.env.NBA_MODEL_SERVICE_URL || "http://test"; const sc = await pr.scoreNbaProps(games, { now, post });
  ok(sc.scored === 1 && sent.games.length === 1 && sent.games[0].outs.join() === "Jayson Tatum" && sent.games[0].quest.join() === "Al Horford" && sent.games[0].lines.length === 2 && JSON.parse(await R.get(pr.K_NBAPROPMODEL("2026-12-30", "BOS @ DET"))).rows.length === 5, "NBA props: the snapshot scores the not-started game's recorded lines with the Out list (+ the Questionable list for the teammates-out input, 10/21); the started game is skipped; saved per game", sc);
  { // 10/23: a missed reply (timeout / empty) is asked once more; "building" is not; two misses report the error
    let calls = 0; const flaky = async (b) => { calls++; if (calls === 1) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); return { ok: true, results: [{ game: "BOS @ DET", rows }] }; };
    const r1 = await pr.scoreNbaProps(games, { now, post: flaky, retryMs: 0 });
    let c2 = 0; const dead = async () => { c2++; return null; }; const r2 = await pr.scoreNbaProps(games, { now, post: dead, retryMs: 0 });
    let c3 = 0; const bld = async () => { c3++; return { ok: false, building: true }; }; const r3 = await pr.scoreNbaProps(games, { now, post: bld, retryMs: 0 });
    let c4 = 0; const tdead = async () => { c4++; if (c4 === 1) throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); return null; }; const r4 = await pr.scoreNbaProps(games, { now, post: tdead, retryMs: 0 });
    ok(calls === 2 && r1.scored === 1 && r1.retried && c2 === 2 && r2.scored === 0 && r2.error === "no reply" && c3 === 1 && r3.building && c4 === 2 && /TimeoutError/.test(r4.error), "NBA props (10/23): a timeout / empty reply is retried once (then scored); two misses report the error; a model being built is not asked twice", { r1, r2, r3, r4 }); }
  { // 10/23 recheck: 20 games in one request timed out twice -- games go 3 at a time, nearest tip-off first, a failed group costs only its own games
    const many = []; for (let i = 0; i < 7; i++) { const k = `T${i} @ H${i}`; many.push({ key: k, away: `T${i}`, home: `H${i}`, date: "2026-12-30", start: `2026-12-31T0${6 - i}:00:00Z`, poly: { spread: { homeSpread: 3.5 } } }); await R.set(pr.K_NBAPROPS("2026-12-30", k), JSON.stringify(saved)); }
    const seen = []; const grp = async (b) => { seen.push(b.games.map((x) => x.away)); if (seen.length === 2 || seen.length === 3) return null; return { ok: true, results: b.games.map((x) => ({ game: `${x.away} @ ${x.home}`, rows: [{ ...rows[0], team: x.home }] })) }; };
    const rg = await pr.scoreNbaProps(many, { now, post: grp, retryMs: 0 });
    const m6 = JSON.parse(await R.get(pr.K_NBAPROPMODEL("2026-12-30", "T6 @ H6")) || "null");
    ok(pr.CHUNK === 3 && seen.length === 4 && seen[0].join() === "T6,T5,T4" && rg.scored === 4 && /1 of 3 groups/.test(rg.error) && m6 && m6.rows[0].tsp === 3.5, "NBA props (10/23 recheck): games are sent 3 at a time, nearest tip-off first; a group that misses twice costs only its own 3 games (4 of 7 scored, the miss reported); the team spread is saved on every row", { seen, rg });
    for (const g of many) { await R.del(pr.K_NBAPROPS("2026-12-30", g.key)); await R.del(pr.K_NBAPROPMODEL("2026-12-30", g.key)); } }
  { // 10/21: LAST = the row the page SHOWED that day (onePerPlayer), not the first graded line of the ladder
    await R.hset(pr.K_NBAPROPRES("2026-12-29"), "BOS @ NYK", JSON.stringify({ picks: [{ name: "Jaylen Brown", stat: "pts", side: "over", line: 14.5, chance: 0.9, price: 0.92, result: "W", actual: 27 }, { name: "Jaylen Brown", stat: "pts", side: "over", line: 22.5, chance: 0.75, price: 0.62, result: "W", actual: 27 }] }));
    const lw = await pr.lastNbaProps("2026-12-30", ["2026-12-29"]); await R.del(pr.K_NBAPROPRES("2026-12-29"));
    ok(lw["Jaylen Brown|pts"] && lw["Jaylen Brown|pts"].line === 22.5, "NBA props LAST (10/21): the line the page showed that day (the 92c line was never shown)", lw); }
  // the page's day: two rows (Brown Over 19.5, Cunningham Under 39.5)
  const day = await pr.nbaPropsForDay("2026-12-30");
  ok(day.length === 1 && day[0].game === "BOS @ DET" && day[0].picks.length === 1 && day[0].picks[0].name === "Jaylen Brown" && day[0].picks[0].result === null, "NBA props page: the day's games with their rows, ungraded; Cunningham's Under is not shown (10/23: NBA Unders cut -- Polymarket sells no Under on NBA props)", day);
  // grading from a box score: Brown 27 pts (Over 19.5 wins), Cunningham 44 pra (Under 39.5 loses)
  const box = { "BOS @ DET": { final: true, players: { "jaylen brown": { pts: 27, reb: 5, ast: 4, pra: 36, "3pm": 2, stl: 1, blk: 0 }, "cade cunningham": { pts: 30, reb: 6, ast: 8, pra: 44, "3pm": 3, stl: 1, blk: 1 } } } };
  const g = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2026-12-31T08:00:00Z"), fetchBox: async () => box });
  const rec = await pr.nbaPropsRecord(["2026-12-30"]), day2 = await pr.nbaPropsForDay("2026-12-30");
  const graded = JSON.parse(await R.hget(pr.K_NBAPROPRES("2026-12-30"), "BOS @ DET")).picks;
  ok(g === 1 && rec.all.w === 1 && rec.all.l === 0 && rec.pts.w === 1 && rec.pra.l === 0 && rec.reb.w === 0 && day2[0].final && day2[0].picks.find((p) => p.name === "Jaylen Brown").result === "W" && graded.find((p) => p.name === "Cade Cunningham").result === "L", "NBA props grading: W / L from the box score, RECORD per stat (Overs only since 10/23), the page shows ✓ / ✗; the cut Under is still graded in the background", { g, rec });
  ok((await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2026-12-31T08:00:00Z"), fetchBox: async () => { throw new Error("no"); } })) === 0, "NBA props grading: a graded game is never graded twice");
  { // 10/22 (owner): the page's % is the calibrated chance (`cal`, the same number the prop parlay legs use); the rows stay the model's own
    const bands = await pr.propCalibration(Date.now(), true), d = await pr.nbaPropsForDay("2026-12-30", Date.now() + 1);
    ok(d[0].picks.every((p) => typeof p.cal === "number" && Math.abs(p.cal - pr.calibrate(p.chance, bands)) < 1e-9) && /p\.cal \?\? p\.chance/.test(readFileSync("public/nba/app.js", "utf8")), "NBA props page: every row carries its calibrated % and the page shows it (10/22)", d[0].picks); }
  { // 10/21 review: ESPN corrects box scores after the final -> one more look 6+ hours later re-grades the saved rows (Cunningham's PRA 44 -> 38 flips Under 39.5 to a win), then never again
    const fixedBox = { "BOS @ DET": { final: true, players: { ...box["BOS @ DET"].players, "cade cunningham": { pts: 26, reb: 5, ast: 7, pra: 38, "3pm": 3, stl: 1, blk: 1 } } } };
    const early = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2026-12-31T10:00:00Z"), fetchBox: async () => fixedBox });
    const g2 = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2026-12-31T15:00:00Z"), fetchBox: async () => fixedBox });
    const cc = JSON.parse(await R.hget(pr.K_NBAPROPRES("2026-12-30"), "BOS @ DET")).picks.find((p) => p.name === "Cade Cunningham");   // 10/23: the Under is graded in the background, not shown
    { const ga = await pr.nbaPropsGradedAll("2026-12-30");   // 10/23: every graded row for npm run verify (the background Unders too)
      ok(ga.graded.length >= 1 && ga.graded.some((g) => g.picks.some((p) => p.name === "Cade Cunningham" && p.side === "under" && p.result === "W")) && !ga.missing.includes("BOS @ DET"), "NBA props ?all=1 (10/23): every graded row, the Unders the page hides included", ga); }
    const g3 = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2026-12-31T23:00:00Z"), fetchBox: async () => { throw new Error("no second look"); } });
    ok(early === 0 && g2 === 1 && cc.result === "W" && cc.actual === 38 && g3 === 0 && pr.RECHECK_H === 6, "NBA props grading: a graded game is looked at again 6+ hours later and a corrected box score re-grades its rows; not again within 20 h", { early, g2, cc, g3 });
    // 10/26: ESPN kept correcting a day+ later -> 2 more looks, 20+ h apart (3 in all), then never again
    const box2 = { "BOS @ DET": { final: true, players: { ...fixedBox["BOS @ DET"].players, "cade cunningham": { pts: 30, reb: 6, ast: 8, pra: 44, "3pm": 3, stl: 1, blk: 1 } } } };
    const g4 = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2027-01-01T12:00:00Z"), fetchBox: async () => box2 });
    const r4 = JSON.parse(await R.hget(pr.K_NBAPROPRES("2026-12-30"), "BOS @ DET"));
    const g5 = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2027-01-02T10:00:00Z"), fetchBox: async () => fixedBox });
    const g6 = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse("2027-01-04T10:00:00Z"), fetchBox: async () => { throw new Error("no fourth look"); } });
    const r6 = JSON.parse(await R.hget(pr.K_NBAPROPRES("2026-12-30"), "BOS @ DET"));
    ok(g4 === 1 && r4.rechecks === 2 && r4.picks.find((p) => p.name === "Cade Cunningham").result === "L" && g5 === 1 && g6 === 0 && r6.rechecks === 3 && r6.fixed === 3 && pr.recheckCount({ rechecked: "x" }) === 1 && pr.RECHECKS === 8 && !pr.recheckDue({ rechecks: 8, checkedAt: "2000-01-01T00:00:00Z" }, Date.now(), "2000-01-01T00:00:00Z"),
      "NBA props re-check: looks 6 h after the grade, then every 20 h (a failed look writes nothing), each correction re-grades the rows; an old `rechecked` row counts as 1", { g4, g5, g6, r6 }); 
  // 10/28: ?do=regradeprops forces a look now (ESPN fixed 10/23-25 boxes after the rows' last look): not due by the clock, still re-graded, counted
  { const R0 = JSON.parse(await R.hget(pr.K_NBAPROPRES("2026-12-30"), "BOS @ DET"));
    const nf = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse(R0.checkedAt) + 3600e3, fetchBox: async () => { throw new Error("not due"); } });
    const gf = await pr.gradeNbaProps({ dates: ["2026-12-30"], now: Date.parse(R0.checkedAt) + 3600e3, fetchBox: async () => box2, force: true });
    const R1 = JSON.parse(await R.hget(pr.K_NBAPROPRES("2026-12-30"), "BOS @ DET"));
    ok(nf === 0 && gf === 1 && R1.rechecks === R0.rechecks + 1 && R1.picks.find((p) => p.name === "Cade Cunningham").result === "L" && pr.recheckDue({ rechecks: 8, checkedAt: new Date().toISOString() }, Date.now(), null, true),
      "NBA props forced re-check (10/28): a row looked at 1 h ago is not due by the clock, but a forced look re-grades it now and counts", { nf, gf, R1 }); }
  }
  // 10/28: one box read per day shared by props + parlays; a failed read is retried next time; boxFor asks for the games' summaries together
  { const es28 = await import("../lib/espn.js"); let calls = 0; const sb = es28.sharedBox(async (d) => { calls++; if (d === "bad" && calls < 3) throw new Error("x"); return { d }; });
    const a1 = await sb("2026-10-23"), a2 = await sb("2026-10-23"); let e1 = null; try { await sb("bad"); } catch (e) { e1 = e; } const a3 = await sb("bad");
    const of = globalThis.fetch; let open = 0, peak = 0;
    globalThis.fetch = async (u) => { if (/scoreboard/.test(u)) return { ok: true, json: async () => ({ events: [1, 2, 3, 4].map((i) => ({ id: String(i), status: { type: { completed: i !== 4 } } })) }) };
      open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 20)); open--; const id = u.match(/event=(\d)/)[1];
      return { ok: true, json: async () => ({ header: { competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: "away", team: { abbreviation: ["BOS", "MIA", "LAL", "DAL"][id - 1] } }, { homeAway: "home", team: { abbreviation: ["NY", "ORL", "GS", "IND"][id - 1] } }] }] }, boxscore: { players: [] } }) }; };
    let bx; try { bx = await es28.boxFor("2026-10-23"); } finally { globalThis.fetch = of; }
    ok(a1 === a2 && calls >= 2 && e1 && a3.d === "bad" && Object.keys(bx).length === 3 && peak === 3, "NBA box scores (10/28): one read per day shared in a run, a failed read retried; the finished games' summaries fetched together (unfinished left out)", { calls, peak, keys: Object.keys(bx) }); }
  // ESPN box parse (the real summary shape): 3PT "1-3" = 1 made, a DNP is left out, the key from the header
  const b = parseBox({ header: { competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: "away", team: { abbreviation: "MIA" } }, { homeAway: "home", team: { abbreviation: "ORL" } }] }] },
    boxscore: { players: [{ team: { abbreviation: "MIA" }, statistics: [{ names: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"], athletes: [{ athlete: { displayName: "Andrew Wiggins Jr." }, stats: ["15", "13", "4-7", "1-3", "4-5", "2", "1", "0", "2", "0", "0", "2", "2", "-1"] }, { athlete: { displayName: "Nobody Played" }, didNotPlay: true, stats: [] }] }] }] } });
  ok(b && b.key === "MIA @ ORL" && b.final && Object.keys(b.players).length === 1 && b.players["andrew wiggins"].pts === 13 && b.players["andrew wiggins"]["3pm"] === 1 && b.players["andrew wiggins"].pra === 16 && b.players["andrew wiggins"].stl === 2, "ESPN box: player stats by normalized name (Jr. dropped), threes from '1-3', a DNP left out", b);
  for (const k of await R.keys("nbaprop*2026-12-30*")) await R.del(k);
  const api = readFileSync(new URL("../../pages/api/nba/props.js", import.meta.url), "utf8"), snap = readFileSync(new URL("../../pages/api/nba/snapshot.js", import.meta.url), "utf8"), gr = readFileSync(new URL("../../pages/api/nba/results/grade.js", import.meta.url), "utf8");
  ok(/nbaPropsForDay\(date\)/.test(api) && /scoreNbaProps\(data\.games\)/.test(snap) && /gradeNbaProps\(\{ fetchBox: box \}\)/.test(gr) && /gradeParlays\(finalsFor, box\)/.test(gr) && /const box = sharedBox\(\)/.test(gr), "NBA props: /api/nba/props serves the day; the snapshot scores; the grade run grades (props and parlay legs share one box read per day, 10/28)");
  const ap = readFileSync(new URL("../../nba/railway-model-service/app.py", import.meta.url), "utf8"), sch = readFileSync(new URL("../../nba/railway-model-service/scheduler.py", import.meta.url), "utf8");
  ok(/@app\.route\("\/prop-probs", methods=\["POST"\]\)/.test(ap) && /nba_prop_model\.chances_many/.test(ap) && /PROPS_ON_START/.test(ap) && /jobs\.append\(\("props", _props\)\)/.test(sch), "NBA service: /prop-probs route, background build when missing, daily 4:20 AM refit"); }
{ // 10/21 (owner): Props Parlays 6 / 8 / 10 legs ($5), the 65% bar, the 77c+ and star-out shadow trackers
  const pr = await import("../lib/props.js"), pl = await import("../lib/parlays.js"), R = globalThis.__TEST_REDIS__, D = "2027-01-05";
  ok(pr.onePerPlayer([{ name: "A", stat: "pts", chance: 0.64, price: 0.62 }, { name: "B", stat: "pts", chance: 0.66, price: 0.62 }]).map((p) => p.name).join() === "B", "NBA props (10/21): a row under 65% (saved under the old 62% bar) is not shown or counted");
  { const bands = { 70: { n: 100, said: 0.72, won: 0.62 } }, rows = [{ name: "A", stat: "ast", side: "over", line: 5.5, chance: 0.72, price: 0.67 }, { name: "A", stat: "ast", side: "over", line: 3.5, chance: 0.88, price: 0.74 }];
    const c = pr.onePerPlayer(rows, bands), raw = pr.onePerPlayer(rows.slice(0, 1));   // 10/23: the blend (0.4 x 72 + 0.6 x 67 = 69.0) calibrates to 64.7 < 67c -> cut; 3.5 shows
    ok(raw.length === 1 && c.length === 1 && c[0].line === 3.5 && c[0].cal > c[0].price, "NBA props (10/23): with the calibration bands a row must be priced under its calibrated (shown) %; the player's next line shows", JSON.stringify(c)); }
  { const g = pr.onePerPlayer([{ name: "A", stat: "pts", side: "over", line: 14.5, chance: 0.74, price: 0.70 }, { name: "A", stat: "pts", side: "over", line: 12.5, chance: 0.80, price: 0.72 }, { name: "B", stat: "ast", side: "over", line: 4.5, chance: 0.72, price: 0.69 }, { name: "C", stat: "pra", side: "over", line: 24.5, chance: 0.72, price: 0.69 }]);
    ok(pr.MIN_GAP === 0.02 && g.length === 2 && g[0].name === "A" && g[0].line === 12.5 && g[1].name === "C", "NBA props (10/23 night): a row must be priced 2+ points under its shown % (A 14.5: 71.6% at 70c is off, his 12.5 at 72c / 75.2% shows; B 70.2% at 69c is off; PRA is exempt: C 70.2% at 69c shows)", g); }
  { const cut = pr.onePerPlayer([{ name: "A", stat: "pts", side: "over", chance: 0.75, price: 0.59 }, { name: "A", stat: "pts", side: "under", chance: 0.7, price: 0.62 }, { name: "B", stat: "reb", side: "under", chance: 0.8, price: 0.7 }, { name: "B", stat: "reb", side: "over", chance: 0.68, price: 0.63 }, { name: "C", stat: "ast", side: "over", chance: 0.72, price: 0.55 }]);
    ok(pr.onePerPlayer([{ name: "T", stat: "3pm", side: "over", line: 0.5, chance: 0.8, price: 0.7 }]).length === 0 && pr.CUT_SIDES.has("3pm|over"), "NBA props (10/23 night): no Threes Over row (live 5-5 at 72c)");
    ok(pr.MIN_PRICE === 0.6 && pr.CUT_SIDES.has("reb|under") && pr.CUT_UNDERS && cut.length === 1 && !cut.some((p) => p.side === "under") && cut.some((p) => p.name === "B" && p.side === "over") && !cut.some((p) => p.name === "C"),
      "NBA props (10/22 night + 10/23): a row priced under 60c is not shown (A's 75% Over at 59c is off, C at 55c is off); no NBA Under at all (A's 70% Under and B's rebounds Under are off; B shows his Over)", cut); }
  { // 10/23: no Over by a player whose team is a 2.5+ point underdog; the team spread is saved with the scored rows
    const rows = pr.onePerPlayer([{ name: "Dog", stat: "pts", side: "over", chance: 0.8, price: 0.65, tsp: 3.5 }, { name: "Fav", stat: "pts", side: "over", chance: 0.8, price: 0.65, tsp: -3.5 }, { name: "Even", stat: "pts", side: "over", chance: 0.8, price: 0.65, tsp: 1.5 }, { name: "Old", stat: "pts", side: "over", chance: 0.8, price: 0.65 }]);
    const src = readFileSync(new URL("../lib/props.js", import.meta.url), "utf8");
    ok(pr.DOG_CUT === 2.5 && rows.map((p) => p.name).sort().join() === "Even,Fav,Old" && /tsp: hs == null \|\| !x\.team \? null : x\.team === t\.g\.home \? hs : -hs/.test(src),
      "NBA props (10/23): an Over by a +2.5-or-more underdog team's player is not a row (last season's real lines 47.4% of 2,300, -11.9 per $100); favorites / close games / rows saved without a spread stay", rows); }
  // 3 games, 9 players with priced 65%+ rows (one player has two stats: only his best leg)
  const mkG = (k, start) => ({ key: k, away: k.split(" @ ")[0], home: k.split(" @ ")[1], date: D, start });
  const G = [mkG("BOS @ NYK", "2027-01-06T00:00:00Z"), mkG("LAL @ GSW", "2027-01-06T03:00:00Z"), mkG("MIA @ ORL", "2027-01-06T00:30:00Z")];
  const players = { "BOS @ NYK": [["Alpha", "BOS", 0.9], ["Bravo", "BOS", 0.85], ["Charlie", "NYK", 0.8]], "LAL @ GSW": [["Delta", "LAL", 0.79], ["Echo", "GSW", 0.75], ["Foxtrot", "GSW", 0.72]], "MIA @ ORL": [["Golf", "MIA", 0.715], ["Hotel", "ORL", 0.71], ["India", "ORL", 0.705]] };
  for (const g of G) { const rows = [], m = {};
    for (const [n, tm, c] of players[g.key]) { rows.push({ name: n, team: tm, stat: "pts", line: 10.5, mu: 14, over: c, under: 1 - c }); m[`${n}|pts|10.5`] = [0.65, 0.63, 0.37, 0.65, "t"]; }
    if (g.key === "BOS @ NYK") { rows.push({ name: "Alpha", team: "BOS", stat: "reb", line: 4.5, mu: 7, over: 0.95, under: 0.05 }); m["Alpha|reb|4.5"] = [0.72, 0.7, 0.3, 0.72, "t"]; }
    await R.set(pr.K_NBAPROPMODEL(D, g.key), JSON.stringify({ rows, start: g.start, away: g.away, home: g.home })); await R.set(pr.K_NBAPROPS(D, g.key), JSON.stringify({ m })); }
  const now = Date.parse("2027-01-05T20:00:00Z"), pp = await pl.buildPropParlays(D, G, now);
  const p6 = pp.find((p) => p.type === "pp6"), p8 = pp.find((p) => p.type === "pp8");
  ok(pp.length === 2 && p6 && p8 && !pp.some((p) => p.type === "pp10") && p6.stake === 5 && p6.legs.length === 6 && p8.legs.length === 8 && p6.legs[0].label === "Alpha Reb Over 4.5" && new Set(p8.legs.map((l) => l.name)).size === 8
    && p6.start === "2027-01-06T00:00:00Z" && p6.legs.every((l) => l.market === "prop" && l.price > 0) && Math.abs(p6.prob - [0.812, 0.73, 0.71, 0.706, 0.69, 0.678].reduce((a, x) => a * x, 1)) < 0.002,
    "Props Parlays (10/21): 6 and 8 legs from 9 players (no 10 with fewer than 10), one leg per player (Alpha's 95% rebounds, not his points), strongest first, $5, start = the first tip", pp);
  { const mlG = ["A1", "A2", "A3", "A4", "A5", "A6"].map((t, i) => ({ ...mkG(`${t} @ H${i}`, "2027-01-06T02:00:00Z"), ml: { pick: { tier: "pick", team: `H${i}`, pct: 80, label: `H${i} ML` } }, poly: { ml: { home: 0.8, away: 0.22 } } }));
    ok((await pl.buildPropParlays(D, mlG, now, [])).length === 0, "Prop Parlays (10/23): games with no prop rows yet do not make a Prop Parlay of moneylines only"); }
  // grading: a prop leg from ESPN's box score; a lost leg loses the parlay
  const k = "parlay:" + D + ":pp6"; await R.set(k, JSON.stringify({ ...p6, date: D })); await R.sadd("parlay:ids", k);
  const players2 = {}; for (const [n, v] of [["alpha", { reb: 9 }], ["bravo", { pts: 20 }], ["charlie", { pts: 12 }], ["delta", { pts: 15 }], ["echo", { pts: 11 }], ["foxtrot", { pts: 4 }]]) players2[n] = v;
  const box = { "BOS @ NYK": { final: true, players: players2 }, "LAL @ GSW": { final: true, players: players2 } };
  await pl.gradeParlays(async () => ({}), async () => box);
  const gp = JSON.parse(await R.get(k));
  // 10/23: ESPN corrects a box score after the final -> the decided parlay's prop legs are re-graded once, 6+ h later; result and money follow
  await pl.gradeParlays(async () => ({}), async () => ({ ...box, "BOS @ NYK": { final: true, players: { ...players2, foxtrot: { pts: 30 } } }, "LAL @ GSW": { final: true, players: { ...players2, foxtrot: { pts: 30 } } } }), Date.now() + 2 * 3600e3);
  const g1 = JSON.parse(await R.get(k));
  await pl.gradeParlays(async () => ({}), async () => ({ ...box, "BOS @ NYK": { final: true, players: { ...players2, foxtrot: { pts: 30 } } }, "LAL @ GSW": { final: true, players: { ...players2, foxtrot: { pts: 30 } } } }), Date.now() + 7 * 3600e3);
  const g2 = JSON.parse(await R.get(k)); const fx = g2.legs.find((l) => l.name === "Foxtrot");
  { await pl.gradeParlays(async () => ({}), async () => box, Date.now() + 9 * 3600e3); const g8 = JSON.parse(await R.get(k));
    await pl.gradeParlays(async () => ({}), async () => box, Date.now() + 28 * 3600e3); const g9 = JSON.parse(await R.get(k));
    ok(g8.rechecks === 1 && g8.legs.find((l) => l.name === "Foxtrot").result === "W" && g9.rechecks === 2 && g9.legs.find((l) => l.name === "Foxtrot").result === "L" && g9.result === "L" && g9.ret === -5,
      "Props Parlays re-check (10/26): not again within 20 h; the next look re-grades the legs again (a correction back to 4 pts loses the parlay)", { g8, g9 }); }
  { const g9 = JSON.parse(await R.get(k)), corr = async () => ({ ...box, "BOS @ NYK": { final: true, players: { ...players2, foxtrot: { pts: 30 } } }, "LAL @ GSW": { final: true, players: { ...players2, foxtrot: { pts: 30 } } } });
    await pl.gradeParlays(async () => ({}), corr, Date.now() + 29 * 3600e3, { date: "1999-01-01", force: true }); const gA = JSON.parse(await R.get(k));
    await pl.gradeParlays(async () => ({}), corr, Date.now() + 29 * 3600e3, { force: true }); const gB = JSON.parse(await R.get(k));
    ok(gA.rechecks === g9.rechecks && gB.rechecks === g9.rechecks + 1 && gB.legs.find((l) => l.name === "Foxtrot").result === "W" && gB.result === "W",
      "Props Parlays forced re-check (10/28): another day's force leaves it alone; a forced look 1 h after the last re-grades the legs now (Foxtrot 30 pts = W, the parlay wins)", { gA, gB }); }
  ok(!g1.rechecked && g1.result === "L" && g2.rechecked && g2.fixed >= 1 && fx.result === "W" && fx.actual === 30 && g2.result === (g2.legs.some((l) => l.result === "L") ? "L" : "W") && (g2.result !== "W" || g2.ret > 0),
    "Props Parlays re-check (10/23): not before 6 h; then the prop legs are re-graded from the corrected box (Foxtrot 4 -> 30 pts = W) and the parlay result / money follow", g2);
  await R.del(k); await R.srem("parlay:ids", k);
  ok(gp.result === "L" && gp.ret === -5 && gp.legs.find((l) => l.name === "Foxtrot").result === "L" && gp.legs.find((l) => l.name === "Foxtrot").actual === 4 && gp.legs.find((l) => l.name === "Alpha").result === "W", "Props Parlays grading: each leg from the box score (Foxtrot 4 pts < 10.5 loses), the parlay lost $5", gp);
  // shadow trackers: a 77c+ row at 65%+ (hidden on the page) and a star-out teammate's points Over at the ~50c line
  const st = pr.starsOut({ key: "BOS @ NYK", away: "BOS", home: "NYK", injuries: { away: [{ name: "Jayson Tatum", status: "Out", ppg: 27 }, { name: "X", status: "Out", ppg: 8 }], home: [{ name: "Y", status: "Questionable", ppg: 24 }] } });
  ok(st.length === 1 && st[0].team === "BOS" && st[0].name === "Jayson Tatum", "star-out shadow: only a 20+ ppg player listed Out / Doubtful counts", st);
  const sr = pr.starRows({ star: st, rows: [{ name: "Jaylen Brown", team: "BOS", stat: "pts", line: 22.5, over: 0.55 }, { name: "Jaylen Brown", team: "BOS", stat: "pts", line: 25.5, over: 0.4 }, { name: "Jalen Brunson", team: "NYK", stat: "pts", line: 25.5, over: 0.5 }] },
    { m: { "Jaylen Brown|pts|22.5": [0.62, 0.6, 0.4, 0.62, "t"], "Jaylen Brown|pts|25.5": [0.49, 0.47, 0.53, 0.49, "t"], "Jalen Brunson|pts|25.5": [0.5, 0.48, 0.52, 0.5, "t"] } });
  ok(sr.length === 1 && sr[0].name === "Jaylen Brown" && sr[0].line === 25.5 && sr[0].side === "over" && sr[0].star === "Jayson Tatum", "star-out shadow: each teammate's points Over at the line priced nearest 50c, the other team's players left out", sr);
  await R.hset(pr.K_NBAPROPRES(D), "BOS @ NYK", JSON.stringify({ picks: [{ name: "Q", stat: "pts", side: "over", line: 10.5, chance: 0.9, price: 0.85, result: "W" }, { name: "Q", stat: "pts", side: "over", line: 12.5, chance: 0.8, price: 0.8, result: "L" }, { name: "U", stat: "ast", side: "under", line: 8.5, chance: 0.95, price: 0.9, result: "W" }, { name: "Z", stat: "reb", side: "over", line: 2.5, chance: 0.9, price: 0.6, result: "L" }], star: [{ name: "Jaylen Brown", result: "W" }, { name: "Derrick White", result: "L" }] }));
  const sh = await pr.propShadows([D]); await R.del(pr.K_NBAPROPRES(D));
  ok(sh.dear.w === 1 && sh.dear.l === 0 && sh.star.w === 1 && sh.star.l === 1 && sh.star.pct === 50, "shadow trackers: 77c+ hidden rows one per player + stat (Q's Over blended 87% at 85c; Z's 60c row is a page row; U's Under cannot be bought: not counted); star-out 1-1", sh);
  { // 10/22 (owner: "B and C if there's not enough players ... mix is like spreads totals or ml or player props" / "Run it through our calibration")
    const card = (g, sp, tot, ml) => ({ ...g, card: { spread: sp ? { plain: { pick: `${sp[0]} ${sp[1]}`, team: sp[0], line: sp[1], hit: sp[2], side: null } } : null, total: tot ? { plain: { pick: `Under ${tot[0]}`, side: "under", line: tot[0], hit: tot[1] } } : null },
      ml: ml ? { pick: { tier: "pick", team: ml[0], label: `${ml[0]} ML`, pct: ml[1] } } : null, poly: { ml: { home: 0.7, away: 0.3 } } });
    const G2 = [card(G[0], ["BOS", -2.5, 58], [220.5, 57], ["BOS", 70]), card(G[1], ["GSW", -1.5, 60], null, ["GSW", 57]), G[2]];
    // BOS @ NYK: Alpha, Bravo, Charlie + 4 more players + total 57 + ML 70 (spread 58 dropped: the ML is stronger) = 9 legs -> its own 6 and 8, short of 10
    const extra = []; for (let i = 0; i < 4; i++) extra.push({ name: `Kilo${i}`, stat: "pts", side: "over", line: 9.5, chance: 0.9 - i * 0.01, cal: 0.9 - i * 0.01, price: 0.6, game: "BOS @ NYK", team: "BOS", start: G[0].start });
    const base = await pr.propLegsForDay(D, G, now);
    const pp2 = await pl.buildPropParlays(D, G2, now, [...base, ...extra].sort((a, b) => b.cal - a.cal));
    const bos = pp2.find((p) => p.type === "pp6" && p.game === "BOS @ NYK"), bos8 = pp2.find((p) => p.type === "pp8" && p.game === "BOS @ NYK"), mixed6 = pp2.find((p) => p.type === "pp6" && !p.game), mixed10 = pp2.find((p) => p.type === "pp10" && !p.game);
    ok(bos && bos.legs.length === 6 && bos.legs.every((l) => l.game === "BOS @ NYK") && bos.start === G[0].start && bos8 && bos8.legs.length === 8 && bos8.legs.some((l) => l.market === "ml" && l.team === "BOS" && l.price === 0.3) && !bos8.legs.some((l) => l.market === "spread")
      && mixed6 && mixed6.legs.length === 6 && !mixed6.legs.some((l) => l.game === "BOS @ NYK") && !pp2.some((p) => p.type === "pp8" && !p.game) && mixed10 && mixed10.legs.length === 10 && mixed10.legs.some((l) => l.game === "BOS @ NYK")
      && !pp2.some((p) => p.legs.some((l) => l.market === "ml" && l.game === "LAL @ GSW")),
      "Prop Parlays (10/22): per game from that game's spread / total / ML / props (spread and ML never both on one game: the stronger stays); a game short of a size gives its legs to one mixed parlay of that size", pp2.map((p) => [p.type, p.game, p.legs.map((l) => l.label)]));
    await R.hset(pr.K_NBAPROPRES("2027-01-01"), "X @ Y", JSON.stringify({ picks: Array.from({ length: 50 }, (_, i) => ({ name: `P${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, stat: "pts", side: "over", line: 20.5, chance: 0.82, price: 0.6, result: i < 35 ? "W" : "L" })) }));
    await R.set(pr.K_NBAPROPMODEL("2027-01-01", "X @ Y"), JSON.stringify({ rows: [] }));
    const bands = await pr.propCalibration(now, true); await R.del(pr.K_NBAPROPRES("2027-01-01")); await R.del(pr.K_NBAPROPMODEL("2027-01-01", "X @ Y")); await R.del("nbapropcal2");
    const c = pr.calibrate(0.82, bands);
    const e = 0.4 * 0.82 + 0.6 * 0.6, ce = pr.calibrate(e, bands);   // 10/23: bands of the Over's blended % (0.688 -> the 65 band)
    ok(bands[65] && bands[65].n === 50 && Math.abs(bands[65].won - 0.7) < 1e-9 && Math.abs(ce - (e + (0.7 - e) * 50 / 150)) < 1e-6 && c === 0.82 && pr.calibrate(0.72, bands) === 0.72,
      "prop calibration (10/22): a leg's chance moves toward what its 5-point band really won, shrunk by 100 graded rows (82% band won 70% of 50 -> 78%); a band with no graded rows keeps the model's %", { bands, c }); }
  for (const g of G) { await R.del(pr.K_NBAPROPMODEL(D, g.key)); await R.del(pr.K_NBAPROPS(D, g.key)); }
  { // BOOK GAP (10/24): books 1-4 pts (spread) / 2-6 pts (total) off Polymarket's main line, books pulled in the last 6 h -> the books' side at Polymarket's number
  const T = new Date(Date.now() - 1800e3).toISOString(), old = new Date(Date.now() - 7 * 3600e3).toISOString(), tip = new Date(Date.now() + 1800e3).toISOString();
  const bg = (books, at = T, over = {}) => cp.buildCard(mk("OKC", "ATL", { books, booksAt: at, start: tip, ...over }));
  const sp = bg({ spread: { homeSpread: -10.5 }, total: { line: 227 } });
  ok(sp.spread.plain.ruleId === "bookgap|spread" && sp.spread.plain.pick === "ATL -8.5" && sp.spread.plain.hit === 57.3 && sp.spread.plain.id === "cardpick|spread", "BOOK GAP spread: books ATL -10.5 vs Polymarket -8.5 -> ATL -8.5 at 57.3%", sp.spread.plain);
  ok(sp.total.plain.ruleId === "bookgap|total" && sp.total.plain.pick === "Over 223.5" && sp.total.plain.hit === 64.1, "BOOK GAP total: books 227 vs Polymarket 223.5 -> Over 223.5 at 64.1%", sp.total.plain);
  { const o2 = sp.total.rows.find((r) => r.side === "over" && r.points === 2), a2 = sp.spread.rows.find((r) => r.team === "ATL" && r.points === 2), a3 = sp.spread.rows.find((r) => r.team === "ATL" && r.points === 3);
    ok(o2 && o2.hit === 66.7 && a2 && a2.hit === 64.3 && a3 && a3.hit === 68.4 && sp.total.pts && sp.total.pts.hit === 66.7,
      "BOOK GAP bought lines read the rule's own measured rates on real Polymarket closes (Over +2 66.7%, ATL +2 pts 64.3%, +3 68.4%), not the main-line lift", { o2, a2, a3, pts: sp.total.pts }); }
  const dog = bg({ spread: { homeSpread: -6.5 }, total: { line: 220 } });
  ok(dog.spread.plain.pick === "OKC +8.5" && dog.total.plain.pick === "Under 223.5", "BOOK GAP the other way: books ATL -6.5 -> OKC +8.5; books 220 -> Under", [dog.spread.plain.pick, dog.total.plain.pick]);
  const small = bg({ spread: { homeSpread: -9 }, total: { line: 224.5 } }), big = bg({ spread: { homeSpread: -14.5 }, total: { line: 233 } }), stale = bg({ spread: { homeSpread: -10.5 }, total: { line: 227 } }, old), nob = bg(null);
  ok(small.spread.plain.ruleId === "model|spread" && small.total.plain.ruleId === "model|total" && big.spread.plain.ruleId === "model|spread" && big.total.plain.ruleId === "model|total" && stale.spread.plain.ruleId === "model|spread" && nob.total.plain.ruleId === "model|total",
    "no BOOK GAP under 1 pt / 2 pts, over 4 / 6 pts (bad read), with books not pulled in the 90 minutes before tip-off (10/29) or no books: the model's side");
  const lmv = bg({ spread: { homeSpread: -10.5 } }, T, { move: { signal: { spread: { team: "OKC", open: 8.5, pts: 3 } } } });
  ok(lmv.spread.plain.ruleId === "linemove|spread" && lmv.spread.plain.hit === 67.9, "LINE MOVE at the open (67.9%) outranks BOOK GAP (57.3%)", lmv.spread.plain); }
{ // 10/26 angle-mix shadows: tired + star out, big dog vs a tired favorite, rested vs star out, rested road favorite
  const pn4 = await import("../lib/pinnacle.js"), ctx = (rh, ra) => ({ home: { rest: rh }, away: { rest: ra } });
  const g1 = { key: "AAA @ BBB", date: "2026-10-27", start: "2026-10-28T00:00:00Z", context: ctx(1, 2), starOut: { home: 1, away: 0 }, poly: { spread: { homeSpread: -9.5 } } };
  const s1 = pn4.angleSides(g1);
  ok(s1.length === 2 && s1.some((x) => x.kind === "tired" && x.team === "AAA" && x.line === 9.5) && s1.some((x) => x.kind === "dogvtired" && x.team === "AAA" && x.line === 9.5), "tired + star out: home BBB on a back-to-back and missing its star -> AAA +9.5 (TIRED), and the same AAA as a 9+ dog vs a tired favorite", JSON.stringify(s1));
  const s2 = pn4.angleSides({ ...g1, context: ctx(1, 4), starOut: { home: 0, away: 1 }, poly: { spread: { homeSpread: 2.5 } } });
  ok(s2.length === 1 && s2[0].kind === "restfav" && s2[0].team === "AAA" && s2[0].line === -2.5, "rested road favorite at a home dog (AAA 4 days rest vs BBB 1) -> AAA -2.5; AAA's own star out blocks RESTED vs STAR OUT", JSON.stringify(s2));
  const s3 = pn4.angleSides({ ...g1, context: ctx(4, 2), starOut: { home: 0, away: 1 }, poly: { spread: { homeSpread: -3 } } });
  ok(s3.length === 1 && s3[0].kind === "restvstar" && s3[0].team === "BBB" && s3[0].line === -3 && pn4.angleSides({ ...g1, context: null }).length === 0, "rested vs star out: BBB 2 more days of rest, AAA missing its star -> BBB -3; no context -> nothing", JSON.stringify(s3));
  const tA = Date.parse("2026-10-27T18:00:00Z");
  ok((await pn4.recordAngleShadows([g1], tA)) === 2 && (await pn4.recordAngleShadows([g1], tA + 60e3)) === 0 && (await pn4.recordAngleShadows([{ ...g1, key: "C @ D" }], Date.parse(g1.start) + 1)) === 0, "angle shadows saved once (NX), never after tip-off");
  const smA = pn4.summarizeMoves(await pn4.loadMoves());
  ok(smA.tired && smA.tired.pending === 1 && smA.dogvtired.pending === 1 && !(smA.all && smA.all.pending > 50), "angle shadows tallied under their own kinds, apart from LINE MOVE", JSON.stringify({ t: smA.tired, d: smA.dogvtired }));
  const s4 = pn4.angleSides({ ...g1, date: "2027-03-05", context: ctx(2, 2), starOut: { home: 1, away: 0 }, model: { total: 218 }, poly: { spread: { homeSpread: -3 }, total: { line: 227.5 } } });
  ok(s4.length === 2 && s4.every((x) => x.market === "total" && x.side === "under" && x.line === 227.5) && s4.some((x) => x.kind === "mtotlate") && s4.some((x) => x.kind === "mtotstar"), "total shadows: model 218 vs 227.5 in March with a star out -> Under 227.5 under both MODEL TOTAL 8+ kinds", JSON.stringify(s4));
  ok(pn4.angleSides({ ...g1, date: "2027-03-05", context: ctx(2, 2), starOut: { home: 0, away: 0 }, model: { total: 240 }, poly: { spread: { homeSpread: -3 }, total: { line: 227.5 } } }).filter((x) => x.market === "total").map((x) => x.kind + ":" + x.side).join() === "mtotlate:over", "model 240 vs 227.5 in March, nobody out -> only the late-season Over");
  ok(/TIRED \+ STAR OUT · fade/.test(readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8")), "Models -> Shadow trackers lists the four angle rows"); }
const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8"), sl = readFileSync(new URL("../lib/slate.js", import.meta.url), "utf8");
  ok(/const LAB_TABS = \[\["lines", "Game Lines"\], \["props", "Player Props"\]\];/.test(app) && /picks = \(\(pg && pg\.picks\) \|\| \[\]\)\.filter\(\(p\) => p\.stat === MBPROP\)/.test(app) && /data-mbprop/.test(app) && /class="stats mbrec">\$\{labRecords\(games, sel\)/.test(app) && /records: R \}/.test(readFileSync(new URL("../../pages/api/nba/modelpicks.js", import.meta.url), "utf8")) && /pp10: "Prop Parlays · 10 legs"/.test(app) && !/\["best4", "Parlay"\]/.test(app) && /Props · 82¢\+ hidden rows/.test(app) && /Props · star out → teammates Over/.test(app) && /buildPropParlays\(d, out, now, legs\)/.test(sl) && /buildSameGame4\(d, out, now, legs\)/.test(sl) && /l\.market !== "prop"/.test(sl),
    "Prop Parlays: scoreboard rows per size (10/28 late: no Model bets tab -- Model bets = Game Lines + Player Props picks), the two shadow rows on Models; built on the slate; never sent for a Polymarket combo quote"); }
{ // 10/26 (owner, design = both sports): the per-game facts on top of the NBA MODEL ⓘ box (nba/lib/why.js)
  const { gameWhy } = whyLib, now = Date.parse("2026-10-26T23:00:00Z");
  const g = { home: "DET", away: "BOS", poly: { spread: { homeSpread: -1.5, home: 0.52, away: 0.48 }, total: { line: 229.5, over: 0.5, under: 0.5 }, ml: { midHome: 0.56, midAway: 0.44 } },
    card: { spread: { plain: { team: "DET", pick: "DET -1.5", hit: 67.9, ruleId: "linemove|spread", why: "LINE MOVE 3", atOpen: true } }, total: { plain: { side: "over", pick: "Over 229.5", hit: 55.2, ruleId: "shotq|total", why: "SHOT QUALITY" } } },
    move: { spread: { open: -3.5, now: -1.5 }, total: { open: 231.5, now: 229.5 }, signal: { spread: { team: "DET", pts: 3, open: -1.5 }, total: { side: "under", pts: 3, open: 232.5 } } },
    books: { spread: { homeSpread: -3.5 }, total: { line: 232.5 } }, booksAt: "2026-10-26T21:00:00Z", start: "2026-10-26T22:00:00Z", fatigue: { away: { ot: false, far: true } },
    context: { home: { rest: 3, trav_km: 0, sq_l20: -4.1, sq_x10: 242, sq_gp: 12, sq_cold_mu: 0.4, sq_mu: 1.2 }, away: { rest: 1, trav_km: 1900, ats_pct: 0.3, ats_n: 24, sq_l20: -3.4, sq_x10: 238 } },
    model: { margin: 2.4, total: 233.1, marketWinPct: 56, teamSide: { team: "DET", line: -1.5, pct: 52.1 }, injuryShift: -0.8 }, injuries: { home: [], away: [{ name: "Jayson Tatum", status: "Out", ppg: 26.8 }, { name: "Al Horford", status: "Questionable", ppg: 9.1 }] }, starOut: { home: 0, away: 1 },
    ml: { pick: { label: "DET ML", pct: 56, tier: "pick", team: "DET" } } };
  const W = gameWhy(g, now), sp = W.spread, tt = W.total, find = (xs, k) => xs.find((x) => x[0] === k), txt = JSON.stringify(W);
  ok(/^DET -1\.5 · 67\.9% · LINE MOVE rule \(Polymarket still at Pinnacle’s opening number: 67\.9%\) — LINE MOVE 3$/.test(sp[0][1].replace("'", "’")) && sp[0][2] === 1, "NBA reason box: the PICK line with its rule and the at-the-open rate", sp[0]);
  ok(/^moved 3 points toward DET since its first line \(opened DET -1\.5\)$/.test(find(sp, "Pinnacle:")[1]) && find(sp, "Pinnacle:")[2] === 1 && /opened DET -3\.5 → now -1\.5: moved 2 toward BOS · DET gets 2/.test(find(sp, "Polymarket line:")[1]) && find(sp, "Polymarket line:")[2] === 1, "NBA reason box: Pinnacle's move and Polymarket's own move with who gained");
  ok(/^DET -3\.5 \(pulled Mon .*PM\) vs Polymarket -1\.5 · 2 off → BOOK GAP \(a stronger rule named the side\)$/.test(find(sp, "Sportsbooks:")[1]) && find(sp, "Sportsbooks:")[2] === 1, "NBA reason box: the books vs Polymarket, inside the BOOK GAP window, outranked by LINE MOVE", find(sp, "Sportsbooks:"));
  ok(/^DET 3 days rest, BOS 1 · BOS flew 1900 km on a back-to-back$/.test(find(sp, "Rest:")[1]) && find(sp, "Rest:")[2] === 1 && /^BOS covered 30% of 24 lined games → ATS REGRESSION/.test(find(sp, "ATS:")[1]) && find(sp, "ATS:")[2] === -1, "NBA reason box: rest / FATIGUE and ATS REGRESSION (fires for BOS, against the pick)", [find(sp, "Rest:"), find(sp, "ATS:")]);
  ok(/^DET by 2\.4 · vs the line it leans nowhere/.test(find(sp, "Model:")[1]) === false && /^DET by 2\.4 · vs the line it leans DET by 0\.9 · injuries moved it -0\.8$/.test(find(sp, "Model:")[1]) && find(sp, "Model:")[2] === 0 && /^DET 52\.1% · data only on NBA/.test(find(sp, "Team model:")[1]), "NBA reason box: the model vs the line (under 1 point = neutral) and the team model as data", find(sp, "Model:"));
  ok(/^top scorer out · J\.Tatum Out \(26\.8 ppg\); A\.Horford Questionable \(9\.1 ppg\)$/.test(find(sp, "BOS injuries:")[1]) && find(sp, "BOS injuries:")[2] === 1 && !find(sp, "DET injuries:") && /^DET ML · 56% = the market’s own chance with the fee out$/.test(find(sp, "ML pick:")[1].replace("'", "’")), "NBA reason box: injuries by points a game with the star flag, and the ML pick", find(sp, "BOS injuries:"));
  ok(/^Over 229\.5 · 55\.2% · SHOT QUALITY rule — SHOT QUALITY$/.test(tt[0][1]) && /^moved the total 3 toward the Under since its first number \(opened 232\.5\) · TOTAL MOVE fires only while Polymarket still has the opening number$/.test(find(tt, "Pinnacle:")[1]) && find(tt, "Pinnacle:")[2] === -1
    && /opened 231\.5 → now 229\.5: down 2 · a better number for the Over/.test(find(tt, "Polymarket total:")[1]) && find(tt, "Polymarket total:")[2] === 1 && /^232\.5 \(pulled .*\) vs Polymarket 229\.5 · 3 off → BOOK GAP \(a stronger rule named the side\)$/.test(find(tt, "Sportsbooks:")[1])
    && /^both teams’ shooting ran cold by 7\.9 over 20 games \(Over at -6\.9 or colder\) · their shots are worth \+9\.3 vs the total \(Over at \+10\.9\) → SHOT QUALITY$/.test(find(tt, "Shot quality:")[1].replace("'", "’")) && find(tt, "Shot quality:")[2] === 1
    && /^233\.1 vs 229\.5 → leans Over by 3\.6$/.test(find(tt, "Model:")[1]) && find(tt, "BOS:")[1] === "top scorer out" && find(tt, "BOS:")[2] === -1, "NBA reason box: the total's lines (Pinnacle, Polymarket, books, shot quality with the cut-offs, model, star out)", tt);
  ok(!/undefined|NaN|null/.test(txt), "NBA reason box: no undefined / NaN", txt.match(/.{30}(undefined|NaN|null).{30}/g));
  const g2 = { ...g, card: { spread: { plain: { team: "BOS", pick: "BOS +1.5", hit: 49.4, ruleId: "model|spread" } }, total: null }, move: null, books: { spread: { homeSpread: -1.5 } }, booksAt: "2026-10-26T10:00:00Z", fatigue: null, context: { home: { rest: 1 }, away: { rest: 2, ats_pct: 0.5, ats_n: 10 } }, ml: { pick: { tier: "none" } }, model: { margin: -0.5, total: 230, marketWinPct: 53 }, injuries: { home: [], away: [] }, starOut: null };
  const W2 = gameWhy(g2, now), s2 = W2.spread;
  ok(/^BOS \+1\.5 · 49\.4% · the model’s side \(no tested rule fired; about a coin flip, 49\.4%\)$/.test(s2[0][1].replace("'", "’")) && /unchanged since first seen/.test(find(s2, "Polymarket line:")[1]) && /the same number$/.test(find(s2, "Sportsbooks:")[1])
    && /a plain back-to-back for DET \(priced by the market, 50\.9%: no rule\)/.test(find(s2, "Rest:")[1]) && find(s2, "Rest:")[2] === 0 && /\(the rule needs 20\+\)$/.test(find(s2, "ATS:")[1]) && /^none: DET is the favorite at 53% with the fee out, under the 56% bar$/.test(find(s2, "ML pick:")[1]) && W2.total[0][1] === "none yet on this total" && /leans Over by 0\.5/.test(find(W2.total, "Model:")[1]), "NBA reason box: the why-nots -- model side, no move, same books number, a plain back-to-back, ATS under 20 games, no ML pick", s2);
  ok(gameWhy(null) === null, "NBA reason box: no row, no lines");
}

{ // 10/26 recheck: a PLACEHOLDER market (a side priced 0.99 / the other 0.49, nobody selling -- Polymarket's stub for a game posted a day early) is not a line.
  // It had been the main total of tomorrow's games ("Over 195.5"), saved as the model-side PICK at first sighting and graded a free win (32 such picks 10/23-27).
  const ev = JSON.parse(JSON.stringify(events[0])), g0 = eventGame(events[0]);
  const stub = (m) => { m.bestAsk = 0.99; m.bestBid = 0.51; m.outcomePrices = JSON.stringify([0.5, 0.5]); };
  for (const m of ev.markets) if (/^(totals|spreads)$/i.test(m.sportsMarketType || "")) stub(m);
  const P = parseGame(ev.markets, g0.away, g0.home), P0 = parseGame(events[0].markets, g0.away, g0.home);
  ok(P.total === undefined && P.spread === undefined && !!P.ml && !!P0.total && !!P0.spread && !(P.totalAlts || []).length && !(P.alts || []).length, "parser (10/26): one-sided placeholder totals / spreads are never the main line nor an alternate; the moneyline still reads", { P, P0: { t: P0.total, s: P0.spread } });
  const evMix = JSON.parse(JSON.stringify(events[0])); let first = true;
  for (const m of evMix.markets) if (/^totals$/i.test(m.sportsMarketType || "")) { if (first) { first = false; continue; } stub(m); }   // one real total among stubs -> that one
  const PM = parseGame(evMix.markets, g0.away, g0.home);
  ok(!!PM.total && PM.total.over > 0.1 && PM.total.over < 0.9 && PM.total.under > 0.1 && PM.total.under < 0.9, "parser (10/26): a real two-sided total is the main total even next to stubs", PM.total);
  // the opening-line baseline: an "opener" 15+ (total) / 10+ (spread) from the current line was a stub -> reset, no move shown
  const alx = await import("../lib/alerts.js");
  const R = globalThis.__TEST_REDIS__; await R.set("open:2026-11-05:BOS @ NYK", JSON.stringify({ hs: 13.5, tl: 195.5, t: "2026-11-04T20:00:00Z" }), "EX", 4 * 86400);
  const mv = await slate.lineMoves([{ key: "BOS @ NYK", date: "2026-11-05", poly: { spread: { homeSpread: -3.5 }, total: { line: 225.5 } } }], Date.parse("2026-11-05T20:00:00Z"));
  const openNow = JSON.parse(await R.get("open:2026-11-05:BOS @ NYK"));
  ok(!(mv["BOS @ NYK"] && (mv["BOS @ NYK"].total || mv["BOS @ NYK"].spread)) && openNow.tl === 225.5 && openNow.hs === -3.5, "line moves (10/26): a placeholder opener is replaced by the line seen now, no 30-point move", { mv, openNow });
  const mv2 = await slate.lineMoves([{ key: "BOS @ NYK", date: "2026-11-05", poly: { spread: { homeSpread: -4.5 }, total: { line: 227.5 } } }], Date.parse("2026-11-05T21:00:00Z"));
  ok(mv2["BOS @ NYK"] && mv2["BOS @ NYK"].total.open === 225.5 && mv2["BOS @ NYK"].total.now === 227.5 && mv2["BOS @ NYK"].spread.open === -3.5, "line moves: a real move after the reset shows from the reset baseline", mv2);
  // alerts: the same jump is a re-base, not a LINE MOVE
  const T0 = Date.parse("2026-11-06T20:00:00Z"), game = (over = {}) => ({ key: "MIA @ ORL", away: "MIA", home: "ORL", date: "2026-11-06", inProgress: false, poly: { spread: { homeSpread: -3.5 }, total: { line: 195.5 }, ml: { midHome: 0.62, midAway: 0.38 } }, spread: null, total: null, ml: null, injuries: { home: [], away: [] }, ...over });
  await alx.alertsFromSlate([game()], T0);
  const n1 = await alx.alertsFromSlate([game({ poly: { spread: { homeSpread: -3.5 }, total: { line: 226.5 }, ml: { midHome: 0.62, midAway: 0.38 } } })], T0 + 60e3);
  const n2 = await alx.alertsFromSlate([game({ poly: { spread: { homeSpread: -3.5 }, total: { line: 226.5 }, ml: { midHome: 0.62, midAway: 0.38 } } })], T0 + 60e3 + (alx.MOVE_HOLD_MIN + 1) * 60e3);
  const base = JSON.parse(await R.get("alertbase:2026-11-06:MIA @ ORL"));
  ok(n1 === 0 && n2 === 0 && base.tl === 226.5 && !(await alx.listAlerts()).some((a) => /MIA @ ORL total: 195\.5/.test(a.title)), "alerts (10/26): a 31-point total jump is a placeholder re-base, never a LINE MOVE alert", { n1, n2, base });
  // the record: a pick on a stub price is never saved; one already saved (graded or not) is voided and leaves every record row
  const g = { key: "MIA @ ORL", away: "MIA", home: "ORL", date: "2026-11-06", start: "2026-11-07T00:00:00Z", poly: { total: { line: 195.5, over: 0.99, under: 0.49 } }, card: { total: { plain: { id: "modelpick|total", kind: "total", side: "over", line: 195.5, pick: "Over 195.5", hit: 50.4, price: 0.99 }, rows: [] }, spread: null } };
  const saved = await rec.recordPicks([g], Date.parse("2026-11-06T20:00:00Z"));
  await R.set("pick:2026-11-04:A @ B:modelpick|total", JSON.stringify({ date: "2026-11-04", game: "A @ B", id: "modelpick|total", market: "total", label: "Over 193.5", side: "over", line: 193.5, pct: 50.4, tier: "pick", price: 0.99, result: "win" })); await R.sadd("pick:ids", "pick:2026-11-04:A @ B:modelpick|total");
  await R.set("pick:2026-11-04:A @ B:ptspick|spread", JSON.stringify({ date: "2026-11-04", game: "A @ B", id: "ptspick|spread", market: "spread", label: "B -1.5", team: "B", line: -1.5, pct: 57, tier: "pick", price: 0.52, result: "win" })); await R.sadd("pick:ids", "pick:2026-11-04:A @ B:ptspick|spread");
  const nv = await rec.voidStubPicks(), after = (await rec.loadPicks()).filter((p) => p.game === "A @ B"), sm = rec.summarize(after);
  ok(saved === 0 && rec.isStubPick({ market: "total", price: 0.99 }) && !rec.isStubPick({ market: "total", price: 0.52 }) && !rec.isStubPick({ market: "ml", price: 0.99 }) && nv === 1
    && after.find((p) => p.id === "modelpick|total").result === "void" && after.find((p) => p.id === "modelpick|total").was === "win" && after.find((p) => p.id === "ptspick|spread").result === "win"
    && !(sm["modelpick|total"] && sm["modelpick|total"].w) && sm["ptspick|spread"].w === 1, "record (10/26): a stub-price pick is never saved; a saved one is voided (its old result kept as `was`) and counts in no row; real picks untouched", { saved, nv, after, sm: Object.keys(sm) });
  await R.srem("pick:ids", "pick:2026-11-04:A @ B:modelpick|total", "pick:2026-11-04:A @ B:ptspick|spread");
}

{ // 10/28 1H SPREAD shadow: the first-half margin from the full-game line vs Polymarket's first-half spreads under the props rules
  const h1 = await import("../lib/h1spread.js"), pn5 = await import("../lib/pinnacle.js"), rec5 = await import("../lib/record.js"), espn5 = await import("../lib/espn.js");
  const c35 = h1.h1HomeCover(-6.5, -3.5), c05 = h1.h1HomeCover(-6.5, -1.5), cdog = h1.h1HomeCover(6.5, 3.5);
  ok(c35 > 0.4 && c35 < 0.55 && c05 > c35 && c05 > 0.53 && cdog > 0.4 && cdog < 0.6 && h1.h1HomeCover(-6.5, -3) === null && h1.h1HomeCover(-6.5, 0.5) === null && h1.h1HomeCover(-30, -3.5) === null,
    "1H cover: home -6.5 for the game covers -3.5 in the first half ~45-55%, -1.5 more often; whole-point lines, -0.5 / +0.5 and lines off the table give nothing", { c35, c05, cdog });
  ok(h1.qualifies(0.57, 0.53) && !h1.qualifies(0.55, 0.50) && !h1.qualifies(0.62, 0.61) && h1.qualifies(0.66, 0.61) && !h1.qualifies(0.80, 0.78) && !h1.qualifies(0.57, 0.58),
    "props rules: 56%+ under 60c, 65%+ from 60c, 77c cap, priced under the chance");
  const rows = [{ line: 5.5, aPrice: 0.53, hPrice: 0.49 }, { line: 3.5, aPrice: 0.49, hPrice: 0.53 }];
  const sd = h1.h1Side(-6.5, rows, "AAA", "BBB");
  ok(sd && sd.team === "AAA" && sd.line > 0 && sd.pc >= 0.56 && sd.px < sd.pc, "h1Side: the side the history likes, priced under its chance (the away dog's first-half line here)", sd);
  ok(h1.h1Side(-6.5, [{ line: 3.5, aPrice: 0.53, hPrice: 0.49 }], "AAA", "BBB") === null, "nothing when no side passes the rules");
  const ev = { markets: [{ sportsMarketType: "basketball_team_first_half_spread", line: -3.5, bestAskQuote: { value: 0.50 }, bestBidQuote: { value: 0.48 },
    marketSides: [{ long: true, description: "-5.50", team: { abbreviation: "BBB" } }, { long: false, description: "+5.50", team: { abbreviation: "AAA" } }] }] };
  const g = { key: "AAA @ BBB", date: "2026-11-10", start: "2026-11-11T00:30:00Z", poly: { spread: { homeSpread: -6.5 } } }, t1 = Date.parse("2026-11-10T20:00:00Z");
  const n1 = await h1.recordH1Shadows([g], t1, async () => ev), n2 = await h1.recordH1Shadows([g], Date.parse(g.start) + 1, async () => ev);
  const saved = (await pn5.loadMoves()).find((m) => m.kind === "h1spr" && m.game === "AAA @ BBB");
  ok(n1 === 1 && n2 === 0 && saved && saved.team === "AAA" && saved.line === 5.5 && saved.half === 1 && saved.first && saved.first.line === 5.5, "1H shadow saved before tip-off only, with the line, price and first sighting", saved);
  const sb = espn5.parseScoreboard({ events: [{ competitions: [{ status: { type: { completed: true }, period: 4 }, competitors: [
    { homeAway: "away", score: "100", team: { abbreviation: "BOS" }, linescores: [{ value: 25 }, { value: 30 }, { value: 20 }, { value: 25 }] },
    { homeAway: "home", score: "104", team: { abbreviation: "NYK" }, linescores: [{ value: 28 }, { value: 29 }, { value: 22 }, { value: 25 }] }] }] }] });
  ok(sb["BOS @ NYK"].h1.away === 55 && sb["BOS @ NYK"].h1.home === 57, "ESPN scoreboard: the first-half score from quarters 1 + 2", sb["BOS @ NYK"]);
  await pn5.gradeMoves(async () => ({ "AAA @ BBB": { final: true, away: 90, home: 110, h1: { away: 52, home: 54 } } }), rec5.gradePick);
  const gd = (await pn5.loadMoves()).find((m) => m.kind === "h1spr" && m.game === "AAA @ BBB");
  ok(gd.result === "win" && pn5.summarizeMoves(await pn5.loadMoves()).h1spr.w >= 1, "graded on the FIRST-HALF score (AAA +5.5 lost the half by 2 = a win, though it lost the game by 20)", gd);
  const snapSrc = readFileSync(new URL("../../pages/api/nba/snapshot.js", import.meta.url), "utf8"), appSrc = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/recordH1Shadows\(reg\)/.test(snapSrc) && /1H SPREAD · props rules", mv\.h1spr/.test(appSrc), "the snapshot records it; Models -> Shadow trackers shows its row"); }
{ // 10/28 (owner: "only add the logo next to their team name"): props rows carry no logo, the team label does
  const appSrc = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/\$\{tlogo\(p\.team\)\}\$\{pnm\(p\.name\)\}<\/span><span class="pp2">\$\{p\.side === "over" \? "O" : "U"\} \$\{p\.line\}<\/span>/.test(appSrc) && !/class="pbl pteam"/.test(appSrc), "NBA props (owner 10/29): no team title lines, the logo before each name, the pick (O 19.5) in its own column"); }
{ // 10/28: the NBA database refused every write from 7:30 PM PT 10/27, silently -- the System list now tests a write and shows the error
  const st = await import("../lib/status.js"), { getRedis } = await import("../lib/redis.js");
  const good = await st.dbHealth(getRedis());
  ok(good.writeOk === true && good.err === null, "database check: a working database reads 'saving'", good);
  const full = { set: async () => { throw new Error("OOM command not allowed when used memory > 'maxmemory'."); }, get: async () => null, info: async () => "used_memory:31457280\r\nmaxmemory:31457280\r\nmaxmemory_policy:noeviction\r\n" };
  const bad = await st.dbHealth(full);
  ok(bad.writeOk === false && /OOM/.test(bad.err) && bad.usedMb === 30 && bad.capMb === 30 && bad.policy === "noeviction", "database check: a refused write keeps the database's own error and its memory", bad);
  const w = st.computeWatch({ snap: { t: new Date().toISOString(), games: 0 }, railway: { ok: true }, pinnacle: null, backup: { t: new Date().toISOString(), where: "volume" }, db: bad });
  ok(w.some((x) => /refusing writes \(OOM/.test(x)), "watchdog: a database refusing writes is the first warning", w);
  ok(st.computeWatch({ snap: { t: new Date().toISOString(), games: 0 }, railway: { ok: true }, backup: { t: new Date().toISOString(), where: "volume" }, db: { writeOk: true, usedMb: 25, capMb: 30 } }).some((x) => /83% full/.test(x)), "watchdog: 80%+ full is reported");
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/\["Database", sy\.db \?/.test(app), "Models -> System shows the Database row"); }
{ // 10/28: old graded prop days shrink (model copy -> game names only, price ladder deleted); ungraded and recent days stay whole
  const pr = await import("../lib/props.js"), { getRedis } = await import("../lib/redis.js"), r = getRedis(), now = Date.parse("2026-11-20T20:00:00Z");
  await r.set("nbapropmodel:2026-11-05:AAA @ BBB", JSON.stringify({ runAt: "x", start: "s", away: "AAA", home: "BBB", rows: [{ name: "P", stat: "pts" }] }));
  await r.set("nbaprops:2026-11-05:AAA @ BBB", JSON.stringify({ m: { a: 1 } })); await r.hset("nbapropres:2026-11-05", "AAA @ BBB", JSON.stringify({ picks: [] }));
  await r.set("nbapropmodel:2026-11-05:CCC @ DDD", JSON.stringify({ away: "CCC", home: "DDD", rows: [1] })); await r.set("nbaprops:2026-11-05:CCC @ DDD", "{}");
  await r.set("nbapropmodel:2026-11-18:EEE @ FFF", JSON.stringify({ away: "EEE", home: "FFF", rows: [1] })); await r.hset("nbapropres:2026-11-18", "EEE @ FFF", "{}");
  const n = await pr.compactNbaProps(now), a = JSON.parse(await r.get("nbapropmodel:2026-11-05:AAA @ BBB"));
  ok(n === 1 && a.stub && !a.rows && a.away === "AAA" && !(await r.get("nbaprops:2026-11-05:AAA @ BBB")) && JSON.parse(await r.get("nbapropmodel:2026-11-05:CCC @ DDD")).rows && (await r.get("nbaprops:2026-11-05:CCC @ DDD")) && JSON.parse(await r.get("nbapropmodel:2026-11-18:EEE @ FFF")).rows,
    "props compaction: only graded days older than 8 days shrink", { n, a });
  const days = await pr.nbaPropDays(); ok(days.includes("2026-11-05"), "a compacted day is still listed (the page and the records keep reading it)");
  for (const k of ["nbapropmodel:2026-11-05:AAA @ BBB", "nbapropmodel:2026-11-05:CCC @ DDD", "nbaprops:2026-11-05:CCC @ DDD", "nbapropmodel:2026-11-18:EEE @ FFF", "nbapropres:2026-11-05", "nbapropres:2026-11-18"]) await r.del(k);
  const gr = readFileSync(new URL("../../pages/api/nba/results/grade.js", import.meta.url), "utf8"); ok(/compactNbaProps\(\)/.test(gr), "the nightly grade run compacts"); }
{ // 10/29: NBA straight bets as legs, a bet on the market's other side with its price / payout and graded from its own leg
  const mb = await import("../lib/mybets.js");
  const o = mb.summarizeLedger({ a: { id: "asc-nba-den-no-2026-10-28-neg-4pt5", title: "DEN Nuggets vs. NO Pelicans", outcome: "+4.50", cost: 5.1255, shares: -10, firstSeen: "2026-10-28T20:00:00Z" },
    b: { id: "asc-nba-gs-min-2026-10-28-pos-2pt5", cost: 4.3176, shares: 8, short: true, resolved: { win: true, pl: 3.68, t: "2026-10-29T05:00:00Z" }, pickResult: "L", closedAt: "2026-10-29T05:00:00Z" } });
  const A = o.open[0], B = o.settled[0];
  ok(A.pick.label === "NOP +4.5" && A.shares === 10 && Math.abs(A.price - 0.51255) < 1e-9 && B.pick.label === "MIN -2.5" && B.result === "loss" && Math.abs(B.pl + 4.3176) < 1e-9 && o.record.l === 1,
    "NBA straight bets: the side held as a leg (NOP +4.5), shares positive with the price, a settled other-side bet graded from its own leg", { A, B }); }
{ // 10/29 (owner: "I did not sell these I lost"): a combo with a lost leg listed under Settled reads Lost -$cost, never "Sold —"
  const app = readFileSync(new URL("../../public/nba/app.js", import.meta.url), "utf8");
  ok(/const state = \(e, settled\) => settled && e\.result \? /.test(app) && /: !e\.result && legLost\(e\) \? `−\$\{money\(e\.cost\)\}`/.test(app), "NBA My bets: a lost-leg combo under Settled says Lost, not Sold"); }
console.log(bad ? `${bad} of ${n} checks FAILED` : `all ${n} site checks passed`);
process.exit(bad ? 1 : 0);
