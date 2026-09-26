// Live Polymarket game lines: moneyline, main spread, main total per game.
// Uses each market's sportsMarketType ("moneyline" | "spreads" | "totals") and line.
// Main line = the one priced closest to 50/50. Games not found are simply omitted.
export const config = { runtime: "edge" };
const GAMMA = "https://gamma-api.polymarket.com";
const TEAMS = { ARI:"Cardinals",ATL:"Falcons",BAL:"Ravens",BUF:"Bills",CAR:"Panthers",CHI:"Bears",CIN:"Bengals",CLE:"Browns",DAL:"Cowboys",DEN:"Broncos",DET:"Lions",GB:"Packers",HOU:"Texans",IND:"Colts",JAX:"Jaguars",KC:"Chiefs",LA:"Rams",LAC:"Chargers",LV:"Raiders",MIA:"Dolphins",MIN:"Vikings",NE:"Patriots",NO:"Saints",NYG:"Giants",NYJ:"Jets",PHI:"Eagles",PIT:"Steelers",SEA:"Seahawks",SF:"49ers",TB:"Buccaneers",TEN:"Titans",WAS:"Commanders" };

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.json();
}
const arr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || "[]"); } catch { return []; } };
const isPeriod = (q) => /\b(1H|2H|1st|2nd|first|second|half|quarter|Q[1-4])\b/i.test(q || "");
const abbrOf = (label, away, home) => {
  const l = (label || "").toLowerCase();
  if (l.includes(TEAMS[away].toLowerCase()) || l === away.toLowerCase()) return away;
  if (l.includes(TEAMS[home].toLowerCase()) || l === home.toLowerCase()) return home;
  return null;
};

export function parseGame(markets, away, home) {
  const out = {};
  const ml = [], spreads = [], totals = [];
  for (const m of markets) {
    const type = (m.sportsMarketType || "").toLowerCase();
    if (isPeriod(m.question) || m.closed) continue;
    const outcomes = arr(m.outcomes), prices = arr(m.outcomePrices).map(Number);
    if (outcomes.length !== 2 || prices.length !== 2 || prices.some(isNaN)) continue;
    if (type === "moneyline") ml.push({ outcomes, prices });
    else if (type === "spreads") spreads.push({ m, outcomes, prices });
    else if (type === "totals") totals.push({ m, outcomes, prices });
  }
  if (ml.length) {
    const { outcomes, prices } = ml[0], o = {};
    outcomes.forEach((lab, i) => { const t = abbrOf(lab, away, home); if (t) o[t] = Math.round(prices[i] * 100); });
    if (o[away] != null && o[home] != null) out.ml = { away: o[away], home: o[home] };
  }
  let best = null;
  for (const s of spreads) {
    // Question form e.g. "Spread: Packers (-5.5)"; else line applies to outcome[0].
    const q = (s.m.question || "").match(/:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/);
    let team = q ? abbrOf(q[1], away, home) : abbrOf(s.outcomes[0], away, home);
    let line = q ? parseFloat(q[2]) : Number(s.m.line);
    if (!team || isNaN(line)) continue;
    const i = s.outcomes.findIndex((lab) => abbrOf(lab, away, home) === team);
    if (i < 0) continue;
    const price = s.prices[i];
    const homeSpread = team === home ? line : -line;
    if (!best || Math.abs(price - 0.5) < Math.abs(best.price - 0.5)) best = { team, line, price, homeSpread };
  }
  if (best) out.spread = { team: best.team, line: best.line, price: Math.round(best.price * 100), homeSpread: best.homeSpread };
  let bt = null;
  for (const t of totals) {
    let line = Number(t.m.line);
    if (isNaN(line) || !t.m.line) { const q = (t.m.question || "").match(/(\d+(?:\.\d+)?)/); line = q ? parseFloat(q[1]) : NaN; }
    const oi = t.outcomes.findIndex((x) => /over/i.test(x)), ui = t.outcomes.findIndex((x) => /under/i.test(x));
    if (isNaN(line) || oi < 0 || ui < 0) continue;
    const over = t.prices[oi];
    if (!bt || Math.abs(over - 0.5) < Math.abs(bt.over - 0.5)) bt = { line, over, under: t.prices[ui] };
  }
  if (bt) out.total = { line: bt.line, over: Math.round(bt.over * 100), under: Math.round(bt.under * 100) };
  return out;
}

export default async function handler(req) {
  try {
    const wanted = (new URL(req.url).searchParams.get("games") || "").split(",").filter(Boolean);
    const events = await getJson(`${GAMMA}/events?series_id=12185&tag_id=100639&active=true&closed=false&limit=200&order=startTime&ascending=true`);
    const results = {};
    await Promise.all(wanted.map(async (key) => {
      const [away, home] = key.split(" @ ");
      if (!TEAMS[away] || !TEAMS[home]) return;
      const ev = events.find((e) => e.title && e.title.includes(TEAMS[away]) && e.title.includes(TEAMS[home]));
      if (!ev) return;
      let markets = ev.markets || [];
      let g = parseGame(markets, away, home);
      // Some game lines may live outside the main event — pull every market for this game.
      if ((!g.spread || !g.total || !g.ml) && ev.gameId) {
        try {
          const more = await getJson(`${GAMMA}/markets?game_id=${ev.gameId}&closed=false&limit=500`);
          if (Array.isArray(more)) g = { ...parseGame(markets.concat(more), away, home) };
        } catch {}
      }
      if (g.ml || g.spread || g.total) results[key] = g;
    }));
    return new Response(JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), games: results }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
