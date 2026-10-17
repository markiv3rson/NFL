#!/usr/bin/env python3
"""
player_model.py — NBA only. Player-level rating test (the NFL app's "player-level rating" idea), honest protocol.
For every game each team's strength is built from ITS PLAYERS going in: per-minute plus-minus and box-score value, shrunk toward 0,
weighted by the minutes each player has been getting. Two versions: all rotation players (what we can know before tip-off, ignoring
the injury report) and only players who actually played (hindsight ceiling). Then: does adding it to the closing line explain any of the
market's miss, with each season left out?  Run: python3 research/player_model.py out.pkl
"""
import sys, collections, numpy as np, pandas as pd
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))
import nba_data as nd, nba_features as nf

def raw_players(seasons):
    rows = []
    for s in seasons:
        p = nd.player_box(s)
        if p is not None and len(p): rows.append(p)
    p = pd.concat(rows, ignore_index=True); p = p[p.season_type == 2].copy()
    p["team"] = p.team_display_name.map(nd._norm); p["date"] = pd.to_datetime(p.game_date).dt.date
    num = lambda c: pd.to_numeric(p[c], errors="coerce").fillna(0.0)
    p["min"] = num("minutes"); p["pm"] = num("plus_minus")
    p["gs"] = (num("points") + 0.4 * num("field_goals_made") - 0.7 * num("field_goals_attempted") - 0.4 * (num("free_throws_attempted") - num("free_throws_made"))
               + 0.7 * num("offensive_rebounds") + 0.3 * num("defensive_rebounds") + num("steals") + 0.7 * num("assists") + 0.7 * num("blocks") - 0.4 * num("fouls") - num("turnovers"))
    p["played"] = (p["min"] > 0) & (~p.did_not_play.fillna(False).astype(bool))
    p["name"] = p.athlete_display_name
    return p[p.team.isin(nd_teams())][["game_id", "season", "date", "team", "athlete_id", "name", "min", "pm", "gs", "played"]].sort_values(["date", "game_id"])

def nd_teams():
    import json, os
    return set(v["name"] for v in json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "teams.json"))).values())

SHR = 600.0      # minutes of shrinkage toward average
HL = 1500.0      # decay: a player's old minutes count half after ~1500 minutes (about a season)
def run(p, listed=None):
    """listed: {date: {(team, normalized name): weight}} from the official injury report (0..1 = chance the player sits)."""
    import nba_injuries as ni
    rating = collections.defaultdict(lambda: [0.0, 0.0, 0.0])    # athlete -> [sum pm48*min, sum gs48*min, sum min] (decayed)
    recent = collections.defaultdict(lambda: collections.deque(maxlen=20))   # team -> deque of {athlete: min}
    out = []; rep_out = []
    for gid, g in p.groupby("game_id", sort=False):
        for team, t in g.groupby("team"):
            hist = recent[team]
            mp = collections.defaultdict(float); n = collections.Counter()
            for d in hist:
                for a, m in d.items():
                    if m > 0: mp[a] += m; n[a] += 1
            actual = {r.athlete_id: r.min for r in t.itertuples() if r.played}
            def strength(weights):
                tot = sum(weights.values()) or 1.0; s_pm = s_gs = 0.0; rs = []
                for a, w in weights.items():
                    sp, sg, sm = rating[a]; r_pm = sp / (sm + SHR); r_gs = sg / (sm + SHR)
                    s_pm += w / tot * r_pm; s_gs += w / tot * r_gs; rs.append((w, r_pm, r_gs))
                rs.sort(reverse=True); top = rs[:3]
                return s_pm, s_gs, np.mean([x[1] for x in top]) if top else 0.0, np.mean([x[2] for x in top]) if top else 0.0
            names = dict(zip(t.athlete_id, t.name)); dt = t.date.iloc[0]
            rep = (listed or {}).get(str(dt))
            if len(hist) >= 8 and rep is not None:
                exp2 = {}
                for a, m in mp.items():
                    if n[a] >= 4 and m / n[a] >= 10:
                        nm = names.get(a)
                        w = rep.get((team, ni.norm(nm)), 0.0) if nm else 0.0
                        exp2[a] = m / len(hist) * (1 - w)
                r_pm, r_gs, rt_pm, rt_gs = strength(exp2) if exp2 else (0, 0, 0, 0)
                rep_out.append((gid, team, r_pm, r_gs, rt_pm, rt_gs))
            if len(hist) >= 8:
                exp_w = {a: mp[a] / len(hist) for a in mp if n[a] >= 4 and mp[a] / n[a] >= 10}
                a_pm, a_gs, t_pm, t_gs = strength(exp_w) if exp_w else (0, 0, 0, 0)
                act_w = {a: m for a, m in actual.items() if m >= 4}
                b_pm, b_gs, bt_pm, bt_gs = strength(act_w) if act_w else (0, 0, 0, 0)
                out.append((gid, team, a_pm, a_gs, t_pm, t_gs, b_pm, b_gs, bt_pm, bt_gs))
            hist.append(actual)
        for r in g.itertuples():           # update ratings AFTER the game is processed for both teams
            if r.played and r.min > 0:
                R = rating[r.athlete_id]; k = 0.5 ** (r.min / HL)
                R[0] = R[0] * k + r.pm / r.min * 48 * r.min; R[1] = R[1] * k + r.gs / r.min * 48 * r.min; R[2] = R[2] * k + r.min
    f = pd.DataFrame(out, columns=["game_id", "team", "a_pm", "a_gs", "t_pm", "t_gs", "b_pm", "b_gs", "bt_pm", "bt_gs"])
    if rep_out:
        f = f.merge(pd.DataFrame(rep_out, columns=["game_id", "team", "r_pm", "r_gs", "rt_pm", "rt_gs"]), on=["game_id", "team"], how="left")
    return f

if __name__ == "__main__":
    p = raw_players(range(2008, nd.current_season() + 1))
    import json, nba_injuries as ni
    hist = ni.history(max_seconds=0); w = json.load(open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))), "data", "injury_weights.json"))); w = w.get("weights", w)
    listed = {}
    for d, rep in hist.items():
        if not rep: continue
        m = {}
        for r in rep["rows"]:
            st = str(r.get("Current Status", "")).lower().replace(" ", "-")
            m[(r.get("Team"), ni.norm(ni.flip_name(r.get("Player Name", ""))))] = w.get(st, 0.0)
        listed[d] = m
    f = run(p, listed); f.to_pickle(sys.argv[1] if len(sys.argv) > 1 else "player_feats.pkl"); print(len(f), "team-games")
