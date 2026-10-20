#!/usr/bin/env python3
"""
live.py — NBA only. Turns tonight's games + lines (+ injuries) into the numbers the site shows.

  Engine().slate([{away:"TOR", home:"DET", date:"2026-10-16", home_spread:-4.5, total:220.5,
                   ml:{home:0.62, away:0.40}, alts:[...], total_alts:[...],
                   injuries:{home:[{name,status}], away:[...]}}])

The conditions are the SAME code the research used (combo_study.side_rows / game_rows), so a live pick means exactly
what the history table says it means.
"""
import math, json, os, re
import numpy as np, pandas as pd

import nba_data as nd, nba_features as nf, fair_line as fl, combo_study as cs
import team_side as tsd   # 10/20: the Model (Team) line (data only)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
MODEL_DIR = os.environ.get("MODEL_DIR", DATA)       # the daily rebuild publishes here; falls back to the files shipped in the repo
TEAMS = json.load(open(os.path.join(DATA, "teams.json")))


def _load(name):
    p = os.path.join(MODEL_DIR, name)
    return json.load(open(p if os.path.exists(p) else os.path.join(DATA, name)))
NAME2ABBR = {v["name"]: k for k, v in TEAMS.items()}
# How much of a listed player's absence to count, by status. Defaults are guesses; the daily rebuild FITS them from the NBA's own injury
# reports (nba_injuries.fit_weights -> injury_weights.json) once enough history is loaded, and the fitted numbers replace these.
import nba_injuries as ni
import shot_quality as sqm
STATUS_W = dict(ni.DEFAULT_W)
PICK_AT = round(cs.PICK_AT * 100, 6)
BREAK_EVEN = 52.38      # -110 odds
ML_TOL = 0.25           # a moneyline more than 25 points away from what the spread implies is treated as a bad read


def _norm(s):
    return ni.norm(s)


def american(p):
    p = min(max(float(p), 0.01), 0.99)
    return -100 * p / (1 - p) if p >= 0.5 else 100 * (1 - p) / p


def sig(x):
    return 1 / (1 + math.exp(-x))


def sig_norm(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def tier(pct):
    return "pick" if pct >= PICK_AT else "lean"


class Engine:
    def __init__(self, coefs=None, table=None):
        self.coefs = coefs or _load("model_coefs.json")
        self.table = table or _load("combo_table.json")
        self.honest = self._honest()
        self.status_w = self._weights()
        self.loaded_at = None
        self._ratings = {}
        self.sched = {}
        self.shotq = {}

    # ------------------------------------------------------------------ data
    def _weights(self):
        try:
            w = _load("injury_weights.json")["weights"]
        except Exception:
            w = {}
        return {**ni.DEFAULT_W, **w}

    def reload_files(self):
        self.coefs, self.table = _load("model_coefs.json"), _load("combo_table.json")
        self.status_w = self._weights()
        return self

    def load(self):
        """(Re)load history. Called at start and by the daily rebuild. Everything is loaded first and swapped in at the end,
        so a failure half-way (a download that broke) leaves the engine serving what it had."""
        cs_ = nd.current_season()
        g = nd.games()
        tg = nd.team_games()
        pbox = nf.player_games(range(max(cs_ - 1, nd.FIRST_SEASON), cs_ + 1))
        _, states = nf.team_context(g, return_states=True)
        sch = nd.schedule(cs_)
        sched = nf.schedule_index(sch)        # rest / travel for tonight come from the schedule (see _ctx)
        reg = sch[sch.season_type == 2] if sch is not None and len(sch) else None
        season_start = str(pd.to_datetime(reg.game_date).min().date()) if reg is not None and len(reg) else None
        h = g[(g.season_type == 2) & g.home_line.notna()]
        hist_side = pd.concat([pd.DataFrame({"line": h.home_line.values, "m": h.margin.values}),
                               pd.DataFrame({"line": -h.home_line.values, "m": -h.margin.values})], ignore_index=True)
        t = g[(g.season_type == 2) & g.total_line.notna()]
        hist_tot = pd.DataFrame({"line": t.total_line.values, "total": t.total.values})
        try:                                   # SHOT QUALITY totals rule: this season's shots from ESPN's play-by-play (no file yet in preseason)
            shotq = sqm.state(nd.pbp(cs_, columns=sqm.PBP_COLS), g, cs_)
            if shotq.get("stale"):
                nd.STALE[f"play_by_play_{cs_}"] = shotq["stale"]
        except Exception as e:
            print(f"[load] shot quality skipped: {e!r}", flush=True); shotq = {}
        try:                                   # 10/20 Model (Team): the team-numbers fit (saved 2 days) and every team-game row for season-to-date numbers
            team_side, team_T = tsd.load_or_fit(g), tsd.team_rows(g)
        except Exception as e:
            print(f"[load] team side skipped: {e!r}", flush=True); team_side, team_T = None, None
        self.season, self.g, self.tg, self.pbox, self.states, self.sched, self.season_start, self.hist_side, self.hist_tot = cs_, g, tg, pbox, states, sched, season_start, hist_side, hist_tot
        self.team_side, self.team_T, self._tnums = team_side, team_T, {}
        self.shotq = shotq
        self._ratings = {}
        self.loaded_at = pd.Timestamp.now().isoformat()
        return self

    def ratings(self, date):
        if date not in self._ratings:
            if len(self._ratings) > 6:
                self._ratings.clear()
            self._ratings[date] = fl.Ratings(self.tg, date)
        return self._ratings[date]

    def team_numbers(self, date):
        """Season-to-date team numbers before `date` for the Model (Team) line (cached per date)."""
        if self.team_T is None:
            return {}
        if date not in self._tnums:
            if len(self._tnums) > 6:
                self._tnums.clear()
            self._tnums[date] = tsd.season_numbers(self.team_T, self.season, date)
        return self._tnums[date]

    def is_preseason(self, date):
        if self.season_start is None:                       # no schedule file read yet: before Oct 15 is preseason, never real picks
            return str(date) < f"{int(self.season) - 1}-10-15"
        return str(date) < self.season_start

    # ------------------------------------------------------------- one team
    def _ctx(self, team_name, date, venue=None):
        st = self.states.get(team_name)
        if st is None or st.season != self.season:
            st = nf.TeamState()
        c = nf._ctx(st, pd.Timestamp(date).date(), venue)
        sr = nf.schedule_rest(getattr(self, "sched", None), team_name, date, venue)   # the schedule knows yesterday's game before its box score arrives
        if sr is not None and (st.last_date is None or sr[2] >= st.last_date):      # a box score newer than the schedule (a Cup game still listed as TBD) wins
            c["rest"], c["trav_km"] = sr[0], sr[1]
        c.update(sqm.ctx(getattr(self, "shotq", None), team_name))                   # shot quality numbers for the card's totals rule
        return c

    def lines_this_season(self):
        return season_lines(getattr(self, "g", None), self.season)

    def _missing(self, team_name, date, inj):
        """Rotation minutes/points the injury list takes away, weighted by status."""
        d = pd.Timestamp(date).date()
        rot = nf.rotation_now(self.pbox, team_name, d)
        if not len(rot):
            return {"missing_min": 0.0, "missing_pts": 0.0, "star_out": 0, "out": [], "n_rot": 0, "hard_pts": 0.0}
        rot = rot.assign(key=rot.name.map(_norm))
        top = rot.sort_values("ppg", ascending=False).iloc[0].key
        mm = mp = hp = 0.0
        star = 0
        out = []
        for p in inj or []:
            w = self.status_w.get(str(p.get("status", "")).lower().replace(" ", "-"), 0.4)
            k = _norm(p.get("name", ""))
            hit = rot[rot.key == k]
            if hit.empty or w <= 0:
                continue
            r = hit.iloc[0]
            mm += w * r.mpg; mp += w * r.ppg
            if w >= 0.9:
                hp += r.ppg      # firmly out
            if k == top and w >= 0.9:
                star = 1
            out.append({"name": r["name"], "status": p.get("status"), "mpg": round(float(r.mpg), 1), "ppg": round(float(r.ppg), 1), "w": w})
        unmatched = [p.get("name") for p in (inj or []) if rot[rot.key == _norm(p.get("name", ""))].empty]   # listed players the rotation does not know (new signing, trade)
        return {"missing_min": mm, "missing_pts": mp, "star_out": star, "out": out, "n_rot": len(rot), "hard_pts": hp, "unmatched": unmatched}

    # -------------------------------------------------------------- teasers
    def spread_rate(self, fav_by_main, fav_by_alt):
        """Historical share of games a team covers `fav_by_alt` (favoured-by number) when its market line was about `fav_by_main`."""
        h = self.hist_side
        w = h[(h.line - fav_by_main).abs() <= 1.0]
        if len(w) < 200:
            w = h[(h.line - fav_by_main).abs() <= 2.0]
        hit = (w.m - fav_by_alt) > 0
        push = (w.m - fav_by_alt) == 0
        return float(hit.sum() / max((~push).sum(), 1)), int(len(w))

    def total_rate(self, main, alt, over):
        h = self.hist_tot
        w = h[(h.line - main).abs() <= 4.0]
        hit = (w.total > alt) if over else (w.total < alt)
        push = w.total == alt
        return float(hit.sum() / max((~push).sum(), 1)), int(len(w))

    # ---------------------------------------------------------------- slate
    def slate(self, games):
        if self.loaded_at is None:
            self.load()
        rows, side_in, failed = [], [], []
        for i, gm in enumerate(games):
          try:
            a, h = gm["away"], gm["home"]
            an, hn = TEAMS[a]["name"], TEAMS[h]["name"]
            date = gm.get("date") or str(pd.Timestamp.now().date())
            ctx_h, ctx_a = self._ctx(hn, date, hn), self._ctx(an, date, hn)
            inj = gm.get("injuries") or {}
            mh = self._missing(hn, date, inj.get("home")); ma = self._missing(an, date, inj.get("away"))
            R = self.ratings(date)
            p = R.predict(hn, an)
            hs = gm.get("home_spread")
            home_line = None if hs is None else -float(hs)           # + = home favoured
            tl = gm.get("total")
            ml = gm.get("ml") or {}
            ml_home = american(ml["home"] / (ml["home"] + ml["away"])) if ml.get("home") and ml.get("away") else np.nan
            ml_away = american(ml["away"] / (ml["home"] + ml["away"])) if ml.get("home") and ml.get("away") else np.nan
            c = {"game_id": -(i + 1), "season": self.season, "season_type": 2, "date": pd.Timestamp(date).date(), "home": hn, "away": an,
                 "home_line": home_line if home_line is not None else np.nan, "total_line": float(tl) if tl is not None else np.nan,
                 "ml_home": ml_home, "ml_away": ml_away, "margin": np.nan, "total": np.nan,
                 "missing_min_h": mh["missing_min"], "missing_pts_h": mh["missing_pts"], "star_out_h": mh["star_out"],
                 "missing_min_a": ma["missing_min"], "missing_pts_a": ma["missing_pts"], "star_out_a": ma["star_out"]}
            c.update({f"h_{k}": v for k, v in ctx_h.items()}); c.update({f"a_{k}": v for k, v in ctx_a.items()})
            side_in.append(c)
            rows.append({"gm": gm, "p": p, "mh": mh, "ma": ma, "ctx_h": ctx_h, "ctx_a": ctx_a, "home_line": home_line, "date": date,
                         "hn": hn, "an": an, "i": i})
          except Exception as ex:                      # one odd game (a bad field) must not cost the whole slate
            failed.append(_failed_game(gm, ex))
        cdf = pd.DataFrame(side_in)
        sr = cs.side_rows(cdf, live=True) if len(cdf) else None
        gr = cs.game_rows(cdf, live=True) if len(cdf) else None
        out = []
        for r in rows:
            try:
                out.append(self._one(r, sr, gr))
            except Exception as ex:
                out.append(_failed_game(r["gm"], ex))
        return out + failed

    def _one(self, r, sr, gr):
        gm = r["gm"]; a, h = gm["away"], gm["home"]
        co = self.coefs
        pre = self.is_preseason(r["date"])
        res = {"key": f"{a} @ {h}", "away": a, "home": h, "date": r["date"], "preseason": pre,
               "context": {"home": _pub(r["ctx_h"]), "away": _pub(r["ctx_a"])},
               "injuries": {"home": r["mh"]["out"], "away": r["ma"]["out"]},
               "starOut": {"home": int(r["mh"]["star_out"]), "away": int(r["ma"]["star_out"])}}
        if r["p"] is None:
            res["model"] = None
            return res
        m_margin, m_total = r["p"][0], r["p"][1]
        x = {"m_margin": m_margin,
             "b2b_d": int(r["ctx_a"]["rest"] == 1) - int(r["ctx_h"]["rest"] == 1),
             "miss_pts_d": r["ma"]["missing_pts"] - r["mh"]["missing_pts"],
             "star_d": r["ma"]["star_out"] - r["mh"]["star_out"]}
        raw = co["margin"]["icpt"] + co["margin"]["coef"][0] * m_margin
        margin = co["margin"]["icpt"] + sum(k * x[c_] for k, c_ in zip(co["margin"]["coef"], co["margin"]["cols"]))
        total = co["total"]["icpt"] + co["total"]["coef"][0] * m_total
        pm = sig(co["win_model"]["icpt"] + co["win_model"]["coef"] * margin)
        win = pm
        hl = r["home_line"]
        if hl is not None:
            wm = co["win_market"]
            win = sig(wm["icpt"] + wm["coef"][0] * hl + wm["coef"][1] * margin)
        mkt = None
        ml = gm.get("ml")
        if ml and ml.get("home") and ml.get("away"):
            mkt = ml["home"] / (ml["home"] + ml["away"])
        has_inj = bool(r["mh"]["out"] or r["ma"]["out"])
        res["model"] = {"margin": round(margin, 1), "rawMargin": round(raw, 1), "total": round(total, 1), "homeWinPct": round(win * 100, 1),
                        "modelOnlyWinPct": round(pm * 100, 1), "marketWinPct": None if mkt is None else round(mkt * 100, 1),
                        "injuryShift": round(margin - raw - co["margin"]["coef"][1] * x["b2b_d"], 1),
                        "restShift": round(co["margin"]["coef"][1] * x["b2b_d"], 1),
                        "estimate": bool(has_inj or pre), "injuryBasis": co.get("injury_basis"), "sdMargin": round(co["sd_margin"], 1), "sdTotal": round(co["sd_total"], 1)}
        # 10/20 Model (Team): the team-numbers side at Polymarket's line, how sure -- DATA on the card (walk-forward 50.7%, never a pick)
        try:
            hs_site = gm.get("home_spread")
            if hs_site is not None and float(hs_site) != 0 and getattr(self, "team_side", None):
                nums = self.team_numbers(r["date"]); pc = tsd.prob_home_covers(self.team_side, nums.get(r["hn"]), nums.get(r["an"]), r["ctx_h"].get("rest"), r["ctx_a"].get("rest"))
                if pc is not None:
                    home_side = pc > 0.5; hs_site = float(hs_site)
                    res["model"]["teamSide"] = {"team": h if home_side else a, "line": hs_site if home_side else -hs_site, "pct": round(max(pc, 1 - pc) * 100, 1)}
        except Exception as ex:
            res["model"]["teamSideError"] = str(ex)[:120]
        res["spread"] = self._spread(gm, r, margin, sr)
        res["total"] = self._total(gm, total, gr, r)
        res["ml"] = self._ml(gm, win, mkt, a, h, sr, r)
        res["teasers"] = self._teasers(gm, r)
        res["lines"] = self._lines(gm)
        if pre:   # patterns and win rates were tested on regular-season games only: kept as a TEST (shown, saved and graded, never a pick)
            for k in ("spread", "total", "ml"):
                if res.get(k) and res[k].get("pick") and res[k]["pick"]["tier"] in ("pick", "lean"):
                    pk = res[k]["pick"]
                    pk["testTier"] = pk["tier"]; pk["tier"] = "test"
                    pk["note"] = "Preseason TEST: patterns were tested on regular-season games only, so this is not a pick"
        return res

    def _honest(self):
        """Win rate of each kind of pattern on games it had NEVER seen (honest_test.py, each season left out). The rate a pattern shows for the
        games it was found in (e.g. 59.1%) is not a win rate; this is. A pattern is only a PICK / LEAN when its honest rate says so."""
        try:
            return {k: v for k, v in _load("honest_unseen.json").items() if isinstance(v, dict)}
        except Exception:
            return {}

    def _pattern_pick(self, kind, best):
        """Turn a matched pattern into a pick whose % is the honest unseen rate for its kind (tier 'none' when that is below break-even)."""
        h = self.honest.get(kind)
        pct = h["win_rate"] if h else best["rate"]
        best["histRate"] = best["rate"]; best["pct"] = pct
        if h:
            best["honest"] = {"winRate": h["win_rate"], "games": h["games"], "seasons": h["seasons"], "above50": h["seasons_above_50"]}
        best["tier"] = tier(pct) if pct >= BREAK_EVEN else "none"
        return best

    # ------------------------------------------------------------- markets
    def _match(self, rows, kind, mask_rows):
        """Patterns of `kind` whose conditions are all true in the given row of the condition frame."""
        hits = []
        for kk, conds, rate, n, per, nper, exp in self.table["table"]:
            if kk != kind:
                continue
            if all(bool(rows.get(cn, False)) for cn in conds):
                hits.append({"pattern": " & ".join(conds), "conds": conds, "rate": rate, "n": n, "periods": per, "nPeriods": nper})
        return hits

    def _spread(self, gm, r, margin, sr):
        hs = gm.get("home_spread")
        if hs is None or sr is None:
            return None
        gid = -(r["i"] + 1)
        a, h = gm["away"], gm["home"]
        best = None
        for side, team in ((1, h), (-1, a)):
            row = sr[(sr.game_id == gid) & (sr.side == side)].iloc[0]
            hits = self._match(row, "spread", None)
            if hits:
                b = max(hits, key=lambda x: (x["rate"], x["n"]))
                if best is None or b["rate"] > best["rate"]:
                    line = float(hs) if side == 1 else -float(hs)
                    best = {**b, "team": team, "line": line, "label": f"{team} {line:+g}", "count": len(hits), "side": "home" if side == 1 else "away"}
        gap = margin + float(hs)          # model home margin minus market's (-home_spread)
        out = {"line": float(hs), "modelGap": round(gap, 1), "modelSide": h if gap > 0 else a}
        if best:
            out["pick"] = self._pattern_pick("spread", best)
        return out

    def _total(self, gm, total, gr, r):
        tl = gm.get("total")
        if tl is None or gr is None:
            return None
        row = gr[gr.game_id == -(r["i"] + 1)].iloc[0]
        hits = self._match(row, "total", None)
        gap = total - float(tl)
        out = {"line": float(tl), "modelGap": round(gap, 1), "modelSide": "over" if gap > 0 else "under"}
        if hits:
            b = max(hits, key=lambda x: (x["rate"], x["n"]))
            out["pick"] = self._pattern_pick("total", {**b, "side": "over", "label": f"Over {tl:g}", "count": len(hits)})
        return out

    def _ml(self, gm, win, mkt, a, h, sr, r):
        # The win chance on the card is the MARKET's own (margin removed): over 22,000 closing moneylines it is calibrated (teams priced 70-75% won
        # 72.4%, 85-90% won 87.3%) and beats our model (Brier 0.2021 vs ~0.209), so it is the honest number. Our model's number stays as the model's.
        use = mkt if mkt is not None else win
        # Sanity (NFL app lesson, 10/5: a corrupt Polymarket read gave a road underdog "95%"): the moneyline must roughly fit the spread line.
        hs_ = gm.get("home_spread"); suspect = None
        if mkt is not None and hs_ is not None:
            fit = sig_norm(-float(hs_) / self.coefs.get("sd_margin", 12.0))
            if abs(mkt - fit) > ML_TOL:
                suspect = f"moneyline {round(mkt * 100)}% for {h} does not fit the spread ({h} {float(hs_):+g} fits {round(fit * 100)}%)"
                use = fit
        side = h if use >= 0.5 else a
        pct = round(max(use, 1 - use) * 100, 1)
        out = {"modelWinPct": {h: round(win * 100, 1), a: round((1 - win) * 100, 1)}, "side": h if win >= 0.5 else a}
        if mkt is not None:
            out["marketWinPct"] = {h: round(mkt * 100, 1), a: round((1 - mkt) * 100, 1)}
        if suspect:
            out["suspect"] = suspect          # no pick from a price that disagrees with the spread; the card says why
        elif pct >= BREAK_EVEN:
            out["pick"] = {"team": side, "label": f"{side} ML", "pct": pct, "tier": tier(pct), "source": "market win chance" if mkt is not None else "model win chance",
                           "modelAgrees": (win >= 0.5) == (use >= 0.5)}
        # moneyline PATTERNS: on games they had never seen they won ~50% (honest_test.py), so a match is shown as information, never as the pick
        best = None
        if sr is not None:
            gid = -(r["i"] + 1)
            for sd, team in ((1, h), (-1, a)):
                rows = sr[(sr.game_id == gid) & (sr.side == sd)]
                if rows.empty:
                    continue
                hits = self._match(rows.iloc[0], "moneyline", None)
                if hits:
                    bb = max(hits, key=lambda x: (x["rate"], x["n"]))
                    if best is None or bb["rate"] > best["rate"]:
                        best = {**bb, "team": team, "label": f"{team} ML", "count": len(hits)}
        if best:
            pp = self._pattern_pick("moneyline", best)
            if pp["tier"] != "none" and pp["pct"] > (out.get("pick") or {}).get("pct", 0):
                out["pick"] = pp
            else:
                out["pattern"] = pp
        return out

    def _lines(self, gm):
        """Every line the page could buy, both teams / both sides (the NFL app's line table, built from NBA history): the main line (0 points) and
        every Polymarket alternate in the team's favour, each with its historical win rate given a main line like this one, its games and price.
        rows: {market, team|side, line, points, hist, n, price}. The site's lib/cardpick.js turns these into PICK / PICK w/ POINTS."""
        out = []
        hs = gm.get("home_spread")
        a, h = gm["away"], gm["home"]
        if hs is not None:
            main = {h: -float(hs), a: float(hs)}            # favoured-by numbers for the main line
            price_main = {h: (gm.get("ml_prices") or {}).get("home"), a: None}
            sp = gm.get("spread_prices") or {}
            for t in (a, h):
                f_main = main[t]
                rate, n = self.spread_rate(f_main, f_main)
                out.append({"market": "spread", "team": t, "line": -f_main, "points": 0.0, "hist": round(rate * 100, 1), "n": n,
                            "price": sp.get("home" if t == h else "away"), "label": f"{t} {-f_main:+g}"})
            for alt in gm.get("alts") or []:
                if not _alt_ok(alt, need_team=True):
                    continue                                   # a half-posted alternate line is skipped, not a reason to lose the game
                t, ln = alt.get("team"), float(alt["line"])
                if t not in main:
                    continue
                f_alt, f_main = -ln, main[t]
                pts = round(f_main - f_alt, 1)
                if pts <= 0:
                    continue
                rate, n = self.spread_rate(f_main, f_alt)
                out.append({"market": "spread", "team": t, "line": ln, "points": pts, "hist": round(rate * 100, 1), "n": n, "price": alt.get("price"), "label": f"{t} {ln:+g}"})
        tl = gm.get("total")
        if tl is not None:
            tp = gm.get("total_prices") or {}
            for over in (True, False):
                rate, n = self.total_rate(float(tl), float(tl), over)
                out.append({"market": "total", "side": "over" if over else "under", "line": float(tl), "points": 0.0, "hist": round(rate * 100, 1), "n": n,
                            "price": tp.get("over" if over else "under"), "label": f"{'Over' if over else 'Under'} {float(tl):g}"})
            for alt in gm.get("total_alts") or []:
                if not _alt_ok(alt):
                    continue
                ln = float(alt["line"])
                if ln == float(tl):
                    continue
                over = ln < float(tl)
                pts = round(abs(float(tl) - ln), 1)
                price = alt.get("over") if over else alt.get("under")
                rate, n = self.total_rate(float(tl), ln, over)
                out.append({"market": "total", "side": "over" if over else "under", "line": ln, "points": pts, "hist": round(rate * 100, 1), "n": n, "price": price,
                            "label": f"{'Over' if over else 'Under'} {ln:g}"})
        return out

    def _teasers(self, gm, r):
        out = []
        hs = gm.get("home_spread")
        a, h = gm["away"], gm["home"]
        if hs is not None:
            main = {h: -float(hs), a: float(hs)}           # favoured-by numbers for the main line
            for alt in gm.get("alts") or []:
                if not _alt_ok(alt, need_team=True):
                    continue
                t, ln = alt["team"], float(alt["line"])
                if t not in main:
                    continue
                f_alt, f_main = -ln, main[t]
                if f_alt >= f_main:        # not in the team's favour
                    continue
                rate, n = self.spread_rate(f_main, f_alt)
                out.append({"market": "spread", "team": t, "line": ln, "mainLine": -f_main, "price": alt.get("price"),
                            "hist": round(rate * 100, 1), "n": n, "label": f"{t} {ln:+g}", "teaser": True})
        tl = gm.get("total")
        if tl is not None:
            for alt in gm.get("total_alts") or []:
                if not _alt_ok(alt):
                    continue
                ln = float(alt["line"])
                if ln == float(tl):
                    continue
                over = ln < float(tl)
                price = alt.get("over") if over else alt.get("under")
                rate, n = self.total_rate(float(tl), ln, over)
                out.append({"market": "total", "side": "over" if over else "under", "line": ln, "mainLine": float(tl), "price": price,
                            "hist": round(rate * 100, 1), "n": n, "label": f"{'Over' if over else 'Under'} {ln:g}", "teaser": True})
        out.sort(key=lambda x: -x["hist"])
        return out


def _alt_ok(alt, need_team=False):
    """An alternate line the site sent is usable only with a number for its line (and a team for a spread)."""
    try:
        return isinstance(alt, dict) and alt.get("line") is not None and float(alt["line"]) == float(alt["line"]) and (not need_team or bool(alt.get("team")))
    except (TypeError, ValueError):
        return False


def _failed_game(gm, ex):
    """The reply for a game the engine could not price: the site shows the market and no model numbers for it."""
    print(f"[slate] {gm.get('away')} @ {gm.get('home')} failed: {ex!r}", flush=True)
    return {"key": f"{gm.get('away')} @ {gm.get('home')}", "away": gm.get("away"), "home": gm.get("home"), "date": gm.get("date"),
            "model": None, "error": str(ex)[:160]}


def season_lines(g, season):
    """This season's regular-season games with a closing line, and how many of those lines are the site's own Polymarket closes."""
    if g is None or not len(g):
        return {"season": int(season), "games": 0, "lined": 0, "polymarket": 0}
    s = g[(g.season == season) & (g.season_type == 2)]
    lined = s.home_line.notna()
    pm = (s["line_src"] == "polymarket") if "line_src" in s else pd.Series(False, index=s.index)
    return {"season": int(season), "games": int(len(s)), "lined": int(lined.sum()), "polymarket": int((lined & pm).sum())}


def _pub(c):
    f = lambda v: None if v is None or (isinstance(v, float) and v != v) else (round(float(v), 3) if isinstance(v, (float, np.floating)) else v)
    return {k: f(v) for k, v in c.items()}


if __name__ == "__main__":
    import sys
    e = Engine().load()
    demo = [{"away": "LAC", "home": "TOR", "date": "2026-10-10", "home_spread": -4.5, "total": 220.5, "ml": {"home": 0.615, "away": 0.385},
             "alts": [{"team": "TOR", "line": -1.5, "price": 0.585}, {"team": "LAC", "line": 7.5, "price": 0.59}],
             "total_alts": [{"line": 216.5, "over": 0.535, "under": 0.465}, {"line": 222.5, "over": 0.415, "under": 0.585}]}]
    print(json.dumps(e.slate(demo), indent=1, default=str)[:3500])
