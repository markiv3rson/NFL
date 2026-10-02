# NFL SLATEZZZ — private site

Password-gated Next.js site (Vercel) plus a Python model service (Railway, `railway-model-service/`).
Betting venue is Polymarket US only; sportsbook odds (The Odds API) are reference data.

## Layout
- `public/` — the page (index.html + app.js): Game Lines (tiles; tap a game for everything on it), Anytime TD (top 30), Pick Lab (MODEL ONLY: Picks + Results), Record (your bets only), and the Alerts bell
- `pages/api/` — snapshots (Polymarket lines + TD prices, sportsbooks), model rerun proxy, grading, My Bets, status, backup
- `lib/` — shared logic: picks, grading, calibration, My Bets sync, injuries, snap counts, wind
- `middleware.ts` — password gate
- `railway-model-service/` — fair_line.py (game lines), td_prob.py (anytime TD), injury_adj.py, scheduler; see its README

## Data
Redis (Upstash) for all stored data. nflverse for schedule, scores, play-by-play, injuries and snap counts.
Polymarket prices use the actual buy price (best ask).

## Environment variables (Vercel)
UPSTASH_REDIS_REST_URL_REDIS_URL, SITE_USERNAME, SITE_PASSWORD, MODEL_SERVICE_URL, MODEL_SERVICE_TOKEN, ODDS_API_KEY,
POLYMARKET_KEY_ID, POLYMARKET_SECRET_KEY.

MODEL_SERVICE_TOKEN: any long random string, set to the SAME value on Vercel and Railway. When set, the Railway model
service rejects every call without it (except /health). Leave it unset on both to keep the old open behavior.

## What the numbers mean
- Moneyline win chance: calibrated and market-based (rechecked 9/30: the model's disagreement adds nothing, so it's the market spread only). Not an edge signal.
- Spread / total picks: calibrated; sit near 50% because the model-vs-market gap has no measured signal. Background only.
- Anytime TD chance: td_prob.py, calibrated on two held-out seasons. Record tab grades it against its own stated
  chances and against Polymarket's closing prices (real markets only; thin markets with no bid near the ask are skipped).
- Win chance on Game Lines cards is labeled "market-based" for that reason.

## Schedule (Railway scheduler, Pacific)
Snapshots Sun 6/7/8/9/10/12/3, Mon-Sat 7/12/3/7 + closing snapshot at each kickoff. Reruns Tue 7:05 + 7:30, Thu 7:05,
Sat 7:05, Sun 9:05, and ~60 min before every kickoff wave. TD retrain Tue 7:15. Grading nightly 11:45 PM. Backup 12:05 AM
(needs a Railway volume at /data).

## Updating
Upload changed folders through GitHub "Upload files" → Commit. Vercel and Railway redeploy automatically.

## 10/1 redesign
- Game Lines is a grid of tiles (away name left, home name right, market win chance in the middle, faint team logos behind). Tap a tile for the full game: Market vs Model side by side, the totals card, and each team's top 3 TD scorers.
- Header: countdown to the next game that has not started. Two small Lines / Model pills sit at the bottom right.
- Alerts (bell): injuries, backup-QB starts, line moves, new price gaps, model moves, wind 12+ mph and final results, saved by the snapshot / rerun / grading jobs (`lib/alerts.js`, `/api/alerts`). A rerun only alerts against an earlier run, so a new week never floods the feed.
- Color code: blue = market, gold = moneyline, violet = the model (no glow), amber = warnings, red = injuries/live/bad, cyan = price gaps, green = wins only.
- Parlay Lab (paper only) also records two touchdown parlays each week: the 2 and the 3 most likely scorers (highest model chance, one per game, real Polymarket market, nobody on the injury report), graded after the games.
- Results tab, Replay card: every tracked pick rule replayed on 2007–25 with sportsbook closing lines (`lib/replay.js`, `/api/replay`, cached 12 h), beside its live record. YES only when it beat break-even in all three periods; the two model-side rows are a fixed 2013–25 backtest of the core ratings.
- Touchdown chances (10/1): the model gives the chance a player scores IF he touches the ball, but the page lists everyone who has touched it this season, and the old numbers ran 18% high on that list (2019–25). `touch_adjusted()` in `td_prob.py` multiplies by an estimated chance he plays and touches the ball (rank, last-game and last-3-game snap share, missed the last game, team games since his last touch, depth chart, usage; no injury inputs, which added nothing). Walk-forward 2021–25 it beat the plain rank tilt (`availability()`, kept as the fallback) in 5 of 5 seasons, Brier −0.0034. Everything derived from the chance (2+ TDs, first TD, price gap) follows. Inside 80 minutes of kickoff with the ESPN inactive feed up, the rerun sends `active: true` and the model switches to the chance he touches the ball *given that he plays* (everyone still listed is playing): regulars back from an Out/Doubtful week who played touched the ball 100% and scored 35–36% (healthy stars 37%); the lower average came from the 36–39% who sat again.
- A green "↩ RETURNING" label (list row and the opened card) marks a player who was Out/Doubtful on last week's injury report, is not this week, and is practicing (full or limited). The service treats him as playing (`returning` in the rerun payload → the chance he touches the ball given that he plays); 2021–25 returners who practiced fully played 87%, limited 61%, did-not-participate 17%, no practice entry 6%, so the last two are only flagged (amber "WAS OUT · NOT PRACTICING") and are not treated as playing. Last week's Out/Doubtful list comes from the same nflverse injury file (`prev` in `lib/injuries.js`).
- Pick Lab is model-only (banner). Picks tab = this week's picks (moneyline side list with spread/total side, Parlay Lab). Results tab = every record (tiles, model-side records, tracked angles, parlay scoreboard, past seasons). Record shows only your own bets.
- Backgrounds: the matchup card on a game page has the two team colors in halves with split logos and each logo beside its name; the whole game page has the same split at low strength (cleared on other tabs); the header's next-kickoff line shows both logos beside the names.
- The page refreshes itself every 2 minutes while open (lines, model, injuries, alerts, Pick Lab, Record) and when you return to it.
- Live lines: while a game is in progress its card shows Polymarket's current spread / moneyline / total (`/api/live`, 15 s cache, refreshed every 30 s while the game is open) with a LIVE tag. Display only: the model, picks, kickoff line, closing line and grades stay locked at kickoff. If Polymarket has no open lines for the game the card says so instead of showing an old number.

### My Bets settlement (10/2)
Polymarket drops a position from the list once it settles, so a settled bet used to show "P/L not reported" and never reached the record.
The sync now also reads Polymarket's own settlement activity (`POSITION_RESOLUTION`) and records won/lost and P/L for every bet, even one that settled between two syncs. A preloaded combo (same week and cost) takes that result at once instead of waiting for nflverse's final score and is never listed twice. The Week 4 PIT @ CLE combo is preloaded with estimated leg prices (they affect only expected/CLV).

Grading + account sync now also run hourly at :20 (6 AM-11 PM PT) from the scheduler, not just at 11:45 PM (10/2).
