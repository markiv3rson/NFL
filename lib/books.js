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
    const ml = [], sp = [], tot = [], byBook = {};
    for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
      const by = (n) => m.outcomes.find((o) => o.name === n), mine = (byBook[bk.key] = byBook[bk.key] || {});
      if (m.key === "h2h") { const h = by(ev.home_team), a = by(ev.away_team); if (h && a) ml.push([toProb(a.price), toProb(h.price)]); }
      if (m.key === "spreads") { const h = by(ev.home_team), a = by(ev.away_team); if (h && a) { sp.push({ point: h.point, p: [toProb(a.price), toProb(h.price)] }); mine.hs = h.point; mine.hp = h.price; mine.ap = a.price; } }
      if (m.key === "totals") { const o = by("Over"), u = by("Under"); if (o && u) { tot.push({ point: o.point, p: [toProb(o.price), toProb(u.price)] }); mine.tl = o.point; } }
    }
    const g = {};
    // 10/12 (owner chose B): each book's own line on every pull (same credits), so line moves can later be tested per book and by
    // time of week (opening / midweek / Sunday). Recorded only -- nothing is shown or picked from it until tested on unseen games.
    if (Object.keys(byBook).length) g.byBook = byBook;
    const c = consensus(ml); if (c) g.ml = { away: c.a, home: c.b, n: c.n };
    if (sp.length) { const pt = mode(sp.map((x) => x.point)); const s = consensus(sp.filter((x) => x.point === pt).map((x) => x.p));
      if (s) g.spread = { homeSpread: pt, away: s.a, home: s.b, n: s.n }; }
    if (tot.length) { const pt = mode(tot.map((x) => x.point)); const t = consensus(tot.filter((x) => x.point === pt).map((x) => x.p));
      if (t) g.total = { line: pt, over: t.a, under: t.b, n: t.n }; }
    out[`${away} @ ${home}`] = g;
  }
  return out;
}
// Owner's pull times (Pacific, same lists as railway-model-service/scheduler.py WEEKDAY / SUNDAY): Mon-Sat 7 AM, 3 PM, 7 PM; Sunday
// 5 AM, 8 AM, 9:30 AM, 12 PM, 4 PM. Full pulls (moneyline + spreads + totals, 3 credits) at weekday 7 AM and every Sunday pull; the others
// skip the moneyline (spreads + totals, 2 credits) -> about 250 credits a month. A books reading counts as current until the next pull.
// Times are minutes after midnight.
export const BOOK_PULLS = { sun: [5 * 60, 8 * 60, 9 * 60 + 30, 12 * 60, 16 * 60], wk: [7 * 60, 15 * 60, 19 * 60] };
const PT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const ptOf = (d) => { const o = {}; for (const x of PT.formatToParts(d)) o[x.type] = x.value; return { sun: o.weekday === "Sun", min: (Number(o.hour) % 24) * 60 + Number(o.minute) }; };
export function nextBooksPull(t) {   // the first scheduled pull after time t (pulls sit on the hour or half hour)
  const d = new Date(t); if (isNaN(d)) return null; const h = new Date(d); h.setUTCMinutes(h.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  for (let i = 1; i <= 96; i++) { const c = new Date(h.getTime() + i * 30 * 60e3), p = ptOf(c); if ((p.sun ? BOOK_PULLS.sun : BOOK_PULLS.wk).includes(p.min)) return c; }
  return null;
}
// Current = taken before the next scheduled pull has had time to land (45 min grace: the scheduler fires at :00-:05 and can retry).
export function booksFresh(booksT, now = Date.now()) {
  if (!booksT) return false; const nx = nextBooksPull(booksT);
  return !!nx && new Date(now).getTime() < nx.getTime() + 45 * 60e3;
}
export async function fetchBooks(apiKey, lite = false) {
  const r = await fetch(`${URL}?regions=us&markets=${lite ? "spreads,totals" : "h2h,spreads,totals"}&oddsFormat=american&apiKey=${apiKey}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`sportsbook odds returned ${r.status}`);
  return { games: parseBooks(await r.json()), remaining: r.headers.get("x-requests-remaining") };
}
