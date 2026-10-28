#!/usr/bin/env python3
"""
nba_data.py — NBA only. Downloads and joins the three public data sets the NBA models use.

  1. ESPN team box scores   (sportsdataverse releases)  -> points, shooting, rebounds, turnovers per team-game
  2. ESPN player box scores (sportsdataverse releases)  -> minutes, points, who played / who sat, starters
  3. Closing lines          (kyleskom OddsData.sqlite)  -> spread, total, moneyline, final score, 2008-2026

Season numbers use the year the season ENDS (2026 = the 2025-26 season).
Files are cached in ~/.nba_cache. The current season is re-downloaded; older seasons are not.
"""
import os, re, sqlite3, urllib.request
import numpy as np, pandas as pd

REL = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
ODDS_URL = "https://raw.githubusercontent.com/kyleskom/NBA-Machine-Learning-Sports-Betting/master/Data/OddsData.sqlite"
CACHE = os.environ.get("NBA_CACHE", os.path.expanduser("~/.nba_cache"))
STALE = {}   # files whose download failed this run and are read from the last copy: {name: error}. /health shows them; the site's watchdog names them.
FIRST_SEASON = 2008


def current_season(today=None):
    """Season number (ending year) that is in progress on `today`. NBA seasons start in October."""
    t = pd.Timestamp(today) if today is not None else pd.Timestamp.today()
    return t.year + 1 if t.month >= 9 else t.year


def _download(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        f.write(r.read())
    os.replace(tmp, path)


def _file(kind, name, season, fresh=None, columns=None):
    f = os.path.join(CACHE, f"{name}_{season}.parquet")
    if fresh is None:
        fresh = season >= current_season()
    if fresh or not os.path.exists(f):
        try:
            _download(f"{REL}/{kind}/{name}_{season}.parquet", f)
            STALE.pop(f"{name}_{season}", None)
        except Exception as e:
            if not os.path.exists(f):
                return None   # season file not published yet (e.g. preseason)
            STALE[f"{name}_{season}"] = str(e)[:120]      # the last copy is used, and the fact is recorded
    if columns:                                           # big files (play-by-play): read only what is needed
        import pyarrow.parquet as pq
        have = set(pq.read_schema(f).names)
        return pd.read_parquet(f, columns=[c for c in columns if c in have])
    return pd.read_parquet(f)


def team_box(season):
    return _file("espn_nba_team_boxscores", "team_box", season)


def player_box(season):
    return _file("espn_nba_player_boxscores", "player_box", season)


def schedule(season):
    return _file("espn_nba_schedules", "nba_schedule", season)


def pbp(season, columns=None):
    """ESPN play-by-play of a season (sportsdataverse espn_nba_pbp, refreshed with the box scores): shot_quality.py reads the shots."""
    return _file("espn_nba_pbp", "play_by_play", season, columns=columns)


def odds_file(fresh=False):
    f = os.path.join(CACHE, "OddsData.sqlite")
    if fresh or not os.path.exists(f):
        try:
            _download(ODDS_URL, f)
            STALE.pop("OddsData.sqlite", None)
        except Exception as e:
            if not os.path.exists(f):
                raise
            STALE["OddsData.sqlite"] = str(e)[:120]      # the public file has not changed since Jan 2026: the last copy is as good
    return f


# ESPN uses short names ("LA Clippers"); the odds file uses full ones ("Los Angeles Clippers").
_NAME_FIX = {"Los Angeles Clippers": "LA Clippers", "LA Clippers": "LA Clippers",
             "New Orleans Hornets": "New Orleans Pelicans", "New Orleans/Oklahoma City Hornets": "New Orleans Pelicans",
             "Charlotte Bobcats": "Charlotte Hornets", "New Jersey Nets": "Brooklyn Nets",
             "Seattle SuperSonics": "Oklahoma City Thunder"}


def _norm(n):
    return _NAME_FIX.get(n, n)


def load_odds():
    """Closing lines, one row per game. Lines are from the HOME team's side:
    home_line > 0 means the home team is favoured by that many points. ml_* are American prices."""
    con = sqlite3.connect(odds_file())
    names = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
    pick = {}
    for n in names:
        m = re.match(r"odds_(\d{4})-(\d\d)(_new)?$", n) or re.match(r"(\d{4})-(\d\d)$", n)
        if not m:
            continue
        y = int(m.group(1)) + 1
        isnew = n.endswith("_new") or not n.startswith("odds_")
        if y not in pick or (isnew and not pick[y].endswith("_new") and n.startswith("odds_")):
            pick[y] = n
        if n.startswith("odds_") and n.endswith("_new"):
            pick[y] = n
    out = []
    for y, n in sorted(pick.items()):
        d = pd.read_sql(f'select Date,Home,Away,OU,Spread,ML_Home,ML_Away,Points,Win_Margin from "{n}"', con)
        d["season"] = y
        out.append(d)
    o = pd.concat(out, ignore_index=True)
    for c in ["OU", "Spread", "ML_Home", "ML_Away", "Points", "Win_Margin"]:
        o[c] = pd.to_numeric(o[c], errors="coerce")
    o["date"] = pd.to_datetime(o["Date"]).dt.date
    o["home"] = o["Home"].map(_norm)
    o["away"] = o["Away"].map(_norm)
    # The spread column is signed in recent seasons and absolute in older ones; the moneyline favourite settles the sign.
    home_fav = o["ML_Home"] < o["ML_Away"]
    mag = o["Spread"].abs()
    o["home_line"] = np.where(home_fav, mag, -mag)
    o = o.rename(columns={"OU": "total_line", "ML_Home": "ml_home", "ML_Away": "ml_away"})
    return o[["season", "date", "home", "away", "home_line", "total_line", "ml_home", "ml_away", "Points", "Win_Margin"]]


def site_closes(fresh=True):
    """Closing lines the site recorded itself (Polymarket's last pre-tip line for every game, lib/closes.js). The public line file
    stops in January 2026, so these fill the gap. Needs SITE_URL (and SITE_LOGIN if the site has a login); falls back to the last
    copy saved on disk, and to nothing."""
    import base64, json
    f = os.path.join(CACHE, "site_closes.json")
    site = os.environ.get("SITE_URL", "").strip().rstrip("/")
    if fresh and site:
        try:
            req = urllib.request.Request(site + os.environ.get("SITE_API", "/api").strip().rstrip("/") + "/closes", headers={"Accept": "application/json", "User-Agent": "nba-model-service/1.0"})
            login = os.environ.get("SITE_LOGIN", "").strip()
            if login:
                req.add_header("Authorization", "Basic " + base64.b64encode(login.encode()).decode())
            bypass = os.environ.get("VERCEL_BYPASS", "").strip()
            if bypass:
                req.add_header("x-vercel-protection-bypass", bypass)
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.loads(r.read())
            if body.get("ok") and isinstance(body.get("closes"), list):
                os.makedirs(CACHE, exist_ok=True)
                old = json.load(open(f)) if os.path.exists(f) else []
                merged = {(c["date"], c["game"]): c for c in old}
                merged.update({(c["date"], c["game"]): c for c in body["closes"]})     # never lose a saved close
                tmp = f + ".new"
                json.dump(list(merged.values()), open(tmp, "w"))
                os.replace(tmp, f)                                                       # never a half-written file
                STALE.pop("site_closes", None)
        except Exception as e:
            STALE["site_closes"] = str(e)[:120]
    try:
        return json.load(open(f)) if os.path.exists(f) else []
    except Exception:
        return []                                                                      # a broken file must not stop the engine from loading


def _american(p):
    p = min(max(float(p), 0.01), 0.99)
    return -100 * p / (1 - p) if p >= 0.5 else 100 * (1 - p) / p


def fill_from_site_closes(g, closes):
    """Fill lines the public file does not have from the site's own recorded closes. Marks every row with line_src."""
    g = g.copy()
    if "line_src" not in g:
        g["line_src"] = np.where(g.home_line.notna(), "sbr", "")
    if not closes:
        return g
    abbr = _abbr_to_name()
    idx = {(pd.Timestamp(c["date"]).date(), abbr.get(c["home"]), abbr.get(c["away"])): c for c in closes if abbr.get(c["home"]) and abbr.get(c["away"])}
    for i in g.index[g.home_line.isna() & g.total_line.isna()]:
        c = idx.get((g.at[i, "date"], g.at[i, "home"], g.at[i, "away"]))
        if not c:
            continue
        # the same sanity bounds as the public file's lines: one corrupt read must not enter the history the win rates are built on
        hs, tl, mh = c.get("hs"), c.get("tl"), c.get("mlHome")
        got = False
        if hs is not None and abs(float(hs)) <= 30:
            g.at[i, "home_line"] = -float(hs); got = True
        if tl is not None and 150 <= float(tl) <= 300:
            g.at[i, "total_line"] = float(tl); got = True
        if mh is not None and 0.03 <= float(mh) <= 0.97:
            g.at[i, "ml_home"] = _american(mh); g.at[i, "ml_away"] = _american(1 - float(mh)); got = True
        if got:
            g.at[i, "line_src"] = "polymarket"
    return g


def fill_from_file(g):
    """Closing lines from data/kaggle_lines_2025_26.csv (public Kaggle 'nba-closing-lines-ats' files, 2024-25 and 2025-26 regular season;
    the main line file stops 2026-01-07). Fills games that still have no line, and replaces a public-file line that is 1+ (spread) / 2+ (total) off the Kaggle close. Rows get line_src = 'kaggle'; the opening spread /
    total are kept as open_home_line / open_total_line for the line-move tests."""
    g = g.copy()
    if "line_src" not in g:
        g["line_src"] = np.where(g.home_line.notna(), "sbr", "")
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "kaggle_lines_2025_26.csv")
    for c in ("open_home_line", "open_total_line"):
        if c not in g: g[c] = np.nan
    if not os.path.exists(f):
        return g
    k = pd.read_csv(f)
    k["date"] = pd.to_datetime(k.date_et).dt.date
    k["home"] = k.home_team.map(_norm); k["away"] = k.away_team.map(_norm)
    k = k.drop_duplicates(["date", "home", "away"], keep="last")
    m = g[["date", "home", "away", "pts_h", "pts_a"]].reset_index().merge(k, on=["date", "home", "away"], how="inner").set_index("index")
    # same rule as the main file: a line counts only when its own final score matches the box score
    m = m[(m.home_score == m.pts_h) & (m.away_score == m.pts_a)]
    g.loc[m.index, "open_home_line"] = -m.open_spread_home
    g.loc[m.index, "open_total_line"] = m.open_total
    # the public file's 2025-26 lines go bad from Nov 2025 (Dec 2025: 93 of 191 spreads off the Kaggle close by 1+, 42 by 3+; Polymarket's own
    # close sits 1.5 from Kaggle and 6 from the public file on those games) -> where both exist and they differ by 1+ (spread) or 2+ (total),
    # the Kaggle close replaces the public line (line_src 'kaggle_fix')
    hl, tl = g.loc[m.index, "home_line"].values, g.loc[m.index, "total_line"].values
    off = ((np.abs(hl + m.close_spread_home.values) >= 1) | (np.abs(tl - m.close_total.values) >= 2)) & ~np.isnan(hl) & ~np.isnan(tl)
    fix = m.index[off & m.close_spread_home.notna().values & m.close_total.notna().values]
    need = m.index[g.loc[m.index, "home_line"].isna().values & g.loc[m.index, "total_line"].isna().values]
    need = need.union(fix)
    mm = m.loc[need]
    g.loc[need, "home_line"] = -mm.close_spread_home
    g.loc[need, "total_line"] = mm.close_total
    p = mm.close_home_win_prob.clip(0.01, 0.99)
    g.loc[need, "ml_home"] = np.where(p >= 0.5, -100 * p / (1 - p), 100 * (1 - p) / p)
    g.loc[need, "ml_away"] = np.where((1 - p) >= 0.5, -100 * (1 - p) / p, 100 * p / (1 - p))
    g.loc[need, "line_src"] = "kaggle"
    g.loc[fix, "line_src"] = "kaggle_fix"
    return g


def _abbr_to_name():
    import json
    t = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "teams.json")))
    return {k: v["name"] for k, v in t.items()}


def team_games(seasons=None):
    """One row per team per game (regular season + playoffs), with box-score totals and the opponent's score."""
    seasons = seasons or range(FIRST_SEASON, current_season() + 1)
    rows = []
    for s in seasons:
        t = team_box(s)
        if t is None or not len(t):
            continue
        rows.append(t)
    t = pd.concat(rows, ignore_index=True)
    t = t[t.season_type.isin([2, 3])].copy()
    t["date"] = pd.to_datetime(t["game_date"]).dt.date
    t["team"] = t["team_display_name"].map(_norm)
    t["opp"] = t["opponent_team_display_name"].map(_norm)
    t["home"] = (t["team_home_away"] == "home").astype(int)
    t["pts"] = pd.to_numeric(t["team_score"])
    t["opp_pts"] = pd.to_numeric(t["opponent_team_score"])
    for c in ["field_goals_attempted", "offensive_rebounds", "turnovers", "free_throws_attempted",
              "three_point_field_goals_attempted", "three_point_field_goals_made", "field_goals_made",
              "free_throws_made", "total_rebounds", "assists"]:
        t[c] = pd.to_numeric(t[c], errors="coerce")
    t["poss"] = t.field_goals_attempted - t.offensive_rebounds + t.turnovers + 0.44 * t.free_throws_attempted
    t = t.dropna(subset=["pts", "opp_pts"]).sort_values(["date", "game_id", "home"]).reset_index(drop=True)
    return t[["game_id", "season", "season_type", "date", "team", "opp", "home", "pts", "opp_pts", "poss",
              "field_goals_attempted", "field_goals_made", "three_point_field_goals_attempted",
              "three_point_field_goals_made", "free_throws_attempted", "free_throws_made",
              "offensive_rebounds", "total_rebounds", "turnovers", "assists", "team_abbreviation"]]


def games(seasons=None):
    """One row per game: home/away scores, possessions, rest days, and the closing line when we have it."""
    tg = team_games(seasons)
    h = tg[tg.home == 1].set_index("game_id")
    a = tg[tg.home == 0].set_index("game_id")
    g = h.join(a, lsuffix="_h", rsuffix="_a", how="inner").reset_index()
    g = g.rename(columns={"team_h": "home", "team_a": "away", "date_h": "date", "season_h": "season",
                          "season_type_h": "season_type"})
    g["poss"] = (g.poss_h + g.poss_a) / 2
    g["margin"] = g.pts_h - g.pts_a            # home minus away
    g["total"] = g.pts_h + g.pts_a
    g = g.sort_values(["date", "game_id"]).reset_index(drop=True)
    # Rest: days since each team's previous game (7 = long rest / first game of season, so nothing looks like a back-to-back)
    last = {}
    rh, ra = [], []
    for r in g.itertuples():
        for team, out in ((r.home, rh), (r.away, ra)):
            p = last.get(team)
            out.append(min((r.date - p).days, 7) if p is not None and (r.date - p).days < 60 else 7)
        last[r.home] = r.date
        last[r.away] = r.date
    g["rest_h"], g["rest_a"] = rh, ra
    keep = ["game_id", "season", "season_type", "date", "home", "away", "pts_h", "pts_a", "margin", "total", "poss",
            "rest_h", "rest_a", "team_abbreviation_h", "team_abbreviation_a", "fg3a_h", "fga_h", "fg3a_a", "fga_a"]
    g = g.rename(columns={"three_point_field_goals_attempted_h": "fg3a_h", "field_goals_attempted_h": "fga_h", "three_point_field_goals_attempted_a": "fg3a_a", "field_goals_attempted_a": "fga_a"})
    g = g[keep]
    o = load_odds()
    g = g.merge(o.drop(columns=["season"]), on=["date", "home", "away"], how="left")
    # A line only counts when the odds file's own final score matches the box score and the numbers are sane
    # (the 2008-2011 file has a few typos such as totals of 1, 47 or 1955, and a few wrong-day matches).
    ok = ((g.Points == g.total) & (g.Win_Margin == g.margin)
          & g.total_line.between(150, 300) & g.home_line.abs().le(30))
    for c in ["home_line", "total_line", "ml_home", "ml_away"]:
        g.loc[~ok, c] = np.nan
    g = g.drop(columns=["Points", "Win_Margin"])
    return fill_from_site_closes(fill_from_file(g), site_closes())


if __name__ == "__main__":
    g = games()
    print(len(g), "games", g.season.min(), "-", g.season.max())
    print("with a closing line:", g.home_line.notna().sum())
    print(g.groupby("season").agg(n=("game_id", "count"), lines=("home_line", lambda s: s.notna().sum())).T.to_string())
