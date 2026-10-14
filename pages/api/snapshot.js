// Takes a line snapshot: Polymarket lines + TD prices for every game that has NOT kicked off,
// plus sportsbook consensus when books=1. Called by the Railway scheduler (7/12/3/7 PT, Sunday
// 6/7/8/9/10/12/3 PT, and just before each kickoff with kickoff=<game>) and by the Refresh button.
import { tablePicks, recordStack, lineMovePick, lineMoveTotalPick, keyNumberPick, injuryPick, bounceBackPick, floorDogPick } from "../../lib/stack";
import { venue, windAtKickoff } from "../../lib/wind";
import { recordTeaser, recordTotalLeg, teaserLeg, totalMove, tkey, WIND_U_MPH, recordFloor } from "../../lib/teaser";
import { comboFactors } from "../../lib/stack";
import { loadComboModel } from "../../lib/combomodel";
import { recordAltValues } from "../../lib/altfair";
import { alertTeaser, alertsTdNo } from "../../lib/alerts";
import { applyCalibration } from "../../lib/calibration";
import { tdRows } from "../../lib/picks";
import { SEASON, currentWeek, loadGames, started } from "../../lib/games";
import { getRedis, jparse, getJSON, setJSON, K, SLATE_CACHE } from "../../lib/redis";
import { fetchEvents, gameLines, tdProps } from "../../lib/poly";
import { sanePoly } from "../../lib/sane";
import { fetchBooks, booksFresh } from "../../lib/books";
import { savePinnacle, pinnacleFailed, pinnacleOk } from "../../lib/pinnacle";
import { gradeRecent } from "../../lib/grade";
import { syncAccount } from "../../lib/mybets";
import { logError } from "../../lib/status";
import { loadModel } from "../../lib/week";
import { isThinMarket } from "../../lib/odds";
import { nameMatches } from "../../lib/picks";
import { recordPaper, recordWinner, tdTotal, situationFor } from "../../lib/paper";
import { buildWeek } from "../../lib/week";
import { loadInjuriesMeta } from "../../lib/injuries";
import { alertsFromLines } from "../../lib/alerts";
export const config = { maxDuration: 120 };

// Automatic pre-log (protocol 3.3): model vs Polymarket frozen at kickoff for every game. Used by the kickoff snapshot
// AND the late-closing safety net below (added 9/29), so a missed kickoff (e.g. the scheduler down) still gets one.
// LINE MOVE / KEY NUMBER at kickoff (10/14 fix): the kickoff snapshot reuses the last books pull. Same rule as the card: that reading must
// be current (taken before the next scheduled pull is due), else no LINE MOVE; KEY NUMBER then uses the newest Pinnacle line (under 1.5 h).
async function timingAtKickoff(season, week, g, t, poly, bk) {
  const bkT = ((await getJSON(K.books(season, week)).catch(() => null)) || {}).t, hrs = (x) => (new Date(t) - new Date(x)) / 3600e3;
  const fresh = booksFresh(bkT, new Date(t));   // current until the owner's next scheduled pull (10/14)
  const alts = poly && poly.alts ? poly.alts : ((await getJSON(`alts:${season}:${week}:${g.key}`).catch(() => null)) || {}).alts || null;
  let B = fresh ? bk : null;
  if (!fresh) { const raws = (await getRedis().lrange(`pinnacle:${season}:${week}:${g.key}`, -6, -1).catch(() => null)) || [];
    const pr = raws.map(jparse).filter((x) => x && x.hs != null && hrs(x.t) <= 1.5 && hrs(x.t) >= -0.1).pop();
    if (pr) B = { spread: { homeSpread: pr.hs } }; }
  return [...(fresh ? [lineMovePick(g, poly, bk), lineMoveTotalPick(g, poly, bk)] : []), keyNumberPick(g, poly, B, alts)].filter(Boolean);
}
export async function writePrelog(season, week, g, t, poly, bk, model) {
  await loadComboModel().catch(() => null);   // newest weekly rebuild (10/9)
  const mdl = model || (await loadModel(season, week).catch(() => null)) || { games: {}, td: {} };
  const mg = mdl.games[g.key] || null, mt = mdl.td[g.key] || {}, tdp = (await getJSON(K.tdpx(season, week, g.key))) || {};
  const topTd = [...(mt.away || []).map((p) => ({ ...p, team: g.away })), ...(mt.home || []).map((p) => ({ ...p, team: g.home }))]
    .sort((a, b) => b.fair - a.fair).slice(0, 8).map((p) => { const q = Object.keys(tdp).find((k) => nameMatches(p.name, k) && /(^|\D)1\+|anytime/i.test(k)); const v = q ? (typeof tdp[q] === "number" ? { ask: tdp[q] } : tdp[q]) : null;
      return { player: p.name, team: p.team, fair: p.fair, ask: v ? v.ask : null, bid: v ? v.bid ?? null : null }; });
  await setJSON(`prelog:${season}:${week}:${g.key}`, { t, game: g.key, poly, books: bk,
    model: mg ? { homeMargin: mg.homeMargin, total: mg.total, homeWinPct: mg.homeWinPct, calHomeCover: mg.calHomeCover, calUnder: mg.calUnder, mktHomeSpread: mg.mktHomeSpread, mktTotal: mg.mktTotal, runAt: mdl.runAt || null } : null, topTd });
  // Pick Lab paper singles (the old game model's side) CUT 10/13 (owner).
  await recordWinner(season, week, g, poly, t, mg).catch(() => 0);      // Most likely winners: the favorite at kickoff (9/30)
  { const alts = poly && poly.alts ? poly.alts : ((await getJSON(`alts:${season}:${week}:${g.key}`).catch(() => null)) || {}).alts || null;   // late close: the saved latest copy
    await recordTeaser(season, week, g, alts ? { ...(poly || {}), alts } : poly, bk, t).catch(() => 0);
    { const allS = ((await getRedis().lrange(K.snaps(season, week, g.key), 0, -1).catch(() => [])) || []).map(jparse).filter(Boolean);   // review fix: first reading WITH a Polymarket line, like the card
      const first = allS.find((x) => x.poly && x.poly.total) || null, firstS = allS.find((x) => x.poly && x.poly.spread) || null, open = first ? first.poly.total.line : null;
      const now = bk && bk.total && bk.total.line != null ? bk.total.line : poly && poly.total ? poly.total.line : null, mv = totalMove(open, now);
      // Total moved 6 (10/9, model replayed 2014-25): the line's 3+ move first, then wind 15+ Under, else AGAINST the model's side
      const mU = mg && mg.calUnder != null ? mg.calUnder >= 50 : null;
      { const s0 = firstS ? firstS.poly.spread.homeSpread : null, v = venue(g) || {};
        // 10/12: recorded at the SAME line the card shows -- Polymarket first (where the bet is placed), books only as a fallback.
        // Before, books came first, so a recorded pick could sit on a different number than the one shown.
        const hsNow = poly && poly.spread && poly.spread.homeSpread != null ? poly.spread.homeSpread : bk && bk.spread ? bk.spread.homeSpread : null;
        const tlNow = poly && poly.total && poly.total.line != null ? poly.total.line : now;
        try { const sitS = await situationFor(season, week, g).catch(() => null); await recordFloor(season, week, g, hsNow, sitS, t).catch(() => 0); await recordStack(season, week, g, tablePicks({ ...g, outdoor: !!v.outdoor }, mg, hsNow, tlNow, s0, open, sitS, Number(week)).concat(injuryPick(g, hsNow, s0, sitS, Number(week)) || [], bounceBackPick(g, hsNow, sitS) || [], floorDogPick(g, hsNow, sitS) || [], ...(await timingAtKickoff(season, week, g, t, poly, bk))), t); } catch {} }   // combo picks (10/9); a failure here never stops the rest
      await recordTotalLeg(season, week, g, poly, bk, mv ? mv.under : mg && mg.outdoor && mg.wind != null && mg.wind >= 15 ? true : mU == null ? true : !mU, t, open, mU === true).catch(() => 0); }
    await recordAltValues(season, week, g, alts ? { ...(poly || {}), alts } : poly, bk, t).catch(() => 0); }   // alt lines under their historical rate (10/9)   // Teaser leg: underdog +1.5..+2.5 at +7.5..+8.5 (10/6)
}

export default async function handler(req, res) {
  try {
    await loadComboModel().catch(() => null);   // newest weekly rebuild for the combo / early-week picks (10/9)
    const src = req.query.src || "manual";
    const season = SEASON, week = Number(req.query.week) || (await currentWeek(season));
    const games = await loadGames(season, week);
    const redis = getRedis(), t = new Date().toISOString();
    let books = null, booksNote = null;
    // Manual "Lines + injuries" refresh pulls sportsbooks too when this week has none or they're 6+ hours old
    // (before, only the scheduler's 2-a-day pulls ever fetched them, so a missed pull left "Books —" for hours).
    if (req.query.books !== "1" && src === "manual") { const bk = await getJSON(K.books(season, week)); if (!bk || Date.now() - new Date(bk.t) > 6 * 3600e3) req.query.books = "1"; }
    const liteBooks = req.query.books === "2";   // 10/14: scheduler's extra pulls skip the moneyline (2 credits, not 3)
    if (liteBooks) req.query.books = "1";
    if (req.query.books === "1") {
      if (!process.env.ODDS_API_KEY) { booksNote = "ODDS_API_KEY not set"; await logError("books", "ODDS_API_KEY not set in Vercel"); }
      else {
        try { const b = await fetchBooks(process.env.ODDS_API_KEY, liteBooks); books = b.games;
          if (liteBooks) { const prev = ((await getJSON(K.books(season, week)).catch(() => null)) || {}).games || {};   // keep the last moneyline
            for (const k of Object.keys(books)) if (!books[k].ml && prev[k] && prev[k].ml) books[k].ml = prev[k].ml; }
          await setJSON(K.books(season, week), { t, games: books, remaining: b.remaining }); booksNote = `credits left ${b.remaining}`; }
        catch (e) { booksNote = String(e); await logError("books", `Sportsbook pull failed: ${String(e).slice(0, 160)}`); }   // was silent: only the scheduler's log saw it
      }
    }
    const open = games.filter((g) => !started(g));
    const booksNow = books ? { t, games: books } : await getJSON(K.books(season, week));   // for the edge tracker (age-checked there)
    let edges = 0;
    const events = open.length ? await fetchEvents() : [];
    // Action Network pull CUT 10/13 (owner): its free splits were always empty and it matched 0 games; lib/splits.js and /api/splitshist stay for reference.
    const splitsNote = null;
    // Pinnacle main spread / total, 10/13: recorded the same way (Redis pinnacle:<season>:<week>:<game>, last 60) on every snapshot, for
    // EVERY not-started game Pinnacle lists -- next week's too, under that game's own week, so its early lines are kept (owner: "do it
    // now"). Not shown or used for picks until tested on unseen games. A failed pull is logged and never stops the snapshot.
    let pinNote = null;
    try {
      const n = await savePinnacle(redis, season, t, src); await pinnacleOk(redis);
      pinNote = `${n} games`;
    } catch (e) { pinNote = String(e).slice(0, 120); await pinnacleFailed(redis, pinNote, logError); }
    const model = open.length ? await loadModel(season, week).catch(() => null) : null;
    let lines = 0, props = 0;
    await Promise.all(open.map(async (g) => {
      let poly = await gameLines(events, g.away, g.home).catch(() => null);
      { const sp = sanePoly(poly, g.nvSpread, g.nvTotal); poly = sp.poly;   // an alternate line read as the game line (10/4: "MIN +19.5") never gets saved
        if (sp.dropped.length) await logError("snapshot", `${g.key}: dropped implausible Polymarket line (${sp.dropped.join("; ")})`).catch(() => {}); }
      // Alternate spreads (teaser legs, 10/6) are kept as ONE latest copy per game, not inside every snapshot (200 kept per game: it would
      // add MBs a week to the database and to every page load).
      const alts = poly && poly.alts ? poly.alts : null; if (alts) { poly = { ...poly }; delete poly.alts; await setJSON(`alts:${season}:${week}:${g.key}`, { t, alts }); }
      if (alts) await alertTeaser(season, g, teaserLeg(g, { ...poly, alts }, books ? books[g.key] || null : ((await getJSON(K.books(season, week)).catch(() => null)) || { games: {} }).games[g.key])).catch(() => 0);   // teaser leg priced right (10/7)
      const snap = { t, src, poly: poly || null, books: books ? books[g.key] || null : undefined };
      // Bad-data guard: a line jumping this far between snapshots is almost always a feed glitch, not a real move
      const prevRaw = await redis.lindex(K.snaps(season, week, g.key), -1), prev = prevRaw ? (jparse(prevRaw) || {}).poly || null : null;
      if (prev && poly) {
        const why = [];
        if (prev.spread && poly.spread && Math.abs(prev.spread.homeSpread - poly.spread.homeSpread) >= 3) why.push(`spread jumped ${prev.spread.homeSpread} → ${poly.spread.homeSpread}`);
        if (prev.total && poly.total && Math.abs(prev.total.line - poly.total.line) >= 4) why.push(`total jumped ${prev.total.line} → ${poly.total.line}`);
        if (prev.ml && poly.ml && Math.abs(prev.ml.home - poly.ml.home) >= 0.25) why.push("moneyline jumped 25+ cents");
        if (why.length) snap.suspect = `Data check failed: ${why.join(", ")}. Bet held until next refresh.`;
      }
      // Edge tracker (Polymarket vs sportsbook price gaps) CUT 10/13 (owner).
      if (prev && poly && !snap.suspect) await alertsFromLines(season, g, prev, poly).catch(() => 0);   // line-move alerts (10/1)
      if (poly || snap.books) { await redis.rpush(K.snaps(season, week, g.key), JSON.stringify(snap)); await redis.ltrim(K.snaps(season, week, g.key), -200, -1); lines += poly ? 1 : 0; }
      // Early-week total recording CUT 10/13 (owner): it went 11-18 live and is off on cards. Old saved rows still grade.
      // Early-week wind Under (10/13, owner: "build both"): saved ONCE, the first time the kickoff forecast says wind 10+ at an outdoor
      // stadium while Polymarket's total is still at its first number this week; graded at that number. Paper only (history at the
      // opening total 60.5% 2014-26, but 2024 51% / 2025 52%, so it gets a live test first).
      if (poly && poly.total && !snap.suspect && !(await redis.hexists(tkey(season, week), `${g.key}|windU`).catch(() => 1))) try {
        // review fix 10/14: opening total = first snapshot WITH a Polymarket total (index 0 is often a books-only snapshot -> never fired)
        const f0 = ((await redis.lrange(K.snaps(season, week, g.key), 0, -1)) || []).map(jparse).find((x) => x && x.poly && x.poly.total) || null, to = f0 ? f0.poly.total.line : null;
        if (to != null && Math.abs(poly.total.line - to) < 0.5) { const wk = await windAtKickoff(g);
          if (wk.outdoor && wk.wind != null && wk.wind >= WIND_U_MPH) await redis.hsetnx(tkey(season, week), `${g.key}|windU`,
            JSON.stringify({ game: g.key, kind: "total", windU: true, side: "under", base: to, line: to, wind: wk.wind, week, t })); }
      } catch {}
      // Recording for future tests (10/13, not shown): kickoff-hour forecast and Out/Doubtful starter counts, each saved with its time
      // (forecast every snapshot, injuries only when they change). Later tests can ask "who knew first, the forecast/news or the line?".
      try { const wf = await windAtKickoff(g); if (wf.outdoor && wf.wind != null) { const fk = `fcst:${season}:${week}:${g.key}`; await redis.rpush(fk, JSON.stringify({ t, wind: wf.wind, temp: wf.temp == null ? null : wf.temp })); await redis.ltrim(fk, -120, -1); }
        const sj = await situationFor(season, week, g).catch(() => null), ik = `inj:${season}:${week}:${g.key}`;
        if (sj && sj.home && sj.away && sj.home.inj && sj.away.inj) { const cur = JSON.stringify({ h: sj.home && sj.home.inj || null, a: sj.away && sj.away.inj || null }), last = await redis.lindex(ik, -1), lj = last ? jparse(last) : null;
          if (!lj || JSON.stringify(lj.s) !== cur) { await redis.rpush(ik, JSON.stringify({ t, s: JSON.parse(cur) })); await redis.ltrim(ik, -60, -1); } } } catch {}
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
          { const calib = await getJSON(`calib:${season}`).catch(() => null);   // "No" marks on the new prices, from the numbers the tab shows (10/7)
            const rows = tdRows(g.key, g.away, g.home, (model && model.td && model.td[g.key]) || null, px, {}).map((r) => ({ ...r, fair: r.fair != null && calib ? applyCalibration(r.fair, calib) : r.fair }));
            await alertsTdNo(season, g, rows).catch(() => 0); }
          // TD price HISTORY (added 9/29): before, each snapshot overwrote the last, so only the latest/closing TD prices
          // existed. Compact rows {t, p: {market: [ask, bid]}}, last 150 snapshots per game (a week uses ~35).
          const compact = {}; for (const [q, v] of Object.entries(px)) { const o = typeof v === "number" ? { ask: v } : v; if (o && o.ask > 0) compact[q] = [o.ask, o.bid ?? null]; }
          await redis.rpush(`tdpxhist:${season}:${week}:${g.key}`, JSON.stringify({ t, src, p: compact })); await redis.ltrim(`tdpxhist:${season}:${week}:${g.key}`, -150, -1); }
      }
      if (String(req.query.kickoff || "").split(",").includes(g.key)) {
        const bk = books ? books[g.key] : ((await getJSON(K.books(season, week))) || { games: {} }).games[g.key];
        await setJSON(K.close(season, week, g.key), { t, poly: poly || null, books: bk || null });
        await writePrelog(season, week, g, t, poly ? (alts ? { ...poly, alts } : poly) : null, bk || null, model);
      }
    }));
    // Safety net: any started game without a closing line gets its last pre-kickoff snapshot.
    let closedLate = 0;
    for (const g of games.filter((g) => started(g))) {
      if (await redis.exists(K.close(season, week, g.key))) continue;
      const raw = await redis.lrange(K.snaps(season, week, g.key), 0, -1);
      const pre = raw.map((x) => jparse(x)).filter((s) => s && new Date(s.t) < new Date(g.kickoff)).pop();
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
    res.status(200).json({ ok: true, week, upcoming: open.length, locked: games.length - open.length, lines, props, books: booksNote, splits: splitsNote, pinnacle: pinNote, closedLate, graded, edges, paper, account: acct.ok ? `synced ${acct.positions} positions` : acct.note });
  } catch (err) { await logError("snapshot", err).catch(() => {}); res.status(500).json({ ok: false, error: String(err) }); }
}
