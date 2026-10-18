// Alerts feed (added 10/1): a short list of "what just happened", built from changes the jobs already see between pulls --
// injuries, QB changes and line moves. Nothing here is computed from
// scratch: each job calls addAlert() when it notices a difference. Stored newest-first, capped at 200 per season.
// Every call is wrapped so an alert problem can never break a snapshot, rerun or grading run.
import { getRedis, jparse } from "./redis";
const KEY = (season) => `alerts:${season}`;
const sgn = (n) => (n > 0 ? "+" : "") + n;
// Cut kinds (owner 10/13, 10/18): never added, and old saved ones are hidden. NFL Alerts = Injury, QB change, Line move, Weather.
// RESULT lines (finals, recaps, settled bets, decided parlays) are cut too: the Results page was deleted 10/18 and nothing reads them.
const CUT_KINDS = new Set(["MODEL", "PRICE GAP", "TEASER", "TD NO", "TD JUMP", "QB TD", "RESULT"]);

// a = { kind, game, team?, title, sub?, id?, ttlH? }. The same id inside ttlH hours (default 6) is skipped, so a repeated pull never re-alerts.
export async function addAlert(season, a) {
  if (CUT_KINDS.has(a.kind)) return 0;
  try {
    const r = getRedis(), id = a.id || `${a.kind}|${a.game}|${a.title}`;
    const ok = await r.set(`alertseen:${season}:${id}`, "1", "EX", Math.round((a.ttlH || 6) * 3600), "NX");
    if (!ok) return 0;
    await r.lpush(KEY(season), JSON.stringify({ t: new Date().toISOString(), kind: a.kind, game: a.game || "", team: a.team || "", title: a.title, sub: a.sub || "" }));
    await r.ltrim(KEY(season), 0, 199);
    return 1;
  } catch { return 0; }
}
export async function listAlerts(season, n = 100) {
  try { return (await getRedis().lrange(KEY(season), 0, n - 1)).map((x) => jparse(x)).filter((x) => x && !CUT_KINDS.has(x.kind)); } catch { return []; }
}

// Polymarket line moved since the last snapshot: spread 0.5+, total 1+, moneyline 5+ cents.
export async function alertsFromLines(season, g, prev, now) {
  if (!prev || !now) return 0; let n = 0;
  if (prev.spread && now.spread && Math.abs(prev.spread.homeSpread - now.spread.homeSpread) >= 0.5)
    n += await addAlert(season, { kind: "LINE MOVE", game: g.key, id: `lm|${g.key}|s|${now.spread.homeSpread}`, title: `${g.key} spread: ${g.home} ${sgn(prev.spread.homeSpread)} → ${sgn(now.spread.homeSpread)}`, sub: "" });
  if (prev.total && now.total && Math.abs(prev.total.line - now.total.line) >= 1)
    n += await addAlert(season, { kind: "LINE MOVE", game: g.key, id: `lm|${g.key}|t|${now.total.line}`, title: `${g.key} total: ${prev.total.line} → ${now.total.line}`, sub: "" });
  if (prev.ml && now.ml && Math.abs(prev.ml.home - now.ml.home) >= 0.05)
    n += await addAlert(season, { kind: "LINE MOVE", game: g.key, id: `lm|${g.key}|m|${Math.round(now.ml.home * 100)}`, title: `${g.key}: ${g.home} moneyline ${Math.round(prev.ml.home * 100)}¢ → ${Math.round(now.ml.home * 100)}¢`, sub: "" });
  return n;
}
// After a model rerun: new injuries, backup-QB starts, side flips, big win-chance moves. Needs the previous run
// (old); a game with no earlier run produces nothing, so the first run of a week never floods the feed.
export async function alertsFromRerun(season, g, old, nw) {
  if (!old || !nw) return 0; let n = 0;
  const say = (m) => (m == null || Math.abs(m) < 0.05 ? "a toss-up" : `${m >= 0 ? g.home : g.away} by ${Math.abs(m).toFixed(1)}`);
  for (const side of ["home", "away"]) {
    const team = side === "home" ? g.home : g.away;
    const was = new Set(((old.inj && old.inj[side] && old.inj[side].players) || []).map((p) => `${p.name}|${p.status}`));
    for (const p of ((nw.inj && nw.inj[side] && nw.inj[side].players) || [])) {
      if (was.has(`${p.name}|${p.status}`)) continue;
      const moved = old.homeMargin != null && nw.homeMargin != null && Math.abs(old.homeMargin - nw.homeMargin) >= 0.05;
      n += await addAlert(season, { kind: "INJURY", game: g.key, team, id: `inj|${g.key}|${p.name}|${p.status}`,
        title: `${team}: ${p.name} ${/^out$/i.test(p.status) ? "ruled out" : String(p.status).toLowerCase()}`, sub: `Model sees ${say(nw.homeMargin)}${moved ? ` (was ${say(old.homeMargin)})` : ""}.` });
    }
  }
  for (const side of ["home", "away"]) {
    const k = side === "home" ? "homeQbFirstStart" : "awayQbFirstStart", team = side === "home" ? g.home : g.away;
    if (nw.fix && nw.fix[k] && !(old.fix && old.fix[k]))
      n += await addAlert(season, { kind: "QB CHANGE", game: g.key, team, id: `qb|${g.key}|${team}`, title: `${g.key}: ${team} backup QB starting`, sub: "" });
  }
  return n;
}
