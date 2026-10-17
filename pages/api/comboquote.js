// Real Polymarket combo price for one parlay (10/17, owner: "I need the real price"). POST { legs, kick: { game: kickoff }, stake } ->
// { ok, pay, price } from a live Polymarket US quote (lib/comboquote.js). Asks for a quote and closes it: never accepts, nothing is bought.
// The same parlay's quote is shared for 7 min (lib/comboquote.js); { fresh: true } (a tap) asks again. ?raw=1 adds every Polymarket reply.
// NBA pages use /api/nba/comboquote (the same handler, NBA markets).
import { realQuote } from "../../lib/comboquote";
export const config = { maxDuration: 30 };

export const quoteHandler = (sport) => async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, why: "POST only" });
    if (!process.env.POLYMARKET_KEY_ID || !process.env.POLYMARKET_SECRET_KEY) return res.status(200).json({ ok: false, why: "Polymarket keys not set" });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const legs = Array.isArray(b.legs) ? b.legs.filter((l) => l && l.game && l.label) : [], stake = Number(b.stake) > 0 ? Math.round(Number(b.stake) * 100) / 100 : 10;
    if (legs.length < 2 || legs.length > 10) return res.status(200).json({ ok: false, why: "a combo has 2 to 10 legs" });
    const { PolymarketUS } = await import("polymarket-us");
    const client = new PolymarketUS({ keyId: process.env.POLYMARKET_KEY_ID, secretKey: process.env.POLYMARKET_SECRET_KEY, timeout: 8000 });
    const log = [], out = await realQuote(client, legs, b.kick || {}, stake, log, { fresh: !!b.fresh, sport });
    res.status(200).json({ ...out, ...(req.query.raw ? { log } : {}) });
  } catch (err) { res.status(500).json({ ok: false, why: String(err) }); }
};
export default quoteHandler("nfl");
