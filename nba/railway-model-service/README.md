# NBA model service (Railway)

Python service the site calls for the model's numbers. It also rebuilds itself every day.

## Deploy
1. Railway: new project from this GitHub repo; root directory `railway-model-service` (or use the root `railway.json`).
2. Add a volume mounted at `/data` and set `MODEL_DIR=/data` AND `NBA_CACHE=/data/cache` (the downloaded box scores, closing lines and injury reports live there, so a redeploy doesn't throw them away) (the daily rebuild publishes there; without it, it publishes into the repo's `data/` folder and loses it on redeploy).
3. Variables: `MODEL_SERVICE_TOKEN` (same value on Vercel), `SITE_URL` (the NBA site), `SITE_LOGIN` (`user:password`, if the site has a login), `VERCEL_BYPASS` (only if Vercel Deployment Protection is on).
4. On Vercel set `MODEL_SERVICE_URL` to the Railway URL.
5. After deploy: open `<railway url>/injuries` (with the token header) and compare it with the NBA's injury report page; check `<railway url>/health` -> `rebuild` -> `injury_days` grows over the first rebuilds (optional `INJURY_HISTORY_SECONDS`, default 900).

## Endpoints
`GET /health` · `GET /injuries` (the official report by game day) · `POST /slate` (tonight's games and lines -> model numbers, patterns, teaser win rates) · `GET /models` · `GET /combo-table` · `GET /futures` (season simulation + its backtest report; rebuilt 4:40 AM PT) · `POST /rebuild`

## Files
`nba_data.py` data, cleaning, site closing lines · `nba_injuries.py` the NBA's official injury report (parser, history, fitted weights) · `nba_features.py` missing players, team context and travel · `season_sim.py` season simulation (futures) and its backtest (`python3 season_sim.py --backtest`) · `nba_roster.py` share of last season's minutes still on each roster · `fair_line.py` ratings · `fit_model.py` final numbers and accuracy report · `combo_study.py` pattern search with the shuffle check · `live.py` tonight's games · `daily_rebuild.py` + `scheduler.py` automatic rebuild · `tests_service.py` checks

Data: ESPN box scores and schedules (sportsdataverse releases) and closing lines 2008-2026 (kyleskom/NBA-Machine-Learning-Sports-Betting). Cached in `~/.nba_cache`.
