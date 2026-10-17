#!/usr/bin/env python3
"""
combo_study.py — NBA only. Finds situational patterns ("combos") that beat the base rate in every period.

  python3 combo_study.py            # scan, print results, write combo_table.json
  python3 combo_study.py --null 20  # also run the same scan on shuffled outcomes 20 times (false-discovery check)

Method
  * One row per team per regular-season game that has a closing line (the team's side of the spread / moneyline).
  * ~60 yes/no conditions about that team and its opponent BEFORE the game (home/away, favourite/dog, rest, back-to-back,
    last result, streak, how it has done against the line lately, ...). NOT included: anything about who is injured. In the
    back-test that is only known from the box score (who actually sat), which the page could not have known before tip-off, so
    patterns built on it looked better than they can be live (found 9/2026: 4 of 24 patterns). Injuries go into the margin model
    through the official injury report instead (nba_injuries.py).
  * A pattern is one condition or two joined with AND. Outcomes: covers the spread, wins the game (moneyline),
    game goes over the total.
  * Kept only if the hit rate beats the break-even rate in EACH of the three periods (2008-13, 2014-19, 2020-now),
    with at least MIN_N games in each period.
      - spread / total: break-even at -110 is 52.38%; PICK needs 56%+ over all periods, otherwise LEAN.
      - moneyline: must beat the market's own implied win chance by 3+ points in every period (favourites win
        a lot anyway), and win 56%+.
  * Persistence check: patterns found using 2008-2019 only, then looked at in 2020-now.
  * False-discovery check: the same scan on shuffled outcomes shows how many patterns pass by luck alone.
"""
import argparse, json, os, sys
import numpy as np, pandas as pd
import nba_data as nd, nba_features as nf

PERIODS = [(2008, 2013), (2014, 2019), (2020, nd.current_season())]   # the last period runs to the current season, so the rebuild scans this season's games
MIN_N = 60
BE = 0.5238          # break-even win rate at -110
ML_EDGE = 0.03
PICK_AT = 0.56


def implied(ml):
    ml = np.asarray(ml, float)
    return np.where(ml < 0, -ml / (-ml + 100), 100 / (ml + 100))


def merge_feat(c, feat):
    """Add missing_min/missing_pts/star_out (home = _h, away = _a) from nba_features.build() to team_context() output."""
    fh = feat.rename(columns={"team": "home", **{k: k + "_h" for k in feat.columns if k not in ("team", "game_id")}})
    fa = feat.rename(columns={"team": "away", **{k: k + "_a" for k in feat.columns if k not in ("team", "game_id")}})
    return c.merge(fh, on=["game_id", "home"], how="left").merge(fa, on=["game_id", "away"], how="left")


def side_rows(c, live=False):
    """Team-side rows with conditions. c = team_context() output with the feature columns merged in (merge_feat).
    live=True keeps games that have no result yet (the site's upcoming games)."""
    c = c[(c.season_type == 2) & c.home_line.notna()].copy() if not live else c.copy()
    rows = []
    for side in (1, -1):
        me, op = ("h", "a") if side == 1 else ("a", "h")
        d = pd.DataFrame({"game_id": c.game_id.values, "season": c.season.values, "side": side})
        d["line"] = c.home_line.values * side                         # + = this team is favoured by that much
        m = c.margin.values * side
        diff = m - d.line.values
        d["cover"] = np.where(diff == 0, np.nan, (diff > 0).astype(float))
        d["win"] = (m > 0).astype(float)
        ml_me = c.ml_home.values if side == 1 else c.ml_away.values
        ml_op = c.ml_away.values if side == 1 else c.ml_home.values
        ml_me = np.where(np.asarray(ml_me, float) == 0, np.nan, ml_me); ml_op = np.where(np.asarray(ml_op, float) == 0, np.nan, ml_op)
        pi, po = implied(ml_me), implied(ml_op)
        imp = pi / (pi + po)
        d["implied"] = np.where(np.isnan(imp), 0.5, imp)
        d["win"] = np.where(np.isnan(imp), np.nan, d["win"])     # no usable moneyline: leave out of the moneyline scan
        d["over"] = np.where(c.total.values == c.total_line.values, np.nan, (c.total.values > c.total_line.values).astype(float))
        g = lambda k: c[f"{me}_{k}"].values
        o = lambda k: c[f"{op}_{k}"].values
        C = {}
        C["home"] = np.full(len(c), side == 1); C["away"] = ~C["home"]
        C["fav"] = d.line.values > 0; C["dog"] = d.line.values < 0
        al = np.abs(d.line.values)
        C["line<=2"] = al <= 2; C["line2-5"] = (al > 2) & (al <= 5); C["line5-9"] = (al > 5) & (al < 9.5); C["line9.5+"] = al >= 9.5
        C["total<215"] = c.total_line.values < 215; C["total225+"] = c.total_line.values >= 225
        C["b2b"] = g("rest") == 1; C["rested3+"] = g("rest") >= 3
        C["opp_b2b"] = o("rest") == 1; C["opp_rested3+"] = o("rest") >= 3
        C["rest_adv2+"] = (g("rest").clip(max=5) - o("rest").clip(max=5)) >= 2
        C["rest_dis2+"] = (o("rest").clip(max=5) - g("rest").clip(max=5)) >= 2
        C["3in4"] = g("games_in_4") >= 3; C["opp_3in4"] = o("games_in_4") >= 3
        # travel (added 10/14): flew 1500+ km since the last game (within 3 days); and who plays at altitude (Denver / Utah)
        tk = lambda w: c[f"{w}_trav_km"].fillna(0).values if f"{w}_trav_km" in c.columns else np.zeros(len(c))      # a frame without travel = no travel
        C["trav_far"] = tk(me) >= 1500; C["opp_trav_far"] = tk(op) >= 1500
        alt = c.home.map(lambda t: nf.travel_km(t, t) == 0 and nd._norm(t) in nf.ALTITUDE).values
        C["road_at_altitude"] = alt & (side == -1); C["home_at_altitude"] = alt & (side == 1)
        for who, f_ in (("", g), ("opp_", o)):
            lm = f_("last_margin")
            C[who + "off_win"] = f_("last_win") == 1; C[who + "off_loss"] = f_("last_win") == 0
            C[who + "off_blowout_win"] = lm >= 15; C[who + "off_blowout_loss"] = lm <= -15
            C[who + "off_close_loss"] = (lm < 0) & (lm >= -5); C[who + "off_close_win"] = (lm > 0) & (lm <= 5)
            C[who + "off_cover"] = pd.Series(f_("last_cover")).eq(1).values
            C[who + "off_nocover"] = pd.Series(f_("last_cover")).eq(0).values
            C[who + "win_streak3+"] = f_("streak") >= 3; C[who + "loss_streak3+"] = f_("streak") <= -3
            C[who + "cover5_hi"] = f_("cover5") >= 0.8; C[who + "cover5_lo"] = f_("cover5") <= 0.2
            C[who + "hot5"] = f_("avg_margin5") >= 6; C[who + "cold5"] = f_("avg_margin5") <= -6
            C[who + "good_team"] = f_("win_pct") >= 0.6; C[who + "bad_team"] = f_("win_pct") <= 0.4
            C[who + "last_over"] = pd.Series(f_("last_over")).eq(1).values
            C[who + "last_under"] = pd.Series(f_("last_over")).eq(0).values
            C[who + "over5_hi"] = f_("over5") >= 0.8; C[who + "over5_lo"] = f_("over5") <= 0.2
            C[who + "last_total_hi"] = f_("last_total") >= 235; C[who + "last_total_lo"] = f_("last_total") <= 200
            C[who + "early"] = f_("gp") < 15; C[who + "late"] = f_("gp") >= 65
        cond = pd.DataFrame({k: np.asarray(v, bool) for k, v in C.items()})
        rows.append(pd.concat([d.reset_index(drop=True), cond], axis=1))
    return pd.concat(rows, ignore_index=True)


def game_rows(c, live=False):
    """One row per game for totals: conditions that involve both teams."""
    c = c[(c.season_type == 2) & c.total_line.notna()].copy() if not live else c.copy()
    d = pd.DataFrame({"game_id": c.game_id.values, "season": c.season.values})
    d["over"] = np.where(c.total.values == c.total_line.values, np.nan, (c.total.values > c.total_line.values).astype(float))
    C = {}
    tl = c.total_line.values
    C["total<205"] = tl < 205; C["total205-220"] = (tl >= 205) & (tl < 220); C["total220-230"] = (tl >= 220) & (tl < 230); C["total230+"] = tl >= 230
    al = np.abs(c.home_line.fillna(0).values)
    C["close_game"] = al <= 3; C["mismatch"] = al >= 9
    for nm, f_ in (("h", lambda k: c[f"h_{k}"].values), ("a", lambda k: c[f"a_{k}"].values)):
        pass
    h = lambda k: c[f"h_{k}"].values
    a = lambda k: c[f"a_{k}"].values
    C["either_b2b"] = (h("rest") == 1) | (a("rest") == 1); C["both_b2b"] = (h("rest") == 1) & (a("rest") == 1)
    C["both_rested"] = (h("rest") >= 3) & (a("rest") >= 3)
    C["both_over5_hi"] = (h("over5") >= 0.6) & (a("over5") >= 0.6); C["both_over5_lo"] = (h("over5") <= 0.4) & (a("over5") <= 0.4)
    C["either_over5_hi"] = (h("over5") >= 0.8) | (a("over5") >= 0.8); C["either_over5_lo"] = (h("over5") <= 0.2) | (a("over5") <= 0.2)
    C["both_last_over"] = pd.Series(h("last_over")).eq(1).values & pd.Series(a("last_over")).eq(1).values
    C["both_last_under"] = pd.Series(h("last_over")).eq(0).values & pd.Series(a("last_over")).eq(0).values
    C["both_last_total_hi"] = (h("last_total") >= 230) & (a("last_total") >= 230)
    C["both_last_total_lo"] = (h("last_total") <= 205) & (a("last_total") <= 205)
    C["early_season"] = (h("gp") < 15) | (a("gp") < 15); C["late_season"] = (h("gp") >= 65) & (a("gp") >= 65)
    C["both_good"] = (h("win_pct") >= 0.55) & (a("win_pct") >= 0.55); C["both_bad"] = (h("win_pct") <= 0.45) & (a("win_pct") <= 0.45)
    C["both_hot5"] = (h("avg_margin5") >= 3) & (a("avg_margin5") >= 3)
    C["blowout_last_either"] = (h("last_margin").__abs__() >= 20) | (a("last_margin").__abs__() >= 20)
    cond = pd.DataFrame({k: np.asarray(v, bool) for k, v in C.items()})
    return pd.concat([d.reset_index(drop=True), cond], axis=1)


def scan(rows, outcome, base=None, min_n=MIN_N, pairs=True):
    """All single and pair patterns. Returns a DataFrame of patterns with per-period n and rate.
    base: None -> compare to BE; or a column name of the 'expected' rate (moneyline implied chance)."""
    meta = {"game_id", "season", "side", "line", "cover", "win", "implied", "over"}
    names = [c for c in rows.columns if c not in meta]
    A = rows[names].values.astype(np.float32)
    y = rows[outcome].values
    valid = ~np.isnan(y)
    yy = np.where(valid, y, 0).astype(np.float32)
    exp = rows[base].values.astype(np.float32) if base else None
    per = []
    for lo, hi in PERIODS:
        m = valid & (rows.season.values >= lo) & (rows.season.values <= hi)
        Ap = A[m]; yp = yy[m]
        n1 = Ap.sum(0); w1 = (Ap * yp[:, None]).sum(0)
        e1 = (Ap * exp[m][:, None]).sum(0) if base else None
        if pairs:
            n2 = Ap.T @ Ap; w2 = Ap.T @ (Ap * yp[:, None])
            e2 = Ap.T @ (Ap * exp[m][:, None]) if base else None
        per.append((n1, w1, e1, n2 if pairs else None, w2 if pairs else None, e2 if pairs else None))
    out = []
    K = len(names)
    def add(label, idx):
        ns = [p[0][idx[0]] if len(idx) == 1 else p[3][idx[0], idx[1]] for p in per]
        ws = [p[1][idx[0]] if len(idx) == 1 else p[4][idx[0], idx[1]] for p in per]
        es = [(p[2][idx[0]] if len(idx) == 1 else p[5][idx[0], idx[1]]) if base else 0 for p in per]
        if min(ns) < min_n:
            return
        rate = [w / n for w, n in zip(ws, ns)]
        exr = [(e / n) if base else BE for e, n in zip(es, ns)]
        out.append((label, *ns, *rate, *exr, sum(ws) / sum(ns), sum(ns)))
    for i in range(K):
        add(names[i], (i,))
    if pairs:
        for i in range(K):
            for j in range(i + 1, K):
                add(names[i] + " & " + names[j], (i, j))
    cols = ["pattern", "n1", "n2", "n3", "r1", "r2", "r3", "e1", "e2", "e3", "rate", "n"]
    return pd.DataFrame(out, columns=cols)


def passes(t, ml=False):
    """Beats the expected rate in every period; moneyline also needs the 3-point edge and 56%+ pooled."""
    edge = ML_EDGE if ml else 0.0
    ok = (t.r1 - t.e1 > edge) & (t.r2 - t.e2 > edge) & (t.r3 - t.e3 > edge)
    ok &= (t.rate >= (PICK_AT if ml else BE))
    return t[ok]


def clean(t):
    """Drop contradictory pairs (e.g. home & away): they never have n in every period so they're gone already;
    this also drops patterns that duplicate a single condition exactly (same n in every period)."""
    return t.drop_duplicates(subset=["n1", "n2", "n3", "r1", "r2", "r3"]).reset_index(drop=True)


def run(null=0, seed=1):
    g = nd.games(); c = nf.team_context(g)
    c = merge_feat(c, nf.build(range(2008, nd.current_season() + 1)))
    sr = side_rows(c); gr = game_rows(c)
    results = {}
    summary = {"periods": [f"{a}-{b}" for a, b in PERIODS], "min_games_per_period": MIN_N, "break_even": BE * 100, "kinds": {}}
    for kind, rows, outc, base, ml in (("spread", sr, "cover", None, False), ("moneyline", sr, "win", "implied", True),
                                       ("total", gr, "over", None, False)):
        t = scan(rows, outc, base)
        good = clean(passes(t, ml))
        results[kind] = (t, good)
        print(f"\n== {kind}: {len(t)} patterns tested, {len(good)} beat the rate in every period")
        for r in good.sort_values("rate", ascending=False).head(15).itertuples():
            print(f"  {r.pattern:60s} n={r.n:5.0f}  rate {r.rate:.3f}  periods {r.r1:.3f}/{r.r2:.3f}/{r.r3:.3f}")
        # persistence: found on 2008-2019 only, how do they do in 2020-now?
        early = t[(t.r1 > t.e1 + (ML_EDGE if ml else 0)) & (t.r2 > t.e2 + (ML_EDGE if ml else 0))]
        early = clean(early[((early.n1 * early.r1 + early.n2 * early.r2) / (early.n1 + early.n2)) >= (PICK_AT if ml else 0.54)])
        summary["kinds"][kind] = {"tested": int(len(t)), "kept": int(len(good))}
        if len(early):
            hold = ((early.r3 - early.e3) > (ML_EDGE if ml else 0)).mean()
            wr = (early.n3 * early.r3).sum() / early.n3.sum()
            summary["kinds"][kind]["persistence"] = {"found_2008_2019": int(len(early)), "still_beat_rate_2020_on": round(float(hold) * 100, 1),
                                                     "their_rate_2020_on": round(float(wr) * 100, 1),
                                                     "expected_2020_on": round(float(np.average(early.e3, weights=early.n3)) * 100, 1)}
            print(f"  persistence: {len(early)} patterns look good in 2008-2019; {hold:.0%} still beat the rate in 2020-now "
                  f"(pooled 2020-now rate of those patterns {wr:.3f}, expected {np.average(early.e3, weights=early.n3):.3f})")
    if null:
        rng = np.random.default_rng(seed)
        print(f"\n== false-discovery check: same scan on shuffled outcomes, {null} runs")
        for kind, rows, outc, base, ml in (("spread", sr, "cover", None, False), ("moneyline", sr, "win", "implied", True),
                                           ("total", gr, "over", None, False)):
            counts = []
            for k in range(null):
                r2 = rows.copy()
                if kind == "total":
                    r2[outc] = np.where(r2[outc].isna(), np.nan, rng.integers(0, 2, len(r2)).astype(float))
                elif kind == "spread":      # the two sides of one game are opposites
                    hc = pd.Series(rng.integers(0, 2, r2.game_id.nunique()).astype(float), index=r2.game_id.unique())
                    base_v = r2.game_id.map(hc).values
                    r2[outc] = np.where(r2[outc].isna(), np.nan, np.where(r2.side == 1, base_v, 1 - base_v))
                else:
                    p_home = r2.loc[r2.side == 1].set_index("game_id").implied
                    hw = pd.Series((rng.random(len(p_home)) < p_home.values).astype(float), index=p_home.index)
                    hv = r2.game_id.map(hw).values
                    r2[outc] = np.where(r2.side == 1, hv, 1 - hv)
                t = scan(r2, outc, base)
                counts.append(len(clean(passes(t, ml))))
            summary["kinds"][kind]["luck_only_mean"] = round(float(np.mean(counts)), 1)
            summary["kinds"][kind]["luck_only_max"] = int(max(counts))
            print(f"  {kind}: patterns passing by luck alone: mean {np.mean(counts):.1f}, max {max(counts)}  (real data found {len(results[kind][1])})")
    return results, sr, gr, summary


def write_table(results, summary, path_dir=None):
    """combo_table.json: every pattern kept. [kind, [conditions], pooled win %, games, [rate per period], [games per period]]"""
    import datetime
    d = path_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(d, exist_ok=True)
    rows = []
    for kind, (t, good) in results.items():
        for r in good.itertuples():
            rows.append([kind, r.pattern.split(" & "), round(r.rate * 100, 1), int(r.n),
                         [round(r.r1 * 100, 1), round(r.r2 * 100, 1), round(r.r3 * 100, 1)], [int(r.n1), int(r.n2), int(r.n3)],
                         [round(r.e1 * 100, 1), round(r.e2 * 100, 1), round(r.e3 * 100, 1)]])
    rows.sort(key=lambda x: (-x[2], -x[3]))
    out = {"built": str(datetime.date.today()), "periods": summary["periods"], "pick_at": round(PICK_AT * 100, 6), "table": rows}
    json.dump(out, open(os.path.join(d, "combo_table.json"), "w"))
    summ = {**summary, "built": out["built"], "patterns": len(rows)}
    hp = os.path.join(d, "honest_unseen.json")
    if not os.path.exists(hp): hp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "honest_unseen.json")      # honest_test.py's leave-one-season-out rates (measured once; shown next to the in-sample ones)
    if os.path.exists(hp):
        hu = json.load(open(hp))
        for k, v in summ.get("kinds", {}).items():
            if k in hu: v["unseen"] = hu[k]
    json.dump(summ, open(os.path.join(d, "combo_summary.json"), "w"), indent=1)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--null", type=int, default=0)
    a = ap.parse_args()
    res, sr, gr, summ = run(a.null)
    write_table(res, summ)
