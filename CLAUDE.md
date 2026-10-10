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

- Model card: ONE answer — the model's number (purple), then **PICK** (green, 56%+) or **LEAN** (yellow) with a plain reason. No teasers on cards; market lines only.
- Teasers (incl. alt lines) are all labeled **TEASER**, in a folded list on Game Lines, top 5.
- Best bets = top 10 straight picks at 56%+. Parlay of the week = top 4, one per game.
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

## TD model — already tested (don't redo without a new idea)

Added (Oct 10, 2026):
- Injury report inputs (own status + top teammate's status), plus the site's Questionable list (official + ESPN) — the nflverse injury file lags Friday statuses.
- Starter out → backup boost: RB (better 5/7 seasons), WR/TE (4/7).

Tested and NOT added (made it worse):
- Last-3-game usage weighting (worse 6/7).
- Opposing defense injuries: plain counts (3/7), starters weighted by snaps (2/7), per-player defender stats — coverage, pressures, tackles (2/7).
- Rookie draft pick (3/7; rookies already about right on average).
- Known gap: news not on any report (coach comments) — can't be tested; the "Market disagrees" box is the warning for it.

## Betting notes from the owner's experience

- Bet Sunday morning after inactives (~90 min before kickoff) and a Model rerun; lines and weather move picks during the week.
- A TEASER pick only works at the teased line.

## Next project: NBA app (discussed Oct 10, 2026 — not started)

Same concept as the NFL app: game model (spread/total/moneyline), tested combo patterns, best bets at 56%+, teasers, player props, Polymarket lines and bet sync, automatic rebuilds.
- NBA differences: ~1,230 games, daily updates; injuries/rest/late scratches matter most; back-to-backs and travel; pace for totals; props (points, rebounds, assists, 3s) depend on minutes.
- Plan: phase 1 game model (~1–2 weeks), phase 2 combos + best bets (~1 week), phase 3 props (~1–2 weeks).
- Open questions for the owner: separate app or a tab in this one? Check which free NBA data sources work from the cloud before promising.
- Wait for "build now".
