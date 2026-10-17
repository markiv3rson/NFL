import sys, numpy as np, pandas as pd
from sklearn.linear_model import Ridge
S=sys.argv[1]
f=pd.read_pickle(S+'pfeats.pkl'); c=pd.read_pickle(S+'ctx.pkl')
c=c[(c.season_type==2)&c.home_line.notna()]
cols=['a_pm','a_gs','t_pm','t_gs','b_pm','b_gs','bt_pm','bt_gs','r_pm','r_gs','rt_pm','rt_gs']
h=f.merge(c[['game_id','home']],on='game_id'); h=h[h.team==h.home].drop(columns=['home','team']).rename(columns={k:'h_'+k for k in cols})
a=f.merge(c[['game_id','away']],on='game_id'); a=a[a.team==a.away].drop(columns=['away','team']).rename(columns={k:'a2_'+k for k in cols})
d=c.merge(h,on='game_id').merge(a,on='game_id'); d['res']=d.margin-d.home_line; d['tres']=d.total-d.total_line
for k in cols: d['d_'+k]=d['h_'+k]-d['a2_'+k]
print(len(d),'games; plus-minus coverage by season (share of games with nonzero strength):'); print(d.groupby('season').apply(lambda x:(x.d_a_pm!=0).mean()).round(2).to_dict())
d=d[d.season>=2010]
d2=d[d.d_r_pm.notna()].copy()
def loso(feats,tgt='res'):
    X=d[feats]; X=(X-X.mean())/X.std(); p=pd.Series(0.0,index=d.index)
    for s in d.season.unique():
        tr=d.season!=s; p[d.season==s]=Ridge(alpha=500).fit(X[tr],d.loc[tr,tgt]).predict(X[d.season==s])
    return p
def show(name,feats,tgt='res'):
    p=loso(feats,tgt); y=d[tgt]; mae0=y.abs().mean(); mae1=(y-p).abs().mean()
    line=f'{name:44s} miss {mae0:.3f} -> {mae1:.3f}  '
    for q in(.8,.9):
        sel=p.abs()>=p.abs().quantile(q); w=((np.sign(p[sel])*y[sel])>0)[y[sel]!=0]
        per=[f'{(((np.sign(p[sel&(d.season.between(a,b))])*y[sel&(d.season.between(a,b))])>0).mean()*100):.0f}' for a,b in((2010,2013),(2014,2019),(2020,2026))]
        line+=f'top{int((1-q)*100)}%: {w.mean()*100:.1f}% ({len(w)}) {"/".join(per)}  '
    print(line)
show('pre-game players, plus-minus',['d_a_pm','d_t_pm'])
show('pre-game players, box value',['d_a_gs','d_t_gs'])
show('pre-game all four',['d_a_pm','d_a_gs','d_t_pm','d_t_gs'])
show('HINDSIGHT who played, plus-minus',['d_b_pm','d_bt_pm'])
show('HINDSIGHT who played, all four',['d_b_pm','d_b_gs','d_bt_pm','d_bt_gs'])
show('pre + hindsight - pre (injury effect)',['d_a_pm','d_a_gs','d_b_pm','d_b_gs'])
show('TOTAL: pre-game players',['d_a_pm','d_a_gs','d_t_pm','d_t_gs'],'tres')

print('--- 2021-26 games with an injury report (pre-tip) ---')
d=d2
show('REPORT-adjusted players (plus-minus)',['d_r_pm','d_rt_pm'])
show('REPORT-adjusted players (all four)',['d_r_pm','d_r_gs','d_rt_pm','d_rt_gs'])
show('report minus no-report (injury effect)',['d_r_pm','d_r_gs','d_a_pm','d_a_gs'])
show('HINDSIGHT who played (all four)',['d_b_pm','d_b_gs','d_bt_pm','d_bt_gs'])
