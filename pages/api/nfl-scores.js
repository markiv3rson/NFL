// Live/final scores — same ESPN family as injuries. Used to auto-grade a
// saved pre-game snapshot once a game is final.
export const config = { runtime: "edge" };

export default async function handler(req) {
  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const games = (data.events || []).map((e) => {
      const comp = e.competitions && e.competitions[0];
      const home = comp.competitors.find((c) => c.homeAway === "home");
      const away = comp.competitors.find((c) => c.homeAway === "away");
      return {
        game: `${away.team.abbreviation} @ ${home.team.abbreviation}`,
        status: e.status.type.name, period: e.status.period, clock: e.status.displayClock,
        homeScore: Number(home.score), awayScore: Number(away.score),
      };
    });
    return new Response(JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), games }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
