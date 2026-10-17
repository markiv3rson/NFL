import pandas as pd, numpy as np, pickle
R=pd.read_csv('/root/.nfl_cache/prop_real.csv'); R['week']=R.week_x; R=R[R.n24>0].copy()
W=pickle.load(open('/root/.nfl_cache/prop_oof.pkl','rb'))
out=[]
for stat,g in R.groupby('stat'):
    if stat not in W: continue
    O=W[stat]; O=O[O.season==2026][['pid','game_id','b_'+stat,'l3_'+stat]]
    m=g.merge(O,on=['pid','game_id'],how='left')
    m['ratio']=m['l3_'+stat]/m['b_'+stat].replace(0,np.nan)
    m['line_vs_avg']=m.line/m['b_'+stat].replace(0,np.nan)
    for lab,mask,side in (('hot (last 3 >= 1.3x avg) -> Under',m.ratio>=1.3,'Under'),('cold (last 3 <= 0.7x avg) -> Over',m.ratio<=0.7,'Over'),
                          ('line >= 1.2x his avg -> Under',m.line_vs_avg>=1.2,'Under'),('line <= 0.8x his avg -> Over',m.line_vs_avg<=0.8,'Over')):
        won=(m.over if side=='Over' else ~m.over)[mask]; mk=(m.close if side=='Over' else 1-m.close)[mask]
        if len(won)>=10: out.append((stat,lab,len(won),round(won.mean()*100,1),round(mk.mean()*100), f"{won[m.week[mask]<=3].mean()*100:.0f}/{won[m.week[mask]>=4].mean()*100:.0f}"))
pd.set_option('display.width',200); print(pd.DataFrame(out,columns=['stat','angle','n','won%','price','wk1-3/4-6']).to_string(index=False))
