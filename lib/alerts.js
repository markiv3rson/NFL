// Alerts feed (added 10/1): a short list of "what just happened", built from changes the jobs already see between pulls --
// injuries, QB changes, line moves, wind, TD marks and final results. Nothing here is computed from
// scratch: each job calls addAlert() when it notices a difference. Stored newest-first, capped at 200 per season.
// Every call is wrapped so an alert problem can never break a snapshot, rerun or grading run.
import { getRedis, jparse } from "./redis";
const KEY = (season) => `alerts:${season}`;
const sgn = (n) => (n > 0 ? "+" : "") + n;
// 10/13 (owner): these alert kinds were cut -- never added, and old saved ones are hidden.
// 10/18 (owner: "I only need the top 5. Anything under Weather is delete"): RESULT (finals, weekly recap, settled bets, model parlays),
// TD NO, TD JUMP and QB TD are cut too. NFL Alerts = All, Injury, QB change, Line move, Weather.
const CUT_KINDS = new Set(["MODEL", "PRICE GAP", "TEASER", "RESULT", "TD NO", "TD JUMP", "QB TD"]);

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
  // (the MODEL alert that used to go here was cut 10/13 -- CUT_KINDS blocks it, so the branch is gone)
  return n;
}
// A game was graded for the first time.
export async function alertResult(season, g, rec) {
  // 10/14 fix: the spread/total results are the CARD's picks locked at kickoff (stack:), not the old game model's side (never a pick).
  const said = (r) => (r === "W" ? "won" : r === "L" ? "lost" : "pushed"), best = {}, plain = {}, pts = {};
  try { for (const v of Object.values((await getRedis().hgetall(`stack:${season}:${rec.week}`)) || {})) { const e = jparse(v);
    if (!e || e.game !== g.key || e.teaser || !e.kind || !e.result) continue; const k = e.kind === "total" ? "total" : "spread";
    if (/^modelpick\|/.test(e.id || "")) continue;   // 10/15: the no-rule model side is not reported as a pick
    if (/^ptspick\|/.test(e.id || "")) { pts[k] = e; continue; }   // 10/15: the card's PICK w/ POINTS is reported next to its PICK, never instead of it
    if (/^cardpick\|/.test(e.id || "")) { plain[k] = e; continue; }
    if (!best[k] || e.hit > best[k].hit) best[k] = e; }
    for (const k of ["spread", "total"]) if (plain[k]) best[k] = plain[k]; } catch {}
  const bits = [rec.ml && `Moneyline pick ${String(rec.ml.label).replace(/ ML$/, "")} ${rec.ml.result === "W" ? "won" : "lost"}`,
    best.spread && `spread pick ${best.spread.pick} ${said(best.spread.result)}`, pts.spread && `with points ${pts.spread.pick} ${said(pts.spread.result)}`, best.total && `total pick ${best.total.pick} ${said(best.total.result)}`, pts.total && `with points ${pts.total.pick} ${said(pts.total.result)}`].filter(Boolean);
  return addAlert(season, { kind: "RESULT", game: g.key, id: `res|${g.key}`, ttlH: 24 * 14, title: `Final: ${g.away} ${g.awayScore} @ ${g.home} ${g.homeScore}`, sub: bits.length ? bits.join(" · ") + "." : "" });
}

// ---- Signals you'd act on (10/7) ----
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
// News lag (10/9): a non-QB's TD chance rose 8+ points between model runs (a teammate ruled out, a new starter) while his
// Polymarket price is still below the new number by 5+ points. prices: { market question: { ask } } for the game.
export async function alertsTdJump(season, g, oldTd, newTd, prices) {
  if (!oldTd || !newTd || !prices) return 0; let n = 0;
  const all = (t) => [...(t.away || []).map((p) => ({ ...p, team: g.away })), ...(t.home || []).map((p) => ({ ...p, team: g.home }))].filter((p) => p.pos !== "QB");
  const { nameMatches } = await import("./picks");
  for (const p of all(newTd)) { const o = all(oldTd).find((x) => x.name === p.name && x.team === p.team); if (!o || p.fair - o.fair < 8) continue;
    const q = Object.keys(prices).find((k) => nameMatches(p.name, k) && /(^|\D)1\+|anytime/i.test(k)) || Object.keys(prices).find((k) => nameMatches(p.name, k));
    const v = q ? prices[q] : null, ask = v ? (typeof v === "number" ? v : v.ask) : null;
    if (!(ask > 0) || p.fair / 100 - ask < 0.05) continue;
    n += await addAlert(season, { kind: "TD JUMP", game: g.key, id: `tdj|${g.key}|${p.name}|${Math.round(p.fair)}`, ttlH: 12,
      title: `${p.name} TD ${Math.round(o.fair)}% → ${Math.round(p.fair)}% · price ${Math.round(ask * 100)}¢`, sub: g.key }); }
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
