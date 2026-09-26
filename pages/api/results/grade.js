import Redis from "ioredis";
let client;
function getRedis() {
  if (!client) client = new Redis(process.env.UPSTASH_REDIS_REST_URL_REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
  return client;
}
// ESPN uses LAR / WSH; the dashboard's game keys use LA / WAS.
const ALIAS = { LAR: "LA", WSH: "WAS" };
const norm = (t) => ALIAS[t] || t;
const SEASON = 2026;

async function fetchScores(week) {
  const q = week ? `?week=${week}&seasontype=2&year=${SEASON}` : "";
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard${q}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
  const data = await res.json();
  const map = {};
  (data.events || []).forEach((e) => {
    const comp = e.competitions && e.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    const key = `${norm(away.team.abbreviation)} @ ${norm(home.team.abbreviation)}`;
    map[key] = { final: e.status.type.name === "STATUS_FINAL", homeScore: Number(home.score), awayScore: Number(away.score) };
  });
  return map;
}

// Turns "GB -4.5/-5.5", "MIA +10.5", "LA -2.5" or a bare number (already home-based)
// into the HOME team's spread (negative = home favored). null if unreadable ("—").
function homeSpread(value, game) {
  if (value == null) return null;
  if (typeof value === "number") return isNaN(value) ? null : value;
  const [away, home] = game.split(" @ ");
  const m = String(value).match(/([A-Z]{2,3})\s*([+-]?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[2]);
  if (norm(m[1]) === home) return n;
  if (norm(m[1]) === away) return -n;
  return null;
}
// "Hit" = the side that line favored won straight up. null = no pick (pick'em, tie, or unreadable).
function pickedWinner(spread, margin) {
  if (spread == null || spread === 0 || margin === 0) return null;
  return (spread < 0 && margin > 0) || (spread > 0 && margin < 0);
}

export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const ids = (await redis.smembers("result:ids")) || [];
    const records = [];
    for (const id of ids) {
      const raw = await redis.get(`result:${id}`);
      if (raw) records.push(JSON.parse(raw));
    }
    const pending = records.filter((r) => !r.graded);
    const weeks = [...new Set(pending.map((r) => (String(r.week || "").match(/\d+/) || [null])[0]))];
    const scoresByWeek = {};
    for (const w of weeks) scoresByWeek[w] = await fetchScores(w);
    let graded = 0;
    for (const record of pending) {
      const w = (String(record.week || "").match(/\d+/) || [null])[0];
      const s = scoresByWeek[w][record.game];
      if (!s || !s.final) continue;
      const margin = s.homeScore - s.awayScore;
      record.finalHomeScore = s.homeScore; record.finalAwayScore = s.awayScore;
      record.actualMargin = margin; record.actualTotal = s.homeScore + s.awayScore;
      record.modelSpreadHit = pickedWinner(homeSpread(record.modelSpread, record.game), margin);
      record.marketSpreadHit = pickedWinner(homeSpread(record.marketSpread, record.game), margin);
      record.graded = true; record.gradedAt = new Date().toISOString();
      await redis.set(`result:${record.id}`, JSON.stringify(record));
      graded++;
    }
    return res.status(200).json({ ok: true, graded });
  } catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
}
