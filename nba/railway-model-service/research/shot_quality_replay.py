"""Night-by-night replay of the live SHOT QUALITY code (shot_quality.state as the service runs it) over 2024-25 and 2025-26, compared with the
research decisions (10/17: same decision on 99.8% of 2,461 games). <dir> holds play_by_play_2025/2026.parquet and espn_shot_frame.pkl.
Usage (from railway-model-service): python3 research/shot_quality_replay.py <dir>"""
import sys, numpy as np, pandas as pd, pyarrow.parquet as pq, warnings
warnings.filterwarnings("ignore"); sys.path.insert(0, ".")
import nba_data as nd, shot_quality as sqm
SP = sys.argv[1].rstrip('/') + '/'
COLD, SQ = -6.9, 10.9
out = []
for season in (2025, 2026):
    f = SP + f'play_by_play_{season}.parquet'; have = set(pq.read_schema(f).names)
    pbp = pd.read_parquet(f, columns=[c for c in sqm.PBP_COLS if c in have]); GT = sqm.game_table(sqm.shots(pbp), sqm.load_rates())
    g = nd.games(); g["date"] = pd.to_datetime(g.date); s = g[(g.season == season) & (g.season_type == 2)]
    for D in sorted(s.date.unique()):
        st = sqm.state(None, g[g.date < D], season, G=GT)
        for r in s[(s.date == D) & s.total_line.notna()].itertuples():
            h, a = sqm.ctx(st, r.home), sqm.ctx(st, r.away)
            cold = (h["sq_gp"] >= 10 and a["sq_gp"] >= 10 and None not in (h["sq_l20"], a["sq_l20"], st.get("cold_mu")) and h["sq_l20"] + a["sq_l20"] - st["cold_mu"] <= COLD)
            sq = (h["sq_gp"] >= 5 and a["sq_gp"] >= 5 and None not in (h["sq_x10"], a["sq_x10"], st.get("sq_mu")) and (h["sq_x10"] + a["sq_x10"]) / 2 - r.total_line - st["sq_mu"] >= SQ)
            out.append((season, str(r.game_id), bool(cold or sq), np.nan if r.total == r.total_line else float(r.total > r.total_line)))
L = pd.DataFrame(out, columns=["season", "game_id", "fire", "over"])
R = pd.read_pickle(SP + 'espn_shot_frame.pkl'); R = R[R.season.isin([2025, 2026])].sort_values("date")
def center(G, d):
    x = pd.DataFrame({"s": G.season.values, "dt": G.date.values, "d": d.values})
    day = x.groupby(["s", "dt"]).d.agg(["sum", "count"]).groupby(level=0).cumsum().groupby(level=0).shift(1)
    mu = (day["sum"] / day["count"]).rename("mu").reset_index(); return pd.Series(d.values - x.merge(mu, on=["s", "dt"], how="left").mu.values, index=d.index)
Rall = pd.read_pickle(SP + 'espn_shot_frame.pkl').sort_values("date")
c = center(Rall, Rall.h_lucktot_20 + Rall.a_lucktot_20); e = center(Rall, (Rall.h_xtot_10 + Rall.a_xtot_10) / 2 - Rall.total_line)
Rall["rfire"] = (((Rall.h_gp >= 10) & (Rall.a_gp >= 10) & (c <= COLD)) | ((Rall.h_gp >= 5) & (Rall.a_gp >= 5) & (e >= SQ)))
J = L.merge(Rall[["game_id", "rfire"]].assign(game_id=lambda x: x.game_id.astype(str)), on="game_id")
print(f"games compared {len(J)} | live fires {int(J.fire.sum())} | research fires {int(J.rfire.sum())} | same decision on {100*(J.fire == J.rfire).mean():.1f}% of games")
for s_ in (2025, 2026):
    x = L[(L.season == s_) & L.fire].over.dropna(); print(f"  {s_ - 1}-{str(s_)[2:]}: live rule fired {len(x)} times, Over won {100*x.mean():.1f}%")
