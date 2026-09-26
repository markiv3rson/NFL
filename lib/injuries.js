// Official NFL team injury reports via nflverse. Latest reported week per team.
const URL = "https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_2026.csv";
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
export async function loadInjuriesMeta() {
  const res = await fetch(URL, { cache: "no-store" });
  const updated = res.headers.get("last-modified");
  if (!res.ok) throw new Error(`injury source returned ${res.status}`);
  const [head, ...rows] = parseCSV(await res.text());
  const ix = (k) => head.indexOf(k);
  const T = ix("team"), W = ix("week"), N = ix("full_name"), RI = ix("report_primary_injury"), RS = ix("report_status"),
        PI = ix("practice_primary_injury"), PS = ix("practice_status"), ST = ix("season_type"), POS = ix("position");
  const latest = {};
  rows.forEach((r) => { if (r[ST] === "REG" && r[T]) latest[r[T]] = Math.max(latest[r[T]] || 0, Number(r[W])); });
  const teams = {};
  rows.forEach((r) => {
    if (r[ST] !== "REG" || !r[T] || Number(r[W]) !== latest[r[T]]) return;
    const injury = r[RI] || r[PI] || "";
    const status = r[RS] || r[PS] || "Listed";
    const detail = [injury, r[RS] && r[PS] ? r[PS] : ""].filter(Boolean).join(" — ");
    (teams[r[T]] = teams[r[T]] || []).push({ name: r[N], pos: r[POS], status, detail, week: Number(r[W]) });
  });
  return { teams, updated: updated ? new Date(updated).toISOString() : null };
}
