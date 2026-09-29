#!/usr/bin/env python3
"""
injury_adj.py — automatic injury adjustment for the game-line model. Output is an ESTIMATE.

What it does: finds each team's regular starters (last 4 games of official snap counts) and, for each one listed
Out / Doubtful / Questionable on the official injury report, moves that team's strength by a fixed number of points.

Point values were fit on 2013-2025 (2,561 games, weeks 4+): margin error of the plain model vs. actual result, per
missing starter. Kept only where the effect was clearly not zero (|t| > 2):
    starting QB -3.96 | WR1 -1.78 | each starting LB -1.25 | each starting OL -0.87 | each starting DB -0.76
    total: only a missing QB moves it (-2.84 points on the game total)
Not used (error bars include zero): RB1, TE1, WR2/WR3, defensive line (edge and interior).
Out-of-sample (leave-one-season-out) this trimmed model error from 10.54 to 10.41 points (market 9.94) and did NOT
beat the market against the spread (50.0% at a 2-point gap vs 52.4% break-even). Never a bet signal by itself.
"""
import os, re, time, urllib.request
import numpy as np, pandas as pd

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
CACHE = os.path.expanduser("~/.nfl_cache")
CURRENT = 2026

SPREAD_PTS = {"QB1": -3.96, "WR1": -1.78, "LB": -1.25, "OL": -0.87, "DB": -0.76}
TOTAL_PTS = {"QB1": -2.84}
# share of listed starters who actually sit, by report status (measured on 2016-2025 injury reports)
STATUS_W = {"out": 1.0, "doubtful": 0.99, "questionable": 0.28}
TEAM_CAP = 6.0   # max points removed from one team (binds in under 1% of 2016-25 team-games)

GROUPS = {"QB": ({"QB"}, 1, "o", .5), "WR": ({"WR"}, 3, "o", .3), "OL": ({"T", "G", "C", "OL"}, 5, "o", .5),
          "LB": ({"LB", "ILB", "OLB", "MLB"}, 3, "d", .5), "DB": ({"CB", "S", "SS", "FS", "DB"}, 4, "d", .5)}
_cache = {"t": 0.0, "df": None, "season": None}

def norm(n):
    n = re.sub(r"[^a-z ]", "", (n or "").lower().replace("-", " "))
    return " ".join(w for w in n.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v"))

def _snaps(season, fresh=False):
    os.makedirs(CACHE, exist_ok=True); f = os.path.join(CACHE, f"snap_counts_{season}.parquet")
    if fresh or not os.path.exists(f):
        urllib.request.urlretrieve(f"{BASE}/snap_counts/snap_counts_{season}.parquet", f)
    s = pd.read_parquet(f)
    return s[s.game_type == "REG"]

def load_snaps(season=CURRENT):
    """Last season + this season (this season re-downloaded at most every 10 minutes)."""
    if _cache["df"] is not None and _cache["season"] == season and time.time() - _cache["t"] < 600:
        return _cache["df"]
    parts = []
    for y in (season - 1, season):
        try: parts.append(_snaps(y, fresh=(y == season)))
        except Exception: pass
    df = pd.concat(parts, ignore_index=True)
    _cache.update(t=time.time(), df=df, season=season)
    return df

def starters(team_snaps, before=None, n_games=4):
    """Regular starters by group from the team's last `n_games` games: {group: [(name, avg_snap_share), ...]} in rank order."""
    T = team_snaps
    keys = T[["season", "week"]].drop_duplicates().sort_values(["season", "week"])
    if before is not None:
        keys = keys[(keys.season < before[0]) | ((keys.season == before[0]) & (keys.week < before[1]))]
    keys = keys.tail(n_games)
    if len(keys) < 3: return {}
    sub = T.merge(keys, on=["season", "week"])
    idx = pd.MultiIndex.from_frame(keys); out = {}
    for g, (pos, n, side, th) in GROUPS.items():
        G = sub[sub.position.isin(pos)].copy()
        if G.empty: continue
        G["pct"] = (G.offense_pct if side == "o" else G.defense_pct).astype(float)
        names = G.drop_duplicates("pfr_player_id").set_index("pfr_player_id").player
        M = G.pivot_table(index="pfr_player_id", columns=["season", "week"], values="pct", aggfunc="max").reindex(columns=idx).fillna(0.0)
        r = (M.sum(axis=1) / len(keys)).sort_values(ascending=False).head(n)
        r = r[r >= th]
        out[g] = [(names[i], float(v)) for i, v in r.items()]
    return out

def team_effect(team, inj_list, snaps=None, st=None):
    """Points this team loses to injuries (<= 0) on the margin, and on the game total. `inj_list`: [{name, status}, ...]."""
    if st is None:
        snaps = load_snaps() if snaps is None else snaps
        st = starters(snaps[snaps.team == team])
    listed = {}
    for x in inj_list or []:
        s = (x.get("status") or "").strip().lower()
        if s in STATUS_W: listed[norm(x.get("name"))] = (STATUS_W[s], s, x.get("name"))
    players, pts, tot = [], 0.0, 0.0
    def take(group, key, name):
        nonlocal pts, tot
        h = listed.get(norm(name))
        if not h: return
        p = SPREAD_PTS[key] * h[0]; t = TOTAL_PTS.get(key, 0.0) * h[0]
        players.append(dict(name=name, group=key, status=h[1], pts=round(p, 2), total=round(t, 2))); pts += p; tot += t
    if st.get("QB"): take("QB", "QB1", st["QB"][0][0])
    if st.get("WR"): take("WR", "WR1", st["WR"][0][0])
    for g in ("OL", "LB", "DB"):
        for nm, _ in st.get(g, []): take(g, g, nm)
    return dict(pts=round(max(pts, -TEAM_CAP), 2), total=round(tot, 2), players=players, capped=pts < -TEAM_CAP)

def adjust_game(away, home, inj_away, inj_home, snaps=None):
    """Returns margin shift (home minus away, points) and total shift for one game, plus who caused it."""
    snaps = load_snaps() if snaps is None else snaps
    a, h = team_effect(away, inj_away, snaps), team_effect(home, inj_home, snaps)
    return dict(margin=round(h["pts"] - a["pts"], 2), total=round(h["total"] + a["total"], 2), home=h, away=a, estimate=True)
