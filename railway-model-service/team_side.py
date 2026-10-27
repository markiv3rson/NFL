"""
team_side.py -- the TEAM MODEL spread rule (owner 10/19: "go off the win success rate of the entire team", not prices).
Each team's season so far (record, cover rate, margin, points for / against, offense + defense EPA / success rate / yards per play,
pass / rush EPA, turnover margin) blended with last season's full average (as 4 games), plus an opponent-adjusted margin (SRS),
home minus away -> logistic regression (C 0.02 since 10/27; 0.05 before) for "home covers". Trained on seasons 2012 .. last season.
10/20 (the label-shuffle check of the walk-forward found it): WITHOUT the spread as an input the same fit does better in every era --
60%+ sure 62.1% (211; eras 58 / 65 / 62, 11 of 12 seasons up) vs 60.4% with it (54 / 64 / 62), 58-60% sure 55.3% (199) vs 55.7%; the
spread's coefficient only pulled the picks toward the market. Shuffled training labels drop the 58%+ bucket to 47-54% (a real edge, not a leak).
Under 58% a coin flip -- so the site fires the rule only at 58%+ and shows those rates (lib/stack.js TEAM_BANDS). Published in the weekly rebuild's artifact as "teamSide": the fit + every team's numbers before week W.
"""
import numpy as np, pandas as pd
import extra_factors as xf

FIX = {"STL": "LA", "SD": "LAC", "OAK": "LV", "LAR": "LA"}
STATS = ["win", "cov", "marg", "pf", "pa", "oepa", "depa", "osr", "dsr", "oypp", "dypp", "tom", "opass", "orush"]
K, FIRST, C = 4, 2011, 0.02   # 10/27: C 0.05 -> 0.02 (re-test with 2026 weeks 1-7: 58%+ 63.4% of 257, eras 61 / 64 / 65, 11 of 13 seasons up; C 0.05 58.6% of 415, 55 / 61 / 60)

def _plays(y):
    cols = ["game_id", "season", "week", "season_type", "posteam", "defteam", "epa", "success", "yards_gained", "play_type", "interception", "fumble_lost", "pass", "rush"]
    p = pd.read_parquet(xf._pbp(y), columns=cols)
    p = p[(p.season_type == "REG") & p.posteam.notna() & p.play_type.isin(["pass", "run"])].copy()
    for c in ("posteam", "defteam"): p[c] = p[c].replace(FIX)
    p["to"] = p.interception.fillna(0) + p.fumble_lost.fillna(0)
    p["pepa"] = p.epa.where(p["pass"] == 1); p["repa"] = p.epa.where(p.rush == 1)
    o = p.groupby(["game_id", "posteam"]).agg(oepa=("epa", "mean"), osr=("success", "mean"), oypp=("yards_gained", "mean"), oto=("to", "sum"),
                                              opass=("pepa", "mean"), orush=("repa", "mean")).reset_index().rename(columns={"posteam": "team"})
    d = p.groupby(["game_id", "defteam"]).agg(depa=("epa", "mean"), dsr=("success", "mean"), dypp=("yards_gained", "mean"), dto=("to", "sum")).reset_index().rename(columns={"defteam": "team"})
    return o.merge(d, on=["game_id", "team"])

def team_games(cur):
    g = xf._games()
    g = g[(g.season >= FIRST) & (g.season <= cur)].copy()
    for c in ("home_team", "away_team"): g[c] = g[c].replace(FIX)
    rows = []
    for _, r in g[g.home_score.notna()].iterrows():
        for team, opp, pf, pa, home in ((r.home_team, r.away_team, r.home_score, r.away_score, 1), (r.away_team, r.home_team, r.away_score, r.home_score, 0)):
            line = -r.spread_line if home else r.spread_line   # the team's spread (negative = favored)
            m = pf - pa; cov = np.nan if pd.isna(line) else (1.0 if m + line > 0 else 0.0 if m + line < 0 else 0.5)
            rows.append(dict(game_id=r.game_id, season=int(r.season), week=int(r.week), team=team, opp=opp, pf=pf, pa=pa, win=1.0 if m > 0 else 0.0 if m < 0 else 0.5, cov=cov, home=home, line=line))
    R = pd.DataFrame(rows)
    P = pd.concat([_plays(y) for y in range(FIRST, cur + 1)])
    R = R.merge(P, on=["game_id", "team"], how="left")
    R["marg"] = R.pf - R.pa; R["tom"] = R.dto - R.oto
    return R, g

def _srs(past):
    teams = pd.unique(past.team); r = {t: 0.0 for t in teams}
    mg = past.groupby("team").marg.mean(); opps = past.groupby("team").opp.apply(list)
    for _ in range(20): r = {t: mg[t] + np.mean([r.get(o, 0) for o in opps[t]]) for t in teams}
    m = np.mean(list(r.values())); return {t: r[t] - m for t in teams}

def _blend(cs, i, prev):
    if prev is not None: return (cs.fillna(0) + K * prev.fillna(0)) / (i + K)
    return cs / i if i > 0 else pd.Series(np.nan, index=STATS)

def design(R):
    """One row per played home game: home-minus-away season-to-date numbers, the home spread and the result (as researched)."""
    R = R.sort_values(["season", "week"]); full = R.groupby(["season", "team"])[STATS].mean(); out = []
    for (s, t), d in R.groupby(["season", "team"]):
        d = d.sort_values("week"); prev = full.loc[(s - 1, t)] if (s - 1, t) in full.index else None
        cs = d[STATS].shift(1).expanding().sum()
        for i, (_, row) in enumerate(d.iterrows()):
            v = cs.iloc[i] if i > 0 else pd.Series(0.0, index=STATS); avg = _blend(v, i, prev)
            rec = dict(game_id=row.game_id, team=t); rec.update({f"s_{k}": avg[k] for k in STATS}); out.append(rec)
    F = pd.DataFrame(out); srs = {}
    for s, d in R.groupby("season"):
        for w in sorted(d.week.unique()):
            past = d[d.week < w]
            if len(past): srs.update({(s, w, t): v for t, v in _srs(past).items()})
    R = R.copy(); R["srs"] = [srs.get((s, w, t), np.nan) for s, w, t in zip(R.season, R.week, R.team)]
    X = R.merge(F, on=["game_id", "team"]); H = X[X.home == 1].set_index("game_id"); A = X[X.home == 0].set_index("game_id")
    cols = [f"s_{k}" for k in STATS] + ["srs"]; D = pd.DataFrame(index=H.index)
    for c in cols: D["d_" + c] = H[c] - A[c].reindex(H.index)
    D["hline"] = H.line; D["cov"] = H["cov"]; D["season"] = H.season; D["week"] = H.week
    D = D.dropna(subset=["hline"]); D = D[D.season >= FIRST + 1]
    feats = [c for c in D.columns if c.startswith("d_")]; D[feats] = D[feats].fillna(0)
    return D, feats

def week_numbers(R, cur, W):
    """Every team's numbers before week W of season cur (the inputs for week W's games)."""
    full = R.groupby(["season", "team"])[STATS].mean(); d = R[(R.season == cur) & (R.week < W)]
    srs = _srs(d) if len(d) else {}; out = {}
    for t in sorted(set(R[R.season.isin([cur, cur - 1])].team)):
        x = d[d.team == t]; prev = full.loc[(cur - 1, t)] if (cur - 1, t) in full.index else None
        avg = _blend(x[STATS].sum() if len(x) else pd.Series(0.0, index=STATS), len(x), prev)
        out[t] = {**{f"s_{k}": (None if pd.isna(avg[k]) else round(float(avg[k]), 6)) for k in STATS}, "srs": None if t not in srs else round(float(srs[t]), 6)}
    return out

def coming_week(g, cur, today=None):
    """The week the numbers are for: the earliest week with a game still to play. 10/20: a game already PLAYED whose score nflverse has not
    posted yet (Monday night's game at the Tuesday 4 AM rebuild) no longer holds the week back -- it made the fit "week 6" again, and the site
    uses these numbers only for the matching week, so week 7 would have had no TEAM MODEL pick all week."""
    left = g[(g.season == cur) & g.home_score.isna()]
    if "gameday" in g.columns:
        today = today or pd.Timestamp.now(tz="America/New_York").strftime("%Y-%m-%d")
        left = left[left.gameday.astype(str) >= today]
    return int(left.week.min()) if len(left) else int(g[g.season == cur].week.max()) + 1

def build(cur):
    from sklearn.linear_model import LogisticRegression
    R, g = team_games(cur)
    D, feats = design(R)
    X = feats; tr = D[(D.season < cur) & (D["cov"] != 0.5)]   # 10/20: the spread is NOT an input any more (see the header) -- the fit reads the two teams' numbers only
    mu, sd = tr[X].mean(), tr[X].std() + 1e-9
    m = LogisticRegression(C=C, max_iter=3000).fit((tr[X] - mu) / sd, tr["cov"].astype(int))
    W = coming_week(g, cur)
    return {"season": int(cur), "week": W, "feat": X, "mean": [round(float(v), 6) for v in mu], "sd": [round(float(v), 6) for v in sd],
            "coef": [round(float(v), 6) for v in m.coef_[0]], "b0": round(float(m.intercept_[0]), 6), "n": int(len(tr)),
            "teams": week_numbers(R, cur, W)}
