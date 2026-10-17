# NFL: a team's top target (7+ targets a game this season) misses the game -> teammates' receiving yards / receptions vs the model.
import pandas as pd, numpy as np, pickle, sys
sys.path.insert(0,'/home/user/NFL/railway-model-service'); import prop_model as pm
W=pickle.load(open('/root/.nfl_cache/prop_oof.pkl','rb'))
T=pm.table(list(range(2019,2027)))
T=T.sort_values(['season','week'])
# per team-game: players with b_tgt>=7 who played the team's previous game but have no row in this game
rows=[]
for (s,team),g in T.groupby(['season','team']):
    wk=sorted(g.week.unique()); by={w:g[g.week==w] for w in wk}
    for i in range(1,len(wk)):
        prev=by[wk[i-1]]; cur=by[wk[i]]
        top=prev[(prev.b_tgt.fillna(0)>=7)|((prev.tgt>=7)&(prev.gp>=3))]
        miss=set(top.pid)-set(cur.pid)
        if miss: rows.append((s,cur.game_id.iloc[0],team,len(miss)))
M=pd.DataFrame(rows,columns=['season','game_id','team','out'])
print('team-games with a top target missing:',len(M))
for stat in ('rec_yds','rec'):
    O=W[stat].merge(M[['game_id','team','out']],on=['game_id','team'],how='left'); O['to']=O.out.fillna(0)>0; O['res']=O[stat]-O.mu
    print(stat,' | '.join(f"{s}: {O[(O.season==s)&O.to].res.mean():+.1f} ({int(((O.season==s)&O.to).sum())}) vs {O[(O.season==s)&~O.to].res.mean():+.1f}" for s in sorted(O.season.unique()) if s<2026))
    res=[]
    for s in range(2021,2026):
        prev=O[O.season<s]; sp=pm.Spread(prev.mu.values,prev[stat].values); te=O[(O.season==s)&O.to]
        for mu,y in zip(te.mu.values,te[stat].values):
            Ls=np.arange(max(0.5,np.round(mu/10)*10-19.5),np.round(mu/10)*10+21,10.0) if stat=='rec_yds' else np.arange(max(0.5,np.floor(mu)-2.5),np.floor(mu)+3,1.0)
            for L in Ls: res.append((s,float(sp.over([mu],[L])[0]),y>L))
    D=pd.DataFrame(res,columns=['season','p','over'])
    for side in ('Over','Under'):
        pc=D.p if side=='Over' else 1-D.p; won=D.over if side=='Over' else ~D.over
        for lo,hi in ((.65,.70),(.70,.80)):
            mm=(pc>=lo)&(pc<hi)
            if mm.sum()>=50: print(f"   top target out, {side:5s} said {lo*100:.0f}-{hi*100:.0f}: won {won[mm].mean()*100:.1f} (said {pc[mm].mean()*100:.1f}, {mm.sum()}) by season "+" ".join(f"{won[mm&(D.season==s)].mean()*100:.0f}" for s in range(2021,2026)))
R=pd.read_csv('/root/.nfl_cache/prop_real.csv'); R=R[R.n24>0].merge(M[['game_id','out']].drop_duplicates('game_id'),on='game_id',how='left')
print('real 2026 lines in games with a top target out (either team):',int(R.out.notna().sum()))
tm=T[['pid','game_id','team']].drop_duplicates()
R=pd.read_csv('/root/.nfl_cache/prop_real.csv'); R=R[(R.n24>0)&R.stat.isin(['rec_yds','rec','long_rec'])].merge(tm,on=['pid','game_id'],how='left').merge(M[['game_id','team','out']],on=['game_id','team'],how='left')
R['to']=R.out.notna(); R['week']=R.week_x
for stat,g in R.groupby('stat'):
    for side in ('Over','Under'):
        pc=g.p_over if side=='Over' else 1-g.p_over; won=g.over if side=='Over' else ~g.over; mk=(g.close if side=='Over' else 1-g.close)
        for lab,m in (('own team top target out, all lines',g.to),('... + model 65%+',g.to&(pc>=.65)),('... + model 60%+',g.to&(pc>=.60))):
            if m.sum()>=8: print(f"  REAL {stat:8s} {side:5s} {lab:38s} won {won[m].mean()*100:.1f}% ({int(won[m].sum())}-{int((~won[m]).sum())}) price {mk[m].mean()*100:.0f}c wk1-3 {won[m&(g.week<=3)].mean()*100:.0f} wk4-6 {won[m&(g.week>=4)].mean()*100:.0f}")
