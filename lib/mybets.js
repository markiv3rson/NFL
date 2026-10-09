// My Bets: preloaded bets + automatic Polymarket US account sync + automatic grading & CLV.
import { modelBase, modelHeaders } from "./model";
import { SEASON, loadGames, loadSeason, currentWeek } from "./games";
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


// A settled position vanishes from the positions list, but Polymarket keeps a POSITION_RESOLUTION activity for it
// (before/after position). Whatever the "realized" field means (payout or profit), a win always raises it and a loss never
// does, so the sign of the change tells win from loss; the money is then shares ($1 each) minus cost, or -cost.
import { makeWeekAt, isComboLeg, sameAsSeed, accountWeek } from "./placed";
import { addAlert } from "./alerts";
export { makeWeekAt, isComboLeg };
export function resolvedFrom(a) {
  const r = a && a.positionResolution; if (!r || !r.marketSlug || !r.beforePosition || !r.afterPosition) return null;
  const b = r.beforePosition, f = r.afterPosition, shares = Number(b.netPosition), cost = Number(b.cost && b.cost.value);
  const delta = Number(f.realized && f.realized.value) - Number(b.realized && b.realized.value);
  if (![shares, cost, delta].every(Number.isFinite) || !(shares > 0) || !(cost >= 0)) return null;
  if (isComboLeg(r.marketSlug, b.marketMetadata)) return null;
  const win = delta > 0.005;
  return { slug: r.marketSlug, win, shares, cost, pl: win ? shares - cost : -cost, t: r.updateTime || null,
    title: (b.marketMetadata && b.marketMetadata.title) || r.marketSlug, outcome: b.marketMetadata && b.marketMetadata.outcome };
}

// A sale (10/9): a combo sold before it settles never gets a POSITION_RESOLUTION, only TRADE activities. Polymarket's realizedPnl
// on the closing trade is the profit from selling. Returns { slug, pl, proceeds, t } for a trade that realized money, else null.
export function soldFrom(a) {
  const tr = a && a.trade; if (!tr || !tr.marketSlug) return null;
  const pl = Number(tr.realizedPnl && tr.realizedPnl.value); if (!Number.isFinite(pl) || Math.abs(pl) < 0.005) return null;
  const qty = Math.abs(Number(tr.qty)), px = Number(tr.price && tr.price.value);
  return { slug: tr.marketSlug, pl, proceeds: Number.isFinite(qty * px) ? qty * px : null, t: tr.updateTime || tr.createTime || null };
}

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
  for (const p of list.filter((x) => !isComboLeg(x.id, (positions.positions[x.id] || {}).marketMetadata))) {
    seen.add(p.id);
    const e = ledger[p.id] || { id: p.id, title: p.title, outcome: p.outcome, season: SEASON, week, firstSeen: t };
    Object.assign(e, { cost: p.cost, shares: p.shares, value: p.value, realized: p.realized, expired: p.expired, lastSeen: t });
    if (e.shares > 0 && e.cost > 0) e.price = e.cost / e.shares;
    delete e.closedAt; ledger[p.id] = e;
  }
  for (const e of Object.values(ledger)) if (!seen.has(e.id) && !e.closedAt) e.closedAt = t;   // sold or settled since last sync
  // Settlements: read the resolution activities so a bet that vanished at settlement still gets its result and P/L,
  // including one that settled between two syncs and was never seen open.
  const res = await client.portfolio.activities({ limit: 100, types: ["ACTIVITY_TYPE_POSITION_RESOLUTION"] }).catch(() => null);
  const weekAt = makeWeekAt(await loadSeason(SEASON).catch(() => []));
  let resolved = 0;
  for (const a of (res && res.activities) || []) {
    const x = resolvedFrom(a); if (!x) continue;
    if (!(x.cost > 0)) continue;   // free / bonus position: not your money
    const e = ledger[x.slug] || (ledger[x.slug] = { id: x.slug, title: x.title, outcome: x.outcome, season: SEASON, week: weekAt(x.t) ?? week, firstSeen: x.t || t, cost: x.cost, shares: x.shares, price: x.shares > 0 ? x.cost / x.shares : null });
    if (!e.resolved) {
      resolved++;
      // Tell the alerts bell your bet settled (once per bet), with the legs when it is one of your typed-in combos.
      const twin = SEED_BETS.find((b) => b.season === SEASON && sameAsSeed(e, [b])), money = (v) => `${v < 0 ? "−" : "+"}$${Math.abs(v).toFixed(2)}`;
      await addAlert(SEASON, { kind: "RESULT", game: twin ? twin.legs[0].game : "", title: `Your $${Number(e.cost || x.cost).toFixed(2)} bet ${x.win ? "won" : "lost"} ${money(x.pl)}`,
        sub: twin ? twin.legs.map((l) => (l.kind === "td" ? `${l.player} TD` : l.kind === "spread" ? `${l.team} ${l.line > 0 ? "+" : ""}${l.line}` : `${l.side === "over" ? "Over" : "Under"} ${l.line}`)).join(" · ") : String(e.title || ""), id: `betres|${x.slug}`, ttlH: 24 * 60 });
    }
    e.resolved = { win: x.win, pl: x.pl, t: x.t }; e.closedAt = e.closedAt || x.t || t;
  }
  // Sales: a bet that vanished without a settlement because you sold it. Sum the profit of its selling trades. Paid back =
  // stake + profit, which matches Polymarket's "Combo sold" amount (price x qty did not, 10/9).
  const tr = await client.portfolio.activities({ limit: 100, types: ["ACTIVITY_TYPE_TRADE"] }).catch(() => null), sales = {};
  for (const a of (tr && tr.activities) || []) { const x = soldFrom(a); if (!x) continue;
    const s = (sales[x.slug] = sales[x.slug] || { pl: 0, proceeds: 0, t: null }); s.pl += x.pl; s.proceeds += x.proceeds || 0; if (!s.t || (x.t && x.t > s.t)) s.t = x.t; }
  let sold = 0;
  for (const [slug, x] of Object.entries(sales)) { const e = ledger[slug]; if (!e || e.resolved || seen.has(slug)) continue;
    if (!e.sold) sold++; e.sold = { pl: Math.round(x.pl * 100) / 100, proceeds: Math.round(((e.cost || 0) + x.pl) * 100) / 100, t: x.t }; e.closedAt = e.closedAt || x.t || t; }
  await setJSON(KEY.ledger, ledger);
  return { ok: true, positions: list.length, resolved, sold, t };
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
      legs.push({ ...l, kickoff: g ? g.kickoff : null, gameFinal: !!(g && g.final), result: legResult(l, g, W.td), close, clv: close ? close / l.price - 1 : null,
        modelP: modelProb(l, models[b.week], calibMb, !started && l.kind === "td" ? ((injAll[l.team] || []).find((x) => Number(x.week) === Number(b.week) && nameMatches(l.player, x.name)) || {}).status : null) });
    }
    let result = comboResult(legs);
    // Never "open" three days after its last game: if a leg still has no result by then (the data never arrived), it is
    // settled with no result, not an open bet carried forever (10/2).
    if (result === "pending" && legs.every((l) => l.kickoff && Date.now() - new Date(l.kickoff).getTime() > 72 * 3600e3)) result = "settled";
    const mult = b.toWin / b.cost, fairMult = 1 / legs.reduce((p, l) => p * l.price, 1);
    const allClose = legs.every((l) => l.close != null);
    // Expected payout = total payout x chance every leg hits (legs treated as independent)
    const pMarket = legs.reduce((p, l) => p * l.price, 1), allModel = legs.every((l) => l.modelP != null);
    const pModel = allModel ? legs.reduce((p, l) => p * l.modelP, 1) : null;
    const expMarket = b.toWin * pMarket, expModel = pModel != null ? b.toWin * pModel : null;
    bets.push({ ...b, source: "preloaded", legs, result, waiting: result === "pending" && legs.length > 0 && legs.every((l) => l.gameFinal),   // every game is over; only the official touchdown data is missing
       multiplier: mult, legsMultiplier: fairMult, payoutVsLegs: mult / fairMult - 1,
      // A pushed leg in a COMBO: Polymarket's combo rules (Aug 2026) don't state how a push settles, so no P/L is invented
      // (before 9/30 it was booked as $0). Every preloaded line is a half point, so this can't happen on them today.
      breakEven: 1 / mult, pl: result === "W" ? b.toWin - b.cost : result === "L" ? -b.cost : result === "P" && legs.length === 1 ? 0 : null,
      pushUnconfirmed: result === "P" && legs.length > 1,
      clv: allClose ? legs.reduce((p, l) => p * l.close, 1) / legs.reduce((p, l) => p * l.price, 1) - 1 : null,
      expMarket, expModel, modelChance: pModel });
  }
  const curWk = await currentWeek(season).catch(() => null);
  const weekAtAll = makeWeekAt(await loadSeason(season).catch(() => []));
  // Account bets from the permanent log. Result: open while held; once expired/closed, P/L = last value + realized - cost
  // (Polymarket's own numbers). If it vanished before a final value was seen, the result stays "settled, P/L unknown"
  // rather than a guess.
  for (const e of Object.values((await getJSON(KEY.ledger)) || {}).filter((x) => Number(x.season ?? 2026) === Number(season))) {
    if (isComboLeg(e.id)) continue;   // a leg of a combo, not a bet (saved by an earlier version)
    // An account bet from an earlier week that is not resolved is not still open: no game bet outlives its week.
    const done = e.expired || e.closedAt || (curWk != null && e.week != null && Number(e.week) < Number(curWk));
    // Polymarket's own settlement of a position (real money) wins over anything we infer.
    const twin = bets.find((b) => b.source === "preloaded" && sameAsSeed(e, [b]));
    if (twin) {   // same bet as a preloaded combo (same week and cost, open or settled): list once; if Polymarket has settled it, use that result now
      // Cross-check (10/2): when the final scores already decide a typed-in combo, compare with Polymarket's own settlement. The result shown
      // stays the one from the scores; a disagreement is flagged (it would mean the settlement reading is wrong, or a leg was graded wrong).
      if (e.resolved && (twin.result === "W" || twin.result === "L")) twin.settleCheck = twin.result === (e.resolved.win ? "W" : "L") ? "agree" : "disagree";
      if (e.resolved && twin.result === "pending") { twin.result = e.resolved.win ? "W" : "L"; twin.pl = e.resolved.pl; twin.viaPolymarket = true; twin.expMarket = 0; twin.expModel = null; }
      else if (e.sold && !e.resolved && (twin.result === "pending" || twin.result === "settled")) { twin.result = e.sold.pl > 0.005 ? "W" : e.sold.pl < -0.005 ? "L" : "P"; twin.pl = e.sold.pl; twin.sold = e.sold; twin.viaPolymarket = true; twin.expMarket = 0; twin.expModel = null; }
      continue;
    }
    const wkOf = accountWeek(e, weekAtAll);   // earlier versions saved the week the sync ran, not the bet's
    const pl = e.resolved ? e.resolved.pl : e.sold ? e.sold.pl : e.expired && (e.value != null || e.realized != null) ? (e.value || 0) + (e.realized || 0) - (e.cost || 0) : null;
    bets.push({ id: e.id, source: "account", week: wkOf, title: e.title, outcome: e.outcome, cost: e.cost || 0, toWin: e.shares || 0, price: e.price ?? null,
      legs: [], result: !done ? "pending" : pl == null ? "settled" : pl > 0.005 ? "W" : pl < -0.005 ? "L" : "P", pl, clv: null, ...(e.sold && !e.resolved ? { sold: e.sold } : {}),
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
    modelCovered: withModel.length,
    settleCheck: { agree: bets.filter((b) => b.settleCheck === "agree").length, disagree: bets.filter((b) => b.settleCheck === "disagree").length } } };
}
