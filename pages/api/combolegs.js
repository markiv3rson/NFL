// One-time lookup (10/14, owner): get back the legs of OLD settled Polymarket combos. Polymarket drops a combo's legs from the account
// list once it settles, so combos from before 10/11 never had their legs saved. This asks Polymarket for each combo by its id and saves
// any legs it finds (`combolegs:<id>`, the same place the account sync saves them), so the Bets tab can show and count them.
// Read-only toward Polymarket. Safe to run again: combos that already have legs are skipped. ?raw=1 adds one sample reply.
import { getJSON, setJSON } from "../../lib/redis";
import { slimLegs } from "../../lib/mybets";
export const config = { maxDuration: 60 };

// Any array of leg-like objects (Polymarket market slugs asc- / tsc- / astatc-) anywhere in the reply
export function findLegs(x, depth = 0) {
  if (!x || typeof x !== "object" || depth > 6) return null;
  if (Array.isArray(x)) {
    if (x.length && x.every((l) => l && typeof l === "object" && /^(asc|tsc|astatc|aml|mlc|sc)-/.test(String(l.slug || l.marketSlug || "")))) return x.map((l) => ({ ...l, slug: l.slug || l.marketSlug }));
    for (const v of x) { const f = findLegs(v, depth + 1); if (f) return f; }
    return null;
  }
  for (const v of Object.values(x)) { const f = findLegs(v, depth + 1); if (f) return f; }
  return null;
}

async function lookup(id, client) {
  const tries = [
    ["gateway market", () => fetch(`https://gateway.polymarket.us/v1/market/slug/${id}`, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : { status: r.status }))],
    ["gateway settlement", () => fetch(`https://gateway.polymarket.us/v1/markets/${id}/settlement`, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : { status: r.status }))],
  ];
  if (client) tries.push(["account market", () => client.markets.retrieveBySlug(id)]);
  const seen = [];
  for (const [name, f] of tries) {
    const r = await f().catch((e) => ({ error: String(e).slice(0, 120) }));
    const legs = findLegs(r); seen.push({ name, reply: r });
    if (legs) return { legs, via: name, seen };
  }
  return { legs: null, seen };
}

export default async function handler(req, res) {
  try {
    const ledger = (await getJSON("mybets:ledger")) || {};
    const ids = Object.values(ledger).map((e) => e && e.id).filter((id) => /^caoc-/.test(id || ""));
    let client = null;
    try { if (process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY) { const { PolymarketUS } = await import("polymarket-us"); client = new PolymarketUS({ keyId: process.env.POLYMARKET_KEY_ID, secretKey: process.env.POLYMARKET_SECRET_KEY }); } } catch {}
    const todo = [];
    for (const id of ids) if (!(await getJSON(`combolegs:${id}`).catch(() => null)) && !(await getJSON(`combopicks:${id}`).catch(() => null))) todo.push(id);
    let found = 0, sample = null; const via = {};
    for (let i = 0; i < todo.length; i += 6) {
      const out = await Promise.all(todo.slice(i, i + 6).map(async (id) => ({ id, ...(await lookup(id, client)) })));
      for (const o of out) {
        if (!sample) sample = { id: o.id, seen: o.seen.map((s) => ({ name: s.name, reply: JSON.stringify(s.reply).slice(0, 1500) })) };
        if (o.legs) { await setJSON(`combolegs:${o.id}`, slimLegs(o.legs)); found++; via[o.via] = (via[o.via] || 0) + 1; }
      }
    }
    const result = !todo.length ? `All ${ids.length} combos already have their legs saved.`
      : found ? `Found the legs for ${found} of ${todo.length} old combos. Open the Bets tab to see them.`
      : `Polymarket did not give back the legs for any of the ${todo.length} old combos. Their legs can't be recovered.`;
    res.status(200).json({ ok: true, result, combos: ids.length, alreadySaved: ids.length - todo.length, checked: todo.length, found, via, ...(req.query.raw ? { sample } : {}) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
