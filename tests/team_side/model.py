import pandas as pd, numpy as np, sys, warnings; warnings.filterwarnings("ignore")
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.ensemble import HistGradientBoostingClassifier
S=sys.argv[1]
R=pd.read_parquet(f"{S}/teamB/teamgames.parquet").sort_values(["season","week"])
R["marg"]=R.pf-R.pa; R["tom"]=R.dto-R.oto
STATS=["win","cov","marg","pf","pa","oepa","depa","osr","dsr","oypp","dypp","tom","opass","orush"]
# season-to-date averages (games before this week), blended with last season's full average (as K games) early on
K=4
full=R.groupby(["season","team"])[STATS].mean()
out=[]
for (s,t),d in R.groupby(["season","team"]):
    d=d.sort_values("week"); prev=full.loc[(s-1,t)] if (s-1,t) in full.index else None
    cs=d[STATS].shift(1).expanding().sum(); n=np.arange(len(d))
    for i,(idx,row) in enumerate(d.iterrows()):
        v=cs.iloc[i] if i>0 else pd.Series(0.0,index=STATS)
        if prev is not None: avg=(v.fillna(0)+K*prev.fillna(0))/(i+K)
        elif i>0: avg=v/i
        else: avg=pd.Series(np.nan,index=STATS)
        rec=dict(game_id=row.game_id,team=t,n=i); rec.update({f"s_{k}":avg[k] for k in STATS}); out.append(rec)
F=pd.DataFrame(out)
# opponent-adjusted margin (SRS) to date: iterate on games before this week
srs={}
for s,d in R.groupby("season"):
    for w in sorted(d.week.unique()):
        past=d[d.week<w]
        if len(past)==0: continue
        teams=pd.unique(past.team); r={t:0.0 for t in teams}
        mg=past.groupby("team").marg.mean(); opps=past.groupby("team").opp.apply(list)
        for _ in range(20): r={t:mg[t]+np.mean([r.get(o,0) for o in opps[t]]) for t in teams}
        m=np.mean(list(r.values()))
        for t in teams: srs[(s,w,t)]=r[t]-m
R["srs"]=[srs.get((s,w,t),np.nan) for s,w,t in zip(R.season,R.week,R.team)]
X=R.merge(F,on=["game_id","team"])
H=X[X.home==1].set_index("game_id"); A=X[X.home==0].set_index("game_id")
cols=[f"s_{k}" for k in STATS]+["srs"]
D=pd.DataFrame(index=H.index)
for c in cols: D["d_"+c]=H[c]-A[c].reindex(H.index)
D["hline"]=H.line; D["cov"]=H["cov"]; D["season"]=H.season; D["week"]=H.week; D["marg"]=H.marg; D["n"]=H.n
D=D.dropna(subset=["hline"]); D=D[D.season>=2012]
feats=[c for c in D.columns if c.startswith("d_")]
D[feats]=D[feats].fillna(0)
def report(name,res):
    r=pd.DataFrame(res); r=r[r.y!=0.5]
    r["ok"]=(r.p>0.5)==(r.y==1); r["conf"]=(r.p-0.5).abs()
    line=[f"{name}: all {r.ok.mean()*100:.1f}% ({len(r)})"]
    for q in (0.5,0.3,0.2,0.1):
        t=r[r.conf>=r.conf.quantile(1-q)]; line.append(f"top{int(q*100)}% {t.ok.mean()*100:.1f} ({len(t)})")
    t=r[r.conf>=r.conf.quantile(0.8)]
    per=[f"{a}-{b}: {t[(t.season>=a)&(t.season<=b)].ok.mean()*100:.1f}" for a,b in ((2014,2017),(2018,2021),(2022,2025))]
    print(" | ".join(line)," || top20 by period:",", ".join(per), flush=True)
    return r
# 1) classifier on team differences + the line (who covers)
for nm,mk in (("logit C=0.05",lambda: LogisticRegression(C=0.05,max_iter=2000)),("logit C=1",lambda: LogisticRegression(C=1,max_iter=2000)),("boosted trees",lambda: HistGradientBoostingClassifier(max_depth=3,max_iter=200,learning_rate=0.05))):
    res=[]
    for s in range(2014,2026):
        tr=D[(D.season<s)&(D.cov!=0.5)]; te=D[D.season==s]
        mu=tr[feats+["hline"]].mean(); sd=tr[feats+["hline"]].std()+1e-9
        m=mk(); m.fit((tr[feats+["hline"]]-mu)/sd, tr["cov"].astype(int))
        p=m.predict_proba((te[feats+["hline"]]-mu)/sd)[:,1]
        res+= [dict(season=s,p=a,y=b) for a,b in zip(p,te["cov"])]
    report(nm,res)
# 2) team-only margin (no line), then compare with the line
res=[];gap=[]
for s in range(2014,2026):
    tr=D[D.season<s]; te=D[D.season==s]
    m=Ridge(alpha=50).fit(tr[feats],tr.marg); pm=m.predict(te[feats])
    g=pm+te.hline.values   # >0: home better than the line says
    for a,b,ss in zip(g,te["cov"],te.season): gap.append(dict(season=ss,g=a,y=b))
G=pd.DataFrame(gap); G=G[G.y!=0.5]; G["ok"]=(G.g>0)==(G.y==1)
print("team-only margin vs line: all", f"{G.ok.mean()*100:.1f}% ({len(G)})", " | ".join(f"gap {t}+: {G[G.g.abs()>=t].ok.mean()*100:.1f}% ({(G.g.abs()>=t).sum()})" for t in (1,2,3,4,5)))
for t in (3,4):
    x=G[G.g.abs()>=t]; print(f"  gap {t}+ by period:", ", ".join(f"{a}-{b}: {x[(x.season>=a)&(x.season<=b)].ok.mean()*100:.1f} ({((x.season>=a)&(x.season<=b)).sum()})" for a,b in ((2014,2017),(2018,2021),(2022,2025))))
D.to_parquet(f"{S}/teamB/D.parquet")
