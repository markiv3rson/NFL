import pandas as pd, numpy as np, pickle, sys
sys.path.insert(0,'/home/user/NFL/railway-model-service'); import prop_model as pm
OOF=pickle.load(open('/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/nba_oof.pkl','rb'))
for stat in ('rebounds','points','assists'):
    O=OOF[stat].copy(); O['date']=pd.to_datetime(O.date)
    O=O.sort_values(['athlete_id','date']); O['rest']=O.groupby('athlete_id').date.diff().dt.days
    O['res']=O[stat]-O.mu
    print(f"\n== {stat}: unseen seasons {sorted(O.season.unique())}")
    for s in sorted(O.season.unique()):
        S=O[O.season==s]; b=S[S.rest==1]; o=S[S.rest>=2]
        print(f"  {s}: back-to-back {len(b)} games, actual - predicted {b.res.mean():+.2f} (others {o.res.mean():+.2f}); relative {(b[stat].sum()/b.mu.sum()-1)*100:+.1f}% vs {(o[stat].sum()/o.mu.sum()-1)*100:+.1f}%")
    # ladder test at lines around the prediction, model chance from earlier seasons, B2B only, Under side 65%+
    res=[]
    for s in sorted(O.season.unique())[1:]:
        prev=O[O.season<s]; sp=pm.Spread(prev.mu.values,prev[stat].values); te=O[(O.season==s)&(O.rest==1)]
        for mu,y in zip(te.mu.values,te[stat].values):
            for L in np.arange(max(0.5,np.floor(mu)-3.5),np.floor(mu)+4,1.0):
                po=float(sp.over([mu],[L])[0]); res.append((s,po,y>L))
    D=pd.DataFrame(res,columns=['season','p','over'])
    for side in ('Under','Over'):
        pc=D.p if side=='Over' else 1-D.p; won=D.over if side=='Over' else ~D.over
        for lo,hi in ((.65,.70),(.70,.80)):
            mm=(pc>=lo)&(pc<hi)
            if mm.sum()>=50: print(f"  B2B {side:5s} said {lo*100:.0f}-{hi*100:.0f}: said {pc[mm].mean()*100:.1f} won {won[mm].mean()*100:.1f} ({mm.sum()}) by season "+" ".join(f"{s}:{won[mm&(D.season==s)].mean()*100:.0f}" for s in sorted(D.season.unique())))
