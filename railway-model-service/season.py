"""Which NFL season is current -- worked out from the date and the data, never typed in by hand.
Aug-Dec belong to that year's season, Jan-Jul to the previous one. data_season() falls back to last season while this
season's play-by-play hasn't been published yet (preseason / before Week 1 is played)."""
import datetime, urllib.request

BASE = "https://github.com/nflverse/nflverse-data/releases/download"

def calendar_season(today=None):
    d = today or datetime.date.today()
    return d.year if d.month >= 8 else d.year - 1

import time
_cache = {}
def data_season(today=None):
    s = calendar_season(today)
    hit = _cache.get(s)
    if hit and (hit[0] == s or time.time() - hit[1] < 6 * 3600): return hit[0]   # "not published" is rechecked every 6 h
    try:
        req = urllib.request.Request(f"{BASE}/pbp/play_by_play_{s}.parquet", method="HEAD")
        urllib.request.urlopen(req, timeout=30)
        _cache[s] = (s, time.time())
    except Exception:
        _cache[s] = (s - 1, time.time())   # not published yet: last season is the latest real data
    return _cache[s][0]
