// Runs on Vercel's own servers, not through Claude — direct HTTP call to
// Polymarket's public API. No auth/key needed.
export const config = { runtime: "edge" };

const GAME_TEAM_NAMES = {
  "CAR @ CLE": ["Panthers", "Browns"], "CIN @ PIT": ["Bengals", "Steelers"],
  "HOU @ IND": ["Texans", "Colts"], "TEN @ NYG": ["Titans", "Giants"],
  "ARI @ SF": ["Cardinals", "49ers"], "MIN @ TB": ["Vikings", "Buccaneers"],
  "BAL @ DAL": ["Ravens", "Cowboys"], "LV @ NO": ["Raiders", "Saints"],
  "LA @ DEN": ["Rams", "Broncos"], "PHI @ CHI": ["Eagles", "Bears"],
  "NE @ JAX": ["Patriots", "Jaguars"], "SEA @ WAS": ["Seahawks", "Commanders"],
  "KC @ MIA": ["Chiefs", "Dolphins"], "LAC @ BUF": ["Chargers", "Bills"],
  "NYJ @ DET": ["Jets", "Lions"],
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} on ${url}`);
  return res.json();
}

export default async function handler(req) {
  try {
    // Fixed 2026-09-25, take 3. Confirmed by actually reading a live response:
    // series_id=12185 + tag_id=100639 finds real weekly games (e.g. "Chargers vs.
    // Bills", slug "nfl-lac-buf-2026-09-27") but only spread/moneyline markets.
    // Anytime-TD props live in a SEPARATE companion event — Polymarket's own docs
    // confirm companion events append "-player-props" to the main event's slug.
    // So: find the main event first (to get its real slug), then fetch that
    // slug + "-player-props" for the actual TD markets.
    const mainEvents = await fetchJson(
      "https://gamma-api.polymarket.com/events?series_id=12185&tag_id=100639&active=true&closed=false&limit=200&order=startTime&ascending=true"
    );
    const results = {};
    for (const [gameKey, teamNames] of Object.entries(GAME_TEAM_NAMES)) {
      const [a, b] = teamNames;
      const mainEvent = mainEvents.find(
        (e) => e.title && e.title.includes(a) && e.title.includes(b)
      );
      if (!mainEvent || !mainEvent.slug) continue;
      let propEvents;
      try {
        propEvents = await fetchJson(
          `https://gamma-api.polymarket.com/events?slug=${mainEvent.slug}-player-props`
        );
      } catch { continue; }
      const propEvent = Array.isArray(propEvents) ? propEvents[0] : propEvents;
      if (!propEvent || !propEvent.markets) continue;
      const players = {};
      for (const m of propEvent.markets) {
        if (!/touchdown/i.test(m.question || "")) continue;
        try {
          const prices = JSON.parse(m.outcomePrices || "[]").map(Number);
          const outcomes = JSON.parse(m.outcomes || "[]");
          const yesIdx = outcomes.findIndex((o) => /yes/i.test(o));
          if (yesIdx === -1 || prices[yesIdx] === undefined) continue;
          players[m.question] = Math.round(prices[yesIdx] * 100);
        } catch { continue; }
      }
      if (Object.keys(players).length) results[gameKey] = players;
    }
    return new Response(JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), games: results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
