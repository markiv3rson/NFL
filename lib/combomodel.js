// Weekly rebuild (10/9): Railway rebuilds the upgraded game model, the early-week total model and the total-move model every Tuesday
// (railway-model-service/weekly_rebuild.py) -- and on deploy when the rebuild code changed (BUILD_TAG). This loads the newest published
// set (cached 6 h) and switches the site to it; with no build yet, or the service down, the copies built into lib/upgrade.js stay in use.
// 10/16 (owner: "cut 1 and two"): the scanned combo table and the pick chooser were removed; an older saved build that still carries them
// is used for its models only, and a build without a tag (made by the old code) is refetched every 15 minutes until a tagged one arrives.
import { getJSON, setJSON } from "./redis";
import { modelBase, modelHeaders } from "./model";
import { useCoefficients, useMoveModel } from "./upgrade";
import { useTeamSide } from "./teammodel";
const KEY = "combomodel:latest";
export const HEALTH_EVERY = 5 * 60 * 1000;
let mem = { t: 0, a: null };
export function applyComboModel(a) {
  if (!a || !a.upgrade || !a.upgrade.feat) { useCoefficients(null, null); useMoveModel(null); useTeamSide(null); return false; }
  useCoefficients(a.upgrade, a.early); useMoveModel(a.moveT); useTeamSide(a.teamSide || null); return true;
}
export async function loadComboModel() {
  if (mem.a && Date.now() - mem.t < 10 * 60 * 1000) return applyComboModel(mem.a) ? mem.a : null;
  let a = await getJSON(KEY).catch(() => null);
  const old = a && (!a.tag || !a.teamSide) && (!a.fetchedAt || Date.now() - Date.parse(a.fetchedAt) > 15 * 60 * 1000);   // 10/19: also a build without the team model
  // 10/27 (owner: "check the railway rebuild"): a deploy rebuild used to stay invisible for up to 2 h (the cache below). Now, at most every
  // HEALTH_EVERY, the service's /health (no token) says which build it holds; a different builtAt than the saved copy = re-read it now.
  let changed = false;
  if (a && a.fetchedAt && !old && (!a.healthAt || Date.now() - Date.parse(a.healthAt) > HEALTH_EVERY)) {
    try { const base = modelBase();
      if (base) { const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) }); const h = r.ok ? await r.json() : null;
        a = { ...a, healthAt: new Date().toISOString() }; changed = !!(h && h.build && h.build.builtAt && a.builtAt && h.build.builtAt !== a.builtAt);
        if (!changed) await setJSON(KEY, a).catch(() => {}); } } catch {}
  }
  if (!a || !a.fetchedAt || old || changed || Date.now() - Date.parse(a.fetchedAt) > 2 * 3600 * 1000) {   // 10/19: 6 h -> 2 h, so Tuesday's rebuild (new week's team numbers) arrives the same morning
    try {
      const base = modelBase();
      if (base) { const r = await fetch(`${base}/combo-model`, { headers: modelHeaders(), signal: AbortSignal.timeout(15000) }); const j = r.ok ? await r.json() : null;
        if (j && j.ok && j.upgrade && j.upgrade.feat) { a = { ...j, fetchedAt: new Date().toISOString() }; await setJSON(KEY, a).catch(() => {}); } }
    } catch {}
  }
  mem = { t: Date.now(), a };
  return applyComboModel(a) ? a : null;
}
