# Idea study (10/9): the user's brainstorm list, tested on the TD model walk-forward (train 3 seasons, test the next, 2021-25).
# Each signal is added alone to the live recipe; kept only if it lowers the Brier score in at least 4 of 5 seasons.
# Run: python3 idea_study.py
import sys, numpy as np, pandas as pd, warnings; warnings.filterwarnings('ignore')
sys.path.insert(0, '/home/user/NFL/railway-model-service')
import td_prob as T
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
G = pd.read_csv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv")
G = G[G.game_type == 'REG'][['game_id', 'season', 'week', 'home_team', 'away_team', 'home_rest', 'away_rest', 'gametime', 'weekday', 'temp', 'roof', 'home_coach', 'away_coach', 'home_qb_id', 'away_qb_id']]
PB = {}
def pbp(s):
    if s not in PB:
        p = T.fetch_pbp(s); PB[s] = p[p.season_type == 'REG']
    return PB[s]
def extra(f, s):
    f = f.copy(); g = G[G.season == s].set_index('game_id')
    home = f.team == f.home_team
    f['rest'] = np.where(home, f.game_id.map(g.home_rest), f.game_id.map(g.away_rest))
    f['short'] = (f.rest <= 5).astype(float)
    f['nonstart'] = 1 - f.depth1
    f['short_bench'] = f.short * f.nonstart                      # 18 short week -> backups
    gt = f.game_id.map(g.gametime).fillna('13:00')
    f['prime'] = (gt >= '19:00').astype(float)                     # 25 kickoff slot
    f['intl'] = 0.0
    tmp = f.game_id.map(g.temp); roof = f.game_id.map(g.roof).fillna('')
    f['cold'] = ((tmp <= 35) & roof.isin(['outdoors', 'open'])).astype(float)
    f['is_rb'] = (f.pos == 'RB').astype(float); f['is_te'] = (f.pos == 'TE').astype(float)
    f['cold_rb'] = f.cold * f.is_rb; f['cold_te'] = f.cold * f.is_te   # 11 weather
    teamm = np.where(home, f.spread_line, -f.spread_line)
    f['bigfav_bench'] = ((teamm >= 7) * f.nonstart).astype(float)       # 7 garbage time
    f['bigdog_bench'] = ((teamm <= -7) * f.nonstart).astype(float)
    # 8 rematch: second time these two teams meet this season
    pair = f[['game_id', 'week', 'team', 'opp']].drop_duplicates('game_id')
    key = pair.apply(lambda r: '|'.join(sorted([r.team, r.opp])), axis=1)
    first = pd.Series(pair.week.values, index=key.values).groupby(level=0).min()
    f['rematch'] = (f.week > f.team.combine(f.opp, lambda a, b: '|'.join(sorted([a, b]))).map(first)).astype(float)
    # 8b facing his old team
    prior, _, _, _ = T.player_games(s - 1)
    pt = prior.groupby('pid').team.agg(lambda x: x.mode().iloc[0])
    f['vs_old'] = (f.pid.map(pt) == f.opp).astype(float)
    # 12 team goal-line run rate to date (inside the 5)
    p = pbp(s); gl = p[(p.yardline_100 <= 5) & p.play_type.isin(['run', 'pass'])]
    t = gl.groupby(['posteam', 'game_id', 'week']).apply(lambda x: pd.Series({'r': (x.play_type == 'run').sum(), 'n': len(x)})).reset_index().sort_values(['posteam', 'week'])
    t['cr'] = t.groupby('posteam').r.cumsum() - t.r; t['cn'] = t.groupby('posteam').n.cumsum() - t.n
    t['glrun'] = (t.cr + 10 * 0.55) / (t.cn + 10)
    f = f.merge(t[['posteam', 'game_id', 'glrun']].rename(columns={'posteam': 'team'}), on=['team', 'game_id'], how='left')
    f['glrun'] = f.glrun.fillna(0.55); f['glrun_rb'] = (f.glrun - 0.55) * f.is_rb; f['glrun_rec'] = (f.glrun - 0.55) * (1 - f.is_rb)
    # 21 opponent red-zone TD rate allowed to date (TDs per red-zone play)
    rz = p[(p.yardline_100 <= 20) & p.play_type.isin(['run', 'pass'])]
    d = rz.groupby(['defteam', 'game_id', 'week']).apply(lambda x: pd.Series({'td': x.touchdown.sum(), 'n': len(x)})).reset_index().sort_values(['defteam', 'week'])
    d['ct'] = d.groupby('defteam').td.cumsum() - d.td; d['cn'] = d.groupby('defteam').n.cumsum() - d.n
    lg = rz.touchdown.mean(); d['rzd'] = (d.ct + 40 * lg) / (d.cn + 40) - lg
    f = f.merge(d[['defteam', 'game_id', 'rzd']].rename(columns={'defteam': 'opp'}), on=['opp', 'game_id'], how='left'); f['rzd'] = f.rzd.fillna(0)
    # 24 QB change: today's starter differs from the team's most-used starter so far
    qb = np.where(home, f.game_id.map(g.home_qb_id), f.game_id.map(g.away_qb_id)); f['qb_today'] = qb
    gq = pd.DataFrame({'team': np.r_[g.home_team.values, g.away_team.values], 'week': np.r_[g.week.values, g.week.values], 'qb': np.r_[g.home_qb_id.values, g.away_qb_id.values]}).sort_values('week')
    main = {}
    for tm, x in gq.groupby('team'):
        seen = {}
        for wk, q in zip(x.week, x.qb):
            main[(tm, wk)] = max(seen, key=seen.get) if seen else None; seen[q] = seen.get(q, 0) + 1
    mq = [main.get((tm, wk)) for tm, wk in zip(f.team, f.week)]
    f['qbchg'] = np.array([(m is not None and q != m) for m, q in zip(mq, qb)], dtype=float)
    f['qbchg_rec'] = f.qbchg * (1 - f.is_rb) * f.r_t                    # receivers' targets matter less with a new QB
    # 13 after a 2+ TD game
    pg, _, _, _ = T.player_games(s); pg = pg.sort_values(['pid', 'week']); pg['last_td'] = pg.groupby('pid').td.shift()
    f = f.merge(pg[['pid', 'game_id', 'last_td']], on=['pid', 'game_id'], how='left'); f['after2'] = (f.last_td >= 2).astype(float)
    # 23 rookies / no prior season, later in the season
    f['noprior'] = f.r_rzt.isna().astype(float) if False else (f.rz_pg.isna()).astype(float)
    f['rook_late'] = f.noprior * (f.week / 18)
    # 20 goal-line specialist: inside-5 carries relative to all carries
    f['gl_spec'] = f.r_i5 / (f.r_c + 1)
    # 16 snap trend
    f['snap_trend'] = f.snap1 - f.snap3
    return f
IDEAS = {'16 snap trend': ['snap_trend'], '18 short week bench': ['short', 'short_bench'], '25 prime time': ['prime'], '11 cold RB/TE': ['cold_rb', 'cold_te'],
         '7 garbage time': ['bigfav_bench', 'bigdog_bench'], '8 rematch': ['rematch'], '8b vs old team': ['vs_old'], '12 coach goal-line': ['glrun_rb', 'glrun_rec'],
         '21 red-zone defense': ['rzd'], '24 QB change': ['qbchg', 'qbchg_rec'], '13 after 2+ TDs': ['after2'], '23 rookie growth': ['noprior', 'rook_late'], '20 goal-line specialist': ['gl_spec']}
def X(f, ex): return np.column_stack([T.design(f)] + [f[c].fillna(0).values for c in ex]) if ex else T.design(f)
F = {}
def feat(s):
    if s not in F: F[s] = extra(T.features(s, T.pos).assign(season=s), s)
    return F[s]
res = {k: [] for k in ['base', *IDEAS, '14 second model (blend)', '32 blind-spot fix']}
for t in range(2021, 2026):
    tr = pd.concat([feat(s) for s in (t - 3, t - 2, t - 1)]); te = feat(t); w = T.recency_weight(tr)
    base = LogisticRegression(C=1.0, max_iter=3000).fit(X(tr, []), tr.scored, sample_weight=w); pb = base.predict_proba(X(te, []))[:, 1]
    res['base'].append(np.mean((pb - te.scored) ** 2))
    for k, ex in IDEAS.items():
        m = LogisticRegression(C=1.0, max_iter=3000).fit(X(tr, ex), tr.scored, sample_weight=w)
        res[k].append(np.mean((m.predict_proba(X(te, ex))[:, 1] - te.scored) ** 2))
    allx = sum(IDEAS.values(), [])
    gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, min_samples_leaf=200).fit(X(tr, allx), tr.scored, sample_weight=w)
    res['14 second model (blend)'].append(np.mean(((pb + gb.predict_proba(X(te, allx))[:, 1]) / 2 - te.scored) ** 2))
    # 32 blind spots: average miss by position x home x favored on training (out-of-fold via base fit), applied as a shift
    ptr = base.predict_proba(X(tr, []))[:, 1]
    seg = lambda f: f.pos + '|' + f.home.astype(str) + '|' + (np.where(f.team == f.home_team, f.spread_line, -f.spread_line) > 0).astype(str)
    adj = pd.Series(tr.scored.values - ptr).groupby(seg(tr).values).mean()
    res['32 blind-spot fix'].append(np.mean((np.clip(pb + seg(te).map(adj).fillna(0).values * 0.5, 0.001, 0.99) - te.scored) ** 2))
    print(t, 'done', flush=True)
b = np.array(res['base'])
for k, v in res.items():
    v = np.array(v); print(f"{k:28s} avg {v.mean():.5f}  vs base {v.mean() - b.mean():+.5f}  better {(v < b).sum()}/5")
