#!/usr/bin/env python3
"""
td_prob.py — Anytime TD PROBABILITIES (calibrated), + EV vs Polymarket.

  python3 td_prob.py --away ATL --home GB --spread 5.5 --total 43 --out "J.Reed" \
      --prices "C.Watson=38,M.Lloyd=30,T.Kraft=31,Bi.Robinson=57"

--spread = home team's favored margin (GB -5.5 -> 5.5). Implied team points come from the
consensus spread/total (public market data). Model: logistic regression trained on the 3 latest seasons (retrained
weekly, see retrain()) of player-games (RZ targets/carries, inside-10/5 usage, volume, TD rate, blended with last season;
opponent TDs allowed by rush/rec; team implied points). Out-of-sample 2025: Brier 0.158 vs 0.172
baseline; calibrated below 35%, overconfident above 40% -> shrunk (p>0.35: 0.35+0.75*(p-0.35)).
Replicated: train 2024->test 2025 Brier 0.158 vs 0.172; train 2023->test 2024 0.159 vs 0.174.
NOT tested against historical prop prices. Label outputs "Model estimate"; quarter Kelly.
Position adjustment (default OFF since 9/30 -- neutral in testing, 2019-25; --posadj flag kept below): opponent receiving TDs allowed are split by
position (WR/TE/RB, shrunk 4 games toward league avg 0.55/0.20/0.10 per game). Added 9/24; it moves
players ~1 pt and acts oddly on low-usage players -- trust the direction for main targets only.
Blind spots (call out manually): snap-share/role shifts, QB changes, new-team players' prior usage.
"""
import pandas as pd, numpy as np, pickle
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
import os, urllib.request, argparse, threading
BASE="https://github.com/nflverse/nflverse-data/releases/download"; CACHE=os.path.expanduser("~/.nfl_cache")
def _get(path, local, fresh):
    os.makedirs(CACHE,exist_ok=True); f=os.path.join(CACHE,local)
    if fresh or not os.path.exists(f): _season.download(f"{BASE}/{path}", f)
    return pd.read_parquet(f)
import season as _season
CUR=_season.data_season()   # auto (was hard-coded 2026): current season once its play-by-play exists, else last season
def fetch_pbp(s): return _get(f"pbp/play_by_play_{s}.parquet", f"pbp_{s}.parquet", s==CUR)
def fetch_ros(s): return _get(f"weekly_rosters/roster_weekly_{s}.parquet", f"ros_{s}.parquet", s==CUR)
def fetch_snap(s): return _get(f"snap_counts/snap_counts_{s}.parquet", f"snap_counts_{s}.parquet", s==CUR)

import re as _re
def _nn(n):
    n = _re.sub(r"[^a-z ]", "", (n if isinstance(n, str) else "").lower().replace("-", " "))
    return " ".join(w for w in n.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v"))
SNAP_FILL = 0.518   # average offensive snap share of a matched skill player (2014-2025); used when a player has no snap history yet

def add_snap(pg, season):
    """Snap share (NEW): a player's average offensive snap % over his previous 3 games (snap3) and his last game (snap1),
    from official snap counts. Tested 2016-2025 (train on 2 prior seasons): lowered TD-probability error in 10 of 10 seasons
    (Brier 0.15897 -> 0.15820). It catches role changes the season totals miss (e.g. a fumble that cuts snaps)."""
    try:
        ros = fetch_ros(season).sort_values("week").drop_duplicates("gsis_id", keep="last").set_index("gsis_id")
        nmap = ros["full_name"].map(_nn)
        sn = fetch_snap(season); sn = sn[sn.game_type == "REG"].copy()
        sn["nn"] = sn.player.map(_nn); sn = sn.sort_values(["team", "nn", "week"])
        g = sn.groupby(["team", "nn"]).offense_pct
        sn["snap3"] = g.transform(lambda x: x.shift(1).rolling(3, min_periods=1).mean()); sn["snap1"] = g.shift(1)
        sk = sn.drop_duplicates(["team", "nn", "week"])[["team", "nn", "week", "snap3", "snap1"]]
        pg = pg.copy(); pg["nn"] = pg.pid.map(nmap); pg = pg.merge(sk, on=["team", "nn", "week"], how="left")
    except Exception:
        pg = pg.copy(); pg["snap3"] = np.nan; pg["snap1"] = np.nan
    pg["snap_miss"] = pg.snap3.isna().astype(int)
    pg["snap3"] = pg.snap3.fillna(SNAP_FILL); pg["snap1"] = pg.snap1.fillna(pg.snap3)
    return pg


def player_games(season):
    p = fetch_pbp(season); p = p[p.season_type=='REG']
    games = p.drop_duplicates('game_id')[['game_id','week','home_team','away_team','spread_line','total_line']]
    rec = p[(p.pass_attempt==1)&(p.sack!=1)&p.receiver_player_id.notna()]
    run = p[(p.rush_attempt==1)&(p.qb_scramble!=1)&p.rusher_player_id.notna()]
    a = pd.DataFrame({'pid':rec.receiver_player_id,'game_id':rec.game_id,'team':rec.posteam,'opp':rec.defteam,
                      'tgt':1,'car':0,'rz_tgt':(rec.yardline_100<=20).astype(int),'i10_tgt':(rec.yardline_100<=10).astype(int),
                      'rz_car':0,'i5_car':0,'td':rec.pass_touchdown.fillna(0).astype(int),'type':'rec'})
    b = pd.DataFrame({'pid':run.rusher_player_id,'game_id':run.game_id,'team':run.posteam,'opp':run.defteam,
                      'tgt':0,'car':1,'rz_tgt':0,'i10_tgt':0,'rz_car':(run.yardline_100<=20).astype(int),'i5_car':(run.yardline_100<=5).astype(int),
                      'td':run.rush_touchdown.fillna(0).astype(int),'type':'rush'})
    x = pd.concat([a,b])
    pg = x.groupby(['pid','game_id','team','opp']).agg(tgt=('tgt','sum'),car=('car','sum'),rz_tgt=('rz_tgt','sum'),i10_tgt=('i10_tgt','sum'),
         rz_car=('rz_car','sum'),i5_car=('i5_car','sum'),td=('td','sum')).reset_index()
    pg = pg.merge(games, on='game_id')
    pg['home'] = (pg.team==pg.home_team).astype(int)
    # team implied points from closing lines (spread_line = home margin)
    pg['imp'] = np.where(pg.home==1, pg.total_line/2 + pg.spread_line/2, pg.total_line/2 - pg.spread_line/2)
    pg['scored'] = (pg.td>0).astype(int)
    # defense TDs allowed by type per game (to compute opponent leak)
    tdp = p[(p.touchdown==1)&(p.td_team==p.posteam)&((p.pass_touchdown==1)|(p.rush_touchdown==1))]
    dal = tdp.assign(rush=(tdp.rush_touchdown==1).astype(int), rec=(tdp.pass_touchdown==1).astype(int)).groupby(['defteam','game_id']).agg(rush=('rush','sum'),rec=('rec','sum')).reset_index()
    return pg, dal, games, p

def features(season, pos):
    pg, dal, games, p = player_games(season)
    prior, _, _, _ = player_games(season-1)
    pr = prior.groupby('pid').agg(g=('game_id','nunique'), rz=('rz_tgt','sum'), rzc=('rz_car','sum'), i5=('i5_car','sum'), i10=('i10_tgt','sum'),
                                  t=('tgt','sum'), c=('car','sum'), td=('td','sum'))
    for c in ['rz','rzc','i5','i10','t','c','td']: pr[c+'_pg'] = pr[c]/pr.g
    pg = pg.sort_values('week')
    rows=[]
    # season-to-date (strictly before this week) player rates
    cols=['tgt','car','rz_tgt','i10_tgt','rz_car','i5_car','td']
    pg = pg.sort_values(['pid','week'])
    cum = pg.groupby('pid')[cols].cumsum() - pg[cols]
    ng = pg.groupby('pid').cumcount()
    for c in cols: pg['std_'+c] = cum[c]
    pg['std_g'] = ng
    # defense season-to-date
    dg = games[['game_id','week','home_team','away_team']]
    dl = pd.concat([dg.rename(columns={'home_team':'def'})[['game_id','week','def']], dg.rename(columns={'away_team':'def'})[['game_id','week','def']]])
    dl = dl.merge(dal.rename(columns={'defteam':'def'}), on=['def','game_id'], how='left').fillna({'rush':0,'rec':0}).sort_values(['def','week'])
    dl['d_rush'] = dl.groupby('def').rush.cumsum()-dl.rush; dl['d_rec']=dl.groupby('def').rec.cumsum()-dl.rec; dl['d_g']=dl.groupby('def').cumcount()
    pg = pg.merge(dl[['game_id','def','d_rush','d_rec','d_g']].rename(columns={'def':'opp'}), on=['game_id','opp'])
    # blend player rates with prior season (prior counts as K games)
    K=3.0
    pg = pg.join(pr[[c for c in pr.columns if c.endswith('_pg')]], on='pid')
    def blend(std, prior_pg):
        pp = prior_pg.fillna(np.nan)
        num = pg[std] + K*pp.fillna(0); den = pg.std_g + K*pp.notna()
        return (num/den.replace(0,np.nan))
    pg['r_rzt']=blend('std_rz_tgt',pg.rz_pg); pg['r_i10']=blend('std_i10_tgt',pg.i10_pg)
    pg['r_rzc']=blend('std_rz_car',pg.rzc_pg); pg['r_i5']=blend('std_i5_car',pg.i5_pg)
    pg['r_t']=blend('std_tgt',pg.t_pg); pg['r_c']=blend('std_car',pg.c_pg); pg['r_td']=blend('std_td',pg.td_pg)
    # league-average shrink for defense (prior 4 games at league avg ~1.4 total TDs, 0.55 rush / 0.85 rec)
    pg['o_rush']=(pg.d_rush+4*0.55)/(pg.d_g+4); pg['o_rec']=(pg.d_rec+4*0.85)/(pg.d_g+4)
    pg = pg.join(pos, on='pid'); pg['pos']=pg.position.map(lambda v: {'FB':'RB','HB':'RB'}.get(v,v))
    pg = pg[pg.pos.isin(['RB','WR','TE'])].dropna(subset=['r_t','r_c','imp'])
    for c in ['r_rzt','r_i10','r_rzc','r_i5','r_td']: pg[c]=pg[c].fillna(0)
    pg = pg.merge(def_epa_todate(p), on=['opp', 'game_id'], how='left')
    pg['d_repa'] = pg['d_repa'].fillna(0.0); pg['d_pepa'] = pg['d_pepa'].fillna(0.0)
    return add_flags(add_snap(pg, season), season, prior)


# ---- Research flags (added 9/28; tested 2008-25, 18 train->test windows: -0.00012 Brier, better in 13 of 18) ----
# new_team: player's usage history comes from a different team last season. rz_shift: his red-zone looks over his
# last 2 games minus his season rate so far. depth1: listed first at his spot on the team's depth chart before the game
# (depth_known = 0 when no chart was found; depth1 is then 0.5). All use only information available before kickoff.
def fetch_depth(s): return _get(f"depth_charts/depth_charts_{s}.parquet", f"depth_{s}.parquet", s==CUR)
def depth_starters(season, game_dates=None):
    """{(pid, week): 1/0} starter flags. Old format (<=2024): depth_team == 1 on offense. New format (2025+, dated
    snapshots): for each game, the team's latest snapshot BEFORE the game date; a player is a starter if he is first
    (lowest pos_rank) in any offensive slot. game_dates: DataFrame(team, week, game_date)."""
    try: d = fetch_depth(season)
    except Exception: return {}
    out = {}
    if "depth_team" in d.columns:
        d = d[(d.game_type == "REG") & (d.formation == "Offense")].copy()
        d["r"] = pd.to_numeric(d.depth_team, errors="coerce")
        for (pid, wk), r in d.groupby(["gsis_id", "week"]).r.min().items():
            if pd.notna(wk): out[(pid, int(wk))] = int(r == 1)
        return out
    if game_dates is None or not len(game_dates): return {}
    d = d[d.pos_abb.isin(["QB", "RB", "WR", "TE", "FB"])].copy()
    d["t"] = pd.to_datetime(d.dt).dt.tz_localize(None)
    for (team, wk), gd in game_dates.groupby(["team", "week"]).game_date.first().items():
        x = d[(d.team == team) & (d.t < pd.to_datetime(gd))]
        if not len(x): continue
        x = x[x.t == x.t.max()]
        top = x.sort_values("pos_rank").groupby("pos_slot").gsis_id.first()
        for pid in x.gsis_id.unique(): out[(pid, int(wk))] = int(pid in set(top.values))
    return out
def _game_dates(p):
    g = p.drop_duplicates("game_id")[["week", "game_date", "home_team", "away_team"]]
    return pd.concat([g.rename(columns={"home_team": "team"})[["team", "week", "game_date"]], g.rename(columns={"away_team": "team"})[["team", "week", "game_date"]]])
def add_flags(pg, season, prior):
    pg = pg.copy()
    prev_team = prior.groupby("pid").team.agg(lambda x: x.mode().iloc[0]) if len(prior) else pd.Series(dtype=object)
    pg["new_team"] = [int(pid in prev_team.index and prev_team[pid] != tm) for pid, tm in zip(pg.pid, pg.team)]
    pg = pg.sort_values(["pid", "week"])
    rzo = pg.rz_tgt + pg.rz_car
    g = rzo.groupby(pg.pid)
    pg["rz_shift"] = (g.transform(lambda x: x.shift(1).rolling(2, min_periods=1).mean()) - g.transform(lambda x: x.shift(1).expanding().mean())).fillna(0)
    try: p = fetch_pbp(season); p = p[p.season_type == "REG"]; gd = _game_dates(p)
    except Exception: gd = None
    ds = depth_starters(season, gd)
    dv = [ds.get((pid, int(wk))) for pid, wk in zip(pg.pid, pg.week)]
    pg["depth_known"] = [int(v is not None) for v in dv]; pg["depth1"] = [0.5 if v is None else float(v) for v in dv]
    return pg
# Opponent per-play defense (10/8): EPA allowed per run play (used for RBs) and per pass play (used for WR/TE), season to date, shrunk
# toward 0 with 150 run / 200 pass plays. Walk-forward 2021-25 (td_signal_study.py): better than without in 4 of 5 seasons; the gain is
# small (~0.00001 Brier) but consistent, and it lets the model see how hard a defense is to run or throw on, not only its TDs allowed.
DEF_SHRINK_RUN, DEF_SHRINK_PASS = 150, 200
def def_epa_todate(pbp):
    """Per defense and game: EPA allowed per run / pass play in its EARLIER games this season (no look-ahead)."""
    x = pbp[pbp.play_type.isin(['pass', 'run']) & pbp.epa.notna()]
    out = None
    for kind, shrink, col in (('run', DEF_SHRINK_RUN, 'd_repa'), ('pass', DEF_SHRINK_PASS, 'd_pepa')):
        g = x[x.play_type == kind].groupby(['defteam', 'game_id', 'week']).epa.agg(['sum', 'count']).reset_index().sort_values(['defteam', 'week'])
        g[col] = (g.groupby('defteam')['sum'].cumsum() - g['sum']) / (g.groupby('defteam')['count'].cumsum() - g['count'] + shrink)
        g = g[['defteam', 'game_id', col]]
        out = g if out is None else out.merge(g, on=['defteam', 'game_id'], how='outer')
    return out.rename(columns={'defteam': 'opp'})
def def_epa_now(pbp, team):
    """A defense's EPA allowed per run / pass play over all its games so far (for the next game)."""
    x = pbp[(pbp.defteam == team) & pbp.play_type.isin(['pass', 'run']) & pbp.epa.notna()]
    r, q = x[x.play_type == 'run'].epa, x[x.play_type == 'pass'].epa
    return float(r.sum() / (len(r) + DEF_SHRINK_RUN)), float(q.sum() / (len(q) + DEF_SHRINK_PASS))
FEATS=['r_rzt','r_i10','r_rzc','r_i5','r_t','r_c','r_td','imp','o_rush','o_rec','is_rb','is_te','rushx','recx','snap3','snap1','snap_miss','new_team','rz_shift','depth1','depth_known','d_repa_rb','d_pepa_rec']
def design(df):
    X = df.copy(); X['is_rb']=(X.pos=='RB').astype(int); X['is_te']=(X.pos=='TE').astype(int)
    X['rushx']=(X.r_rzc+X.r_i5)*X.o_rush; X['recx']=(X.r_rzt+X.r_i10)*X.o_rec
    dr = X['d_repa'] if 'd_repa' in X else 0.0; dp = X['d_pepa'] if 'd_pepa' in X else 0.0
    X['d_repa_rb'] = np.asarray(dr, dtype=float) * X.is_rb; X['d_pepa_rec'] = np.asarray(dp, dtype=float) * (1 - X.is_rb)
    return X[FEATS].values

def load_pos():
    frames=[]
    for s in range(CUR-3, CUR+1):
        try:
            r=fetch_ros(s); frames.append(r[['gsis_id','position','week']].assign(s=s))
        except Exception: pass
    r=pd.concat(frames).sort_values(['s','week']).drop_duplicates('gsis_id',keep='last')
    return r.set_index('gsis_id')[['position']]

pos=load_pos()
MODEL_DIR = os.environ.get("MODEL_DIR", "/data")
CURRENT = CUR

def recency_weight(df):
    """Recent-games weighting: within a season, a player's last 3 games count more than early ones,
    so role changes (e.g. a new starter) are picked up faster. Weight 1.0 -> 1.6 over the season, prior-season rows stay at 1.0."""
    w = pd.Series(1.0, index=df.index)
    cur = df.season == df.season.max() if "season" in df.columns else pd.Series(True, index=df.index)
    if "week" in df.columns:
        mx = df.week.max()
        w = np.where(cur, 1.0 + 0.6 * (df.week / max(mx, 1)).clip(0, 1), 1.0)
    return w

def fit_model(train_seasons, exclude=None):
    """Train on the given seasons (current season's completed weeks included once it has any).
    exclude=(season, weeks): leave those weeks OUT of training. The weekly retrain tests the candidate on the last 2
    weeks; before 9/28 it also TRAINED on them, so the test was rigged in the candidate's favor and it would go live
    on a score it had effectively seen the answers to."""
    frames = []
    for s in train_seasons:
        try:
            f = features(s, pos); f["season"] = s
            if exclude and s == exclude[0] and "week" in f.columns: f = f[~f.week.isin(exclude[1])]
            frames.append(f)
        except Exception: pass
    tr = pd.concat(frames)
    w = recency_weight(tr)
    return LogisticRegression(C=1.0, max_iter=2000).fit(design(tr), tr.scored, sample_weight=w)

def brier(model, df):
    p = shrink(model.predict_proba(design(df))[:, 1])
    return float(np.mean((p - df.scored) ** 2))

def eval_holdout(model, season, weeks):
    """Brier score on specific weeks of a season the model didn't train on (a fair test)."""
    f = features(season, pos)
    f = f[f.week.isin(weeks)] if "week" in f.columns else f
    return brier(model, f) if len(f) else None

def holdout_sqerr(model, season, weeks):
    """Per-player squared errors on held-out weeks (same rows for any model, so two models can be compared pairwise)."""
    f = features(season, pos)
    f = f[f.week.isin(weeks)] if "week" in f.columns else f
    return (shrink(model.predict_proba(design(f))[:, 1]) - f.scored.values) ** 2 if len(f) else None

def load_active():
    p = os.path.join(MODEL_DIR, "td_model.pkl")
    if os.path.exists(p):
        try:
            with open(p, "rb") as fh: obj = pickle.load(fh)
            # a model saved before snap share was added has fewer inputs; ignore it and retrain
            if getattr(obj.get("model"), "n_features_in_", None) == len(FEATS): return obj
        except Exception: pass
    return None

def save_active(obj):
    try:
        os.makedirs(MODEL_DIR, exist_ok=True)
        with open(os.path.join(MODEL_DIR, "td_model.pkl"), "wb") as fh: pickle.dump(obj, fh)
        return True
    except Exception: return False

_active = load_active()
ACTIVE_TRAINED = list(_active.get("trained", [])) if _active else [CUR - 3, CUR - 2, CUR - 1]
ACTIVE_THROUGH = tuple(_active.get("through", (0, 0))) if _active else (0, 0)   # (season, last week) the live model trained on
m = _active["model"] if _active else fit_model([CUR - 3, CUR - 2, CUR - 1])   # 3 seasons (tested 9/28: better in 10 of 13)
def shrink(p): return np.asarray(p, dtype=float)   # 10/1: was 0.75x above 35%; out-of-sample 2019-25 it understated stars by 2.5 pts (z>3) and scored no better. Now identity (kept so callers stay put).

# ---- More TD markets, all derived from the calibrated anytime chance p (tested 2016-2025, out-of-sample) ----
def two_plus(p):
    """Chance of 2+ TDs: Poisson from the anytime chance, x1.09 (out-of-sample the plain Poisson ran ~9% low). Brier 0.0333 vs 0.0349 for no-info."""
    p = np.clip(np.asarray(p, dtype=float), 0, 0.95); lam = -np.log(1 - p)
    return np.minimum(0.6, 1.044 * (1 - np.exp(-lam) * (1 + lam)))   # 10/1: 1.035 -> 1.044 once the 35% shrink was removed (plain Poisson 3.50% vs 3.66% actual 2019-25); 9/30: 1.09 -> 1.035 (with the team TD total, x1.09 ran 3.77% vs 3.58% actual)
FIRST_OTHER = 0.4   # expected first-TD arrivals from non-listed scorers (QB runs, defense, special teams); best fit 2016-25
FIRST_OTHER_QB = 0.28   # 10/6: once QBs are listed, "someone else" is defense/special teams: 0.275 TDs a game, 2022-25 (5.7% of first TDs)
def first_td(p_lists, qb_lam=0.0):
    """Chance each player scores the game's FIRST touchdown. p_lists = one array of anytime chances per team (both teams together).
    A player's share of the game's expected TDs, times the chance any TD happens. Brier 0.0471 vs 0.0486 for a flat guess.
    qb_lam > 0 means the QBs are in p_lists (10/6): FIRST_OTHER (fit with QBs unlisted) is then replaced by FIRST_OTHER_QB."""
    allp = np.concatenate([np.clip(np.asarray(a, dtype=float), 0, 0.95) for a in p_lists]); lam = -np.log(1 - allp)
    T = lam.sum() + (FIRST_OTHER_QB if qb_lam > 0 else FIRST_OTHER)
    return [(-np.log(1 - np.clip(np.asarray(a, dtype=float), 0, 0.95))) / T * (1 - np.exp(-T)) for a in p_lists]
def group_any(df, n=8):
    """Chance at least one RB / WR / TE of this team scores (top 8 by chance at each position, independent)."""
    out = {}
    for pos_, g in df.groupby('pos'):
        x = g.p.sort_values(ascending=False).head(n).values; out[pos_] = float(1 - np.prod(1 - x))
    return out
pg,dal,games,p=player_games(CUR); prior,_,_,p_prev=player_games(CUR-1)
K=3.0
pr=prior.groupby('pid').agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum'))
cur=pg.groupby(['pid','team']).agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum')).reset_index()
def _names(*pbps): return pd.concat([x[[a,b]].dropna().set_axis(['pid','name'],axis=1) for x in pbps for a,b in (('receiver_player_id','receiver_player_name'),('rusher_player_id','rusher_player_name'))]).drop_duplicates('pid').set_index('pid').name
names=_names(p, p_prev)   # this season first, then last season's names (for players who haven't touched the ball yet)
def _live_snap():
    try:
        sn = fetch_snap(CUR); sn = sn[sn.game_type == "REG"].copy(); sn["nn"] = sn.player.map(_nn)
        sn = sn.sort_values(["team", "nn", "week"]); g = sn.groupby(["team", "nn"]).offense_pct
        out = pd.DataFrame({"snap3": g.apply(lambda x: x.tail(3).mean()), "snap1": g.apply(lambda x: x.iloc[-1]), "last_wk": sn.groupby(["team", "nn"]).week.max()}).reset_index()
        return out
    except Exception:
        return pd.DataFrame(columns=["team", "nn", "snap3", "snap1", "last_wk"])
def _live_touch_ctx():
    """Team game weeks, each player's last touch week, and each team's latest snap-count week (inputs of touch_adjusted)."""
    try:
        tw = {t: sorted(set(int(w) for w in g.week)) for t, g in pg.groupby("team")}
        lt = pg.groupby("pid").week.max().astype(int).to_dict()
        sn = fetch_snap(CUR); sn = sn[(sn.game_type == "REG") & (sn.offense_snaps > 0)]
        tl = {t: int(w) for t, w in sn.groupby("team").week.max().items()}
        return tw, lt, tl
    except Exception: return {}, {}, {}
SNAP_NOW = _live_snap()
TEAM_WEEKS, PID_LAST_TOUCH, SNAP_TEAM_LAST = _live_touch_ctx()
def _live_flags():
    """Live versions of the three research flags, for the NEXT game (same definitions as training)."""
    try: prev_team = prior.groupby("pid").team.agg(lambda x: x.mode().iloc[0])
    except Exception: prev_team = pd.Series(dtype=object)
    x = pg.assign(rzo=pg.rz_tgt + pg.rz_car).sort_values(["pid", "week"])
    shift = (x.groupby("pid").rzo.apply(lambda v: v.tail(2).mean()) - x.groupby("pid").rzo.mean()).to_dict()
    starters, known = set(), set()
    try:
        d = fetch_depth(CUR); d = d[d.pos_abb.isin(["QB", "RB", "WR", "TE", "FB"])].copy()
        d["t"] = pd.to_datetime(d.dt)
        for team, g in d.groupby("team"):
            g = g[g.t == g.t.max()]; known |= set(g.gsis_id)
            starters |= set(g.sort_values("pos_rank").groupby("pos_slot").gsis_id.first().values)
    except Exception: pass
    return prev_team, shift, starters, known
PREV_TEAM, RZ_SHIFT, DEPTH_STARTERS, DEPTH_KNOWN = _live_flags()
def _depth_changes():
    """Depth-chart change flags (added 9/29): compare each team's LATEST depth chart with the one in place before its
    last game. {pid: "moved up to starter"} / {pid: "dropped from starter"}. Display only -- the model already uses
    the current chart through depth1; this tells you WHY a number moved."""
    out = {}
    try:
        d = fetch_depth(CUR); d = d[d.pos_abb.isin(["QB", "RB", "WR", "TE", "FB"])].copy(); d["t"] = pd.to_datetime(d.dt).dt.tz_localize(None)
        gd = p.drop_duplicates("game_id")[["game_date", "home_team", "away_team"]]
        last = pd.concat([gd.rename(columns={"home_team": "team"})[["team", "game_date"]], gd.rename(columns={"away_team": "team"})[["team", "game_date"]]]).groupby("team").game_date.max()
        top = lambda x: set(x.sort_values("pos_rank").groupby("pos_slot").gsis_id.first().values)
        for team, g in d.groupby("team"):
            now = g[g.t == g.t.max()]
            if team not in last.index: continue
            before = g[g.t < pd.to_datetime(last[team])]
            if not len(before): continue
            before = before[before.t == before.t.max()]
            a, b = top(now), top(before)
            for pid in a - b:
                if pid in set(before.gsis_id): out[pid] = "moved up to starter on the depth chart"
                else: out[pid] = "new on the depth chart as a starter"
            for pid in b - a:
                if pid in set(now.gsis_id): out[pid] = "dropped from starter on the depth chart"
    except Exception: pass
    return out
DEPTH_NOTE = _depth_changes()
# Latest official weekly roster status. Players on IR/PUP ("RES"), the exempt list ("EXE"), released ("CUT"), retired,
# or now on ANOTHER team are dropped from the TD list. Before 9/28 the list came only from this season's play-by-play,
# so injured-reserve players kept showing a TD chance from their early-season usage (Week 3: A.J. Brown 26.5%,
# J.Mason 28.6%, 7 more), and those were graded as model misses. INA (a game-day inactive) is NOT dropped: it's last
# game's designation, not this week's; this week's Out list handles that.
UNAVAILABLE = {"RES", "EXE", "CUT", "RET"}
def _latest_roster():
    try:
        r = fetch_ros(CUR).sort_values("week").drop_duplicates("gsis_id", keep="last").set_index("gsis_id")
        return r["status"].astype(str), r["team"].astype(str)
    except Exception:
        return pd.Series(dtype=str), pd.Series(dtype=str)
ROS_STATUS, ROS_TEAM = _latest_roster()
def unavailable(pid, team):
    st, tm = ROS_STATUS.get(pid), ROS_TEAM.get(pid)
    return (st in UNAVAILABLE) or (tm is not None and tm != team and tm != "nan")
try: _ros_nn = fetch_ros(CUR).sort_values("week").drop_duplicates("gsis_id", keep="last").set_index("gsis_id")["full_name"].map(_nn)
except Exception: _ros_nn = pd.Series(dtype=object)
def dstats(team):
    g=games[(games.home_team==team)|(games.away_team==team)]
    d=dal[dal.defteam==team]; n=len(g)
    return (d.rush.sum()+4*0.55)/(n+4),(d.rec.sum()+4*0.85)/(n+4)
AVG={'WR':0.55,'TE':0.20,'RB':0.10}
def pos_rec(defteam):
    t=p[(p.touchdown==1)&(p.td_team==p.posteam)&(p.pass_touchdown==1)&(p.defteam==defteam)]
    ps=t.receiver_player_id.map(lambda i:{'FB':'RB','HB':'RB'}.get(pos.position.get(i),pos.position.get(i)))
    g=len(games[(games.home_team==defteam)|(games.away_team==defteam)])
    return {k:0.85*((ps==k).sum()+4*v)/(g+4)/v for k,v in AVG.items()}
def _norm(t): return "".join(ch for ch in t.lower() if ch.isalpha() or ch == " ")
def is_out_name(short, outs):
    # Match pbp short name ("Bi.Robinson", "A.St.Brown") to a full name ("Bijan Robinson", "Amon-Ra St. Brown"):
    # same last name AND the pbp first-name prefix starts the full first name. "Brian Robinson" out
    # must NOT remove "Bi.Robinson".
    if short in outs: return True
    if "." not in short: return False
    pre, rest = short.split(".", 1)
    pre, rest = pre.lower(), _norm(rest).replace(" ", "")
    for o in outs:
        w = _norm(o.replace("-", " ").replace(".", " ")).split()
        for a in range(1, len(w)):
            acc = ""
            for b in range(a, len(w)):
                acc += w[b]
                if acc == rest and (w[a - 1].startswith(pre) or (a > 1 and w[a - 2].startswith(pre))): return True
                if len(acc) >= len(rest): break
    return False

# ---- Quarterback rushing touchdowns (10/6) ----
# Before this the list held RB/WR/TE only, so running QBs (Allen, Hurts, Jackson...) never showed and their TDs sat in "someone else".
# 2022-25: QBs scored 0.58 rushing TDs a game and 12.4% of games' FIRST touchdown. Model: logistic on the team's starter (most pass
# attempts), from his rushing per start this season blended with last season (prior counts as 3 games): carries, red-zone carries,
# inside-5 carries, rushing TDs, plus team implied points and the opponent's rush TDs allowed per game (shrunk 4 games to 0.55).
# Walk-forward (train the 3 seasons before, test the next): Brier 2022 0.1243 vs 0.1341 flat, 2023 0.1288 vs 0.1415, 2024 0.1242 vs
# 0.1362, 2025 0.1207 vs 0.1313 (4 of 4 better); said 13.4/24.1/36.3% vs 12.7/29.3/41.1% scored. Coefficients fit on 2023-25 starters
# (qb_study.py reproduces them). The chance assumes he starts; Out/Doubtful QBs are skipped for the next QB with starts.
QB_F = ['r_car', 'r_rz', 'r_i5', 'r_rtd', 'imp', 'o_rush']
# 10/8: QBs with no previous NFL season (rookies, first-time starters) are blended with an average starter's per-start rushing (3 starts'
# worth, QB_LG from 2023-25) instead of trusting one or two starts. Walk-forward 2022-25: better overall in 3 of 4 seasons (2025 slightly
# worse); coefficients refit with the blend on 2023-25 starters.
QB_COEF, QB_INT = np.array([0.219, 0.031, 0.297, 0.822, 0.0, 0.161]), -2.927
QB_LG = {'car': 3.3083, 'rz': 0.7337, 'i5': 0.243, 'rtd': 0.1973}
def qb_starts(pbp):
    """Per team-game: the starter (most pass attempts) and his rushing that game (kneels left out)."""
    x = pbp[pbp.season_type == 'REG'] if 'season_type' in pbp else pbp
    pa = x[x.pass_attempt == 1].groupby(['game_id', 'week', 'posteam', 'passer_player_id']).size().reset_index(name='att')
    st = pa.sort_values('att').drop_duplicates(['game_id', 'posteam'], keep='last').rename(columns={'passer_player_id': 'pid', 'posteam': 'team'})
    runs = x[(x.rush_attempt == 1) & (x.qb_kneel != 1) & x.rusher_player_id.notna()]
    r = runs.groupby(['game_id', 'rusher_player_id']).agg(car=('rush_attempt', 'sum'), rz=('yardline_100', lambda v: (v <= 20).sum()),
        i5=('yardline_100', lambda v: (v <= 5).sum()), rtd=('rush_touchdown', 'sum')).reset_index().rename(columns={'rusher_player_id': 'pid'})
    return st.merge(r, on=['game_id', 'pid'], how='left').fillna({'car': 0, 'rz': 0, 'i5': 0, 'rtd': 0})
def _build_qb():
    try:
        c, q = qb_starts(p), qb_starts(p_prev)
        cur_qb = c.groupby(['pid', 'team']).agg(g=('game_id', 'nunique'), car=('car', 'sum'), rz=('rz', 'sum'), i5=('i5', 'sum'), rtd=('rtd', 'sum'), last=('week', 'max')).reset_index()
        prior_qb = q.groupby('pid').agg(g=('game_id', 'nunique'), car=('car', 'sum'), rz=('rz', 'sum'), i5=('i5', 'sum'), rtd=('rtd', 'sum'))
        prev_team = q.sort_values('week').drop_duplicates('pid', keep='last').set_index('pid')['team']
        return cur_qb, prior_qb, prev_team
    except Exception as e:
        print(f"[td] QB tables failed: {e}", flush=True)
        return pd.DataFrame(columns=['pid', 'team', 'g', 'car', 'rz', 'i5', 'rtd', 'last']), pd.DataFrame(), pd.Series(dtype=object)
def qb_row(team, opp, imp, outs=()):
    """The team's expected starting QB and his chance of a rushing TD, or None."""
    o_rush, _ = dstats(opp)
    mine = QB_CUR[QB_CUR.team == team].sort_values(['last', 'g'], ascending=False)   # the most recent starter first (a benching or injury shows up here)
    cands = [(r.pid, r) for r in mine.itertuples()]
    if not cands and len(QB_PREV_TEAM):   # team hasn't played yet: last season's starter still on the roster
        cands = [(pid, None) for pid, tm in ROS_TEAM.items() if tm == team and pid in QB_PRIOR.index and QB_PRIOR.loc[pid].g >= 4]
    # 10/8: every listed starter Out (a backup's first start): fall back to the team's other rostered QBs, depth-chart
    # starter first. Before, the team got no QB row at all and first_td had no QB in its "someone else" share.
    seen = {pid for pid, _ in cands}
    extra = [pid for pid, tm in ROS_TEAM.items() if tm == team and pid not in seen and pid in pos.index and pos.loc[pid, 'position'] == 'QB']
    cands = cands + [(pid, None) for pid in sorted(extra, key=lambda x: (x not in DEPTH_STARTERS, -(QB_PRIOR.loc[x].g if x in QB_PRIOR.index else 0)))]
    for pid, r in cands:
        name = names.get(pid)
        if name is None:   # never touched the ball: "F.Last" from the roster name
            full = str(_ros_nn.get(pid, "")).split()
            if len(full) < 2: continue
            name = f"{full[0][0].upper()}.{' '.join(w.title() for w in full[1:])}"
        if unavailable(pid, team) or is_out_name(name, outs): continue
        q = QB_PRIOR.loc[pid] if pid in QB_PRIOR.index else None
        g0 = float(r.g) if r is not None else 0.0
        def bl(k):
            cur_v = float(getattr(r, k)) if r is not None else 0.0
            if q is None: return (cur_v + K * QB_LG[k]) / (g0 + K)   # no NFL history: blend with an average starter
            return (cur_v + K * float(q[k]) / float(q.g)) / (g0 + K)
        x = np.array([bl('car'), bl('rz'), bl('i5'), bl('rtd'), float(imp), float(o_rush)])
        pq = float(1 / (1 + np.exp(-(QB_INT + QB_COEF @ x))))
        return {'name': name, 'pos': 'QB', 'p': min(pq, 0.9), 'boosted': False, 'depth_note': None}
    return None
QB_CUR, QB_PRIOR, QB_PREV_TEAM = _build_qb()
def run(team,opp,imp,outs=(),posadj=False,active=False,returning=()):
    o_rush,o_rec=dstats(opp); rows=[]
    mine = cur[cur.team==team]
    if not len(mine) and len(ROS_TEAM):
        # Team hasn't played this season yet (Week 1, or before its first game): list its CURRENT roster players with
        # last season's usage (zero games this season, so the blend below is just their per-game rates from last year).
        # Before 9/30 the TD tab was empty for a team until it had played a game.
        ids = [pid for pid, tm in ROS_TEAM.items() if tm == team and pid in pr.index]
        mine = pd.DataFrame([{"pid": pid, "team": team, "g": 0, "rz": 0, "i10": 0, "rzc": 0, "i5": 0, "t": 0, "c": 0, "td": 0} for pid in ids])
    for _,r in mine.iterrows():
        if unavailable(r.pid, team): continue
        q=pr.loc[r.pid] if r.pid in pr.index else None
        def bl(a,b):
            if q is None: return r[a]/r.g
            return (r[a]+K*q[b]/q.g)/(r.g+K)
        rows.append(dict(pid=r.pid,name=names.get(r.pid,r.pid),r_rzt=bl('rz','rz'),r_i10=bl('i10','i10'),r_rzc=bl('rzc','rzc'),r_i5=bl('i5','i5'),
             r_t=bl('t','t'),r_c=bl('c','c'),r_td=bl('td','td'),imp=imp,o_rush=o_rush,o_rec=o_rec))
    if not rows: return pd.DataFrame(columns=['name','pos','p','boosted','depth_note'])   # no usable players (no data yet)
    df=pd.DataFrame(rows).join(pos,on='pid'); df['pos']=df.position.map(lambda v:{'FB':'RB','HB':'RB'}.get(v,v))
    df['nn']=df.pid.map(_ros_nn); df['team']=team
    df=df.merge(SNAP_NOW,on=['team','nn'],how='left').set_index(df.index)
    # Fallback: same team + same last name when that's unique (roster "Kenny Gainwell" vs snap file "Kenneth Gainwell")
    if df.snap3.isna().any() and len(SNAP_NOW):
        sn = SNAP_NOW[SNAP_NOW.team == team].assign(last=lambda x: x.nn.str.split().str[-1])
        uniq = sn.groupby('last').filter(lambda g: len(g) == 1).set_index('last')
        for i in df.index[df.snap3.isna()]:
            last = str(df.at[i, 'nn']).split()[-1:] or ['']
            if last[0] in uniq.index: df.at[i, 'snap3'] = uniq.at[last[0], 'snap3']; df.at[i, 'snap1'] = uniq.at[last[0], 'snap1']; df.at[i, 'last_wk'] = uniq.at[last[0], 'last_wk']
    df['snap_miss']=df.snap3.isna().astype(int); df['snap3']=df.snap3.fillna(SNAP_FILL); df['snap1']=df.snap1.fillna(df.snap3)
    df['new_team']=[int(pid in PREV_TEAM.index and PREV_TEAM[pid]!=team) for pid in df.pid]
    df['rz_shift']=[float(RZ_SHIFT.get(pid,0.0)) for pid in df.pid]
    df['depth_known']=[int(pid in DEPTH_KNOWN) for pid in df.pid]
    df['depth1']=[(1.0 if pid in DEPTH_STARTERS else 0.0) if pid in DEPTH_KNOWN else 0.5 for pid in df.pid]
    _is_out = lambda short: is_out_name(short, outs)
    full = df[df.pos.isin(['RB','WR','TE'])].copy()
    outmask = full.name.apply(_is_out)
    df = full[~outmask].copy()
    df['d_repa'], df['d_pepa'] = def_epa_now(p, opp)   # opponent per-play defense (10/8)
    if posadj: df['o_rec']=df.pos.map(pos_rec(opp))
    # (Vacated-usage boost removed 9/30: handing an Out player's red-zone share to teammates tested WORSE in 7 of 7
    # seasons, 2019-25 -- the teammates' own usage already carries most of it, and the bump overshot.)
    pb_=team_budget(shrink(m.predict_proba(design(df))[:,1]), imp)
    playing_ = df.name.apply(lambda s: match_any(s, list(returning))).values if returning else None
    df['p']=touch_adjusted(df, pb_, team, active, playing_)   # 10/1: x the chance he plays AND touches the ball (falls back to the rank tilt)
    df['boosted'] = False
    df['depth_note']=[DEPTH_NOTE.get(pid) for pid in df.pid]
    return df.sort_values('p',ascending=False)[['name','pos','p','boosted','depth_note']]

# Without him (10/8): for each player on the Out list who is a regular on this team (5+ touches a game), the games the team
# played this season and last (when he was on the team) where he had no touch, and the top 3 TD scorers in those games.
# Shown on the page only; not used in the numbers (handing his share to teammates tested worse, 9/30).
def without(team, outs, n=3):
    both = pd.concat([pg.assign(cs=1), prior.assign(cs=0)]); mine = both[both.team == team]
    if not len(mine) or not outs: return []
    res = []
    for pid, rows in mine.groupby('pid'):
        nm = names.get(pid, pid)
        if not is_out_name(nm, outs): continue
        now = rows[rows.cs == 1]
        if not len(now) or (now.tgt.sum() + now.car.sum()) / len(now) < 5: continue
        seasons = set(rows.cs)
        team_g = set(mine[mine.cs.isin(seasons)].game_id); missed = team_g - set(rows.game_id)
        if not missed: continue
        sc = mine[mine.game_id.isin(missed) & (mine.td > 0) & (mine.pid != pid)].groupby('pid').td.sum().sort_values(ascending=False).head(n)
        res.append({"out": nm, "games": len(missed), "top": [{"name": names.get(k, k), "td": int(v)} for k, v in sc.items()]})
    return res

# Team TD total (added 9/30): each player's chance is computed on its own, so a team's list can add up to more (or fewer)
# TDs than its implied points support. Scale every player's expected TDs halfway toward the team's expected RB/WR/TE
# TDs (-0.746 + 0.1297 x implied points, fit on 5,278 team-games 2016-25). Tested train-3/test-next 2019-25: better in
# 7 of 7 seasons (Brier -0.00037). Halfway (a=0.5) beat a=0.25 and a=1.0. The team sum uses the top 8 players only
# (training has ~8 players per team-game; the live list also holds everyone who touched the ball this season, which
# would inflate the sum and pull every number down). Top-8 tested the same as the full sum: 7 of 7.
BUDGET_A, BUDGET_K, BUDGET_N, BUDGET_CONC = 0.5, (-0.7459, 0.1297), 8, 1.1
def team_budget(p, imp):
    p = np.clip(np.asarray(p, dtype=float), 0, 0.95); lam = -np.log(1 - p); tot = np.sort(lam)[::-1][:BUDGET_N].sum()
    if tot <= 0: return p
    target = max(0.3, BUDGET_K[0] + BUDGET_K[1] * float(imp))
    lam = lam * (target / tot) ** BUDGET_A
    # Concentration (9/30): out of sample the model was too cautious on a team's top options (#1 on team +2.2 pts scored
    # vs said, #2-3 +1.4) and too generous to depth players (#4+ -1.2), in both 2019-21 and 2022-25. lam^1.1, rescaled to
    # keep the team's expected TDs unchanged, fixes it: tuned on 2019-21 only, checked on 2022-25 (Brier 0.15241 ->
    # 0.15225; #1-on-team gap +2.4 -> +0.6, #4+ -1.4 -> -0.7).
    if lam.sum() > 0:
        l2 = lam ** BUDGET_CONC; lam = l2 * lam.sum() / l2.sum()
    return 1 - np.exp(-lam)

# Availability (10/1): the model learns from player-games where the player TOUCHED the ball, but the list holds every player
# who has touched it this season, including ones who sit, are inactive, or play without a touch. Replayed on the live-style list
# (2019-25, 38,513 listed players; injury-report Out/Doubtful removed, Questionable x0.669, after the team total step) the shown
# chances ran 18% too high overall: #1-#4 on a team 5-13% high, #7-#8 32% high, #9+ 44% high (said 19.7% vs 16.1% actual).
# A smooth multiplier by rank on the team, 0.918 x rank^-0.084 (#1 x0.92 ... #20 x0.71), fit on all seven seasons; fitted on the
# other six each time it beat the unadjusted numbers in 6 of 7 held-out seasons (Brier -0.0018 on average).
AVAIL_C, AVAIL_G = 0.918, 0.084
def availability(p):
    p = np.asarray(p, dtype=float); order = np.argsort(-p, kind="stable"); rank = np.empty(len(p)); rank[order] = np.arange(1, len(p) + 1)
    return np.clip(p * np.minimum(1.0, AVAIL_C * rank ** -AVAIL_G), 0, 0.97)

# Touch chance (10/1): replaces the plain rank tilt above as the main step (the tilt stays as the fallback). The model gives the chance
# a player scores IF he touches the ball; his chance to play and touch it at all is estimated from information known before kickoff:
# his rank on the team, last game's and last-3-games' snap share, whether he missed the team's last game, how many team games since
# his last touch, depth-chart status and his usage. Logistic fit on the 2019-25 live-style list (35,660 players: everyone with an
# earlier touch this season, Out/Doubtful removed). Walk-forward 2021-25 (each season judged on a model fit on earlier seasons only):
# better than the rank tilt in 5 of 5 seasons, Brier -0.0034 (t = -21), and 12.3/19.5/31.2/49.5% said vs 13.0/21.1/34.5/46.7% actual
# for 10-15/15-25/25-40/40+%. Injury and practice status added nothing beyond these, so none is used.
TOUCH_FEATS = ['lrank', 'pb', 's1f', 's3f', 's_miss', 'missed_last', 'lgap', 'depth1', 'depth_known', 'r_t', 'r_c']
TOUCH_MEAN = [1.569396, 0.204976, 0.460706, 0.468006, 0.013825, 0.200869, 0.388849, 0.477594, 0.944251, 3.507601, 2.387435]
TOUCH_SCALE = [0.746154, 0.127576, 0.289202, 0.267211, 0.116764, 0.400651, 0.674365, 0.485346, 0.229436, 2.374554, 4.536742]
TOUCH_COEF = [-0.017068, -0.116241, 0.582569, 0.216033, 0.125243, -0.622508, -0.656877, -0.092541, 0.022239, 0.352244, 0.480237]
TOUCH_INTERCEPT = 1.135998
# Once the inactive list is out (inside 80 minutes of kickoff, ESPN feed up) everyone still listed is playing, so the question is only
# whether he touches the ball. Returning stars show why this matters: 2021-25 regulars back after an Out/Doubtful week who PLAYED touched
# the ball 100% of the time and scored 35-36% (healthy stars 37%); the lower average came from the 36-39% who sat again. Same inputs,
# fit on the 28,528 played player-games only. Walk-forward 2021-25 on players who played: better than the all-in model in 5 of 5
# seasons (Brier 0.13610 vs 0.13695) and closer to actual at 25-40% (said 31.3% vs 34.0% actual, was 36.1%).
TOUCH2_MEAN = [1.514018, 0.213771, 0.506998, 0.503352, 0.0, 0.063832, 0.19218, 0.503873, 0.962949, 3.663268, 2.373353]
TOUCH2_SCALE = [0.749196, 0.130815, 0.282059, 0.263309, 1.0, 0.244453, 0.454731, 0.490634, 0.188888, 2.395083, 4.617076]
TOUCH2_COEF = [-0.171957, -0.071239, 0.421314, 0.330832, 0.0, 0.049755, -0.234643, -0.006197, 0.037847, 0.995609, 2.062878]
TOUCH2_INTERCEPT = 3.17296
def touch_prob(X, active=False):
    """X: rows in TOUCH_FEATS order -> chance he plays and touches the ball (active=True: chance he touches it, given he plays)."""
    m, s, c, b = (TOUCH2_MEAN, TOUCH2_SCALE, TOUCH2_COEF, TOUCH2_INTERCEPT) if active else (TOUCH_MEAN, TOUCH_SCALE, TOUCH_COEF, TOUCH_INTERCEPT)
    z = b + ((np.asarray(X, dtype=float) - np.array(m)) / np.array(s)) @ np.array(c)
    return 1 / (1 + np.exp(-z))
def match_any(short, names):
    """True when a play-by-play short name ('Bi.Robinson', 'A.St.Brown') or a full name is one of `names` (full names from the injury file).
    Same rule as run()'s Out matching: same last name AND the first-name prefix starts the full first name."""
    def norm(t): return "".join(ch for ch in str(t).lower() if ch.isalpha() or ch == " ")
    if short in names: return True
    if "." not in short: return any(norm(short).split() == norm(o.replace("-", " ").replace(".", " ")).split() for o in names)
    pre, rest = short.split(".", 1); pre, rest = pre.lower(), norm(rest).replace(" ", "")
    for o in names:
        w = norm(o.replace("-", " ").replace(".", " ")).split()
        for a in range(1, len(w)):
            acc = ""
            for b in range(a, len(w)):
                acc += w[b]
                if acc == rest and (w[a - 1].startswith(pre) or (a > 1 and w[a - 2].startswith(pre))): return True
                if len(acc) >= len(rest): break
    return False
def touch_adjusted(df, pb, team, active=False, playing=None):
    """pb = chances after the team-total step (one team's list). Returns pb x touch chance; any problem -> the rank tilt."""
    try:
        pb = np.asarray(pb, dtype=float); order = np.argsort(-pb, kind="stable"); rank = np.empty(len(pb)); rank[order] = np.arange(1, len(pb) + 1)
        tw, tl = TEAM_WEEKS.get(team) or [], SNAP_TEAM_LAST.get(team)
        if not tw or tl is None: return availability(pb)
        miss = df.snap_miss.values.astype(float)
        s1 = np.where(miss == 1, 0.4, df.snap1.values.astype(float)); s3 = np.where(miss == 1, 0.4, df.snap3.values.astype(float))
        lw = pd.to_numeric(df["last_wk"], errors="coerce").values
        missed = np.array([1.0 if (np.isnan(w) or w < tl) else 0.0 for w in lw])
        gap = np.array([sum(1 for w in tw if w > PID_LAST_TOUCH[pid]) if pid in PID_LAST_TOUCH else 99 for pid in df.pid.values], dtype=float)
        X = np.column_stack([np.log(rank), pb, s1, s3, miss, missed, np.log1p(np.minimum(gap, 20)), df.depth1.values.astype(float), df.depth_known.values.astype(float), df.r_t.values.astype(float), df.r_c.values.astype(float)])
        pt = touch_prob(X, active)
        if playing is not None and np.any(playing): pt = np.where(np.asarray(playing, dtype=bool), touch_prob(X, True), pt)   # returners: treated as playing
        out = np.clip(pb * pt, 0, 0.97)
        return out if np.all(np.isfinite(out)) else availability(pb)
    except Exception: return availability(pb)

import time as _time
_LIVE_T = _time.time()
_REFRESH_LOCK = threading.Lock()   # 10/9: 4 request threads -- one reload at a time
def refresh_live(max_age=1800):
    with _REFRESH_LOCK: return _refresh_live(max_age)
def _refresh_live(max_age=1800):
    """Reload this season's data (play-by-play, snap counts, rosters, depth charts, positions) if it is older than
    max_age seconds. Before 9/28 all of it loaded ONCE when the Railway server started and every rerun reused it --
    for days, until the next deploy -- so new games, snap counts, IR moves and depth changes never reached the TD
    numbers even though reruns kept running. Called at the start of every TD rerun and weekly retrain."""
    global pos, pg, dal, games, p, p_prev, prior, pr, cur, names, SNAP_NOW, _ros_nn, ROS_STATUS, ROS_TEAM, TEAM_WEEKS, PID_LAST_TOUCH, SNAP_TEAM_LAST
    global PREV_TEAM, RZ_SHIFT, DEPTH_STARTERS, DEPTH_KNOWN, DEPTH_NOTE, _LIVE_T, CUR, CURRENT, QB_CUR, QB_PRIOR, QB_PREV_TEAM
    # Season rollover (9/30): the server runs for months, so the season is re-worked-out here, not only at start-up.
    new_season = _season.data_season()
    if new_season != CUR: CUR = CURRENT = new_season; max_age = 0
    if _time.time() - _LIVE_T < max_age: return False
    pos = load_pos()
    pg, dal, games, p = player_games(CUR); prior, _, _, p_prev = player_games(CUR - 1)
    pr = prior.groupby('pid').agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum'))
    cur = pg.groupby(['pid','team']).agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum')).reset_index()
    names = _names(p, p_prev)
    SNAP_NOW = _live_snap(); TEAM_WEEKS, PID_LAST_TOUCH, SNAP_TEAM_LAST = _live_touch_ctx()
    try: _ros_nn = fetch_ros(CUR).sort_values("week").drop_duplicates("gsis_id", keep="last").set_index("gsis_id")["full_name"].map(_nn)
    except Exception: _ros_nn = pd.Series(dtype=object)
    ROS_STATUS, ROS_TEAM = _latest_roster()
    PREV_TEAM, RZ_SHIFT, DEPTH_STARTERS, DEPTH_KNOWN = _live_flags()
    DEPTH_NOTE = _depth_changes()
    QB_CUR, QB_PRIOR, QB_PREV_TEAM = _build_qb()
    _LIVE_T = _time.time()
    return True

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--away",required=True); ap.add_argument("--home",required=True)
    ap.add_argument("--spread",type=float,required=True); ap.add_argument("--total",type=float,required=True)
    ap.add_argument("--out",default=""); ap.add_argument("--posadj",action="store_true"); ap.add_argument("--prices",default="")
    a=ap.parse_args(); outs=[o.strip() for o in a.out.split(",") if o.strip()]
    px={k.strip():float(v) for k,v in (x.split("=") for x in a.prices.split(",") if x.strip())}
    hi=a.total/2+a.spread/2; ai=a.total/2-a.spread/2
    for team,opp,imp in [(a.away,a.home,ai),(a.home,a.away,hi)]:
        df=run(team,opp,imp,outs,a.posadj).head(10)
        print(f"\n{team} vs {opp} (implied {imp:.1f} pts) — Model estimate")
        for _,r in df.iterrows():
            line=f"  {r['name']:<12} {r.pos:<3} fair {r.p*100:5.1f}%"
            if r['name'] in px:
                ev=r.p/(px[r['name']]/100)-1; line+=f" | Poly {px[r['name']]:.0f}c | EV at limit {ev*100:+.1f}%" + ("  <- recheck (>30%)" if ev>0.3 else "")
            print(line)

def retrain(season=None):
    """Weekly TD retrain, shared by the scheduler (Tuesday 7:15) and POST /retrain-td so the two can't drift apart
    again: fresh data, 3 past seasons (+ this season's earlier weeks), the last 4 completed weeks held OUT of training,
    and the candidate goes live only if it beats the active model by more than 2 standard errors on those weeks."""
    global m, ACTIVE_TRAINED, ACTIVE_THROUGH
    import datetime as _dt
    refresh_live(0)                  # first: this also rolls the season over when a new one has started
    season = season or CURRENT
    season_pg, _, _, _ = player_games(season)
    cur_weeks = sorted(season_pg.week.unique().tolist())
    # Stricter switch rule (9/30): with 2 held-out weeks the noise (SD ~0.0003 Brier) is bigger than the typical real gap
    # between two decent models (~0.00017), so the old "better by 0.0001" rule picked the WORSE model 28% of the time
    # (tested 2019-25). Now: last 4 completed weeks held out, and the candidate must win by more than 2 standard errors
    # of the paired per-player difference. Otherwise the current model stays.
    holdout = cur_weeks[-4:] if len(cur_weeks) >= 6 else []
    train_seasons = [season - 3, season - 2, season - 1] + ([season] if len(cur_weeks) > 4 else [])
    candidate = fit_model(train_seasons, exclude=(season, holdout) if holdout else None)
    ec = holdout_sqerr(candidate, season, holdout) if holdout else None
    # If the live model was itself trained on some of these held-out weeks (it's refit on everything when it goes live),
    # scoring it on them would be in-sample and rig the test for it (9/30). Refit its recipe without them first.
    incumbent = m
    if holdout and ACTIVE_THROUGH[0] == season and ACTIVE_THROUGH[1] >= min(holdout):
        incumbent = fit_model(ACTIVE_TRAINED, exclude=(season, holdout))
    ea = holdout_sqerr(incumbent, season, holdout) if holdout else None
    cand_brier = float(ec.mean()) if ec is not None else None
    active_brier = float(ea.mean()) if ea is not None else None
    went_live = False
    if ec is not None and ea is not None and len(ec) > 50:
        d = ec - ea; se = float(d.std(ddof=1) / np.sqrt(len(d)))
        went_live = float(d.mean()) < -2 * se
    saved, reason = None, None
    # New season (9/30): until 6 weeks are played there's nothing to hold out, but a model that never saw LAST season is
    # simply out of date -- refit on the 3 most recent complete seasons and use it (no test needed: same method, newer data).
    if not holdout and (season - 1) not in ACTIVE_TRAINED:
        train_seasons, went_live, reason = [season - 3, season - 2, season - 1], True, "new season: refit on the 3 latest complete seasons"
    if went_live:
        # It won the fair test; the live copy is refit WITH the held-out weeks (the most recent games shouldn't be left out).
        candidate = fit_model(train_seasons)
        m = candidate; ACTIVE_TRAINED = list(train_seasons)
        ACTIVE_THROUGH = (season, int(max(cur_weeks))) if season in train_seasons and cur_weeks else (0, 0)   # single assignment: run() reads m once per prediction, so readers see old or new, never a mix
        saved = save_active({"model": candidate, "trained": train_seasons, "through": list(ACTIVE_THROUGH), "holdout_weeks": holdout, "brier": cand_brier,
                             "t": _dt.datetime.now(_dt.timezone.utc).isoformat()})
    return {"went_live": went_live, "reason": reason, "candidate_brier": cand_brier, "active_brier": active_brier,
            "holdout_weeks": holdout, "trained_on": train_seasons, "saved": bool(saved)}
