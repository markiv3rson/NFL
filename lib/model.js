// Railway model service: base URL + the shared-secret header (MODEL_SERVICE_TOKEN, same value on Vercel and Railway).
export const modelBase = () => (process.env.MODEL_SERVICE_URL || "").trim().replace(/\/+$/, "");
export function modelHeaders(extra = {}) {
  const t = (process.env.MODEL_SERVICE_TOKEN || "").trim();
  return t ? { ...extra, "X-Model-Token": t } : extra;
}
