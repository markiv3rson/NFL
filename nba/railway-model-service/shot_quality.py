"""Shot quality from ESPN's play-by-play (sportsdataverse espn_nba_pbp, refreshed with the box scores): the numbers behind the card's
SHOT QUALITY totals rule (lib/cardpick.js shotRule; research/shot_quality.py + shot_quality_espn.py, 10/17).
Per shot: expected points = the make rate of shots like it (2 or 3, distance band, kind: dunk / tip / layup / hook / fade / jumper; rates from
every regular-season shot 2008-2026, data/shot_rates.json) x its value. Per game: field-goal points, expected field-goal points.
Per team before tonight (this season's games only): xtot10 = expected shot points of its games, last 10 (5+ games); luck20 = shot points
minus expected, both teams, its games, last 20 (10+ games); gp = games with shot data. Season references (means over this season's lined
games, computed from each game's pre-game numbers): cold_mu (home + away luck20) and sq_mu ((home + away xtot10) / 2 - closing total).
The site fires the rule when (home + away luck20) - cold_mu <= -6.9 (both 10+ games) or (home + away xtot10) / 2 - total - sq_mu >= 10.9
(both 5+ games)."""
import os, json, numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RATES_FILE = os.path.join(HERE, "data", "shot_rates.json")
PBP_COLS = ["game_id", "season", "season_type", "team_id", "home_team_id", "away_team_id", "type_text", "text", "shooting_play",
            "points_attempted", "scoring_play", "coordinate_x", "coordinate_y"]
BANDS = [-1, 1, 2, 3, 4, 7, 11, 15, 19, 22, 23, 25, 27, 30, 99]
KIND = [("dunk", "dunk"), ("tip", "tip"), ("layup|finger roll|putback", "layup"), ("hook", "hook"), ("fade", "fade")]
W_LUCK, W_X, MIN_LUCK, MIN_X = 20, 10, 10, 5
STALE_DAYS = 2               # play-by-play more than 2 days behind the box scores: the rule is off and the watchdog names the file


def shots(p):
    """Field-goal tries of a play-by-play frame: game_id, season, side (h / a), three, db (distance band, -1 unknown), kind, made, val."""
    if p is None or not len(p):
        return pd.DataFrame(columns=["game_id", "season", "side", "three", "db", "kind", "made", "val"])
    p = p.copy()
    if "points_attempted" not in p:
        p["points_attempted"] = np.nan
    p = p[(p.season_type == 2) & (p.shooting_play == True) & ~p.type_text.fillna("").str.contains("Free Throw")].copy()
    t = p.text.fillna("").str.lower()
    pa = pd.to_numeric(p.points_attempted, errors="coerce")
    p["three"] = np.where(pa.isin([2, 3]), (pa == 3).astype(int), t.str.contains("three point").astype(int))
    x, y = pd.to_numeric(p.coordinate_x, errors="coerce"), pd.to_numeric(p.coordinate_y, errors="coerce")
    ok = x.abs().le(47) & y.abs().le(25) & x.notna()
    d = np.sqrt((x.abs() - 41.75) ** 2 + y ** 2).where(ok)                      # basket at x = +-41.75 ft
    d = d.fillna(pd.to_numeric(t.str.extract(r"(\d+)-foot")[0], errors="coerce"))
    p["db"] = pd.cut(d.clip(0, 40), BANDS, labels=False).astype("float").fillna(-1).astype(int)
    k = p.type_text.fillna("").str.lower(); p["kind"] = "jump"
    for pat, lab in reversed(KIND):
        p.loc[k.str.contains(pat), "kind"] = lab
    p["made"] = p.scoring_play.fillna(False).astype(int); p["val"] = 2 + p.three
    tid, hid, aid = (pd.to_numeric(p[c], errors="coerce") for c in ("team_id", "home_team_id", "away_team_id"))   # team_id is a float in these files
    p["side"] = np.where(tid == hid, "h", np.where(tid == aid, "a", None))
    p = p[p.side.notna()]
    p["game_id"] = p.game_id.astype(str)
    return p[["game_id", "season", "side", "three", "db", "kind", "made", "val"]]


def build_rates(S, min_n=30):
    """Make rates by cell, with the two fallbacks, from a frame of shots(); written to data/shot_rates.json by research/shot_rates_build.py."""
    out = {}
    for key, name in ((["three", "db", "kind"], "cell"), (["three", "db"], "band"), (["three"], "type")):
        r = S.groupby(key).made.agg(["mean", "count"])
        out[name] = {"|".join(str(v) for v in (i if isinstance(i, tuple) else (i,))): round(float(m), 4) for i, (m, n) in r.iterrows() if n >= min_n}
    return out


def load_rates(path=RATES_FILE):
    try:
        return json.load(open(path))
    except Exception:
        return None


def expected(S, rates):
    """Expected points of each shot: cell rate, else 2/3 + distance band, else 2/3."""
    c = S.three.astype(str) + "|" + S.db.astype(str) + "|" + S.kind; b = S.three.astype(str) + "|" + S.db.astype(str); t = S.three.astype(str)
    m = c.map(rates.get("cell", {})).fillna(b.map(rates.get("band", {}))).fillna(t.map(rates.get("type", {})))
    return m.astype(float) * S.val


def game_table(S, rates):
    """Per game: home / away field-goal points (fg_h / fg_a) and expected field-goal points (xfg_h / xfg_a); the game table has its own pts_h."""
    if not len(S):
        return pd.DataFrame(columns=["game_id", "fg_h", "fg_a", "xfg_h", "xfg_a"])
    S = S.assign(xfg=expected(S, rates), fg=S.made * S.val)
    w = S.groupby(["game_id", "side"])[["fg", "xfg"]].sum().unstack("side")
    w.columns = [f"{a}_{b}" for a, b in w.columns]
    return w.reset_index().dropna()


def state(pbp, g, season, rates=None, G=None):
    """{"teams": {team name: {xtot10, luck20, gp}}, "cold_mu": .., "sq_mu": .., "games": n} for tonight, from this season's games so far.
    G: an already built game_table() (a replay reuses it)."""
    rates = rates or load_rates()
    if G is None:
        if rates is None or pbp is None or g is None or not len(g):
            return {}
        G = game_table(shots(pbp), rates)
    if g is None or not len(g):
        return {}
    s = g[(g.season == season) & (g.season_type == 2) & g.margin.notna()].copy()
    s["game_id"] = s.game_id.astype(str)
    last_final = pd.to_datetime(s.date).max() if len(s) else None
    s = s.merge(G, on="game_id", how="inner").sort_values("date")
    if not len(s):
        return {"teams": {}, "cold_mu": None, "sq_mu": None, "games": 0}
    last_pbp = pd.to_datetime(s.date).max()
    if last_final is not None and (last_final - last_pbp).days > STALE_DAYS:      # the play-by-play stopped updating: no rule on old numbers
        return {"teams": {}, "cold_mu": None, "sq_mu": None, "games": int(len(s)),
                "stale": f"play-by-play ends {last_pbp.date()}, box scores reach {last_final.date()}"}
    s["xtot"] = s.xfg_h + s.xfg_a
    s["luck"] = (s.fg_h - s.xfg_h) + (s.fg_a - s.xfg_a)
    long = pd.concat([s[["game_id", "date", "home", "xtot", "luck"]].rename(columns={"home": "team"}),
                      s[["game_id", "date", "away", "xtot", "luck"]].rename(columns={"away": "team"})]).sort_values(["team", "date"])
    grp = long.groupby("team")
    long["x10"] = grp.xtot.transform(lambda c: c.shift(1).rolling(W_X, min_periods=MIN_X).mean())          # pre-game, as in the research
    long["l20"] = grp.luck.transform(lambda c: c.shift(1).rolling(W_LUCK, min_periods=MIN_LUCK).mean())
    pre = long.set_index(["game_id", "team"])
    s["h_x10"] = [pre.x10.get((gid, t)) for gid, t in zip(s.game_id, s.home)]; s["a_x10"] = [pre.x10.get((gid, t)) for gid, t in zip(s.game_id, s.away)]
    s["h_l20"] = [pre.l20.get((gid, t)) for gid, t in zip(s.game_id, s.home)]; s["a_l20"] = [pre.l20.get((gid, t)) for gid, t in zip(s.game_id, s.away)]
    lined = s[s.total_line.notna()]
    cold = (lined.h_l20 + lined.a_l20).dropna(); sq = ((lined.h_x10 + lined.a_x10) / 2 - lined.total_line).dropna()
    teams = {}
    for t, x in long.groupby("team"):
        x = x.sort_values("date")
        teams[t] = {"xtot10": float(x.xtot.tail(W_X).mean()) if len(x) >= MIN_X else None,
                    "luck20": float(x.luck.tail(W_LUCK).mean()) if len(x) >= MIN_LUCK else None, "gp": int(len(x))}
    return {"teams": teams, "cold_mu": float(cold.mean()) if len(cold) else None, "sq_mu": float(sq.mean()) if len(sq) else None, "games": int(len(s))}


def ctx(st, team):
    """The keys the card reads, for one team: sq_x10, sq_l20, sq_gp, sq_cold_mu, sq_mu (missing data -> None)."""
    t = (st or {}).get("teams", {}).get(team) or {}
    return {"sq_x10": t.get("xtot10"), "sq_l20": t.get("luck20"), "sq_gp": t.get("gp", 0), "sq_cold_mu": (st or {}).get("cold_mu"), "sq_mu": (st or {}).get("sq_mu")}
