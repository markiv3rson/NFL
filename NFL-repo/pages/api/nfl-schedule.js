// Real ESPN schedule endpoint — works for past, current, and FUTURE weeks
// (ESPN posts the full season schedule up front).
export const config = { runtime: "edge" };

export default async function handler(req) {
  const url = new URL(req.url);
  const week = url.searchParams.get("week") || "1";
  const year = url.searchParams.get("year") || new Date().getFullYear();
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&year=${year}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const games = (data.events || []).map((e) => {
      const comp = e.competitions && e.competitions[0];
      const home = comp.competitors.find((c) => c.homeAway === "home");
      const away = comp.competitors.find((c) => c.homeAway === "away");
      return {
        game: `${away.team.abbreviation} @ ${home.team.abbreviation}`,
        awayName: away.team.displayName, homeName: home.team.displayName,
        date: comp.date, status: e.status.type.name,
        network: (comp.broadcasts && comp.broadcasts[0] && comp.broadcasts[0].names && comp.broadcasts[0].names[0]) || "",
      };
    });
    return new Response(JSON.stringify({ ok: true, week: Number(week), year: Number(year), games }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
