// Automatic news check (added 9/28): the latest ESPN NFL headlines, matched to this week's games by team.
// Source tier 4 (major outlet) — shown as "verify" notes on the card; it NEVER changes a model number.
// Uses ESPN's public site API; if it fails or changes shape, the cards just show no news (the watchdog notes it).
import { TEAMS } from "./games";
let cache = { t: 0, items: null };
export async function loadNews() {
  if (cache.items && Date.now() - cache.t < 20 * 60e3) return cache.items;
  const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100", { cache: "no-store" });
  if (!r.ok) throw new Error(`news ${r.status}`);
  const d = await r.json();
  const items = (d.articles || []).map((a) => ({
    headline: a.headline || "", published: a.published || null, url: a.links && a.links.web ? a.links.web.href : null,
    teams: (a.categories || []).filter((c) => c.type === "team").map((c) => c.description || ""),
    athletes: (a.categories || []).filter((c) => c.type === "athlete").map((c) => c.description || ""),
  })).filter((a) => a.headline);
  cache = { t: Date.now(), items };
  return items;
}
// Headlines from the last 4 days that name either team (by nickname in ESPN's team tags or the headline itself).
export function newsFor(items, away, home) {
  const nick = [TEAMS[away], TEAMS[home]].filter(Boolean).map((x) => x.toLowerCase());
  const cutoff = Date.now() - 4 * 86400e3;
  return (items || []).filter((a) => (!a.published || new Date(a.published) > cutoff) &&
    (a.teams.some((t) => nick.some((n) => t.toLowerCase().includes(n))) || nick.some((n) => a.headline.toLowerCase().includes(n))))
    .slice(0, 5).map((a) => ({ headline: a.headline, url: a.url, published: a.published, athletes: a.athletes }));
}
