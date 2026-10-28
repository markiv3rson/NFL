// Polymarket US (10/17, owner: "it needs to match my app"): every Polymarket number in the app is read from Polymarket US -- the markets and prices
// the owner's Polymarket app shows. The international site (gamma-api.polymarket.com, read before) lists other alternate lines: the card showed
// "Under 56.5" where the owner's app has 55.5 and 57.5. Public gateway, no sign-in:
//   /v1/events?tagSlug=nfl&startDateMin=&startDateMax=   the games (one market each)
//   /v1/events/slug/<sport>-<away>-<home>-<ET date>      every market of one game
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
const STAT = new Set(["passing_yards", "passing_attempts", "passing_completions", "rushing_yards", "receiving_yards", "receptions", "longest_reception", "scrimmage_yards"]);
// One Polymarket US market -> the gamma-style market the parsers read, or null (half / quarter markets and other types are left out; a TD market
// nobody is selling has no price -- its bid is not a price you can buy at)
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
  if (t === "football_player_touchdowns" && num(m.line) === 1 && ask != null) return { ...base, sportsMarketType: "anytime_touchdowns", question: `${name} 1+ touchdowns`, outcomes: ["Yes", "No"] };
  // 10/20: first-TD markets ("A.J. Brown scores the first touchdown", titleShort = the name) -> "<name> first touchdown"; lib/picks.js isAnytimeTD keeps them out of the anytime prices
  if (t === "football_player_first_touchdown" && ask != null) { const fn = String(m.titleShort || "").trim() || name; return { ...base, sportsMarketType: "first_touchdown", question: `${fn} first touchdown`, outcomes: ["Yes", "No"] }; }
  const st = t.replace(/^football_player_/, "");
  if (STAT.has(st) && isFinite(num(m.line))) { const line = num(m.line) - 0.5; return { ...base, sportsMarketType: st, question: `${name}: ${st} O/U ${line}`, line, outcomes: ["Over", "Under"] }; }
  return null;
}
export const usMarkets = (ev, sport = "nfl") => ((ev && ev.markets) || []).map((m) => toGamma(m, sport)).filter(Boolean);

// PRICE HISTORY (10/27, owner: the game page chart "like theirs"; docs.polymarket.us -> Get Price History): GET /v1/price-history?symbol=<market slug>
// &fixedInterval=<window>&fidelity=<minutes>. One market per call, public, cache 30 s. `longPrice` = the YES side's display price (best ask) -- on a
// moneyline the AWAY team; `shortPrice` = the NO side's (1 - best bid) = the HOME team. Each point holds the LAST price of its bucket, so a 3-hour
// point stamped 2 h before kickoff already carries in-game prices -- fine for the chart, never for a pre-game test. History is kept after the game.
export const HIST_RANGES = { "1d": ["INTERVAL_1D", 5], "1w": ["INTERVAL_1W", 180], "1m": ["INTERVAL_1M", 180], all: ["INTERVAL_ALL", 180], live: ["INTERVAL_LIVE", 1] };
const US_CODE = { nfl: { LA: "lar" }, nba: { GSW: "gs", NOP: "no", SAS: "sa", NYK: "ny", PHX: "pho" } };
export const usCode = (team, sport = "nfl") => (US_CODE[sport] || {})[String(team).toUpperCase()] || String(team).toLowerCase();
// the moneyline market of a game: aec-<sport>-<away>-<home>-<Eastern date of the start>
export function moneylineSlug(sport, away, home, startIso) {
  const d = new Date(startIso); if (isNaN(d)) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `aec-${sport}-${usCode(away, sport)}-${usCode(home, sport)}-${day}`;
}
// [[t, away, home]]: the placeholder prices from before a market had a book (both sides ~0.9, or one side missing) are dropped from the front;
// after that every point stays (in a game the two sides can sum far from 1 near the end)
export function cleanHistory(h) {
  const pts = (Array.isArray(h) ? h : []).map((p) => [Number(p.timestamp), Number(p.longPrice), Number(p.shortPrice)])
    .filter((p) => p[0] > 0 && p[1] >= 0 && p[1] <= 1 && p[2] >= 0 && p[2] <= 1).sort((a, b) => a[0] - b[0]);
  const ok = (p) => p[1] + p[2] >= 0.9 && p[1] + p[2] <= 1.12;
  const i = pts.findIndex(ok);
  return i < 0 ? [] : pts.slice(i);
}
export async function priceHistory(slug, range = "all") {
  const [iv, fid] = HIST_RANGES[range] || HIST_RANGES.all;
  const j = await getJson(`/v1/price-history?symbol=${encodeURIComponent(slug)}&fixedInterval=${iv}&fidelity=${fid}`, 12000);
  return cleanHistory(j && j.history);
}
