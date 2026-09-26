#!/usr/bin/env python3
"""
td_matchup.py — NFL matchup + Anytime TD research report (public nflverse play-by-play).

Usage:
  python3 td_matchup.py --away ATL --home GB
  python3 td_matchup.py --away ATL --home GB --season 2026 \
      --out "J.Reed,A.Banks" \
      --prices "T.Kraft=31/70,Bi.Robinson=57/44,M.Golden=31/70"

What it does (current season, regular season, all weeks played so far):
  1. Usage per offense: targets, target share, red-zone (<=20) and inside-10 targets,
     carries, RZ carries, inside-5 carries, TDs.
  2. Opponent defense: red-zone drives + TD rate, TDs allowed by position (RB/WR/TE/QB)
     and type (rush/rec), with the scorer of every TD.
  3. Pass-direction splits (left/middle/right) and run-direction splits (by gap),
     offense vs. what the opposing defense allows.
  4. Anytime TD ranking, at least 2 per team: usage x what the opponent allows at the
     player's position. The score is a RANKING AID, not a probability.
  5. Optional Polymarket Yes/No prices -> de-vigged market probability.

Rules baked in (NFL Research Protocol):
  - Player's team/position come from the latest weekly roster (catches wrong pairings).
  - Samples under 10 red-zone drives are flagged SMALL SAMPLE.
  - Nothing here is a fair probability. Market price is never your fair probability.
"""
import argparse, os, sys, urllib.request
import pandas as pd

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
CACHE = os.path.expanduser("~/.nfl_cache")


def fetch(path, fresh=True):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, path.replace("/", "_"))
    if fresh or not os.path.exists(local):
        urllib.request.urlretrieve(f"{BASE}/{path}", local)
    return pd.read_parquet(local)


def load(season):
    pbp = fetch(f"pbp/play_by_play_{season}.parquet")
    pbp = pbp[pbp.season_type == "REG"].copy()
    ros = fetch(f"weekly_rosters/roster_weekly_{season}.parquet")
    ros = ros.sort_values("week").drop_duplicates("gsis_id", keep="last")
    pos = ros.set_index("gsis_id")[["position", "team", "full_name"]]
    return pbp, pos


def pos_of(pid, pos):
    try:
        p = pos.loc[pid, "position"]
        return {"FB": "RB", "HB": "RB"}.get(p, p)
    except KeyError:
        return "?"


def usage(pbp, pos, team):
    pas = pbp[(pbp.posteam == team) & (pbp.pass_attempt == 1) & (pbp.sack != 1) & pbp.receiver_player_id.notna()]
    run = pbp[(pbp.posteam == team) & (pbp.rush_attempt == 1) & (pbp.qb_scramble != 1) & pbp.rusher_player_id.notna()]
    rows = {}
    def r(pid, name):
        return rows.setdefault(pid, dict(pid=pid, player=name, pos=pos_of(pid, pos), cur_team=(pos.loc[pid, "team"] if pid in pos.index else "?"),
                                         tgt=0, rz_tgt=0, i10_tgt=0, car=0, rz_car=0, i5_car=0, rec_td=0, rush_td=0))
    for _, x in pas.iterrows():
        d = r(x.receiver_player_id, x.receiver_player_name)
        d["tgt"] += 1; d["rz_tgt"] += x.yardline_100 <= 20; d["i10_tgt"] += x.yardline_100 <= 10
        d["rec_td"] += int(x.pass_touchdown == 1)
    for _, x in run.iterrows():
        d = r(x.rusher_player_id, x.rusher_player_name)
        d["car"] += 1; d["rz_car"] += x.yardline_100 <= 20; d["i5_car"] += x.yardline_100 <= 5
        d["rush_td"] += int(x.rush_touchdown == 1)
    df = pd.DataFrame(rows.values())
    if df.empty:
        return df
    df["tgt_share%"] = (df.tgt / max(df.tgt.sum(), 1) * 100).round(1)
    df["td"] = df.rec_td + df.rush_td
    df["games"] = pbp[pbp.posteam == team].game_id.nunique()
    return df.sort_values(["rz_tgt", "rz_car", "tgt"], ascending=False)


def defense(pbp, pos, team):
    s = pbp[pbp.defteam == team]
    rz = s[s.yardline_100 <= 20].groupby(["game_id", "drive"]).touchdown.max()
    tds = s[(s.touchdown == 1) & (s.td_team == s.posteam) & ((s.pass_touchdown == 1) | (s.rush_touchdown == 1))]
    allowed = []
    for _, x in tds.iterrows():
        if x.pass_touchdown == 1:
            allowed.append(("rec", pos_of(x.receiver_player_id, pos), x.receiver_player_name, x.posteam, int(x.yards_gained)))
        else:
            allowed.append(("rush", pos_of(x.rusher_player_id, pos), x.rusher_player_name, x.posteam, int(x.yards_gained)))
    a = pd.DataFrame(allowed, columns=["type", "pos", "scorer", "opp", "yds"])
    games = s.game_id.nunique()
    return dict(games=games, rz_drives=len(rz), rz_td=int(rz.sum()), allowed=a)


def splits(pbp, team, side):
    key = "posteam" if side == "off" else "defteam"
    pas = pbp[(pbp[key] == team) & (pbp.pass_attempt == 1) & (pbp.sack != 1) & pbp.pass_location.notna()]
    p = pas.groupby("pass_location").agg(att=("play_id", "size"), comp_pct=("complete_pass", "mean"),
                                         ypa=("yards_gained", "mean"), td=("pass_touchdown", "sum"))
    p["comp_pct"] = (p.comp_pct * 100).round(1); p["ypa"] = p.ypa.round(1)
    run = pbp[(pbp[key] == team) & (pbp.rush_attempt == 1) & (pbp.qb_scramble != 1)].copy()
    run["dir"] = run.run_location.fillna("?") + "-" + run.run_gap.fillna("mid")
    run["expl"] = run.yards_gained >= 10
    q = run.groupby("dir").agg(car=("play_id", "size"), ypc=("yards_gained", "mean"),
                               expl_pct=("expl", "mean"), td=("rush_touchdown", "sum"))
    q["ypc"] = q.ypc.round(1); q["expl_pct"] = (q.expl_pct * 100).round(1)
    tot = dict(car=len(run), ypc=round(run.yards_gained.mean(), 2) if len(run) else 0,
               expl=round(run.expl.mean() * 100, 1) if len(run) else 0)
    return p, q, tot


def prior_rz(season, pos):
    """Last season red-zone opportunities per game played, by player id (context for tiny samples)."""
    try:
        p = fetch(f"pbp/play_by_play_{season - 1}.parquet")
    except Exception:
        return {}
    p = p[p.season_type == "REG"]
    rec = p[(p.pass_attempt == 1) & (p.sack != 1) & p.receiver_player_id.notna()]
    run = p[(p.rush_attempt == 1) & (p.qb_scramble != 1) & p.rusher_player_id.notna()]
    touch = pd.concat([rec[["receiver_player_id", "game_id", "yardline_100"]].rename(columns={"receiver_player_id": "pid"}),
                       run[["rusher_player_id", "game_id", "yardline_100"]].rename(columns={"rusher_player_id": "pid"})])
    g = touch.groupby("pid").game_id.nunique()
    rz = touch[touch.yardline_100 <= 20].groupby("pid").size()
    return (rz / g).round(2).to_dict()


def td_rank(u, d, outs, prior, n=8):
    """Ranking aid (NOT a probability).
    Rush side: red-zone / inside-5 carries, weighted by rush TDs the opponent allows.
    Receiving side: red-zone / inside-10 targets, weighted by receiving TDs the opponent allows at that position."""
    if u.empty:
        return u
    u = u[~u.player.isin(outs) & u.pos.isin(["RB", "WR", "TE", "QB"])].copy()
    a = d["allowed"]; g = max(d["games"], 1)
    rush_pg = len(a[a.type == "rush"]) / g
    rec_pg = {p: len(a[(a.type == "rec") & (a.pos == p)]) / g for p in ["RB", "WR", "TE", "QB"]}
    G = u.games
    rush_part = (2 * u.rz_car + 3 * u.i5_car) / G + 0.1 * u.car / G
    rec_part = (2 * u.rz_tgt + 3 * u.i10_tgt) / G + 0.15 * u.tgt / G
    u["opp_rush_td_pg"] = round(rush_pg, 2)
    u["opp_rec_td_pg_pos"] = u.pos.map(lambda p: round(rec_pg.get(p, 0), 2))
    u["rz_opp_pg"] = ((u.rz_tgt + u.rz_car) / G).round(2)
    u["prior_rz_pg"] = u.index.map(lambda i: None)
    u["prior_rz_pg"] = [prior.get(pid) for pid in u["pid"]]
    cur = rush_part * (0.5 + rush_pg) + rec_part * (0.5 + u.opp_rec_td_pg_pos)
    # Shrink tiny current samples toward last season: prior counts as K games.
    K = 3
    mult = u.apply(lambda r: (0.5 + rush_pg) if r.car > r.tgt else (0.5 + rec_pg.get(r.pos, 0)), axis=1)
    pr = pd.Series([prior.get(pid) for pid in u.pid], index=u.index)
    prior_part = (2 * pr * mult).where(pr.notna(), cur)
    u["score"] = ((cur * G + prior_part * K) / (G + K) + 0.5 * u.td / G).round(2)
    return u.sort_values("score", ascending=False).head(n)


def devig(prices):
    out = []
    for item in [p for p in prices.split(",") if p.strip()]:
        name, px = item.split("=")
        y, no = [float(v) for v in px.split("/")]
        out.append((name.strip(), y, no, round(y / (y + no) * 100, 1)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--away", required=True); ap.add_argument("--home", required=True)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--out", default="", help="comma list of pbp names ruled OUT, e.g. J.Reed")
    ap.add_argument("--prices", default="", help='Polymarket Yes/No, e.g. "T.Kraft=31/70,M.Golden=31/70"')
    ap.add_argument("--md", default="", help="also write a markdown report to this path")
    a = ap.parse_args()
    outs = [o.strip() for o in a.out.split(",") if o.strip()]
    pbp, pos = load(a.season)
    wk = int(pbp.week.max()); last = pbp.game_date.max()
    L = []
    P = L.append
    P(f"# {a.away} @ {a.home} — TD matchup report ({a.season}, data through Week {wk}, last game {last})\n")
    P("Source: nflverse public play-by-play + weekly rosters. Ranking scores are NOT probabilities.\n")
    if outs:
        P(f"Excluded as OUT: {', '.join(outs)}\n")
    prior = prior_rz(a.season, pos)
    res = {}
    for off, dfn in [(a.away, a.home), (a.home, a.away)]:
        u = usage(pbp, pos, off); d = defense(pbp, pos, dfn); res[off] = (u, d)
        rzp = round(d["rz_td"] / d["rz_drives"] * 100, 1) if d["rz_drives"] else 0
        flag = " — SMALL SAMPLE (<10 RZ drives)" if d["rz_drives"] < 10 else ""
        P(f"\n## {off} offense vs {dfn} defense\n")
        P(f"**{dfn} red-zone D:** {d['rz_td']} TD on {d['rz_drives']} RZ drives ({rzp}%) in {d['games']} games{flag}\n")
        al = d["allowed"]
        if len(al):
            summ = al.groupby(["pos", "type"]).size().to_dict()
            P("**TDs allowed by position:** " + ", ".join(f"{p} {t}: {n}" for (p, t), n in summ.items()) + "\n")
            for _, x in al.iterrows():
                P(f"- {x.scorer} ({x.pos}, {x.opp}) {x.type} TD, {x.yds} yds")
        else:
            P("**TDs allowed:** none\n")
        P(f"\n**{off} usage** (games: {u.games.iloc[0] if not u.empty else 0})\n")
        cols = ["player", "pos", "cur_team", "tgt", "tgt_share%", "rz_tgt", "i10_tgt", "car", "rz_car", "i5_car", "td"]
        P(u[cols].head(10).to_markdown(index=False) if not u.empty else "no data")
        wrong = u[(u.cur_team != off) & (u.cur_team != "?")] if not u.empty else u
        if len(wrong):
            P(f"\n⚠️ Team check: {', '.join(wrong.player + '→' + wrong.cur_team)} now listed on another team — verify.")
        po, ro, to = splits(pbp, off, "off"); pd_, rd, td = splits(pbp, dfn, "def")
        P(f"\n**Pass direction — {off} offense**\n"); P(po.to_markdown())
        P(f"\n**Pass direction — {dfn} defense allows**\n"); P(pd_.to_markdown())
        P(f"\n**Runs — {off} offense** (car {to['car']}, ypc {to['ypc']}, explosive {to['expl']}%)\n"); P(ro.to_markdown())
        P(f"\n**Runs — {dfn} defense allows** (car {td['car']}, ypc {td['ypc']}, explosive {td['expl']}%)\n"); P(rd.to_markdown())
    P("\n## Anytime TD ranking (min 2 per team — ranking aid, not probability)\n")
    for off, dfn in [(a.away, a.home), (a.home, a.away)]:
        u, d = res[off]
        rk = td_rank(u, d, outs, prior)
        P(f"\n**{off}** (vs {dfn})\n")
        P(rk[["player", "pos", "rz_opp_pg", "prior_rz_pg", "td", "opp_rush_td_pg", "opp_rec_td_pg_pos", "score"]].to_markdown(index=False))
        if len(rk) < 2:
            P("⚠️ Fewer than 2 candidates — widen the pool manually.")
    if a.prices:
        P("\n## Polymarket de-vig (market view only — never your fair probability)\n")
        P("| player | Yes | No | de-vig Yes % |\n|---|---|---|---|")
        for n, y, no, dv in devig(a.prices):
            P(f"| {n} | {y}¢ | {no}¢ | {dv}% |")
    txt = "\n".join(L)
    print(txt)
    if a.md:
        open(a.md, "w").write(txt)


if __name__ == "__main__":
    main()
