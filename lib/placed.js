// Helpers for the Bets tab (lib/mybets.js): which week a bet belongs to, combo legs, typed-in duplicates.
// (The weekly $200 budget that also used these was removed 10/14.)

// Week a bet belongs to: the week of the latest game that had kicked off by then (a settlement comes after its last game).
export function makeWeekAt(rows) {
  const r = (rows || []).filter((g) => g.kickoff).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  return (ts) => { const at = ts ? new Date(ts).getTime() : NaN; if (!isFinite(at)) return null; let w = null; for (const g of r) { if (new Date(g.kickoff).getTime() <= at) w = g.week; else break; } return w; };
}
// A combo's individual legs show up in the account as their own positions (slug "astatc-...", state COMBO_LEG_STATE_*).
// Only the combo itself ("caoc-...") is money; counting the legs as bets inflated the loss count (2-53 on 10/2).
// 10/19 fix (owner: "why is my single bets not showing?"): Polymarket uses the same "astatc-" name for SINGLE player bets (first TD, anytime TD,
// props), which were skipped too. A single is an "astatc-" market traded ON ITS OWN (a trade activity under its own name -- a combo trades
// under its "caoc-" / "crossd-" name, never its legs'); `singles` = those names (plus ledger rows already known as singles).
export const isComboLeg = (slug, meta, singles = null) => (/^astatc-/i.test(String(slug || "")) && !(singles && singles.has(String(slug))))
  || /^COMBO_LEG/i.test(String((meta && (meta.settlement && meta.settlement.state || meta.state)) || ""));
export function tradedSingles(activities) {
  const out = new Set();
  for (const a of (activities && activities.activities) || []) { const s = a && a.trade && a.trade.marketSlug; if (/^astatc-/i.test(String(s || ""))) out.add(String(s)); }
  return out;
}
// An account entry that is the same bet as a typed-in combo: same stake AND same payout (the week on a settlement-only entry is a guess).
export const sameAsSeed = (e, seed) => (seed || []).some((b) => Math.abs(b.cost - (e.cost || 0)) < 0.011 && Math.abs(b.toWin - (e.shares || 0)) < 1);
// The week an account entry belongs to: when it settled if known (earlier versions saved the week the sync ran).
export const accountWeek = (e, weekAt) => (e.resolved && e.resolved.t && weekAt(e.resolved.t)) ?? e.week;
// 10/20 review: the week of the GAMES a bet is on, once its legs / prop name them -- the earliest scheduled week (on or after `from`, the
// placement week) holding each game, the latest of those. A combo on Thursday's NE @ CHI placed during Monday night's week-6 game was filed under
// week 6: its record counted in week 6, its TD prices were read from week 6 and its legs were marked from week 6's finals (never, for a week-7
// game). null when a game is not on the schedule (the placement week stays).
export function gameWeekOf(games, rows, from = null) {
  const keys = [...new Set((games || []).filter(Boolean))]; if (!keys.length) return null;
  let w = null;
  for (const k of keys) {
    const ws = (rows || []).filter((g) => g.key === k && g.week != null).map((g) => Number(g.week)).sort((a, b) => a - b);
    const hit = ws.find((x) => from == null || x >= Number(from)) ?? ws[ws.length - 1];
    if (hit == null) return null;
    w = w == null ? hit : Math.max(w, hit);
  }
  return w;
}
