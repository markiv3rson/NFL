// Alerts feed (the bell): a short newest-first list of "what just happened", NBA only. Four kinds:
//   PICK       a new PICK / LEAN appeared (regular season; preseason TEST picks never alert)
//   LINE MOVE  a Polymarket line moved since the last time we told you (spread 1+ pt, total 2+ pts, moneyline 5+ cents)
//   INJURY     a rotation player (10+ ppg) newly listed Out / Doubtful / Questionable
//   RESULT     a PICK / LEAN was graded
// Each job calls addAlert() when it notices a difference; the same id inside ttlH hours is skipped so a repeated snapshot never
// re-alerts. Every call is wrapped so an alert problem can never break a snapshot or a grading run. Phone push is NOT built.
import { getRedis, jparse } from "./redis";
const KEY = "alerts:log", CAP = 200;
const sgn = (n) => (n > 0 ? "+" : "") + n;
export const MOVE = { spread: 1, total: 2, ml: 0.05 }, INJ_PPG = 10;

export async function addAlert(a, now = Date.now()) {
  try {
    const r = getRedis(), id = a.id || `${a.kind}|${a.game}|${a.title}`;
    const ok = await r.set(`alertseen:${id}`, "1", "EX", Math.round((a.ttlH || 12) * 3600), "NX");
    if (!ok) return 0;
    await r.lpush(KEY, JSON.stringify({ t: new Date(now).toISOString(), kind: a.kind, game: a.game || "", team: a.team || "", title: a.title, sub: a.sub || "" }));
    await r.ltrim(KEY, 0, CAP - 1);
    return 1;
  } catch { return 0; }
}
// 10/18 (owner): RESULT lines show at the top of the Bets tab (My bets), not in Alerts
export async function listAlerts(n = 100) {
  try { return (await getRedis().lrange(KEY, 0, n - 1)).map((x) => jparse(x)).filter((x) => x && x.kind !== "RESULT"); } catch { return []; }
}
export async function listResults(n = 40) {
  try { return (await getRedis().lrange(KEY, 0, CAP - 1)).map((x) => jparse(x)).filter((x) => x && x.kind === "RESULT").slice(0, n); } catch { return []; }
}

const lineNow = (g) => { const px = g.poly || {}; return { hs: px.spread ? px.spread.homeSpread : null, tl: px.total ? px.total.line : null, ml: px.ml ? px.ml.midHome / (px.ml.midHome + px.ml.midAway) : null }; };
const injKey = (t, p) => `${t}|${p.name}|${String(p.status).toLowerCase()}`;
const relevant = (p) => (p.ppg || 0) >= INJ_PPG && /out|doubtful|questionable/i.test(p.status || "");

// Called after every scheduled snapshot with the slate's game rows. A game with no earlier baseline only stores one
// (so the first look at a game never floods the feed with line moves / injuries); new PICKs are news from the first sighting.
export async function alertsFromSlate(games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (g.inProgress) continue;
    if (!g.preseason) {                                                  // new green picks: the card's PICK (56%+) and the moneyline PICK
      const legs = []; const ml = g.ml && g.ml.pick; if (ml && (ml.tier === "pick" || ml.tier === "lean") && ml.pct >= 56) legs.push({ market: "ml", label: ml.label, pct: ml.pct, who: ml.team });
      for (const k of ["spread", "total"]) { const c = g.card && g.card[k] && g.card[k].plain; if (c && c.hit >= 56) legs.push({ market: k, label: c.pick, pct: c.hit, who: c.team || c.side }); }
      for (const p of legs) n += await addAlert({ kind: "PICK", game: g.key, id: `pick|${g.date}|${g.key}|${p.market}|${p.who || p.label}`, ttlH: 36, title: `${g.key}: ${p.label} · ${Math.round(p.pct)}%`, sub: "" }, now);
    }
    // line moves, measured against the last line we told you about (slow drifts add up instead of hiding under the limit)
    const bkey = `alertbase:${g.date}:${g.key}`, cur = lineNow(g), base = jparse(await r.get(bkey).catch(() => null));
    if (!base) { await r.set(bkey, JSON.stringify(cur), "EX", 4 * 86400).catch(() => {}); }
    else {
      const next = { ...base };
      for (const f of ["hs", "tl", "ml"]) if (base[f] == null && cur[f] != null) next[f] = cur[f];   // a market posted after the first look gets its baseline now
      if (cur.hs != null && base.hs != null && Math.abs(cur.hs - base.hs) >= MOVE.spread) {
        n += await addAlert({ kind: "LINE MOVE", game: g.key, id: `lm|${g.date}|${g.key}|s|${cur.hs}`, title: `${g.key} spread: ${g.home} ${sgn(base.hs)} → ${sgn(cur.hs)}`, sub: "" }, now); next.hs = cur.hs; }
      if (cur.tl != null && base.tl != null && Math.abs(cur.tl - base.tl) >= MOVE.total) {
        n += await addAlert({ kind: "LINE MOVE", game: g.key, id: `lm|${g.date}|${g.key}|t|${cur.tl}`, title: `${g.key} total: ${base.tl} → ${cur.tl}`, sub: "" }, now); next.tl = cur.tl; }
      if (cur.ml != null && base.ml != null && Math.abs(cur.ml - base.ml) >= MOVE.ml) {
        n += await addAlert({ kind: "LINE MOVE", game: g.key, id: `lm|${g.date}|${g.key}|m|${Math.round(cur.ml * 100)}`, title: `${g.key}: ${g.home} moneyline ${Math.round(base.ml * 100)}¢ → ${Math.round(cur.ml * 100)}¢`, sub: "" }, now); next.ml = cur.ml; }
      if (next.hs !== base.hs || next.tl !== base.tl || next.ml !== base.ml) await r.set(bkey, JSON.stringify(next), "EX", 4 * 86400).catch(() => {});
    }
    // injuries: rotation players newly listed
    const ikey = `alertinj:${g.date}:${g.key}`, listed = [];
    for (const [side, team] of [["away", g.away], ["home", g.home]]) for (const p of ((g.injuries && g.injuries[side]) || [])) if (relevant(p)) listed.push({ team, p, k: injKey(team, p) });
    const had = jparse(await r.get(ikey).catch(() => null));
    if (had) for (const x of listed) if (!had.includes(x.k)) {
      n += await addAlert({ kind: "INJURY", game: g.key, team: x.team, id: `inj|${g.date}|${x.k}`,
        title: `${x.team}: ${x.p.name} ${/^out$/i.test(x.p.status) ? "ruled out" : String(x.p.status).toLowerCase()}`, sub: `${x.p.ppg} points a game.` }, now);
    }
    await r.set(ikey, JSON.stringify([...new Set([...(had || []), ...listed.map((x) => x.k)])]), "EX", 4 * 86400).catch(() => {});
  }
  return n;
}

export async function alertForResult(p, now = Date.now()) {
  if (!p || p.tier === "test" || !p.result || p.result === "void" || !(Number(p.pct) >= 56)) return 0;
  const word = p.result === "win" ? "Won" : p.result === "loss" ? "Lost" : "Push";
  return addAlert({ kind: "RESULT", game: p.game, id: `res|${p.date}|${p.game}|${p.market}`, ttlH: 72, title: `${word}: ${p.label} (${p.game})`, sub: p.final ? `Final ${p.final.away}–${p.final.home}.` : "" }, now);
}
