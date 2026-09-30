// My Bets: preloaded bets + automatic Polymarket US account sync + automatic grading & CLV.
import { modelBase, modelHeaders } from "./model";
import { SEASON, loadGames, currentWeek } from "./games";
import { getRedis, getJSON, setJSON } from "./redis";
import { nameMatches } from "./picks";
import { loadModel } from "./week";
import { ncdf, ninv, SD_MARGIN, SD_TOTAL, isThinMarket, shiftCover } from "./odds";
import { applyCalibration } from "./calibration";
import { loadInjuries } from "./injuries";

// Model's chance for one leg (same math as fair_line.py / td_prob.py). null if the model has no number.
// status = this week's official report status for a TD leg's player (only passed before kickoff).
function modelProb(leg, model, calib, status) {
  const [, home] = leg.game.split(" @ ");
  if (leg.kind === "td") {
    const t = model.td[leg.game]; if (!t) return null;
    const r = [...(t.away || []), ...(t.home || [])].find((x) => nameMatches(x.name, leg.player));
    // Same (calibrated) number the TD tab showed when the bet was placed, not the raw model number
    if (!r || r.fair == null) return null;
    const p = (calib ? applyCalibration(r.fair, calib) : r.fair) / 100;
    // Availability (9/30, same rule as the TD tab): the model's % assumes he plays; a TD bet on a player who sits
    // settles No. Out/Doubtful ~never play (99%+), Questionable RB/WR/TE sit 33% (2016-25).
    if (/^(out|doubtful)$/i.test(status || "")) return 0.01 * p;
    if (/^questionable$/i.test(status || "")) return 0.669 * p;
    return p;
  }
  const m = model.games[leg.game]; if (!m) return null;
  // Spreads/totals: start from the CALIBRATED chance at the market line (fair_line.py cal_cover/cal_under) and shift it to
  // the leg's own line. The raw model-vs-market gap was proven to carry no signal, so it isn't used when the calibrated
  // number exists; older weeks without it fall back to the old raw math.
  if (leg.kind === "spread" && m.homeMargin != null) {
    const hs = leg.team === home ? leg.line : -leg.line;
    let pHome;
    if (m.calHomeCover != null && m.mktHomeSpread != null) {
      pHome = shiftCover(m.calHomeCover / 100, m.mktHomeSpread, hs);   // same key-number shift as the Game Lines tab
    } else pHome = 1 - ncdf((-hs - m.homeMargin) / SD_MARGIN);
    return leg.team === home ? pHome : 1 - pHome;
  }
  if (leg.kind === "total" && m.total != null) {
    let pU;
    if (m.calUnder != null && m.mktTotal != null) {
      const mu = m.mktTotal - SD_TOTAL * ninv(m.calUnder / 100);
      pU = ncdf((leg.line - mu) / SD_TOTAL);
    } else pU = ncdf((leg.line - m.total) / SD_TOTAL);
    return leg.side === "under" ? pU : 1 - pU;
  }
  return null;
}

const KEY = { synced: "mybets:synced", raw: "mybets:raw", ledger: "mybets:ledger", scorers: (s, w) => `tdscorers:${s}:${w}` };
import { SEED_BETS as ALL_SEED_BETS, SEED_SEASON } from "./betsSeed";
const SEED_BETS = ALL_SEED_BETS.map((b) => ({ season: SEED_SEASON, ...b }));
export { SEED_BETS };

// ---------- Polymarket US account sync (read-only calls: positions + activities) ----------
export async function syncAccount() {
  const keyId = process.env.POLYMARKET_KEY_ID, secretKey = process.env.POLYMARKET_SECRET_KEY;
  if (!keyId || !secretKey) return { ok: false, note: "POLYMARKET_KEY_ID / POLYMARKET_SECRET_KEY not set in Vercel" };
  const { PolymarketUS } = await import("polymarket-us");
  const client = new PolymarketUS({ keyId, secretKey });
  const positions = await client.portfolio.positions({ limit: 200 });
  // Unrecognized reply (API change / error body): stop before the ledger step, which would otherwise mark every open
  // bet "settled" because none of them appear in an empty list.
  if (!positions || typeof positions.positions !== "object") return { ok: false, note: "Polymarket positions reply not recognized — ledger left unchanged" };
  const activities = await client.portfolio.activities({ limit: 100 }).catch((e) => ({ error: String(e) }));
  const t = new Date().toISOString();
  await setJSON(KEY.raw, { t, positions, activities }); // raw copy, shown on the page so the format can be checked
  const list = Object.entries((positions && positions.positions) || {}).map(([slug, p]) => ({
    id: slug, title: (p.marketMetadata && p.marketMetadata.title) || slug, outcome: p.marketMetadata && p.marketMetadata.outcome,
    shares: Number(p.netPosition), cost: Number(p.cost && p.cost.value), value: p.cashValue ? Number(p.cashValue.value) : null,
    realized: p.realized ? Number(p.realized.value) : null, expired: !!p.expired, updated: p.updateTime || null,
  }));
  await setJSON(KEY.synced, { t, list });
  // Permanent bet log (added 9/30): before, bets placed on Polymarket were only LISTED while open and vanished once
  // settled, so they never reached your record, P/L, CLV or the $200 weekly budget. Each position is saved the first
  // time it appears (week, price paid) and updated on every sync; when it expires/closes, its final value is kept.
  const ledger = (await getJSON(KEY.ledger)) || {}, week = await currentWeek(SEASON).catch(() => null), seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    const e = ledger[p.id] || { id: p.id, title: p.title, outcome: p.outcome, season: SEASON, week, firstSeen: t };
    Object.assign(e, { cost: p.cost, shares: p.shares, value: p.value, realized: p.realized, expired: p.expired, lastSeen: t });
    if (e.shares > 0 && e.cost > 0) e.price = e.cost / e.shares;
    delete e.closedAt; ledger[p.id] = e;
  }
  for (const e of Object.values(ledger)) if (!seen.has(e.id) && !e.closedAt) e.closedAt = t;   // sold or settled since last sync
  await setJSON(KEY.ledger, ledger);
  return { ok: true, positions: list.length, t };
}

// ---------- grading ----------
async function scorers(season, week, finals) {
  const cached = await getJSON(KEY.scorers(season, week));
  const fresh = cached && Date.now() - new Date(cached.t) < 6 * 3600e3 && finals.every((g) => cached.games[g] !== undefined);
  if (fresh) return cached.games;
  const base = modelBase();
  if (!base) return (cached && cached.games) || {};
  try {
    const r = await fetch(`${base}/td-scorers?season=${season}&week=${week}`, { cache: "no-store", headers: modelHeaders() });
    const d = await r.json();
    if (d.ok) { await setJSON(KEY.scorers(season, week), { t: new Date().toISOString(), games: d.games }); return d.games; }
  } catch {}
  return (cached && cached.games) || {};
}
export function legResult(leg, g, tdGames) {
  if (!g || !g.final) return "pending";
  const [away, home] = leg.game.split(" @ ");
  if (leg.kind === "spread") {
    const margin = leg.team === home ? g.homeScore - g.awayScore : g.awayScore - g.homeScore;
    const x = margin + leg.line; return x > 0 ? "W" : x < 0 ? "L" : "P";
  }
  if (leg.kind === "total") {
    const t = g.homeScore + g.awayScore, x = leg.side === "over" ? t - leg.line : leg.line - t;
    return x > 0 ? "W" : x < 0 ? "L" : "P";
  }
  const list = tdGames[leg.game];
  if (!list) return "pending";                                   // play-by-play not in yet
  return list.some((short) => nameMatches(short, leg.player)) ? "W" : "L";
}
export function comboResult(legs) {
  if (legs.some((l) => l.result === "L")) return "L";
  if (legs.every((l) => l.result === "W")) return "W";
  if (legs.some((l) => l.result === "P") && legs.every((l) => l.result === "W" || l.result === "P")) return "P";
  return "pending";
}

const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();
// ---------- closing prices / CLV (last Polymarket price before kickoff) ----------
async function closingPrice(season, week, leg) {
  const close = await getJSON(`close:${season}:${week}:${leg.game}`);
  if (leg.kind === "td") {
    const px = await getJSON(`tdpx:${season}:${week}:${leg.game}`);
    if (!px) return null;
    // Match on first AND last name (suffixes like Jr./III dropped). Matching the last word alone let "Travis Etienne Jr."
    // match on "jr", i.e. whichever Jr. came first in the list.
    const words = norm(leg.player).split(" ").filter((w) => w && !SUFFIX.has(w));
    const first = words[0], last = words[words.length - 1];
    const q = Object.keys(px).find((k) => { if (!/anytime|(^|\D)1\+/i.test(k)) return false;   // whole words (9/30): "Williams" != "Williamson"
      const w = norm(k.replace(/\s*(1\+|anytime).*$/i, "")).split(" ").filter((x) => x && !SUFFIX.has(x)); return w[0] === first && w[w.length - 1] === last; });
    if (!q) return null;
    const v = typeof px[q] === "number" ? { ask: px[q] } : px[q];
    // Thin market (isThinMarket: nobody bidding within 5¢ / 40% of the ask): the ask isn't a real closing price, so no CLV.
    if (isThinMarket(v.ask, v.bid ?? null)) return null;
    return v.ask;
  }
  if (!close || !close.poly) return null;
  const [, home] = leg.game.split(" @ ");
  if (leg.kind === "spread" && close.poly.spread) {
    const hs = close.poly.spread.homeSpread, legHs = leg.team === home ? leg.line : -leg.line;
    if (hs !== legHs) return null;                                 // line moved: not the same bet anymore
    return leg.team === home ? close.poly.spread.home : close.poly.spread.away;
  }
  if (leg.kind === "total" && close.poly.total && close.poly.total.line === leg.line)
    return leg.side === "over" ? close.poly.total.over : close.poly.total.under;
  return null;
}

export async function loadMyBets(season = SEASON) {
  const seed = SEED_BETS.filter((b) => b.season === season);   // this season's preloaded bets only
  const weeks = [...new Set(seed.map((b) => b.week))];
  const byWeek = {}, models = {};
  const calibMb = await getJSON(`calib:${season}`).catch(() => null);
  const injAll = (await loadInjuries().catch(() => null)) || {};
  for (const w of weeks) {
    models[w] = await loadModel(season, w);
    const games = await loadGames(season, w);
    const finals = games.filter((g) => g.final).map((g) => g.key);
    const needTd = seed.some((b) => b.week === w && b.legs.some((l) => l.kind === "td" && finals.includes(l.game)));
    byWeek[w] = { games: Object.fromEntries(games.map((g) => [g.key, g])), td: needTd ? await scorers(season, w, finals) : {} };
  }
  const bets = [];
  for (const b of seed) {
    const W = byWeek[b.week], legs = [];
    for (const l of b.legs) {
      const g = W.games[l.game], started = g && Date.now() >= new Date(g.kickoff).getTime();
      const close = started ? await closingPrice(season, b.week, l) : null;
      legs.push({ ...l, kickoff: g ? g.kickoff : null, result: legResult(l, g, W.td), close, clv: close ? close / l.price - 1 : null,
        modelP: modelProb(l, models[b.week], calibMb, !started && l.kind === "td" ? ((injAll[l.team] || []).find((x) => Number(x.week) === Number(b.week) && nameMatches(l.player, x.name)) || {}).status : null) });
    }
    const result = comboResult(legs), mult = b.toWin / b.cost, fairMult = 1 / legs.reduce((p, l) => p * l.price, 1);
    const allClose = legs.every((l) => l.close != null);
    // Expected payout = total payout x chance every leg hits (legs treated as independent)
    const pMarket = legs.reduce((p, l) => p * l.price, 1), allModel = legs.every((l) => l.modelP != null);
    const pModel = allModel ? legs.reduce((p, l) => p * l.modelP, 1) : null;
    const expMarket = b.toWin * pMarket, expModel = pModel != null ? b.toWin * pModel : null;
    bets.push({ ...b, source: "preloaded", legs, result, multiplier: mult, legsMultiplier: fairMult, payoutVsLegs: mult / fairMult - 1,
      // A pushed leg in a COMBO: Polymarket's combo rules (Aug 2026) don't state how a push settles, so no P/L is invented
      // (before 9/30 it was booked as $0). Every preloaded line is a half point, so this can't happen on them today.
      breakEven: 1 / mult, pl: result === "W" ? b.toWin - b.cost : result === "L" ? -b.cost : result === "P" && legs.length === 1 ? 0 : null,
      pushUnconfirmed: result === "P" && legs.length > 1,
      clv: allClose ? legs.reduce((p, l) => p * l.close, 1) / legs.reduce((p, l) => p * l.price, 1) - 1 : null,
      expMarket, expModel, modelChance: pModel });
  }
  // Account bets from the permanent log. Result: open while held; once expired/closed, P/L = last value + realized - cost
  // (Polymarket's own numbers). If it vanished before a final value was seen, the result stays "settled, P/L unknown"
  // rather than a guess.
  for (const e of Object.values((await getJSON(KEY.ledger)) || {}).filter((x) => Number(x.season ?? 2026) === Number(season))) {
    const done = e.expired || e.closedAt;
    // expired (resolved) while we could still see it: final value + realized - cost. Vanished without being seen expired
    // (sold, or resolved between syncs): the last value seen may be pre-resolution, so no P/L is invented.
    const pl = e.expired && (e.value != null || e.realized != null) ? (e.value || 0) + (e.realized || 0) - (e.cost || 0) : null;
    bets.push({ id: e.id, source: "account", week: e.week, title: e.title, outcome: e.outcome, cost: e.cost || 0, toWin: e.shares || 0, price: e.price ?? null,
      legs: [], result: !done ? "pending" : pl == null ? "settled" : pl > 0.005 ? "W" : pl < -0.005 ? "L" : "P", pl, clv: null,
      expMarket: !done ? (e.value ?? e.cost ?? 0) : 0, expModel: null });   // open: the market's current value of the position
  }
  const synced = (await getJSON(KEY.synced)) || null, raw = (await getJSON(KEY.raw)) || null;
  const graded = bets.filter((b) => b.pl != null), open = bets.filter((b) => b.result === "pending");
  const staked = graded.reduce((s, b) => s + b.cost, 0), pl = graded.reduce((s, b) => s + b.pl, 0);
  const clvs = bets.filter((b) => b.clv != null).map((b) => b.clv);
  const withModel = open.filter((b) => b.expModel != null);
  return { bets, synced, raw, summary: {
    wins: bets.filter((b) => b.result === "W").length, losses: bets.filter((b) => b.result === "L").length, pushes: bets.filter((b) => b.result === "P").length,
    open: open.length, openCost: open.reduce((s, b) => s + b.cost, 0), pl, roi: staked ? pl / staked : null,
    avgClv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null, clvCount: clvs.length,
    maxPayout: open.reduce((s, b) => s + b.toWin, 0),
    expMarket: open.reduce((s, b) => s + b.expMarket, 0),
    expModel: withModel.reduce((s, b) => s + b.expModel, 0), expModelCost: withModel.reduce((s, b) => s + b.cost, 0),
    modelCovered: withModel.length } };
}
