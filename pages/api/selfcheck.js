// Scheduled self-check (Thu 12:05 PM, Fri 5:05 PM, Sun 7:35 AM PT, from the Railway scheduler): runs the same Watchdog
// as the Record tab, saves the result, and logs each problem to System status so it shows up even if nobody opens Record.
import { buildWeek } from "../../lib/week";
import { loadInjuriesMeta } from "../../lib/injuries";
import { getStatus, logError } from "../../lib/status";
import { setJSON } from "../../lib/redis";
import { computeWatch } from "../../lib/watchdog";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const inj = await loadInjuriesMeta().catch(() => null);
    const data = await buildWeek({ injuries: inj ? inj.teams : null });
    const status = await getStatus(data.season, data.week, data.meta || {}, data.modelRunAt).catch(() => null);
    const items = await computeWatch(data, status, inj);
    const out = { t: new Date().toISOString(), week: data.week, games: data.games.length, items };
    await setJSON("selfcheck:last", out);
    // ONE combined entry: the status panel shows only the last 10 errors, and one line per item would push real errors out
    if (items.length) await logError("self-check", `${items.length} issue(s): ${items.join(" | ")}`.slice(0, 600));
    res.status(200).json({ ok: true, ...out });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
