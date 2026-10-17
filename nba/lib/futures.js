// Futures: the model service's season simulation (wins, playoffs, seeds, conference and title chances) next to Polymarket's own prices.
// Shown on the Models tab only. NO picks and no "value": the simulation is about as good as last year's record plus how much of the
// roster is back (see the backtest numbers it carries), and on the two past seasons with market prices the market was closer.
import { TEAMS, ABBRS } from "./teams";
import { modelBase, modelHeaders } from "./model";
import { getRedis, jparse } from "./redis";

const GAMMA = () => process.env.GAMMA_BASE || "https://gamma-api.polymarket.com";
const arr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || "[]"); } catch { return []; } };

// "Los Angeles Clippers" / "LA Clippers" / "Trail Blazers" -> LAC / POR (a Polymarket name or a model-service name)
export const abbrOfName = (name) => {
  const n = String(name || "").trim();
  return ABBRS.find((a) => TEAMS[a].name === n) || ABBRS.find((a) => n.endsWith(TEAMS[a].nick)) || null;
};

async function getJson(url, fetcher = fetch) {
  const r = await fetcher(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} from Polymarket`);
  return r.json();
}
export async function fetchFutureEvents(fetcher = fetch) {
  const out = [];
  for (const off of [0, 100]) {
    const page = await getJson(`${GAMMA()}/events?tag_slug=nba&closed=false&limit=100&offset=${off}&order=volume&ascending=false`, fetcher);
    out.push(...page); if (page.length < 100) break;
  }
  return out;
}

// one Polymarket price: the midpoint of a real two-sided book, else the listed price; "thin" when the book is wide or empty
export function priceOf(m) {
  const mid = arr(m.outcomePrices).map(Number), bid = Number(m.bestBid), ask = Number(m.bestAsk);
  const two = bid > 0 && ask > 0 && ask > bid;
  const p = two ? (bid + ask) / 2 : mid[0];
  return { p: Number.isFinite(p) ? p : null, thin: !two || ask - bid > 0.08 };
}
const eventRows = (ev) => {
  const rows = {};
  for (const m of ev.markets || []) { if (m.closed) continue; const a = abbrOfName(m.groupItemTitle); if (!a) continue; rows[a] = priceOf(m); }
  return rows;
};
const findEvent = (events, re) => events.find((e) => re.test(e.title || ""));
const lineOf = (m) => { const x = String(m.question || "").match(/O\/U\s*([\d.]+)/); return x ? Number(x[1]) : null; };

const PCT = (x) => (x == null ? null : Math.round(x * 10) / 10);
// build the page data from the service's simulation + Polymarket's events
export function buildFutures(sim, events) {
  const byAbbr = {}; for (const t of sim.teams || []) { const a = abbrOfName(t.team); if (a) byAbbr[a] = t; }
  const section = (id, title, key, ev, note) => {
    const mk = ev ? eventRows(ev) : {};
    const rows = ABBRS.filter((a) => byAbbr[a]).map((a) => ({ team: a, model: PCT(byAbbr[a][key]), market: mk[a] && mk[a].p != null ? PCT(mk[a].p * 100) : null, thin: !!(mk[a] && mk[a].thin) }));
    rows.sort((x, y) => (y.model || 0) - (x.model || 0));
    return { id, title, note: note || "", market: !!ev, rows };
  };
  const ev = (re) => findEvent(events, re);
  const sections = [
    section("champion", "Champion", "champion", ev(/^NBA: \d{4} Champion$/)),
    section("east", "East champion", "conf_champion", ev(/Eastern Conference Champion/)),
    section("west", "West champion", "conf_champion", ev(/Western Conference Champion/)),
    section("playoffs", "Make the playoffs", "playoffs", ev(/Team to Make Playoffs/), "Counts the play-in: a team must win its way into the 7 or 8 seed."),
    section("playin", "Make the play-in", "play_in", ev(/Team to Make Play-In/), "Finish 7th to 10th in the conference."),
    section("seed1", "#1 seed", "seed1", ev(/Eastern Conference #1 Seed/), "East shown with the East market, West with the West market."),
  ];
  // the #1-seed market is one event per conference: put each conference's rows next to its own prices
  const e1 = ev(/Eastern Conference #1 Seed/), w1 = ev(/Western Conference #1 Seed/), s1 = sections[5];
  const mkE = e1 ? eventRows(e1) : {}, mkW = w1 ? eventRows(w1) : {};
  s1.rows = ABBRS.filter((a) => byAbbr[a]).map((a) => { const m = (byAbbr[a].conf === "East" ? mkE : mkW)[a]; return { team: a, model: PCT(byAbbr[a].seed1), market: m && m.p != null ? PCT(m.p * 100) : null, thin: !!(m && m.thin) }; }).sort((x, y) => (y.model || 0) - (x.model || 0));
  s1.market = !!(e1 || w1);
  // season wins: Polymarket's win-total LINES next to the model's expected wins (the order books there are usually empty: lines only)
  const wt = ev(/Regular Season Win Totals/), wins = [];
  const lines = {}; if (wt) for (const m of wt.markets || []) { const a = abbrOfName(m.groupItemTitle); if (a) lines[a] = { line: lineOf(m), ...priceOf(m) }; }
  for (const a of ABBRS) if (byAbbr[a]) {
    const t = byAbbr[a], L = lines[a];
    const over = L && L.line != null ? Math.round(t.ge[Math.min(83, Math.floor(L.line) + 1)] * 1000) / 10 : null;
    wins.push({ team: a, ew: t.ew, low: t.w10, high: t.w90, returning: t.returning_pct == null ? null : t.returning_pct, line: L ? L.line : null, modelOver: over, marketOver: L && !L.thin && L.p != null ? PCT(L.p * 100) : null });
  }
  wins.sort((x, y) => y.ew - x.ew);
  return { ok: true, season: sim.season, built: sim.built, sims: sim.sims, sections, wins, report: sim.report || null, stale: sim.stale_hours || null, polymarket: events.length > 0 };
}

export async function loadFutures({ fetcher = fetch, now = Date.now() } = {}) {
  const base = modelBase(); if (!base) throw new Error("MODEL_SERVICE_URL not set");
  const r = getRedis(), ckey = "futures:poly";
  let events = null; const c = jparse(await r.get(ckey).catch(() => null));
  if (c && now - c.t < 10 * 60e3) events = c.events;
  else { try { events = await fetchFutureEvents(fetcher); await r.set(ckey, JSON.stringify({ t: now, events }), "EX", 3600).catch(() => {}); } catch { events = c ? c.events : []; } }
  const res = await fetcher(`${base}/futures`, { headers: modelHeaders(), cache: "no-store", signal: AbortSignal.timeout(25000) });
  const sim = await res.json().catch(() => null);
  if (!sim || !sim.ok) return { ok: false, loading: !!(sim && sim.loading), error: (sim && sim.error) || `model service ${res.status}` };
  return buildFutures(sim, events);
}
