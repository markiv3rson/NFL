#!/usr/bin/env python3
"""
prop_model.py -- player prop chances (10/17): passing / rushing / receiving yards, receptions, pass attempts, pass completions,
longest reception. For any Over/Under line it gives the chance of Over and Under.

How it works (nothing here uses a past prop price):
  1. One row per player-game from nflverse play-by-play (official-style stats) + snap counts (a player who played and got
     no touches counts as 0). A player who did not play is not a row -- Polymarket settles that as Under.
  2. Inputs known BEFORE the game: the player's average of the stat this season (blended with last season, 3 games' weight),
     his last-3 average, his usage (targets / carries / pass attempts a game), snap share (last game, last 3), the team's
     implied points (spread + total), the opponent's average allowed of that stat to that position, home.
  3. A boosted-tree model predicts the player's average for the game (one per stat).
  4. The chance of clearing a line comes from what really happened to the 2,000 player-games with the closest prediction
     in EARLIER seasons (each scaled to this player's prediction) -- an empirical spread, not a bell curve.
Walk-forward: a season is always predicted by models trained only on earlier seasons (tests: tests/prop_backtest.py).
"""
import os, threading, pickle, time
import numpy as np, pandas as pd
import td_prob

STATS = ["pass_yds", "pass_att", "pass_cmp", "rush_yds", "rec_yds", "rec", "long_rec"]
# Polymarket market type -> our stat
PM_TYPE = {"passing_yards": "pass_yds", "passing_attempts": "pass_att", "passing_completions": "pass_cmp", "rushing_yards": "rush_yds",
           "receiving_yards": "rec_yds", "receptions": "rec", "longest_reception": "long_rec"}
LABEL = {"pass_yds": "Passing yards", "pass_att": "Pass attempts", "pass_cmp": "Completions", "rush_yds": "Rushing yards",
         "rec_yds": "Receiving yards", "rec": "Receptions", "long_rec": "Longest reception"}
# who is modeled for each stat (the positions Polymarket lists)
POS_FOR = {"pass_yds": ("QB",), "pass_att": ("QB",), "pass_cmp": ("QB",), "rush_yds": ("QB", "RB"),
           "rec_yds": ("RB", "WR", "TE"), "rec": ("RB", "WR", "TE"), "long_rec": ("RB", "WR", "TE")}
FIRST_TRAIN = 2019          # first season with a full prior season of features (2018 pbp)
K_PRIOR = 3.0               # last season counts as 3 games
NEIGH = 2000                # player-games used to shape the chance of a line
CACHE = os.path.expanduser("~/.nfl_cache")
MODEL_DIR = os.environ.get("MODEL_DIR", "/data")   # the Railway volume (same place as the TD model), so a deploy keeps the built model
MODEL_FILE = os.path.join(MODEL_DIR if os.path.isdir(MODEL_DIR) else CACHE, "prop_model_v2.pkl")   # v2: vacated-usage inputs (10/17)


def _pos_map(season):
    r = td_prob.fetch_ros(season).sort_values("week")
    r = r.drop_duplicates("gsis_id", keep="last")
    pos = r.set_index("gsis_id").position.map(lambda v: {"FB": "RB", "HB": "RB"}.get(v, v))
    return pos, r


def stat_games(season):
    """Per player-game stats (regular season) + the game's closing lines. Played-but-no-touch players (snap counts) are 0 rows."""
    p = td_prob.fetch_pbp(season); p = p[(p.season_type == "REG") & (p.two_point_attempt.fillna(0) != 1)]
    games = p.drop_duplicates("game_id")[["game_id", "week", "home_team", "away_team", "spread_line", "total_line", "roof"]]
    pa = p[(p.pass_attempt == 1) & (p.sack.fillna(0) != 1) & p.passer_player_id.notna()]
    q = pa.groupby(["passer_player_id", "game_id", "posteam", "defteam"]).agg(
        pass_att=("pass_attempt", "size"), pass_cmp=("complete_pass", "sum"), pass_yds=("passing_yards", "sum")).reset_index()
    q.columns = ["pid", "game_id", "team", "opp", "pass_att", "pass_cmp", "pass_yds"]
    ru = p[(p.rush_attempt == 1) & p.rusher_player_id.notna()]
    r = ru.groupby(["rusher_player_id", "game_id", "posteam", "defteam"]).agg(car=("rush_attempt", "size"), rush_yds=("rushing_yards", "sum")).reset_index()
    r.columns = ["pid", "game_id", "team", "opp", "car", "rush_yds"]
    tg = p[(p.pass_attempt == 1) & (p.sack.fillna(0) != 1) & p.receiver_player_id.notna()]
    c = tg.assign(ry=np.where(tg.complete_pass == 1, tg.receiving_yards.fillna(0), np.nan))
    w = c.groupby(["receiver_player_id", "game_id", "posteam", "defteam"]).agg(
        tgt=("pass_attempt", "size"), rec=("complete_pass", "sum"), rec_yds=("ry", "sum"), long_rec=("ry", "max")).reset_index()
    w.columns = ["pid", "game_id", "team", "opp", "tgt", "rec", "rec_yds", "long_rec"]
    # 10/26 (owner: "find everything that's wrong"): the official stats -- what Polymarket settles on -- credit yards after a LATERAL to the player
    # who took the lateral (week 7 SF @ ATL: London 2 yds, lateral to Bi.Robinson +14 -> official 59, this 45), and nflverse keeps them in
    # lateral_receiving_yards / lateral_rushing_yards, not receiving_yards / rushing_yards. 9 laterals in weeks 1-7 (D.Samuel +80 in week 3 had no
    # target of his own, so he had no row at all); with them every weekly receiving / rushing yards total equals nflverse's official stats file.
    for lid, ly, col in (("lateral_receiver_player_id", "lateral_receiving_yards", "rec_yds"), ("lateral_rusher_player_id", "lateral_rushing_yards", "rush_yds")):
        if lid not in p.columns or ly not in p.columns: continue
        la = p[p[lid].notna() & p[ly].notna()]
        if not len(la): continue
        la = la.groupby([lid, "game_id", "posteam", "defteam"])[ly].sum().reset_index(); la.columns = ["pid", "game_id", "team", "opp", "lat"]
        tgt = w if col == "rec_yds" else r
        m = tgt.merge(la, on=["pid", "game_id", "team", "opp"], how="outer")
        m[col] = m[col].fillna(0.0) + m["lat"].fillna(0.0); m = m.drop(columns=["lat"])
        if col == "rec_yds": w = m
        else: r = m
    x = q.merge(r, on=["pid", "game_id", "team", "opp"], how="outer").merge(w, on=["pid", "game_id", "team", "opp"], how="outer")
    # players who played (snap counts) with no pass / rush / target: zero rows
    pos, ros = _pos_map(season)
    try:
        sn = td_prob.fetch_snap(season); sn = sn[(sn.game_type == "REG") & (sn.offense_snaps > 0)]
        pf = ros.dropna(subset=["pfr_id"]).drop_duplicates("pfr_id").set_index("pfr_id").gsis_id
        sn = sn.assign(pid=sn.pfr_player_id.map(pf)).dropna(subset=["pid"])
        sn = sn[sn.pid.map(pos).isin(["QB", "RB", "WR", "TE"])]
        z = sn[["pid", "game_id", "team", "opponent", "offense_pct"]].rename(columns={"opponent": "opp", "offense_pct": "snap"})
        z["team"] = z.team.replace({"LAR": "LA"}); z["opp"] = z.opp.replace({"LAR": "LA"})
        x = x.merge(z, on=["pid", "game_id", "team", "opp"], how="outer")
    except Exception:
        x["snap"] = np.nan
    for col in ["pass_att", "pass_cmp", "pass_yds", "car", "rush_yds", "tgt", "rec", "rec_yds", "long_rec"]:
        x[col] = x[col].fillna(0.0)
    x = x.merge(games, on="game_id")
    x["home"] = (x.team == x.home_team).astype(int)
    x["season"] = season
    x["pos"] = x.pid.map(pos)
    x = x[x.pos.isin(["QB", "RB", "WR", "TE"])]
    x["imp"] = np.where(x.home == 1, x.total_line / 2 + x.spread_line / 2, x.total_line / 2 - x.spread_line / 2)
    x["tm_margin"] = np.where(x.home == 1, x.spread_line, -x.spread_line)
    x["dome"] = x.roof.isin(["dome", "closed"]).astype(int)
    return x.drop(columns=["roof"]).reset_index(drop=True)


def _feat_season(x, prior):
    """Inputs known before each game (season-to-date strictly before this week, blended with last season)."""
    cols = STATS + ["tgt", "car"]
    x = x.sort_values(["pid", "week"]).copy()
    g = x.groupby("pid")
    cum = g[cols].cumsum() - x[cols]
    x["gp"] = g.cumcount()
    pr = prior.groupby("pid")[cols].mean() if prior is not None and len(prior) else pd.DataFrame(columns=cols)
    pr_n = prior.groupby("pid").size() if prior is not None and len(prior) else pd.Series(dtype=float)
    for ccol in cols:
        pm = x.pid.map(pr[ccol]) if ccol in pr else pd.Series(np.nan, index=x.index)
        has = pm.notna().astype(float)
        x["b_" + ccol] = (cum[ccol] + K_PRIOR * pm.fillna(0)) / (x.gp + K_PRIOR * has).replace(0, np.nan)
        x["l3_" + ccol] = g[ccol].transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    x["prior_g"] = x.pid.map(pr_n).fillna(0)
    x["snap1"] = g.snap.shift(1); x["snap3"] = g.snap.transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
    # team pass attempts a game so far (pace / pass volume) and the player's share of targets / carries
    tm = x.drop_duplicates(["team", "game_id"])[["team", "game_id", "week"]]
    tt = x.groupby(["team", "game_id"]).agg(t_att=("pass_att", "sum"), t_car=("car", "sum"), t_tgt=("tgt", "sum")).reset_index()
    tm = tm.merge(tt, on=["team", "game_id"]).sort_values(["team", "week"])
    for ccol in ["t_att", "t_car", "t_tgt"]:
        tm["b_" + ccol] = tm.groupby("team")[ccol].transform(lambda s: s.shift(1).expanding().mean())
    x = x.merge(tm[["team", "game_id", "b_t_att", "b_t_car", "b_t_tgt"]], on=["team", "game_id"], how="left")
    x["tgt_sh"] = x.b_tgt / x.b_t_tgt.replace(0, np.nan); x["car_sh"] = x.b_car / x.b_t_car.replace(0, np.nan)
    # opponent allowed per game of each stat to this position group (season to date, shrunk 4 games toward the league mean)
    al = x.groupby(["opp", "game_id", "week", "pos"])[STATS].sum().reset_index().sort_values(["opp", "pos", "week"])
    gg = al.groupby(["opp", "pos"])
    lg = al.groupby("pos")[STATS].mean()
    al["d_g"] = gg.cumcount()
    for s in STATS:
        prev = gg[s].cumsum() - al[s]
        al["o_" + s] = (prev + 4 * al.pos.map(lg[s])) / (al.d_g + 4)
    x = x.merge(al[["opp", "game_id", "pos"] + ["o_" + s for s in STATS]], on=["opp", "game_id", "pos"], how="left")
    return _vacated(x)


def _vacated(x):
    """10/17 (owner: injury input): targets / carries a game of the team's regulars (4+ targets or 8+ carries a game) who played one of the
    team's last 2 games but not this one -- injured or inactive. The model alone missed it: when a top target sat, his teammates beat the
    prediction every season 2020-25 (receiving yards +1.3 to +4.5). Live, the Out / Doubtful list removes those players (live_rows)."""
    tg = x[["team", "game_id", "week", "season"]].drop_duplicates(["team", "game_id"]).sort_values(["team", "season", "week"])
    tg["k"] = tg.groupby(["team", "season"]).cumcount()
    x = x.drop(columns=[c for c in ("vac_tgt", "vac_car", "k") if c in x]).merge(tg[["team", "game_id", "k"]], on=["team", "game_id"], how="left")
    R = x[["season", "team", "k", "pid", "b_tgt", "b_car"]]
    reg = R[(R.b_tgt.fillna(0) >= 4) | (R.b_car.fillna(0) >= 8)]
    prev = pd.concat([reg.assign(k=reg.k + lag, lag=lag) for lag in (1, 2)]).sort_values("lag").drop_duplicates(["season", "team", "k", "pid"])
    here = R[["season", "team", "k", "pid"]].assign(here=1)
    gone = prev.merge(here, on=["season", "team", "k", "pid"], how="left")
    gone = gone[gone.here.isna()]
    gone = gone.assign(vt=np.where(gone.b_tgt.fillna(0) >= 4, gone.b_tgt.fillna(0), 0.0), vc=np.where(gone.b_car.fillna(0) >= 8, gone.b_car.fillna(0), 0.0))
    v = gone.groupby(["season", "team", "k"]).agg(vac_tgt=("vt", "sum"), vac_car=("vc", "sum")).reset_index()
    x = x.merge(v, on=["season", "team", "k"], how="left")
    x["vac_tgt"] = x.vac_tgt.fillna(0.0); x["vac_car"] = x.vac_car.fillna(0.0)
    return x.drop(columns=["k"])


FEATS_COMMON = ["imp", "tm_margin", "total_line", "home", "dome", "gp", "prior_g", "snap1", "snap3", "b_tgt", "b_car", "l3_tgt", "l3_car",
                "tgt_sh", "car_sh", "b_t_att", "b_pass_att", "l3_pass_att", "vac_tgt", "vac_car"]


def feats_for(stat):
    extra = ["b_" + stat, "l3_" + stat, "o_" + stat]
    if stat == "long_rec": extra += ["b_rec_yds", "b_rec", "o_rec_yds"]
    if stat in ("pass_yds", "pass_cmp"): extra += ["b_pass_cmp", "b_pass_yds", "o_pass_yds"]
    if stat == "rec_yds": extra += ["b_rec", "o_rec"]
    if stat == "rec": extra += ["b_rec_yds"]
    return FEATS_COMMON + [f for f in extra if f not in FEATS_COMMON]


_TABLE = {}
def table(seasons):
    """Feature table for the given seasons (cached per season in memory)."""
    out = []
    for s in seasons:
        if s not in _TABLE or s == td_prob.CUR:
            x = stat_games(s)
            try: prior = stat_games(s - 1)
            except Exception: prior = None
            _TABLE[s] = _feat_season(x, prior)
        out.append(_TABLE[s])
    return pd.concat(out, ignore_index=True)


def eligible(df, stat):
    """The player-games modeled for a stat: right position and some history (at least 1 game this season or last season)."""
    m = df.pos.isin(POS_FOR[stat]) & ((df.gp > 0) | (df.prior_g > 0))
    if stat in ("pass_yds", "pass_att", "pass_cmp"): m &= df.b_pass_att.fillna(0) >= 15    # starters / regular passers
    if stat == "rush_yds": m &= (df.b_car.fillna(0) >= (3 if True else 0))
    if stat in ("rec_yds", "rec", "long_rec"): m &= df.b_tgt.fillna(0) >= 1.5
    return df[m]


def _fit(train, stat):
    from sklearn.ensemble import HistGradientBoostingRegressor
    f = feats_for(stat)
    m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_depth=4, min_samples_leaf=60, l2_regularization=1.0, random_state=0)
    m.fit(train[f].astype(float).values, train[stat].astype(float).values)
    return m


def predict_mu(model, df, stat):
    return np.maximum(model.predict(df[feats_for(stat)].astype(float).values), 0.1)


class Spread:
    """Chance a player-game clears a line: the NEIGH earlier player-games with the closest predicted average, each outcome scaled
    to this prediction (outcome x mu / mu_i). Built only from out-of-sample predictions."""
    def __init__(self, mu, y):
        o = np.argsort(mu); self.mu = np.asarray(mu, float)[o]; self.y = np.asarray(y, float)[o]
    def over(self, mu, line):
        mu = np.atleast_1d(np.asarray(mu, float)); line = np.broadcast_to(np.asarray(line, float), mu.shape)
        out = np.empty(mu.shape)
        n = len(self.mu); h = min(NEIGH, n) // 2
        idx = np.searchsorted(self.mu, mu)
        for i, (m, L, k) in enumerate(zip(mu, line, idx)):
            lo = max(0, min(k - h, n - 2 * h)); hi = lo + 2 * h
            sc = self.y[lo:hi] * (m / self.mu[lo:hi])
            out[i] = float(np.mean(sc > L))
        return out


def walk_forward(test_seasons, stats=STATS, log=print):
    """Out-of-sample predictions: season s is predicted by models trained on FIRST_TRAIN..s-1; its chance spread uses only the
    out-of-sample predictions of the seasons before it. Returns {stat: DataFrame with mu and the spread used}."""
    allseas = list(range(FIRST_TRAIN, max(test_seasons) + 1))
    T = table(allseas)
    res = {}
    for stat in stats:
        E = eligible(T, stat)
        oof = []
        for s in allseas[1:]:
            tr = E[E.season < s]; te = E[E.season == s].copy()
            if not len(te) or not len(tr): continue
            te["mu"] = predict_mu(_fit(tr, stat), te, stat)
            oof.append(te)
        O = pd.concat(oof, ignore_index=True)
        O["spread_from"] = O.season   # spread for season s = OOF rows of seasons < s
        res[stat] = O
        log(f"[props] {stat}: {len(O)} out-of-sample player-games")
    return res


def chance_table(O, s):
    """The Spread for season s (earlier seasons' out-of-sample rows)."""
    prev = O[O.season < s]
    return Spread(prev.mu.values, prev[O.columns[O.columns.get_loc('mu') - 0]].values) if False else None


# ---------------- live ----------------
_LOCK = threading.Lock()
_LIVE = {"built": None, "models": None, "spreads": None, "season": None}


def build_live(season=None, log=print):
    """Fit one model per stat on every season through last season plus this season's played weeks; the chance spread uses every
    out-of-sample prediction (walk-forward). Saved to disk; rebuilt weekly (scheduler) or when missing."""
    season = season or td_prob.CUR
    seas = list(range(FIRST_TRAIN, season + 1))
    T = table(seas)
    models, spreads, info = {}, {}, {}
    for stat in STATS:
        E = eligible(T, stat)
        oof = []
        for s in seas[1:]:
            tr = E[E.season < s]; te = E[E.season == s].copy()
            if not len(te) or not len(tr): continue
            te["mu"] = predict_mu(_fit(tr, stat), te, stat); oof.append(te)
        O = pd.concat(oof, ignore_index=True)
        models[stat] = _fit(E, stat)
        spreads[stat] = (O.mu.values.astype(np.float32), O[stat].values.astype(np.float32))
        info[stat] = {"train": int(len(E)), "oof": int(len(O))}
    obj = {"built": time.time(), "season": season, "models": models, "spreads": spreads, "info": info}
    os.makedirs(os.path.dirname(MODEL_FILE), exist_ok=True)
    with open(MODEL_FILE, "wb") as f: pickle.dump(obj, f)
    with _LOCK: _LIVE.update(obj)
    log(f"[props] built {season}: {info}")
    return info


def load_live():
    with _LOCK:
        if _LIVE["models"] is not None: return _LIVE
    try:
        with open(MODEL_FILE, "rb") as f: obj = pickle.load(f)
        with _LOCK: _LIVE.update(obj)
        return _LIVE
    except Exception:
        return None


_SG = {}
def _stat_games_cached(season, max_age=1800):
    """stat_games(season) reused for max_age seconds (a rerun asks for 28 teams at once; each call re-aggregated the whole season before)."""
    hit = _SG.get(season)
    if hit and (season < td_prob.CUR or time.time() - hit[0] < max_age): return hit[1]
    x = stat_games(season); _SG[season] = (time.time(), x); return x


def _names_now():
    _, ros = _pos_map(td_prob.CUR)
    return ros.set_index("gsis_id").full_name.map(td_prob._nn)


def live_rows_many(teams, outs_by_team=None):
    """This week's input row for every player of each team in `teams` = {team: (opp, imp, tm_margin, total, home)}, from his season so far
    + last season, in ONE feature pass. outs_by_team = {team: [full names Out / Doubtful]}: those players get no row, so the vacated-usage
    inputs (vac_tgt / vac_car) count them as missing and their teammates' numbers rise (10/17, owner: injury input)."""
    season = td_prob.CUR
    allp = _stat_games_cached(season); prior = None
    try: prior = _stat_games_cached(season - 1)
    except Exception: pass
    if not len(allp): return pd.DataFrame()
    nm = _names_now(); nxt_week = int(allp.week.max()) + 1; fakes = []
    for team, (opp, imp, tm_margin, total, home) in teams.items():
        cur = allp[allp.team == team]
        if not len(cur): continue
        last = cur.sort_values("week").groupby("pid").tail(1).copy()
        outs = {td_prob._nn(n) for n in (outs_by_team or {}).get(team, []) if n}
        if outs: last = last[~last.pid.map(nm).isin(outs)]
        fake = last[["pid", "team", "pos"]].copy()
        fake["opp"] = opp; fake["game_id"] = f"NEXT_{team}"; fake["week"] = nxt_week; fake["home"] = int(home); fake["season"] = season
        for col in STATS + ["tgt", "car", "snap"]: fake[col] = np.nan if col == "snap" else 0.0
        fake["home_team"] = team if home else opp; fake["away_team"] = opp if home else team
        fake["spread_line"] = tm_margin if home else -tm_margin; fake["total_line"] = total
        fake["imp"] = imp; fake["tm_margin"] = tm_margin; fake["dome"] = 0
        fakes.append(fake)
    if not fakes: return pd.DataFrame()
    both = pd.concat([allp] + fakes, ignore_index=True)
    F = _feat_season(both, prior)
    F = F[F.game_id.str.startswith("NEXT_")]
    return F.assign(nn=F.pid.map(nm))


def live_rows(team, opp, imp, tm_margin, total, home, outs=()):
    return live_rows_many({team: (opp, imp, tm_margin, total, home)}, {team: list(outs)})


def chances_many(games):
    """games: [{"away", "home", "spread" (away spread: home favored = positive), "total", "outs": [names], "lines": [{"name", "stat", "line"}]}]
    -> [{"game", "rows": [{name, team, stat, line, mu, over, under}]}]. An Out / Doubtful player's own lines are skipped (he is not playing)."""
    L = load_live()
    if not L or not L.get("models"): return []
    teams, outs_by = {}, {}
    for g in games:
        a, h, sp, tot = g["away"], g["home"], float(g["spread"]), float(g["total"])
        teams[a] = (h, tot / 2 - sp / 2, -sp, tot, 0); teams[h] = (a, tot / 2 + sp / 2, sp, tot, 1)
        outs_by[a] = outs_by[h] = list(g.get("outs") or [])
    rows = live_rows_many(teams, outs_by)
    out = []
    for g in games:
        res = []
        if len(rows):
            mine = rows[rows.team.isin([g["away"], g["home"]])]
            outs = {td_prob._nn(n) for n in (g.get("outs") or [])}
            for ln in g.get("lines") or []:
                stat = ln.get("stat"); nn = td_prob._nn(ln.get("name", ""))
                if stat not in L["models"] or nn in outs: continue
                r = mine[mine.nn == nn]
                if len(r) != 1: continue
                mu = float(predict_mu(L["models"][stat], r, stat)[0])
                po = float(Spread(*L["spreads"][stat]).over([mu], [float(ln["line"])])[0])
                res.append({"name": ln.get("name"), "team": str(r.team.iloc[0]), "stat": stat, "line": float(ln["line"]), "mu": round(mu, 1), "over": round(po, 4), "under": round(1 - po, 4)})
        out.append({"game": f"{g['away']} @ {g['home']}", "rows": res})
    return out


def _active_pids(teams):
    """10/21 review: the research's team sums (scratchpad stack/build.py) add up the players who actually PLAYED each game; live_rows_many keeps a
    row for every player who appeared for the team this season, so injured-reserve / benched / cut players and backup quarterbacks were summed
    too (week 7: 1.54 passers and 8.25 receivers a team live vs 1.03 and 6.87 in the research; Barkley, B.Hall, Achane, Rice ... last played weeks
    ago). The live universe is now the players who played the team's most recent game (minus this week's Out list), the closest pre-game match."""
    allp = _stat_games_cached(td_prob.CUR)
    if not len(allp): return {}
    out = {}
    for t in teams:
        cur = allp[allp.team == t]
        if len(cur): out[t] = set(cur[cur.week == cur.week.max()].pid)
    return out


# 10/22: version of the team-yards sums -- 2 = only players who played the team's last game (the 10/21 fix). The site lets STACK name a
# PICK only from v2 yards (lib/cardpick.js), so the old sums (inactive players and backup QBs counted) never make a pick.
TEAM_YARDS_V = 2

def team_yards(games):
    """STACK shadow inputs (10/21): each team's expected yards this week from the prop model -- the same player universe as the research's
    walk-forward sums (eligible() per stat): py = passing + rushing yards of the team's modeled players, rec = receiving yards.
    games: [{"away", "home", "spread" (away spread: home favored = positive), "total", "outs": [names]}] -> [{"game", "home": {"py", "rec", "n"}, "away": {...}}]."""
    L = load_live()
    if not L or not L.get("models"): return []
    teams, outs_by = {}, {}
    for g in games:
        a, h, sp, tot = g["away"], g["home"], float(g["spread"]), float(g["total"])
        teams[a] = (h, tot / 2 - sp / 2, -sp, tot, 0); teams[h] = (a, tot / 2 + sp / 2, sp, tot, 1)
        outs_by[a] = outs_by[h] = list(g.get("outs") or [])
    rows = live_rows_many(teams, outs_by)
    act = _active_pids(set(teams))
    out = []
    for g in games:
        res = {"game": f"{g['away']} @ {g['home']}"}
        for side in ("away", "home"):
            t = g[side]; r = rows[rows.team == t] if len(rows) else rows; py = 0.0; rec = 0.0; n = 0
            if len(r) and t in act: r = r[r.pid.isin(act[t])]   # 10/21 review: only players who played the team's last game (see _active_pids)
            for stat in ("pass_yds", "rush_yds", "rec_yds"):
                if stat not in L["models"] or not len(r): continue
                e = eligible(r, stat)
                if not len(e): continue
                mu = float(np.sum(predict_mu(L["models"][stat], e, stat))); n += int(len(e))
                if stat == "rec_yds": rec += mu
                else: py += mu
            res[side] = {"py": round(py, 1), "rec": round(rec, 1), "n": n}
        out.append(res)
    return out


def chances(team, opp, imp, tm_margin, total, home, lines, outs=()):
    """One team (kept for the research scripts): lines [{"name", "stat", "line"}] -> each with "over" / "under" chance (0-1) and "mu"."""
    L = load_live()
    if not L or not L.get("models"): return []
    rows = live_rows(team, opp, imp, tm_margin, total, home, outs)
    if not len(rows): return []
    out = []
    for ln in lines:
        stat = ln.get("stat")
        if stat not in L["models"]: continue
        r = rows[rows.nn == td_prob._nn(ln.get("name", ""))]
        if len(r) != 1: continue
        mu = float(predict_mu(L["models"][stat], r, stat)[0])
        po = float(Spread(*L["spreads"][stat]).over([mu], [float(ln["line"])])[0])
        out.append({**ln, "mu": round(mu, 1), "over": round(po, 4), "under": round(1 - po, 4)})
    return out


def week_stats(season, week):
    """Official stats of one finished week for grading: { "AWAY @ HOME": { "<normalized full name>": { pass_yds, ..., long_rec, rush_att, pass_td, atd } } }.
    A player who did not play has no entry (Polymarket settles that as Under).
    10/29: + rush_att (carries, kneel-downs included as in the official stats: 99.9% of 2026 player-weeks equal nflverse's carries), pass_td
    (the passer's TD passes) and atd (rushing, receiving and special-teams return TDs by the player who crossed the goal line, defensive TDs out --
    the /td-scorers rule the Anytime TD grading uses); a player whose only line is a return TD gets a row of his own."""
    x = _stat_games_cached(season); x = x[x.week == int(week)]
    nm = _names_now(); out = {}
    for r in x.itertuples():
        n = nm.get(r.pid)
        if not n: continue
        key = f"{r.away_team} @ {r.home_team}"
        out.setdefault(key, {})[n] = {**{s: float(getattr(r, s)) for s in STATS}, "rush_att": float(r.car), "pass_td": 0.0, "atd": 0.0}
    p = td_prob.fetch_pbp(season); p = p[(p.season_type == "REG") & (p.week == int(week)) & (p.two_point_attempt.fillna(0) != 1)]
    keys = p.drop_duplicates("game_id").set_index("game_id").apply(lambda g: f"{g.away_team} @ {g.home_team}", axis=1).to_dict()
    zero = {**{s: 0.0 for s in STATS}, "rush_att": 0.0, "pass_td": 0.0, "atd": 0.0}
    pt = p[(p.pass_touchdown == 1) & p.passer_player_id.notna()].groupby(["game_id", "passer_player_id"]).size()
    t = p[(p.touchdown == 1) & p.td_player_id.notna()]
    t = t[~((t.td_team != t.posteam) & t.play_type.isin(["pass", "run", "qb_kneel", "qb_spike", "no_play"]))]
    for col, ser in (("pass_td", pt), ("atd", t.groupby(["game_id", "td_player_id"]).size())):
        for (gid, pid), v in ser.items():
            n = nm.get(pid); key = keys.get(gid)
            if not n or not key: continue
            out.setdefault(key, {}).setdefault(n, dict(zero))[col] = float(v)
    return out


def week_snaps(season, week):
    """10/23: every player who took at least one snap (offense, defense or special teams) in each game of the week, from nflverse snap counts:
    { "AWAY @ HOME": [<normalized full name>, ...] }. Polymarket settles a player prop of a player who took no snap at the last fair price
    (not Under), so the site grades him a push; a game missing here = snap counts not posted yet (the site waits)."""
    sn = td_prob.fetch_snap(season); sn = sn[(sn.game_type == "REG") & (sn.week == int(week))]
    if not len(sn): return {}
    _, ros = _pos_map(season); pf = ros.dropna(subset=["pfr_id"]).drop_duplicates("pfr_id").set_index("pfr_id").gsis_id; nm = _names_now()
    snaps = sn[["offense_snaps", "defense_snaps", "st_snaps"]].fillna(0).sum(axis=1); sn = sn[snaps > 0]
    g = td_prob.fetch_pbp(season); g = g[g.week == int(week)].drop_duplicates("game_id").set_index("game_id")
    out = {}
    for r in sn.itertuples():
        if r.game_id not in g.index: continue
        gid = g.loc[r.game_id]; key = f"{gid.away_team} @ {gid.home_team}"
        pid = pf.get(r.pfr_player_id); n = nm.get(pid) if pid is not None else None
        out.setdefault(key, set()).add(n or td_prob._nn(r.player))
    return {k: sorted(v) for k, v in out.items()}
