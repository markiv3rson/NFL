import { parseCSV } from "./injuries";
// nflverse public schedule/scores file (same source the models use).
const URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
// Current season from the date (Aug-Dec = that year, Jan-Jul = the season that started the year before), never typed in
// by hand (was hard-coded 2026). Before a new season's files exist, the loaders' own error handling covers it.
export const SEASON = (() => { const d = new Date(); return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; })();
export const TEAMS = { ARI:"Cardinals",ATL:"Falcons",BAL:"Ravens",BUF:"Bills",CAR:"Panthers",CHI:"Bears",CIN:"Bengals",CLE:"Browns",DAL:"Cowboys",DEN:"Broncos",DET:"Lions",GB:"Packers",HOU:"Texans",IND:"Colts",JAX:"Jaguars",KC:"Chiefs",LA:"Rams",LAC:"Chargers",LV:"Raiders",MIA:"Dolphins",MIN:"Vikings",NE:"Patriots",NO:"Saints",NYG:"Giants",NYJ:"Jets",PHI:"Eagles",PIT:"Steelers",SEA:"Seahawks",SF:"49ers",TB:"Buccaneers",TEN:"Titans",WAS:"Commanders" };
export const GAME_HOURS = 4;
const GAME_TYPES = new Set(["REG", "WC", "DIV", "CON", "SB"]);

// nflverse times are US Eastern. EDT (-04:00) until the first Sunday of November, then EST.
export function kickoffISO(gameday, gametime) {
  if (!gameday) return null;
  const [y, m, d] = gameday.split("-").map(Number);
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  const firstSunNov = 1 + ((7 - nov1) % 7);
  const edt = (m > 3 && m < 11) || (m === 11 && d < firstSunNov);
  return `${gameday}T${gametime || "13:00"}:00${edt ? "-04:00" : "-05:00"}`;
}

let cache = { t: 0, rows: null };
export async function loadSeason(season = SEASON) {
  if (cache.rows && Date.now() - cache.t < 5 * 60 * 1000) return cache.rows.filter((r) => r.season === season);
  const res = await fetch(URL, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`schedule source returned ${res.status}`);
  const [head, ...body] = parseCSV(await res.text()); // proper CSV: handles quoted fields like roof ""
  const ix = (k) => head.indexOf(k);
  const I = { season: ix("season"), type: ix("game_type"), week: ix("week"), day: ix("gameday"), time: ix("gametime"),
    away: ix("away_team"), as: ix("away_score"), home: ix("home_team"), hs: ix("home_score"), roof: ix("roof"), stadium: ix("stadium"), loc: ix("location"), surface: ix("surface") };
  const rows = [];
  for (const c of body) {
    // Regular season + playoffs (added 9/30: Wild Card/Divisional/Conference/Super Bowl are weeks 19-22 in this file;
    // before, the site stopped at Week 18).
    if (!GAME_TYPES.has(c[I.type]) || Number(c[I.season]) < SEASON - 1) continue;
    const final = c[I.as] !== "" && c[I.hs] !== "" && c[I.as] !== undefined;
    rows.push({ season: Number(c[I.season]), week: Number(c[I.week]), key: `${c[I.away]} @ ${c[I.home]}`,
      away: c[I.away], home: c[I.home], gameday: c[I.day], gametime: c[I.time], kickoff: kickoffISO(c[I.day], c[I.time]),
      final, awayScore: final ? Number(c[I.as]) : null, homeScore: final ? Number(c[I.hs]) : null,
      roof: c[I.roof] || "", stadium: c[I.stadium] || "",
      neutral: I.loc >= 0 && c[I.loc] === "Neutral", surface: I.surface >= 0 ? c[I.surface] || "" : "" });
  }
  // Neutral games at a US stadium (the Super Bowl): which team plays home games there, so wind/roof use the real venue
  // instead of "unknown international venue" (9/30).
  const homeOf = {}; for (const r of rows) if (!r.neutral && r.stadium) homeOf[r.stadium] = r.home;
  for (const r of rows) if (r.neutral && homeOf[r.stadium]) r.venueHome = homeOf[r.stadium];
  cache = { t: Date.now(), rows };
  return rows.filter((r) => r.season === season);
}
export async function loadGames(season, week) {
  return (await loadSeason(Number(season))).filter((r) => r.week === Number(week));
}
export const started = (g, now = Date.now()) => !!g.kickoff && now >= new Date(g.kickoff).getTime();
// Current week = the week of the earliest game that is not final yet (flips to next week once MNF is final).
export async function currentWeek(season = SEASON) {
  const rows = await loadSeason(season);
  // A game with no score 2+ days after kickoff (postponed, cancelled, or the score feed lagging) no longer holds the
  // whole site on its week; before 9/28 one postponed game would have frozen the site on that week indefinitely.
  const now = Date.now();
  const open = rows.filter((r) => !r.final && !(r.kickoff && now > new Date(r.kickoff).getTime() + 48 * 3600e3)).sort((a, b) => a.week - b.week);
  return open.length ? open[0].week : Math.max(...rows.map((r) => r.week));
}
