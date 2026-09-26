// Proxies to the Railway model service. This file itself is still a Vercel
// serverless function, so it has its own execution limit even though Railway
// is always-on — extend it, and handle non-JSON upstream responses cleanly
// instead of crashing on .json() when Vercel's own timeout page comes back.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const base = process.env.MODEL_SERVICE_URL;
  if (!base) {
    return res.status(500).json({ ok: false, error: "MODEL_SERVICE_URL isn't set in Vercel env vars yet — deploy railway-model-service/ first (see its README)." });
  }
  try {
    const endpoint = req.query.type === "td" ? "/rerun-td-probs" : "/rerun-game-lines";
    const upstream = await fetch(base + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(504).json({ ok: false, error: "Model service took too long or returned a non-JSON response (likely still training — try again, or check Railway logs). Raw start: " + text.slice(0, 120) });
    }
    return res.status(upstream.status).json(data);
  } catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
}
