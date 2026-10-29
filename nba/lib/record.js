// Pick tracking and grading. Every pick the card shows is saved before tip-off (a tested rule's PICK at first sighting, the rest as the card shows
// them at the last snapshot before tip-off, 10/29 night) and graded after the game,
// with the Polymarket price it was shown at (so the Models tab can show W-L AND money per $100). Win rate is the judge, never price.
// Ids: ml (the moneyline PICK = the market's win chance), cardpick|spread / cardpick|total (a tested rule's side at Polymarket's line),
// modelpick|spread / modelpick|total (no rule: the model's side), ptspick|spread / ptspick|total (PICK w/ POINTS). Preseason rows are tier "test".
import { getRedis, jparse, mgetAll } from "./redis";
import { staleDate } from "./pinnacle";
import { finalsFor } from "./espn";
const KEY = (date, game, id) => `pick:${date}:${game}:${id}`;
const IDS = "pick:ids";
// 10/29 (owner: "start fresh and record all of our picks starting today ... only for model bets"): the Model bets record tiles count from this day on
export const MB_FROM = "2026-10-29";
export const pickRows = (g) => {
  const rows = [], test = !!g.preseason, base = (id, market, x) => ({ date: g.date, game: g.key, id, market, label: x.label || x.pick, team: x.team || null, side: x.side || null, line: x.line ?? null,
    pct: x.pct ?? x.hit, tier: test ? "test" : "pick", ruleId: x.ruleId || null, points: x.points || 0, price: x.price > 0 && x.price < 1 ? x.price : null, ...(x.alt ? { alt: true } : {}), savedAt: new Date().toISOString() });
  const ml = g.ml && g.ml.pick;
  if (ml && (ml.tier === "pick" || ml.tier === "lean" || ml.tier === "test") && ml.team) rows.push(base("ml", "ml", { ...ml, price: g.priceFor ? g.priceFor("ml", ml) : ml.price, pct: ml.pct }));
  const card = g.card; if (!card) return rows;
  for (const k of ["spread", "total"]) { const c = card[k]; if (!c) continue;
    if (c.plain && c.plain.line != null) rows.push(base(c.plain.id, k, c.plain));
    if (c.pts && c.pts.line != null) rows.push({ ...base(c.pts.id, k, c.pts), r72: true }); }   // r72: chosen by the 10/29 late 72% / 82c rule
  return rows;
};
// the side of a pick: the team on a spread, Over / Under on a total
const sideOf = (x) => (x ? (x.market === "total" ? x.side : x.team) : null);
// 10/29 night recheck: the ML PICK, the model-side PICK and the PICK w/ POINTS follow the card until tip-off (the last snapshot, 3 min before tip, is the
// one graded and shown after tip-off, as the NFL card's kickoff copy). They were the first sighting -- often the day-early line: 10/30's picks saved on
// 10/29 read MIA -3.5 / HOU -5.5 / BOS -11.5 while the cards showed MIA -7.5 / DAL +5.5 / CHI +13.5, so the card flipped at tip-off and the record graded
// a pick the page had stopped showing. Their tested rates come from closing lines. A tested rule's PICK (cardpick) keeps its first sighting (LINE MOVE
// is measured at the open). Every replaced row stays under first:<key> (the first sighting, written once).
const FOLLOW = /^(ml|modelpick\|(spread|total)|ptspick\|(spread|total))$/;
const sameRow = (a, b) => a.label === b.label && Number(a.pct) === Number(b.pct) && Number(a.points || 0) === Number(b.points || 0) && !!a.alt === !!b.alt;
export async function recordPicks(games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (g.start && now >= Date.parse(g.start)) continue;       // only picks seen before tip-off count
    const rows = pickRows(g);
    // 10/20 review (one side per game, 10/19): the saved PICK of each market decides the side; a PICK w/ POINTS on the OTHER side is never saved, and
    // one saved on the other side is replaced before tip-off by the card's line on the PICK's side, or leaves the record when the card has none.
    // Nothing is deleted: the first replaced row is kept under removed:<key> (written once).
    const ids = ["ml", ...["spread", "total"].flatMap((k) => [`ptspick|${k}`, `cardpick|${k}`, `modelpick|${k}`])], cur = {};
    const vals = ((await r.mget(...ids.map((id) => KEY(g.date, g.key, id))).catch(() => null)) || []).map(jparse);   // one command per game
    ids.forEach((id, i) => { cur[id] = vals[i] || null; });
    const pickOf = (k) => cur[`cardpick|${k}`] || rows.find((x) => x.market === k && /^(cardpick|modelpick)\|/.test(x.id)) || cur[`modelpick|${k}`] || null;
    for (const row of rows) {
      // 10/29 night: a model-side spread's PICK w/ POINTS may sit on the other team on purpose (alt: the team whose 5-10 point line wins more)
      if (/^ptspick\|/.test(row.id) && !row.alt) { const pk = pickOf(row.market); if (pk && sideOf(pk) !== sideOf(row)) continue; }
      if (isStubPick(row)) continue;   // 10/26: a placeholder line (a side at 0.9+) is never saved as a pick
      const key = KEY(row.date, row.game, row.id), old = cur[row.id];
      if (!old) { if (!(await r.set(key, JSON.stringify(row), "NX"))) continue; await r.sadd(IDS, key); cur[row.id] = row; n++; continue; }   // new (NX: one command)
      // 10/29 late (owner: "make sure it saves the new rule"): a PICK w/ POINTS saved before the 72% / 82c rule went live (no r72 mark) is re-saved
      // once with the card's line before tip-off; the old row stays under removed:<key> (written once). Only games not started reach this loop.
      if (/^ptspick\|/.test(row.id) && !old.r72 && (old.label !== row.label || Number(old.points) !== Number(row.points))) {   // the same line under both rules: kept as saved
        await r.set(`removed:${key}`, JSON.stringify({ ...old, removedAt: new Date(now).toISOString(), why: "PICK w/ POINTS saved under the old fewest-points rule (10/29 late: 72% / 82c)" }), "NX");
        await r.set(key, JSON.stringify(row)); await r.sadd(IDS, key); cur[row.id] = row; n++; continue;
      }
      if (!FOLLOW.test(row.id) || sameRow(old, row)) continue;   // a rule's PICK: the first sighting stands; an unchanged pick costs nothing
      await r.set(`first:${key}`, JSON.stringify(old), "NX");
      await r.set(key, JSON.stringify({ ...row, firstSavedAt: old.firstSavedAt || old.savedAt || null })); cur[row.id] = row; n++;
    }
    for (const k of ["spread", "total"]) {
      const pk = KEY(g.date, g.key, `ptspick|${k}`), old = cur[`ptspick|${k}`], pick = cur[`cardpick|${k}`] || cur[`modelpick|${k}`];
      // 10/26 night: the card no longer buys points on the model-side TOTAL, so a saved ptspick|total under a modelpick|total (saved before the change) leaves the record before tip-off too
      const noneNow = !!old && !!pick && k === "total" && pick.id === "modelpick|total" && !rows.some((x) => x.id === "ptspick|total");
      if (!old || !pick || ((sideOf(old) === sideOf(pick) || old.alt) && !noneNow)) continue;
      const repl = rows.find((x) => x.id === `ptspick|${k}` && sideOf(x) === sideOf(pick));
      await r.set(`removed:${pk}`, JSON.stringify({ ...old, removedAt: new Date(now).toISOString(), why: noneNow ? "no PICK w/ POINTS on the model-side total (10/26)" : "PICK w/ POINTS on the other side of the PICK" }), "NX");
      if (repl) await r.set(pk, JSON.stringify(repl)); else { await r.del(pk); await r.srem(IDS, pk); }
      n++;
    }
  }
  return n;
}
// result of one pick given the final score: "win" | "loss" | "push"
export function gradePick(p, away, home, f) {
  const margin = { [away]: f.away - f.home, [home]: f.home - f.away };
  if (p.market === "ml") { const m = margin[p.team]; return m === 0 ? "push" : m > 0 ? "win" : "loss"; }
  if (p.market === "spread") { const d = margin[p.team] + p.line; return d === 0 ? "push" : d > 0 ? "win" : "loss"; }
  if (p.market === "total") { const t = f.away + f.home; if (t === p.line) return "push"; return (t > p.line) === (p.side === "over") ? "win" : "loss"; }
  return null;
}
export async function loadPicks() {
  const r = getRedis(); const ids = await r.smembers(IDS); const out = [];
  const vals = await mgetAll(r, ids);                                   // one batch per 200 picks, not one read per pick
  ids.forEach((k, i) => { const v = jparse(vals[i]); if (v) out.push({ ...v, id: v.id || v.market, _k: k }); });
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}
// 10/26 recheck: a spread / total pick saved on a PLACEHOLDER line (a side priced 0.9+ = nobody selling; Polymarket's stub for a game posted a day
// early, e.g. "Over 195.5" at 0.99) is void -- it was never a bettable line, and two such stubs had been graded free wins (LAC @ OKC Over 193.5,
// WAS @ CHI Under 255.5). The parser no longer makes a main line of one (lib/poly.js twoSided); this voids the ones already saved, graded or not.
export const STUB_PRICE = 0.9;
export const isStubPick = (p) => (p.market === "spread" || p.market === "total") && p.price != null && (p.price >= STUB_PRICE || p.price <= 1 - STUB_PRICE);
export async function voidStubPicks(picks = null) {
  const r = getRedis(); let n = 0;
  for (const p of picks || (await loadPicks())) {
    if (!isStubPick(p) || p.result === "void") continue;
    const { _k, ...row } = p; row.was = row.result || null; row.result = "void"; row.voided = "placeholder line";
    await r.set(_k || KEY(row.date, row.game, row.id), JSON.stringify(row)); n++;
  }
  return n;
}
export async function gradeAll(fetchFinals = finalsFor) {
  const r = getRedis(), picks = await loadPicks(), byDate = {};
  await voidStubPicks(picks).catch(() => 0);
  for (const p of picks) if (!p.result && !isStubPick(p)) (byDate[p.date] = byDate[p.date] || []).push(p);
  let graded = 0;
  for (const [date, list] of Object.entries(byDate)) {
    let finals; try { finals = await fetchFinals(date); } catch { continue; }
    for (const p of list) {
      const f = finals[p.game], { _k, ...row } = p;
      if (!f || !f.final) { if (staleDate(date)) { row.result = "void"; await r.set(_k || KEY(row.date, row.game, row.id), JSON.stringify(row)); graded++; } continue; }   // postponed / moved game: closed out as void, not pending forever
      const [away, home] = p.game.split(" @ ");
      row.result = gradePick(row, away, home, f); row.final = { away: f.away, home: f.home }; row.gradedAt = new Date().toISOString();
      await r.set(_k || KEY(row.date, row.game, row.id), JSON.stringify(row)); graded++;
    }
  }
  return graded;
}
// money per pick at the saved Polymarket price, $100 a pick: a win pays 100 / price - 100, a loss -100
export const retOf = (p) => (!p.result || p.result === "push" || p.result === "void" ? 0 : p.result === "win" ? (p.price > 0 && p.price < 1 ? 100 / p.price - 100 : null) : -100);
export function summarize(picks) {
  const by = {};
  const add = (k, p) => { const e = (by[k] = by[k] || { w: 0, l: 0, push: 0, pending: 0, saidSum: 0, saidN: 0, stk: 0, ret: 0 });
    if (p.result === "win" || p.result === "loss") { e.saidSum += Number(p.pct) || 0; e.saidN++; const m = retOf(p); if (m != null) { e.stk += 100; e.ret += m; } }
    if (!p.result) e.pending++; else if (p.result === "win") e.w++; else if (p.result === "loss") e.l++; else if (p.result !== "void") e.push++; };
  for (const p of picks) {
    const id = p.id || p.market;
    if (p.result === "void") continue;                                           // a postponed game's pick is in no row
    if (p.tier === "test") { add("test", p); add(`test:${id}`, p); continue; }
    add(id, p);
    if (/^ptspick\|/.test(id)) { add("pts", p); continue; }                       // bought lines are their own record
    add("all", p); if (p.market !== id) add(p.market, p); if (Number(p.pct) >= 56) add("green", p);
    if (/^modelpick\|/.test(id)) add("model", p); else if (/^cardpick\|/.test(id)) { add("rule", p); if (p.ruleId) add(`rule:${p.ruleId}`, p); }   // each tested rule keeps its own record
  }
  for (const e of Object.values(by)) { e.pct = e.w + e.l ? Math.round((e.w / (e.w + e.l)) * 1000) / 10 : null; e.said = e.saidN ? Math.round((e.saidSum / e.saidN) * 10) / 10 : null;
    e.per100 = e.stk ? Math.round((e.ret / e.stk) * 100) : null; delete e.saidSum; delete e.saidN; delete e.stk; delete e.ret; }
  return by;
}

// Closing-line value (CLV): the number the pick was first shown at vs where Polymarket closed (+ = beat the close). Spread: the team's own line,
// e.g. +4.5 first and +3.5 at the close = +1. Total: over gains when the line closes higher, under when it closes lower. Moneyline has no line.
export function clvOf(p, close) {
  if (!p || !close || p.line == null || p.tier === "test" || (p.points || 0) > 0) return null;
  if (p.market === "spread") {
    if (close.hs == null) return null;
    const [away, home] = p.game.split(" @ "); const cl = p.team === home ? close.hs : p.team === away ? -close.hs : null;
    return cl == null ? null : Math.round((p.line - cl) * 100) / 100;
  }
  if (p.market === "total") {
    if (close.tl == null) return null;
    return Math.round((p.side === "under" ? p.line - close.tl : close.tl - p.line) * 100) / 100;
  }
  return null;
}
export function clvSummary(picks, closes) {
  const by = {}; for (const c of closes || []) by[`${c.date}|${c.game}`] = c;
  let n = 0, sum = 0, beat = 0, same = 0;
  for (const p of picks) { const v = clvOf(p, by[`${p.date}|${p.game}`]); if (v == null) continue; n++; sum += v; if (v > 0) beat++; else if (v === 0) same++; }
  return { n, avg: n ? Math.round((sum / n) * 100) / 100 : null, beat, same, worse: n - beat - same, beatPct: n ? Math.round((beat / n) * 1000) / 10 : null };
}

// After tip-off the card shows the picks saved before it (a rule's first sighting, the rest as at the last snapshot before tip-off), with W / L once graded.
const LOCK_IDS = ["ml", "cardpick|spread", "modelpick|spread", "ptspick|spread", "cardpick|total", "modelpick|total", "ptspick|total"];
export async function lockedFor(date, game) {
  const r = getRedis(), out = {};
  const vals = await mgetAll(r, LOCK_IDS.map((id) => KEY(date, game, id))).catch(() => []);   // one command per game
  for (const [i, id] of LOCK_IDS.entries()) {
    const v = jparse(vals[i]); if (!v) continue;
    const k = v.market, slot = /^ptspick\|/.test(id) ? "pts" : "plain";
    if (slot === "plain" && /^modelpick\|/.test(id) && out[k] && out[k].plain) continue;   // a rule pick saved later outranks the earlier model pick
    (out[k] = out[k] || {})[slot] = { label: v.label, pct: v.pct, result: v.result || null, price: v.price ?? null };
  }
  return Object.keys(out).length ? out : null;
}
