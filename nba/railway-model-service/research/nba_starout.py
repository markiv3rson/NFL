# Star teammate out (did not play, season-to-date 20+ points a game before this game) -> teammates' points / assists / rebounds.
# History: unseen-season model residuals (the prop model has no injury input). Real lines: Over rates.
import pandas as pd, numpy as np, pickle, re, sys
sys.path.insert(0,'/home/user/NFL/railway-model-service'); import prop_model as pm
B=pd.concat([pd.read_parquet(f'/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/player_box_{s}.parquet') for s in range(2022,2027)]); B=B[B.season_type==2].copy()
B['d']=pd.to_datetime(B.game_date); B['min']=pd.to_numeric(B.minutes,errors='coerce').fillna(0)
B['played']=(~B.did_not_play.fillna(False).astype(bool))&(B['min']>0); B['points']=pd.to_numeric(B.points,errors='coerce').fillna(0)
B=B.sort_values(['athlete_id','d'])
P=B[B.played].copy(); g=P.groupby(['athlete_id','season']); P['ppg']=(g.points.cumsum()-P.points)/g.cumcount().replace(0,np.nan)
# each player's latest ppg before a date (as of his previous played game), then DNP rows get it
last=P[['athlete_id','season','d','ppg','points']].copy()
D=B[~B.played][['athlete_id','season','d','game_id','team_id']].copy()
D=pd.merge_asof(D.sort_values('d'),P[['athlete_id','d','ppg','points']].assign(pp=lambda x: x.groupby('athlete_id').points.transform(lambda s: s.expanding().mean())).sort_values('d')[['athlete_id','d','pp']],on='d',by='athlete_id',allow_exact_matches=False)
star=D[D.pp>=20].groupby(['game_id','team_id']).size().rename('stars_out').reset_index()
print('team-games with a 20+ ppg player out:',len(star))
OOF=pickle.load(open('/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/nba_oof.pkl','rb'))
for stat in ('points','assists','rebounds'):
    O=OOF[stat].copy(); O=O.merge(star,on=['game_id','team_id'],how='left'); O['so']=O.stars_out.fillna(0)>0
    O['res']=O[stat]-O.mu
    line=" ".join(f"{s}: out {O[(O.season==s)&O.so].res.mean():+.2f} ({int(((O.season==s)&O.so).sum())}) vs {O[(O.season==s)&~O.so].res.mean():+.2f}" for s in sorted(O.season.unique()))
    print(f"{stat}: actual - predicted when a star teammate sits | {line}")
    res=[]
    for s in sorted(O.season.unique())[1:]:
        prev=O[O.season<s]; sp=pm.Spread(prev.mu.values,prev[stat].values); te=O[(O.season==s)&O.so&(O.mu>=(8 if stat=='points' else 3))]
        for mu,y in zip(te.mu.values,te[stat].values):
            for L in np.arange(max(0.5,np.floor(mu)-3.5),np.floor(mu)+4,1.0): res.append((s,float(sp.over([mu],[L])[0]),y>L))
    Dd=pd.DataFrame(res,columns=['season','p','over'])
    for side in ('Over','Under'):
        pc=Dd.p if side=='Over' else 1-Dd.p; won=Dd.over if side=='Over' else ~Dd.over
        for lo,hi in ((.65,.70),(.70,.80)):
            mm=(pc>=lo)&(pc<hi)
            if mm.sum()>=50: print(f"   star out, {side:5s} said {lo*100:.0f}-{hi*100:.0f}: won {won[mm].mean()*100:.1f} (said {pc[mm].mean()*100:.1f}, {mm.sum()}) by season "+" ".join(f"{won[mm&(Dd.season==s)].mean()*100:.0f}" for s in sorted(Dd.season.unique())))
# real lines 2025-26
R=pd.read_csv('/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/nba_real.csv'); R['date']=pd.to_datetime(R.date)
nn=lambda s: " ".join(w for w in re.sub(r"[^a-z ]","",str(s).lower().replace("-"," ").replace(".","")).split() if w not in ("jr","sr","ii","iii","iv"))
B['player']=B.athlete_display_name.map(nn)
k=B[B.played][['player','d','game_id','team_id']].rename(columns={'d':'date'}).merge(star,on=['game_id','team_id'],how='left')
R=R.merge(k[['player','date','stars_out']],on=['player','date'],how='left'); R['so']=R.stars_out.fillna(0)>0
print('\nreal lines with a star teammate out:',int(R.so.sum()))
for stat,gq in R.groupby('stat'):
    for side in ('Over','Under'):
        pc=gq.p_over if side=='Over' else 1-gq.p_over; won=gq.over if side=='Over' else ~gq.over; mk=(gq.close if side=='Over' else 1-gq.close)
        for lab,m in (('star out, all lines',gq.so),('star out + model 65%+',gq.so&(pc>=.65)),('star out + model 65%+ + mkt<=55c',gq.so&(pc>=.65)&(mk<=.55))):
            if m.sum()>=20: print(f"  REAL {stat:8s} {side:5s} {lab:34s} won {won[m].mean()*100:.1f}% ({int(m.sum())}) price {mk[m].mean()*100:.0f}c | Dec-Feb {won[m&R.loc[gq.index,'date'].dt.month.isin([12,1,2])].mean()*100:.0f} Mar-Apr {won[m&R.loc[gq.index,'date'].dt.month.isin([3,4])].mean()*100:.0f}")
