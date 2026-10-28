# SLATEZZ NFL model service (Railway)

Flask app (`app.py`, gunicorn) + scheduler (`scheduler.py`, Pacific times; the job list is in the root `CLAUDE.md`). Settings: `SITE_URL`, `SITE_LOGIN`,
`MODEL_SERVICE_TOKEN` (same value as on Vercel; every route but `/health` requires it), `BUILD_TAG` (a new value = rebuild on deploy), a volume at `/data`.

- `fair_line.py` + `injury_adj.py` — game lines (`/rerun-game-lines`)
- `td_prob.py` — anytime / first TD (`/rerun-td-probs`, `/td-scorers`, `/retrain-td`)
- `prop_model.py` — player props (`/prop-probs`, `/build-props`, `/player-stats`, `/team-yards`)
- `weekly_rebuild.py` + `extra_factors.py` + `team_side.py` — the Tuesday rebuild: game model, TEAM MODEL, TOTAL MOVE, checks (`/combo-model`, `/rebuild-combos`)
- `wide_model.py` — the WIDE shadow (`/wide-picks`)
- `season.py` — season / week helpers; `data/` — research data (Polymarket closes)

Research history (every study, every number): `git log` and `git show 758518d:CLAUDE.md`.
