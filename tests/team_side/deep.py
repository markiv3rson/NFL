import pandas as pd, numpy as np, sys, warnings; warnings.filterwarnings("ignore")
from sklearn.linear_model import LogisticRegression
S=sys.argv[1]; D=pd.read_parquet(f"{S}/teamB/D.parquet")
feats=[c for c in D.columns if c.startswith("d_")]
def run(C, fs, label):
    res=[]
    for s in range(2014,2026):
        tr=D[(D.season<s)&(D["cov"]!=0.5)]; te=D[D.season==s]
        X=fs+["hline"]; mu=tr[X].mean(); sd=tr[X].std()+1e-9
        m=LogisticRegression(C=C,max_iter=3000).fit((tr[X]-mu)/sd, tr["cov"].astype(int))
        p=m.predict_proba((te[X]-mu)/sd)[:,1]
        res.append(pd.DataFrame(dict(season=s,week=te.week.values,p=p,y=te["cov"].values,hline=te.hline.values)))
    r=pd.concat(res); r=r[r.y!=0.5]; r["ok"]=(r.p>0.5)==(r.y==1); r["conf"]=(r.p-.5).abs()
    # threshold by fixed probability (usable live), not by within-season quantile
    out=[label]
    for th in (0.04,0.06,0.08,0.10):
        t=r[r.conf>=th]
        per=[t[(t.season>=a)&(t.season<=b)] for a,b in ((2014,2017),(2018,2021),(2022,2025))]
        out.append(f"p>={50+th*100:.0f}%: {t.ok.mean()*100:.1f} ({len(t)}) [{', '.join(f'{x.ok.mean()*100:.0f}' for x in per)}] seasons>50: {(t.groupby('season').ok.mean()>0.5).sum()}/{t.season.nunique()}")
    print("\n  ".join(out), flush=True); return r
r=run(0.05, feats, "ALL FEATURES C=0.05")
t=r[r.conf>=0.08]; side=np.where(t.p>0.5,1,-1); dog=np.where(side==1, t.hline>0, t.hline<0)
print("  confident picks: home side", (side==1).mean().round(2), "| underdog", dog.mean().round(2), "| weeks 1-4", (t.week<=4).mean().round(2))
run(0.05, ["d_s_win","d_s_cov","d_s_marg","d_srs"], "RECORD / COVERS / MARGIN / SRS only")
run(0.05, ["d_s_oepa","d_s_depa","d_s_osr","d_s_dsr","d_s_oypp","d_s_dypp","d_s_tom"], "PER-PLAY + TURNOVERS only")
run(0.05, [f for f in feats if f!="d_s_cov"], "ALL minus covers")
# coefficients on the full data
X=feats+["hline"]; tr=D[D["cov"]!=0.5]; mu=tr[X].mean(); sd=tr[X].std()
m=LogisticRegression(C=0.05,max_iter=3000).fit((tr[X]-mu)/sd, tr["cov"].astype(int))
print("coefficients (home covers):", ", ".join(f"{a}={b:+.3f}" for a,b in sorted(zip(X,m.coef_[0]),key=lambda z:-abs(z[1]))))
