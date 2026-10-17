# NBA player props research (10/17): walk-forward model for points / rebounds / assists, same method as the NFL prop model
# (boosted trees on pre-game inputs; chance of a line from the earlier seasons' out-of-sample outcomes nearest in prediction).
import sys, numpy as np, pandas as pd, pickle
sys.path.insert(0, "/home/user/NFL/railway-model-service"); import prop_model as pm
from sklearn.ensemble import HistGradientBoostingRegressor
D = "/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/"
STATS = ["points", "rebounds", "assists"]
B = pd.concat([pd.read_parquet(D + f"player_box_{s}.parquet") for s in range(2021, 2027)], ignore_index=True)
B = B[(B.season_type == 2)].copy()
B["min"] = pd.to_numeric(B["minutes"], errors="coerce")
B["played"] = (~B.did_not_play.fillna(False).astype(bool)) & (B["min"].fillna(0) > 0)
B = B[B.played].copy()
for c in STATS: B[c] = pd.to_numeric(B[c], errors="coerce").fillna(0)
B["date"] = pd.to_datetime(B.game_date); B = B.sort_values(["athlete_id", "date"])
B["pos"] = B.athlete_position_abbreviation.fillna("?").str[0]   # G / F / C
g = B.groupby(["athlete_id", "season"])
for c in STATS + ["min"]:
    cum = g[c].cumsum() - B[c]; n = g.cumcount()
    B["s_" + c] = cum / n.replace(0, np.nan)
    B["l5_" + c] = g[c].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
B["gp"] = g.cumcount()
prior = B.groupby(["athlete_id", "season"])[STATS + ["min"]].mean().reset_index(); prior["season"] += 1
B = B.merge(prior.rename(columns={c: "p_" + c for c in STATS + ["min"]}), on=["athlete_id", "season"], how="left")
for c in STATS + ["min"]:
    has = B["p_" + c].notna().astype(float)
    B["b_" + c] = (B["s_" + c].fillna(0) * B.gp + 3 * B["p_" + c].fillna(0)) / (B.gp + 3 * has).replace(0, np.nan)
B["start1"] = g.starter.shift(1).astype(float)
# team / opponent scoring so far this season, opponent allowed per position
T = B.drop_duplicates(["game_id", "team_id"])[["game_id", "team_id", "opponent_team_id", "season", "date", "team_score", "opponent_team_score"]].sort_values("date")
tg = T.groupby(["team_id", "season"])
T["t_for"] = tg.team_score.transform(lambda s: s.shift(1).expanding().mean()); T["t_against"] = tg.opponent_team_score.transform(lambda s: s.shift(1).expanding().mean())
B = B.merge(T[["game_id", "team_id", "t_for"]], on=["game_id", "team_id"], how="left")
B = B.merge(T[["game_id", "team_id", "t_against"]].rename(columns={"team_id": "opponent_team_id", "t_against": "o_against"}), on=["game_id", "opponent_team_id"], how="left")
A = B.groupby(["opponent_team_id", "season", "game_id", "date", "pos"])[STATS].sum().reset_index().sort_values("date")
ag = A.groupby(["opponent_team_id", "season", "pos"])
for c in STATS: A["o_" + c] = ag[c].transform(lambda s: s.shift(1).expanding().mean())
B = B.merge(A[["opponent_team_id", "game_id", "pos"] + ["o_" + c for c in STATS]], on=["opponent_team_id", "game_id", "pos"], how="left")
B["home"] = (B.home_away == "home").astype(int)
F = ["b_min", "l5_min", "gp", "start1", "t_for", "o_against", "home", "b_points", "b_rebounds", "b_assists", "l5_points", "l5_rebounds", "l5_assists"]
E = B[(B.b_min.fillna(0) >= 12)].copy()     # rotation players with some history (the ones Polymarket lists)
OOF = {}
for stat in STATS:
    f = F + ["o_" + stat]; out = []
    for s in range(2023, 2027):
        tr, te = E[E.season < s], E[E.season == s].copy()
        m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_depth=4, min_samples_leaf=80, l2_regularization=1.0, random_state=0).fit(tr[f].astype(float), tr[stat])
        te["mu"] = np.maximum(m.predict(te[f].astype(float)), 0.1); out.append(te)
    OOF[stat] = pd.concat(out, ignore_index=True)
    print(stat, len(OOF[stat]), flush=True)
pickle.dump(OOF, open(D + "nba_oof.pkl", "wb"))
# history test: seasons 2024-2026 unseen, Polymarket-style lines around each player's average
rows = []
for stat in STATS:
    O = OOF[stat]
    for s in (2024, 2025, 2026):
        sp_ = O[O.season < s]; te = O[O.season == s]; sp = pm.Spread(sp_.mu.values, sp_[stat].values)
        for mu, px, y in zip(te.mu.values, te["b_" + stat].fillna(te.mu).values, te[stat].values):
            L = np.arange(max(0.5, np.floor(px * 0.5) + 0.5), px * 1.6 + 1, 1.0 if stat != "points" else 2.0)
            if not len(L): continue
            for l, p in zip(L, sp.over(np.full(len(L), mu), L)): rows.append((stat, s, l, p, y > l))
R = pd.DataFrame(rows, columns=["stat", "season", "line", "p_over", "over"])
for stat, gg in R.groupby("stat"):
    for side in ("Over", "Under"):
        pc = gg.p_over if side == "Over" else 1 - gg.p_over; won = gg.over if side == "Over" else ~gg.over; m = pc >= .65
        by = " ".join(f"{s}:{won[m & (gg.season == s)].mean()*100:.0f}" for s in (2024, 2025, 2026))
        bands = " ".join(f"{lo}-{hi}:{won[(pc>=lo/100)&(pc<hi/100)].mean()*100:.1f}" for lo, hi in ((65, 70), (70, 80), (80, 90), (90, 101)))
        print(f"HISTORY {stat:8s} {side:5s} 65%+ said {pc[m].mean()*100:.1f} won {won[m].mean()*100:.1f}% ({m.sum()}) by season {by} | {bands}", flush=True)
