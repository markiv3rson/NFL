#!/usr/bin/env python3
"""
nba_injuries.py — NBA only. The NBA's own injury report (a PDF the league publishes through the day, history from 2021-22).

  https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HHAM.pdf   (and a minutes variant, HH_MMPM — both are tried)
  columns: Game Date | Game Time | Matchup | Team | Player Name ("Last, First") | Current Status | Reason
  statuses: Out, Available, Questionable, Probable, Doubtful. Date/time/matchup/team are only printed on the first row of a group.

What this file does
  * parse_pdf()      PDF -> rows. Reads each cell by its position under the header; falls back to a text-token reader.
  * latest()         the newest report that exists right now (live injuries for the site).
  * history()        one report per game day since 2021-22, cached on disk, time-boxed per run (used to FIT the status weights).
  * fit_weights()    how often a listed player really sits, by status, from that history (injury_weights.py in the NFL app's spirit).

NOT verified against a real report from the cloud session that wrote it (the host is blocked there). Every entry point checks its own
output (check_rows) and the callers fall back (ESPN for live, the default weights for the fit) instead of trusting a parse that looks wrong.
Written from the documented layout, not copied from any package (the one that exists is AGPL).
"""
import datetime as dt, io, json, os, re, time, urllib.error, urllib.request
import numpy as np, pandas as pd

import nba_data as nd

BASE = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_"
STATUSES = ("Out", "Available", "Questionable", "Probable", "Doubtful")
CACHE_DIR = os.path.join(nd.CACHE, "injuries")
HEADER = ["Game Date", "Game Time", "Matchup", "Team", "Player Name", "Current Status", "Reason"]
TEAM_NAMES = sorted({v["name"] for v in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "teams.json"))).values()}, key=len, reverse=True)
NAME2ABBR = {v["name"]: k for k, v in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "teams.json"))).items()}
UA = {"User-Agent": "nba-model-service/1.0", "Accept": "application/pdf"}


def norm(s):
    """Match key for a player name: accents folded (the report says Jokic, the box score Jokić), punctuation and case dropped."""
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z ]", "", s.lower().replace("-", " ")).strip()


def flip_name(n):
    """'Lively II, Dereck' -> 'Dereck Lively II'. Already-flipped names pass through."""
    n = re.sub(r"\s+", " ", str(n)).strip()
    if "," in n:
        last, first = n.rsplit(",", 1)
        return f"{first.strip()} {last.strip()}".strip()
    return n


# ------------------------------------------------------------------------------------------------------ parsing
def pdf_words(pdf_bytes):
    """[(page, x0, top, text), ...] for every word, and the page text. pdfplumber (MIT) reads the PDF."""
    import pdfplumber
    words, text = [], []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pi, page in enumerate(pdf.pages):
            for w in page.extract_words(use_text_flow=False, keep_blank_chars=False, x_tolerance=1.5, y_tolerance=2):
                words.append((pi, float(w["x0"]), float(w["top"]), w["text"]))
            text.append(page.extract_text() or "")
    return words, "\n".join(text)


def _clean(cells):
    return {k: " ".join(v).strip() or None for k, v in cells.items()}


def parse_by_position(words):
    """Rows by cell position. Worked out from a real report (12/2025): the header gives each column's left edge; a player row is a line with a
    status word in the status column; the reason cell wraps onto lines ABOVE and BELOW its row (vertically centred), so every reason-only line
    goes to the nearest player row on its page; date / time / matchup / team are printed once per group and carry down."""
    by_page = {}
    for pi, x0, top, t in words:
        by_page.setdefault(pi, []).append((top, x0, t))
    cols, events = None, []                # events: ("row"|"frag"|"group", page, top, cells)
    for pi in sorted(by_page):
        lines, last = [], None
        for top, x0, t in sorted(by_page[pi]):
            if last is None or abs(top - last) > 3:
                lines.append((top, [])); last = top
            lines[-1][1].append((x0, t))
        for top, ln in lines:
            ln.sort()
            txt = " ".join(t for _, t in ln)
            if re.search(r"Game\s+Date", txt) and "Reason" in txt:                      # a header line: (re)learn the column starts
                starts, seen_game = {}, 0
                for x0, t in ln:
                    if t == "Game":
                        starts["Game Date" if seen_game == 0 else "Game Time"] = x0; seen_game += 1
                    elif t == "Matchup": starts["Matchup"] = x0
                    elif t == "Team": starts["Team"] = x0
                    elif t == "Player": starts["Player Name"] = x0
                    elif t == "Current": starts["Current Status"] = x0
                    elif t == "Reason": starts["Reason"] = x0
                if len(starts) == 7:
                    cols = sorted(starts.items(), key=lambda kv: kv[1])
                continue
            if cols is None or re.search(r"Injury Report|Page \d+ of \d+", txt):
                continue
            cells = {h: [] for h in HEADER}
            for x0, t in ln:
                col = cols[0][0]
                for h, sx in cols:
                    if x0 + 4 >= sx:
                        col = h
                cells[col].append(t)
            cells = _clean(cells)
            if cells["Current Status"] in STATUSES:
                events.append(("row", pi, top, cells))
            elif any(cells[h] for h in HEADER[:4]) or cells["Player Name"] or cells["Current Status"]:
                events.append(("group", pi, top, cells))           # team / matchup lines, "NOT YET SUBMITTED", anything that is not a player
            elif cells["Reason"]:
                events.append(("frag", pi, top, cells))
    rows = [e for e in events if e[0] == "row"]
    pieces = {id(e): [(e[2], e[3]["Reason"])] if e[3]["Reason"] else [] for e in rows}
    for kind, pi, top, cells in events:
        if kind != "frag":
            continue
        same = [e for e in rows if e[1] == pi] or rows
        if same:
            near = min(same, key=lambda e: (abs(e[2] - top), e[2]))     # the nearest player row on that page
            pieces[id(near)].append((top, cells["Reason"]))
    out, fill = [], {h: None for h in HEADER[:4]}
    for kind, pi, top, cells in events:
        if kind == "frag":
            continue
        for h in HEADER[:4]:
            if cells.get(h):
                fill[h] = cells[h]
        if kind == "row":
            r = {h: cells[h] for h in HEADER}
            for h in HEADER[:4]:
                r[h] = cells[h] or fill[h]
            ev = next(e for e in rows if e[3] is cells)
            r["Reason"] = " ".join(t for _, t in sorted(pieces[id(ev)])) or None
            out.append(r)
    return out


_TOK = re.compile(
    r"(?P<date>\d{1,2}/\d{1,2}/\d{4})|(?P<time>\d{1,2}:\d{2}\s*\((?:ET|CT|MT|PT)\))|(?P<match>\b[A-Z]{2,4}@[A-Z]{2,4}\b)|"
    r"(?P<team>" + "|".join(re.escape(t) for t in TEAM_NAMES) + r")|(?P<status>\b(?:" + "|".join(STATUSES) + r")\b)|(?P<nys>NOT YET SUBMITTED)")
_PLAYER_TAIL = re.compile(r"((?:[A-Z][\w.'’\-]*)(?: (?:Jr\.|Sr\.|II|III|IV|V))?, (?:[A-Z][\w.'’\-]*)(?: [A-Z][\w.'’\-]*)?)\s*$")


def parse_text(text):
    """Fallback when the header can't be found: read the page text as a stream of date / time / matchup / team / status tokens."""
    flat = re.sub(r"\s+", " ", text)
    items = [(m.lastgroup, m.group(), m.start(), m.end()) for m in _TOK.finditer(flat)]
    rows, state = [], {h: None for h in HEADER[:4]}
    for i, (kind, val, s, e) in enumerate(items):
        nxt = items[i + 1][2] if i + 1 < len(items) else len(flat)
        if kind == "date": state["Game Date"] = val
        elif kind == "time": state["Game Time"] = val
        elif kind == "match": state["Matchup"] = val
        elif kind == "team": state["Team"] = val
        elif kind == "status":
            before = flat[items[i - 1][3] if i else 0:s].strip()
            m = _PLAYER_TAIL.search(before)
            player = m.group(1) if m else before
            if rows and items[i - 1][0] == "status" and m:
                rows[-1]["Reason"] = before[:m.start()].strip() or rows[-1].get("Reason")
            after = flat[e:nxt].strip()
            nxt_kind = items[i + 1][0] if i + 1 < len(items) else None
            reason = after
            if nxt_kind == "status":
                mm = _PLAYER_TAIL.search(after)
                reason = after[:mm.start()].strip() if mm else after
            rows.append({**state, "Player Name": player, "Current Status": val, "Reason": reason or None})
    return rows


def _forward_fill(rows):
    last = {h: None for h in HEADER[:4]}
    out = []
    for r in rows:
        r = dict(r)
        for h in HEADER[:4]:
            if r.get(h):
                last[h] = r[h]
            else:
                r[h] = last[h]
        if r.pop("_group", False):
            continue
        out.append(r)
    return out


def check_rows(rows):
    """A parse is trusted only if it looks like an injury report: enough rows, real statuses, 'Last, First' names, known teams."""
    if len(rows) < 3:
        return False
    ok_status = np.mean([r.get("Current Status") in STATUSES for r in rows])
    ok_name = np.mean([bool(r.get("Player Name")) and "," in r["Player Name"] for r in rows])
    ok_team = np.mean([r.get("Team") in NAME2ABBR for r in rows])
    return ok_status >= 0.95 and ok_name >= 0.9 and ok_team >= 0.9


def parse_pdf(pdf_bytes):
    words, text = pdf_words(pdf_bytes)
    rows = parse_by_position(words)
    method = "position"
    if not check_rows(rows):
        rows, method = parse_text(text), "text"
    return {"rows": rows, "method": method, "ok": check_rows(rows)}


def teams_from_rows(rows, games=None):
    """{ABBR: [{name, status, reason}]} — Available players are left out (not an absence). `games` = optional set of 'AWAY@HOME'."""
    out = {}
    for r in rows:
        if r.get("Current Status") in (None, "Available") or r.get("Team") not in NAME2ABBR:
            continue
        if games and r.get("Matchup") not in games:
            continue
        out.setdefault(NAME2ABBR[r["Team"]], []).append({"name": flip_name(r["Player Name"]), "status": r["Current Status"], "reason": r.get("Reason")})
    return out


# ------------------------------------------------------------------------------------------------------ fetching
def _labels(ts):
    """File-name labels for the report published at ts (Eastern). Until Dec 2025 reports were hourly and named by the hour ('05PM' = the
    5:30 PM report); since Jan 2026 they come every 15 minutes, named with minutes ('05_30PM'). Both are tried; the hour-only name is only
    tried at :30 so it never returns a report published AFTER ts."""
    out = [ts.strftime("%I_%M%p")]
    if ts.minute == 30:
        out.insert(0, ts.strftime("%I%p"))
    return out


LAST = {"err": None}          # "net" = could not reach the host at all; "404" = reached it, that file does not exist


def _get(url, timeout=20):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            b = r.read()
            LAST["err"] = None if b[:4] == b"%PDF" else "notpdf"
            return b if b[:4] == b"%PDF" else None
    except urllib.error.HTTPError as e:
        LAST["err"] = "404" if e.code == 404 else f"http{e.code}"
    except (urllib.error.URLError, TimeoutError, OSError):
        LAST["err"] = "net"
    return None


def fetch_at(ts):
    """Try every label for the report at ts (a datetime, ET). Returns (bytes, url) or (None, None)."""
    for label in _labels(ts):
        url = f"{BASE}{ts:%Y-%m-%d}_{label}.pdf"
        b = _get(url)
        if b:
            return b, url
    return None, None


def latest(now_et=None, back_hours=10, step_min=15):
    """The newest report available now: walk back from `now` in 15-minute steps. Returns {asOf, url, method, rows, teams} or {error}."""
    now_et = now_et or dt.datetime.now(dt.timezone.utc).astimezone(__import__("zoneinfo").ZoneInfo("America/New_York")).replace(tzinfo=None)
    ts = now_et.replace(second=0, microsecond=0, minute=(now_et.minute // step_min) * step_min)
    for k in range(int(back_hours * 60 / step_min)):
        b, url = fetch_at(ts - dt.timedelta(minutes=step_min * k))
        if b is None and LAST["err"] == "net":
            return {"error": "could not reach the NBA injury report host"}
        if b:
            try:
                p = parse_pdf(b)
            except Exception as e:                              # a PDF we can't even open
                return {"error": f"report downloaded but could not be read: {e}", "url": url}
            if not p["ok"]:
                return {"error": "report downloaded but its layout was not recognised", "url": url, "method": p["method"]}
            return {"asOf": (ts - dt.timedelta(minutes=step_min * k)).isoformat(), "url": url, "method": p["method"], "rows": p["rows"]}
    return {"error": "no report found in the last %d hours" % back_hours}


def history(seasons=None, max_seconds=900, today=None):
    """One report per game day (the one closest before the earliest tip-off, up to 6 hours earlier), cached under CACHE_DIR as parsed JSON.
    Days already cached (including 'no report') are not fetched again. Stops after max_seconds so a first run just continues next time.
    Returns {date: {"asOf", "rows"} | None}."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cs = nd.current_season(today)
    seasons = seasons or range(2022, cs + 1)
    t0, out, fetched, net_fail = time.time(), {}, 0, 0
    today = pd.Timestamp(today).date() if today is not None else pd.Timestamp.today().date()
    for s in seasons:
        sch = nd.schedule(s)
        if sch is None or not len(sch):
            continue
        sch = sch[sch.season_type == 2].copy()
        sch["et"] = pd.to_datetime(sch["game_date_time"], utc=True).dt.tz_convert("America/New_York").dt.tz_localize(None)
        first_tip = sch.groupby(sch["et"].dt.date)["et"].min()
        for d, tip in first_tip.items():
            if d >= today:
                continue
            f = os.path.join(CACHE_DIR, f"{d}.json")
            if os.path.exists(f):
                out[str(d)] = json.load(open(f)); continue
            if time.time() - t0 > max_seconds:
                continue
            if net_fail >= 3:                                  # the host is not reachable from here: stop, don't hammer it
                break
            found = None
            target = tip - dt.timedelta(minutes=75)
            target = (target if target.minute >= 30 else target - dt.timedelta(hours=1)).replace(minute=30, second=0, microsecond=0)   # the latest :30 report before then
            for k in range(12):                                # up to 6 hours back, half-hour steps
                b, url = fetch_at(target - dt.timedelta(minutes=30 * k))
                if b is None and LAST["err"] == "net":
                    break
                if b:
                    try:
                        p = parse_pdf(b)
                        if p["ok"]:
                            found = {"asOf": (target - dt.timedelta(minutes=30 * k)).isoformat(), "rows": p["rows"], "method": p["method"]}
                    except Exception:
                        pass
                    break
            fetched += 1
            if found is None and LAST["err"] == "net":         # unreachable is not "no report that day": don't cache it
                net_fail += 1
                continue
            json.dump(found, open(f, "w"))
            out[str(d)] = found
    return out


# ------------------------------------------------------------------------------------------------------ the weights
DEFAULT_W = {"out": 1.0, "doubtful": 0.9, "questionable": 0.4, "day-to-day": 0.4, "probable": 0.1, "available": 0.0}


def fit_weights(hist, pbox, min_n=25):
    """How often a listed rotation player really sits, by status. hist = history(); pbox = nba_features.player_games().
    Returns {"weights": {status: w}, "counts": {status: n}, "unlisted_sit_rate", "dates"} — a weight is only set when n >= min_n."""
    import nba_features as nf
    pbox = pbox.copy()
    pbox["key"] = pbox.athlete_display_name.map(norm)
    by_team = {t: g for t, g in pbox.groupby("team")}
    sat, n_ = {}, {}
    un_sat = un_n = 0
    used = 0

    for d, rep in hist.items():
        if not rep:
            continue
        day = pd.Timestamp(d).date()
        listed = {}
        for r in rep["rows"]:
            if r.get("Team") in nd._NAME_FIX.values() or r.get("Team") in NAME2ABBR:
                listed[(r["Team"], norm(flip_name(r["Player Name"])))] = r["Current Status"]
        used += 1
        for team, tp in by_team.items():
            today_rows = tp[tp.date == day]
            if today_rows.empty:
                continue
            rot = nf.rotation_now(pbox, team, day)
            if rot.empty:
                continue
            played = set(today_rows.loc[today_rows.played, "key"])
            for _, p in rot.iterrows():
                key = norm(p["name"])
                st = listed.get((team, key))
                sit = key not in played
                if st:
                    sat[st] = sat.get(st, 0) + int(sit); n_[st] = n_.get(st, 0) + 1
                else:
                    un_sat += int(sit); un_n += 1
    weights = {k.lower().replace(" ", "-"): round(sat[k] / n_[k], 3) for k in n_ if n_[k] >= min_n}
    return {"weights": weights, "counts": n_, "unlisted_sit_rate": round(un_sat / un_n, 4) if un_n else None, "unlisted_n": un_n, "dates": used,
            "built": str(pd.Timestamp.today().date())}


if __name__ == "__main__":
    r = latest()
    print({k: v for k, v in r.items() if k != "rows"}, len(r.get("rows") or []))
