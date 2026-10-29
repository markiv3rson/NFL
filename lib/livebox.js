// LIVE GRADING (10/28 late, owner: "Can you do live grading?" -> "build now"): the facts of a game being played, from ESPN's public game summary --
// the score and clock, the first-half score, each player's receiving / rushing numbers and touchdowns, every scoring play (who, what kind, the
// score after it) and each team's yards. The page (public/app.js liveMark) turns them into each pick's live state: winning / losing, its live
// number, and ✓ / ✗ the moment a pick can no longer change (an Over reached, an Under passed, a TD scored, the final whistle). DISPLAY ONLY:
// nothing is saved; every record still comes from the official grading after the game.
import { teamOf } from "./espn";
const SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUM = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;
const DST = /(interception|fumble|punt|kickoff|blocked|defensive|missed field goal).*(return|touchdown)|return touchdown/i;
const n0 = (x) => { const v = Number(x); return isFinite(v) ? v : 0; };

// ESPN scoreboard -> { "AWAY @ HOME": event id } for the given keys
export function eventIds(json, keys) {
  const want = new Set(keys), out = {};
  for (const ev of (json && json.events) || []) { const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    const by = {}; for (const t of c.competitors || []) { const ab = teamOf(t.team && (t.team.displayName || t.team.name)); if (ab && t.homeAway) by[t.homeAway] = ab; }
    const key = by.away && by.home ? `${by.away} @ ${by.home}` : null; if (key && want.has(key)) out[key] = String(ev.id); }
  return out;
}
// one ESPN game summary -> the facts the page grades with (null when ESPN has no score yet)
export function boxFacts(json) {
  const c = json && json.header && json.header.competitions && json.header.competitions[0]; if (!c) return null;
  const side = {}, ab = {}; for (const t of c.competitors || []) { if (!t.homeAway) continue; side[t.homeAway] = t; ab[t.homeAway] = teamOf(t.team && (t.team.displayName || t.team.name)); }
  if (!side.away || !side.home) return null;
  const s = c.status || {}, ty = s.type || {}, st = ty.state === "in" || ty.state === "post" ? ty.state : null; if (!st) return null;
  const per = n0(s.period), det = String(ty.shortDetail || ty.detail || ""), clock = s.displayClock && s.displayClock !== "0:00" ? String(s.displayClock) : "";
  const lbl = st === "post" || ty.completed ? "FINAL" : /half/i.test(det) && !/end of/i.test(det) ? "HALFTIME" : /end of/i.test(det) && per ? `End ${per > 4 ? "OT" : "Q" + per}` : per > 4 ? `OT${clock ? " " + clock : ""}` : per ? `Q${per}${clock ? " " + clock : ""}` : "LIVE";
  const ls = (t) => (t.linescores || []).map((x) => n0(x.displayValue ?? x.value));
  const la = ls(side.away), lh = ls(side.home), perN = Math.max(per, la.length), half = st === "post" || per >= 3 || lbl === "HALFTIME";
  const out = { st, lbl, per: perN, a: n0(side.away.score), h: n0(side.home.score), final: st === "post" || !!ty.completed,
    h1: half && la.length >= 2 && lh.length >= 2 ? { a: la[0] + la[1], h: lh[0] + lh[1] } : null, pl: [], sp: [], yds: { a: null, h: null } };
  // players: receiving / rushing / passing lines by name
  const by = new Map();
  for (const tb of (json.boxscore && json.boxscore.players) || []) {
    const tm = teamOf(tb.team && (tb.team.displayName || tb.team.name));
    for (const grp of tb.statistics || []) { const keys = grp.keys || [], col = (k) => keys.indexOf(k);
      for (const a of grp.athletes || []) { const nm = a.athlete && a.athlete.displayName; if (!nm) continue; const st2 = a.stats || [], v = (k) => (col(k) >= 0 ? n0(st2[col(k)]) : 0);
        const p = by.get(nm + "|" + tm) || { n: nm, t: tm, rec: 0, recYds: 0, rushYds: 0, recTd: 0, rushTd: 0, passTd: 0 };
        if (grp.name === "receiving") { p.rec = v("receptions"); p.recYds = v("receivingYards"); p.recTd = v("receivingTouchdowns"); }
        else if (grp.name === "rushing") { p.rushYds = v("rushingYards"); p.rushTd = v("rushingTouchdowns"); }
        else if (grp.name === "passing") p.passTd = v("passingTouchdowns");
        else continue;
        by.set(nm + "|" + tm, p); } } }
  out.pl = [...by.values()];
  // scoring plays, in order: the team that scored, the kind, whether a two-point try was good (the score jumped 8), the score after it
  let pa = 0, ph = 0;
  for (const sp of json.scoringPlays || []) {
    const a = n0(sp.awayScore), h = n0(sp.homeScore), tm = teamOf(sp.team && (sp.team.displayName || sp.team.name)) || (sp.team && sp.team.abbreviation);
    const t = tm && tm === ab.home ? "h" : tm && tm === ab.away ? "a" : h - ph > a - pa ? "h" : "a", d = t === "h" ? h - ph : a - pa;
    const txt = String((sp.type && sp.type.text) || ""), abbr = String((sp.type && sp.type.abbreviation) || "");
    const td = /touchdown/i.test(txt) || abbr === "TD", ty = td ? "td" : /field goal/i.test(txt) || abbr === "FG" ? "fg" : /safety/i.test(txt) || abbr === "SF" ? "sf" : "x";
    const how = !td ? "" : /pass/i.test(txt) && !DST.test(txt) ? "pass" : /rush/i.test(txt) ? "rush" : DST.test(txt) ? "dst" : "other";
    out.sp.push({ t, ty, how, two: td && d === 8, per: n0(sp.period && sp.period.number), a, h }); pa = a; ph = h; }
  for (const tb of (json.boxscore && json.boxscore.teams) || []) { const tm = teamOf(tb.team && (tb.team.displayName || tb.team.name)), k = tm === ab.home ? "h" : tm === ab.away ? "a" : null;
    const y = (tb.statistics || []).find((x) => x.name === "totalYards"); if (k && y) out.yds[k] = n0(y.displayValue ?? y.value); }
  return out;
}
// games = [{ key }] -> { key: facts } (ESPN down / a game it has no score for: left out, the page then shows no live state)
export async function liveBoxes(keys, fetcher = fetch) {
  if (!keys.length) return {};
  const get = async (u) => { const r = await fetcher(u, { cache: "no-store", signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`ESPN ${r.status}`); return r.json(); };
  const ids = eventIds(await get(SB).catch(() => null), keys), out = {};
  await Promise.all(Object.entries(ids).map(async ([k, id]) => { try { const f = boxFacts(await get(SUM(id))); if (f) out[k] = f; } catch {} }));
  return out;
}
