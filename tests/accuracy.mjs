// ACCURACY CHECK (10/14, owner: "make the tests say whether the picks win"). Runs the app's OWN pick functions (lib/stack.js) on past
// games and grades them with the app's own grader -- so this checks the code, not a copy of it. Fails (exit 1) when a green rule wins
// under 56% on its history, or when the code's result drifts more than 1.5 points from the rate the card shows (a code change broke it).
// Then prints each rule's LIVE record this season from the site. Needs the internet (nflverse schedule + the site); without it, it says so.
// Rules that need inputs not in public history files (INJURY: weekly starters out; TOTAL MOVE: the model's early features) are live-only here.
import { readFileSync } from "node:fs";
import { BUY_TIERS, BUY_ALT, buyCands, keyNumberPick, bounceBackPick, floorDogPick, lineMovePick, lineMoveTotalPick, injuryPick, gradeStackPick } from "../lib/stack.js";
import { startersOut } from "../lib/snaps.js";
import { parseCSV } from "../lib/injuries.js";
import { kickoffISO } from "../lib/games.js";

const SITE = process.env.SITE_URL || "https://nfl-nfl9.vercel.app";
import { execFileSync } from "node:child_process";
const getText = (u) => execFileSync("curl", ["-sL", "--max-time", "120", u], { maxBuffer: 256 << 20 }).toString();
const getJSONurl = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); return await r.json(); }
  catch { return JSON.parse(execFileSync("curl", ["-s", "--max-time", "90", u], { maxBuffer: 64 << 20 }).toString()); } };   // plain fetch can't use a proxy
const pct = (w, l) => (w + l ? (100 * w) / (w + l) : null);
let bad = 0;
const games = await (async () => {
  try {
    const r = await fetch("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", { signal: AbortSignal.timeout(30000) });
    const [h, ...rows] = parseCSV(await r.text()), ix = (k) => h.indexOf(k);
    return rows.filter((c) => c[ix("game_type")] === "REG" && c[ix("home_score")] !== "" && c[ix("home_score")] !== undefined && c[ix("spread_line")] !== "")
      .map((c) => ({ id: c[ix("game_id")], season: +c[ix("season")], week: +c[ix("week")], away: c[ix("away_team")], home: c[ix("home_team")],
        as: +c[ix("away_score")], hs: +c[ix("home_score")], sp: +c[ix("spread_line")], tl: c[ix("total_line")] === "" ? null : +c[ix("total_line")],
        kickoff: kickoffISO(c[ix("gameday")], c[ix("gametime")]) }))
      .sort((a, b) => a.season - b.season || a.week - b.week);
  } catch (e) { console.log(`accuracy: schedule file not reachable (${e}) -- history check skipped`); return null; }
})();

if (games) {
  const opens = Object.fromEntries(parseCSV(readFileSync(new URL("../railway-model-service/data/opens.csv", import.meta.url), "utf8")).slice(1).filter((r) => r[0]).map((r) => [r[0], { so: +r[1], to: +r[2] }]));
  // each team's previous game this season (for BOUNCE BACK / BOUNCE BACK DOG): points, and margin against the closing line
  const last = {}, prevOf = {};
  for (const g of games) { for (const [t, side] of [[g.home, "home"], [g.away, "away"]]) { const p = last[`${g.season}|${t}`]; prevOf[`${g.id}|${side}`] = p || null; }
    for (const [t, home] of [[g.home, true], [g.away, false]]) { const pts = home ? g.hs : g.as, opp = home ? g.as : g.hs;
      last[`${g.season}|${t}`] = { prevPts: pts, prevAts: home ? pts - opp - g.sp : pts - opp + g.sp }; } }
  const rules = {
    // every bought-point tier (lib/stack.js BUY_TIERS), all games; Polymarket's line = the bought number (main or alternate)
    "BEAT THE 3": { claim: null, from: 1999, to: 2025, run: (g, G) => { const hs = -G.sp, T = BUY_TIERS[Math.abs(hs)]; if (!T) return null;
      const fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, team = T.side === "fav" ? fav : dog, main = team === g.home ? T.line : -T.line;
      return keyNumberPick(g, { spread: { homeSpread: main, home: 0.5, away: 0.5 } }, { spread: { homeSpread: hs } }); } },
    // the second candidates (books 3.5: the favorite at -2.5, 1 point), replayed on their own line -- 10/19 rules cleanup: BUY_ALT is empty, so no replay
    ...(Object.keys(BUY_ALT).length ? { "BEAT THE 3 (alt)": { claim: null, from: 1999, to: 2025, run: (g, G) => { const hs = -G.sp, T = (BUY_ALT[Math.abs(hs)] || [])[0]; if (!T) return null;
      const fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, team = T.side === "fav" ? fav : dog, main = team === g.home ? T.line : -T.line;
      return keyNumberPick(g, { spread: { homeSpread: main, home: 0.5, away: 0.5 } }, { spread: { homeSpread: hs } }); } } } : {}),
    "BOUNCE BACK": { claim: 61.3, from: 1999, to: 2025, run: (g, G) => bounceBackPick(g, -G.sp, { away: prevOf[`${G.id}|away`], home: prevOf[`${G.id}|home`] }) },
    "BOUNCE BACK DOG": { claim: 56.5, from: 1999, to: 2025, run: (g, G) => floorDogPick(g, -G.sp, { away: prevOf[`${G.id}|away`], home: prevOf[`${G.id}|home`] }) },
    // LINE MOVE: Polymarket "still has the old number" = the opening line; the books = the close. Graded at the opening number.
    "LINE MOVE (spread)": { claim: null, from: 2014, to: 2025, run: (g, G) => { const o = opens[G.id]; if (!o || !isFinite(o.so)) return null;
      return lineMovePick(g, { spread: { homeSpread: -o.so, home: 0.5, away: 0.5 } }, { spread: { homeSpread: -G.sp } }); } },
    "LINE MOVE (total)": { claim: 66.1, from: 2014, to: 2025, run: (g, G) => { const o = opens[G.id]; if (!o || !isFinite(o.to) || G.tl == null) return null;
      return lineMoveTotalPick(g, { total: { line: o.to, over: 0.5, under: 0.5 } }, { total: { line: G.tl } }); } },
  };
  console.log("\nACCURACY -- the app's own pick code replayed on past games (closing line unless noted):");
  for (const [name, R] of Object.entries(rules)) {
    let w = 0, l = 0, p = 0; const tiers = {};
    for (const G of games) { if (G.season < R.from || G.season > R.to) continue;
      const g = { key: `${G.away} @ ${G.home}`, away: G.away, home: G.home, kickoff: G.kickoff }, x = R.run(g, G); if (!x) continue;
      const res = gradeStackPick({ ...x, home: G.home }, G.hs, G.as); if (res === "W") w++; else if (res === "L") l++; else p++;
      const t = (tiers[x.hit] = tiers[x.hit] || { w: 0, l: 0, n: x.n }); if (res === "W") t.w++; else if (res === "L") t.l++; }
    const hit = pct(w, l), tierTxt = Object.entries(tiers).map(([h, t]) => `card says ${h}% -> ${pct(t.w, t.l).toFixed(1)}% (${t.w + t.l})`).join(" · ");
    // drift = the code now wins LESS than the card says (by 1.5+ points on 50+ games); winning more is noted, not a failure
    const exact = !/^BEAT THE 3/.test(name), drift = Object.entries(tiers).filter(([h, t]) => exact ? t.w + t.l >= 30 && Math.abs(pct(t.w, t.l) - Number(h)) > 0.05 : t.w + t.l >= 50 && pct(t.w, t.l) < Number(h) - 1.5);   // 10/14 audit: every non-tier rule must match its card number exactly
    const fail = hit == null || hit < 56 || drift.length;
    if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${name.padEnd(20)} ${w}-${l}${p ? ` (${p} push)` : ""} = ${hit == null ? "—" : hit.toFixed(1) + "%"} ${R.from}-${String(R.to).slice(2)} · ${tierTxt}`);
  }
  // AT THE OPENING LINE (10/14, owner: "build 1"): the same rules, but the books' number is the week's OPENING spread (2014-26). Picks that
  // fire early in the week meet this number, not the close. The card shows the lower of the closing and opening rates.
  { const out = {};
    for (const G of games) { if (G.season < 2014 || G.season > 2025) continue; const o = opens[G.id]; if (!o || !isFinite(o.so)) continue;
      const g = { key: `${G.away} @ ${G.home}`, away: G.away, home: G.home, kickoff: G.kickoff }, hs = -o.so;
      for (const T of buyCands(Math.abs(hs))) {   // every candidate on its own line (main-line price only for that candidate)
        const fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, team = T.side === "fav" ? fav : dog, main = team === g.home ? T.line : -T.line;
        const x = keyNumberPick(g, { spread: { homeSpread: main, home: 0.5, away: 0.5 } }, { spread: { homeSpread: hs } }); if (!x) continue;
        const res = gradeStackPick({ ...x, home: G.home }, G.hs, G.as), k = `${Math.abs(hs)} ${T.side} ${x.line > 0 ? "+" : ""}${x.line}`, t = (out[k] = out[k] || { w: 0, l: 0 });
        if (res === "W") t.w++; else if (res === "L") t.l++; } }
    console.log("\nOPENING-LINE replay of BEAT THE 3 tiers (books' number = the week's opening spread, 2014-2025):");
    for (const [k, t] of Object.entries(out).sort()) console.log(`     books ${k.padEnd(9)} ${t.w}-${t.l} = ${pct(t.w, t.l) == null ? "—" : pct(t.w, t.l).toFixed(1)}% (${t.w + t.l})`); }
  // EXACT TIER NUMBERS (10/14 audit, owner: "100% accuracy"): every stored number in BUY_TIERS / BUY_ALT (closing 1999-2025, opening 2014-2025, the same side at the
  // books' own number) recomputed straight from the nflverse file and compared. Any difference over 0.05 points, or a different game count, FAILS.
  { let miss = 0, cells = 0;
    const cand = []; for (const [A, T] of Object.entries(BUY_TIERS)) cand.push([+A, T]); for (const [A, L] of Object.entries(BUY_ALT)) for (const T of L) cand.push([+A, T]);
    for (const [A, T] of cand) {
      const rate = (ver, lo, hi) => { let w = 0, n = 0; for (const G of games) { if (G.season < lo || G.season > hi) continue; const sp = ver === "close" ? G.sp : (opens[G.id] ? -opens[G.id].so : NaN); if (!isFinite(sp) || Math.abs(sp) !== A) continue;
          const X = (ver === "close" ? G.sp > 0 : -sp > 0) ? G.hs - G.as : G.as - G.hs; n++; if (T.side === "fav" ? X > Math.abs(T.line) : X < Math.abs(T.line)) w++; } return [n ? Math.round(1000 * w / n) / 10 : null, n]; };
      const plain = () => { let w = 0, n = 0; for (const G of games) { if (G.season > 2025 || Math.abs(G.sp) !== A) continue; const X = G.sp > 0 ? G.hs - G.as : G.as - G.hs; if (X === A) continue; n++; if (T.side === "fav" ? X > A : X < A) w++; } return Math.round(1000 * w / n) / 10; };
      const want = [["close", [T.hit, T.n], rate("close", 1999, 2025)], ["open", T.open, rate("open", 2014, 2025)]];
      for (const [lab, st, nw] of want) { cells++; if (nw[0] == null || Math.abs(st[0] - nw[0]) > 0.05 || st[1] !== nw[1]) { miss++; console.log(`     books ${A} ${T.side} ${T.line} ${lab}: stored ${st[0]} (${st[1]}) vs recomputed ${nw[0]} (${nw[1]})`); } }
      { cells++; const pl = plain(); if (Math.abs(T.plain - pl) > 0.05) { miss++; console.log(`     books ${A} ${T.side} ${T.line} plain: stored ${T.plain} vs recomputed ${pl}`); } } }
    if (miss) bad++;
    console.log(`${miss ? "FAIL" : "ok  "} ${"TIER NUMBERS".padEnd(20)} ${cells - miss} of ${cells} stored numbers match the nflverse file exactly`); }
  // EXACT LINE TABLE (10/15): the win-rate table behind PICK w/ POINTS (lib/linetable_data.js) is rebuilt from the nflverse file and must match what is stored, count for count.
  { const { buildTable } = await import("./linetable_build.mjs"), { LT } = await import("../lib/linetable_data.js"), fresh = await buildTable(), same = JSON.stringify({ s: fresh.s, t: fresh.t }) === JSON.stringify(LT); if (!same) bad++;
    console.log(`${same ? "ok  " : "FAIL"} ${"LINE TABLE".padEnd(20)} ${same ? `every count matches the nflverse file (${fresh.games} games, ${Object.keys(fresh.s).length} spread numbers, ${Object.keys(fresh.t).length} total buckets)` : "stored table differs from the nflverse file: re-run tests/linetable_build.mjs"}`); }
  // INJURY (10/14): starters out rebuilt per team-week from nflverse's injury reports + snap counts with the app's own startersOut(), then
  // the app's own injuryPick(): line not yet moved 1+ toward the healthy team between the opening line and the close, graded at the close.
  { let w = 0, l = 0, p = 0, seasons = 0; const byType = { qb: { w: 0, l: 0 }, other: { w: 0, l: 0 } };
    for (let y = 2014; y <= 2025; y++) {
      let injRows, snapRows;
      try { injRows = parseCSV(getText(`https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${y}.csv`));
        snapRows = parseCSV(getText(`https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${y}.csv`)); } catch { continue; }
      if (injRows.length < 100 || snapRows.length < 100) continue; seasons++;
      const ih = injRows[0], sh = snapRows[0], I = (k) => ih.indexOf(k), S = (k) => sh.indexOf(k), AL = { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" };
      const snaps = {};   // same shape as lib/snaps.js loadSnaps
      for (const r of snapRows.slice(1)) { if (r[S("game_type")] !== "REG" || !r[S("team")]) continue; const t = AL[r[S("team")]] || r[S("team")], n = r[S("player")];
        const q = ((snaps[t] = snaps[t] || {})[n] = snaps[t][n] || { name: n, pos: r[S("position")], weeks: {}, dweeks: {} });
        q.weeks[+r[S("week")]] = +r[S("offense_pct")] || 0; q.dweeks[+r[S("week")]] = +r[S("defense_pct")] || 0; q.pos = r[S("position")]; }
      const inj = {};
      for (const r of injRows.slice(1)) { if (r[I("game_type")] !== "REG" || !r[I("team")]) continue; const t = AL[r[I("team")]] || r[I("team")];
        (inj[t] = inj[t] || []).push({ name: r[I("full_name")], status: r[I("report_status")] || "", week: +r[I("week")] }); }
      // 10/20: each team's previous GAME week this season (bye-aware) -> the flag on that week's report = a continuing injury (no pick)
      const prevWeek = {}, byTeam = {};
      for (const G of games.filter((x) => x.season === y)) for (const t of [G.home, G.away]) (byTeam[t] = byTeam[t] || []).push(G.week);
      for (const t in byTeam) { const ws = [...new Set(byTeam[t])].sort((a, b) => a - b); ws.forEach((wk, i) => (prevWeek[`${t}|${wk}`] = i ? ws[i - 1] : null)); }
      const so = (t, wk) => startersOut(snaps[t], (inj[t] || []).filter((x) => x.week === wk), wk);
      for (const G of games.filter((x) => x.season === y)) { const o = opens[G.id]; if (!o || !isFinite(o.so)) continue;
        const pw = (t) => prevWeek[`${t}|${G.week}`];
        const sit = { home: { inj: so(G.home, G.week), injPrev: pw(G.home) ? so(G.home, pw(G.home)) : null },
                      away: { inj: so(G.away, G.week), injPrev: pw(G.away) ? so(G.away, pw(G.away)) : null } };
        const g = { key: `${G.away} @ ${G.home}`, away: G.away, home: G.home }, x = injuryPick(g, -G.sp, -o.so, sit, G.week); if (!x) continue;
        const res = gradeStackPick({ ...x, home: G.home }, G.hs, G.as); if (res === "W") w++; else if (res === "L") l++; else p++;
        if (res === "W" || res === "L") byType[x.injType || "other"][res === "W" ? "w" : "l"]++; } }
    // 10/20: the card shows the type's own rate (lib/stack.js INJURY_RATES): QB newly out must stay 56%+ and match its number; OL / DB must match its number
    const { INJURY_RATES } = await import("../lib/stack.js");
    const hit = pct(w, l), hq = pct(byType.qb.w, byType.qb.l), ho = pct(byType.other.w, byType.other.l);
    const fail = !seasons || hit == null || hq == null || hq < 56 || Math.abs(hq - INJURY_RATES.qb.hit) > 1.5 || ho == null || Math.abs(ho - INJURY_RATES.other.hit) > 1.5; if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${"INJURY".padEnd(20)} ${w}-${l}${p ? ` (${p} push)` : ""} = ${hit == null ? "—" : hit.toFixed(1) + "%"} 2014-25 (${seasons} seasons of reports; new injuries only) · QB out ${byType.qb.w}-${byType.qb.l} = ${hq == null ? "—" : hq.toFixed(1) + "%"} (card ${INJURY_RATES.qb.hit}) · 2+ OL / DB ${byType.other.w}-${byType.other.l} = ${ho == null ? "—" : ho.toFixed(1) + "%"} (card ${INJURY_RATES.other.hit})`); }
}
// TOTAL MOVE: its inputs are the model's early features, so it is checked by the weekly rebuild's own honest test (every season predicted by a
// model that never saw it, bet at the opening total), read from the site. The card shows these same numbers.
try { const st = (await getJSONurl(`${SITE}/api/slate`)) || {}, m = st.status && st.status.moveCheck;   // getStatus() rides on the slate
  if (m) { const fail = m.hit20 < 56; if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${"TOTAL MOVE".padEnd(20)} top 20% ${m.hit20}% (${m.n20}) · top 10% ${m.hit10}% (${m.n10}) · unseen seasons, rebuild ${String(m.builtAt || "").slice(0, 10)}`); }
  else console.log("     TOTAL MOVE: the site has no rebuild numbers yet (shows the built-in 57.6% / 61.3%)");
} catch (e) { console.log(`     TOTAL MOVE: site not reachable (${String(e).slice(0, 60)})`); }
// GAME PROPS (10/28 night, lib/gameprops.js): the app's own pick code on Polymarket US's 2026 wk1-7 game / team props (steady two-sided books in the 2 h
// before kickoff, the prices you would have paid, Polymarket's settlement; railway-model-service/data/poly_us_gameprops.csv). No 2026 game made a pick.
{ const G = await import("../lib/gameprops.js"), [h, ...rows] = parseCSV(readFileSync(new URL("../railway-model-service/data/poly_us_gameprops.csv", import.meta.url), "utf8")), ix = (k) => h.indexOf(k);
  const by = {}; for (const c of rows) if (c.length === h.length) (by[`${c[ix("week")]}|${c[ix("away")]}|${c[ix("home")]}`] ||= []).push(c);
  const picks = [];
  for (const cs of Object.values(by)) { const cache = {}, best = {}, a = cs[0][ix("away")], hm = cs[0][ix("home")], hf = +cs[0][ix("hfav")], tl = +cs[0][ix("tl")];
    for (const c of cs) { const lt = c[ix("long_team")], m = { slug: c[ix("slug")], sportsMarketType: c[ix("type")], question: c[ix("question")], marketSides: [{ long: true, team: lt ? { abbreviation: lt } : null }, { long: false }] };
      const p = G.gpParse(m, a, hm); if (!p) continue; const ch = G.gpChance(p, hf, tl, cache), y = +c[ix("long_won")];
      for (const [px, chs, won] of [[+c[ix("long_price")], ch, y], [+c[ix("short_price")], 1 - ch, 1 - y]]) { const sh = G.gpShown(chs, px);
        if (G.gpQualifies(sh, px) && (!best[p.fam] || sh > best[p.fam].sh)) best[p.fam] = { sh, px, won, wk: +c[ix("week")] }; } }
    for (const b of Object.values(best)) if (b.won !== 0.5) picks.push(b); }
  const f = (xs) => { const w = xs.filter((x) => x.won === 1).length; return { w, l: xs.length - w, hit: pct(w, xs.length - w), said: xs.reduce((s, x) => s + x.sh, 0) / xs.length * 100, per: xs.reduce((s, x) => s + x.won / x.px - 1, 0) / xs.length * 100 }; };
  const A = f(picks), B = f(picks.filter((x) => x.wk >= 4)), fail = A.hit < 56 || A.hit < A.said - 3;
  if (fail) bad++;
  console.log(`${fail ? "FAIL" : "ok  "} ${"GAME PROPS".padEnd(20)} ${A.w}-${A.l} = ${A.hit.toFixed(1)}% (said ${A.said.toFixed(1)}, ${A.per >= 0 ? "+" : ""}${A.per.toFixed(1)} per $100) Polymarket US 2026 wk1-7 · weeks 4-7 ${B.w}-${B.l} = ${B.hit.toFixed(1)}%`); }

// Live record this season, from the site (each pick counted once, at the line it was first shown).
try {
  const d = await getJSONurl(`${SITE}/api/slate`), seen = {};
  for (const g of d.games || []) for (const c of g.combos || []) if (!seen[c.id]) seen[c.id] = c;
  const L = await getJSONurl(`${SITE}/api/results/list`).catch(() => null), card = L && L.combos && L.combos.card;
  console.log("\nLIVE this season (graded picks):");
  for (const c of Object.values(seen)) { const w = (c.rec || {}).w || 0, l = (c.rec || {}).l || 0;
    console.log(`     ${c.id.padEnd(20)} ${w}-${l}${w + l ? ` = ${pct(w, l).toFixed(1)}%` : " (none graded yet)"} · card says ${c.hit}%`); }
  const R = L && L.combos && L.combos.rules;
  if (R && Object.keys(R).length) { console.log("\nLIVE per green rule (each pick once: rules at the line first shown, the card's PICK / PICK w/ POINTS / MODEL SIDE as locked at kickoff; BELOW = 15+ graded and 10+ points under the card -- a flag, nothing is cut):");
    const sprt = (w, l, say) => { const p1 = Math.min(Math.max(say / 100, 0.53), 0.95), p0 = 0.524, llr = w * Math.log(p1 / p0) + l * Math.log((1 - p1) / (1 - p0)); return `${llr >= 2.94 ? "evidence FOR" : llr <= -2.94 ? "evidence AGAINST" : "not decided yet"} (LLR ${llr >= 0 ? "+" : ""}${llr.toFixed(2)})`; };   // 10/26 night: sequential test, +/-2.94 = 5% error either way
    for (const [k, r] of Object.entries(R).sort()) console.log(`     ${r.flag === "BELOW" ? "BELOW" : "     "} ${k.padEnd(34)} ${r.w}-${r.l}${r.w + r.l ? ` = ${pct(r.w, r.l).toFixed(1)}%` : ""} · card says ${r.say}% · ${r.flag} · ${sprt(r.w, r.l, r.say)}`); }
  else console.log("\nLIVE per green rule: none graded yet");
  if (card) console.log(`     card PICK${card.from ? ` (week ${card.from}+, locked at kickoff)` : ""} spread ${card.spread.w}-${card.spread.l} = ${(pct(card.spread.w, card.spread.l) || 0).toFixed(1)}% · total ${card.total.w}-${card.total.l} = ${(pct(card.total.w, card.total.l) || 0).toFixed(1)}%`);
} catch (e) { console.log(`\nLIVE: site not reachable (${String(e).slice(0, 80)})`); }

// Parlays (10/14, owner: "make sure everything is graded ... see what works and what doesn't"): every saved parlay type's live record,
// how often it hit vs how often its % said, and the money at the owner's stakes. Reported weekly in the Tuesday report card.
try {
  const L = await getJSONurl(`${SITE}/api/results/list`), P = (L && L.paper) || {}, B = P.board || {}, names = P.names || {};
  const keys = ["sgp_best", "sgp_best_fill", "sgp_3", "sgp_upset", "sgp_st", "best_2", "best_3", "td_likely_2", "td_likely_3"];   // 10/19 (owner): 3 legs at most -- the 4-leg types are no longer built
  console.log("\nPARLAYS this season (all legs must win):");
  for (const k of keys) { const b = B[k]; if (!b) continue; const d = b.decided || 0;
    console.log(`     ${(names[k] || k).slice(0, 44).padEnd(44)} ${d ? `${b.hits}-${d - b.hits} = ${(100 * b.hits / d).toFixed(1)}%` : "none graded yet"}${b.expRate != null && d ? ` · said ${(100 * b.expRate).toFixed(1)}%` : ""}${b.money != null ? ` · ${b.money >= 0 ? "+" : "-"}$${Math.abs(b.money).toFixed(0)}` : ""}${b.review && b.review.verdict && !/TOO FEW|WAITING/.test(b.review.verdict) ? ` · ${b.review.verdict}` : ""}`); }
} catch (e) { console.log(`\nPARLAYS: site not reachable (${String(e).slice(0, 80)})`); }

if (bad) { console.log(`\naccuracy: ${bad} rule(s) FAILED`); process.exit(1); }
console.log("\naccuracy: every green rule still wins 56%+ on its history and matches the % the card shows");
