// Miss finder: scans this week's graded results for the known failure patterns (protocol 4.9) and
// reports where the models were most wrong, with a plain-words note. Read-only, run for the recap.
export function findMisses(records) {
  const out = [];
  const qbGames = records.filter((r) => r.qbChange), other = records.filter((r) => !r.qbChange);
  const avgErr = (list, key) => { const xs = list.filter((r) => r[key] != null); return xs.length ? xs.reduce((s, r) => s + Math.abs(r[key]), 0) / xs.length : null; };
  const qbErr = avgErr(qbGames, "totalErr"), baseErr = avgErr(other, "totalErr");
  if (qbErr != null && baseErr != null && qbErr > baseErr + 2 && qbGames.filter((r) => r.totalErr != null).length >= 3)
    out.push({ pattern: "QB-change games", note: `Totals off by ${qbErr.toFixed(1)} pts on average in ${qbGames.length} games (vs ${baseErr.toFixed(1)} elsewhere) — games graded before 9/28 had no QB adjustment; later ones use the automatic estimate, which still can't see news after the last rerun.`, n: qbGames.length });
  const windGames = records.filter((r) => r.wind != null && r.wind >= 15);
  const windErr = avgErr(windGames, "totalErr");
  if (windErr != null && baseErr != null && windErr > baseErr + 2 && windGames.length >= 2)
    out.push({ pattern: "High-wind games (15+ mph)", note: `Totals off by ${windErr.toFixed(1)} pts on average in the ${windGames.length} windiest games.`, n: windGames.length });
  // High-confidence TD players: compare misses to how many misses the model itself EXPECTED. Before 9/28 this listed
  // "12 players the model gave 40%+ to didn't score" as a problem, when 22 such players should miss about 12.6 times.
  const hi = records.flatMap((r) => r.td || []).filter((p) => p.fair >= 40 && p.played !== false);   // inactive players aren't model misses
  if (hi.length >= 10) {
    const miss = hi.filter((p) => !p.scored), exp = hi.reduce((a, p) => a + (1 - p.fair / 100), 0);
    const sd = Math.sqrt(hi.reduce((a, p) => a + (p.fair / 100) * (1 - p.fair / 100), 0));
    if (miss.length > exp + 2 * sd)
      out.push({ pattern: "High-confidence TD misses", note: `${miss.length} of ${hi.length} players the model gave 40%+ to didn't score (about ${exp.toFixed(1)} expected) — more than luck explains: ${miss.slice(0, 4).map((p) => p.player).join(", ")}.`, n: hi.length });
  }
  return out;
}
