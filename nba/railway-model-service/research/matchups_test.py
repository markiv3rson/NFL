"""Defender matchups vs the closing line (nba.com tracking matchups 2017-18 .. 2025-26, public mirror shufinskiy/nba_data matchups_<y>).
A row = one offensive player (person_id, team_id = the offense) guarded by one defender (matchups_person_id) for partial possessions;
checked on 2025-10-21 HOU @ OKC: the rows' three-point tries per team (38 / 48) match that team's own (39 / 52), so team_id is the offense.
Defender rating: points allowed per 100 partial possessions guarded, everything before tonight (this season and last), shrunk toward the
league rate with 400 possessions. Tonight's defense: the team's defenders' ratings weighted by their share of the team's guarding in its
previous 10 games. Team-style numbers too (last 10 games): switches per 100, share of shots against help defense, points per 100 as offense.
Tests: ridge on the market's miss (spread and total) with each season left out; the side when the model disagrees with the line.
Only 2018-2026 exists, so the 2008-13 period is empty: a result here is a candidate at best under the every-period rule.
Usage: PYTHONPATH=. python3 research/matchups_test.py <matchup dir> <shot dir>"""
import sys, os, glob, re, warnings, numpy as np, pandas as pd
from sklearn.linear_model import Ridge
warnings.filterwarnings("ignore")
sys.path.insert(0, "."); import nba_data as nd
MD, SHOT = sys.argv[1], sys.argv[2]
NORM = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "NOH": "NOP", "NOK": "NOP", "UTAH": "UTA", "WSH": "WAS", "NJ": "BKN", "NJN": "BKN", "SEA": "OKC"}
nm = lambda t: NORM.get(t, t)
cols = ["game_id", "team_id", "team_tricode", "home_team_id", "person_id", "matchups_person_id", "partial_possessions", "player_points", "switches_on",
        "matchup_field_goals_attempted", "help_field_goals_attempted"]
M = []
for f in sorted(glob.glob(os.path.join(MD, "matchups_*.csv"))):
    y = int(re.search(r"_(\d{4})\.csv$", f).group(1)); x = pd.read_csv(f, usecols=cols, dtype={"game_id": str}); x["season"] = y + 1; M.append(x)
M = pd.concat(M, ignore_index=True); M = M[M.game_id.str.lstrip("0").str.startswith("2")]
M["game_id"] = M.game_id.str.lstrip("0")
mp = pd.concat([pd.read_csv(f, usecols=["GAME_ID", "GAME_DATE", "HTM", "VTM"], dtype={"GAME_ID": str}).drop_duplicates("GAME_ID")
                for f in glob.glob(os.path.join(SHOT, "shotdetail_*.csv"))]).drop_duplicates("GAME_ID")
mp["GAME_ID"] = mp.GAME_ID.str.lstrip("0"); mp["date"] = pd.to_datetime(mp.GAME_DATE.astype(str), format="%Y%m%d"); mp["home"] = mp.HTM.map(nm); mp["away"] = mp.VTM.map(nm)
M = M.merge(mp[["GAME_ID", "date", "home", "away"]], left_on="game_id", right_on="GAME_ID")
M["off"] = M.team_tricode.map(nm); M["deff"] = np.where(M.off == M.home, M.away, M.home)
print(f"matchup rows {len(M):,} | games {M.game_id.nunique():,} | seasons {M.season.min()}-{M.season.max()}", flush=True)
# ---- defender ratings before each game day (cumulative over this season and last), shrunk
D = M.groupby(["season", "date", "deff", "matchups_person_id"]).agg(pp=("partial_possessions", "sum"), pts=("player_points", "sum")).reset_index().sort_values("date")
lg = M.player_points.sum() / M.partial_possessions.sum()
day = D.groupby(["matchups_person_id", "date"])[["pp", "pts"]].sum().reset_index().sort_values(["matchups_person_id", "date"])
day["season"] = day.date.map(lambda d: d.year + 1 if d.month >= 8 else d.year)
recs = []
for pid, x in day.groupby("matchups_person_id"):
    cp = x.pp.cumsum().shift(1).fillna(0).values; ct = x.pts.cumsum().shift(1).fillna(0).values; s = x.season.values; dt = x.date.values
    # keep only this season and last: subtract what was before the start of last season
    for i in range(len(x)):
        j0 = np.searchsorted(s, s[i] - 1, "left"); base_p = cp[j0] if j0 < len(cp) else 0; base_t = ct[j0] if j0 < len(ct) else 0
        p_, t_ = cp[i] - base_p, ct[i] - base_t
        recs.append((pid, dt[i], 100 * (t_ + 400 * lg) / (p_ + 400)))
DR = pd.DataFrame(recs, columns=["matchups_person_id", "date", "drat"])
D = D.merge(DR, on=["matchups_person_id", "date"])
# ---- team-game numbers
TG = M.groupby(["season", "date", "game_id", "off", "deff"]).agg(pp=("partial_possessions", "sum"), pts=("player_points", "sum"), sw=("switches_on", "sum"),
                                                                    mfga=("matchup_field_goals_attempted", "sum"), hfga=("help_field_goals_attempted", "sum")).reset_index()
TG["opp100"] = 100 * TG.pts / TG.pp; TG["sw100"] = 100 * TG.sw / TG.pp; TG["help"] = TG.hfga / (TG.mfga + TG.hfga).clip(lower=1)
rows = []
# each defender's rating as of any date: sorted dates + ratings (the rating on a date already uses only earlier days)
RT = {pid: (x.date.values.astype("datetime64[ns]"), x.drat.values) for pid, x in DR.sort_values("date").groupby("matchups_person_id")}
def rating_on(pid, dt):
    a = RT.get(pid)
    if a is None: return 100 * lg
    j = np.searchsorted(a[0], np.datetime64(dt, "ns"), "right") - 1
    return a[1][j] if j >= 0 else 100 * lg
for team, x in pd.concat([TG.assign(team=TG.off, role="o"), TG.assign(team=TG.deff, role="d")]).groupby("team"):
    xo = x[x.role == "o"].set_index("game_id"); xd = x[x.role == "d"].set_index("game_id").sort_values("date")
    gl = xd.index.tolist(); DT = D[D.deff == team]
    by_date = {dt: y.set_index("matchups_person_id").pp for dt, y in DT.groupby("date")}
    for i, gid in enumerate(gl):
        prev = gl[max(0, i - 10):i]
        if len(prev) < 3: rows.append((gid, team) + (np.nan,) * 5); continue
        dt = xd.loc[gid, "date"]
        share = pd.concat([by_date[d] for d in xd.loc[prev, "date"] if d in by_date]).groupby(level=0).sum()
        drot = float(sum(v / share.sum() * rating_on(pid, dt) for pid, v in share.items()))
        rows.append((gid, team, drot, xd.loc[prev, "sw100"].mean(), xd.loc[prev, "help"].mean(), xo.reindex(prev).opp100.mean(), xd.loc[prev, "opp100"].mean()))
F = pd.DataFrame(rows, columns=["game_id", "team", "drot", "sw", "help", "o100", "d100"])
g = nd.games(); g = g[(g.season_type == 2) & g.home_line.notna()].copy(); g["date"] = pd.to_datetime(g.date)
g["home_n"] = g.team_abbreviation_h.map(nm); g["away_n"] = g.team_abbreviation_a.map(nm)
G = g.merge(mp[["GAME_ID", "date", "home"]], left_on=["date", "home_n"], right_on=["date", "home"]).rename(columns={"GAME_ID": "nba_id"})
fh = F.rename(columns={c: "h_" + c for c in F.columns if c not in ("game_id",)}); fa = F.rename(columns={c: "a_" + c for c in F.columns if c not in ("game_id",)})
G = G.merge(fh, left_on=["nba_id", "home_n"], right_on=["game_id", "h_team"], suffixes=("", "_x")).merge(fa, left_on=["nba_id", "away_n"], right_on=["game_id", "a_team"], suffixes=("", "_y"))
G["miss"] = G.margin - G.home_line; G["hcov"] = np.where(G.miss == 0, np.nan, (G.miss > 0).astype(float))
G["tmiss"] = G.total - G.total_line; G["over"] = np.where(G.tmiss == 0, np.nan, (G.tmiss > 0).astype(float))
print(f"lined games with matchup numbers: {len(G):,} | home covers {100*G.hcov.mean():.1f}% | over {100*G.over.mean():.1f}%", flush=True)
def test(target, feats, side, label):
    Z = G.dropna(subset=feats + [target]).copy(); pred = pd.Series(np.nan, index=Z.index)
    for s in sorted(Z.season.unique()):
        tr, te = Z.season != s, Z.season == s
        mu, sd = Z.loc[tr, feats].mean(), Z.loc[tr, feats].std().replace(0, 1)
        m = Ridge(alpha=50.0).fit((Z.loc[tr, feats] - mu) / sd, Z.loc[tr, target]); pred[te] = m.predict((Z.loc[te, feats] - mu) / sd)
    base = np.sqrt((Z[target] ** 2).mean()); new = np.sqrt(((Z[target] - pred) ** 2).mean())
    print(f"\n== {label}: {len(Z):,} games | miss of the line {base:.3f} -> line + matchups {new:.3f}")
    for q in (0.8, 0.9, 0.95):
        cut = pred.abs().quantile(q); m = pred.abs() >= cut; w = np.where(pred[m] > 0, Z.loc[m, side], 1 - Z.loc[m, side]); ok = ~np.isnan(w); x = Z[m][ok]; w = w[ok]
        bys = pd.Series(w).groupby(x.season.values).mean()
        print(f"  top {round(100*(1-q))}% by gap: side wins {100*w.mean():.1f}% of {len(x)} | 2018-19 {100*w[x.season.values <= 2019].mean():.1f} / 2020+ {100*w[x.season.values >= 2020].mean():.1f} | seasons >50: {int((bys > .5).sum())}/{len(bys)}")
test("miss", ["h_drot", "a_drot", "h_sw", "a_sw", "h_help", "a_help", "h_o100", "a_o100", "h_d100", "a_d100"], "hcov", "SPREAD: rotation defender rating, switching, help defense, matchup points for / against")
test("tmiss", ["h_drot", "a_drot", "h_sw", "a_sw", "h_help", "a_help", "h_o100", "a_o100", "h_d100", "a_d100"], "over", "TOTAL: same numbers")
d = G.h_drot - G.a_drot; ok = d.notna()
for q in (0.9, 0.95):
    for lab, mask, bet_home in (("home's guards much better (lower points allowed)", d <= d[ok].quantile(1 - q), True), ("away's much better", d >= d[ok].quantile(q), False)):
        x = G[ok & mask]; w = np.where(bet_home, x.hcov, 1 - x.hcov); okw = ~np.isnan(w); x = x[okw]; w = w[okw]
        print(f"  defender rating gap top {round(100*(1-q))}%: {lab} -> bet them: {100*w.mean():.1f}% of {len(x)} | 2018-19 {100*w[x.season.values <= 2019].mean():.1f} / 2020+ {100*w[x.season.values >= 2020].mean():.1f}")
