// Official snap counts (nflverse). Used for: snap-share trend on TD rows, QB-change flag, role-change flags.
import { parseCSV } from "./injuries";
const URL = "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2026.csv";
const ALIAS = { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" };
let cache = { t: 0, data: null };

export async function loadSnaps() {
  if (cache.data && Date.now() - cache.t < 30 * 60e3) return cache.data;
  const res = await fetch(URL, { cache: "no-store" });
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
  return { pct: Math.round(last * 100), trend: avg == null ? null : last - avg >= 0.10 ? "up" : avg - last >= 0.10 ? "down" : null };
}
const isOut = (s) => /^(out|doubtful)$/i.test(s || "");
// QB change: season's regular starter listed Out/Doubtful, or someone else took most QB snaps last game.
export function qbChange(teamSnaps, teamInjuries) {
  const qbs = Object.values(teamSnaps || {}).filter((p) => p.pos === "QB");
  if (!qbs.length) return null;
  const starter = qbs.sort((a, b) => b.total - a.total)[0];
  const lastWk = Math.max(...qbs.flatMap((p) => Object.keys(p.weeks).map(Number)));
  const lastQb = qbs.filter((p) => p.weeks[lastWk] != null).sort((a, b) => b.weeks[lastWk] - a.weeks[lastWk])[0];
  const inj = (teamInjuries || []).find((x) => x.name === starter.name);
  if (inj && isOut(inj.status)) return `QB change: ${starter.name} ${inj.status}`;
  if (lastQb && lastQb.name !== starter.name) return `QB change: ${lastQb.name} started last game`;
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
  const inj = (teamInjuries || []).find((x) => x.name === starter.name);
  const starterOut = inj && isOut(inj.status);
  // Who is expected to start: the starter, unless he's out/doubtful, in which case the next-most-used QB not
  // himself listed out/doubtful (or, failing that, whoever played the most recent game).
  let expected = starter;
  if (starterOut) {
    const alt = qbs.filter((p) => p.name !== starter.name).sort((a, b) => b.total - a.total)
      .find((p) => { const i = (teamInjuries || []).find((x) => x.name === p.name); return !(i && isOut(i.status)); });
    if (!alt) return null;
    expected = alt;
  }
  if (expected.name === starter.name && !starterOut) return null;   // the regular starter is playing — nothing to flag
  const priorStarts = Object.entries(expected.weeks).filter(([wk, pct]) => Number(wk) < thisWeek && pct >= 0.5).length;
  return priorStarts === 0 ? expected.name : null;
}
// Role boost: a position group's top-snap player is Out/Doubtful -> teammates at that spot likely gain usage.
export function roleBoosts(teamSnaps, teamInjuries) {
  const out = {};
  for (const pos of ["RB", "WR", "TE"]) {
    const top = Object.values(teamSnaps || {}).filter((p) => p.pos === pos).sort((a, b) => b.total - a.total)[0];
    const inj = top && (teamInjuries || []).find((x) => x.name === top.name);
    if (inj && isOut(inj.status)) out[pos] = `Role boost: ${pos}1 ${top.name} ${inj.status}`;
  }
  return out;
}
