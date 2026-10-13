// Database space (10/14, owner: "build now"). The database is Redis Cloud's FREE plan: 30 MB. Each finished week left ~3-4 MB, mostly
// two logs nothing reads after the week is graded: the TD price history (every snapshot of every player, `tdpxhist:`) and the model
// rerun log (up to 61 runs, `rerunlog:`). Once a week is over and every game is graded, they shrink ONCE (marker `compacted:<s>:<w>`):
//  - tdpxhist: only the first entry (opening prices -- grading reads it for the TD price move) and the last (closing) are kept;
//  - rerunlog: the newest 5 runs are kept.
// Lines, picks, records, results and grades are never touched. The nightly Railway backup keeps full copies for 30 days.
import { getRedis, K } from "./redis";
import { loadSeason, currentWeek, SEASON } from "./games";
export const DB_CAP_MB = 30;
export async function compactOldWeeks(season = SEASON) {
  const r = getRedis(), rows = await loadSeason(season), cur = await currentWeek(season), done = [];
  for (const w of [...new Set(rows.map((x) => x.week))].filter((w) => w < cur).sort((a, b) => a - b)) {
    if (await r.exists(`compacted:${season}:${w}`)) continue;
    const games = rows.filter((x) => x.week === w);
    if (!games.length || !games.every((g) => g.final)) continue;
    const graded = await Promise.all(games.map((g) => r.exists(K.res(season, w, g.key))));
    if (graded.some((x) => !x)) continue;   // wait until every game is graded
    for (const g of games) {
      const hk = `tdpxhist:${season}:${w}:${g.key}`, n = await r.llen(hk);
      if (n > 2) { const [a] = await r.lrange(hk, 0, 0), [b] = await r.lrange(hk, -1, -1); await r.del(hk); await r.rpush(hk, a, b); }
    }
    await r.ltrim(`rerunlog:${season}:${w}`, 0, 4);   // newest first (lpush)
    await r.set(`compacted:${season}:${w}`, new Date().toISOString());
    done.push(w);
  }
  return done;
}
