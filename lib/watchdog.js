// Watchdog: plain-language list of anything missing or stale. ONE copy, used by the Record tab (/api/slate) and by the
// scheduled self-check (/api/selfcheck), so the two can never disagree.
import { getJSON } from "./redis";
import { nextBooksPull } from "./books";
export async function computeWatch(data, status, inj) {
  // Watchdog (added 9/28): plain-language list of anything missing or stale, so nothing fails silently.
    const now = Date.now(), H = 3600e3, soon = data.games.filter((g) => !g.started && g.kickoff && new Date(g.kickoff) - now < 48 * H);
    const watch = [];
    if (data.modelRunAt && now - new Date(data.modelRunAt) > 4 * 24 * H) watch.push(`Model last ran ${Math.round((now - new Date(data.modelRunAt)) / 86400e3)} days ago — tap the refresh button in the menu to rerun the model.`);
    const noModel = data.games.filter((g) => !g.started && !g.model).map((g) => g.key); if (noModel.length) watch.push(`No model numbers yet: ${noModel.join(", ")}.`);
    const noLines = soon.filter((g) => !g.poly).map((g) => g.key); if (noLines.length) watch.push(`No Polymarket game lines within 48 h of kickoff: ${noLines.join(", ")}.`);
    const noTd = soon.filter((g) => !(g.td || []).some((r) => r.price != null)).map((g) => g.key); if (noTd.length) watch.push(`No Polymarket TD prices yet within 48 h of kickoff: ${noTd.join(", ")}.`);
    const noTdModel = data.games.filter((g) => !g.started && g.poly && !(g.td || []).length).map((g) => g.key); if (noTdModel.length) watch.push(`No TD model yet: ${noTdModel.join(", ")} — rerun after lines post.`);
    const dow = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short" });
    const injWeeks = inj ? [...new Set(Object.values(inj.teams).flat().map((x) => Number(x.week)))] : [];
    if (["Thu", "Fri", "Sat", "Sun"].includes(dow) && !injWeeks.includes(Number(data.week))) watch.push(`This week's official injury report isn't in the feed yet — injury adjustments are off until it is.`);
    // 10/14 fix: late = past the NEXT scheduled snapshot (owner's times) by 1 h. The flat 8 h limit fired every night (7 PM -> 7 AM gap) and
    // all Sunday night (3 PM -> Monday 7 AM).
    const nxSnap = status && status.lastSnapshot ? nextBooksPull(status.lastSnapshot) : null;
    if (nxSnap && now > nxSnap.getTime() + H) watch.push(`No price snapshot in ${Math.round((now - new Date(status.lastSnapshot)) / H)} h — check the Railway scheduler.`);
    if (status && status.railway && !status.railway.ok) watch.push(`The Railway model service isn't answering -- model reruns, the TD model and the automatic schedule stop until it's back (check Railway).`);   // 10/14
    // 10/27: a failed or unpublished model rebuild (from the service's /health) -- the site keeps the previous build
    const rb = status && status.railway && status.railway.rebuild && status.railway.rebuild.last;
    if (rb && rb.error) watch.push(`The last model rebuild on Railway FAILED (${String(rb.error).slice(0, 80)}) -- the site keeps the previous build; check the Railway logs.`);
    else if (rb && rb.published === false) watch.push(`The last model rebuild on Railway did not pass its checks -- the site keeps the previous build.`);
    if (status && status.usedMb != null && status.capMb && status.usedMb > 0.8 * status.capMb) watch.push(`Database ${Math.round(status.usedMb)} of ${status.capMb} MB used -- when it fills, new lines and grades stop saving.`);   // 10/14
    if (status && (!status.backup || now - new Date(status.backup.t) > 36 * H)) watch.push(`No backup in the last 36 h — check the Railway volume.`);
    else if (status && status.backup && status.backup.where === "failed") watch.push(`Last night's backup failed — check the Railway logs.`);
    // 10/20 review: the sportsbook pulls stop when the Odds API credits run out (about 57 a week); say so a week ahead
    if (status && status.credits != null && Number(status.credits) < 60) watch.push(`Odds API credits low: ${status.credits} left (about 57 used a week) -- sportsbook lines stop when they run out.`);
    if (status && status.retrain && /^failed/.test(status.retrain.summary || "")) watch.push(`Last TD retrain failed: ${String(status.retrain.summary).slice(0, 90)}`);
    // 10/20 review: a week the pages just switched to (Sunday night) has no books until Monday's 7 AM PT pull -- "yet this week" now waits until
    // the week's first kickoff is under 3.3 days away (Monday ~10 AM PT before a Thursday game); it fired every Sunday night / Monday morning.
    const first = Math.min(...(data.games || []).filter((g) => !g.carry && g.kickoff).map((g) => new Date(g.kickoff).getTime()));
    if (data.booksAt ? Date.now() - new Date(data.booksAt) > 30 * H : (isFinite(first) && first - now < 3.3 * 24 * H)) watch.push(`No sportsbook odds ${data.booksAt ? "in 30+ h" : "yet this week"} — check the Railway scheduler and the error list below (credits / API key).`);
  // Automatic runs (added 9/29): if the scheduler hasn't reached the site in 9 h, say so -- on 9/29 every scheduled call
  // was rejected (401, login mismatch) for 12 hours and nothing on the site showed it.
  const auto = await getJSON("auto:last").catch(() => null);
  if (!auto || now - new Date(auto.t) > 9 * H) watch.push(`No automatic run ${auto ? `since ${new Date(auto.t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", minute: "2-digit" })} PT` : "recorded yet"} — the Railway scheduler can't reach the site (check Railway logs; a 401 means SITE_LOGIN doesn't match the site login).`);
  // Final games with no graded result after 12 h, or graded with a part missing (grading skips a game with no closing line, no stored model or no play-by-play yet).
  try { const { ungradedFinals } = await import("./grade"); const u = await ungradedFinals(data.season);
    if (u.length) watch.push(`Final games not fully graded: ${u.map((x) => `${x.key} (${x.reason})`).join("; ")}.`); } catch {}
  if (data.espnError) watch.push(`ESPN game-day injury feed unavailable (${String(data.espnError).slice(0, 70)}) — inactives won't be caught automatically; check them by hand.`);
  return watch;
}
