// My Bets: automatic Polymarket US account sync + settled / sold detection. NBA bets only.
// resolvedFrom() and soldFrom() are copied unchanged from the NFL app (they read Polymarket's own settlement / trade records and
// have been running on real bets there). The sync itself is the same read-only calls (positions + activities).
// 10/27 (owner: "Fix the player props ... Also fix the straight bets"): a player-prop leg ("astatc-nba-...-pra-ametho-gte25") reads the player
// and the bet ("Amen Thompson 25+ PRA") instead of the game's name, a total leg carries its number ("Under 241.5", the NBA slug has no "total-"),
// a prop leg Polymarket never marked is graded from ESPN's box score, and a SINGLE player bet (an "astatc-" market traded on its own, same rule
// as NFL's lib/placed.js) is a bet of its own with the player's name, team and result.
import { getJSON, setJSON, getRedis } from "./redis";
import { TEAMS } from "./teams";
import { finalsFor, boxFor } from "./espn";
import { normName } from "./props";
import { etDate } from "./poly";

const KEY = { synced: "mybets:nba:synced", raw: "mybets:nba:raw", ledger: "mybets:nba:ledger" };

// Is this Polymarket market an NBA game? (slug / title mention NBA, or both sides are NBA nicknames)
export function isNba(slug, meta) {
  const s = String(slug || "").toLowerCase(), t = String((meta && meta.title) || "").toLowerCase();
  if (/(^|[^a-z])nba([^a-z]|$)/.test(s) || /\bnba\b/.test(t)) return true;
  const nicks = Object.values(TEAMS).map((x) => x.nick.toLowerCase());
  return nicks.filter((n) => t.includes(n)).length >= 2;
}
// A parlay / combo position is made of several markets; it isn't one NBA game's bet. An "astatc-" player market is a combo's LEG unless it was
// traded on its own (`singles`, from tradedSingles) -- a combo trades under its "caoc-" / "crossd-" name, never its legs' (10/27, same as NFL).
export const isComboLeg = (slug, meta, singles = null) => {
  const s = String(slug || ""), st = String((meta && ((meta.settlement && meta.settlement.state) || meta.state)) || "");
  return (/^astatc-/i.test(s) && !(singles && singles.has(s))) || /^COMBO_LEG/i.test(st) || /combo|parlay/i.test(s) || !!(meta && /combo|parlay/i.test(String(meta.type || meta.title || "")));
};
export function tradedSingles(activities) {
  const out = new Set();
  for (const a of (activities && activities.activities) || []) { const s = a && a.trade && a.trade.marketSlug; if (/^astatc-/i.test(String(s || ""))) out.add(String(s)); }
  return out;
}
// 10/17 (owner: "NBA My bets shows the legs like NFL"): a Polymarket account combo ("caoc-..." / "crossd-...") has no title; its legs (comboLegDetails) name
// the games. It is an NBA bet when every leg is an NBA game ("nba-bos-det-2026-10-22"). The legs are kept in the ledger at every sync, because
// Polymarket drops them once the combo settles.
export const isAcctCombo = (id) => /^(caoc|crossd)-/.test(String(id || ""));
export const nbaLegs = (L) => Array.isArray(L) && L.length > 0 && L.every((l) => /^nba-/.test(String((l && l.eventSlug) || "")));
export const slimLegs = (L) => (Array.isArray(L) ? L.map((l) => ({ slug: l.slug || "", eventSlug: l.eventSlug || "", title: l.title || "", outcome: l.outcome ?? "", state: l.state || "",
  team: l.team && l.team.abbreviation ? { abbreviation: l.team.abbreviation } : null, ...(l.player ? { player: l.player } : {}) })) : []);
const US_CODE = { GS: "GSW", NO: "NOP", SA: "SAS", NY: "NYK", PHO: "PHX" }, usTeam = (t) => { const u = String(t || "").toUpperCase(); return US_CODE[u] || u; };
const sgnLine = (x) => (x > 0 ? `+${x}` : `${x}`);

// ---------- player-prop markets ("astatc-nba-<away>-<home>-<date>-<stat>-<code>-gte<N>" = N or more; the "No" side = under N) ----------
const STAT_WORD = { pts: "Pts", reb: "Reb", ast: "Ast", pra: "PRA", "3pm": "3PM", stl: "Stl", blk: "Blk", pr: "Pts + Reb", pa: "Pts + Ast", ra: "Reb + Ast", to: "TO", dd: "Double-Double" };
const STAT_KEY = { pts: "pts", reb: "reb", ast: "ast", pra: "pra", "3pm": "3pm", stl: "stl", blk: "blk" };   // the box-score field (espn.js parseBox); the rest can't be graded here
export function propStat(slug) {
  const m = /^astatc-nba-([a-z]+)-([a-z]+)-(\d{4}-\d\d-\d\d)-([a-z0-9]+)-([a-z]+)-gte(\d+)$/.exec(String(slug || "")); if (!m) return null;
  const n = Number(m[6]), word = STAT_WORD[m[4]] || m[4].toUpperCase();
  return { game: `${usTeam(m[1])} @ ${usTeam(m[2])}`, date: m[3], stat: m[4], code: m[5], n, line: n - 0.5, word, what: `${n}+ ${word}` };
}
const propLabel = (name, ps, no) => (no ? `${name} under ${ps.n} ${ps.word}` : `${name} ${ps.what}`);
// { "<market slug>": { name, team } } for every player market of a Polymarket US event ("Amen Thompson 25+ Pts + Reb + Ast" -> Amen Thompson, HOU)
export function usPlayerNames(ev) {
  const out = {};
  for (const m of (ev && ev.markets) || []) { if (!/^astatc-nba-/.test(String(m.slug || ""))) continue;
    const name = String(m.titleShort || m.title || "").replace(/\s+\d+\+\s.*$/, "").trim(), s = (m.marketSides || []).find((x) => x.team && x.team.abbreviation);
    if (name) out[m.slug] = { name, team: s ? usTeam(s.team.abbreviation) : null }; }
  return out;
}
const NAMES_TTL = 7 * 24 * 3600;
async function usNamesFor(eventSlug) {
  if (!/^nba-[a-z]+-[a-z]+-\d{4}-\d\d-\d\d$/.test(String(eventSlug || ""))) return {};
  const key = `usnames:nba:${eventSlug}`, hit = await getJSON(key).catch(() => null); if (hit) return hit;
  try { const r = await fetch(`https://gateway.polymarket.us/v1/events/slug/${eventSlug}`, { cache: "no-store", signal: AbortSignal.timeout(10000) }); if (!r.ok) return {};
    const j = await r.json(), out = usPlayerNames(j && (j.event || j));
    if (Object.keys(out).length) await getRedis().set(key, JSON.stringify(out), "EX", NAMES_TTL).catch(() => {});
    return out; } catch { return {}; }
}
// Polymarket's player code -> a name among the game's recorded prop names ("ametho" = first name starts "ame" + last name "tho"; every split tried,
// the longest first-name part wins, a tie between two players keeps the code). The fallback when the event can no longer be read.
export function codeName(code, names) {
  let best = null, score = 0, tie = false;
  for (const n of names || []) { const w = String(n).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/-/g, " ").replace(/[^a-z ]/g, "").split(" ").filter(Boolean); if (w.length < 2) continue;
    let s = 0; for (let i = 1; i < code.length - 1; i++) { const a = code.slice(0, i), b = code.slice(i); if (w[0].startsWith(a) && w.slice(1).some((x) => x.startsWith(b))) s = Math.max(s, i); }
    if (s > score) { best = n; score = s; tie = false; } else if (s && s === score && n !== best) tie = true; }
  return tie ? null : best;
}
async function recordedNames(date, game) { const s = await getJSON(`nbaprops:${date}:${game}`).catch(() => null); return s && s.m ? [...new Set(Object.keys(s.m).map((k) => k.split("|")[0]))] : []; }
// Fills `player` (and a missing team) on the prop legs of a combo; true when a leg changed. Legs keep the name for good (the ledger is saved after).
export async function nameLegs(L) {
  let changed = false;
  for (const l of L || []) { if (!/^astatc-nba-/.test(String((l && l.slug) || "")) || l.player) continue;
    const ps = propStat(l.slug); if (!ps) continue;
    const us = (await usNamesFor(l.eventSlug || `nba-${l.slug.split("-")[2]}-${l.slug.split("-")[3]}-${ps.date}`))[l.slug];
    let name = us && us.name; if (!name) name = codeName(ps.code, await recordedNames(ps.date, ps.game));
    if (!name) continue;
    l.player = name; if (!(l.team && l.team.abbreviation) && us && us.team) l.team = { abbreviation: us.team }; changed = true; }
  return changed;
}
// A single player bet -> { label, team, game, date, kind: "prop", player, stat, line, side }
export function propOf(slug, meta, us = null) {
  const ps = propStat(slug); if (!ps) return null;
  const sub = (meta && meta.subject) || {}, subName = sub.name ? String(sub.name).replace(/\s+\d+\+\s.*$/, "").trim() : null;
  const name = (us && us.name) || subName || ps.code, tm = /\/nba\/([a-z]+)\//.exec(String(sub.image || "")), no = /^no$/i.test(String((meta && meta.outcome) || ""));
  return { label: propLabel(name, ps, no), team: (us && us.team) || (tm ? usTeam(tm[1]) : null), game: ps.game, date: ps.date, kind: "prop", player: name, stat: ps.stat, line: ps.line, side: no ? "under" : "over" };
}
// Legs -> { label, result, game, date, kind, team }: spread "asc-nba-..." outcome "+4.50" -> "BOS +4.5"; moneyline "aec-..." -> "BOS ML";
// total "tsc-...-221pt5" outcome "Over" -> "Over 221.5"; prop "astatc-...-pra-ametho-gte25" -> "Amen Thompson 25+ PRA" (player, stat, line, side kept
// for grading). Result from the leg's own state (won / lost).
export function comboPicks(L) {
  return (Array.isArray(L) ? L : []).map((l) => {
    const slug = l.slug || "", m = /^nba-([a-z]+)-([a-z]+)-(\d{4}-\d\d-\d\d)/.exec(l.eventSlug || ""), game = m ? `${usTeam(m[1])} @ ${usTeam(m[2])}` : "";
    const result = /WON/.test(l.state || "") ? "W" : /LOST/.test(l.state || "") ? "L" : l.result || null, team = l.team && l.team.abbreviation ? usTeam(l.team.abbreviation) : null;   // 10/27: a grade saved on the ledger's leg (from ESPN) rides along
    let label = l.title || slug, kind = "other", extra = {};
    if (/^asc-/.test(slug)) { const x = Number(l.outcome); label = `${team} ${isFinite(x) ? sgnLine(x) : l.outcome}`; kind = "spread"; }
    else if (/^aec-/.test(slug)) { label = `${team} ML`; kind = "ml"; }
    else if (/^tsc-/.test(slug)) { const t = /-(\d+)pt(\d)$/.exec(slug); label = `${l.outcome} ${t ? `${t[1]}.${t[2]}` : ""}`.trim(); kind = "total"; }
    else if (/^astatc-nba-/.test(slug)) { const ps = propStat(slug); if (ps) { const name = l.player || ps.code, no = /^no$/i.test(String(l.outcome || "")); label = propLabel(name, ps, no); kind = "prop"; extra = { player: name, stat: ps.stat, line: ps.line, side: no ? "under" : "over" }; } }
    const date = m ? m[3] : (propStat(slug) || {}).date || null;
    return { label, result, ...(l.actual != null && l.result ? { actual: l.actual } : {}), game: game || (propStat(slug) || {}).game || "", date, kind, ...(team && kind !== "total" ? { team } : {}), ...extra };
  });
}
// A leg Polymarket never marked, graded from the game's final score (f = { away, home, final } from ESPN)
export function markLeg(p, f) {
  if (p.result || !f || !f.final || !p.game) return p;
  const [a, h] = p.game.split(" @ "), tot = /^(Over|Under)\s+([\d.]+)$/.exec(p.label), sp = /^([A-Z]{2,3})\s+([+-][\d.]+|ML)$/.exec(p.label);
  let x = null;
  if (tot) x = (tot[1] === "Over" ? 1 : -1) * (f.away + f.home - Number(tot[2]));
  else if (sp && (sp[1] === a || sp[1] === h)) x = (sp[1] === h ? f.home - f.away : f.away - f.home) + (sp[2] === "ML" ? 0 : Number(sp[2]));
  return x == null || !isFinite(x) ? p : { ...p, result: x > 0 ? "W" : x < 0 ? "L" : "P" };
}
// A prop leg (or a single prop bet) graded from the box score (box = boxFor(date)["AWAY @ HOME"]): the player's number vs the line; a player
// not in the box score of a final game did not play -> push (Polymarket settles him at the last price, not a loss).
export function markProp(p, box) {
  if (!p || p.result || p.kind !== "prop" || !box || !box.final || !p.player || !p.stat) return p;
  const key = STAT_KEY[p.stat]; if (!key) return p;
  const row = (box.players || {})[normName(p.player)]; if (!row) return { ...p, result: "P", actual: null };
  const v = Number(row[key] || 0), over = v > Number(p.line);
  return { ...p, result: (p.side === "under" ? !over : over) ? "W" : "L", actual: v };
}

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
  // 10/19 (same fix as NFL 10/18): realizedPnl is the YES side's view; a NO-side sale's real result is effectiveRealizedPnl
  const raw = Number(tr.realizedPnl && tr.realizedPnl.value), eff = Number(tr.effectiveRealizedPnl && tr.effectiveRealizedPnl.value);
  const pl = Number.isFinite(eff) ? eff : raw; if (!Number.isFinite(pl) || Math.abs(pl) < 0.005) return null;
  const qty = Math.abs(Number(tr.qty)), px = Number(tr.price && tr.price.value);
  return { slug: tr.marketSlug, pl, proceeds: Number.isFinite(qty * px) ? qty * px : null, t: tr.updateTime || tr.createTime || null, ...(Number.isFinite(eff) && Number.isFinite(raw) && Math.abs(eff - raw) >= 0.005 ? { fixed: true } : {}) };
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
  const ledger = (await getJSON(KEY.ledger)) || {}, seen = new Set();
  // 10/27: single player bets = "astatc-" markets traded on their own (the trades are read once here, the sales below reuse them)
  const tr = await client.portfolio.activities({ limit: 100, types: ["ACTIVITY_TYPE_TRADE"] }).catch(() => null);
  const singles = tradedSingles(tr); for (const e of Object.values(ledger)) if (e && e.single) singles.add(e.id);
  const all = Object.entries(positions.positions || {}).map(([slug, p]) => ({ slug, p, meta: p.marketMetadata }));
  const list = all.filter((x) => (isNba(x.slug, x.meta) && !isComboLeg(x.slug, x.meta, singles)) || (isAcctCombo(x.slug) && nbaLegs(x.p.comboLegDetails))).map(({ slug, p }) => ({
    id: slug, title: (p.marketMetadata && p.marketMetadata.title) || slug, outcome: p.marketMetadata && p.marketMetadata.outcome,
    shares: Number(p.netPosition), cost: Number(p.cost && p.cost.value), value: p.cashValue ? Number(p.cashValue.value) : null,
    realized: p.realized ? Number(p.realized.value) : null, expired: !!p.expired, updated: p.updateTime || null, ...(isAcctCombo(slug) ? { legs: slimLegs(p.comboLegDetails) } : {}) }));
  await setJSON(KEY.synced, { t, list });
  // Permanent bet log: each position is saved the first time it appears and updated on every sync; when it expires/closes its final value is kept.
  for (const p of list) {
    seen.add(p.id);
    const e = ledger[p.id] || { id: p.id, title: p.title, outcome: p.outcome, firstSeen: t };
    Object.assign(e, { cost: p.cost, shares: p.shares, value: p.value, realized: p.realized, expired: p.expired, lastSeen: t });
    if (p.legs && p.legs.length) {   // the names found before ride along (Polymarket's legs never carry them); new prop legs get theirs now
      const old = new Map((e.legs || []).filter((l) => l && (l.player || l.result)).map((l) => [l.slug, l]));
      for (const l of p.legs) { const o = old.get(l.slug); if (!o) continue; if (!l.player && o.player) l.player = o.player; if (o.result && !l.result) { l.result = o.result; if (o.actual != null) l.actual = o.actual; } }   // 10/27: the names AND the grades found before ride along
      await nameLegs(p.legs).catch(() => false); e.legs = p.legs; }
    if (singles.has(p.id)) { e.single = true; const meta = (positions.positions[p.id] || {}).marketMetadata || {}; const us = (await usNamesFor(meta.eventSlug).catch(() => ({})))[p.id]; e.prop = propOf(p.id, meta, us) || e.prop || null; }
    if (e.shares > 0 && e.cost > 0) e.price = e.cost / e.shares;
    delete e.closedAt; ledger[p.id] = e;
  }
  for (const e of Object.values(ledger)) if (!seen.has(e.id) && !e.closedAt) e.closedAt = t;   // sold or settled since last sync
  // Settlements: a bet that vanished at settlement still gets its result and P/L.
  const res = await client.portfolio.activities({ limit: 100, types: ["ACTIVITY_TYPE_POSITION_RESOLUTION"] }).catch(() => null);
  let resolved = 0;
  for (const a of (res && res.activities) || []) {
    const x = resolvedFrom(a); if (!x || !(x.cost > 0) || isComboLeg(x.slug, x.meta, singles)) continue;
    if (!isNba(x.slug, x.meta) && !(isAcctCombo(x.slug) && ledger[x.slug])) continue;   // a combo counts once it was seen open with NBA legs
    const e = ledger[x.slug] || (ledger[x.slug] = { id: x.slug, title: x.title, outcome: x.outcome, firstSeen: x.t || t, cost: x.cost, shares: x.shares, price: x.shares > 0 ? x.cost / x.shares : null });
    if (singles.has(x.slug) && !e.prop) { e.single = true; e.prop = propOf(x.slug, x.meta, (await usNamesFor(x.meta && x.meta.eventSlug).catch(() => ({})))[x.slug]) || null; }
    if (!e.resolved) resolved++;
    e.resolved = { win: x.win, pl: x.pl, t: x.t }; e.closedAt = e.closedAt || x.t || t;
  }
  // Sales: a bet that vanished without a settlement because you sold it.
  const sales = {};
  for (const a of (tr && tr.activities) || []) { const x = soldFrom(a); if (!x) continue;
    const s = (sales[x.slug] = sales[x.slug] || { pl: 0, proceeds: 0, t: null }); s.pl += x.pl; s.proceeds += x.proceeds || 0; if (x.fixed) s.fixed = true; if (!s.t || (x.t && x.t > s.t)) s.t = x.t; }
  let sold = 0;
  // A NO-side sale saved before the 10/19 fix (YES-side profit) is re-saved once with the right number while its trade is still in the window.
  for (const [slug, x] of Object.entries(sales)) { const e = ledger[slug]; if (!e || e.resolved || seen.has(slug)) continue;
    if (e.sold && !(x.fixed && !e.sold.fx)) continue;
    if (!e.sold) sold++; e.sold = { pl: Math.round(x.pl * 100) / 100, proceeds: Math.round(((e.cost || 0) + x.pl) * 100) / 100, t: x.t, ...(x.fixed ? { fx: 1 } : {}) }; e.closedAt = e.closedAt || x.t || t; }
  await setJSON(KEY.ledger, ledger);
  return { ok: true, positions: list.length, resolved, sold, t };
}

// What the Bets tab shows: open bets, settled / sold bets, and the record.
export function summarizeLedger(ledger) {
  const rows = Object.values(ledger || {}).map((e) => (e.legs && e.legs.length ? { ...e, picks: comboPicks(e.legs) } : { ...e }));
  const open = rows.filter((e) => !e.closedAt && !e.resolved && !e.sold);
  const done = rows.filter((e) => e.resolved || e.sold).map((e) => ({ ...e, pl: e.resolved ? e.resolved.pl : e.sold.pl, result: e.resolved ? (e.resolved.win ? "win" : "loss") : "sold" }));
  const w = done.filter((e) => e.result === "win").length, l = done.filter((e) => e.result === "loss").length;
  const staked = done.reduce((s, e) => s + (e.cost || 0), 0), pl = done.reduce((s, e) => s + e.pl, 0);
  return { open, settled: done.sort((a, b) => String((b.resolved || b.sold).t || "").localeCompare(String((a.resolved || a.sold).t || ""))),
    record: { w, l, sold: done.filter((e) => e.result === "sold").length, pl: Math.round(pl * 100) / 100, staked: Math.round(staked * 100) / 100, pct: w + l ? Math.round((w / (w + l)) * 1000) / 10 : null } };
}
export async function loadMyBets() {
  const synced = await getJSON(KEY.synced).catch(() => null), ledger = (await getJSON(KEY.ledger).catch(() => null)) || {};
  // Prop legs saved before 10/27 carry no player name: looked up once here and kept in the ledger
  let dirty = false;
  for (const e of Object.values(ledger)) { if (!e || !e.legs || !e.legs.some((l) => l && /^astatc-nba-/.test(l.slug || "") && !l.player)) continue;
    if (await nameLegs(e.legs).catch(() => false)) dirty = true; }
  if (dirty) await setJSON(KEY.ledger, ledger).catch(() => {});
  const out = summarizeLedger(ledger), finals = {}, boxes = {}, today = etDate(new Date().toISOString());
  // 10/27: the promise is memoized (not the value), so a combo's four legs on one day share ONE ESPN read instead of four at once
  const fin = (d) => (finals[d] = finals[d] || finalsFor(d).catch(() => null));
  const box = (d) => (boxes[d] = boxes[d] || boxFor(d).catch(() => null));
  // Legs Polymarket never marked are graded once the game is final: spread / moneyline / total from the score, a prop from the box score
  // (one ESPN read per game day); the same for a single prop bet still open after its game. Settled and open bets alike (a 2-day combo).
  // 10/27: a grade is written back onto the ledger's leg (result / actual), so a graded leg is never read from ESPN again -- before, every
  // page load re-read the box score of every day with a prop leg in the ledger (a dozen ESPN calls a load, growing with every bet).
  for (const e of [...out.settled, ...out.open]) {
    const todo = (e.picks || []).filter((p) => !p.result && p.date && p.date <= today);
    if (todo.length) e.picks = await Promise.all(e.picks.map(async (p) => (p.result || !p.date || p.date > today ? p
      : p.kind === "prop" ? markProp(p, ((await box(p.date)) || {})[p.game]) : markLeg(p, ((await fin(p.date)) || {})[p.game]))));
    if (e.prop && !e.prop.result && e.prop.date && e.prop.date <= today) e.prop = markProp(e.prop, ((await box(e.prop.date)) || {})[e.prop.game]);
    const L = ledger[e.id];
    if (L && L.legs && e.picks) e.picks.forEach((p, i) => { const l = L.legs[i]; if (l && p.result && !l.result && !/WON|LOST/.test(l.state || "")) { l.result = p.result; if (p.actual != null) l.actual = p.actual; dirty = true; } });
    if (L && L.prop && e.prop && e.prop.result && !L.prop.result) { L.prop = e.prop; dirty = true; }
  }
  if (dirty) await setJSON(KEY.ledger, ledger).catch(() => {});
  return { syncedAt: synced ? synced.t : null, ...out };
}
