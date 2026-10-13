# NFL betting app — notes for Claude

Read this first in every new chat. It carries the owner's rules and what has already been tried.

## Owner's rules (always follow)

1. **Answer every question first, all of them, before anything else.**
2. **Never build, test, push, merge or delete anything until the owner says "build now"** (picking an option Claude offered also counts). Explaining is fine; acting is not. Don't undo or redo changes on your own either.
3. Short, plain answers. No jargon.
4. Don't add things the owner didn't ask for, and put things exactly where told.
5. Judge bets by **win rate**, never by price/value.
6. Trust small samples. No "luck" filter.
7. "Tests pass" only means the code runs — never say it as if the predictions are right. Give accuracy numbers instead.
8. Be upfront about gaps: say what a model can't see.
9. Phone alerts / login: don't build or ask unless the owner raises it.
10. The owner handles Railway settings. Never paste secrets (an Odds API key was once shared in a screenshot — don't repeat it).

## What the app shows (owner's layout rules)

- Tab bar (10/13): at the bottom, icon over each name, plus the Alerts bell; same rose color as the Lines / Model buttons (NOT green).
- Model card: ONE answer — the model's number (purple), then **PICK** — green at 56%+ (with its short reason, e.g. LINE MOVE), yellow
  below it with NO notes (owner 10/13: "too many notes"). Always a PICK, never LEAN. No teasers on cards; market lines only.
- Teasers: CUT from Game Lines 10/13 (owner never bets them). The code stays; teaser legs are still recorded and graded.
- Best bets = top 10 straight picks at 56%+. Parlay of the week = top 4, one per game.
- Model Picks tab (10/13: the angle / teaser / price-gap / spread-total-side parlays are hidden: angles_2/3, angles_fav_3, alt_2, alt_pick_3, right_now_3, same_game_3, linked_sgp_3): ~22 parlay types built once a week (first scheduled snapshot within 26 h of the first Sunday kickoff — Sat 7 AM PT
  when the first game is London) and graded. Includes "Best bets · 2/3/4" (= the Parlay of the week). Alt-line parlays are labeled
  TEASER. TD parlays may use thin markets (leg says "thin"); the price shown is the ask.
- Bets tab: an open leg says "⚠ app now picks the other side" when the app has a 56%+ pick against it.
- Early-week total edge: TURNED OFF on cards 10/11 (11-18 live); recording CUT 10/13 (old rows still grade).
- Anytime TD tab: top 3 per team (owner wants it kept), plus a "⚠ Market disagrees" box for any player 20+ points from Polymarket.
- Referees and price-gap alerts were removed on purpose. Models tab is 8 sections (10/13: "Price gaps" cut, "Records · model's side" cut, "Tracked angles" is only the wind Under paper row). Also cut 10/13: "Hit rate by week" (Trends), the Replay box, the Pick Lab paper singles (old game model's side; `recordPicks` no longer runs), bell alerts for MODEL / PRICE GAP / TEASER, and the edge tracker (`logEdges` no longer runs; the code stays). The Action Network pull was cut 10/13 (`lib/splits.js` and `/api/splitshist` stay for reference).

## Where things live

- Site (Next.js on Vercel, nfl-nfl9.vercel.app): `pages/api/*`, `lib/*`, front end `public/app.js`.
  - Combo picks: `lib/stack.js`, `lib/combotable.js`; game model: `lib/upgrade.js`; teasers: `lib/teaser.js`; week data: `lib/week.js`.
  - Model rerun (sends Out/Questionable lists to Railway): `pages/api/rerun.js`.
  - Bets tab / Polymarket sync: `lib/mybets.js`, `pages/api/mybets.js`.
- Model service (Python on Railway): `railway-model-service/`.
  - TD model: `td_prob.py`. Weekly rebuild (Tue 4 AM PT, publishes only if checks pass): `weekly_rebuild.py`, `scheduler.py`.
- Tests: `npm test` (site checks, grading audit, service checks).
- Weekly Tuesday check-in routine exists (9:52 AM PT) to confirm the rebuild and report records.

## How models are tested

Train on earlier seasons, predict the next one (2019–25 for the TD model). A change is kept only if it's more accurate in most seasons. Combo picks: kept when every period (2014–17 / 2018–21 / 2022–now) beats the base rate.

## Combo picks — starters out (added Oct 10, 2026)

- Factors: dog/fav starting QB out, a skill starter out, 2+ OL / DB / front-seven starters out (official Out/Doubtful +
  60%+ snap share; `lib/snaps.js startersOut`, `weekly_rebuild.py starters_out`). STRAIGHT BETS ONLY — owner never bets teasers;
  the rebuild skips teaser bet types for these factors. Their scanned rates (~65%) were measured on the games they were found in, so
  they are NOT win rates; since 10/12 these factors are only inputs to the chooser (see "How picks are chosen").

## How picks are chosen (Oct 12, 2026 — owner chose "A + B")

- The scanned single patterns ("combos") were OVERFIT: judged on the same games they were found in they won 60.7%; on unseen
  games (each season's patterns found without it, 2014-26) only 49.8%. Week 5, the first true live test, went 15-21.
  The earlier "77-41" included weeks 3-4 REPLAYED with patterns built from those same games — not a real test.
- Cards now use the combined chooser (`lib/chooser.js`): one logistic model per market over all 109 factors, with the % shown
  made HONEST by a calibration fit on unseen games. Unseen-game results: spreads 51.2% (its confidence doesn't separate
  winners), totals 52.0% (54.9% on its 195 most confident). So most cards show LEAN ~51-54%; PICK (56%+) is rare or absent.
- The weekly rebuild refits it (`weekly_rebuild.py train_chooser`) and publishes `chooser`; `lib/combomodel.js` loads it.
- Dropped as picks (rates never checked on unseen games): scanned teaser combos, the 3 "keeper" angles, angles in general,
  the "total fell" rule. Teasers left: dog +6 ladder and total ±6 (simple base rates: 67% 2007-25, 28-13 live).
- The game model alone has no edge on the line (50.6% / 51.7% on 2,531 games). Never present its side as a pick.
- Its number (even the upgraded one) is LESS accurate than the line: margin off 9.99 vs 9.89, total 10.52 vs 10.47, better in only
  3 of 13 seasons (2014-26, each season unseen). (Owner removed the card note saying so, 10/13.)
- RULE FOR ANY NEW PICK SOURCE: test it on games it has never seen (leave one season out) before showing any win rate.
  A rate measured on the games a pattern was found in is not a win rate.

## LINE MOVE (Oct 12, 2026) — the one spread edge found

- Rule (nothing fitted): when sportsbooks moved the spread and Polymarket still has the old number, take the side the books moved
  toward at Polymarket's number (`lib/stack.js lineMovePick`). History 2014-26, graded at the opening number, each game once:
  crossed 3 or 7 AND moved 1+ point 63.2% (495 games, 13/13 seasons); no crossing, moved 3+ 58.5% (205, 10/13). Those two only.
  NOT picks: no crossing 1-1.4 48.2%, 1.5-1.9 57.4% (not steady), 2-2.9 49.8%; half-point crossings 53.7%.
- Corrected 10/12: the first version fired on any 1+ move (48-52% without a crossing) and on half-point crossings. Polymarket only
  lists half-point spreads, so books 7 vs Polymarket 6.5 is rounding, not a move (CIN @ MIA week 5 would have been a fake signal).
- Live caveat: history uses where the line CLOSED; a midweek book move can still go back.
- Shown as a PICK on the spread card when it applies; recorded and graded with the other picks. Needs fresh books (3 h game day /
  8 h before) and fresh Polymarket (3 h) on the page.
- Tested and NOT edges on spreads (unseen games): game model vs opening line 51.5%, chooser vs opening line 50.2%, home dogs,
  road dogs, big dogs, +3/+3.5 dogs, division dogs, home dogs +3 or less (48-51.5%).
- Picks are recorded at the same line the card shows (Polymarket first). Before 10/12 the recorder used the books' line first.

## LINE MOVE on totals + edge hunt (Oct 13, 2026)

- Added (`lib/stack.js lineMoveTotalPick`, nothing fitted): books' total 3+ off Polymarket's -> books' direction at Polymarket's
  number. History 2014-26 at the opening total: moved 3+ 67.0% (376, 12/13 seasons); Action Network opener vs close 2023-25: 66.1%
  (322). NOT picks: 2-2.9 56.1% (AN 2025 48%), 1-1.9 51-53%.
- BIG CAVEAT: in 2026 weeks 3-5 Polymarket's total was never more than 1 point off the books (597 readings), and its spread never more
  than 1.5. Polymarket follows the books, so both LINE MOVE rules rarely fire. The history edge is "bet the opener before the move";
  the open problem is predicting the move early. Pinnacle (moves first) is being saved for exactly that test.
- Early-week wind Under (paper, 10/13): first time the kickoff forecast says wind 10+ (outdoor) while Polymarket's total is still at
  its first number, Under at that number is saved once and graded (teaser hash `|windU`; Models -> tracked row). History at the opening
  total 60.5% (2014-26) but 2024 51% / 2025 52%, so live test first. Clean re-test 10/13: a cut-down chooser betting the opening total
  hit 58% on its top 25%, but it was mostly this wind signal.
- Tested, not added: model vs OPEN total 51-54% (56.2% only at 5+ apart, 8/13 seasons); wind 10+ Under at close 58.7% but 2024 42%,
  2025 48% (market caught up; also uses game-time wind, not the forecast); open total 50+ Under 54.7%; open total <=38 Over 53.5%.

## KEY NUMBER (Oct 13, 2026 -- Claude's idea, owner: "build now")

- `lib/stack.js keyNumberPick`: books' spread exactly 3 -> underdog +3.5 on Polymarket (main line or alternate). Nothing fitted.
  Regular season 2006-25, closing line exactly 3 (793 games): dog +3.5 won 58.1% (61/56/56% by period); fav -2.5 50.9%.
  The +3.5 usually costs ~53-55c. Shown as a green PICK, recorded and graded. Books at 10 -> dog +10.5 61% but only 160 games and
  uneven (54/75/59): not added. Books at 7 -> dog +7.5 51%: no.
- Also tested 10/13, not added: half point on totals (finals land on any one total only 2-5%; Under 47.5 at books 47 won 58% on
  205 but that's 1 of 10 numbers tried -- likely chance); moneyline vs spread disagreement 48-51%; unit vs unit matchups = the fixed
  stat features below (no gain vs the spread).
- Also tested 10/13, not added: a second model that learns when the chooser is wrong and switches sides (spreads 51.1% -> 49.0%,
  totals 52.6% -> 48.9% on unseen seasons); boosted-tree chooser (spreads 52%, totals 52-54%).

## Matchup-pairing bug (fixed Oct 13, 2026)

- `extra_factors.py _row`: the 14 spread stat features paired each offense with its OWN defense ((home off + home def) - (away off +
  away def), D = what a defense allows), so a bad defense counted FOR its team. Fixed to offense vs the OPPONENT's defense. Stats-only
  margin fit 2014-25: correlation with the real margin 0.14 -> 0.35, error 11.08 -> 10.46. Totals features were unaffected (sum of all
  four). Caches renamed (`xf_models2_`, `stats2_`) so everything rebuilds. Against the spread it adds nothing (the line already knows):
  chooser on unseen seasons spreads 51.2% -> 49.7%, totals 52.0% -> 50.8% -- both inside coin-flip noise. Kept because it is correct.
- Checked 10/13 and found consistent: the site sends the line to the model with the right sign; the site's chooser inputs (upgraded
  model leans, line move, stats leans) match how the rebuild trains them; books' consensus line is the most common number (not an average).

## Full check (Oct 13, 2026 night) -- nothing cut, nothing new passed

- Removing signal groups from the chooser (weather, calendar, line shape, model leans, stats leans, line moves, last game,
  coach/age/QB, travel/rest, injuries, schedule spots), fair test (groups chosen without the test season): spreads 49.2% vs 49.7%
  with all; totals 50.5% vs 50.8%. The "best" groups to drop changed every season -- no group is reliably bad. Kept all.
- Loss review weeks 3-5 (card picks 21-17 spreads, 25-19 totals): every loss was an old scanned combo (retired 10/12). KEY NUMBER
  would have flipped ~3 (CAR @ CLE, NYG @ WAS, BAL @ ATL).
- Teasers still hold: dog +1.5-2.5 teased +6 75.7% (74/75/77 by period); totals +-6 67% every period.
- TD model calibrated this season (787 players): said 14% -> 16% scored, 24% -> 28%, 35% -> 36%.
- Research: most studies find the NFL spread market efficient; post-bye road teams 53.6% overall but 47% 2020-25; half point on 3
  confirmed as the most valuable half point (9-15% of games land on 3; we measured 9.1%).

## INJURY pick + six "make the model more accurate" tests (Oct 13, 2026 night)

- INJURY pick (`lib/stack.js injuryPick`, green, recorded and graded): exactly one team has its starting QB, 2+ DBs or 2+ linemen out
  (official Out/Doubtful + 60%+ snap share) -> take the OTHER team at the current line, only while the line has not moved 1+ point
  toward it since the week's first reading. History 2014-26 at the closing line: not yet moved 57.0% (256 games; 52/62/58 by period);
  already moved 54.2% (not a pick). Graded at the OPENING line all injury games win 60.0% (472, 12/13 seasons) -- the edge is the news
  arriving before the line moves; by Sunday it's 55.8%. Questionable QB 52.6%, limited/DNP practice but not out 48.8%: no edge.
  The nflverse injury file keeps only each player's latest status, so a Wednesday-only practice test isn't possible.
- Tested, no gain (model still LESS accurate than the line): blending the model with the line (best 10% model on the opening line:
  margin error 9.998 vs 10.000; on the close, any model weight is worse); a learned new-QB-game shift (10.138 vs 10.063 line alone;
  the line beats the model in QB-change games 10.06 vs 10.85); rating speed (new-game weight 0.10-0.15 best, 10.454 vs 10.456 now);
  TD prices as a total check (26 games; sum of TD prices tracks the real total 0.36 vs the line's 0.54; disagreements 6-11 wrong);
  model + injuries vs the opening line 53.4% (50.6% without) -- noted, under 56%.
- Sign check: `d.km` / `d.so` are HOME-FAVORED margins (home -3.5 spread = +3.5), so the line's margin is +km, not -km.

## Tests after PR #232 + access check (Oct 13, 2026 night) -- nothing new passed

- Tested on unseen seasons, no pick found: team turnover luck, league scoring trend, week-1 Under, clean backup-QB retest (first week
  with a backup 59.2% at the open but 51.3% at the close; later weeks 52-53% -- an earlier 61.3% claim did NOT replicate, retracted),
  WR / CB starters out, late-season rest, training-window length. TD model vs Polymarket prices: about tied.
- Polymarket price history only goes back to Aug 2026 (preseason + weeks 1-5). NFL.com daily injury feed is not reachable.
- RECORDING (not shown, `pages/api/snapshot.js`): kickoff-hour forecast every snapshot (Redis `fcst:<season>:<week>:<game>`, last 120)
  and starters-out counts whenever they change (`inj:<season>:<week>:<game>`, last 60), each with a time, to test later who knew
  first -- the forecast/news or the line. Past forecasts/news times can't be rebuilt, so this is the only way to get them.
- Access check (about 240 hosts): api.the-odds-api.com reachable but needs a key (not in the sandbox; past odds by timestamp would
  fix the "past hourly lines" gap). Open-Meteo and Kalshi were rate-limited. Pro-Football-Reference, Reddit, many books block us.

## Kaggle free data (Oct 13, 2026 night) -- sandbox can download public Kaggle datasets

- Works: `https://www.kaggle.com/api/v1/datasets/download/<owner>/<name>` (no login) and `/api/v1/datasets/list?search=`.
- Checked: "NFL Timestamped Odds" (oliviersportsdata) = only 18 games, too few. "NFL Injury Reports 2009-2025" = just the nflverse file
  we already use (no posting times). "MGM Grand NFL betting data" (caseydurfee, 1,360 games 2021-26) has REAL bets % and money % per side.
- Tested on it: spreads, money% minus bets% 20+ -> follow money 47.8% (92 games), 10+ 51.2%: no edge. Totals: 20+ more money than bets
  on the Under 61.3% (93) but the Over side only 51.4% (35), seasons swing 45-75%, and it is 1 of 8 cuts tried -- NOT added. No free
  live source for these splits anyway.

- More Kaggle checks (10/13): 538 Elo ratings (published rule, nothing fitted) vs the closing spread: 538's own file 2006-21 gap 3+ pts
  54.4% (1,378 games), 6+ 56.2% -- but rebuilt from nflverse results with 538's formula it is only 52.2% at 3+ (1,706 games, 2022-26
  50.4%, 2025 43%), 52.4% at 6+: NOT an edge (the first number came from a different line file). Elo error 10.75 vs line 10.50.
  Player props file (andyt338, only Sep 18-29 2026, 4 yardage/reception markets): bettors' Over at the opening point wins 43.9%
  (Pass yds 54%, reception yds 44.5%, receptions 40%, rush yds 40%); betting the way the line moved open->close at the opening point
  56.4% on 1,170 props -- only 2 weeks, all games correlated: record only, test again when more weeks exist.

- Poisson scoring model (soccer-style, walk-forward 2014-25, 2,932 games): total error 11.02 vs line 10.48; over/under 49.3%, spreads 49.9%.
  NOT an edge.
- PREDICT THE LINE MOVE (10/13, ridge, each season unseen, bet the OPENING number in the predicted direction, features known at the
  open only: rest, travel, stats, model-vs-open gaps, coaches...): predicted vs actual move correlation spread 0.41, total 0.49.
  Spreads 53-54.6% (878-2,043 games, 10/12 seasons above 50), totals 53-55.2% (697-1,984 games, 9/12). With game-week info (injuries,
  wind) added: spreads up to 55.5% at the strongest cut, totals 55.7% (609 games, 8/12 seasons). Model-vs-open-total gap alone: 3+ off
  53.9%, 4+ 54.1%. Best cuts still under 56% and need the OPENING number early in the week (Polymarket may lag it) -- candidate,
  NOT a pick. Needs the live opening-vs-Polymarket record (Pinnacle + pin30 data) to confirm.

## TOTAL MOVE (Oct 13, 2026 -- owner: "build the ones that work")

- `lib/upgrade.js predictTotalMove` + `lib/stack.js totalMovePick`: a ridge model (early features only: what is known at the open)
  predicts how far the total will move from its OPENING number. While the total is within half a point of its opening number and the
  prediction is strong, take that direction at that number. Unseen seasons 2014-26, bet at the opening total: top 20% 57.4% (507 games,
  11/12 seasons), top 10% 61.9% (252). Refit weekly (`weekly_rebuild.py train_move`, published as `moveT`; dry run passed).
- Shown as a green PICK (hit 57/62 >= 56%), recorded and graded. Same family as the early-week total that went 11-18 live: watch it.
- Same method on spreads: top 10% 55.9%, top 20% 53% -- not added. Also tested 10/13, no edge: Poisson scoring model (49.3% totals),
  538 Elo rebuilt (52.2%), MGM money vs bets splits (spreads 47.8%).

## Recording for future tests (10/12, owner chose A + B) — NOT shown, NOT picks until tested on unseen games

- A: betting splits are NOT available free -- Action Network's public feed leaves every bets % / money % null (PRO only; VSiN's
  splits are paid too). Owner chose to keep pulling that feed for its per-book LINES with posting times (likely includes openers):
  `lib/splits.js`, Redis `splits:<season>:<week>:<game>`. Only a failed pull is logged.
- TESTED 10/12 on 2,127 games 2018-2025 (past splits are free via `/api/splitshist?season=&week=`; graded at the closing consensus line):
  NO splits rule reaches 56%. Spreads: fade the public 49-51%, follow money 50-52%, reverse line move 50.2% (2023-25 only).
  Totals: fade the public 50-51%; follow the money when money% - bets% >= 20: 54.5% (294-245) even with the cutoff picked
  leave-one-season-out, but only 33-31 in 2024-25 and season counts swing wildly (7 to 142 games). Not added as a pick; live
  splits aren't free anyway.
- B: each sportsbook's own spread/total on every books pull (`byBook` in the books data and snapshots), for testing line moves per
  book and by time of week.
- C (10/13): Pinnacle's free guest feed (sharpest book) -- full-game main spread/total saved on every snapshot for every
  not-started game it lists, next week's included (`lib/pinnacle.js`, Redis `pinnacle:<season>:<week>:<game>`; check: `/api/pinnaclecheck`). No history exists, so it needs ~half a season before any test;
  LINE MOVE's 63.2% was measured on the consensus line, not Pinnacle's.
  Also every 30 min (Railway scheduler :10/:40 -> `/api/pinnaclepull`, src "pin30") with Polymarket's main line read at the same moment
  (`poly` in each record), to test "Pinnacle moved first, Polymarket hasn't caught up". A failed pull shows in 8 · System → "Errors (last 2 days)".

## Game model — already tested, not added

- Injured starters as inputs (margin error 10.020 -> 10.024: the line already prices injuries).
- QB quality / backup QB starting (worse in new-QB games).
- Same-game legs: spread and total are basically unrelated; a team's TD scorers rise a lot with its cover + Over (3.10 vs 2.14
  TDs) — the app only multiplies legs across different games, so no fix needed.

## TD model — already tested (don't redo without a new idea)

Added (Oct 10, 2026):
- Injury report inputs (own status + top teammate's status), plus the site's Questionable list (official + ESPN) — the nflverse injury file lags Friday statuses.
- Starter out → backup boost: RB (better 5/7 seasons), WR/TE (4/7).

Tested and NOT added (made it worse):
- Last-3-game usage weighting (worse 6/7).
- Opposing defense injuries: plain counts (3/7), starters weighted by snaps (2/7), per-player defender stats — coverage, pressures, tackles (2/7).
- Rookie draft pick (3/7; rookies already about right on average).
- Weather — wind, cold, outdoor (2/7).
- Head-coach change mid-season: model already close (19.6% said vs 20.3% actual). Play-caller changes aren't in any data.
- 2+ TD and first-TD numbers: already calibrated 2019-25; this season's small sample agrees.
- Known gap: news not on any report (coach comments) — can't be tested; the "Market disagrees" box is the warning for it.

## Already handled (don't rebuild)

- Late scratches: Railway reruns the model ~60 min before every kickoff wave.
- Combo grading: account bets use Polymarket's own payouts.
- Live / in-game picks: owner doesn't want them. Player props beyond anytime TD: not wanted unless accurate.

## Betting notes from the owner's experience

- Bet Sunday morning after inactives (~90 min before kickoff) and a Model rerun; lines and weather move picks during the week.
- A TEASER pick only works at the teased line.

## Next project: NBA app (discussed Oct 10, 2026 — not started)

Same concept as the NFL app: game model (spread/total/moneyline), tested combo patterns, best bets at 56%+, teasers, player props, Polymarket lines and bet sync, automatic rebuilds.
- NBA differences: ~1,230 games, daily updates; injuries/rest/late scratches matter most; back-to-backs and travel; pace for totals; props (points, rebounds, assists, 3s) depend on minutes.
- Plan: phase 1 game model (~1–2 weeks), phase 2 combos + best bets (~1 week), phase 3 props (~1–2 weeks).
- Open questions for the owner: separate app or a tab in this one? Check which free NBA data sources work from the cloud before promising.
- Wait for "build now".
