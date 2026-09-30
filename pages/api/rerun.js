// Reruns BOTH models on Railway for every game that hasn't kicked off, using:
// the latest Polymarket spread/total (sportsbook consensus if Polymarket has none),
// players listed OUT on the official injury report, and the kickoff wind forecast (outdoor only).
import { SEASON, currentWeek, loadGames, loadSeason, started } from "../../lib/games";
import { getRedis, getJSON, setJSON, K } from "../../lib/redis";
import { logError } from "../../lib/status";
import { history } from "../../lib/week";
import { loadInjuries } from "../../lib/injuries";
import { windAtKickoff, venue, isNeutral } from "../../lib/wind";
import { loadSnaps, qbFirstStart, sameName } from "../../lib/snaps";
import { loadEspnInjuries, espnOutFor } from "../../lib/espn";
export const config = { maxDuration: 300 };

async function post(base, path, body) {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`model service ${path}: ${text.slice(0, 120)}`); }
}
export default async function handler(req, res) {
  const base = (process.env.MODEL_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return res.status(500).json({ ok: false, error: "MODEL_SERVICE_URL not set in Vercel" });
  try {
    const season = SEASON, week = await currentWeek(season);
    const all = await loadGames(season, week), games = all.filter((g) => !started(g));
    if (!games.length) return res.status(200).json({ ok: true, week, rerun: 0, note: "every game has started — nothing to rerun" });
    const injuries = await loadInjuries().catch(() => ({}));
    const espn = await loadEspnInjuries().catch(() => null);
    const snaps = await loadSnaps().catch(() => ({}));
    // Rest days: days since a team's last game before THIS kickoff (across the full season, not just this week).
    const seasonRows = await loadSeason(season);
    const restDays = (team, kickoff) => {
      const prior = seasonRows.filter((r) => (r.away === team || r.home === team) && r.kickoff && new Date(r.kickoff) < new Date(kickoff));
      if (!prior.length) return null;
      const last = prior.reduce((a, b) => (new Date(a.kickoff) > new Date(b.kickoff) ? a : b));
      return (new Date(kickoff) - new Date(last.kickoff)) / 86400000;
    };
    // 2026 current-season home surface (turf vs grass), from this week's own schedule data when present.
    // Turf: the schedule's surface field, preferring the latest PLAYED game at that home stadium (Buffalo's new 2026
// stadium shows grass for played games but a stale "a_turf" for future ones). Neutral sites: surface unknown -> no
// turf term. Fallback list (LAC was missing before 9/28; SoFi is turf for both LA teams).
    const TURF_TEAMS = new Set(["NO","LA","LAC","NE","IND","NYJ","SEA","ATL","MIN","DET","CIN","DAL","HOU","NYG"]);
    const isTurf = (g) => {
      if (isNeutral(g)) return false;
      const played = seasonRows.filter((r) => r.home === g.home && r.final && r.surface && r.stadium === g.stadium).sort((a, b) => (a.kickoff < b.kickoff ? 1 : -1))[0];
      const s = (played && played.surface) || g.surface;
      return s ? !/grass/i.test(s) : TURF_TEAMS.has(g.home);
    };
    const books = (await getJSON(K.books(season, week))) || { games: {} };
    const payload = await Promise.all(games.map(async (g) => {
      const last = [...(await history(season, week, g.key))].reverse().find((s) => s.poly) || {};
      const p = last.poly || {}, b = books.games[g.key] || {};
      const hs = p.spread ? p.spread.homeSpread : b.spread ? b.spread.homeSpread : null;
      const total = p.total ? p.total.line : b.total ? b.total.line : null;
      const w = await windAtKickoff(g), vn = venue(g);
      const outs = [...(injuries[g.away] || []), ...(injuries[g.home] || [])].filter((x) => Number(x.week) === Number(week) && /^(out|doubtful)$/i.test(x.status)).map((x) => x.name);
      // + ESPN game-day Out (inactives etc., dated this week) so the kickoff-wave rerun hands their share to teammates
      for (const t of [g.away, g.home]) for (const e of ((espn && espn.teams[t]) || [])) if (espnOutFor(e, t, g.kickoff, seasonRows) && !outs.includes(e.name)) outs.push(e.name);   // Doubtful too: 99% sit, and their red-zone share goes to teammates
      // (THIS week's report only — before 9/28 a Tuesday rerun dropped last week's Out players from the new week's TD list)
      return { away: g.away, home: g.home, key: g.key, wind: w.wind, outdoor: w.outdoor && w.wind != null,
        dome: vn ? !vn.outdoor : null, neutral: isNeutral(g), turf: isTurf(g),
        restAwayDays: g.kickoff ? restDays(g.away, g.kickoff) : null,
        spread: hs == null ? null : -hs, total, outs };
    }));
    // Injury adjustment only uses THIS week's official report (a stale list from last week must never move a lean).
    const injFor = (t) => { const off = (injuries[t] || []).filter((x) => Number(x.week) === Number(week)).map((x) => ({ name: x.name, pos: x.pos, status: x.status }));
      // ESPN game-day Out overrides a Questionable (or missing) official status, so a starter ruled inactive Sunday
      // morning moves the game-line injury adjustment too (QB1 -3.96 etc.).
      const gk = (games.find((gg) => gg.away === t || gg.home === t) || {}).kickoff;
      for (const e of ((espn && espn.teams[t]) || [])) if (espnOutFor(e, t, gk, seasonRows)) { const i = off.findIndex((x) => sameName(x.name, e.name)); if (i >= 0) off[i].status = "Out"; else off.push({ name: e.name, pos: e.pos, status: "Out" }); }
      return off; };
    const lines = await post(base, "/rerun-game-lines", { games: payload.map((x) => ({ away: x.away, home: x.home, wind: x.wind, outdoor: x.outdoor,
      spread: x.spread, total: x.total, dome: x.dome, neutral: x.neutral, turf: x.turf, restAwayDays: x.restAwayDays, week,
      // Backup QB making his first start this week (tested 2016-25, margin effect): homeQbFirstStart -6.29 pts,
      // awayQbFirstStart +4.46 pts, both split evenly across each team's own score on the model service side.
      homeQbFirstStart: !!qbFirstStart(snaps[x.home], injFor(x.home), week),
      awayQbFirstStart: !!qbFirstStart(snaps[x.away], injFor(x.away), week),
      inj: { away: injFor(x.away), home: injFor(x.home) } })) });
    const tdIn = payload.filter((x) => x.spread != null && x.total != null);
    const td = tdIn.length ? await post(base, "/rerun-td-probs", { games: tdIn.map((x) => ({ away: x.away, home: x.home, spread: x.spread, total: x.total, outs: x.outs })) }) : { results: [] };
    const store = (await getJSON(K.model(season, week))) || { games: {}, td: {} };
    const runAt = new Date().toISOString();
    let nLines = 0, nTd = 0; const errors = [];
    (lines.results || []).forEach((r, i) => {
      const x = payload[i];
      if (r.error) return errors.push(`${x.key}: ${r.error}`);
      // homeMargin / total / homeWinPct now include the injury adjustment (Estimate); rawMargin / rawTotal / rawWinPct are the plain
      // model, kept so both can be graded against each other. inj = who caused the shift.
      store.games[x.key] = { homeMargin: -r.homeSpread, total: r.total, homeWinPct: r.homeWinPct,
        rawMargin: r.raw ? -r.raw.homeSpread : null, rawTotal: r.raw ? r.raw.total : null, rawWinPct: r.raw ? r.raw.homeWinPct : null,
        // New: calibrated chances (win uses the market spread; cover/under stay ~50% because the model's gap has no measured signal),
        // team-points chances, and which fixes applied (home-field, dome, pace, neutral site).
        calHomeCover: r.calHomeCover ?? null, calUnder: r.calUnder ?? null,
        // The market lines those calibrated chances were computed at, so other lines (e.g. a My Bets leg at -3.5)
        // can be converted from the same calibrated number instead of the raw model gap.
        mktHomeSpread: x.spread != null ? -x.spread : null, mktTotal: x.total ?? null, teamPts: r.teamPts || null, fix: r.fix || null,
        inj: r.inj || null, wind: x.wind, outdoor: x.outdoor, runAt, source: "rerun" };
      nLines++;
    });
    (td.results || []).forEach((r, i) => {
      const x = tdIn[i];
      if (r.error) return errors.push(`${x.key} TD: ${r.error}`);
      store.td[x.key] = { away: r.away, home: r.home, awayGroups: r.awayGroups || null, homeGroups: r.homeGroups || null, outs: r.excluded, linesUsed: { homeSpread: -x.spread, total: x.total }, runAt };
      nTd++;
    });
    store.runAt = runAt;
    await setJSON(K.model(season, week), store);
    // Rerun history: every run with its inputs and outputs (logged only; included in Export)
    if ((req.query.src || "manual") !== "manual") await setJSON("auto:last", { t: runAt, what: `model rerun (${req.query.src})` });
    await getRedis().lpush(`rerunlog:${season}:${week}`, JSON.stringify({ t: runAt, src: req.query.src || "manual",
      games: payload.map((x) => ({ key: x.key, inputs: { homeSpread: x.spread == null ? null : -x.spread, total: x.total, wind: x.wind, outs: x.outs.length },
        model: store.games[x.key] || null, td: (store.td[x.key] ? [...store.td[x.key].away, ...store.td[x.key].home].map((p) => [p.name, p.fair]) : null) })) }));
    await getRedis().ltrim(`rerunlog:${season}:${week}`, 0, 60);
    res.status(200).json({ ok: true, week, rerun: nLines, td: nTd, skippedTd: payload.length - tdIn.length, locked: all.length - games.length, errors });
  } catch (err) { await logError("rerun", err).catch(() => {}); res.status(500).json({ ok: false, error: String(err) }); }
}
