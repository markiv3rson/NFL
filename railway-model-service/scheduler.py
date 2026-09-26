"""
Snapshot scheduler (runs inside the Railway service, 24/7).
Calls the site's /api/snapshot on Mark's schedule, Pacific time:
  Sunday:  6, 7, 8, 9, 10 AM, 12 PM, 3 PM   (Polymarket + sportsbooks)
  Mon-Sat: 7 AM, 12 PM, 3 PM, 7 PM           (Polymarket + sportsbooks)
  Every kickoff: 3 minutes before -> closing-line snapshot (Polymarket; books reused)
  Nightly 11:45 PM: grade finished games
Env: SITE_URL (https://nfl-nfl9.vercel.app), SITE_LOGIN ("user:password" for the site's login).
"""
import os, threading, time, base64, csv, io, urllib.request, urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

PT, ET = ZoneInfo("America/Los_Angeles"), ZoneInfo("America/New_York")
SUNDAY = [6, 7, 8, 9, 10, 12, 15]
WEEKDAY = [7, 12, 15, 19]
SCHED_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
_started = False

def _call(path):
    site, login = os.environ.get("SITE_URL", "").rstrip("/"), os.environ.get("SITE_LOGIN", "")
    if not site: print("[scheduler] SITE_URL not set", flush=True); return
    req = urllib.request.Request(site + path)
    if login: req.add_header("Authorization", "Basic " + base64.b64encode(login.encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=150) as r: print(f"[scheduler] {path} -> {r.read()[:200]!r}", flush=True)
    except Exception as e: print(f"[scheduler] {path} failed: {e}", flush=True)

def _kickoffs():
    """Upcoming kickoffs (UTC) for the next 8 days from the NFL schedule."""
    try:
        with urllib.request.urlopen(SCHED_URL, timeout=60) as r: rows = list(csv.DictReader(io.StringIO(r.read().decode())))
    except Exception as e:
        print(f"[scheduler] schedule load failed: {e}", flush=True); return []
    now, out = datetime.now(timezone.utc), []
    for x in rows:
        if x.get("game_type") != "REG" or not x.get("gameday") or not x.get("gametime"): continue
        try: k = datetime.strptime(f"{x['gameday']} {x['gametime']}", "%Y-%m-%d %H:%M").replace(tzinfo=ET).astimezone(timezone.utc)
        except ValueError: continue
        if now - timedelta(minutes=5) < k < now + timedelta(days=8): out.append((k, f"{x['away_team']} @ {x['home_team']}"))
    return out

def _loop():
    fired, kicks, kicks_at = set(), [], None
    while True:
        try:
            now_pt = datetime.now(PT)
            if kicks_at is None or (datetime.now(timezone.utc) - kicks_at) > timedelta(hours=1):
                kicks, kicks_at = _kickoffs(), datetime.now(timezone.utc)
            hours = SUNDAY if now_pt.weekday() == 6 else WEEKDAY
            if now_pt.hour in hours and now_pt.minute < 5:
                tag = f"s:{now_pt:%Y-%m-%d-%H}"
                if tag not in fired: fired.add(tag); _call("/api/snapshot?src=schedule&books=1")
            nowu = datetime.now(timezone.utc)
            due = {}
            for k, game in kicks:
                if k - timedelta(minutes=3) <= nowu < k: due.setdefault(k, []).append(game)
            for k, glist in due.items():
                tag = f"k:{k:%Y%m%d%H%M}"
                if tag not in fired: fired.add(tag); _call("/api/snapshot?src=kickoff&kickoff=" + urllib.parse.quote(",".join(glist)))
            if now_pt.hour == 23 and now_pt.minute >= 45:
                tag = f"g:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired.add(tag); _call("/api/results/grade")
        except Exception as e:
            print(f"[scheduler] loop error: {e}", flush=True)
        time.sleep(30)

def start():
    global _started
    if _started: return
    _started = True
    threading.Thread(target=_loop, daemon=True).start()
    print("[scheduler] started", flush=True)
