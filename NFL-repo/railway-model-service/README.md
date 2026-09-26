# NFL BETTORS model service (Railway)

Runs fair_line.py / td_prob.py for real, on demand, when the site's "Rerun
model" or "Preview model" button is tapped. Separate from the main Vercel
site because training downloads real data and does real computation —
needs an actual server (no 10-second timeout to fight), not a quick
serverless function.

## Deploy (one-time, ~10 minutes)
1. Create a free Railway account at railway.app (GitHub login works)
2. Push this `railway-model-service` folder to its own GitHub repo
3. Railway: "New Project" -> "Deploy from GitHub repo" -> pick it
4. Auto-detects Python via requirements.txt + Procfile — no config needed
5. Railway gives you a URL like `nfl-bettors-model.up.railway.app`
6. Add that URL to the MAIN SITE's Vercel env vars as `MODEL_SERVICE_URL`

## Cost
~$5/month realistic ongoing (only runs when the button is tapped).

## Fixed tonight (2026-09-25)
The --out / outs exclusion previously only matched exact pbp short names
("P.Nacua"). Passing a full name like "Puka Nacua" silently failed to
exclude him — verified and fixed to match on last name either way.
