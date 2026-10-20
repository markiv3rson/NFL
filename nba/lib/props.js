// NBA player props (10/20, owner: "find everything that works"): Polymarket US now lists them (opening night BOS @ DET: 159 markets -- points, rebounds,
// assists, threes, steals, blocks as "N+" ladders; until 10/20 the notes said there were none). Nothing is SHOWN: this only RECORDS every prop line of a
// not-started game on each slate build (first price next to the latest), the same background step the NFL props went through before their research on
// real lines (lib/props.js). Key `nbaprops:<ET date>:<AWAY @ HOME>` = { first, t, m: { "name|stat|line": [overAsk, overBid, underAsk, firstOverAsk, firstTime] } }.
// "N+" = Over N-0.5. The NBA prop model (nba/railway-model-service/research/props_model.py) is research only; its real-line test can run on these.
import { getJSON, setJSON } from "./redis";
const STAT = { basketball_player_points: "pts", basketball_player_rebounds: "reb", basketball_player_assists: "ast", basketball_player_threes: "3pm",
  basketball_player_steals: "stl", basketball_player_blocks: "blk" };
const q = (x) => { const v = Number(x && typeof x === "object" ? x.value : x); return v > 0 && v < 1 ? Math.round(v * 1000) / 1000 : null; };
export const K_NBAPROPS = (date, key) => `nbaprops:${date}:${key}`;
export const nbaPropName = (m) => String((m && (m.title || m.titleShort)) || "").replace(/\s+\d+\+\s.*$/, "").trim();
export function nbaPropsFromEvent(ev) {
  const out = [];
  for (const m of (ev && (ev.rawProps || ev.markets)) || []) {
    const stat = STAT[String(m.sportsMarketType || "")]; if (!stat || m.closed || m.active === false) continue;
    const n = Number(m.line), name = nbaPropName(m); if (!isFinite(n) || !name) continue;
    const ask = q(m.bestAskQuote), bid = q(m.bestBidQuote);
    out.push({ name, stat, line: n - 0.5, oa: ask, ob: bid, ua: bid != null ? Math.round((1 - bid) * 1000) / 1000 : null });
  }
  return out;
}
export async function recordNbaProps(date, key, rows, t) {
  if (!rows || !rows.length || !date || !key) return 0;
  const k = K_NBAPROPS(date, key), old = (await getJSON(k)) || { first: t, m: {} }, m = { ...(old.m || {}) };
  for (const r of rows) { const f = `${r.name}|${r.stat}|${r.line}`, o = m[f]; m[f] = [r.oa, r.ob, r.ua, o ? o[3] : r.oa, o ? o[4] : t]; }
  await setJSON(k, { first: old.first || t, t, m });
  return rows.length;
}
