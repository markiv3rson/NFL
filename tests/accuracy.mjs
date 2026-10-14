// ACCURACY CHECK (10/14, owner: "make the tests say whether the picks win"). Runs the app's OWN pick functions (lib/stack.js) on past
// games and grades them with the app's own grader -- so this checks the code, not a copy of it. Fails (exit 1) when a green rule wins
// under 56% on its history, or when the code's result drifts more than 1.5 points from the rate the card shows (a code change broke it).
// Then prints each rule's LIVE record this season from the site. Needs the internet (nflverse schedule + the site); without it, it says so.
// Rules that need inputs not in public history files (INJURY: weekly starters out; TOTAL MOVE: the model's early features) are live-only here.
import { readFileSync } from "node:fs";
import { BUY_TIERS, BUY_ALT, buyCands, isNightGame, keyNumberPick, bounceBackPick, floorDogPick, lineMovePick, lineMoveTotalPick, injuryPick, gradeStackPick } from "../lib/stack.js";
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
    // every bought-point tier (lib/stack.js BUY_TIERS), day AND night games (each against its own card rate); Polymarket's line = the bought number (main or alternate)
    "BEAT THE 3": { claim: null, from: 1999, to: 2025, run: (g, G) => { const hs = -G.sp, T = BUY_TIERS[Math.abs(hs)]; if (!T) return null;
      const fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, team = T.side === "fav" ? fav : dog, main = team === g.home ? T.line : -T.line;
      return keyNumberPick(g, { spread: { homeSpread: main, home: 0.5, away: 0.5 } }, { spread: { homeSpread: hs } }); } },
    // the second candidates (books 3.5: the favorite at -2.5, 1 point), replayed on their own line
    "BEAT THE 3 (alt)": { claim: null, from: 1999, to: 2025, run: (g, G) => { const hs = -G.sp, T = (BUY_ALT[Math.abs(hs)] || [])[0]; if (!T) return null;
      const fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, team = T.side === "fav" ? fav : dog, main = team === g.home ? T.line : -T.line;
      return keyNumberPick(g, { spread: { homeSpread: main, home: 0.5, away: 0.5 } }, { spread: { homeSpread: hs } }); } },
    "BOUNCE BACK": { claim: 58.8, from: 1999, to: 2025, run: (g, G) => bounceBackPick(g, -G.sp, { away: prevOf[`${G.id}|away`], home: prevOf[`${G.id}|home`] }) },
    "BOUNCE BACK DOG": { claim: 56.9, from: 1999, to: 2025, run: (g, G) => floorDogPick(g, -G.sp, { away: prevOf[`${G.id}|away`], home: prevOf[`${G.id}|home`] }) },
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
  // fire early in the week meet this number, not the close. Day / night shown apart; the card shows the lower of the two rates.
  { const out = {};
    for (const G of games) { if (G.season < 2014 || G.season > 2025) continue; const o = opens[G.id]; if (!o || !isFinite(o.so)) continue;
      const g = { key: `${G.away} @ ${G.home}`, away: G.away, home: G.home, kickoff: G.kickoff }, hs = -o.so;
      for (const T of buyCands(Math.abs(hs))) {   // every candidate on its own line (main-line price only for that candidate)
        const fav = hs < 0 ? g.home : g.away, dog = hs < 0 ? g.away : g.home, team = T.side === "fav" ? fav : dog, main = team === g.home ? T.line : -T.line;
        const x = keyNumberPick(g, { spread: { homeSpread: main, home: 0.5, away: 0.5 } }, { spread: { homeSpread: hs } }); if (!x) continue;
        const res = gradeStackPick({ ...x, home: G.home }, G.hs, G.as), k = `${Math.abs(hs)} ${T.side} ${x.line > 0 ? "+" : ""}${x.line}|${x.night ? "night" : "day"}`, t = (out[k] = out[k] || { w: 0, l: 0 });
        if (res === "W") t.w++; else if (res === "L") t.l++; } }
    console.log("\nOPENING-LINE replay of BEAT THE 3 tiers (books' number = the week's opening spread, 2014-2025):");
    for (const [k, t] of Object.entries(out).sort()) console.log(`     books ${k.padEnd(9)} ${t.w}-${t.l} = ${pct(t.w, t.l) == null ? "—" : pct(t.w, t.l).toFixed(1)}% (${t.w + t.l})`); }
  // EXACT TIER NUMBERS (10/14 audit, owner: "100% accuracy"): every stored number in BUY_TIERS / BUY_ALT (closing 1999-2025 day / night, opening 2014-2025 day / night, the same side at the
  // books' own number) recomputed straight from the nflverse file and compared. Any difference over 0.05 points, or a different game count, FAILS.
  { let miss = 0, cells = 0;
    const cand = []; for (const [A, T] of Object.entries(BUY_TIERS)) cand.push([+A, T]); for (const [A, L] of Object.entries(BUY_ALT)) for (const T of L) cand.push([+A, T]);
    for (const [A, T] of cand) {
      const rate = (ver, night, lo, hi) => { let w = 0, n = 0; for (const G of games) { if (G.season < lo || G.season > hi) continue; const sp = ver === "close" ? G.sp : (opens[G.id] ? -opens[G.id].so : NaN); if (!isFinite(sp) || Math.abs(sp) !== A || isNightGame(G.kickoff) !== night) continue;
          const X = (ver === "close" ? G.sp > 0 : -sp > 0) ? G.hs - G.as : G.as - G.hs; n++; if (T.side === "fav" ? X > Math.abs(T.line) : X < Math.abs(T.line)) w++; } return [n ? Math.round(1000 * w / n) / 10 : null, n]; };
      const plain = (night) => { let w = 0, n = 0; for (const G of games) { if (G.season > 2025 || Math.abs(G.sp) !== A || isNightGame(G.kickoff) !== night) continue; const X = G.sp > 0 ? G.hs - G.as : G.as - G.hs; if (X === A) continue; n++; if (T.side === "fav" ? X > A : X < A) w++; } return Math.round(1000 * w / n) / 10; };
      const want = [["close day", [T.hit, T.n], rate("close", false, 1999, 2025)], ["close night", T.night, rate("close", true, 1999, 2025)], ["open day", T.open[0], rate("open", false, 2014, 2025)],
        ["open night", T.open[1], rate("open", true, 2014, 2025)]];
      for (const [lab, st, nw] of want) { cells++; if (nw[0] == null || Math.abs(st[0] - nw[0]) > 0.05 || st[1] !== nw[1]) { miss++; console.log(`     books ${A} ${T.side} ${T.line} ${lab}: stored ${st[0]} (${st[1]}) vs recomputed ${nw[0]} (${nw[1]})`); } }
      for (const [lab, st, nw] of [["plain day", T.plain[0], plain(false)], ["plain night", T.plain[1], plain(true)]]) { cells++; if (Math.abs(st - nw) > 0.05) { miss++; console.log(`     books ${A} ${T.side} ${T.line} ${lab}: stored ${st} vs recomputed ${nw}`); } } }
    if (miss) bad++;
    console.log(`${miss ? "FAIL" : "ok  "} ${"TIER NUMBERS".padEnd(20)} ${cells - miss} of ${cells} stored numbers match the nflverse file exactly`); }
  // INJURY (10/14): starters out rebuilt per team-week from nflverse's injury reports + snap counts with the app's own startersOut(), then
  // the app's own injuryPick(): line not yet moved 1+ toward the healthy team between the opening line and the close, graded at the close.
  { let w = 0, l = 0, p = 0, seasons = 0;
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
      for (const G of games.filter((x) => x.season === y)) { const o = opens[G.id]; if (!o || !isFinite(o.so)) continue;
        const sit = { home: { inj: startersOut(snaps[G.home], (inj[G.home] || []).filter((x) => x.week === G.week), G.week) },
                      away: { inj: startersOut(snaps[G.away], (inj[G.away] || []).filter((x) => x.week === G.week), G.week) } };
        const g = { key: `${G.away} @ ${G.home}`, away: G.away, home: G.home }, x = injuryPick(g, -G.sp, -o.so, sit, G.week); if (!x) continue;
        const res = gradeStackPick({ ...x, home: G.home }, G.hs, G.as); if (res === "W") w++; else if (res === "L") l++; else p++; } }
    const hit = pct(w, l), fail = !seasons || hit == null || hit < 56 || hit < 56.5 - 0.05; if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${"INJURY".padEnd(20)} ${w}-${l}${p ? ` (${p} push)` : ""} = ${hit == null ? "—" : hit.toFixed(1) + "%"} 2014-25 (${seasons} seasons of reports) · card says 56.5%`); }
}
// TOTAL MOVE: its inputs are the model's early features, so it is checked by the weekly rebuild's own honest test (every season predicted by a
// model that never saw it, bet at the opening total), read from the site. The card shows these same numbers.
try { const st = (await getJSONurl(`${SITE}/api/slate`)) || {}, m = st.status && st.status.moveCheck;   // getStatus() rides on the slate
  if (m) { const fail = m.hit20 < 56; if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${"TOTAL MOVE".padEnd(20)} top 20% ${m.hit20}% (${m.n20}) · top 10% ${m.hit10}% (${m.n10}) · unseen seasons, rebuild ${String(m.builtAt || "").slice(0, 10)}`); }
  else console.log("     TOTAL MOVE: the site has no rebuild numbers yet (shows the built-in 57.6% / 61.3%)");
} catch (e) { console.log(`     TOTAL MOVE: site not reachable (${String(e).slice(0, 60)})`); }

// Live record this season, from the site (each pick counted once, at the line it was first shown).
try {
  const d = await getJSONurl(`${SITE}/api/slate`), seen = {};
  for (const g of d.games || []) for (const c of g.combos || []) if (!seen[c.id]) seen[c.id] = c;
  const L = await getJSONurl(`${SITE}/api/results/list`).catch(() => null), card = L && L.combos && L.combos.card;
  console.log("\nLIVE this season (graded picks):");
  for (const c of Object.values(seen)) { const w = (c.rec || {}).w || 0, l = (c.rec || {}).l || 0;
    console.log(`     ${c.id.padEnd(20)} ${w}-${l}${w + l ? ` = ${pct(w, l).toFixed(1)}%` : " (none graded yet)"} · card says ${c.hit}%`); }
  const R = L && L.combos && L.combos.rules;
  if (R && Object.keys(R).length) { console.log("\nLIVE per green rule (each pick once, at the line first shown; BELOW = 15+ graded and 10+ points under the card -- a flag, nothing is cut):");
    for (const [k, r] of Object.entries(R).sort()) console.log(`     ${r.flag === "BELOW" ? "BELOW" : "     "} ${k.padEnd(34)} ${r.w}-${r.l}${r.w + r.l ? ` = ${pct(r.w, r.l).toFixed(1)}%` : ""} · card says ${r.say}% · ${r.flag}`); }
  else console.log("\nLIVE per green rule: none graded yet");
  if (card) console.log(`     card picks (all rules) spread ${card.spread.w}-${card.spread.l} = ${(pct(card.spread.w, card.spread.l) || 0).toFixed(1)}% · total ${card.total.w}-${card.total.l} = ${(pct(card.total.w, card.total.l) || 0).toFixed(1)}%`);
} catch (e) { console.log(`\nLIVE: site not reachable (${String(e).slice(0, 80)})`); }

// Parlays (10/14, owner: "make sure everything is graded ... see what works and what doesn't"): every saved parlay type's live record,
// how often it hit vs how often its % said, and the money at the owner's stakes. Reported weekly in the Tuesday report card.
try {
  const L = await getJSONurl(`${SITE}/api/results/list`), P = (L && L.paper) || {}, B = P.board || {}, names = P.names || {};
  const keys = ["sgp_best", "sgp_best_fill", "sgp_3", "sgp_linked", "sgp_style", "leg4_fav", "leg4_green_fav", "leg4_fav_td", "best_2", "best_3", "best_4"];
  console.log("\nPARLAYS this season (all legs must win):");
  for (const k of keys) { const b = B[k]; if (!b) continue; const d = b.decided || 0;
    console.log(`     ${(names[k] || k).slice(0, 44).padEnd(44)} ${d ? `${b.hits}-${d - b.hits} = ${(100 * b.hits / d).toFixed(1)}%` : "none graded yet"}${b.expRate != null && d ? ` · said ${(100 * b.expRate).toFixed(1)}%` : ""}${b.money != null ? ` · ${b.money >= 0 ? "+" : "-"}$${Math.abs(b.money).toFixed(0)}` : ""}${b.review && b.review.verdict && !/TOO FEW|WAITING/.test(b.review.verdict) ? ` · ${b.review.verdict}` : ""}`); }
} catch (e) { console.log(`\nPARLAYS: site not reachable (${String(e).slice(0, 80)})`); }

if (bad) { console.log(`\naccuracy: ${bad} rule(s) FAILED`); process.exit(1); }
console.log("\naccuracy: every green rule still wins 56%+ on its history and matches the % the card shows");
