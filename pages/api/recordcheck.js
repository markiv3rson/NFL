// Read-only check (10/14, owner: "do your checks"): what the recorders actually saved, so they can be audited without database
// access. ?week=N (default: current week). Returns, per game: the latest 30-minute Pinnacle/Polymarket record (with the order book)
// and the saved card picks with their first line, latest/kickoff line, line value (CLV) and result. Saves nothing, changes nothing.
import { getRedis } from "../../lib/redis";
import { SEASON, currentWeek } from "../../lib/games";
import { skey, clvOf } from "../../lib/stack";
const jp = (x) => { try { return x ? JSON.parse(x) : null; } catch { return null; } };
export default async function handler(req, res) {
  try {
    const r = getRedis(), week = Number(req.query.week) || (await currentWeek(SEASON)), out = {};
    const pin = []; let c = "0";
    do { const [nx, ks] = await r.scan(c, "MATCH", `pinnacle:${SEASON}:${week}:*`, "COUNT", 200); c = nx; pin.push(...ks); } while (c !== "0");
    for (const k of pin) { const game = k.split(":").slice(3).join(":"), n = await r.llen(k), last = jp(await r.lindex(k, -1));
      (out[game] = out[game] || {}).pinnacle = { records: n, last }; }
    for (const [f, v] of Object.entries((await r.hgetall(skey(SEASON, week))) || {})) { const p = jp(v); if (!p || p.teaser) continue;
      (out[p.game] = out[p.game] || {}).picks = [...((out[p.game] || {}).picks || []), { id: p.id, pick: p.pick, hit: p.hit, first: p.first || null, line: p.line, savedAt: p.t, clv: clvOf(p), result: p.result || null }]; }
    res.status(200).json({ ok: true, season: SEASON, week, games: out });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
