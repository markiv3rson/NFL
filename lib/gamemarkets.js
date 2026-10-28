// Every other market of one game on Polymarket US (halves, quarters, team totals, game / team props), grouped: { periods: { "1h": { spread, total,
// winner }, ... }, teamTotals: { CAR: { full, 1h, 2h } }, props: { game, team } }. Used by the 15-min pull (the NFL 1H SPREAD pick + the gmpx: price
// log) and the NBA 1H spread shadow. 10/28 (owner: "only things that should show is the winning picks"): the page no longer lists these prices, so
// the /api/gamemarkets routes are gone.
// Prices are what you pay: the YES / Over / long side = the best ask, the other side = 1 - the best bid.
import { usCode, appTeam } from "./polyus";

const PER = [["full_game", "full"], ["first_half", "1h"], ["second_half", "2h"], ["first_quarter", "q1"], ["second_quarter", "q2"], ["third_quarter", "q3"], ["fourth_quarter", "q4"]];
const PRE = { nfl: "football", nba: "basketball" };
const qv = (x) => { const v = Number(x && typeof x === "object" ? x.value : x); return v > 0 && v < 1 ? v : null; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const etDay = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); };
export const eventSlug = (sport, away, home, start) => { const day = etDay(start); return day ? `${sport}-${usCode(away, sport)}-${usCode(home, sport)}-${day}` : null; };
// the period a market type is for ("basketball_team_total_points_first_half" -> 1h; no period word -> full game)
const periodOf = (t) => { for (const [w, k] of PER) if (t.includes(w)) return k; return "full"; };
// a game-props group name from the type: "football_game_race_to_points" -> "Race to points"
const groupName = (t, pre) => { const s = t.replace(`${pre}_game_`, "").replace(`${pre}_team_`, "").replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

// one market -> { yes, no } prices, or null when nobody is quoting it
function prices(m) {
  if (!m || m.closed || m.active === false || m.hidden) return null;
  const bid = qv(m.bestBidQuote), ask = qv(m.bestAskQuote); if (ask == null && bid == null) return null;
  const yes = r2(ask), no = bid == null ? null : r2(1 - bid);
  // a dead book (nobody selling one side: 97c YES next to 35c NO, or a 99c side) is not a price -- the same two-sided guard as the main lines
  if ((yes != null && yes >= 0.98) || (no != null && no >= 0.98) || (yes != null && no != null && yes + no > 1.12)) return null;
  return { yes, no };
}
// the lines nearest the middle (closest to 50c): up to n, in line order (a spread's line = the away team's)
function nearMain(rows, key, n = 5) {
  const priced = rows.filter((r) => r[key] != null && r[key] > 0.02 && r[key] < 0.98);
  return priced.sort((a, b) => Math.abs(a[key] - 0.5) - Math.abs(b[key] - 0.5)).slice(0, n).sort((a, b) => a.line - b.line);
}

export function parseGameMarkets(ev, sport, away, home) {
  const pre = PRE[sport] || PRE.nfl, periods = {}, teamTotals = { [away]: {}, [home]: {} }, game = {}, team = {};
  const per = (k) => (periods[k] = periods[k] || { spread: [], total: [], winner: [] });
  for (const m of (ev && ev.markets) || []) {
    const t = String(m.sportsMarketType || ""); if (!t.startsWith(pre + "_") || t.startsWith(pre + "_player_")) continue;
    if (t === `${pre}_team_full_game_spread` || t === `${pre}_team_full_game_total` || t === `${pre}_team_full_game_winner`) continue;   // on the SPREAD & ML / TOTALS cards already
    const p = prices(m); if (!p) continue;
    const sides = m.marketSides || [], L = sides.find((s) => s.long), S = sides.find((s) => !s.long);
    const tm = (s) => (s && s.team && s.team.abbreviation ? appTeam(s.team.abbreviation, sport) : null);
    const line = Number(m.line), k = periodOf(t);
    if (/_spread$/.test(t) && L && S && tm(L) && tm(S)) {   // the long side's line is its description ("+1.50" or "-1.50"); written from the away team's side
      const dl = Number(String(L.description || "").replace(/^\+/, "")); if (!isFinite(dl)) continue;
      const aw = tm(L) === away; per(k).spread.push({ line: aw ? dl : -dl, aPrice: aw ? p.yes : p.no, hPrice: aw ? p.no : p.yes }); continue; }
    if (/total/.test(t) && !/touchdowns|field_goals|yards|two_point|rush_touchdowns|pass_touchdowns/.test(t) && isFinite(line)) {
      const who = tm(L) || tm(S), under = L && /under/i.test(L.description || ""), row = { line, over: under ? p.no : p.yes, under: under ? p.yes : p.no };
      if (who && teamTotals[who]) (teamTotals[who][k] = teamTotals[who][k] || []).push(row);
      else per(k).total.push(row);
      continue; }
    if (/_winner$/.test(t)) { per(k).winner.push({ team: tm(L), label: String(m.titleShort || m.title || ""), price: p.yes }); continue; }
    // everything else is a prop: team props (a side carries a team) or game props
    const g = groupName(t, pre), row = { label: String(m.title || m.titleShort || m.question || ""), yes: p.yes, no: p.no, team: tm(L) || tm(S) };
    const into = row.team ? team : game; (into[g] = into[g] || []).push(row);
  }
  for (const k of Object.keys(periods)) {
    const P = periods[k]; P.spreadAll = P.spread.filter((r, i, A) => A.findIndex((x) => x.line === r.line) === i).sort((a, b) => a.line - b.line);   // 10/28: every priced line (the 1H spread pick reads them all)
    P.spread = nearMain(P.spread.filter((r, i, A) => A.findIndex((x) => x.line === r.line) === i), "aPrice"); P.total = nearMain(P.total, "over");
    if (!P.spread.length && !P.total.length && !P.winner.length) delete periods[k];
  }
  for (const tt of Object.values(teamTotals)) for (const k of Object.keys(tt)) { tt[k] = nearMain(tt[k], "over"); if (!tt[k].length) delete tt[k]; }
  const tidy = (o) => { for (const [g, rows] of Object.entries(o)) { o[g] = rows.filter((r) => r.yes != null).sort((a, b) => b.yes - a.yes).slice(0, 12); if (!o[g].length) delete o[g]; } return o; };
  return { periods, teamTotals, props: { game: tidy(game), team: tidy(team) } };
}
