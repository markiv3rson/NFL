import json, os, ssl, time, urllib.request, datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
D = os.path.dirname(os.path.abspath(__file__)); CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
T = {'passing_yards','rushing_yards','receiving_yards','receptions','passing_attempts','passing_completions','longest_reception'}
def get(u, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"}), timeout=60, context=CTX) as r: return json.loads(r.read().decode())
        except Exception: time.sleep(1.5 * (i + 1))
    return None
def kick_ts(e, m):
    g = (m.get("gameStartTime") or e.get("startTime") or e.get("endDate") or "").replace(" ", "T").replace("+00", "+00:00").replace("Z", "+00:00")
    try: return dt.datetime.fromisoformat(g).timestamp()
    except Exception: return None
ev26 = json.load(open(f"{D}/../pm/events.json")); ev26 = ev26["closed"] + ev26["open"]
slugs = sorted({e["slug"] for e in ev26 if "2026-09-01" <= e["slug"][-10:] <= "2026-10-16"})
print("2026 game events", len(slugs), flush=True)
jobs = []
def props(s):
    r = get(f"https://gamma-api.polymarket.com/events?slug={s}-player-props"); r = r[0] if isinstance(r, list) and r else None
    return (s, r)
with ThreadPoolExecutor(max_workers=6) as ex:
    for s, pe in ex.map(props, slugs):
        if not pe: continue
        for m in pe.get("markets", []):
            if m.get("sportsMarketType") in T: jobs.append((s, pe, m))
print("prop markets to pull:", len(jobs), flush=True)
def pull(job):
    slug, e, m = job; cid = m["conditionId"]; kick = kick_ts(e, m); trades = []; off = 0
    while off < 6000:
        d = get(f"https://data-api.polymarket.com/trades?market={cid}&limit=1000&offset={off}")
        if not isinstance(d, list): break
        trades += [(int(t["timestamp"]), float(t["price"]), int(t.get("outcomeIndex", 0)), float(t.get("size") or 0)) for t in d if t.get("timestamp") is not None]
        if len(d) < 1000: break
        off += 1000
    p0 = sorted((t, (p if oi == 0 else round(1 - p, 4)), sz) for t, p, oi, sz in trades)   # price of Over
    pre = [x for x in p0 if kick is None or x[0] < kick]
    return {"slug": slug, "type": m.get("sportsMarketType"), "question": m.get("question"), "line": m.get("line"), "conditionId": cid, "kick": kick,
            "nPre": len(pre), "n2h": len([x for x in pre if kick and x[0] >= kick - 7200]) if kick else None,
            "n24": len([x for x in pre if kick and x[0] >= kick - 86400]) if kick else None,
            "first": pre[0][:2] if pre else None, "close": pre[-1][:2] if pre else None, "usd": round(sum(p * s for _, p, s in pre), 2),
            "vol": float(m.get("volumeNum") or 0), "final": m.get("outcomePrices"), "outcomes": m.get("outcomes")}
n = 0; t0 = time.time()
with open(f"{D}/markets_props.jsonl", "w") as f, ThreadPoolExecutor(max_workers=10) as ex:
    for fu in as_completed([ex.submit(pull, j) for j in jobs]):
        try: rec = fu.result()
        except Exception: continue
        f.write(json.dumps(rec) + "\n"); f.flush(); n += 1
        if n % 500 == 0: print(f"{n}/{len(jobs)} markets, {time.time()-t0:.0f}s", flush=True)
print("done", n, flush=True)
