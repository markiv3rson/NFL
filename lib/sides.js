// A straight team bet read from its Polymarket US market slug (10/29, owner: "Why does the straight bets look like that? Why doesn't it show it like in
// a parlay style?" -> the bet as a leg: team + side, graded like a parlay leg). Both sports. The market's YES side is in the slug:
//   moneyline aec-<sport>-<a>-<b>-<date>                 YES = <a> wins
//   spread    asc-<sport>-<a>-<b>-<date>-<neg|pos>-<n>pt<d>  YES = <a> at that line (checked on the owner's own legs: asc-nba-gs-min-...-neg-7pt5 = GS -7.5)
//   total     tsc-<sport>-<a>-<b>-<date>-<n>pt<d>        YES = Over
// A NEGATIVE position (Polymarket's netPosition < 0, with money in it) holds the market's OTHER side: the other team at the opposite line, or the Under
// (DEN Nuggets vs. NO Pelicans "+4.50", -10 shares, $5.13 = NO +4.5 at 51c, pays $10).
export function teamSingle(slug, short, team = (c) => String(c || "").toUpperCase()) {
  const m = /^(aec|asc|tsc)-(nfl|nba)-([a-z]+)-([a-z]+)-(\d{4}-\d\d-\d\d)(?:-(neg|pos))?(?:-(\d+)pt(\d+))?$/.exec(String(slug || ""));
  if (!m) return null;
  const [, kind, , a0, b0, date, sign, n, d] = m, a = team(a0), b = team(b0), num = n != null ? Number(`${n}.${d}`) : null, game = `${a} @ ${b}`;
  if (kind === "aec") { const t = short ? b : a; return { kind: "ml", team: t, label: `${t} ML`, game, date }; }
  if (kind === "asc") { if (num == null || !sign) return null; const ln = (sign === "neg" ? -1 : 1) * num * (short ? -1 : 1), t = short ? b : a;
    return { kind: "spread", team: t, line: ln, label: `${t} ${ln > 0 ? "+" : ""}${ln}`, game, date }; }
  if (num == null) return null;
  return { kind: "total", side: short ? "under" : "over", line: num, label: `${short ? "Under" : "Over"} ${num}`, game, date };
}
// Polymarket's position -> { shares (always positive), short } (a position with no money in it is not a bet)
export const sideOf = (netPosition) => { const n = Number(netPosition); return { shares: Math.abs(n), short: n < 0 }; };
