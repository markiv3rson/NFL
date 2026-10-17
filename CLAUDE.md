# NFL betting app — notes for Claude

## **THE #1 RULE (owner, 10/14, after Claude broke it again and again): ANSWER FIRST. DO NOTHING UNTIL THE OWNER SAYS "BUILD NOW".**

**1. Answer every question the owner asks, all of them, in short plain words. Then STOP and wait.**
**2. Do NOT edit, build, test, commit, push, merge or delete anything until the owner types the exact words "build now". NOTHING ELSE COUNTS: not picking an option ("I want B", "by confidence", "2 or 4"), not "yes", "continue", "do it", "fix it", not a rule, not anger, not a complaint. (Owner 10/14, after Claude built on "I want option B": "Do not build anything until I specifically say build now.") After answering, STOP and wait.**
**2b. "BUILD NOW" and "MERGE NOW" ARE TWO SEPARATE COMMANDS (owner 10/14). "Build now" = edit, test, commit and push to the work branch ONLY. NEVER create a PR or merge to main until the owner types the exact words "merge now". After building, say what changed and wait.**

**3. If it is not clear what the owner means, ASK in plain words. Never guess and build. Never "fix" something on your own.**
**4. Never undo, redo or clean up your own changes without being told. If you made a mistake, say so and wait.**
**5. When the owner says "build now", build the WHOLE thing in one go, then say what changed.**

Read this first in every new chat. It carries the owner's rules and what has already been tried.

## CURRENT STATE (cleaned 10/15 -- READ THIS FIRST; where an older section below disagrees, THIS wins)

- **OWNER'S STANDING DECISIONS (10/16, final -- do NOT re-raise, do NOT ask again, do NOT "suggest" the opposite):** (1) WIN RATE is the only judge of a pick and its color. Green 56%+, light green 53-55%, yellow below. (2) PRICE / CUSHION is data only. It never picks a line and never colors anything. The owner: "I'm winning anyway. I don't care about the price. If I gotta pay a little bit more, then what the fuck? I don't care." The 10/15 cut of cushion colors was Claude's reading of "I just need to win"; the owner confirmed it 10/16 ("just keep it green"). (3) PICK w/ POINTS = the fewest points (1 or 2) that reach 56% on either side; 1-POINT LINES STAY, on spreads and totals (owner 10/16: "I don't want to skip 1 point lines"). (4) The fallback (best line when none reaches 56%) STAYS. (5) Nothing from the Polymarket real-price replay changes the app; its "candidates" were put to the owner 10/16 and REJECTED. Checked 10/16 against `lib/cardpick.js` (`isGreenPick`, `pickPts`, `PTS_BAR 56`, `RULE_POINTS 2`, `FAR_GAIN 3`) and `public/app.js clsOf`: the code does exactly this.
- **SLATEZZ: ONE SITE FOR NFL + NBA (10/17, owner; see SLATEZZ MERGE below).** No bottom tab bar, no lever. A side menu ("Menu A · Neon") replaces them: NFL (Alerts, Game Lines, Anytime TD, Bets), NBA (Alerts, Game Lines, Bets), then MODEL ANALYSIS (NFL, NBA); the round refresh button at the top of the menu reruns BOTH models. Home (`/index.html`, no hash) = SLATEZZ header + NFL and NBA live lists. Every other page's header = [away logo] vs [home logo] · NEXT GAME · clock. Docked sub-tab strips sit at the very bottom. **Menu Bets (10/17):** Bets heads My bets and Model bets (separate pages `#mybets` / `#modelbets`, both sports); Model bets has its parlay types as menu sub tabs under it, both sports (NFL 2 legs, 3 legs, 4 legs, My style, Bought, Diff; NBA Same game, Bought, Parlay, Favorites -> `#modelbets-<type>`, title "Model bets · 3 legs"; no docked type strip). NFL My bets and Model bets pick the week from a drop-down, NBA My bets and Model bets the day (`.wksel`). Drop-downs have NO box on both sports (owner 10/17: "Don't box this up"): just the bold week / day and its arrow. **NFL Game Lines (10/17):** the game tiles are stacked one per row under the time-slot headers (`linesBySlot`, same slots and `.labslot` look as Model bets; slots in the old order: upcoming, live, finished). **NFL page photo (10/17, owner, option A):** the owner's NFL-logo picture (`public/nfl-bg.jpg`) sits behind EVERY NFL page except home (Raiders) and a game page (team colours): Alerts, Game Lines, Anytime TD, My bets, Model bets, Models (`html.lines-on .pagewm`, `linesBg()`). Cards / tiles / stat tiles and the Model bets parlay blocks over a photo are 80% dark, no blur, and the page photos are darkened more (gradient .68 / .76 / .86) -- owner 10/17: 22% and then 55% were unreadable over the bright NFL logo picture; home boxes and NBA pages too. **Anytime TD cleanup (10/17):** no subtitle; Best TD picks and the main list use one row look (small logo, name + position + tag, game under it, % right; `.tdr`, Best box `.tdbest`); practice status is a short tag (DNP / LP / FP, `practTag`); no big faded logos in the rows; "No · N under" is a small ⚠ next to the price (`.nogap`, the full text on hover); the main list order is unchanged. **NO PILLS (10/17, owner: "I hate all the pill looks"), NFL + NBA:** Injuries ▾ / History ▾ (`.tag`), ← Games (`.back`), Mark all read (`.phbtn`) are plain text; injury alerts show just the team logo (`.injb`, no red circle / badge); player tags (RB, WR, DNP, Q, OUT, RETURNING) are plain coloured text; the menu shows just the icons, no rounded squares, and the open page is white bold text (no highlight pill). Do not bring pills back. **10/17 last pills removed (both sports):** tile / game-page capsules (`.chip`: London, CHI -1.5, LIVE, PRESEASON), the LINE MOVES strip (`.mv`), buttons (`.btn`: Sync account, Export data, Show top 8), tab chips (`.chips button`: Futures tabs, game-by-game weeks -> plain text with a purple underline on the open one), every `.pill` tag (Early estimate, Q / OUT / D). The gold dashed Best bets / Parlay tickets stay (owner never asked). The menu button (☰) has no box either. **Fits the iPhone (10/17):** header clock scales with the screen (`clamp(20px,6.8vw,32px)`, smaller logos and label), parlay text a size smaller under 500px, drop-down arrow sits AFTER the text (`.wksel::after`), checked at 375 / 390 px wide: nothing runs past the edge on any page, both sports. **Menu groups (10/17, owner):** Alerts has its kinds as sub tabs (NFL All, Injury, QB change, Line move, Weather, Result, TD No, TD jump, QB TD; NBA All, New pick, Line move, Injury, Result -> `#alerts-<kind>`, `alSlug`; the docked kind strip is gone). Alerts, Bets and Model bets OPEN AND CLOSE their lists (each kind shows its own unread number on its line, the total stays on Alerts; ▾ right after the name, closed to start; tapping them only toggles, the sub tabs open pages; `.mtog` / `.msubs` in `public/shell.js` / `shell.css`). **NBA Game Lines photo (10/17, owner):** the owner's Kobe photo (`public/nba/lines-bg.jpg`, in colour) behind EVERY NBA page (Alerts, Game Lines, My bets, Model bets, Models), same darkening and 80% dark tiles as NFL (`linesBg()` in `public/nba/app.js`, `html.lines-on` in `public/nba/index.html`); an NBA game page keeps its team colours. The menu shows "Last model refresh · <newest of NFL / NBA>" (`/api/lastrun`). **Home photo + icon (10/17, owner):** the Raiders photo (`public/home-bg.jpg`, black and white) sits behind the home screen only (`html.home-on::before`, darkened), the NFL / NBA home lists are see-through boxes over it (`.hsec`, 80% dark, no blur -- owner 10/17: frosted 48% "don't look transparent", then 22% was unreadable); the same photo cropped square on the helmet is the app icon (`apple-touch-icon.png`, `icon-192/512.png`, `?v=3`; one icon for the whole site).
- **BUILD 10/17 late (owner: "Do everything else except 10 11 12 ... Build now" + "Everything together. Build now" + "Finish all. Build now"; work branch, NOT merged):**
  (1) **NBA My bets lists a combo's legs** like NFL (`nba/lib/mybets.js isAcctCombo / nbaLegs / comboPicks / markLeg`: a caoc- / crossd- combo whose legs are all `nba-` games is an NBA bet, legs kept in the ledger, labeled "GSW +4.5" / "DET ML" / "Over 221.5", unmarked legs graded from ESPN finals; `public/nba/app.js legRow`: ✓ / ✗, logo, green / red). NBA bets stay OFF the NFL list (`lib/mybets.js isNbaBet`).
  (2) **Prop model injury input** (`railway-model-service/prop_model.py _vacated`): `vac_tgt` / `vac_car` = targets / carries a game of the team's regulars (4+ targets or 8+ carries) who played one of the last 2 games but not this one; live, the week's Out / Doubtful list removes those players from the rows (`live_rows_many`, `chances_many`) so teammates' numbers rise. Walk-forward 2021-25: receiving-yards miss in those games +1.07 -> +0.10 yards, Brier 0.21423 -> 0.21374; Unders 65-80% in those games said 73 won 70.7 -> 71.8. Model file `prop_model_v2.pkl` on the Railway volume, built in the background when missing (~10 min; `/prop-probs` answers 503 "building" until then), rebuilt Tuesday 5 AM PT (`scheduler.py _build_props`). New routes `/prop-probs`, `/player-stats`, `/build-props`.
  (3) **Props page** (menu: Bets -> My bets, Model bets, **Props**, both sports, `#props`; owner option A): NFL = receiving-yards UNDERS the model gives 65%+ (`lib/props.js PROP_PASS`: bands 65-70 / 70-80 / 80-90 / 90-100; research: 73.0% on 152 real lines), rows `[logo] Player · Rec Yds Under 54.5 · 73% · 48¢` under the kickoff headers, week drop-down, RECORD tile (W-L, % won), ✓ / ✗ green / red once graded (`/api/props`, `propsForWeek`, `propsRecord`); the rerun asks Railway `/prop-probs` for every recorded receiving-yards line with the week's Out list and saves `propmodel:<s>:<w>:<game>` (last copy before kickoff = the locked one), `gradePropsWeek` runs with the week's grading. NBA Props page exists and shows "None yet." (Polymarket US lists no NBA player props). Checked end to end locally: BAL @ CLE 40 lines -> 31 answered, 14 Unders 65%+, the Out player skipped.
  (4) **PARLAY LAB** (see the section below): nothing beats Polymarket's price steadily on 2014-25; two risky builds held 6 of 7 seasons and were ADDED to Model bets: **Upset** (same game: underdog ML + its lead RB TD, `sgp_upset`, $5, hist 17.6%, menu sub tab "Upset", also on the game page) and **4 most likely TD scorers** (one per game, `leg4_td4`, $5, hist 17.7%, under Different Game Parlays). Saved and graded like the others.
  (5) **LEGS review** on the Models parlay scoreboard: every graded leg this season by kind (TD / Spread / Moneyline / Over / Under: W-L, %) and how many parlays each kind lost (`paperSummary` -> `legs`, `killers`; `legKind`).
  (6) Reminders set (scheduled tasks): NBA backup first run (10/18 12:40 AM PT), live in-game lines (Sun 10/18 10:50 AM PT), NBA real parlay prices (10/20 3:30 PM PT). (9) The Odds API historical month needs the owner to buy the plan (~$30) and add the key.
  Tests: 405 NFL, 293 NBA, grading audit, service, accuracy; browser pass 390 / 1440 px every page incl. #props and #modelbets-upset, 28 game pages: 0 errors.
  **Phone menu (10/17, owner, after 4 tries: "remove all this extra space and make everything a little bigger ... everything fits, take out all that extra space"):** `public/shell.css @media (max-width:500px)`: the drawer is 236 px wide (62vw), ends where its last row ends (`bottom:auto; max-height:100dvh`, rounded bottom corner) so the page shows beside AND below it; NO gap before MODEL ANALYSIS (`.mspace` no longer stretches); rows 40 px / 16 px text, sub rows 34 / 30 px, logo 30 px, buttons 34 px. Checked 390 x 844 with both Bets lists open (746 px tall, fits) and 375 x 667. Computers unchanged (full-height 318 px drawer). Owner rejected the in-between versions (narrower drawer, smaller text, flush-left padding): what bothered him was the empty space, not the width.
- **[SUPERSEDED same day by REAL POLYMARKET PRICE ON TAP]** **Parlay payout counts the same-game links (10/17, owner chose C):** the PL line was the legs' prices multiplied (NO ML + Over 46.5 + D.Vele TD + J.Johnson TD showed 62x; Polymarket's combo paid 33.92x). Now payout = 1 / the prices run through the same link math as the chance (`lib/combo.js comboPay`, page `linkedPay` in `public/app.js`, tests check they agree): that example = about 34x. Legs in different games: still the prices multiplied. Links that work against each other (a TD with the Under, a TD vs the other team's cover) raise the payout. Graded money (`lib/paper.js` ret) uses it too. Real Polymarket combo quotes (B): Polymarket US has an RFQ system, but a quote is a trade request from the owner's account to market makers and the sandbox cannot reach polymarket.us -- not built, needs the owner's OK. NBA checked 10/17 (owner: "fix both"): nothing to change -- its parlays are spread + total of one game (measured independent, link 1.00, nba/CLAUDE.md) or legs from different games, so multiplying the prices is already right there.
- **REAL POLYMARKET PRICE ON TAP (10/17, owner: "I need the real price", option 1):** tapping a parlay's PL line (before kickoff, 2+ legs) calls `/api/comboquote` (`lib/comboquote.js`): each leg -> its Polymarket US market + side from the game's event (`gateway /v1/events/slug/nfl-<away>-<home>-<ET date>`; "TB +2.5" = SIDE_SELL of "PIT -2.5", Under = SIDE_SELL), `POST /v1/combos`, wait 1.1 s (1 request a second), `POST /v1/rfqs` {symbol, cashOrderQty: stake, restRemainder: false}, read quotes (`GET /v1/rfqs/quotes?rfqId=`; the requester BUYS at a quote's `buyPrice`, and `buyQtyDecimal` = shares the stake buys, fee included; best = most shares; payout = shares / stake -- live PIT @ TB check: 16 quotes, best 0.061 -> 147.37 shares = 14.74x, Polymarket's app 14.79x minutes earlier), ALWAYS `DELETE /v1/rfqs/{id}`; NEVER accepts (no accept call exists). Payout = 1 / (price + fee), fee per share = p (0.12805 - 0.2657 p), fitted on the owner's 5 bought combos (Saints 33.92x exact; all 5 within a cent). The line then shows Polymarket's real payout; a failure leaves the line as it was (reason in the tap's tooltip). Before a tap the line is the estimate: links where legs HELP each other only (Polymarket pays nothing for legs that work against each other) x 0.977 cut (`lib/combo.js comboPay` / page `linkedPay`; both owner quotes within 3%; graded parlay money uses it, grading fixture updated). `?raw=1` on the route returns every Polymarket reply. Network: api.polymarket.us + gateway.polymarket.us allowed in this environment 10/17; docs.polymarket.us still blocked (request fields came from search summaries of the docs: combos legs {symbol, side SIDE_BUY/SELL}, RFQ cashOrderQty / restRemainder, DELETE /v1/rfqs/{id}; the quote-read path is tried 3 ways).
- **POLYMARKET US EVERYWHERE + 15-MIN PRICES (10/17, owner: "it needs to match my app", option B, NFL + NBA):** every Polymarket line and price (main spread / total / moneyline, alternate lines, TD prices, prop recording, order books) is read from Polymarket US (`lib/polyus.js`: `gateway.polymarket.us/v1/events?tagSlug=nfl|nba` lists the games, `/v1/events/slug/<slug>` holds each game's markets, `/v1/markets/<slug>/book` the book; each market turned into the gamma shape `lib/poly.js` / `nba/lib/poly.js parseGame` already read; buy price = ask, other side = 1 - bid). The international site (gamma) listed other alternates (card showed Under 56.5; the owner's app has 55.5 / 57.5). NBA futures read Polymarket US too (10/17, owner: "switch it"; `nba/lib/futures.js usFutures`: champion, conference champions, #1 seeds, playoff qualifiers, win totals "51+ wins" = Over 50.5; Polymarket US has NO play-in market, so that section shows the model only; its playoff and win-total books were nearly empty on 10/17). The 15-min pull saves each game's newest main line (`polynow:<s>:<w>:<game>`, 4 days) and the slate shows it when newer than the last snapshot and it passes the snapshot data check (`lib/week.js`); snapshots, history and alerts unchanged. Parlay quotes stay every 5 min. TD prices: a player no longer listed drops out at the 15-min merge. **Bets TD legs (same day):** real name + team from the game's Polymarket US event (`lib/mybets.js usPlayerNames`, `usnames:` 6 h; "ladmcc" -> Ladd McConkey, LAC logo; 2+ / 3+ legs and Jr. / III names get logos). **KC logo** = the owner's logo (`public/kc.png`) on every page and home.
- **FULL PASS 10/17 night (owner: "run through everything ... check back ups ... holes ... models ... props research ... build now"; work branch, NOT merged):** live checks against Polymarket US: all 157 card rows (line + price), every main spread / total / moneyline and 261 TD prices match within 3-4c; all 233 parlay legs map to a real Polymarket US market (quotable), estimates = `comboPay`; background quotes live (HOU @ JAX 2 legs 3.70x real vs 3.78x estimate, 3 legs 6.23x vs 6.47x); every card internally consistent (PICK = its row, PICK w/ POINTS = a row and the fewest points reaching 56%); all 32 NFL / 30 NBA Polymarket US team codes map; headless browser on every page + 28 game pages at 390 / 1440 px: 0 errors, no undefined / NaN; status clean (Railway, pull, 11.6 of 30 MB). FIXED: **NBA had NO backup** since the move (NFL backs up nightly) -> `pages/api/nba/backup.js` (paged like the NFL's) + NBA scheduler 12:10 AM PT `_backup` (file per night on the NBA volume `MODEL_DIR/backups`, last 30 kept) + NBA System row "Last backup" + watchdog line when missing / 36 h old / failed; NBA game list now looks 10 days ahead (All-Star break) and reads only the first 3 game days, 8 at a time (`nba/lib/poly.js`); a TD market nobody is selling has no price (it showed the bid; `lib/polyus.js`); week-5 TD legs saved without a game get their team from that week's TD lists (`lib/mybets.js tdTeamFromModel`); NBA model-side rate updated to the 10/17 rebuild's own report 49.4% spread / 50.4% total on 2,462 games (was 50.3 / 50.5 on 1,783; `nba/lib/cardpick.js MODEL_HIT`). Props research results: PLAYER PROPS RESEARCH 2 below.
- **MODEL BETS OVER/UNDER + ORDER + FRIDAY-MORNING PRICES (10/17, owner):** Model bets (NFL only; owner: NBA no) tabs, in this order and with these names: **Over/Under, 4 Leg (My Style), 4 Leg (Bought), 4 Leg, 3 Leg, 2 Leg, Different Game Parlays** (`LAB_TABS` in `public/app.js`, `TYPES.nfl` in `public/shell.js`; hash keys unchanged: ou / style / pts / 4 / 3 / 2 / diff; opens on Over/Under). Over/Under = each game's total PICK at Polymarket's main line AND its total PICK w/ POINTS (owner: option C), stacked by game under the kickoff headers, line · win % · Polymarket price, ✓ / ✗ from the picks locked at kickoff; this week only (`ouLegs` / `ouBlock`); no payout line or quote (single bets). Background prices in two speeds (`refreshQuotes`, `AHEAD_H`): games within 12 h every 5 min; further out every 30 min (cached 40 min) up to **4 days for NFL** (Sunday / Monday parlays have real prices from Friday morning) and **1 day for NBA** (owner).
- **WIN CHANCE + COIN-FLIP DATA CHECK (10/17, owner: "fix bug 2 & 3", NFL):** the market's win chance on the tile and game page now comes from Polymarket's MONEYLINE with the fee taken out (`mktHome` in `public/app.js`: home price / (home + away)); the spread's % (`g.winPct`) is only the fallback (it read NO 56% in NO @ NYG while the moneyline said 50/50). `g.winPct` itself is unchanged (parlay legs / winners use it). The snapshot data check no longer calls a favorite flip in a coin-flip game a jump: both readings within 1.5 of pick'em (NYG +1.5 -> NYG -1.5) is not a jump (`lib/sane.js spreadJumped`); real 3+ point moves are still held.
- **BACKGROUND + NBA (10/17, owner: "refresh in the background all the time. I need this for the nba also"):** every slate build saves the parlays on its pages (`cq:parlays:nfl` in `pages/api/slate.js`, `cq:parlays:nba` in `nba/lib/slate.js`, via `saveParlayList`); the NFL Railway scheduler calls `/api/comboquotes?sport=nfl` and `?sport=nba` every 5 min (:02, :07, ...), which re-quote the parlays whose price is older than 4 min (games starting in the next 12 h -- owner 10/17 option 2, sized for the Vercel free plan: about 60-100 of its 360 GB-hours a month; the site itself used ~50 -- oldest first, 3 at a time, 40 s budget; `refreshQuotes`). Quote cache 7 min (`QUOTE_TTL`). NBA: same Polymarket US flow (`nba-<away>-<home>-<ET date>`, `basketball_team_full_game_*`, codes GSW=gs NOP=no SAS=sa NYK=ny PHX=pho; checked on BOS @ DET), NBA page auto-fills via `/api/nba/comboquote` (`public/nba/app.js plAuto`). The quote cache and the 1-a-second slot live in the NFL database for BOTH sports (one Polymarket account = one limit). Last run: `cq:last:<sport>`. Watch Vercel function usage (Hobby plan): each 5-min run can take up to ~45 s per sport.
- **PRICES UPDATE BY THEMSELVES (10/17, owner: "I need it to update automatically"):** no tap needed: every PL line on the open page asks for its real quote by itself, one parlay after another, and again every 3 min while the page is open (`plAuto` / `plQuote` / `plShown` in `public/app.js`; quotes kept per parlay in `PLC`, so a page redraw keeps the real price). A tap asks again right away (`fresh`). Server (`lib/comboquote.js`): a quote is shared 2.5 min for every phone (`cqq:`), the parlay's Polymarket markets + combo symbol a day (`cqs:`, so a refresh = ONE quote request, no 3 MB event download), every Polymarket write waits for a free 1.1 s slot (`cq:slot`). First fill of a page: about 3 s a parlay; refreshes about 2.5 s each.
- **"crossd-" combos (10/17, owner: "why can't I see my legs"):** Polymarket now names some account combos "crossd-..." (older ones "caoc-..."); the Bets tab read legs only for "caoc-", so these showed the code, no legs and "Time unknown". Both are read now (`lib/mybets.js isAcctCombo`: leg save, picks, grading, `/api/combolegs`); the new moneyline leg type "aec-..." shows as "NO ML" (logo) and is graded from the final score (`markFromFinals`). Checked on the live account data: all 3 crossd combos list their 4 legs.
- **Tabs (old, replaced 10/17 by the menu):** Game Lines, Anytime TD, Bets, Alerts, Models. Model Picks is not a tab: it is the right side of the toggle at the top of Bets (My bets | Model bets).
- **Spread / total card:** `Model: <number>` / `PICK: <side at Polymarket's own line> · win %`. Under MORE: `PICK w/ POINTS` first, then ONE list with both teams (totals: Over AND Under) at main, 1 and 2 points; a 3rd point only if it beats the best line within 2 points by 3+ win points; 4 points never. The chosen row is green across; nothing else is green in the list. Same rules on every game.
- **PICK side:** a tested rule (BEAT THE tiers, LINE MOVE, INJURY, BOUNCE BACK, BOUNCE BACK DOG, TOTAL MOVE); with no rule it is the model's side at the main line (`modelpick|`, 50.6% spreads / 51.7% totals, yellow, its own record row "MODEL SIDE", NEVER counted in the rules' record, the weekly recap or Final alerts). The chooser was REMOVED 10/16 (with the scanned combo table); old `chooser|` rows stay in the records as history. BEAT THE tiers (14) only name the side.
- **Colors:** by WIN RATE only -- green 56%+, light green 53-55%, yellow below. Price/cushion is data, never a color or a reason. No notes, warnings or footnotes.
- **Win rates for any line:** `lib/linetable.js` (all games, no day/night split; lowest of closing 1999-2025 / opening 2014-25 / recent 2020-25). **SPREADS ARE SHRUNK (10/16):** each group's rate is pulled toward the same side + same cushion pooled over every books number (as 200 extra games, `SHRINK_K`) before the lowest is taken -- tested leave-one-season-out, the card's chosen PICK w/ POINTS now says 59.0% and wins 59.5% (it said 59.7% and won 57.8% unshrunk; favorites said 61.7% and won 56.6%). Totals are not shrunk (said 56.3%, won 57.4%). Examples now: books 3 dog +3.5 54.6% (was 55.3), 4.5 fav -2.5 58.3% (was 63.8), 13.5 dog +14.5 57.1% (was 63.9), 2.5 dog +3.5 56.2% (was 56.9), 4 fav -2.5 54.4%. The recent group counts from 60 games (opening 200, closing 40); at 200 it counted for only 1 of 15 BEAT THE tiers. Recent 2020-25 rates (10/15): books 4 fav -2.5 53.1% (64), books 7 fav -5.5 51.1% (88), books 7.5 fav -5.5 52.7% (91), books 3.5 dog +5.5 54.0% (161) -- now shown on the cards; samples are small (1 standard error ~6 pts). Day/night rates in older sections are gone.
- **Records / ids:** `cardpick|`, `ptspick|`, `modelpick|` plus each rule's own id; saved at kickoff and on first show, graded. Parlays use the plain PICK line; only `sgp_style_pts` ("Bought") uses points lines.
- **Alternate prices:** the 30-min Pinnacle pull saves `alts:` (checked live 10/15: every card has 5-7 spread rows, 4-7 total rows).
- **Removed for good:** teasers, wind alert/Under tracker, OFFENSIVE FLOOR tracker, MIDDLE, price-gap, Rules-split warning, cushion colors, "Model Picks" tab, BOUGHT-POINT TOTALS pick, day/night split, **the pick chooser and the scanned combo table (10/16: `lib/chooser.js`, `lib/combotable.js`, `scan` / `train_chooser` in the rebuild, the "300+ combos" publish gate; `lib/stack.js movePicks` = TOTAL MOVE only; `lib/combomodel.js` loads `upgrade` / `early` / `moveT` only and refetches a build without a tag every 15 min)**.
- **Live edges (all that passed testing):** key-number points (BEAT THE), LINE MOVE, TOTAL MOVE, INJURY, BOUNCE BACK (road team missed by 24+ since 10/16, 61.3% on 261), BOUNCE BACK DOG.
- **Parlay chance (10/16):** `lib/combo.js comboChance` shrinks the product of the positive same-game links (lift product ^0.75, `LIFT_POWER`); drags (TD with the Under, TD vs the other team's cover) stay full. Measured 2021-25 with the walk-forward TD model: ML + Over + top TD said 22.9% hit 20.9% (now 20.9), ML + Over + 2 TDs said 12.4% hit 9.6% (now 10.3), style + Under said 2.6% hit 2.0%.
- **Game model (10/16):** ridge strength `UP_ALPHA = 3000` in `weekly_rebuild.py` (was 30; walk-forward margin error 9.917 -> 9.793, total 10.541 -> 10.409; dry run passed: marginErr 9.944 vs line 9.903, totalErr 10.455 vs line 10.456). `BUILD_TAG` there + `app.py`: Railway rebuilds on deploy when the saved build has a different tag, so a merge brings the new model live the same hour (no Tuesday wait). The game model alone and the chooser are about a coin flip. Week 6 is the first real live test.
- **TD model vs Polymarket (10/16):** `railway-model-service/data/poly_td_closes.csv` + `tests/poly_td_replay.mjs`: 2026 weeks 3-6 Best TD picks (55%+) 12-2 at 63c; all priced players Brier 0.184 vs market 0.188 -- the TD model beats the market so far. INJURY EARLY shadow tracker live (Models -> Tracked angles). Model bets list has time-slot headers; every parlay leg has a logo; computer screens use the full width; finished cards go green when the PICK won; FINAL under the score on the tile.
- **Polymarket real prices (10/16):** `railway-model-service/data/poly_closes.csv` holds every 2025-26 game market's real closing / early prices (trade log); `tests/poly_replay.mjs` replays the card on them with money per $100. Result: bought points cost about what they win (PICK w/ POINTS spreads 53.5% at 59c = -9.5 per $100, totals 53.6% = -7.3; 1-point total picks 40.2%); nothing changed in the app -- see POLYMARKET REAL-PRICE REPLAY.
- **Process:** nothing is built until the owner types "build now"; merge only on "merge now"; even read-only checks wait for the owner's go.
- **Game page layout (10/16, owner's sketches, built + merged):** the section title sits OUTSIDE the card on its own row with the pills next to it -- "SPREAD & ML" + `Injuries N ▾` + `History ▾`, "TOTALS" + `History ▾` (`secRow` / `headPills`; the drop-downs still open at the top of the card, `headDrops`). Inside each card: `MARKET` header, then SPORTSBOOK (left) | POLYMARKET (right) (`.mk`), then the `MODEL` header and the model lines (Model number, PICK, More) FULL WIDTH under it -- no purple box, no line between market and model, no green "live" dot. Touchdowns = ONE card titled "ANYTIME TD" (`tdTop3`): the top 3 of each team in one list ranked best to worst, team logo next to each name, no team titles; the "First TD pick" line (and the finished game's touchdown line) at the bottom of that card (`.tdfoot`). Same-game parlays below untouched. Sketches: claude.ai/artifact/6D4NwGUfdaHu3xkyaYGSMh.
- **PICK w/ POINTS fallback stays (owner 10/16: "I don't want that"):** when no line within 2 points reaches 56%, the card still names the best line (history: said 55.7%, won 43.2% on 37 games). Do not change it to "none".
- **Full app pass (10/16, owner: "every single file ... fix everything"):** every JS file type-checked (no undefined names, no wrong call counts), Python compiled + pyflakes, every tab and 4 game pages loaded headless with the live slate (0 errors, no undefined/NaN), the Polymarket main-total parser checked against the live market for all 13 games (matches the best live-book line every time), the books pull schedule matches the scheduler, sign-in middleware and deploy config read. Fixed: a failed card-pick save at kickoff was swallowed silently (now logged to System, `pages/api/snapshot.js`); stale watchdog wording ("tap ▶ Rerun model" -> the lever); stale comments in `lib/cardpick.js` / `public/app.js` (chooser era); a dead `isGreenPick(hit, price)` second argument; a dead MODEL-alert branch in `lib/alerts.js`; two f-string nits in `scheduler.py`. Nothing in the picks, grading or numbers was wrong.

## Owner's rules (always follow)

1. **Answer every question first, all of them, before anything else.**
2. **Never build, test, push, merge or delete anything until the owner says "build now"** -- ONLY those words count (an option pick, "yes" or "continue" do NOT). Explaining is fine; acting is not. Don't undo or redo changes on your own either.
3. Short, plain answers. No jargon. **Every spread or line written in a reply carries its + or − (favorite −2.5, underdog +3.5) -- owner 10/15.**
4. Don't add things the owner didn't ask for, and put things exactly where told. **NO explanatory notes, warnings, footnotes, subtitles or "how this works" sentences anywhere in the app (owner 10/15: "I'm the one building it, I understand it"). Show data only. Never add a section, list or card nobody asked for.**
5. Judge bets by **win rate**, never by price/value.
6. Trust small samples. No "luck" filter.
7. "Tests pass" only means the code runs — never say it as if the predictions are right. Give accuracy numbers instead.
8. Be upfront about gaps: say what a model can't see.
9. Phone alerts / login: don't build or ask unless the owner raises it.
11. **DESIGN = BOTH SPORTS, CODE = ONE SPORT (owner 10/17, later the same night): "Any design I do or app layout or app change, NOT THE CODE. Do it for both NFL AND NBA. I want everything to look consistent throughout the app."** Every look / layout / screen change goes on NFL AND NBA together, without asking. (10/17 consistency pass: NBA Game Lines stacked one per row under a header per day with its tip times, `linesByDay`; NBA Model bets headers EARLY / NIGHT / LATE GAMES with tip times, `nbaSlot`; NBA My bets day drop-down, `MBDAY`, settled bets by the day they closed, open bets always shown, "Season" = all.) Only code / data / model / pick changes stay one-sport (the earlier rule: "when I tell you to make an update on one thing, you better not update the other"). An NFL request changes only NFL files (`lib/`, `pages/api/` outside `nba/`, `public/index.html`, `public/app.js`, `railway-model-service/`); an NBA request only NBA files (`nba/`, `pages/api/nba/`, `public/nba/`). The shared pieces (`public/shell.js`, `public/shell.css`, the home screen) serve both. A non-design fix that would also apply to the other sport: ask first ("fix NBA too?").
10. The owner handles Railway settings. Never paste secrets (an Odds API key was once shared in a screenshot — don't repeat it).

## What the app shows (owner's layout rules) [HISTORY -- bullets dated before 10/15 may be stale; where one disagrees with CURRENT STATE, CURRENT STATE wins]

- Tab bar (10/15): Game Lines, Anytime TD, Bets, Alerts, Models -- FIVE tabs; there is no Model Picks tab (it lives inside Bets). Icon over each name, purple/blue, no box.
- Model card: ONE answer — the model's number (purple), then **PICK** — green at 56%+, LIGHT GREEN at 53-55% (owner 10/13), yellow
  below 53% with NO notes (owner 10/13: "too many notes"). Always a PICK, never LEAN. No teasers on cards; market lines only. (The short reason tag was removed 10/15; PICK w/ POINTS and the line list sit under MORE -- see CURRENT STATE.)
- Teasers: REMOVED 10/14 (owner never bets them; code deleted, no longer recorded). The "buy points" idea lives on as BEAT THE 3.
- Best bets = top 10 straight picks at 56%+. Parlay of the week = top 4, one per game.
- Model Picks tab (the old angle / teaser / price-gap parlays were deleted 10/14): parlay types built once a week (first scheduled snapshot within 26 h of the first Sunday kickoff — Sat 7 AM PT
  when the first game is London) and graded. Includes "Best bets · 2/3/4" (= the Parlay of the week). TD parlays may use thin markets (leg says "thin"); the price shown is the ask.
- [CUT 10/15] The "⚠ Rules split" warning (10/14) is gone; when two rules take opposite sides the card shows the higher win rate, nothing else.
- SAME-GAME PARLAYS (10/14, `lib/sgp.js`; current set = 2 legs / 3 legs / 4 legs / 4 legs · my style, see PAGE CLEANUP below): every game page
  shows a "SAME-GAME PARLAY" box at the bottom, below the touchdowns (tab bar: see CURRENT STATE) -- BEST (strong legs: green spread/total 56%+ and TD players 55%+, one per team, ALL kept -- owner 10/14 "we are testing everything":
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
- Referees and price-gap alerts were removed on purpose. Models tab is 8 sections (10/13: "Price gaps" cut, "Records · model's side" cut; "Tracked angles" = the shadow tests in `lib/tracked.js`: Pinnacle LINE MOVE, order-book tilt, INJURY EARLY -- the wind Under and OFFENSIVE FLOOR trackers were cut 10/15). Also cut 10/13: "Hit rate by week" (Trends), the Replay box, the Pick Lab paper singles, bell alerts for MODEL / PRICE GAP / TEASER, the edge tracker and the Action Network pull (all their code deleted 10/14).

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
  * Alerts: [the wind alert was CUT 10/15]. SOS removed from the screen
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

## BUY THE POINTS + fixes A-D (10/14 late, owner: "build now") [PARTLY SUPERSEDED -- see CURRENT STATE]

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
  - Card picks: `lib/stack.js` (rules), `lib/cardpick.js` (the card), `lib/linetable.js` (win % of any line); game model: `lib/upgrade.js`; tracked paper tests: `lib/tracked.js`; week data: `lib/week.js`.
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

## How picks are chosen (Oct 12, 2026 — owner chose "A + B") [SUPERSEDED: the chooser and the combo table were removed 10/16 -- see CURRENT STATE]

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

## KEY NUMBER (Oct 13, 2026 -- Claude's idea, owner: "build now") [PARTLY SUPERSEDED -- see CURRENT STATE]

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

## BOUNCE BACK (Oct 13, 2026 -- owner: "build now") [SUPERSEDED 10/16: cutoff is 24+, 61.3% on 261 -- see CURRENT STATE / RESEARCH DAY 10/16]

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

## Firmer promises (10/14, owner: "build 1 and 3; 2, 4, 5 out") [PARTLY SUPERSEDED -- see CURRENT STATE]

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

## CAP AT 2 POINTS (10/14, owner: "cap it at 2 points ... use fewer points when that is enough") [PARTLY SUPERSEDED -- see CURRENT STATE]

- No pick ever buys more than 2 points (`BUY_TIERS`; a test checks it). Removed: books 1 -> dog +3.5 (buys 2.5) and books 6.5 -> fav -2.5 (buys 4). Kept: books 1.5, 2.5, 3, 3.5, 4.5,
  5.5, 13.5. Each kept tier is already the fewest points that passed (books 1.5 +2.5 54%, 4.5 -3.5 53%, 5.5 +6.5 56% not steady). The line matrix passes a few more cells within 2
  points (books 4 fav -2.5 64%, 6 dog +7.5 58%, 6.5 dog +8.5 62%, 7.5 fav -5.5 59%) but its bar (every period 52%+) is looser than the one the tiers were added under -- not added.
- RARE 3-POINT EXCEPTION (owner 10/14: "3 should be the max but only on rare situations"): a 3-point buy is allowed only where it wins 60%+ at BOTH the closing and opening number
  with every period 56%+ and no cheaper line passes (`tests/line_matrix.mjs` prints the list). Two tiers: books 3.5 -> underdog +6.5 (replaces favorite -2.5, which fell to 52% at the
  open): day 60.9% close / 67.9% open, night 62.1% / 58.3%; books 6.5 -> underdog +9.5: day 62.4% / 63.6%, night 63.6% (66) / 67.6% (37). Card shows the lower. The other 3-point
  cells (books 3 dog +5.5, 2.5 dog +5.5, 4.5 dog +7.5, 4.5 fav -1.5, 1.5 dog +4.5) already have a cheaper tier on that books number -- not added.
- FINAL CAP 10/14 (owner: "cap it at 3.5"): no tier buys more than 3.5 points (test checks it). Books 1 -> dog +3.5 (buys 2.5) is BACK; the old books 6.5 -> fav -2.5 (buys 4) stays out. 9 tiers: books 1, 1.5, 2.5, 3,
  3.5 (dog +6.5), 4.5, 5.5, 6.5 (dog +9.5), 13.5.

## "Without the extra points" line (10/14, owner: "yes show it, build now") [PARTLY SUPERSEDED -- see CURRENT STATE]

- A green bought-point pick now says "Without the extra points it wins about X% · with them Y%." (`public/app.js plainNote`; shown only when the points add 2+ points; not on light-green /
  yellow cards -- owner's no-notes rule). `BUY_TIERS[..].plain` = [day, night] win rate of the same side at the books' own number, 1999-2025 closing, pushes left out:
  books 1 49.3/48.2, 1.5 47.2/58.1 (31 night games), 2.5 52.4/47.8, 3 53.8/46.5, 3.5 50.6/50.0, 4.5 51.4/43.5, 5.5 55.3/51.0, 6.5 53.5/53.8, 13.5 68.0/45.5.
- Chooser side test (10/14, 2,604 games 2014-26, every season unseen): the chooser picking the side then buying points wins no more than always-favorite / always-underdog
  (0 pts 48.5%, 1 pt 53.5%, 2 pts 57.6%, 3 pts 60.5%; books 3.5 + 1 pt: chooser 53.7% vs favorite 60.4%). The points do the work, not the side -> key-number rules decide the side (owner agreed).

## Card cleanup (10/14, owner: "organize the cards, too much noise"; chose A + B) [PARTLY SUPERSEDED -- see CURRENT STATE]

- Spread / total Model card keeps only: the model number, PICK + %, one short reason, and the "Rules split" warning. The without-the-extra-points %, this rule's record, "line moved" and the
  cost warning sit behind a "More" tap (`public/app.js moreBox`, a plain `<details>`). Light-green / yellow cards still have no notes.

## BOUGHT-POINT TOTALS (10/14, owner: "by confidence"; option A) -- REMOVED 10/15 (the card's PICK w/ POINTS replaced it; code deleted; `talts` parsing stays) [PARTLY SUPERSEDED -- see CURRENT STATE]

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

## CARD v2 + OPTION 3 + LAYOUT (10/15, owner: "build now"; on the work branch, NOT merged until "merge now") [PARTLY SUPERSEDED -- see CURRENT STATE]

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

## LAYOUT v3 (10/15, owner: "build now") [PARTLY SUPERSEDED -- see CURRENT STATE]

- **Parlay lists (Model Picks lists, game page, 4 legs across games):** ONE card per opened list, the games in kickoff order (morning to evening), parlays TWO ACROSS in small type, every block identical: `ARI @ LA · 67%` (game name, then its hit %), `• leg · %` lines (bought-line legs add `· N pts`), `PL: 1.7x · $20 → $33` (`PL: —` with no price). No notes, no "hits ~", no "filled", no rule tags (`pBlock` / `plPay` in `public/app.js`; CSS `.pgrid`, `.par`, `.pbh`, `.pbl`, `.pbp`; `.pb` is the old bar-chart class, don't reuse).
- **Model Picks buttons (`sgpCards`):** two columns -- left: Same game 2 legs, 3 legs, 4 legs, 4 legs · different games; right: 4 legs · my style, 4 legs · my style · bought lines. A tapped button opens its list under the buttons.
- **Models tab:** NO cards. Section headers are bold uppercase with a line under them (`.fold`), sub-headings have a thin line, rows are plain label / value pairs TWO ACROSS (`#models .drop.open` grid); long multi-line rows (System "Recorded this week") run full width. The four top tiles (Moneyline, Spread picks, Total picks, Line value) stay as tiles (owner 10/15: "who told you to remove this?"). Color only where it is needed: W-L records by rate (`paint` no longer colors ranges like "10-20%"), money, on target / too high, all clear / saved / none. The parlay scoreboard is the first section (closed). Section 3 starts with "Card picks" (PICK / PICK w/ POINTS, spread and total: W-L, %, money per $100; `COMBOS.cardRec`). Section 4 Touchdowns = three plain lists (Chances vs results, Top scorers, Vs Polymarket: Accuracy, Yes bets, No bets). The "Picks recorded and graded" list was removed.
- **Removed notes:** Bets "mixed time slots" warning, scoreboard footnote, section blurbs (`mSec` has no meaning argument), page subtitles, `plainNote` / `costNote`, "Lines you could buy" header.
- Tests: 331 site checks, grading audit 4,124, accuracy ok (LINE TABLE exact); browser audit and damaged-data run 0 errors.

## MODEL PICKS v5 (10/15, owner: "build now") [PARTLY SUPERSEDED -- see CURRENT STATE]

- **Model Picks tab:** NO button cards. Week chips at the top (`#lab-wk`, current week first), six sub-tabs docked above the bottom bar (`#lab-sub`: 2 legs, 3 legs, 4 legs, My style, Bought, Diff), and ONE list for the chosen type, one column, kickoff order.
  Block (`pBlock`, also used by the game page): `[logo] ARI @ [logo] LA · 67%` on the left, the PL line top right in blue with the Polymarket logo (`PL: 1.7x · $20 → $33`, `PL: —` with no price), legs `✓ won / ✗ lost / • pending  label · %` (bought-line legs add `· N pts`), `✓ Won` / `✗ Lost` bottom right.
- **Data:** the current week uses the live slate (`g.sgp`, `S.fourLeg`); once a game has started its saved copy (with results) is used; past weeks come from `/api/modelbets` (every saved parlay this season by week and type; `recordSgp` now saves `kickoff`). Past weeks fill up from week 6 on (same-game parlays were first saved 10/14).
- **Bets tab:** layout unchanged; team logos added next to team names (`logoLabel`, `legName`, `tdTeam`: a touchdown leg gets its player's team logo only when the player is found once in this week's TD lists). Model Picks stays its own tab (owner: "keep the Bets layout as is"); an open question is whether to combine both under Bets with a toggle.
- Tests: 333 site checks, grading audit 4,124, accuracy ok; browser audit 0 errors (logos do not load in the sandbox, the app hides a failed logo).

## ONE BETS TAB (10/15, owner: "build now ... merge now") [PARTLY SUPERSEDED -- see CURRENT STATE]

- Model Picks is no longer a tab. The **Bets** tab has a toggle at the top (`#bets-sw`): **My bets** on the left (the list exactly as before, week chips docked above the bar, team logos added) and **Model bets** on the right (week chips at the top, the six sub-tabs docked above the bar,
  the one-column parlay list described in MODEL PICKS v5 above). The choice is remembered (`localStorage betsView`, `BETSVIEW`, `applyBetsView`). Bottom bar: Game Lines, Anytime TD, Bets, Alerts, Models.
- Tests: 333 site checks, grading audit 4,124, accuracy ok; browser audit and damaged-data run 0 errors.

- Sub-tab bar (10/15, owner: "clean and crisp"): Model bets sub-tabs and week tabs are a flat strip -- no round pills or borders, equal columns, plain bold text, purple underline on the active one (`#lab-sub`, `#lab-wk` in `public/index.html`).

- Alternate prices (10/15, owner: "go look"): the card dropped Polymarket alternate lines after 3 h because only the scheduled snapshots saved them. The 30-min pull (`pages/api/pinnaclepull.js`) now saves `alts:<season>:<week>:<game>` too, so PICK w/ POINTS sees current prices.

## CUTS + 13 (10/15, owner: "build now and 13"; on the work branch, NOT merged until "merge now") [PARTLY SUPERSEDED -- see CURRENT STATE]

- **Day / night split DROPPED everywhere** (owner: "night games don't really matter"): BEAT THE tiers, BOUNCE BACK (57.2%, 376), BOUNCE BACK DOG (56.5%, 285) and the line table use ALL games (`isNightGame` deleted from `lib/stack.js`; `BUY_TIERS` rates recomputed from nflverse, `npm run accuracy` TIER NUMBERS 27 of 27). Earlier notes above about day / night rates are superseded.
- **Line table:** one histogram per group (no d / n); a group counts only with 200+ games (opening and recent-years groups), the closing group 40+ (`lib/linetable.js MIN_N`).
- **Chooser PICK removed from the card** (`lib/cardpick.js TESTED`): a card shows a PICK only when a tested rule fires (BEAT THE, LINE MOVE, INJURY, BOUNCE BACK, BOUNCE BACK DOG, TOTAL MOVE). The chooser stays in the records. Live check: 10 of 28 cards have a PICK.
- **13: a BEAT THE pick sits on its BOUGHT line** (DEN +3.5, not DEN +2.5), with the tier's tested rate and that line's price; no PICK w/ POINTS on top for those. Other rules keep PICK on Polymarket's line + PICK w/ POINTS.
- **Cut:** wind alert, "Rules split ⚠" warning, OFFENSIVE FLOOR tracker, wind Under tracker, MIDDLE note + tracker (old saved rows are no longer graded or shown). Shadow trackers (Pinnacle LINE MOVE, order-book tilt) stay.
- **Alternate prices:** the 30-min Pinnacle pull now also saves `alts:<season>:<week>:<game>` (the card dropped them after 3 h when only the scheduled snapshots saved them; live check showed 0 buyable lines on every game).
- `noteFirstSeen` now keeps `price`, `points`, `tier`, `key` (rule labels / money of first-shown picks).
- 4 (model's number on the card), 8, 12 not cut; 7 ("4 legs · my style · bought lines") kept, owner wants more research first.
- Tests: 326 site checks, grading audit 4,124, accuracy ok (LINE TABLE exact); browser audit 0 errors.

- **13 UNDONE (10/15, owner: "who told you to change my layout ... put that back"):** the card is back to CARD v2: BEAT THE rules name the SIDE only; PICK sits on Polymarket's own line with the line table's win %; PICK w/ POINTS = best cushion; MORE lists every buyable line up to 3.5 points (1 / 2 / 3 points, each with win %, price, cushion). Points are counted from POLYMARKET's main line (BUF @ LV: main BUF -5.5, books -4.5 -> -4.5 is 1 pt, -3.5 is 2 pts, -2.5 is 3 pts). Never change card layout without the owner saying so. Open: owner asked why buy 2 points when the underdog +1 point could do it -- underdog rows are not on the card (removed earlier at the owner's request); ask before adding.

## CARD LIST BY WIN RATE (10/15, owner: "we are not trying to beat the market, I just need to win" / "1 list with both" / "make the words smaller, one line"; on the work branch, NOT merged until "merge now")

- **Win rate decides, price is only shown.** Colors: green 56%+, light green 53-55%, yellow below (`clsOf`, `isGreenPick(hit)`); the cushion (win % minus price) stays in the data but picks and colors nothing. Best bets sort by win rate.
- **ONE list under MORE with BOTH teams** (spread: both teams; total: Over AND Under): lines 0 ("main"), 1 and 2 points from Polymarket's main line, each `line · pts · win % · price`, sorted by points. A 3rd point appears only when it is rare: 60%+ and no line within 2 points reaches 60% (`lib/cardpick.js finishRows`, `RULE_POINTS 2`, `RARE_BAR 60`). 4 points never.
- **PICK w/ POINTS** = the fewest points (1 or 2) that reach 56% on EITHER team (`pickPts`, `PTS_BAR 56`); none reaching it -> the highest win rate within 2 points; "none" only with no lines. PICK is still the rule's side at Polymarket's own line (BEAT THE: table rate there).
- **Type is small and one line per row** (11px rows, 13px PICK lines, nowrap); the paragraph reason is now one short tag (e.g. "BEAT THE 3"). No cushion / "PICK costs" text on the card.
- Polymarket IS reachable from the sandbox (`fetchEvents` / `gameLines` in `lib/poly.js` return live alternate prices, 10/15 check) -- the earlier note "feeds not testable here" was wrong. The card still reads the SAVED alternates (refreshed every 30 min by the pull, dropped after 3 h).
- Tests: 326 site checks, grading audit 4,124, accuracy ok.

- **PICK w/ POINTS now sits UNDER MORE** (owner 10/15), first line inside it, above the list. The card on top shows only Model + PICK. In the list the row the model chose turns GREEN all the way across (`cardBody`, class `g` on the whole row); other rows color only their win %.

- **Card polish (10/15, owner: "build now, merge now"):** the "MODEL ESTIMATE" title is gone from the card (the purple section header and the "Model: <number>" line stay). The MORE list is plain (no green / yellow on win %), SPLIT BY TEAM (the pick's team first, team name as a small header; totals: Over / Under), and the ONLY green is the PICK w/ POINTS line and the row it chose (whole row green).

- **Same rules on every game (10/15, owner: "yes, build now, merge now"):** a game with NO tested rule still shows the full list (both teams; Over AND Under) and PICK w/ POINTS (the fewest points that reach 56%, either side); the PICK line says "No pick". `buildCard` no longer needs a tested rule (`plain` is null then; only `ptspick|` is recorded; parlays still use only games with a PICK -- `ptsLeg` needs `plain`). The "BEAT THE 3" / rule-name tag line and the team-name titles are gone: the list is split by team with a gap only. Polymarket lists totals in 2-point steps, so total rows are mostly main and 2 pts.

## BUILD 10/15 night (owner: "okay build now"; on the work branch, NOT merged until "merge now")

- **PL line colors:** the Polymarket logo and "PL: 7.7x" blue, " · $10 → " white (`.plw`), the payout green (`plPay`).
- **Bought parlay = 4 legs** (`sgp_style_pts`): spread PICK w/ POINTS + total PICK w/ POINTS + the top TD each team; a game without a bought total line (or without both TDs) gets none. `ptsLeg` no longer needs a PICK (PICK w/ POINTS exists on every game).
- **3rd-point rule (owner: option 2):** a line 2.5 / 3 points out is listed, and becomes PICK w/ POINTS, only when it beats the best line within 2 points by 3+ win points (`finishRows`, `FAR_GAIN 3`, `pickPts`); 4 points never. BUF @ LV: BUF -2.5 63.8% beats LV +7.5 60.6% by 3.2 -> it is picked.
- **Favorite tiers added back** (owner: "add all the favorites back"): books 2 (fav -0.5, 58.1% on 160), 4 (-2.5, 63.9% / 58.4% open), 5 (-2.5, 66.3%), 6 (-3.5, 56.2%), 7 (-5.5, 56.9%), 7.5 (-5.5, 58.9%) -- `BUY_TIERS` now 14, TIER NUMBERS 45 of 45. The books 3 (55.3%) and 3.5 favorite (53.5%) tiers stay (owner: break-even is fine).
- **PICK on games with no rule = the model's side at the main line** (`lib/cardpick.js modelNums`): spread by `modelUp.margin` (else `model.homeMargin`) vs Polymarket's main spread, total by the model's total vs the main total; an exact tie goes to the favorite (totals: Under). Shown at the model's honest history 50.6% spreads / 51.7% totals (2,531 games) = yellow. OWN record ids `modelpick|spread` / `modelpick|total` (Models -> Card picks rows "MODEL SIDE"), never mixed into the rules' record or the tiles. Best bets / parlay "strong legs" ignore them (under 56%); "my style" parlays now have a spread and total leg on every game.
- PICK w/ POINTS stays free to pick either team (owner: keep it as is).
- Tests: 327 site checks, grading audit 4,124, accuracy ok (TIER NUMBERS 45 of 45).

## RESEARCH DAY 10/16 (owner: "10 minutes on each model, rule and output; fix what you find"; work branch, NOT merged until "merge now")

- **Fixed:** BOUNCE BACK cutoff 21+ -> 24+ (the 21-23 band won 47.8% on 115, under 50% in 3 of 4 periods; 24+ 61.3% on 261, 28+ 64.7%); game model ridge 30 -> 3000;
  Railway rebuild-on-deploy (`BUILD_TAG`); same-game parlay links shrunk (`LIFT_POWER` 0.75 on positive links only); spread line table shrunk (`SHRINK_K` 200) and the recent-years
  group counting from 60 games. Tests after all of it: 327 site checks, grading audit 4,124, service checks, accuracy replay (BOUNCE BACK 160-101 = 61.3%).
- **History windows (owner asked: learn from only the last 5-10 years?) -- NO, longer wins or ties everywhere, each season unseen:** game model margin error 3y 9.97 / 5y 9.84 / all 9.76;
  TOTAL MOVE top 20% 55.1 / 56.6 / 58.4%; win % formula refit 3y/5y/10y/all log loss 0.6104 / 0.6090 / 0.6086 / 0.6086 vs the current formula 0.6075 (kept); TD model 3 / 5 / all seasons
  Brier 0.16142 / 0.16138 / 0.16152 (3 kept); chooser 48-53% at every window; rules all / last 10 / last 5: BEAT THE 59.1 / 59.4 / 58.1, BOUNCE BACK 57.2 / 60.0 / 60.9, DOG 56.5 / 62.8 / 64.4,
  LINE MOVE spread 62.6 / 63.2 / 64.5, total 66.1 / 65.8 / 64.7, INJURY 56.5 / 57.2 / 61.1.
- **TD model variants (train 3 seasons, test 2021-25):** recency off / strong, older seasons x0.6, blend 30/70 and 70/30, GBM 600 iters, depth 4, logit C 0.3 / 3 -- all within 0.0002 Brier of
  the current model (depth 4 -0.00004, better in 2 of 5). Nothing changed. This season (weeks 3-5, 807 players): said 14 -> 16.5% scored, 24 -> 27, 35 -> 36, 47 -> 38 (55 players), 65 -> 81 (21);
  vs Polymarket on 733 priced: Brier model 0.1566 vs market mid 0.1607; 10+ points apart (154) model 0.1544 vs 0.1651. 2+ TD said 3.8% hit 4.9%; first TD 5.05 / 5.11. History 2021-25 walk-forward:
  Best TD picks (55%+) 254 of 396 = 64.1% (said 59.9); top-3 list rank 1 / 2 / 3 said 43 / 32 / 26, scored 44 / 33 / 28.
- **Game model extras:** season-decay weights 0.9 / 0.8 / 0.7 worse; dropping qbr -0.03 margin error (left in); km (the line) is the only feature that matters (+0.30 without it).
  TOTAL MOVE: alpha 100 / 300 / 3000 / 10000 -> top 20% 57.2 / 58.6 / 58.2 / 57.2 (1000 kept, inside noise); dropping mt or apm +1 point (noise). Chooser: C 0.01-1.0 all 48-52% spreads, 51-53% totals.
- **Rule splits (closing line):** BEAT THE by week / home-road / total size all 56-61%; LINE MOVE spread: move 2.5-3.4 only 55.7% (176; the rest 62-66%, noise), toward the underdog 67%, road pick 65%;
  LINE MOVE total: every split 61-71% (moved DOWN -> Under 68.6%, 5+ points 71.4%); BOUNCE BACK DOG: home dog 60.2% vs road 53.3%, scored 0 60.6% vs 1-3 54.3%, weeks 5-12 51.6% (periods uneven, no cut);
  INJURY by type: QB out 56.9% (123), 2+ OL 55.2% (67), 2+ DB 51.3% (78; dropping it leaves the rule at 56.4%, not changed); weeks 14+ 63.1%, weeks 4-13 53%; the edge at the OPENING line is in
  "already moved 1+" games (66.1%, 233) -- the news moved the line; by the close those are 53.7%.
- **Card accuracy, leave-one-season-out 2014-25 (1,569 games with a half-point closing spread; the card's own rows and pickPts replayed):** unshrunk lowest-of-three: rows said 52.5% won 54.7%
  (a minimum of three noisy numbers runs low), but the CHOSEN line said 59.7% won 57.8% (favorites 61.7 / 56.6, 2-point lines 60.9 / 57.4, far lines 61.2 / 58.8) -- picking the best-looking
  cell runs hot. Estimators tried: pooled closing 59.9 / 58.6; average of 3 60.5 / 56.5 (worst); closing shrunk K=100 58.9 / 58.7; lowest of 3 shrunk K=100 59.1 / 58.3 (fav 60.2 / 57.2);
  **lowest of 3 shrunk K=200 59.0 / 59.5 (fav 59.9 / 59.4, dog 58.8 / 59.5, 1 pt 56.4 / 57.4, 2 pts 59.0 / 59.3, far 60.7 / 61.0; rows said 56-59 won 57.6, 60-64 won 60.6) -> built.**
  Totals (1,629 games): PICK w/ POINTS said 56.3% won 57.4%, rows calibrated -> not shrunk.
- **Parlay chances, walk-forward TD model 2021-25 (1,359 favorite team-games):** fav ML + top TD said 37.2% hit 36.9%; ML + Over + top TD 22.9 / 20.9; ML + Over + top 2 TDs 12.4 / 9.6; measured
  links ML&TD 1.12x (app 1.19), TD&Over 1.22x (1.23), ML&Over 1.00x; joint 3-leg 1.32x vs the product 1.46x -> power 0.75 on positive links. Owner's style (754 games): cover + Over + TD each
  team hit 6.90% (full product said 6.71, shrunk 6.10); cover + Under + TD each team hit 1.99% (full 2.63, shrunk-everything 3.02) -> drags are NOT shrunk; cover & own TD 1.14x, cover & other
  team's TD 0.75x, the two TDs 1.03x.
- **Database** 8.9 of 30 MB after week 5 compaction; no errors; Railway answering.
- **Extra 15 minutes (10/16, owner): tried and NOT built.** (1) Spread line table split by HOME/ROAD: rows a hair better (Brier 0.2465 vs 0.2468) but the chosen PICK w/ POINTS
  calibrates worse (said 59.2 won 58.5; home-team picks said 58.3 won 56.1) -- the thinner cells bring the selection bias back. Fact behind it: a ROAD underdog buying 1 point wins 56.8%
  (1,548) vs a HOME underdog 53.6% (935); at 2 points 59.9 vs 58.1. (2) Table lean at the main line as the no-rule side: 48.7% (1,510) -- the model side (50.6%) stays. (3) Totals by week:
  weeks 1-3 Under at the main total 52.1% (1,257; periods 55/50/49/54), Under +2 58.1% vs 56.2% the rest of the year -- a small early-season Under lean, only usable next September;
  weeks 4-12 and 13+ are 50/50 at the main total. (4) Totals by spread size: spread <=3 Under +2 58.2% (58/55/57/63) vs Over +2 54.4%; total 48+ & spread <=3 Under +2 59.5% (437; 58/63/57/61).
  Leave-one-season-out with the totals table split by spread size: rows WORSE (Brier 0.2508 vs 0.2490), PICK w/ POINTS the same (56.4 / 57.3 vs 56.3 / 57.4) -> not built.
- **GAME MODEL REBUILD (10/16, owner: "rebuild that entire model, try a different way"; 20 minutes, walk-forward 2019-26, train = every earlier season from 2014; line alone margin error 9.743):**
  current ridge 3000 **9.732** (side vs the close 51.5%); old ridge 30 9.758; "model of the gap" (line + ridge on what the line misses) alpha 300 / 1000 / 3000 / 10000 -> 9.730 / 9.731 / 9.733 / 9.737
  (a tie, side 50.8-51.4%); boosted trees on the gap 9.77-9.86 (worse), half-weight 9.757; stacking line + line-free model with a learned blend 9.778 (the blend put 1.06 on the line, 0.00 on
  the model); small-spread interactions 9.759. Totals: gap ridge 10.363 vs current 10.386 vs line 10.325 (not better than the line). Aimed at the OPENING spread with early features only:
  ridge 50.7-52.1%, boosted trees 49.9-51.7%, logistic / boosted classifiers 50.6-51.7%, confident top 10% 46-51% -> spreads can't be predicted off the open with what the app can see
  (the totals version is TOTAL MOVE, 58%). Market-implied ratings (ratings fit from the market's own closing lines, this week's line vs the rating gap, 4,135 games 2006-25): every gap
  bucket 46-53% home cover, fade the adjustment 50.4 / 52.1%; the one steady bucket (market priced the home team 2-4 under its rating -> road team 54.3%, 54/55/54 by period) is 1 of 7
  buckets and under 56% -> no pick. Kernel-smoothed line table (pool books A +-0.5 at the same team line, then shrink): rows Brier 0.2466 vs 0.2468 but the chosen PICK w/ POINTS calibrates
  worse (favorites 57.8 said / 55.3 won, 2-point lines 57.7 / 54.0 vs 59.9 / 59.4 and 59.0 / 59.3 now) -> not built. **Conclusion: nothing beats the current number; the closing line is the
  model. The card number stays ridge 3000.** The "vs open" column for models that use the closing line is NOT a real test (the close already knows the move) and was ignored.
- **CUT 10/16 (owner: "Cut 1 and two", "build now"):** the pick chooser and the scanned combo table are gone from the site and the rebuild. Site: `lib/chooser.js` and `lib/combotable.js`
  deleted; `tablePicks` -> `movePicks` (TOTAL MOVE only; `comboFactors` kept for the model number and the move model); `lib/combomodel.js` keeps `upgrade` / `early` / `moveT` only.
  Rebuild: `scan`, `train_chooser`, `F_for`, `PERIODS`, `INJ_FACTORS` removed; the artifact has no `table` / `chooser`; `passes()` = games 2000+, margin and total error vs the old model
  (the "300+ combos" gate is gone); `BUILD_TAG` bumped so Railway rebuilds on deploy. No new `chooser|` picks are recorded; old ones stay as history (`CURRENT_RULES` never counted them).
  FOUND BY THE TESTS AND FIXED: the kickoff recorder (`pages/api/snapshot.js writePrelog`) built the card without the model numbers, so a game with NO rule recorded nothing at kickoff
  (the chooser used to fill that hole); it now passes `model` / `modelUp` into `buildCard`, so the model-side PICK is saved at kickoff like the others. Dry run without the chooser / table:
  passes, artifact keys builtAt / checks / early / moveT / season / tag / upgrade, marginErr 9.944 vs line 9.903, totalErr 10.455 vs line 10.456.
- ANSWERED 10/16 (owner: "I don't want that"): the fallback stays; the card names the best line when none reaches 56%.

## FULL APP PASS 2 (10/16, owner: "look through the entire app for mistakes, holes or missing data ... build now ... merge now")

- Ran: full `npm test` (327 site checks, grading audit, service checks, accuracy: every rule 56%+ and TIER NUMBERS / LINE TABLE exact); type check of every JS file (0 undefined names /
  wrong call counts), `node --check` on every file, Python compile + pyflakes; the LIVE slate (14 games, week 6) checked game by game: Polymarket spread / total / moneyline on all 14,
  books on all 14, model numbers on all 14, card PICK + PICK w/ POINTS + 3-7 rows on every unplayed game (13), TD lists 13-22 players per game (45 of 252 without a Polymarket price =
  markets not posted yet, mostly Sunday night / Monday games; 0 stale), injuries 8-28 per game, same-game parlays on all 13, first-shown picks saved for every game (9-16 each), SEA @ DEN
  recorded at kickoff (6 picks, all graded) and in the results file; status: credits 335, Railway answering, database 9.1 of 30 MB, Pinnacle pull alive, ESPN kickoff check OK, 0 errors;
  every tab (Lines, TD, Bets mine + Model bets all 6 sub-tabs, Alerts, Models with every section open) and all 14 game pages loaded headless with the live data: 0 page errors, 0
  undefined / NaN / Infinity. No TD or injury row sits on the wrong game. Consistency checks: BEAT THE picks sit on Polymarket's own line with the table rate there (HOU +2.5 49%,
  BUF -5.5 46%: by design), BOUNCE BACK CHI -1.5 61.3%, DOG TEN +6.5, no INJURY pick for CAR @ PHI because the line already moved 1+ toward CAR after Hurts was ruled out (rule).
- FIXED: Bets tab showed a Polymarket account position "SEA Seahawks vs. DEN Broncos -- Broncos · settled -- P/L not reported · $7.54 · pays -$17.00" -- Polymarket had listed it with
  netPosition -17 (sold out / merged) and no settlement; a ledger row with 0 or negative shares and no settlement or sale is now left out, and `toWin` is never negative
  (`lib/mybets.js isHeld`, tested). Removed a dead `rows=[]` in `td_prob.py`. Nothing else found.
- Known and fine: Models "PICK · total" says waiting for week 6 because SEA @ DEN's total pick at kickoff was still the chooser's (id `chooser|total`, won); from Sunday every game
  records `cardpick|` / `modelpick|`. Self-check runs Thu 12:05 PM, Fri 5:05 PM, Sun 7:35 AM PT (scheduler), so "last self-check Thu" on a Friday morning is right.

## BREAKDOWN 10/16 (owner: "give me a real breakdown ... break down everything to see what we can improve on. build now") -- nothing in the app changed; choices for the owner

- **What the app really is in week 6 (14 games):** 12 of 13 unplayed games get their PICK side from a BEAT THE tier (56-64% at the bought line in history; on Polymarket's OWN line the PICK
  shows the table's 46-50% = yellow); CHI @ ATL is BOUNCE BACK (CHI -1.5, 61%); TEN @ IND is BOUNCE BACK DOG (TEN +6.5, 56.5%). LINE MOVE 0 fires (Polymarket tracks the books within
  1 point: 270 of 333 real 2025-26 games), INJURY 0 (the line moves before the app sees the news: CAR @ PHI moved 5 points on Hurts), TOTAL MOVE 1 fire (SEA @ DEN, won). Every total
  PICK is the model's side at 51.7%. So the GREEN on the cards comes from PICK w/ POINTS (56-65%) nearly everywhere.
- **Live record of the current rules = 1 game** (SEA @ DEN: BEAT THE, PICK, PICK w/ POINTS, TOTAL MOVE all won). Weeks 3-5 (spreads 22-18, totals 27-19) were the old chooser. Sunday
  10/18 is the first real test of what is on the cards now.
- **Proven in history (each season unseen):** BEAT THE 59%, BOUNCE BACK 61.3%, DOG 57%, LINE MOVE 63 / 66%, INJURY 56.5%, TOTAL MOVE 57-62%, PICK w/ POINTS spreads said 59.0 won 59.5,
  totals 56.3 / 57.4; TD Best picks 64% (RBs), TD model on target this season in every band but 40-50% (29% of 35).
- **Weaker on REAL Polymarket lines 2025-26 (win rate, 351 games):** PICK w/ POINTS spreads 53.5% (said 56.4; 2026 so far 38-41), the table's 56-59% rows won 51-54%; favorite BEAT THE
  tiers 10-13 vs underdog tiers 61-45 (57.5%) -- 23 games, small; 1-point bought totals 39-58 (owner: keep); main-line favorites 48%, underdogs 52%. Buying early changes nothing.
- **The owner's own bets (Bets tab analysis):** spreads 8-5 (62%), totals 11-5 (69%), touchdowns 10-21 (32%); 3-leg combos 1 of 2 won (+$101), 4-leg 2 of 12 (-$83), 5-leg 0 of 1.
  The TD legs are what sink the combos; the app's Best TD picks (55%+) scored 17 of 21 live (weeks 3-5) and 64% in history.
- **Improvements on the table (owner picks; each is a "build now" item):**
  A. Combos from the app's legs only: spread / total PICK w/ POINTS + Best TD picks (55%+ players, in practice RB1s), 2-3 legs, never 5.
  B. Bet Sunday morning after the model rerun and inactives: prices do not get worse by waiting (under 1c), and the injuries are in.
  C. INJURY EARLY (shadow first): the edge is 60% at the OPENING line and gone once the line moves; record a shadow pick the minute `inj:` starters-out changes (ESPN feed with dates),
     at the line of that minute, and grade it. Live only; past seasons can't be rebuilt.
  D. TD player prices from the Polymarket trade log (same free pull as the game lines): the real hit rate and price of Best TD picks at Polymarket, the owner's most-bet market.
  E. Favorite BEAT THE tiers: watch; 10-13 on real lines is 23 games. Re-check after week 8 with the live record.
  F. Keep as is: TD model, totals table, BOUNCE BACK, BOUNCE BACK DOG, the card layout and colors.
- Checked and NOT a bug: SEA @ DEN's PICK first showed "DEN +2.5 · 39%" on Wednesday -- that was the old day/night table (Thursday night game) before the split was removed 10/15;
  at kickoff it read 47.7% (unshrunk) and today's table says 49.1%.

## BUILD 10/16 night (owner: "c d e f build now" + layout asks + "build everything ive asked now. build now. merge now"; merged)

- **Model bets list (Bets -> Model bets):** a small header between the time slots, in kickoff order, the blocks unchanged (`labSlot` / `.labslot` in `public/app.js`): EARLY (Sunday before 9 AM
  your time, London), 10 AM GAMES, 1 PM GAMES, PRIME TIME · THU / SUN / MON (Sunday 4 PM+ and every weeknight). The "Diff" list (parlays across games) has no headers.
- **Parlay legs have NO logos** (owner 10/16, final: "no legs but the header names on each parlay"): logos sit only on the parlay's header line (the game names, `gameLogos`); every leg
  line is plain text (`legLogoLabel`). Built as all-legs-logos, then totals-off, then none -- do not add leg logos again.
- **Computer screen (1100px and wider):** the page uses the whole width (`.wrap max-width:none`), Game Lines tiles 4 across (5 at 1600px+), the docked chip strips (Alerts kinds, My bets
  weeks, Model bets sub-tabs) are centered. Under 1100px (iPhone) nothing changed. The Alerts chips sat bottom-left on a computer because the strip was left-aligned.
- **Finished game cards:** the card border and the GAME FINISHED cover turn GREEN when the PICK locked at kickoff won, stay red when it lost (`finClass`, `.card.fin.won`, `.cover.won`);
  each card by its own PICK (SEA @ DEN: both green).
- **Game Lines tile of a finished game:** FINAL sits under the score (`.lv dim`), the foot shows the day and time like every other tile.
- **c. INJURY EARLY shadow** (`lib/tracked.js recordInjEarly`, called from the slate build every 30 min, weeks 4+): the first build that sees exactly one team with its starting QB /
  2+ DBs / 2+ linemen out saves the HEALTHY team at Polymarket's line of that moment (`<game>|injearly`, once per game), whether or not the line has moved -- the INJURY rule's edge is
  60% at the opening line and gone after the move. Graded with the other tracked legs; Models -> Tracked angles row "INJURY EARLY (shadow)". Not a pick. Tested.
- **d. TD model vs REAL Polymarket TD prices** (`railway-model-service/data/poly_td_closes.csv`, 3,231 anytime-TD markets from the trade log; `tests/poly_td_replay.mjs`).
  2025: Polymarket listed anytime-TD markets only from 11/30 (weeks 13-18, 10 players a game) and almost nobody traded them (6 markets with a trade in the last 2 hours) -> 2025 is a
  CALIBRATION check only (walk-forward, trained 2022-24, all 4,544 names matched): model 55%+ 25-15 = 62.5% (said 60.1), 45-54 47.6% (said 49.8), 35-44 33.7% (39.4), 25-34 30.7% (29.3),
  under 25 21.4% (18.3). 2026 weeks 3-6 (the app's own kickoff numbers vs the trade-log close, 275 priced players): all players 30.5% hit (said 27.3) at 31c = +2.0 per $100, Brier model
  0.184 vs market 0.188; **Best TD picks (55%+) 12-2 = 85.7% at 63c = +34.9 per $100** (small); 45-54 10-10 at 53c (-9.0); 35-44 17-21 = 44.7% at 43c (+7.3); 25-34 27.7% (-12.5);
  under 25 19.6% at 19c (+5.5). Longshots the model likes 10+ points more than the price: 0-5. Players the model likes 10+ points LESS than the price: 5-19 = 20.8% at 43c (-49.4 per $100
  for whoever buys them). The TD model is the one model that beats the market so far; the 55%+ list is the bet.
- **e. Favorite BEAT THE tiers -- watch:** `ruleRecords` now also pools the live BEAT THE picks by side ("BEAT THE · favorite tiers" / "· underdog tiers", the pick's line sign), so the
  Tuesday report card (`npm run accuracy`, LIVE per green rule) shows both with the BELOW flag; re-check after week 8 (real-line replay: favorites 10-13, underdogs 61-45).
- **f.** TD model, totals table, BOUNCE BACK, BOUNCE BACK DOG, card layout and colors: unchanged.
- Tests: 329 site checks, grading audit, service checks, accuracy; browser pass phone + 1440px (0 errors), DOM logo count, screenshots of every changed screen.

## PASS 3 (10/16, owner: "read through everything. math logic, contradicting each other. confusion. do another pass"; merged)

- **Thresholds agree everywhere:** card colors green 56 / light green 53 (`clsOf`, `isGreenPick`, `PTS_BAR 56`); parlay "strong legs" use the same `isGreenPick` (56%+) and TD 55%+
  (`TD_MIN`); Best TD picks 55%+ (`BEST_TD`); Best bets 56%+; glow 56 / 58 / 61. Below green the shown % rounds DOWN everywhere (card, TD rows).
- **Kickoff recorder = the card:** `pages/api/snapshot.js` builds the kickoff card with the same `buildCard`, the same rule list (TOTAL MOVE, INJURY, BOUNCE BACK, DOG, LINE MOVE, BEAT THE),
  the same saved alternates and the model numbers, so the PICK / PICK w/ POINTS saved at kickoff is the one the card showed.
- **FIXED -- time-slot rules disagreed:** the Bets tab's `kickSlot` (Pacific clock, before 9 / noon / 5 PM, TNF-SNF-MNF prime) and the new Model bets headers used different cutoffs
  (phone clock, 4 PM). `labSlot` now uses the same Pacific cutoffs. `slotOf` (parlay-of-the-week slot) keeps its own 3 slots (morning / afternoon / primetime), same hours.
- **Tiles:** Spread picks / Total picks count the card's PICK from week 6 on and the old card picks before (weeks 3-5 chooser era) -- one record per game and market, as the note says.
- **Notes de-contradicted:** the "What the app shows" section is marked HISTORY; its stale bullets (Rules split warning, old tab order, wind alert, old Tracked angles list, the
  reason tag on the card) now say CUT / see CURRENT STATE. Rule of reading: CURRENT STATE + OWNER'S STANDING DECISIONS win over every older section.
- **Docked strips (owner 10/16: "make it like the Model bets sub tabs"):** the Alerts kinds strip and the My bets weeks strip are now the SAME flat strip as the Model bets sub-tabs
  (`.chips.dock` in `public/index.html`: equal columns, bold text, purple underline, no pills); when the labels do not fit (Alerts on a phone) the strip scrolls sideways instead of
  truncating. One rule for all three.
- **TD prices every 30 min (owner 10/16: "why is there no prices on most of the parlays"):** TD prices were refreshed only by the scheduled snapshots (7 AM / 3 PM / 7 PM PT), so a
  market Polymarket posted in the morning had no price -- and its parlays no payout -- until the afternoon. `pages/api/pinnaclepull.js mergeTdPrices` now merges the live prices
  every 30 min: new players added, ordinary moves taken, a HALVED price left to the snapshot's 3-check glitch guard; same `tdpxhist:` history (src "pin30"). Tested. A leg still
  without a price means Polymarket has not posted that player's market at all.
- **Model bets slot headers** carry the real kickoff times ("1 PM GAMES · Sun 1:05 PM · Sun 1:25 PM") and a line under them (`.labslot`).
- Nothing else found: tests, grading audit, accuracy, browser pass (phone + computer) all clean.

## PASS 4 (10/16, owner: "spend 15 minutes looking at everything over and over ... fix it"; merged)

- **Numbers correlate (live week-6 slate, 13 unplayed games, scripted):** every PICK's % equals its main row; every PICK w/ POINTS is a listed row with the same % and price and is
  the fewest points reaching 56%; every parlay leg equals its source (card PICK / PICK w/ POINTS, TD list % and price, Polymarket no-vig moneyline); every parlay chance is at or
  under its weakest leg; every payout = stake x the legs' prices multiplied; Diff chances = the legs' product; every game has both cards, both PICK w/ POINTS, 3+ rows, all five
  same-game parlays, top 3 TD per team, injuries, a win %. Models tab TD bands recomputed from the results file match to the player. Bets week-6 profit +$41.66 = the two sold
  combos. By design, not errors: the 3- and 4-leg same-game parlays carry "Over · 50%" (tested shape, not the card's total pick); the tile's 90% (win chance from the spread) and
  the Diff parlay's "LA ML 87%" (Polymarket's no-vig moneyline) are different, both meant.
- **FIXED -- the INJURY family could not see ESPN's "ruled out" news:** starters-out counts (`situationFor` -> `startersOut`) read only the official report, which marks a player Out
  on Friday; Thursday it still said "DNP" for Hurts while ESPN, the alert and the model already had him out. INJURY and INJURY EARLY therefore saw nothing until the line had moved.
  Now ESPN Out / Doubtful entries posted after the team's last game join the list as "Out" (`lib/paper.js withEspnOuts`, same rule as the model rerun and the TD tab). Tested.
- **TD prices confirmed live:** the first 30-min pull on the new code filled B.Tuten, K.Williams, P.Nacua, J.Cook, J.Williams, D.Swift; every parlay on those games shows its payout.
  Only the Monday game (WAS @ SF) waits for Polymarket to post its markets.
- **Owner 10/16 (A):** a parlay leg whose player has NO Polymarket market (DeVonta Smith, Limited, CAR @ PHI) stays as is and the parlay shows "PL: —" until Polymarket posts him.
  **The pull now runs every 15 minutes** (`scheduler.py` :10 / :25 / :40 / :55 -> `/api/pinnaclepull`: Pinnacle, Polymarket lines, alternates, TD prices, shadow records). Inside a
  time slot the parlay blocks have NO lines between them; the only line is under the slot header (`.par` border removed).
- Seen, left alone: the Alerts kind "LINE MOVE" (a sportsbook line change) shares its name with the LINE MOVE rule (a pick). The MONEYLINE tile is the favorite-at-kickoff record
  (16-13), the results file's "SEA ML" rows are the model's own moneyline side (24-21) -- two different records, both labeled.

## POLYMARKET REAL-PRICE REPLAY (10/16, owner: "Build now number one ... auto math, auto calibration, everything"; work branch, NOT merged until "merge now")

- **Data (new, `railway-model-service/data/poly_closes.csv`, 9,425 rows):** every 2025 + 2026 regular-season Polymarket game market (spreads, totals, moneyline; 357 events,
  9,594 markets from gamma series 10187 / 12185), prices rebuilt from Polymarket's public TRADE LOG (`data-api.polymarket.com/trades?market=<conditionId>`; `prices-history` is
  purged once a market resolves). Per market: `close` = last trade before kickoff (about the midpoint; the replay adds 1c for the ask), `first`, the last price 5 / 3 / 1 days out,
  2-hour VWAP, trade counts, volume. 351 games matched to nflverse scores (the 6 unmatched are January playoff slugs); 4 games had no main line traded in the last 2 hours.
  **2025 had thin markets: only 1-2 traded spread lines in 136 of 268 games (totals 106); 2026 has 6+ lines in 76 of 79 games.** So 2025 PICK w/ POINTS was the fallback
  (no 56% line offered) in 118 of 207 spread cards and 149 of 223 total cards; 2026 only 3 and 13.
- **Replay (`tests/poly_replay.mjs`, run `node --import ./tests/register.mjs tests/poly_replay.mjs`):** the app's OWN `buildCard` (rows, PICK w/ POINTS), `keyNumberPick`
  (BEAT THE) and LINE MOVE on those real lines, graded on the real scores, win rate AND money per $100 at the real price. 2026 is out of sample (the table stops at 2025);
  2025 is in-sample with the live table, so the headline 2025 numbers below come from the scratch run with a table cut at 2024 (same picture).
- **Card rows (every line the card lists):** spreads 1 pt won 56.1% (said 53.2) at 56c = -0.5 per $100; 2 pts 58.2% (said 56.5) at 60c = -2.2; 2.5-3 pts 55.6% (said 60.7) at 62c = -9.7.
  Favorite rows 48.2% (-10.7 per $100), underdog rows 58.1% (+6.2). Rows the table calls 56-59% won only 51.3% (-14.2), 60%+ 55.6% (-3.9) -- the shrunk spread table still runs
  HOT on real Polymarket lines. Totals: 2 pts 59.2% (+1.8), 1 pt 53.4% (-3.0); Over rows 55.8% vs Under rows 50.3%; total rows said 56-59 won 64.3% (+9.3) -- the totals table is fine.
- **PICK w/ POINTS:** spreads 147-128 = 53.5% (said 56.4) at 59c = -9.5 per $100 (honest 2025 56.1% / -3.8; 2026 46.8% / -23.5 on 79); said 56%+ 51.7% (-15.2); fallback 55.6%.
  Totals 162-140 = 53.6% at 58c = -7.3; **1-point total picks 39-58 = 40.2% (-27.2)**, 2-point 61.3% (+5.1), 3-point 62.9% (+3.6); said 56%+ 62.4% (+5.7); fallback 48.1% (-15.5).
- **BEAT THE at the real bought-line price:** 82-65 = 55.8% (said 57.1) at 59c = -5.7 per $100 (2025 58.3% / -1.2; 2026 52.4% / -11.7). Books 3 -> +3.5 23-16 (+4.8), 3.5 -> +5.5 9-4,
  2.5 -> +3.5 15-15 (-16.2), 4.5 -> -2.5 4-4, 7 -> -5.5 5-5. LINE MOVE at the close fired 10 / 9 times (6-4, 5-4): Polymarket and the books close within 1 point in 270 of 333 games.
- **Main lines at Polymarket's price:** favorites 47.6% (2025) / 48.1% (2026) lose -5 per $100; underdogs 52.4 / 51.9% (+1.2 / +1.5); 2025 Over 51.9% (+3.8), Under 48.1%.
  Moneyline favorites priced 60-70c won 56.3% (-13.5 per $100, 112 games); 50-60c 55.1% (-1.8); 70-80c 74.7% (-0.5); 80c+ 90.5% (+4.3, 42).
- **Buying early does nothing:** the same line's price moves -0.75c to +0.4c on average from 5 / 3 / 1 days out to the close (580-1,182 lines); the picks bought 3 days early cost 2c less
  and won the same games -> no early-buy edge (the earlier "-3c on picks" was selection, not timing).
- **Bottom line:** at real Polymarket prices the bought points win more often but cost what they win: every bought spread class is between -0.5 and -10 per $100; only 2-3 point total
  lines and underdog spread rows made money. **Candidates put to the owner 10/16 and REJECTED (owner: win rate only, keep 1-point lines, keep it green; see OWNER'S STANDING DECISIONS -- do not raise them again):** (1) never take a 1-point bought TOTAL as PICK w/ POINTS (39-58);
  (2) the spread table's 56-59% band is hot on real lines (won 51-54%) -- shrink more or show the lower closing-only rate; (3) main-line favorites lose at Polymarket, underdogs
  break even; (4) moneyline favorites at 60-70c are the worst parlay legs. Next data step if wanted: the same trade-log pull for TD player-prop events (`-player-props` slugs).

## RESEARCH 10/16 afternoon (owner: "10 minutes each" on the 8 follow-ups, then "keep digging"; nothing built in the app -- findings below, each topic worked until its data ran out, then dug further)

- **1. Pick timing (live).** Correct numbers (an earlier pass compared BEAT THE's bought line with Pinnacle's main line -- wrong): on POLYMARKET's own line, week 6's 18 spread rule picks
  (14 BEAT THE, BOUNCE BACK, DOG, 2 LINE MOVE) saw the line move toward the pick in 3, against in 4, unchanged in 11 by Thursday noon (avg +0.1 pts; the pick's own Polymarket price +0.4c).
  Polymarket's spread moved at all Mon->Thu in only 5 of 14 games (avg 0.7 pts). Weeks 3-6 saved card picks (results file `clvPts`): spread picks avg +0.03 pts (18 of 30 at 0), total picks
  -0.9; W-L by move (for us / against / none): spreads 1-5 / 3-4 / 16-15, totals 5-3 / 8-8 / 7-15 -- nothing yet. Pinnacle vs Polymarket gap of 1+ point right now: 5 of 14 games, all on
  totals except BUF @ LV (shadow LINE MOVE territory). The real study needs graded weeks 6-10 (`stackfirst:` times + `pin30`).
- **2. TD 40-45% bucket.** This season 6 of 26 scored (noise). Walk-forward 2021-25, 869 players in the band: said 42.4 scored 41.3 -- calibrated; by position RB 40.6 / WR 42.9 / TE 37.3;
  by season 38.8-45.6; cold slices: weeks 1-4 35.9% (209) and 14+ 37.1% (245), team implied under 20 points 33.3% (120), Questionable 29.4% (51), DNP 19.2% (26) -- each 1 of ~30 cuts,
  1-2 standard errors, and `imp` / `q` / `dnp` are already model inputs -> nothing changed. 45-55 band: RB 48.7 (692) fine, WR 45.4 (227), team rank 3 37.0 (27). 55%+ picks are RBs
  (380, 65.0%); WRs 15 at 46.7%, TE 1 -- the Best TD picks box is in practice an RB list. Top-3 list rank 1/2/3 said 43/32/26 scored 44/33/28 (unchanged).
- **3. Fallback PICK w/ POINTS.** With the SHRUNK table the app uses now, the leave-one-season-out replay (1,510 games, every alternate +1/+2/+2.5/+3 offered) has ZERO games where no line
  reaches 56% -- the fallback only happens live when Polymarket lists too few alternates (ARI @ LA at books 13.5). Unshrunk it was 60 games at 43.3% (favorite rows 50%, underdog 30%;
  the main-line favorite 55% in those games -- 1 cut, not a rule). Shrunk card re-check: said 59.0 won 59.5 (1 pt 56.4/57.4, 2 pts 59.0/59.3, 3 pts 60.7/61.0; favorites 59.9/59.4,
  underdogs 58.8/59.5; totals 56.3/57.4). Nothing to change; owner keeps the fallback.
- **4. Alternate prices (this week, 141 priced rows on 28 cards).** Polymarket prices bought points ABOVE their win rate: spreads price minus win% = +1.0c at the main line, +2.8 at 1 pt,
  +3.0 at 2 pts, +0.3 at 3 pts; totals +1.5 / +3.6 / +3.3 / -0.2. Expected money per $100: spreads main -1.9, 1 pt -5.0, 2 pts -5.0, 3 pts -0.5; totals -3.0 / -6.6 / -5.7 / +0.2; Unders -2.4 vs
  Overs -6.6. Rows that are BOTH 56%+ and priced under their win rate: 11 of 141 (CHI -1.5 61% at 48c the only big one; the rest Unders at 55-62c, CLE +6.5 / PHI +6.5 / WAS +9.5 at 56-60c).
  The chosen PICK w/ POINTS: 58.7% at 60c = -2.4 per $100, positive in 5 of 26. The 10/15 finding holds: the points win more often but cost more than they win. Owner's rule (win rate) stands.
- **5. Odds API past odds (tested with the sandbox key, 1 credit).** The FREE plan already serves `/v4/historical/.../events` (a snapshot list with timestamps; snapshots exist every 5 MINUTES:
  previous 11:50:39 / next 12:00:39 around 2024-10-16 12:00Z); historical ODDS return `HISTORICAL_UNAVAILABLE_ON_FREE_USAGE_PLAN`, paid plans only (~$30/mo 20K credits, $59 100K, per
  third-party pages; the official site is blocked here). Cost rule from those pages: a historical odds call = 10 x markets x regions credits -> spreads+totals, one region = 20 per snapshot;
  one snapshot carries EVERY game. 6 snapshots a week (Mon open, Wed, Fri, Sat, Sun 9 AM, kickoff) x 18 weeks x 6 seasons 2020-25 = ~650 calls = ~13K credits = ONE month of the $30 plan.
  That answers "bet Wednesday or Sunday" for every rule and gives hourly lines for the INJURY / LINE MOVE timing. Best buy. Verify the plan page and the 10x rule before paying.
- **6. Betting splits.** No free history anywhere: SharpAPI (DraftKings + Circa, 5-min refresh, 48 h of history, $229/mo Pro), Sportradar (enterprise). sportsbettingdime's public page
  is reachable but its tables are drawn by JavaScript (only the article text comes through; a headless browser could read it weekly -- live only, no past data; Wayback has no snapshots).
  Kaggle "nfl-sample-2018-2026" (oliviersportsdata) = Bet365/BookMaker timestamped lines for only 18 games (a vendor sample). Verdict: not worth paying; the MGM test already said no edge.
- **7. Injury posting times.** nflverse's injury file has no dates (the `date_modified` column in its dictionary is not in the 2025 file). NFL.com's weekly pages (nfl.com/injuries/league/2024/REG10,
  reachable) show only the final practice status + game status per player -- no per-day history. ESPN's free feed (site.api.espn.com/apis/site/v2/sports/football/nfl/injuries, 800 items,
  32 teams) carries a `date` per item and a comment naming the practice day ("full participant in Wednesday's practice", "ruled out ... Tuesday") -> the only free source of WHEN news posted,
  live only. The app's `inj:` recorder already logs starters-out changes with times. Past seasons stay untestable.
- **8. Polymarket history -- THE FIND.** Last season's NFL game markets still exist on gamma (e.g. `nfl-kc-buf-2025-11-02`: moneyline, spreads -1.5 / -2.5, totals 50.5-53.5, team totals, 1H).
  `prices-history` returns nothing for them (purged after resolution), BUT the public trade log (`data-api.polymarket.com/trades?market=<conditionId>&limit=1000&offset=N`) still has every
  trade with price and timestamp: Chiefs-Bills ML 1,356 pre-kickoff trades (first Oct 26 at 68c, last Nov 2 21:24Z at 56c), spread -2.5 91 trades (last 50c), -1.5 21 (last 53c),
  O/U 52.5 176 (51c), O/U 50.5 133 (56c). So the 2025 season's Polymarket closing (and mid-week) prices for main AND alternate lines can be rebuilt for free -- the missing piece for
  "do bought lines make money at Polymarket's price" and for Polymarket-vs-books timing. Size: ~270 games x ~15 markets x 1-4 calls = a few thousand calls. Not built (a separate job);
  order-book depth is still not archived anywhere, so keep `pin30` running.
- **Next Gen Stats, second pass (10/16, owner: "yes, build now"). Nothing built.** nflverse's NGS release now holds usable weekly rows only for 2018-2023 (the 2024 files have 5 rows, 2025 is missing), so the walk-forward
  test is 2021-23 (12,763 player-games), features merged from EARLIER weeks only (no leak). TD model Brier, base 0.15443: + goal-line set (rush yards over expected, 8+ box %, efficiency,
  each x inside-5 carries) 0.15449 (worse, better in 1 of 3 seasons); + role-change set (air-yards-share jump and target jump last game, separation, YAC over expected) 0.15455 (worse, 1 of 3);
  both 0.15438 (-0.00005, 2 of 3 -- the same ~0.1% as 10/13, noise). Best TD picks 66.3% base vs 66.1 / 64.7 / 66.7%; rank-1 scorer 43.6% vs 43.7 / 43.6 / 42.8. Leave NGS out of the TD model.
  INJURY x replacement QB (the rule's QB-out games 2014-25, 107 with a known replacement from snap counts; CPOE from his earlier NGS weeks, 59 games 2018-23): replacement CPOE below 0 ->
  healthy team 62.2% (37), CPOE 0 or better 52.4% (21); below -2 -> 71.4% (21), above +2 -> 55.6% (18); no NGS history at all (a true backup) 72.7% (11). Points the right way (a worse
  backup = a better pick) but 21-37 games per cell and the NGS files stop at 2023 -> a CANDIDATE to re-test when nflverse restores 2024-25, not a rule. Scripts: /tmp/claude-0/ngs_td.py, ngs_qb.py.
- Clock note: the sandbox clock only advances while a command runs (it read 14:13-14:19 for the first pass), so "10 minutes" cannot be measured with `date` here; the second pass went
  topic by topic until each source was exhausted (every check above). Nothing passed the bar to build; the next real steps are the Odds API month (5) and the Polymarket trade backfill (8).



## PARLAY LAB (10/17, owner: "find ways to win the parlays ... calculated risk ... reverse engineer winnings"; scripts `scratchpad/plab/lab.py`, `lab2.py`, `diag*.py`, data `td_oof.parquet` = the app's TD model walk-forward 2019-25)

- **Method:** every build written down before looking; 2014-25 games (closing lines, moneylines, scores) and the TD model replayed walk-forward 2019-25 (train s-3..s-1). Payout = Polymarket's way (`comboPay`: prices multiplied, helping links ^0.75, x0.977); leg prices: moneyline = books' close (vig in), spread / total 52.4c, TD = model + 3c (no TD price history before 2026; 2026 real prices ran there). A "pass" = money above zero in every period AND 100+ parlays -- with ~90 builds tried, about 1 in 8 passes that by chance, so the by-season count and z decide.
- **Single legs at the price (the base of every parlay):** favorite moneyline every band -0.8 to -5.2 per $100; Over -7.1 (z -4.2), favorite covers -7.3 (z -4.3), Under -2.1, underdog covers -1.8; the model's top scorer 50-55% +1.2, 55-60% -1.7, 60-70% -0.1; 40-50% -11 to -16. **2+ TD legs lose ~50 per $100.** Nothing beats the price steadily; parlays multiply the cut.
- **Same game (all lose):** fav ML + Over -12; fav ML + Under -7; the researched 3-leg (fav ML + Over + top TD) 20.4% hit, -18; linked 4 9.6%, -27; owner's style with the Over 6.1% (-33), with the Under 2.2% (-67); CLOCK (fav ML + Under + RB1) -24; SHOOTOUT (Over + both WR1) -12. Highest hit rates: fav ML + top TD 60%+ 54% (-2.4), 55%+ 49.5% (-5.9). **Heavy favorites' win + own scorer link is only 1.05x (Polymarket prices 1.14x) -- that pair is OVERPRICED; 50-70c favorites 1.16-1.18x.**
- **UPSET (built):** underdog ML + its lead RB TD: 1,758 games, hit 17.6%, pay 8.0x, +10.5 per $100, z 1.5, seasons +35 / +3 / +9 / +10 / +19 / -10 / +11 (6 of 7). Why: the dog's RB1 scores 49-58% when the dog wins vs 28-31% when it loses (link ~1.4x vs 1.14x priced). Dog ML + dog TOP scorer (any position) only +2.
- **Across games (one a week):** 4 biggest favorites 44.0% hit, +0.4 (6 of 12 seasons); 3 favorites 56.9%, -1.4; 6 favorites 25.8%, +9 (7 of 12, z 0.7); 3 shortest underdogs 12.4% at 9.6x, +12 but 24-25 -4. **4 most likely TD scorers one per game (built):** 17.7% (22 of 124 weeks), 7.0x, +28, seasons 2019 0/17 then +65 / +81 / +45 / +20 / +54 / +25 (6 of 7, z 1.05); 3 scorers 28.2% +13 (5 of 7); 5 scorers 11.3% at 12.7x +46 (5 of 7). Best TD picks (RB 55%+) x2-4: uneven.
- **"2 games x (fav ML + its top TD)" looked like +39 (z 2.2) and 3 games +107 (z 3.0) -- NOT real:** by season -15 / -8 / +76 / +16 / -16 / -38 / +35 (3 of 7); two hot seasons sat in two different periods. Each pair alone loses (-9 / -7 / +4). Not built.
- **Reverse-engineering the 3-leg winners (fav ML + Over + top TD by pre-game condition):** no condition turns it positive in every period (dome -9, top TD is RB -12, WR/TE -35, spread 3.5-6.5 -12, total <=42 -16 ...). 4-favorites weeks that all won vs lost: weakest leg 76c vs 73c, nothing else separates them; weakest leg 80c+ -> all 4 won more often. Weeks 1-4 worst.
- **Live paper record so far (weeks 3-6, from `/api/results/list`):** td_likely_2 2-0, td_likely_3 1-0, model_best_4 1-0, home_fav_95_single 2-0; sgp_3 / sgp_linked / sgp_style / sgp_style_pts 0-1 each (SEA @ DEN); 14 of each saved for week 6.

## SLATEZZ MERGE (10/17, owner: "build now ... merge now only after you've done your checks"; sketches claude.ai/artifact/7Y97DkcA2fpKCSVDbdC6sR)

- **Where NBA lives now (copied from markiv3rson/NBA main + its `tracking-test` branch with the SHOT QUALITY totals rule):** `nba/lib/*` (site code), `pages/api/nba/*` (its routes; every NBA route is `/api/nba/...`),
  `public/nba/index.html` + `public/nba/app.js` (its pages), `nba/railway-model-service/*` (its model service copy), `nba/tests/*` (its 282 checks, run by `npm test` / `npm run test:nba`), `nba/CLAUDE.md` (NBA's own notes -- read them for NBA work).
  The NBA service's own Python tests need its downloaded data cache (`npm run test:nba-service`; not in CI).
- **NBA runs SEPARATELY:** `nba/lib/redis.js` reads ONLY `NBA_REDIS_URL` (never the NFL database's variable; unset -> empty in-memory store), `nba/lib/model.js` ONLY `NBA_MODEL_SERVICE_URL` / `NBA_MODEL_SERVICE_TOKEN`, `nba/lib/books.js` ONLY
  `NBA_ODDS_API_KEY`. Polymarket account keys are shared (same account). Tests check all of this.
- **Owner's Vercel settings to add on the NFL project (copy the values from the NBA project):** `NBA_REDIS_URL` (NBA's Redis address), `NBA_MODEL_SERVICE_URL`, `NBA_MODEL_SERVICE_TOKEN`, `NBA_ODDS_API_KEY`. Until they are set the NBA pages are empty; NFL is unaffected.
- **Moved 10/17 night (owner, from the phone):** the four NBA settings are on the NFL Vercel project (checked live: NBA database, model service, Polymarket all answer; model numbers on every NBA game). NBA's Railway service now deploys from
  `markiv3rson/NFL`, root directory `/nba/railway-model-service`, variables `SITE_URL` = the combined site, `SITE_API` = `/api/nba`, `SITE_LOGIN` (deploy of 73d61ef passed 10/17 04:30 UTC). Railway reads a service's config file from the REPO ROOT
  unless the service's "Railway Config File" setting names another path, and watch patterns are matched from the repo root: NBA's service must point its config file at `/nba/railway-model-service/railway.json` (watches `/nba/railway-model-service/**`);
  NFL's `/railway.json` watches `/railway-model-service/**`. The old NBA Vercel project (nba-nfl9) can be paused once NBA's scheduler is seen calling `/api/nba/...` on the combined site (Railway logs: `[scheduler] /api/nba/slate -> ok (200)`).
- **Shell (`public/shell.js` + `public/shell.css`, loaded by both pages):** the menu, refresh (POST `/api/rerun` + GET `/api/nba/snapshot`), header clock text (1d 1h 7m / 2h 14m / 26m / 45s), the unread count on each Alerts row.
  Pages switch by hash: NFL `#home` (or none) `#alerts #lines #td #record #models`; NBA `#alerts #lines #record #models`, `#game=KEY` opens an NBA game (home screen rows).
- **Home (`renderHome` in `public/app.js`):** per sport a title row ("● NFL · LIVE NOW" or "NFL", right: NEXT GAME [logo] @ [logo] clock) and the live games as a list: logo, team, that team's sportsbook spread from before kickoff (NFL: the
  kickoff snapshot's books; NBA: the books pull if it was before tip-off), O/U total in the middle, score, clock. Nothing live -> that sport's next game row. NBA scores: new `/api/nba/live` (ESPN scoreboard, today + yesterday ET). Background black.
- Checks: NFL 345 site checks (new: no tab bar / lever, menu items, refresh calls, header clock, NBA settings separate, NBA page calls only /api/nba, NBA live parse, home rows), NBA 282, grading audit, service, accuracy; `next build`
  bundles every `/api/nba/*` route; headless browser at 430 px and 1440 px through home, menu, all NFL pages, Model bets, a game page, home -> NBA game, all NBA pages: 0 errors, no undefined / NaN.
- **Player props (owner 10/17: "Don't add it to the app yet ... just research"):** only the background recording runs -- the 15-min pull saves every Polymarket prop line (`props:<s>:<w>:<game>`, first + latest price; `lib/props.js recordProps`).
  Nothing is shown. `railway-model-service/prop_model.py` + `tests/prop_backtest.py` / `tests/prop_real.py` are research tools; their results are in PLAYER PROPS RESEARCH.

## PLAYER PROPS RESEARCH 2 (10/17 night, owner: "10 minutes each ... 65% and higher ... nba and nfl"; research only, nothing in the app; scripts `tests/props_research/*.py`, `nba/railway-model-service/research/nba_real2.py`, `nba_b2b.py`, `nba_starout.py`)

- **Method:** cuts written BEFORE looking at results, each split into halves (NFL weeks 1-3 / 4-6, NBA Dec-Feb / Mar-Apr); a cut passes only at 65%+ overall AND in both halves. Real lines = Polymarket closes traded in the last 24 h.
- **NFL, PASS on real lines:** receiving yards Under, model 65%+: **73.0% (111-41, 152 lines; 72.5 / 73.5)**; same where the market DISAGREED (that side priced 55c or less): **70.4% (54; 68.8 / 72.7)** -- the one place the model beats the market. Model 75%+: 84.2% (57; 76.9 / 90.3). Receiving yards line set 20%+ above the player's season average -> Under **71.8% (110; 70 / 73) at 64c**, no model needed. Receptions Under when model 65%+ and market 60c+ agree: 82.4% (34; 82 / 83). Passing yards Over model 75%+: 89.5% (19; 89 / 90) but the market priced it 83c. Receiving yards Over model 65%+: 71.9% (57; 67 / 79).
- **NFL, no edge:** "hot" player (last 3 games 1.3x his average) -> Under 49-60%; "cold" -> Over 49-60% (the market does not overreact). Disagreement cuts on rushing yards / receptions 54-59%.
- **NFL new Polymarket US prop types (ladders "N+"), history 2021-25 each season unseen:** rushing attempts, scrimmage yards, passing TDs, interceptions thrown are CALIBRATED (model 65-90% = what happened, every season; e.g. scrimmage yards Under 70-80%: said 75.2 won 75.2 on 16,922 lines; interceptions Under 70-80%: said 75.7 won 81.2). No past Polymarket US prices exist for them, so this proves the numbers are honest, not that they beat the market.
- **NFL, model blind spot:** when a team's top target (7+ targets a game) misses the game, teammates beat the model every season 2020-25 (receiving yards +1.3 to +4.5 over the prediction): model 70-80% receptions Over won **81.3% (770; 80 / 83 / 85 / 80 / 79)**, receiving yards Over 77.8% (720); model Unders in those games lose 6-8 points vs what they say. Real 2026 lines: only 17 (receiving yards Over 12-5 at 67c) -- too few to say the market misses it. Candidate; an injury input for the prop model would fix the Unders.
- **NBA, real lines:** no cut passes in both halves. Model 65%+ disagreement cuts 50-60% (the model alone does not beat the NBA prop market); "model + market agree" cuts 77-97% in Mar-Apr but 50-64% Dec-Feb (uneven, as on 10/17 morning). Rebounds Under on the second night of a back-to-back read 73.6% (53; 71 / 76) -- REJECTED: in every unseen season players on back-to-backs do NOT fall short of the prediction (rebounds +0.0 to +0.1), model 65-70% Unders on back-to-backs won 65.5% (3,867).
- **NBA, model blind spot:** a 20+ points-a-game teammate sitting adds +0.4 to +1.6 points to the others vs the model every season 2023-26; model points Unders in those games win 61.6% at "67.5" and 65.4% at "72.5". On real lines the market already adjusts (points Over 55.9% of 195), and a model points Under with a star out won 41% (39) -- a warning, not a bet.
- **Verdict:** only the NFL receiving-yards Under family (model 65%+, the 20%-above-average line, and the disagreement cut) clears 65% on real lines in both halves; the rest are history-only or uneven. Live samples are 6 NFL weeks.

## PLAYER PROPS RESEARCH (10/17, owner: "10 minutes each ... only if it passes the 65% ... don't add it to the app yet"; bar = 65% REAL win rate on unseen history AND real Polymarket lines)

- **Method (both sports, nothing from prices used to fit):** boosted trees on pre-game inputs (season average blended with last season, last games, usage / minutes, team scoring, opponent allowed to the position, home);
  the chance of a line = what really happened to the earlier seasons' out-of-sample player-games with the nearest prediction. History = every season unseen at ladder lines around each player's average.
  Real lines = Polymarket's trade-log closes (NFL 2026 weeks 1-6: `railway-model-service/data/poly_prop_closes.csv`, 1,874 traded markets, 1,663 matched; NBA 2025-26: 25,615 markets inside the game events, 10,692 traded in the last 24 h, 8,960 matched to a box score).
  Scripts: `railway-model-service/prop_model.py`, `tests/prop_backtest.py`, `tests/prop_real.py`; NBA `nba/railway-model-service/research/props_model.py`, `props_real.py`, `props_pull.py`.
- **History (unseen seasons) -- every group passes, the model's % matches reality:** NFL 2021-26 model 65%+ won 73-87% by group (65-70% band 67-70%); NBA 2024-26 points / rebounds / assists 77-81% (65-70% band 67-68%).
- **NFL on REAL Polymarket lines (model 65%+), PASS = 65%+:** receiving yards Under **72.4% (118-45; TE 82%, RB 78%, WR 67%; every week 64%+; where the market priced it under 60c still 67.5% on 83)**, receiving yards Over **72.1% (44-17; WR 76%, TE 60%)**,
  receptions Over **82.4% (28-6)**, passing yards Over **78.7% (37-10, but the market said 78c -- it agrees with the model)**. Fail: rushing yards Under 63.6% (77-44) / Over 64.5% (20-11) (both 73-81% when the market also priced the side 60c+), receptions Under 58.8%,
  passing yards Under 58.7%, attempts / completions / longest reception (2-5 traded lines each). Overall the model is ~6 points too confident on real lines (said 74, won 68) and the market's close is slightly sharper (Brier 0.2326 vs model 0.2362).
- **NBA on REAL Polymarket lines (2025-26):** only rebounds Over passes (**66.9%, 89-44**; Feb 12-14, Apr 40-5 -- uneven). Fail: points Over 61.4%, points Under 52.9%, rebounds Under 58.4%, assists Over 59.4% / Under 58.6%. The model is 10-15 points too confident on real lines
  (said 71-76, won 53-67) although its Brier beats the market close (0.2522 vs 0.2622; many closes are thin). When the market ALSO priced the side 60c+: points Over 77.3% (97), rebounds Over 83.1% (59), assists Over 66.7% (105) -- the model alone against the market is 53-58%.
- **Not built (owner):** nothing shown. Candidates if the owner wants them later: NFL receiving yards Under / Over, receptions Over, passing yards Over; NBA rebounds Over. All small live samples (NFL 6 weeks); the "model + market agree" cuts were found after looking (several cuts tried).
