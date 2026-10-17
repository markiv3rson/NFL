import numpy as np, pandas as pd
S='/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/'
c=pd.read_pickle(S+'ctx.pkl'); c=c[(c.season_type==2)&c.home_line.notna()].sort_values(['date','game_id']).reset_index(drop=True)
c['res']=c.margin-c.home_line; c['tres']=c.total-c.total_line
c['per']=pd.cut(c.season,[0,2013,2019,2100],labels=['08-13','14-19','20+'])
# last ATS miss size per team, road trip length, rematch
last={};trip={};prev={}
lm_h=[];lm_a=[];tr_a=[];tr_h=[];rem=[]
hist={}
for r in c.itertuples():
    lm_h.append(last.get(r.home,np.nan)); lm_a.append(last.get(r.away,np.nan))
    tr_a.append(trip.get(r.away,0)); tr_h.append(-trip.get(r.home,0))  # road games in row (a) / home stand (h as negative)
    rem.append(frozenset((r.home,r.away)) in hist and (r.date-hist[frozenset((r.home,r.away))]).days<30)
    last[r.home]=r.res; last[r.away]=-r.res
    hist[frozenset((r.home,r.away))]=r.date
    trip[r.away]=trip.get(r.away,0)+1 if trip.get(r.away,0)>=0 else 1; trip[r.home]=-1 if trip.get(r.home,0)>=0 else trip[r.home]-1
c['lm_h']=lm_h;c['lm_a']=lm_a;c['trip_a']=tr_a;c['trip_h']=tr_h;c['rem']=rem
def rep(name,mask,side,col='res'):
    d=c[mask]; y=d[col]*side if np.isscalar(side) else d[col]*side[mask]
    nz=y!=0; w=(y[nz]>0)
    byp=[f'{w[d.per[nz]==p].mean()*100:.1f}' for p in ['08-13','14-19','20+']]
    print(f'{name:55s} {w.mean()*100:5.1f}% n={len(w):5d}  periods {"/".join(byp)}')
rep('home after covering by 10+ (bounce): bet home',c.lm_h>=10,1)
rep('home after missing by 10+: bet home',c.lm_h<=-10,1)
rep('away after missing by 10+: bet away',c.lm_a<=-10,-1)
rep('away after covering by 10+: bet away',c.lm_a>=10,-1)
rep('road team 4+ road games in a row: bet home',c.trip_a>=4,1)
rep('road team on 4+ road trip: bet road',c.trip_a>=4,-1)
rep('home 4+ home stand: bet home',c.trip_h<=-4,1)
rep('rematch within 30 days: bet home',c.rem,1)
rep('rematch within 30 days: over',c.rem,1,'tres')
rep('early season (gp<=8) total: under',(c.h_gp<=8)&(c.a_gp<=8),-1,'tres')
rep('early season (gp<=8) total: over',(c.h_gp<=8)&(c.a_gp<=8),1,'tres')
rep('big dog (7+) road: bet dog',c.home_line>=7,-1)
rep('big home dog (7+): bet dog',c.home_line<=-7,1)
rep('road dog 3-7 after a loss: dog',(c.home_line.between(3,7))&(c.a_last_win==0),-1)
rep('low scoring last game both, over',(c.h_last_total<200)&(c.a_last_total<200),1,'tres')
rep('home 3+ game win streak: bet home',c.h_streak>=3,1)
rep('away 3+ game loss streak: bet away',c.a_streak<=-3,-1)
rep('key number: home fav 3 : bet home',c.home_line==3,1)
rep('key number: home fav 5 : bet home',c.home_line==5,1)
rep('back-to-back road team vs rested home: bet home',(c.a_rest==1)&(c.h_rest>=2),1)
