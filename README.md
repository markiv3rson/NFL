# NFL BETTORS — private site

Password-gated Next.js project: live Polymarket TD prices, live ESPN
injuries/scores/schedule, a Results tab with auto-grading, and a model-rerun
button that calls a separate Railway service running the real Python models.

## What's in here
- `public/index.html` — the dashboard, synced from the live Claude artifact
  as of Fri 9/25 evening (fresh model reruns + verified Friday injury news)
- `middleware.ts` — password gate
- `pages/api/` — live prices, injuries, scores, schedule, results (save/grade/export), model-rerun proxy
- `railway-model-service/` — separate deploy, the real Python model backend

## Deploy (one-time, ~10 minutes)
1. Create a free Vercel account at vercel.com
2. Push this whole `slate-scanner` folder to a new GitHub repo
3. In Vercel: "Add New" -> "Project" -> select the repo
4. Before clicking Deploy, add Environment Variables:
   - `SITE_USERNAME` -> your username
   - `SITE_PASSWORD` -> a real password
5. Click Deploy. You get a URL like `nfl-bettors-xyz.vercel.app`

## Also needed for full functionality
- **Vercel KV** (free tier) for the Results tab: Vercel dashboard -> Storage -> Create Database -> KV
- **Railway model service**: see `railway-model-service/README.md`, then add its URL as `MODEL_SERVICE_URL` in this project's Vercel env vars

## Updating the dashboard later
Replace `public/index.html` in the GitHub repo, Vercel auto-redeploys in ~30 seconds.

## Honest state as of tonight (Fri 9/25)
- **Model numbers**: real, freshly reran against live nflverse data for all
  15 remaining Week 3 games. Confirmed unchanged from earlier in the week —
  expected, since no new games have completed since Thursday's ATL@GB.
- **Injuries**: real, freshly verified via web search for the 5 names that
  mattered most (Nacua now Doubtful, Goedert trending Out, Barkley cleared,
  Chicago's Case Keenum confirmed starting). Brock Bowers' status came back
  from contaminated/conflicting search results — flagged, not guessed at.
- **Prices**: NOT refreshed. Claude's tools can't reliably pull live
  Polymarket cent prices (this was tested and confirmed weeks ago) — the
  price/cent columns on the dashboard are still whatever was last entered
  from your screenshots. You'll need fresh screenshots before betting off
  Sunday's numbers.
- **Deploy**: not done. Claude has no Vercel/Railway account access and
  cannot click deploy — that step is yours, whenever you're ready to walk
  through it.
- **Untested end-to-end**: every live API route (Polymarket, ESPN, Railway
  proxy) — same limitation as always, Claude's tools can't make these exact
  calls from inside chat to verify. First real test is you, after deploying.
