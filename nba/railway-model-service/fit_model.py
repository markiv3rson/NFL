#!/usr/bin/env python3
"""
fit_model.py — NBA only. Fits the final model numbers and writes an honest accuracy report.

  python3 fit_model.py            # writes data/model_coefs.json and data/model_report.json

What it fits (all on games played BEFORE the game being predicted — ratings are walk-forward):
  margin  = a + b*ratings_margin + rest/back-to-back + missing-players terms
  total   = a + b*ratings_total
  win %   = logistic on the adjusted margin (model only) and on adjusted margin + the market spread (when we have it)
Honest report: coefficients are fit on seasons <= TRAIN_END (2016) and scored on 2017-now ("untouched"), always next to
the market's own closing-line accuracy on the same games. Production coefficients are then refit on everything.
"""
import json, math, os, sys
import numpy as np, pandas as pd
from sklearn.linear_model import LinearRegression, LogisticRegression

import nba_data as nd, nba_features as nf, fair_line as fl

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
TRAIN_END = 2016
MARGIN_COLS = ["m_margin", "b2b_d", "miss_pts_d", "star_d"]


def wf_all(g, tg, first=2009, last=None):
    """Walk-forward ratings for every season, cached per season (the current season is always recomputed)."""
    last = last or nd.current_season()
    parts = []
    for s in range(first, last + 1):
        f = os.path.join(nd.CACHE, f"wf_{s}.pkl")
        if s < nd.current_season() and os.path.exists(f):
            parts.append(pd.read_pickle(f))
            continue
        if not (g.season == s).any():
            continue
        w = fl.walk_forward(g, tg, [s])
        w.to_pickle(f)
        parts.append(w)
    return pd.concat(parts, ignore_index=True)


def attach(g, w, feat, rfeat=None):
    """Join walk-forward ratings and missing-player numbers to the games. With `rfeat` (nba_features.report_features) the missing-player
    numbers are the ones the official injury report gives BEFORE tip-off (NaN on days without a report); without it they are who actually
    sat, which the page can't know in advance (optimistic)."""
    x = g.merge(w, on="game_id")
    f = feat
    if rfeat is not None:
        f = rfeat.rename(columns={"missing_pts_r": "missing_pts", "missing_min_r": "missing_min", "star_out_r": "star_out"})
        f = f.drop_duplicates(["game_id", "team"])
    fh = f.rename(columns={"team": "home", **{k: k + "_h" for k in f.columns if k not in ("team", "game_id")}})
    fa = f.rename(columns={"team": "away", **{k: k + "_a" for k in f.columns if k not in ("team", "game_id")}})
    x = x.merge(fh, on=["game_id", "home"], how="left").merge(fa, on=["game_id", "away"], how="left")
    x["b2b_d"] = (x.rest_a == 1).astype(int) - (x.rest_h == 1).astype(int)
    x["miss_pts_d"] = x.missing_pts_a - x.missing_pts_h
    x["star_d"] = x.star_out_a - x.star_out_h
    return x


def implied(ml):
    ml = np.asarray(ml, float)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(ml < 0, -ml / (-ml + 100), 100 / (ml + 100))


def brier(p, y):
    return float(np.mean((np.asarray(p) - np.asarray(y)) ** 2))


def fit_all(r):
    """r: regular-season rows with ratings + features. Returns coefficient dict."""
    c = {}
    m = LinearRegression().fit(r[MARGIN_COLS], r.margin)
    c["margin"] = {"cols": MARGIN_COLS, "coef": [float(v) for v in m.coef_], "icpt": float(m.intercept_)}
    adj = m.predict(r[MARGIN_COLS])
    c["sd_margin"] = float(np.std(r.margin - adj))
    t = LinearRegression().fit(r[["m_total"]], r.total)
    c["total"] = {"cols": ["m_total"], "coef": [float(t.coef_[0])], "icpt": float(t.intercept_)}
    c["sd_total"] = float(np.std(r.total - t.predict(r[["m_total"]])))
    hw = (r.margin > 0).astype(int)
    lg = LogisticRegression(C=100).fit(adj.reshape(-1, 1), hw)
    c["win_model"] = {"coef": float(lg.coef_[0][0]), "icpt": float(lg.intercept_[0])}
    rl = r[r.home_line.notna()]
    adjl = m.predict(rl[MARGIN_COLS])
    lg2 = LogisticRegression(C=100).fit(np.column_stack([rl.home_line.values, adjl]), (rl.margin > 0).astype(int))
    c["win_market"] = {"coef": [float(v) for v in lg2.coef_[0]], "icpt": float(lg2.intercept_[0])}
    return c


def predict_margin(c, row):
    return c["margin"]["icpt"] + sum(k * row[col] for k, col in zip(c["margin"]["coef"], c["margin"]["cols"]))


def report(x, train_end=TRAIN_END, basis="who actually sat (no injury-report history loaded yet: optimistic)"):
    """Honest scorecard: fit on seasons <= train_end, score on the later ones, next to the market on the same games."""
    r = x[(x.season_type == 2) & x.m_margin.notna() & x.missing_pts_h.notna() & x.missing_pts_a.notna()].copy()
    tr, te = r[r.season <= train_end], r[r.season > train_end]
    c = fit_all(tr)
    adj = LinearRegression().fit(tr[MARGIN_COLS], tr.margin).predict(te[MARGIN_COLS])
    te = te.assign(adj=adj)
    te = te.assign(adj_total=c["total"]["icpt"] + c["total"]["coef"][0] * te.m_total)
    L = te[te.home_line.notna()]
    out = {"trained_on": f"{int(tr.season.min())}-{train_end}", "tested_on": f"{train_end + 1}-{int(te.season.max())}", "games": int(len(te)), "injury_basis": basis, "rows": []}
    out["rows"].append({"model": "Spread (margin)", "what": "average miss, points", "ours": round(float(np.abs(te.margin - te.adj).mean()), 2),
                        "ours_same_games": round(float(np.abs(L.margin - L.adj).mean()), 2),
                        "market": round(float(np.abs(L.margin - L.home_line).mean()), 2), "games": int(len(L))})
    LT = te[te.total_line.notna()]
    out["rows"].append({"model": "Total", "what": "average miss, points", "ours": round(float(np.abs(te.total - te.adj_total).mean()), 2),
                        "ours_same_games": round(float(np.abs(LT.total - LT.adj_total).mean()), 2),
                        "market": round(float(np.abs(LT.total - LT.total_line).mean()), 2), "games": int(len(LT))})
    # win chance
    lg = LogisticRegression(C=100).fit(LinearRegression().fit(tr[MARGIN_COLS], tr.margin).predict(tr[MARGIN_COLS]).reshape(-1, 1), (tr.margin > 0).astype(int))
    pw = lg.predict_proba(te[["adj"]].values)[:, 1]
    ph, pa = implied(L.ml_home), implied(L.ml_away)
    ok = np.isfinite(ph) & np.isfinite(pa)
    mk = (ph / (ph + pa))[ok]
    Lw = L[ok]
    pw_same = lg.predict_proba(Lw[["adj"]].values)[:, 1]
    out["rows"].append({"model": "Moneyline (win chance)", "what": "Brier score (lower is better)",
                        "ours": round(brier(pw_same, (Lw.margin > 0)), 4), "ours_same_games": round(brier(pw_same, (Lw.margin > 0)), 4),
                        "market": round(brier(mk, (Lw.margin > 0)), 4), "games": int(len(Lw))})
    # does the model's side of the spread / total cover? (the check that matters for betting)
    gap = L.adj - L.home_line
    side_cover = np.where(gap > 0, (L.margin - L.home_line) > 0, (L.margin - L.home_line) < 0)
    push = (L.margin - L.home_line) == 0
    tiers = []
    for lo, hi in ((0, 1), (1, 2), (2, 3), (3, 5), (5, 99)):
        s = (gap.abs() >= lo) & (gap.abs() < hi) & ~push
        if s.sum() >= 50:
            tiers.append({"gap": f"{lo}-{hi if hi < 99 else '+'}", "games": int(s.sum()), "model_side_covers": round(float(side_cover[s].mean() * 100), 1)})
    out["spread_side"] = {"overall": round(float(side_cover[~push].mean() * 100), 1), "break_even": 52.4, "by_gap": tiers}
    gt = LT.adj_total - LT.total_line
    over_hit = np.where(gt > 0, LT.total > LT.total_line, LT.total < LT.total_line)
    pt = LT.total == LT.total_line
    ttiers = []
    for lo, hi in ((0, 2), (2, 4), (4, 6), (6, 99)):
        s = (gt.abs() >= lo) & (gt.abs() < hi) & ~pt
        if s.sum() >= 50:
            ttiers.append({"gap": f"{lo}-{hi if hi < 99 else '+'}", "games": int(s.sum()), "model_side_hits": round(float(over_hit[s].mean() * 100), 1)})
    out["total_side"] = {"overall": round(float(over_hit[~pt].mean() * 100), 1), "break_even": 52.4, "by_gap": ttiers}
    # calibration of the win chance
    bins = []
    for lo, hi in ((0, .3), (.3, .4), (.4, .5), (.5, .6), (.6, .7), (.7, 1.01)):
        s = (pw >= lo) & (pw < hi)
        if s.sum() >= 50:
            bins.append({"said": f"{int(lo*100)}-{min(int(hi*100),100)}%", "games": int(s.sum()), "home_won": round(float((te.margin[s] > 0).mean() * 100), 1),
                         "avg_said": round(float(pw[s].mean() * 100), 1)})
    out["win_calibration"] = bins
    return out


def main(hist=None, weights=None):
    """hist = nba_injuries.history(), weights = nba_injuries.fit_weights(...) (both optional; without them the old 'who actually sat' basis is used)."""
    os.makedirs(DATA, exist_ok=True)
    g = nd.games(); tg = nd.team_games()
    w = wf_all(g, tg)
    feat = nf.build(range(2008, nd.current_season() + 1))
    x = attach(g, w, feat)
    train_end, basis = TRAIN_END, "who actually sat (no injury-report history loaded yet: optimistic)"
    days = sum(1 for v in (hist or {}).values() if v)
    if hist and weights and days >= 200:
        import nba_injuries as ni
        pbox = nf.player_games(range(2021, nd.current_season() + 1))
        wts = {**ni.DEFAULT_W, **weights["weights"]}
        rf = nf.report_features(hist, pbox, wts)
        xr = attach(g, w, feat, rf)
        ok = xr[(xr.season_type == 2) & xr.m_margin.notna() & xr.missing_pts_h.notna() & xr.missing_pts_a.notna()]
        if len(ok) >= 2500 and ok.season.nunique() >= 3:
            x = xr
            seasons = sorted(ok.season.unique())
            train_end = int(seasons[-3]) if len(seasons) >= 4 else int(seasons[-2])
            basis = f"the official injury report before tip-off ({int(seasons[0])}-{int(seasons[-1])}, {days} game days)"
    rep = report(x, train_end, basis)
    r = x[(x.season_type == 2) & x.m_margin.notna() & x.missing_pts_h.notna() & x.missing_pts_a.notna()]
    coefs = fit_all(r)
    coefs["fit_through"] = str(g[g.season_type == 2].date.max())
    coefs["games"] = int(len(r))
    coefs["injury_basis"] = basis
    json.dump(coefs, open(os.path.join(DATA, "model_coefs.json"), "w"), indent=1)
    rep["built"] = str(pd.Timestamp.today().date())
    json.dump(rep, open(os.path.join(DATA, "model_report.json"), "w"), indent=1)
    x.to_pickle(os.path.join(nd.CACHE, "x_all.pkl"))
    print(json.dumps({k: rep[k] for k in ("trained_on", "tested_on", "injury_basis", "rows")}, indent=1))
    return coefs, rep


if __name__ == "__main__":
    main()
