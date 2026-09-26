// Real, free, no-key ESPN endpoint. Pulls every team's current injury list.
export const config = { runtime: "edge" };

const TEAM_IDS = {
  ATL:1,BUF:2,CHI:3,CIN:4,CLE:5,DAL:6,DEN:7,DET:8,GB:9,TEN:10,IND:11,KC:12,
  LV:13,LAR:14,MIA:15,MIN:16,NE:17,NO:18,NYG:19,NYJ:20,PHI:21,ARI:22,PIT:23,
  LAC:24,SF:25,SEA:26,TB:27,WAS:28,CAR:29,JAX:30,BAL:33,HOU:34
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
  if (!res.ok) throw new Error(`${res.status} on ${url}`);
  return res.json();
}

export default async function handler(req) {
  try {
    const results = {};
    const entries = Object.entries(TEAM_IDS);
    // Fixed: firing all 32 teams' fetches at once (each with up to 15 nested
    // player-detail fetches — up to ~500 simultaneous requests) was very
    // likely triggering ESPN's rate limiting, silently failing most of them
    // via allSettled and leaving the result set near-empty. Batch instead.
    const BATCH_SIZE = 6;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(async ([abbr, id]) => {
          const data = await fetchJson(
            `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams/${id}/injuries`
          );
          const items = data.items || [];
          const details = await Promise.allSettled(items.slice(0, 10).map((it) => fetchJson(it.$ref)));
          const list = details
            .filter((d) => d.status === "fulfilled")
            .map((d) => {
              const v = d.value;
              return { name: v.athlete && v.athlete.displayName, status: v.status && v.status.name, detail: v.shortComment || v.longComment || "" };
            })
            .filter((p) => p.name);
          return [abbr, list];
        })
      );
      settled.forEach((r) => { if (r.status === "fulfilled") { const [abbr, list] = r.value; if (list.length) results[abbr] = list; } });
    }
    return new Response(JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), teams: results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
