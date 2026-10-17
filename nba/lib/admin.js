// One-off actions for a signed-in person (pages/api/admin.js):
//   rebuild    start the model service's daily rebuild now (it runs on Railway in the background; the Models tab's "Last rebuild" row shows the outcome)
//   unrecord   move a day's saved picks and parlays out of the record. Only a day outside the record window (lib/slate.js recordWindow) can be
//              cleared, and nothing is deleted: every row is kept under removed:<key>, so the step can be undone.
import { getRedis } from "./redis";
import { modelBase, modelHeaders } from "./model";
import { recordWindow } from "./slate";

export async function unrecordDay(date, now = Date.now()) {
  if (recordWindow(now).has(date)) return { ok: false, error: "that day is inside the record window (today or tomorrow)" };
  const r = getRedis(), moved = { picks: 0, parlays: 0 };
  for (const [ids, prefix, field] of [["pick:ids", `pick:${date}:`, "picks"], ["parlay:ids", `parlay:${date}:`, "parlays"]]) {
    for (const k of (await r.smembers(ids)) || []) {
      if (!k.startsWith(prefix)) continue;
      const v = await r.get(k);
      if (v != null) await r.set(`removed:${k}`, v);
      await r.del(k); await r.srem(ids, k); moved[field]++;
    }
  }
  return { ok: true, date, ...moved };
}

export async function startRebuild(fetcher = fetch) {
  const base = modelBase(); if (!base) return { ok: false, error: "MODEL_SERVICE_URL not set" };
  const r = await fetcher(`${base}/rebuild`, { method: "POST", headers: modelHeaders(), cache: "no-store", signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  return { ok: !!(j && j.ok), status: r.status, ...(j || {}) };
}
