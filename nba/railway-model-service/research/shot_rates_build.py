"""Writes data/shot_rates.json (make rate per shot cell, see shot_quality.py) from ESPN play-by-play files, every regular-season shot.
Usage (from railway-model-service): PYTHONPATH=. python3 research/shot_rates_build.py <dir with play_by_play_<season>.parquet>"""
import sys, os, glob, json
import pandas as pd, pyarrow.parquet as pq
sys.path.insert(0, "."); import shot_quality as sq
parts = []
for f in sorted(glob.glob(os.path.join(sys.argv[1], "play_by_play_*.parquet"))):
    have = set(pq.read_schema(f).names)
    parts.append(sq.shots(pd.read_parquet(f, columns=[c for c in sq.PBP_COLS if c in have])))
S = pd.concat(parts, ignore_index=True)
r = sq.build_rates(S); r["shots"] = int(len(S)); r["seasons"] = sorted(int(x) for x in S.season.unique())
json.dump(r, open(sq.RATES_FILE, "w"), indent=0, sort_keys=True)
x = sq.expected(S, r)
print(f"shots {len(S):,} | cells {len(r['cell'])} | expected points per shot {x.mean():.4f} vs actual {(S.made * S.val).mean():.4f} | file {sq.RATES_FILE}")
