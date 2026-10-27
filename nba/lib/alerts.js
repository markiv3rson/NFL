// Alerts feed (the bell): a short newest-first list of "what just happened", NBA only. Three kinds:
//   PICK       a new PICK / LEAN appeared (regular season; preseason TEST picks never alert)
//   LINE MOVE  a Polymarket line moved since the last time we told you (spread 1+ pt, total 2+ pts, moneyline 5+ cents) and held 20+ min
//   INJURY     a rotation player (10+ ppg) newly listed Out / Doubtful / Questionable
// Each job calls addAlert() when it notices a difference; the same id inside ttlH hours is skipped so a repeated snapshot never
// re-alerts. Every call is wrapped so an alert problem can never break a snapshot or a grading run. Phone push is NOT built.
import { getRedis, jparse } from "./redis";
const KEY = "alerts:log", CAP = 200;
const sgn = (n) => (n > 0 ? "+" : "") + n;
export const MOVE = { spread: 1, total: 2, ml: 0.05 }, INJ_PPG = 10, MOVE_HOLD_MIN = 20;

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
// Old RESULT lines (cut 10/18 with the Results page) stay hidden.
export async function listAlerts(n = 100) {
  try { return (await getRedis().lrange(KEY, 0, n - 1)).map((x) => jparse(x)).filter((x) => x && x.kind !== "RESULT"); } catch { return []; }
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
      // 10/21 recheck: remembered 4 days like the line / injury baselines (36 h re-alerted the same pick on game day: UTA @ MEM MEM -1.5, PHI @ NYK NYK ML)
      for (const p of legs) n += await addAlert({ kind: "PICK", game: g.key, id: `pick|${g.date}|${g.key}|${p.market}|${p.who || p.label}`, ttlH: 96, title: `${g.key}: ${p.label} · ${Math.round(p.pct)}%`, sub: "" }, now);
    }
    // line moves, measured against the last line we told you about (slow drifts add up instead of hiding under the limit)
    const bkey = `alertbase:${g.date}:${g.key}`, cur = lineNow(g), base = jparse(await r.get(bkey).catch(() => null));
    if (!base) { await r.set(bkey, JSON.stringify(cur), "EX", 4 * 86400).catch(() => {}); }
    else {
      const next = { ...base, pend: { ...(base.pend || {}) } };
      for (const f of ["hs", "tl", "ml"]) if (base[f] == null && cur[f] != null) next[f] = cur[f];   // a market posted after the first look gets its baseline now
      // 10/23: a move alerts only when the new line still holds on a reading MOVE_HOLD_MIN+ after it first showed (Polymarket's main line flickers
      // on thin books: 20 of 50 back-to-back NBA line-move alerts 10/21-22 were exact reversals, TOR @ WAS +4.5 -> +1.5 -> +4.5 in 7 minutes)
      const say = { hs: (b, c) => `${g.key} spread: ${g.home} ${sgn(b)} → ${sgn(c)}`, tl: (b, c) => `${g.key} total: ${b} → ${c}`, ml: (b, c) => `${g.key}: ${g.home} moneyline ${Math.round(b * 100)}¢ → ${Math.round(c * 100)}¢` };
      const lim = { hs: MOVE.spread, tl: MOVE.total, ml: MOVE.ml }, tag = { hs: "s", tl: "t", ml: "m" };
      for (const f of ["hs", "tl", "ml"]) {
        if (cur[f] == null || base[f] == null) continue;
        if ((f === "hs" && Math.abs(cur[f] - base[f]) >= 10) || (f === "tl" && Math.abs(cur[f] - base[f]) >= 15)) { next[f] = cur[f]; delete next.pend[f]; continue; }   // 10/26: a placeholder baseline (Over 195.5), not a move -- re-based, no alert
        if (Math.abs(cur[f] - base[f]) < lim[f]) { delete next.pend[f]; continue; }   // back within the limit: the flicker is forgotten
        const pd = next.pend[f], same = pd && Math.sign(pd.v - base[f]) === Math.sign(cur[f] - base[f]);
        if (!same) { next.pend[f] = { v: cur[f], t: new Date(now).toISOString() }; continue; }
        if (now - Date.parse(pd.t) < MOVE_HOLD_MIN * 60e3) { next.pend[f] = { ...pd, v: cur[f] }; continue; }
        n += await addAlert({ kind: "LINE MOVE", game: g.key, id: `lm|${g.date}|${g.key}|${tag[f]}|${f === "ml" ? Math.round(cur[f] * 100) : cur[f]}`, title: say[f](base[f], cur[f]), sub: "" }, now);
        next[f] = cur[f]; delete next.pend[f];
      }
      if (JSON.stringify(next) !== JSON.stringify({ ...base, pend: base.pend || {} })) await r.set(bkey, JSON.stringify(next), "EX", 4 * 86400).catch(() => {});
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
