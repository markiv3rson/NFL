#!/usr/bin/env python3
"""
nba_features.py — NBA only. Who is missing from each team's rotation.

Rotation = players who averaged real minutes over the team's last WINDOW games (looking only at games before this one).
Missing = rotation players who did not play. In a back-test "did not play" is what actually happened; live, the same
numbers come from the injury list.

  missing_min  = sum of the missing players' minutes per game (a full rotation is about 240 minutes per game)
  missing_pts  = sum of the missing players' points per game
  star_out     = 1 if the team's top scorer (by points per game) is missing
  n_missing    = how many rotation players are missing
"""
import numpy as np, pandas as pd
import nba_data as nd

WINDOW = 20        # team games looked back
MIN_PLAYED = 6     # must have played in at least this many of those games
MIN_MPG = 14.0     # and averaged at least this many minutes when playing


def player_games(seasons=None):
    seasons = seasons or range(nd.FIRST_SEASON, nd.current_season() + 1)
    rows = []
    for s in seasons:
        p = nd.player_box(s)
        if p is None or not len(p):
            continue
        rows.append(p)
    p = pd.concat(rows, ignore_index=True)
    p = p[p.season_type.isin([2, 3])].copy()
    p["team"] = p["team_display_name"].map(nd._norm)
    p["date"] = pd.to_datetime(p["game_date"]).dt.date
    p["min"] = pd.to_numeric(p["minutes"], errors="coerce").fillna(0.0)
    p["pts"] = pd.to_numeric(p["points"], errors="coerce").fillna(0.0)
    p["played"] = (p["min"] > 0) & (~p["did_not_play"].fillna(False).astype(bool))
    return p[["game_id", "season", "date", "team", "athlete_id", "athlete_display_name", "min", "pts", "played", "starter"]]


def rotation_from(tp, asof, window=WINDOW):
    """tp = ONE team's player-games. The team's rotation going into `asof` -> DataFrame [athlete_id, name, mpg, ppg, gp]."""
    tp = tp[tp.date < asof]
    season = nd.current_season(pd.Timestamp(asof))
    if tp[tp.season == season].game_id.nunique() < window:
        # early in a season the 20-game window would reach into last spring (tank line-ups, playoff rotations, a star who sat out April):
        # the whole previous season is averaged in with this season's games instead, until this season has 20 games of its own
        h = tp[(tp.season >= season - 1) & tp.played]
    else:
        last = tp.groupby("game_id").date.first().sort_values().index[-window:]
        h = tp[tp.game_id.isin(last) & tp.played]
    gp = h.groupby("athlete_id").agg(name=("athlete_display_name", "last"), mpg=("min", "mean"),
                                     ppg=("pts", "mean"), gp=("game_id", "nunique"))
    gp = gp[(gp.gp >= MIN_PLAYED) & (gp.mpg >= MIN_MPG)]
    return gp.reset_index()


def rotation_now(p, team, asof, window=WINDOW):
    """Live use: the team's rotation going into `asof`."""
    return rotation_from(p[p.team == team], asof, window)


def report_features(hist, pbox, weights, window=WINDOW):
    """Missing-player numbers the way the page can know them BEFORE tip-off: from the official injury report (nba_injuries.history),
    each listed rotation player counted by how often that status really sits (`weights`, status -> 0..1). One row per (game_id, team)
    on days that have a report. Same maths as live.Engine._missing, so a back-test of it is a back-test of what the page does."""
    import nba_injuries as ni
    pbox = pbox.copy()
    pbox["key"] = pbox.athlete_display_name.map(ni.norm)
    by_team = {t: g for t, g in pbox.groupby("team")}
    out = []
    for d, rep in hist.items():
        if not rep:
            continue
        day = pd.Timestamp(d).date()
        listed = {}
        for r in rep["rows"]:
            st = str(r.get("Current Status", "")).lower().replace(" ", "-")
            listed[(r.get("Team"), ni.norm(ni.flip_name(r.get("Player Name", ""))))] = weights.get(st, 0.0)
        for team, tp in by_team.items():
            games_today = tp[tp.date == day]
            if games_today.empty:
                continue
            rot = rotation_from(tp, day, window)
            if rot.empty:
                for gid in games_today.game_id.unique():
                    out.append((gid, team, 0.0, 0.0, 0)); 
                continue
            rot = rot.assign(key=rot.name.map(ni.norm))
            w = rot.key.map(lambda k: listed.get((team, k), 0.0)).values
            top = int(np.argmax(rot.ppg.values))
            for gid in games_today.game_id.unique():
                out.append((gid, team, float((w * rot.mpg.values).sum()), float((w * rot.ppg.values).sum()), int(w[top] >= 0.9)))
    return pd.DataFrame(out, columns=["game_id", "team", "missing_min_r", "missing_pts_r", "star_out_r"])


def build(seasons=None, window=WINDOW):
    """One row per (game_id, team). Per team: a games x players table, then rolling sums over the previous
    `window` games, so a game never sees itself or anything after it."""
    p = player_games(seasons)
    out = []
    for team, tp in p.groupby("team"):
        games = tp.groupby("game_id").date.first().sort_values()
        gidx = {g: i for i, g in enumerate(games.index)}
        pl = {a: j for j, a in enumerate(tp.athlete_id.unique())}
        G, N = len(games), len(pl)
        gi = tp.game_id.map(gidx).values
        pj = tp.athlete_id.map(pl).values
        ok = tp.played.values
        P = np.zeros((G, N)); M = np.zeros((G, N)); S = np.zeros((G, N))
        P[gi[ok], pj[ok]] = 1.0
        M[gi[ok], pj[ok]] = tp["min"].values[ok]
        S[gi[ok], pj[ok]] = tp["pts"].values[ok]
        z = np.zeros((1, N))
        cP, cM, cS = (np.vstack([z, np.cumsum(x, axis=0)]) for x in (P, M, S))
        for i, gid in enumerate(games.index):
            lo = max(0, i - window)
            if i - lo < 8:
                out.append((gid, team, np.nan, np.nan, np.nan, np.nan))
                continue
            gp = cP[i] - cP[lo]
            with np.errstate(invalid="ignore", divide="ignore"):
                mpg = (cM[i] - cM[lo]) / gp
                ppg = (cS[i] - cS[lo]) / gp
            rot = (gp >= MIN_PLAYED) & (mpg >= MIN_MPG)
            if not rot.any():
                out.append((gid, team, 0.0, 0.0, 0, 0))
                continue
            miss = rot & (P[i] == 0)
            top = int(np.argmax(np.where(rot, ppg, -1)))
            out.append((gid, team, float(mpg[miss].sum()), float(ppg[miss].sum()), int(P[i, top] == 0), int(miss.sum())))
    return pd.DataFrame(out, columns=["game_id", "team", "missing_min", "missing_pts", "star_out", "n_missing"])


if __name__ == "__main__":
    f = build(range(2009, 2027))
    print(f.describe().round(2).to_string())
    f.to_pickle("/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/feat.pkl")


# ---------------------------------------------------------------------------------------------------------------
# Team context for combo patterns (last result, streak, rest, how the team has done against the line, ...).
# One streaming pass over games in date order. The context for a game is read BEFORE the game updates the state,
# so nothing in a row has seen its own result. Live use: replay history, then read the context of upcoming games.
# ---------------------------------------------------------------------------------------------------------------
from collections import deque

# ---------------------------------------------------------------------------------------------------------------
# Travel: how far a team flew since its previous game (only counted if that game was within the last 3 days).
# Arena coordinates (lat, lon), keyed by nba_data._norm names. Tested 10/14 on 22,004 games: the market already prices travel
# (adding it to the closing line changes the miss from 13.097 to 13.095), so it only enters as a pattern CONDITION and has to pass
# the same every-period + shuffle checks as everything else.
# ---------------------------------------------------------------------------------------------------------------
import math
ARENA = {"Atlanta Hawks": (33.76, -84.40), "Boston Celtics": (42.37, -71.06), "Brooklyn Nets": (40.68, -73.97), "Charlotte Hornets": (35.23, -80.84),
         "Chicago Bulls": (41.88, -87.67), "Cleveland Cavaliers": (41.50, -81.69), "Dallas Mavericks": (32.79, -96.81), "Denver Nuggets": (39.75, -105.01),
         "Detroit Pistons": (42.34, -83.06), "Golden State Warriors": (37.77, -122.39), "Houston Rockets": (29.75, -95.36), "Indiana Pacers": (39.76, -86.16),
         "LA Clippers": (34.04, -118.27), "Los Angeles Lakers": (34.04, -118.27), "Memphis Grizzlies": (35.14, -90.05), "Miami Heat": (25.78, -80.19),
         "Milwaukee Bucks": (43.04, -87.92), "Minnesota Timberwolves": (44.98, -93.28), "New Orleans Pelicans": (29.95, -90.08), "New York Knicks": (40.75, -73.99),
         "Oklahoma City Thunder": (35.46, -97.52), "Orlando Magic": (28.54, -81.38), "Philadelphia 76ers": (39.90, -75.17), "Phoenix Suns": (33.45, -112.07),
         "Portland Trail Blazers": (45.53, -122.67), "Sacramento Kings": (38.58, -121.50), "San Antonio Spurs": (29.43, -98.44), "Toronto Raptors": (43.64, -79.38),
         "Utah Jazz": (40.77, -111.90), "Washington Wizards": (38.90, -77.02)}
ALTITUDE = {"Denver Nuggets", "Utah Jazz"}


def travel_km(a, b):
    """Great-circle distance between two arenas (km); 0 if either is unknown."""
    a, b = nd._norm(a), nd._norm(b)
    if a not in ARENA or b not in ARENA or a == b:
        return 0.0
    la1, lo1, la2, lo2 = map(math.radians, (*ARENA[a], *ARENA[b]))
    return 6371.0 * math.acos(min(1.0, math.sin(la1) * math.sin(la2) + math.cos(la1) * math.cos(la2) * math.cos(lo1 - lo2)))


def schedule_index(sch):
    """{team: [(date, venue team), ...] sorted} from the season schedule (regular season, postponed / cancelled games left out): every
    game a team is set to play, so tonight's rest and travel do not depend on yesterday's box score having reached the data release."""
    out = {}
    if sch is None or not len(sch):
        return out
    s = sch[sch.season_type == 2] if "season_type" in sch else sch
    if "status_type_name" in s:
        s = s[~s.status_type_name.astype(str).str.upper().isin(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_CANCELLED"])]
    for r in s.itertuples():
        d = pd.Timestamp(r.game_date).date(); h = nd._norm(r.home_display_name); a = nd._norm(r.away_display_name)
        venue = None if str(getattr(r, "neutral_site", "")).lower() == "true" else h      # a neutral site (the Cup final): no travel measured
        out.setdefault(h, []).append((d, venue)); out.setdefault(a, []).append((d, venue))
    for v in out.values():
        v.sort()
    return out


def schedule_rest(idx, team, date, venue=None):
    """(rest days capped at 7, travel km from the last arena, date of that last game) for `team` on `date`, from the last scheduled
    game strictly before `date`. None when the schedule has no earlier game for the team (first game of the season)."""
    lst = idx.get(nd._norm(team)) if idx else None
    if not lst:
        return None
    date = pd.Timestamp(date).date()
    prev = [x for x in lst if x[0] < date]
    if not prev:
        return None
    last_date, last_venue = prev[-1]
    days = (date - last_date).days
    rest = min(days, 7) if days < 60 else 7
    trav = travel_km(last_venue, venue) if (venue and last_venue and days <= 3) else 0.0
    return rest, trav, last_date



class TeamState:
    def __init__(self):
        self.season = None
        self.last_date = None
        self.recent = deque(maxlen=10)       # dicts: win, margin, total, cover, over, dates
        self.dates = deque(maxlen=4)
        self.gp = 0
        self.wins = 0
        self.streak = 0
        self.last_venue = None     # home team of the previous game = where the team last played
        self.ats_w = 0; self.ats_n = 0          # season record against the closing line (games with a line, pushes left out)
        self.fg3a = 0.0; self.fga = 0.0         # season shot attempts, for the 3-point attempt share
        self.lg = None                          # the league's running season totals (shared dict), for "vs the league average"


def _ctx(st, date, venue=None):
    r = list(st.recent)
    last = r[-1] if r else None
    l5 = r[-5:]
    cov = [x["cover"] for x in l5 if x["cover"] is not None]
    ovr = [x["over"] for x in l5 if x["over"] is not None]
    nights4 = sum(1 for d in st.dates if (date - d).days <= 3)   # prior games in the 3 nights before (this game makes it +1)
    return {
        "rest": min((date - st.last_date).days, 7) if st.last_date and (date - st.last_date).days < 60 else 7,
        "gp": st.gp,
        "win_pct": st.wins / st.gp if st.gp else np.nan,
        "last_win": None if last is None else int(last["win"]),
        "last_margin": np.nan if last is None else last["margin"],
        "last_total": np.nan if last is None else last["total"],
        "last_cover": None if last is None or last["cover"] is None else last["cover"],
        "last_over": None if last is None or last["over"] is None else last["over"],
        "streak": st.streak,
        "avg_margin5": np.mean([x["margin"] for x in l5]) if len(l5) >= 3 else np.nan,
        "cover5": np.mean(cov) if len(cov) >= 3 else np.nan,
        "over5": np.mean(ovr) if len(ovr) >= 3 else np.nan,
        "games_in_4": nights4 + 1,
        "trav_km": travel_km(st.last_venue, venue) if (venue and st.last_venue and st.last_date and (date - st.last_date).days <= 3) else 0.0,
        # 10/16 rules: season ATS record (ATS REGRESSION), 3-point attempt share vs the league so far this season (3PT UNDER)
        "ats_pct": st.ats_w / st.ats_n if st.ats_n else np.nan,
        "ats_n": st.ats_n,
        "r3_rel": (st.fg3a / st.fga - st.lg["fg3a"] / st.lg["fga"]) if (st.gp >= 10 and st.fga > 0 and st.lg and st.lg.get("fga", 0) > 0) else np.nan,
    }


def team_context(g, return_states=False):
    """g: output of nba_data.games(). Returns g with ctx_h_* and ctx_a_* columns added (regular season and playoffs
    both update the state; patterns are only scanned on the regular season)."""
    g = g.sort_values(["date", "game_id"]).reset_index(drop=True)
    for c_ in ("fg3a_h", "fga_h", "fg3a_a", "fga_a"):
        if c_ not in g: g[c_] = np.nan
    S = {}; LG = {}
    H, A = [], []
    for r in g.itertuples():
        sh = S.setdefault(r.home, TeamState()); sa = S.setdefault(r.away, TeamState())
        for st in (sh, sa):
            if st.season != r.season:         # new season: record, streak and recent form start over
                st.season = r.season; st.recent.clear(); st.dates.clear(); st.gp = 0; st.wins = 0; st.streak = 0; st.last_venue = None
                st.ats_w = 0; st.ats_n = 0; st.fg3a = 0.0; st.fga = 0.0; st.lg = LG.setdefault(r.season, {"fg3a": 0.0, "fga": 0.0})
        H.append(_ctx(sh, r.date, r.home)); A.append(_ctx(sa, r.date, r.home))
        if r.margin != r.margin:        # no result yet (an upcoming game): read its context but don't update anything
            continue
        hl = r.home_line
        has_line = hl == hl
        has_tot = r.total_line == r.total_line
        for st, side in ((sh, 1), (sa, -1)):
            m = r.margin * side
            cover = None
            if has_line:
                d = m - (hl * side)       # team margin minus the line it was giving
                cover = None if d == 0 else int(d > 0)
            over = None
            if has_tot and r.total != r.total_line:
                over = int(r.total > r.total_line)
            win = m > 0
            st.recent.append({"win": win, "margin": m, "total": r.total, "cover": cover, "over": over})
            if cover is not None: st.ats_n += 1; st.ats_w += cover
            f3, fa = (r.fg3a_h, r.fga_h) if side == 1 else (r.fg3a_a, r.fga_a)
            if f3 == f3 and fa == fa and fa > 0: st.fg3a += f3; st.fga += fa; st.lg["fg3a"] += f3; st.lg["fga"] += fa
            st.dates.append(r.date); st.last_date = r.date; st.last_venue = r.home; st.gp += 1; st.wins += int(win)
            st.streak = (st.streak + 1 if st.streak > 0 else 1) if win else (st.streak - 1 if st.streak < 0 else -1)
    hdf = pd.DataFrame(H).add_prefix("h_"); adf = pd.DataFrame(A).add_prefix("a_")
    out = pd.concat([g, hdf, adf], axis=1)
    return (out, S) if return_states else out
