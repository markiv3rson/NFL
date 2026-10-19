import pandas as pd, numpy as np, sys, warnings; warnings.filterwarnings("ignore")
from sklearn.linear_model import LogisticRegression
S=sys.argv[1]; D=pd.read_parquet(f"{S}/teamB/D.parquet")
print("seasons in D:", sorted(D.season.unique())[-3:], "2026 games:", (D.season==2026).sum())
feats=[c for c in D.columns if c.startswith("d_")]
sets={"ALL":feats,"ALL minus covers":[f for f in feats if f!="d_s_cov"],"per-play+SRS+TO":["d_s_oepa","d_s_depa","d_s_osr","d_s_dsr","d_srs","d_s_tom"]}
for nm,fs in sets.items():
    X=fs+["hline"]
    # walk-forward incl. 2026 live
    res=[]
    for s in range(2014,2027):
        tr=D[(D.season<s)&(D["cov"]!=0.5)]; te=D[(D.season==s)&(D["cov"]!=0.5)]
        if not len(te): continue
        mu=tr[X].mean(); sd=tr[X].std()+1e-9
        m=LogisticRegression(C=0.05,max_iter=3000).fit((tr[X]-mu)/sd, tr["cov"].astype(int))
        p=m.predict_proba((te[X]-mu)/sd)[:,1]; res.append(pd.DataFrame(dict(season=s,p=p,y=te["cov"].values)))
    r=pd.concat(res); r["ok"]=(r.p>0.5)==(r.y==1); r["c"]=(r.p-.5).abs()
    l=r[r.season==2026]
    print(f"{nm}: 2026 live all {l.ok.mean()*100:.1f}% ({len(l)}); p>=56% {l[l.c>=.06].ok.mean()*100:.1f}% ({(l.c>=.06).sum()}); p>=58% {l[l.c>=.08].ok.mean()*100:.1f}% ({(l.c>=.08).sum()})"
          f" | 2014-25 all {r[r.season<2026].ok.mean()*100:.1f}%; p>=58 by era " + ", ".join(f"{r[(r.season>=a)&(r.season<=b)&(r.c>=.08)].ok.mean()*100:.1f} ({((r.season>=a)&(r.season<=b)&(r.c>=.08)).sum()})" for a,b in ((2014,2017),(2018,2021),(2022,2025))))
