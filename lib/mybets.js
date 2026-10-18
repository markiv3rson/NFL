// My Bets: preloaded bets + automatic Polymarket US account sync + automatic grading & CLV.
import { modelBase, modelHeaders } from "./model";
import { SEASON, loadGames, loadSeason, currentWeek } from "./games";
import { getRedis, getJSON, setJSON, K } from "./redis";
import { nameMatches } from "./picks";
import { loadModel } from "./week";
import { ncdf, ninv, SD_MARGIN, SD_TOTAL, isThinMarket, shiftCover } from "./odds";
import { applyCalibration } from "./calibration";
import { comboChance } from "./combo";
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
export { makeWeekAt, isComboLeg };
// 10/16 audit: Polymarket once listed a position with netPosition -17 (sold out / merged); without a settlement or a sale it is not a bet you hold
export const isHeld = (shares, resolved, sold) => Number(shares) > 0 || !!resolved || !!sold;
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
  // review fix 10/14: page through ALL positions (nextCursor) -- with one 200 page, open bets past it were stamped closed
  let positions = await client.portfolio.positions({ limit: 200 });
  for (let i = 0, cur = positions && positions.nextCursor; cur && !positions.eof && i < 20; i++) {
    const nx = await client.portfolio.positions({ limit: 200, cursor: cur }).catch(() => null); if (!nx || typeof nx.positions !== "object") { positions = null; break; }
    positions = { ...positions, positions: { ...positions.positions, ...nx.positions }, nextCursor: nx.nextCursor, eof: nx.eof }; cur = nx.nextCursor; }
  // Unrecognized reply (API change / error body): stop before the ledger step, which would otherwise mark every open
  // bet "settled" because none of them appear in an empty list.
  if (!positions || typeof positions.positions !== "object") return { ok: false, note: "Polymarket positions reply not recognized — ledger left unchanged" };
  await saveComboLegs(positions.positions).catch(() => 0);   // 10/14: every combo's legs, while Polymarket still lists them
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
  for (const p of list.filter((x) => !isComboLeg(x.id, (positions.positions[x.id] || {}).marketMetadata) && !isNbaBet(x.id, (positions.positions[x.id] || {}).comboLegDetails))) {
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
    if (isNbaBet(x.slug, isAcctCombo(x.slug) ? await getJSON(`combolegs:${x.slug}`).catch(() => null) : null)) continue;
    const e = ledger[x.slug] || (ledger[x.slug] = { id: x.slug, title: x.title, outcome: x.outcome, season: SEASON, week: weekAt(x.t) ?? week, firstSeen: x.t || t, cost: x.cost, shares: x.shares, price: x.shares > 0 ? x.cost / x.shares : null });
    if (!e.resolved) {
      resolved++;
    }
    e.resolved = { win: x.win, pl: x.pl, t: x.t, cost: x.cost, shares: x.shares }; e.closedAt = e.closedAt || x.t || t;   // 10/14 audit: the settlement's own stake (the ledger's cost can be older, from before you added to the position)
  }
  // Sales: a bet that vanished without a settlement because you sold it. Sum the profit of its selling trades. Paid back =
  // stake + profit, which matches Polymarket's "Combo sold" amount (price x qty did not, 10/9).
  const tr = await client.portfolio.activities({ limit: 100, types: ["ACTIVITY_TYPE_TRADE"] }).catch(() => null), sales = {};
  for (const a of (tr && tr.activities) || []) { const x = soldFrom(a); if (!x) continue;
    const s = (sales[x.slug] = sales[x.slug] || { pl: 0, proceeds: 0, t: null }); s.pl += x.pl; s.proceeds += x.proceeds || 0; if (!s.t || (x.t && x.t > s.t)) s.t = x.t; }
  let sold = 0;
  // 10/14 fix: saved ONCE. Only the last 100 trades are read, so a later sync (older sell trades dropped off) re-summed a smaller profit
  // and overwrote the right one.
  for (const [slug, x] of Object.entries(sales)) { const e = ledger[slug]; if (!e || e.resolved || e.sold || seen.has(slug)) continue;
    if (!e.sold) sold++; e.sold = { pl: Math.round(x.pl * 100) / 100, proceeds: Math.round(((e.cost || 0) + x.pl) * 100) / 100, t: x.t }; e.closedAt = e.closedAt || x.t || t; }
  await setJSON(KEY.ledger, ledger);
  return { ok: true, positions: list.length, resolved, sold, t };
}

// ---------- grading ----------
async function scorers(season, week, finals) {
  const cached = await getJSON(KEY.scorers(season, week));
  const fresh = cached && Date.now() - new Date(cached.t) < 6 * 3600e3 && finals.every((g) => cached.games[g] !== undefined);
  if (fresh) return withTeams(cached.games, cached.teams);
  const base = modelBase();
  if (!base) return cached && cached.games ? withTeams(cached.games, cached.teams) : {};
  try {
    const r = await fetch(`${base}/td-scorers?season=${season}&week=${week}`, { cache: "no-store", headers: modelHeaders() });
    const d = await r.json();
    if (d.ok) { await setJSON(KEY.scorers(season, week), { t: new Date().toISOString(), games: d.games, teams: d.teams || null }); return withTeams(d.games, d.teams); }
  } catch {}
  return cached && cached.games ? withTeams(cached.games, cached.teams) : {};
}
// scorer -> team(s) per game rides along (not enumerable) so a TD leg needs the scorer on the RIGHT team (same check as lib/grade.js)
function withTeams(games, teams) { const g = { ...(games || {}) }; Object.defineProperty(g, "_teams", { value: teams || null, enumerable: false }); return g; }
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
  const T = tdGames._teams && tdGames._teams[leg.game];
  return list.some((short) => nameMatches(short, leg.player) && (!T || !T[short] || !leg.team || T[short].includes(leg.team))) ? "W" : "L";
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


// Picks inside a Polymarket combo (10/9): the account sync only had the combo's code ("caoc-..."), but Polymarket's position data
// lists every leg. Spread "asc-nfl-chi-gb-...-neg-1pt5" -> "CHI -1.5"; total "tsc-...-total-42pt5" -> "Over 42.5 · NYG @ WAS";
// TD "astatc-...-td-camska-gte1" -> the player whose first and last names start "cam" + "ska" (or "jaco" + "mer") in that game's TD markets.
const sgnLine = (x) => (x > 0 ? `+${x}` : `${x}`);
const PM_TEAM = { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" }, pmTeam = (t) => PM_TEAM[(t || "").toUpperCase()] || (t || "").toUpperCase();   // Polymarket codes -> the app's
// Polymarket's TD code -> player name (10/10). Codes are first-name start + last-name start: "camska" (Cam Skattebo), "jacomer"
// (Jacory Croskey-Merritt), "dswi" (D'Andre Swift, ONE letter of the first name -- before this 2+ were required, so it showed "dswi").
// Every split is tried; the player matching with the longest first-name part wins, and a tie between two players keeps the code.
export function tdCodeName(code, names) {
  let best = null, score = 0, tie = false;
  for (const n of names) { const w = n.toLowerCase().replace(/-/g, " ").replace(/[^a-z ]/g, "").split(" ").filter(Boolean); if (w.length < 2) continue;
    let s = 0; for (let i = 1; i < code.length - 1; i++) { const a = code.slice(0, i), b = code.slice(i); if (w[0].startsWith(a) && w.slice(1).some((x) => x.startsWith(b))) s = Math.max(s, i); }
    if (s > score) { best = n; score = s; tie = false; } else if (s && s === score && n !== best) tie = true; }
  return tie ? null : best;
}
// 10/14 (owner): a combo's legs are saved at EVERY account sync while Polymarket still lists them (`combolegs:<id>`), so a combo that
// settles before anyone opens the Bets tab keeps its legs. slimLegs keeps only what comboPicks reads.
// 10/17 (owner: "why can't I see my legs"): Polymarket now names some combos "crossd-..." (the older ones "caoc-..."); same leg list, so both are read.
export const isAcctCombo = (id) => /^(caoc|crossd)-/.test(String(id || ""));
// 10/17: NBA bets are listed on the NBA page (nba/lib/mybets.js); the NFL list leaves out a single NBA market and a combo whose legs are all NBA games
export const isNbaBet = (id, legs) => /^[a-z]+-nba-/.test(String(id || "")) || (Array.isArray(legs) && legs.length > 0 && legs.every((l) => /^nba-/.test(String((l && l.eventSlug) || ""))));
export const slimLegs = (L) => (Array.isArray(L) ? L.map((l) => ({ slug: l.slug || "", eventSlug: l.eventSlug || "", title: l.title || "", outcome: l.outcome ?? "", state: l.state || "", team: l.team && l.team.abbreviation ? { abbreviation: l.team.abbreviation } : null })) : []);
export async function saveComboLegs(pos) {
  let n = 0;
  for (const [id, p] of Object.entries(pos || {})) { if (!isAcctCombo(id) || !Array.isArray(p && p.comboLegDetails) || !p.comboLegDetails.length) continue;
    await setJSON(`combolegs:${id}`, slimLegs(p.comboLegDetails)); n++; }
  return n;
}
// 10/17 (owner: "why is McConkey's name like that"): "ladmcc" was not in the saved TD prices, so the code showed. A TD leg now reads the player's real
// name and team from the game's Polymarket US event (public, the same markets the owner's app shows); cached 6 h per game.
// { "<market slug>": { name, team } } for every player market of the event.
export function usPlayerNames(ev) {
  const out = {};
  for (const m of (ev && ev.markets) || []) { if (!/^astatc-/.test(String(m.slug || ""))) continue;
    const name = String(m.titleShort || m.title || "").replace(/\s+\d+\+\s.*$/, "").trim(), s = (m.marketSides || []).find((x) => x.team && x.team.abbreviation);
    if (name) out[m.slug] = { name, team: s ? pmTeam(s.team.abbreviation) : null }; }
  return out;
}
async function usNamesFor(eventSlug) {
  if (!/^nfl-[a-z]+-[a-z]+-\d{4}-\d\d-\d\d$/.test(String(eventSlug || ""))) return {};
  const key = `usnames:${eventSlug}`, hit = await getJSON(key).catch(() => null); if (hit) return hit;
  try { const r = await fetch(`https://gateway.polymarket.us/v1/events/slug/${eventSlug}`, { cache: "no-store", signal: AbortSignal.timeout(10000) }); if (!r.ok) return {};
    const j = await r.json(), out = usPlayerNames(j && (j.event || j));
    if (Object.keys(out).length) await getRedis().set(key, JSON.stringify(out), "EX", 6 * 3600).catch(() => {});
    return out; } catch { return {}; }
}
// 10/17: TD legs saved before legs carried their game (week 5 combos) still get a team logo: the player's team from that week's TD model lists,
// only when exactly one team has him.
export function tdTeamFromModel(td, name) {
  const teams = new Set(), games = new Set();
  for (const [gk, t] of Object.entries(td || {})) for (const side of ["away", "home"]) if (((t && t[side]) || []).some((x) => x && x.name && nameMatches(x.name, name))) { teams.add(gk.split(" @ ")[side === "away" ? 0 : 1]); games.add(gk); }
  return teams.size === 1 ? { team: [...teams][0], game: games.size === 1 ? [...games][0] : null } : null;
}
export async function comboPicks(raw, id, season, week, saved = null) {
  const pos = raw && raw.positions && (raw.positions.positions || raw.positions);
  let L = pos && pos[id] && pos[id].comboLegDetails; if (!Array.isArray(L) || !L.length) L = saved; if (!Array.isArray(L) || !L.length) return null;
  const out = [];
  for (const l of L) {
    const slug = l.slug || "", m = /^nfl-([a-z]+)-([a-z]+)-/.exec(l.eventSlug || ""), game = m ? `${pmTeam(m[1])} @ ${pmTeam(m[2])}` : l.title || "";
    const mark = /WON/.test(l.state || "") ? "W" : /LOST/.test(l.state || "") ? "L" : null;
    let label = l.title || slug, team = null;
    if (/^asc-/.test(slug)) { const team = pmTeam(l.team && l.team.abbreviation), x = Number(l.outcome); label = `${team} ${isFinite(x) ? sgnLine(x) : l.outcome}`; }
    else if (/^aec-/.test(slug)) label = `${pmTeam(l.team && l.team.abbreviation)} ML`;   // moneyline leg ("aec-nfl-no-nyg-...", outcome "Saints")
    else if (/^tsc-/.test(slug)) { const t = /total-(\d+)pt(\d)/.exec(slug); label = `${l.outcome} ${t ? `${t[1]}.${t[2]}` : ""} · ${game}`; }
    else if (/^astatc-/.test(slug)) {
      const c = /-td-([a-z]+)-gte(\d+)/.exec(slug); let name = c ? c[1] : "player";
      const us = (await usNamesFor(l.eventSlug))[slug]; if (us) { name = us.name; team = us.team; }
      else try { const px = (await getJSON(K.tdpx(season, week, game))) || {};
        if (c) { const hit = tdCodeName(c[1], Object.keys(px).map((k) => k.split(":")[0].trim())); if (hit) name = hit; } } catch {}
      label = `${name} ${c && c[2] !== "1" ? `${c[2]}+` : "1+"} TD`;
    }
    out.push({ label, result: mark, game, ...(team ? { team } : {}), kind: /^astatc-/.test(slug) ? "td" : /^tsc-/.test(slug) ? "total" : /^asc-/.test(slug) ? "spread" : /^aec-/.test(slug) ? "ml" : "other" });
  }
  return out;
}
export async function markFromFinals(picks, season, week) {
  const wkGames = await loadGames(season, week), finals = wkGames.filter((g) => g.final && g.homeScore != null && g.awayScore != null);
  // 10/14: a 1+ TD leg with no mark from Polymarket is graded from the official scorers of its game (same as typed-in combos)
  // Legs saved before 10/14 carry no game: the player's name is looked up in every final game of that week (a player plays one game).
  const tdGames = picks.some((p) => !p.result && / 1\+ TD$/.test(p.label) && (!p.game || finals.some((g) => g.key === p.game))) && finals.length ? await scorers(season, week, finals.map((g) => g.key)).catch(() => ({})) : {};
  const allFinal = finals.length && finals.length === wkGames.length && finals.every((g) => tdGames[g.key]);   // only once the whole week is over
  return picks.map((p) => { if (p.result) return p;
    const td = / 1\+ TD$/.test(String(p.label)) ? (p.game ? tdGames[p.game] : allFinal ? [].concat(...finals.map((g) => tdGames[g.key])) : null) : null;
    if (td) { const name = String(p.label).replace(/ 1\+ TD$/, ""); return /^[a-z]+$/.test(name) ? p : { ...p, result: td.some((x) => nameMatches(x, name)) ? "W" : "L" }; }
    const L = String(p.label), tot = L.match(/^(Over|Under)\s+([\d.]+)\s+·\s+(.+)$/), sp = L.match(/^([A-Z]{2,3})\s+([+-][\d.]+|ML)$/);
    const inGame = (x) => (p.game ? x.key === p.game : x.home === sp[1] || x.away === sp[1]);
    const g = tot ? finals.find((x) => x.key === tot[3]) : sp ? finals.find(inGame) : null; if (!g) return p;
    const x = tot ? (tot[1] === "Over" ? 1 : -1) * (g.homeScore + g.awayScore - Number(tot[2])) : (sp[1] === g.home ? g.homeScore - g.awayScore : g.awayScore - g.homeScore) + (sp[2] === "ML" ? 0 : Number(sp[2]));
    return { ...p, result: x > 0 ? "W" : x < 0 ? "L" : "P" }; });
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
    const pModel = allModel ? comboChance(legs, (l) => l.modelP) : null;   // same-game links counted (lib/combo.js)
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
  const rawPos = (await getJSON(KEY.raw).catch(() => null)) || null, tdModels = {};
  for (const e of Object.values((await getJSON(KEY.ledger)) || {}).filter((x) => Number(x.season ?? 2026) === Number(season))) {
    if (isComboLeg(e.id)) continue;   // a leg of a combo, not a bet (saved by an earlier version)
    // An account bet from an earlier week that is not resolved is not still open: no game bet outlives its week.
    // review fix 10/14: a bet's week is the week it was PLACED; one placed after MNF is on next week's game, so allow one extra week
    const done = e.expired || e.closedAt || (curWk != null && e.week != null && Number(e.week) < Number(curWk) - 1);
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
    // Settled combos (10/11): Polymarket drops a combo's legs once it settles, so the legs seen while it was open are saved and reused;
    // spread/total legs still blank are marked from the final scores (TD legs keep the mark Polymarket last showed).
    const savedLegs = isAcctCombo(e.id) ? await getJSON(`combolegs:${e.id}`).catch(() => null) : null;
    if (isNbaBet(e.id, savedLegs)) continue;
    let picks = isAcctCombo(e.id) ? await comboPicks(rawPos, e.id, season, wkOf, savedLegs).catch(() => null) : null;
    if (isAcctCombo(e.id)) {
      if (picks && picks.length) await setJSON(`combopicks:${e.id}`, picks).catch(() => {}); else picks = await getJSON(`combopicks:${e.id}`).catch(() => null);
      if (picks && picks.some((p) => !p.team && / \d\+ TD$/.test(String(p.label)))) {
        const td = (tdModels[wkOf] ??= (await loadModel(season, wkOf).catch(() => null)) || {}).td || {};
        picks = picks.map((p) => { if (p.team || !/ \d\+ TD$/.test(String(p.label))) return p; const hit = tdTeamFromModel(td, String(p.label).replace(/ \d\+ TD$/, "")); return hit ? { ...p, team: hit.team, game: p.game || hit.game } : p; });
      }
      if (picks && done) picks = await markFromFinals(picks, season, wkOf).catch(() => picks);
    }
    // 10/14 audit: a settled bet's stake is the one the SETTLEMENT used. The ledger's cost can be older (a position added to after the last sync: cost 4.47 shown, 5.00 lost = "-111.9%"),
    // so a settlement with its own cost uses it, and an older loss (pl = -cost) takes the stake from the loss itself.
    const rs = e.resolved, costNow = rs && rs.cost > 0 ? rs.cost : rs && !rs.win && rs.pl < 0 ? -rs.pl : e.cost || 0, sharesNow = rs && rs.shares > 0 ? rs.shares : e.shares || 0;
    if (!isHeld(sharesNow, rs, e.sold)) continue;   // 10/16 audit: a ledger row with 0 or negative shares and no settlement or sale is not a bet (it showed "pays -$17.00")
    bets.push({ id: e.id, source: "account", week: wkOf, title: e.title, outcome: e.outcome, cost: costNow, toWin: Math.max(0, sharesNow), price: sharesNow > 0 && costNow > 0 && costNow !== (e.cost || 0) ? costNow / sharesNow : e.price ?? null, ...(picks ? { picks } : {}),
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
