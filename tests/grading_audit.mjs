// Replays the whole 2025 season (regular season + playoffs, 285 real games with their closing lines) through the site's REAL grading
// code and compares every result with the independent expectation in fixtures/grading_2025.json (built by make_grading_fixture.py,
// in Python, separately from this code). Any mismatch fails the test run.
import { readFileSync } from "node:fs";
import RedisMock from "ioredis-mock";
const RealDate = Date, FAKE = new RealDate("2026-01-15T12:00:00Z").getTime();          // pretend it is January 2026: SEASON = 2025 and every game is over
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FAKE); } static now() { return FAKE; } };
const here = (p) => new URL(p, import.meta.url);
const csv = readFileSync(here("./fixtures/grading_2025.csv"), "utf8"), F = JSON.parse(readFileSync(here("./fixtures/grading_2025.json"), "utf8"));
globalThis.fetch = async (url) => { if (String(url).includes("nflverse/nfldata")) return new Response(csv, { status: 200 }); throw new Error("offline (grading audit)"); };
globalThis.__TEST_REDIS__ = new RedisMock(); const redis = globalThis.__TEST_REDIS__;
const { SEASON } = await import("../lib/games.js");
if (SEASON !== 2025) throw new Error(`audit clock wrong: SEASON is ${SEASON}`);
const { recordPicks, recordWinner } = await import("../lib/paper.js");
const { gradeWeek } = await import("../lib/grade.js");
const { legResult, comboResult, resolvedFrom } = await import("../lib/mybets.js");
const bad = {}, total = {}; const miss = (k, msg) => { bad[k] = (bad[k] || 0) + 1; if (bad[k] <= 3) console.log(`MISMATCH [${k}]`, msg); };
const chk = (k, ok, msg) => { total[k] = (total[k] || 0) + 1; if (!ok) miss(k, msg); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const weeks = [...new Set(F.games.map((g) => g.week))].sort((a, b) => a - b);
// ---- seed Redis exactly like the live site: model run, kickoff snapshot (closing lines), the kickoff-time picks/winners, combos, edge log
for (const w of weeks) {
  const gs = F.games.filter((g) => g.week === w), model = { games: {}, td: {}, runAt: "t" };
  for (const g of gs) {
    model.games[g.key] = { homeMargin: g.hm, total: g.mt, homeWinPct: 50 };
    await redis.set(`close:2025:${w}:${g.key}`, JSON.stringify({ t: "t", poly: g.poly, books: null }));
    const gm = { key: g.key, home: g.home, away: g.away };
    await recordPicks(2025, w, gm, g.poly, model.games[g.key], "t"); await recordWinner(2025, w, gm, g.poly, "t");
  }
  await redis.set(`model:2025:${w}`, JSON.stringify(model));
  const parlays = F.combos.filter((c) => c.week === w).map((c) => ({ strategy: "audit", legs: c.legs.map((l) => ({ ...l })), pay: 1 }));
  if (parlays.length) await redis.set(`paper:2025:${w}`, JSON.stringify({ parlays }));
  for (const e of F.edges.filter((x) => x.week === w)) { const g = F.games.find((x) => x.key === e.game);
    await redis.hset(`edgelog:2025:${w}`, `${e.game}|${e.rec.market}|${JSON.stringify(e.rec)}`, JSON.stringify({ game: e.game, price: e.price, ev: 0.1, fair: 0.5, t: "t", ...e.rec })); }
}
// ---- run the site's real grading, week by week
for (const w of weeks) await gradeWeek(2025, w);
// ---- compare: Record-tab grades (res:*), Pick Lab, winners, combos, edge tracker
for (const g of F.games) {
  const w = g.week, rec = JSON.parse((await redis.get(`res:2025:${w}:${g.key}`)) || "null"), e = g.expected;
  chk("record exists", !!rec, g.key); if (!rec) continue;
  chk("record: spread", e.spread ? !!rec.spread && rec.spread.result === e.spread.result && rec.spread.label.startsWith(e.spread.side === "home" ? g.home : g.away) : !rec.spread, `${g.key} ${JSON.stringify(rec.spread)} vs ${JSON.stringify(e.spread)}`);
  chk("record: total", e.total ? !!rec.total && rec.total.result === e.total.result && rec.total.label.startsWith(e.total.side === "over" ? "Over" : "Under") : !rec.total, `${g.key} ${JSON.stringify(rec.total)} vs ${JSON.stringify(e.total)}`);
  chk("record: winner (ml)", e.ml ? !!rec.ml && rec.ml.result === e.ml.result && rec.ml.label === `${e.ml.team} ML` : !rec.ml, `${g.key} ${JSON.stringify(rec.ml)} vs ${JSON.stringify(e.ml)}`);
  chk("record: stats-only ml", e.mlModel ? !!rec.mlModel && rec.mlModel.result === e.mlModel.result : !rec.mlModel, `${g.key} ${JSON.stringify(rec.mlModel)}`);
  const ps = JSON.parse((await redis.hget(`picks:2025:${w}`, `${g.key}|spread`)) || "null"), pt = JSON.parse((await redis.hget(`picks:2025:${w}`, `${g.key}|total`)) || "null");
  chk("pick lab: spread", e.spread ? !!ps && ps.result === e.spread.result && near(ps.line, e.spread.line) && near(ps.price, e.spread.price) && near(ps.ret, e.spread.result === "W" ? 1 / ps.price - 1 : e.spread.result === "L" ? -1 : 0) : !ps, `${g.key} ${JSON.stringify(ps)} vs ${JSON.stringify(e.spread)}`);
  chk("pick lab: total", e.total ? !!pt && pt.result === e.total.result && near(pt.line, e.total.line) && near(pt.price, e.total.price) : !pt, `${g.key} ${JSON.stringify(pt)} vs ${JSON.stringify(e.total)}`);
  const wn = JSON.parse((await redis.hget(`winners:2025:${w}`, g.key)) || "null");
  chk("winners", !!wn && wn.team === e.winner.team && wn.result === e.winner.result && near(wn.p, e.winner.p), `${g.key} ${JSON.stringify(wn)} vs ${JSON.stringify(e.winner)}`);
  for (const { leg, expected } of g.mybets) chk("my bets: leg grading", legResult(leg, { final: true, homeScore: g.H, awayScore: g.A }, {}) === expected, `${JSON.stringify(leg)} -> ${legResult(leg, { final: true, homeScore: g.H, awayScore: g.A }, {})} vs ${expected} (${g.H}-${g.A})`);
}
for (const w of weeks) { const rec = JSON.parse((await redis.get(`paper:2025:${w}`)) || "null"); if (!rec) continue;
  const cs = F.combos.filter((c) => c.week === w);
  rec.parlays.forEach((p, i) => { const c = cs[i]; chk("combos: result", p.result === c.expected.result && near(p.ret, c.expected.ret), `week ${w} #${i} ${p.result}/${p.ret} vs ${c.expected.result}/${c.expected.ret} legs ${JSON.stringify(p.legs.map((l) => l.result))} vs ${JSON.stringify(c.expected.legs)}`);
    chk("combos: each leg", p.legs.every((l, j) => l.result === c.expected.legs[j]), `week ${w} #${i}`); }); }
for (const e of F.edges) { const all = await redis.hgetall(`edgelog:2025:${e.week}`); const f = Object.keys(all).find((k) => k.startsWith(`${e.game}|${e.rec.market}|`) && JSON.stringify(JSON.parse(all[k]).market) === JSON.stringify(e.rec.market) && JSON.parse(all[k]).price === e.price);
  const r = f ? JSON.parse(all[f]) : null; chk("edge tracker", !!r && r.result === e.expected.result && near(r.pl, e.expected.pl) && r.clv != null && near(r.clv, e.expected.clv), `${e.game} ${JSON.stringify(r)} vs ${JSON.stringify(e.expected)}`); }
// ---- combo rule for My Bets (W + P mix = unconfirmed push, any L = lost, all W = won)
chk("my bets: combo rule", comboResult([{ result: "W" }, { result: "L" }]) === "L" && comboResult([{ result: "W" }, { result: "W" }]) === "W" && comboResult([{ result: "W" }, { result: "P" }]) === "P" && comboResult([{ result: "W" }, { result: "pending" }]) === "pending", "comboResult");
// ---- Polymarket settlement activity -> result (win raises "realized", loss never does)
const act = (before, after) => ({ positionResolution: { marketSlug: "caoc-x", updateTime: "t", beforePosition: { netPosition: "130", cost: { value: "20" }, realized: { value: before } }, afterPosition: { netPosition: "0", realized: { value: after } } } });
const rw = resolvedFrom(act("0", "130")), rw2 = resolvedFrom(act("0", "110")), rl = resolvedFrom(act("0", "0")), rl2 = resolvedFrom(act("0", "-20"));
chk("settlement", rw.win && near(rw.pl, 110) && rw2.win && near(rw2.pl, 110) && !rl.win && near(rl.pl, -20) && !rl2.win && near(rl2.pl, -20), "resolvedFrom");
chk("settlement", resolvedFrom({}) === null && resolvedFrom({ positionResolution: { marketSlug: "x" } }) === null, "bad input");
let n = 0, nb = 0; for (const k of Object.keys(total)) { n += total[k]; nb += bad[k] || 0; console.log(`${(bad[k] ? "FAIL" : "ok  ")} ${k.padEnd(26)} ${total[k] - (bad[k] || 0)} / ${total[k]}`); }
console.log(nb ? `grading audit: ${nb} of ${n} checks FAILED` : `grading audit: all ${n} checks passed`);
process.exit(nb ? 1 : 0);
