# NFL betting app — notes for Claude

## **THE #1 RULE (owner, 10/14, after Claude broke it again and again): ANSWER FIRST. DO NOTHING UNTIL THE OWNER SAYS "BUILD NOW".**

**1. Answer every question the owner asks, all of them, in short plain words. Then STOP and wait.**
**2. Do NOT edit, build, test, commit, push, merge or delete anything until the owner types the exact words "build now". NOTHING ELSE COUNTS: not picking an option ("I want B", "by confidence", "2 or 4"), not "yes", "continue", "do it", "fix it", not a rule, not anger, not a complaint. (Owner 10/14, after Claude built on "I want option B": "Do not build anything until I specifically say build now.") After answering, STOP and wait.**
**2b. "BUILD NOW" and "MERGE NOW" ARE TWO SEPARATE COMMANDS (owner 10/14). "Build now" = edit, test, commit and push to the work branch ONLY. NEVER create a PR or merge to main until the owner types the exact words "merge now". After building, say what changed and wait.**

**3. If it is not clear what the owner means, ASK in plain words. Never guess and build. Never "fix" something on your own.**
**4. Never undo, redo or clean up your own changes without being told. If you made a mistake, say so and wait.**
**5. When the owner says "build now", build the WHOLE thing in one go, then say what changed.**

Read this first in every new chat. It carries the owner's rules and what has already been tried.

## Owner's rules (always follow)

1. **Answer every question first, all of them, before anything else.**
2. **Never build, test, push, merge or delete anything until the owner says "build now"** -- ONLY those words count (an option pick, "yes" or "continue" do NOT). Explaining is fine; acting is not. Don't undo or redo changes on your own either.
3. Short, plain answers. No jargon. **Every spread or line written in a reply carries its + or − (favorite −2.5, underdog +3.5) -- owner 10/15.**
4. Don't add things the owner didn't ask for, and put things exactly where told. **NO explanatory notes, warnings, footnotes, subtitles or "how this works" sentences anywhere in the app (owner 10/15: "I'm the one building it, I understand it"). Show data only. Never add a section, list or card nobody asked for.** **NO explanatory notes, warnings, footnotes, subtitles or "how this works" sentences anywhere in the app (owner 10/15: "I'm the one building it, I understand it"). Show data only. Never add a section, list or card nobody asked for (owner 10/15: the "Picks recorded and graded" list).**
5. Judge bets by **win rate**, never by price/value.
6. Trust small samples. No "luck" filter.
7. "Tests pass" only means the code runs — never say it as if the predictions are right. Give accuracy numbers instead.
8. Be upfront about gaps: say what a model can't see.
9. Phone alerts / login: don't build or ask unless the owner raises it.
10. The owner handles Railway settings. Never paste secrets (an Odds API key was once shared in a screenshot — don't repeat it).

## What the app shows (owner's layout rules)

- Tab bar (10/15): Game Lines, Anytime TD, Bets, Alerts, Models -- FIVE tabs; there is no Model Picks tab (it lives inside Bets). Icon over each name, purple/blue, no box.
- Model card: ONE answer — the model's number (purple), then **PICK** — green at 56%+ (with its short reason, e.g. LINE MOVE), LIGHT GREEN at 53-55% (owner 10/13), yellow
  below 53% with NO notes (owner 10/13: "too many notes"). Always a PICK, never LEAN. No teasers on cards; market lines only.
- Teasers: REMOVED 10/14 (owner never bets them; code deleted, no longer recorded). The "buy points" idea lives on as BEAT THE 3.
- Best bets = top 10 straight picks at 56%+. Parlay of the week = top 4, one per game.
- Model Picks tab (the old angle / teaser / price-gap parlays were deleted 10/14): parlay types built once a week (first scheduled snapshot within 26 h of the first Sunday kickoff — Sat 7 AM PT
  when the first game is London) and graded. Includes "Best bets · 2/3/4" (= the Parlay of the week). TD parlays may use thin markets (leg says "thin"); the price shown is the ask.
- Model card (10/14, owner): when another green rule takes the OTHER side of the same market, the green pick adds "⚠ Rules split: <pick> (<rule>, <%>) is green too. Pick one side." (`public/app.js splitNote`).
- SAME-GAME PARLAYS (10/14, `lib/sgp.js`; current set = 2 legs / 3 legs / 4 legs / 4 legs · my style, see PAGE CLEANUP below): every game page
  shows a "SAME-GAME PARLAY" box at the bottom, below the touchdowns; tab bar order (owner 10/14, final): Game Lines, Anytime TD, Bets, Bell, Models, Model Picks -- BEST (strong legs: green spread/total 56%+ and TD players 55%+, one per team, ALL kept -- owner 10/14 "we are testing everything":
  a TD with the Under stays, its chance counts the 0.77x link; fewer than 2 strong legs -> filled with the next-strongest legs and saved as
  its own record `sgp_best_fill`, so every game gets one) and YOUR STYLE (card's spread + total
  pick + the top TD scorer on each team, Out/Doubtful/Questionable skipped). Chance = legs x same-game links (`lib/combo.js comboChance`).
  Model Picks tab: "Same-game parlays · ranked" card at the top + scoreboard group SAME-GAME PARLAYS (sgp_best / sgp_style). Saved on every
  slate build until kickoff (`paper:<s>:<w>:sgp|<game>`, last save before kickoff counts), graded by gradePaper, no bell alert (`noAlert`).
  Legs without a Polymarket price yet (TD markets post late in the week) still count; such parlays get win/loss only (no return).
- Game page (10/14, owner): the "BEST PICK · THIS GAME" box at the top was removed (it repeated the Model cards; `anglesBox` code kept).
- CASINO LOOK (10/14, owner picked sketches 1/3/5/14/15/17 + purple parlay glow; sketches: claude.ai/artifact/6AwTJ5nR4pz7dgKLDkqYqk): green
  PICK is the same size as the card's other text and only GLOWS (owner: no growing) -- brighter for stronger picks (`glowOf`: 56-57% soft, 58-60% mid, 61%+ bright); its % rolls in like a
  slot reel when a game page opens (`rollReels`); Bets tab only: settled bets get a gold HIT! (coins, once per bet via localStorage
  `stampSeen`) or red MISS stamp (`stampFor`, not on cashed-out bets); header countdown digits flip; header (owner 10/14): no "NFL Slate" title; week/date, NEXT KICKOFF countdown, next game and "Updated" on the left, a slot lever
  on the right RERUNS THE MODEL (lines refresh on their own); the model's parlay cards (same-game box, Model Picks, Parlay of the
  week) glow purple (`.modelglow`). KEY NUMBER is shown as "BEAT THE 3" (rule id stays `keynum|spread`).
- Bets tab: an open leg says "⚠ app now picks the other side" when the app has a 56%+ pick against it.
- Early-week total edge: TURNED OFF 10/11 (11-18 live); its code was deleted 10/14.
- Anytime TD tab: "Best TD picks" box at the top (10/14, owner: only the model's 55%+ players; graded weeks 3-5 they scored 17 of 21
  vs 22% for all listed players), then top 3 per team (owner wants it kept), plus a "⚠ Market disagrees" box for any player 20+ points from Polymarket.
- Referees and price-gap alerts were removed on purpose. Models tab is 8 sections (10/13: "Price gaps" cut, "Records · model's side" cut, "Tracked angles" = wind Under, OFFENSIVE FLOOR and the two shadow rules, `lib/tracked.js`). Also cut 10/13: "Hit rate by week" (Trends), the Replay box, the Pick Lab paper singles, bell alerts for MODEL / PRICE GAP / TEASER, the edge tracker and the Action Network pull (all their code deleted 10/14).

- Sign-in (10/14, owner chose B): one good sign-in sets a 1-year "remember this phone" cookie (`middleware.ts`, `nfl_remember` = hash of
  username + password); changing SITE_PASSWORD in Vercel signs every phone out. Cross-site guard kept.

- Polymarket combo legs (10/14, owner): Polymarket drops a combo's legs once it settles. Now every account sync saves each open combo's
  legs (`lib/mybets.js saveComboLegs` -> `combolegs:<id>`), the Bets tab uses them after Polymarket drops them, 1+ TD legs with no mark are
  graded from the official scorers, and Bets -> analysis counts account combos' legs too. `/api/combolegs` = one-time lookup that tries to
  get OLD settled combos' legs back from Polymarket by id (`?raw=1` shows a sample reply).

## 4-LEG PARLAY RESEARCH (10/14, owner: "find strategies for a 4 leg parlay"; 214 weeks 2014-25, closing moneylines, walk-forward TD model)

- Cross-game, share of weeks all 4 won: 4 biggest moneyline favorites 41.1% (market said 37.9%; heavy favorites win more than priced:
  85%+ said 87% won 91%); skipping games where a green pick backs the underdog 42.5% (beat its priced chance 10/13 seasons; 3+ of 4
  legs 77%; weeks 1-4 35%, 15-18 51%). 5 favorites 33.6%; home favorites only 35.0%; 3 favorites 55.6%. Best green pick + 3 favorites
  32.2%; 3 favorites + top TD 31.4%; 2 favorites + 2 TD 21.6%; 4 green picks 10.8% (21.4% with LINE MOVE, which rarely fires live);
  4 most likely TD scorers 9.2%. STRONG WEEK (all 4 favorites priced 70%+): 48.6% of 146 weeks (periods 50/43/53) vs 30.2% of
  the other 63 -> flagged on the card (`strong`); 3+ of 4 legs: strong 82%, other 62%.
  Also checked, no gain: time-slot spread, underdog with a new QB (market prices it), Thursday/Monday favorites (noise), linked 4 with
  RB1+WR1 = top 2 by model (8.0% vs 7.9%), RB1+TE1 worse (5.1%). Favorites the line moved toward / total size / home vs road: no gain (the close prices it). No effect: division games, rest, QB change, last result, wind, favorite-win vs Over link (none).
- Same game (2,665 games): owner's style (spread + total + top TD each team) 4.6-5.7% with the Over, 1.8-2.4% with the Under; best
  same-game 4-leg = favorite ML + Over + favorite's top 2 scorers 7.9%; best 3-leg = favorite covers + Over + its top TD 14.2%.
  Style is best in games with total 47+ and both top scorers 40%+ (~9-11%). Green spread pick + same team's top TD: both hit 26%
  (vs 20% if unrelated). Lead RB of a team implied 27+ points scores 54-55%. Opponent TDs allowed adds nothing to the TD model.
- BUILT (`lib/sgp.js FOUR_LEG / fourLegParlays`, slate `fourLeg`): Model Picks "4-leg parlays · this week" card (purple) +
  scoreboard group 4-LEG PARLAYS (leg4_fav, leg4_green_fav, leg4_fav_td, recorded weekly in buildPaper, graded); same-game box adds
  LINKED 4 (`sgp_linked`, saved per game) and a note when "your style" uses an Under with TDs.

- PAGE CLEANUP (10/14, owner: "build everything now"):
  * Same game, every game every week, saved before kickoff and graded: 2 legs (`sgp_best`, filled `sgp_best_fill` = favorite wins + its top
    TD, 33% in 2014-25), 3 legs (`sgp_3` = favorite wins + Over + its top TD, best same-game 3-leg 18.8%, 25.3% when that player is 50%+),
    4 legs (`sgp_linked`, 7.9%), 4 legs · my style (`sgp_style`). Research 2,659 games: best 2-legs fav ML + Under 33.8%, fav ML + top TD
    33.0%, fav ML + Over 32.3%; best 3-legs fav ML + Over + top TD 18.8%, fav ML + Over + 2nd TD 14.7%, fav covers + Over + top TD 14.2%.
  * Every parlay shows its Polymarket payout: legs' prices multiplied (1/price each) and what its stake returns (`payLine`, STAKES); legs without a price say so.
  * Model Picks: page header + drop-down cards (Same game 2 / 3 / 4 legs, 4 legs · my style, 4 legs · different games), no purple on its cards;
    the old "Your model's parlays · week" list removed; scoreboard grouped (Same game, 4 legs, Best bets, Favorites, Touchdowns) with W-L and
    hit % and past-season hit %. Old cut parlays (angles, teasers, right now, linked_sgp_3, same_game_3) no longer built; their code removed.
  * Game Lines: Best bets / Parlay of the week as two gold tickets; line changes as a chip strip; live game tiles glow red.
  * Page headers are plain words with a gradient line; numbers roll in like slot reels when a tab or game opens (`slotify`).
  * Anytime TD: Best TD picks players are not repeated in the list below; "Market disagrees" is a ⚠ line on the player's row.
  * Alerts: wind alert says "Strong wind can lower scoring" (the old "Windy under" angle is not a pick). SOS removed from the screen
    (strength of schedule is still computed in `lib/week.js schedStrength` as `g.sos`, just not shown).
  * Dead page code removed: anglesBox, extraBets, rightNowBox, saferSide/saferOne/saferRate/saferTotal/totalMoved, comboLines, ord; the
    unused `angles` field on games.

- 10/14 (owner, "build now for all three"): Models + Model Picks tabs are purple; the floating Lines / Model buttons are gone (the lever
  pulls new lines via `refreshLines`; the model reruns automatically before every kickoff wave); "Updated" sits under the lever; page
  headers are just the words with a rose line under them. RISK FIX: history lists (`snaps`, `pinnacle` 30-min, `tdpxhist`, `fcst`, `inj`)
  now trim with `lib/redis.js pushCapped` -- the week's first 10 readings are always kept (opening lines for TOTAL MOVE / INJURY / wind
  Under). Before, heavy refreshing -- and the 30-min Pinnacle pull after ~4 days -- pushed the opening readings out. The lever buys
  sportsbook odds only when the saved ones are 6+ h old (3 credits); Polymarket reads are free.

- 10/14 (owner, latest look): no red anywhere -- purple / blue / white theme (old rose values remapped in `public/index.html`; red stays
  only for losses, MISS and LIVE games). Header = sketch 6: no box, green "LINES LIVE · WEEK n · dates" line, countdown in a white-to-purple
  gradient, "until <next game>", slim lever on the right with the MODEL time under it. THE LEVER ONLY RERUNS THE MODEL (`rerunModel` ->
  POST /api/rerun); Polymarket / sportsbook lines and injuries refresh on their own (schedule + 30-min pull). Bottom tab bar has no box: a
  dark fade with a purple-to-blue hairline. Every tab change scrolls to the top.

- 10/14 (owner): STAKES per parlay type (`lib/sgp.js STAKES`): my style $5, same game 4 legs $10, 3 legs $15, 2 legs $20, 4 legs across
  games $10 -- saved on each parlay (`stake`), shown as "$stake -> $payout", and graded into a money result per type (`board.money`,
  scoreboard "+$/-$"; win rate stays the main judge). `npm run accuracy` (Tuesday report card) now prints every parlay type's live record,
  hit vs said %, money and verdict. Best bets + Parlay of the week moved off Game Lines to the top of the Bets tab as two tickets side by side
  (tap one to open its list). A line sits under the header. Filter chips (Bets weeks, Alerts kinds) are docked right above the bottom tab
  bar (`.chips.dock`) for one-thumb use. Grading check 10/14: weeks 3-5 every final game graded (16/16/15), all 87 card picks graded
  (chooser included since 10/12), week 6 parlays saved and waiting.

## BUY THE POINTS + fixes A-D (10/14 late, owner: "build now")

- BEAT THE 3 is now a table of tested tiers (`lib/stack.js BUY_TIERS`, 1999-2025 closing line, DAY rates): books 1 / 1.5 / 2.5 / 3 ->
  dog +3.5 (60.7 / 62.1 / 60.9 / 57.9%); books 3.5 / 4.5 / 6.5 -> fav -2.5 (59.8 / 65.6 / 66.9%); books 5.5 -> dog +7.5 (61.7%, "BEAT THE
  7"); books 13.5 -> dog +14.5 (68.0% on 50, "BEAT THE 14"). NOT picks (tested 10/14): fav -6.5 at 7/7.5/8, dog +7.5 at 5/6/6.5, fav -9.5
  at 10.5/11, dog +10.5 at 9/9.5/10, dog +14.5 at 13/14, books 2, books 4. Books 4.5 dog +7.5 also passed (60.8%) -- only the fav side
  is shown. Polymarket alternate lines now read up to 15 points (`lib/poly.js`). Buying more points always raises the win rate; the price
  rises too.
- B: night games (`isNightGame`: Thursday, Sunday 7 PM ET+, Monday; Thanksgiving-day Thursday games count as night too, as in the history).
  First built as "day games only" (BEAT THE 3 night 53-56% every period vs day 58-61%; BOUNCE BACK 48-51% vs 58.8%; DOG 53.1% vs 56.9%;
  underdogs cover less at night: Thu 46.7%, SNF 49.9%, Sun day 51.6%); owner: "I want night games too" -> the rules fire at night with
  the NIGHT rate on the card (`BUY_TIERS[..].night`, 1999-2025): books 1 55.8%, 1.5 69.7% (33), 2.5 51.1%, 3 51.8%, 3.5 fav 55.6%, 4.5 fav
  54.2%, 6.5 fav 66.7%, 5.5 dog +7.5 60.0%, 13.5 45.5% (11); BOUNCE BACK 48.3% (58), DOG 53.1% (32). Day card %: BOUNCE BACK 58.8% (318),
  DOG 56.9% (253). Under 56% the card shows light green / yellow. `npm run accuracy` replays day AND night against each card number.
- A: same-game parlays -- `lib/combo.js pairLift` treats two side bets in one game as linked (same team = the less likely leg; opposite
  teams = pA + pB - 1, the window between them). DEN +3.5 + SEA ML showed 34%, real ~13-17%. The 2-leg filler (`lib/sgp.js`) never adds
  a leg that works against one already in (link < 1x); same-team TD first.
- C: wind. Open-Meteo's archive (ERA5) at kickoff MATCHES nflverse stadium wind (235 games 2021-25: mean 8.9 vs 8.9 mph, 10+ in 35% vs
  38%, corr 0.74) -- the source is not inflated; 9 of 10 outdoor games at 10+ in week 6 is the 5-day forecast or a windy week (the
  historical-forecast API was blocked, can't test forecast skill). TOTAL MOVE used the MEASURED kickoff wind (unknown at the open):
  without it 57.6% (507) / 61.3% (253) vs 59.1% / 62.7% -> wind dropped (`weekly_rebuild.py MOVE_DROP` + "w"; built-in `UP_MOVE` refit;
  a published model that still has "w" is ignored by `useMoveModel` and the status `moveCheck`).
- D: card warns "⚠ Costs X¢ but wins Y%" when the pick's price (its own bought-line price or the main line's) is above its win rate
  (`public/app.js costNote`).
- MIDDLE (owner: "only if it looks like a good edge"): books 2.5 / 3 / 3.5 -> favorite -2.5 + underdog +3.5 shown as a note on the
  spread card only when the two prices add up to less than 1 + the exact-3 share (day 8.8 / 9.3 / 10.1%, night 3.3 / 9.4 / 7.3%) (`lib/stack.js middleCheck`).
  Saved once (`|middle` in `lib/tracked.js`), graded (W = favorite by exactly 3, both won), Models -> Tracked angles row with money.
  The Polymarket COMBO version (ML + spread as one parlay, 6.39x for SEA ML + DEN +3.5) can't be judged: the app can't see combo prices.

## BUG HUNT (10/14, owner: "run every possible bug and fix them")

- Ran: TypeScript name/type check of every JS file (no undefined names), Python undefined-name check (clean), 20,000 random games through
  every pick rule / grading / middle / parlay builder (0 problems), 20,000 random parlay-leg sets through the same-game chance math
  (never above the least likely leg, symmetric, no NaN), a 2-week scheduler simulation across the 11/1 daylight-saving change (site's
  `nextBooksPull` and the scheduler's slots match on all 672 half-hours; 23 pulls / 57 credits a week), the live slate checked for
  impossible values (none), every tab and all 14 game pages loaded in a browser with the live data (no errors, no "undefined"/"NaN"),
  and 14 loads with randomly damaged data (0 page errors). The browser can't trust the sandbox's HTTPS proxy: serve `public/` from a
  route stub and feed it live JSON fetched with curl (see /tmp scripts idea: route local.test -> files + /api/* fixtures).
- Fixed: the iPhone clock / battery were drawn over the page content (`body::before` strip, `public/index.html`); the Bets tab still said
  "Open this week $X of $200" (the weekly budget was deleted); the System warning said "tap ↻ Lines + injuries" (button removed);
  a NaN / non-number line could become a pick labeled "A NaN" (`lib/picks.js` now returns no pick).
- Checked and fine: parlay grading of the new -2.5 / +7.5 / +14.5 labels, read-only API endpoints with bad input, the TD tab header
  ("Week 7 / top 7" in a screenshot was the digit animation mid-roll; it lands on "Week 6 · top 3"). NFL app credits 349 after the 10/14
  7 AM pull (352 - 3); the sandbox key read 490 -> a different Odds API subscription.
- Not testable here: the model service HTTP endpoints (importing it downloads the model data), Polymarket / Pinnacle live feeds.

## CLEANUP (10/14, owner: "delete all 8", teasers too)

- Deleted: the price-gap tracker (`lib/edges.js`, "right now" gaps, PRICE GAP alert), the old bet sizing ($200 weekly cap, Kelly stakes,
  value-ranked "best" list, `gameBets`, correlation warnings, `placedThisWeek`), the alternate-line value tracker (`lib/altfair.js`), the
  retired scanned-combo code (`stackPicks`, `STACK_NAMES`), the old Pick Lab singles (`picksFor` / `recordPicks` / `picksSummary`, angle
  names), the early-week total card note, the hidden "unmodeled TD players" / "ESPN removed" lists, the Action Network code
  (`lib/splits.js`, `/api/splitshist`), the 10/10 replay tool (`lib/backfill.js`, `/api/replaypicks`), and ALL teaser code (legs, total
  +-6, "total fell" leg, teaser alert). `lib/teaser.js` became `lib/tracked.js` (wind Under, OFFENSIVE FLOOR, shadow rules only; still in
  the Redis hash `teaser:<s>:<w>` so old rows count). Old Redis data from the removed features (edgelog:, picks:, altval:, splits:,
  teaser legs) was NOT deleted. System "Recorded this week" now counts the card picks saved at kickoff (it said "picks missing" since 10/13).
- Kept on purpose: strength of schedule (computed, not shown), the old season replay (feeds "history %" on the scoreboard), the game
  model's own spread/total side (`spreadPick`/`totalPick`, card cover only), TD "No" alerts.

## Where things live

- Site (Next.js on Vercel, nfl-nfl9.vercel.app): `pages/api/*`, `lib/*`, front end `public/app.js`.
  - Card picks: `lib/stack.js`, `lib/combotable.js`; game model: `lib/upgrade.js`; tracked paper tests: `lib/tracked.js`; week data: `lib/week.js`.
  - Model rerun (sends Out/Questionable lists to Railway): `pages/api/rerun.js`.
  - Bets tab / Polymarket sync: `lib/mybets.js`, `pages/api/mybets.js`.
- Model service (Python on Railway): `railway-model-service/`.
  - TD model: `td_prob.py`. Weekly rebuild (Tue 4 AM PT, publishes only if checks pass): `weekly_rebuild.py`, `scheduler.py`.
- Tests: `npm test` (site checks, grading audit, service checks, then ACCURACY: `tests/accuracy.mjs` replays the app's own green-rule code on
  past games -- KEY NUMBER, BOUNCE BACK, BOUNCE BACK DOG, LINE MOVE spread/total -- and FAILS if one wins under 56% or 1.5+ points under
  the % its card shows; then prints each rule's live record this season. `npm run accuracy` runs just that part.)
  10/14: INJURY is replayed too (starters out rebuilt per team-week from nflverse injury reports + snap counts with the app's own
  startersOut/injuryPick): weeks 4+ 147-113 = 56.5% (2014-26; periods 52/61/57). It FAILED at first (54.7%) because the app also fired
  in weeks 1-3, which were never tested (the 57.0% came from week-4+ games) and went 3-11 there -> INJURY and TOTAL MOVE now fire from
  week 4 only (`lib/stack.js TESTED_FROM_WEEK`). TOTAL MOVE is checked by the weekly rebuild's own unseen-season numbers (`moveCheck`
  in the slate status). Tuesday check-in routine (9:52 AM PT) now posts a WEEKLY REPORT CARD from `npm run accuracy`: per green rule live
  W-L vs history %, flag only.
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
  winners), totals 52.0% (54.9% on its 195 most confident). So most chooser picks are yellow (~51-54%); cards always say PICK (never LEAN).
- The weekly rebuild refits it (`weekly_rebuild.py train_chooser`) and publishes `chooser`; `lib/combomodel.js` loads it.
- Dropped as picks (rates never checked on unseen games): scanned teaser combos, the 3 "keeper" angles, angles in general,
  the "total fell" rule. (Teasers were removed entirely 10/14.)
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
- Shown as a PICK on the spread card when it applies; recorded and graded with the other picks. Needs current books (until the next
  scheduled pull, 10/14) and fresh Polymarket (3 h; the 30-min Pinnacle pull's Polymarket reading counts).
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
  The +3.5 usually costs ~53-55c. Shown as a green PICK, recorded and graded. WIDENED 10/14 (owner: "build now" -- DEN +3.5 vanished when the
  books moved 3 -> 2.5): books exactly 2.5 -> underdog +3.5 too: 2006-25 59.6% (240-163; 1999-05 59.4, 06-13 62.4, 14-19 58.1, 20-25 59.2).
  Card shows 59.6% at 2.5 / 58.1% at 3; both replayed in `npm run accuracy`. Books at 3.5 -> no pick (the dog just gets the line). Books at 10 -> dog +10.5 61% but only 160 games and
  uneven (54/75/59): not added. Books at 7 -> dog +7.5 51%: no.
- WIDENED AGAIN 10/14 (owner: "build now", "I'd rather pay more than lose" -- the bought points' higher price is NOT a gap): books exactly
  1.5 -> underdog +3.5 63.9% (124-70, 1999-2025; 63.5/61.5/65.7/64.3); books exactly 3.5 -> FAVORITE -2.5 59.1% (388-268; 57.6/59.2/58.1/
  61.5). Both in `keyNumberPick` (same id `keynum|spread`), replayed in `npm run accuracy` (2006-25: 64.1% / 59.6%).
  Then (owner: "all 4, build now"): books exactly 1 -> underdog +3.5 59.9% (321-215; 66/57/60/62) ADDED. NOT added: books 2 -> dog +3.5
  55.0% (160; 1999-05 46%); books 4 -> favorite -2.5 63.9% (324) but falling 78/64/58/53 (2020-25 53% on 64). Stale books: Pinnacle now only
  CONFIRMS the books' last number (same number -> pick, reason says "(Pinnacle still there)"); Pinnacle alone can't create a BEAT THE 3 pick
  (`lib/week.js`, kickoff recorder `pages/api/snapshot.js`). 4-leg cards show "Thu +4" on a Thursday favorite leg.
- Same day (owner: "build now"): WIN % RECALIBRATED (`lib/picks.js winX`, `fair_line.py CAL_WIN_BEND`): -0.0470 + 0.1187 m + 0.0334 m|m|/10
  (m = market home-favored margin). Old straight line said small favorites 2-3 pts too high; unseen seasons 2006-25: 50-60% said 56.3 won
  55.4 (was 56.7/54.0), 60-70% 63.4/62.2 (was 63.9/61.8). THURSDAY FAVORITES (+4 pts: won 71.3% vs 67.2% priced, 300 games) count 4 points
  stronger in the 4-leg favorites parlays (`lib/sgp.js THU_BUMP`, leg flag `thu`).
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

## BOUNCE BACK (Oct 13, 2026 -- owner: "build now")

- `lib/stack.js bounceBackPick` (+ `prevAts` in `lib/paper.js situationFor`): the ROAD team missed the spread by 21+ in its last game ->
  road team at the current line. Nothing fitted. Closing line 2006-25 57.6% (297; 55/60/58% by period, 14/20 seasons); 1999-2005 (held
  out) 54.9% (82); 24+ 60.8% (209). Home-team version 52.4%: road only. Week 6 2026: CHI @ ATL qualifies (CHI -25.5 ATS in week 5).
- Other angles tested 10/13, NOT edges (closing line 2006-25): late-season home dogs 50.0%; cold home vs dome road team 50.6%; road team
  less rest + 2 zones travel 47.9%; road-upset winner then division game 46%; Thursday home team 53.5% (217); big favorite after a loss
  50.8%; home team after a 21+ ATS miss 52.4%.

## BOUNCE BACK DOG (Oct 14, 2026 -- owner: "I need more rules that pass")

- `lib/stack.js floorDogPick`, green, recorded and graded: a team that scored 3 or less last game and is the UNDERDOG now -> that team at
  the current line. Nothing fitted. Closing 1999-2025 57.1% (294; periods 52/56/60/66); 2014-26 opening line 60.6% (94); shut out + dog
  61.2% (103). Favorite version 49.0% (not a pick). Found by stacking two near-misses ("scored <=3" 54.6% + underdog); the stacking was
  1 of 5 tried -- watch it live. Owner 10/14 (review flagged it): keep it GREEN. Week 6: TEN (scored 3) @ IND qualifies.
- Same batch, NOT added: INJURY widened -- 2+ front-seven out 57.1% close but 42 games, 2022-26 50% open; skill starter out 52.8%; injury
  count gap 4+ 55.9% (59, 2022-26 44%). BOUNCE BACK 14+/17+ 51-52% (21+ stays). Missed by 14+ and scored <=10 -> 52-54%. Healthy team is
  also the home dog 47.5%; KEY-3 game where the dog is the healthy team 41.4% (30).

## Tests 10/13 late + CLV tracker (owner: "go")

- Audit page (read-only): `/api/recordcheck?week=N` -> per game the latest 30-min Pinnacle/Polymarket record (order book incl.), the
  first line each pick was SHOWN at (`stackfirst:`), and the saved kickoff picks with first line, kickoff line, CLV and result.
- CLV FIX 10/14: picks are recorded only at kickoff, so the first line now comes from `stackfirst:<season>:<week>` (write-once, saved
  when the slate first shows each pick; `lib/stack.js noteFirstSeen`). Before the fix CLV was always 0.
- AUDIT FIX 10/14: picks were graded only if still on the card at kickoff -- timing picks (TOTAL MOVE, INJURY, LINE MOVE) that vanished
  because the line moved their way were never graded. Now every pick is also saved (whole pick) the first time it is shown
  (`stackfirst:`), graded by `gradeFirstSeenWeek` (lib/grade.js), and `stackRecords` (the record next to each pick) counts each pick once
  per week+game+rule at its FIRST-SHOWN line. Known quirk: KEY NUMBER's line is always +3.5, so its LINE VALUE is always 0.
- REVIEW FIXES 10/14: stackRecords keeps pushes in its de-dup (a first-shown push no longer lets the kickoff row count a win);
  Models-tab card record (stackSummary) also counts graded first-shown picks; the kickoff recorder's opening lines = first snapshot WITH a
  Polymarket line (same as the card -- INJURY / TOTAL MOVE were lost when the week's first snapshot had no Polymarket line); BOUNCE BACK DOG
  has its own label; order-book TILT ignores dead/placeholder books; Pinnacle pull runs 6 games at a time with a 15 s cap per game's
  Polymarket part (it could pass Vercel's 60 s limit); first-seen saves use one hmget per game; situationFor runs once per game per build.
- REVIEW 2 FIXES 10/14: TOTAL MOVE's early inputs included 4 stats models built from the CLOSING line (s_ens/t_ens/s_gbm/t_gbm) -- removed
  (`weekly_rebuild.py MOVE_DROP`); retested without them: top 20% 59.1% (508), top 10% 62.7% (252) -> the edge never depended on them.
  `situationFor`: if a team's last game isn't final yet, "last game" is unknown (it used to fall back two weeks -> BOUNCE BACK misfires).
  Bets tab: positions paged past 200 (open bets were stamped closed); a bet placed after MNF on next week's game isn't marked settled;
  TD legs need the scorer on the right team (as in grade.js). Rebuild drops ambiguous replay joins (same lines + same result, same week).
  FIXED 10/14 (owner: "fix all 5"): the chooser's honest test now hides the test season from EVERY row's model leans (two-level leave-one-
  season-out, `weekly_rebuild.py F_for`): spreads 49.7 -> 49.4%, totals 50.8 -> 50.4% (dry run passed; goes live with the next Tuesday rebuild).
- REVIEW 3 FIXES 10/14: TD model -- injury flags loaded at start-up (were empty for 30 min after each deploy) and last week's report is
  ignored until the team's new one (stale Questionable boosted backups). Scheduler: kickoff-wave rerun window 65->25 min before kickoff
  (a running postgame rerun made it skip). Wind Under paper: opening total from the first snapshot WITH a Polymarket total. Chooser: if the
  calibrated % for its side is under 50%, it flips to the other side. Starters-out recorder ignores failed loads. Cards: the old
  "★ Tested angle: Under" (wind) and "★ home fav 9.5+ ML" notes removed (angles dropped as picks); Models "Model's pick on every game"
  shows the CARD's pick, not the game model's own side. (The ~150 lines of unused front-end code were removed 10/14.)
- FIX 10/14: books are pulled only 2x a weekday (7 AM / 3 PM PT) to save credits, so overnight they pass the 8 h limit and KEY NUMBER
  vanished from the cards ~half the day. Now, when the books are stale, the latest Pinnacle line (30-min pull, under 1.5 h old) stands in
  for "the books sit on 3" (`lib/week.js`); the reason then says "Pinnacle at ...". Pinnacle fetch retries once (occasional 403s).
  Same day, 2nd cause: Polymarket snapshots run only 4x a weekday, so its reading also passed the 3 h limit. The 30-min Pinnacle record's
  Polymarket main line (`poly.hs` / `poly.h`) now stands in for it too when snapshots are stale.
  Same fix extended: LINE MOVE (spread + total) also uses that newer Polymarket reading (books stay the books -- LINE MOVE was tested on
  the books' consensus; Pinnacle-as-books is the shadow test). INJURY's "line hasn't moved yet" check uses the newest Polymarket line.
  The fallback now looks at the last 6 records (the newest one is often a snapshot record with no Polymarket reading).
  Full pass 10/14: every card pick (incl. TOTAL MOVE, BOUNCE BACK, BOUNCE BACK DOG, chooser) uses the newest Polymarket line.
  BOOKS AT THE OWNER'S TIMES (10/14 late, owner): pulled at EVERY scheduled snapshot -- Mon-Sat 7 AM, 3 PM, 7 PM; Sunday 5 AM, 8 AM,
  9:30 AM, 12 PM, 4 PM (Pacific; scheduler SUNDAY / WEEKDAY are (hour, minute) slots). Full pulls (with moneyline, 3 credits) at weekday
  7 AM and every Sunday pull; the rest skip the moneyline (`&books=2`, 2 credits, last moneyline kept) -> 23 pulls / 57 credits a week,
  ~250 a month. The sandbox's ODDS_API_KEY read 490 left / 10 used on 10/14 and the NFL app (Vercel key) read 352 the evening before, 349 after the
  7 AM pull -> the sandbox key is a different Odds API subscription from the NFL app's. A books reading counts as current until the next scheduled pull (+45 min)
  (`lib/books.js BOOK_PULLS / booksFresh`; keep it the same as scheduler.py WEEKDAY / SUNDAY). This replaced the 3 h / 8 h limit, so
  LINE MOVE / KEY NUMBER no longer drop off between pulls. Kickoff recorder uses the same rule; if the books aren't current, no LINE MOVE
  is saved and KEY NUMBER uses the newest Pinnacle line. Risk: a books move after the last pull (most likely overnight) isn't seen until
  the next pull.
- AUDIT 10/14 (owner: "check everything"): (1) Polymarket pick'em: both teams listed at -1.5 at ~48% (NO @ NYG) -- the app took the one a
  hair nearer 50% (NYG -1.5) though the moneyline and books had NO favored, flipping every dog/favorite input. Now when two lines are within
  1.5c of 50/50 it takes the one nearer the moneyline's spread (`lib/poly.js parseGame`). (2) Card %: 55.6% showed "56%" in light green --
  below green the % now rounds DOWN, colors use the real rate. (3) Records: a first-shown pick replaces the kickoff record only when it is
  GREEN (timing picks); the chooser's yellow side can flip midweek, so its record is the side locked at kickoff (`stackRecords`,
  `stackSummary`). (4) `situationFor`: while a team's last game is still being played, its 3-game streak and two-games-back are unknown too.
  (5) Site's 2+ TD formula used 1.035 while the model service moved to 1.044 on 10/1 -> site 2+ TD numbers ran ~1% low; now 1.044
  (`lib/calibration.js twoPlus`). (6) Model card number, win % and every pick now use the same newest line (`FR` in `lib/week.js`).
  (7) Bets tab: a sold bet's profit is saved once (only the last 100 trades are read; later syncs re-summed a smaller number).
  (8) Scheduler: a scheduled snapshot (and its books pull) skipped for good if the previous one was still running -- now retried in its
  5-minute window; same for the Pinnacle pull. (9) First-shown picks were saved only when someone had the app open -- the scheduler now
  builds the slate every 30 min (:15 / :45) so every pick shown gets recorded and graded.
  (10) Model Picks "Best bets" parlays: a KEY NUMBER leg (+3.5 alternate) was saved at the MAIN line's price (+2.5) -- now a pick off the
  main line uses its own price. (11) Parlay Lab hit rates counted a pushed parlay as a miss -- pushes now out (return still counts).
  (12) A Polymarket reading that failed the data check (line jumped 3+ / total 4+) still fed every pick -- now skipped until confirmed;
  the 30-min reading gets the same jump check and the 6-point sanity check vs the schedule's line (`pages/api/pinnaclepull.js`).
  (13) System checks: "No price snapshot in 8 h" / "No automatic run in 9 h" fired every night (7 PM -> 7 AM) and all Sunday night. Now
  "late" = 1 h past the next scheduled snapshot (`lib/watchdog.js`), and the 30-min Pinnacle pull marks the scheduler alive (`auto:last`).
  (14) Bell: the "Final" alert and the weekly recap reported the old game model's spread/total SIDE as won/lost (never a pick) -- now
  they report the card's picks locked at kickoff (`lib/alerts.js alertResult`, `lib/grade.js weekRecap`).
  (15) Model rerun sent the TD/game model the latest Polymarket line even when it failed the data check -- now skips it like the card.
- CLV tracker built: each card pick keeps the line it FIRST showed at (`first` in `stack:` records, `lib/stack.js recordStack/clvOf`);
  the kickoff line is the close. Models tab -> "LINE VALUE" tile: average points gained vs the close and % of picks that beat it.
- "Line moved with/against the model" (game model side vs the open, 2014-26, 2,578 games): moved WITH 55.1% at the open (48.1% at the
  close), static 51.4%, AGAINST 45.7% (52.4% at the close). Only knowable after the move -> no pick; it is why LINE MOVE works.
- No gain (unseen seasons, ATS at close / open, and margin error vs the line 9.904): owner's EPA power-rating code 48.3% close / 45.0% open
  (its line error 10.67); pass70/rush30 50.7%; success rate 51.5%; garbage time removed 49.3%; leverage-weighted 49.7%; Next Gen
  (CPOE, time to throw, aggressiveness, RYOE, separation) 48-52%; ESPN QBR 49.5%; PFR pressures/blitz/bad throws/drops/missed tackles
  47.5-50.4%; all new data together 50.8% (error 9.939, worse); PageRank 47.5%; rest edge (bye/TNF) 45.6/52.7%; coach 4th-down
  aggressiveness 49-52%. Totals with all of it 48-52%. INJURY weighted by QBR: no better (good QB lost 51.5% close, weaker QB 55.2%).
- Not tested: FTN charting (only 2022+), TD-model inputs from Next Gen/charting (TD model ~ Polymarket already).

- Injury cluster vs matchup (10/13, 2018-26, bet the team facing the injury): 2+ OL out vs top-10 pass rush 64.0% open / 59.3% close
  (25 games); vs bottom-half pass rush 63.4% / 64.3% (41) -> the edge is the 2+ OL injury itself (already in INJURY), the pass rush adds
  nothing. 1+ OL vs top-10 rush 47.0% / 44.3% (234); 2+ DB vs top-10 pass offense 50.0% / 44.4% (36). Margin error line 9.871, + cluster
  matchups 9.901 (worse). Closed: don't add defensive-matchup overlays to injuries.

- Special teams / steady-vs-big-play / box count (10/13, unseen seasons). NOT added -- don't retest without a new idea:
  Special teams EPA as a model input: 51.0% open, 51.6% close, margin error 9.923 -> 9.920 (no real change). Rule "top-8 ST unit vs
  bottom-8 -> better ST team": 56.8% open (292, 10/13) but 54.1% close; 2018-21 only 50% open / 48% close; works only when the better
  ST team is also the favorite (62-68% open) -- found after looking, so likely a favorites-at-the-open effect. Owner: keep it out.
  Success rate vs explosive-play split: 51.9% open, error worse (9.930); "steady vs boom-or-bust" 60% on only 20 games.
  Box count rushing (participation 2016-25): 51.5% open, error worse. Big favorites (6+) with WEAK light-box rushing covered 60.9% at
  the open (128) but strong-rushing big favorites also 54.4% -- big favorites cover the open generally; not a rushing effect.

## Untested-list batch (Oct 13-14, 2026 night) -- nothing added to the app

- Unseen seasons; spreads graded at the open / close; margin error vs the line alone (~9.90). NONE cleared 56% steadily:
  FTN charting 2022+ 48-50%, error worse (9.50 -> 9.57). Man/zone coverage fit 2018+ 47-51%, error worse. Late-season motivation:
  winning team vs eliminated-ish team 55% open / 53% close. Salary-weighted injuries (Out/Doubtful % of cap): 10%+ gap 57.0% open but
  51.5% close; with "line not moved 1+" 56.1% (255) but the games outside the INJURY pick only 53.3% and falling by period -> it is the
  INJURY edge again. Books exactly 10 -> dog +10.5 (1999-2025) 58.4% (202) but periods 48/54/75/59, 16/28 seasons -> not added.
  Spread version of TOTAL MOVE with the features the site can compute live: 51% (the earlier 55.9% used research-only inputs).
  GDELT news timing: not testable (rate-limited, ~3-month window, no past mid-week lines) -> covered by the live recording.
- Macro angles: road team 2nd straight road game + 2 zones -> fade 53.0% open / 50.7% close; back-to-back long trips 48.5% open;
  spread <=2.5 with a top-5 point-differential-variance team -> favorite 56.6% close (256) but 54.4% open, 11/20 seasons (uneven);
  divisional rematch after a 14+ win -> loser 47-49%, game-1 margin makes rematch error worse (10.184 -> 10.190).
- Cross-asset: TOTAL MOVE predicts the total DOWN (top 20% / 10%) -> underdog at the open 49.5% / 48.4% (baseline 49.7%). Dead.
- TD model + Next Gen Stats (walk-forward 2021-25, Brier, lower = better). FIRST run leaked (NGS lists a player only in weeks he gets
  enough volume, so a same-week merge told the model who got the ball) -- always merge NGS with earlier weeks only (merge_asof).
  Leak-free: base 0.15609 avg; all NGS (separation, YAC over expected, rush yards over expected) 0.15594, better 5/5 seasons;
  rush over expected alone 0.15590, 5/5; separation+YAC alone 2/5. Gain ~0.1% (would not move a shown TD % by a point). NOT added
  -- owner 10/14: leave it out (gain too small for a weekly NGS download in td_prob.py).

- Last four (10/14, closing line 2006-25 unless noted). NONE added; historical testing is done until the live logs mature:
  Mid-season head coach change (nflverse coach name change, 43 team-seasons): first 3 games under the new coach -> that team 59.3%
  close (91) but 1999-2005 (held out) 35.7% (28) -> 53.8% on 119 over 1999-2025. First game only 60.6% (33). Noise.
  New kicker (fade in the new kicker's 2nd game): 57.6% open / 54.8% close, periods 50/47/59 -> no. Denver: bet DEN at home 45.6%
  close; fade the team the week after playing AT Denver 43.5% open / 50.0% close. In-season trade within 8 days: buyer 55.0% open /
  51.1% close; fade the seller 49.2% close. Referee crews stay removed (owner).

- Four more (10/14, closing line 1999-2025, open 2014+). None added:
  Last season's record in weeks 1-4 (fade last year's good teams / back bad ones): 50-52% close, 33-48% open. Cover streaks: fade 3/4/5+
  straight covers 50.6-51.3%; back a team that failed to cover 5+ straight 56.9% close (246, 18/27 seasons) but 49.1% at the open and
  periods 51/69/59/51 (1 of 6 cuts) -> noise. One-score-game luck: 49-51%. Polymarket leaning 52c+ at its own line (weeks 3-5 saved
  snapshots): 68.8% on only 16 games, 55c+ almost never happens -> recheck later in the season.

- Line-shape batch (10/14). None added: opening spread next to 3/7 rarely moves ONTO the key (opens 2.5 -> closes 3 only 27%; 6.5 -> 7
  21%); betting at those opens 52.5-54.7%. Big favorite + low total -> dog 44.7-49.7%; short spread + high total -> dog 46-48%.
  Division Under 52.9% open / 51.8% close; primetime Under 53.3% / 51.4%; division+primetime Under 55.9% open (229) but 51.7% close.
  Total key numbers: opening 46.5 Under 58.8% (114) but closing 46.5 Under only 49.4% (239) and 46-48 range 51.3% (1,092) -> chance.

- OFFENSIVE FLOOR paper tracker BUILT 10/14 (owner: "build now"): `lib/tracked.js recordFloor`, saved at kickoff in the teaser hash as
  `<game>|floor` when exactly one team scored 3 or less last week -> that team at the kickoff spread (flags `shut`, `road`); graded with the
  other tracked tests (`gradeTrackedWeek`); Models -> Tracked angles row (with shut-out and road splits). Not a pick until it holds live.
- Batch 6 (10/14, closing 1999-2025, open 2014+). Nothing added to the app:
  OFFENSIVE FLOOR (watch list, paper candidate): team scored 0 last week -> bet it 64.2% open (53) / 57.4% close (155), periods
  99-05/06-12/13-19/20-25 = 60/44/66/63, only 14/27 seasons over 50; scored <=3 -> 60.6% open (137) / 54.6% close (423), periods
  53/52/54/61; <=6 52.8%; <=7 51.5%; <=10 51.5% (steady decline = likely real but small). Shut out, on the road 61.9% close (63).
  No edge: line jumped 3/4/5+ toward a team vs last week's lines -> fade 51.9-52.0% close, 49% open; both teams Over by 10+/14+ last week
  -> Under 46-48%, both Under -> Over 49-54%; final week home 53.0% / dog 49.2% / Under 49.1%; team pitched a shutout -> fade 51.0%;
  highest total of the week Under 53.6%, lowest Over 48.1%; Sunday 1 PM / 4 PM home 48-50%; West-coast teams at 1 PM ET 50-52%.

- Batch 7 (10/14). Nothing added: starting QB back after missing last week -> his team 54.6% open / 50.5% close (111); as underdog
  56.3% (71, 6/12 seasons), as favorite 40% (40). Green picks agreeing (replay 2014-26): 2+ rules on the same side 56.6% (53) -- no premium
  over each alone (KEY 55.5, INJURY 56.2, BOUNCE 57.2, LINE MOVE 62.9); rules point OPPOSITE ways in 88 games (card shows the higher %).
  TD model vs Polymarket at kickoff (prelog top TD candidates, weeks 3-5, 247 players / 31 games): Brier model 0.206 vs market 0.210;
  when 10+ pts apart (52) model 0.174 vs market 0.189 -> encouraging, too small; recheck later. TD price drift: Polymarket TD prices
  barely move in the week (2 of 263 moved 5+ pts) -> nothing to test. Rookie QB starts 1-8: 48-52%. Season ATS record after week 6:
  fade 70%+ 52.1%, back <=30% 53.8%. International games: favorite 60.9% (69) but 2020-26 48%; next game fade 52.3%.
  Popular teams (DAL/KC/PHI/GB/SF) on bye: 3+ in one week never happened 2014-26; 2+ only 6 weeks; average open->close spread move
  1.48 (0 on bye) / 1.32 (1) / 1.60 (2); LINE MOVE in 2+ weeks 65.2% (23) vs 62.8% otherwise -> no effect.

- Slate split (10/14, 2014-26, history replay): LINE MOVE spread / LINE MOVE total / TOTAL MOVE (top 20%) won
  Sunday 1 PM 58.6% (261) / 67.0% (200) / 56.5% (260); Sunday 4 PM 66.7% (147) / 65.1% (86) / 57.1% (105); standalone TNF/SNF/MNF/intl
  65.3% (121) / 70.3% (74) / 65.5% (116, small -- anchor on the 57.4% overall). Closing-line error: margin 9.85 (1 PM) / 10.09 (4 PM) /
  9.96 (standalone), totals 10.51 / 10.26 / 10.55 -> primetime lines are NOT sharper. Keep firing in every window; no slate filter.
- TODO (live data, after ~4-8 weeks): split live picks by WHEN they first fired (`stackfirst:` time) -- Sunday night-Monday vs
  Friday-kickoff -- and compare win rate and LINE VALUE; use the 30-min Pinnacle log for when lines moved. Not testable on past seasons
  (history has only open and close).

- SHADOW PICKS BUILT 10/14 (owner: "build everything now") -- recorded every 30 min by `/api/pinnaclepull` (`recordShadow`), saved
  ONCE when first fired in the teaser hash, graded, kept out of other records; Models -> Tracked angles rows. NOT shown, NOT picks until
  they hold live: (1) LINE MOVE with PINNACLE in place of the books (`|pinlm` spread, `|pinlmT` total) vs Polymarket at the same moment;
  (2) Polymarket order-book TILT: one side has 4x+ the money resting near the top and $1,000+ (`|tilt` spread home-side book, `|tiltT`
  Over book) -> that side at Polymarket's number. Market-only CHOOSER: needs several hundred graded games of these inputs -> mid-season.
- Batch 8 (10/14, closing 1999-2025, open 2014+). Nothing added: market momentum -- line moved toward a team open->close 3 straight
  games -> follow 54.2% open (325, 9/12) / 52.6% close; fading it 45.8%; line-implied rating up/down 3 straight 47-53%. Public teams
  (DAL/KC/PHI/GB/SF) favored -> opponent 49.7% close; in primetime 45.4% (355) -- popular favorites slightly OVER-covered; by team
  46-53%. Underdog implied score <=17 -> dog 52.5% close / 45.3% open. Weeks 17-18 fade a 12+ win team 50.0% / 41.7%. Head coach vs a
  team he coached in the last 3 seasons 55.3% (38 games; 2020-25 38%).

- Batch 9 (10/14, closing 1999-2025). Nothing added: lost by 28+ last game and now the underdog 57.1% (315) -- but outside games already
  picked by BOUNCE BACK / BOUNCE BACK DOG only 49.1% (112): the existing rules already capture it. Allowed 40+ last game, now dog 53.6%;
  lost by 21+ now dog 53.4%; won by 30+ now fav -> fade 52.7%; scored 40+ now fav -> fade 50.0%; a team scored <=3 -> Over 51.5% /
  Under 48.5%; both teams scored <=10 -> Over 55.1% (136, 13/27); both allowed 35+ -> Under 55.1% (89, 1999-05 33%).

## Vercel deploy limit (10/14)

- The free (Hobby) plan rate-limits deployments; on 10/14 merges #275-#281 hit "Deployment rate limited -- retry in 24 hours" and the
  site stayed on #274 (Railway deployed fine). Every push to the work branch also made a PREVIEW deploy. `vercel.json` now turns off
  deploys for `claude/**` branches, so only main deploys. Batch fixes into fewer merges. A rate-limited deploy is NOT retried by Vercel:
  after the limit resets, push to main (or press Redeploy in Vercel) and check the `x-build` header on /api/slate = main's commit.
- Pinnacle pull retries after 3 s and 10 s (10 s per try); the single 2-s retry still failed ~1 pull in 3 overnight.
- 10/14 (owner: "fix all 5"): a Pinnacle failure is logged only on the 2nd in a row (`lib/pinnacle.js pinnacleFailed`, key `pinfail`);
  LINE VALUE leaves KEY NUMBER out (its line is always +3.5); ~140 lines of unused page code removed (old reasons/replay/open-move/price-gap/
  teaser-strip/TD-calibration/by-week helpers and their tests); System page pings the Railway model service (`/health`, 5 s) and the
  watchdog warns when it isn't answering.
- ESPN (10/14): the plain scoreboard stays on LAST week until ~Wednesday and ESPN now rejects date ranges (HTTP 400), so the moved-game
  check found 0 of 14 games (site) and nothing at all (scheduler). Both now ask by week: `?dates=<season>&seasontype=2&week=<n>`
  (`lib/espnFinals.js`, `scheduler.py _espn_kickoffs`). TD retrain needs 6 played weeks before it tests (week 6 = first real test).

## Database space (10/14, owner: "build now")

- The database is Redis Cloud's FREE plan: **30 MB** (Vercel -> Storage -> Redis "redis-amber-clock"; no monthly command cap). It held
  ~12 MB after week 5 and grew ~3-4 MB per finished week (full by ~week 10). `lib/compact.js compactOldWeeks` (run by every
  /api/results/grade call) shrinks a week ONCE when it is over and every game is graded: `tdpxhist:` -> first + last entry, `rerunlog:` ->
  newest 5 (marker `compacted:<s>:<w>`). Lines, picks, records, results untouched. System shows "x of 30 MB"; the watchdog warns past 80%.

## Recording for future tests (10/12, owner chose A + B) — NOT shown, NOT picks until tested on unseen games

- A: betting splits are NOT available free -- Action Network's public feed leaves every bets % / money % null (PRO only; VSiN's
  splits are paid too). The pull was cut 10/13 and its code (`lib/splits.js`) deleted 10/14; old Redis `splits:` rows remain.
- TESTED 10/12 on 2,127 games 2018-2025 (past splits came from Action Network's history feed; `/api/splitshist` deleted 10/14; graded at the closing consensus line):
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
  (`poly` in each record), to test "Pinnacle moved first, Polymarket hasn't caught up".
  10/14 (owner: "go"): each pin30 `poly` also has the main markets' Polymarket order book -- `sb` (spread, home side) and `tb`
  (total, Over side): `bb`/`ba` best bid/ask, `bd`/`ad` dollars resting within 5c of them, `vol`/`liq` Polymarket's running volume /
  liquidity (30-min volume = difference between records). `lib/poly.js bookDepth` + non-enumerable `_mkt` (never saved in snapshots). A failed pull shows in 8 · System → "Errors (last 2 days)".

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

## Firmer promises (10/14, owner: "build 1 and 3; 2, 4, 5 out")

- 1: BEAT THE 3 tiers replayed at the week's OPENING spread (2014-26, `npm run accuracy` prints them; `lib/stack.js BUY_OPEN / tierRate`). The card
  shows the LOWER of the closing and opening rate when the opening sample is 60+ games. Moves: books 3.5 fav -2.5 day 59.8 -> 51.9 (yellow),
  books 3 day 57.9 -> 55.6 (light green), 2.5 day 60.9 -> 58.6, 5.5 day 61.7 -> 58.7, 6.5 day 66.9 -> 64.3; the rest unchanged.
- 3: live record per green rule (each BEAT THE tier day/night apart), each pick once at its first-shown line (`ruleRecords` in `stackSummary` -> `combos.rules`);
  `npm run accuracy` prints it with a BELOW flag (15+ graded and 10+ points under the card). Flag only, nothing is cut.

## LINE MATRIX (10/14, owner: "I want all the lines measured so we can always find the advantage")

- `tests/line_matrix.mjs` -> `tests/line_matrix_results.txt`: win rate of EVERY half-point line (up to 6 points bought) for every books number, favorite and
  underdog, day / night / all, closing 1999-2025 and opening 2014-26; totals (Over / Under at books -/+ x, by total size). Passing = 56%+, 100+ games, every
  period 52%+. Re-run: `node --import ./tests/register.mjs tests/line_matrix.mjs`. Win rate always rises with points bought (and so does the price) -- the
  steep jumps are at 3 and 7 (books 4.5 favorite: -3.5 wins 53-58%, -2.5 wins 63-66%, -4.5 itself ~50%). Prices are not judged (owner rule: win rate).
  A smooth-bell-curve "price" benchmark was tried and dropped: it is not what Polymarket charges (alternate lines are priced close to their history), so "edge vs
  smooth" was mostly the shape of NFL margins, not an advantage.
- NOT wired into the app yet: BUY_TIERS still has the 9 tested tiers. The matrix shows more passing cells (books 5 / 7 / 7.5 favorites at -2.5, books 4 / 4.5 / 5.5 ...);
  adding any is the owner's call.

## CAP AT 2 POINTS (10/14, owner: "cap it at 2 points ... use fewer points when that is enough")

- No pick ever buys more than 2 points (`BUY_TIERS`; a test checks it). Removed: books 1 -> dog +3.5 (buys 2.5) and books 6.5 -> fav -2.5 (buys 4). Kept: books 1.5, 2.5, 3, 3.5, 4.5,
  5.5, 13.5. Each kept tier is already the fewest points that passed (books 1.5 +2.5 54%, 4.5 -3.5 53%, 5.5 +6.5 56% not steady). The line matrix passes a few more cells within 2
  points (books 4 fav -2.5 64%, 6 dog +7.5 58%, 6.5 dog +8.5 62%, 7.5 fav -5.5 59%) but its bar (every period 52%+) is looser than the one the tiers were added under -- not added.
- RARE 3-POINT EXCEPTION (owner 10/14: "3 should be the max but only on rare situations"): a 3-point buy is allowed only where it wins 60%+ at BOTH the closing and opening number
  with every period 56%+ and no cheaper line passes (`tests/line_matrix.mjs` prints the list). Two tiers: books 3.5 -> underdog +6.5 (replaces favorite -2.5, which fell to 52% at the
  open): day 60.9% close / 67.9% open, night 62.1% / 58.3%; books 6.5 -> underdog +9.5: day 62.4% / 63.6%, night 63.6% (66) / 67.6% (37). Card shows the lower. The other 3-point
  cells (books 3 dog +5.5, 2.5 dog +5.5, 4.5 dog +7.5, 4.5 fav -1.5, 1.5 dog +4.5) already have a cheaper tier on that books number -- not added.
- FINAL CAP 10/14 (owner: "cap it at 3.5"): no tier buys more than 3.5 points (test checks it). Books 1 -> dog +3.5 (buys 2.5) is BACK; the old books 6.5 -> fav -2.5 (buys 4) stays out. 9 tiers: books 1, 1.5, 2.5, 3,
  3.5 (dog +6.5), 4.5, 5.5, 6.5 (dog +9.5), 13.5.

## "Without the extra points" line (10/14, owner: "yes show it, build now")

- A green bought-point pick now says "Without the extra points it wins about X% · with them Y%." (`public/app.js plainNote`; shown only when the points add 2+ points; not on light-green /
  yellow cards -- owner's no-notes rule). `BUY_TIERS[..].plain` = [day, night] win rate of the same side at the books' own number, 1999-2025 closing, pushes left out:
  books 1 49.3/48.2, 1.5 47.2/58.1 (31 night games), 2.5 52.4/47.8, 3 53.8/46.5, 3.5 50.6/50.0, 4.5 51.4/43.5, 5.5 55.3/51.0, 6.5 53.5/53.8, 13.5 68.0/45.5.
- Chooser side test (10/14, 2,604 games 2014-26, every season unseen): the chooser picking the side then buying points wins no more than always-favorite / always-underdog
  (0 pts 48.5%, 1 pt 53.5%, 2 pts 57.6%, 3 pts 60.5%; books 3.5 + 1 pt: chooser 53.7% vs favorite 60.4%). The points do the work, not the side -> key-number rules decide the side (owner agreed).

## Card cleanup (10/14, owner: "organize the cards, too much noise"; chose A + B)

- Spread / total Model card keeps only: the model number, PICK + %, one short reason, and the "Rules split" warning. The without-the-extra-points %, this rule's record, "line moved" and the
  cost warning sit behind a "More" tap (`public/app.js moreBox`, a plain `<details>`). Light-green / yellow cards still have no notes.

## BOUGHT-POINT TOTALS (10/14, owner: "by confidence"; option A) -- REMOVED 10/15 (the card's PICK w/ POINTS replaced it; code deleted; `talts` parsing stays)

- `lib/stack.js totalBuyPick / withTotalBuy` (id `totalbuy|total`, green): when the chooser likes a side of the total AND is confident, take that side on a Polymarket ALTERNATE total
  line moved the pick's way -- Over lower, Under higher, off Polymarket's main total. Chooser's most confident 10% (raw confidence >= thr10 0.6288) buys 2 points, the next 20% (>= thr30 0.58026) buys 4
  (`lib/chooser.js totalBuyLevel`; the weekly rebuild republishes `markets.total.thr` and checks the rule as `oos.totalBuy`). Honest rates (2,607 games 2014-26, every season unseen,
  half-point lines at the closing total): top 10% buying 2 = 59.4% (133; 58/62/58 by period), next 20% buying 4 = 64.2% (313; 66/65/63). The chooser adds ~2-3 points on top of
  what the points alone win (the bottom 70% buying 4 wins 61.9%). Sides tested: always Under 55.9 / 62.6%, always Over 57.1 / 62.6% (2 / 4 points) -> the side hardly matters without confidence.
  Card shows these rates (no "without the points" line: the plain-line rates are too noisy); recorded, graded and counted in the live rule list as "BOUGHT TOTAL · 2 pts / 4 pts".
- Polymarket lists 20-40 total lines per game (2-point steps, 1-point on some), `lib/poly.js` now keeps the ones within 6 points of the main total with a two-sided book and a 10-90c price as
  `talts` (stored with the spread alternates in `alts:<season>:<week>:<game>`, read by `lib/week.js` and the kickoff recorder in `pages/api/snapshot.js`; older than 3 h -> no pick).
  Tested but NOT used: choosing the side by size (Over if total <= 41), by line move, by day/night (night Under 57.7% at 2 points vs Over 54.3%; day the reverse -- small samples).

## SHORTEST POINTS, EITHER SIDE (10/14) -- PARTLY SUPERSEDED 10/15: books 4, 6, 6.5, 7.5 tiers removed (8 tiers left); the tiers now only NAME THE SIDE, the bought line is chosen by cushion (see CARD v2)

- Rule (owner): take the FEWEST points that still hold up (56%+, closing and opening line), on whichever side, favorite or underdog; never more than 3.5. `BUY_TIERS` is now 12 tiers
  (`lib/stack.js`; each carries its own day / night / opening / plain rates): books 1 dog +3.5, 1.5 dog +3.5, 2.5 dog +3.5, 3 dog +3.5, **3.5 dog +5.5 (2 pts; 55.9% close day, 63.2% open) -- OR favorite -2.5 (1 pt,
  `BUY_ALT`; 59.8% close, 51.9% open): the higher card % wins**, **4 fav -2.5 (1.5 pts; 62.5% close, 59.1% open; it was falling by period 78/64/58/53 -- watch it)**, 4.5 fav -2.5, 5.5 dog +7.5,
  **6 dog +7.5 (1.5 pts; 58.1% / 56.1%)**, **6.5 dog +8.5 (2 pts; 62.4% / 63.6% -- the old +9.5 won exactly the same, the third point added nothing)**, **7.5 fav -5.5 (2 pts; 58.6% / 55.6%)**, 13.5 dog +14.5.
  Removed: books 3.5 dog +6.5 and books 6.5 dog +9.5 (3 points). Fav text now "BEAT THE <key>" with the key number (3, 6). `tests/accuracy.mjs` replays every candidate (closing and opening line).

## 100% ACCURACY AUDIT (10/14, owner: "build now"; on the work branch, NOT merged until "merge now")

- Every number on 14 game pages, 84 TD rows, 56 same-game parlays, cross-game parlays, Bets sums and Parlay of the week was recomputed outside the app and matched. Math library fuzz: ncdf err 2e-7, odds conversions exact, cover-shift never broke an invariant (4000 cases).
- Fixed: stored tier numbers had drifted from real history -> regenerated from nflverse, and `npm run accuracy` now has an exact "TIER NUMBERS" check (stored hit % and n must equal the replay; 78 of 78 ok). LINE MOVE spread/total, INJURY and MIDDLE constants recomputed the same way (spread tiers 63.5/587 and 60.3/239, total 66.1/460, INJURY 56.5/260).
- Fixed wording: "1 players" / "1 picks" (`plural`), same-game chance now "about N in 10" / "1 in N" (`sgpChance`), TD rows below 55% round down (`tdPct`), spacing between tile chips.
- Fixed Bets tab: a lost account bet showed -111.9% because a stale cost was used; settled bets now use the resolved cost/shares (`lib/mybets.js`).
- Known gaps (not fixed): market win % is ~2 points off in the 50-60% and 70-80% bins; BEAT THE tier "3.5 dog +5.5" shows 56.2% (borderline green); "100%" cannot be proven for predictions, only that the code does what the notes say.

## FULL PASS 2 (10/14, owner: "build now" -- finish every check; NOT merged until "merge now")

- Win % calibration re-tested (7,046 games 1999-2026, each season unseen): the 2-point gaps in the 50-60% / 70-80% bins are inside sampling noise (1 standard error ~1.3 pts); a refit (3 or 4 terms) is NOT better than the current formula (log loss 0.6123 vs 0.6124-0.6125) -> left as is.
- Recent-period watch (all games, closing, 2020-25): books 4 fav -2.5 53.1% (64), books 7.5 fav -5.5 52.7% (91), books 3.5 dog +5.5 54.0% (161) -- all pass the "every period 52%+" bar but are weak lately; card shows the lower of close/open only. Owner's call whether to show a recent-years rate too.
- Browser pass on the new front end: all 14 game pages, Lines, TD, Bets, Models, Model Picks, Alerts (bell) -- 0 page errors, 0 "undefined/NaN" lines; damaged-data run 0 issues. Countdown 1d 1h 7m matched the real kickoff time; kickoff times vs America/New_York for 15,288 date/time combos (2010-35): 0 wrong. Fuzz: 60,000 random/junk inputs through keyNumberPick + grading (0 bad, 0 crashes, max 2.5 pts bought), 60,000 through totalBuyPick + grading (0 bad). Grading audit already compares the real 2025 season to an independent Python build (285 games). TD 2+ formula (1.044) matches the service.

## CARD v2 + OPTION 3 + LAYOUT (10/15, owner: "build now"; on the work branch, NOT merged until "merge now")

- **Why:** the owner pays for every bought point ("I want money, buy less points"). 1 point at books 1 / 1.5 / 4.5 wins only 52-54%, 2 points 63% -- the jumps come from crossing 3 and 7. So points are only bought when
  the line's win % beats its Polymarket price. The 56% bar was Claude's own early cutoff (not the owner's); the real bar is the price.
- **Game page, spread and total cards (`lib/cardpick.js buildCard`, shown by `public/app.js cardBody`):** `Model: <number>` / `PICK: <side at Polymarket's own line> · win %` / `PICK w/ POINTS: <bought line> · win %`.
  Everything else (the rule's reason, "Rules split", every buyable line with points, win %, price and cushion, the PICK's price) is under MORE. Removed from the card: the underdog rows, this rule's record, the cost warning.
- **CUSHION = win % - Polymarket price.** Colors (PICK and PICK w/ POINTS): green +3 or better, light green 0 to +3, yellow below 0; no price posted -> the old 56% / 53% lines. PICK w/ POINTS = the line with the best cushion
  among lines up to **3.5 points** better than Polymarket's main line (fewest points on a tie); none when no line has a positive cushion, the saved alternate prices are 3+ h old, or no price is posted ("none beats its price" / "no prices posted yet").
- **Side:** the best-tested rule pick (BEAT THE 3 tiers, LINE MOVE, INJURY, BOUNCE BACK, BOUNCE BACK DOG, TOTAL MOVE), else the chooser's side (owner 10/15: "the chooser's side"). A BEAT THE rule names the side only: the PICK is on Polymarket's own line
  (never the bought +3.5) with the line table's win % there. BEAT THE tiers left: books 1, 1.5, 2.5, 3, 3.5 (dog +5.5 or fav -2.5), 4.5, 5.5, 13.5.
- **Win rates for ANY line (`lib/linetable.js`, data `lib/linetable_data.js`, built by `tests/linetable_build.mjs` from nflverse, 6,967 games):** counts of the favorite's margin per books number (spreads) and of final total - books total (totals), in three groups: closing 1999-2025,
  opening 2014-2025, closing 2020-2025 (recent years); day / night when the group has 60+ games. The rate shown is the LOWEST of the three groups, never below the plain pick's own %. `npm run accuracy` rebuilds the table and FAILS if one count differs ("LINE TABLE").
- **Real prices vs history (10/15, last night's Polymarket prices, 14 games, both sides):** bought lines cost MORE than they win on average (closing-only history: 1 point -2.9, 2 points -2.5, 3 points -1.9 cents; totals -2.0 / -1.6 / -2.0; main lines about fair at -0.6 / -0.7); only 18-26% of
  bought spread lines and 17-33% of total lines had a positive cushion (5-13% with the lowest-of-three rate). So "none beats its price" will be the usual answer -- that is the app being frugal, not broken. Past Polymarket alternate prices are not saved anywhere (only the latest `alts:` copy), so money on past seasons can't be tested.
  From now on every PICK and PICK w/ POINTS is recorded with its price, so Models shows W-L AND money per $100.
- **Recorded + graded:** ids `cardpick|spread` / `cardpick|total` (PICK) and `ptspick|spread` / `ptspick|total` (PICK w/ POINTS) go through `recordStack` (kickoff, `pages/api/snapshot.js`) and `noteFirstSeen` (first shown), graded by `gradeStackWeek` /
  `gradeFirstSeenWeek`; the Models tile "Spread / Total picks" counts the PICK from week 6 on; after kickoff the card shows both locked picks with W / L (`lockedFor`). Models -> "Picks recorded and graded" lists every saved pick id (saved / graded / W-L / money).
- **Parlays and Best bets use the PLAIN line only** (`plainLeg` in `lib/cardpick.js`): Best bets / Parlay of the week / 4-leg favorites / same-game legs are the card's PICK at Polymarket's own line, green = cushion +3 or better (no price: 56%+), best cushion first.
  The ONLY parlay with bought lines is the new **"4 legs · my style · bought lines"** (`sgp_style_pts`, $5, per game, needs at least one points leg, saved and graded like the others): spread and total on PICK w/ POINTS where there is one + the top TD each team.
- **Layout:** tab bar order Game Lines, Anytime TD, Bets, Alerts, Model Picks, **Models (far right)**. Model Picks: two drop-downs side by side (Same game 2 legs, 3 legs; their lists open full width below), then stacked: Same game 4 legs, 4 legs · my style,
  4 legs · my style · bought lines, 4 legs · different games. The **parlay scoreboard moved to the Models tab** (first section, closed until tapped), followed by "Picks recorded and graded".
- Tests: 332 site checks (card, line table, parlay legs, record+grade end to end), grading audit 4,124, service checks, accuracy (TIER NUMBERS 54 of 54, LINE TABLE exact). Browser pass on the new front end with a fixture that has invented alternate lines (live slate JSON does not carry them): 0 page errors.

## LAYOUT v3 (10/15, owner: "build now")

- **Parlay lists (Model Picks lists, game page, 4 legs across games):** ONE card per opened list, the games in kickoff order (morning to evening), parlays TWO ACROSS in small type, every block identical: `ARI @ LA · 67%` (game name, then its hit %), `• leg · %` lines (bought-line legs add `· N pts`), `PL: 1.7x · $20 → $33` (`PL: —` with no price). No notes, no "hits ~", no "filled", no rule tags (`pBlock` / `plPay` in `public/app.js`; CSS `.pgrid`, `.par`, `.pbh`, `.pbl`, `.pbp`; `.pb` is the old bar-chart class, don't reuse).
- **Model Picks buttons (`sgpCards`):** two columns -- left: Same game 2 legs, 3 legs, 4 legs, 4 legs · different games; right: 4 legs · my style, 4 legs · my style · bought lines. A tapped button opens its list under the buttons.
- **Models tab:** NO cards. Section headers are bold uppercase with a line under them (`.fold`), sub-headings have a thin line, rows are plain label / value pairs TWO ACROSS (`#models .drop.open` grid); long multi-line rows (System "Recorded this week") run full width. The four top tiles (Moneyline, Spread picks, Total picks, Line value) stay as tiles (owner 10/15: "who told you to remove this?"). Color only where it is needed: W-L records by rate (`paint` no longer colors ranges like "10-20%"), money, on target / too high, all clear / saved / none. The parlay scoreboard is the first section (closed). Section 3 starts with "Card picks" (PICK / PICK w/ POINTS, spread and total: W-L, %, money per $100; `COMBOS.cardRec`). Section 4 Touchdowns = three plain lists (Chances vs results, Top scorers, Vs Polymarket: Accuracy, Yes bets, No bets). The "Picks recorded and graded" list was removed.
- **Removed notes:** Bets "mixed time slots" warning, scoreboard footnote, section blurbs (`mSec` has no meaning argument), page subtitles, `plainNote` / `costNote`, "Lines you could buy" header.
- Tests: 331 site checks, grading audit 4,124, accuracy ok (LINE TABLE exact); browser audit and damaged-data run 0 errors.

## MODEL PICKS v5 (10/15, owner: "build now")

- **Model Picks tab:** NO button cards. Week chips at the top (`#lab-wk`, current week first), six sub-tabs docked above the bottom bar (`#lab-sub`: 2 legs, 3 legs, 4 legs, My style, Bought, Diff), and ONE list for the chosen type, one column, kickoff order.
  Block (`pBlock`, also used by the game page): `[logo] ARI @ [logo] LA · 67%` on the left, the PL line top right in blue with the Polymarket logo (`PL: 1.7x · $20 → $33`, `PL: —` with no price), legs `✓ won / ✗ lost / • pending  label · %` (bought-line legs add `· N pts`), `✓ Won` / `✗ Lost` bottom right.
- **Data:** the current week uses the live slate (`g.sgp`, `S.fourLeg`); once a game has started its saved copy (with results) is used; past weeks come from `/api/modelbets` (every saved parlay this season by week and type; `recordSgp` now saves `kickoff`). Past weeks fill up from week 6 on (same-game parlays were first saved 10/14).
- **Bets tab:** layout unchanged; team logos added next to team names (`logoLabel`, `legName`, `tdTeam`: a touchdown leg gets its player's team logo only when the player is found once in this week's TD lists). Model Picks stays its own tab (owner: "keep the Bets layout as is"); an open question is whether to combine both under Bets with a toggle.
- Tests: 333 site checks, grading audit 4,124, accuracy ok; browser audit 0 errors (logos do not load in the sandbox, the app hides a failed logo).

## ONE BETS TAB (10/15, owner: "build now ... merge now")

- Model Picks is no longer a tab. The **Bets** tab has a toggle at the top (`#bets-sw`): **My bets** on the left (the list exactly as before, week chips docked above the bar, team logos added) and **Model bets** on the right (week chips at the top, the six sub-tabs docked above the bar,
  the one-column parlay list described in MODEL PICKS v5 above). The choice is remembered (`localStorage betsView`, `BETSVIEW`, `applyBetsView`). Bottom bar: Game Lines, Anytime TD, Bets, Alerts, Models.
- Tests: 333 site checks, grading audit 4,124, accuracy ok; browser audit and damaged-data run 0 errors.

- Sub-tab bar (10/15, owner: "clean and crisp"): Model bets sub-tabs and week tabs are a flat strip -- no round pills or borders, equal columns, plain bold text, purple underline on the active one (`#lab-sub`, `#lab-wk` in `public/index.html`).
