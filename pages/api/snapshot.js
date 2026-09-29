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
import { loadModel } from "../../lib/week";
import { isThinMarket } from "../../lib/odds";
import { nameMatches } from "../../lib/picks";
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
    const model = open.length ? await loadModel(season, week).catch(() => null) : null;
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
        // TD guard. A feed glitch (e.g. the 2+ market read as anytime) halves prices for BOTH teams at once; real news
        // (a QB ruled out) moves ONE team. Only real markets count: a thin market's ask (see isThinMarket) jumps around
        // with no trading, so it can't signal anything. Rules:
        //  - fewer than 3 real-market halvings → accept
        //  - all halvings on one team → accept (news), and log it
        //  - both teams → reject and log the actual prices; if the SAME rejection repeats 3 snapshots in a row, accept
        //    (a price that holds for three checks is the market, not a glitch). Before 9/28 a rejection was permanent.
        const old = await getJSON(K.tdpx(season, week, g.key));
        const rec = (v) => (v == null ? null : typeof v === "number" ? { ask: v } : v);
        const real = (v) => v && !isThinMarket(v.ask, v.bid ?? null);
        const drops = old ? Object.keys(px).filter((q) => { const o = rec(old[q]), n = rec(px[q]); return real(o) && real(n) && n.ask < o.ask * 0.5; }) : [];
        let accept = true, msg = null;
        if (drops.length >= 3) {
          const tdModel = (model && model.td && model.td[g.key]) || {};
          const teamOf = (q) => { for (const side of ["away", "home"]) if ((tdModel[side] || []).some((m) => nameMatches(m.name, q))) return side === "away" ? g.away : g.home; return "?"; };
          const teams = [...new Set(drops.map(teamOf))];
          const detail = drops.slice(0, 4).map((q) => `${q.replace(/\s*1\+.*$/i, "")} ${Math.round(rec(old[q]).ask * 100)}¢→${Math.round(rec(px[q]).ask * 100)}¢`).join(", ");
          if (teams.length === 1 && teams[0] !== "?") msg = `${g.key}: ${drops.length} ${teams[0]} TD prices halved (one team — treated as real news, accepted): ${detail}`;
          else {
            const rk = `tdrej:${season}:${week}:${g.key}`, sig = drops.slice().sort().join("|");
            const prevRej = await getJSON(rk), n = prevRej && prevRej.sig === sig ? prevRej.n + 1 : 1;
            if (n >= 3) { await redis.del(rk); msg = `${g.key}: same ${drops.length} TD price drops held for 3 checks — accepted as real: ${detail}`; }
            else { accept = false; await setJSON(rk, { sig, n }); msg = `${g.key}: ${drops.length} TD prices halved on both teams (check ${n} of 3) — kept previous prices: ${detail}`; }
          }
        } else await redis.del(`tdrej:${season}:${week}:${g.key}`);
        if (msg) await logError("snapshot", msg);
        if (accept) { await setJSON(K.tdpx(season, week, g.key), px); props++; }
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
