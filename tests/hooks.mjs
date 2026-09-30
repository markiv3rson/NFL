import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[mc]?js$|\.json$/.test(spec) && ctx.parentURL) {
    const u = new URL(spec + ".js", ctx.parentURL); if (existsSync(fileURLToPath(u))) return next(spec + ".js", ctx);
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.startsWith("file:") && !url.includes("/node_modules/") && /\/(lib|tests)\/[^/]+\.js$/.test(url)) return next(url, { ...ctx, format: "module" });
  return next(url, ctx);
}
