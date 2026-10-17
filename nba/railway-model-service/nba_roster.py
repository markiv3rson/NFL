#!/usr/bin/env python3
"""
nba_roster.py — NBA only. How much of last season's playing time is still on each team.

  returning % = (minutes last season by players who are on the roster now) / (all of the team's minutes last season)

Why: the ratings come from the last 800 days of games, so a team that lost half its rotation still carries the old players' strength.
Measured 10/14 on 480 team-seasons: teams keeping 80%+ of their minutes beat the ratings-and-last-year prediction by 3.6 wins on average,
teams keeping under 55% missed by 1.7 (season_sim.fit_blend turns that into one more weight, fitted with the season held out).

History: "on the roster" = the players who appeared in the team's first 10 games of the season (the file has no preseason rosters).
Live:    ESPN's current team rosters (names matched after stripping accents / Jr. / III). If ESPN can't be reached the term is simply
         left out (returning_now() returns None) — nothing breaks.
"""
import json, subprocess, unicodedata, urllib.request
import numpy as np, pandas as pd
import nba_data as nd

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"


def norm_name(s):
    t = "".join(c for c in unicodedata.normalize("NFKD", str(s)) if not unicodedata.combining(c)).lower()
    for x in (".", "'", ","):
        t = t.replace(x, "")
    for suf in (" jr", " sr", " iii", " ii", " iv"):
        if t.endswith(suf):
            t = t[: -len(suf)]
    return t.strip()


def _minutes(df):
    return pd.to_numeric(df.minutes, errors="coerce").fillna(0.0)


def returning_history(first=2010, last=None):
    """DataFrame [season, team, ret] (ret in percent) for every team-season with a previous season on file."""
    last = last or nd.current_season() - 1
    rows = []
    boxes = {}
    for s in range(first - 1, last + 1):
        pb = nd.player_box(s)
        if pb is None or not len(pb):
            continue
        pb = pb[pb.season_type == 2].copy()
        pb["min_"] = _minutes(pb); pb["tn"] = pb.team_display_name.map(nd._norm)
        boxes[s] = pb
    for s in range(first, last + 1):
        cur, prev = boxes.get(s), boxes.get(s - 1)
        if cur is None or prev is None:
            continue
        for t, g in cur.groupby("tn"):
            order = g.groupby("game_id").game_date.first().sort_values().index[:10]
            roster = set(g[g.game_id.isin(order)].athlete_id)
            pt = prev[prev.tn == t]; tot = pt.min_.sum()
            if tot > 0:
                rows.append({"season": s, "team": t, "ret": float(pt[pt.athlete_id.isin(roster)].min_.sum() / tot * 100)})
    return pd.DataFrame(rows)


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "nba-slate/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception:
        # some hosts / proxies only talk to curl (the cloud sandbox); same request, same JSON
        out = subprocess.run(["curl", "-s", "-m", str(timeout), "-H", "Accept: application/json", url], capture_output=True, text=True, timeout=timeout + 5).stdout
        return json.loads(out)


def returning_now(season=None):
    """{team name: returning %} from ESPN's current rosters and last season's player box scores, or None if ESPN can't be read."""
    season = season or nd.current_season()
    try:
        prev = nd.player_box(season - 1)
        if prev is None:
            return None
        prev = prev[prev.season_type == 2].copy()
        prev["min_"] = _minutes(prev); prev["tn"] = prev.team_display_name.map(nd._norm); prev["key"] = prev.athlete_display_name.map(norm_name)
        teams = _get(f"{ESPN}/teams")["sports"][0]["leagues"][0]["teams"]
        out = {}
        for t in teams:
            tm = t["team"]
            names = {norm_name(a.get("displayName", "")) for a in _get(f"{ESPN}/teams/{tm['id']}/roster").get("athletes", [])}
            pt = prev[prev.tn == nd._norm(tm["displayName"])]; tot = pt.min_.sum()
            if tot > 0 and names:
                out[nd._norm(tm["displayName"])] = float(pt[pt.key.isin(names)].min_.sum() / tot * 100)
        return out if len(out) >= 28 else None
    except Exception as e:
        print("[roster] could not read ESPN rosters:", str(e)[:100], flush=True)
        return None
