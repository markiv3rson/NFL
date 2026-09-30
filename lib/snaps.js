// Official snap counts (nflverse). Used for: snap-share trend on TD rows, QB-change flag, role-change flags.
import { parseCSV } from "./injuries";
import { SEASON } from "./games";
const URL = () => `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${SEASON}.csv`;
const ALIAS = { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" };
let cache = { t: 0, data: null };
// Snap counts and injury reports spell names differently ("Michael Penix" vs "Michael Penix Jr.", "D.J. Moore" vs
// "DJ Moore"). Before 9/28 they were compared exactly, so ~9% of injured players (64 of 1,468 in 2025) never matched:
// a starting QB listed Out with a suffix triggered no QB-change flag and no first-start adjustment.
const key = (n) => String(n || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
export const sameName = (a, b) => key(a) === key(b);

export async function loadSnaps() {
  if (cache.data && Date.now() - cache.t < 30 * 60e3) return cache.data;
  const res = await fetch(URL(), { cache: "no-store" });
  if (!res.ok) throw new Error(`snap counts returned ${res.status}`);
  const [head, ...rows] = parseCSV(await res.text());
  const ix = (k) => head.indexOf(k);
  const I = { wk: ix("week"), name: ix("player"), pos: ix("position"), team: ix("team"), snaps: ix("offense_snaps"), pct: ix("offense_pct"), gt: ix("game_type") };
  const teams = {};
  for (const r of rows) {
    if (r[I.gt] !== "REG" || !r[I.team]) continue;
    const team = ALIAS[r[I.team]] || r[I.team], name = r[I.name];
    const p = ((teams[team] = teams[team] || {})[name] = teams[team][name] || { name, pos: r[I.pos], weeks: {}, total: 0 });
    p.weeks[Number(r[I.wk])] = Number(r[I.pct]); p.total += Number(r[I.snaps]) || 0;
  }
  cache = { t: Date.now(), data: teams };
  return teams;
}
// Last game's snap % and the trend vs the games before it (arrow when it moved 10+ points).
export function snapTrend(teamSnaps, matches) {
  const p = Object.values(teamSnaps || {}).find((x) => matches(x.name));
  if (!p) return null;
  const wks = Object.keys(p.weeks).map(Number).sort((a, b) => a - b);
  const last = p.weeks[wks[wks.length - 1]], prev = wks.slice(0, -1).map((w) => p.weeks[w]);
  const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
  // "early": a regular (50%+ of snaps before) who played under half his usual share last game -- the usual sign he
  // got hurt or benched mid-game. There is no official injury status until Wednesday's practice report, so this is
  // the only same-week warning available. Flag only; it doesn't change the %.
  const early = avg != null && avg >= 0.5 && last < avg * 0.5;
  // Snap files only list players who played. If the team played a later game than his last row, he MISSED it --
  // before 9/28 his older snap % was shown as if it were last game's, with no warning.
  const teamLast = Math.max(...Object.values(teamSnaps).flatMap((x) => Object.keys(x.weeks).map(Number)));
  const missed = wks[wks.length - 1] < teamLast;
  return { pct: Math.round(last * 100), avg: avg == null ? null : Math.round(avg * 100), early, missed, lastWeek: wks[wks.length - 1],
    trend: avg == null ? null : last - avg >= 0.10 ? "up" : avg - last >= 0.10 ? "down" : null };
}
const isOut = (s) => /^(out|doubtful)$/i.test(s || "");
// QB change: season's regular starter listed Out/Doubtful, or someone else took most QB snaps last game.
export function qbChange(teamSnaps, teamInjuries) {
  const qbs = Object.values(teamSnaps || {}).filter((p) => p.pos === "QB");
  if (!qbs.length) return null;
  const weeks = [...new Set(qbs.flatMap((p) => Object.keys(p.weeks).map(Number)))].sort((a, b) => a - b);
  const top = (w) => qbs.filter((p) => p.weeks[w] != null).sort((a, b) => b.weeks[w] - a.weeks[w])[0];
  const last = top(weeks[weeks.length - 1]), before = weeks.length > 1 ? top(weeks[weeks.length - 2]) : null;
  // 1) this week's official report lists last game's starter Out/Doubtful
  const inj = last && (teamInjuries || []).find((x) => sameName(x.name, last.name));
  if (inj && isOut(inj.status)) return `QB change: ${last.name} ${inj.status}`;
  // 2) last game's starter differs from the game before (a change JUST happened). Before 9/28 "starter" meant most
  // snaps all season, so a QB who took over (Penix, ATL) kept being flagged week after week.
  if (last && before && last.name !== before.name) return `QB change: ${last.name} started last game (${before.name} the game before)`;
  return null;
}
// Backup QB making his FIRST start of the season for this team (tested 2016-25: a home team's backup's first
// start costs it ~7.6 pts vs the model's expectation; an away team's backup's first start helps the home team
// ~5.7 pts). A "start" here is a game where that QB took the most QB snaps on the team. Returns the QB's name
// if this week looks like his first start, else null. `thisWeek` is the week being predicted (not yet played).
export function qbFirstStart(teamSnaps, teamInjuries, thisWeek) {
  const qbs = Object.values(teamSnaps || {}).filter((p) => p.pos === "QB");
  if (!qbs.length) return null;
  const starter = qbs.sort((a, b) => b.total - a.total)[0];
  const inj = (teamInjuries || []).find((x) => sameName(x.name, starter.name));
  const starterOut = inj && isOut(inj.status);
  // Who is expected to start: the starter, unless he's out/doubtful, in which case the next-most-used QB not
  // himself listed out/doubtful (or, failing that, whoever played the most recent game).
  let expected = starter;
  if (starterOut) {
    const alt = qbs.filter((p) => p.name !== starter.name).sort((a, b) => b.total - a.total)
      .find((p) => { const i = (teamInjuries || []).find((x) => sameName(x.name, p.name)); return !(i && isOut(i.status)); });
    if (!alt) return null;
    expected = alt;
  }
  if (expected.name === starter.name && !starterOut) return null;   // the regular starter is playing — nothing to flag
  const priorStarts = Object.entries(expected.weeks).filter(([wk, pct]) => Number(wk) < thisWeek && pct >= 0.5).length;
  return priorStarts === 0 ? expected.name : null;
}
// Role note: a position group's top-snap player is Out/Doubtful. Shown on teammates as information only -- since 9/30 his
// usage is NOT added to their chances (the hand-off tested worse in 7 of 7 seasons), and the text says so.
export function roleBoosts(teamSnaps, teamInjuries) {
  const out = {};
  for (const pos of ["RB", "WR", "TE"]) {
    const top = Object.values(teamSnaps || {}).filter((p) => p.pos === pos).sort((a, b) => b.total - a.total)[0];
    const inj = top && (teamInjuries || []).find((x) => sameName(x.name, top.name));
    if (inj && isOut(inj.status)) out[pos] = `${pos}1 ${top.name} is ${inj.status} — may mean more work here (not added to this chance)`;
  }
  return out;
}
