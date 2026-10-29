"""
Scheduler (runs inside the Railway service, 24/7). Pacific time.
  Every day 5:15 AM:   automatic rebuild (daily_rebuild.run — publishes only if its checks pass), then the model reloads
                       (10/21: was 4 AM, but ESPN's box-score / play-by-play files for last night land ~11:30 UTC = 4:30 AM PDT,
                       so every 4 AM build ran without last night's games)
  Every day 5:35 AM:   refit the player-prop model; 5:55 AM: season simulation for the futures (Sundays also replay past seasons)
  Every day 8:15 AM:   catch-up: in season, if the engine still has no box score from yesterday, reload the files once more
  Every 30 min, 7 AM - 9:30 PM:  the site's /api/snapshot (Polymarket lines + model; saves each game's last pre-tip line = its closing line)
  3 minutes before every tip-off:  one more /api/snapshot, so each game's saved closing line is the real last line, not up to 30 minutes old
  Hourly at :20, 6 AM - 11 PM:  sync the Polymarket account (my bets)
  Nightly 11:45 PM:    grade finished games' picks (/api/results/grade); again at 1:45 PM (10/29: the props' re-check of ESPN's corrected boxes)
  Nightly 12:10 AM:    back up the NBA database (/api/backup, paged) to a file on the volume, last 30 nights kept (10/17)
Env: SITE_URL (the NBA site), SITE_LOGIN ("user:password" if the site has a login), VERCEL_BYPASS (only if Deployment Protection is on),
     SITE_API (10/17, merged site: "/api/nba" when SITE_URL is the combined NFL + NBA site; default "/api" = the old stand-alone NBA site).
"""
import base64, json, os, threading, time, urllib.error, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
_started = False
TIPS = []          # tonight's tip-off times (Pacific), refreshed from the site every 10 minutes


def _call(path, tries=3, timeout=280):
    site, login = os.environ.get("SITE_URL", "").strip().rstrip("/"), os.environ.get("SITE_LOGIN", "").strip()
    if not site:
        print("[scheduler] SITE_URL not set", flush=True)
        return None
    if path.startswith("/api/"): path = os.environ.get("SITE_API", "/api").strip().rstrip("/") + path[4:]   # merged site: /api/nba/... (10/28: once, before the retries -- inside the loop a retry asked /api/nba/nba/... and always failed)
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(site + path, headers={"Accept": "application/json", "User-Agent": "nba-scheduler/1.0"})
        if login:
            req.add_header("Authorization", "Basic " + base64.b64encode(login.encode()).decode())
        bypass = os.environ.get("VERCEL_BYPASS", "").strip()
        if bypass:
            req.add_header("x-vercel-protection-bypass", bypass)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                if body.lstrip()[:1] in (b"{", b"["):
                    print(f"[scheduler] {path} -> ok ({r.status}) {body[:120]!r}", flush=True)
                    return body
                print(f"[scheduler] {path} attempt {attempt}: got a web page, not data (status {r.status})", flush=True)
        except urllib.error.HTTPError as e:
            print(f"[scheduler] {path} attempt {attempt} failed: HTTP {e.code}", flush=True)
        except Exception as e:
            print(f"[scheduler] {path} attempt {attempt} failed: {e}", flush=True)
        if attempt < tries:
            time.sleep(60)
    print(f"[scheduler] {path} gave up after {tries} tries", flush=True)
    return None


def _rebuild():
    import daily_rebuild
    r = daily_rebuild.run()
    try:
        import app
        app._reload()
    except Exception as e:
        print("[scheduler] reload after rebuild failed:", e, flush=True)
    print("[scheduler] rebuild:", {k: r.get(k) for k in ("ok", "published", "failed_checks", "patterns")}, flush=True)


def refresh_tips():
    """Read the upcoming tip-off times from the site's slate (free: no sportsbook credits are spent by reading it)."""
    global TIPS
    body = _call("/api/slate", tries=1, timeout=60)
    if not body:
        return
    try:
        games = json.loads(body).get("games") or []
        TIPS = [datetime.fromisoformat(g["start"].replace("Z", "+00:00")).astimezone(PT) for g in games if g.get("start") and not g.get("inProgress")]
    except Exception as e:
        print("[scheduler] could not read tip-off times:", e, flush=True)


BACKUP_DIR = os.environ.get("BACKUP_DIR") or os.path.join(os.environ.get("MODEL_DIR", "/data"), "backups")


def _backup():
    """Every key of the NBA database, in ~2 MB pages, saved as one file (keeps the last 30 nights)."""
    data, cursor, pages = {}, "0", 0
    while True:
        raw = _call(f"/api/backup?cursor={cursor}")
        if not raw:
            print("[scheduler] backup page failed -- nothing saved", flush=True)
            _call("/api/backup?mark=failed&files=0", tries=1)
            return
        page = json.loads(raw)
        data.update(page.get("data") or {})
        cursor, pages = str(page.get("next", "0")), pages + 1
        if cursor == "0" or pages > 200:
            break
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        path = os.path.join(BACKUP_DIR, f"backup-{datetime.now(PT):%Y-%m-%d}.json")
        with open(path, "w") as f:
            json.dump({"ok": True, "t": datetime.now(timezone.utc).isoformat(), "keys": len(data), "pages": pages, "data": data}, f)
        files = sorted(x for x in os.listdir(BACKUP_DIR) if x.startswith("backup-"))
        for old in files[:-30]:
            os.remove(os.path.join(BACKUP_DIR, old))
        root = os.path.abspath(BACKUP_DIR).split(os.sep)[1] if os.path.abspath(BACKUP_DIR).count(os.sep) > 1 else ""
        persistent = bool(root) and os.path.ismount(os.sep + root)
        _call(f"/api/backup?mark={'volume' if persistent else 'temporary'}&files={min(len(files), 30)}", tries=1)
        print(f"[scheduler] backup saved {path} ({len(data)} keys)", flush=True)
    except Exception as e:
        print(f"[scheduler] backup save failed: {e}", flush=True)
        _call("/api/backup?mark=failed&files=0", tries=1)


def _props():
    """10/20: refit the player-prop model (nba_prop_model.py) with yesterday's box scores."""
    try:
        import nba_prop_model
        nba_prop_model.build_live(log=lambda m: print(m, flush=True))
    except Exception as e:
        print("[scheduler] prop model build failed:", str(e)[:200], flush=True)


def _catchup():
    """10/21: the box-score files can land late; in season, reload once more when the engine's newest game is older than yesterday."""
    try:
        import app
        e = app._engine["e"]
        if e is None or not getattr(e, "season_start", None):
            return
        today = datetime.now(PT).date()
        if str(today) <= e.season_start:
            return
        last = (e.lines_this_season() or {}).get("last")
        yday = str(today.fromordinal(today.toordinal() - 1))
        if last is None or last < yday:
            print(f"[scheduler] catch-up reload: newest box score {last}, yesterday {yday}", flush=True)
            app._reload()
    except Exception as ex:
        print("[scheduler] catch-up failed:", ex, flush=True)


def _futures():
    try:
        import app
        app._futures_job(force_backtest=datetime.now(PT).weekday() == 6)      # Sundays also replay past seasons
    except Exception as e:
        print("[scheduler] futures failed:", e, flush=True)


def due(now, last, tips=None):
    """Jobs due at this PT minute. `last` remembers what already ran so a job fires once per slot."""
    jobs = []
    key = now.strftime("%Y-%m-%d %H:%M")
    h, m = now.hour, now.minute
    if h == 5 and m == 15:
        jobs.append(("rebuild", _rebuild))
    if h == 5 and m == 55:
        jobs.append(("futures", _futures))
    if h == 5 and m == 35:
        jobs.append(("props", _props))
    if h == 8 and m == 15:
        jobs.append(("catchup", _catchup))
    # 10/29: the 12:10 AM backup was missed 10/28 and 10/29 (status:backup still 10/27) -- a night with no backup file is made up at 8:20 AM
    if h == 8 and m == 20 and not os.path.exists(os.path.join(BACKUP_DIR, f"backup-{now:%Y-%m-%d}.json")):
        jobs.append(("backup-catchup", _backup))
    if 7 <= h <= 21 and m in (0, 30):
        jobs.append(("snapshot", lambda: _call("/api/snapshot?src=cron")))
    for tip in tips or []:                      # the real closing line: one snapshot 3 minutes before each distinct tip-off
        if int((tip - now).total_seconds() // 60) == 3:
            jobs.append((f"close:{tip:%Y-%m-%d %H:%M}", lambda: _call("/api/snapshot?src=close")))
    if 6 <= h <= 23 and m == 20:
        jobs.append(("sync", lambda: _call("/api/mybets?sync=1")))
    if h == 23 and m == 45:
        jobs.append(("grade", lambda: _call("/api/results/grade")))
    # 10/29 night recheck: the props' 6-h re-check had no run to ride (grading was nightly only, so ESPN's box corrections waited ~24 h: 12 rows of
    # 10/28 still read the old box 10/29 evening) -- a second grade pass at 1:45 PM PT re-checks last night's games the same day (only final games grade)
    if h == 13 and m == 45:
        jobs.append(("grade-pm", lambda: _call("/api/results/grade")))
    if h == 0 and m == 10:
        jobs.append(("backup", _backup))
    return [(n, f) for n, f in jobs if last.get(n) != key and not last.__setitem__(n, key)]


def _loop():
    last = {}
    while True:
        try:
            now = datetime.now(PT)
            if now.minute % 10 == 5 and last.get("tips") != now.strftime("%H:%M") and not last.__setitem__("tips", now.strftime("%H:%M")):
                threading.Thread(target=refresh_tips, daemon=True).start()
            for name, fn in due(now, last, TIPS):
                threading.Thread(target=fn, daemon=True).start()
        except Exception as e:
            print("[scheduler] loop error:", e, flush=True)
        time.sleep(20)


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, daemon=True).start()
    print("[scheduler] started", flush=True)
