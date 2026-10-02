// What you have actually placed, shared by My Bets (display) and the weekly $200 budget (stake sizing) so both always agree.
// Kept free of imports from week.js / mybets.js so either can use it without a cycle.
import { SEASON, loadSeason } from "./games";
import { getJSON } from "./redis";
import { SEED_BETS, SEED_SEASON } from "./betsSeed";

// Week a bet belongs to: the week of the latest game that had kicked off by then (a settlement comes after its last game).
export function makeWeekAt(rows) {
  const r = (rows || []).filter((g) => g.kickoff).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  return (ts) => { const at = ts ? new Date(ts).getTime() : NaN; if (!isFinite(at)) return null; let w = null; for (const g of r) { if (new Date(g.kickoff).getTime() <= at) w = g.week; else break; } return w; };
}
// A combo's individual legs show up in the account as their own positions (slug "astatc-...", state COMBO_LEG_STATE_*).
// Only the combo itself ("caoc-...") is money; counting the legs as bets inflated the loss count (2-53 on 10/2).
export const isComboLeg = (slug, meta) => /^astatc-/i.test(String(slug || "")) || /^COMBO_LEG/i.test(String((meta && (meta.settlement && meta.settlement.state || meta.state)) || ""));
// An account entry that is the same bet as a typed-in combo: same stake AND same payout (the week on a settlement-only entry is a guess).
export const sameAsSeed = (e, seed) => (seed || []).some((b) => Math.abs(b.cost - (e.cost || 0)) < 0.011 && Math.abs(b.toWin - (e.shares || 0)) < 1);
// The week an account entry belongs to: when it settled if known (earlier versions saved the week the sync ran).
export const accountWeek = (e, weekAt) => (e.resolved && e.resolved.t && weekAt(e.resolved.t)) ?? e.week;

// Dollars placed in one week: typed-in combos plus account bets, each bet once, never combo legs.
export async function placedThisWeek(season, week) {
  const seed = season === SEED_SEASON ? SEED_BETS : [];
  const ledger = (await getJSON("mybets:ledger").catch(() => null)) || {};
  const weekAt = makeWeekAt(await loadSeason(season).catch(() => []));
  const typed = seed.filter((b) => Number(b.week) === Number(week)).reduce((s, b) => s + b.cost, 0);
  const account = Object.values(ledger).filter((e) => Number(e.season ?? SEASON) === Number(season) && !isComboLeg(e.id) && !sameAsSeed(e, seed) && Number(accountWeek(e, weekAt)) === Number(week))
    .reduce((s, e) => s + (Number(e.cost) || 0), 0);
  return typed + account;
}
