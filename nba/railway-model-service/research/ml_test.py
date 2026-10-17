"""Moneyline: is the market's own win chance (margin removed) honest? Calibrate it with each season left out, compare Brier, then favourites parlays by day."""
import sys, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
S=sys.argv[1]
c=pd.read_pickle(S+'ctx.pkl'); c=c[(c.season_type==2)&c.ml_home.notna()&c.ml_away.notna()].copy()
imp=lambda ml:np.where(ml<0,-ml/(-ml+100),100/(ml+100))
ph,pa=imp(c.ml_home.values),imp(c.ml_away.values); c['p']=ph/(ph+pa); c['y']=(c.margin>0).astype(float)
c=c[(c.p>0.01)&(c.p<0.99)]
print(len(c),'games with moneylines; Brier of the raw market chance',round(((c.p-c.y)**2).mean(),4))
c['fav_p']=np.maximum(c.p,1-c.p); c['fav_won']=np.where(c.p>=0.5,c.y,1-c.y)
b=pd.cut(c.fav_p,[.5,.55,.6,.65,.7,.75,.8,.85,.9,1.0])
t=c.groupby(b,observed=True).agg(n=('y','size'),said=('fav_p','mean'),won=('fav_won','mean')).round(3); print(t.to_string())
# LOSO calibration: logistic on logit(p) (+ squared term)
lg=lambda p:np.log(p/(1-p))
X=np.c_[lg(c.p),lg(c.p)*np.abs(lg(c.p))]
pred=pd.Series(0.0,index=c.index)
for s in sorted(c.season.unique()):
    tr=(c.season!=s).values; m=LogisticRegression(C=100).fit(X[tr],c.y[tr]); pred[c.season==s]=m.predict_proba(X[(c.season==s).values])[:,1]
c['pc']=pred
print('Brier raw market',round(((c.p-c.y)**2).mean(),4),'| calibrated market (unseen seasons)',round(((c.pc-c.y)**2).mean(),4),'| our model 0.2092 vs market 0.2043 (2025-26 only, from the report)')
c['fav_pc']=np.maximum(c.pc,1-c.pc)
b2=pd.cut(c.fav_pc,[.5,.6,.7,.8,.9,1.0]); print(c.groupby(b2,observed=True).agg(n=('y','size'),said=('fav_pc','mean'),won=('fav_won','mean')).round(3).to_string())
print('honest calibration check by 56%+ buckets: said vs won (unseen)')
# favourites parlay by day: 4 biggest favourites, one per game
c['day']=c.date
res=[]
for d,g in c.groupby('day'):
    if len(g)<4: continue
    top=g.sort_values('fav_pc',ascending=False).head(4)
    res.append((d,top.fav_won.prod(),top.fav_pc.prod(),top.fav_p.prod(),top.fav_won.sum(),d.year if hasattr(d,'year') else 0,top.season.iloc[0]))
r=pd.DataFrame(res,columns=['day','all4','pc','pm','n4','y','season'])
print(f'4 biggest favourites per day ({len(r)} days): all 4 won {r.all4.mean()*100:.1f}% | calibrated said {r.pc.mean()*100:.1f}% | raw market said {r.pm.mean()*100:.1f}% | 3+ of 4 won {(r.n4>=3).mean()*100:.1f}%')
print(' by season all4:', r.groupby('season').all4.mean().mul(100).round(0).astype(int).to_dict())
for k in (3,2):
    res=[]
    for d,g in c.groupby('day'):
        if len(g)<k: continue
        top=g.sort_values('fav_pc',ascending=False).head(k); res.append((top.fav_won.prod(),top.fav_pc.prod()))
    x=np.array(res); print(f'{k} biggest favourites per day: all won {x[:,0].mean()*100:.1f}% said {x[:,1].mean()*100:.1f}% ({len(x)} days)')
c.to_pickle(S+'ml_cal.pkl')
