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
    return pg

FEATS=['r_rzt','r_i10','r_rzc','r_i5','r_t','r_c','r_td','imp','o_rush','o_rec','is_rb','is_te','rushx','recx']
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

def fit_model(train_seasons):
    """Train on the given seasons (current season's completed weeks included once it has any)."""
    frames = []
    for s in train_seasons:
        try:
            f = features(s, pos); f["season"] = s; frames.append(f)
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
            with open(p, "rb") as fh: return pickle.load(fh)
        except Exception: pass
    return None

def save_active(obj):
    try:
        os.makedirs(MODEL_DIR, exist_ok=True)
        with open(os.path.join(MODEL_DIR, "td_model.pkl"), "wb") as fh: pickle.dump(obj, fh)
        return True
    except Exception: return False

_active = load_active()
m = _active["model"] if _active else fit_model([2024, 2025])
def shrink(p): return np.where(p>0.35, 0.35+0.75*(p-0.35), p)
pg,dal,games,p=player_games(2026); prior,_,_,_=player_games(2025)
K=3.0
pr=prior.groupby('pid').agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum'))
cur=pg.groupby(['pid','team']).agg(g=('game_id','nunique'),rz=('rz_tgt','sum'),i10=('i10_tgt','sum'),rzc=('rz_car','sum'),i5=('i5_car','sum'),t=('tgt','sum'),c=('car','sum'),td=('td','sum')).reset_index()
names=pd.concat([p[['receiver_player_id','receiver_player_name']].dropna().set_axis(['pid','name'],axis=1),p[['rusher_player_id','rusher_player_name']].dropna().set_axis(['pid','name'],axis=1)]).drop_duplicates('pid').set_index('pid').name
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
        q=pr.loc[r.pid] if r.pid in pr.index else None
        def bl(a,b):
            if q is None: return r[a]/r.g
            return (r[a]+K*q[b]/q.g)/(r.g+K)
        rows.append(dict(pid=r.pid,name=names.get(r.pid,r.pid),r_rzt=bl('rz','rz'),r_i10=bl('i10','i10'),r_rzc=bl('rzc','rzc'),r_i5=bl('i5','i5'),
             r_t=bl('t','t'),r_c=bl('c','c'),r_td=bl('td','td'),imp=imp,o_rush=o_rush,o_rec=o_rec))
    df=pd.DataFrame(rows).join(pos,on='pid'); df['pos']=df.position.map(lambda v:{'FB':'RB','HB':'RB'}.get(v,v))
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
    return df.sort_values('p',ascending=False)[['name','pos','p','boosted']]

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
