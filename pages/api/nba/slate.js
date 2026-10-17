import { buildSlate } from "../../../nba/lib/slate";
import { getRedis, SLATE_CACHE, BUILD } from "../../../nba/lib/redis";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    res.setHeader("x-build", BUILD);   // which deployment answered (the page reloads itself when this changes)
    const c = await getRedis().get(SLATE_CACHE).catch(() => null);
    if (c) { res.setHeader("Content-Type", "application/json"); return res.status(200).send(c); }
    const data = await buildSlate({ days: Number(req.query.days) || 1 });
    const body = JSON.stringify(data);
    await getRedis().set(SLATE_CACHE, body, "EX", 60).catch(() => {});
    res.setHeader("Content-Type", "application/json"); res.status(200).send(body);
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
