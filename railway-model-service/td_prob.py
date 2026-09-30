#!/usr/bin/env python3
"""
td_prob.py — Anytime TD PROBABILITIES (calibrated), + EV vs Polymarket.

  python3 td_prob.py --away ATL --home GB --spread 5.5 --total 43 --out "J.Reed" \
      --prices "C.Watson=38,M.Lloyd=30,T.Kraft=31,Bi.Robinson=57"

--spread = home team's favored margin (GB -5.5 -> 5.5). Implied team points come from the
consensus spread/total (public market data). Model: logistic regression trained on 2024-25
player-games (RZ targets/carries, inside-10/5 usage, volume, TD rate, blended with last season;
opponent TDs allowed by rush/rec; team implied points). Out-of-sample 2025: Brier 0.158 vs 0.172
baseline; calibrated below 35%, overconfident above 40% -> shrunk (p>0.35: 0.35+0.75*(p-0.35)).
Replicated: train 2024->test 2025 Brier 0.158 vs 0.172; train 2023->test 2024 0.159 vs 0.174.
NOT tested against historical prop prices. Label outputs "Model estimate"; quarter Kelly.
Position adjustment (default ON, --no-posadj to disable): opponent receiving TDs allowed are split by
position (WR/TE/RB, shrunk 4 games toward league avg 0.55/0.20/0.10 per game). Added 9/24; it moves
players ~1 pt and acts oddly on low-usage players -- trust the direction for main targets only.
Blind spots (call out manually): snap-share/role shifts, QB changes, new-team players' prior usage.
"""
import pandas as pd, numpy as np, pickle
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
import os, urllib.request, argparse
BASE="https://github.com/nflverse/nflverse-data/releases/download"; CACHE=os.path.expanduser("~/.nfl_cache")
def _get(path, local, fresh):
    os.makedirs(CACHE,exist_ok=True); f=os.path.join(CACHE,local)
    if fresh or not os.path.exists(f): urllib.request.urlretrieve(f"{BASE}/{path}", f)
    return pd.read_parquet(f)
CUR=2026
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
FEATS=['r_rzt','r_i10','r_rzc','r_i5','r_t','r_c','r_td','imp','o_rush','o_rec','is_rb','is_te','rushx','recx','snap3','snap1','snap_miss','new_team','rz_shift','depth1','depth_known']
def design(df):
    X = df.copy(); X['is_rb']=(X.pos=='RB').astype(int); X['is_te']=(X.pos=='TE').astype(int)
    X['rushx']=(X.r_rzc+X.r_i5)*X.o_rush; X['recx']=(X.r_rzt+X.r_i10)*X.o_rec
    return X[FEATS].values

def load_pos():
    frames=[]
    for s in [2023,2024,2025,2026]:
        try:
            r=fetch_ros(s); frames.append(r[['gsis_id','position','week']].assign(s=s))
        except Exception: pass
    r=pd.concat(frames).sort_values(['s','week']).drop_duplicates('gsis_id',keep='last')
    return r.set_index('gsis_id')[['position']]

pos=load_pos()
MODEL_DIR = os.environ.get("MODEL_DIR", "/data")
CURRENT = 2026

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
m = _active["model"] if _active else fit_model([2023, 2024, 2025])   # 3 seasons (tested 9/28: better in 10 of 13)
def shrink(p): return np.where(p>0.35, 0.35+0.75*(p-0.35), p)

# ---- More TD markets, all derived from the calibrated anytime chance p (tested 2016-2025, out-of-sample) ----
def two_plus(p):
    """Chance of 2+ TDs: Poisson from the anytime chance, x1.09 (out-of-sample the plain Poisson ran ~9% low). Brier 0.0333 vs 0.0349 for no-info."""
    p = np.clip(np.asarray(p, dtype=float), 0, 0.95); lam = -np.log(1 - p)
    return np.minimum(0.6, 1.09 * (1 - np.exp(-lam) * (1 + lam)))
FIRST_OTHER = 0.4   # expected first-TD arrivals from non-listed scorers (QB runs, defense, special teams); best fit 2016-25
def first_td(p_lists):
    """Chance each player scores the game's FIRST touchdown. p_lists = one array of anytime chances per team (both teams together).
    A player's share of the game's expected TDs, times the chance any TD happens. Brier 0.0471 vs 0.0486 for a flat guess."""
    allp = np.concatenate([np.clip(np.asarray(a, dtype=float), 0, 0.95) for a in p_lists]); lam = -np.log(1 - allp)
    T = lam.sum() + FIRST_OTHER
    return [(-np.log(1 - np.clip(np.asarray(a, dtype=float), 0, 0.95))) / T * (1 - np.exp(-T)) for a in p_lists]
def group_any(df, n=8):
    """Chance at least one RB / WR / TE of this team scores (top 8 by chance at each position, independent)."""
    out = {}
    for pos_, g in df.groupby('pos'):
        x = g.p.sort_values(ascending=False).head(n).values; out[pos_] = float(1 - np.prod(1 - x))
    return out
pg,dal,games,p=player_games(2026); prior,_,_,_=player_games(2025)
K=3.0
pr=prior.groupby('pid').agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum'))
cur=pg.groupby(['pid','team']).agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum')).reset_index()
names=pd.concat([p[['receiver_player_id','receiver_player_name']].dropna().set_axis(['pid','name'],axis=1),p[['rusher_player_id','rusher_player_name']].dropna().set_axis(['pid','name'],axis=1)]).drop_duplicates('pid').set_index('pid').name
def _live_snap():
    try:
        sn = fetch_snap(CUR); sn = sn[sn.game_type == "REG"].copy(); sn["nn"] = sn.player.map(_nn)
        sn = sn.sort_values(["team", "nn", "week"]); g = sn.groupby(["team", "nn"]).offense_pct
        out = pd.DataFrame({"snap3": g.apply(lambda x: x.tail(3).mean()), "snap1": g.apply(lambda x: x.iloc[-1])}).reset_index()
        return out
    except Exception:
        return pd.DataFrame(columns=["team", "nn", "snap3", "snap1"])
SNAP_NOW = _live_snap()
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
def run(team,opp,imp,outs=(),posadj=True):
    o_rush,o_rec=dstats(opp); rows=[]
    for _,r in cur[cur.team==team].iterrows():
        if unavailable(r.pid, team): continue
        q=pr.loc[r.pid] if r.pid in pr.index else None
        def bl(a,b):
            if q is None: return r[a]/r.g
            return (r[a]+K*q[b]/q.g)/(r.g+K)
        rows.append(dict(pid=r.pid,name=names.get(r.pid,r.pid),r_rzt=bl('rz','rz'),r_i10=bl('i10','i10'),r_rzc=bl('rzc','rzc'),r_i5=bl('i5','i5'),
             r_t=bl('t','t'),r_c=bl('c','c'),r_td=bl('td','td'),imp=imp,o_rush=o_rush,o_rec=o_rec))
    df=pd.DataFrame(rows).join(pos,on='pid'); df['pos']=df.position.map(lambda v:{'FB':'RB','HB':'RB'}.get(v,v))
    df['nn']=df.pid.map(_ros_nn); df['team']=team
    df=df.merge(SNAP_NOW,on=['team','nn'],how='left').set_index(df.index)
    # Fallback: same team + same last name when that's unique (roster "Kenny Gainwell" vs snap file "Kenneth Gainwell")
    if df.snap3.isna().any() and len(SNAP_NOW):
        sn = SNAP_NOW[SNAP_NOW.team == team].assign(last=lambda x: x.nn.str.split().str[-1])
        uniq = sn.groupby('last').filter(lambda g: len(g) == 1).set_index('last')
        for i in df.index[df.snap3.isna()]:
            last = str(df.at[i, 'nn']).split()[-1:] or ['']
            if last[0] in uniq.index: df.at[i, 'snap3'] = uniq.at[last[0], 'snap3']; df.at[i, 'snap1'] = uniq.at[last[0], 'snap1']
    df['snap_miss']=df.snap3.isna().astype(int); df['snap3']=df.snap3.fillna(SNAP_FILL); df['snap1']=df.snap1.fillna(df.snap3)
    df['new_team']=[int(pid in PREV_TEAM.index and PREV_TEAM[pid]!=team) for pid in df.pid]
    df['rz_shift']=[float(RZ_SHIFT.get(pid,0.0)) for pid in df.pid]
    df['depth_known']=[int(pid in DEPTH_KNOWN) for pid in df.pid]
    df['depth1']=[(1.0 if pid in DEPTH_STARTERS else 0.0) if pid in DEPTH_KNOWN else 0.5 for pid in df.pid]
    def _norm(t): return "".join(ch for ch in t.lower() if ch.isalpha() or ch == " ")
    def _is_out(short):
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
    full = df[df.pos.isin(['RB','WR','TE'])].copy()
    outmask = full.name.apply(_is_out)
    df = full[~outmask].copy()
    if posadj: df['o_rec']=df.pos.map(pos_rec(opp))
    # Vacated-usage boost: an Out player's red-zone/inside-10/inside-5 share gets redistributed to the
    # remaining players at his position, proportional to their own current share (the model can't see this on its own).
    boost = {}
    for p_, grp in full.groupby('pos'):
        gone = grp[outmask.loc[grp.index]]
        stay = grp[~outmask.loc[grp.index]]
        if not len(gone) or not len(stay): continue
        for col in ['r_rzt','r_i10','r_rzc','r_i5']:
            pool = gone[col].sum()
            if pool <= 0: continue
            wsum = stay[col].sum()
            for pid, row in stay.iterrows():
                share = (row[col] / wsum) if wsum > 0 else (1 / len(stay))
                df.loc[pid, col] = df.loc[pid, col] + pool * share
                boost[pid] = True
    df['p']=shrink(m.predict_proba(design(df))[:,1])
    df['boosted'] = df.index.map(lambda i: bool(boost.get(i)))
    df['depth_note']=[DEPTH_NOTE.get(pid) for pid in df.pid]
    return df.sort_values('p',ascending=False)[['name','pos','p','boosted','depth_note']]

import time as _time
_LIVE_T = _time.time()
def refresh_live(max_age=1800):
    """Reload this season's data (play-by-play, snap counts, rosters, depth charts, positions) if it is older than
    max_age seconds. Before 9/28 all of it loaded ONCE when the Railway server started and every rerun reused it --
    for days, until the next deploy -- so new games, snap counts, IR moves and depth changes never reached the TD
    numbers even though reruns kept running. Called at the start of every TD rerun and weekly retrain."""
    global pos, pg, dal, games, p, prior, pr, cur, names, SNAP_NOW, _ros_nn, ROS_STATUS, ROS_TEAM
    global PREV_TEAM, RZ_SHIFT, DEPTH_STARTERS, DEPTH_KNOWN, DEPTH_NOTE, _LIVE_T
    if _time.time() - _LIVE_T < max_age: return False
    pos = load_pos()
    pg, dal, games, p = player_games(CUR); prior, _, _, _ = player_games(CUR - 1)
    pr = prior.groupby('pid').agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum'))
    cur = pg.groupby(['pid','team']).agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum')).reset_index()
    names = pd.concat([p[['receiver_player_id','receiver_player_name']].dropna().set_axis(['pid','name'],axis=1),p[['rusher_player_id','rusher_player_name']].dropna().set_axis(['pid','name'],axis=1)]).drop_duplicates('pid').set_index('pid').name
    SNAP_NOW = _live_snap()
    try: _ros_nn = fetch_ros(CUR).sort_values("week").drop_duplicates("gsis_id", keep="last").set_index("gsis_id")["full_name"].map(_nn)
    except Exception: _ros_nn = pd.Series(dtype=object)
    ROS_STATUS, ROS_TEAM = _latest_roster()
    PREV_TEAM, RZ_SHIFT, DEPTH_STARTERS, DEPTH_KNOWN = _live_flags()
    DEPTH_NOTE = _depth_changes()
    _LIVE_T = _time.time()
    return True

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--away",required=True); ap.add_argument("--home",required=True)
    ap.add_argument("--spread",type=float,required=True); ap.add_argument("--total",type=float,required=True)
    ap.add_argument("--out",default=""); ap.add_argument("--no-posadj",action="store_true"); ap.add_argument("--prices",default="")
    a=ap.parse_args(); outs=[o.strip() for o in a.out.split(",") if o.strip()]
    px={k.strip():float(v) for k,v in (x.split("=") for x in a.prices.split(",") if x.strip())}
    hi=a.total/2+a.spread/2; ai=a.total/2-a.spread/2
    for team,opp,imp in [(a.away,a.home,ai),(a.home,a.away,hi)]:
        df=run(team,opp,imp,outs,not a.no_posadj).head(10)
        print(f"\n{team} vs {opp} (implied {imp:.1f} pts) — Model estimate")
        for _,r in df.iterrows():
            line=f"  {r['name']:<12} {r.pos:<3} fair {r.p*100:5.1f}%"
            if r['name'] in px:
                ev=r.p/(px[r['name']]/100)-1; line+=f" | Poly {px[r['name']]:.0f}c | EV at limit {ev*100:+.1f}%" + ("  <- recheck (>30%)" if ev>0.3 else "")
            print(line)
