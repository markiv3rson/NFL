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

- Model card: ONE answer — the model's number (purple, with "less accurate than the line" under it), then **PICK** — green at 56%+, yellow
  below it ("weak pick: won X% on games it never saw"). Owner chose C on 10/12: always a PICK, never LEAN. No teasers on cards; market lines only.
- Teasers (incl. alt lines) are all labeled **TEASER**, in a folded list on Game Lines, top 5.
- Best bets = top 10 straight picks at 56%+. Parlay of the week = top 4, one per game.
- Model Picks tab: ~22 parlay types built once a week (first scheduled snapshot within 26 h of the first Sunday kickoff — Sat 7 AM PT
  when the first game is London) and graded. Includes "Best bets · 2/3/4" (= the Parlay of the week). Alt-line parlays are labeled
  TEASER. TD parlays may use thin markets (leg says "thin"); the price shown is the ask.
- Bets tab: an open leg says "⚠ app now picks the other side" when the app has a 56%+ pick against it.
- Early-week total edge: TURNED OFF on cards 10/11 (11-18 live); still recorded and graded on paper.
- Anytime TD tab: top 3 per team (owner wants it kept), plus a "⚠ Market disagrees" box for any player 20+ points from Polymarket.
- Referees and price-gap alerts were removed on purpose.

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
  3 of 13 seasons (2014-26, each season unseen). Cards say so under the purple number (10/12).
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

## Recording for future tests (10/12, owner chose A + B) — NOT shown, NOT picks until tested on unseen games

- A: betting splits (bets % vs money %) from Action Network's public feed, every scheduled/kickoff snapshot: `lib/splits.js`,
  Redis `splits:<season>:<week>:<game>`. Field names unverified at build time (the build machine can't reach the feed); a pull with no
  split fields or a failure is logged to the status panel. No free history, so test after ~half a season.
- B: each sportsbook's own spread/total on every books pull (`byBook` in the books data and snapshots), for testing line moves per
  book and by time of week.

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
