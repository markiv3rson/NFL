"""Lineup-based player ratings (adjusted plus-minus from who was on the floor) vs the closing line.
Input: stints from research/lineups_build.py (five players a side, points, possessions per stretch), the nba.com shot files only to map
nba.com game ids to date + home team, and our game table for lines and results.
Ratings: a ridge regression of the margin per 100 possessions on the ten players on the floor (+1 home side, -1 away side) plus home court,
weighted by possessions, refit at the start of each month on everything from the previous season and this season BEFORE that month.
Tonight's team strength: its players' ratings weighted by their share of the team's floor time in its previous 10 games (a trade shows up as
soon as the new player plays). A hindsight version (the players who actually played tonight, by their floor time tonight) is printed only to
show how much "who plays" matters; the page could never know it.
Tests: ridge on the market's miss with each season left out; the side when the rating gap disagrees with the line, by period.
Usage: PYTHONPATH=. python3 research/lineups_rapm.py <stints.parquet> <shot dir>"""
import sys, os, glob, re, warnings, numpy as np, pandas as pd
from scipy import sparse
from sklearn.linear_model import Ridge
warnings.filterwarnings("ignore")
sys.path.insert(0, "."); import nba_data as nd
ST, SHOT = sys.argv[1], sys.argv[2]
NORM = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "NOH": "NOP", "NOK": "NOP", "UTAH": "UTA", "WSH": "WAS", "NJ": "BKN", "NJN": "BKN", "SEA": "OKC"}
nm = lambda t: NORM.get(t, t)
per = lambda s: "08-13" if s <= 2013 else "14-19" if s <= 2019 else "20+"
P = ("08-13", "14-19", "20+")
S = pd.read_parquet(ST); S = S[S.ok & (S.poss > 0)].copy()
mp = pd.concat([pd.read_csv(f, usecols=["GAME_ID", "GAME_DATE", "HTM", "VTM"], dtype={"GAME_ID": str}).drop_duplicates("GAME_ID")
                for f in glob.glob(os.path.join(SHOT, "shotdetail_*.csv"))]).drop_duplicates("GAME_ID")
mp["date"] = pd.to_datetime(mp.GAME_DATE.astype(str), format="%Y%m%d"); mp["home"] = mp.HTM.map(nm); mp["away"] = mp.VTM.map(nm)
S = S.merge(mp[["GAME_ID", "date", "home", "away"]], left_on="nba_game_id", right_on="GAME_ID", how="inner")
print(f"stints with complete lineups mapped to a date: {len(S):,} | seasons {S.season.min()}-{S.season.max()}", flush=True)
S["y"] = 100 * (S.hpts - S.apts) / S.poss.clip(lower=0.5)
H5 = S.home5.str.split(","); A5 = S.away5.str.split(",")
players = sorted(set(p for l in H5 for p in l) | set(p for l in A5 for p in l)); pix = {p: i for i, p in enumerate(players)}
rows = np.repeat(np.arange(len(S)), 10); cols = np.array([pix[p] for h, a in zip(H5, A5) for p in h + a]); vals = np.tile(np.r_[np.ones(5), -np.ones(5)], len(S))
X = sparse.csr_matrix((vals, (rows, cols)), shape=(len(S), len(players)))
S["month"] = S.date.dt.to_period("M")
# ---- walk-forward ratings: refit at the start of each month of each season
ratings = {}            # (season, month) -> Series of ratings by player id
for s in sorted(S.season.unique()):
    for mth in sorted(S[S.season == s].month.unique()):
        tr = ((S.season == s - 1) | ((S.season == s) & (S.month < mth))).values
        if tr.sum() < 5000: continue
        m = Ridge(alpha=3000.0, fit_intercept=True, solver="sparse_cg").fit(X[tr], S.y.values[tr], sample_weight=S.poss.values[tr])
        ratings[(s, mth)] = pd.Series(m.coef_, index=players)
    print(f"  ratings for {s}: {sum(1 for k in ratings if k[0] == s)} months", flush=True)
# ---- floor time per player per team-game
long = []
for side, col in (("home", "home5"), ("away", "away5")):
    t = S[["season", "date", "GAME_ID", side, col, "secs"]].rename(columns={side: "team", col: "five"})
    t = t.assign(pid=t.five.str.split(",")).explode("pid"); long.append(t[["season", "date", "GAME_ID", "team", "pid", "secs"]])
L = pd.concat(long).groupby(["season", "date", "GAME_ID", "team", "pid"]).secs.sum().reset_index()
games = L[["season", "date", "GAME_ID", "team"]].drop_duplicates().sort_values(["team", "season", "date"])
def strength(rt, shares):
    if rt is None or shares is None or shares.empty: return np.nan
    w = shares / shares.sum() * 5; return float((w * rt.reindex(w.index).fillna(0)).sum())
out = []
for (team, s), grp in games.groupby(["team", "season"]):
    gl = grp.GAME_ID.tolist(); dates = grp.date.tolist(); LT = L[(L.team == team) & (L.season == s)]
    by = {gid: x.set_index("pid").secs for gid, x in LT.groupby("GAME_ID")}
    for i, (gid, dt) in enumerate(zip(gl, dates)):
        rt = ratings.get((s, pd.Period(dt, "M")))
        prev = pd.concat([by[x] for x in gl[max(0, i - 10):i]]).groupby(level=0).sum() if i >= 3 else None
        out.append((gid, team, strength(rt, prev), strength(rt, by.get(gid))))
R = pd.DataFrame(out, columns=["GAME_ID", "team", "pre", "hind"])
g = nd.games(); g = g[(g.season_type == 2) & g.home_line.notna()].copy(); g["date"] = pd.to_datetime(g.date)
g["home_n"] = g.team_abbreviation_h.map(nm); g["away_n"] = g.team_abbreviation_a.map(nm)
G = g.merge(mp[["GAME_ID", "date", "home"]], left_on=["date", "home_n"], right_on=["date", "home"], how="inner")
G = G.merge(R.rename(columns={"team": "home_n", "pre": "h_pre", "hind": "h_hind"}), on=["GAME_ID", "home_n"]).merge(
    R.rename(columns={"team": "away_n", "pre": "a_pre", "hind": "a_hind"}), on=["GAME_ID", "away_n"])
G["per"] = G.season.map(per); G["miss"] = G.margin - G.home_line; G["hcov"] = np.where(G.miss == 0, np.nan, (G.miss > 0).astype(float))
G["d_pre"] = G.h_pre - G.a_pre; G["d_hind"] = G.h_hind - G.a_hind
print(f"lined games with lineup ratings: {len(G):,} (pre-game {G.d_pre.notna().sum():,}) | home covers {100*G.hcov.mean():.1f}%", flush=True)
print(f"correlation with the market line: pre-game {G.d_pre.corr(G.home_line):.2f}, hindsight {G.d_hind.corr(G.home_line):.2f}")
def test(col, label):
    Z = G[G[col].notna()].copy(); pred = pd.Series(np.nan, index=Z.index)
    for s in sorted(Z.season.unique()):
        tr, te = Z.season != s, Z.season == s
        m = Ridge(alpha=1.0).fit(Z.loc[tr, [col, "home_line"]], Z.loc[tr, "miss"]); pred[te] = m.predict(Z.loc[te, [col, "home_line"]])
    base = np.sqrt((Z.miss ** 2).mean()); new = np.sqrt(((Z.miss - pred) ** 2).mean())
    print(f"\n== {label}: {len(Z):,} games | miss of the line {base:.3f} -> line + ratings {new:.3f}")
    for q in (0.8, 0.9, 0.95):
        cut = pred.abs().quantile(q); m = pred.abs() >= cut; w = np.where(pred[m] > 0, Z.loc[m, "hcov"], 1 - Z.loc[m, "hcov"]); ok = ~np.isnan(w); x = Z[m][ok]; w = w[ok]
        print(f"  top {round(100*(1-q))}% by gap: side wins {100*w.mean():.1f}% of {len(x)} | by period " + " / ".join(f"{100*w[x.per.values == p].mean():.1f}" for p in P)
              + f" | seasons >50: {int((pd.Series(w).groupby(x.season.values).mean() > .5).sum())}/{x.season.nunique()}")
test("d_pre", "LINEUP RATINGS, PRE-GAME (players' share of floor time in the last 10 games)")
test("d_hind", "LINEUP RATINGS, HINDSIGHT (who actually played tonight; not knowable before tip-off)")
