// Polymarket-vs-sportsbooks edge tracker (added 9/30). The one realistic edge for a Polymarket bettor is Polymarket's
// price lagging the sportsbook consensus: backtests (2006-25) found no stats-based way to beat the CLOSING sportsbook
// line, so the model is not the edge -- the price gap is. This logs every time a Polymarket price is 3%+ better than
// the FRESH no-vig sportsbook fair price (books pulled within 3 h), then grades each spot at the result and at the
// closing Polymarket price. The Record tab shows whether these spots actually win -- measured, not assumed.
import { spreadOk, totalOk } from "./sane";
import { getRedis, jparse, getJSON, setJSON, K } from "./redis";
import { gameBets } from "./picks";

export const EDGE_MIN = 0.03, EDGE_MAX = 0.3, BOOKS_MAX_AGE_H = 3, BOOKS_MAX_AGE_EARLY_H = 8;   // EDGE_MAX: the rest of the app treats a 30%+ gap as probably bad data, so the tracker does too (10/5)
// Allowed sportsbook-odds age for a game: 3 h within a day of kickoff, 8 h before that (9/30: midweek lines barely move
// and books are pulled twice a weekday, so a flat 3 h left "Right now" idle most of the week).
export const booksMaxAgeH = (kickoff) => (kickoff && new Date(kickoff) - Date.now() > 24 * 3600e3 ? BOOKS_MAX_AGE_EARLY_H : BOOKS_MAX_AGE_H);
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
export async function logEdges(season, week, g, poly, bk, booksT, t, onNew = null) {
  if (!poly || !bk || !booksT || Date.now() - new Date(booksT) > booksMaxAgeH(g.kickoff) * 3600e3) return 0;
  const r = getRedis(); let n = 0;
  for (const b of gameBets(g.key, g.away, g.home, poly, bk, null, null, null)) {
    const fee = Math.max(0, Number(process.env.POLY_FEE_PCT) || 0) / 100, evNet = b.fair / (b.price * (1 + fee)) - 1;   // same fee rule as the page
    if (b.estimate || !(evNet >= EDGE_MIN) || evNet > EDGE_MAX) continue;
    const p = parse(b); if (!p) continue;
    const rec = { t, game: g.key, market: b.market, label: b.label, price: b.price, fair: +b.fair.toFixed(4), ev: +b.ev.toFixed(4), booksT, ...p };
    const added = await r.hsetnx(key(season, week), `${g.key}|${b.label}`, JSON.stringify(rec));
    n += added;
    if (added && onNew) await Promise.resolve(onNew(rec)).catch(() => {});   // new spot -> an alert (10/1)
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

// Called from grading once per week with that week's final games (9/30: was once per game, re-reading the log each time).
export async function gradeEdgesWeek(season, week, finals) {
  const all = await getRedis().hgetall(key(season, week));
  const open = Object.values(all || {}).map((x) => jparse(x)).filter((e) => e && !e.result);
  let n = 0; for (const g of finals) if (open.some((e) => e.game === g.key)) n += await gradeEdges(season, week, g, all);
  return n;
}
export async function gradeEdges(season, week, g, preloaded = null) {
  const r = getRedis(), all = preloaded || await r.hgetall(key(season, week)); let changed = 0;
  const close = await getJSON(K.close(season, week, g.key));
  for (const [f, raw] of Object.entries(all || {})) {
    const e = jparse(raw); if (!e || e.game !== g.key || e.result) continue;
    // A spot logged from an absurd Polymarket line (10/4: "MIN +19.5") is removed instead of graded as a win.
    if ((e.market === "spread" && !spreadOk(e.team === g.home ? e.line : -e.line, g.nvSpread)) || (e.market === "total" && !totalOk(e.line, g.nvTotal))) { await r.hdel(key(season, week), f); continue; }
    const margin = g.homeScore - g.awayScore, total = g.homeScore + g.awayScore;
    let x = null;
    if (e.market === "ml") x = e.team === g.home ? margin : -margin;
    if (e.market === "spread") x = (e.team === g.home ? margin : -margin) + e.line;
    if (e.market === "total") x = e.side === "over" ? total - e.line : e.line - total;
    if (x == null) continue;
    e.result = x > 0 ? "W" : x < 0 ? "L" : "P";
    const fee = Math.max(0, Number(process.env.POLY_FEE_PCT) || 0) / 100;
    e.pl = e.result === "W" ? 1 / (e.price * (1 + fee)) - 1 : e.result === "L" ? -1 : 0;      // per $1 staked, after POLY_FEE_PCT (0 = before fees)
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
    for (const k of ks) for (const raw of Object.values((await r.hgetall(k)) || {})) { const e = jparse(raw); if (e) out.push(e); } } while (c !== "0");
  const done = out.filter((e) => e.result), clv = done.filter((e) => e.clv != null);
  const sum = (a, f) => a.reduce((s, e) => s + f(e), 0);
  return { logged: out.length, graded: done.length, open: out.length - done.length,
    w: done.filter((e) => e.result === "W").length, l: done.filter((e) => e.result === "L").length, p: done.filter((e) => e.result === "P").length,
    roi: done.length ? sum(done, (e) => e.pl) / done.length : null, avgEv: done.length ? sum(done, (e) => e.ev) / done.length : null,
    avgClv: clv.length ? sum(clv, (e) => e.clv) / clv.length : null, clvN: clv.length,
    byMarket: ["spread", "ml", "total"].map((m) => { const d = done.filter((e) => e.market === m);
      return { market: m, n: d.length, w: d.filter((e) => e.result === "W").length, roi: d.length ? sum(d, (e) => e.pl) / d.length : null }; }) };
}
