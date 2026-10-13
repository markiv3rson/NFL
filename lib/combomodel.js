// Weekly rebuild (10/9): Railway rebuilds the upgraded game model, the early-week total model and the combo table every Tuesday
// (railway-model-service/weekly_rebuild.py). This loads the newest published set (cached 6 h) and switches the site to it; with no
// build yet, or the service down, the copies built into lib/upgrade.js and lib/combotable.js stay in use.
import { getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";
import { useTable } from "./stack";
import { useCoefficients, useMoveModel } from "./upgrade";
import { COMBO_TABLE } from "./combotable";
import { useChooser } from "./chooser";
const KEY = "combomodel:latest";
let mem = { t: 0, a: null };
const INJ_F = /^(dog|fav)(QB|SK|OL|DB|F7)out$/;
export function applyComboModel(a) {
  if (!a || !Array.isArray(a.table) || a.table.length < 300 || !a.upgrade || !a.upgrade.feat) { useTable(null); useCoefficients(null, null); useChooser(null); useMoveModel(null); return false; }
  // Starters-out rows (10/10) come from the built-in table until a weekly rebuild that scans them publishes its own.
  const hasInj = a.table.some((r) => (r[1] || []).some((f) => INJ_F.test(f)));
  useTable(hasInj ? a.table : [...a.table, ...COMBO_TABLE.filter((r) => r[1].some((f) => INJ_F.test(f)))]); useCoefficients(a.upgrade, a.early); useChooser(a.chooser); useMoveModel(a.moveT); return true;
}
export async function loadComboModel() {
  if (mem.a && Date.now() - mem.t < 10 * 60 * 1000) return applyComboModel(mem.a) ? mem.a : null;
  let a = await getJSON(KEY).catch(() => null);
  // 10/12: a saved copy without the chooser (built before it existed) is refetched now, not after 6 h -- with a 15-minute pause between
  // tries so a Railway service still rebuilding isn't asked on every page load.
  const old = a && !a.chooser && (!a.fetchedAt || Date.now() - Date.parse(a.fetchedAt) > 15 * 60 * 1000);
  if (!a || !a.fetchedAt || old || Date.now() - Date.parse(a.fetchedAt) > 6 * 3600 * 1000) {
    try {
      const base = modelBase();
      if (base) { const r = await fetch(`${base}/combo-model`, { headers: modelHeaders(), signal: AbortSignal.timeout(15000) }); const j = r.ok ? await r.json() : null;
        if (j && j.ok && Array.isArray(j.table)) { a = { ...j, fetchedAt: new Date().toISOString() }; await setJSON(KEY, a).catch(() => {}); } }
    } catch {}
  }
  mem = { t: Date.now(), a };
  return applyComboModel(a) ? a : null;
}
