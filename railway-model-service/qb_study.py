# QB rushing-TD study (10/6): walk-forward test (train 3 seasons, test the next) and the 2023-25 fit behind td_prob.QB_COEF.
# Run: python3 qb_study.py  (needs pbp_2018..2025 in ~/.nfl_cache)
import pandas as pd, numpy as np, sys
from sklearn.linear_model import LogisticRegression
import os
D=os.path.expanduser('~/.nfl_cache/')   # pbp_{season}.parquet from nflverse-data releases (td_prob.fetch_pbp caches them here)
def qb_games(s):
    p=pd.read_parquet(D+f'pbp_{s}.parquet',columns=['season','season_type','game_id','week','posteam','defteam','home_team','spread_line','total_line','passer_player_id','rusher_player_id','rush_attempt','qb_scramble','qb_kneel','yardline_100','rush_touchdown','pass_attempt','touchdown','td_player_id'])
    p=p[p.season_type=='REG']
    # starter = most pass attempts for team in game
    pa=p[p.pass_attempt==1].groupby(['game_id','posteam','passer_player_id']).size().reset_index(name='att')
    st=pa.sort_values('att').drop_duplicates(['game_id','posteam'],keep='last').rename(columns={'passer_player_id':'pid'})
    runs=p[(p.rush_attempt==1)&(p.qb_kneel!=1)]
    r=runs.groupby(['game_id','rusher_player_id']).agg(car=('rush_attempt','sum'),rz=('yardline_100',lambda x:(x<=20).sum()),i5=('yardline_100',lambda x:(x<=5).sum()),rtd=('rush_touchdown','sum')).reset_index().rename(columns={'rusher_player_id':'pid'})
    g=p.drop_duplicates('game_id')[['game_id','week','home_team','spread_line','total_line']]
    x=st.merge(r,on=['game_id','pid'],how='left').fillna({'car':0,'rz':0,'i5':0,'rtd':0}).merge(g,on='game_id')
    x['imp']=np.where(x.posteam==x.home_team,x.total_line/2+x.spread_line/2,x.total_line/2-x.spread_line/2)
    opp=p.drop_duplicates(['game_id','posteam'])[['game_id','posteam','defteam']]
    x=x.merge(opp,on=['game_id','posteam'])
    # any TD scored by the QB (rush); target
    x['y']=(x.rtd>0).astype(int); x['season']=s
    # defense rush TDs allowed per game to date
    dr=p[(p.rush_touchdown==1)].groupby(['game_id','defteam']).size().reset_index(name='rta')
    return x, dr, p
def build(s):
    x,dr,p=qb_games(s); xp,_,_=qb_games(s-1)
    pr=xp.groupby('pid').agg(g=('game_id','nunique'),car=('car','sum'),rz=('rz','sum'),i5=('i5','sum'),rtd=('rtd','sum'))
    x=x.sort_values(['pid','week'])
    for c in ['car','rz','i5','rtd']: x['s_'+c]=x.groupby('pid')[c].cumsum()-x[c]
    x['s_g']=x.groupby('pid').cumcount()
    K=3.0
    x=x.join(pr.add_prefix('p_'),on='pid')
    for c in ['car','rz','i5','rtd']:
        pp=(x['p_'+c]/x['p_g'])
        x['r_'+c]=(x['s_'+c]+K*pp.fillna(0))/(x.s_g+K*pp.notna()).replace(0,np.nan)
    # defense: rush TDs allowed per game to date (shrunk)
    d=dr.rename(columns={'defteam':'def'})
    allg=p.drop_duplicates(['game_id','defteam'])[['game_id','week','defteam']].rename(columns={'defteam':'def'}).merge(d,on=['game_id','def'],how='left').fillna({'rta':0}).sort_values(['def','week'])
    allg['d_r']=allg.groupby('def').rta.cumsum()-allg.rta; allg['d_g']=allg.groupby('def').cumcount()
    x=x.merge(allg[['game_id','def','d_r','d_g']].rename(columns={'def':'defteam'}),on=['game_id','defteam'],how='left')
    x['o_rush']=(x.d_r.fillna(0)+4*0.55)/(x.d_g.fillna(0)+4)
    return x.dropna(subset=['r_car','imp'])
F=['r_car','r_rz','r_i5','r_rtd','imp','o_rush']
data={s:build(s) for s in range(2019,2026)}
def brier(p,y): return float(np.mean((p-y)**2))
print('season n  base_rate  brier_model  brier_rate  brier_const')
allp=[];ally=[]
for t in range(2022,2026):
    tr=pd.concat([data[s] for s in (t-3,t-2,t-1)]); te=data[t]
    m=LogisticRegression(C=1.0,max_iter=2000).fit(tr[F].fillna(0),tr.y)
    pm=m.predict_proba(te[F].fillna(0))[:,1]
    rate=np.clip(te.r_rtd.fillna(0),0,0.9)  # naive: TDs per game to date
    print(t,len(te),round(te.y.mean(),3),round(brier(pm,te.y),4),round(brier(rate,te.y),4),round(brier(np.full(len(te),tr.y.mean()),te.y),4))
    allp+=list(pm);ally+=list(te.y)
allp=np.array(allp);ally=np.array(ally)
for lo,hi in [(0,.1),(.1,.2),(.2,.3),(.3,.45),(.45,1)]:
    k=(allp>=lo)&(allp<hi)
    if k.sum(): print(f"said {lo:.2f}-{hi:.2f}: n={k.sum()} said {allp[k].mean()*100:.1f}% scored {ally[k].mean()*100:.1f}%")
m=LogisticRegression(C=1.0,max_iter=2000).fit(pd.concat([data[s] for s in (2023,2024,2025)])[F].fillna(0),pd.concat([data[s] for s in (2023,2024,2025)]).y)
print('coef',dict(zip(F,np.round(m.coef_[0],3))),'int',round(m.intercept_[0],3))
