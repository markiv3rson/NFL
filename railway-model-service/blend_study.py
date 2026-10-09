# Second-model check (10/9): gradient-boosted TD model blended 50/50 with the live logistic one, before and after the team
# TD total step (team_budget), with and without the extra signals. Walk-forward 2021-25. Run: python3 blend_study.py
import sys, io, contextlib, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
sys.path.insert(0, '/home/user/NFL/railway-model-service')
with contextlib.redirect_stdout(io.StringIO()):
    import idea_study as I
import td_prob as T
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
def budget(f, p):
    out = np.array(p, dtype=float)
    for _, ix in f.groupby(['game_id', 'team']).indices.items(): out[ix] = T.team_budget(out[ix], float(f.imp.iloc[ix[0]]))
    return out
allx = sum(I.IDEAS.values(), [])
R = {k: [] for k in ['logit', 'logit+budget', 'blend base feats', 'blend base+budget', 'blend all feats', 'blend all+budget', 'gb alone+budget', 'blend 30/70+budget']}
for t in range(2021, 2026):
    tr = pd.concat([I.feat(s) for s in (t - 3, t - 2, t - 1)]); te = I.feat(t).reset_index(drop=True); w = T.recency_weight(tr); y = te.scored.values
    lg = LogisticRegression(C=1.0, max_iter=3000).fit(I.X(tr, []), tr.scored, sample_weight=w).predict_proba(I.X(te, []))[:, 1]
    g0 = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, min_samples_leaf=200).fit(I.X(tr, []), tr.scored, sample_weight=w).predict_proba(I.X(te, []))[:, 1]
    g1 = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, min_samples_leaf=200).fit(I.X(tr, allx), tr.scored, sample_weight=w).predict_proba(I.X(te, allx))[:, 1]
    br = lambda p: float(np.mean((p - y) ** 2))
    R['logit'].append(br(lg)); R['logit+budget'].append(br(budget(te, lg)))
    R['blend base feats'].append(br((lg + g0) / 2)); R['blend base+budget'].append(br(budget(te, (lg + g0) / 2)))
    R['blend all feats'].append(br((lg + g1) / 2)); R['blend all+budget'].append(br(budget(te, (lg + g1) / 2)))
    R['gb alone+budget'].append(br(budget(te, g0))); R['blend 30/70+budget'].append(br(budget(te, 0.3 * lg + 0.7 * g0)))
    print(t, flush=True)
b = np.array(R['logit+budget'])
for k, v in R.items(): v = np.array(v); print(f"{k:22s} {v.mean():.5f} vs live {v.mean() - b.mean():+.5f} better {(v < b).sum()}/5")
