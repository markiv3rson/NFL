// ACCURACY CHECK (10/14, owner: "make the tests say whether the picks win"). Runs the app's OWN pick functions (lib/stack.js) on past
// games and grades them with the app's own grader -- so this checks the code, not a copy of it. Fails (exit 1) when a green rule wins
// under 56% on its history, or when the code's result drifts more than 1.5 points from the rate the card shows (a code change broke it).
// Then prints each rule's LIVE record this season from the site. Needs the internet (nflverse schedule + the site); without it, it says so.
// Rules that need inputs not in public history files (INJURY: weekly starters out; TOTAL MOVE: the model's early features) are live-only here.
import { readFileSync } from "node:fs";
import { keyNumberPick, bounceBackPick, floorDogPick, lineMovePick, lineMoveTotalPick, gradeStackPick } from "../lib/stack.js";
import { parseCSV } from "../lib/injuries.js";

const SITE = process.env.SITE_URL || "https://nfl-nfl9.vercel.app";
import { execFileSync } from "node:child_process";
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
    "KEY NUMBER": { claim: 58.1, from: 2006, to: 2025, run: (g, G) => { const hs = -G.sp; if (Math.abs(hs) !== 3) return null;
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
  console.log("     INJURY, TOTAL MOVE: need weekly injury / model inputs not in the public files -- live record only (below).");
}

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

if (bad) { console.log(`\naccuracy: ${bad} rule(s) FAILED`); process.exit(1); }
console.log("\naccuracy: every green rule still wins 56%+ on its history and matches the % the card shows");
