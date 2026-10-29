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
export const resetGamesCache = () => { cache = { t: 0, rows: null }; };   // tests only
export async function loadSeason(season = SEASON) {
  if (cache.rows && Date.now() - cache.t < 5 * 60 * 1000) return cache.rows.filter((r) => r.season === season);
  const res = await fetch(URL, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`schedule source returned ${res.status}`);
  const [head, ...body] = parseCSV(await res.text()); // proper CSV: handles quoted fields like roof ""
  const ix = (k) => head.indexOf(k);
  const I = { season: ix("season"), type: ix("game_type"), week: ix("week"), day: ix("gameday"), time: ix("gametime"),
    away: ix("away_team"), as: ix("away_score"), home: ix("home_team"), hs: ix("home_score"), roof: ix("roof"), stadium: ix("stadium"), hc: ix("home_coach"), loc: ix("location"), surface: ix("surface"), sp: ix("spread_line"), tl: ix("total_line"), ot: ix("overtime"), wd: ix("weekday"), div: ix("div_game"), hr: ix("home_rest"), ar: ix("away_rest") };
  const rows = [];
  for (const c of body) {
    // Regular season + playoffs (added 9/30: Wild Card/Divisional/Conference/Super Bowl are weeks 19-22 in this file;
    // before, the site stopped at Week 18).
    if (!GAME_TYPES.has(c[I.type]) || Number(c[I.season]) < SEASON - 1) continue;
    const final = c[I.as] !== "" && c[I.hs] !== "" && c[I.as] !== undefined;
    rows.push({ season: Number(c[I.season]), week: Number(c[I.week]), key: `${c[I.away]} @ ${c[I.home]}`,
      away: c[I.away], home: c[I.home], gameday: c[I.day], gametime: c[I.time], kickoff: kickoffISO(c[I.day], c[I.time]),
      final, awayScore: final ? Number(c[I.as]) : null, homeScore: final ? Number(c[I.hs]) : null,
      roof: c[I.roof] || "", stadium: c[I.stadium] || "", homeCoach: I.hc >= 0 ? c[I.hc] || null : null,
      homeRest: I.hr >= 0 && c[I.hr] !== "" ? Number(c[I.hr]) : null, awayRest: I.ar >= 0 && c[I.ar] !== "" ? Number(c[I.ar]) : null,   // 10/21: days since each team's last game (STACK input)
      neutral: I.loc >= 0 && c[I.loc] === "Neutral", overtime: I.ot >= 0 && c[I.ot] === "1", weekday: I.wd >= 0 ? c[I.wd] || "" : "", div: I.div >= 0 && c[I.div] === "1", surface: I.surface >= 0 ? c[I.surface] || "" : "",
      nvSpread: I.sp >= 0 && c[I.sp] !== "" && !isNaN(Number(c[I.sp])) ? Number(c[I.sp]) : null, nvTotal: I.tl >= 0 && c[I.tl] !== "" && !isNaN(Number(c[I.tl])) ? Number(c[I.tl]) : null });   // sportsbook closing lines, used only to catch an absurd Polymarket line
  }
  // Neutral games at a US stadium (the Super Bowl): which team plays home games there, so wind/roof use the real venue
  // instead of "unknown international venue" (9/30).
  const homeOf = {}; for (const r of rows) if (!r.neutral && r.stadium) homeOf[r.stadium] = r.home;
  for (const r of rows) if (r.neutral && homeOf[r.stadium]) r.venueHome = homeOf[r.stadium];
  try { const { overlayEspnFinals } = await import("./espnFinals"); await overlayEspnFinals(rows); } catch {}   // ESPN's final score for games nflverse has not posted yet
  try { const { overlayEspnKickoffs } = await import("./espnFinals"); await overlayEspnKickoffs(rows); } catch {}   // ESPN's kickoff when nflverse's time is stale (10/7: CHI @ GB)
  overlayPolyKickoffs(rows, KICK_FIX);   // hand-confirmed moves (official team/league announcements), applied last
  cache = { t: Date.now(), rows };
  return rows.filter((r) => r.season === season);
}
// Polymarket's start time replaces the schedule's (and ESPN's) when they differ by 10+ minutes, for games not final.
// Kickoff moves confirmed by hand that the schedule file / ESPN still had wrong. Same 2-day guard as Polymarket's.
// Polymarket's start time is NOT used: on 10/8 it still showed CHI @ GB at the old 4:25 ET slot after the NFL moved the game
// to noon CT on 9/29 (Packers.com, Packers News, Daily Herald). The schedule file had it right.
export const KICK_FIX = {};
export function overlayPolyKickoffs(rows, pk, now = Date.now()) {
  let n = 0;
  for (const r of rows) { const k = pk && pk[r.key]; if (!k || r.final || isNaN(Date.parse(k)) || !r.kickoff) continue;
    if (Math.abs(Date.parse(k) - Date.parse(r.kickoff)) > 2 * 86400e3) continue;   // same matchup another week: leave it
    if (Math.abs(Date.parse(k) - Date.parse(r.kickoff)) >= 10 * 60e3) { r.kickoffWas = r.kickoffWas || r.kickoff; r.kickoff = k; r.kickoffFrom = "polymarket"; n++; } }
  return n;
}
export async function loadGames(season, week) {
  return (await loadSeason(Number(season))).filter((r) => r.week === Number(week));
}
export const started = (g, now = Date.now()) => !!g.kickoff && now >= new Date(g.kickoff).getTime();
// Current week = the week of the earliest game that is not final yet (flips to next week once MNF is final). 10/13: briefly flipped at
// the last kickoff instead; owner had it put back (the live Monday game disappeared).
export async function currentWeek(season = SEASON) {
  const rows = await loadSeason(season);
  // A game with no score 2+ days after kickoff (postponed, cancelled, or the score feed lagging) no longer holds the
  // whole site on its week; before 9/28 one postponed game would have frozen the site on that week indefinitely.
  const now = Date.now();
  const open = rows.filter((r) => !r.final && !(r.kickoff && now > new Date(r.kickoff).getTime() + 48 * 3600e3)).sort((a, b) => a.week - b.week);
  return open.length ? open[0].week : Math.max(...rows.map((r) => r.week));
}
// 10/19 (owner: "after sunday games are done i need to start seeing week 7 on monday except for the week 6 monday game"): the week the PAGES show.
// Once every game of the current week that is NOT on Monday (or later, Eastern time) is final, the pages move to the next week and the
// current week's Monday game(s) still to finish ride along at the top (`carry`). Recording, grading and kickoff saves keep using currentWeek
// (the Monday game is still graded and recorded under its own week); the scheduled snapshot and the model rerun cover both weeks until it ends.
const etDay = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(iso));
export function pickDisplayWeek(rows, cur, now = Date.now()) {
  const wk = rows.filter((r) => r.week === cur), next = rows.filter((r) => r.week === cur + 1);
  const left = wk.filter((r) => !r.final && !(r.kickoff && now > new Date(r.kickoff).getTime() + 48 * 3600e3));
  if (!next.length || !left.length || !wk.some((r) => r.final)) return { week: cur, carry: [] };
  if (!left.every((r) => r.kickoff && /^(Mon|Tue)$/.test(etDay(r.kickoff)))) return { week: cur, carry: [] };
  return { week: cur + 1, carry: left.map((r) => r.key) };
}
export async function displayWeek(season = SEASON) {
  const rows = await loadSeason(season), cur = await currentWeek(season);
  return { cur, ...pickDisplayWeek(rows, cur) };
}
// 10/29 (owner: "start fresh and record all of our picks starting today ... only for model bets"): the Model bets record tiles count from this week on
export const MB_FROM_WEEK = 8;
