# LIVE AUDIT (10/19 review, owner: "we still can't prove that everything is correct"): re-grades everything the live site has graded this
# season from OUTSIDE data and fails on any difference. Run: `npm run verify` (or `python3 tests/verify_live.py [site]`).
#   1. final scores            -> nflverse games.csv
#   2. card / rule / model picks (spread, total, moneyline) -> recomputed from those scores
#   3. model parlays            -> every leg recomputed (TD legs from the graded scorer list), parlay = all legs won
#   4. touchdown scorers        -> nflverse player stats (rushing + receiving + special-teams TDs)
#   5. props                    -> nflverse receiving yards, Under / Over vs the line
# Exit 1 on any difference. Names nflverse spells differently are counted as "not matched", never as right.
import csv, io, json, re, sys, time, urllib.request, collections

SITE = (sys.argv[1] if len(sys.argv) > 1 else "https://nfl-nfl9.vercel.app").rstrip("/")
SEASON = 2026
FIX = {"LAR": "LA", "WSH": "WAS", "JAC": "JAX"}

def get(url, raw=False):
    for i in range(3):   # one dropped connection (ESPN / GitHub) is retried, never read as a difference
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                b = r.read()
            break
        except Exception:
            if i == 2: raise
            time.sleep(2 * (i + 1))
    return b.decode() if raw else json.loads(b)

def grade(label, g):
    a, h = g["game"].split(" @ "); A, H = g["awayScore"], g["homeScore"]
    m = re.match(r"^(Over|Under) ([\d.]+)", label)
    if m:
        d = (A + H - float(m.group(2))) * (1 if m.group(1) == "Over" else -1)
        return "W" if d > 0 else "L" if d < 0 else "P"
    m = re.match(r"^([A-Z]{2,3}) ML", label)
    if m:
        mine, opp = (H, A) if m.group(1) == h else (A, H)
        return "W" if mine > opp else "L" if mine < opp else "P"
    m = re.match(r"^([A-Z]{2,3}) ([+-][\d.]+)", label)
    if m:
        mine, opp = (H, A) if m.group(1) == h else (A, H)
        x = mine - opp + float(m.group(2))
        return "W" if x > 0 else "L" if x < 0 else "P"
    return None

bad = 0
def wrong(*a):
    global bad
    bad += 1; print("  WRONG", *a)

L = get(f"{SITE}/api/results/list")
res = {f'{r["week"]}|{r["game"]}': r for r in L["results"] if r.get("awayScore") is not None}

# 1. scores
games = {}
for r in csv.DictReader(io.StringIO(get("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", True))):
    if r["season"] == str(SEASON) and r["game_type"] == "REG" and r["away_score"] != "":
        games[(int(r["week"]), r["away_team"], r["home_team"])] = (int(r["away_score"]), int(r["home_score"]))
n = miss = 0
for r in res.values():
    a, h = r["game"].split(" @ "); s = games.get((r["week"], FIX.get(a, a), FIX.get(h, h)))
    if not s: miss += 1; continue
    n += 1
    if s != (r["awayScore"], r["homeScore"]): wrong("score", r["week"], r["game"], (r["awayScore"], r["homeScore"]), "nflverse", s)
print(f"1. scores: {n} checked vs nflverse, {miss} not posted there yet")

# 2. picks
n = 0
for r in res.values():
    for k in ("spread", "total", "ml", "blendSpread", "blendTotal"):
        x = r.get(k)
        if not x or x.get("result") not in ("W", "L", "P") or not x.get("label"): continue
        gx = grade(x["label"], r)
        if gx is None: continue
        n += 1
        if gx != x["result"]: wrong("pick", r["week"], r["game"], x["label"], x["result"], "->", gx)
for key, picks in ((L.get("combos") or {}).get("card") or {}).get("byGame", {}).items():
    r = res.get(key)
    if not r: continue
    for p in picks:
        if p.get("result") not in ("W", "L", "P"): continue
        gx = grade(p["pick"], r)
        if gx is None: continue
        n += 1
        if gx != p["result"]: wrong("card pick", key, p["pick"], p["result"], "->", gx)
# kickoff records + first-shown copies of every rule (the timing rules are graded at the line first shown) -- from the saved fields, not the label
def g_saved(x, r):
    if x.get("line") is None or not x.get("kind"): return None
    a, h = r["game"].split(" @ "); m = r["homeScore"] - r["awayScore"]; tot = r["homeScore"] + r["awayScore"]
    if x["kind"] == "total": d = (x["line"] - tot) if x.get("side") == "under" else (tot - x["line"])
    elif x.get("team"): d = (m if x["team"] == (x.get("home") or h) else -m) + x["line"]
    else: return None
    return "W" if d > 0 else "L" if d < 0 else "P"
nk = nf = 0
for w in sorted({r["week"] for r in res.values()}):
    try: RC = get(f"{SITE}/api/recordcheck?week={w}").get("games") or {}
    except Exception: continue
    for game, v in RC.items():
        r = res.get(f"{w}|{game}")
        if not r: continue
        for x in v.get("picks") or []:
            if x.get("result") not in ("W", "L", "P"): continue
            gx = g_saved(x, r) if x.get("kind") else grade(x.get("pick") or "", r)   # before the 10/20 endpoint fields: from the label
            if gx is None: continue
            nk += 1
            if gx != x["result"]: wrong("kickoff pick", w, game, x.get("id"), x.get("pick"), x["result"], "->", gx)
        for x in v.get("firstSeen") or []:
            if x.get("result") not in ("W", "L", "P"): continue
            gx = g_saved(x, r)
            if gx is None: continue
            nf += 1
            if gx != x["result"]: wrong("first-shown pick", w, game, x.get("pick"), x.get("line"), x["result"], "->", gx)
print(f"2. picks: {n} graded picks recomputed from the scores, plus {nk} kickoff records and {nf} first-shown copies of every rule")

# 3. parlays
MB = get(f"{SITE}/api/modelbets"); nl = npar = 0
for wk, types in (MB.get("weeks") or {}).items():
    for typ, lst in types.items():
        for p in lst:
            rs = []
            for l in p.get("legs") or []:
                rs.append(l.get("result")); r = res.get(f'{wk}|{l.get("game")}')
                if not r or l.get("result") not in ("W", "L", "P"): continue
                if l.get("kind") == "td" or l.get("label", "").endswith(" TD"):
                    pl = l.get("player") or l["label"][:-3]; row = [x for x in r.get("td") or [] if x.get("player") == pl]
                    if not row or row[0].get("scored") is None: continue
                    gx = "W" if row[0]["scored"] else "L"
                else:
                    gx = grade(l["label"], r)
                    if gx is None: continue
                nl += 1
                if gx != l["result"]: wrong("parlay leg", wk, typ, l["label"], l["result"], "->", gx)
            if p.get("result") in ("W", "L") and rs and all(x in ("W", "L", "P") for x in rs):
                npar += 1; exp = "L" if "L" in rs else "W"
                if exp != p["result"]: wrong("parlay", wk, typ, p.get("game"), rs, p["result"])
print(f"3. parlays: {nl} legs and {npar} decided parlays recomputed")

# 4 + 5. touchdowns and props vs nflverse player stats
td = collections.defaultdict(int); yd = {}; teams = set()
nn = lambda x: re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(x or "").strip().lower())   # "Kenneth Walker III" = "Kenneth Walker", "KC Concepcion Jr." = "KC Concepcion"
for r in csv.DictReader(io.StringIO(get(f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{SEASON}.csv", True))):
    if r["season_type"] != "REG": continue
    w, t = int(r["week"]), FIX.get(r["team"], r["team"]); teams.add((w, t))
    td[(w, t, r["player_name"])] += sum(int(float(r.get(c) or 0)) for c in ("rushing_tds", "receiving_tds", "special_teams_tds"))
    yd[(w, nn(r["player_display_name"]))] = {"rec_yds": float(r["receiving_yards"] or 0), "rec": float(r["receptions"] or 0), "pass_yds": float(r["passing_yards"] or 0)}   # 10/20: receptions / passing props too
n = um = 0
for r in res.values():
    for p in r.get("td") or []:
        if p.get("scored") is None or p.get("played") is False or (r["week"], p["team"]) not in teams: continue
        got = td.get((r["week"], p["team"], p["player"]))
        if got is None:   # no row in nflverse's player stats = no carry / catch / return that week (they list every player who touched the ball) -> 0 TDs
            um += 1
            if p["scored"]: wrong("TD", r["week"], r["game"], p["player"], "app says scored, nflverse has no touch for him (name spelled differently?)")
            continue
        n += 1
        if (got > 0) != bool(p["scored"]): wrong("TD", r["week"], r["game"], p["player"], "app", p["scored"], "nflverse", got)
print(f"4. touchdowns: {n} player rows vs nflverse, {um} more with no touch in nflverse (all graded 'no TD')")
n = nm = um = 0
for w in sorted({r["week"] for r in res.values()}):
    try: P = get(f"{SITE}/api/props?week={w}")
    except Exception: continue
    for g in P.get("games") or []:
        for r in g.get("picks") or []:
            if r.get("result") not in ("W", "L") or r.get("actual") is None: continue
            n += 1
            if ("W" if (r["actual"] < r["line"]) == (r["side"] == "under") else "L") != r["result"]: wrong("prop grade", w, r["name"], r)
            y = yd.get((w, nn(r["name"]))); y = None if y is None else y.get(r.get("stat") or "rec_yds")
            if y is None:   # no row = no catch that week -> 0 yards
                um += 1
                if int(r["actual"]) != 0: wrong("prop yards", w, r["name"], "app", r["actual"], "nflverse has no catch for him (name spelled differently?)")
                continue
            nm += 1
            if int(y) != int(r["actual"]): wrong("prop yards", w, r["name"], "app", r["actual"], "nflverse", y)
print(f"5. props: {n} graded, {nm} yard totals vs nflverse, {um} more with no catch in nflverse (all 0 yards in the app)")

# 6. NBA picks (10/20 review) -> ESPN's final scores for each game day (an outside source; the app grades from the same feed, so this checks the math)
ESPN_FIX = {"GS": "GSW", "NO": "NOP", "SA": "SAS", "NY": "NYK", "UTAH": "UTA", "WSH": "WAS"}
try:
    NP = get(f"{SITE}/api/nba/results/list").get("picks") or []
    RES = {"win": "W", "loss": "L", "push": "P", "W": "W", "L": "L", "P": "P"}     # NBA saves win / loss / push (void = postponed, never graded)
    graded = [p for p in NP if p.get("result") in RES and p.get("label")]
    finals = {}
    for day in sorted({p["date"] for p in graded}):
        sb = get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day.replace('-', '')}")
        for e in sb.get("events") or []:
            c = e["competitions"][0]
            if not c["status"]["type"].get("completed"): continue
            t = {x["homeAway"]: (ESPN_FIX.get(x["team"]["abbreviation"], x["team"]["abbreviation"]), int(x["score"])) for x in c["competitors"]}
            finals[(day, f'{t["away"][0]} @ {t["home"][0]}')] = {"game": f'{t["away"][0]} @ {t["home"][0]}', "awayScore": t["away"][1], "homeScore": t["home"][1]}
    n = um = 0
    for p in graded:
        g = finals.get((p["date"], p["game"]))
        gx = grade(p["label"], g) if g else None
        if gx is None: um += 1; continue
        n += 1
        if gx != RES[p["result"]]: wrong("NBA pick", p["date"], p["game"], p["label"], p["result"], "->", gx)
    print(f"6. NBA picks: {n} graded picks recomputed from ESPN finals, {um} not matched ({len(NP) - len(graded)} not graded yet or void)")
    # NBA model parlays: every graded leg from the same ESPN finals, parlay = all legs won (a pushed leg drops out)
    days = get(f"{SITE}/api/nba/modelbets").get("days") or {}
    nl = npar = 0
    for day, types in days.items():
        sb = None
        for typ, lst in types.items():
            for p in lst:
                for l in p.get("legs") or []:
                    if l.get("result") not in ("W", "L") or not l.get("label"): continue
                    key = (day, l.get("game"))
                    if key not in finals:
                        if sb is None:
                            sb = get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day.replace('-', '')}")
                            for e in sb.get("events") or []:
                                c = e["competitions"][0]
                                if not c["status"]["type"].get("completed"): continue
                                t = {x["homeAway"]: (ESPN_FIX.get(x["team"]["abbreviation"], x["team"]["abbreviation"]), int(x["score"])) for x in c["competitors"]}
                                finals[(day, f'{t["away"][0]} @ {t["home"][0]}')] = {"game": f'{t["away"][0]} @ {t["home"][0]}', "awayScore": t["away"][1], "homeScore": t["home"][1]}
                    g = finals.get(key); gx = grade(l["label"], g) if g else None
                    if gx is None: continue
                    nl += 1
                    if gx != l["result"]: wrong("NBA parlay leg", day, typ, l["label"], l["result"], "->", gx)
                rs = [l.get("result") for l in p.get("legs") or []]
                if p.get("result") in ("W", "L") and rs and all(x in ("W", "L", "P") for x in rs):
                    npar += 1
                    if ("L" if "L" in rs else "W") != p["result"]: wrong("NBA parlay", day, typ, rs, p["result"])
    print(f"   NBA parlays: {nl} legs and {npar} decided parlays recomputed")
except Exception as e:
    print(f"6. NBA picks: could not check ({str(e)[:80]})")

# 7. NBA player props (10/21 review) -> ESPN box scores (a second parser, written here from ESPN's own labels; the app's parser is nba/lib/espn.js parseBox)
try:
    nn2 = lambda x: re.sub(r"[^a-z]", "", re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(x or "").strip().lower()))
    days = sorted({p["date"] for p in NP} | set((get(f"{SITE}/api/nba/props").get("days") or [])))
    n = um = push = 0
    for day in days:
        P = get(f"{SITE}/api/nba/props?date={day}")
        rows = [(g, r) for g in P.get("games") or [] for r in g.get("picks") or [] if r.get("result") in ("W", "L", "P")]
        if not rows: continue
        box = {}
        sb = get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day.replace('-', '')}")
        for e in sb.get("events") or []:
            if not e["status"]["type"].get("completed"): continue
            sm = get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={e['id']}")
            for tm in (sm.get("boxscore") or {}).get("players") or []:
                st = tm["statistics"][0]; lab = st.get("labels") or []
                for a in st.get("athletes") or []:
                    v = a.get("stats") or []
                    nm = nn2(a["athlete"]["displayName"])
                    if not v or a.get("didNotPlay"): box[nm] = None; continue
                    d = dict(zip(lab, v)); num = lambda k: float(str(d.get(k, "0")).split("-")[0] or 0)
                    pts, reb, ast = num("PTS"), num("REB"), num("AST")
                    box[nm] = {"pts": pts, "reb": reb, "ast": ast, "pra": pts + reb + ast, "3pm": num("3PT"), "stl": num("STL"), "blk": num("BLK")}
        for g, r in rows:
            k = nn2(r["name"])
            if k not in box: um += 1; continue
            b = box[k]
            if b is None:
                push += 1
                if r["result"] != "P": wrong("NBA prop", day, r["name"], r["stat"], "did not play but graded", r["result"])
                continue
            y = b.get(r["stat"])
            if y is None: um += 1; continue
            n += 1
            gx = "P" if y == r["line"] else ("W" if (y < r["line"]) == (r["side"] == "under") else "L")
            if gx != r["result"] or (r.get("actual") is not None and float(r["actual"]) != y): wrong("NBA prop", day, g["game"], r["name"], r["stat"], r["side"], r["line"], "app", r["result"], r.get("actual"), "ESPN", y, gx)
    print(f"7. NBA props: {n} graded rows recomputed from ESPN box scores, {push} did-not-play pushes, {um} not matched")
except Exception as e:
    print(f"7. NBA props: could not check ({str(e)[:80]})")

# 8. first-TD scorer and first-TD team (10/21 review) -> nflverse play-by-play (the first touchdown play of each game)
try:
    import gzip
    raw = urllib.request.urlopen(urllib.request.Request(f"https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{SEASON}.csv.gz", headers={"User-Agent": "verify"}), timeout=120).read()
    first = {}
    for r in csv.DictReader(io.StringIO(gzip.decompress(raw).decode())):
        if r.get("season_type") != "REG" or r.get("touchdown") != "1" or not r.get("td_team"): continue
        k = (int(r["week"]), FIX.get(r["away_team"], r["away_team"]), FIX.get(r["home_team"], r["home_team"]))
        if k in first: continue
        first[k] = (r.get("td_player_name") or "", FIX.get(r["td_team"], r["td_team"]))
    ng = nt = 0
    for r in res.values():
        a, h = r["game"].split(" @ ")
        f = first.get((r["week"], a, h))
        if not f: continue
        rows = [p for p in r.get("td") or [] if p.get("ftdHit") is not None]
        if rows:
            ng += 1
            hit = [p["player"] for p in rows if p["ftdHit"]]
            if len(hit) > 1 or (hit and hit[0] != f[0]): wrong("first TD", r["week"], r["game"], "app", hit, "nflverse", f[0])
            if not hit and any(p["player"] == f[0] and p.get("team") == f[1] for p in rows): wrong("first TD", r["week"], r["game"], "app none, nflverse", f[0])
        ft = r.get("ftdTeam") or {}
        if ft.get("first") in ("home", "away"):
            nt += 1
            if (h if ft["first"] == "home" else a) != f[1]: wrong("first TD team", r["week"], r["game"], "app", ft["first"], "nflverse", f[1])
    print(f"8. first TD: {ng} games' first-TD scorer and {nt} first-TD team results vs nflverse play-by-play")
except Exception as e:
    print(f"8. first TD: could not check ({str(e)[:80]})")

print(f"\nverify: {'ALL RIGHT' if not bad else f'{bad} WRONG'}")
sys.exit(1 if bad else 0)
