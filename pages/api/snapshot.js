// Takes a line snapshot: Polymarket lines + TD prices for every game that has NOT kicked off,
// plus sportsbook consensus when books=1. Called by the Railway scheduler (7/12/3/7 PT, Sunday
// 6/7/8/9/10/12/3 PT, and just before each kickoff with kickoff=<game>) and by the Refresh button.
import { SEASON, currentWeek, loadGames, started } from "../../lib/games";
import { getRedis, getJSON, setJSON, K, SLATE_CACHE } from "../../lib/redis";
import { fetchEvents, gameLines, tdProps } from "../../lib/poly";
import { fetchBooks } from "../../lib/books";
import { gradeRecent } from "../../lib/grade";
import { syncAccount } from "../../lib/mybets";
import { logError } from "../../lib/status";
import { loadModel } from "../../lib/week";
import { isThinMarket } from "../../lib/odds";
import { nameMatches } from "../../lib/picks";
import { logEdges } from "../../lib/edges";
import { recordPaper } from "../../lib/paper";
import { buildWeek } from "../../lib/week";
import { loadInjuriesMeta } from "../../lib/injuries";
export const config = { maxDuration: 120 };

// Automatic pre-log (protocol 3.3): model vs Polymarket frozen at kickoff for every game. Used by the kickoff snapshot
// AND the late-closing safety net below (added 9/29), so a missed kickoff (e.g. the scheduler down) still gets one.
async function writePrelog(season, week, g, t, poly, bk, model) {
  const mdl = model || (await loadModel(season, week).catch(() => null)) || { games: {}, td: {} };
  const mg = mdl.games[g.key] || null, mt = mdl.td[g.key] || {}, tdp = (await getJSON(K.tdpx(season, week, g.key))) || {};
  const topTd = [...(mt.away || []).map((p) => ({ ...p, team: g.away })), ...(mt.home || []).map((p) => ({ ...p, team: g.home }))]
    .sort((a, b) => b.fair - a.fair).slice(0, 8).map((p) => { const q = Object.keys(tdp).find((k) => nameMatches(p.name, k) && /(^|\D)1\+|anytime/i.test(k)); const v = q ? (typeof tdp[q] === "number" ? { ask: tdp[q] } : tdp[q]) : null;
      return { player: p.name, team: p.team, fair: p.fair, ask: v ? v.ask : null, bid: v ? v.bid ?? null : null }; });
  await setJSON(`prelog:${season}:${week}:${g.key}`, { t, game: g.key, poly, books: bk,
    model: mg ? { homeMargin: mg.homeMargin, total: mg.total, homeWinPct: mg.homeWinPct, calHomeCover: mg.calHomeCover, calUnder: mg.calUnder, mktHomeSpread: mg.mktHomeSpread, mktTotal: mg.mktTotal, runAt: mdl.runAt || null } : null, topTd });
}

export default async function handler(req, res) {
  try {
    const src = req.query.src || "manual";
    const season = SEASON, week = Number(req.query.week) || (await currentWeek(season));
    const games = await loadGames(season, week);
    const redis = getRedis(), t = new Date().toISOString();
    let books = null, booksNote = null;
    // Manual "Lines + injuries" refresh pulls sportsbooks too when this week has none or they're 6+ hours old
    // (before, only the scheduler's 2-a-day pulls ever fetched them, so a missed pull left "Books —" for hours).
    if (req.query.books !== "1" && src === "manual") { const bk = await getJSON(K.books(season, week)); if (!bk || Date.now() - new Date(bk.t) > 6 * 3600e3) req.query.books = "1"; }
    if (req.query.books === "1") {
      if (!process.env.ODDS_API_KEY) { booksNote = "ODDS_API_KEY not set"; await logError("books", "ODDS_API_KEY not set in Vercel"); }
      else {
        try { const b = await fetchBooks(process.env.ODDS_API_KEY); books = b.games; await setJSON(K.books(season, week), { t, games: books, remaining: b.remaining }); booksNote = `credits left ${b.remaining}`; }
        catch (e) { booksNote = String(e); await logError("books", `Sportsbook pull failed: ${String(e).slice(0, 160)}`); }   // was silent: only the scheduler's log saw it
      }
    }
    const open = games.filter((g) => !started(g));
    const booksNow = books ? { t, games: books } : await getJSON(K.books(season, week));   // for the edge tracker (age-checked there)
    let edges = 0;
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
      if (poly && !snap.suspect && booksNow && booksNow.games) { const n =   // not when this snapshot failed the data check (9/30)
         await logEdges(season, week, g, poly, booksNow.games[g.key], booksNow.t, t).catch(() => 0); edges += n; }   // add AFTER the await: "edges += await" lost updates across parallel games
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
        if (accept) { await setJSON(K.tdpx(season, week, g.key), px); props++;
          // TD price HISTORY (added 9/29): before, each snapshot overwrote the last, so only the latest/closing TD prices
          // existed. Compact rows {t, p: {market: [ask, bid]}}, last 150 snapshots per game (a week uses ~35).
          const compact = {}; for (const [q, v] of Object.entries(px)) { const o = typeof v === "number" ? { ask: v } : v; if (o && o.ask > 0) compact[q] = [o.ask, o.bid ?? null]; }
          await redis.rpush(`tdpxhist:${season}:${week}:${g.key}`, JSON.stringify({ t, src, p: compact })); await redis.ltrim(`tdpxhist:${season}:${week}:${g.key}`, -150, -1); }
      }
      if (String(req.query.kickoff || "").split(",").includes(g.key)) {
        const bk = books ? books[g.key] : ((await getJSON(K.books(season, week))) || { games: {} }).games[g.key];
        await setJSON(K.close(season, week, g.key), { t, poly: poly || null, books: bk || null });
        await writePrelog(season, week, g, t, poly || null, bk || null, model);
      }
    }));
    // Safety net: any started game without a closing line gets its last pre-kickoff snapshot.
    let closedLate = 0;
    for (const g of games.filter((g) => started(g))) {
      if (await redis.exists(K.close(season, week, g.key))) continue;
      const raw = await redis.lrange(K.snaps(season, week, g.key), 0, -1);
      const pre = raw.map((x) => JSON.parse(x)).filter((s) => new Date(s.t) < new Date(g.kickoff)).pop();
      if (pre) { const bk = ((await getJSON(K.books(season, week))) || { games: {} }).games[g.key];
        await setJSON(K.close(season, week, g.key), { t: pre.t, poly: pre.poly, books: pre.books || bk || null }); closedLate++;
        if (!(await redis.exists(`prelog:${season}:${week}:${g.key}`))) await writePrelog(season, week, g, pre.t, pre.poly, pre.books || bk || null, null); }
    }
    const meta = (await getJSON(K.meta(season, week))) || {};
    meta.lastSnapshot = t; meta.lastSrc = src; if (books) { meta.lastBooks = t; meta.credits = (await getJSON(K.books(season, week)) || {}).remaining; }
    await setJSON(K.meta(season, week), meta);
    if (src !== "manual") await setJSON("auto:last", { t, what: `snapshot (${src})` });   // "Last automatic run" + Watchdog
    await redis.del(SLATE_CACHE).catch(() => {});   // the page shows the new prices immediately
    // Your Refresh button (src=manual) skips grading and the account sync (the scheduler does both several times a day,
    // and the Record tab has its own Sync button) so the button comes back fast.
    // Parlay Lab: record this week's PAPER parlays once, on the scheduled snapshot within ~26 h of the first Sunday kickoff
    let paper = 0;
    if (src !== "manual" && !(await redis.exists(`paper:${season}:${week}`))) {
      const sun = games.filter((g) => g.kickoff && new Date(g.kickoff).getUTCDay() === 0 && !started(g)).map((g) => new Date(g.kickoff).getTime());
      const hrs = sun.length ? (Math.min(...sun) - Date.now()) / 3600e3 : -1;
      if (hrs >= 0 && hrs <= 26) {
        const inj = await loadInjuriesMeta().catch(() => null);
        paper = await recordPaper(season, week, await buildWeek({ season, week, injuries: inj ? inj.teams : null })).catch((e) => { logError("paper", e); return 0; });
      }
    }
    const graded = src === "manual" ? 0 : await gradeRecent(season).catch(() => 0);
    const acct = src === "manual" ? { ok: false, note: "skipped on manual refresh" } : await syncAccount().catch((e) => ({ ok: false, note: String(e) }));  // auto-sync My Bets
    res.status(200).json({ ok: true, week, upcoming: open.length, locked: games.length - open.length, lines, props, books: booksNote, closedLate, graded, edges, paper, account: acct.ok ? `synced ${acct.positions} positions` : acct.note });
  } catch (err) { await logError("snapshot", err).catch(() => {}); res.status(500).json({ ok: false, error: String(err) }); }
}
