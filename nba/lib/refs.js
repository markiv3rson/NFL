// NBA referee crews (10/30, owner: "go to the other websites and do research ... build it, grade it, test it, and put it on the app ... as long as it wins").
// official.nba.com posts each game's crew ~9:00 AM ET on game day. A crew's score = sum over its 3 refs of (final total - closing total) / (games + K)
// from refs_data.js (2019-2026, 9,346 games). Tested walk-forward (each ref scored on his EARLIER games only, the cut-offs from earlier seasons):
// a crew in the top / bottom 20% took the Over / Under 52.4% of 2,304 games 2021-26, 52.8% (624-558) on 2024-27, 50-54% every season -- under
// the 56% bar, so it only replaces the model's own side on a total no tested rule names (49-50%), yellow, no PICK w/ POINTS. Spreads: 50-52%, not used.
import { TEAMS, ABBRS } from "./teams";
import { REFS, REF_K, REF_LO, REF_HI } from "./refs_data";
import { getRedis, jparse } from "./redis";
import { etDate } from "./poly";

export const REF_HIT = 52.8, REF_N = 1182, REF_MIN_GAMES = 30, REF_URL = "https://official.nba.com/referee-assignments/";
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
export function teamOf(txt) {
  const t = String(txt || "").toLowerCase().trim();
  if (/lakers/.test(t)) return "LAL"; if (/clippers/.test(t)) return "LAC";
  return ABBRS.find((a) => TEAMS[a].city.toLowerCase() === t) || ABBRS.find((a) => t.endsWith(TEAMS[a].nick.toLowerCase())) || null;
}
// the page's NBA table (the WNBA table under it is cut off): "Charlotte @ Washington | James Capers (#19) | Sean Corbin (#33) | Brandon Schwab (#49) | -"
export function parseAssignments(html) {
  const nba = String(html || "").split(/WNBA Referee Assignments/i)[0], out = {};
  for (const row of nba.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (row.match(/<t[d][\s\S]*?<\/t[d]>/gi) || []).map((c) => c.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\(#\d+\)/g, "").replace(/\s+/g, " ").trim());
    if (cells.length < 4) continue;
    const m = cells[0].split(/\s+@\s+/); if (m.length !== 2) continue;
    const a = teamOf(m[0]), h = teamOf(m[1]), crew = cells.slice(1, 4).filter(Boolean);
    if (a && h && crew.length === 3) out[`${a} @ ${h}`] = crew;
  }
  return out;
}
// null unless all 3 refs have REF_MIN_GAMES+ graded games (the test only judged crews like that)
export function crewScore(crew) {
  if (!Array.isArray(crew) || crew.length < 3) return null;
  let s = 0;
  for (const x of crew.slice(0, 3)) { const r = REFS[norm(x)]; if (!r || r[1] < REF_MIN_GAMES) return null; s += r[0] / (r[1] + REF_K); }
  return s;
}
export function crewSide(crew) { const s = crewScore(crew); return s == null ? null : s >= REF_HI ? "over" : s <= REF_LO ? "under" : null; }
// today's crews (ET date), read once and kept 30 minutes; an empty page (before ~9 AM ET) is asked again on the next snapshot
export async function loadCrews(now = Date.now(), fetcher = fetch) {
  const day = etDate(new Date(now).toISOString()), key = `refs:${day}`, r = getRedis();
  const kept = jparse(await r.get(key).catch(() => null));
  if (kept && kept.games && Object.keys(kept.games).length && now - kept.t < 30 * 60e3) return kept.games;
  try {
    const res = await fetcher(REF_URL, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/120" }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!res.ok) return (kept && kept.games) || {};
    const games = parseAssignments(await res.text());
    if (Object.keys(games).length) await r.set(key, JSON.stringify({ t: now, games }), "EX", 3 * 86400).catch(() => {});
    return Object.keys(games).length ? games : (kept && kept.games) || {};
  } catch { return (kept && kept.games) || {}; }
}
