import sys, json, re, pickle, numpy as np, pandas as pd
sys.path.insert(0, "/home/user/NFL/railway-model-service"); import prop_model as pm
D = "/tmp/claude-0/-home-user-NFL/9d58547f-a966-5d11-a288-e9ad77513bb7/scratchpad/nbap/"
nn = lambda s: " ".join(w for w in re.sub(r"[^a-z ]", "", str(s).lower().replace("-", " ").replace(".", "")).split() if w not in ("jr", "sr", "ii", "iii", "iv"))
OOF = pickle.load(open(D + "nba_oof.pkl", "rb"))
P = pd.DataFrame([json.loads(l) for l in open(D + "nba_props.jsonl")])
P = P[P.close.notna() & (P.n24 > 0)].copy()
P["player"] = P.q.str.split(":").str[0].map(nn); P["date"] = pd.to_datetime(P.slug.str[-10:])
print("traded in the last 24 h:", len(P), P.type.value_counts().to_dict())
rows = []
for stat in ("points", "rebounds", "assists"):
    O = OOF[stat]; sp_ = O[O.season < 2026]; sp = pm.Spread(sp_.mu.values, sp_[stat].values)
    te = O[O.season == 2026][["athlete_display_name", "date", "mu", stat, "b_" + stat]].copy(); te["player"] = te.athlete_display_name.map(nn)
    q = P[P.type == stat]
    m = q.merge(te, on=["player", "date"], how="inner")
    m2 = q.assign(date=q.date - pd.Timedelta(days=1)).merge(te, on=["player", "date"], how="inner")
    m = pd.concat([m, m2]).drop_duplicates(["slug", "q"])
    m["p_over"] = [float(sp.over([mu], [float(l)])[0]) for mu, l in zip(m.mu, m.line)]
    m["over"] = m[stat] > m.line.astype(float); m["stat"] = stat; rows.append(m)
R = pd.concat(rows, ignore_index=True); R.to_csv(D + "nba_real.csv", index=False)
print("matched to a box score + model number:", len(R))
for stat, g in R.groupby("stat"):
    for side in ("Over", "Under"):
        pc = g.p_over if side == "Over" else 1 - g.p_over; won = g.over if side == "Over" else ~g.over; mk = (g.close if side == "Over" else 1 - g.close)
        m = pc >= .65
        if not m.sum(): continue
        mo = g.date.dt.month
        by = " ".join(f"m{k}:{int(won[m & (mo == k)].sum())}-{int((~won[m & (mo == k)]).sum())}" for k in (10, 11, 12, 1, 2, 3, 4) if (m & (mo == k)).sum())
        bands = " ".join(f"{lo}-{hi}:{won[(pc>=lo/100)&(pc<hi/100)].mean()*100:.0f}({((pc>=lo/100)&(pc<hi/100)).sum()})" for lo, hi in ((65, 70), (70, 80), (80, 90), (90, 101)) if ((pc>=lo/100)&(pc<hi/100)).sum())
        agree = m & (mk >= .60); dis = m & (mk < .60)
        print(f"REAL {stat:8s} {side:5s} 65%+ said {pc[m].mean()*100:.1f} won {won[m].mean()*100:.1f}% ({int(won[m].sum())}-{int((~won[m]).sum())}) mkt {mk[m].mean()*100:.0f}c | mkt 60c+ {won[agree].mean()*100 if agree.sum() else float('nan'):.1f}% ({agree.sum()}) | mkt<60c {won[dis].mean()*100 if dis.sum() else float('nan'):.1f}% ({dis.sum()}) | {bands} | {by}")
s = R; print("Brier model", round(float(((s.p_over - s.over) ** 2).mean()), 4), "market", round(float(((s.close - s.over) ** 2).mean()), 4), len(s))
