// Replay (10/1): every pick rule the app tracks, replayed on past seasons (2007-25, nflverse closing lines) so the Results tab can
// show, next to the live record, whether a rule has ever held up. Rule-based rows are computed here from the public schedule file.
// The two "model side" rows need the Python power ratings, so they are fixed numbers from the 2013-25 walk-forward backtest
// (core ratings, weeks 4+, each week fit only on earlier games) and say so.
// Verdict: a rule is only "YES" when it beats break-even in ALL THREE periods of its history, not just on average. It was found
// by scanning many rules, so an average alone is exactly what luck can produce.
import { parseCSV } from "./injuries";
import { getJSON, setJSON } from "./redis";
import { SEASON } from "./games";
const URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
export const BREAK_EVEN = 0.524;                       // -110
const PERIODS = [[2007, 2012], [2013, 2018], [2019, 2025]];
const MIN_N = 100;
const MODEL_ROWS = [   // from the 2013-25 backtest; periods 2013-17, 2018-21, 2022-25
  { id: "spread_model", name: "Spread · model side", kind: "ats", note: "model replay 2013–25", n: 2713, hit: 0.4884, periods: [{ n: 1014, hit: 0.4803 }, { n: 827, hit: 0.5139 }, { n: 872, hit: 0.4736 }] },
  { id: "total_model", name: "Total · model side", kind: "ats", note: "model replay 2013–25", n: 2755, hit: 0.4915, periods: [{ n: 1031, hit: 0.4947 }, { n: 836, hit: 0.4761 }, { n: 888, hit: 0.5023 }] },
];
export function verdict(kind, n, overall, periods) {
  if (kind === "win") return "INFO";
  if (n < MIN_N) return "TOO FEW";
  const bar = kind === "ml" ? 0 : BREAK_EVEN, v = (p) => p.value;
  if (!(overall > bar)) return "NO EDGE";
  return periods.length && periods.every((p) => p.n >= 30 && v(p) > bar) ? "YES" : "UNSTABLE";
}
// rows: parsed games (see parse below). Returns the table.
export function computeReplay(rows) {
  const g = rows.filter((r) => r.season >= 2007 && r.season < SEASON && r.hs != null && r.as != null && r.spread != null).sort((a, b) => a.season - b.season || a.week - b.week);
  const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  // each team's previous game this season (pts for/against) and next game's week, for the situational rules
  const byTeam = {};
  for (const r of g) for (const t of [r.home, r.away]) (byTeam[`${r.season}|${t}`] = byTeam[`${r.season}|${t}`] || []).push(r);
  const prevOf = (r, t) => { const l = byTeam[`${r.season}|${t}`]; const i = l.indexOf(r); return i > 0 ? l[i - 1] : null; };
  const nextOf = (r, t) => { const l = byTeam[`${r.season}|${t}`]; const i = l.indexOf(r); return i < l.length - 1 ? l[i + 1] : null; };
  const ptsFor = (p, t) => (p.home === t ? p.hs : p.as), ptsAg = (p, t) => (p.home === t ? p.as : p.hs);
  const out = [];
  const periodsOf = (picks, valueOf) => PERIODS.map(([a, b]) => { const xs = picks.filter((p) => p.r.season >= a && p.r.season <= b); return { label: `${a}–${String(b).slice(2)}`, n: xs.length, value: xs.length ? valueOf(xs) : null }; });
  // ats rules: pick(r) -> +1 win / -1 loss / 0 push (or null = rule does not apply)
  const ats = (id, name, f) => { const picks = []; for (const r of g) { const x = f(r); if (x != null && x !== 0) picks.push({ r, x }); }
    const hit = (xs) => xs.filter((p) => p.x > 0).length / xs.length, ps = periodsOf(picks, hit);
    out.push({ id, name, kind: "ats", n: picks.length, hit: picks.length ? hit(picks) : null, periods: ps.map((p) => ({ label: p.label, n: p.n, hit: p.value, value: p.value })), verdict: verdict("ats", picks.length, picks.length ? hit(picks) : 0, ps) }); };
  const cov = (r) => sgn(r.hs - r.as - r.spread);      // +1 home covers (spread = home favored by)
  ats("dog", "Road dogs +3 to +6.5", (r) => (r.spread >= 3 && r.spread <= 6.5 ? -cov(r) : null));
  ats("away3", "Road team, spread 3 or less", (r) => (Math.abs(r.spread) <= 3 ? -cov(r) : null));
  ats("wind", "Under, wind 12+ mph", (r) => (r.total != null && r.wind != null && r.wind >= 12 && /outdoor|open/i.test(r.roof || "") ? -sgn(r.hs + r.as - r.total) : null));
  ats("lowloss", "Underdog off a loss scoring 10 or fewer", (r) => { if (!r.spread) return null; const dog = r.spread < 0 ? r.home : r.away, p = prevOf(r, dog); if (!p || !(ptsFor(p, dog) < ptsAg(p, dog)) || ptsFor(p, dog) > 10) return null; return r.spread < 0 ? cov(r) : -cov(r); });
  ats("prebye", "Home team before its bye (wk 8+)", (r) => { if (r.week < 8) return null; const n = nextOf(r, r.home); return n && n.week >= r.week + 2 ? cov(r) : null; });
  // moneyline rows
  { const picks = g.filter((r) => r.spread >= 9.5 && r.hml != null && r.hs !== r.as).map((r) => ({ r, x: r.hs > r.as ? (r.hml < 0 ? 100 / -r.hml : r.hml / 100) : -1 }));
    const roi = (xs) => xs.reduce((a, p) => a + p.x, 0) / xs.length, win = (xs) => xs.filter((p) => p.x > 0).length / xs.length, ps = periodsOf(picks, roi);
    out.push({ id: "homefav", name: "Home fav 9.5+ · moneyline", kind: "ml", n: picks.length, hit: picks.length ? win(picks) : null, roi: picks.length ? roi(picks) : null,
      periods: ps.map((p, i) => ({ label: p.label, n: p.n, hit: p.n ? win(picks.filter((q) => q.r.season >= PERIODS[i][0] && q.r.season <= PERIODS[i][1])) : null, value: p.value })), verdict: verdict("ml", picks.length, picks.length ? roi(picks) : 0, ps) }); }
  { const picks = g.filter((r) => r.spread !== 0 && r.hs !== r.as).map((r) => ({ r, x: (r.spread > 0) === (r.hs > r.as) ? 1 : -1 }));
    const hit = (xs) => xs.filter((p) => p.x > 0).length / xs.length, ps = periodsOf(picks, hit);
    out.unshift({ id: "favorite", name: "Moneyline · market favorite wins", kind: "win", n: picks.length, hit: hit(picks), periods: ps.map((p) => ({ label: p.label, n: p.n, hit: p.value, value: p.value })), verdict: "INFO" }); }
  const model = MODEL_ROWS.map((m) => ({ ...m, periods: m.periods.map((p, i) => ({ label: ["2013–17", "2018–21", "2022–25"][i], n: p.n, hit: p.hit, value: p.hit })), verdict: verdict(m.kind, m.n, m.hit, m.periods.map((p) => ({ n: p.n, value: p.hit }))) }));
  const first = out.splice(0, 1);
  return { t: new Date().toISOString(), seasons: [Math.min(...g.map((r) => r.season)), Math.max(...g.map((r) => r.season))], rows: [...first, ...model, ...out], parlays: parlayHistory(rows) };
}

// Parlay history (10/2): the paper parlay rules that need only the market, replayed week by week on past seasons, so the Pick Lab
// scoreboard can show a long-run hit rate and return next to the live one. Same rules as lib/paper.js buildPaper:
//   home_fav_95_single/2/3  home favorites of 9.5+ on the moneyline, best-priced first, 1, 2 or 3 per week (different games)
//   top3_home_75            the 3 home teams the market gives 75%+ (no-vig chance), biggest first
// Priced at the home moneyline itself (vig included), so returns are what buying it would have paid. A tie drops that parlay.
// Rules that need the model's own past numbers (touchdown parlays, "Right now", the model's best 4, same-game) have no history here.
const dec = (a) => (a < 0 ? 1 + 100 / -a : 1 + a / 100);
export function parlayHistory(rows) {
  const g = rows.filter((r) => r.season >= 2007 && r.season < SEASON && r.hs != null && r.as != null && r.hml != null && r.hs !== r.as);
  const weeks = {}; for (const r of g) (weeks[`${r.season}|${r.week}`] = weeks[`${r.season}|${r.week}`] || []).push(r);
  const price = (r) => 1 / dec(r.hml);
  const nv = (r) => { const h = 1 / dec(r.hml); if (r.aml == null) return h; const a = 1 / dec(r.aml); return h / (h + a); };   // no-vig home chance
  const defs = [["home_fav_95_single", "Home favorites 9.5+ · moneyline · singles", 1, (w) => w.filter((r) => r.spread >= 9.5).sort((a, b) => price(b) - price(a)), "single"],
    ["home_fav_95_2", "Home favorites 9.5+ · moneyline · 2-leg", 2, (w) => w.filter((r) => r.spread >= 9.5).sort((a, b) => price(b) - price(a))],
    ["home_fav_95_3", "Home favorites 9.5+ · moneyline · 3-leg", 3, (w) => w.filter((r) => r.spread >= 9.5).sort((a, b) => price(b) - price(a))],
    ["top3_home_75", "3 biggest home favorites (75%+) · moneyline", 3, (w) => w.filter((r) => nv(r) >= 0.75).sort((a, b) => nv(b) - nv(a))]];
  return defs.map(([id, name, k, pickFrom, single]) => {
    const ps = [];
    for (const [key, w] of Object.entries(weeks)) { const season = Number(key.split("|")[0]), c = pickFrom(w);
      if (single) { for (const r of c) ps.push({ season, win: r.hs > r.as, pay: 1 / price(r) }); }
      else if (c.length >= k) { const l = c.slice(0, k); ps.push({ season, win: l.every((r) => r.hs > r.as), pay: l.reduce((a, r) => a / price(r), 1) }); } }
    const sum = (xs) => ({ n: xs.length, hit: xs.length ? xs.filter((p) => p.win).length / xs.length : null, roi: xs.length ? xs.reduce((a, p) => a + (p.win ? p.pay - 1 : -1), 0) / xs.length : null });
    return { id, name, ...sum(ps), periods: PERIODS.map(([a, b]) => ({ label: `${a}–${String(b).slice(2)}`, ...sum(ps.filter((p) => p.season >= a && p.season <= b)) })) };
  });
}
export function parseGames(text) {
  const [head, ...body] = parseCSV(text), ix = (k) => head.indexOf(k), num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
  const I = { season: ix("season"), type: ix("game_type"), week: ix("week"), away: ix("away_team"), as: ix("away_score"), home: ix("home_team"), hs: ix("home_score"), spread: ix("spread_line"), total: ix("total_line"), roof: ix("roof"), wind: ix("wind"), hml: ix("home_moneyline"), aml: ix("away_moneyline") };
  return body.filter((c) => c[I.type] === "REG").map((c) => ({ season: Number(c[I.season]), week: Number(c[I.week]), away: c[I.away], home: c[I.home], as: num(c[I.as]), hs: num(c[I.hs]), spread: num(c[I.spread]), total: num(c[I.total]), roof: c[I.roof] || "", wind: num(c[I.wind]), hml: num(c[I.hml]), aml: I.aml >= 0 ? num(c[I.aml]) : null }));
}
// Cached 12 h in Redis: the schedule file is 2 MB and history only changes when a game finishes.
export async function loadReplay() {
  const hit = await getJSON("replay:cache2").catch(() => null);
  if (hit && Date.now() - new Date(hit.t) < 12 * 3600e3) return hit;
  const r = await fetch(URL, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`schedule source returned ${r.status}`);
  const d = computeReplay(parseGames(await r.text())); await setJSON("replay:cache2", d).catch(() => {});
  return d;
}
