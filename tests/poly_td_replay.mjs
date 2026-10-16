// POLYMARKET TD REPLAY (10/16, owner: "d"): the TD model's numbers against REAL Polymarket anytime-TD prices, from the public trade log (close = last trade before kickoff, +1c for the ask).
// Data: railway-model-service/data/poly_td_closes.csv (one row per anytime-TD market). 2025: Polymarket only listed TD markets from 11/30 (weeks 13-18, 10 players a game) and
// almost nobody traded them (6 markets with a trade in the last 2 hours), so 2025 only checks the model's CALIBRATION (walk-forward: trained on 2022-24, every name matched).
// 2026: weeks 1-6 player-prop events; the model number is the app's own kickoff record (results file, weeks 3-6), so 2026 rows are the live test.
// Run: node --import ./tests/register.mjs tests/poly_td_replay.mjs
import { readFileSync } from "node:fs";
import { parseCSV } from "../lib/injuries.js";
const [H, ...R] = parseCSV(readFileSync(new URL("../railway-model-service/data/poly_td_closes.csv", import.meta.url), "utf8")), ix = (k) => H.indexOf(k), SP = 0.01;
const T = {}, tally = (k, hit, price, said) => { const t = (T[k] = T[k] || { n: 0, w: 0, px: 0, money: 0, said: 0, bm: 0, bp: 0, priced: price != null }); t.n++; t.w += hit ? 1 : 0; t.said += said;
  t.bm += (said - (hit ? 1 : 0)) ** 2; if (price != null) { t.px += price; t.money += hit ? 1 / price - 1 : -1; t.bp += (price - SP - (hit ? 1 : 0)) ** 2; } };
let rows = 0, modeled = 0, priced = 0;
for (const r of R) { if (r.length < H.length) continue; rows++;
  const yr = r[ix("season")], p = r[ix("p_model")] === "" ? null : Number(r[ix("p_model")]), sc = r[ix("scored")] === "" ? null : Number(r[ix("scored")]) === 1, close = r[ix("close")] === "" ? null : Number(r[ix("close")]), live = close != null && Number(r[ix("n2h")]) >= 1;
  if (p == null || sc == null) continue; modeled++;
  const band = p >= 0.55 ? "55%+" : p >= 0.45 ? "45-54" : p >= 0.35 ? "35-44" : p >= 0.25 ? "25-34" : "<25";
  tally(`${yr} · model ${band} · every player with a model number`, sc, null, p);
  if (!live) continue; priced++; const price = close + SP;
  tally(`${yr} · model ${band} · at the Polymarket close`, sc, price, p); tally(`${yr} · all priced players`, sc, price, p);
  if (p - close >= 0.1) tally(`${yr} · model 10+ pts ABOVE the price`, sc, price, p); if (close - p >= 0.1) tally(`${yr} · model 10+ pts BELOW the price`, sc, price, p);
  if (Number(r[ix("rank")]) === 1) tally(`${yr} · #1 scorer per team`, sc, price, p); }
console.log(`TD market rows ${rows} · with a model number ${modeled} · priced at the close ${priced}`);
for (const k of Object.keys(T).sort()) { const t = T[k]; console.log(`   ${k.padEnd(58)} ${String(t.w + "-" + (t.n - t.w)).padStart(8)}  hit ${(100 * t.w / t.n).toFixed(1).padStart(5)}%  said ${(100 * t.said / t.n).toFixed(1).padStart(5)}%` +
  (t.priced ? `  price ${(100 * t.px / t.n).toFixed(0).padStart(3)}c  money/$100 ${(100 * t.money / t.n).toFixed(1).padStart(6)}  Brier model ${(t.bm / t.n).toFixed(3)} vs market ${(t.bp / t.n).toFixed(3)}` : `  Brier ${(t.bm / t.n).toFixed(3)}`)); }
