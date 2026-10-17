# NBA props on REAL Polymarket lines (2025-26, traded in the last 24 h), cuts fixed before looking, split Dec-Feb vs Mar-Apr.
import pandas as pd, numpy as np
R=pd.read_csv('/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/nba_real.csv'); R['date']=pd.to_datetime(R.date); R['early']=R.date.dt.month.isin([12,1,2])
R['avg']=np.select([R.stat=='points',R.stat=='rebounds',R.stat=='assists'],[R.b_points,R.b_rebounds,R.b_assists])
R['lva']=R.line/R.avg.replace(0,np.nan)
# rest: days since the player's previous game (box scores)
B=pd.concat([pd.read_parquet(f'/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/player_box_{s}.parquet') for s in (2025,2026)]); B=B[B.season_type==2]
B['d']=pd.to_datetime(B.game_date); B=B.sort_values(['athlete_display_name','d']); B['rest']=B.groupby('athlete_display_name').d.diff().dt.days
import re
nn=lambda s: " ".join(w for w in re.sub(r"[^a-z ]","",str(s).lower().replace("-"," ").replace(".","")).split() if w not in ("jr","sr","ii","iii","iv"))
B['player']=B.athlete_display_name.map(nn); rest=B[['player','d','rest']].rename(columns={'d':'date'})
R=R.merge(rest,on=['player','date'],how='left')
rows=[]
for stat,g in R.groupby('stat'):
    for side in ('Over','Under'):
        pc=g.p_over if side=='Over' else 1-g.p_over; won=g.over if side=='Over' else ~g.over; mk=(g.close if side=='Over' else 1-g.close).clip(.01,.99)
        cuts=[('model65+',pc>=.65),('disagree: model65+ mkt<=55c',(pc>=.65)&(mk<=.55)),('agree: model65+ mkt60c+',(pc>=.65)&(mk>=.60)),('agree75: model70+ mkt65c+',(pc>=.70)&(mk>=.65)),
              ('model75+',pc>=.75),('market alone 65c+',mk>=.65),('market alone 70c+',mk>=.70)]
        if side=='Under': cuts.append(('line >= 1.2x avg -> Under',g.lva>=1.2))
        else: cuts.append(('line <= 0.8x avg -> Over',g.lva<=0.8))
        cuts.append(('back-to-back (rest 1 day)',(g.rest==1)&(pc>=.65)))
        for cut,m in cuts:
            if m.sum()<30: continue
            f=lambda mm: f"{won[mm].mean()*100:.1f}% ({mm.sum()})" if mm.sum() else "-"
            rows.append((stat,side,cut,int(m.sum()),round(won[m].mean()*100,1),f(m&g.early),f(m&~g.early),round(mk[m].mean()*100)))
T=pd.DataFrame(rows,columns=['stat','side','cut','n','won%','Dec-Feb','Mar-Apr','price'])
pd.set_option('display.width',250); pd.set_option('display.max_rows',300); print(T.to_string(index=False))
