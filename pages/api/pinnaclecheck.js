// Read-only check (10/13, owner): can the site's servers reach Pinnacle? Fetches Pinnacle's current lines and reports what came
// back. Saves nothing, changes nothing.
import { fetchPinnacle } from "../../lib/pinnacle";
export default async function handler(req, res) {
  try {
    const g = await fetchPinnacle();
    res.status(200).json({ ok: true, games: Object.keys(g).length, lines: g });
  } catch (e) { res.status(200).json({ ok: false, error: String(e).slice(0, 200) }); }
}
