// Takes a line snapshot: Polymarket lines + TD prices for every game that has NOT kicked off,
// plus sportsbook consensus when books=1. Called by the Railway scheduler (7/12/3/7 PT, Sunday
// 6/7/8/9/10/12/3 PT, and just before each kickoff with kickoff=<game>) and by the Refresh button.
import { SEASON, currentWeek, loadGames, started } from "../../lib/games";
import { getRedis, getJSON, setJSON, K } from "../../lib/redis";
import { fetchEvents, gameLines, tdProps } from "../../lib/poly";
import { fetchBooks } from "../../lib/books";
import { gradeRecent } from "../../lib/grade";
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
      if (poly || snap.books) { await redis.rpush(K.snaps(season, week, g.key), JSON.stringify(snap)); lines += poly ? 1 : 0; }
      const px = await tdProps(events, g.away, g.home).catch(() => null);
      if (px) { await setJSON(K.tdpx(season, week, g.key), px); props++; }
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
    meta.lastSnapshot = t; meta.lastSrc = src; if (books) meta.lastBooks = t;
    await setJSON(K.meta(season, week), meta);
    const graded = await gradeRecent(season).catch(() => 0);
    res.status(200).json({ ok: true, week, upcoming: open.length, locked: games.length - open.length, lines, props, books: booksNote, closedLate, graded });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
