// My Bets: automatic Polymarket US account sync + settled / sold detection. NBA bets only.
// resolvedFrom() and soldFrom() are copied unchanged from the NFL app (they read Polymarket's own settlement / trade records and
// have been running on real bets there). The sync itself is the same read-only calls (positions + activities).
import { getJSON, setJSON } from "./redis";
import { TEAMS } from "./teams";

const KEY = { synced: "mybets:nba:synced", raw: "mybets:nba:raw", ledger: "mybets:nba:ledger" };

// Is this Polymarket market an NBA game? (slug / title mention NBA, or both sides are NBA nicknames)
export function isNba(slug, meta) {
  const s = String(slug || "").toLowerCase(), t = String((meta && meta.title) || "").toLowerCase();
  if (/(^|[^a-z])nba([^a-z]|$)/.test(s) || /\bnba\b/.test(t)) return true;
  const nicks = Object.values(TEAMS).map((x) => x.nick.toLowerCase());
  return nicks.filter((n) => t.includes(n)).length >= 2;
}
// A parlay / combo position is made of several markets; it isn't one NBA game's bet.
export const isComboLeg = (slug, meta) => /combo|parlay/i.test(String(slug || "")) || !!(meta && /combo|parlay/i.test(String(meta.type || meta.title || "")));

export function resolvedFrom(a) {
  const r = a && a.positionResolution; if (!r || !r.marketSlug || !r.beforePosition || !r.afterPosition) return null;
  const b = r.beforePosition, f = r.afterPosition, shares = Number(b.netPosition), cost = Number(b.cost && b.cost.value);
  const delta = Number(f.realized && f.realized.value) - Number(b.realized && b.realized.value);
  if (![shares, cost, delta].every(Number.isFinite) || !(shares > 0) || !(cost >= 0)) return null;
  const win = delta > 0.005;
  return { slug: r.marketSlug, win, shares, cost, pl: win ? shares - cost : -cost, t: r.updateTime || null,
    title: (b.marketMetadata && b.marketMetadata.title) || r.marketSlug, outcome: b.marketMetadata && b.marketMetadata.outcome, meta: b.marketMetadata };
}
export function soldFrom(a) {
  const tr = a && a.trade; if (!tr || !tr.marketSlug) return null;
  const pl = Number(tr.realizedPnl && tr.realizedPnl.value); if (!Number.isFinite(pl) || Math.abs(pl) < 0.005) return null;
  const qty = Math.abs(Number(tr.qty)), px = Number(tr.price && tr.price.value);
  return { slug: tr.marketSlug, pl, proceeds: Number.isFinite(qty * px) ? qty * px : null, t: tr.updateTime || tr.createTime || null };
}

export async function syncAccount() {
  const keyId = process.env.POLYMARKET_KEY_ID, secretKey = process.env.POLYMARKET_SECRET_KEY;
  if (!keyId || !secretKey) return { ok: false, note: "POLYMARKET_KEY_ID / POLYMARKET_SECRET_KEY not set in Vercel" };
  const { PolymarketUS } = await import("polymarket-us");
  const client = new PolymarketUS({ keyId, secretKey });
  const positions = await client.portfolio.positions({ limit: 200 });
  // Unrecognized reply (API change / error body): stop before the ledger step, which would otherwise mark every open bet "settled".
  if (!positions || typeof positions.positions !== "object") return { ok: false, note: "Polymarket positions reply not recognized — ledger left unchanged" };
  const t = new Date().toISOString();
  await setJSON(KEY.raw, { t, positions });
  const all = Object.entries(positions.positions || {}).map(([slug, p]) => ({ slug, p, meta: p.marketMetadata }));
  const list = all.filter((x) => isNba(x.slug, x.meta) && !isComboLeg(x.slug, x.meta)).map(({ slug, p }) => ({
    id: slug, title: (p.marketMetadata && p.marketMetadata.title) || slug, outcome: p.marketMetadata && p.marketMetadata.outcome,
    shares: Number(p.netPosition), cost: Number(p.cost && p.cost.value), value: p.cashValue ? Number(p.cashValue.value) : null,
    realized: p.realized ? Number(p.realized.value) : null, expired: !!p.expired, updated: p.updateTime || null }));
  await setJSON(KEY.synced, { t, list });
  // Permanent bet log: each position is saved the first time it appears and updated on every sync; when it expires/closes its final value is kept.
  const ledger = (await getJSON(KEY.ledger)) || {}, seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    const e = ledger[p.id] || { id: p.id, title: p.title, outcome: p.outcome, firstSeen: t };
    Object.assign(e, { cost: p.cost, shares: p.shares, value: p.value, realized: p.realized, expired: p.expired, lastSeen: t });
    if (e.shares > 0 && e.cost > 0) e.price = e.cost / e.shares;
    delete e.closedAt; ledger[p.id] = e;
  }
  for (const e of Object.values(ledger)) if (!seen.has(e.id) && !e.closedAt) e.closedAt = t;   // sold or settled since last sync
  // Settlements: a bet that vanished at settlement still gets its result and P/L.
  const res = await client.portfolio.activities({ limit: 100, types: ["ACTIVITY_TYPE_POSITION_RESOLUTION"] }).catch(() => null);
  let resolved = 0;
  for (const a of (res && res.activities) || []) {
    const x = resolvedFrom(a); if (!x || !(x.cost > 0) || !isNba(x.slug, x.meta) || isComboLeg(x.slug, x.meta)) continue;
    const e = ledger[x.slug] || (ledger[x.slug] = { id: x.slug, title: x.title, outcome: x.outcome, firstSeen: x.t || t, cost: x.cost, shares: x.shares, price: x.shares > 0 ? x.cost / x.shares : null });
    if (!e.resolved) resolved++;
    e.resolved = { win: x.win, pl: x.pl, t: x.t }; e.closedAt = e.closedAt || x.t || t;
  }
  // Sales: a bet that vanished without a settlement because you sold it.
  const tr = await client.portfolio.activities({ limit: 100, types: ["ACTIVITY_TYPE_TRADE"] }).catch(() => null), sales = {};
  for (const a of (tr && tr.activities) || []) { const x = soldFrom(a); if (!x) continue;
    const s = (sales[x.slug] = sales[x.slug] || { pl: 0, proceeds: 0, t: null }); s.pl += x.pl; s.proceeds += x.proceeds || 0; if (!s.t || (x.t && x.t > s.t)) s.t = x.t; }
  let sold = 0;
  for (const [slug, x] of Object.entries(sales)) { const e = ledger[slug]; if (!e || e.resolved || seen.has(slug)) continue;
    if (!e.sold) sold++; e.sold = { pl: Math.round(x.pl * 100) / 100, proceeds: Math.round(((e.cost || 0) + x.pl) * 100) / 100, t: x.t }; e.closedAt = e.closedAt || x.t || t; }
  await setJSON(KEY.ledger, ledger);
  return { ok: true, positions: list.length, resolved, sold, t };
}

// What the Bets tab shows: open bets, settled / sold bets, and the record.
export function summarizeLedger(ledger) {
  const rows = Object.values(ledger || {});
  const open = rows.filter((e) => !e.closedAt && !e.resolved && !e.sold);
  const done = rows.filter((e) => e.resolved || e.sold).map((e) => ({ ...e, pl: e.resolved ? e.resolved.pl : e.sold.pl, result: e.resolved ? (e.resolved.win ? "win" : "loss") : "sold" }));
  const w = done.filter((e) => e.result === "win").length, l = done.filter((e) => e.result === "loss").length;
  const staked = done.reduce((s, e) => s + (e.cost || 0), 0), pl = done.reduce((s, e) => s + e.pl, 0);
  return { open, settled: done.sort((a, b) => String((b.resolved || b.sold).t || "").localeCompare(String((a.resolved || a.sold).t || ""))),
    record: { w, l, sold: done.filter((e) => e.result === "sold").length, pl: Math.round(pl * 100) / 100, staked: Math.round(staked * 100) / 100, pct: w + l ? Math.round((w / (w + l)) * 1000) / 10 : null } };
}
export async function loadMyBets() {
  const synced = await getJSON(KEY.synced).catch(() => null), ledger = (await getJSON(KEY.ledger).catch(() => null)) || {};
  return { syncedAt: synced ? synced.t : null, ...summarizeLedger(ledger) };
}
