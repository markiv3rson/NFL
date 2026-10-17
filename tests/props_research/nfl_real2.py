# NFL props on REAL Polymarket lines (2026 weeks 1-6), cuts fixed before looking: (a) model 65%+ vs market <=55c on that side (true disagreement),
# (b) model 65%+ AND market 60c+ (agreement), (c) model edge 15+ points over the price, (d) model 75%+ -- each split weeks 1-3 vs 4-6.
import pandas as pd, numpy as np
R=pd.read_csv('/root/.nfl_cache/prop_real.csv'); R['week']=R.week_x
R=R[R.n24>0].copy()   # traded in the last 24 h (a real close)
rows=[]
for stat,g in R.groupby('stat'):
    for side in ('Over','Under'):
        pc=g.p_over if side=='Over' else 1-g.p_over; won=g.over if side=='Over' else ~g.over
        mk=(g.close if side=='Over' else 1-g.close).clip(0.01,0.99)
        for cut,m in (('model65+',pc>=.65),('disagree: model65+ mkt<=55c',(pc>=.65)&(mk<=.55)),('agree: model65+ mkt60c+',(pc>=.65)&(mk>=.60)),('edge15+',(pc-mk>=.15)),('model75+',pc>=.75),('agree75: model70+ mkt65c+',(pc>=.70)&(mk>=.65))):
            if m.sum()<10: continue
            e=m&(g.week<=3); l=m&(g.week>=4)
            f=lambda mm: f"{won[mm].mean()*100:.1f}% ({int(won[mm].sum())}-{int((~won[mm]).sum())})" if mm.sum() else "-"
            rows.append((stat,side,cut,int(m.sum()),round(won[m].mean()*100,1),f(e),f(l),round(mk[m].mean()*100),round(((won[m]/(mk[m]+.01))-1).mean()*100,1)))
T=pd.DataFrame(rows,columns=['stat','side','cut','n','won%','wk1-3','wk4-6','price','per$100'])
pd.set_option('display.width',250); pd.set_option('display.max_rows',200)
print(T.to_string(index=False))
P=T[(T['won%']>=65)]
print('\nPASS 65%+ overall (then check both halves):'); print(P.to_string(index=False))
