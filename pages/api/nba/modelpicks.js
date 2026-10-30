// Model bets pick tabs (10/28 late, owner: "Remove all the sub tabs under models bets and I need sub tabs for all the models picks in the card"; design =
// both sports): one day's SAVED card picks (spread / total PICK + PICK w/ POINTS, the ML PICK; the same choice as the card shows after tip-off,
// lib/record.js lockedFor) with W / L once graded, and each game's tip-off from ESPN's scoreboard. The page uses the live slate for the days it carries.
import { loadPicks, MB_FROM } from "../../../nba/lib/record";
import { finalsFor } from "../../../nba/lib/espn";
import { getRedis } from "../../../nba/lib/redis";
import { loadGameProps, gamePropsRecord } from "../../../nba/lib/gameprops";
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
    const gp = date ? await loadGameProps(getRedis(), keys.map((key) => ({ key, date }))).catch(() => ({})) : {};   // 10/30: the GAME PROPS picks (lib/gameprops.js)
    const games = keys.map((key) => { const [away, home] = key.split(" @ "), f = fin[key] || {};
      return { key, away, home, date, start: f.start || null, final: !!f.final, awayScore: f.away ?? null, homeScore: f.home ?? null, locked: by[key] || null, ...(gp[key] ? { gprops: gp[key] } : {}) }; });
    // 10/29 (owner: "records at the top of every tab in models bets"): the season's W-L of the same picks (every saved day; pushes count neither way)
    // 10/29 (owner: "start fresh ... only for model bets"): counted from 10/29 on (MB_FROM); every older day stays saved, graded and in the day drop-down
    const R = { spread: { w: 0, l: 0 }, spreadPts: { w: 0, l: 0 }, total: { w: 0, l: 0 }, totalPts: { w: 0, l: 0 }, ml: { w: 0, l: 0 } }, seen = {};
    for (const p of all) { if (!(p.date >= MB_FROM)) continue; const id = String(p.id || p.market), k = `${p.date}|${p.game}|${p.market}`;
      const slot = id === "ml" ? "ml" : /^ptspick\|/.test(id) ? `${p.market}Pts` : /^cardpick\|/.test(id) ? p.market : /^modelpick\|/.test(id) ? p.market : null; if (!slot || !R[slot]) continue;
      if (/^modelpick\|/.test(id) && all.some((x) => x.date === p.date && x.game === p.game && String(x.id) === `cardpick|${p.market}`)) continue;   // the card shows the rule pick
      const sk = `${k}|${slot}`; if (seen[sk]) continue; seen[sk] = 1;
      if (p.result === "win") R[slot].w++; else if (p.result === "loss") R[slot].l++; }
    R.gp = await gamePropsRecord(getRedis(), MB_FROM).catch(() => ({ w: 0, l: 0 }));
    res.status(200).json({ ok: true, date, days, games, records: R });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
