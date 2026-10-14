// Helpers for the Bets tab (lib/mybets.js): which week a bet belongs to, combo legs, typed-in duplicates.
// (The weekly $200 budget that also used these was removed 10/14.)

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
