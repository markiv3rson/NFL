// WIDE MODEL shadow (10/27, owner: "test all of these ... build it into the app"): the model service's wide_model.py (every situation flag on both teams +
// the raw numbers, boosted trees, fit on 1999..now) gives its side on every unplayed game at the newest Polymarket line and flags its confident fifth.
// Research 10/26: the confident fifth 55.6% of 665 (2013-25) above the coin-flip ceiling, but 52.3% on one fixed fit and 51.6% time-reversed -- so a
// SHADOW only (lib/tracked.js recordWideShadow, Models -> Tracked angles "WIDE (shadow)"), never a pick until it holds live. One service call per
// slate build, cached WIDE_TTL while the lines are unchanged.
import { getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";
export const WIDE_TTL = 20 * 60 * 1000;
export function wideInputs(season, week, games) {
  return games.filter((g) => !g.started && g.lineNow && g.lineNow.hs != null && isFinite(g.lineNow.hs))
    .map((g) => ({ game: g.key, season, week: Number(g.week ?? week), away: g.away, home: g.home, homeSpread: g.lineNow.hs, total: g.lineNow.tl ?? null,
      openHomeSpread: g.open && g.open.spread && g.open.spread.homeSpread != null ? g.open.spread.homeSpread : null, openTotal: g.open && g.open.total && g.open.total.line != null ? g.open.total.line : null }));
}
export async function widePicks(season, week, games) {
  const list = wideInputs(season, week, games); if (!list.length) return {};
  const key = `wide:${season}:${week}`, sig = JSON.stringify(list.map((x) => [x.game, x.homeSpread, x.total]));
  const c = await getJSON(key).catch(() => null);
  if (c && c.sig === sig && c.t && Date.now() - Date.parse(c.t) < WIDE_TTL) return c.games || {};
  const base = modelBase(); if (!base) return (c && c.games) || {};
  try {
    const r = await fetch(`${base}/wide-picks`, { method: "POST", headers: { "content-type": "application/json", ...modelHeaders() }, body: JSON.stringify({ games: list }), signal: AbortSignal.timeout(25000) });
    const j = r.ok ? await r.json() : null;
    if (j && j.ok && j.games) { await setJSON(key, { t: new Date().toISOString(), sig, games: j.games, thr: j.thr ?? null, v: j.v ?? null }).catch(() => {}); return j.games; }
  } catch {}
  return (c && c.games) || {};
}
