import { loadGames, kickoffISO } from "../../lib/games";
export const config = { runtime: "edge" };
const NAMES = { ARI:"Cardinals",ATL:"Falcons",BAL:"Ravens",BUF:"Bills",CAR:"Panthers",CHI:"Bears",CIN:"Bengals",CLE:"Browns",DAL:"Cowboys",DEN:"Broncos",DET:"Lions",GB:"Packers",HOU:"Texans",IND:"Colts",JAX:"Jaguars",KC:"Chiefs",LA:"Rams",LAC:"Chargers",LV:"Raiders",MIA:"Dolphins",MIN:"Vikings",NE:"Patriots",NO:"Saints",NYG:"Giants",NYJ:"Jets",PHI:"Eagles",PIT:"Steelers",SEA:"Seahawks",SF:"49ers",TB:"Buccaneers",TEN:"Titans",WAS:"Commanders" };
export default async function handler(req) {
  const url = new URL(req.url);
  const week = url.searchParams.get("week") || "1";
  const year = url.searchParams.get("year") || "2026";
  try {
    const games = (await loadGames(year, week)).map((g) => ({
      game: `${g.away} @ ${g.home}`, awayName: NAMES[g.away] || g.away, homeName: NAMES[g.home] || g.home,
      date: kickoffISO(g.gameday, g.gametime), status: g.final ? "STATUS_FINAL" : "STATUS_SCHEDULED", network: "",
    }));
    return new Response(JSON.stringify({ ok: true, week: Number(week), year: Number(year), games }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
