// Takes a line snapshot: Polymarket lines + TD prices for every game that has NOT kicked off,
// plus sportsbook consensus when books=1. Called by the Railway scheduler (7/12/3/7 PT, Sunday
// 6/7/8/9/10/12/3 PT, and just before each kickoff with kickoff=<game>) and by the Refresh button.
import { SEASON, currentWeek, loadGames, started } from "../../lib/games";
import { getRedis, getJSON, setJSON, K } from "../../lib/redis";
import { fetchEvents, gameLines, tdProps } from "../../lib/poly";
import { fetchBooks } from "../../lib/books";
import { gradeRecent } from "../../lib/grade";
import { syncAccount } from "../../lib/mybets";
import { logError } from "../../lib/status";
export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  try {
    const src = req.query.src || "manual";
    const season = SEASON, week = Number(req.query.week) || (await currentWeek(season));
    const games = await loadGames(season, week);
    const redis = getRedis(), t = new Date().toISOString();
    let books = null, booksNote = null;
    if (req.query.books === "1") {
      if (!process.env.ODDS_API_KEY) booksNote = "ODDS_API_KEY not set";
      else {
        try { const b = await fetchBooks(process.env.ODDS_API_KEY); books = b.games; await setJSON(K.books(season, week), { t, games: books, remaining: b.remaining }); booksNote = `credits left ${b.remaining}`; }
        catch (e) { booksNote = String(e); }
      }
    }
    const open = games.filter((g) => !started(g));
    const events = open.length ? await fetchEvents() : [];
    let lines = 0, props = 0;
    await Promise.all(open.map(async (g) => {
      const poly = await gameLines(events, g.away, g.home).catch(() => null);
      const snap = { t, src, poly: poly || null, books: books ? books[g.key] || null : undefined };
      // Bad-data guard: a line jumping this far between snapshots is almost always a feed glitch, not a real move
      const prevRaw = await redis.lindex(K.snaps(season, week, g.key), -1), prev = prevRaw ? JSON.parse(prevRaw).poly : null;
      if (prev && poly) {
        const why = [];
        if (prev.spread && poly.spread && Math.abs(prev.spread.homeSpread - poly.spread.homeSpread) >= 3) why.push(`spread jumped ${prev.spread.homeSpread} → ${poly.spread.homeSpread}`);
        if (prev.total && poly.total && Math.abs(prev.total.line - poly.total.line) >= 4) why.push(`total jumped ${prev.total.line} → ${poly.total.line}`);
        if (prev.ml && poly.ml && Math.abs(prev.ml.home - poly.ml.home) >= 0.25) why.push("moneyline jumped 25+ cents");
        if (why.length) snap.suspect = `Data check failed: ${why.join(", ")}. Bet held until next refresh.`;
      }
      if (poly || snap.books) { await redis.rpush(K.snaps(season, week, g.key), JSON.stringify(snap)); await redis.ltrim(K.snaps(season, week, g.key), -200, -1); lines += poly ? 1 : 0; }
      const px = await tdProps(events, g.away, g.home).catch(() => null);
      if (px) {
        // TD guard: if 3+ players' prices halve at once, keep the old prices (feed glitch like the 2+ market mix-up)
        const old = await getJSON(K.tdpx(season, week, g.key));
        const ask = (v) => (v == null ? null : typeof v === "number" ? v : v.ask);
        const drops = old ? Object.keys(px).filter((q) => ask(old[q]) && ask(px[q]) < ask(old[q]) * 0.5).length : 0;
        if (drops >= 3) await logError("snapshot", `${g.key}: ${drops} TD prices halved at once — kept previous prices`);
        else { await setJSON(K.tdpx(season, week, g.key), px); props++; }
      }
      if (String(req.query.kickoff || "").split(",").includes(g.key)) {
        const bk = books ? books[g.key] : ((await getJSON(K.books(season, week))) || { games: {} }).games[g.key];
        await setJSON(K.close(season, week, g.key), { t, poly: poly || null, books: bk || null });
      }
    }));
    // Safety net: any started game without a closing line gets its last pre-kickoff snapshot.
    let closedLate = 0;
    for (const g of games.filter((g) => started(g))) {
      if (await redis.exists(K.close(season, week, g.key))) continue;
      const raw = await redis.lrange(K.snaps(season, week, g.key), 0, -1);
      const pre = raw.map((x) => JSON.parse(x)).filter((s) => new Date(s.t) < new Date(g.kickoff)).pop();
      if (pre) { const bk = ((await getJSON(K.books(season, week))) || { games: {} }).games[g.key];
        await setJSON(K.close(season, week, g.key), { t: pre.t, poly: pre.poly, books: pre.books || bk || null }); closedLate++; }
    }
    const meta = (await getJSON(K.meta(season, week))) || {};
    meta.lastSnapshot = t; meta.lastSrc = src; if (books) { meta.lastBooks = t; meta.credits = (await getJSON(K.books(season, week)) || {}).remaining; }
    await setJSON(K.meta(season, week), meta);
    const graded = await gradeRecent(season).catch(() => 0);
    const acct = await syncAccount().catch((e) => ({ ok: false, note: String(e) }));  // auto-sync My Bets
    res.status(200).json({ ok: true, week, upcoming: open.length, locked: games.length - open.length, lines, props, books: booksNote, closedLate, graded, account: acct.ok ? `synced ${acct.positions} positions` : acct.note });
  } catch (err) { await logError("snapshot", err).catch(() => {}); res.status(500).json({ ok: false, error: String(err) }); }
}
