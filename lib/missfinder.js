// Miss finder: scans this week's graded results for the known failure patterns (protocol 4.9) and
// reports where the models were most wrong, with a plain-words note. Read-only, run for the recap.
export function findMisses(records) {
  const out = [];
  const qbGames = records.filter((r) => r.qbChange), other = records.filter((r) => !r.qbChange);
  const avgErr = (list, key) => { const xs = list.filter((r) => r[key] != null); return xs.length ? xs.reduce((s, r) => s + Math.abs(r[key]), 0) / xs.length : null; };
  const qbErr = avgErr(qbGames, "totalErr"), baseErr = avgErr(other, "totalErr");
  if (qbErr != null && baseErr != null && qbErr > baseErr + 2)
    out.push({ pattern: "QB-change games", note: `Totals off by ${qbErr.toFixed(1)} pts on average (vs ${baseErr.toFixed(1)} elsewhere) — the model can't see the QB change.`, n: qbGames.length });
  const windGames = records.filter((r) => r.wind != null && r.wind >= 15);
  const windErr = avgErr(windGames, "totalErr");
  if (windErr != null && baseErr != null && windErr > baseErr + 2 && windGames.length >= 2)
    out.push({ pattern: "High-wind games (15+ mph)", note: `Totals off by ${windErr.toFixed(1)} pts on average in the ${windGames.length} windiest games.`, n: windGames.length });
  const tdMiss = [];
  for (const r of records) for (const p of r.td || []) if (p.fair >= 40 && !p.scored) tdMiss.push(p);
  if (tdMiss.length >= 3) out.push({ pattern: "High-confidence TD misses", note: `${tdMiss.length} players the model gave 40%+ to didn't score: ${tdMiss.slice(0, 4).map((p) => p.player).join(", ")}.`, n: tdMiss.length });
  return out;
}
