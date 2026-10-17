"""Rebuild the five players on the floor for every possession stretch ("stint") from nba.com play-by-play (public mirror shufinskiy/nba_data,
nbastats_<start year>.tar.xz: one row per event, EVENTMSGTYPE 8 = substitution with PLAYER1 out and PLAYER2 in).
Who starts a period: every player with an event in that period before his first substitution IN, plus players subbed OUT before being
subbed in. A player who starts a period and records nothing before leaving the floor... is caught by his sub-out; one who plays the whole
period without any event is missed: the period's lineup is then filled from the previous period's closing five when that is consistent, else
the stretch is marked incomplete and left out of the ratings.
Per stint: seconds, home and away points (from the running score), possessions (field-goal tries + 0.44 x free-throw trips - offensive
rebounds + turnovers, both teams together, halved), the ten player ids.
Usage: python3 research/lineups_build.py <dir with nbastats_<y>.csv> <out.parquet>"""
import sys, os, glob, re, numpy as np, pandas as pd
SRC, OUT = sys.argv[1], sys.argv[2]
COLS = ["GAME_ID", "EVENTNUM", "EVENTMSGTYPE", "EVENTMSGACTIONTYPE", "PERIOD", "PCTIMESTRING", "SCORE", "HOMEDESCRIPTION", "VISITORDESCRIPTION",
        "PERSON1TYPE", "PLAYER1_ID", "PLAYER1_TEAM_ID", "PERSON2TYPE", "PLAYER2_ID", "PLAYER2_TEAM_ID", "PERSON3TYPE", "PLAYER3_ID", "PLAYER3_TEAM_ID"]
def secs(t):
    m, s = str(t).split(":"); return int(m) * 60 + int(s)
def plen(p): return 720 if p <= 4 else 300
out = []
for f in sorted(glob.glob(os.path.join(SRC, "nbastats_*.csv"))):
    y = int(re.search(r"_(\d{4})\.csv$", f).group(1)); season = y + 1
    d = pd.read_csv(f, usecols=COLS, dtype={"GAME_ID": str}, low_memory=False)
    d = d[d.GAME_ID.str.lstrip("0").str.startswith("2")]                     # regular season only
    d = d.sort_values(["GAME_ID", "PERIOD", "EVENTNUM"])
    n_ok = n_all = 0
    for gid, ev in d.groupby("GAME_ID", sort=False):
        ev = ev.reset_index(drop=True)
        # home / away team ids from player rows (PERSONTYPE 4 = home player, 5 = away player)
        home_tid = ev.loc[ev.PERSON1TYPE == 4, "PLAYER1_TEAM_ID"].dropna(); away_tid = ev.loc[ev.PERSON1TYPE == 5, "PLAYER1_TEAM_ID"].dropna()
        if home_tid.empty or away_tid.empty: continue
        H, A = home_tid.mode()[0], away_tid.mode()[0]
        prev_close = {H: set(), A: set()}; hs = as_ = 0
        for per, pe in ev.groupby("PERIOD", sort=True):
            pe = pe.reset_index(drop=True)
            # starters of this period
            first_in, seen = {}, {H: [], A: []}
            starters = {H: set(), A: set()}
            for r in pe.itertuples(index=False):
                if r.EVENTMSGTYPE == 8:
                    pin, pout, tid = r.PLAYER2_ID, r.PLAYER1_ID, r.PLAYER1_TEAM_ID
                    if tid in starters and pout not in first_in: starters[tid].add(pout)
                    first_in.setdefault(pin, True)
                    continue
                for pt, pid, tid in ((r.PERSON1TYPE, r.PLAYER1_ID, r.PLAYER1_TEAM_ID), (r.PERSON2TYPE, r.PLAYER2_ID, r.PLAYER2_TEAM_ID), (r.PERSON3TYPE, r.PLAYER3_ID, r.PLAYER3_TEAM_ID)):
                    if pt in (4, 5) and pid and tid in starters and pid not in first_in and r.EVENTMSGTYPE not in (9, 11, 18):
                        if not (r.EVENTMSGTYPE == 6 and r.EVENTMSGACTIONTYPE in (11, 12, 13, 18, 19, 25, 30)):   # technical-type fouls can come from the bench
                            starters[tid].add(pid)
            for tid in (H, A):
                if len(starters[tid]) < 5 and len(prev_close[tid]) == 5:
                    for p in prev_close[tid]:
                        if len(starters[tid]) >= 5: break
                        if p not in first_in: starters[tid].add(p)
            on = {H: set(starters[H]), A: set(starters[A])}
            t0 = plen(per); st = dict(t=t0, hs=hs, as_=as_, fga=0, fta=0, oreb=0, tov=0); last_miss = None
            def close(t_end):
                ok = len(on[H]) == 5 and len(on[A]) == 5
                sec = st["t"] - t_end
                if sec > 0 or (hs - st["hs"]) or (as_ - st["as_"]):
                    out.append((season, gid, per, sec, hs - st["hs"], as_ - st["as_"], (st["fga"] + 0.44 * st["fta"] - st["oreb"] + st["tov"]) / 2.0,
                                tuple(sorted(on[H])) if ok else None, tuple(sorted(on[A])) if ok else None))
            for r in pe.itertuples(index=False):
                t = secs(r.PCTIMESTRING) if isinstance(r.PCTIMESTRING, str) and ":" in r.PCTIMESTRING else st["t"]
                if isinstance(r.SCORE, str) and " - " in r.SCORE:
                    a_, h_ = r.SCORE.split(" - "); as_, hs = int(a_), int(h_)
                et = r.EVENTMSGTYPE
                if et in (1, 2):
                    st["fga"] += 1
                    if et == 2: last_miss = r.PLAYER1_TEAM_ID
                elif et == 3 and str(r.EVENTMSGACTIONTYPE) in ("10", "12", "15"): st["fta"] += 1        # one per free-throw trip (its last shot)
                elif et == 4 and r.PERSON1TYPE in (4, 5):                                               # player rebound: offensive if his team missed last
                    if last_miss is not None and r.PLAYER1_TEAM_ID == last_miss: st["oreb"] += 1
                    last_miss = None
                elif et == 5: st["tov"] += 1
                if et == 8:
                    tid = r.PLAYER1_TEAM_ID
                    if tid in on:
                        close(t); st.update(t=t, hs=hs, as_=as_, fga=0, fta=0, oreb=0, tov=0)
                        on[tid].discard(r.PLAYER1_ID); on[tid].add(r.PLAYER2_ID)
            close(0); prev_close = {H: set(on[H]), A: set(on[A])}
        n_all += 1
    print(f"{season}: games {n_all}", flush=True)
S = pd.DataFrame(out, columns=["season", "nba_game_id", "period", "secs", "hpts", "apts", "poss", "home5", "away5"])
S["ok"] = S.home5.notna()
print(f"stints {len(S):,} | complete lineups {100*S.ok.mean():.1f}% of stints, {100*S[S.ok].secs.sum()/S.secs.sum():.1f}% of minutes", flush=True)
S["home5"] = S.home5.map(lambda t: ",".join(str(int(x)) for x in t) if t else None); S["away5"] = S.away5.map(lambda t: ",".join(str(int(x)) for x in t) if t else None)
S.to_parquet(OUT)
