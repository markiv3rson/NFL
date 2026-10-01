// Sportsbook consensus (The Odds API) — REFERENCE ONLY, the prior for fair probability (protocol 2.11).
// One pull = h2h + spreads + totals, US region = 3 credits.
import { TEAMS } from "./games";
import { toProb, toAmerican } from "./odds";
const URL = (process.env.ODDS_BASE || "https://api.the-odds-api.com") + "/v4/sports/americanfootball_nfl/odds";
const abbrFromName = (name) => Object.keys(TEAMS).find((k) => (name || "").endsWith(TEAMS[k])) || null;

// Average implied probability per side across books, then de-vig (2.3).
function consensus(pairs) {
  if (!pairs.length) return null;
  const a = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, b = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  return { a: { odds: toAmerican(a), fair: a / (a + b) }, b: { odds: toAmerican(b), fair: b / (a + b) }, n: pairs.length };
}
function mode(nums) {
  const c = {}; nums.forEach((n) => (c[n] = (c[n] || 0) + 1));
  return Number(Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]);
}
export function parseBooks(events) {
  const out = {};
  for (const ev of events || []) {
    const away = abbrFromName(ev.away_team), home = abbrFromName(ev.home_team);
    if (!away || !home) continue;
    const ml = [], sp = [], tot = [];
    for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
      const by = (n) => m.outcomes.find((o) => o.name === n);
      if (m.key === "h2h") { const h = by(ev.home_team), a = by(ev.away_team); if (h && a) ml.push([toProb(a.price), toProb(h.price)]); }
      if (m.key === "spreads") { const h = by(ev.home_team), a = by(ev.away_team); if (h && a) sp.push({ point: h.point, p: [toProb(a.price), toProb(h.price)] }); }
      if (m.key === "totals") { const o = by("Over"), u = by("Under"); if (o && u) tot.push({ point: o.point, p: [toProb(o.price), toProb(u.price)] }); }
    }
    const g = {};
    const c = consensus(ml); if (c) g.ml = { away: c.a, home: c.b, n: c.n };
    if (sp.length) { const pt = mode(sp.map((x) => x.point)); const s = consensus(sp.filter((x) => x.point === pt).map((x) => x.p));
      if (s) g.spread = { homeSpread: pt, away: s.a, home: s.b, n: s.n }; }
    if (tot.length) { const pt = mode(tot.map((x) => x.point)); const t = consensus(tot.filter((x) => x.point === pt).map((x) => x.p));
      if (t) g.total = { line: pt, over: t.a, under: t.b, n: t.n }; }
    out[`${away} @ ${home}`] = g;
  }
  return out;
}
export async function fetchBooks(apiKey) {
  const r = await fetch(`${URL}?regions=us&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${apiKey}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`sportsbook odds returned ${r.status}`);
  return { games: parseBooks(await r.json()), remaining: r.headers.get("x-requests-remaining") };
}
