# NBA Slate

NBA betting app: game lines (moneyline, spread, totals) with the model's numbers, tested patterns, best bets at 56%+, teasers, your Polymarket bets, and automatic daily rebuilds. Same concept and look as the NFL app, NBA data only.

- `public/`, `pages/api/`, `lib/` — the site (Next.js, Vercel)
- `railway-model-service/` — the model service (Python, Railway)
- `CLAUDE.md` — owner's rules, results so far, known gaps

`npm test` runs the site checks and the service checks. See `railway-model-service/README.md` to deploy the service.
