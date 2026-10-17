// NBA live scores for the home screen (10/17, merged site): ESPN's public scoreboard for today and yesterday (Eastern),
// { "AWAY @ HOME": { a, h, st: "pre" | "in" | "post", lbl: "Q3 6:30" } }. Display only; nothing is saved.
import { espnAbbr } from "../../../nba/lib/espn";

const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
export function parseLive(json) {
  const out = {};
  for (const ev of (json && json.events) || []) {
    const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    const away = c.competitors.find((x) => x.homeAway === "away"), home = c.competitors.find((x) => x.homeAway === "home");
    if (!away || !home) continue;
    const a = espnAbbr(away.team && away.team.abbreviation), h = espnAbbr(home.team && home.team.abbreviation);
    if (!a || !h) continue;
    const S = c.status || ev.status || {}, st = (S.type && S.type.state) || "pre";
    const period = Number(S.period) || 0, clock = S.displayClock || "";
    const lbl = st === "post" ? "FINAL" : st === "in" ? (S.type && /half/i.test(S.type.detail || "") ? "Half" : `${period > 4 ? "OT" : "Q" + period} ${clock}`.trim()) : "";
    out[`${a} @ ${h}`] = { a: Number(away.score) || 0, h: Number(home.score) || 0, st, lbl };
  }
  return out;
}
export default async function handler(req, res) {
  try {
    const base = process.env.ESPN_SCOREBOARD_URL || "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
    const days = [ymd(new Date(Date.now() - 864e5)), ymd(new Date())];
    const scores = {};
    for (const d of days) {
      try { const r = await fetch(`${base}?dates=${d}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }); if (r.ok) Object.assign(scores, parseLive(await r.json())); } catch {}
    }
    res.status(200).json({ ok: true, t: new Date().toISOString(), scores });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 120), scores: {} }); }
}
