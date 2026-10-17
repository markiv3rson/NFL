// Everything the page shows, computed server-side: Polymarket lines (spread / total / moneyline + alternate lines) -> the model service
// (fair numbers, win chance, every buyable line) -> the card (PICK / PICK w/ POINTS), best bets, parlays. NBA only. Betting venue = Polymarket.
import { fetchEvents, polyGames } from "./poly";
import { loadInjuries, injuriesFor } from "./injuries";
import { modelBase, modelHeaders } from "./model";
import { getRedis, jparse } from "./redis";
import { recordPicks, lockedFor } from "./record";
import { buildCard, cardLegs, isGreen } from "./cardpick";
import { buildParlays, recordParlays } from "./parlays";
import { recordCloses } from "./closes";
import { moveSignal } from "./pinnacle";
import { alertsFromSlate } from "./alerts";
import { pullBooksIfDue, loadBooks } from "./books";
import { TEAMS } from "./teams";
import { finalsFor, otTeams, allFinal } from "./espn";
import { etDate } from "./poly";
import { ESPN_STATUS, logError } from "./status";

export const BEST_BETS = 10, PARLAY_LEGS = 4, PICK_AT = 56;
const GAME_HOURS = 3.5;           // a game counts as "today's slate" until about this long after tip-off

async function callModel(payload, fetcher = fetch) {
  const base = modelBase(); if (!base) throw new Error("MODEL_SERVICE_URL not set");
  const r = await fetcher(`${base}/slate`, { method: "POST", headers: modelHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(30000) });   // the snapshot has 60 s in all; closing lines are saved before this call
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || `model service ${r.status}`);
  return j;
}

export const polyPrice = (g, market, p) => {
  const px = g.poly || {};
  if (market === "spread" && px.spread && p.team) return p.team === g.home ? px.spread.home : px.spread.away;
  if (market === "total" && px.total) return p.side === "under" ? px.total.under : px.total.over;
  if (market === "ml" && px.ml && p.team) return px.ml[p.team === g.home ? "home" : "away"];
  return null;
};

export async function lineMoves(games, now = Date.now()) {
  const r = getRedis(); const out = {};
  for (const g of games) {
    if (!g.poly) continue;
    const key = `open:${g.date}:${g.key}`;
    const now_ = { hs: g.poly.spread ? g.poly.spread.homeSpread : null, tl: g.poly.total ? g.poly.total.line : null };
    let open = jparse(await r.get(key).catch(() => null));
    if (!open) { open = { ...now_, t: new Date(now).toISOString() }; await r.set(key, JSON.stringify(open), "EX", 4 * 86400).catch(() => {}); }
    else { let ch = false; for (const f of ["hs", "tl"]) if (open[f] == null && now_[f] != null) { open[f] = now_[f]; ch = true; }   // a market posted later gets its first line now
      if (ch) await r.set(key, JSON.stringify(open), "KEEPTTL").catch(() => {}); }
    const mv = {};
    if (open.hs != null && now_.hs != null && open.hs !== now_.hs) mv.spread = { open: open.hs, now: now_.hs };
    if (open.tl != null && now_.tl != null && open.tl !== now_.tl) mv.total = { open: open.tl, now: now_.tl };
    const sig = await moveSignal(g.date, g.key, now).catch(() => null);   // Pinnacle's own opening number vs its latest (3+ points = LINE MOVE)
    if (sig) mv.signal = sig;
    if (Object.keys(mv).length) out[g.key] = mv;
  }
  return out;
}

// Straight picks that count for Best bets / the Parlay: the card's PICK at Polymarket's own line and the moneyline PICK, green = 56%+ (win rate decides).
export function collectPicks(games) {
  const rows = [];
  for (const g of games) {
    if (g.inProgress || g.preseason) continue;
    for (const x of cardLegs(g)) rows.push({ game: g.key, away: g.away, home: g.home, start: g.start, market: x.market, label: x.label, pct: x.pct, team: x.team || null, side: x.side || null, line: x.line, price: x.price ?? null, ruleId: x.ruleId || null, games: x.n || null });
    const p = g.ml && g.ml.pick; if (p && (p.tier === "pick" || p.tier === "lean") && p.team) rows.push({ game: g.key, away: g.away, home: g.home, start: g.start, market: "ml", label: p.label, pct: p.pct, team: p.team, side: null, line: null, price: polyPrice(g, "ml", p), ruleId: "ml", games: null });
  }
  return rows.filter((x) => isGreen(x.pct)).sort((a, b) => b.pct - a.pct || (b.games || 0) - (a.games || 0));
}
export const bestBets = (picks) => picks.slice(0, BEST_BETS);
export function collectTests(games) {            // preseason TEST picks: listed for the record check only
  const rows = [];
  for (const g of games) { if (!g.preseason || g.inProgress) continue;
    const p = g.ml && g.ml.pick; if (p && p.tier === "test") rows.push({ game: g.key, away: g.away, home: g.home, start: g.start, market: "ml", label: p.label, pct: p.pct, testTier: p.testTier || null, source: p.source || null });
    for (const x of ["spread", "total"]) { const c = g.card && g.card[x] && g.card[x].plain; if (c) rows.push({ game: g.key, away: g.away, home: g.home, start: g.start, market: x, label: c.pick, pct: c.hit, testTier: isGreen(c.hit) ? "pick" : "lean", source: c.ruleId }); } }
  return rows.sort((a, b) => b.pct - a.pct);
}
export function parlay(picks) {          // top picks, one per game
  const seen = new Set(), out = [];
  for (const p of picks) { if (seen.has(p.game)) continue; seen.add(p.game); out.push(p); if (out.length >= PARLAY_LEGS) break; }
  return out;
}

// the day before a slate date (dates are US Eastern game days)
export const dayBefore = (d) => new Date(Date.parse(d + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
// FATIGUE (10/16, tested 2008-26): a team on a back-to-back after OVERTIME, or an away team on a back-to-back after flying 1,500+ km.
// Overtime yesterday comes from ESPN's scoreboard (period 5+). Saved for 12 h only once every game that day is final (a day still being
// played is asked again next snapshot); today's date is never looked up (its games are not over). A failed ESPN call is noted for the
// watchdog and gives no overtime. A plain back-to-back is not fatigue (the market prices it, 50.9%).
export const FAR_KM = 1500, OT_TIMEOUT_MS = 6000;
export async function otSetFor(date, otSets, now = Date.now(), fetchFinals = finalsFor) {
  if (otSets && otSets[date]) return new Set(otSets[date]);
  if (date >= etDate(new Date(now).toISOString())) return new Set();
  const r = getRedis(), k = `otset:${date}`, saved = jparse(await r.get(k).catch(() => null));
  if (saved) return new Set(saved);
  try {
    const finals = await fetchFinals(date, { timeoutMs: OT_TIMEOUT_MS }), set = otTeams(finals);
    if (allFinal(finals)) await r.set(k, JSON.stringify([...set]), "EX", 12 * 3600).catch(() => {});
    await r.set(ESPN_STATUS, JSON.stringify({ ok: true, t: new Date(now).toISOString(), date }), "EX", 7 * 86400).catch(() => {});
    return set;
  } catch (e) {
    await r.set(ESPN_STATUS, JSON.stringify({ ok: false, t: new Date(now).toISOString(), date, msg: String((e && e.message) || e).slice(0, 80) }), "EX", 7 * 86400).catch(() => {});
    return new Set();
  }
}
// The record window (owner 10/16): picks, parlays and alerts are saved only from the day before tip-off (the game's Eastern date is today or
// tomorrow). Every win rate on the card was measured at closing lines; a line days out is thin and can sit points from the close. The slate still
// shows games further out; closing lines (3 minutes before tip) and Pinnacle's openers are saved whenever seen.
export const dayAfter = (d) => new Date(Date.parse(d + "T12:00:00Z") + 86400e3).toISOString().slice(0, 10);
export function recordWindow(now = Date.now()) { const today = etDate(new Date(now).toISOString()); return new Set([today, dayAfter(today)]); }
export function fatigueOf(ctx, team, otSet) {
  if (!ctx || ctx.rest !== 1) return null;
  const ot = !!(otSet && otSet.has(team)), far = Number(ctx.trav_km) >= FAR_KM;
  return ot || far ? { ot, far } : null;
}
export async function buildSlate({ now = Date.now(), days = 1, events = null, injuries = null, model = null, record = true, pullBooks = false, booksFetch = fetch, forceBooks = false, otSets = null } = {}) {
  const ev = events || (await fetchEvents());
  let games = polyGames(ev).filter((g) => Date.parse(g.start) + GAME_HOURS * 3600e3 > now).sort((a, b) => a.start.localeCompare(b.start));
  const dates = [...new Set(games.map((g) => g.date))].slice(0, days + 1);
  games = games.filter((g) => dates.includes(g.date));
  if (record) await recordCloses(games, now).catch((e) => logError("closes", e));   // closing lines first: they need neither the model nor the injuries
  const inj = injuries || (await loadInjuries().catch(() => ({ teams: {}, dates: {}, t: null })));
  const payload = { games: games.filter((g) => g.poly).map((g) => {
    const px = g.poly;
    return { away: g.away, home: g.home, date: g.date,
      home_spread: px.spread ? px.spread.homeSpread : null, total: px.total ? px.total.line : null,
      ml: px.ml ? { home: px.ml.midHome, away: px.ml.midAway } : null,
      alts: px.alts || [], total_alts: px.totalAlts || [],
      spread_prices: px.spread ? { home: px.spread.home, away: px.spread.away } : null, total_prices: px.total ? { over: px.total.over, under: px.total.under } : null,
      injuries: { home: injuriesFor(inj, g.date, g.home), away: injuriesFor(inj, g.date, g.away) } };
  }) };
  let svc = null, modelError = null;
  if (payload.games.length) { try { svc = model ? model : await callModel(payload); } catch (e) { modelError = String(e.message || e); } }
  const byKey = {}; for (const m of (svc && svc.games) || []) byKey[m.key] = m;
  // preseason: the service says so per game; when it is down, the season start it reported last time decides (so no credits are spent and no shadow rows saved on preseason games)
  const rr = getRedis(); let seasonStart = svc && svc.seasonStart ? String(svc.seasonStart) : null;
  if (seasonStart) await rr.set("season:start", seasonStart).catch(() => {}); else seasonStart = (await rr.get("season:start").catch(() => null)) || null;
  const preOf = (g) => { const m = byKey[g.key]; return m && m.preseason != null ? !!m.preseason : !!(seasonStart && g.date < seasonStart); };
  // Sportsbook lines: pulled only by the scheduled snapshot, only when a pull is due (see lib/books.js); the page just reads the last pull.
  // Preseason games are left out of that decision: the Odds API doesn't list them, so a pull would only spend credits.
  let booksPull = null;
  if (pullBooks) booksPull = await pullBooksIfDue(games.filter((g) => !preOf(g)), { now, fetcher: booksFetch, force: forceBooks }).catch((e) => ({ pulled: false, note: String(e.message || e).slice(0, 160) }));
  const bk = await loadBooks().catch(() => null);
  const moves = await lineMoves(games, now).catch(() => ({}));
  const locked = {}, otByDate = {};
  for (const g of games) if (now >= Date.parse(g.start)) locked[g.key] = await lockedFor(g.date, g.key).catch(() => null);
  if (svc) for (const d of dates) otByDate[d] = await otSetFor(dayBefore(d), otSets, now);
  const out = games.map((g) => {
    const m = byKey[g.key] || {};
    const row = { key: g.key, away: g.away, home: g.home, start: g.start, date: g.date, poly: g.poly,
      model: m.model || null, spread: m.spread || null, total: m.total || null, ml: m.ml || null, context: m.context || null,
      injuries: m.injuries || { home: [], away: [] }, starOut: m.starOut || null, lines: m.lines || [], preseason: preOf(g), move: moves[g.key] || null, books: (bk && bk.games && bk.games[g.key]) || null };
    // A game already under way: Polymarket's lines are live, but the patterns and win rates were tested on closing lines only,
    // so no PICK / LEAN / teaser is offered on it (picks seen before tip-off were already saved for the record).
    row.inProgress = now >= Date.parse(g.start);
    if (row.inProgress) for (const k of ["spread", "total", "ml"]) if (row[k] && row[k].pick) row[k] = { ...row[k], pick: { ...row[k].pick, tier: "none" } };
    if (m.context) { const o = otByDate[g.date]; const fh = fatigueOf(m.context.home, g.home, o), fa = fatigueOf(m.context.away, g.away, o); if (fh || fa) row.fatigue = { home: fh, away: fa }; }
    row.card = m.model ? buildCard(row) : null;          // PICK / PICK w/ POINTS / every buyable line (lib/cardpick.js)
    if (row.inProgress) row.locked = locked[g.key] || null;   // the picks saved before tip-off, with W / L once graded
    return row;
  });
  const picks = collectPicks(out), best = bestBets(picks);
  // parlays are built per day (the slate carries today and the next day with games): the 4 favorites and the Parlay of a day use that day's games only
  const parlays = dates.flatMap((d) => buildParlays(out.filter((g) => g.date === d), best.filter((p) => out.some((g) => g.key === p.game && g.date === d))).map((p) => ({ ...p, date: d })));
  const win = recordWindow(now), soon = out.filter((g) => win.has(g.date));          // today's and tomorrow's games only
  if (record && svc) await alertsFromSlate(soon, now).catch((e) => logError("alerts", e));
  if (record && svc) await recordPicks(soon.filter((g) => !g.inProgress).map((g) => ({ ...g, priceFor: (mk, p) => polyPrice(g, mk, p) })), now).catch((e) => logError("record", e));
  if (record && svc) for (const d of dates.filter((x) => win.has(x))) await recordParlays(d, parlays.filter((p) => p.date === d), out, now).catch((e) => logError("parlays", e));
  return { ok: true, now: new Date(now).toISOString(), dates, teams: TEAMS, games: out, bestBets: best, parlay: parlay(picks), parlays, tests: collectTests(out),
    books: bk ? { t: bk.t, remaining: bk.remaining } : null, booksPull,
    modelOk: payload.games.length ? !!svc : null, modelError, seasonStart, modelBuiltAt: svc ? svc.builtAt : null, fitThrough: svc ? svc.fitThrough : null, patternsBuilt: svc ? svc.patternsBuilt : null,
    injuriesUpdated: inj.t || null, injuriesSource: inj.source || null, injuriesStale: !!inj.stale, injuriesMissing: !inj.t };
}
