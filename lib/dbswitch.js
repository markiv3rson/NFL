// 10/28: the move to the shared paid database without a gap. Until the one-time copy (lib/migrate.js) has finished and set the switch key in the NEW
// database, every command still goes to the OLD database; once the key is there, every command goes to the new one (checked at most every 20 s
// per server instance, and never back). So nothing is ever written into a half-empty new database (first-seen lines, alert baselines, records).
export const SWITCH_KEY = "migrated:done";
export function switching(oldC, newC, flag = SWITCH_KEY, every = 20e3) {
  if (!oldC) return newC;
  let onNew = false, checkedAt = 0, pending = null;
  const pick = async () => {
    if (onNew) return newC;
    if (Date.now() - checkedAt < every) return oldC;
    if (!pending) pending = newC.get(flag).then((v) => { onNew = !!v; }).catch(() => {}).finally(() => { checkedAt = Date.now(); pending = null; });
    await pending; return onNew ? newC : oldC;
  };
  const batch = (kind) => (cmds) => {   // pipeline() / multi() are called without await: record the calls, replay them on the chosen client at exec()
    const calls = [], p = new Proxy({}, { get: (_, m) => (m === "exec" ? async () => { const c = await pick(), real = c[kind](cmds); for (const [mm, a] of calls) real[mm](...a); return real.exec(); }
      : (...a) => { calls.push([m, a]); return p; }) });
    return p;
  };
  return new Proxy({}, { get: (_, prop) => {
    if (prop === "then") return undefined;
    if (prop === "pipeline" || prop === "multi") return batch(prop);
    if (prop === "onNew") return () => onNew;
    return async (...args) => { const c = await pick(); return c[prop](...args); };
  } });
}
