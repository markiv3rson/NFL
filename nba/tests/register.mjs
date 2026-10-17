// Lets plain Node run the site's lib/ files the way Next.js does: "./odds" -> "./odds.js", and repo .js files as ES modules.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
