# SLATEZZ — private NFL + NBA betting site

One Next.js site on Vercel (nfl-nfl9.vercel.app): NFL at `/index.html`, NBA at `/nba/index.html`, shared `public/shell.js` + `public/shell.css`.
Two Python model services on Railway: NFL `railway-model-service/`, NBA `nba/railway-model-service/`.
Betting venue: Polymarket US. Sportsbook lines (The Odds API, Pinnacle) are reference data.

**Read `CLAUDE.md` first** (the owner's rules, what every pick is and how it was tested, data, jobs). NBA details: `nba/CLAUDE.md`.

## Where things are
- `public/` — the pages (NFL `index.html` + `app.js`, NBA `nba/`), helmets, backgrounds
- `pages/api/` — routes (NFL `/api/...`, NBA `/api/nba/...`): snapshots, 15-min Polymarket pull, slate, grading, My bets, alerts, backup
- `lib/` (NFL), `nba/lib/` (NBA) — picks, line tables, models, grading, Polymarket / ESPN / nflverse readers
- `middleware.ts` — password gate
- `tests/`, `nba/tests/` — `npm test` (site checks, grading audit, service checks, accuracy replay, NBA checks); `npm run verify` re-grades the season from outside data

## Settings (Vercel)
`NBA_DB_URL_REDIS_URL` (the one paid Redis Cloud database, both sports; NBA keys under `nba:`), `SITE_USERNAME`, `SITE_PASSWORD`,
`MODEL_SERVICE_URL`, `MODEL_SERVICE_TOKEN`, `ODDS_API_KEY`, `POLYMARKET_KEY_ID`, `POLYMARKET_SECRET_KEY`,
`NBA_MODEL_SERVICE_URL`, `NBA_MODEL_SERVICE_TOKEN`, `NBA_ODDS_API_KEY`.

## Deploys
Only `main` deploys (Vercel skips `claude/**` branches; check `x-build` on `/api/slate`). A merge touching `railway-model-service/**` redeploys the NFL service; `nba/railway-model-service/**` the NBA one.
