// Weekly rebuild (10/9): Railway rebuilds the upgraded game model, the early-week total model and the total-move model every Tuesday
// (railway-model-service/weekly_rebuild.py) -- and on deploy when the rebuild code changed (BUILD_TAG). This loads the newest published
// set (cached 6 h) and switches the site to it; with no build yet, or the service down, the copies built into lib/upgrade.js stay in use.
// 10/16 (owner: "cut 1 and two"): the scanned combo table and the pick chooser were removed; an older saved build that still carries them
// is used for its models only, and a build without a tag (made by the old code) is refetched every 15 minutes until a tagged one arrives.
import { getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";
import { useCoefficients, useMoveModel } from "./upgrade";
const KEY = "combomodel:latest";
let mem = { t: 0, a: null };
export function applyComboModel(a) {
  if (!a || !a.upgrade || !a.upgrade.feat) { useCoefficients(null, null); useMoveModel(null); return false; }
  useCoefficients(a.upgrade, a.early); useMoveModel(a.moveT); return true;
}
export async function loadComboModel() {
  if (mem.a && Date.now() - mem.t < 10 * 60 * 1000) return applyComboModel(mem.a) ? mem.a : null;
  let a = await getJSON(KEY).catch(() => null);
  const old = a && !a.tag && (!a.fetchedAt || Date.now() - Date.parse(a.fetchedAt) > 15 * 60 * 1000);
  if (!a || !a.fetchedAt || old || Date.now() - Date.parse(a.fetchedAt) > 6 * 3600 * 1000) {
    try {
      const base = modelBase();
      if (base) { const r = await fetch(`${base}/combo-model`, { headers: modelHeaders(), signal: AbortSignal.timeout(15000) }); const j = r.ok ? await r.json() : null;
        if (j && j.ok && j.upgrade && j.upgrade.feat) { a = { ...j, fetchedAt: new Date().toISOString() }; await setJSON(KEY, a).catch(() => {}); } }
    } catch {}
  }
  mem = { t: Date.now(), a };
  return applyComboModel(a) ? a : null;
}
