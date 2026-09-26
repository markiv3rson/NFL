// My Bets: preloaded bets + automatic Polymarket US account sync + automatic grading & CLV.
import { SEASON, loadGames } from "./games";
import { getRedis, getJSON, setJSON } from "./redis";
import { nameMatches } from "./picks";

const KEY = { synced: "mybets:synced", raw: "mybets:raw", scorers: (s, w) => `tdscorers:${s}:${w}` };
const td = (game, player, team, price) => ({ game, kind: "td", player, team, price });
const sp = (game, team, line, price) => ({ game, kind: "spread", team, line, price });
const tot = (game, side, line, price) => ({ game, kind: "total", side, line, price });

// Mark's Week 3 combos, entered from his Polymarket screenshots (9/26). "toWin" = total payout.
export const SEED_BETS = [
  { id: "w3-c1", week: 3, cost: 9.11, toWin: 162.09, legs: [td("LV @ NO", "Travis Etienne Jr.", "NO", .37), td("LA @ DEN", "Kyren Williams", "LA", .53), td("LA @ DEN", "RJ Harvey", "DEN", .25)] },
  { id: "w3-c2", week: 3, cost: 9.13, toWin: 131.97, legs: [tot("ARI @ SF", "under", 48.5, .52), tot("MIN @ TB", "under", 43.5, .545), tot("BAL @ DAL", "over", 53.5, .49), tot("LV @ NO", "under", 43.5, .49)] },
  { id: "w3-c3", week: 3, cost: 10.00, toWin: 189.58, legs: [sp("LV @ NO", "LV", 3.5, .53), td("LV @ NO", "Ashton Jeanty", "LV", .49), td("LV @ NO", "Chris Olave", "NO", .38), tot("LV @ NO", "under", 43.5, .49)] },
  { id: "w3-c4", week: 3, cost: 10.00, toWin: 121.86, legs: [sp("CAR @ CLE", "CAR", -1.5, .52), sp("LAC @ BUF", "LAC", 7.5, .525), sp("NE @ JAX", "JAX", -2.5, .54), sp("NYJ @ DET", "DET", -6.5, .51)] },
  { id: "w3-c5", week: 3, cost: 10.00, toWin: 132.89, legs: [tot("CAR @ CLE", "under", 43.5, .545), tot("LAC @ BUF", "under", 49.5, .485), tot("NE @ JAX", "under", 46.5, .515), tot("NYJ @ DET", "under", 48.5, .505)] },
  { id: "w3-c6", week: 3, cost: 15.00, toWin: 255.80, legs: [td("CAR @ CLE", "Quinshon Judkins", "CLE", .45), td("CAR @ CLE", "Tetairoa McMillan", "CAR", .33), td("HOU @ IND", "David Montgomery", "HOU", .46), td("NYJ @ DET", "Jahmyr Gibbs", "DET", .72)] },
  { id: "w3-c7", week: 3, cost: 20.00, toWin: 683.77, legs: [td("ARI @ SF", "Trey McBride", "ARI", .32), td("MIN @ TB", "Bucky Irving", "TB", .40), td("MIN @ TB", "Justin Jefferson", "MIN", .38), td("BAL @ DAL", "CeeDee Lamb", "DAL", .43)] },
  { id: "w3-c8", week: 3, cost: 25.00, toWin: 236.35, legs: [td("HOU @ IND", "Jonathan Taylor", "IND", .56), td("NYJ @ DET", "Amon-Ra St. Brown", "DET", .51), td("SEA @ WAS", "Jaxon Smith-Njigba", "SEA", .48), td("ARI @ SF", "Christian McCaffrey", "SF", .67)] },
];

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
  const byWeek = {};
  for (const w of weeks) {
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
      legs.push({ ...l, kickoff: g ? g.kickoff : null, result: legResult(l, g, W.td), close, clv: close ? close / l.price - 1 : null });
    }
    const result = comboResult(legs), mult = b.toWin / b.cost, fairMult = 1 / legs.reduce((p, l) => p * l.price, 1);
    const allClose = legs.every((l) => l.close != null);
    bets.push({ ...b, source: "preloaded", legs, result, multiplier: mult, legsMultiplier: fairMult, payoutVsLegs: mult / fairMult - 1,
      breakEven: 1 / mult, pl: result === "W" ? b.toWin - b.cost : result === "L" ? -b.cost : result === "P" ? 0 : null,
      clv: allClose ? legs.reduce((p, l) => p * l.close, 1) / legs.reduce((p, l) => p * l.price, 1) - 1 : null });
  }
  const synced = (await getJSON(KEY.synced)) || null, raw = (await getJSON(KEY.raw)) || null;
  const graded = bets.filter((b) => b.pl != null), open = bets.filter((b) => b.result === "pending");
  const staked = graded.reduce((s, b) => s + b.cost, 0), pl = graded.reduce((s, b) => s + b.pl, 0);
  const clvs = bets.filter((b) => b.clv != null).map((b) => b.clv);
  return { bets, synced, raw, summary: {
    wins: bets.filter((b) => b.result === "W").length, losses: bets.filter((b) => b.result === "L").length, pushes: bets.filter((b) => b.result === "P").length,
    open: open.length, openCost: open.reduce((s, b) => s + b.cost, 0), pl, roi: staked ? pl / staked : null,
    avgClv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null, clvCount: clvs.length } };
}
