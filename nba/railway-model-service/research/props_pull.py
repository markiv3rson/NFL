import json, os, ssl, time, urllib.request, datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt"); D = os.path.dirname(os.path.abspath(__file__))
def get(u, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"}), timeout=60, context=CTX) as r: return json.loads(r.read().decode())
        except Exception: time.sleep(1.5 * (i + 1))
    return None
evs = []
for off in range(0, 2000, 100):
    e = get(f"https://gamma-api.polymarket.com/events?series_id=10345&closed=true&limit=100&offset={off}&order=startTime&ascending=false")
    if not e: break
    evs += e
reg = [e for e in evs if "2025-10-21" <= e["slug"][-10:] <= "2026-04-12"]
print("events", len(evs), "regular season", len(reg), flush=True)
jobs = [(e, m) for e in reg for m in e.get("markets", []) if m.get("sportsMarketType") in ("points", "rebounds", "assists")]
print("prop markets", len(jobs), flush=True)
if jobs: print("rule:", jobs[0][1].get("description", "")[:600], flush=True)
def kick(e, m):
    g = (m.get("gameStartTime") or e.get("startTime") or "").replace(" ", "T").replace("+00", "+00:00").replace("Z", "+00:00")
    try: return dt.datetime.fromisoformat(g).timestamp()
    except Exception: return None
def pull(job):
    e, m = job; k = kick(e, m); tr = []; off = 0
    while off < 4000:
        d = get(f"https://data-api.polymarket.com/trades?market={m['conditionId']}&limit=1000&offset={off}")
        if not isinstance(d, list): break
        tr += [(int(t["timestamp"]), float(t["price"]), int(t.get("outcomeIndex", 0))) for t in d if t.get("timestamp") is not None]
        if len(d) < 1000: break
        off += 1000
    p0 = sorted((t, p if oi == 0 else round(1 - p, 4)) for t, p, oi in tr); pre = [x for x in p0 if k is None or x[0] < k]
    return {"slug": e["slug"], "type": m["sportsMarketType"], "q": m.get("question"), "line": m.get("line"), "outcomes": m.get("outcomes"), "final": m.get("outcomePrices"),
            "nPre": len(pre), "n24": len([x for x in pre if k and x[0] >= k - 86400]), "close": pre[-1][1] if pre else None, "kick": k}
n = 0
with open(f"{D}/nba_props.jsonl", "w") as f, ThreadPoolExecutor(max_workers=12) as ex:
    for fu in as_completed([ex.submit(pull, j) for j in jobs]):
        try: f.write(json.dumps(fu.result()) + "\n"); n += 1
        except Exception: pass
        if n % 1000 == 0: print(n, flush=True)
print("done", n, flush=True)
