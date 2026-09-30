# NFL SLATEZZZ model service (Railway)

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

## Injury adjustment (added 9/28) — injury_adj.py
`/rerun-game-lines` now accepts an optional `inj: {away: [...], home: [...]}` per game (the official injury list for the CURRENT week,
sent by the site's `pages/api/rerun.js`). When present, the fair spread/total/win % include the injury adjustment and the response
also carries `raw` (the plain model) and `inj` (who caused the shift). Without `inj` nothing changes.

- Starters = each team's regular starters over its last 4 games of official snap counts (this season, last season fills early weeks).
- Points per missing starter (fit on 2013-2025, 2,561 games): QB1 -3.96, WR1 -1.78, each LB -1.25, each OL -0.87, each DB -0.76.
  Game total: only a missing QB moves it (-2.84). RB1, TE1, WR2/3 and the defensive line were tested and are NOT used (effect not distinguishable from zero).
- Status weights (how often a listed starter really sits, 2016-2025): Out 1.00, Doubtful 0.99, Questionable 0.28.
- Cap: 6 points per team (binds in under 1% of 2016-2025 team-games).
- Honest scorecard (leave-one-season-out): margin error 10.54 -> 10.41 (market 9.94); against the spread 50.0% at a 2-point gap (break-even 52.4%).
  It makes the lean more accurate; it is still an Estimate and not a bet signal by itself.

## Home-field, totals, and calibrated chances (added 9/28) — fair_line.py, app.py
`fair_line.py` and `/rerun-game-lines` now include, on top of the injury adjustment above:

- **Home-field fix.** The plain model underrated home teams by ~2.2 points, holding steady in every 5-year block
  2006-2025. Fixed with `+2.2` to the home margin. On a neutral site (e.g. the Brazil game), the model's own home
  boost is removed instead — neutral games ran ~4.7 points worse than the model expected (60 games, 2006-2025).
  Cut 2006-25 margin error 10.83 -> 10.69.
- **Totals spread corrected.** `SD_TOTAL` was 10; the real out-of-sample spread of totals error over 2006-2025 is
  ~13.3, so Over/Under percentages were overconfident. Now 13.3 on both the model service and the site (`lib/odds.js`).
- **Totals adjustments.** Dome/closed-roof games +2.59 pts (t=5.5, strong). Pace: +0.12 pt per combined recent
  play (last 8 games/team) above that season's league average (t=2.8, weaker). Combined: total MAE 10.78 -> 10.75.
- **Calibrated win / cover / Under chances.** Fit out-of-sample (leave-one-season-out), replacing the plain
  margin -> normal-CDF percentages:
  - Win: uses the market's spread as the main input (`cal_win`). Brier 0.2082 vs 0.2211 for the model's own
    margin-only percentage. Falls back to a model-only fit when there's no market spread yet.
  - Cover / Under: the model's disagreement with the market carries **no measurable signal** out-of-sample
    (`cal_cover`, `cal_under` land at ~50% regardless of the gap size). Stored on the response (`calHomeCover`,
    `calUnder`) but NOT shown — the Weak/Moderate/Strong tiers stay as they were, unchanged.
- **Team points.** `team_points()` gives each team's expected points and its chance of scoring over each
  half-point line from 13.5 to 34.5, blended from the market-implied points (tested best; the model's own gap
  gets ~0 weight). Shown on the Game Lines card as "Team scoring: ...".

## Extra TD markets (added 9/28) — td_prob.py, app.py
Built on the same calibrated anytime-TD chance, tested walk-forward 2016-2025 (train on 2 prior seasons):

- **Snap share.** Each player's average offensive snap % over his last 3 games and his last game, from official
  snap counts, added as model inputs. Improved Brier score in 10 of 10 seasons (0.15897 -> 0.15820) — this is
  the model's known blind spot (e.g. a role that shrank after a fumble) and now the model can see it.
- **2+ touchdowns.** Poisson from the anytime chance, x1.09 correction (fit to match actual rates). Brier 0.0333
  vs 0.0349 for a no-information guess.
- **First touchdown of the game.** Each player's share of the game's total expected TDs (including an
  unlisted-scorer constant for QB runs, D/ST, etc. — 0.4, best fit 2016-25), times the chance any TD happens at
  all. Brier 0.0471 vs 0.0486 for a flat guess.
- **Chance any RB / WR / TE on a team scores.** Independent-OR across the top players at that position. Works
  best for WR and TE; weak for RB (barely beats a no-info guess) — shown as extra context, not a primary number.
- **Not added — tested and dropped:** recent goal-line role (redundant once snap share is in), team red-zone
  pass rate, and weather all failed to move the walk-forward Brier score.
- **Not built — parked on request (9/28):** player yardage/reception O/U props. Confirmed Polymarket lists these
  (e.g. receiving yards O/U per player) — same shape as the anytime-TD market, so the approach would carry over,
  but the person asked to hold off on player props specifically.

All of the above validated end-to-end under Railway's exact pinned package versions (pandas 2.2.3, numpy 1.26.4,
scikit-learn 1.5.1, pyarrow 17.0.0) via a separate venv, and the site's rendering was checked with a Node harness
across five scenarios (normal lean, pick'em/no-lean, injury-adjusted, finished game, TD card with new markets).

## Five more gaps, tested and added (9/28) — fair_line.py, app.py, lib/snaps.js, pages/api/rerun.js
Requested review of common gaps other models miss. Tested 9 candidates against 2006-2025 (2016-2025 for the
backup-QB one, limited by play-by-play passer data); 2 were dead ends and are NOT built in:
- **Altitude (Denver home games):** no effect (t=-0.3). Dropped.
- **Referee crews:** the real spread between refs' average game totals (1.40) was SMALLER than what shuffling
  the data randomly produces (1.68 typical, 2.18 at the 95th percentile) — the opposite of a real signal. A
  ref's own history doesn't predict future games either (out-of-sample coefficient ~0). Dropped.

Five held up and are now live, fit jointly (not just one at a time) on the 2006-2025 out-of-sample margin
residual — combined they cut margin MAE from 10.682 to 10.601-10.603:
- **Divisional games:** -1.0 pt margin, -1.9 pt total (t=-2.3 / -4.3). Division rivals play tighter, lower-scoring games.
- **Surface:** +0.9 pt on the total when the home team's current-season field is turf (t=1.8-1.9, the weakest
  of the five but still net-positive combined with the rest).
- **OL/pass-rush mismatch:** each side's season-to-date sack rate allowed (offense) and forced (defense), shrunk
  toward a ~6.5% league-average prior with a 4-game/244-dropback weight. Net mismatch moves the margin by about
  -28.7 pts per 1.0 (t=-2.8) -- in practice mismatches run a few points, not a full 1.0, so real-game shifts are
  usually under a point. **Caught and fixed a real bug here first:** the initial shrinkage formula added the
  prior as `4 * league_rate` instead of `4 * games_worth_of_dropbacks * league_rate`, which pulled every team's
  computed sack rate down toward near-zero early in a season (e.g. 2.2% instead of the correct ~6.5% through
  Week 3). Recomputing the mismatch feature correctly barely changed the finding (t=-2.8 either way, coefficient
  -27.9 buggy vs -28.7 corrected) since the bias mostly cancels in the difference-of-differences -- but the
  live model uses the corrected version.
- **Bye + long trip:** a road team on 13+ days' rest traveling 1,500+ miles: -1.8 pts per 1,000 miles (t=-2.9).
  Thin sample (85 games, 2006-2025) — flagged as a lean, not a strong claim.
- **Backup QB's first start with a team, this season:** by far the biggest of the five. A HOME team's backup
  making his first start: -7.6 pts to the home margin (t=-6.0). An AWAY team's backup making his first start:
  +5.7 pts to the home margin (t=4.4). Detected client-side (`lib/snaps.js: qbFirstStart()`) from official snap
  counts — the team's regular starter is out/doubtful (or already replaced) and the presumed replacement has no
  prior week this season with a 50%+ offensive snap share. Sent to the model service as
  `homeQbFirstStart` / `awayQbFirstStart` booleans, applied as a symmetric margin shift the same way as the
  other four (half onto each team's own score, so the total is unchanged).

**Tested, real, but NOT built in (needs a decision):**
- **NGS separation / cushion / YAC-over-expected** (receivers only, from Next Gen Stats): cut the TD model's
  Brier score from 0.1569 to 0.1541 on 2020-2025 -- a real gain. Held back because coverage only starts in 2018
  and only covers about 27% of receiver-player-games even then (a lot of missing-data fallback), so it would
  make the TD model's accuracy depend partly on data availability rather than a clean signal. Worth adding if a
  fallback strategy is agreed on first.

All five live fixes were end-to-end tested under Railway's exact pinned package versions (same venv as the
first four fixes), and the JS `qbFirstStart()` logic was unit-tested against synthetic snap-count scenarios
(second start correctly returns null, true first start returns the player's name, healthy starter returns null).

## Accuracy audit (9/28) — found and fixed one real double-counting bug
Went back through every formula and sign convention line by line before calling this done. Found:

- **Confirmed correct, no bug:** the market spread sign convention (positive = home favored) is consistent
  across the historical training data, the live site, and every calibrated formula (`cal_win`, `cal_cover`,
  `cal_under`, `spreadPick`). The OL/pass-rush mismatch formula in the live code matches the tested formula
  exactly, term for term. `team_points()`'s over/under-a-line math is exact (empirical residual quantiles > a
  threshold), not an approximation. The calibrated cover/under numbers (`calHomeCover`, `calUnder`) are computed
  but never referenced by the site's own pick/tier logic, so they can't leak in and skew what's displayed.
- **Found a real double-counting bug:** the backup-QB-first-start effect (from the "5 more gaps" pass) and the
  existing injury adjustment's QB1-out penalty (`injury_adj.py`, -3.96 pts) can both fire on the same game --
  about 44% of a team's first-time backup starts also have that week's official report listing the original
  starter Out/Doubtful/Questionable, which is exactly what triggers the injury adjustment. Tested both together
  in one regression: each stays statistically significant on its own, but each coefficient shrinks once you
  control for the other (home first-start: -7.69 alone -> -6.29 controlled; away first-start: +5.71 alone ->
  +4.46 controlled). Applying both effects at their full solo-fit size would have double-counted the same
  signal on roughly half of first-start games. **Fixed:** `HOME_QB_FIRST_START` / `AWAY_QB_FIRST_START` now use
  the controlled values (-6.29 / +4.46), verified end-to-end after the change.
- **Lower-confidence, not fully tested:** the OL/pass-rush mismatch (a season-to-date rolling team stat) could
  overlap a little with the injury adjustment's OL-starter-out penalty in a given week, but it's a much looser
  connection than the QB case (a rolling season average vs. a single week's injury status), so it wasn't tested
  further. Worth a look if the OL/pass-rush effect ever looks like it's firing stronger than expected alongside
  an OL injury.

## Second audit pass (9/28) — found and fixed a live-calibration drift bug
- **Found and fixed:** the site's live self-calibration (`lib/calibration.js`, corrects a player's TD% once
  20+ graded results exist in that probability band) updated `r.fair` but left `r.two` (2+ TDs) and `r.first`
  (first TD of the game) computed from the STALE pre-calibration number -- they'd have silently drifted out of
  sync with the displayed fair% once calibration kicked in. Fixed by adding `twoPlus()` and `firstTdShares()` to
  `calibration.js` (JS mirrors of `td_prob.py`'s `two_plus()`/`first_td()`) and recomputing both after
  calibration runs, in `lib/week.js`.
- **Caught a bug in my own fix while building it:** `first_td` is a joint, whole-game computation across every
  listed player on BOTH teams (their combined chances form the shared denominator for "who scores first"). My
  first pass called it separately per team, which dropped the other team's players from the denominator and
  inflated every player's share roughly 3x. Fixed to run once, jointly, across both teams' rows -- then verified
  the JS version produces numbers that match the Python original exactly, digit for digit, on real data.
- **Re-confirmed correct:** market-spread sign convention, the OL/pass-rush mismatch formula, team-points math,
  and that `SD_TOTAL` (now 13.3) has no leftover hardcoded old value anywhere in the codebase.

## Ideas from other public NFL models (researched 9/28) — all three tested, outcome
- **Special teams value** (FPI/DVOA): tested and BUILT, see "Built (9/28)" below.
- **Situational success rate** (DVOA's core idea): tested and BUILT, strongest finding of the project.
- **QB skill differential** instead of a flat backup-first-start penalty: tested and REJECTED. Out-of-sample
  (2016-25) the flat penalty scored 10.631 margin MAE, the EPA-gap version 10.674 (worse). Flat penalty stays.
- Market-spread-as-input for win chance (nflfastR's approach) already matches what `cal_win()` does.

## Third audit pass (9/28) — found and fixed a real calibration-wiring bug, this one live on the site
Ran a full audit at Mark's request: syntax check on every file, imports verified under Railway's exact pinned
package versions, and a check that every probability the site shows is actually using the calibrated math.
Found two places where it wasn't -- one CLI-only, one live on the site.

- **`fair_line.py`'s own CLI (`main()`) never got switched to the calibrated functions.** `app.py` (the live
  site) correctly calls `cal_win`/`cal_cover`/`cal_under`, but the standalone command -- the one this README's
  own "Weekly run" section tells you to run for the pre-kickoff Line Room log -- was still printing the old
  pre-calibration normal-CDF numbers. On a real ATL@GB check this was off by 14.9 points on win% and made a
  cover that's actually a coin flip look like 38.5%/61.5%. Fixed: the CLI now calls the same calibrated
  functions `app.py` uses, and labels model-only output as such when no market spread is given.
- **`lib/picks.js` -- the site's actual Sides pick engine (`spreadPick`/`totalPick`, what drives the Weak/
  Moderate/Strong tiers) -- was never wired to the calibrated numbers either, even though `app.py` was already
  computing and storing them (`calHomeCover`/`calUnder`) right next to the fields `picks.js` was using instead.
  It was recomputing its own raw model-vs-market-gap probability from scratch -- the exact input that testing
  already confirmed carries no real signal for covers/unders. Confirmed live via the render harness: this
  showed "ATL +5.5 -- Strong -- 60.9%" on a spread where the calibrated chance is ~50.5%. Same bug in
  `gameBets()`'s fallback fair-probability (used for spread/total Polymarket bets when no sportsbook reference
  exists) -- that number fed directly into EV and Kelly stake size.
  Fixed: both now read `m.calHomeCover`/`m.calUnder` directly. Practical effect: spread and total picks will
  now show "no lean" almost all the time -- that's correct, not a regression, and matches what the backtesting
  already established. Moneyline is unaffected and unchanged: `m.homeWinPct` was already calibrated correctly
  and does carry real signal from the market spread.
- Verified with real execution (not just inspection): ran the fixed functions directly against the ATL@GB
  numbers, confirmed correct output and correct spread-sign labels (`ATL +5.5` / `GB -5.5`), re-ran the full
  render harness end to end and confirmed the card now shows "No lean" instead of the fake "Strong."

## Built (9/28): special teams, success rate, replaced OL-mismatch and farbye
The confirmed-but-unbuilt backlog from the "5 more gaps round 2/3" testing -- built now, all four together:

- **Special teams EPA differential** (FG/punt/kickoff, season-to-date): +3.77 margin per 1.0 EPA/play edge (t=3.42
  in the final joint fit). New `special_teams_epa()`.
- **Success rate edge** (down/distance/field-position-adjusted efficiency, on top of the plain-EPA power ratings,
  season-to-date): +14.99 margin per 1.0 edge (t=6.23) -- the strongest finding of the whole project. New
  `success_rate()`.
- **Removed the OL/pass-rush-mismatch term** (`sack_rates()`, deleted). Once success rate is in the model this term
  is statistically dead (t=-2.8 -> -0.14) -- success rate already captures it. Costs nothing on accuracy.
- **Replaced farbye with a plain away-team-off-bye flag.** The old bye+1,500mi-travel interaction and a plain bye
  flag measure the same thing (they lose significance combined); the plain flag has far more supporting games
  (324 vs 85) for a similar accuracy gain. `travel_miles()`/`STADIUM_COORDS` are no longer used by the model
  (kept in the file, unreferenced); `app.py`'s diagnostic field renamed `farTravelBye` -> `awayBye` to match, and
  the site's reason text updated the same way.
- Divisional coefficient refit alongside the new terms for internal consistency: -1.0 -> -0.905 margin (still
  -1.9 total, untouched).
- **`backtest()` had a real gap, found while validating this:** it never populated `st_epa`/`success_rate` on the
  model dict, so running `--backtest` after this change would have silently NOT tested the new terms at all --
  same pre-existing gap already applied to rest-day/backup-QB, which also aren't exercised by this quick backtest.
  Fixed for the two new terms (season-to-date-only pbp per backtest week, no look-ahead); rest-day/backup-QB
  still aren't covered here since `team_games()` doesn't carry rest-day data -- noted in the backtest's own output
  now instead of silently missing.
- Joint out-of-sample validation (2006-2025, leave-one-season-out): margin MAE 10.682 -> 10.616 from these four
  terms alone (backup-QB-first-start, already live, is fit and applied separately on top).
- Playoff elimination: see the next section (built later the same day, away-team side only).

## NGS test redone, all rejected ideas re-tested together, elimination + turnovers built (9/28)

**NGS receiver tracking data -- NOT built. The earlier "gain" was look-ahead leakage.**
The first test merged each player's NGS row from the SAME week being predicted. NGS only lists a receiver in weeks he
clears a target threshold, so that merge secretly told the model the player got targets in the game it was predicting.
Rebuilt with strictly prior-week NGS data (the only thing the live site would ever have): no gain at all.
Brier 2025: 0.1571 without NGS vs 0.1575 with it; 2024: 0.1569 vs 0.1568. The prior session's NGS result had the same
same-week merge. td_prob.py left unchanged (17 features). Re-checked every live feature for the same mistake: special
teams, success rate, turnovers and records all use completed games before the week being predicted only.

**Every previously rejected idea, re-tested together** (20 seasons, leave-one-season-out, on top of the live model:
divisional, bye, special teams, success rate, backup QB):
- All 11 rejected margin ideas added at once: 10.567 -> 10.570 (worse). Rejected totals ideas together: 10.739 -> 10.756 (worse).
- Added one at a time, only two helped: away team eliminated (-0.011, t=3.3) and turnover margin (-0.004, t=2.6).
  Home eliminated, injury burden, OL mismatch, bye+travel, altitude, jet lag (both versions), West Coast early
  kickoff and cold all zero or worse -- rejections confirmed.
- Every live feature stays significant with all of them in the fit.

**Built: away-team-eliminated + turnover-margin edge** (`away_eliminated()`, `records()`, `turnover_margin()` in fair_line.py).
- Together: margin MAE 10.567 -> 10.553 out-of-sample, better in 13/20 seasons.
- End-to-end backtest of the built code 2021-25: pooled 10.180 -> 10.159, better in 3/5 seasons (market: 9.720).
- Correction to an earlier note: elimination does NOT need a standings/tiebreaker tracker. The tested proxy is week 13+,
  10+ games played, under .250 -- just wins and games played. The site now sends the week (rerun.js -> app.py -> predict()).
- Verified: turnover_margin matches an independent calculation exactly; records spot-checked against real 2023 results.
- app.py diagnostic `fix.awayElim`; card reason text added.
- Also fixed a stale comment in rerun.js that still quoted the old backup-QB numbers (-7.58/+5.72 -> the live -6.29/+4.46).

## Cleanup + TD-vs-market grading (9/28, final pass before upload)
- Removed dead code: `travel_miles()` / `STADIUM_COORDS` (fair_line.py; unused since farbye was replaced by the plain
  away-bye flag) and the raw, uncalibrated `homeCoversMktSpread` / `underMktTotal` outputs (app.py; nothing read them,
  and they were the exact numbers proven to carry no signal).
- lib/mybets.js: My Bets "model chance" for spread/total legs still used the raw model gap. Now starts from the
  calibrated cover/under chance at the market line and shifts it to the leg's own line (rerun.js stores the market
  lines as `mktHomeSpread` / `mktTotal`). Checked: returns exactly the calibrated number at the market line, and moves
  the right way off it (GB -3.5 55.6%, -5.5 49.5%, -7.5 43.4%). Weeks without the new fields fall back to the old math.
- Record tab: "Season record by lean strength" became one bucket once picks were calibrated (~50%), so it now shows a
  plain Spreads / Totals record. Unused TIER table removed from public/app.js.
- NEW — TD model vs Polymarket (Record tab): grading now saves each graded player's CLOSING Polymarket TD price
  (last pre-kickoff snapshot) next to the model's chance and whether he scored. The Record tab shows model vs market
  accuracy (Brier, lower wins; market = middle of bid/ask) and what $1 on every "model > price" player would have
  returned. Already-graded games get prices added once without re-grading anything else (Week 3 prices are still in
  the database, so Week 3 fills in on the first snapshot after upload). No historical TD prop prices exist in any free
  source, so this forward record is the only real test; treat it as noise under ~200 priced players.
- Verified: every .py compiles under the Railway-pinned versions; CLI output calibrated; /rerun-game-lines and
  /rerun-td-probs return 200; every .js passes node --check; full `next build` of the repo plus this package succeeds;
  all three render harnesses pass (Record tab numbers checked by hand).

## Full audit, round 2 (9/28 evening, after the first upload went live)
Found from the live site and the Week 3 export (nfl-bettors-results.json). Site files unless marked [Railway].
- TD self-correction (lib/calibration.js): one noisy week could cut a 35-45% player by 30% and made numbers jump at
  bucket edges. Now shrunk toward "no change" (150 imaginary players) and interpolated. Old tables ignored until rebuilt.
- Thin markets (lib/odds.js isThinMarket, used everywhere): a market only counts if someone bids within 5¢ of the ask
  (40% of it for long shots). Week 3: 175 of 258 priced players were thin; they faked a +83% "model beats Polymarket".
  Real markets: model 0.194 vs Polymarket 0.200 Brier, $1 Yes bets 3 of 8, +$0.62. Thin markets: no CLV, no money bet,
  "thin market" tag on the TD tab. Record tab also tracks the No side and scored-vs-priced.
- CLV: TD legs matched on first + last name (was last word only, so "Jr." matched anyone); thin closing prices skipped.
- TD price guard (snapshot.js): one-team drops = real news (accepted); both-team drops rejected up to 3 checks, then
  accepted; logs actual prices. Before, a rejection was permanent (PHI @ CHI frozen from Sunday).
- Bet sizing (lib/week.js): weekly $200 cap now counts down across bets (each bet was capped separately); same-team
  dedupe only among bettable bets; correlation rule covers any player TD + his team's side (protocol 2.6).
- Removed: Blend (logged), dead "edge after fees" code (EV never included fees).
- TD calibration verdicts: "too high/low" only beyond 2 standard errors ("within normal luck" otherwise).
- [Railway] TD scorers: credited to the player who actually scored (td_player_name; lateral case Evans→Samuel) and
  special-teams return TDs count (Polymarket anytime rules; defensive TDs don't). Week 3 anytime: 58.3 expected, 58 actual.
- [Railway] td_prob.py drops players on IR/PUP, exempt list, released, retired or now on another team (latest weekly
  roster). Week 3 had 9 such players graded, incl. A.J. Brown 26.5% and J.Mason 28.6%. Snap-share join gets a
  same-team + last-name fallback (Kenny/Kenneth Gainwell).
- Injury reports: every decision uses only that week's report (Tue-Wed used last week's Out list for the new week).
- QB/role logic (lib/snaps.js): names compared without suffixes/punctuation (Penix Jr., D.J. Moore). 64 of 1,468
  injured players in 2025 never matched before.
- Neutral sites (lib/wind.js, games.js): schedule's location field + all 8 2026 venues. Before, only Brazil was
  known, so London (Wk 4 IND @ WAS), Paris, Madrid, Munich, Mexico City got a 2.2-pt home edge and the home city's wind.
- Turf from the schedule's surface field (latest played game wins); LAC was missing from the hand list.
- Game Lines cards now show the calibrated win chance, labeled "market-based". Checked 9/28 (4,234 games, 2006-25):
  its accuracy is the MARKET spread's; adding the model's gap improves Brier only 0.20834 -> 0.20825, and the gap's
  weight is NEGATIVE (95% range -0.062..-0.002): when the model likes a team more than the market, that team wins
  slightly less often. So the win chance can point opposite to "Model sees X by N" -- that is the data, not a bug.
  Earlier notes calling win % "the one model number with real signal" overstated it: the signal is the market's.
- [Railway] Weekly TD retrain: holdout weeks are now excluded from training (the test was rigged: 0.1394 vs honest
  0.1403 on 2025, 9x the switch threshold).
- [Railway] Reruns added Tue 7:30 (after retrain), Thu 7:05, Sat 7:05 (after practice/final injury reports).
- currentWeek: a game with no score 2+ days after kickoff no longer freezes the site on that week.
- Backup: paged (~2 MB per request) and pipelined; the single reply likely exceeded Vercel's 4.5 MB response limit.
  Still needs a Railway volume at /data for backups AND the retrained TD model to survive redeploys.
- Miss finder: "high-confidence TD misses" now compares misses to what the model itself expected (Week 3: 12 of 22
  missed vs ~12.6 expected, i.e. normal, so no longer flagged); QB-change pattern needs 3+ games and shows the count.
- Status panel: database cap shown as 256 MB (Upstash free tier), not 30 MB. The real limit to watch is 500K
  commands/month (Upstash dashboard → Usage).
- [Railway] Success-rate term sign fix (fair_line.py): the edge added each defense's "success rate allowed" with the
  wrong sign (a home defense allowing MORE success raised the home edge). Tested 2006-25, 4,243 games: offense-only
  edge wins out-of-sample (joint MAE 10.620 -> 10.606, 12 of 20 seasons); refit ST 4.212, SR 30.394, bye -2.189. On the
  real-code 2021-25 backtest it is neutral (10.159 -> 10.158, 2 of 5 seasons) -- kept because the old form was wrong
  in direction and the 20-season test favors the fix.
- Game Lines / Totals cards: a calibrated cover/Under within 2.5 pts of 50% now reads "No lean · about 50/50" with the
  small tilt shown underneath (protocol 3.3). Before, the >50% side printed as a pick even when it pointed opposite to
  "Model sees ..." (the calibration slightly fades the model's own gap).
- fair_line.py CLI: new --neutral flag (London etc.).
- Record tab "Top TD picks": #1 and Top 2 per team scored vs what the model expected (Week 3: 11 of 30 vs 12.9;
  18 of 60 vs 22.3), plus 2+ TDs (9 vs 9.9) and first TD of the game (15 vs 13.6). [Railway] /td-scorers now also
  returns TD counts per player and the game's first TD scorer (null if the first TD was defensive).
- Record labels: spread/total record shown as "tilts (~50/50)", moneyline as "market-based".
- td_matchup.py drops IR / exempt / released / retired players too (same rule as td_prob.py).
- TD rows: "⚠ left last game early? (usually N%) — check injury news" when a regular (50%+ snaps) played under half
  his usual share last game. Official injury status doesn't exist until Wednesday; after Week 3 this flags Achane
  (5% vs 81%), Justin Jefferson (12% vs 96%), Jalen Coker and Terrance Ferguson. Flag only; the % is unchanged.

## Round 3 (9/28 late): TD research flags + 15 faults
- TD model: 3 research flags (depth-chart starter, red-zone role shift, new team) + trained on 3 seasons. Held-out
  Brier vs old: 2023->24 -0.00011, 2024->25 -0.00031, 2022-23->24 -0.00016, 2023-24->25 -0.00041 (better in all 4).
  Depth charts: old weekly format (<=2024) depth_team==1; new dated format (2025+) = first in any offensive slot in the
  team's last snapshot before the game. FEATS grew 17 -> 21, so a saved model is ignored and refit on first start.
- [Railway] td_prob.refresh_live(): this season's data reloads on every TD rerun (max every 30 min) and before the
  retrain. Before, it loaded once per server start and every rerun reused it for days.
- [Railway] scheduler._retrain (the one that runs Tuesdays) had its own copy of the retrain: now fresh data, 3 seasons,
  hold-out weeks excluded from training -- same rules as /retrain-td.
- Grading waits for play-by-play (MNF/late games were saved without TD results and never revisited).
- Doubtful = out for TD (rows removed, red-zone share goes to teammates).
- TD rows: "didn't play last game (last played week N)"; "left last game early? (usually N%)".
- [Railway] /td-scorers returns scorer teams; TD credit and 2+ counts check the team.
- My Bets uses the calibrated TD % the tab showed.
- [Railway] Sportsbook pulls 16/week (was every snapshot, ~405 of 500 credits/month); scheduled snapshots retry
  twice, not three times (retries duplicated snapshots).
- Status turns yellow only for problems in the last 24 h. New Watchdog (Record tab) lists missing/stale data.
- TD cards list Polymarket TD players the model doesn't cover (QBs, returners, exempt/IR players still priced).
- News dropdown: ESPN headlines (last 4 days, both teams), tier 4, verify-only, never changes a number.
- td_matchup.py (local research tool, not used on Railway) needs `pip install tabulate` to print its tables.
- Round 4 math fixes: first-TD % pool (tab and grading) = model's top 14 per team, not just shown/graded rows;
  "any RB/WR/TE scores" recomputed from calibrated numbers; TD EV / price label / stake / rank re-run after
  calibration; spread/total calibrated % and win % shifted to the CURRENT (or closing) line instead of the last
  rerun's line; fair_line.py CLI adds the dome bonus only with --dome.
- Calibration re-checked on the new 21-feature TD model (held-out 2024+2025, 9,036 player-games): the existing
  shrink (above 35%: 0.35 + 0.75x) still beats refits out-of-sample (2025: 0.15681 vs 0.15699). 20-40% players score
  2-3 pts more than predicted -- the live weekly self-correction absorbs that. No change.

## 9/29: automation + monitoring
- Last automatic run (auto:last, set by scheduled snapshots/reruns) on System status; Watchdog warns if none in 9 h.
  Cause found 9/29: every scheduler call got 401 (SITE_LOGIN vs SITE_USERNAME/SITE_PASSWORD). Both sides now trim.
- Self-check /api/selfcheck (Thu 12:05 PM, Fri 5:05 PM, Sun 7:35 AM PT): same Watchdog (lib/watchdog.js, one copy),
  saved to selfcheck:last and logged to System status.
- Automatic pre-log at kickoff: prelog:{season}:{week}:{game} = model numbers, closing lines, top 8 TD chances vs price.
- Tuesday recap on Record: finished week's TD scored vs expected, TD vs Polymarket (real markets), your bets.
- TD model CLV: opening price (first TD price-history entry) vs closing mid for players the model had above the open.
- Price-move alerts: 5¢+ over ~24 h on real markets (row badge + "Price moves" box on the TD tab).
- [Railway] Depth-chart change flags: latest chart vs the one before each team's last game ("moved up to starter" /
  "dropped from starter"), display only. Sportsbook failures logged; manual refresh pulls books if missing/6 h old.
- Gap fixes (9/30): Questionable players' TD rows remind you to check the inactive list ~90 min before kickoff (the
  injury feed has no inactives; inactive = TD market settles No). The late-closing safety net also writes the
  pre-log, so a missed kickoff snapshot still gets one. TD price history reads only the first entry + last 40
  (was the whole week, ~1 MB per page load).
- ESPN game-day status (lib/espn.js, 9/30): ESPN's league injury feed keeps updating through game day. Players ESPN
  lists Out/Doubtful/Suspended (dated within 8 days) come off the TD list ("Removed — ESPN lists them out"), are passed
  as outs to the TD rerun (teammates get the red-zone share) and to the game-line injury adjustment. Other ESPN
  statuses show on the row. Feed down/unreadable -> Watchdog. Tier 4 source; parser tested on the documented shape,
  live feed not reachable from the build environment.
