import Redis from "ioredis";
let client;
function getRedis() {
  if (!client) client = new Redis(process.env.UPSTASH_REDIS_REST_URL_REDIS_URL, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
  return client;
}
async function fetchScores() {
  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
  const data = await res.json();
  const map = {};
  (data.events || []).forEach((e) => {
    const comp = e.competitions && e.competitions[0];
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    const key = `${away.team.abbreviation} @ ${home.team.abbreviation}`;
    map[key] = { final: e.status.type.name === "STATUS_FINAL", homeScore: Number(home.score), awayScore: Number(away.score) };
  });
  return map;
}
export default async function handler(req, res) {
  try {
    const redis = getRedis();
    const scores = await fetchScores();
    const ids = (await redis.smembers("result:ids")) || [];
    let graded = 0;
    for (const id of ids) {
      const raw = await redis.get(`result:${id}`);
      if (!raw) continue;
      const record = JSON.parse(raw);
      if (record.graded) continue;
      const s = scores[record.game];
      if (!s || !s.final) continue;
      const margin = s.homeScore - s.awayScore;
      record.finalHomeScore = s.homeScore; record.finalAwayScore = s.awayScore;
      record.actualMargin = margin; record.actualTotal = s.homeScore + s.awayScore;
      if (record.modelSpread != null) record.modelSpreadHit = Math.sign(margin) === Math.sign(record.modelSpread) || record.modelSpread === 0;
      if (record.marketSpread != null) record.marketSpreadHit = Math.sign(margin) === Math.sign(record.marketSpread) || record.marketSpread === 0;
      record.graded = true; record.gradedAt = new Date().toISOString();
      await redis.set(`result:${id}`, JSON.stringify(record));
      graded++;
    }
    return res.status(200).json({ ok: true, graded });
  } catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
}
