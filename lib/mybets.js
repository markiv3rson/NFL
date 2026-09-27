// My Bets: preloaded bets + automatic Polymarket US account sync + automatic grading & CLV.
import { SEASON, loadGames } from "./games";
import { getRedis, getJSON, setJSON } from "./redis";
import { nameMatches } from "./picks";
import { loadModel } from "./week";
import { ncdf, SD_MARGIN, SD_TOTAL } from "./odds";

// Model's chance for one leg (same math as fair_line.py / td_prob.py). null if the model has no number.
function modelProb(leg, model) {
  const [, home] = leg.game.split(" @ ");
  if (leg.kind === "td") {
    const t = model.td[leg.game]; if (!t) return null;
    const r = [...(t.away || []), ...(t.home || [])].find((x) => nameMatches(x.name, leg.player));
    return r && r.fair != null ? r.fair / 100 : null;
  }
  const m = model.games[leg.game]; if (!m) return null;
  if (leg.kind === "spread" && m.homeMargin != null) {
    const hs = leg.team === home ? leg.line : -leg.line, pHome = 1 - ncdf((-hs - m.homeMargin) / SD_MARGIN);
    return leg.team === home ? pHome : 1 - pHome;
  }
  if (leg.kind === "total" && m.total != null) { const pU = ncdf((leg.line - m.total) / SD_TOTAL); return leg.side === "under" ? pU : 1 - pU; }
  return null;
}

const KEY = { synced: "mybets:synced", raw: "mybets:raw", scorers: (s, w) => `tdscorers:${s}:${w}` };
import { SEED_BETS } from "./betsSeed";
export { SEED_BETS };

// ---------- Polymarket US account sync (read-only calls: positions + activities) ----------
export async function syncAccount() {
  const keyId = process.env.POLYMARKET_KEY_ID, secretKey = process.env.POLYMARKET_SECRET_KEY;
  if (!keyId || !secretKey) return { ok: false, note: "POLYMARKET_KEY_ID / POLYMARKET_SECRET_KEY not set in Vercel" };
  const { PolymarketUS } = await import("polymarket-us");
  const client = new PolymarketUS({ keyId, secretKey });
  const positions = await client.portfolio.positions({ limit: 200 });
  const activities = await client.portfolio.activities({ limit: 100 }).catch((e) => ({ error: String(e) }));
  const t = new Date().toISOString();
  await setJSON(KEY.raw, { t, positions, activities }); // raw copy, shown on the page so the format can be checked
  const list = Object.entries((positions && positions.positions) || {}).map(([slug, p]) => ({
    id: slug, title: (p.marketMetadata && p.marketMetadata.title) || slug, outcome: p.marketMetadata && p.marketMetadata.outcome,
    shares: Number(p.netPosition), cost: Number(p.cost && p.cost.value), value: p.cashValue ? Number(p.cashValue.value) : null,
    realized: p.realized ? Number(p.realized.value) : null, expired: !!p.expired, updated: p.updateTime || null,
  }));
  await setJSON(KEY.synced, { t, list });
  return { ok: true, positions: list.length, t };
}

// ---------- grading ----------
async function scorers(season, week, finals) {
  const cached = await getJSON(KEY.scorers(season, week));
  const fresh = cached && Date.now() - new Date(cached.t) < 6 * 3600e3 && finals.every((g) => cached.games[g] !== undefined);
  if (fresh) return cached.games;
  const base = (process.env.MODEL_SERVICE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return (cached && cached.games) || {};
  try {
    const r = await fetch(`${base}/td-scorers?season=${season}&week=${week}`, { cache: "no-store" });
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

// ---------- closing prices / CLV (last Polymarket price before kickoff) ----------
async function closingPrice(season, week, leg) {
  const close = await getJSON(`close:${season}:${week}:${leg.game}`);
  if (leg.kind === "td") {
    const px = await getJSON(`tdpx:${season}:${week}:${leg.game}`);
    if (!px) return null;
    const q = Object.keys(px).find((k) => /anytime|1\+/i.test(k) && k.toLowerCase().includes(leg.player.split(" ").slice(-1)[0].toLowerCase().replace(/\.$/, "")));
    if (!q) return null; const v = px[q]; return typeof v === "number" ? v : v.ask;
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
  const weeks = [...new Set(SEED_BETS.map((b) => b.week))];
  const byWeek = {}, models = {};
  for (const w of weeks) {
    models[w] = await loadModel(season, w);
    const games = await loadGames(season, w);
    const finals = games.filter((g) => g.final).map((g) => g.key);
    const needTd = SEED_BETS.some((b) => b.week === w && b.legs.some((l) => l.kind === "td" && finals.includes(l.game)));
    byWeek[w] = { games: Object.fromEntries(games.map((g) => [g.key, g])), td: needTd ? await scorers(season, w, finals) : {} };
  }
  const bets = [];
  for (const b of SEED_BETS) {
    const W = byWeek[b.week], legs = [];
    for (const l of b.legs) {
      const g = W.games[l.game], started = g && Date.now() >= new Date(g.kickoff).getTime();
      const close = started ? await closingPrice(season, b.week, l) : null;
      legs.push({ ...l, kickoff: g ? g.kickoff : null, result: legResult(l, g, W.td), close, clv: close ? close / l.price - 1 : null,
        modelP: modelProb(l, models[b.week]) });
    }
    const result = comboResult(legs), mult = b.toWin / b.cost, fairMult = 1 / legs.reduce((p, l) => p * l.price, 1);
    const allClose = legs.every((l) => l.close != null);
    // Expected payout = total payout x chance every leg hits (legs treated as independent)
    const pMarket = legs.reduce((p, l) => p * l.price, 1), allModel = legs.every((l) => l.modelP != null);
    const pModel = allModel ? legs.reduce((p, l) => p * l.modelP, 1) : null;
    const expMarket = b.toWin * pMarket, expModel = pModel != null ? b.toWin * pModel : null;
    bets.push({ ...b, source: "preloaded", legs, result, multiplier: mult, legsMultiplier: fairMult, payoutVsLegs: mult / fairMult - 1,
      breakEven: 1 / mult, pl: result === "W" ? b.toWin - b.cost : result === "L" ? -b.cost : result === "P" ? 0 : null,
      clv: allClose ? legs.reduce((p, l) => p * l.close, 1) / legs.reduce((p, l) => p * l.price, 1) - 1 : null,
      expMarket, expModel, modelChance: pModel });
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
