// Pinnacle's free guest feed, NBA only (league 487 = regular season, 5270 = preseason). Pinnacle is the sharpest book. Its full-game main
// spread / total / moneyline is RECORDED on each snapshot so the opening number is known and "the line moved 3+" can be tested live.
// Not used for the model or the picks. Two pages per league: matchups (team names) + markets (numbers).
import { TEAMS } from "./teams";
import { getRedis, jparse, mgetAll } from "./redis";
import { etDate } from "./poly";
const BASE = () => process.env.PINNACLE_URL || "https://guest.api.arcadia.pinnacle.com/0.1/leagues";
const LEAGUES = [487, 5270];
const abbrOf = (name) => Object.keys(TEAMS).find((k) => name && (TEAMS[k].name === name || String(name).endsWith(TEAMS[k].nick))) || null;
// -> { "AWAY @ HOME": { id, start, hs, hp, ap, tl, op, up } }  hs = home spread (negative = home favoured), hp / ap = American prices
export function parsePinnacle(matchups, markets) {
  const teams = {};
  for (const m of Array.isArray(matchups) ? matchups : []) {
    if (!m || !m.id || m.parentId || m.special || !Array.isArray(m.participants)) continue;
    const h = m.participants.find((p) => p.alignment === "home"), a = m.participants.find((p) => p.alignment === "away");
    const home = h && abbrOf(h.name), away = a && abbrOf(a.name);
    if (home && away) teams[m.id] = { key: `${away} @ ${home}`, start: m.startTime || null };
  }
  const out = {};
  for (const k of Array.isArray(markets) ? markets : []) {
    const g = teams[k && k.matchupId];
    if (!g || k.period !== 0 || k.isAlternate !== false || (k.status && k.status !== "open")) continue;
    const by = (d) => (k.prices || []).find((p) => p.designation === d);
    const o = out[g.key] || (out[g.key] = { id: k.matchupId, start: g.start });
    if (k.type === "spread") { const h = by("home"), a = by("away"); if (h && a && Number.isFinite(h.points)) Object.assign(o, { hs: h.points, hp: h.price, ap: a.price }); }
    if (k.type === "total") { const ov = by("over"), un = by("under"); if (ov && un && Number.isFinite(ov.points)) Object.assign(o, { tl: ov.points, op: ov.price, up: un.price }); }
    if (k.type === "moneyline") { const h = by("home"), a = by("away"); if (h && a) Object.assign(o, { mh: h.price, ma: a.price }); }
  }
  for (const key of Object.keys(out)) if (out[key].hs == null && out[key].tl == null && out[key].mh == null) delete out[key];
  return out;
}
export async function fetchPinnacle(fetcher = fetch, budgetMs = 25000, leagues = LEAGUES) {
  // One retry (after 3 s) per page, both leagues at once, and an overall deadline: the snapshot has 60 s in total and must still save its page data.
  const get = async (p) => {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetcher(`${BASE()}/${p}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (r.ok) return await r.json();
        if (i === 0) await new Promise((ok) => setTimeout(ok, 3000)); else throw new Error(`Pinnacle ${p} returned ${r.status}`);
      } catch (e) { if (i === 1) throw e; }
    }
  };
  const league = async (lg) => { const [m, k] = await Promise.all([get(`${lg}/matchups`), get(`${lg}/markets/straight`)]); return parsePinnacle(m, k); };
  const work = Promise.allSettled(leagues.map(league));
  const timeout = new Promise((ok) => setTimeout(() => ok(null), budgetMs));
  const res = await Promise.race([work, timeout]);
  if (!res) throw new Error("Pinnacle took longer than " + budgetMs / 1000 + " s");
  const out = {}; let fails = 0, last = null;
  for (const x of res) { if (x.status === "fulfilled") Object.assign(out, x.value); else { fails++; last = x.reason; } }
  if (fails === leagues.length) throw last;
  Object.defineProperty(out, "_fails", { value: fails, enumerable: false });
  return out;
}
export const pinKey = (date, game) => `pin:${date}:${game}`;
// Saves Pinnacle's line for every not-started game of the slate: the first sighting (the opening line as far as we can see) is kept for good,
// every pull is added to a short history (last 200). Returns how many games were saved.
export async function savePinnacle(games, now = Date.now(), pin = null) {
  const r = getRedis(), lines = pin || (await fetchPinnacle()); let n = 0;
  // Games the feed lists that the slate does not show yet (Pinnacle posts regular-season lines days ahead): saved too, so the first sighting
  // is the real opening number, not the line of the day before. Polymarket's line is filled in once the game reaches the slate.
  const onSlate = new Set(games.map((g) => g.key));
  const ahead = Object.entries(lines).filter(([key, p]) => !onSlate.has(key) && p && Number.isFinite(Date.parse(p.start || "")))
    .map(([key, p]) => { const start = new Date(Date.parse(p.start)).toISOString(); return { key, start, date: etDate(start), poly: null }; });
  for (const g of [...games, ...ahead]) {
    const p = lines[g.key]; if (!p || now >= Date.parse(g.start)) continue;
    const px = g.poly || null;     // Polymarket's own main line at the same moment, so "Pinnacle moved, Polymarket hasn't" can be tested later
    const row = { t: new Date(now).toISOString(), poly: px ? { hs: px.spread ? px.spread.homeSpread : null, tl: px.total ? px.total.line : null } : null, hs: p.hs ?? null, hp: p.hp ?? null, ap: p.ap ?? null, tl: p.tl ?? null, op: p.op ?? null, up: p.up ?? null, mh: p.mh ?? null, ma: p.ma ?? null };
    const k = pinKey(g.date, g.key);
    const ok = await r.set(`${k}:open`, JSON.stringify(row), "EX", 21 * 86400, "NX").catch(() => null);
    if (!ok) {            // already have an opening row: fill in any market it did not have yet (the spread can be posted before the total)
      const old = jparse(await r.get(`${k}:open`).catch(() => null));
      if (old) { let ch = false; for (const f of ["hs", "hp", "ap", "tl", "op", "up", "mh", "ma", "poly"]) if (old[f] == null && row[f] != null) { old[f] = row[f]; ch = true; }
        if (ch) await r.set(`${k}:open`, JSON.stringify(old), "KEEPTTL").catch(() => {}); }
    }
    await r.lpush(k, JSON.stringify(row)).catch(() => {}); await r.ltrim(k, 0, 199).catch(() => {}); await r.expire(k, 14 * 86400).catch(() => {});
    n++;
  }
  return n;
}
export async function loadPinOpen(date, game) { return jparse(await getRedis().get(`${pinKey(date, game)}:open`).catch(() => null)); }
export async function pinnacleFailed(msg, logError) {          // one failed pull is not an error; the 2nd in a row is
  const r = getRedis(), n = await r.incr("pinfail").catch(() => 2); await r.expire("pinfail", 6 * 3600).catch(() => {});
  if (n >= 2) await logError("pinnacle", `Pinnacle lines pull failed ${n} times in a row: ${msg}`).catch(() => {});
}
export const pinnacleOk = () => { const r = getRedis(); return Promise.all([r.del("pinfail"), r.set("ok:pinnacle", new Date().toISOString())]).catch(() => 0); };

// LINE MOVE (tested on 2024-26 opening vs closing lines): the side the line moved 3+ points toward wins at the OPENING number
// (spread 67.9% over 483 games, total 61.8%), and not at the closing number. So the signal names the opening number to take.
export const MOVE_AT = 3;
const FRESH_MS = 2 * 3600e3;      // a Pinnacle row older than this is not live (the game was pulled from the board), so no signal from it
const fresh = (row, now = Date.now()) => (row && now - Date.parse(row.t) < FRESH_MS ? row : null);
export function signalFrom(open, now, home, away) {
  if (!open || !now) return null;
  const out = {};
  if (open.hs != null && now.hs != null && Math.abs(now.hs - open.hs) >= MOVE_AT) {
    const toHome = now.hs < open.hs;           // home spread fell = the line moved toward the home team
    out.spread = { team: toHome ? home : away, open: toHome ? open.hs : -open.hs, nowLine: toHome ? now.hs : -now.hs, openHomeSpread: open.hs, nowHomeSpread: now.hs, pts: Math.abs(now.hs - open.hs) };
  }
  if (open.tl != null && now.tl != null && Math.abs(now.tl - open.tl) >= MOVE_AT) {
    out.total = { side: now.tl > open.tl ? "over" : "under", open: open.tl, now: now.tl, nowLine: now.tl, pts: Math.abs(now.tl - open.tl) };
  }
  return Object.keys(out).length ? out : null;
}
export async function moveSignal(date, game, now_ = Date.now()) {
  const r = getRedis(), k = pinKey(date, game);
  const open = jparse(await r.get(`${k}:open`).catch(() => null)), now = fresh(jparse(await r.lindex(k, 0).catch(() => null)), now_);
  const [away, home] = game.split(" @ ");
  return signalFrom(open, now, home, away);
}

// Shadow record of LINE MOVE signals (not picks, not counted in the pick record): the first sighting before tip-off stands, graded on the
// opening number once the game is final. This is how the 2024-26 finding gets tested on games it has never seen.
const LM_IDS = "lm:ids", lmKey = (date, game, market) => `lm:${date}:${game}:${market}`;
export async function recordMoves(games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (now >= Date.parse(g.start)) continue;
    const sg = await moveSignal(g.date, g.key, now).catch(() => null); if (!sg) continue;
    const rows = [];
    if (sg.spread) rows.push({ market: "spread", team: sg.spread.team, line: sg.spread.open, nowLine: sg.spread.nowLine, pts: sg.spread.pts, label: `${sg.spread.team} ${sg.spread.open > 0 ? "+" : ""}${sg.spread.open}` });
    if (sg.total) rows.push({ market: "total", side: sg.total.side, line: sg.total.open, nowLine: sg.total.nowLine, pts: sg.total.pts, label: `${sg.total.side} ${sg.total.open}` });
    for (const x of rows) {
      const k = lmKey(g.date, g.key, x.market);
      const ok = await r.set(k, JSON.stringify({ ...x, date: g.date, game: g.key, start: g.start, t: new Date(now).toISOString() }), "NX").catch(() => null);
      if (ok) { await r.sadd(LM_IDS, k).catch(() => {}); n++; }
    }
  }
  return n;
}
export async function loadMoves() {
  const r = getRedis(), out = [], keys = (await r.smembers(LM_IDS).catch(() => [])) || [], vals = await mgetAll(r, keys).catch(() => []);
  keys.forEach((k, i) => { const v = jparse(vals[i]); if (v) out.push({ ...v, _k: k }); });
  return out;
}
export const STALE_DAYS = 3, staleDate = (date, now = Date.now()) => Date.parse(date + "T12:00:00Z") < now - STALE_DAYS * 86400e3;   // a game not final 3 days after its date was postponed or moved
export async function gradeMoves(fetchFinals, grade) {
  const r = getRedis(), byDate = {}; let n = 0;
  for (const m of await loadMoves()) if (!m.result) (byDate[m.date] = byDate[m.date] || []).push(m);
  for (const [date, list] of Object.entries(byDate)) {
    let finals; try { finals = await fetchFinals(date); } catch { continue; }
    for (const m of list) {
      const f = finals[m.game];
      if (!f || !f.final) { if (staleDate(date)) { const { _k, ...row } = m; row.result = "void"; await r.set(_k, JSON.stringify(row)).catch(() => {}); n++; } continue; }   // postponed / moved: closed out, not pending forever
      const [away, home] = m.game.split(" @ ");
      const { _k, ...row } = m; row.result = grade(row, away, home, f); if (row.nowLine != null) row.resultNow = grade({ ...row, line: row.nowLine }, away, home, f); row.final = { away: f.away, home: f.home };
      await r.set(_k, JSON.stringify(row)); n++;
    }
  }
  return n;
}
export function summarizeMoves(all) {
  const by = {};
  const tally = (k, m, field) => { const e = (by[k] = by[k] || { w: 0, l: 0, push: 0, pending: 0 }); const r = m[field]; if (!r) e.pending++; else if (r === "win") e.w++; else if (r === "loss") e.l++; else if (r !== "void") e.push++; };
  const kinds = ["gap", "bgap", "inj", ...Object.keys(ANGLE_SHADOWS)];
  for (const m of all.filter((x) => x.kind === "gap" || x.kind === "bgap" || ANGLE_SHADOWS[x.kind])) { tally(m.kind, m, "result"); tally(`${m.kind}:${m.market}`, m, "result"); }
  for (const m of all.filter((x) => x.kind === "inj")) { tally("inj", m, "result"); tally("now:inj", m, "resultNow"); }
  for (const m of all.filter((x) => !kinds.includes(x.kind))) { tally("all", m, "result"); tally(m.market, m, "result"); tally("now:all", m, "resultNow"); tally(`now:${m.market}`, m, "resultNow"); }
  for (const e of Object.values(by)) e.pct = e.w + e.l ? Math.round((e.w / (e.w + e.l)) * 1000) / 10 : null;
  return by;
}

// Pinnacle vs Polymarket (shadow only). Soft-book lines that sit 1+ point away from Pinnacle's number are the classic stale-line spot; the old
// multi-book file (2010-18) showed it only on typos (with 3+ soft books agreeing the gap won 51.3%), so this is recorded and graded live, not shown as a pick.
export const GAP_SPREAD = 1, GAP_TOTAL = 1.5;
export function gapFrom(now, home, away) {
  if (!now || !now.poly) return null;
  const out = {};
  if (now.hs != null && now.poly.hs != null && Math.abs(now.poly.hs - now.hs) >= GAP_SPREAD) {
    const toHome = now.hs < now.poly.hs;        // Pinnacle likes the home team more than Polymarket does
    out.spread = { team: toHome ? home : away, line: toHome ? now.poly.hs : -now.poly.hs, pinLine: toHome ? now.hs : -now.hs, pts: Math.abs(now.poly.hs - now.hs) };
  }
  if (now.tl != null && now.poly.tl != null && Math.abs(now.poly.tl - now.tl) >= GAP_TOTAL) {
    out.total = { side: now.tl > now.poly.tl ? "over" : "under", line: now.poly.tl, pinLine: now.tl, pts: Math.abs(now.poly.tl - now.tl) };
  }
  return Object.keys(out).length ? out : null;
}
export async function recordGaps(games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (now >= Date.parse(g.start)) continue;
    const row = fresh(jparse(await r.lindex(pinKey(g.date, g.key), 0).catch(() => null)), now); const [away, home] = g.key.split(" @ ");
    const gp = gapFrom(row, home, away); if (!gp) continue;
    for (const [market, x] of Object.entries(gp)) {
      const k = lmKey(g.date, g.key, `gap-${market}`);
      const ok = await r.set(k, JSON.stringify({ kind: "gap", market, team: x.team, side: x.side, line: x.line, pinLine: x.pinLine, pts: x.pts, label: x.team ? `${x.team} ${x.line > 0 ? "+" : ""}${x.line}` : `${x.side} ${x.line}`, date: g.date, game: g.key, start: g.start, t: new Date(now).toISOString() }), "NX").catch(() => null);
      if (ok) { await r.sadd(LM_IDS, k).catch(() => {}); n++; }
    }
  }
  return n;
}

// fetch + save in one go; returns { n, fails } (fails = leagues that failed while the other answered)
export async function pullPinnacle(games, now = Date.now(), fetcher = fetch) {
  // 10/19: the preseason league (5270) only while the slate has preseason games -- after the preseason it answers 403 and half of every pull failed
  const lines = await fetchPinnacle(fetcher, 25000, (games || []).some((g) => g.preseason) ? LEAGUES : [487]);
  return { n: await savePinnacle(games, now, lines), fails: lines._fails || 0 };
}

// Sportsbooks (The Odds API consensus) vs Polymarket, shadow only -- the NFL app's LINE MOVE idea ("the books moved, Polymarket still has the old number").
// Books are pulled twice a day, so a reading counts for 6 hours. Spread 1+ pt, total 2+ pts; graded on the books' side at Polymarket's number.
export const BGAP_SPREAD = 1, BGAP_TOTAL = 2, BOOKS_FRESH_MS = 6 * 3600e3;
export function bookGapFrom(g, home, away) {
  const out = {}, px = g.poly || {}, bk = g.books || {};
  if (bk.spread && px.spread && Math.abs(px.spread.homeSpread - bk.spread.homeSpread) >= BGAP_SPREAD) {
    const toHome = bk.spread.homeSpread < px.spread.homeSpread;
    out.spread = { team: toHome ? home : away, line: toHome ? px.spread.homeSpread : -px.spread.homeSpread, pinLine: toHome ? bk.spread.homeSpread : -bk.spread.homeSpread, pts: Math.abs(px.spread.homeSpread - bk.spread.homeSpread) };
  }
  if (bk.total && px.total && Math.abs(px.total.line - bk.total.line) >= BGAP_TOTAL) out.total = { side: bk.total.line > px.total.line ? "over" : "under", line: px.total.line, pinLine: bk.total.line, pts: Math.abs(px.total.line - bk.total.line) };
  return Object.keys(out).length ? out : null;
}
export async function recordBookGaps(games, booksAt, now = Date.now()) {
  if (!booksAt || now - Date.parse(booksAt) > BOOKS_FRESH_MS) return 0;
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (now >= Date.parse(g.start)) continue;
    const [away, home] = g.key.split(" @ "), gp = bookGapFrom(g, home, away); if (!gp) continue;
    for (const [market, x] of Object.entries(gp)) {
      const k = lmKey(g.date, g.key, `bgap-${market}`);
      const ok = await r.set(k, JSON.stringify({ kind: "bgap", market, team: x.team, side: x.side, line: x.line, pinLine: x.pinLine, pts: x.pts, label: x.team ? `${x.team} ${x.line > 0 ? "+" : ""}${x.line}` : `${x.side} ${x.line}`, date: g.date, game: g.key, start: g.start, t: new Date(now).toISOString() }), "NX").catch(() => null);
      if (ok) { await r.sadd(LM_IDS, k).catch(() => {}); n++; }
    }
  }
  return n;
}

// 10/26 angle mix (owner: "mix up some angles together ... build different options ... just for tracking angles"), shadow only: four pairs from a
// scan of 13 spread angles in pairs (found 2009-18, checked 2019-26 unseen, NBA closing lines with the service's walk-forward rows; 3 passed vs 0.4 for
// shuffled results). Recorded once at Polymarket's main line when first seen and graded like the others; never a pick until it holds live.
//   tired      fade the team that is on a back-to-back AND missing its star (the other team neither): 55.2% of 1,024 (2009-14 53, 2015-20 55, 2021-26 57; 16 of 18 seasons)
//   dogvtired  a 9+ point underdog against a favorite on a back-to-back:                              56.2% of 365 (51 / 63 / 55)
//   restvstar  the team with 2+ more days of rest against an opponent missing its star:                 56.0% of 425 (52 / 59 / 57)
//   restfav    a road favorite with 2+ more days of rest at a home underdog:                            57.6% of 311 (60 / 53 / 59)
//   restlate   the team with 2+ more days of rest from mid-February on (season day 120+):                 59.7% of 196 unseen 2019-26 (found 54.8% of 409 on 2009-18)
//   Totals (same scan, 2011-26 closes vs the service's walk-forward total; uneven by season, so shadows only):
//   mtotlate   the model's total 8+ points off the line, from March 1 on (season day 130+): its side 57.0% of 481 (Over 58, Under 56; 2024 59% of 123, the rest 50-62)
//   mtotstar   the model's total 8+ UNDER the line with a star out on either team: Under 60.2% of 256 (2025 40% of 15, the rest 53-69)
export const ANGLE_SHADOWS = { tired: [55.2, 1024], dogvtired: [56.2, 365], restvstar: [56.0, 425], restfav: [57.6, 311], restlate: [59.7, 196], mtotlate: [57.0, 481], mtotstar: [60.2, 256] };
const lateSeason = (date) => { const md = String(date || "").slice(5); return md >= "02-15" && md <= "04-30"; };
export function angleSides(g) {
  const c = g && g.context, so = g && g.starOut, px = g && g.poly && g.poly.spread; if (!c || !c.home || !c.away || !px || px.homeSpread == null) return [];
  const [away, home] = g.key.split(" @ "), hs = Number(px.homeSpread), rh = Number(c.home.rest), ra = Number(c.away.rest);
  const b2h = rh === 1, b2a = ra === 1, sth = !!(so && so.home === 1), sta = !!(so && so.away === 1), out = [];
  if (b2h && sth && !b2a && !sta) out.push(["tired", away]); else if (b2a && sta && !b2h && !sth) out.push(["tired", home]);
  if (hs >= 9 && b2a && !b2h) out.push(["dogvtired", home]); else if (hs <= -9 && b2h && !b2a) out.push(["dogvtired", away]);
  if (isFinite(rh) && isFinite(ra)) {
    if (rh - ra >= 2 && sta && !sth) out.push(["restvstar", home]); else if (ra - rh >= 2 && sth && !sta) out.push(["restvstar", away]);
    if (ra - rh >= 2 && hs >= 1) out.push(["restfav", away]);
    if (lateSeason(g.date)) { if (rh - ra >= 2) out.push(["restlate", home]); else if (ra - rh >= 2) out.push(["restlate", away]); }
  }
  const rows = out.map(([kind, team]) => ({ kind, market: "spread", team, line: team === home ? hs : -hs }));
  const mt = g.model && isFinite(Number(g.model.total)) ? Number(g.model.total) : null, tl = g.poly.total && isFinite(Number(g.poly.total.line)) ? Number(g.poly.total.line) : null;
  if (mt != null && tl != null && Math.abs(mt - tl) >= 8) {
    const side = mt > tl ? "over" : "under", md = String(g.date || "").slice(5);
    if (md >= "03-01" && md <= "04-30") rows.push({ kind: "mtotlate", market: "total", side, line: tl });
    if (side === "under" && (sth || sta)) rows.push({ kind: "mtotstar", market: "total", side, line: tl });
  }
  return rows;
}
export async function recordAngleShadows(games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (now >= Date.parse(g.start)) continue;
    for (const x of angleSides(g)) {
      const k = lmKey(g.date, g.key, `${x.kind}-${x.market}`);
      const ok = await r.set(k, JSON.stringify({ kind: x.kind, market: x.market, team: x.team, side: x.side, line: x.line, label: x.team ? `${x.team} ${x.line > 0 ? "+" : ""}${x.line}` : `${x.side} ${x.line}`, date: g.date, game: g.key, start: g.start, t: new Date(now).toISOString() }), "NX").catch(() => null);
      if (ok) { await r.sadd(LM_IDS, k).catch(() => {}); n++; }
    }
  }
  return n;
}

// INJURY (the NFL app's best-tested idea, shadow only here): exactly one team has its top scorer firmly out (official report / ESPN) -> the OTHER team,
// graded at Pinnacle's opening number (the news arriving before the line moves) and at Polymarket's number when seen. On 2024-26 closing / opening lines
// the healthy side covered 56.5% / 56.0% of 713 games at the open but only 52.4% / 54.4% at the close, with uneven seasons, so it is a live test only.
export async function recordInjuryShadow(games, now = Date.now()) {
  const r = getRedis(); let n = 0;
  for (const g of games) {
    if (now >= Date.parse(g.start) || !g.starOut || !g.poly || !g.poly.spread) continue;
    const h = g.starOut.home === 1, a = g.starOut.away === 1; if (h === a) continue;       // exactly one team
    const [away, home] = g.key.split(" @ "), open = await loadPinOpen(g.date, g.key); if (!open || open.hs == null) continue;
    const team = h ? away : home;                                                             // the healthy side
    const hs = g.poly.spread.homeSpread;
    const k = lmKey(g.date, g.key, "inj-spread");
    const row = { kind: "inj", market: "spread", team, line: team === home ? open.hs : -open.hs, nowLine: team === home ? hs : -hs, out: h ? home : away,
      label: `${team} ${(team === home ? open.hs : -open.hs) > 0 ? "+" : ""}${team === home ? open.hs : -open.hs}`, date: g.date, game: g.key, start: g.start, t: new Date(now).toISOString() };
    const ok = await r.set(k, JSON.stringify(row), "NX").catch(() => null);
    if (ok) { await r.sadd(LM_IDS, k).catch(() => {}); n++; }
  }
  return n;
}
