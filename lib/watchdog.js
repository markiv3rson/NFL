// Watchdog: plain-language list of anything missing or stale. ONE copy, used by the Record tab (/api/slate) and by the
// scheduled self-check (/api/selfcheck), so the two can never disagree.
import { getJSON } from "./redis";
export async function computeWatch(data, status, inj) {
  // Watchdog (added 9/28): plain-language list of anything missing or stale, so nothing fails silently.
    const now = Date.now(), H = 3600e3, soon = data.games.filter((g) => !g.started && g.kickoff && new Date(g.kickoff) - now < 48 * H);
    const watch = [];
    if (data.modelRunAt && now - new Date(data.modelRunAt) > 4 * 24 * H) watch.push(`Model last ran ${Math.round((now - new Date(data.modelRunAt)) / 86400e3)} days ago — tap ▶ Rerun model.`);
    const noModel = data.games.filter((g) => !g.started && !g.model).map((g) => g.key); if (noModel.length) watch.push(`No model numbers yet: ${noModel.join(", ")}.`);
    const noLines = soon.filter((g) => !g.poly).map((g) => g.key); if (noLines.length) watch.push(`No Polymarket game lines within 48 h of kickoff: ${noLines.join(", ")}.`);
    const noTd = soon.filter((g) => !(g.td || []).some((r) => r.price != null)).map((g) => g.key); if (noTd.length) watch.push(`No Polymarket TD prices yet within 48 h of kickoff: ${noTd.join(", ")}.`);
    const noTdModel = data.games.filter((g) => !g.started && g.poly && !(g.td || []).length).map((g) => g.key); if (noTdModel.length) watch.push(`No TD model yet: ${noTdModel.join(", ")} — rerun after lines post.`);
    const dow = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short" });
    const injWeeks = inj ? [...new Set(Object.values(inj.teams).flat().map((x) => Number(x.week)))] : [];
    if (["Thu", "Fri", "Sat", "Sun"].includes(dow) && !injWeeks.includes(Number(data.week))) watch.push(`This week's official injury report isn't in the feed yet — injury adjustments are off until it is.`);
    if (status && status.lastSnapshot && now - new Date(status.lastSnapshot) > 8 * H) watch.push(`No price snapshot in ${Math.round((now - new Date(status.lastSnapshot)) / H)} h — check the Railway scheduler.`);
    if (status && (!status.backup || now - new Date(status.backup.t) > 36 * H)) watch.push(`No backup in the last 36 h — check the Railway volume.`);
    else if (status && status.backup && status.backup.where === "failed") watch.push(`Last night's backup failed — check the Railway logs.`);
    if (status && status.retrain && /^failed/.test(status.retrain.summary || "")) watch.push(`Last TD retrain failed: ${String(status.retrain.summary).slice(0, 90)}`);
    if (!data.booksAt || Date.now() - new Date(data.booksAt) > 30 * H) watch.push(`No sportsbook odds ${data.booksAt ? "in 30+ h" : "yet this week"} — tap ↻ Lines + injuries, or check the error list below (credits / API key).`);
  // Automatic runs (added 9/29): if the scheduler hasn't reached the site in 9 h, say so -- on 9/29 every scheduled call
  // was rejected (401, login mismatch) for 12 hours and nothing on the site showed it.
  const auto = await getJSON("auto:last").catch(() => null);
  if (!auto || now - new Date(auto.t) > 9 * H) watch.push(`No automatic run ${auto ? `since ${new Date(auto.t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" })} PT` : "recorded yet"} — the Railway scheduler can't reach the site (check Railway logs; a 401 means SITE_LOGIN doesn't match the site login).`);
  if (data.espnError) watch.push(`ESPN game-day injury feed unavailable (${String(data.espnError).slice(0, 70)}) — inactives won't be caught automatically; check them by hand.`);
  return watch;
}
