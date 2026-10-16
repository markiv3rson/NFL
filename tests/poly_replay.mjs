// POLYMARKET REPLAY (10/16, owner: "build now number one"): real Polymarket prices for every 2025 and 2026 regular-season game market, rebuilt from
// Polymarket's public trade log (data-api.polymarket.com/trades; prices-history is purged after a market resolves). close = the last trade before
// kickoff (about the midpoint; a buyer pays ~1c more, SP), p1d / p3d / p5d = the last trade that many days before kickoff. Runs the app's OWN card
// code (lib/cardpick.js buildCard: rows, PICK w/ POINTS), the BEAT THE tiers (lib/stack.js keyNumberPick) and LINE MOVE on those real lines,
// grades them on the real scores and shows win rate AND money at the real price. Data: railway-model-service/data/poly_closes.csv
// (built by the scratch puller; one row per market). Run: node --import ./tests/register.mjs tests/poly_replay.mjs
// NOTE: the live line table includes 2025 games, so 2025 rows are IN-SAMPLE here (2026 is not: the table stops at 2025). The 10/16 scratch run graded 2025
// with a table cut at 2024 (honest) and saw the same picture: 2025 PICK w/ POINTS spreads 110-86 = 56.1% (said 55.2) at 58c = -3.8 per $100, totals 115-108 =
// 51.6% at 57c = -10.2; bought spread rows said 54.2 won 57.3. Here (in-sample) 2025 reads 119-88 / 120-103. 2026 is identical in both runs (38-41 spreads, 45-34 totals).
import { readFileSync } from "node:fs";
import { parseCSV } from "../lib/injuries.js";
import { keyNumberPick, gradeStackPick, lineMovePick, lineMoveTotalPick } from "../lib/stack.js";
import { buildCard } from "../lib/cardpick.js";
const ROWS = parseCSV(readFileSync(new URL("../railway-model-service/data/poly_closes.csv", import.meta.url), "utf8")), H = ROWS[0], ix = (k) => H.indexOf(k);
const num = (v) => (v === "" || v == null ? null : Number(v));
import { TEAMS } from "../lib/games.js";
const games = await (async () => { const [h, ...rows] = parseCSV(await (await fetch("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", { signal: AbortSignal.timeout(60000) })).text()), ix = (k) => h.indexOf(k), out = {};
  for (const c of rows) { if (c[ix("game_type")] !== "REG" || !["2025", "2026"].includes(c[ix("season")]) || c[ix("home_score")] === "") continue;
    const g = { season: +c[ix("season")], week: +c[ix("week")], away: c[ix("away_team")], home: c[ix("home_team")], day: c[ix("gameday")], hs: +c[ix("home_score")], as: +c[ix("away_score")], sp: +c[ix("spread_line")], tl: c[ix("total_line")] === "" ? null : +c[ix("total_line")] };
    g.key = `${g.away} @ ${g.home}`; out[`${g.away}|${g.home}|${g.day}`] = g; } return out; })();
const dayShift = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// rows -> the same per-market records the scratch replay used (slug = season|game)
const TEAMNICK = TEAMS, NICK = Object.fromEntries(Object.entries(TEAMS).map(([a, n]) => [n.toLowerCase(), a]));
const recs = ROWS.slice(1).filter((r) => r.length >= 16).map((r) => { const kind = r[ix("kind")], side = r[ix("side")], line = num(r[ix("line")]), close = num(r[ix("close")]);
  return { slug: `${r[ix("season")]}|${r[ix("game")]}`, kind, line, question: kind === "spreads" ? `Spread: ${TEAMNICK[side]} (${line})` : kind === "totals" ? `O/U ${line}` : `${TEAMNICK[side]} vs. x`,
    outcomes: JSON.stringify([kind === "totals" ? "Over" : TEAMNICK[side], ""]), close: close == null ? null : [0, close], first: num(r[ix("first")]), p120: num(r[ix("p5d")]), p72: num(r[ix("p3d")]), p24: num(r[ix("p1d")]), n2h: num(r[ix("n2h")]) || 0 }; }), bySlug = {};
for (const r of recs) (bySlug[r.slug] = bySlug[r.slug] || []).push(r);
const pct = (w, l) => (w + l ? (100 * w) / (w + l) : null), r1 = (x) => Math.round(x * 10) / 10;
const T = {}, tally = (k, said, res, price, pts) => { const t = (T[k] = T[k] || { n: 0, w: 0, l: 0, said: 0, px: 0, money: 0, pxn: 0 }); if (res === "P") return; t.n++; t[res === "W" ? "w" : "l"]++; t.said += said || 0;
  if (price > 0 && price < 1) { t.pxn++; t.px += price; t.money += res === "W" ? 1 / price - 1 : -1; } };
let matched = 0, unmatched = [], noMain = 0;
const SP = 0.01;   // last trade ~ the midpoint; a buyer pays about a cent more (the ask)
for (const [slug, ms] of Object.entries(bySlug)) {
  const [season, key] = slug.split("|"), g = Object.values(games).find((x) => String(x.season) === season && x.key === key);
  if (!g) { unmatched.push(slug); continue; } matched++; const { home, away } = g;
  const live = (r) => r.close && r.n2h >= 1;   // traded in the last 2 hours before kickoff: a real closing price
  // spreads: team's own line + price of that team at the close
  const sp = ms.filter((r) => r.kind === "spreads" && live(r)).map((r) => { const q = r.question.match(/^Spread: (.+?) \(([+-]?\d+(?:\.\d+)?)\)/); if (!q) return null; const team = NICK[q[1].toLowerCase()]; if (!team) return null;
    return { team, line: +q[2], price: r.close[1] + SP, mid: r.close[1], p72: r.p72, p24: r.p24, other: team === home ? away : home }; }).filter(Boolean);
  const tt = ms.filter((r) => r.kind === "totals" && live(r)).map((r) => ({ line: r.line ?? +(r.question.match(/O\/U (\d+(?:\.\d+)?)/) || [])[1], over: r.close[1] + SP, under: 1 - r.close[1] + SP, p72: r.p72 })).filter((x) => isFinite(x.line));
  const ml = ms.find((r) => r.kind === "moneyline" && live(r)); let poly = {};
  if (ml) { const o = JSON.parse(ml.outcomes), t0 = NICK[o[0].toLowerCase()]; const p0 = ml.close[1]; poly.ml = t0 === home ? { home: p0, away: 1 - p0 } : { home: 1 - p0, away: p0 }; }
  // main spread = the line nearest 50/50 (same idea as lib/poly.js); alternates = every other live line, both sides
  const main = sp.slice().sort((a, b) => Math.abs(a.mid - 0.5) - Math.abs(b.mid - 0.5))[0];
  if (main) { const hsP = main.team === home ? main.line : -main.line; poly.spread = { homeSpread: hsP, home: main.team === home ? main.price : 1 - main.mid + SP, away: main.team === home ? 1 - main.mid + SP : main.price }; }
  const alts = []; for (const x of sp) { alts.push({ team: x.team, line: x.line, price: x.price }); alts.push({ team: x.other, line: -x.line, price: 1 - x.mid + SP }); }
  const mainT = tt.slice().sort((a, b) => Math.abs(a.over - 0.5 - SP) - Math.abs(b.over - 0.5 - SP))[0];
  if (mainT) poly.total = { line: mainT.line, over: mainT.over, under: mainT.under };
  const talts = []; for (const x of tt) { talts.push({ side: "over", line: x.line, price: x.over }); talts.push({ side: "under", line: x.line, price: x.under }); }
  if (!poly.spread && !poly.total) { noMain++; continue; }
  const nLiveSp = sp.length, nLiveT = tt.length; tally(`lines · ${g.season} · live spread lines per game ${nLiveSp <= 2 ? "1-2" : nLiveSp <= 5 ? "3-5" : "6+"}`, 50, "W", null); tally(`lines · ${g.season} · live total lines per game ${nLiveT <= 2 ? "1-2" : nLiveT <= 5 ? "3-5" : "6+"}`, 50, "W", null);
  const bk = { spread: { homeSpread: -g.sp }, total: g.tl != null ? { line: g.tl } : null };
  const G = { key: g.key, away: g.away, home: g.home, started: false, final: false, model: null }, now = Date.now();
  const card = buildCard(G, [], poly, bk, { t: new Date(now).toISOString(), alts, talts }, now);
  const grade = (p) => gradeStackPick({ kind: p.kind, team: p.team, side: p.side, line: p.line, home: g.home }, g.hs, g.as);
  const yr = `${g.season}`;
  for (const kind of ["spread", "total"]) { const c = card && card[kind]; if (!c) continue;
    for (const r of c.rows) { const res = grade({ ...r, kind }), lab = kind === "spread" ? (r.team === (g.sp > 0 ? g.home : g.away) ? "favorite" : "underdog") : r.side;
      tally(`${kind} rows · ${r.points === 0 ? "main" : r.points <= 2 ? r.points + " pt" : "far"}`, r.hit, res, r.price); tally(`${kind} rows · ${yr} · ${r.points === 0 ? "main" : "bought"}`, r.hit, res, r.price); tally(`${kind} rows · ${lab}`, r.hit, res, r.price);
      tally(`${kind} rows · said ${r.hit < 53 ? "<53" : r.hit < 56 ? "53-55" : r.hit < 60 ? "56-59" : "60+"}`, r.hit, res, r.price); }
    if (c.pts) { const res = grade({ ...c.pts, kind }); tally(`PICK w/ POINTS · ${kind}`, c.pts.hit, res, c.pts.price); tally(`PICK w/ POINTS · ${kind} · ${yr}`, c.pts.hit, res, c.pts.price);
      tally(`PICK w/ POINTS · ${kind} · ${c.pts.points} pts`, c.pts.hit, res, c.pts.price); tally(`PICK w/ POINTS · ${kind} · said ${c.pts.hit >= 56 ? "56+" : "<56 (fallback)"}`, c.pts.hit, res, c.pts.price);
      // timing: what did that same line cost 3 days before kickoff?
      const src = kind === "spread" ? sp.find((x) => x.team === c.pts.team && x.line === c.pts.line) : tt.find((x) => x.line === c.pts.line);
      const early = src ? (kind === "spread" ? src.p72 : c.pts.side === "over" ? src.p72 : src.p72 == null ? null : 1 - src.p72) : null;
      if (early != null) { const ep = (kind === "spread" && src.team !== c.pts.team ? 1 - early : early) + SP; tally(`PICK w/ POINTS · ${kind} · bought 3 DAYS EARLY at that day's price`, c.pts.hit, res, ep); tally(`PICK w/ POINTS · ${kind} · same picks at the close (for the early compare)`, c.pts.hit, res, c.pts.price); } }
  }
  // BEAT THE tiers with the real bought-line price
  for (const x of sp) { for (const [k, v] of [["5 days out", "p120"], ["3 days out", "p72"], ["1 day out", "p24"]]) { const r = ms.find((m) => m.kind === "spreads" && m.question.includes(`(${x.line})`) && m.question.startsWith(`Spread: ${TEAMS[x.team]}`)); const e = r && r[v];
      if (e != null) { const key = `early price · spread lines · ${k} -> close`; const t = (T[key] = T[key] || { n: 0, w: 0, l: 0, said: 0, px: 0, money: 0, pxn: 0 }); t.n++; t.pxn++; t.px += x.mid - e; } } }
  for (const x of tt) { for (const [k, v] of [["5 days out", "p120"], ["3 days out", "p72"], ["1 day out", "p24"]]) { const r = ms.find((m) => m.kind === "totals" && (m.line ?? +(m.question.match(/O\/U (\d+(?:\.\d+)?)/) || [])[1]) === x.line); const e = r && r[v];
      if (e != null) { const key = `early price · total lines (Over side) · ${k} -> close`; const t = (T[key] = T[key] || { n: 0, w: 0, l: 0, said: 0, px: 0, money: 0, pxn: 0 }); t.n++; t.pxn++; t.px += (x.over - SP) - e; } } }
  for (const kind of ["spread", "total"]) { const c = card && card[kind]; if (c && c.pts) tally(`fallback share · ${yr} · ${kind} · ${c.pts.hit >= 56 ? "a 56% line existed" : "FALLBACK (no 56% line)"}`, 50, "W", null); }
  const kn = keyNumberPick(G, poly, bk, alts); if (kn) { const res = grade(kn); tally(`BEAT THE · all`, kn.hit, res, kn.price); tally(`BEAT THE · books ${kn.tier} -> ${kn.pick.split(" ")[1]}`, kn.hit, res, kn.price); tally(`BEAT THE · ${yr}`, kn.hit, res, kn.price); }
  // LINE MOVE with the real Polymarket close vs the books' close
  const lm = lineMovePick(G, poly, bk); if (lm) tally(`LINE MOVE spread (Polymarket close vs books close)`, lm.hit, grade(lm), null);
  const lmt = lineMoveTotalPick(G, poly, bk); if (lmt) tally(`LINE MOVE total (Polymarket close vs books close)`, lmt.hit, grade(lmt), null);
  // main lines: favorite / underdog / over / under at Polymarket's own number (price = what you pay)
  if (poly.spread) { const favHome = poly.spread.homeSpread < 0, fav = favHome ? g.home : g.away, dog = favHome ? g.away : g.home;
    tally(`main line · ${yr} · favorite`, 50, grade({ kind: "spread", team: fav, line: favHome ? poly.spread.homeSpread : -poly.spread.homeSpread }), favHome ? poly.spread.home : poly.spread.away);
    tally(`main line · ${yr} · underdog`, 50, grade({ kind: "spread", team: dog, line: favHome ? -poly.spread.homeSpread : poly.spread.homeSpread }), favHome ? poly.spread.away : poly.spread.home);
    tally(`gap · Polymarket main spread vs books close ${Math.abs(poly.spread.homeSpread + g.sp) >= 1 ? "1+ pt apart" : "within 1"}`, 50, "W", null); }
  if (poly.total) { tally(`main line · ${yr} · over`, 50, grade({ kind: "total", side: "over", line: poly.total.line }), poly.total.over); tally(`main line · ${yr} · under`, 50, grade({ kind: "total", side: "under", line: poly.total.line }), poly.total.under); }
  if (poly.ml) { const favHome = poly.ml.home >= poly.ml.away, p = favHome ? poly.ml.home : poly.ml.away, won = favHome ? g.hs > g.as : g.as > g.hs; if (g.hs !== g.as) tally(`moneyline favorite · priced ${p < 0.6 ? "50-60" : p < 0.7 ? "60-70" : p < 0.8 ? "70-80" : "80+"}`, 100 * p, won ? "W" : "L", p + SP); }
}
console.log(`games matched ${matched}, unmatched ${unmatched.length} ${unmatched.slice(0, 5).join(" ")}, no live main line ${noMain}`);
const show = (title, re) => { console.log("\n" + title); for (const k of Object.keys(T).filter((k) => re.test(k)).sort()) { const t = T[k]; if (!t.n) continue;
  console.log(`   ${k.padEnd(62)} ${String(t.w + "-" + t.l).padStart(8)}  won ${pct(t.w, t.l).toFixed(1)}%${t.said ? `  said ${(t.said / t.n).toFixed(1)}%` : ""}${t.pxn ? `  price ${(100 * t.px / t.pxn).toFixed(0)}c  money/$100 ${(100 * t.money / t.pxn).toFixed(1).padStart(6)}` : ""}`); } };
show("CARD ROWS (every line the card would list, real Polymarket closes):", /^(spread|total) rows/);
show("PICK w/ POINTS (the card's chosen line):", /^PICK w\/ POINTS/);
show("BEAT THE tiers at the real bought-line price:", /^BEAT THE/);
show("LINE MOVE at the close:", /^LINE MOVE/);
show("MAIN LINES, both sides, at Polymarket's price:", /^main line|^gap/);
show("MONEYLINE favorites:", /^moneyline/);
show("HOW MANY LIVE LINES A GAME HAD AT THE CLOSE:", /^lines/);
show("FALLBACK SHARE:", /^fallback/);
console.log("\nEARLY PRICE: average change in the SAME line's price from N days out to the close (cents; + = it got dearer by kickoff):");
for (const k of Object.keys(T).filter((k) => k.startsWith("early price")).sort()) { const t = T[k]; console.log(`   ${k.padEnd(62)} n=${String(t.n).padStart(5)}  avg ${(100 * t.px / t.pxn).toFixed(2)}c`); }
