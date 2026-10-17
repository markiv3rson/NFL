"""The shot-quality angles of research/shot_quality.py rebuilt on ESPN's play-by-play (sportsdataverse espn_nba_pbp, the feed the service
can read every night), as an independent second source. Per shot: 2 or 3 (points_attempted), distance from the court coordinates
(basket at x = +-41.75 ft; the "N-foot" in the text when coordinates are missing), kind from the play type (dunk / tip / layup / hook / fade /
jumper); expected points = make rate of that cell in the OTHER seasons x value. Same pre-game features (prior games of the season only), same
angles, totals centred on the season's running average. ESPN game ids are the game table's own ids, so no name matching is needed.
Usage (from railway-model-service): PYTHONPATH=. python3 research/shot_quality_espn.py <dir with play_by_play_<season>.parquet> [nba.com frame.pkl]"""
import sys, os, glob, re, warnings, numpy as np, pandas as pd
warnings.filterwarnings("ignore")
sys.path.insert(0, "."); import nba_data as nd
PBP = sys.argv[1]; NBA = sys.argv[2] if len(sys.argv) > 2 else None
per = lambda s: "08-13" if s <= 2013 else "14-19" if s <= 2019 else "20+"
BE = 52.38; P = ("08-13", "14-19", "20+")
KIND = [("dunk", "dunk"), ("tip", "tip"), ("layup|finger roll|putback", "layup"), ("hook", "hook"), ("fade", "fade")]

def shots_of(f):
    c = ["game_id", "season", "season_type", "team_id", "home_team_id", "away_team_id", "type_text", "text", "shooting_play", "points_attempted",
         "scoring_play", "coordinate_x", "coordinate_y"]
    import pyarrow.parquet as pq
    have = set(pq.read_schema(f).names); p = pd.read_parquet(f, columns=[x for x in c if x in have])
    if "points_attempted" not in p: p["points_attempted"] = np.nan          # older files: 2 or 3 from the text
    p = p[(p.season_type == 2) & (p.shooting_play == True) & ~p.type_text.fillna("").str.contains("Free Throw")].copy()
    t = p.text.fillna("").str.lower()
    p["three"] = np.where(p.points_attempted.isin([2, 3]), (p.points_attempted == 3).astype(int), t.str.contains("three point").astype(int))
    x, y = pd.to_numeric(p.coordinate_x, errors="coerce"), pd.to_numeric(p.coordinate_y, errors="coerce")
    ok = x.abs().le(47) & y.abs().le(25) & x.notna()
    d = np.sqrt((x.abs() - 41.75) ** 2 + y ** 2).where(ok)
    p["dist"] = d.fillna(pd.to_numeric(t.str.extract(r"(\d+)-foot")[0], errors="coerce"))
    p["db"] = pd.cut(p.dist.clip(0, 40), [-1, 1, 2, 3, 4, 7, 11, 15, 19, 22, 23, 25, 27, 30, 99], labels=False).astype("float").fillna(-1).astype(int)
    k = p.type_text.fillna("").str.lower(); p["kind"] = "jump"
    for pat, lab in reversed(KIND): p.loc[k.str.contains(pat), "kind"] = lab
    p["made"] = p.scoring_play.fillna(False).astype(int); p["val"] = 2 + p.three
    tid, hid, aid = (pd.to_numeric(p[c], errors="coerce") for c in ("team_id", "home_team_id", "away_team_id"))   # team_id is a float in these files
    p["side"] = np.where(tid == hid, "h", np.where(tid == aid, "a", None))
    return p[p.side.notna()][["game_id", "season", "side", "three", "db", "kind", "made", "val", "dist"]]
S = pd.concat([shots_of(f) for f in sorted(glob.glob(os.path.join(PBP, "play_by_play_*.parquet")))], ignore_index=True)
S["cell"] = S.three.astype(str) + "|" + S.db.astype(str) + "|" + S.kind
S["xm"] = np.nan
for key in (["cell"], ["three", "db"], ["three"]):
    tot = S.groupby(key).made.agg(["sum", "count"]).rename(columns={"sum": "m", "count": "n"})
    bys = S.groupby(key + ["season"]).made.agg(["sum", "count"]).rename(columns={"sum": "ms", "count": "ns"}).reset_index().merge(tot.reset_index(), on=key)
    bys["rate"] = (bys.m - bys.ms) / (bys.n - bys.ns).clip(lower=1); bys.loc[(bys.n - bys.ns) < 30, "rate"] = np.nan
    S = S.merge(bys[key + ["season", "rate"]], on=key + ["season"], how="left"); S["xm"] = S.xm.fillna(S.rate); S = S.drop(columns="rate")
S["xpts"] = S.xm * S.val; S["pts"] = S.made * S.val
cov = S.groupby("season").dist.apply(lambda d: d.notna().mean())
print(f"ESPN shots {len(S):,} | seasons {S.season.min()}-{S.season.max()} | shots with a distance by season: {dict((int(k), round(v, 2)) for k, v in cov.items())}", flush=True)
print(f"xpts/shot {S.xpts.mean():.3f} vs pts/shot {S.pts.mean():.3f}", flush=True)
TG = S.groupby(["game_id", "season", "side"]).agg(fga=("made", "size"), pts=("pts", "sum"), xpts=("xpts", "sum")).reset_index()
W = TG.pivot_table(index=["game_id", "season"], columns="side", values=["fga", "pts", "xpts"]).reset_index()
W.columns = ["game_id", "season"] + [f"sh{a}_{b}" for a, b in W.columns[2:]]          # shfga_h, shpts_h, shxpts_h ... (the game table has its own pts_h)
W["game_id"] = W.game_id.astype(str)

g = nd.games(); g = g[(g.season_type == 2) & g.margin.notna()].copy(); g["game_id"] = g.game_id.astype(str); g["date"] = pd.to_datetime(g.date)
g = g.merge(W.drop(columns="season"), on="game_id", how="inner")
print(f"games joined: {len(g):,}", flush=True)
rows = []
for s_, me, op in (("h", "h", "a"), ("a", "a", "h")):
    team = g.home if s_ == "h" else g.away
    rows.append(pd.DataFrame({"season": g.season, "date": g.date, "game_id": g.game_id, "team": team,
        "luck": (g[f"shpts_{me}"] - g[f"shxpts_{me}"]) - (g[f"shpts_{op}"] - g[f"shxpts_{op}"]),
        "xtot": g[f"shxpts_{me}"] + g[f"shxpts_{op}"], "lucktot": (g[f"shpts_{me}"] - g[f"shxpts_{me}"]) + (g[f"shpts_{op}"] - g[f"shxpts_{op}"])}))
T = pd.concat(rows).sort_values(["team", "season", "date"])
for N in (5, 10, 20):
    r = T.groupby(["team", "season"])[["luck", "xtot", "lucktot"]].transform(lambda c: c.shift(1).rolling(N, min_periods=max(3, N // 2)).mean())
    for c in r.columns: T[f"{c}_{N}"] = r[c]
T["gp"] = T.groupby(["team", "season"]).cumcount()
F = [c for c in T.columns if re.search(r"_(5|10|20)$", c)] + ["gp"]
G = g.merge(T[["game_id", "team"] + F].rename(columns={c: "h_" + c for c in F + ["team"]}), left_on=["game_id", "home"], right_on=["game_id", "h_team"]) \
     .merge(T[["game_id", "team"] + F].rename(columns={c: "a_" + c for c in F + ["team"]}), left_on=["game_id", "away"], right_on=["game_id", "a_team"])
G = G[G.home_line.notna()].sort_values("date").copy(); G["per"] = G.season.map(per)
G["hcov"] = np.where(G.margin == G.home_line, np.nan, (G.margin - G.home_line > 0).astype(float))
G["over"] = np.where(G.total == G.total_line, np.nan, (G.total > G.total_line).astype(float))
print(f"lined games with features: {len(G):,} | home covers {100*G.hcov.mean():.1f}% | over {100*G.over.mean():.1f}%", flush=True)

def center(d):
    x = pd.DataFrame({"s": G.season.values, "dt": G.date.values, "d": d.values})
    day = x.groupby(["s", "dt"]).d.agg(["sum", "count"]).groupby(level=0).cumsum().groupby(level=0).shift(1)
    mu = (day["sum"] / day["count"]).rename("mu").reset_index()
    return pd.Series(d.values - x.merge(mu, on=["s", "dt"], how="left").mu.values, index=d.index)
def rep(name, bet_home, mask, res):
    x = G[mask]; w = np.where(bet_home, x[res], 1 - x[res]); ok = ~np.isnan(w); x = x[ok]; w = w[ok]
    byp = [(100 * w[x.per.values == q].mean() if (x.per.values == q).any() else float("nan"), int((x.per.values == q).sum())) for q in P]
    seas = pd.Series(w).groupby(x.season.values).mean(); passed = all(v[0] >= BE and v[1] >= 60 for v in byp)
    print(f"  {name:62s} {100*w.mean():5.1f}% of {len(x):5d} | " + " / ".join(f"{v[0]:.1f}" for v in byp) + f" | seasons >50: {int((seas > .5).sum())}/{len(seas)}" + ("  PASS" if passed else ""))
    return passed
print("\n== the three angles found on nba.com's shot data, rebuilt on ESPN's (and their mirrors)")
ok5 = (G.h_gp >= 2) & (G.a_gp >= 2); d = G.h_luck_5 - G.a_luck_5; m = ok5 & d.notna()
rep("SPREAD luck last 5: home luckier (top 5%) -> AWAY", False, m & (d >= d[m].quantile(.95)), "hcov")
rep("  mirror: away luckier (top 5%) -> HOME", True, m & (d <= d[m].quantile(.05)), "hcov")
rep("  both ways, top 10% either side -> the unlucky side", (d <= d[m].quantile(.05)).values[(m & ((d >= d[m].quantile(.95)) | (d <= d[m].quantile(.05)))).values], m & ((d >= d[m].quantile(.95)) | (d <= d[m].quantile(.05))), "hcov")
e = center((G.h_xtot_5 + G.a_xtot_5) / 2 - G.total_line); m = ok5 & e.notna()
rep("TOTAL expected shot points ABOVE the total, last 5 (top 10%) -> OVER", True, m & (e >= e[m].quantile(.9)), "over")
rep("  mirror: BELOW (top 10%) -> UNDER", False, m & (e <= e[m].quantile(.1)), "over")
ok20 = (G.h_gp >= 10) & (G.a_gp >= 10); c = center(G.h_lucktot_20 + G.a_lucktot_20); m = ok20 & c.notna()
rep("TOTAL both teams' games ran COLD last 20 (top 10%) -> OVER", True, m & (c <= c[m].quantile(.1)), "over")
rep("  mirror: HOT (top 10%) -> UNDER", False, m & (c >= c[m].quantile(.9)), "over")
print("\n== neighbours (same idea, other windows / cut-offs)")
for N in (5, 10, 20):
    okn = (G[f"h_gp"] >= N // 2) & (G[f"a_gp"] >= N // 2)
    d = G[f"h_luck_{N}"] - G[f"a_luck_{N}"]; m = okn & d.notna()
    for q in (.9, .95): rep(f"SPREAD luck last {N}: home luckier (top {round(100*(1-q))}%) -> AWAY", False, m & (d >= d[m].quantile(q)), "hcov")
    e = center((G[f"h_xtot_{N}"] + G[f"a_xtot_{N}"]) / 2 - G.total_line); m = okn & e.notna()
    for q in (.8, .9, .95): rep(f"TOTAL expected ABOVE the total last {N} (top {round(100*(1-q))}%) -> OVER", True, m & (e >= e[m].quantile(q)), "over")
    c = center(G[f"h_lucktot_{N}"] + G[f"a_lucktot_{N}"]); m = okn & c.notna()
    for q in (.1, .2): rep(f"TOTAL both COLD last {N} (top {round(100*q)}%) -> OVER", True, m & (c <= c[m].quantile(q)), "over")
if NBA:
    Nb = pd.read_pickle(NBA)[["game_id", "h_luck_5", "h_xtot_5", "h_lucktot_20"]].rename(columns=lambda c: c if c == "game_id" else "nba_" + c)
    Nb["game_id"] = Nb.game_id.astype(str); J = G.merge(Nb, on="game_id")
    print(f"\nsame games on both sources: {len(J):,} | correlation of the pre-game numbers: luck last 5 {J.h_luck_5.corr(J.nba_h_luck_5):.2f}, "
          f"expected points last 5 {J.h_xtot_5.corr(J.nba_h_xtot_5):.2f}, total luck last 20 {J.h_lucktot_20.corr(J.nba_h_lucktot_20):.2f}")
G.to_pickle(os.path.join(PBP, "espn_shot_frame.pkl"))
