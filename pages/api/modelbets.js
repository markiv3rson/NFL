// Model Picks (10/15): every parlay the app saved this season, grouped by week and by type, with its results.
// types: "2" 2 legs, "3" 3 legs, "upset" Upset, "st" Spread + Total, "best" Best Legs (green picks / most likely TD scorers, 2-3 legs across games);
// "4", "style", "pts", "diff" = types no longer built (10/19), kept so their old saved weeks still group.
import { getRedis, getJSON } from "../../lib/redis";
import { SEASON } from "../../lib/games";
import { BEST_STAKE, PROP_PARLAY_STAKE } from "../../lib/paper";

const GROUP = { pp6: "pp6", pp8: "pp8", pp10: "pp10", sgp_best: "2", sgp_best_fill: "2", sgp_3: "3", sgp_linked: "4", sgp_style: "style", sgp_style_pts: "pts", leg4_fav: "diff", leg4_green_fav: "diff", leg4_fav_td: "diff", leg4_td4: "diff", sgp_upset: "upset", sgp_st: "st", best_2: "best", best_3: "best", td_likely_2: "best", td_likely_3: "best" };
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const r = getRedis(), weeks = {}, saved = []; let c = "0";
    do { const [n, ks] = await r.scan(c, "MATCH", `paper:${SEASON}:*`, "COUNT", 200); c = n;
      for (const k of ks) { const w = k.split(":")[2], rec = await getJSON(k); if (!rec || !Array.isArray(rec.parlays)) continue;
        if (k.split(":").length === 3) saved.push(Number(w));   // the week's own copy (paper:<s>:<w>, Saturday morning) -- once it exists Best Legs shows only it
        for (const p of rec.parlays) { const g = GROUP[p.strategy]; if (!g) continue; const W = (weeks[w] = weeks[w] || {}); (W[g] = W[g] || []).push({ strategy: p.strategy, legs: p.legs, prob: p.prob ?? null, stake: p.stake ?? BEST_STAKE[p.strategy] ?? (/^pp\d+$/.test(p.strategy) ? PROP_PARLAY_STAKE : null), result: p.result || null, ret: p.ret ?? null, game: rec.game || null, kickoff: rec.kickoff || null }); } } } while (c !== "0");
    res.status(200).json({ ok: true, season: SEASON, weeks, saved: saved.sort((a, b) => a - b) });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
