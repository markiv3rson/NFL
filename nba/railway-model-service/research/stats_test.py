import sys; sys.path.insert(0,'/home/user/NBA/railway-model-service')
import numpy as np, pandas as pd, nba_data as nd
from sklearn.linear_model import Ridge
S='/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/'
c=pd.read_pickle(S+'ctx.pkl'); tg=nd.team_games()
tg=tg[tg.season_type==2].sort_values(['date','game_id'])
K=['field_goals_made','field_goals_attempted','three_point_field_goals_made','three_point_field_goals_attempted','free_throws_attempted','offensive_rebounds','turnovers','poss','total_rebounds']
o=tg[['game_id','team']+K].rename(columns={k:'o_'+k for k in K}).rename(columns={'team':'o_team'})
t=tg.merge(o,left_on=['game_id','opp'],right_on=['game_id','o_team']).sort_values(['date','game_id'])
def four(p):
    return pd.DataFrame({'efg':(p.field_goals_made+.5*p.three_point_field_goals_made)/p.field_goals_attempted,
     'tov':p.turnovers/p.poss,'ftr':p.free_throws_attempted/p.field_goals_attempted,
     'orb':p.offensive_rebounds/(p.offensive_rebounds+p.o_total_rebounds-p.o_offensive_rebounds),
     'r3':p.three_point_field_goals_attempted/p.field_goals_attempted,'pace':p.poss})
def four_d(p):
    q=p.rename(columns={**{k:'x_'+k for k in K},**{'o_'+k:k for k in K}}).rename(columns={'x_'+k:'o_'+k for k in K})
    d=four(q); d.columns=['d_'+x for x in d.columns]; return d
F=pd.concat([four(t),four_d(t)],axis=1); F['game_id']=t.game_id.values; F['team']=t.team.values; F['season']=t.season.values
cols=[x for x in F.columns if x not in('game_id','team','season')]
HL=25; a=1-0.5**(1/HL)
pre={}  # (game_id,team)->vector before the game
state={}
rows=[]
for r in F.itertuples(index=False):
    v=np.array(r[:len(cols)],float); s=state.get(r.team)
    rows.append((r.game_id,r.team,None if s is None else s[0].copy(), 0 if s is None else s[1]))
    if s is None: state[r.team]=[v,1]
    else:
        s[0]=(1-a)*s[0]+a*v; s[1]+=1
pre={(g,t):(v,n) for g,t,v,n in rows}
X=[];idx=[]
for r in c.itertuples():
    h=pre.get((r.game_id,r.home)); aw=pre.get((r.game_id,r.away))
    if h is None or aw is None or h[0] is None or aw[0] is None or min(h[1],aw[1])<15: continue
    hv,av=h[0],aw[0]
    n=len(cols)//2
    # margin-relevant: home offense vs away defense etc
    feat=np.concatenate([hv[:n]-av[:n], hv[n:]-av[n:]])   # off diff, def diff
    X.append(feat);idx.append(r.Index)
X=np.array(X); d=c.loc[idx].copy()
names=['d_'+x for x in cols[:n]]+['dd_'+x for x in cols[:n]]
d=d.reset_index(drop=True); X=pd.DataFrame(X,columns=names); X=(X-X.mean())/X.std()
d=d[d.season_type==2]; X=X.loc[d.index]
m=d.home_line.notna()
d=d[m]; X=X[m]
d['res']=d.margin-d.home_line   # + = home covers
d['tres']=d.total-d.total_line
def loso(target,extra=None):
    pred=pd.Series(0.0,index=d.index)
    for s in sorted(d.season.unique()):
        tr=d.season!=s
        Xa=X.copy()
        mdl=Ridge(alpha=2000).fit(Xa[tr],d.loc[tr,target]); pred[d.season==s]=mdl.predict(Xa[d.season==s])
    return pred
for tgt,line in(('res','spread'),('tres','total')):
    p=loso(tgt); y=d[tgt]
    mae0=y.abs().mean(); mae1=(y-p).abs().mean()
    print(line,'market miss',round(mae0,3),'with stat features (unseen seasons)',round(mae1,3))
    for q in(.9,.8,.7):
        thr=p.abs().quantile(q); sel=p.abs()>=thr
        w=((np.sign(p[sel])*y[sel])>0)[y[sel]!=0]
        print(f'  top {int((1-q)*100)}% by |model-vs-market|: {w.mean()*100:.1f}% of {len(w)}',
              ' by season>50:',sum(((np.sign(p[sel&(d.season==s)])*y[sel&(d.season==s)])>0).mean()>.5 for s in d.season.unique() if (sel&(d.season==s)).sum()>10),'/',d.season.nunique())
# also plain: top |coef|
print('feature sums', pd.Series(Ridge(alpha=2000).fit(X,d.res).coef_,index=names).round(3).to_dict())
