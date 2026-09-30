// Polymarket-vs-sportsbooks edge tracker (added 9/30). The one realistic edge for a Polymarket bettor is Polymarket's
// price lagging the sportsbook consensus: backtests (2006-25) found no stats-based way to beat the CLOSING sportsbook
// line, so the model is not the edge -- the price gap is. This logs every time a Polymarket price is 3%+ better than
// the FRESH no-vig sportsbook fair price (books pulled within 3 h), then grades each spot at the result and at the
// closing Polymarket price. The Record tab shows whether these spots actually win -- measured, not assumed.
import { getRedis, getJSON, setJSON, K } from "./redis";
import { gameBets } from "./picks";

export const EDGE_MIN = 0.03, BOOKS_MAX_AGE_H = 3;
const key = (s, w) => `edgelog:${s}:${w}`;

// label -> { team, line } (spread), { team } (ml), { side, line } (total), from gameBets' own label format
function parse(b) {
  const m = b.label.match(/^(\S+) ([+-]?\d+(?:\.\d+)?)$/);
  if (b.market === "spread" && m) return { team: m[1], line: Number(m[2]) };
  if (b.market === "ml") return { team: b.label.replace(/ ML$/, "") };
  const t = b.label.match(/^(Over|Under) (\d+(?:\.\d+)?)$/);
  if (b.market === "total" && t) return { side: t[1].toLowerCase(), line: Number(t[2]) };
  return null;
}

// Called by every snapshot for games that haven't kicked off. First sighting of each spot is kept (HSETNX).
export async function logEdges(season, week, g, poly, bk, booksT, t) {
  if (!poly || !bk || !booksT || Date.now() - new Date(booksT) > BOOKS_MAX_AGE_H * 3600e3) return 0;
  const r = getRedis(); let n = 0;
  for (const b of gameBets(g.key, g.away, g.home, poly, bk, null, null, null)) {
    if (b.estimate || !(b.ev >= EDGE_MIN)) continue;
    const p = parse(b); if (!p) continue;
    const rec = { t, game: g.key, market: b.market, label: b.label, price: b.price, fair: +b.fair.toFixed(4), ev: +b.ev.toFixed(4), booksT, ...p };
    n += await r.hsetnx(key(season, week), `${g.key}|${b.label}`, JSON.stringify(rec));
  }
  return n;
}

function closePrice(e, g, close) {
  const p = close && close.poly; if (!p) return null;
  if (e.market === "ml" && p.ml) return e.team === g.home ? p.ml.home : p.ml.away;
  if (e.market === "spread" && p.spread) {
    const hs = e.team === g.home ? e.line : -e.line;
    return p.spread.homeSpread === hs ? (e.team === g.home ? p.spread.home : p.spread.away) : null;   // line moved: no like-for-like close
  }
  if (e.market === "total" && p.total && p.total.line === e.line) return e.side === "over" ? p.total.over : p.total.under;
  return null;
}

// Called from grading for each final game.
export async function gradeEdges(season, week, g) {
  const r = getRedis(), all = await r.hgetall(key(season, week)); let changed = 0;
  const close = await getJSON(K.close(season, week, g.key));
  for (const [f, raw] of Object.entries(all || {})) {
    const e = JSON.parse(raw); if (e.game !== g.key || e.result) continue;
    const margin = g.homeScore - g.awayScore, total = g.homeScore + g.awayScore;
    let x = null;
    if (e.market === "ml") x = e.team === g.home ? margin : -margin;
    if (e.market === "spread") x = (e.team === g.home ? margin : -margin) + e.line;
    if (e.market === "total") x = e.side === "over" ? total - e.line : e.line - total;
    if (x == null) continue;
    e.result = x > 0 ? "W" : x < 0 ? "L" : "P";
    e.pl = e.result === "W" ? 1 / e.price - 1 : e.result === "L" ? -1 : 0;      // per $1 staked, before fees
    const c = closePrice(e, g, close); e.close = c; e.clv = c ? c / e.price - 1 : null;
    await r.hset(key(season, week), f, JSON.stringify(e)); changed++;
  }
  return changed;
}

// Season summary for the Record tab.
export async function edgeSummary(season) {
  const r = getRedis(), out = [];
  let c = "0";
  do { const [n, ks] = await r.scan(c, "MATCH", `edgelog:${season}:*`, "COUNT", 200); c = n;
    for (const k of ks) for (const raw of Object.values((await r.hgetall(k)) || {})) out.push(JSON.parse(raw)); } while (c !== "0");
  const done = out.filter((e) => e.result), clv = done.filter((e) => e.clv != null);
  const sum = (a, f) => a.reduce((s, e) => s + f(e), 0);
  return { logged: out.length, graded: done.length, open: out.length - done.length,
    w: done.filter((e) => e.result === "W").length, l: done.filter((e) => e.result === "L").length, p: done.filter((e) => e.result === "P").length,
    roi: done.length ? sum(done, (e) => e.pl) / done.length : null, avgEv: done.length ? sum(done, (e) => e.ev) / done.length : null,
    avgClv: clv.length ? sum(clv, (e) => e.clv) / clv.length : null, clvN: clv.length,
    byMarket: ["spread", "ml", "total"].map((m) => { const d = done.filter((e) => e.market === m);
      return { market: m, n: d.length, w: d.filter((e) => e.result === "W").length, roi: d.length ? sum(d, (e) => e.pl) / d.length : null }; }) };
}
