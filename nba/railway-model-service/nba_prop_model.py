#!/usr/bin/env python3
"""
nba_prop_model.py -- the NBA player-prop model (10/20, owner: "Player props" page for both sports, bar 62%+).

Same method as the NFL prop model (railway-model-service/prop_model.py) and the 10/17 research (research/props_model.py):
boosted trees on pre-game inputs (season to date blended with last season, last 5 games, minutes, starter, team scoring,
opponent allowed to the position, home), one model per stat; the CHANCE of a line = what happened to the earlier seasons'
out-of-sample player-games with the nearest prediction, each outcome scaled to this prediction (prop_model.Spread, copied here
so the NBA service stays on its own).

Stats: pts, reb, ast, pra (points + rebounds + assists), 3pm, stl, blk.  Data: ESPN player box scores (sportsdataverse,
nba_data.player_box), regular season, seasons FIRST_TRAIN..now.  Every season from TEST_FROM is predicted by a model trained
only on the seasons before it; the live model is trained on everything.

Honest numbers (10/17 research, real Polymarket lines 2025-26, model 65%+): only rebounds Over cleared 65% (66.9%, 89-44);
points Over 61.4%, assists Over 59.4%, Unders 53-58% -- the model alone is 53-58% against the NBA prop market. The page shows
the model's % and keeps the live record per stat; the record is the truth.

Live:  build_live() -> MODEL_FILE (the Railway volume), load_live(), chances_many(games) for the site's /prop-probs.
Test:  python3 nba_prop_model.py --test   (walk-forward calibration by stat / side / band, every season unseen)
"""
import os, re, sys, pickle, datetime as dt
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nba_data as nd

STATS = ["pts", "reb", "ast", "pra", "3pm", "stl", "blk"]
COL = {"pts": "points", "reb": "rebounds", "ast": "assists", "3pm": "three_point_field_goals_made", "stl": "steals", "blk": "blocks"}
ABBR_FIX = {"GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS", "PHO": "PHX"}
FIRST_TRAIN, TEST_FROM = 2021, 2023
PRIOR_G = 3                 # last season counts as 3 games next to this season's average
MIN_B_MIN = 12              # rotation players (the ones Polymarket lists)
NEIGH = 2000
MODEL_DIR = os.environ.get("MODEL_DIR", "/data")
MODEL_FILE = os.path.join(MODEL_DIR if os.path.isdir(MODEL_DIR) else nd.CACHE, "nba_prop_model_v1.pkl")
BASE = ["b_min", "l5_min", "gp", "start1", "t_for", "o_against", "home"] + [f"b_{s}" for s in STATS] + [f"l5_{s}" for s in STATS]
# 10/21: teammates out. A REGULAR (20+ minutes a game) who played one of the team's last 3 games and sits this one (live: the
# official Out / Doubtful list) -- his minutes / points / assists / rebounds a game, summed per team, and how many. Walk-forward
# 2023-26: points miss 4.875 -> 4.815 (better every season), PRA 6.331 -> 6.226, rebounds / assists a little; in games with 40+
# minutes out the old model was 1.3 points (PRA 2.0) low. Real Polymarket lines 2025-26: Brier better for points / rebounds /
# assists, points rows 65%+ won 57.4 -> 61.5%. Threes / steals / blocks gain nothing -> left without it.
VAC = ["vac_min", "vac_pts", "vac_ast", "vac_reb", "vac_n"]
VAC_STATS = ("pts", "reb", "ast", "pra")
VAC_MIN = 20
PROP_V = 2                  # model version: a saved model of another version keeps serving and is rebuilt in the background
feats_for = lambda stat: BASE + [f"o_{stat}"] + (VAC if stat in VAC_STATS else [])
OLD_FEATS = lambda stat: BASE + [f"o_{stat}"]   # a version-1 model file (no "feats" saved)


def norm_name(n):
    s = re.sub(r"[^a-z ]", "", str(n or "").lower().replace("-", " ").replace(".", ""))
    return " ".join(w for w in s.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v"))


def fix_abbr(a):
    a = str(a or "").upper(); return ABBR_FIX.get(a, a)


def load_box(seasons):
    """Regular-season player-games that were played (minutes > 0), one row per player per game, stats as numbers."""
    parts = []
    for s in seasons:
        try: d = nd.player_box(s)
        except Exception: d = None
        if d is None or not len(d): continue
        parts.append(d)
    if not parts: return None
    B = pd.concat(parts, ignore_index=True)
    B = B[B.season_type == 2].copy()
    B["min"] = pd.to_numeric(B["minutes"], errors="coerce")
    dnp = B["did_not_play"].fillna(False).astype(bool) if "did_not_play" in B else False
    B = B[(~dnp) & (B["min"].fillna(0) > 0)].copy()
    for k, c in COL.items(): B[k] = pd.to_numeric(B[c], errors="coerce").fillna(0.0)
    B["pra"] = B["pts"] + B["reb"] + B["ast"]
    B["date"] = pd.to_datetime(B["game_date"])
    B["pos"] = B["athlete_position_abbreviation"].fillna("?").astype(str).str[:1]
    B["team"] = B["team_abbreviation"].map(fix_abbr); B["opp"] = B["opponent_team_abbreviation"].map(fix_abbr)
    B["home"] = (B["home_away"] == "home").astype(int)
    B["starter"] = B["starter"].fillna(False).astype(bool)
    B["name"] = B["athlete_display_name"].astype(str)
    B["season"] = B["season"].astype(int)
    return B.sort_values(["athlete_id", "date"]).reset_index(drop=True)


def _team_tables(B):
    """Per game: the team's scoring so far this season (t_for) and the opponent's points allowed (o_against); per (opponent, position):
    what the opponent allowed per game so far this season (o_<stat>). All from EARLIER games only."""
    T = B.drop_duplicates(["game_id", "team"])[["game_id", "team", "opp", "season", "date", "team_score", "opponent_team_score"]].sort_values("date")
    tg = T.groupby(["team", "season"])
    T["t_for"] = tg["team_score"].transform(lambda s: s.shift(1).expanding().mean()); T["t_against"] = tg["opponent_team_score"].transform(lambda s: s.shift(1).expanding().mean())
    A = B.groupby(["opp", "season", "game_id", "date", "pos"])[STATS].sum().reset_index().sort_values("date")
    ag = A.groupby(["opp", "season", "pos"])
    for c in STATS: A["o_" + c] = ag[c].transform(lambda s: s.shift(1).expanding().mean())
    return T, A


def table(B):
    """Feature table: every row's inputs come from BEFORE that game."""
    B = B.copy(); g = B.groupby(["athlete_id", "season"])
    for c in STATS + ["min"]:
        cum = g[c].cumsum() - B[c]; n = g.cumcount()
        B["s_" + c] = cum / n.replace(0, np.nan)
        B["l5_" + c] = g[c].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())
    B["gp"] = g.cumcount()
    prior = B.groupby(["athlete_id", "season"])[STATS + ["min"]].mean().reset_index(); prior["season"] += 1
    B = B.merge(prior.rename(columns={c: "p_" + c for c in STATS + ["min"]}), on=["athlete_id", "season"], how="left")
    for c in STATS + ["min"]:
        has = B["p_" + c].notna().astype(float)
        B["b_" + c] = (B["s_" + c].fillna(0) * B["gp"] + PRIOR_G * B["p_" + c].fillna(0)) / (B["gp"] + PRIOR_G * has).replace(0, np.nan)
    B["start1"] = g["starter"].shift(1).astype(float)
    T, A = _team_tables(B)
    B = B.merge(T[["game_id", "team", "t_for"]], on=["game_id", "team"], how="left")
    B = B.merge(T[["game_id", "team", "t_against"]].rename(columns={"team": "opp", "t_against": "o_against"}), on=["game_id", "opp"], how="left")
    B = B.merge(A[["opp", "game_id", "pos"] + ["o_" + c for c in STATS]], on=["opp", "game_id", "pos"], how="left")
    return _vacated(B)


def _vacated(B):
    """vac_* per team-game: regulars (b_min 20+) who played one of the team's last 3 games, are not in this one and were not traded
    (their next game, any team, is for this team again, or they play no more this season). Values = their pre-game averages at the
    last game they played."""
    G = B.drop_duplicates(["game_id", "team"])[["game_id", "team", "season", "date"]].sort_values("date")
    G["gi"] = G.groupby(["team", "season"]).cumcount()
    B = B.merge(G[["game_id", "team", "gi"]], on=["game_id", "team"], how="left")
    o = B.sort_values(["athlete_id", "date"])
    B.loc[o.index, "next_team"] = o.groupby("athlete_id")["team"].shift(-1).values
    cols = ["b_min", "b_pts", "b_ast", "b_reb", "next_team"]
    parts = [B[["athlete_id", "team", "season"] + cols].assign(gi=B["gi"] + k, k=k) for k in (1, 2, 3)]
    C = pd.concat(parts, ignore_index=True).sort_values("k").drop_duplicates(["athlete_id", "team", "season", "gi"])   # his latest game for the team
    C = C[(C["b_min"].fillna(0) >= VAC_MIN) & (C["next_team"].isna() | (C["next_team"] == C["team"]))]
    here = B[["athlete_id", "team", "season", "gi"]].assign(here=1)
    C = C.merge(here, on=["athlete_id", "team", "season", "gi"], how="left")
    C = C[C["here"].isna()]
    V = C.groupby(["team", "season", "gi"]).agg(vac_min=("b_min", "sum"), vac_pts=("b_pts", "sum"), vac_ast=("b_ast", "sum"),
                                                vac_reb=("b_reb", "sum"), vac_n=("athlete_id", "size")).reset_index()
    B = B.merge(V, on=["team", "season", "gi"], how="left")
    for c in VAC: B[c] = B[c].fillna(0.0)
    return B.drop(columns=["next_team"])


eligible = lambda df: df[df["b_min"].fillna(0) >= MIN_B_MIN]


def _fit(train, stat):
    from sklearn.ensemble import HistGradientBoostingRegressor
    f = feats_for(stat)
    return HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_depth=4, min_samples_leaf=80, l2_regularization=1.0, random_state=0).fit(train[f].astype(float).values, train[stat].values)


def predict_mu(model, df, stat, feats=None):
    return np.maximum(model.predict(df[feats or feats_for(stat)].astype(float).values), 0.05)


class Spread:
    """Chance a player-game clears a line: the NEIGH earlier player-games with the closest predicted average, each outcome scaled to this
    prediction (outcome x mu / mu_i). Built only from out-of-sample predictions. (Same as prop_model.Spread in the NFL service.)"""
    def __init__(self, mu, y):
        o = np.argsort(mu); self.mu = np.asarray(mu, float)[o]; self.y = np.asarray(y, float)[o]
    def over(self, mu, line):
        mu = np.atleast_1d(np.asarray(mu, float)); line = np.broadcast_to(np.asarray(line, float), mu.shape)
        out = np.empty(mu.shape); n = len(self.mu); h = min(NEIGH, n) // 2
        idx = np.searchsorted(self.mu, mu)
        for i, (m, L, k) in enumerate(zip(mu, line, idx)):
            lo = max(0, min(k - h, n - 2 * h)); hi = lo + 2 * h
            sc = self.y[lo:hi] * (m / self.mu[lo:hi]); out[i] = float(np.mean(sc > L))
        return out


def walk_forward(E, stats=STATS, log=print):
    """Out-of-sample predictions: season s predicted by a model trained on FIRST_TRAIN..s-1. {stat: DataFrame(season, mu, y)}"""
    out = {}
    seasons = sorted(E["season"].unique())
    for stat in stats:
        parts = []
        for s in seasons:
            if s < TEST_FROM: continue
            tr, te = E[E["season"] < s], E[E["season"] == s].copy()
            if len(tr) < 2000 or not len(te): continue
            te["mu"] = predict_mu(_fit(tr, stat), te, stat); parts.append(te[["season", "mu", stat, "b_" + stat, "name", "date"]].rename(columns={stat: "y"}))
        out[stat] = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["season", "mu", "y"])
        log(f"[nba props] walk-forward {stat}: {len(out[stat])} player-games")
    return out


def _state(B, cur):
    """One 'next game' feature row per player: this season to date (if the season's file is out) else last season as the prior with
    gp 0 -- exactly the shape of a season-opener row in training. Plus the live team tables."""
    have_cur = cur in set(B["season"].unique())
    last3 = {}
    if have_cur:
        T3 = B[B["season"] == cur].drop_duplicates(["game_id", "team"]).sort_values("date")
        last3 = {t: set(d["game_id"].tail(3)) for t, d in T3.groupby("team")}
    rows = []
    last = B.groupby("athlete_id").tail(1)
    for aid, r in last.set_index("athlete_id").iterrows():
        s = int(r["season"]); x = {"athlete_id": aid, "name": r["name"], "nname": norm_name(r["name"]), "team": r["team"], "pos": r["pos"]}
        mine = B[B["athlete_id"] == aid]
        if have_cur and s == cur:
            this, prev = mine[mine["season"] == cur], mine[mine["season"] == cur - 1]
        elif s == cur - 1:
            this, prev = mine.iloc[0:0], mine[mine["season"] == cur - 1]
        else:
            continue   # did not play last season: no prior, not modeled (same as the training rule)
        gp = len(this); x["gp"] = gp
        for c in STATS + ["min"]:
            sm = this[c].mean() if gp else np.nan; pm_ = prev[c].mean() if len(prev) else np.nan
            has = 0.0 if np.isnan(pm_) else 1.0
            den = gp + PRIOR_G * has
            x["b_" + c] = np.nan if den == 0 else ((0 if gp == 0 else sm * gp) + PRIOR_G * (0 if np.isnan(pm_) else pm_)) / den
            x["l5_" + c] = this[c].tail(5).mean() if gp else np.nan
        x["start1"] = float(this["starter"].iloc[-1]) if gp else np.nan
        x["last3"] = bool(gp) and r["game_id"] in last3.get(r["team"], ())   # played one of his team's last 3 games (teammates-out input)
        rows.append(x)
    S = pd.DataFrame(rows)
    teams, opp_pos = {}, {}
    if have_cur:
        C = B[B["season"] == cur]
        T = C.drop_duplicates(["game_id", "team"])
        for t, d in T.groupby("team"): teams[t] = {"t_for": float(d["team_score"].mean()), "t_against": float(d["opponent_team_score"].mean())}
        A = C.groupby(["opp", "game_id", "pos"])[STATS].sum().reset_index()
        for (o, p), d in A.groupby(["opp", "pos"]): opp_pos[(o, p)] = {("o_" + c): float(d[c].mean()) for c in STATS}
    return S, teams, opp_pos


def build_live(log=print):
    cur = nd.current_season()
    B = load_box(range(FIRST_TRAIN, cur + 1))
    if B is None: raise RuntimeError("no player box scores")
    E = eligible(table(B))
    log(f"[nba props] {len(E)} eligible player-games, seasons {sorted(E['season'].unique())}, current {cur}")
    oof = walk_forward(E, log=log)
    models = {stat: _fit(E, stat) for stat in STATS}
    spread = {stat: (oof[stat]["mu"].values, oof[stat]["y"].values) for stat in STATS}
    S, teams, opp_pos = _state(B, cur)
    out = {"built": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z", "cur": cur, "seasons": sorted(int(s) for s in E["season"].unique()),
           "models": models, "spread": spread, "state": S, "teams": teams, "opp_pos": opp_pos, "n": int(len(E)),
           "v": PROP_V, "feats": {stat: feats_for(stat) for stat in STATS}}
    os.makedirs(os.path.dirname(MODEL_FILE), exist_ok=True)
    with open(MODEL_FILE + ".part", "wb") as f: pickle.dump(out, f)
    os.replace(MODEL_FILE + ".part", MODEL_FILE)
    _LIVE.clear(); _LIVE.update(out)
    log(f"[nba props] built: {len(S)} players, {len(E)} rows -> {MODEL_FILE}")
    return out


_LIVE = {}


def load_live():
    if _LIVE.get("models"): return _LIVE
    if not os.path.exists(MODEL_FILE): return None
    try:
        with open(MODEL_FILE, "rb") as f: _LIVE.update(pickle.load(f))
    except Exception:
        return None
    return _LIVE if _LIVE.get("models") else None


def built_age_hours():
    if not os.path.exists(MODEL_FILE): return None
    return (dt.datetime.utcnow().timestamp() - os.path.getmtime(MODEL_FILE)) / 3600


def _player_rows(L, away, home):
    """Candidate players for one game: everybody whose latest team is one of the two (normalized name -> row), with a name-only fallback."""
    S = L["state"]; mine = S[S["team"].isin([away, home])]
    by = {r["nname"]: r for _, r in mine.iterrows()}
    anyone = {r["nname"]: r for _, r in S.iterrows()}
    return by, anyone


Q_SITS = 0.455             # share of Questionable rotation players who sit (official reports 2021-26, nba_injuries weights)


def _vac_live(L, teams, outs, quest=()):
    """Teammates out tonight, the training's shape: regulars (20+ minutes a game) on the team who played one of its last 3 games and
    are on the official Out / Doubtful list (each counted whole) or Questionable (counted Q_SITS of the way: the expected minutes out).
    {team: {vac_min, vac_pts, vac_ast, vac_reb, vac_n}}"""
    S = L["state"]; out = {}; quest = set(quest) - set(outs)
    for t in teams:
        d = S[(S["team"] == t) & (S["nname"].isin(outs) | S["nname"].isin(quest))]
        if "last3" in d: d = d[d["last3"].fillna(False).astype(bool)]
        d = d[d["b_min"].fillna(0) >= VAC_MIN]
        w = np.where(d["nname"].isin(outs), 1.0, Q_SITS)
        out[t] = {"vac_min": float((d["b_min"] * w).sum()), "vac_pts": float((d["b_pts"] * w).sum()), "vac_ast": float((d["b_ast"] * w).sum()),
                  "vac_reb": float((d["b_reb"] * w).sum()), "vac_n": float(w.sum())}
    return out


def needs_rebuild():
    """A saved model of an older version (no teammates-out input) keeps serving until the background rebuild replaces it."""
    L = load_live(); return L is not None and L.get("v") != PROP_V


def chances_many(games):
    """games: [{away, home, outs: [names], lines: [{name, stat, line}]}] -> [{game, rows: [{name, team, stat, line, mu, over, under}]}]"""
    L = load_live()
    if L is None: raise RuntimeError("prop model not built")
    sp = {stat: Spread(*L["spread"][stat]) for stat in STATS if len(L["spread"][stat][0])}
    out = []
    for g in games:
        away, home = fix_abbr(g.get("away")), fix_abbr(g.get("home"))
        outs = {norm_name(n) for n in (g.get("outs") or [])}
        by, anyone = _player_rows(L, away, home)
        vac = _vac_live(L, (away, home), outs, {norm_name(n) for n in (g.get("quest") or [])})
        rows, mus = [], {}   # 10/23: the predicted average does not depend on the line -- once per player + stat, not once per ladder rung
        for ln in g.get("lines") or []:
            stat = str(ln.get("stat") or ""); nn = norm_name(ln.get("name"))
            if stat not in sp or nn in outs: continue
            line = float(ln.get("line"))
            if (nn, stat) in mus:
                hit = mus[(nn, stat)]
                if hit is None: continue
                team, mu = hit; over = float(sp[stat].over([mu], [line])[0])
                rows.append({"name": ln.get("name"), "team": team, "stat": stat, "line": line, "mu": round(mu, 2), "over": round(over, 4), "under": round(1 - over, 4)}); continue
            mus[(nn, stat)] = None
            r = by.get(nn)
            if r is None: r = anyone.get(nn)
            if r is None: continue
            team = r["team"] if r["team"] in (away, home) else None
            is_home = 1 if team == home else 0 if team == away else np.nan
            opp = away if team == home else home if team == away else None
            x = {k: r.get(k, np.nan) for k in BASE if k in r.index}
            x["home"] = is_home
            x["t_for"] = (L["teams"].get(team) or {}).get("t_for", np.nan) if team else np.nan
            x["o_against"] = (L["teams"].get(opp) or {}).get("t_against", np.nan) if opp else np.nan
            op = L["opp_pos"].get((opp, r["pos"])) if opp else None
            x["o_" + stat] = (op or {}).get("o_" + stat, np.nan)
            x.update(vac.get(team) or {c: 0.0 for c in VAC})
            if not (float(x.get("b_min") or 0) >= MIN_B_MIN): continue
            X = pd.DataFrame([x])
            fs = (L.get("feats") or {}).get(stat) or OLD_FEATS(stat)
            for c in fs:
                if c not in X: X[c] = np.nan
            mu = float(predict_mu(L["models"][stat], X, stat, fs)[0])
            mus[(nn, stat)] = (team, mu)
            over = float(sp[stat].over([mu], [line])[0])
            rows.append({"name": ln.get("name"), "team": team, "stat": stat, "line": line, "mu": round(mu, 2), "over": round(over, 4), "under": round(1 - over, 4)})
        out.append({"game": f"{away} @ {home}", "rows": rows})
    return out


def history_report(log=print, bar=0.62):
    """Walk-forward calibration at Polymarket-style ladder lines, every season unseen; by stat / side / band."""
    cur = nd.current_season()
    B = load_box(range(FIRST_TRAIN, cur + 1)); E = eligible(table(B)); oof = walk_forward(E, log=log)
    bands = ((62, 65), (65, 70), (70, 80), (80, 90), (90, 101))
    for stat in STATS:
        O = oof[stat]; seasons = sorted(O["season"].unique())
        rows = []
        for s in seasons[1:]:
            sp_ = O[O["season"] < s]; te = O[O["season"] == s]; sp = Spread(sp_["mu"].values, sp_["y"].values)
            step = 2.0 if stat in ("pts", "pra") else 1.0
            for mu, px, y in zip(te["mu"].values, te["b_" + stat].fillna(te["mu"]).values, te["y"].values):
                Ls = np.arange(max(0.5, np.floor(px * 0.5) + 0.5), px * 1.6 + 1, step)
                if not len(Ls): continue
                for l, p in zip(Ls, sp.over(np.full(len(Ls), mu), Ls)): rows.append((s, l, p, y > l))
        R = pd.DataFrame(rows, columns=["season", "line", "p_over", "over"])
        for side in ("Over", "Under"):
            pc = R["p_over"] if side == "Over" else 1 - R["p_over"]; won = R["over"] if side == "Over" else ~R["over"]; m = pc >= bar
            by = " ".join(f"{s}:{won[m & (R.season == s)].mean()*100:.0f}" for s in seasons[1:])
            bd = " ".join(f"{lo}-{hi}:{won[(pc>=lo/100)&(pc<hi/100)].mean()*100:.1f}({int(((pc>=lo/100)&(pc<hi/100)).sum())})" for lo, hi in bands)
            log(f"HISTORY {stat:4s} {side:5s} {int(bar*100)}%+ said {pc[m].mean()*100:.1f} won {won[m].mean()*100:.1f}% ({int(m.sum())}) by season {by} | {bd}")


if __name__ == "__main__":
    if "--test" in sys.argv: history_report()
    else: build_live()
