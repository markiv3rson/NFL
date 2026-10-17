# Polymarket real closing prices for every 2025-26 regular-season NBA game market: moneyline + the busiest spread + the busiest total
# (highest volume = the main line). Closing price = the last trade-history point before the game's start time. Output: poly_closes_2026.csv
import json, subprocess, csv, sys, datetime as dt
from concurrent.futures import ThreadPoolExecutor
S = "/tmp/claude-0/-home-user-NBA/794f1d45-bf2d-5fa3-902d-11e3c451823a/scratchpad/"
def get(url):
    for _ in range(3):
        try:
            out = subprocess.run(["curl", "-s", "--max-time", "40", url], capture_output=True, text=True).stdout
            return json.loads(out)
        except Exception:
            pass
    return None
LO, HI = "2025-10-21", "2026-04-13"
events = []
for off in range(0, 4000, 200):
    ev = get(f"https://gamma-api.polymarket.com/events?series_id=10345&closed=true&limit=200&offset={off}&order=startTime&ascending=false")
    if not ev: break
    events += ev
    if min(str(e.get('startTime') or '9')[:10] for e in ev) < LO: break
print("closed events listed:", len(events), flush=True)
games = [e for e in events if LO <= str(e.get("startTime") or "")[:10] <= HI and e.get("markets")]
print("2025-26 regular-season window:", len(games), flush=True)
json.dump([{k: e.get(k) for k in ("id", "title", "slug", "startTime")} for e in games], open(S + "poly_closed_events.json", "w"))
def pick(e):
    ms = e["markets"]; out = {}
    ml = [m for m in ms if m.get("sportsMarketType") == "moneyline"]
    sp = [m for m in ms if m.get("sportsMarketType") == "spreads"]
    tt = [m for m in ms if m.get("sportsMarketType") == "totals"]
    vol = lambda m: float(m.get("volumeNum") or m.get("volume") or 0)
    if ml: out["ml"] = ml[0]
    if sp: out["spread"] = max(sp, key=vol)
    if tt: out["total"] = max(tt, key=vol)
    return out
def close_price(m, start_ts):
    try: tok = json.loads(m["clobTokenIds"])[0]
    except Exception: return None, None
    h = get(f"https://clob.polymarket.com/prices-history?market={tok}&startTs={start_ts - 7 * 86400}&endTs={start_ts + 86400}&fidelity=60")   # resolved markets answer only with an explicit window
    pts = (h or {}).get("history") or []
    before = [p for p in pts if p["t"] <= start_ts]
    if not before: return None, len(pts)
    return before[-1]["p"], len(pts)
def work(e):
    start = e.get("startTime"); st = int(dt.datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp())
    row = {"title": e.get("title"), "start": start, "slug": e.get("slug")}
    for k, m in pick(e).items():
        p, n = close_price(m, st)
        row[k + "_q"] = m.get("question"); row[k + "_line"] = m.get("line"); row[k + "_px"] = p; row[k + "_pts"] = n
        row[k + "_outcomes"] = m.get("outcomes"); row[k + "_final"] = m.get("outcomePrices"); row[k + "_vol"] = m.get("volumeNum")
    return row
rows = []
with ThreadPoolExecutor(max_workers=3) as ex:
    for i, r in enumerate(ex.map(work, games)):
        rows.append(r)
        if i % 100 == 0: print("done", i, flush=True)
keys = sorted({k for r in rows for k in r})
with open(S + "poly_closes_2026.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)
print("saved", len(rows), "rows", flush=True)
