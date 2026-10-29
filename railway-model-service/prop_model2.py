#!/usr/bin/env python3
"""
prop_model2.py -- the SECOND player-prop model (10/28 night; owner: "build ... 1, 2, 3, 4, and 5. Build now and then merge now").

What it is: P(stat >= X) straight from a boosted-tree classifier, one per family (receiving yards, receptions, rushing yards, scrimmage yards;
10/29: + rushing attempts, passing TDs, anytime TD),
fit on the 2023-2025 regular seasons ONLY (nflverse weekly player stats + the schedule's spread / total). Inputs for a player-game, all from
BEFORE that game: his last-3 / last-8 average of the stat, its spread over the last 8, his volume (targets or carries, last 3 / last 8), how
many games he has, his position, his team's implied points (spread + total), home -- and X itself (also X over his recent average). Each
training game is repeated over the family's Polymarket ladder rungs.

Tested on Polymarket US 2026 weeks 1-7 (steady two-sided books, prices = what you pay; the model never saw 2026), rule = 0.6 model + 0.4
price 65%+, priced under it, 77c max, one per player: rushing-yards Unders 110-29 = 79.1% (weeks 4-7 76-14), scrimmage-yards Unders 29-8,
receiving-yards Unders 249-82, receptions Unders 123-45; and with the app's own prop model (prop_model.py) on the same weeks-6-7 lines:
the app alone 146-35 = 80.7%, both models agreeing 130-26 = 83.3% (scratchpad us/propmodel.py, us/agree.py). The site uses it two ways
(lib/props.js): rushing / scrimmage yards Unders come from this model, and receiving yards / receptions rows show only when both models agree.
"""
import os, re, time, pickle, threading, unicodedata
import numpy as np, pandas as pd
import season as _season

CACHE = os.path.expanduser("~/.nfl_cache")
MODEL_DIR = os.environ.get("MODEL_DIR", "/data")
MODEL_FILE = os.path.join(MODEL_DIR if os.path.isdir(MODEL_DIR) else CACHE, "prop_model2_v2.pkl")   # 10/29: v2 = + rush_att / pass_td / atd (v1 had four families)
STATS_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{y}.csv"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
TRAIN = (2023, 2024, 2025)
# site stat -> (nflverse column, volume column, Polymarket ladder rungs X: "X+" = Over X - 0.5)
FAM = {
    "rec_yds": ("receiving_yards", "targets", [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 75, 80, 90, 100, 110, 120, 125, 130, 140, 150]),
    "rec": ("receptions", "targets", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    "rush_yds": ("rushing_yards", "carries", [1, 3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 75, 80, 90, 100, 110, 120, 125, 130, 140, 150]),
    "scrim_yds": ("scrim", "carries", [30, 35, 40, 45, 50, 60, 70, 75, 80, 85, 90, 100, 110, 120, 130, 140, 150, 160]),
    # 10/29 (owner: "build now" on the props test): rushing attempts, QB passing TDs, anytime TD (tds = rushing + receiving + special-teams TDs),
    # the same method and inputs as tested -- Polymarket US 2026 wk1-7 under the page's rules (75%+, 50-82c, priced under its %, one per player):
    # rushing-attempts Unders 19-4, passing-TD Overs 21-7, anytime TD No (1+ TD Under) 159-52 (scratchpad us/propmodel.py, us/props_band.py)
    "rush_att": ("carries", "carries", [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]),
    "pass_td": ("passing_tds", "attempts", [1, 2, 3, 4, 5]),
    "atd": ("tds", "carries", [1, 2, 3]),
}
POS = {"QB": 0, "RB": 1, "WR": 2, "TE": 3}
FC = ["m3", "m8", "sd8", "v3", "v8", "n", "pos", "imp", "home"]
TEAM = {"LAR": "LA", "WSH": "WAS", "JAC": "JAX"}
_LIVE = {}
_BUILD = {"running": False}


def norm(s):
    """'Ja'Marr Chase Jr.' -> 'jamarrchase' (the research's matching key)"""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", s)
    return re.sub(r"[^a-z]", "", s)


def _csv(url, local, max_age=None):
    os.makedirs(CACHE, exist_ok=True); f = os.path.join(CACHE, local)
    if not os.path.exists(f) or (max_age is not None and time.time() - os.path.getmtime(f) > max_age): _season.download(url, f)
    return pd.read_csv(f, low_memory=False)


def logs(seasons, fresh_cur=True):
    """Regular-season player games of the given seasons, with the schedule's spread / total, sorted by player and date."""
    cur = _season.data_season(); parts = []
    for y in seasons:
        try: parts.append(_csv(STATS_URL.format(y=y), f"stats_player_week_{y}.csv", 6 * 3600 if (y == cur and fresh_cur) else None))
        except Exception: pass
    P = pd.concat(parts, ignore_index=True); P = P[P.season_type == "REG"].copy()
    P["scrim"] = P.rushing_yards.fillna(0) + P.receiving_yards.fillna(0)
    P["tds"] = P.rushing_tds.fillna(0) + P.receiving_tds.fillna(0) + P.special_teams_tds.fillna(0)
    G = _csv(GAMES_URL, "nfldata_games.csv", 6 * 3600); G = G[G.game_type == "REG"][["game_id", "home_team", "spread_line", "total_line"]]
    P = P.merge(G, on="game_id", how="left")
    P["team"] = P.team.replace(TEAM); P["home"] = (P.team == P.home_team.replace(TEAM)).astype(int)
    P["imp"] = np.where(P.home == 1, P.total_line / 2 + P.spread_line / 2, P.total_line / 2 - P.spread_line / 2)
    P["nk"] = P.player_display_name.map(norm)
    return P.sort_values(["player_id", "season", "week"]).reset_index(drop=True)


def feats(P, col, vol):
    g = P.groupby("player_id")[col]; v = P.groupby("player_id")[vol]
    sh = lambda s: s.shift(1)
    return pd.DataFrame({"m3": g.transform(lambda s: sh(s).rolling(3, 1).mean()), "m8": g.transform(lambda s: sh(s).rolling(8, 1).mean()),
                         "sd8": g.transform(lambda s: sh(s).rolling(8, 2).std()), "v3": v.transform(lambda s: sh(s).rolling(3, 1).mean()),
                         "v8": v.transform(lambda s: sh(s).rolling(8, 1).mean()), "n": g.transform(lambda s: sh(s).notna().cumsum()),
                         "pos": P.position.map(POS).fillna(4), "imp": P.imp, "home": P.home}, index=P.index)


def build(log=print):
    """Fit the four families on 2023-2025 (as tested) and save the file."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    P = logs(TRAIN, fresh_cur=False); models = {}
    for st, (col, vol, rungs) in FAM.items():
        P[col] = P[col].astype(float); P[vol] = P[vol].astype(float)
        X0 = pd.concat([P[["season", col]], feats(P, col, vol)], axis=1)
        tr = X0[(X0.n >= 3) & X0.m8.notna() & X0[col].notna()]
        rr = [r for r in rungs if r <= np.nanpercentile(tr[col], 99.5)] or rungs
        T = tr.loc[tr.index.repeat(len(rr))].copy(); T["X"] = np.tile(rr, len(tr)); T["xr"] = T.X / (T.m8.abs() + 1); T["y"] = (T[col] >= T.X).astype(int)
        if len(T) > 600000: T = T.sample(600000, random_state=0)
        models[st] = HistGradientBoostingClassifier(max_iter=300, max_depth=4, learning_rate=0.05, random_state=0).fit(T[FC + ["X", "xr"]], T.y)
        log(f"[props2] {st}: {len(T)} training rows")
    L = {"models": models, "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "train": list(TRAIN)}
    try:
        with open(MODEL_FILE, "wb") as f: pickle.dump(L, f)
    except Exception as e: log(f"[props2] could not save: {e}")
    _LIVE.clear(); _LIVE.update(L); return {"built": L["built"]}


def load_live():
    if _LIVE.get("models"): return _LIVE
    try:
        with open(MODEL_FILE, "rb") as f: _LIVE.update(pickle.load(f)); return _LIVE
    except Exception: return None


def build_bg(log=print):
    if _BUILD["running"]: return
    _BUILD["running"] = True
    def go():
        try: build(log)
        except Exception as e: log(f"[props2] build failed: {e}")
        finally: _BUILD["running"] = False
    threading.Thread(target=go, daemon=True).start()


def player_now(P, nk, teams):
    """The player's form before his next game: (row of inputs without imp / home, his team) or None (fewer than 3 games)."""
    h = P[P.nk == nk]
    if not len(h): return None
    if h.player_id.nunique() > 1:   # two players with one name: the one on a team in this game, else the most recent
        last = h.sort_values(["season", "week"]).groupby("player_id").tail(1)
        pick = last[last.team.isin(teams)] if last.team.isin(teams).any() else last
        h = h[h.player_id == pick.sort_values(["season", "week"]).player_id.iloc[-1]]
    return h.sort_values(["season", "week"])


def chances_many(games, upto=None):
    """games: [{"away", "home", "spread" (away spread: home favored = positive), "total", "outs": [names], "lines": [{"name", "stat", "line"}]}]
    -> [{"game", "rows": [{name, team, stat, line, over, under}]}]; lines of other stats, unknown players or players with under 3 games are skipped.
    upto = (season, week): use only games before that week (the replay test; live = every game so far)."""
    L = load_live()
    if not L or not L.get("models"): return []
    cur = _season.data_season(); P = logs(sorted(set(TRAIN) | {cur - 1, cur}))
    if upto: P = P[(P.season * 100 + P.week) < upto[0] * 100 + upto[1]]
    out = []
    for g in games:
        a, h, sp, tot = TEAM.get(g["away"], g["away"]), TEAM.get(g["home"], g["home"]), float(g["spread"]), float(g["total"])
        imp = {a: tot / 2 - sp / 2, h: tot / 2 + sp / 2}; outs = {norm(n) for n in (g.get("outs") or [])}
        rows, X, keep = [], [], []
        for ln in g.get("lines") or []:
            st = ln.get("stat")
            if st not in FAM or st not in L["models"]: continue
            nk = norm(ln.get("name"))
            if not nk or nk in outs: continue
            hist = player_now(P, nk, (a, h))
            if hist is None: continue
            col, vol, _ = FAM[st]; s = hist[col].astype(float).values; v = hist[vol].astype(float).values
            n = int(np.sum(~np.isnan(s)))
            if n < 3: continue
            last8, last3 = s[-8:], s[-3:]
            team = str(hist.team.iloc[-1])
            if team not in imp: continue   # his last game was for another team (a trade with no game yet): no row
            x = {"m3": np.nanmean(last3), "m8": np.nanmean(last8), "sd8": np.nanstd(last8, ddof=1) if np.sum(~np.isnan(last8)) >= 2 else np.nan,
                 "v3": np.nanmean(v[-3:]), "v8": np.nanmean(v[-8:]), "n": n, "pos": POS.get(str(hist.position.iloc[-1]), 4), "imp": imp[team], "home": int(team == h)}
            Xr = float(ln["line"]) + 0.5
            X.append({**x, "X": Xr, "xr": Xr / (abs(x["m8"]) + 1)}); keep.append((ln, st, team))
        if X:
            D = pd.DataFrame(X)
            for st in {k[1] for k in keep}:
                idx = [i for i, k in enumerate(keep) if k[1] == st]
                p = L["models"][st].predict_proba(D.iloc[idx][FC + ["X", "xr"]])[:, 1]
                for i, po in zip(idx, p):
                    ln, _, team = keep[i]
                    rows.append({"name": ln.get("name"), "team": team, "stat": st, "line": float(ln["line"]), "over": round(float(po), 4), "under": round(1 - float(po), 4)})
        out.append({"game": f"{g['away']} @ {g['home']}", "rows": rows})
    return out
