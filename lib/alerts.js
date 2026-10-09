// Alerts feed (added 10/1): a short list of "what just happened", built from changes the jobs already see between pulls --
// injuries, QB changes, line moves, new price gaps, model moves, wind, and final results. Nothing here is computed from
// scratch: each job calls addAlert() when it notices a difference. Stored newest-first, capped at 200 per season.
// Every call is wrapped so an alert problem can never break a snapshot, rerun or grading run.
import { getRedis, jparse } from "./redis";
const KEY = (season) => `alerts:${season}`;
const sgn = (n) => (n > 0 ? "+" : "") + n;

// a = { kind, game, team?, title, sub?, id?, ttlH? }. The same id inside ttlH hours (default 6) is skipped, so a repeated pull never re-alerts.
export async function addAlert(season, a) {
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
  try { return (await getRedis().lrange(KEY(season), 0, n - 1)).map((x) => jparse(x)).filter(Boolean); } catch { return []; }
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
// A new "Polymarket cheaper than the sportsbooks" spot was logged (called from the edge tracker with the logged record).
export async function alertPriceGap(season, g, e) {
  return addAlert(season, { kind: "PRICE GAP", game: g.key, id: `gap|${g.key}|${e.label}`, title: `${e.label}: Polymarket ${Math.round(e.price * 100)}¢ vs fair ${Math.round(e.fair * 100)}¢`, sub: `${e.ev >= 0 ? "+" : ""}${(e.ev * 100).toFixed(1)}% cheaper than the sportsbooks' fair price. Odds are fresh.` });
}
// After a model rerun: new injuries, backup-QB starts, side flips, big win-chance moves, wind crossing 12 mph. Needs the previous run
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
      n += await addAlert(season, { kind: "QB CHANGE", game: g.key, team, id: `qb|${g.key}|${team}`, title: `${g.key}: ${team}'s backup QB is making his first start`, sub: "" });
  }
  if (old.homeMargin != null && nw.homeMargin != null) {
    const flip = Math.sign(old.homeMargin) !== Math.sign(nw.homeMargin) && Math.abs(old.homeMargin) >= 0.5 && Math.abs(nw.homeMargin) >= 0.5;
    const winMove = old.homeWinPct != null && nw.homeWinPct != null && Math.abs(old.homeWinPct - nw.homeWinPct) >= 5;
    if (flip || winMove) n += await addAlert(season, { kind: "MODEL", game: g.key, id: `mdl|${g.key}|${Math.round(nw.homeMargin * 2)}`, title: `${g.key}: model now sees ${say(nw.homeMargin)}`, sub: `was ${say(old.homeMargin)}` });
  }
  if (nw.outdoor && nw.wind != null && nw.wind >= 12 && !(old.outdoor && old.wind != null && old.wind >= 12))
    n += await addAlert(season, { kind: "WEATHER", game: g.key, id: `wind|${g.key}`, title: `${g.key}: wind forecast ${Math.round(nw.wind)} mph`, sub: "Windy under" });
  return n;
}
// A game was graded for the first time.
export async function alertResult(season, g, rec) {
  const bits = [rec.ml && `Moneyline pick ${String(rec.ml.label).replace(/ ML$/, "")} ${rec.ml.result === "W" ? "won" : "lost"}`,
    rec.spread && `spread side ${rec.spread.label} ${rec.spread.result === "W" ? "won" : rec.spread.result === "L" ? "lost" : "pushed"}`,
    rec.total && `total side ${rec.total.label} ${rec.total.result === "W" ? "won" : rec.total.result === "L" ? "lost" : "pushed"}`].filter(Boolean);
  return addAlert(season, { kind: "RESULT", game: g.key, id: `res|${g.key}`, ttlH: 24 * 14, title: `Final: ${g.away} ${g.awayScore} @ ${g.home} ${g.homeScore}`, sub: bits.length ? bits.join(" · ") + "." : "" });
}

// ---- Signals you'd act on (10/7) ----
// A teaser leg (underdog +1.5..+2.5 at +7.5..+8.5) whose Polymarket price is at or under the cap. Once per leg per line.
export async function alertTeaser(season, g, leg) {
  if (!leg || !leg.value) return 0;
  return addAlert(season, { kind: "TEASER", game: g.key, team: leg.team, id: `teaser|${g.key}|${leg.team}|${leg.line}`, ttlH: 96,
    title: `Teaser leg: ${leg.team} +${leg.line} at ${Math.round(leg.price * 100)}¢`, sub: `${g.key} · from +${leg.base}` });
}
// "No" marks: a real touchdown market where the model (as shown, after calibration) is 5+ points under the bid. rows: [{ player, team, fair, price, bid }].
export function tdNoGapServer(r) {
  if (!r || r.fair == null || !(r.bid > 0) || !(r.price > 0) || r.stale || r.thin || r.price - r.bid > Math.min(0.05, 0.4 * r.price)) return null;
  const gap = r.bid * 100 - r.fair; return gap >= 5 ? Math.round(gap) : null;
}
export async function alertsTdNo(season, g, rows) {
  let n = 0;
  for (const r of rows || []) { const gap = tdNoGapServer(r); if (gap == null) continue;
    n += await addAlert(season, { kind: "TD NO", game: g.key, team: r.team, id: `tdno|${g.key}|${r.player}`, ttlH: 96,
      title: `${r.player} TD: No looks cheap`, sub: `Model ${Math.round(r.fair)}% vs Yes selling at ${Math.round(r.bid * 100)}¢ (${gap} pts) · ${g.key}` }); }
  return n;
}
// A starting QB's touchdown chance moved 10+ points between model runs (new starter, injury news, a big line move).
export async function alertsQbJump(season, g, oldTd, newTd) {
  if (!oldTd || !newTd) return 0; let n = 0;
  const qbs = (t) => [...(t.away || []), ...(t.home || [])].filter((p) => p.pos === "QB");
  for (const q of qbs(newTd)) { const o = qbs(oldTd).find((x) => x.name === q.name);
    const was = o ? o.fair : null;
    if (was == null ? q.fair < 20 : Math.abs(q.fair - was) < 10) continue;   // a new starter shows when he is 20%+; otherwise a 10-point move
    n += await addAlert(season, { kind: "QB TD", game: g.key, id: `qbtd|${g.key}|${q.name}|${Math.round(q.fair)}`, ttlH: 24,
      title: `${q.name} TD chance ${was == null ? "now" : `${Math.round(was)}% →`} ${Math.round(q.fair)}%`, sub: g.key }); }
  return n;
}
