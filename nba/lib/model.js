// NBA's own Railway model service (merged site, 10/17): NBA_MODEL_SERVICE_URL + NBA_MODEL_SERVICE_TOKEN -- never the NFL service's variables.
export const modelBase = () => (process.env.NBA_MODEL_SERVICE_URL || "").trim().replace(/\/+$/, "");
export function modelHeaders(extra = {}) {
  const t = (process.env.NBA_MODEL_SERVICE_TOKEN || "").trim();
  return t ? { ...extra, "X-Model-Token": t } : extra;
}
