// Betting splits (10/12, owner chose A): the share of BETS vs the share of MONEY on each side, from Action Network's public
// scoreboard feed. RECORDED ONLY -- nothing is shown or picked from it until it is tested on games it never saw (CLAUDE.md rule).
// The feed's exact field names were not verifiable from the build machine, so every field that looks like a split (public /
// money / tickets / bets) is kept as-is per game, plus the lines next to it; the test later reads whatever names it carries.
// A pull that finds no split fields is logged (status panel) so a changed or blocked feed is noticed.
import { TEAMS } from "./games";
const URL = process.env.SPLITS_URL || "https://api.actionnetwork.com/web/v1/scoreboard/nfl?period=game";
const KEEP = /public|money|ticket|bets|handle|spread|total|ml_|book_id|^type$/i;
const abbrOf = (t) => {
  if (!t) return null;
  const s = String(t.abbr || t.abbreviation || "").toUpperCase(), name = String(t.full_name || t.display_name || t.name || "");
  if (TEAMS[s]) return s;
  if (s === "LAR") return "LA"; if (s === "WSH") return "WAS"; if (s === "JAC") return "JAX";
  return Object.keys(TEAMS).find((k) => name && name.endsWith(TEAMS[k])) || null;
};
// Returns { "AWAY @ HOME": [ {field: value, ...} per odds row ] } and how many split fields were found.
export function parseSplits(json) {
  const out = {}; let fields = 0;
  for (const g of (json && json.games) || []) {
    const teams = g.teams || [], byId = Object.fromEntries(teams.map((t) => [t.id, t]));
    const away = abbrOf(byId[g.away_team_id]) || abbrOf(teams[0]), home = abbrOf(byId[g.home_team_id]) || abbrOf(teams[1]);
    if (!away || !home) continue;
    const rows = [];
    for (const o of g.odds || []) {
      const r = {};
      for (const [k, v] of Object.entries(o || {})) if (KEEP.test(k) && (typeof v === "number" || typeof v === "string") ) { r[k] = v; if (/public|money|ticket/i.test(k) && v != null) fields++; }
      if (Object.keys(r).length) rows.push(r);
    }
    if (rows.length) out[`${away} @ ${home}`] = rows;
  }
  return { games: out, fields };
}
export async function fetchSplits() {
  const r = await fetch(URL, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`splits feed returned ${r.status}`);
  return parseSplits(await r.json());
}
