"""Shot quality and shooting luck vs the closing line (owner 10/17: "test shot quality, matchups and lineups against the line").
Data: nba.com shot detail for every regular-season shot 2007-08 .. 2025-26, from the public GitHub mirror shufinskiy/nba_data
(raw.githubusercontent.com/shufinskiy/nba_data/main/datasets/shotdetail_<start year>.tar.xz), unpacked into <dir>.
Per shot: expected points = make rate of shots like it (2 or 3, zone, distance, kind: dunk / layup / hook / tip / jumper) in the OTHER seasons
x its value. Per team-game: actual field-goal points, expected field-goal points, for its own shots and the opponent's.
Pre-game features (prior games of the same season only): shooting luck (actual minus expected, own minus opponent's), expected shooting
margin, actual margin, last 5 / 10 / 20 games. Tests on closing lines (home_line = home expected margin, + = home favoured; the home side
covers when margin - home_line > 0): angle buckets by period with a shuffle count, and a ridge on the market's miss with each season left out.
Usage (from railway-model-service): PYTHONPATH=. python3 research/shot_quality.py <shot dir> [out.pkl]"""
import sys, os, glob, re, numpy as np, pandas as pd
sys.path.insert(0, "."); import nba_data as nd
SHOT_DIR = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else None
NORM = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "NOH": "NOP", "NOK": "NOP", "UTAH": "UTA", "WSH": "WAS", "NJ": "BKN", "NJN": "BKN", "SEA": "OKC"}
nm = lambda t: NORM.get(t, t)
per = lambda s: "08-13" if s <= 2013 else "14-19" if s <= 2019 else "20+"
BE = 52.38

# ---------------------------------------------------------------- shots
cols = ["GAME_ID", "TEAM_ID", "SHOT_TYPE", "SHOT_ZONE_BASIC", "SHOT_DISTANCE", "ACTION_TYPE", "SHOT_MADE_FLAG", "GAME_DATE", "HTM", "VTM"]
parts = []
for f in sorted(glob.glob(os.path.join(SHOT_DIR, "shotdetail_*.csv"))):
    y = int(re.search(r"_(\d{4})\.csv$", f).group(1))
    if y < 2007: continue
    x = pd.read_csv(f, usecols=cols, dtype={"GAME_ID": str}); x["season"] = y + 1; parts.append(x)
S = pd.concat(parts, ignore_index=True)
S["three"] = S.SHOT_TYPE.str.startswith("3").astype(int); S["val"] = 2 + S.three
a = S.ACTION_TYPE.str.lower()
S["kind"] = np.select([a.str.contains("dunk"), a.str.contains("tip"), a.str.contains("layup|finger roll"), a.str.contains("hook"), a.str.contains("fade")],
                      ["dunk", "tip", "layup", "hook", "fade"], "jump")
S["dist"] = pd.cut(S.SHOT_DISTANCE.clip(0, 40), [-1, 0, 1, 2, 3, 4, 7, 11, 15, 19, 22, 23, 25, 27, 30, 99], labels=False)
S["cell"] = S.three.astype(str) + "|" + S.SHOT_ZONE_BASIC + "|" + S.dist.astype(str) + "|" + S.kind
S["made"] = S.SHOT_MADE_FLAG.astype(int)
# make rate of the cell in the OTHER seasons (fallback: 2/3 + zone + distance, then 2/3)
S["xm"] = np.nan
for key in (["cell"], ["three", "SHOT_ZONE_BASIC", "dist"], ["three"]):
    tot = S.groupby(key).made.agg(["sum", "count"]).rename(columns={"sum": "m", "count": "n"})
    bys = S.groupby(key + ["season"]).made.agg(["sum", "count"]).rename(columns={"sum": "ms", "count": "ns"}).reset_index()
    bys = bys.merge(tot.reset_index(), on=key); bys["rate"] = (bys.m - bys.ms) / (bys.n - bys.ns).clip(lower=1); bys.loc[(bys.n - bys.ns) < 30, "rate"] = np.nan
    S = S.merge(bys[key + ["season", "rate"]], on=key + ["season"], how="left")
    S["xm"] = S.xm.fillna(S.rate); S = S.drop(columns="rate")
S["xpts"] = S.xm * S.val; S["pts"] = S.made * S.val
S["rim"] = (S.SHOT_ZONE_BASIC == "Restricted Area").astype(int); S["mid"] = (S.SHOT_ZONE_BASIC == "Mid-Range").astype(int)
print(f"shots {len(S):,} | seasons {S.season.min()}-{S.season.max()} | expected make rate missing {S.xm.isna().mean():.4f} | xpts/shot {S.xpts.mean():.3f} vs pts/shot {S.pts.mean():.3f}", flush=True)
# team id -> tricode per season: the code shared by all of its games
tri = {}
for (s, t), grp in S.groupby(["season", "TEAM_ID"]):
    sets = grp.drop_duplicates("GAME_ID")[["HTM", "VTM"]].values
    common = set(sets[0]);
    for h, v in sets[1:]: common &= {h, v}
    tri[(s, t)] = nm(sorted(common)[0]) if len(common) == 1 else None
S["team"] = [tri.get(k) for k in zip(S.season, S.TEAM_ID)]
TG = S.groupby(["season", "GAME_ID", "GAME_DATE", "HTM", "team"]).agg(fga=("made", "size"), pts=("pts", "sum"), xpts=("xpts", "sum"), fg3a=("three", "sum"), rim=("rim", "sum"), mid=("mid", "sum")).reset_index()
TG["home"] = TG.HTM.map(nm); TG["date"] = pd.to_datetime(TG.GAME_DATE.astype(str), format="%Y%m%d")
opp = TG[["GAME_ID", "team", "fga", "pts", "xpts", "fg3a"]].rename(columns=lambda c: c if c == "GAME_ID" else "o_" + c)
TG = TG.merge(opp, on="GAME_ID"); TG = TG[TG.team != TG.o_team].copy()
TG["luck"] = (TG.pts - TG.xpts) - (TG.o_pts - TG.o_xpts)          # own shooting luck minus the opponent's, points
TG["xnet"] = TG.xpts - TG.o_xpts                                    # expected field-goal points margin
TG["luck_off"] = TG.pts - TG.xpts; TG["luck_def"] = TG.o_pts - TG.o_xpts
TG["xq_off"] = TG.xpts / TG.fga; TG["xq_def"] = TG.o_xpts / TG.o_fga
TG["r3"] = TG.fg3a / TG.fga; TG["rrim"] = TG.rim / TG.fga
TG["xtot"] = TG.xpts + TG.o_xpts; TG["lucktot"] = TG.luck_off + TG.luck_def
print(f"team-games {len(TG):,}", flush=True)

# ---------------------------------------------------------------- games + lines
g = nd.games(); g = g[(g.season_type == 2) & g.margin.notna()].copy()
g["home_n"] = g.team_abbreviation_h.map(nm); g["away_n"] = g.team_abbreviation_a.map(nm); g["date"] = pd.to_datetime(g.date)
# actual margin per team-game from our own table (all games, lined or not)
long = pd.concat([pd.DataFrame({"season": g.season, "date": g.date, "team": g.home_n, "mar": g.margin, "tot": g.total}),
                  pd.DataFrame({"season": g.season, "date": g.date, "team": g.away_n, "mar": -g.margin, "tot": g.total})])
T = TG.merge(long, on=["season", "date", "team"], how="inner").sort_values(["team", "season", "date"])
print(f"team-games joined to our games: {len(T):,} of {len(TG):,}", flush=True)
FEATS = ["luck", "xnet", "mar", "luck_off", "luck_def", "xq_off", "xq_def", "r3", "rrim", "xtot", "lucktot", "tot"]
for N in (5, 10, 20):
    r = T.groupby(["team", "season"])[FEATS].transform(lambda c: c.shift(1).rolling(N, min_periods=max(3, N // 2)).mean())
    for c in FEATS: T[f"{c}_{N}"] = r[c]
T["gp"] = T.groupby(["team", "season"]).cumcount()
F = [c for c in T.columns if re.search(r"_(5|10|20)$", c)] + ["gp"]
H = T[["season", "date", "team"] + F].rename(columns={c: "h_" + c for c in F + ["team"]})
A = T[["season", "date", "team"] + F].rename(columns={c: "a_" + c for c in F + ["team"]})
G = g.merge(H, left_on=["season", "date", "home_n"], right_on=["season", "date", "h_team"]).merge(A, left_on=["season", "date", "away_n"], right_on=["season", "date", "a_team"])
G = G[G.home_line.notna()].copy(); G["per"] = G.season.map(per)
G["miss"] = G.margin - G.home_line; G["hcov"] = np.where(G.miss == 0, np.nan, (G.miss > 0).astype(float))
G["tmiss"] = G.total - G.total_line; G["over"] = np.where(G.tmiss == 0, np.nan, (G.tmiss > 0).astype(float))
print(f"lined games with features: {len(G):,} | home covers {100*G.hcov.mean():.1f}% | over {100*G.over.mean():.1f}%", flush=True)
if OUT: G.to_pickle(OUT)

# ---------------------------------------------------------------- angle buckets
def rep(name, side_home, mask, res="hcov"):
    """side_home: True = bet home (or Over), False = bet away (Under) on the masked games."""
    x = G[mask]; w = np.where(side_home[mask], x[res], 1 - x[res]); ok = ~np.isnan(w); x = x[ok]; w = w[ok]
    if not len(x): return None
    byp = {q: (100 * w[x.per.values == q].mean(), int((x.per.values == q).sum())) for q in ("08-13", "14-19", "20+")}
    seas = pd.Series(w).groupby(x.season.values).mean(); passed = all(v[0] >= BE and v[1] >= 60 for v in byp.values())
    print(f"  {name:58s} {100*w.mean():5.1f}% of {len(x):5d} | " + " / ".join(f"{v[0]:.1f}" for v in byp.values()) + f" | seasons >50: {int((seas > .5).sum())}/{len(seas)}" + ("  PASS" if passed else ""))
    return passed
def angles(G, quiet=False):
    out = []
    for N in (5, 10, 20):
        d = G[f"h_luck_{N}"] - G[f"a_luck_{N}"]; ok = d.notna() & (G.h_gp >= N // 2) & (G.a_gp >= N // 2)
        for q in (0.9, 0.95):
            hi, lo = d[ok].quantile(q), d[ok].quantile(1 - q)
            out.append((f"luck last {N}: home luckier (top {round(100*(1-q))}%) -> bet AWAY", np.zeros(len(G), bool), ok & (d >= hi)))
            out.append((f"luck last {N}: away luckier (top {round(100*(1-q))}%) -> bet HOME", np.ones(len(G), bool), ok & (d <= lo)))
        dx = (G[f"h_xnet_{N}"] - G[f"a_xnet_{N}"]) - (G[f"h_mar_{N}"] - G[f"a_mar_{N}"])   # expected better than results
        for q in (0.9,):
            hi, lo = dx[ok].quantile(q), dx[ok].quantile(1 - q)
            out.append((f"expected minus actual last {N}: home under-rated (top 10%) -> HOME", np.ones(len(G), bool), ok & (dx >= hi)))
            out.append((f"expected minus actual last {N}: away under-rated (top 10%) -> AWAY", np.zeros(len(G), bool), ok & (dx <= lo)))
    return out
print("\n== SPREAD angles (bet the unlucky side / the side whose shot quality beats its results)")
A1 = angles(G); n_pass = sum(bool(rep(n, s, m)) for n, s, m in A1)
def tangles(G):
    out = []
    for N in (5, 10, 20):
        d = G[f"h_lucktot_{N}"] + G[f"a_lucktot_{N}"]; ok = d.notna() & (G.h_gp >= N // 2) & (G.a_gp >= N // 2)
        hi, lo = d[ok].quantile(0.9), d[ok].quantile(0.1)
        out.append((f"both teams' games ran HOT last {N} (top 10%) -> UNDER", np.zeros(len(G), bool), ok & (d >= hi)))
        out.append((f"both teams' games ran COLD last {N} (top 10%) -> OVER", np.ones(len(G), bool), ok & (d <= lo)))
        e = (G[f"h_xtot_{N}"] + G[f"a_xtot_{N}"]) / 2 - G.total_line; okx = e.notna() & ok
        out.append((f"expected shot points far ABOVE the total, last {N} (top 10%) -> OVER", np.ones(len(G), bool), okx & (e >= e[okx].quantile(0.9))))
        out.append((f"expected shot points far BELOW the total, last {N} (top 10%) -> UNDER", np.zeros(len(G), bool), okx & (e <= e[okx].quantile(0.1))))
    return out
print("\n== TOTAL angles")
A2 = tangles(G); n_pass_t = sum(bool(rep(n, s, m, "over")) for n, s, m in A2)
print(f"\nangles passing every period: spread {n_pass} of {len(A1)}, total {n_pass_t} of {len(A2)}")
# shuffle: results shuffled within season, same angles; how many pass by luck alone
rng = np.random.default_rng(7); sh_s, sh_t = [], []
import io, contextlib
for k in range(20):
    G2 = G.copy()
    for col in ("hcov", "over"): G2[col] = G2.groupby("season")[col].transform(lambda c: pd.Series(rng.permutation(c.values), index=c.index))
    Gs, G = G, G2
    with contextlib.redirect_stdout(io.StringIO()):
        sh_s.append(sum(bool(rep(n, s, m)) for n, s, m in angles(G))); sh_t.append(sum(bool(rep(n, s, m, "over")) for n, s, m in tangles(G)))
    G = Gs
print(f"luck alone (20 shuffles): spread angles passing avg {np.mean(sh_s):.2f} (max {max(sh_s)}), total avg {np.mean(sh_t):.2f} (max {max(sh_t)})")

# ---------------------------------------------------------------- ridge on the market's miss, each season left out
from sklearn.linear_model import Ridge
def ridge(target, feats, label, side_col):
    X = G[feats].astype(float); ok = X.notna().all(axis=1) & G[target].notna(); Z = G[ok].copy(); X = X[ok]
    pred = pd.Series(np.nan, index=Z.index)
    for s in sorted(Z.season.unique()):
        tr, te = Z.season != s, Z.season == s
        mu, sd = X[tr].mean(), X[tr].std().replace(0, 1)
        m = Ridge(alpha=50.0).fit((X[tr] - mu) / sd, Z.loc[tr, target]); pred[te] = m.predict((X[te] - mu) / sd)
    base = np.sqrt((Z[target] ** 2).mean()); new = np.sqrt(((Z[target] - pred) ** 2).mean())
    print(f"\n== RIDGE {label}: {len(Z):,} games | miss of the line {base:.3f} -> line + model {new:.3f}")
    for q in (0.8, 0.9, 0.95):
        cut = pred.abs().quantile(q); m = pred.abs() >= cut; w = np.where(pred[m] > 0, Z.loc[m, side_col], 1 - Z.loc[m, side_col]); ok2 = ~np.isnan(w)
        x = Z[m][ok2]; w = w[ok2]
        byp = " / ".join(f"{100*w[x.per.values == p].mean():.1f}" for p in ("08-13", "14-19", "20+"))
        print(f"  top {round(100*(1-q))}% by model gap (|gap| >= {cut:.2f}): side wins {100*w.mean():.1f}% of {len(x)} | by period {byp}")
SF = [f"{s}_{c}_{N}" for c in ("luck", "xnet", "mar", "xq_off", "xq_def") for N in (5, 10, 20) for s in ("h", "a")]
ridge("miss", SF, "SPREAD (luck, expected margin, actual margin, shot quality for and against; home and away; 5 / 10 / 20 games)", "hcov")
TF = [f"{s}_{c}_{N}" for c in ("lucktot", "xtot", "tot", "r3", "rrim", "xq_off", "xq_def") for N in (5, 10, 20) for s in ("h", "a")]
ridge("tmiss", TF, "TOTAL (luck, expected shot points, actual totals, 3-point and rim rates, shot quality; 5 / 10 / 20 games)", "over")
