// Polymarket US (10/17, owner: "it needs to match my app"): every Polymarket number in the app is read from Polymarket US -- the markets and prices
// the owner's Polymarket app shows. The international site (gamma-api.polymarket.com, read before) lists other alternate lines: the card showed
// "Under 56.5" where the owner's app has 55.5 and 57.5. Public gateway, no sign-in:
//   /v1/events?tagSlug=nfl&startDateMin=&startDateMax=   the games (one market each)
//   /v1/events/slug/<sport>-<away>-<home>-<ET date>      every market of one game
//   /v1/markets/<market slug>/book                        the order book of one market
// A market has a YES side ("long": away team for spreads, Over, the player's YES) with the best bid / ask; buying the other side costs 1 - best bid.
// Each market is turned into the shape lib/poly.js and nba/lib/poly.js already parse (outcomes, bestBid, bestAsk, line).
export const US = process.env.POLY_US_BASE || "https://gateway.polymarket.us";
async function getJson(path, ms = 15000) {
  const r = await fetch(`${US}${path}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} on ${path}`);
  return r.json();
}
const qv = (x) => { const v = Number(x && typeof x === "object" ? x.value : x); return v > 0 && v < 1 ? v : null; };
const num = (x) => Number(String(x ?? "").replace(/^\+/, ""));
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
// Polymarket US team codes that differ from the app's
export const US_TEAM = { nfl: { LAR: "LA", WSH: "WAS", JAC: "JAX", LVR: "LV" }, nba: { GS: "GSW", NO: "NOP", SA: "SAS", NY: "NYK", PHO: "PHX" } };
export const appTeam = (code, sport = "nfl") => { const u = String(code || "").toUpperCase(); return (US_TEAM[sport] || {})[u] || u; };
const PRE = { nfl: "football", nba: "basketball" };

// The league's games starting between fromMs and toMs: [{ slug, away, home, start }] (team codes in the app's spelling)
export async function usGames(sport, fromMs, toMs) {
  const j = await getJson(`/v1/events?tagSlug=${sport}&limit=200&closed=false&startDateMin=${iso(fromMs)}&startDateMax=${iso(toMs)}`);
  const re = new RegExp(`^${sport}-([a-z]+)-([a-z]+)-(\\d{4}-\\d\\d-\\d\\d)$`), out = [];
  for (const e of (j && j.events) || []) { const m = re.exec(e.slug || ""); if (!m || e.closed) continue;
    out.push({ slug: e.slug, away: appTeam(m[1], sport), home: appTeam(m[2], sport), start: e.startTime || null }); }
  return out;
}
// Every open event of a league (games and futures), page by page (100 a page, up to 5 pages)
export async function usEventList(tag) {
  const out = [];
  for (let off = 0; off < 500; off += 100) { const j = await getJson(`/v1/events?tagSlug=${tag}&limit=100&offset=${off}&closed=false`, 20000);
    const ev = (j && j.events) || []; out.push(...ev); if (ev.length < 100) break; }
  return out;
}
export async function usEvent(slug) { const j = await getJson(`/v1/events/slug/${encodeURIComponent(slug)}`, 20000); return (j && (j.event || j)) || null; }

// Player name from a market title: "Jaylen Warren 1+ TD" -> "Jaylen Warren", "Germie Bernard O9 FPTS" -> "Germie Bernard"
export const usPlayerName = (m) => String((m && (m.titleShort || m.title)) || "").replace(/\s+O?\d+\+?\s.*$/, "").trim();
// Player yardage / catch markets ("DK Metcalf 40+ Rec Yds" = Over 39.5) for the prop recorder (lib/props.js)
const STAT = new Set(["passing_yards", "passing_attempts", "passing_completions", "rushing_yards", "receiving_yards", "receptions", "longest_reception"]);
// One Polymarket US market -> the gamma-style market the parsers read, or null (half / quarter markets and other types are left out)
export function toGamma(m, sport = "nfl") {
  const pre = PRE[sport] || PRE.nfl, t = String((m && m.sportsMarketType) || ""), sides = (m && m.marketSides) || [];
  const L = sides.find((s) => s.long), S = sides.find((s) => !s.long); if (!L || !S) return null;
  const bid = qv(m.bestBidQuote), ask = qv(m.bestAskQuote), mid = bid != null && ask != null ? (bid + ask) / 2 : ask ?? bid; if (mid == null) return null;
  const base = { slug: m.slug, _usSlug: m.slug, closed: !!m.closed || m.active === false, bestBid: bid ?? 0, bestAsk: ask ?? 0,
    outcomePrices: [+mid.toFixed(4), +(1 - mid).toFixed(4)], spread: bid != null && ask != null ? +(ask - bid).toFixed(4) : null };
  const tm = (s) => appTeam(s.team && s.team.abbreviation, sport);
  if (t === `${pre}_team_full_game_winner`) return { ...base, sportsMarketType: "moneyline", question: "Moneyline", outcomes: [tm(L), tm(S)] };
  if (t === `${pre}_team_full_game_spread`) { const line = num(L.description); if (!isFinite(line) || !tm(L) || !tm(S)) return null;
    return { ...base, sportsMarketType: "spreads", question: `Spread: ${tm(L)} (${line})`, outcomes: [tm(L), tm(S)], line }; }
  if (t === `${pre}_team_full_game_total`) { const line = num(m.line); if (!isFinite(line)) return null;
    return { ...base, sportsMarketType: "totals", question: `O/U ${line}`, outcomes: /under/i.test(L.description) ? ["Under", "Over"] : ["Over", "Under"], line }; }
  if (pre !== "football") return null;
  const name = usPlayerName(m); if (!name) return null;
  if (t === "football_player_touchdowns" && num(m.line) === 1) return { ...base, sportsMarketType: "anytime_touchdowns", question: `${name} 1+ touchdowns`, outcomes: ["Yes", "No"] };
  const st = t.replace(/^football_player_/, "");
  if (STAT.has(st) && isFinite(num(m.line))) { const line = num(m.line) - 0.5; return { ...base, sportsMarketType: st, question: `${name}: ${st} O/U ${line}`, line, outcomes: ["Over", "Under"] }; }
  return null;
}
export const usMarkets = (ev, sport = "nfl") => ((ev && ev.markets) || []).map((m) => toGamma(m, sport)).filter(Boolean);

// Dollars resting within 5 cents of the best bid / best ask. flip = read the other side (home team of a spread whose YES side is the away team).
export async function usBook(slug, flip = false) {
  if (!slug) return null;
  const d = ((await getJson(`/v1/markets/${encodeURIComponent(slug)}/book`, 8000)) || {}).marketData || {};
  const rd = (xs) => (xs || []).map((x) => [qv(x.px), Number(x.qty)]).filter(([p, q]) => p != null && q > 0);
  let bids = rd(d.bids), asks = rd(d.offers || d.asks);
  if (flip) [bids, asks] = [asks.map(([p, q]) => [1 - p, q]), bids.map(([p, q]) => [1 - p, q])];
  const bb = bids.length ? Math.max(...bids.map((x) => x[0])) : null, ba = asks.length ? Math.min(...asks.map((x) => x[0])) : null;
  const sum = (xs, ok) => Math.round(xs.filter(([p]) => ok(p)).reduce((a, [p, s]) => a + p * s, 0));
  return { bb: bb == null ? null : +bb.toFixed(4), ba: ba == null ? null : +ba.toFixed(4), bd: bb == null ? 0 : sum(bids, (p) => p >= bb - 0.05), ad: ba == null ? 0 : sum(asks, (p) => p <= ba + 0.05) };
}
