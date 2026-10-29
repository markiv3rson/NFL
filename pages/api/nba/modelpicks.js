// Model bets pick tabs (10/28 late, owner: "Remove all the sub tabs under models bets and I need sub tabs for all the models picks in the card"; design =
// both sports): one day's SAVED card picks (spread / total PICK + PICK w/ POINTS, the ML PICK; the same choice as the card shows after tip-off,
// lib/record.js lockedFor) with W / L once graded, and each game's tip-off from ESPN's scoreboard. The page uses the live slate for the days it carries.
import { loadPicks } from "../../../nba/lib/record";
import { finalsFor } from "../../../nba/lib/espn";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const all = (await loadPicks()).filter((p) => p.result !== "void"), days = [...new Set(all.map((p) => p.date))].sort();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? String(req.query.date) : days[days.length - 1] || null;
    const fin = date ? await finalsFor(date).catch(() => ({})) : {}, by = {};
    for (const p of all.filter((x) => x.date === date)) {
      const id = String(p.id || p.market), k = p.market === "ml" ? "ml" : p.market, slot = /^ptspick\|/.test(id) ? "pts" : "plain", L = (by[p.game] = by[p.game] || {});
      if (!/^(ml|cardpick\|(spread|total)|modelpick\|(spread|total)|ptspick\|(spread|total))$/.test(id)) continue;
      if (slot === "plain" && /^modelpick\|/.test(id) && L[k] && L[k].plain) continue;   // a rule pick saved later outranks the earlier model pick (lockedFor)
      (L[k] = L[k] || {})[slot] = { label: p.label, pct: p.pct, result: p.result || null, price: p.price ?? null };
    }
    const keys = [...new Set([...Object.keys(by), ...Object.keys(fin)])];
    const games = keys.map((key) => { const [away, home] = key.split(" @ "), f = fin[key] || {};
      return { key, away, home, date, start: f.start || null, final: !!f.final, awayScore: f.away ?? null, homeScore: f.home ?? null, locked: by[key] || null }; });
    res.status(200).json({ ok: true, date, days, games });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
