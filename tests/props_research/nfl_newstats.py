# New Polymarket US prop types (ladders "N+"): rushing attempts, scrimmage yards, passing TDs, interceptions thrown. Walk-forward history:
# each season predicted by models trained only on earlier seasons; chance of a line from earlier seasons' out-of-sample outcomes.
import sys, numpy as np, pandas as pd
sys.path.insert(0,'/home/user/NFL/railway-model-service'); import prop_model as pm, td_prob
seas=list(range(2019,2026))
T=pm.table(seas)
# passing TDs / interceptions per passer-game from pbp
extra=[]
for s in seas:
    p=td_prob.fetch_pbp(s); p=p[(p.season_type=='REG')&p.passer_player_id.notna()&(p.pass_attempt==1)]
    a=p.groupby(['passer_player_id','game_id']).agg(pass_td=('pass_touchdown','sum'),ints=('interception','sum')).reset_index().rename(columns={'passer_player_id':'pid'})
    extra.append(a)
X=pd.concat(extra); T=T.merge(X,on=['pid','game_id'],how='left'); T[['pass_td','ints']]=T[['pass_td','ints']].fillna(0)
T['scrim']=T.rush_yds+T.rec_yds
T=T.sort_values(['pid','season','week'])
for c in ('pass_td','ints','scrim'):
    g=T.groupby(['pid','season']); cum=g[c].cumsum()-T[c]; n=g.cumcount()
    T['b_'+c]=cum/n.replace(0,np.nan); T['l3_'+c]=g[c].transform(lambda s: s.shift(1).rolling(3,min_periods=1).mean())
base=pm.FEATS_COMMON
FE={'car':base+['b_rush_yds','l3_rush_yds','o_rush_yds'],'scrim':base+['b_scrim','l3_scrim','b_rush_yds','b_rec_yds','o_rush_yds','o_rec_yds'],
    'pass_td':base+['b_pass_td','l3_pass_td','b_pass_yds','o_pass_yds'],'ints':base+['b_ints','l3_ints','b_pass_yds']}
EL={'car':T.pos.isin(['RB','QB'])&(T.b_car.fillna(0)>=5),'scrim':T.pos.isin(['RB','WR','TE'])&((T.b_car.fillna(0)+T.b_tgt.fillna(0))>=4),
    'pass_td':(T.pos=='QB')&(T.b_pass_att.fillna(0)>=15),'ints':(T.pos=='QB')&(T.b_pass_att.fillna(0)>=15)}
LADDER={'car':lambda mu: np.arange(np.floor(mu)-4.5,np.floor(mu)+5,1.0),'scrim':lambda mu: np.arange(np.round(mu/10)*10-29.5,np.round(mu/10)*10+31,10.0),
        'pass_td':lambda mu: np.array([0.5,1.5,2.5]),'ints':lambda mu: np.array([0.5,1.5])}
from sklearn.ensemble import HistGradientBoostingRegressor
for stat in FE:
    E=T[EL[stat]].dropna(subset=['b_'+('rush_yds' if stat=='car' else stat)]).copy(); f=FE[stat]; oof=[]
    for s in seas[1:]:
        tr=E[E.season<s]; te=E[E.season==s].copy()
        m=HistGradientBoostingRegressor(max_iter=300,learning_rate=0.05,max_depth=4,min_samples_leaf=60,l2_regularization=1.0,random_state=0).fit(tr[f].astype(float).values,tr[stat].astype(float).values)
        te['mu']=np.maximum(m.predict(te[f].astype(float).values),0.05); oof.append(te)
    O=pd.concat(oof); res=[]
    for s in range(2021,2026):
        prev=O[O.season<s]; sp=pm.Spread(prev.mu.values,prev[stat].values); te=O[O.season==s]
        for mu,y in zip(te.mu.values,te[stat].values):
            for L in LADDER[stat](mu):
                if L<0: continue
                po=float(sp.over([mu],[L])[0]); res.append((s,L,po,y>L))
    D=pd.DataFrame(res,columns=['season','line','p','over'])
    print(f"\n== {stat}: {len(O)} out-of-sample player-games, {len(D)} ladder lines 2021-25")
    for side in ('Over','Under'):
        pc=D.p if side=='Over' else 1-D.p; won=D.over if side=='Over' else ~D.over
        for lo,hi in ((.65,.70),(.70,.80),(.80,.90)):
            mm=(pc>=lo)&(pc<hi)
            if mm.sum()>=50: print(f"  {side:5s} said {lo*100:.0f}-{hi*100:.0f}: said {pc[mm].mean()*100:.1f} won {won[mm].mean()*100:.1f} ({mm.sum()}) | by season "+" ".join(f"{won[mm&(D.season==s)].mean()*100:.0f}" for s in range(2021,2026)))
