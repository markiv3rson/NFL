// Background refresh of the real Polymarket parlay prices (10/17, owner: "I need it to refresh in the background all the time"). The scheduler calls
// /api/comboquotes?sport=nfl and ?sport=nba every 5 min; each re-quotes the parlays on that sport's pages whose price is older than 4 min
// (lib/comboquote.js refreshQuotes) for up to 40 s. Asks for quotes and closes them: never accepts, nothing is bought.
import { refreshQuotes } from "../../lib/comboquote";
import { getRedis } from "../../lib/redis";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const sport = req.query.sport === "nba" ? "nba" : "nfl";
    if (!process.env.POLYMARKET_KEY_ID || !process.env.POLYMARKET_SECRET_KEY) return res.status(200).json({ ok: false, why: "Polymarket keys not set" });
    const { PolymarketUS } = await import("polymarket-us");
    const client = new PolymarketUS({ keyId: process.env.POLYMARKET_KEY_ID, secretKey: process.env.POLYMARKET_SECRET_KEY, timeout: 8000 });
    const out = await refreshQuotes(client, sport);
    await getRedis().set(`cq:last:${sport}`, JSON.stringify({ t: new Date().toISOString(), ...out }), "EX", 86400).catch(() => {});
    res.status(200).json({ ok: true, sport, ...out });
  } catch (err) { res.status(500).json({ ok: false, why: String(err) }); }
}
