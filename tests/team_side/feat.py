# Team-only spread model (owner 10/19, option B; research only, tests/team_side/README.md): each team's season so far (record, covers, scoring, per-play offense/defense,
# turnovers, schedule strength), compared with the closing spread. Built from nflverse play-by-play 2011-2026 + the schedule file.
import pandas as pd, numpy as np, os, sys
S=sys.argv[1]
G=pd.read_csv(f"{S}/ff/games.csv", low_memory=False)
G=G[(G.game_type=="REG")&(G.season>=2011)].copy()
G["home_team"]=G.home_team.replace({"STL":"LA","SD":"LAC","OAK":"LV"}); G["away_team"]=G.away_team.replace({"STL":"LA","SD":"LAC","OAK":"LV"})
tg=[]  # one row per team-game: stats from that game
for yr in range(2011,2027):
    f=f"/root/.nfl_cache/pbp_{yr}.parquet"
    if not os.path.exists(f): f=f"/tmp/nfl_cache_test/pbp_{yr}.parquet"
    if not os.path.exists(f): continue
    p=pd.read_parquet(f, columns=["game_id","season","week","season_type","posteam","defteam","epa","success","yards_gained","play_type","interception","fumble_lost","pass","rush"])
    p=p[(p.season_type=="REG")&p.posteam.notna()&p.play_type.isin(["pass","run"])]
    for c in ("posteam","defteam"): p[c]=p[c].replace({"STL":"LA","SD":"LAC","OAK":"LV","LAR":"LA"})
    p["to"]=p.interception.fillna(0)+p.fumble_lost.fillna(0)
    o=p.groupby(["game_id","season","week","posteam"]).agg(oepa=("epa","mean"),osr=("success","mean"),oypp=("yards_gained","mean"),oplays=("epa","size"),oto=("to","sum"),
        opass=("epa",lambda x: x[p.loc[x.index,"pass"]==1].mean()),orush=("epa",lambda x: x[p.loc[x.index,"rush"]==1].mean())).reset_index().rename(columns={"posteam":"team"})
    d=p.groupby(["game_id","defteam"]).agg(depa=("epa","mean"),dsr=("success","mean"),dypp=("yards_gained","mean"),dto=("to","sum")).reset_index().rename(columns={"defteam":"team"})
    tg.append(o.merge(d,on=["game_id","team"]))
    print("pbp",yr,len(p),flush=True)
T=pd.concat(tg)
# scores, covers from the schedule
rows=[]
for _,g in G[G.home_score.notna()].iterrows():
    for team,opp,pf,pa,home in ((g.home_team,g.away_team,g.home_score,g.away_score,1),(g.away_team,g.home_team,g.away_score,g.home_score,0)):
        line = -g.spread_line if home else g.spread_line   # team's spread (negative = favored)
        m=pf-pa; cov = np.nan if pd.isna(line) else (1.0 if m+line>0 else 0.0 if m+line<0 else 0.5)
        rows.append(dict(game_id=g.game_id,season=g.season,week=g.week,team=team,opp=opp,pf=pf,pa=pa,win=1.0 if m>0 else 0.0 if m<0 else 0.5,cov=cov,home=home,line=line))
R=pd.DataFrame(rows).merge(T.drop(columns=["season","week"]),on=["game_id","team"],how="left")
R.to_parquet(f"{S}/teamB/teamgames.parquet"); print("team-games",len(R))
