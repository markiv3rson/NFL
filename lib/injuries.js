// Official NFL team injury reports via nflverse. Latest reported week per team.
import { SEASON } from "./games";
// A function, not a constant: games.js imports this file too, so SEASON isn't initialized yet at load time.
const URL = () => `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${SEASON}.csv`;
export function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
export async function loadInjuries() { return (await loadInjuriesMeta()).teams; }
let injCache = { t: 0, v: null };
export async function loadInjuriesMeta() {
  if (injCache.v && Date.now() - injCache.t < 10 * 60e3) return injCache.v;   // 10-min cache: every page load re-downloaded the file
  const v = await loadInjuriesFresh(); injCache = { t: Date.now(), v }; return v;
}
async function loadInjuriesFresh() {
  const res = await fetch(URL(), { cache: "no-store", signal: AbortSignal.timeout(20000) });
  const updated = res.headers.get("last-modified");
  if (!res.ok) throw new Error(`injury source returned ${res.status}`);
  const [head, ...rows] = parseCSV(await res.text());
  const ix = (k) => head.indexOf(k);
  const T = ix("team"), W = ix("week"), N = ix("full_name"), RI = ix("report_primary_injury"), RS = ix("report_status"),
        PI = ix("practice_primary_injury"), PS = ix("practice_status"), ST = ix("season_type"), POS = ix("position");
  const latest = {};
  const ok = (r) => ["REG", "POST", "WC", "DIV", "CON", "SB"].includes(r[ST]);   // playoff reports too (9/30)
  rows.forEach((r) => { if (ok(r) && r[T]) latest[r[T]] = Math.max(latest[r[T]] || 0, Number(r[W])); });
  const teams = {};
  rows.forEach((r) => {
    if (!ok(r) || !r[T] || Number(r[W]) !== latest[r[T]]) return;
    const injury = r[RI] || r[PI] || "";
    const status = r[RS] || r[PS] || "Listed";
    const detail = [injury, r[RS] && r[PS] ? r[PS] : ""].filter(Boolean).join(" — ");
    (teams[r[T]] = teams[r[T]] || []).push({ name: r[N], pos: r[POS], status, detail, week: Number(r[W]) });
  });
  return { teams, updated: updated ? new Date(updated).toISOString() : null };
}
