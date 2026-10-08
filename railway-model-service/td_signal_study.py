# Touchdown-signal study (10/8): xTD (yard-line weighted carries/targets), team offense EPA, opponent per-play run/pass EPA, game script.
# Walk-forward 2021-25 vs the live recipe; none shipped (see README). Run: python3 td_signal_study.py
import sys, numpy as np, pandas as pd
sys.path.insert(0,'/home/user/NFL/railway-model-service')
import td_prob as T
from sklearn.linear_model import LogisticRegression
P={}
def pbp(s):
    if s not in P:
        p=T.fetch_pbp(s); P[s]=p[p.season_type=='REG'][['game_id','week','posteam','defteam','rusher_player_id','receiver_player_id','rush_attempt','pass_attempt','qb_scramble','sack','yardline_100','rush_touchdown','pass_touchdown','epa','play_type']].copy()
    return P[s]
def rate_tables(seasons):
    x=pd.concat([pbp(s) for s in seasons])
    ru=x[(x.rush_attempt==1)&(x.qb_scramble!=1)&x.rusher_player_id.notna()]; tg=x[(x.pass_attempt==1)&(x.sack!=1)&x.receiver_player_id.notna()]
    rr=ru.groupby(ru.yardline_100.clip(1,99)).rush_touchdown.mean(); tr=tg.groupby(tg.yardline_100.clip(1,99)).pass_touchdown.mean()
    return rr.reindex(range(1,100)).interpolate().fillna(0), tr.reindex(range(1,100)).interpolate().fillna(0)
def player_xtd(s, rr, tr):
    x=pbp(s)
    ru=x[(x.rush_attempt==1)&(x.qb_scramble!=1)&x.rusher_player_id.notna()]; tg=x[(x.pass_attempt==1)&(x.sack!=1)&x.receiver_player_id.notna()]
    a=pd.DataFrame({'pid':ru.rusher_player_id,'game_id':ru.game_id,'week':ru.week,'xtd':ru.yardline_100.clip(1,99).map(rr).values})
    b=pd.DataFrame({'pid':tg.receiver_player_id,'game_id':tg.game_id,'week':tg.week,'xtd':tg.yardline_100.clip(1,99).map(tr).values})
    return pd.concat([a,b]).groupby(['pid','game_id','week']).xtd.sum().reset_index()
def team_epa(s):
    x=pbp(s); x=x[x.play_type.isin(['pass','run'])&x.epa.notna()]
    off=x.groupby(['posteam','game_id','week']).epa.agg(['sum','count']).reset_index().rename(columns={'posteam':'team'})
    dr=x[x.play_type=='run'].groupby(['defteam','game_id','week']).epa.agg(['sum','count']).reset_index().rename(columns={'defteam':'opp'})
    dp=x[x.play_type=='pass'].groupby(['defteam','game_id','week']).epa.agg(['sum','count']).reset_index().rename(columns={'defteam':'opp'})
    return off,dr,dp
def to_date(df, key, shrink):
    df=df.sort_values([key,'week']).copy()
    cs=df.groupby(key)['sum'].cumsum()-df['sum']; cc=df.groupby(key)['count'].cumsum()-df['count']
    df['v']=cs/(cc+shrink); return df[[key,'game_id','v']]
def add_extra(f, s, rr, tr):
    f=f.copy()
    cur=player_xtd(s,rr,tr); pri=player_xtd(s-1,rr,tr)
    pr=pri.groupby('pid').agg(px=('xtd','sum'),pg=('game_id','nunique'))
    cur=cur.sort_values(['pid','week']); cur['cx']=cur.groupby('pid').xtd.cumsum()-cur.xtd; cur['cg']=cur.groupby('pid').cumcount()
    f=f.merge(cur[['pid','game_id','cx','cg']],on=['pid','game_id'],how='left').join(pr,on='pid')
    ppg=(f.px/f.pg)
    f['r_xtd']=((f.cx.fillna(0)+3*ppg.fillna(0))/(f.cg.fillna(0)+3*ppg.notna())).replace([np.inf],np.nan).fillna(0)
    off,dr,dp=team_epa(s)
    f=f.merge(to_date(off,'team',300).rename(columns={'v':'t_epa'}),on=['team','game_id'],how='left')
    f=f.merge(to_date(dr,'opp',150).rename(columns={'v':'d_repa'}),on=['opp','game_id'],how='left')
    f=f.merge(to_date(dp,'opp',200).rename(columns={'v':'d_pepa'}),on=['opp','game_id'],how='left')
    for c in ['t_epa','d_repa','d_pepa']: f[c]=f[c].fillna(0)
    f['is_rb']=(f.pos=='RB').astype(int)
    f['d_repa_rb']=f.d_repa*f.is_rb; f['d_pepa_rec']=f.d_pepa*(1-f.is_rb)
    return f
VARS={'base':[], 'xtd':['r_xtd'], 'off_epa':['t_epa'], 'def_epa':['d_repa_rb','d_pepa_rec'], 'all':['r_xtd','t_epa','d_repa_rb','d_pepa_rec']}
def X(f, extra): return np.column_stack([T.design(f)]+[f[c].values for c in extra]) if extra else T.design(f)
res={k:[] for k in VARS}
for t in range(2021,2026):
    tr_s=[t-3,t-2,t-1]; rr,trr=rate_tables(tr_s)
    tr=pd.concat([add_extra(T.features(s,T.pos).assign(season=s),s,rr,trr) for s in tr_s]); w=T.recency_weight(tr)
    te=add_extra(T.features(t,T.pos),t,rr,trr)
    line=[str(t)]
    for k,ex in VARS.items():
        m=LogisticRegression(C=1.0,max_iter=3000).fit(X(tr,ex),tr.scored,sample_weight=w)
        p=m.predict_proba(X(te,ex))[:,1]; b=float(np.mean((p-te.scored)**2)); res[k].append(b); line.append(f"{k} {b:.5f}")
    print(" | ".join(line),flush=True)
for k in VARS:
    wins=sum(1 for a,b in zip(res[k],res['base']) if a<b); print(k,'avg',round(np.mean(res[k]),5),'better than base in',wins,'of 5')
