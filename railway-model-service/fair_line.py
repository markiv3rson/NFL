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
  4. Margin ~ Normal(mean, 13), total ~ Normal(mean, 13.3) (was 10: measured spread of totals error over 2006-2025 is ~13.3).
  4b. Divisional games -1.9 total (lower-scoring). The -0.9 MARGIN part was removed 9/30 (worse out of sample).
  4c. Turf (current-season home surface) +0.9 pts on total (weaker evidence, kept -- still net positive combined with the rest).
  4d. Special teams EPA differential (FG/punt/kickoff, season-to-date): +3.77 margin per 1.0 EPA/play edge (t=3.42).
  4e. Success rate edge (offense only, 9/28 fix): +30.39 margin per 1.0 edge in season-to-date offensive success rate.
      power ratings): +14.99 margin per 1.0 edge (t=6.23) -- the strongest single finding in the whole project.
  4f. [REMOVED 9/30 -- worse out of sample 2013-25] Road team on a bye (13+ days rest): flat -2.06 margin (t=-2.61). Replaces an earlier bye+travel-distance version --
      that one and a plain bye flag turned out to measure the same thing (they lose significance combined), and the
      plain flag has far more supporting games with a similar accuracy gain.
  5. Wind (outdoor/open roof only): total += -0.267 * (wind_mph - 7.5). Fit 2021-23, applied forward;
     cut 5-season total MAE 10.71 -> 10.62.
  5b. Home-field fix: the plain model underrates home teams by ~2.2 pts in every 5-year block 2006-2025, so +2.2 is added to the
     home margin (not on neutral sites, where the model's own home boost is removed instead). Cut 2006-25 margin error 10.83 -> 10.69.
  5c. Totals: dome/closed-roof games +2.59 pts (t=5.5) and pace (+0.12 pt per combined play above that season's league average, t=2.8).
  6. --adj "ATL=+1.5" manually shifts a team's points (QB change etc.). Not validated -- label it.

  4g. [REMOVED 9/30 -- worse out of sample 2013-25] Turnover-margin edge: +0.44 margin per 1.0 edge (t=2.2).
  4h. Road team effectively eliminated (week 13+, 10+ games played, under .250): +3.17 home margin (t=3.0).
      Home-team-eliminated tested as noise (t=-1.3) and is NOT included.
      4g+4h together: margin MAE 10.567 -> 10.553 out-of-sample (better in 13/20 seasons) -- small but real.

Removed: the OL/pass-rush-mismatch term (sack rate differential) that used to sit alongside these. Once success rate
is in the model, that term goes statistically dead (t=-2.8 -> -0.14) -- success rate already captures it, so dropping
it costs nothing on accuracy and removes a term that was double-counting.

Joint out-of-sample test (divisional + special-teams + success-rate + plain-bye-flag, 2006-2025, LOSO by season):
margin MAE 10.682 -> 10.616. Backup-QB-first-start (below) is fit and applied separately.

Backtest 2021-25 (n=1,119): spreads and totals do NOT beat the market (totals 47.8% pooled vs 52.4%
break-even). Used for weekly forward-testing in Line Room and as a sanity check. Label outputs Estimate.
"""
import argparse, os, math, urllib.request
import numpy as np, pandas as pd
import season as _season
from sklearn.linear_model import Ridge

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
_LAST_REG_PBP = None
CACHE = os.path.expanduser("~/.nfl_cache")
SD_MARGIN, SD_TOTAL, PRIOR_W, ALPHA, WIND_COEF = 13.0, 13.3, 0.2, 4.0, -0.267
HFA_FIX, DOME_PTS, PACE_COEF = 2.2, 2.59, 0.12
DIV_MARGIN, DIV_TOTAL, TURF_TOTAL = -0.905, -1.9, 0.9
# Refit 9/28 with the success-rate term corrected (see predict): special teams 4.212, success-rate edge 30.394,
# away-off-bye -2.189 (divisional unchanged at -0.904). Joint LOSO 2006-25 margin MAE 10.620 -> 10.606, 12 of 20 seasons.
ST_DIFF_COEF, SR_EDGE_COEF, BYE_AWAY_COEF = 4.212, 30.394, -2.189
TO_EDGE_COEF, ELIM_AWAY_COEF = 0.439, 3.167   # turnover-margin edge (per game, prior games) / road team effectively eliminated
# Refit 9/30 JOINTLY with injury_adj's QB penalty (backtest 2013-25): the old -6.29/+4.46 stacked on top of the -3.96
# injury penalty double-counted -- live stacking scored 10.299 margin MAE vs 10.234 for the injury penalty alone. Joint
# refit (flat -1.90 + 10.86 x backup-quality gap in injury_adj, and these): 10.211, better in 10 of 13 seasons.
HOME_QB_FIRST_START, AWAY_QB_FIRST_START = -3.33, 2.49   # margin effect; home team's own backup vs. away team's own backup, first career start with that team this season.
# Corrected DOWN from the solo-fit values (-7.69 / +5.71): about 44% of first-starts also trip injury_adj.py's QB1-out
# penalty (-3.96), and testing both together showed real overlap -- these are the values that remain significant once
# the injury-report QB1 flag is controlled for, so stacking this with injury_adj no longer double-counts the same signal.

def fetch(season, fresh=None):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, f"pbp_{season}.parquet")
    if fresh is None: fresh = season >= _season.data_season()   # current season re-downloaded; past seasons cached
    if fresh or not os.path.exists(f):
        _season.download(f"{BASE}/pbp/play_by_play_{season}.parquet", f)
    return pd.read_parquet(f)

def team_games(p, keep_reg=False):
    global _LAST_REG_PBP
    reg = p[p.season_type == "REG"]
    if keep_reg: _LAST_REG_PBP = reg
    p = reg[reg.play_type.isin(["pass", "run"]) & reg.epa.notna()]
    g = p.groupby(["game_id", "season", "week", "posteam", "defteam"]).agg(
        epa=("epa", "mean"), plays=("epa", "size"), home_team=("home_team", "first")).reset_index()
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

def predict(M, away, home, adj=None, neutral=False, rest_away_days=None, home_qb_first_start=False, away_qb_first_start=False, week=None):
    adj = adj or {}
    eh = M["mu"] + M["off"][home] + M["dfn"][away] + M["hfa"]; ea = M["mu"] + M["off"][away] + M["dfn"][home]
    ph, pa = np.polyval(M["pts"], eh) + adj.get(home, 0), np.polyval(M["pts"], ea) + adj.get(away, 0)
    if neutral: ph -= M["pts"][0] * M["hfa"]        # neutral site: no home edge at all
    else: ph += HFA_FIX / 2; pa -= HFA_FIX / 2       # home-field fix (model underrates home teams ~2.2 pts)
    margin_extra = 0.0
    # Removed 9/30 (leave-one-season-out 2013-25, each tested by dropping it with everything else refit): the divisional
    # margin term, the road-team-off-a-bye term and the turnover-margin term each made the margin slightly WORSE out of
    # sample. Divisional stays on the TOTAL (extra_total), where it still helps.
    st = M.get("st_epa") or {}
    if away in st and home in st: margin_extra += ST_DIFF_COEF * (st[home] - st[away])
    sr = M.get("success_rate") or {}
    if away in sr and home in sr and None not in sr[away].values() and None not in sr[home].values():
        # OFFENSE-ONLY success-rate edge. The old formula (home off - away def) - (away off - home def) added each
        # team's defensive "success rate allowed" with the wrong sign (a home defense allowing MORE success raised the
        # home edge). Tested 2006-25 (4,243 games): separately, defense-allowed terms carry little (their EPA side is
        # already in the ridge ratings), and offense-only beats the old mix out-of-sample (joint MAE 10.620 -> 10.606).
        sr_edge = sr[home]["off"] - sr[away]["off"]
        margin_extra += SR_EDGE_COEF * sr_edge
    if home_qb_first_start: margin_extra += HOME_QB_FIRST_START
    if away_qb_first_start: margin_extra += AWAY_QB_FIRST_START
    if away_eliminated(M, away, week): margin_extra += ELIM_AWAY_COEF
    ph += margin_extra / 2; pa -= margin_extra / 2
    return ph, pa

def pace_info(M, away, home):
    """Combined recent pace (plays per game, last 8 games each) minus league average, for the totals adjustment."""
    p, lg = M.get("pace") or {}, M.get("pace_lg")
    if not p or lg is None or away not in p or home not in p: return 0.0
    return float(p[away] + p[home] - 2 * lg)

def extra_total(M, away, home, dome, turf=None):
    """Dome +2.59, pace, divisional, and turf adjustments to the total. dome=None (unknown venue) skips the dome part;
    turf=None (unknown surface) skips the turf part."""
    d = DOME_PTS if dome else 0.0
    pc = PACE_COEF * pace_info(M, away, home)
    dv = DIV_TOTAL if is_division_game(away, home) else 0.0
    tf = TURF_TOTAL if turf else 0.0
    return d + pc + dv + tf, d, pc

def wind_adj(total, wind, outdoor):
    if not outdoor or wind is None or (isinstance(wind, float) and np.isnan(wind)): return total, 0.0
    d = WIND_COEF * (wind - 7.5); return total + d, d

def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))

DIVISIONS = {
    "BUF": "AFCE", "MIA": "AFCE", "NE": "AFCE", "NYJ": "AFCE",
    "BAL": "AFCN", "CIN": "AFCN", "CLE": "AFCN", "PIT": "AFCN",
    "HOU": "AFCS", "IND": "AFCS", "JAX": "AFCS", "TEN": "AFCS",
    "DEN": "AFCW", "KC": "AFCW", "LV": "AFCW", "LAC": "AFCW",
    "DAL": "NFCE", "NYG": "NFCE", "PHI": "NFCE", "WAS": "NFCE",
    "CHI": "NFCN", "DET": "NFCN", "GB": "NFCN", "MIN": "NFCN",
    "ATL": "NFCS", "CAR": "NFCS", "NO": "NFCS", "TB": "NFCS",
    "ARI": "NFCW", "LA": "NFCW", "SF": "NFCW", "SEA": "NFCW",
}
def is_division_game(away, home): return DIVISIONS.get(away) is not None and DIVISIONS.get(away) == DIVISIONS.get(home)

# ---- Calibrated chances (fit 2006-2025, checked out-of-sample by season; see BACKTEST notes in README) ----
# Win: market spread is the main input; the model's gap adds nothing measurable. Cover / Under: the model's gap vs the market carries
# no measurable signal, so the calibrated chance stays ~50%. Team points: market-implied points work best (model weight ~0).
# Rechecked 9/30 against the rebuilt model (2013-25) and all games 2006-25: the model-gap term is now ~0 (+0.005 refit; it
# was fit on the OLD model) and market-only scored better (log loss 0.6016 vs 0.6026), so the gap weight is 0. Market part
# refit on 5,247 games 2006-25 (ties out): -0.0452 + 0.1464 x market margin.
CAL_WIN = (-0.0452, 0.1464, 0.0)          # intercept, market home-favored margin, (model margin - market margin)
CAL_WIN_MODEL_ONLY = (-0.0756, 0.1588)   # intercept, model margin (used when no market spread yet)
CAL_COVER = (-0.0462, 0.0)      # intercept, (model margin - market margin). 9/30: flat home-cover rate 48.85% (2006-25); the gap term scored worse than flat
CAL_UNDER = (0.0206, 0.0169)      # intercept, (market total - model total)
TEAM_W = (0.0, 1.0, 0.0)             # intercept, market-implied points, (model - ...). 9/30: old fit ran 2-3 pts high on overs; now market-implied + real 2006-25 errors
TEAM_RESID_Q = [-19.75, -17.75, -16.5, -15.5, -14.5, -13.75, -13.25, -12.5, -12.0, -11.5, -11.0, -10.5, -10.0, -9.75, -9.25, -9.0, -8.75, -8.25, -8.0, -7.5, -7.25, -7.0, -6.75, -6.42, -6.0, -5.75, -5.5, -5.25, -5.0, -4.75, -4.5, -4.25, -4.0, -3.75, -3.5, -3.25, -3.0, -2.91, -2.5, -2.5, -2.25, -2.0, -1.75, -1.5, -1.25, -1.0, -0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 0.75, 0.81, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5, 5.0, 5.25, 5.5, 5.75, 6.0, 6.5, 6.75, 7.0, 7.25, 7.5, 8.0, 8.25, 8.75, 9.0, 9.5, 10.0, 10.5, 11.0, 11.75, 12.25, 12.75, 13.5, 14.0, 14.75, 15.5, 16.5, 17.5, 18.8, 20.53, 23.5]          # 99 quantiles of team-points error (out-of-sample)
def _sig(x): return 1 / (1 + math.exp(-x))
def cal_win(margin, mkt_margin=None):
    """Calibrated chance the home team wins. margin = model home margin; mkt_margin = market home-favored margin."""
    if mkt_margin is None: return _sig(CAL_WIN_MODEL_ONLY[0] + CAL_WIN_MODEL_ONLY[1] * margin)
    return _sig(CAL_WIN[0] + CAL_WIN[1] * mkt_margin + CAL_WIN[2] * (margin - mkt_margin))
def cal_cover(margin, mkt_margin): return _sig(CAL_COVER[0] + CAL_COVER[1] * (margin - mkt_margin))
def cal_under(total, mkt_total): return _sig(CAL_UNDER[0] + CAL_UNDER[1] * (mkt_total - total))
def team_points(ph, pa, mkt_margin=None, mkt_total=None):
    """Expected points and chance of scoring more than each half-point line, for both teams."""
    if mkt_margin is not None and mkt_total is not None:
        mh, ma = (mkt_total + mkt_margin) / 2, (mkt_total - mkt_margin) / 2
        eh = TEAM_W[0] + TEAM_W[1] * mh + TEAM_W[2] * (ph - mh); ea = TEAM_W[0] + TEAM_W[1] * ma + TEAM_W[2] * (pa - ma); src = "market"
    else: eh, ea, src = ph, pa, "model"
    q = np.array(TEAM_RESID_Q)
    def over(mean): return {f"{L:.1f}": round(float((q > (L - mean)).mean()) * 100, 1) for L in np.arange(13.5, 34.6, 1.0)}
    return {"home": round(eh, 1), "away": round(ea, 1), "homeOver": over(eh), "awayOver": over(ea), "basis": src}

def recency_weight(cur):
    """Recent-games weighting: this season's last 3 weeks count up to 1.5x a week 1 game, so a team's
    current form (injuries, role changes, a hot/cold stretch) moves the rating faster than a flat season average."""
    mx = cur.week.max()
    return 1.0 + 0.5 * ((cur.week - max(mx - 3, 1)) / max(mx - max(mx - 3, 1), 1)).clip(0, 1)

def special_teams_epa(pbp_reg):
    """Season-to-date special-teams EPA/play (field goal, punt, kickoff plays), per team. Feeds the special-teams
    margin term (item 4d) -- confirmed real, holds up combined with everything else."""
    if pbp_reg is None or "play_type" not in pbp_reg.columns or not len(pbp_reg): return {}
    s = pbp_reg[pbp_reg.play_type.isin(["field_goal", "punt", "kickoff"]) & pbp_reg.epa.notna()]
    out = {}
    for t in sorted(set(pbp_reg.posteam.dropna())):
        o = s[s.posteam == t]
        if len(o): out[t] = float(o.epa.mean())
    return out

def success_rate(pbp_reg):
    """Season-to-date success rate (1st down needs 40% of yards to go, 2nd needs 60%, 3rd/4th needs 100%),
    offense and defense, per team. Feeds the success-rate margin term (item 4e) -- the strongest finding in
    the whole project, and it makes the old OL/pass-rush-mismatch term redundant (dropped, see header)."""
    if pbp_reg is None or "down" not in pbp_reg.columns or not len(pbp_reg): return {}
    p = pbp_reg[pbp_reg.play_type.isin(["pass", "run"]) & pbp_reg.epa.notna() & pbp_reg.down.notna()]
    if not len(p): return {}
    need = np.select([p.down == 1, p.down == 2], [0.4 * p.ydstogo, 0.6 * p.ydstogo], default=p.ydstogo)
    p = p.assign(success=(p.yards_gained >= need).astype(int))
    out = {}
    for t in sorted(set(p.posteam.dropna()) | set(p.defteam.dropna())):
        o, d = p[p.posteam == t], p[p.defteam == t]
        out[t] = {"off": float(o.success.mean()) if len(o) else None, "def": float(d.success.mean()) if len(d) else None}
    return out

def turnover_margin(pbp_reg):
    """Per-game turnover margin (takeaways - giveaways) over completed games this season, per team."""
    if pbp_reg is None or "fumble_lost" not in pbp_reg.columns or not len(pbp_reg): return {}
    p = pbp_reg; out = {}
    for t in sorted(set(p.posteam.dropna())):
        gp = p[(p.posteam == t) | (p.defteam == t)].game_id.nunique()
        if not gp: continue
        give = p[p.posteam == t][["fumble_lost", "interception"]].fillna(0).values.sum()
        take = p[p.defteam == t][["fumble_lost", "interception"]].fillna(0).values.sum()
        out[t] = float((take - give) / gp)
    return out

def records(pbp_reg):
    """(wins, games played) per team from completed regular-season games. Ties count as non-wins, same as the test."""
    if pbp_reg is None or "home_score" not in pbp_reg.columns or not len(pbp_reg): return {}
    g = pbp_reg.drop_duplicates("game_id"); out = {}
    for _, r in g.iterrows():
        for t, pf, pa in [(r.home_team, r.home_score, r.away_score), (r.away_team, r.away_score, r.home_score)]:
            w, n = out.get(t, (0, 0)); out[t] = (w + int(pf > pa), n + 1)
    return out

def away_eliminated(M, away, week):
    """Tested proxy: week 13+, road team has played 10+ games and won under 25% of them."""
    rec = (M.get("record") or {}).get(away)
    if week is None or rec is None: return False
    w, n = rec
    return int(week) >= 13 and n >= 10 and w / n < 0.25

def build(season):
    cur = team_games(fetch(season), keep_reg=True); prior = team_games(fetch(season - 1))
    rows = pd.concat([prior, cur])
    w = np.r_[np.full(len(prior), PRIOR_W), recency_weight(cur)]
    M = fit(rows, w)
    r = rows.sort_values(["season", "week"])
    M["pace"] = {t: float(g.plays.tail(8).mean()) for t, g in r.groupby("posteam")}; M["pace_lg"] = float(cur.plays.mean() if len(cur) else r.plays.mean())
    M["st_epa"] = special_teams_epa(_LAST_REG_PBP)
    M["success_rate"] = success_rate(_LAST_REG_PBP)
    M["to_margin"] = turnover_margin(_LAST_REG_PBP)
    M["record"] = records(_LAST_REG_PBP)
    return M, cur

def backtest(season):
    full = fetch(season); allg = team_games(full); prior = team_games(fetch(season - 1)); out = []
    preg = full[full.season_type == "REG"]
    for wk in range(4, int(allg.week.max()) + 1):
        cur = allg[allg.week < wk]
        M = fit(pd.concat([prior, cur]), np.r_[np.full(len(prior), PRIOR_W), recency_weight(cur) if len(cur) else np.ones(0)])
        pbp_td = preg[preg.week < wk]   # season-to-date only, no look-ahead
        M["st_epa"] = special_teams_epa(pbp_td)
        M["success_rate"] = success_rate(pbp_td)
        M["to_margin"] = turnover_margin(pbp_td); M["record"] = records(pbp_td)
        for gid, x in allg[(allg.week == wk) & (allg.home == 1)].set_index("game_id").iterrows():
            ph, pa = predict(M, x.defteam, x.posteam, week=wk)
            t, _ = wind_adj(ph + pa, x.wind, x.roof in ("outdoors", "open"))
            out.append(dict(week=wk, mm=ph - pa, mt=t, km=x.spread_line, kt=x.total_line, res=x.result, tot=x.total))
    b = pd.DataFrame(out)
    print(f"Backtest {season}: {len(b)} games | margin MAE model {abs(b.mm-b.res).mean():.2f} vs close {abs(b.km-b.res).mean():.2f}"
          f" | total MAE model {abs(b.mt-b.tot).mean():.2f} vs close {abs(b.kt-b.tot).mean():.2f}")
    print("  (rest-day/bye and backup-QB terms aren't exercised by this quick backtest -- team_games() doesn't carry "
          "rest-day data; those are validated separately, see README.)")
    return b

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--away"); ap.add_argument("--home"); ap.add_argument("--season", type=int, default=None)
    ap.add_argument("--adj", default=""); ap.add_argument("--wind", type=float); ap.add_argument("--outdoor", action="store_true")
    ap.add_argument("--spread", type=float, help="market home favored margin, e.g. 5.5"); ap.add_argument("--total", type=float)
    ap.add_argument("--backtest", type=int)
    ap.add_argument("--dome", action="store_true", help="indoor / closed roof: +2.59 on the total")
    ap.add_argument("--neutral", action="store_true", help="neutral site (London, Paris...): no home-field edge")
    a = ap.parse_args()
    a.season = a.season or _season.data_season()
    if a.backtest: backtest(a.backtest); return
    adj = {k: float(v) for k, v in (x.split("=") for x in a.adj.split(",") if x)}
    M, cur = build(a.season)
    ph, pa = predict(M, a.away, a.home, adj, neutral=a.neutral); margin = ph - pa
    total, wd = wind_adj(ph + pa, a.wind, a.outdoor)
    # Dome only with --dome (before 9/28 every game without --outdoor got the indoor +2.6, e.g. London +2.6 by mistake)
    ex, dm, pc = extra_total(M, a.away, a.home, bool(a.dome), None); total += ex
    ph, pa = ph + (wd + ex) / 2, pa + (wd + ex) / 2
    p_home = cal_win(margin, a.spread)
    print(f"{a.away} @ {a.home} ({a.season}, weeks played {int(cur.week.max())}) — Estimate")
    if adj: print(f"  manual adj: {adj}")
    if wd: print(f"  wind {a.wind:.0f} mph: {wd:+.2f} pts on total")
    if ex: print(f"  dome {dm:+.2f} / pace {pc:+.2f} pts on total")
    print(f"  Fair score: {a.home} {ph:.1f} – {a.away} {pa:.1f}")
    if a.spread is None:
        print(f"  Fair spread: {a.home} {-margin:+.1f} | Fair total: {total:.1f} | Win (model-only, no market spread yet): {a.home} {p_home*100:.1f}% / {a.away} {(1-p_home)*100:.1f}%")
    else:
        print(f"  Fair spread: {a.home} {-margin:+.1f} | Fair total: {total:.1f} | Win (calibrated): {a.home} {p_home*100:.1f}% / {a.away} {(1-p_home)*100:.1f}%")
    if a.spread is not None:
        pc_ = cal_cover(margin, a.spread)
        print(f"  {a.home} -{a.spread} covers: {pc_*100:.1f}% | {a.away} +{a.spread} covers: {(1-pc_)*100:.1f}%  (calibrated: stays ~50%, no measured signal in the model-market gap)")
    if a.total is not None:
        pu = cal_under(total, a.total)
        print(f"  Under {a.total}: {pu*100:.1f}% | Over: {(1-pu)*100:.1f}%  (calibrated: stays ~50%, no measured signal in the model-market gap)")

if __name__ == "__main__":
    main()
