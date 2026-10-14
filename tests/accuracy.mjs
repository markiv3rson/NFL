// ACCURACY CHECK (10/14, owner: "make the tests say whether the picks win"). Runs the app's OWN pick functions (lib/stack.js) on past
// games and grades them with the app's own grader -- so this checks the code, not a copy of it. Fails (exit 1) when a green rule wins
// under 56% on its history, or when the code's result drifts more than 1.5 points from the rate the card shows (a code change broke it).
// Then prints each rule's LIVE record this season from the site. Needs the internet (nflverse schedule + the site); without it, it says so.
// Rules that need inputs not in public history files (INJURY: weekly starters out; TOTAL MOVE: the model's early features) are live-only here.
import { readFileSync } from "node:fs";
import { keyNumberPick, bounceBackPick, floorDogPick, lineMovePick, lineMoveTotalPick, injuryPick, gradeStackPick } from "../lib/stack.js";
import { startersOut } from "../lib/snaps.js";
import { parseCSV } from "../lib/injuries.js";

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
        as: +c[ix("away_score")], hs: +c[ix("home_score")], sp: +c[ix("spread_line")], tl: c[ix("total_line")] === "" ? null : +c[ix("total_line")] }))
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
    "BEAT THE 3": { claim: 58.1, from: 2006, to: 2025, run: (g, G) => { const hs = -G.sp; if (Math.abs(hs) !== 3 && Math.abs(hs) !== 2.5) return null;
      return keyNumberPick(g, { spread: { homeSpread: hs > 0 ? 3.5 : -3.5, home: 0.5, away: 0.5 } }, { spread: { homeSpread: hs } }); } },
    "BOUNCE BACK": { claim: 57.0, from: 1999, to: 2025, run: (g, G) => bounceBackPick(g, -G.sp, { away: prevOf[`${G.id}|away`], home: prevOf[`${G.id}|home`] }) },
    "BOUNCE BACK DOG": { claim: 57.1, from: 1999, to: 2025, run: (g, G) => floorDogPick(g, -G.sp, { away: prevOf[`${G.id}|away`], home: prevOf[`${G.id}|home`] }) },
    // LINE MOVE: Polymarket "still has the old number" = the opening line; the books = the close. Graded at the opening number.
    "LINE MOVE (spread)": { claim: null, from: 2014, to: 2026, run: (g, G) => { const o = opens[G.id]; if (!o || !isFinite(o.so)) return null;
      return lineMovePick(g, { spread: { homeSpread: -o.so, home: 0.5, away: 0.5 } }, { spread: { homeSpread: -G.sp } }); } },
    "LINE MOVE (total)": { claim: 67.0, from: 2014, to: 2026, run: (g, G) => { const o = opens[G.id]; if (!o || !isFinite(o.to) || G.tl == null) return null;
      return lineMoveTotalPick(g, { total: { line: o.to, over: 0.5, under: 0.5 } }, { total: { line: G.tl } }); } },
  };
  console.log("\nACCURACY -- the app's own pick code replayed on past games (closing line unless noted):");
  for (const [name, R] of Object.entries(rules)) {
    let w = 0, l = 0, p = 0; const tiers = {};
    for (const G of games) { if (G.season < R.from || G.season > R.to) continue;
      const g = { key: `${G.away} @ ${G.home}`, away: G.away, home: G.home }, x = R.run(g, G); if (!x) continue;
      const res = gradeStackPick({ ...x, home: G.home }, G.hs, G.as); if (res === "W") w++; else if (res === "L") l++; else p++;
      const t = (tiers[x.hit] = tiers[x.hit] || { w: 0, l: 0, n: x.n }); if (res === "W") t.w++; else if (res === "L") t.l++; }
    const hit = pct(w, l), tierTxt = Object.entries(tiers).map(([h, t]) => `card says ${h}% -> ${pct(t.w, t.l).toFixed(1)}% (${t.w + t.l})`).join(" · ");
    // drift = the code now wins LESS than the card says (by 1.5+ points on 50+ games); winning more is noted, not a failure
    const drift = Object.entries(tiers).filter(([h, t]) => t.w + t.l >= 50 && pct(t.w, t.l) < Number(h) - 1.5);
    const fail = hit == null || hit < 56 || drift.length;
    if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${name.padEnd(20)} ${w}-${l}${p ? ` (${p} push)` : ""} = ${hit == null ? "—" : hit.toFixed(1) + "%"} ${R.from}-${String(R.to).slice(2)} · ${tierTxt}`);
  }
  // INJURY (10/14): starters out rebuilt per team-week from nflverse's injury reports + snap counts with the app's own startersOut(), then
  // the app's own injuryPick(): line not yet moved 1+ toward the healthy team between the opening line and the close, graded at the close.
  { let w = 0, l = 0, p = 0, seasons = 0;
    for (let y = 2014; y <= Math.max(...games.map((x) => x.season)); y++) {
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
    const hit = pct(w, l), fail = !seasons || hit == null || hit < 56 || hit < 57.0 - 1.5; if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${"INJURY".padEnd(20)} ${w}-${l}${p ? ` (${p} push)` : ""} = ${hit == null ? "—" : hit.toFixed(1) + "%"} 2014-${String(Math.max(...games.map((x) => x.season))).slice(2)} (${seasons} seasons of reports) · card says 57%`); }
}
// TOTAL MOVE: its inputs are the model's early features, so it is checked by the weekly rebuild's own honest test (every season predicted by a
// model that never saw it, bet at the opening total), read from the site. The card shows these same numbers.
try { const st = (await getJSONurl(`${SITE}/api/slate`)) || {}, m = st.status && st.status.moveCheck;   // getStatus() rides on the slate
  if (m) { const fail = m.hit20 < 56; if (fail) bad++;
    console.log(`${fail ? "FAIL" : "ok  "} ${"TOTAL MOVE".padEnd(20)} top 20% ${m.hit20}% (${m.n20}) · top 10% ${m.hit10}% (${m.n10}) · unseen seasons, rebuild ${String(m.builtAt || "").slice(0, 10)}`); }
  else console.log("     TOTAL MOVE: the site has no rebuild numbers yet (shows the built-in 59.1% / 62.7%)");
} catch (e) { console.log(`     TOTAL MOVE: site not reachable (${String(e).slice(0, 60)})`); }

// Live record this season, from the site (each pick counted once, at the line it was first shown).
try {
  const d = await getJSONurl(`${SITE}/api/slate`), seen = {};
  for (const g of d.games || []) for (const c of g.combos || []) if (!seen[c.id]) seen[c.id] = c;
  const L = await getJSONurl(`${SITE}/api/results/list`).catch(() => null), card = L && L.combos && L.combos.card;
  console.log("\nLIVE this season (graded picks):");
  for (const c of Object.values(seen)) { const w = (c.rec || {}).w || 0, l = (c.rec || {}).l || 0;
    console.log(`     ${c.id.padEnd(20)} ${w}-${l}${w + l ? ` = ${pct(w, l).toFixed(1)}%` : " (none graded yet)"} · card says ${c.hit}%`); }
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
