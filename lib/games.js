// Shared: nflverse public schedule/scores file (same source the models use).
// Replaces ESPN, which returns 403 to Vercel's servers.
const URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
export async function loadGames(season, week) {
  const res = await fetch(URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`schedule source returned ${res.status}`);
  const lines = (await res.text()).split("\n");
  const head = lines[0].split(",");
  const ix = (k) => head.indexOf(k);
  const I = { season: ix("season"), type: ix("game_type"), week: ix("week"), day: ix("gameday"), time: ix("gametime"),
    away: ix("away_team"), as: ix("away_score"), home: ix("home_team"), hs: ix("home_score") };
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    if (c[I.season] !== String(season) || c[I.type] !== "REG" || c[I.week] !== String(week)) continue;
    const final = c[I.as] !== "" && c[I.hs] !== "";
    out.push({ away: c[I.away], home: c[I.home], gameday: c[I.day], gametime: c[I.time], final,
      awayScore: final ? Number(c[I.as]) : null, homeScore: final ? Number(c[I.hs]) : null });
  }
  return out;
}
// nflverse times are US Eastern. EDT (-04:00) until the first Sunday of November, then EST.
export function kickoffISO(gameday, gametime) {
  if (!gameday) return null;
  const [y, m, d] = gameday.split("-").map(Number);
  const nov1 = new Date(Date.UTC(y, 10, 1)).getUTCDay();
  const firstSunNov = 1 + ((7 - nov1) % 7);
  const edt = m < 11 || (m === 11 && d < firstSunNov) || m > 12;
  return `${gameday}T${gametime || "13:00"}:00${edt && m < 12 ? "-04:00" : "-05:00"}`;
}
