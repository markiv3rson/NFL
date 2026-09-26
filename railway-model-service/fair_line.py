#!/usr/bin/env python3
"""
fair_line.py — opponent-adjusted power ratings -> fair spread, total, win %, + wind.

  python3 fair_line.py --away ATL --home GB --wind 10 --outdoor
  python3 fair_line.py --away ATL --home GB --wind 10 --outdoor --spread 5.5 --total 42.5
  python3 fair_line.py --backtest 2025

Method (public nflverse play-by-play):
  1. Offensive EPA/play per team-game (pass + run plays, regular season).
  2. Ridge: EPA/play = offense + opponent defense + home edge. Current season weight 1.0, last season 0.2.
  3. EPA/play -> points via a linear fit on the same games.
  4. Margin ~ Normal(mean, 13), total ~ Normal(mean, 10).
  5. Wind (outdoor/open roof only): total += -0.267 * (wind_mph - 7.5). Fit 2021-23, applied forward;
     cut 5-season total MAE 10.71 -> 10.62.
  6. --adj "ATL=+1.5" manually shifts a team's points (QB change etc.). Not validated -- label it.

Backtest 2021-25 (n=1,119): spreads and totals do NOT beat the market (totals 47.8% pooled vs 52.4%
break-even). Used for weekly forward-testing in Line Room and as a sanity check. Label outputs Estimate.
"""
import argparse, os, math, urllib.request
import numpy as np, pandas as pd
from sklearn.linear_model import Ridge

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
CACHE = os.path.expanduser("~/.nfl_cache")
SD_MARGIN, SD_TOTAL, PRIOR_W, ALPHA, WIND_COEF = 13.0, 10.0, 0.2, 4.0, -0.267

def fetch(season, fresh=None):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, f"pbp_{season}.parquet")
    if fresh is None: fresh = season >= 2026
    if fresh or not os.path.exists(f):
        urllib.request.urlretrieve(f"{BASE}/pbp/play_by_play_{season}.parquet", f)
    return pd.read_parquet(f)

def team_games(p):
    p = p[(p.season_type == "REG") & p.play_type.isin(["pass", "run"]) & p.epa.notna()]
    g = p.groupby(["game_id", "season", "week", "posteam", "defteam"]).agg(
        epa=("epa", "mean"), home_team=("home_team", "first")).reset_index()
    g["home"] = (g.posteam == g.home_team).astype(int)
    sc = p.drop_duplicates("game_id").set_index("game_id")[["home_score", "away_score", "spread_line", "total_line", "result", "total", "roof", "wind"]]
    g = g.join(sc, on="game_id")
    g["pts"] = np.where(g.home == 1, g.home_score, g.away_score)
    return g

def fit(rows, w):
    teams = sorted(set(rows.posteam) | set(rows.defteam)); idx = {t: i for i, t in enumerate(teams)}; n = len(teams)
    X = np.zeros((len(rows), 2 * n + 1))
    for r, (o, d, h) in enumerate(zip(rows.posteam, rows.defteam, rows.home)):
        X[r, idx[o]] = 1; X[r, n + idx[d]] = 1; X[r, 2 * n] = h
    m = Ridge(alpha=ALPHA).fit(X, rows.epa, sample_weight=w)
    return dict(off=dict(zip(teams, m.coef_[:n])), dfn=dict(zip(teams, m.coef_[n:2 * n])),
                hfa=m.coef_[2 * n], mu=m.intercept_, pts=np.polyfit(rows.epa, rows.pts, 1))

def predict(M, away, home, adj=None):
    adj = adj or {}
    eh = M["mu"] + M["off"][home] + M["dfn"][away] + M["hfa"]; ea = M["mu"] + M["off"][away] + M["dfn"][home]
    return np.polyval(M["pts"], eh) + adj.get(home, 0), np.polyval(M["pts"], ea) + adj.get(away, 0)

def wind_adj(total, wind, outdoor):
    if not outdoor or wind is None or (isinstance(wind, float) and np.isnan(wind)): return total, 0.0
    d = WIND_COEF * (wind - 7.5); return total + d, d

def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def build(season):
    cur = team_games(fetch(season)); prior = team_games(fetch(season - 1))
    rows = pd.concat([prior, cur]); w = np.r_[np.full(len(prior), PRIOR_W), np.ones(len(cur))]
    return fit(rows, w), cur

def backtest(season):
    allg = team_games(fetch(season)); prior = team_games(fetch(season - 1)); out = []
    for wk in range(4, int(allg.week.max()) + 1):
        cur = allg[allg.week < wk]
        M = fit(pd.concat([prior, cur]), np.r_[np.full(len(prior), PRIOR_W), np.ones(len(cur))])
        for gid, x in allg[(allg.week == wk) & (allg.home == 1)].set_index("game_id").iterrows():
            ph, pa = predict(M, x.defteam, x.posteam)
            t, _ = wind_adj(ph + pa, x.wind, x.roof in ("outdoors", "open"))
            out.append(dict(week=wk, mm=ph - pa, mt=t, km=x.spread_line, kt=x.total_line, res=x.result, tot=x.total))
    b = pd.DataFrame(out)
    print(f"Backtest {season}: {len(b)} games | margin MAE model {abs(b.mm-b.res).mean():.2f} vs close {abs(b.km-b.res).mean():.2f}"
          f" | total MAE model {abs(b.mt-b.tot).mean():.2f} vs close {abs(b.kt-b.tot).mean():.2f}")
    return b

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--away"); ap.add_argument("--home"); ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--adj", default=""); ap.add_argument("--wind", type=float); ap.add_argument("--outdoor", action="store_true")
    ap.add_argument("--spread", type=float, help="market home favored margin, e.g. 5.5"); ap.add_argument("--total", type=float)
    ap.add_argument("--backtest", type=int)
    a = ap.parse_args()
    if a.backtest: backtest(a.backtest); return
    adj = {k: float(v) for k, v in (x.split("=") for x in a.adj.split(",") if x)}
    M, cur = build(a.season)
    ph, pa = predict(M, a.away, a.home, adj); margin = ph - pa
    total, wd = wind_adj(ph + pa, a.wind, a.outdoor)
    ph, pa = ph + wd / 2, pa + wd / 2
    p_home = 1 - ncdf(-margin / SD_MARGIN)
    print(f"{a.away} @ {a.home} ({a.season}, weeks played {int(cur.week.max())}) — Estimate")
    if adj: print(f"  manual adj: {adj}")
    if wd: print(f"  wind {a.wind:.0f} mph: {wd:+.2f} pts on total")
    print(f"  Fair score: {a.home} {ph:.1f} – {a.away} {pa:.1f}")
    print(f"  Fair spread: {a.home} {-margin:+.1f} | Fair total: {total:.1f} | Win: {a.home} {p_home*100:.1f}% / {a.away} {(1-p_home)*100:.1f}%")
    if a.spread is not None:
        pc = 1 - ncdf((a.spread - margin) / SD_MARGIN)
        print(f"  {a.home} -{a.spread} covers: {pc*100:.1f}% | {a.away} +{a.spread} covers: {(1-pc)*100:.1f}%")
    if a.total is not None:
        pu = ncdf((a.total - total) / SD_TOTAL); print(f"  Under {a.total}: {pu*100:.1f}% | Over: {(1-pu)*100:.1f}%")

if __name__ == "__main__":
    main()
