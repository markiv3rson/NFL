# NBA side of SLATEZZ — notes for Claude

The owner's rules and the app layout are in the root `CLAUDE.md` (they apply here). Rewritten short on 10/28; the full history is in git: `git show 758518d:nba/CLAUDE.md`.
Season number = the year the season ENDS (2027 = 2026-27).

## Where things live

- Site: `nba/lib/*`, routes `pages/api/nba/*` (every route is `/api/nba/...`), pages `public/nba/index.html` + `public/nba/app.js`, tests `nba/tests/*` (`npm run test:nba`).
- Model service (Railway): `nba/railway-model-service/` — `nba_data.py` (data + cleaning + the site's closes via `/api/nba/closes`), `nba_injuries.py`, `nba_features.py`, `fair_line.py`, `fit_model.py` (numbers + accuracy report), `live.py` (tonight's games, line table), `team_side.py` (team model, data only), `nba_prop_model.py` (props, teammates-out input v2), `season_sim.py` (futures), `daily_rebuild.py` + `scheduler.py`, `app.py`.
- Settings (combined Vercel project): `NBA_REDIS_URL`, `NBA_MODEL_SERVICE_URL`, `NBA_MODEL_SERVICE_TOKEN`, `NBA_ODDS_API_KEY` — NBA never reads NFL's database, service or odds key. Railway NBA service: root `/nba/railway-model-service`, config `/nba/railway-model-service/railway.json`, `SITE_URL`, `SITE_API=/api/nba`, `SITE_LOGIN`, `MODEL_DIR` + `NBA_CACHE` on a volume.
- Jobs (Pacific): rebuild 5:15 AM (ESPN's box files land ~4:30 AM), prop refit 5:35, futures 5:55, catch-up 8:15 when yesterday's box is missing; site snapshot every 30 min 7 AM-9:30 PM + 3 min before each tip; grading 11:45 PM (props re-graded up to 3 looks for ESPN corrections); backup 12:10 AM.

## Data

- Box scores / schedule: ESPN via sportsdataverse 2008-now (player boxes 2021-now). Closing lines 2008-2026: `OddsData.sqlite` (cleaned), then the site's own recorded Polymarket closes (`lib/closes.js`).
- Live: Polymarket US (spread / total / moneyline + alternates, 1H spread / total / moneyline, team totals, player props as "N+" ladders — the No side of every NBA player prop is NOT buyable). Books: The Odds API, 7 AM and 1 h before the first tip on game days (reference + BOOK GAP).
- stats.nba.com never answers from a data center: no tracking data.

## What the card does

- **PICK side**: LINE MOVE (Pinnacle moved, Polymarket not yet: at the open 67.9%, after 56.3%) > BOOK GAP (books 1-4 off on the spread 59.7%, 2-6 on the total 64.1%, books pulled in the last 6 h; measured bought-line rates `BGAP_PTS`) > FATIGUE (OT back-to-back / 1,500+ km flight) / ATS REGRESSION (away team covering 35% or less of 20+ lined games: 57.3%) / SHOT QUALITY (totals) > the model's side (49.4% spread / 50.4% total, yellow). No PICK w/ POINTS on the model-side total. A line needs both sides priced 0.1-0.9 (day-early stub markets are never lines, never picks; old stub picks voided).
- **Line table** (`live.py total_rate / spread_rate`): every past game measured against its OWN line. Rule PICKs lift their bought lines by the PICK's edge.
- **ML PICK** = the market's fee-out chance 56%+ (calibrated on 22,003 closes; beats the model).
- **Props**: Overs only, shown % = 0.4 model + 0.6 price (PRA 0.8 model + 0.2 price, `OVER_W_STAT`: real-book PRA Overs priced 65.4c won 78.7% of 357, day-by-day Brier 0.1784 -> 0.1701) then band-calibrated (K 100), 65%+, priced 60-77c and 2+ points under the shown % (PRA exempt), no Over when the player's team is a +2.5 or bigger underdog (47.4% on 2,300 real lines), Threes and rebounds Unders cut. Prop Parlays 6 / 8 / 10 legs per game ($5), Same Game 4 ($5; the card's green PICKs + prop rows); the parlay chance counts same-game links (own team cover + his Over 1.03x, other team 0.97x, total Over + points / assists Over 1.04x).
- **Shadows** (Models -> Shadow trackers, never picks): 1H SPREAD (`lib/h1spread.js`: first-half margin from the full-game line vs every Polymarket 1H spread line, props rules at 56%; real 2025-26 fresh closes 72-48 = 60.0%, fragile), 7 angle mixes (TIRED, BIG DOG vs a tired favorite, RESTED vs star out, RESTED road favorite, RESTED from mid-February, MODEL TOTAL 8+ from March, MODEL TOTAL 8+ under with a star out), LINE MOVE shadows, star out -> teammates' Over, 77c+ hidden prop rows.
- Every game market's prices are saved first + latest at each snapshot (`gmpx:<date>:<game>`).

## Tested, no edge (don't redo without a new idea)

- The game model does not beat the closing line (margin 10.80 vs 10.56, total 15.00 vs 14.37 on the report basis); team model 50-53%; wide all-flags model, Elo, team-stat totals, a ridge / GBM on what the line misses: nothing; 2,303 single patterns per market and 34-condition pairs: none hold out of sample (persistence 52.0%).
- Early-season Unders / Overs, league and team over-under form, back-to-back rebounds Unders, star-out Unders, blocks, hot / cold player form, home / road prop splits, line-size cuts, the 60c floor (stays), books' opener vs Polymarket, moneyline books vs Polymarket, NBA 1H totals (53.7%) and 1H moneyline (fail), team totals (model 9.21 vs market 8.94).
