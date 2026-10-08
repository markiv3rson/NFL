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

While the page is open it also calls /api/results/grade?lock=1 on load and every refresh (server lock: one run per 5 minutes across all tabs), which grades finished games, syncs the Polymarket account, and reloads the Record data if it ran (10/2).

Record tab (10/2): week chips (default = this week, "Season" = all); account bets get their week from when they settled.

System status now lists, for each game that has kicked off, whether its closing line, the model picks and the favorite were saved ("Recorded this week") (10/2).

After every game (10/2): the scheduler checks nflverse every 15 minutes and reruns the model as soon as a new final score appears (src=postgame). The TD retrain now also runs Wednesday 7:15 AM as a catch-up if Monday night posted late; a retrain on unchanged data keeps the live model (clear-win rule). Calibration already updates on every grade run.

Scheduler 401s now log who refused (the site login vs Vercel Deployment Protection). Optional Railway variable VERCEL_BYPASS = the "Protection Bypass for Automation" secret from Vercel (10/2).

The scheduler tests its connection to the site at every start and logs the result, then runs a catch-up grade (10/2).

Same-game paper parlay (10/2): for every game the scheduled snapshot records one parlay ~26 h before kickoff: the biggest edge from spread/total/ML (max 2) plus its best TD edge. Legs are linked so no hit rate is claimed (prob null); only the real result is kept. Graded with the other paper parlays and shown in Pick Lab.

Game-by-game results (10/2): week chips with counts (default = newest week with results; "All" shows everything), games in kickoff order.

model_best_4 (10/2): the model's own parlay, not copied from any bettor: its 4 most likely legs across different games (home moneylines it gives 75%+ and the most likely scorers), real combined chance recorded; part of the weekly paper set.

Old weeks clean up (10/2): an account bet from an earlier week that is not resolved is no longer "open", and a typed-in combo with a leg still unresolved 3 days after its last game shows as "settled" instead of open.

Record tab, earlier weeks (10/2): results only. The open bets, expected returns and live account sections are hidden; the Settled bets list opens by default.

Pick Lab winners list (10/2): each game shows labeled "Spread / Total / TD" lines (TD = the game's most likely scorer who is not out) under the moneyline pick.

Pick Lab (10/2): the Picks view keeps the model's pick on every game (saved at kickoff, graded after) and the parlays; each parlay type has a one-line rule saying how its legs are chosen.

Pick Lab review (10/2): every parlay type is judged after 30 graded parlays by a rule set in advance, from its own results: HOLDS (it hit about as often as the model said), OVERSTATED (its chances run too high: fix the model, not the picker), UNDERSTATED, or PAYING / LOSING for same-game parlays whose legs move together. Nothing is retuned from a few weeks of luck.
The same-game parlay record is built only for games that need one (not on every snapshot).
My Bets now has an end-to-end test on a mock Redis covering Polymarket settlements, combo legs, earlier weeks and typed-in combos listed once.

Tabs (10/2): Game Lines, Anytime TD, Pick Lab (the model's parlays + parlay scoreboard only), Bets (your real Polymarket bets, formerly Record), Models (every model's picks and results in nine sections: scoreboard, winners, spreads and totals, touchdowns, tracked angles, price gaps, trends and analysis, misses and every game, system). Each section opens with one plain line saying what it means. Trends has hit rate by week, confidence vs result, and the touchdown calibration bars, drawn in plain code (no chart library).

Three fixes (10/2): (1) System lists only errors from the last 48 hours. (2) A bet whose games are all over but whose touchdown data is not posted shows "final · waiting for touchdown results". (3) lib/espnFinals.js: a game nflverse has not posted, that kicked off 3 h 15 min ago and ESPN reports completed, counts as final with ESPN's score, so spread/total/moneyline legs and the picks grade without waiting; touchdown results still wait for the official play-by-play (grading skips a game's TD part until it is posted). If ESPN is down nothing changes.

Audit fixes (10/2): the weekly $200 budget and the Bets tab now share one count (lib/placed.js: each bet once, no combo legs, account bets in the week they settled); a bet whose games are over but whose touchdown data is missing stays visible in earlier weeks and now shows "final · waiting for touchdown results" for typed-in combos too (before, only account bets showed the label); sections you open on Models and Bets stay open through refreshes; Bets opens fine before the slate loads; the Scoreboard heading names its week; stale tab names fixed in two messages.

Gaps closed (10/2): (1) a game whose raw spread or total gap is under 0.05 now leans the side its calibrated chance leans (same rule in lib/picks.js, lib/paper.js picksFor and the page), so every game has a side unless that chance is exactly 50%; (2) the same-game parlay no longer needs sportsbook gaps: a gap wins its slot, and the model's own spread side, total side and best scorer fill the rest (15 of 15 games buildable on a full local slate, 0 of 15 before); (3) Models and Bets show an "Updated hh:mm" line; (4) the alerts bell posts a RESULT alert when one of your bets settles and when a model parlay is decided (once each).

Improvements (10/2): (1) Pick Lab shows each market-only parlay rule's long-run history next to its live record (lib/replay.js parlayHistory: 2007–25, priced at the home moneyline; cross-checked against the Replay row, 591 games, 87.8% hit, +2.6%); rules needing the model's past numbers say they are judged live only. (2) Bets has an Analysis section: each leg type's hit rate against the price paid, and record by combo size, from typed-in combos. (3) Models shows closing-line value for the spread and total sides (points the market moved toward the pick); older results are filled once from the week's first snapshot (lib/grade.js clvPtsFor). (5) ESPN is skipped for a minute after a failed or slow call (3 s limit); Models no longer shows two differently-sourced moneyline/spread/total records under the same names.
Number checks added: every week's Bets record, profit and open money add up to the season's (200 random sets); the weekly $200 budget and the Bets tab count the same dollars (60 random ledgers x 3 weeks); parlay-history and closing-line maths are hand-worked in tests.

Research and guards (10/2): 25 new angles (rest, byes, Thursday, divisions, bye weeks, temperature, domes, totals, week ranges, ...) were tested on 2007-25 with three periods and a multiple-testing bar; none holds, so none was added. The market's moneyline chances are well calibrated (no band off by more than ~2 standard errors), so the page does not adjust them. Widening the favorites parlay to road favorites made it worse (any-side 75%+ top 3: -1.6% vs +5.9% home-only, which is itself unstable), so it stays home-only. Guards added: the settlement cross-check (when the scores already decide a typed-in combo, Polymarket's verdict is compared and a disagreement is flagged on Bets) and a weekly recap alert once every game of a week is graded.

Grading checks (10/5): touchdown grading was checked against an independent source (nflverse player stats, rushing + receiving TDs) for all 14 finished Week 4 games: per-game totals and per-player counts match exactly. The typed-in combos grade the same as the on-screen results (Week 3 all lost, Week 4 PIT @ CLE combo won +$110.32). New watchdog line: "Final but not graded after 12 h" names each game and why (no closing line saved / no model numbers saved / waiting for the official touchdown data), so a game can never go ungraded silently.

From the 10/5 export (production data): all 30 Week 4 moneyline/spread/total results re-derived from the final scores matched; 160 touchdown flags matched nflverse player stats (0 wrong). Found and fixed: a game's touchdown players have no "played" flag until the week's snap counts post (hours after the games; 13 of 172 were set), and those players were being counted as model misses in the touchdown calibration, the miss finder, the Models touchdown checks and the weekly recap. Now only players known to have played count; the rest are shown as "waiting for snap counts", and the weekly recap alert waits until every flag is set. The watchdog also reports games graded with a part missing (the 9/28 Monday game has only its moneyline).
Tests that depended on a fixed calendar date now use dates relative to today.

Absurd-line fix (10/5): on 10/4 two Week 4 spread picks were saved at absurd lines ("MIN +19.5" and "SEA +20.5"; the real closing lines were MIN -10 and SEA -7) and graded as wins, inflating the spread record (10-4) and the closing-line numbers. Cause: lib/poly.js picked the main spread as "the market whose price is closest to 50/50", and an unpriced alternate line sits at a placeholder 50%. Fixes: (1) the main spread must fit the game's moneyline (within 4.5 points of what it implies) and prefers markets with a real two-sided book; (2) lib/sane.js drops a Polymarket spread/total more than 6 points from the sportsbook closing line (nflverse spread_line/total_line, now carried on every game row) at snapshot time and at grading; (3) results, Pick Lab picks and edge-tracker spots already saved with an absurd line are removed at the next grading pass instead of counting; (4) the edge tracker ignores gaps over 30% like the rest of the app. Checked: the other 8 graded Week 4 spreads and all totals were within 1 point of the real lines.

Label fix (10/5): parlay lines said "market chance" but the number is the app's own estimate (model touchdown chances times market-implied win odds); now "est. chance".

Parlay chance labels (10/5): each parlay line shows "market chance X%" (1 / payout, the price itself) and, where there is one, "model Y%"; the scoreboard says "model said".

Agree-with-the-market (10/5): (1) each touchdown row shows a blended chance (half the model, half the market mid price) on real markets; Models also scores the blend next to the model and the market (Weeks 3-4, 123 players: blend 0.2154, model 0.2158, market 0.2174; weight fixed at 50/50 until about 500 graded players). (2) When the model and the market are within a point on the spread or total, the lean box says "Agrees with the market" and the pick list marks "(agrees)".

Anytime TD tab (10/5): shows the three likeliest scorers per team (the old league-wide top 30 filled with 15 players per team when only one game was priced); no "Show everyone" button (removed 10/5, it was noise).

Lean wording, 3-per-team TD, live total check (10/5): (1) the Model leans box no longer says "No lean · about 50/50"; it always names the model's side as a "weak lean" with the real historical rate (picks this close to the line won about 51%, break-even 52.4%). Nothing is labeled strong because the all-in backtests (2016-25) found no edge against closing lines. (2) Anytime TD shows the top 3 per team. (3) Live Polymarket totals more than 15 points from the schedule-file total (a half or alternate market, e.g. "OVER 27.5" on a 52.5 game) are dropped from the live display.

TD calibration honesty + edge mark (10/5): from the 10/5 export (272 players who played, Weeks 3-4) the 35-50% bucket said 39% and scored 29% (n=24, margin about ±9), the 5-15% bucket said 11% and scored 18% (n=108): mostly noise at this sample, so the correction stays shrunk (K=150, ±15% cap) rather than chasing it. The Models calibration rows now show "scored X% ±margin" and "too few to trust" under 30 players; Anytime TD rows show "+N vs price" only when the half-model/half-market blend beats Polymarket's price by 5+ points on a real market.

Next week early (10/5): Game Lines and Anytime TD have a "This week / Next week (Week N)" toggle (shown only when next week's slate has games). Next week's touchdown percentages exist before Polymarket lists anything: `/api/rerun?week=next` runs the game model first, then feeds the TD model the game model's own spread and total (no market line, so no ¢ price and no "+N vs price"); each such game is flagged `early` and labeled "Early estimate · no market line yet" until a normal rerun at real lines replaces it (no alerts or `auto:last` are written for early runs). The scheduler runs it daily 8:00-8:59 AM Pacific in the shared rerun slot. `/api/slate?week=N` is cached 2 minutes per week.

Next-week Model button (10/5): with "Next week" selected, the ▶ Model button runs `/api/rerun?week=next` (the early estimates) and the empty list says the early estimates aren't ready yet.

Was-out tag fix (10/5): the "WAS OUT" / "RETURNING" tag and the "last week out" note are no longer shown for a player whose snap counts show he played his team's most recent game (`playedLastGame` in `lib/snaps.js`). The injury feed's latest report can be older than that game; Nacua, who played a full game, was still tagged. Display only, the chance is unchanged.

Early game boxes + cache fix (10/5): on next-week games with no market line yet, the Model leans boxes show the model's own spread, win chance and total, labeled "Early estimate" (they stay blank on any other game without a line). The early run now also clears the per-week slate cache (`SLATE_CACHE:wN`), so the Next week view fills in right after it finishes instead of up to 2 minutes later.

Graded touchdown cards (10/5): on a finished game's page, each top-scorer row is marked "✓ scored", "✗ no TD", "inactive" or "waiting for snaps" (or "not graded" if the player isn't in the game's record), and a line above the cards reads "model's top N · X scored · expected Y" counting only graded players who played (same rule as Models). The graded records come from `/api/results/list` (loaded once, only when a finished game page opens), so the numbers match Models → Touchdowns and feed the same calibration check.

TD model by position and by opponent defense (10/5): Models → Trends now splits the touchdown check (said vs scored, ±margin, "too few to trust" under 30, only players who played) by position (RB/WR/TE/QB) and by opponent defense (the opponent's average points allowed in its OTHER graded games: 3+ above the league average = weak, 3+ below = strong; the game being graded never counts, otherwise a high-scoring game would make its own opponent look weak). New graded records keep each player's `pos`; older ones are filled in by `/api/results/list` from the model run saved for that game (players no longer in that run show as "no position on record").

One page, no toggle (10/5): the "This week / Next week" buttons are gone. Game Lines shows this week's tiles and, under them, a "Next week · Week N" heading with next week's tiles; Anytime TD shows this week's top 3 per team and, under it, next week's top 3 per team (its own ranking, labeled "Early estimate" until real lines arrive). A tapped next-week game opens its own page. When every game this week has started, the tab says "No games left this week". The ▶ Model button reruns this week and, if next week has no estimates yet, runs `/api/rerun?week=next` too.

Moneyline sanity + three fixes (10/5): the 10/5 export showed "MIA ML 95%" (at MIN) and "LAC ML 95%" (at SEA), road-underdog picks from the same corrupt Polymarket read as the bogus alternate spreads, which inflated "right 44% (said 67%)" and "each week's top 4: said 86%". (1) `mlOk` (lib/sane.js): a moneyline pick whose chance differs by more than 25 points from what the sportsbook closing spread implies (`homeWinFromSpread`, normal curve with SD 13.5) is dropped, both when a game is graded and for records already stored (one-time purge, `mlChecked`; the stats-only moneyline model is unaffected). Grading also never feeds a bad stored spread into the moneyline chance (it falls back to the sportsbook line). (2) The lean box says "Picks like this have won about 51%" instead of "this close to the line", which was wrong for big gaps. (3) The watchdog's "graded without its spread and total picks" warns only while the record is under 3 days old (a Week 3 game from before lines were saved warned for two weeks and could never be completed).

Tab order (10/6): Game Lines, Anytime TD, Bets, Models, then Pick Lab renamed "Model Picks" last, right before the bell. The tab buttons size to their text (equal columns would clip the longer label on a narrow phone).

Moneyline sanity everywhere + calibration check (10/6): the corrupt Week 4 read that produced "MIA ML 95%" also fed the "most likely winners" list and the price-gap tracker, so the 7–9 "right 44% (said 67%)" record and the 2-of-9 moneyline price gaps still held bad rows after the graded-result fix. Now (1) `recordWinner` replaces a winner whose chance doesn't fit the sportsbook closing spread with that spread's own favorite; (2) `gradeWinnersWeek` removes any stored winner that fails `mlOk` (graded or not) so it counts in no record; (3) `gradeEdges` removes a moneyline price-gap spot whose price fails `mlOk`. Calibration check on the 10/6 export (507 players who played, Weeks 3-4, leave-one-game-out by game): the current bucket correction (K=150, ±15% cap) scored log-loss 0.4932 / Brier 0.1583 vs 0.4942 / 0.1586 uncorrected, while a fitted logistic recalibration was WORSE (0.4965 / 0.1597; 0.4954 with shrinkage). So the calibration stays as is: nothing tested beats it out of sample, and the #2-scorer shortfall (22% scored vs 32% said) flips to #3 over-performing (36% vs 25%), which is noise, not a rank effect.

Plainer pages (10/6): removed the extra explanations across the site: the one-line meaning under each Models section, footnotes on how to read a number ("Judge after 100+ picks", "Saved at kickoff, graded after", color legends), every visible "break-even / 52.4%" mention, the wind-angle history sentence, the replay and parlay-scoreboard footnotes, the "Tap a row / Tap a game" hints, and the note under the touchdown grades. Kept: every number, record and heading; everything about price gaps (strip, tile tags, Models section, "+N vs price"); warnings (watchdog, QB change); short labels ("Early estimate", "too few to trust", "weak lean").

Week 6 removed + first TD pick (10/6): (1) the next-week section is gone from Game Lines and Anytime TD, the scheduler's daily 8 AM early run is removed, and the ▶ Model button no longer runs next week (`/api/rerun?week=next` still exists but nothing calls it). (2) Each game page shows "First TD pick": the player from either team with the highest first-touchdown chance (Out/Doubtful skipped), marked ✓/✗ after the game; Models → Touchdowns adds "First TD picks: X of N right (model said Y%)". (3) First-TD calibration (`buildFtdCalibration` / `applyFtdCalibration`): same shrunk, ±15%-capped bucket method as the anytime-TD correction, OFF until 100 graded games have first-TD results (15 on 10/6; the top pick was 3 of 15, said 19%).

Model first on totals (10/6): when the model leans Over, the "★ Tested angle: Under (wind)" line is left off the game card, so each game shows one call (the model's total already includes the wind adjustment). When the model also leans Under, the angle still shows beside it. The wind angle keeps its own record in Models → Tracked angles.

Price-gap purge for graded spots (10/6): `gradeEdgesWeek` now runs the same sanity check (`badSpot`: absurd spread/total line, or a moneyline price that doesn't fit the sportsbook closing spread) over spots that were already graded, and removes the bad ones, so a corrupt-read spot graded before the check existed no longer counts in the price-gap record (e.g. the 2-of-9 moneyline row).

Teaser legs, "No" mark, retrain-aware correction (10/6):
- Teaser legs (`lib/teaser.js`): an underdog getting +1.5 to +2.5 bought 6 points higher (+7.5 to +8.5) crosses 3 and 7. 2007-25 regular season, closing lines: covered 76.1% of 616 (2007-12 75.8%, 2013-18 74.8%, 2019-25 77.2%); the favorite version faded to 70.5% in 2019-25 and is not used; home underdogs straight ATS were 49.7% of 1,764 (no edge). Polymarket's alternate spreads (both sides, real two-sided books only, `poly.alts`) are saved as one latest copy per game (`alts:{season}:{week}:{game}`, never inside the 200 snapshots). Game Lines shows a "Teaser legs" strip (price, ✓ when 73¢ or less); each leg is saved at kickoff and graded after (paper, `teaser:{season}:{week}`), shown in Models → Tracked angles with its return at the price paid.
- "No" mark: on a real market where the model is 5+ points under the bid, the Anytime TD row shows "No · N under"; Models → Touchdowns adds "$1 on No when model is 5+ pts under" (10/6 export: 21 of 28, +27%; any gap: 58 of 84, +7.6%; 3+: 32 of 46, +12%).
- After the Tuesday retrain puts a new touchdown model live, `/api/status` records the switch week (`tdmodel:switch`) and the touchdown correction counts games graded under the old model at half weight.
- Checked and left alone: the stored `thin` flag on a few old 99¢/1¢ rows is wrong, but every Models number re-checks bid/ask itself, so nothing is skewed.

Quarterbacks in the touchdown model (10/6): the list held RB/WR/TE only, so running QBs never showed, were never graded, and their TDs sat in first-TD's "someone else" (2022-25: QBs 0.58 rushing TDs a game, 12.4% of first TDs; defense/special teams 5.7%). `td_prob.qb_row` adds each team's most recent starting QB (Out/Doubtful/IR skipped for the next QB with starts): logistic on his rushing per start this season blended with last season (carries, red-zone and inside-5 carries, rushing TDs), team implied points and opponent rush TDs allowed. Walk-forward 2022-25 (`railway-model-service/qb_study.py`): better than a flat rate in 4 of 4 seasons (e.g. 2025 Brier 0.1207 vs 0.1313); said 13.4/24.1/36.3% vs 12.7/29.3/41.1% scored. Example (BUF @ LA): J.Allen 48%, M.Stafford 8%. With QBs listed, first-TD "someone else" is defense/special teams only (0.28 TDs a game, `FIRST_OTHER_QB`, same in lib/calibration.js); listed players now cover ~95% of first TDs. QB rows are graded like everyone else (the scorer feed already includes QB rushing TDs) and show in Models → By position.

Injuries dropdown midweek (10/7): the button only counted Out/Doubtful/Questionable, and the Wednesday report has practice notes only, so on 10/7 TB @ DAL lost its "Injuries" button. `injDisplay` (lib/week.js) now also lists "DNP (practice)" and "Limited (practice)" (full practice left out), after the game statuses, so the dropdown never vanishes midweek. Display only: model decisions still use game statuses.

Alerts, opening line, wind test (10/7):
- New alerts (bell): "Teaser leg" when an underdog +1.5..+2.5 at +7.5..+8.5 is priced 73¢ or less (from the snapshot that saves alternate prices); "TD No" when a real touchdown market's bid is 5+ points over the model as shown (after calibration); "QB TD" when a starting QB's touchdown chance moves 10+ points between model runs (a new starter at 20%+). Each alerts once (teaser/No: per leg/player for 4 days).
- Lean box: "Opened TB +8.5 · moved 1 toward the model" once the line has moved half a point since the week's first snapshot (green when toward the model's side).
- Wind and touchdowns, tested and NOT shipped: in outdoor 10+ mph wind the model runs a little high on WR/TE in 4 of 5 seasons, but a wind adjustment fit on the 3 prior seasons improved held-out windy games in only 3 of 5 seasons (2021-25) and the overall Brier change was ~0, so it stays out.

Kickoff times from ESPN (10/7): nflverse's schedule still had CHI @ GB at 1:00 PM ET when the game was at 4:25 PM ET, so the app showed the wrong time and the closing-line snapshot, pre-log and kickoff-wave rerun would have fired hours early. `overlayEspnKickoffs` (lib/espnFinals.js, applied in loadSeason) and the scheduler's `_espn_kickoffs` now use ESPN's kickoff for unfinished games in the next 8 days whenever it differs from the schedule file by 10+ minutes (ESPN codes WSH/LAR map to WAS/LA). ESPN down = the schedule file's times, as before.

Audit (10/8), end to end with realistic data (slate build, kickoff snapshot, grading): ESPN kickoff override, alternate-spread storage (one copy per game, never inside snapshots), teaser leg recorded at kickoff and graded (CHI +8.5 at 70¢ → W, +43%), TD "No" and teaser alerts, QB rows priced and graded (first-TD with the 0.28 defense/special-teams rule), moneyline/winner sanity, practice-only injuries, and `next build` all checked. One wording fix: the teaser strip said "✓ under 73¢" for a leg at exactly 73¢; it now says "✓ good price".
