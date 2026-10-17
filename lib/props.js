// PLAYER PROPS (10/17, owner: "build now"; bar 65%): passing / rushing / receiving yards, receptions, pass attempts, completions,
// longest reception.
//  - recordProps: every 15-min pull saves each Polymarket prop line of a not-started game (Over / Under price, Over bid, liquidity, volume),
//    keeping the week's FIRST price next to the latest one. Redis `props:<season>:<week>:<game>` = { first, t, m: { "name|stat|line": [...] } }.
//  - The model's chances (Railway /rerun-prop-probs, prop_model.py) are saved by the rerun as `propmodel:<season>:<week>:<game>`; reruns skip
//    started games, so the last copy before kickoff is the locked one. Same for the prices.
//  - gradeProps: once a game is final, every line where the model gives a side 65%+ is graded from the official stats (Railway
//    /player-stats; a player who did not play = 0, Polymarket settles that as Under) and saved in `propres:<season>:<week>` (one field per game).
//  - A prop group (stat x side x model band) is SHOWN only when it passed the 65% bar in history AND on real Polymarket lines (PROP_PASS,
//    from tests/prop_backtest.py + tests/prop_real.py) -- otherwise it is only tracked.
import { getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";

export const PROP_BAR = 0.65;
export const PROP_LABEL = { pass_yds: "Passing yards", pass_att: "Pass attempts", pass_cmp: "Completions", rush_yds: "Rushing yards",
  rec_yds: "Receiving yards", rec: "Receptions", long_rec: "Longest reception" };
export const PROP_BANDS = [[0.65, 0.70], [0.70, 0.80], [0.80, 0.90], [0.90, 1.01]];
export const bandOf = (p) => { const b = PROP_BANDS.find(([lo, hi]) => p >= lo && p < hi); return b ? `${Math.round(b[0] * 100)}-${Math.min(100, Math.round(b[1] * 100))}` : null; };
// Groups that passed both tests: "stat|side|band" -> { hist: [won, n], real: [won, n] }. Filled from the tests (see the notes in CLAUDE.md).
export const PROP_PASS = {};
export const propKey = (r) => `${r.name}|${r.stat}|${r.line}`;
export const K_PROPS = (s, w, g) => `props:${s}:${w}:${g}`;
export const K_PROPMODEL = (s, w, g) => `propmodel:${s}:${w}:${g}`;
export const K_PROPRES = (s, w) => `propres:${s}:${w}`;

// rows from lib/poly.js statPropsFromMarkets. m[key] = [overAsk, overBid, underAsk, liq, vol, firstOverAsk, firstUnderAsk, firstTime]
export async function recordProps(redis, season, g, rows, t) {
  if (!rows || !rows.length || !g || g.week == null) return 0;
  const key = K_PROPS(season, g.week, g.key), old = (await getJSON(key)) || { first: t, m: {} }, m = { ...(old.m || {}) };
  for (const r of rows) {
    const k = propKey(r), o = m[k];
    m[k] = [r.oa, r.ob, r.ua, r.liq, r.vol, o ? o[5] : r.oa, o ? o[6] : r.ua, o ? o[7] : t];
  }
  await setJSON(key, { first: old.first || t, t, m });
  return rows.length;
}
export function propRows(saved) {
  if (!saved || !saved.m) return [];
  return Object.entries(saved.m).map(([k, v]) => { const [name, stat, line] = k.split("|");
    return { name, stat, line: Number(line), oa: v[0], ob: v[1], ua: v[2], liq: v[3], vol: v[4], oa0: v[5], ua0: v[6], t0: v[7] }; });
}
// A side the model gives 65%+ -> a pick (with the price that side costs at the last reading before kickoff).
export function propPicks(modelRows, saved) {
  const px = new Map(propRows(saved).map((r) => [propKey(r), r]));
  const out = [];
  for (const r of modelRows || []) {
    const side = r.over >= PROP_BAR ? "over" : r.under >= PROP_BAR ? "under" : null; if (!side) continue;
    const p = px.get(propKey(r)) || {}, chance = side === "over" ? r.over : r.under;
    out.push({ name: r.name, stat: r.stat, line: r.line, side, chance, mu: r.mu, band: bandOf(chance), price: side === "over" ? p.oa ?? null : p.ua ?? null,
      bid: side === "over" ? p.ob ?? null : p.ob != null ? Math.round((1 - p.ob) * 1000) / 1000 : null, liq: p.liq ?? null, team: r.team || null });
  }
  return out;
}
export const groupOf = (p) => `${p.stat}|${p.side}|${p.band}`;
export const shownProp = (p) => !!PROP_PASS[groupOf(p)];

// Official stats for a finished week from the Railway service: { "AWAY @ HOME": { "<normalized name>": { pass_yds, ... } } }
const statCache = new Map();
async function weekStats(season, week) {
  const base = modelBase(); if (!base) return null;
  const ck = `${season}:${week}`;
  if (!statCache.has(ck)) statCache.set(ck, fetch(`${base}/player-stats?season=${season}&week=${week}`, { cache: "no-store", headers: modelHeaders() }).then((r) => r.json()));
  try { const d = await statCache.get(ck); return d && d.ok ? d : null; } catch { statCache.delete(ck); return null; }
}
export const normName = (n) => String(n || "").toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").split(/\s+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w)).join(" ");

// Grade one final game's prop picks (once). The game's stats must be posted (the service lists the game) -- a player missing from them did not play.
export async function gradePropsGame(redis, season, week, g) {
  const rk = K_PROPRES(season, week);
  if (await redis.hexists(rk, g.key)) return 0;
  const model = await getJSON(K_PROPMODEL(season, week, g.key)); if (!model || !model.rows) return 0;
  const st = await weekStats(season, week); if (!st || !st.games || !st.games[g.key]) return 0;
  const box = st.games[g.key], saved = await getJSON(K_PROPS(season, week, g.key));
  const picks = propPicks(model.rows, saved).map((p) => {
    const s = box[normName(p.name)], v = s ? Number(s[p.stat] || 0) : 0;
    const over = v > p.line;
    return { ...p, actual: v, played: !!s, result: (p.side === "over" ? over : !over) ? "W" : "L" };
  });
  await redis.hset(rk, g.key, JSON.stringify({ t: new Date().toISOString(), runAt: model.runAt || null, picks }));
  return picks.length;
}
export async function gradePropsWeek(redis, season, week, games) {
  let n = 0;
  for (const g of games) if (g.final) n += await gradePropsGame(redis, season, week, g).catch(() => 0);
  return n;
}
// Live record per group (and overall) for the Models tab: { groups: { "stat|side|band": { w, l, shown } }, all: { w, l } }
export async function propSummary(redis, season, weeks) {
  const groups = {}, all = { w: 0, l: 0 };
  for (const w of weeks) {
    const h = await redis.hgetall(K_PROPRES(season, w)).catch(() => null); if (!h) continue;
    for (const v of Object.values(h)) { let d; try { d = JSON.parse(v); } catch { continue; }
      for (const p of d.picks || []) { const k = groupOf(p), x = groups[k] || (groups[k] = { w: 0, l: 0, shown: !!PROP_PASS[k] });
        if (p.result === "W") { x.w++; all.w++; } else if (p.result === "L") { x.l++; all.l++; } } }
  }
  return { groups, all };
}
