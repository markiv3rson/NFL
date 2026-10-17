#!/usr/bin/env python3
"""
fair_line.py — NBA only. Opponent-adjusted team ratings -> fair spread, total, win %.

  python3 fair_line.py --away LAC --home TOR
  python3 fair_line.py --backtest 2025

Method (public ESPN box scores via sportsdataverse):
  1. Per team-game points per 100 possessions (possessions = FGA - OREB + TOV + 0.44 FTA).
  2. Ridge, refit weekly with only games BEFORE that week: points/100 = league + home edge + offense(team) + defense(opponent).
     Older games count less (half-life HALF_LIFE days), so last season fills in early and fades as this one grows.
  3. Pace the same way (possessions = league + team + opponent).
  4. Fair margin = (home pts/100 - away pts/100) * pace / 100, fair total = (sum) * pace / 100.
  5. Extras (each fit out of sample, see study scripts): rest / back-to-back, missing rotation players.
Everything here is NBA data. Nothing is carried over from the NFL app except the method.
"""
import argparse, math
import numpy as np, pandas as pd
from scipy import sparse
from sklearn.linear_model import Ridge

import nba_data as nd

HALF_LIFE = 120.0      # days; tuned on 2009-2016 only (see tune_ratings.py: 9.44 margin MAE on 2010-2016)
ALPHA = 5.0            # ridge strength (weighted games)
SD_MARGIN = 12.4       # measured spread of the market's margin error, 2008-2026
SD_TOTAL = 17.9        # measured spread of the market's total error


def _design(teams_idx, t_team, t_opp, t_home, n):
    m = len(t_team)
    rows = np.arange(m)
    off = sparse.csr_matrix((np.ones(m), (rows, t_team)), shape=(m, n))
    dfn = sparse.csr_matrix((np.ones(m), (rows, t_opp)), shape=(m, n))
    home = sparse.csr_matrix(t_home.reshape(-1, 1).astype(float))
    return sparse.hstack([home, off, dfn]).tocsr()


class Ratings:
    """Ratings fit on team-games strictly before `asof`."""

    def __init__(self, tg, asof, half_life=HALF_LIFE, alpha=ALPHA, lookback=800):
        asof = pd.Timestamp(asof).date()
        d = tg[(tg.date < asof) & (tg.date >= (pd.Timestamp(asof) - pd.Timedelta(days=lookback)).date())]
        d = d[d.poss > 50]
        self.ok = len(d) > 200
        if not self.ok:
            return
        self.teams = sorted(set(d.team) | set(d.opp))
        self.ix = {t: i for i, t in enumerate(self.teams)}
        n = len(self.teams)
        ti = d.team.map(self.ix).values
        oi = d.opp.map(self.ix).values
        age = np.array([(asof - x).days for x in d.date], dtype=float)
        w = 0.5 ** (age / half_life)
        w = w * np.where(d.season_type.values == 3, 0.7, 1.0)    # playoffs: slightly less weight
        X = _design(None, ti, oi, d.home.values, n)
        eff = (d.pts / d.poss * 100).values
        self.mu = np.average(eff, weights=w)
        r = Ridge(alpha=alpha, fit_intercept=False)
        r.fit(X, eff - self.mu, sample_weight=w)
        self.hca = r.coef_[0]
        self.off = r.coef_[1:1 + n]
        self.dfn = r.coef_[1 + n:]
        # pace
        Xp = sparse.hstack([sparse.csr_matrix(np.ones((len(d), 1))),
                            _design(None, ti, oi, np.zeros(len(d)), n)[:, 1:1 + n]
                            + _design(None, oi, ti, np.zeros(len(d)), n)[:, 1:1 + n]]).tocsr()
        # (team + opponent pace both enter additively through the same column of the same team)
        pace = d.poss.values
        self.pmu = np.average(pace, weights=w)
        rp = Ridge(alpha=alpha, fit_intercept=False)
        rp.fit(Xp[:, 1:], pace - self.pmu, sample_weight=w)
        self.pace = rp.coef_
        self.games_seen = {t: 0 for t in self.teams}

    def has(self, team):
        return self.ok and team in self.ix

    def predict(self, home, away):
        """Returns (margin, total, home_pts, away_pts). Margin is home minus away. None if a team is unknown."""
        if not (self.has(home) and self.has(away)):
            return None
        h, a = self.ix[home], self.ix[away]
        eff_h = self.mu + self.hca + self.off[h] + self.dfn[a]
        eff_a = self.mu + self.off[a] + self.dfn[h]
        pace = self.pmu + self.pace[h] + self.pace[a]
        return ((eff_h - eff_a) * pace / 100, (eff_h + eff_a) * pace / 100,
                eff_h * pace / 100, eff_a * pace / 100)


def walk_forward(g, tg, seasons, step_days=7, **kw):
    """Predict every game in `seasons` using only games before the start of its week."""
    out = []
    gg = g[g.season.isin(seasons)].sort_values("date")
    d0, d1 = gg.date.min(), gg.date.max()
    day = d0
    while day <= d1:
        end = (pd.Timestamp(day) + pd.Timedelta(days=step_days)).date()
        chunk = gg[(gg.date >= day) & (gg.date < end)]
        if len(chunk):
            R = Ratings(tg, day, **kw)
            for r in chunk.itertuples():
                p = R.predict(r.home, r.away)
                out.append((r.game_id, *(p if p else (np.nan,) * 4)))
        day = end
    return pd.DataFrame(out, columns=["game_id", "m_margin", "m_total", "m_pts_h", "m_pts_a"])


def win_prob(margin, sd=SD_MARGIN):
    return 0.5 * (1 + math.erf(margin / (sd * math.sqrt(2))))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--backtest", type=int)
    a = ap.parse_args()
    g = nd.games()
    tg = nd.team_games()
    if a.backtest:
        w = walk_forward(g, tg, [a.backtest])
        x = g.merge(w, on="game_id")
        x = x[(x.season_type == 2) & x.m_margin.notna()]
        print(len(x), "games; model margin MAE", (x.margin - x.m_margin).abs().mean().round(2),
              "total MAE", (x.total - x.m_total).abs().mean().round(2))
        y = x[x.home_line.notna()]
        print("market margin MAE", (y.margin - y.home_line).abs().mean().round(2),
              "total MAE", (y.total - y.total_line).abs().mean().round(2))
