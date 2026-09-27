// Reruns BOTH models on Railway for every game that hasn't kicked off, using:
// the latest Polymarket spread/total (sportsbook consensus if Polymarket has none),
// players listed OUT on the official injury report, and the kickoff wind forecast (outdoor only).
import { SEASON, currentWeek, loadGames, started } from "../../lib/games";
import { getRedis, getJSON, setJSON, K } from "../../lib/redis";
import { logError } from "../../lib/status";
import { history } from "../../lib/week";
import { loadInjuries } from "../../lib/injuries";
import { windAtKickoff } from "../../lib/wind";
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
    const books = (await getJSON(K.books(season, week))) || { games: {} };
    const payload = await Promise.all(games.map(async (g) => {
      const last = [...(await history(season, week, g.key))].reverse().find((s) => s.poly) || {};
      const p = last.poly || {}, b = books.games[g.key] || {};
      const hs = p.spread ? p.spread.homeSpread : b.spread ? b.spread.homeSpread : null;
      const total = p.total ? p.total.line : b.total ? b.total.line : null;
      const w = await windAtKickoff(g);
      const outs = [...(injuries[g.away] || []), ...(injuries[g.home] || [])].filter((x) => /^out$/i.test(x.status)).map((x) => x.name);
      return { away: g.away, home: g.home, key: g.key, wind: w.wind, outdoor: w.outdoor && w.wind != null,
        spread: hs == null ? null : -hs, total, outs };
    }));
    const lines = await post(base, "/rerun-game-lines", { games: payload.map((x) => ({ away: x.away, home: x.home, wind: x.wind, outdoor: x.outdoor })) });
    const tdIn = payload.filter((x) => x.spread != null && x.total != null);
    const td = tdIn.length ? await post(base, "/rerun-td-probs", { games: tdIn.map((x) => ({ away: x.away, home: x.home, spread: x.spread, total: x.total, outs: x.outs })) }) : { results: [] };
    const store = (await getJSON(K.model(season, week))) || { games: {}, td: {} };
    const runAt = new Date().toISOString();
    let nLines = 0, nTd = 0; const errors = [];
    (lines.results || []).forEach((r, i) => {
      const x = payload[i];
      if (r.error) return errors.push(`${x.key}: ${r.error}`);
      store.games[x.key] = { homeMargin: -r.homeSpread, total: r.total, homeWinPct: r.homeWinPct, wind: x.wind, outdoor: x.outdoor, runAt, source: "rerun" };
      nLines++;
    });
    (td.results || []).forEach((r, i) => {
      const x = tdIn[i];
      if (r.error) return errors.push(`${x.key} TD: ${r.error}`);
      store.td[x.key] = { away: r.away, home: r.home, outs: r.excluded, linesUsed: { homeSpread: -x.spread, total: x.total }, runAt };
      nTd++;
    });
    store.runAt = runAt;
    await setJSON(K.model(season, week), store);
    // Rerun history: every run with its inputs and outputs (logged only; included in Export)
    await getRedis().lpush(`rerunlog:${season}:${week}`, JSON.stringify({ t: runAt, src: req.query.src || "manual",
      games: payload.map((x) => ({ key: x.key, inputs: { homeSpread: x.spread == null ? null : -x.spread, total: x.total, wind: x.wind, outs: x.outs.length },
        model: store.games[x.key] || null, td: (store.td[x.key] ? [...store.td[x.key].away, ...store.td[x.key].home].map((p) => [p.name, p.fair]) : null) })) }));
    await getRedis().ltrim(`rerunlog:${season}:${week}`, 0, 60);
    res.status(200).json({ ok: true, week, rerun: nLines, td: nTd, skippedTd: payload.length - tdIn.length, locked: all.length - games.length, errors });
  } catch (err) { await logError("rerun", err).catch(() => {}); res.status(500).json({ ok: false, error: String(err) }); }
}
