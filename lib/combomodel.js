// Weekly rebuild (10/9): Railway rebuilds the upgraded game model, the early-week total model and the combo table every Tuesday
// (railway-model-service/weekly_rebuild.py). This loads the newest published set (cached 6 h) and switches the site to it; with no
// build yet, or the service down, the copies built into lib/upgrade.js and lib/combotable.js stay in use.
import { getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";
import { useTable } from "./stack";
import { useCoefficients } from "./upgrade";
const KEY = "combomodel:latest";
let mem = { t: 0, a: null };
export function applyComboModel(a) {
  if (!a || !Array.isArray(a.table) || a.table.length < 300 || !a.upgrade || !a.upgrade.feat) { useTable(null); useCoefficients(null, null); return false; }
  useTable(a.table); useCoefficients(a.upgrade, a.early); return true;
}
export async function loadComboModel() {
  if (mem.a && Date.now() - mem.t < 10 * 60 * 1000) return applyComboModel(mem.a) ? mem.a : null;
  let a = await getJSON(KEY).catch(() => null);
  if (!a || !a.fetchedAt || Date.now() - Date.parse(a.fetchedAt) > 6 * 3600 * 1000) {
    try {
      const base = modelBase();
      if (base) { const r = await fetch(`${base}/combo-model`, { headers: modelHeaders(), signal: AbortSignal.timeout(15000) }); const j = r.ok ? await r.json() : null;
        if (j && j.ok && Array.isArray(j.table)) { a = { ...j, fetchedAt: new Date().toISOString() }; await setJSON(KEY, a).catch(() => {}); } }
    } catch {}
  }
  mem = { t: Date.now(), a };
  return applyComboModel(a) ? a : null;
}
