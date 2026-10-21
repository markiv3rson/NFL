// NBA Player props page (10/20, owner: "Player props"; bar 65%+ since 10/21): one day's rows per game (every stat; the page shows its tab's stat), the days
// that have rows, and the season's W-L per stat. ?date=YYYY-MM-DD picks the day (default: today, else the newest day with rows).
import { nbaPropDays, nbaPropsForDay, nbaPropsRecord, NBA_PROP_BAR, NBA_STATS } from "../../../nba/lib/props";
import { etDate } from "../../../nba/lib/poly";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const days = await nbaPropDays(), today = etDate(new Date().toISOString());
    const date = String(req.query.date || "").match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : days.includes(today) ? today : (days.filter((d) => d > today)[0] || days[days.length - 1] || today);
    const games = await nbaPropsForDay(date), record = await nbaPropsRecord(days);
    res.status(200).json({ ok: true, date, days, bar: NBA_PROP_BAR, stats: NBA_STATS, games, record });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
