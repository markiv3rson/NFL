"""
Snapshot scheduler (runs inside the Railway service, 24/7).
Calls the site's /api/snapshot on Mark's schedule, Pacific time:
  Sunday:  6, 7, 8, 9, 10 AM, 12 PM, 3 PM   (Polymarket + sportsbooks)
  Mon-Sat: 7 AM, 12 PM, 3 PM, 7 PM           (Polymarket + sportsbooks)
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
SUNDAY = [6, 7, 8, 9, 10, 12, 15]
WEEKDAY = [7, 12, 15, 19]
BOOK_HOURS_WK, BOOK_HOURS_SUN = {7, 15}, {7, 9, 12, 15}   # sportsbook pulls: 2 a weekday + 4 Sunday = 16/week (~210 credits/month)
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
            _call(f"/api/status?backup=failed&files=0", tries=1)   # so the status panel doesn't keep showing last night's as current
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
        _call(f"/api/status?backup=failed&files=0", tries=1)

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
        summary = ("went live: " if r.get("ok") else "kept previous: ") + json.dumps({k: r.get(k) for k in ("games", "marginErr", "oldMarginErr", "totalErr", "combos", "minutes", "error") if r.get(k) is not None})
        print(f"[scheduler] combo rebuild -> {summary}", flush=True)
        _call(f"/api/status?combos={urllib.parse.quote(summary)}", tries=1)
    except Exception as e:
        print(f"[scheduler] combo rebuild failed: {e}", flush=True)
        _call(f"/api/status?combos={urllib.parse.quote('failed: ' + str(e))}", tries=1)

ESPN_SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
ESPN_ABBR = {"WSH": "WAS", "LAR": "LA"}   # ESPN -> nflverse team codes where they differ
def _espn_kickoffs():
    """{ "AWAY @ HOME": kickoff UTC } from ESPN for the next ~9 days (10/7: nflverse still had CHI @ GB at 1:00 PM ET after the game
    moved to 4:25 PM ET, so the closing-line snapshot and the kickoff-wave rerun would have fired hours early). Empty on any failure."""
    try:
        now = datetime.now(timezone.utc)
        url = f"{ESPN_SB}?dates={(now - timedelta(days=1)):%Y%m%d}-{(now + timedelta(days=9)):%Y%m%d}&limit=100"
        with urllib.request.urlopen(url, timeout=20) as r: d = json.loads(r.read().decode())
        out = {}
        for ev in d.get("events", []):
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
    espn = _espn_kickoffs()
    now, out = datetime.now(timezone.utc), []
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
            hours = SUNDAY if now_pt.weekday() == 6 else WEEKDAY
            if now_pt.hour in hours and now_pt.minute < 5:
                tag = f"s:{now_pt:%Y-%m-%d-%H}"
                # Sportsbook pull (3 credits of the 500/month free tier) only on some snapshots: before 9/28 every one
                # pulled books -- 31 a week, ~405 credits a month before retries, and a slow site makes _call retry
                # (each retry pulled again), so the month could run dry. Books are reference only; 16 a week is plenty.
                bk = "&books=1" if (now_pt.hour in BOOK_HOURS_SUN if now_pt.weekday() == 6 else now_pt.hour in BOOK_HOURS_WK) else ""
                if tag not in fired: fired[tag] = time.time(); _bg("snapshot", _call, "/api/snapshot?src=schedule" + bk, tries=2)   # 2 tries, not 3: a timeout usually means it DID run, and each retry appended a duplicate snapshot (and re-pulled books)
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
            rerun_now = ((now_pt.weekday() in (1, 3, 5) and now_pt.hour == 7 and 5 <= now_pt.minute < 10) or
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
            for k in {k for k, _ in kicks if k - timedelta(minutes=65) <= nowu < k - timedelta(minutes=55)}:
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
