#!/usr/bin/env python3
"""
season_sim.py — NBA only. Plays a whole season out on the computer thousands of times to put numbers on futures:
wins, make the play-in / playoffs, #1 seed, best / worst record, conference champion, champion.

  Team strength   = last-800-days ridge ratings (fair_line.Ratings), blended with last season's record (weights fitted on 2010-2026),
                    optionally plus a roster term (nba_roster.py) — each shrunk toward average, because the fitted weights < 1 say so.
  Season shock    = every simulated season gets a random strength error per team (SD fitted so the simulated spread of win totals
                    matches how far real seasons landed from the preseason prediction: ~9.8 wins, of which ~4.5 is plain luck).
  Games           = the real schedule (+2 Cup games per team the schedule file doesn't list yet), win chance from the rating gap and
                    home court (normal curve, 12.4-point game spread).
  Standings       = by wins, random tie-break (the NBA's real tie-breakers are not modelled — a gap, said on the page).
  Postseason      = 2021+ rules: seeds 1-6 straight in, 7-10 play-in (7v8, 9v10, loser of 7v8 vs winner of 9v10), best-of-7 series with
                    2-2-1-1-1 home court by seed, Finals home court by record.

Nothing here beats the market by design: the backtest (backtest()) says how good it really is, game by game of history.
Run:  python3 season_sim.py --backtest     (writes data/futures_calib.json + data/futures_report.json)
"""
import argparse, json, math, os, sys
import numpy as np, pandas as pd
from scipy.special import ndtr

import nba_data as nd, fair_line as fl, nba_roster as nr

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("MODEL_DIR", os.path.join(HERE, "data"))
SD_GAME = fl.SD_MARGIN                      # 12.4 points
WINS_PER_POINT = 82 * (1 / (SD_GAME * math.sqrt(2 * math.pi)))    # one point of rating = ~2.64 wins over 82 games

EAST = ["Atlanta Hawks", "Boston Celtics", "Brooklyn Nets", "Charlotte Hornets", "Chicago Bulls", "Cleveland Cavaliers", "Detroit Pistons",
        "Indiana Pacers", "Miami Heat", "Milwaukee Bucks", "New York Knicks", "Orlando Magic", "Philadelphia 76ers", "Toronto Raptors", "Washington Wizards"]
WEST = ["Dallas Mavericks", "Denver Nuggets", "Golden State Warriors", "Houston Rockets", "LA Clippers", "Los Angeles Lakers", "Memphis Grizzlies",
        "Minnesota Timberwolves", "New Orleans Pelicans", "Oklahoma City Thunder", "Phoenix Suns", "Portland Trail Blazers", "Sacramento Kings",
        "San Antonio Spurs", "Utah Jazz"]
TEAMS = EAST + WEST                          # index 0-14 East, 15-29 West
TIX = {t: i for i, t in enumerate(TEAMS)}
HOME_PATTERN = [1, 1, 0, 0, 1, 0, 1]         # 2-2-1-1-1: does the higher seed host game n


def _tix(name):
    return TIX.get(nd._norm(name))


# --------------------------------------------------------------------------------------------- strength
def net_points(R):
    """Team net rating in points per game (vs an average team on a neutral floor) from fair_line.Ratings."""
    return {t: (R.off[R.ix[t]] - R.dfn[R.ix[t]]) * (R.pmu / 100) for t in R.teams}


def expected_wins_from_ratings(net, games, hca):
    """Expected wins per team (scaled to 82 games) for a list of (home, away) games using ratings only (no shocks)."""
    w = {t: 0.0 for t in TEAMS}; n = {t: 0 for t in TEAMS}
    for h, a in games:
        if h not in net or a not in net or h not in w or a not in w:     # all-star games and the like are not in TEAMS
            continue
        p = float(ndtr((net[h] - net[a] + hca) / SD_GAME))
        w[h] += p; w[a] += 1 - p; n[h] += 1; n[a] += 1
    return {t: (w[t] / n[t] * 82 if n[t] else 41.0) for t in TEAMS}


def history_table(first=2010, last=None):
    """One row per team-season: ratings-only wins prediction (p82), last season's wins (prev82), actual wins (w82), games, season."""
    last = last or nd.current_season() - 1
    g = nd.games(); tg = nd.team_games()
    reg = g[g.season_type == 2]
    rows = []
    for S in range(first, last + 1):
        gs = reg[reg.season == S]
        if gs.empty:
            continue
        R = fl.Ratings(tg, gs.date.min())
        if not R.ok:
            continue
        net = net_points(R); hca = R.hca * R.pmu / 100
        pred = expected_wins_from_ratings(net, list(zip(gs.home.map(nd._norm), gs.away.map(nd._norm))), hca)
        w = {}; n = {}
        for r in gs.itertuples():
            if r.margin != r.margin:
                continue
            h, a = nd._norm(r.home), nd._norm(r.away)
            if h not in TIX or a not in TIX:
                continue
            w[h] = w.get(h, 0) + int(r.margin > 0); w[a] = w.get(a, 0) + int(r.margin < 0); n[h] = n.get(h, 0) + 1; n[a] = n.get(a, 0) + 1
        for t in w:
            rows.append(dict(season=S, team=t, games=n[t], w82=w[t] / n[t] * 82, p82=pred.get(t, 41.0)))
    d = pd.DataFrame(rows)
    prev = d[["season", "team", "w82"]].copy(); prev["season"] += 1
    d = d.merge(prev.rename(columns={"w82": "prev82"}), on=["season", "team"], how="left")
    try:
        d = d.merge(nr.returning_history(first, last), on=["season", "team"], how="left")     # minutes returning from last season (%)
    except Exception as e:
        print("[sim] returning minutes unavailable:", str(e)[:80], flush=True); d["ret"] = np.nan
    return d


def fit_blend(table, hold_out=None):
    """actual wins = a + b1*(ratings wins - 41) + b2*(last season's wins - 41) + b3*(returning minutes % - average).
    Short seasons (2012 / 2021) are kept: wins are per 82. hold_out = a season left out of the fit (for an honest backtest)."""
    x = table.dropna(subset=["prev82"])
    x = x[x.games >= 60]
    if hold_out is not None:
        x = x[x.season != hold_out]
    ret = x.ret if "ret" in x.columns else pd.Series(np.nan, index=x.index)
    ret_mean = float(ret.mean()) if ret.notna().any() else 0.0
    A = np.vstack([np.ones(len(x)), x.p82 - 41, x.prev82 - 41, ret.fillna(ret_mean) - ret_mean]).T
    c, *_ = np.linalg.lstsq(A, x.w82.values, rcond=None)
    res = x.w82.values - A @ c
    A0 = A[:, :3]; c0, *_ = np.linalg.lstsq(A0, x.w82.values, rcond=None); res0 = x.w82.values - A0 @ c0
    return {"icpt": float(c[0]), "b_ratings": float(c[1]), "b_prev": float(c[2]), "b_ret": float(c[3]), "ret_mean": ret_mean,
            "resid_sd": float(res.std()), "resid_sd_without_roster": float(res0.std()), "n": int(len(x))}


def blended_wins(p82, prev82, calib, ret=None):
    prev = p82 if (prev82 is None or (isinstance(prev82, float) and prev82 != prev82)) else prev82
    r = calib["b_ret"] * (ret - calib["ret_mean"]) if (ret is not None and ret == ret and calib.get("b_ret") is not None) else 0.0
    return calib["icpt"] + calib["b_ratings"] * (p82 - 41) + calib["b_prev"] * (prev - 41) + r


def shock_points(resid_sd, luck_sd=math.sqrt(82 * 0.25)):
    """Season-long strength error (points) so that luck (~4.5 wins) + this error reproduce the real spread of wins around a preseason prediction."""
    return math.sqrt(max(resid_sd ** 2 - luck_sd ** 2, 0.0)) / WINS_PER_POINT


# --------------------------------------------------------------------------------------------- the simulation
def _series(rng, s, hi, lo, hca):
    """Best-of-7, higher seed hosts games 1,2,5,7. hi / lo = team index arrays (n,). s = strengths (n_sims, 30). Returns winner index array."""
    n = len(hi); ar = np.arange(n)
    sh, sl = s[ar, hi], s[ar, lo]
    wh = np.zeros(n, int); wl = np.zeros(n, int)
    for host_high in HOME_PATTERN:
        live = (wh < 4) & (wl < 4)
        p_high = ndtr((sh - sl + (hca if host_high else -hca)) / SD_GAME)
        hit = rng.random(n) < p_high
        wh += (live & hit); wl += (live & ~hit)
    return np.where(wh >= 4, hi, lo)


def _game(rng, s, home, away, hca):
    ar = np.arange(len(home))
    return rng.random(len(home)) < ndtr((s[ar, home] - s[ar, away] + hca) / SD_GAME)


def simulate(strength, games, hca, shock_pts, n=10000, play_in=True, seed=7, chunk=2500, line_events=None):
    """strength: array(30) of expected net points (index = TEAMS). games: list of (home_idx, away_idx) incl. extra Cup games.
    Returns dict of per-team arrays (30,) of probabilities / means plus the win-total samples (n, 30)."""
    rng = np.random.default_rng(seed)
    H = np.array([g[0] for g in games]); A = np.array([g[1] for g in games])
    out = {k: np.zeros(30) for k in ("play_in", "playoffs", "top6", "seed1", "best", "worst", "r2", "conf_finals", "finals", "champion", "conf_champion")}
    wins_all = np.zeros((0, 30), np.int16)
    done = 0
    while done < n:
        m = min(chunk, n - done); done += m
        s = strength[None, :] + rng.normal(0.0, shock_pts, size=(m, 30))
        p = ndtr((s[:, H] - s[:, A] + hca) / SD_GAME)
        hw = rng.random((m, len(H))) < p
        W = np.zeros((m, 30), np.int16)
        for t in range(30):
            W[:, t] = hw[:, H == t].sum(1) + (~hw[:, A == t]).sum(1)
        wins_all = np.vstack([wins_all, W])
        key = W + rng.random(W.shape) * 0.5                     # random tie-break
        ar = np.arange(m)
        seeds = {}
        for c, cols in (("E", np.arange(0, 15)), ("W", np.arange(15, 30))):
            order = cols[np.argsort(-key[:, cols], axis=1)]       # (m, 15) team index by seed
            seeds[c] = order
            np.add.at(out["seed1"], order[:, 0], 1)
            np.add.at(out["top6"], order[:, :6].ravel(), 1)
        np.add.at(out["best"], np.argmax(key, axis=1), 1)
        np.add.at(out["worst"], np.argmin(key, axis=1), 1)
        champs_conf = {}
        for c in ("E", "W"):
            o = seeds[c]
            if play_in:
                np.add.at(out["play_in"], o[:, 6:10].ravel(), 1)
                t7, t8, t9, t10 = o[:, 6], o[:, 7], o[:, 8], o[:, 9]
                a_win = _game(rng, s, t7, t8, hca); seed7 = np.where(a_win, t7, t8); loser_a = np.where(a_win, t8, t7)
                b_win = _game(rng, s, t9, t10, hca); w_b = np.where(b_win, t9, t10)
                c_win = _game(rng, s, loser_a, w_b, hca); seed8 = np.where(c_win, loser_a, w_b)
                bracket = np.column_stack([o[:, :6], seed7, seed8])
            else:
                bracket = o[:, :8]
            np.add.at(out["playoffs"], bracket.ravel(), 1)
            b = bracket
            r1 = [_series(rng, s, b[:, 0], b[:, 7], hca), _series(rng, s, b[:, 3], b[:, 4], hca), _series(rng, s, b[:, 2], b[:, 5], hca), _series(rng, s, b[:, 1], b[:, 6], hca)]
            seed_of = lambda team: np.argmax(b == team[:, None], axis=1)        # seed position (0-7) of a team in this bracket
            def hi_lo(x, y):
                sx, sy = seed_of(x), seed_of(y); return np.where(sx < sy, x, y), np.where(sx < sy, y, x)
            for w in r1: np.add.at(out["r2"], w, 1)
            h1, l1 = hi_lo(r1[0], r1[1]); h2, l2 = hi_lo(r1[2], r1[3])
            s1 = _series(rng, s, h1, l1, hca); s2 = _series(rng, s, h2, l2, hca)
            for w in (s1, s2): np.add.at(out["conf_finals"], w, 1)
            hc, lc = hi_lo(s1, s2)
            cw = _series(rng, s, hc, lc, hca)
            np.add.at(out["conf_champion"], cw, 1); np.add.at(out["finals"], cw, 1)
            champs_conf[c] = cw
        e, w_ = champs_conf["E"], champs_conf["W"]
        e_better = key[ar, e] >= key[ar, w_]
        hi, lo = np.where(e_better, e, w_), np.where(e_better, w_, e)
        champ = _series(rng, s, hi, lo, hca)
        np.add.at(out["champion"], champ, 1)
    res = {k: v / n for k, v in out.items()}
    res["playoffs_incl_playin"] = res["playoffs"]
    res["wins"] = wins_all
    return res


def games_from_schedule(sched):
    """(home_idx, away_idx) for each regular-season row of a schedule frame with home_display_name / away_display_name (TBD rows dropped),
    plus two extra Cup games per team (one home, one away vs rotating opponents) when the file lists fewer than 82."""
    g = []
    for r in sched.itertuples():
        h, a = _tix(r.home_display_name), _tix(r.away_display_name)
        if h is not None and a is not None:
            g.append((h, a))
    cnt = np.zeros(30, int)
    for h, a in g:
        cnt[h] += 1; cnt[a] += 1
    rng = np.random.default_rng(11)
    short = [t for t in range(30) for _ in range(max(0, 82 - cnt[t]) // 2)]
    if short:
        a_side = list(short); b_side = list(rng.permutation(short))
        for h, a in zip(a_side, b_side):
            if h != a:
                g.append((h, a))
    return g


# --------------------------------------------------------------------------------------------- live
def live_futures(tg=None, g=None, season=None, n=10000, calib=None, seed=7):
    """Futures for the season in progress / about to start, from today's ratings."""
    season = season or nd.current_season()
    sched = nd.schedule(season)
    if sched is None:
        return None
    sched = sched[sched.season_type == 2]
    tg = tg if tg is not None else nd.team_games(); g = g if g is not None else nd.games()
    calib = calib or load_calib()
    today = pd.Timestamp.today().normalize()
    R = fl.Ratings(tg, today)
    net = net_points(R); hca = R.hca * R.pmu / 100
    pairs = [(nd._norm(r.home_display_name), nd._norm(r.away_display_name)) for r in sched.itertuples()]
    p82 = expected_wins_from_ratings(net, pairs, hca)
    last = g[(g.season == season - 1) & (g.season_type == 2)]
    prevw = {}
    for t, sub in pd.concat([last.assign(team=last.home.map(nd._norm), win=last.margin > 0), last.assign(team=last.away.map(nd._norm), win=last.margin < 0)]).groupby("team"):
        prevw[t] = sub.win.mean() * 82
    ret = nr.returning_now(season) or {}
    ew = np.array([blended_wins(p82[t], prevw.get(t, p82[t]), calib, ret.get(t)) for t in TEAMS])
    ew = ew - ew.mean() + 41                                         # the league average is 41 wins
    strength = (ew - 41) / WINS_PER_POINT
    games = games_from_schedule(sched)
    res = simulate(strength, games, hca, shock_points(calib["resid_sd"]), n=n, play_in=True, seed=seed)
    pk = _pack(res, ew, season, calib)
    for t in pk["teams"]:
        t["returning_pct"] = None if ret.get(t["team"]) is None else round(ret[t["team"]])
    return pk


def _pack(res, ew, season, calib):
    w = res["wins"]
    teams = []
    for i, t in enumerate(TEAMS):
        col = w[:, i]
        teams.append({"team": t, "conf": "East" if i < 15 else "West", "ew": round(float(col.mean()), 1), "ew_prior": round(float(ew[i]), 1),
                      "w10": int(np.percentile(col, 10)), "w90": int(np.percentile(col, 90)),
                      **{k: round(float(res[k][i]) * 100, 2) for k in ("play_in", "playoffs", "top6", "seed1", "best", "worst", "champion", "conf_champion", "finals", "conf_finals")},
                      "p30": round(float((col >= 30).mean()) * 100, 1), "p40": round(float((col >= 40).mean()) * 100, 1), "p50": round(float((col >= 50).mean()) * 100, 1), "p60": round(float((col >= 60).mean()) * 100, 1),
                      "ge": [round(float((col >= k).mean()), 4) for k in range(0, 84)]})        # P(wins >= k), k = 0..83
    return {"season": season, "built": pd.Timestamp.now().isoformat(timespec="minutes"), "sims": int(w.shape[0]), "calib": calib, "teams": teams}


def over_prob(team_row, line):
    """P(wins > line) for a line like 50.5 (= P(wins >= 51))."""
    return float(team_row["ge"][min(83, int(math.floor(line)) + 1)])


LIVE_FILE = "futures_live.json"


def _write(name, obj):
    os.makedirs(DATA, exist_ok=True)
    tmp = os.path.join(DATA, name + ".new")
    json.dump(obj, open(tmp, "w"))
    os.replace(tmp, os.path.join(DATA, name))


def _live_path():
    f = os.path.join(DATA, LIVE_FILE)
    return f if os.path.exists(f) else os.path.join(HERE, "data", LIVE_FILE)       # the file shipped in the repo until the first run writes its own


def load_live():
    f = _live_path()
    return json.load(open(f)) if os.path.exists(f) else None


def live_age_hours():
    """Hours since the live simulation was written (None if there is none). The shipped copy counts, so a fresh deploy shows numbers at
    once and refreshes itself when it is over a day old."""
    f = _live_path()
    return (pd.Timestamp.now().timestamp() - os.path.getmtime(f)) / 3600 if os.path.exists(f) else None


def refresh_live(n=10000):
    """Simulate the coming / current season from today's ratings and save it for the site (/futures)."""
    r = live_futures(n=n)
    if r:
        _write(LIVE_FILE, r)
    return bool(r)


def refresh_backtest(n=4000):
    """Replay past seasons (leave-one-season-out) and save the fitted weights + the plain-number report."""
    table = history_table()
    calib = fit_blend(table)
    d, rep = backtest(n=n, verbose=False)
    _write("futures_calib.json", calib); _write("futures_report.json", rep)
    return rep


def load_calib():
    f = os.path.join(DATA, "futures_calib.json")
    if not os.path.exists(f):
        f = os.path.join(HERE, "data", "futures_calib.json")
    return json.load(open(f))


# --------------------------------------------------------------------------------------------- backtest
def season_facts(g, S):
    """Real outcomes of season S from the games table: teams that made the playoffs (4+ playoff games), the finalists and the champion."""
    po = g[(g.season == S) & (g.season_type == 3)].sort_values(["date", "game_id"])
    if po.empty:
        return None
    cnt = {}
    for r in po.itertuples():
        for t in (nd._norm(r.home), nd._norm(r.away)):
            cnt[t] = cnt.get(t, 0) + 1
    made = {t for t, c in cnt.items() if c >= 4}
    last = po.iloc[-1]
    champ = nd._norm(last.home) if last.margin > 0 else nd._norm(last.away)
    finalists = {nd._norm(last.home), nd._norm(last.away)}
    return {"made": made, "champion": champ, "finalists": finalists}


def backtest(first=2010, n=4000, out_dir=None, seasons=None, verbose=True):
    g = nd.games(); tg = nd.team_games()
    table = history_table(first)
    reg = g[g.season_type == 2]
    rows, champ_rows, per_season = [], [], []
    hist_poly = {}
    pf = os.path.join(HERE, "data", "poly_futures_history.json")
    if os.path.exists(pf):
        hist_poly = json.load(open(pf)).get("seasons", {})
    for S in (seasons or range(first, nd.current_season())):
        if S == 2020:
            continue                                   # bubble season: 22 teams, 8 seeding games
        gs = reg[reg.season == S]
        if gs.empty:
            continue
        facts = season_facts(g, S)
        if not facts:
            continue
        calib = fit_blend(table, hold_out=S)           # weights fitted WITHOUT this season
        R = fl.Ratings(tg, gs.date.min())
        if not R.ok:
            continue
        net = net_points(R); hca = R.hca * R.pmu / 100
        sub = table[table.season == S].set_index("team")
        rv = (lambda t: sub.ret.get(t, np.nan) if "ret" in sub.columns else np.nan)
        ew = np.array([blended_wins(sub.p82.get(t, 41.0), sub.prev82.get(t, np.nan), calib, rv(t)) for t in TEAMS])
        ew0 = np.array([blended_wins(sub.p82.get(t, 41.0), sub.prev82.get(t, np.nan), calib, None) for t in TEAMS])
        ew = ew - ew.mean() + 41; ew0 = ew0 - ew0.mean() + 41
        games = [(_tix(r.home), _tix(r.away)) for r in gs.itertuples() if _tix(r.home) is not None and _tix(r.away) is not None]
        res = simulate((ew - 41) / WINS_PER_POINT, games, hca, shock_points(calib["resid_sd"]), n=n, play_in=S >= 2021, seed=S)
        wins = res["wins"]
        real = {t: sub.w82.get(t) for t in TEAMS}
        cnt = np.zeros(30)
        for h, a in games:
            cnt[h] += 1; cnt[a] += 1
        for i, t in enumerate(TEAMS):
            if t not in sub.index or cnt[i] == 0:
                continue
            col82 = wins[:, i] * (82.0 / cnt[i])         # wins were simulated over the season's real game count; per-82 lines short seasons up
            a82 = real[t]
            rows.append(dict(season=S, team=t, ew=float(col82.mean()), ew_prior=float(ew[i]), ew_prior_no_roster=float(ew0[i]), actual=float(a82),
                             c50=float(np.percentile(col82, 25) <= a82 <= np.percentile(col82, 75)), c80=float(np.percentile(col82, 10) <= a82 <= np.percentile(col82, 90)),
                             c90=float(np.percentile(col82, 5) <= a82 <= np.percentile(col82, 95)),
                             made=float(t in facts["made"]), p_playoffs=float(res["playoffs"][i]), champion=float(t == facts["champion"]), p_champion=float(res["champion"][i]),
                             finalist=float(t in facts["finalists"]), p_finals=float(res["finals"][i])))
        per_season.append(S)
        if verbose:
            print(f"  {S}: simulated, champion {facts['champion']}: model gave it {res['champion'][TIX[facts['champion']]]*100:.1f}%", flush=True)
    d = pd.DataFrame(rows)
    rep = _report(d, hist_poly, table, n)
    return d, rep


def _report(d, hist_poly, table, n):
    """Plain numbers: how good the simulator was on past seasons, and (2 seasons) against Polymarket's own preseason prices."""
    mae = float((d.ew - d.actual).abs().mean())
    brier_po = float(((d.p_playoffs - d.made) ** 2).mean()); base_po = float(((d.made.mean() - d.made) ** 2).mean())
    ll = lambda p: float(-np.log(np.clip(p, 1e-4, 1)).mean())
    champ = d[d.champion == 1]
    rep = {"built": pd.Timestamp.now().isoformat(timespec="minutes"), "sims_per_season": n, "seasons": sorted(int(s) for s in d.season.unique()), "team_seasons": int(len(d)),
           "wins": {"mae": round(mae, 2), "mae_prior_with_roster": round(float((d.ew_prior - d.actual).abs().mean()), 2), "mae_prior_without_roster": round(float((d.ew_prior_no_roster - d.actual).abs().mean()), 2), "coverage_50": round(float(d.c50.mean()) * 100, 1), "coverage_80": round(float(d.c80.mean()) * 100, 1), "coverage_90": round(float(d.c90.mean()) * 100, 1)},
           "playoffs": {"brier_model": round(brier_po, 4), "brier_everyone_same_chance": round(base_po, 4), "n": int(len(d))},
           "champion": {"seasons": int(len(champ)), "avg_chance_given_to_real_champion_pct": round(float(champ.p_champion.mean()) * 100, 1), "uniform_pct": round(100 / 30, 1),
                        "log_loss": round(ll(champ.p_champion), 3), "uniform_log_loss": round(math.log(30), 3),
                        "real_champions_in_top4_pct": round(float(np.mean([r.team in set(d[d.season == r.season].nlargest(4, "p_champion").team) for r in champ.itertuples()])) * 100, 1)},
           "vs_market": {}}
    for s, kinds in hist_poly.items():
        ch = kinds.get("champion")
        if not ch:
            continue
        S = int(s)
        sub = d[d.season == S]
        if sub.empty:
            continue
        real_champ = [k for k, v in ch["teams"].items() if v["won"]]
        if not real_champ:
            continue
        tot = sum(v["price"] for v in ch["teams"].values())
        mk = ch["teams"][real_champ[0]]["price"] / tot
        key = nd._norm(real_champ[0])
        mod = float(sub[sub.team == key].p_champion.iloc[0]) if (sub.team == key).any() else None
        rep["vs_market"][str(S)] = {"champion": real_champ[0], "market_pct": round(mk * 100, 1), "model_pct": None if mod is None else round(mod * 100, 1), "market_asof": ch["asof"]}
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backtest", action="store_true"); ap.add_argument("--n", type=int, default=4000); ap.add_argument("--live", action="store_true")
    a = ap.parse_args()
    if a.backtest:
        table = history_table()
        calib = fit_blend(table)
        d, rep = backtest(n=a.n)
        os.makedirs(DATA, exist_ok=True)
        json.dump(calib, open(os.path.join(DATA, "futures_calib.json"), "w"), indent=1)
        json.dump(rep, open(os.path.join(DATA, "futures_report.json"), "w"), indent=1)
        print(json.dumps(rep, indent=1))
    if a.live:
        r = live_futures(n=10000)
        for t in sorted(r["teams"], key=lambda x: -x["champion"])[:8]:
            print(t["team"], t["ew"], "wins | playoffs", t["playoffs"], "% | title", t["champion"], "%")


if __name__ == "__main__":
    main()
