#!/usr/bin/env python3
"""
team_side.py -- NBA "Model (Team)" (10/20, owner: the same line as the NFL card, both sports). The whole team's season so far, nothing from prices:
each team's record, cover %, margin, points for / against, pace and 3-point rate, season to date blended with last season as K games, plus the
rest difference; a logistic fit on "home covers the closing line", every season predicted by a fit on earlier seasons only.

HONEST RESULT (walk-forward 2015-2026, 13,180 games with 5+ games played, scratchpad nbatm/tm.py, same math): all games 50.6%, 55%+ sure 52.6% on
380, 58%+ sure 11 games -- the NBA line already prices team strength. So this is DATA on the card (yellow), NEVER a pick: no rule reads it.
The numpy logistic (ridge) below is used so the service needs no sklearn.
"""
import json, os
import numpy as np, pandas as pd

FEATS = ["win", "cover", "marg", "pf", "pa", "poss", "fg3r"]
K = 10                      # last season counts as this many games at the start of a season
MIN_GP = 5                  # fewer games played this season than this -> no number (last season fills the early weeks only partly)
L2 = 20.0                   # ridge strength (= sklearn C 0.05 on ~16k rows)
HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, "data", "team_side.json")


def team_rows(g):
    """One row per team-game from the games frame (home/away names, home_line = the HOME team's favoured margin, + = home favoured)."""
    g = g[(g.season_type == 2)].dropna(subset=["pts_h", "pts_a"]).copy()
    g["date"] = pd.to_datetime(g.date)
    hl = g.home_line.astype(float)
    cov_h = np.where(hl.isna(), np.nan, np.sign(g.margin - hl))
    def fg3r(a, b):
        return np.where(b > 0, a / b.replace(0, np.nan), np.nan)
    H = pd.DataFrame({"season": g.season, "date": g.date, "team": g.home, "pf": g.pts_h, "pa": g.pts_a, "poss": g.poss,
                      "fg3r": fg3r(g.fg3a_h, g.fga_h), "win": (g.margin > 0).astype(float), "cover": np.where(cov_h > 0, 1.0, np.where(cov_h < 0, 0.0, np.nan))})
    A = pd.DataFrame({"season": g.season, "date": g.date, "team": g.away, "pf": g.pts_a, "pa": g.pts_h, "poss": g.poss,
                      "fg3r": fg3r(g.fg3a_a, g.fga_a), "win": (g.margin < 0).astype(float), "cover": np.where(cov_h < 0, 1.0, np.where(cov_h > 0, 0.0, np.nan))})
    T = pd.concat([H, A], ignore_index=True)
    T["marg"] = T.pf - T.pa
    return T.sort_values(["team", "date"]).reset_index(drop=True)


def season_numbers(T, season, before):
    """Every team's season-to-date averages BEFORE `before` (a date), blended with last season's averages as K games. {team: {feat: value, 'gp': n}}"""
    before = pd.Timestamp(before)
    cur = T[(T.season == season) & (T.date < before)]
    last = T[T.season == season - 1].groupby("team")[FEATS].mean()
    out = {}
    for team, grp in cur.groupby("team"):
        n = len(grp); d = {"gp": int(n)}
        for f in FEATS:
            s = grp[f].sum(skipna=True)
            lp = last[f].get(team, np.nan) if team in last.index else np.nan
            d[f] = float((s + K * lp) / (n + K)) if not np.isnan(lp) else (float(s / n) if n else np.nan)
        out[team] = d
    for team in last.index:                       # a team with no game yet this season: last season's numbers alone
        if team not in out:
            out[team] = {"gp": 0, **{f: float(last.loc[team, f]) for f in FEATS}}
    return out


def _design(g, T):
    """Per-game feature rows for the fit (season-to-date before each game, cumulative, one pass)."""
    g = g[(g.season_type == 2)].dropna(subset=["home_line", "pts_h", "pts_a"]).copy()
    g["date"] = pd.to_datetime(g.date)
    prev = {s: T[T.season == s].groupby("team")[FEATS].mean() for s in T.season.unique()}
    parts = []
    for (s, team), grp in T.groupby(["season", "team"]):
        grp = grp.sort_values("date"); n = np.arange(len(grp)); cs = grp[FEATS].cumsum().shift(1).fillna(0)
        last = prev.get(s - 1); lp = last.loc[team] if (last is not None and team in last.index) else None
        d = pd.DataFrame({"season": s, "team": team, "date": grp.date.values, "gp": n})
        for f in FEATS:
            d["s_" + f] = (cs[f].values + K * lp[f]) / (n + K) if (lp is not None and not np.isnan(lp[f])) else np.where(n > 0, cs[f].values / np.maximum(n, 1), np.nan)
        parts.append(d)
    S = pd.concat(parts, ignore_index=True)
    H = g.merge(S.rename(columns={"team": "home"}), on=["season", "home", "date"], how="inner", suffixes=("", "_h"))
    H = H.merge(S.rename(columns={"team": "away"}).rename(columns={**{"s_" + f: "a_" + f for f in FEATS}, "gp": "gpa"}), on=["season", "away", "date"], how="inner")
    X = pd.DataFrame({"d_" + f: H["s_" + f] - H["a_" + f] for f in FEATS})
    X["d_rest"] = (H.rest_h.clip(upper=5) - H.rest_a.clip(upper=5)).values
    X["y"] = np.where(H.margin - H.home_line > 0, 1.0, np.where(H.margin - H.home_line < 0, 0.0, np.nan))
    X["season"] = H.season.values; X["gp"] = H.gp.values; X["gpa"] = H.gpa.values
    X = X.dropna(); X = X[(X.gp >= MIN_GP) & (X.gpa >= MIN_GP)]
    return X


def _logit_fit(X, y, l2=L2, iters=50):
    """Ridge logistic regression by Newton steps on standardized features. Returns b0, coef (standardized), mean, sd."""
    mu = X.mean(axis=0); sd = X.std(axis=0); sd[sd == 0] = 1
    Z = (X - mu) / sd; n, k = Z.shape
    A = np.hstack([np.ones((n, 1)), Z]); w = np.zeros(k + 1); R = np.eye(k + 1) * l2; R[0, 0] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-A @ w)); W = p * (1 - p)
        grad = A.T @ (p - y) + R @ w; Hs = (A * W[:, None]).T @ A + R
        step = np.linalg.solve(Hs, grad); w -= step
        if np.abs(step).max() < 1e-8:
            break
    return float(w[0]), w[1:].tolist(), mu.tolist(), sd.tolist()


def fit(g, through=None):
    """Fit on every finished season up to `through` (default: the last season with 500+ lined games). Returns the published dict."""
    T = team_rows(g); X = _design(g, T)
    counts = X.groupby("season").size()
    if through is None:
        through = int(max(s for s, c in counts.items() if c >= 500))
    tr = X[X.season <= through]
    feat = [c for c in X.columns if c.startswith("d_")]
    b0, coef, mu, sd = _logit_fit(tr[feat].values.astype(float), tr.y.values.astype(float))
    return {"feat": feat, "coef": [round(c, 6) for c in coef], "mean": [round(m, 6) for m in mu], "sd": [round(s, 6) for s in sd], "b0": round(b0, 6),
            "n": int(len(tr)), "through": through, "k": K, "minGp": MIN_GP, "l2": L2,
            "note": "NBA Model (Team): walk-forward 2015-26 all games 50.6%, 55%+ sure 52.6% (380) -- data only, never a pick"}


def prob_home_covers(fitd, nh, na, rest_h, rest_a):
    """P(home covers) from the two teams' season numbers (season_numbers rows) and rest days. None when a team has too few games."""
    if not fitd or nh is None or na is None:          # early season: last season's numbers stand in (the blend), the card shows it as data anyway
        return None
    z = fitd["b0"]
    for i, f in enumerate(fitd["feat"]):
        if f == "d_rest":
            x = min(rest_h or 0, 5) - min(rest_a or 0, 5)
        else:
            k = f[2:]; a, b = nh.get(k), na.get(k)
            if a is None or b is None or (isinstance(a, float) and np.isnan(a)) or (isinstance(b, float) and np.isnan(b)):
                return None
            x = a - b
        z += fitd["coef"][i] * (x - fitd["mean"][i]) / fitd["sd"][i]
    return float(1 / (1 + np.exp(-z)))


def load_or_fit(g, max_age_days=2):
    """The saved fit when fresh, else a new one (saved). Used by live.py at load()."""
    try:
        if os.path.exists(FILE) and (pd.Timestamp.now() - pd.Timestamp(os.path.getmtime(FILE), unit="s")).days < max_age_days:
            with open(FILE) as f:
                return json.load(f)
    except Exception:
        pass
    d = fit(g)
    try:
        os.makedirs(os.path.dirname(FILE), exist_ok=True)
        with open(FILE, "w") as f:
            json.dump(d, f)
    except Exception:
        pass
    return d


def walk_forward(g, first=2015):
    """Each season predicted by a fit on earlier seasons: the honest record by sureness (prints)."""
    T = team_rows(g); X = _design(g, T); feat = [c for c in X.columns if c.startswith("d_")]
    out = []
    for s in sorted(X.season.unique()):
        if s < first:
            continue
        tr = X[X.season < s]; te = X[X.season == s]
        if len(tr) < 2000 or not len(te):
            continue
        b0, coef, mu, sd = _logit_fit(tr[feat].values.astype(float), tr.y.values.astype(float))
        z = b0 + ((te[feat].values - np.array(mu)) / np.array(sd)) @ np.array(coef)
        p = 1 / (1 + np.exp(-z)); sure = np.maximum(p, 1 - p); won = (p > 0.5) == (te.y.values == 1)
        out.append(pd.DataFrame({"season": s, "sure": sure, "won": won}))
    R = pd.concat(out)
    rep = {}
    for name, m in (("all", R.sure >= 0), ("55+", R.sure >= 0.55), ("58+", R.sure >= 0.58), ("60+", R.sure >= 0.60)):
        d = R[m]; rep[name] = {"n": int(len(d)), "hit": round(float(d.won.mean() * 100), 1) if len(d) else None}
    return rep


if __name__ == "__main__":
    import nba_data as nd
    g = nd.games(list(range(2012, nd.current_season() + 1)))
    print("walk-forward", walk_forward(g))
    d = fit(g); print({k: d[k] for k in ("feat", "coef", "b0", "n", "through")})
    T = team_rows(g); nums = season_numbers(T, nd.current_season(), pd.Timestamp.now())
    print("teams with numbers", len(nums), list(nums.items())[:2])
