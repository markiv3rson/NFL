// Sportsbook consensus (The Odds API), NBA only. Shown next to Polymarket on each game; the model and the picks do not use it.
// One pull = moneyline + spread + total, US books = 3 credits. Pulled twice a day, not on every snapshot (the free plan is small
// and shared with the NFL app): 7 AM Pacific on a day with games, and 1 hour before the first tip-off of the night.
import { TEAMS } from "./teams";
import { toProb, toAmerican } from "./odds";
import { getRedis, jparse } from "./redis";
const URL_ = () => (process.env.ODDS_BASE || "https://api.the-odds-api.com") + "/v4/sports/basketball_nba/odds";
export const BOOKS_KEY = "books:latest";
const abbrFromName = (name) => Object.keys(TEAMS).find((k) => TEAMS[k].name === name) || Object.keys(TEAMS).find((k) => (name || "").endsWith(TEAMS[k].nick)) || null;

// Average implied win chance per side across books, then remove the book's margin.
function consensus(pairs) {
  if (!pairs.length) return null;
  const a = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, b = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  return { a: { odds: toAmerican(a / (a + b)) }, b: { odds: toAmerican(b / (a + b)) }, n: pairs.length };
}
function mode(nums) {
  const c = {}; nums.forEach((n) => (c[n] = (c[n] || 0) + 1));
  return Number(Object.entries(c).sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]);
}
export function parseBooks(events) {
  const out = {};
  for (const ev of events || []) {
    const away = abbrFromName(ev.away_team), home = abbrFromName(ev.home_team);
    if (!away || !home) continue;
    const ml = [], sp = [], tot = [];
    for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
      const by = (n) => (m.outcomes || []).find((o) => o.name === n);
      if (m.key === "h2h") { const h = by(ev.home_team), a = by(ev.away_team); if (h && a) ml.push([toProb(a.price), toProb(h.price)]); }
      if (m.key === "spreads") { const h = by(ev.home_team), a = by(ev.away_team); if (h && a && h.point != null) sp.push({ point: h.point, p: [toProb(a.price), toProb(h.price)] }); }
      if (m.key === "totals") { const o = by("Over"), u = by("Under"); if (o && u && o.point != null) tot.push({ point: o.point, p: [toProb(o.price), toProb(u.price)] }); }
    }
    const g = {};
    const c = consensus(ml); if (c) g.ml = { away: c.a.odds, home: c.b.odds, n: c.n };
    if (sp.length) { const pt = mode(sp.map((x) => x.point)), s = consensus(sp.filter((x) => x.point === pt).map((x) => x.p));
      if (s) g.spread = { homeSpread: pt, away: s.a.odds, home: s.b.odds, n: s.n }; }
    if (tot.length) { const pt = mode(tot.map((x) => x.point)), t = consensus(tot.filter((x) => x.point === pt).map((x) => x.p));
      if (t) g.total = { line: pt, over: t.a.odds, under: t.b.odds, n: t.n }; }
    if (Object.keys(g).length) out[`${away} @ ${home}`] = g;
  }
  return out;
}

export async function fetchBooks(apiKey, fetcher = fetch) {
  const q = new URLSearchParams({ apiKey, regions: "us", markets: "h2h,spreads,totals", oddsFormat: "american" });
  const r = await fetcher(`${URL_()}?${q}`, { cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`Odds API answered ${r.status}`);   // the address holds the key, so it is never put in the message
  const events = await r.json();
  if (!Array.isArray(events)) throw new Error("Odds API reply was not a list of games");
  const left = r.headers && r.headers.get ? Number(r.headers.get("x-requests-remaining")) : NaN;
  return { games: parseBooks(events), remaining: Number.isFinite(left) ? left : null };
}

const ptDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
const ptHour = (ms) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false }).format(ms)) % 24;

// Which pull (if any) is due right now. Games = the slate's games (start = ISO time).
//   "am"  : 7 AM Pacific or later, on a day (Pacific) that has a game, once a day.
//   "pre" : from 1 hour before the first tip-off of the night until tip-off, once per night.
export function booksDue(games, now = Date.now()) {
  const open = games.filter((g) => Date.parse(g.start) > now).sort((a, b) => a.start.localeCompare(b.start));
  if (!open.length) return null;
  const night = ptDate(Date.parse(open[0].start));
  const tip = Math.min(...games.filter((g) => ptDate(Date.parse(g.start)) === night).map((g) => Date.parse(g.start)));   // the night's FIRST tip-off, even if it has passed
  if (now >= tip - 3600e3 && now < tip) return { slot: "pre", id: `pre:${night}` };
  if (ptHour(now) >= 7 && now < tip - 3 * 3600e3 && games.some((g) => ptDate(Date.parse(g.start)) === ptDate(now))) return { slot: "am", id: `am:${ptDate(now)}` };   // within 3 h of the first tip the pre-tip pull is the day's pull (a matinee day pays once, not twice)
  return null;
}

// Pull if one is due and not yet done. The slot is claimed first, so two snapshots at once cannot both spend credits;
// a failed pull gives the slot back so the next snapshot retries.
export async function pullBooksIfDue(games, { now = Date.now(), apiKey = process.env.NBA_ODDS_API_KEY   /* merged site: NBA's own Odds API setting, NFL credits are never used */, fetcher = fetch, force = false } = {}) {
  // force = a person asked for a pull right now (signed-in /api/snapshot?books=now): runs outside the two daily slots, costs ~3 credits
  const due = force ? { slot: "manual", id: `manual:${now}` } : booksDue(games, now);
  if (!due) return { pulled: false, note: null };
  if (!apiKey) return { pulled: false, note: "NBA_ODDS_API_KEY not set" };
  const r = getRedis(), flag = `books:pull:${due.id}`;
  const claimed = await r.set(flag, new Date(now).toISOString(), "EX", 36 * 3600, "NX").catch(() => null);
  if (!claimed) return { pulled: false, note: null };
  try {
    const b = await fetchBooks(apiKey, fetcher);
    await r.set(BOOKS_KEY, JSON.stringify({ t: new Date(now).toISOString(), slot: due.slot, games: b.games, remaining: b.remaining }));
    return { pulled: true, slot: due.slot, remaining: b.remaining, games: Object.keys(b.games).length, note: `credits left ${b.remaining}` };
  } catch (e) {
    await r.del(flag).catch(() => {});
    return { pulled: false, note: String(e.message || e).slice(0, 160) };
  }
}
export async function loadBooks() {
  return jparse(await getRedis().get(BOOKS_KEY).catch(() => null));
}
