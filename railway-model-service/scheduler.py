"""
Snapshot scheduler (runs inside the Railway service, 24/7).
Calls the site's /api/snapshot on Mark's schedule, Pacific time:
  Sunday:  5 AM, 8 AM, 9:30 AM, 12 PM, 4 PM   (Polymarket + sportsbooks)
  Mon-Sat: 7 AM, 3 PM, 7 PM                   (Polymarket + sportsbooks)
  Every 15 min (:10 / :25 / :40 / :55): Pinnacle lines + Polymarket's lines, alternates and TD prices at the same moment (/api/pinnaclepull)
  Every 30 min (:15 and :45): build the slate so every pick shown gets its first-shown record (/api/slate)
  Every 5 min (:02, :07, ...): refresh the real Polymarket prices of the NFL and NBA parlays on the pages (/api/comboquotes?sport=nfl|nba)
  Every kickoff: 3 minutes before -> closing-line snapshot (Polymarket; books reused)
  Every distinct kickoff wave: ~60 min before -> model rerun (catches that wave's active/inactive news)
  Every 15 min: a new nflverse final -> model rerun (src=postgame)
  Nightly 11:45 PM + hourly at :20 (6 AM-11 PM): grade finished games and sync the Polymarket account
Env: SITE_URL (https://nfl-nfl9.vercel.app), SITE_LOGIN ("user:password" for the site's login).
     (app.py also reads MODEL_SERVICE_TOKEN; the scheduler itself doesn't call app.py over HTTP.)
"""
import json, os, threading, time, base64, csv, io, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

PT, ET = ZoneInfo("America/Los_Angeles"), ZoneInfo("America/New_York")
SUNDAY = [(5, 0), (8, 0), (9, 30), (12, 0), (16, 0)]     # (hour, minute), Pacific
WEEKDAY = [(7, 0), (15, 0), (19, 0)]
BOOK_HOURS_WK, BOOK_HOURS_SUN = {(7, 0)}, set(SUNDAY)   # FULL sportsbook pulls (moneyline + spreads + totals, 3 credits)
# 10/14 (owner): the books are pulled at EVERY scheduled snapshot; the times above are full pulls, the rest skip the moneyline (&books=2,
# 2 credits) -> 23 pulls a week (11 full + 12 lite = 57 credits), about 250 credits a month. The site counts a books reading as current
# until the next scheduled pull (lib/books.js BOOK_PULLS / booksFresh -- keep it the same as WEEKDAY / SUNDAY here).
SCHED_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
_started = False

def _call(path, tries=3, timeout=280):
    """GET the site; retry (60s apart) if the reply isn't data, e.g. the site was mid-redeploy."""
    site, login = os.environ.get("SITE_URL", "").strip().rstrip("/"), os.environ.get("SITE_LOGIN", "").strip()   # strip: a stray space/newline in the Railway variable = 401 on every call
    if not site: print("[scheduler] SITE_URL not set", flush=True); return None
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(site + path, headers={"Accept": "application/json", "User-Agent": "nfl-slatezzz-scheduler/1.0"})
        if login: req.add_header("Authorization", "Basic " + base64.b64encode(login.encode()).decode())
        bypass = os.environ.get("VERCEL_BYPASS", "").strip()   # Vercel "Protection Bypass for Automation" secret, only needed if Deployment Protection is on
        if bypass: req.add_header("x-vercel-protection-bypass", bypass)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if body.lstrip()[:1] in (b"{", b"["):
                    print(f"[scheduler] {path} -> ok ({r.status}) {body[:160]!r}", flush=True); return body
                print(f"[scheduler] {path} attempt {attempt}: got a web page, not data (status {r.status}) — retrying", flush=True)
        except urllib.error.HTTPError as e:
            # Say WHO refused (added 10/2): the app's own login answers 401 "Authentication required" with a WWW-Authenticate
            # header; Vercel's Deployment Protection answers with an HTML sign-in page and an x-vercel-* header.
            try: why = e.read()[:200].decode("utf-8", "replace").replace("\n", " ")
            except Exception: why = ""
            h = e.headers or {}
            who = "the site's own login (SITE_LOGIN doesn't match SITE_USERNAME/SITE_PASSWORD)" if h.get("WWW-Authenticate") else ("Vercel's Deployment Protection (turn it off for Production, or set VERCEL_BYPASS)" if any(k.lower().startswith("x-vercel") for k in h.keys()) and "text/html" in (h.get("Content-Type") or "") else "unknown")
            print(f"[scheduler] {path} attempt {attempt} failed: HTTP {e.code} — refused by: {who}; server={h.get('Server')}; www-authenticate={h.get('WWW-Authenticate')}; body={why!r}", flush=True)
        except Exception as e:
            print(f"[scheduler] {path} attempt {attempt} failed: {e}", flush=True)
        if attempt < tries: time.sleep(60)
    print(f"[scheduler] {path} gave up after {tries} tries", flush=True); return None

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/data/backups")
def _backup():
    # Pages of ~2 MB (see pages/api/backup.js): keep asking until the cursor comes back "0", then save one file.
    data, cursor, pages = {}, "0", 0
    while True:
        raw = _call(f"/api/backup?cursor={cursor}")
        if not raw:
            print("[scheduler] backup page failed — nothing saved", flush=True)
            _call("/api/status?backup=failed&files=0", tries=1)   # so the status panel doesn't keep showing last night's as current
            return
        page = json.loads(raw); data.update(page.get("data") or {}); cursor = str(page.get("next", "0")); pages += 1
        if cursor == "0" or pages > 200: break
    body = json.dumps({"ok": True, "t": datetime.now(timezone.utc).isoformat(), "keys": len(data), "pages": pages, "data": data}).encode()
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        path = os.path.join(BACKUP_DIR, f"backup-{datetime.now(PT):%Y-%m-%d}.json")
        with open(path, "wb") as f: f.write(body)
        files = sorted(x for x in os.listdir(BACKUP_DIR) if x.startswith("backup-"))
        for old in files[:-30]: os.remove(os.path.join(BACKUP_DIR, old))      # keep the last 30 nights
        persistent = os.path.ismount("/data") or os.path.exists("/data/.volume")
        _call(f"/api/status?backup={'volume' if persistent else 'temporary'}&files={min(len(files), 30)}", tries=1)
        print(f"[scheduler] backup saved {path}", flush=True)
    except Exception as e:
        print(f"[scheduler] backup save failed: {e}", flush=True)
        _call("/api/status?backup=failed&files=0", tries=1)

def _retrain():
    """Weekly TD retrain, run IN-PROCESS (not over HTTP) so the gunicorn worker's request slot stays free.
    Same code as POST /retrain-td (td_prob.retrain) -- before, this had its own copy and the two drifted."""
    try:
        import td_prob
        r = td_prob.retrain()
        summary = (f"went live ({r['reason']})" if r.get("reason") else ("went live: " if r["went_live"] else "kept current model: ") +
                   f"candidate {r['candidate_brier']} vs active {r['active_brier']} on weeks {r['holdout_weeks']}")
        print(f"[scheduler] retrain-td (in-process) -> {summary}", flush=True)
        _call(f"/api/status?retrain={urllib.parse.quote(summary)}", tries=1)
    except Exception as e:
        print(f"[scheduler] retrain-td failed: {e}", flush=True)
        _call(f"/api/status?retrain={urllib.parse.quote('failed: ' + str(e))}", tries=1)

def _build_props():
    """Weekly prop-model build (10/17), in-process: new week's stats in, model + chance spreads refit."""
    try:
        import prop_model
        r = prop_model.build_live(log=lambda m: print(m, flush=True))
        print(f"[scheduler] prop model built -> {r}", flush=True)
    except Exception as e:
        print(f"[scheduler] prop model build failed: {e}", flush=True)

def _rebuild_combos():
    """Weekly combo / upgraded-model rebuild (10/9), in-process. Opening lines for this season come from the site's own first saved lines."""
    try:
        import weekly_rebuild, extra_factors
        opens = {}
        raw = _call("/api/opens", tries=2)
        if raw:
            g = extra_factors._games(); idx = {(int(r.season), int(r.week), r.away_team, r.home_team): r.game_id for r in g.itertuples()}
            for x in json.loads(raw).get("games", []):
                gid = idx.get((int(x["season"]), int(x["week"]), x["away"], x["home"]))
                if gid and x.get("so") is not None and x.get("to") is not None: opens[gid] = {"so": x["so"], "to": x["to"]}
        r = weekly_rebuild.run(opens)
        summary = ("went live: " if r.get("ok") else "kept previous: ") + json.dumps({k: r.get(k) for k in ("games", "marginErr", "oldMarginErr", "totalErr", "minutes", "error") if r.get(k) is not None})
        print(f"[scheduler] combo rebuild -> {summary}", flush=True)
        _call(f"/api/status?combos={urllib.parse.quote(summary)}", tries=1)
    except Exception as e:
        print(f"[scheduler] combo rebuild failed: {e}", flush=True)
        _call(f"/api/status?combos={urllib.parse.quote('failed: ' + str(e))}", tries=1)

ESPN_SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
ESPN_ABBR = {"WSH": "WAS", "LAR": "LA"}   # ESPN -> nflverse team codes where they differ
def _espn_kickoffs(weeks=()):
    """{ "AWAY @ HOME": kickoff UTC } from ESPN for the given (season, week) pairs (10/7: nflverse still had CHI @ GB at 1:00 PM ET after
    the game moved to 4:25 PM ET, so the closing-line snapshot and the kickoff-wave rerun would have fired hours early). Empty on any failure.
    10/14 fix: ESPN now rejects date ranges (HTTP 400) -- this had silently returned nothing -- so it asks by week (regular season)."""
    try:
        evs = []
        for season, week in sorted(set(weeks)) or [(None, None)]:
            url = f"{ESPN_SB}?dates={season}&seasontype=2&week={week}" if season and week and 1 <= week <= 18 else ESPN_SB
            with urllib.request.urlopen(url, timeout=20) as r: evs += json.loads(r.read().decode()).get("events", [])
        out = {}
        for ev in evs:
            c = (ev.get("competitions") or [{}])[0]; by = {}
            for t in c.get("competitors", []):
                ab = (t.get("team") or {}).get("abbreviation"); by[t.get("homeAway")] = ESPN_ABBR.get(ab, ab)
            if by.get("away") and by.get("home") and ev.get("date"):
                out[f"{by['away']} @ {by['home']}"] = datetime.fromisoformat(ev["date"].replace("Z", "+00:00"))
        return out
    except Exception as e:
        print(f"[scheduler] ESPN kickoffs unavailable ({e}); using the schedule file", flush=True); return {}
def _kickoffs():
    """Upcoming kickoffs (UTC) for the next 8 days from the NFL schedule, with ESPN's time when it differs by 10+ minutes."""
    try:
        with urllib.request.urlopen(SCHED_URL, timeout=60) as r: rows = list(csv.DictReader(io.StringIO(r.read().decode())))
    except Exception as e:
        print(f"[scheduler] schedule load failed: {e}", flush=True); return []
    now, out = datetime.now(timezone.utc), []
    wk = set()
    for x in rows:   # the weeks with games in the next 8 days, for the ESPN check
        try:
            k = datetime.strptime(f"{x['gameday']} {x['gametime']}", "%Y-%m-%d %H:%M").replace(tzinfo=ET).astimezone(timezone.utc)
            if x.get("game_type") == "REG" and now - timedelta(days=1) < k < now + timedelta(days=8): wk.add((int(x["season"]), int(x["week"])))
        except (ValueError, KeyError, TypeError): pass
    espn = _espn_kickoffs(wk)
    for x in rows:
        if x.get("game_type") not in ("REG", "WC", "DIV", "CON", "SB") or not x.get("gameday") or not x.get("gametime"): continue   # + playoffs (9/30)
        try: k = datetime.strptime(f"{x['gameday']} {x['gametime']}", "%Y-%m-%d %H:%M").replace(tzinfo=ET).astimezone(timezone.utc)
        except ValueError: continue
        key = f"{x['away_team']} @ {x['home_team']}"
        e = espn.get(key)
        if e is not None and abs((e - k).total_seconds()) >= 600 and abs((e - k).total_seconds()) < 3 * 86400: k = e   # moved game (same week)
        if now - timedelta(minutes=5) < k < now + timedelta(days=8): out.append((k, key))
    return out

def _finals():
    """Games nflverse has posted a final score for (this season, recent weeks). None if the schedule can't be read."""
    try:
        with urllib.request.urlopen(SCHED_URL, timeout=60) as r: rows = list(csv.DictReader(io.StringIO(r.read().decode())))
    except Exception as e:
        print(f"[scheduler] finals load failed: {e}", flush=True); return None
    yr = max((int(x["season"]) for x in rows if x.get("season", "").isdigit()), default=0)
    return {f"{x['season']}:{x['week']}:{x['away_team']} @ {x['home_team']}" for x in rows
            if x.get("season") == str(yr) and x.get("away_score") not in (None, "") and x.get("home_score") not in (None, "")}

_running, _running_lock = set(), threading.Lock()
def _bg(kind, fn, *args, **kw):
    """Run a job in its own thread. Before 9/30 every call ran inline in the loop, so one slow rerun (up to ~15 min
    with retries) or a multi-page backup blocked the loop past the 3-minute kickoff-close window and the 5-minute
    snapshot/rerun windows, silently skipping them. kind = one job of each kind at a time (e.g. no two reruns overlap)."""
    with _running_lock:
        if kind in _running: print(f"[scheduler] {kind} still running — will retry", flush=True); return False
        _running.add(kind)
    def run():
        try: fn(*args, **kw)
        except Exception as e: print(f"[scheduler] {kind} failed: {e}", flush=True)
        finally:
            with _running_lock: _running.discard(kind)
    threading.Thread(target=run, daemon=True).start()
    return True

def _loop():
    fired, kicks, kicks_at = {}, [], None
    seen_finals, finals_at = None, None   # games nflverse had already finished when we last looked (None until the first look)
    while True:
        try:
            now_pt = datetime.now(PT)
            if kicks_at is None or (datetime.now(timezone.utc) - kicks_at) > timedelta(hours=1):
                kicks, kicks_at = _kickoffs(), datetime.now(timezone.utc)
            # After every game (added 10/2): when nflverse posts a new final score, rerun the model right away so the next
            # games' numbers use that game's plays, snaps and injuries. Checked every 15 minutes; the first look after a
            # restart only records what is already final (no rerun).
            if finals_at is None or (datetime.now(timezone.utc) - finals_at) > timedelta(minutes=15):
                finals_at = datetime.now(timezone.utc); fin = _finals()
                if fin is not None:
                    new_games = sorted(fin - seen_finals) if seen_finals is not None else []
                    if new_games and _bg("rerun", _call, "/api/rerun?src=postgame"): print(f"[scheduler] new final(s) {new_games} -> postgame rerun", flush=True)
                    elif new_games: fin = seen_finals   # a rerun was already busy: look again next time
                    seen_finals = fin
            slots = SUNDAY if now_pt.weekday() == 6 else WEEKDAY
            slot = next(((h, m) for h, m in slots if now_pt.hour == h and m <= now_pt.minute < m + 5), None)
            if slot:
                tag = f"s:{now_pt:%Y-%m-%d}-{slot[0]:02d}{slot[1]:02d}"
                # Sportsbook pull at every scheduled snapshot (10/14): full pulls (3 credits) at the BOOK_HOURS, the rest skip the
                # moneyline (2 credits). Books feed LINE MOVE / KEY NUMBER.
                bk = "&books=1" if slot in (BOOK_HOURS_SUN if now_pt.weekday() == 6 else BOOK_HOURS_WK) else "&books=2"
                # 10/14 fix: marked done only once it actually started -- a snapshot still running from before used to make this slot
                # (and its books pull) skip for good; now it retries every 30 s inside the 5-minute window.
                # 2 tries, not 3: a timeout usually means it DID run, and each retry appended a duplicate snapshot (and re-pulled books)
                if tag not in fired and _bg("snapshot", _call, "/api/snapshot?src=schedule" + bk, tries=2): fired[tag] = time.time()
            # Pinnacle every 30 min (10/13, owner): Pinnacle moves first; saved with Polymarket's line at the same moment so "Pinnacle moved,
            # Polymarket hasn't" can be tested. Free feed, no credits. Recorded only.
            # 10/16 (owner): every 15 min (:10 / :25 / :40 / :55) -- the pull also refreshes the Polymarket TD prices and alternate lines
            if now_pt.minute % 15 >= 10 and now_pt.minute % 15 < 15:
                tag = f"p:{now_pt:%Y-%m-%d-%H}-{now_pt.minute // 15}"
                if tag not in fired and _bg("pinnacle", _call, "/api/pinnaclepull", tries=1, timeout=90): fired[tag] = time.time()
            # 10/14 fix: build the slate every 30 min (:15 / :45, right after the Pinnacle pull). Picks are saved as "first shown"
            # (stackfirst:) only when the slate is built, so a timing pick that came and went while nobody had the app open was never
            # recorded or graded.
            if now_pt.minute % 30 >= 15 and now_pt.minute % 30 < 20:
                tag = f"sl:{now_pt:%Y-%m-%d-%H}-{now_pt.minute // 30}"
                if tag not in fired and _bg("slate", _call, "/api/slate", tries=1, timeout=90): fired[tag] = time.time()
            # 10/17 (owner: "I need it to refresh in the background all the time", NFL and NBA): every 5 min the site re-quotes the parlays
            # whose real Polymarket price is older than 4 min (asks and closes, never buys), so pages open with real prices already there.
            if now_pt.minute % 5 == 2:
                tag = f"cq:{now_pt:%Y-%m-%d-%H-%M}"
                if tag not in fired:
                    fired[tag] = time.time()
                    _bg("quotes", _call, "/api/comboquotes?sport=nfl", tries=1, timeout=75)
                    _bg("quotesnba", _call, "/api/comboquotes?sport=nba", tries=1, timeout=75)
            nowu = datetime.now(timezone.utc)
            due = {}
            for k, game in kicks:
                if k - timedelta(minutes=3) <= nowu < k: due.setdefault(k, []).append(game)
            for k, glist in due.items():
                tag = f"k:{k:%Y%m%d%H%M}"
                if tag not in fired: fired[tag] = time.time(); _bg(tag, _call, "/api/snapshot?src=kickoff&kickoff=" + urllib.parse.quote(",".join(glist)))   # own kind per kickoff: a close must never be skipped
            # Automatic reruns: Tuesday 7:05 AM (new week loaded) and Sunday 9:05 AM (after final injury reports)
            # Added 9/28: Tue 7:30 (so the TD model retrained at 7:15 is actually used before Sunday; before, the Tuesday
            # numbers came from the OLD model and stayed up all week), Thu 7:05 (Wednesday's first practice report is in
            # the injury feed by then) and Sat 7:05 (Friday's final report). Before, Thu-Sat showed Tuesday's numbers.
            # 10/23: + Friday 2:05 PM (the final injury report posts ~1 PM PT: Out / Doubtful players leave the TD lists and the prop rows, their
            # backups move up the same afternoon, not Saturday 7 AM -- a Friday-evening Over on a player ruled Out loses)
            rerun_now = ((now_pt.weekday() in (1, 3, 5) and now_pt.hour == 7 and 5 <= now_pt.minute < 10) or
                         (now_pt.weekday() == 4 and now_pt.hour == 14 and 5 <= now_pt.minute < 10) or
                         (now_pt.weekday() == 6 and now_pt.hour == 9 and 5 <= now_pt.minute < 10))
            # Tuesday "after the retrain" rerun (9/30): waits until the 7:15 retrain has finished (it runs in its own thread
            # now), any time 7:30-8:29, so the new model is actually used.
            if now_pt.weekday() in (1, 2) and ((now_pt.hour == 7 and now_pt.minute >= 30) or now_pt.hour == 8):
                tag = f"r:after-retrain:{now_pt:%Y-%m-%d}"
                with _running_lock: busy = "retrain" in _running
                if tag not in fired and not busy and _bg("rerun", _call, "/api/rerun?src=auto"): fired[tag] = time.time()
            if rerun_now:
                tag = f"r:{now_pt:%Y-%m-%d-%H}-{now_pt.minute // 30}"
                # marked done only once it actually started: a rerun still busy from an earlier wave is retried next loop (9/30)
                if tag not in fired and _bg("rerun", _call, "/api/rerun?src=auto"): fired[tag] = time.time()
            # Kickoff-wave reruns: one rerun per distinct kickoff time (10 AM, 1:05, 1:25, 5:20, TNF, SNF, MNF...),
            # fired ~60 min before that wave kicks off -- after teams must confirm active/inactive (~90 min before
            # kickoff) but with enough buffer that the news has settled. Catches every wave, not just the 9:05 AM
            # Sunday rerun, which only lines up with the 10 AM games.
            # review fix 10/14: window 65 -> 25 min before kickoff (was 65 -> 55). A postgame rerun (same "rerun" kind, up to ~16 min)
            # running at the wave time used to make the wave rerun skip for good; now it retries until 25 min before kickoff.
            for k in {k for k, _ in kicks if k - timedelta(minutes=65) <= nowu < k - timedelta(minutes=25)}:
                tag = f"rw:{k:%Y%m%d%H%M}"
                if tag not in fired and _bg("rerun", _call, "/api/rerun?src=wave"): fired[tag] = time.time()
            # Weekly TD retrain: Tuesday 7:15 AM, after the rerun above has the new week's data loaded.
            # Wednesday too (10/2): if nflverse posted Monday night's game after Tuesday's retrain, this one picks it up. The
            # clear-win rule means a retrain on unchanged data keeps the live model.
            # Weekly combo / upgraded-model rebuild (10/9): Tuesday 4 AM PT, before the 7:30 rerun uses it. ~10-20 minutes in its own thread.
            if now_pt.weekday() == 1 and now_pt.hour == 4 and now_pt.minute < 5:
                tag = f"combos:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired[tag] = time.time(); _bg("combos", _rebuild_combos)
            if now_pt.weekday() in (1, 2) and now_pt.hour == 7 and 15 <= now_pt.minute < 20:
                tag = f"rt:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired[tag] = time.time(); _bg("retrain", _retrain)
            # Weekly prop-model build (10/17): Tuesday 5 AM PT, after the combo rebuild, before the 7:30 rerun asks it for chances.
            if now_pt.weekday() == 1 and now_pt.hour == 5 and now_pt.minute < 5:
                tag = f"props:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired[tag] = time.time(); _bg("props", _build_props)
            # Nightly backup at 12:05 AM
            if now_pt.hour == 0 and 5 <= now_pt.minute < 10:
                tag = f"b:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired[tag] = time.time(); _bg("backup", _backup)
            # Self-check (added 9/29): Thu 12:05 PM (before TNF), Fri 5:05 PM, Sun 7:35 AM -- the site checks every game
            # for lines, model numbers, TD prices and this week's injury report, and records anything missing.
            if ((now_pt.weekday() == 3 and now_pt.hour == 12) or (now_pt.weekday() == 4 and now_pt.hour == 17) or
                    (now_pt.weekday() == 6 and now_pt.hour == 7 and now_pt.minute >= 30)) and 5 <= now_pt.minute % 30 < 10:
                tag = f"sc:{now_pt:%Y-%m-%d-%H}"
                if tag not in fired: fired[tag] = time.time(); _bg("selfcheck", _call, "/api/selfcheck", tries=2)
            if now_pt.hour == 23 and now_pt.minute >= 45:
                tag = f"g:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired[tag] = time.time(); _bg("grade", _call, "/api/results/grade")
            # Hourly at :20 from 6 AM to 11 PM (added 10/2): nflverse posts final scores and play-by-play hours after a game
            # ends, so a once-a-night grade missed them (Thursday's game sat ungraded). The call grades whatever is final and
            # also syncs the Polymarket account; with nothing new it does almost no work.
            if 6 <= now_pt.hour <= 22 and 20 <= now_pt.minute < 30:
                tag = f"gh:{now_pt:%Y-%m-%d-%H}"
                if tag not in fired: fired[tag] = time.time(); _bg("grade", _call, "/api/results/grade")
            for t in [t for t, at in fired.items() if time.time() - at > 86400]: del fired[t]   # tags only matter inside their window; cap growth
        except Exception as e:
            print(f"[scheduler] loop error: {e}", flush=True)
        time.sleep(30)

# 10/22 (owner: "so once it deploys ... everything automatically"): a NEW Railway deploy runs the model once by itself, a few minutes after
# the service is up, so every number made by new service code (STACK's team yards, TD / prop chances) is redone without a tap in the app.
# Once per deploy: Railway gives each deploy its own RAILWAY_DEPLOYMENT_ID; the last one seen is kept on the volume. No id (a local
# run) -> nothing happens. A rerun already running (a kickoff wave) is waited out, up to ~12 minutes.
DEPLOY_SEEN = os.path.join(os.environ.get("MODEL_DIR", "/data"), "last_deploy_rerun.txt")
def _after_deploy(wait=360):
    dep = os.environ.get("RAILWAY_DEPLOYMENT_ID") or ""
    if not dep: return False
    try: old = open(DEPLOY_SEEN).read().strip()
    except Exception: old = ""
    if old == dep: return False
    time.sleep(wait)
    for _ in range(6):
        if _bg("rerun", _call, "/api/rerun?src=deploy"):
            try:
                with open(DEPLOY_SEEN, "w") as f: f.write(dep)
            except Exception as e: print(f"[scheduler] deploy rerun: could not save the deploy id: {e}", flush=True)
            print(f"[scheduler] new deploy {dep[:8]} -> model rerun", flush=True); return True
        time.sleep(120)
    return False

def start():
    global _started
    if _started: return
    _started = True
    threading.Thread(target=_loop, daemon=True).start()
    print("[scheduler] started", flush=True)
    # Connection test at every start (10/2): one quick call so the log says right away whether the site accepts the scheduler
    # (before, nothing was called until the next scheduled window, up to an hour later), then a catch-up grade + account sync.
    def _hello():
        ok = _call("/api/status", tries=1, timeout=60)
        print("[scheduler] startup check: " + ("the site accepted the scheduler (login OK)" if ok else "the site REFUSED the scheduler — see the line above for who"), flush=True)
        if ok: _call("/api/results/grade", tries=1)
    threading.Thread(target=_hello, daemon=True).start()
    threading.Thread(target=_after_deploy, daemon=True).start()   # 10/22: one model rerun after a new deploy
