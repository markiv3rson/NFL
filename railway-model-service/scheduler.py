"""
Snapshot scheduler (runs inside the Railway service, 24/7).
Calls the site's /api/snapshot on Mark's schedule, Pacific time:
  Sunday:  6, 7, 8, 9, 10 AM, 12 PM, 3 PM   (Polymarket + sportsbooks)
  Mon-Sat: 7 AM, 12 PM, 3 PM, 7 PM           (Polymarket + sportsbooks)
  Every kickoff: 3 minutes before -> closing-line snapshot (Polymarket; books reused)
  Every distinct kickoff wave: ~60 min before -> model rerun (catches that wave's active/inactive news)
  Nightly 11:45 PM: grade finished games
Env: SITE_URL (https://nfl-nfl9.vercel.app), SITE_LOGIN ("user:password" for the site's login).
"""
import json, os, threading, time, base64, csv, io, urllib.request, urllib.parse
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
    site, login = os.environ.get("SITE_URL", "").rstrip("/"), os.environ.get("SITE_LOGIN", "")
    if not site: print("[scheduler] SITE_URL not set", flush=True); return None
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(site + path, headers={"Accept": "application/json", "User-Agent": "nfl-slatezzz-scheduler/1.0"})
        if login: req.add_header("Authorization", "Basic " + base64.b64encode(login.encode()).decode())
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if body.lstrip()[:1] in (b"{", b"["):
                    print(f"[scheduler] {path} -> ok ({r.status}) {body[:160]!r}", flush=True); return body
                print(f"[scheduler] {path} attempt {attempt}: got a web page, not data (status {r.status}) — retrying", flush=True)
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
        if not raw: print("[scheduler] backup page failed — nothing saved", flush=True); return
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

def _retrain():
    """Weekly TD retrain, run IN-PROCESS (not over HTTP): a direct Python call so the gunicorn worker's
    one request slot stays free for real traffic (rerun, health) the whole time this runs. Only the
    training/network work competes for CPU; it never blocks the site from being reachable."""
    try:
        import td_prob
        season = td_prob.CURRENT
        # NOTE (9/28): this is the retrain that actually runs every Tuesday. It had its own copy of the logic, so the
        # leak fix and 3-season training made in app.py's /retrain-td never reached it. Both now share these rules:
        # fresh data first, 3 past seasons, and the 2 held-out weeks left OUT of training.
        td_prob.refresh_live(0)
        season_pg, _, _, _ = td_prob.player_games(season)
        cur_weeks = sorted(season_pg.week.unique().tolist())
        holdout = cur_weeks[-2:] if len(cur_weeks) >= 4 else []
        train_seasons = [2023, 2024, 2025] + ([season] if len(cur_weeks) > 2 else [])
        candidate = td_prob.fit_model(train_seasons, exclude=(season, holdout) if holdout else None)
        cand_brier = td_prob.eval_holdout(candidate, season, holdout) if holdout else None
        active_brier = td_prob.eval_holdout(td_prob.m, season, holdout) if holdout else None
        went_live = cand_brier is not None and active_brier is not None and cand_brier < active_brier - 1e-4
        if went_live:
            td_prob.m = candidate
            td_prob.save_active({"model": candidate, "trained": train_seasons, "holdout_weeks": holdout, "brier": cand_brier})
        summary = ("went live: " if went_live else "kept current model: ") + f"candidate {cand_brier} vs active {active_brier} on weeks {holdout}"
        print(f"[scheduler] retrain-td (in-process) -> {summary}", flush=True)
        _call(f"/api/status?retrain={urllib.parse.quote(summary)}", tries=1)
    except Exception as e:
        print(f"[scheduler] retrain-td failed: {e}", flush=True)
        _call(f"/api/status?retrain={urllib.parse.quote('failed: ' + str(e))}", tries=1)

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
                # Sportsbook pull (3 credits of the 500/month free tier) only on some snapshots: before 9/28 every one
                # pulled books -- 31 a week, ~405 credits a month before retries, and a slow site makes _call retry
                # (each retry pulled again), so the month could run dry. Books are reference only; 16 a week is plenty.
                bk = "&books=1" if (now_pt.hour in BOOK_HOURS_SUN if now_pt.weekday() == 6 else now_pt.hour in BOOK_HOURS_WK) else ""
                if tag not in fired: fired.add(tag); _call("/api/snapshot?src=schedule" + bk, tries=2)   # 2 tries, not 3: a timeout usually means it DID run, and each retry appended a duplicate snapshot (and re-pulled books)
            nowu = datetime.now(timezone.utc)
            due = {}
            for k, game in kicks:
                if k - timedelta(minutes=3) <= nowu < k: due.setdefault(k, []).append(game)
            for k, glist in due.items():
                tag = f"k:{k:%Y%m%d%H%M}"
                if tag not in fired: fired.add(tag); _call("/api/snapshot?src=kickoff&kickoff=" + urllib.parse.quote(",".join(glist)))
            # Automatic reruns: Tuesday 7:05 AM (new week loaded) and Sunday 9:05 AM (after final injury reports)
            # Added 9/28: Tue 7:30 (so the TD model retrained at 7:15 is actually used before Sunday; before, the Tuesday
            # numbers came from the OLD model and stayed up all week), Thu 7:05 (Wednesday's first practice report is in
            # the injury feed by then) and Sat 7:05 (Friday's final report). Before, Thu-Sat showed Tuesday's numbers.
            rerun_now = ((now_pt.weekday() in (1, 3, 5) and now_pt.hour == 7 and 5 <= now_pt.minute < 10) or
                         (now_pt.weekday() == 1 and now_pt.hour == 7 and 30 <= now_pt.minute < 35) or
                         (now_pt.weekday() == 6 and now_pt.hour == 9 and 5 <= now_pt.minute < 10))
            if rerun_now:
                tag = f"r:{now_pt:%Y-%m-%d-%H}-{now_pt.minute // 30}"
                if tag not in fired: fired.add(tag); _call("/api/rerun?src=auto")
            # Kickoff-wave reruns: one rerun per distinct kickoff time (10 AM, 1:05, 1:25, 5:20, TNF, SNF, MNF...),
            # fired ~60 min before that wave kicks off -- after teams must confirm active/inactive (~90 min before
            # kickoff) but with enough buffer that the news has settled. Catches every wave, not just the 9:05 AM
            # Sunday rerun, which only lines up with the 10 AM games.
            for k in {k for k, _ in kicks if k - timedelta(minutes=65) <= nowu < k - timedelta(minutes=55)}:
                tag = f"rw:{k:%Y%m%d%H%M}"
                if tag not in fired: fired.add(tag); _call("/api/rerun?src=wave")
            # Weekly TD retrain: Tuesday 7:15 AM, after the rerun above has the new week's data loaded.
            if now_pt.weekday() == 1 and now_pt.hour == 7 and 15 <= now_pt.minute < 20:
                tag = f"rt:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired.add(tag); _retrain()
            # Nightly backup at 12:05 AM
            if now_pt.hour == 0 and 5 <= now_pt.minute < 10:
                tag = f"b:{now_pt:%Y-%m-%d}"
                if tag not in fired: fired.add(tag); _backup()
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
