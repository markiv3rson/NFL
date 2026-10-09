# Which extra inputs the second TD model needs (10/9). Walk-forward 2021-25, 50/50 blend with the logistic model, after team_budget.
import sys, io, contextlib, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
sys.path.insert(0, '/home/user/NFL/railway-model-service')
with contextlib.redirect_stdout(io.StringIO()):
    import blend_study as B
I, T = B.I, B.T
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
SETS = {'all': sum(I.IDEAS.values(), []),
        'live-easy': ['snap_trend', 'gl_spec', 'rzd', 'glrun_rb', 'glrun_rec', 'after2', 'noprior', 'rook_late', 'vs_old', 'rematch', 'bigfav_bench', 'bigdog_bench', 'short', 'short_bench', 'prime'],
        'core5': ['rzd', 'glrun_rb', 'glrun_rec', 'snap_trend', 'gl_spec']}
R = {k: [] for k in ['live', *SETS]}
for t in range(2021, 2026):
    tr = pd.concat([I.feat(s) for s in (t - 3, t - 2, t - 1)]); te = I.feat(t).reset_index(drop=True); w = T.recency_weight(tr); y = te.scored.values
    lg = LogisticRegression(C=1.0, max_iter=3000).fit(I.X(tr, []), tr.scored, sample_weight=w).predict_proba(I.X(te, []))[:, 1]
    br = lambda p: float(np.mean((B.budget(te, p) - y) ** 2)); R['live'].append(br(lg))
    for k, ex in SETS.items():
        g = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, min_samples_leaf=200, random_state=0).fit(I.X(tr, ex), tr.scored, sample_weight=w).predict_proba(I.X(te, ex))[:, 1]
        R[k].append(br((lg + g) / 2))
    print(t, flush=True)
b = np.array(R['live'])
for k, v in R.items(): v = np.array(v); print(f"{k:10s} {v.mean():.5f} vs live {v.mean() - b.mean():+.5f} better {(v < b).sum()}/5")
