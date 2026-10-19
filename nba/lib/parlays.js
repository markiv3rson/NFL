// The model's parlays (the NFL app's Model bets, NBA version). Built on every slate build, saved once per day and type (the first sighting
// before the first leg tips off stands), graded when the games end, shown under Bets -> Model bets by day.
//   best4    the Parlay: the 4 strongest green lines (56%+, the card's PICK or PICK w/ POINTS, spread or total), one per game   $10
//            10/19 (owner: "1 yes 2 yes ... build now"): it was the top 4 green best bets, which on 10/20-21 were all moneylines = the same 4 legs as fav4;
//            fewer than 4 green lines that day -> a 3- or 2-leg Parlay with the ones there are (owner 10/19: "you decide what's best for me": fewer legs win more
//            often -- each leg ~60% (said 60.5 / won 59.9 on 22,683 games), so 2 legs ~36%, 3 ~22%, 4 ~13%); 1 or 0 green lines -> none
//   fav4     the 4 biggest moneyline favorites of the day (market win chance)              $10   (history 2008-26: all 4 won 36.4% of 2,583 days, the market said 35.5%)
//   sgp      same game, 2 legs: the card's spread PICK + total PICK at Polymarket's lines  $20   (spread and total are independent: chance = product);
//            10/19 (owner: "the same" as the NFL parlay fixes): only when BOTH legs are green (56%+) -- two of the model's 49-50% sides made a 25% coin flip on every game
//   sgp_pts  same game, 2 legs on bought lines: spread PICK w/ POINTS + total PICK w/ POINTS  $5
import { getRedis, jparse, mgetAll } from "./redis";
import { cardLegs, ptsLeg } from "./cardpick";
import { staleDate } from "./pinnacle";
const GREEN = 56;   // the card's green bar (lib/cardpick.js)
export const STAKES = { best4: 10, fav4: 10, sgp: 20, sgp_pts: 5 };
const IDS = "parlay:ids", KEY = (date, type, game) => `parlay:${date}:${type}${game ? ":" + game : ""}`;
const r3 = (x) => Math.round(x * 1000) / 1000;
const mk = (type, legs, game, start) => {
  if (!legs || !legs.length) return null;
  const pay = legs.every((l) => l.price > 0 && l.price < 1) ? legs.reduce((a, l) => a / l.price, 1) : null;
  return { type, game: game || null, start: start || null, stake: STAKES[type] || 10, legs, prob: r3(legs.reduce((a, l) => a * (l.prob || 0), 1)), pay: pay == null ? null : Math.round(pay * 100) / 100 };
};
const leg = (g, x) => ({ game: g.key, market: x.market, team: x.team || null, side: x.side || null, line: x.line ?? null, label: x.label, prob: r3((x.pct || 0) / 100), price: x.price > 0 && x.price < 1 ? x.price : null, ...(x.bought ? { bought: true, points: x.points } : {}) });
const mktHome = (g) => { const m = g.poly && g.poly.ml; return m && m.midHome > 0 && m.midAway > 0 ? m.midHome / (m.midHome + m.midAway) : null; };

export function buildParlays(games, bestBets) {
  const ahead = games.filter((g) => !g.inProgress && !g.preseason);
  const out = [];
  // 10/19 check: the card's own green PICK counts too (UTA @ MEM: LINE MOVE MEM +1.5 67.9% was the day's strongest line and was left out)
  const greens = ahead.map((g) => [...cardLegs(g), ptsLeg(g, "spread"), ptsLeg(g, "total")].filter((x) => x && x.line != null && x.pct >= GREEN).sort((a, b) => b.pct - a.pct).map((x) => ({ g, x }))[0]).filter(Boolean)
    .sort((a, b) => b.x.pct - a.x.pct).slice(0, 4);
  if (greens.length >= 2) out.push(mk("best4", greens.map(({ g, x }) => leg(g, x))));
  const favs = ahead.map((g) => { const ph = mktHome(g); if (ph == null || ph === 0.5) return null; const home = ph > 0.5, team = home ? g.home : g.away;
    return { g, p: home ? ph : 1 - ph, leg: { game: g.key, market: "ml", team, side: null, line: null, label: `${team} ML`, prob: r3(home ? ph : 1 - ph), price: g.poly.ml[home ? "home" : "away"] > 0 && g.poly.ml[home ? "home" : "away"] < 1 ? g.poly.ml[home ? "home" : "away"] : null } }; })
    // 10/19 (same as the NFL 4 biggest favorites): skip a game where our own green spread pick backs the underdog
    .filter((x) => { if (!x) return false; const sp = cardLegs(x.g).find((l) => l.market === "spread"); return !(sp && sp.pct >= GREEN && sp.team && sp.team !== x.leg.team); })
    .sort((a, b) => b.p - a.p).slice(0, 4);
  if (favs.length === 4) out.push(mk("fav4", favs.map((x) => x.leg)));
  for (const g of ahead) {
    const L = cardLegs(g), sp = L.find((x) => x.market === "spread"), tt = L.find((x) => x.market === "total");
    if (sp && tt && sp.pct >= GREEN && tt.pct >= GREEN) out.push(mk("sgp", [leg(g, sp), leg(g, tt)], g.key, g.start));
    const bs = ptsLeg(g, "spread"), bt = ptsLeg(g, "total");
    if (bs && bt) out.push(mk("sgp_pts", [leg(g, bs), leg(g, bt)], g.key, g.start));
  }
  return out.filter(Boolean);
}
// 10/19 (owner: "the same" as the NFL fix): a parlay is saved AND REBUILT on every slate build until its first leg tips off -- it was the first
// sighting (the day before), which could not see the day's injury news and rest decisions. A saved parlay that today's build no longer makes,
// while none of its games has started, leaves the record (moved to removed:<key>, nothing is deleted). A parlay with a started leg never changes.
export async function recordParlays(date, parlays, games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  const startOf = (p) => { if (p.start) return Date.parse(p.start); const ts = p.legs.map((l) => { const g = games.find((x) => x.key === l.game); return g ? Date.parse(g.start) : NaN; }); return ts.some((t) => !(t > 0)) ? NaN : Math.min(...ts); };
  const legsOf = (p) => JSON.stringify(p.legs.map((l) => [l.label, l.line]));
  const built = new Set();
  for (const p of parlays) {
    if (!(now < startOf(p))) continue;                               // only before the first leg tips off
    const k = KEY(date, p.type, p.game); built.add(k);
    const old = jparse(await r.get(k).catch(() => null));
    if (old && (old.result || legsOf(old) === legsOf(p))) continue;   // graded, or nothing changed
    await r.set(k, JSON.stringify({ ...p, date, t: new Date(now).toISOString(), ...(old ? { first: old.first || old.t } : {}) })).catch(() => null);
    await r.sadd(IDS, k).catch(() => {}); n++;
  }
  for (const k of (await r.smembers(IDS).catch(() => [])) || []) {
    if (!k.startsWith(`parlay:${date}:`) || built.has(k)) continue;
    const raw = await r.get(k).catch(() => null), old = jparse(raw);
    if (!old || old.result || !(now < startOf(old))) continue;
    await r.set(`removed:${k}`, raw).catch(() => {}); await r.del(k).catch(() => {}); await r.srem(IDS, k).catch(() => {});
  }
  return n;
}
export async function loadParlays() {
  const r = getRedis(), out = [], keys = (await r.smembers(IDS).catch(() => [])) || [];
  const vals = await mgetAll(r, keys).catch(() => []);                   // one batch per 200 parlays
  keys.forEach((k, i) => { const v = jparse(vals[i]); if (v) out.push({ ...v, _k: k }); });
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(a.start || "").localeCompare(String(b.start || ""))));
}
// result of one leg given the final score (same arithmetic as lib/record.js gradePick)
export function gradeLeg(l, away, home, f) {
  const margin = { [away]: f.away - f.home, [home]: f.home - f.away };
  if (l.market === "ml") { const m = margin[l.team]; return m === 0 ? "P" : m > 0 ? "W" : "L"; }
  if (l.market === "spread") { const d = margin[l.team] + l.line; return d === 0 ? "P" : d > 0 ? "W" : "L"; }
  if (l.market === "total") { const t = f.away + f.home; if (t === l.line) return "P"; return (t > l.line) === (l.side === "over") ? "W" : "L"; }
  return null;
}
export async function gradeParlays(fetchFinals) {
  const r = getRedis(), byDate = {}; let n = 0;
  for (const p of await loadParlays()) if (!p.result) (byDate[p.date] = byDate[p.date] || []).push(p);
  for (const [date, list] of Object.entries(byDate)) {
    let finals; try { finals = await fetchFinals(date); } catch { continue; }
    for (const p of list) {
      let changed = false;
      for (const l of p.legs) { if (l.result) continue; const f = finals[l.game]; if (!f || !f.final) { if (staleDate(date)) { l.result = "P"; changed = true; } continue; } const [away, home] = l.game.split(" @ "); l.result = gradeLeg(l, away, home, f); changed = true; }   // a leg whose game never happened is a push
      const res = p.legs.map((l) => l.result);
      if (res.some((x) => x === "L")) p.result = "L"; else if (res.every((x) => x === "W" || x === "P")) p.result = res.every((x) => x === "P") ? "P" : "W";
      if (p.result) { const won = p.legs.filter((l) => l.result === "W"), pay = won.length && won.every((l) => l.price > 0 && l.price < 1) ? won.reduce((a, l) => a / l.price, 1) : null;   // a pushed leg drops out of the payout
        p.ret = p.result === "W" ? (pay != null ? Math.round(p.stake * (pay - 1) * 100) / 100 : null) : p.result === "L" ? -p.stake : 0; changed = true; n++; }
      if (changed) { const { _k, ...row } = p; await r.set(_k, JSON.stringify(row)).catch(() => {}); }
    }
  }
  return n;
}
export function summarizeParlays(list) {
  const by = {};
  for (const p of list) { const e = (by[p.type] = by[p.type] || { n: 0, decided: 0, hits: 0, money: 0, said: 0, pending: 0 }); e.n++;
    if (p.result === "W" || p.result === "L") { e.decided++; e.said += p.prob || 0; if (p.result === "W") e.hits++; if (p.ret != null) e.money += p.ret; } else if (!p.result) e.pending++; }
  for (const e of Object.values(by)) { e.pct = e.decided ? Math.round((e.hits / e.decided) * 1000) / 10 : null; e.said = e.decided ? Math.round((e.said / e.decided) * 1000) / 10 : null; e.money = Math.round(e.money * 100) / 100; }
  return by;
}
