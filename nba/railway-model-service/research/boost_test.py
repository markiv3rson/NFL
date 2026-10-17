"""Gradient boosting on EVERYTHING we have (context, rest, travel, team stats, player ratings) against the market's miss, each season left out."""
import sys, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
S=sys.argv[1]
c=pd.read_pickle(S+'ctx.pkl'); st=pd.read_pickle(S+'statfeats.pkl'); pf=pd.read_pickle(S+'pfeats.pkl')
c=c[(c.season_type==2)&c.home_line.notna()].copy()
cols=['a_pm','a_gs','t_pm','t_gs']
h=pf.merge(c[['game_id','home']],on='game_id'); h=h[h.team==h.home].drop(columns=['home','team']).rename(columns={k:'h_'+k for k in cols})[['game_id']+['h_'+k for k in cols]]
a=pf.merge(c[['game_id','away']],on='game_id'); a=a[a.team==a.away].drop(columns=['away','team']).rename(columns={k:'a2_'+k for k in cols})[['game_id']+['a2_'+k for k in cols]]
d=c.merge(st,on='game_id').merge(h,on='game_id').merge(a,on='game_id')
for k in cols: d['dp_'+k]=d['h_'+k]-d['a2_'+k]
d=d[d.season>=2010].reset_index(drop=True)
d['res']=d.margin-d.home_line; d['tres']=d.total-d.total_line
feat=[x for x in d.columns if x.startswith(('d_','dd_','dp_'))]+['h_rest','a_rest','h_gp','a_gp','h_win_pct','a_win_pct','h_streak','a_streak','h_avg_margin5','a_avg_margin5','h_cover5','a_cover5','h_over5','a_over5','h_games_in_4','a_games_in_4','h_trav_km','a_trav_km','home_line','total_line']
feat=[x for x in feat if x in d.columns]
d['d_rest']=d.h_rest-d.a_rest
print(len(d),'games',len(feat),'features')
for tgt,name in(('res','spread'),('tres','total')):
    p=pd.Series(0.0,index=d.index)
    for s in sorted(d.season.unique()):
        tr=d.season!=s
        m=HistGradientBoostingRegressor(max_iter=150,learning_rate=0.03,max_depth=3,min_samples_leaf=200,l2_regularization=10).fit(d.loc[tr,feat],d.loc[tr,tgt])
        p[d.season==s]=m.predict(d.loc[d.season==s,feat])
    y=d[tgt]; print(name,'market miss',round(y.abs().mean(),3),'-> with boosted model',round((y-p).abs().mean(),3))
    for q in(.8,.9,.95):
        sel=p.abs()>=p.abs().quantile(q); w=((np.sign(p[sel])*y[sel])>0)[y[sel]!=0]
        per=[f'{(((np.sign(p[sel&d.season.between(a_,b_)])*y[sel&d.season.between(a_,b_)])>0).mean()*100):.1f}' for a_,b_ in((2010,2013),(2014,2019),(2020,2026))]
        print(f'  top {int((1-q)*100)}% by predicted miss: {w.mean()*100:.1f}% of {len(w)}  periods {"/".join(per)}  seasons>50: {sum(((np.sign(p[sel&(d.season==s)])*y[sel&(d.season==s)])>0).mean()>.5 for s in d.season.unique() if (sel&(d.season==s)).sum()>5)}/{d.season.nunique()}')
