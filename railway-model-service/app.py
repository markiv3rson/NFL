#!/usr/bin/env python3
"""
app.py — the model-rerun service. Deployed on Railway (a real, always-on
server, not a serverless function) because fair_line.py / td_prob.py do
real work: download nflverse play-by-play data and train real models.

Thin Flask wrapper around the exact same fair_line.py / td_prob.py already
in this project — exposes them over HTTP so the site's "Rerun model" and
"Preview model" buttons have something to call.

Endpoints:
  GET  /health
  POST /rerun-game-lines   body: {"games": [{"away":"ATL","home":"GB","wind":10,"outdoor":true,"inj":{"away":[{"name":"..","status":"Out"}],"home":[...]},"spread":5.5,"total":42.5,"neutral":false,"dome":false}, ...]}
                           (inj is optional; when present the numbers include the injury adjustment, and "raw" holds the plain model)
  POST /rerun-td-probs     body: {"games": [{"away":"ATL","home":"GB","spread":-2.8,"total":41.2,"outs":["D.Goedert"]}, ...]}
"""
import os, hmac
from flask import Flask, request, jsonify
import fair_line
import td_prob
import injury_adj
import season as _season

app = Flask(__name__)

# Shared secret: when MODEL_SERVICE_TOKEN is set (Railway AND Vercel), every endpoint except /health needs the
# X-Model-Token header. Without it, anyone who found the Railway URL could trigger retrains and heavy reruns.
# (CORS removed: only the site's server calls this service, never a browser.)
TOKEN = os.environ.get("MODEL_SERVICE_TOKEN", "").strip()
@app.before_request
def _auth():
    if request.path == "/health" or not TOKEN: return None
    if not hmac.compare_digest(request.headers.get("X-Model-Token", "").strip(), TOKEN):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

# ESPN (schedule tab) uses LAR / WSH; nflverse (the models) uses LA / WAS.
ALIASES = {"LAR": "LA", "WSH": "WAS", "JAC": "JAX"}
def nv(team):
    return ALIASES.get(team, team)

@app.route("/td-scorers", methods=["GET"])
def td_scorers():
    """Anytime-TD scorers per game from nflverse play-by-play: rushing, receiving and special-teams return TDs by the
    player who scored; defensive TDs excluded (Polymarket anytime rules). Used to grade TD bets and the TD model."""
    try:
        season = int(request.args.get("season") or _season.data_season()); week = int(request.args.get("week"))
        p = td_prob.fetch_pbp(season)
        p = p[p.season_type.isin(["REG", "POST"]) & (p.week == week)]   # playoff weeks (19-22) grade too (9/30)
        out, counts, first, teams = {}, {}, {}, {}
        for gid, g in p.groupby("game_id"):
            key = f"{nv(g.away_team.iloc[0])} @ {nv(g.home_team.iloc[0])}"
            # The player who actually crossed the goal line (td_player_name), not the play's rusher/receiver: on a
            # lateral (e.g. 2026 wk3 Evans catch, lateral to Deebo Samuel for 80 yds) the old way credited the wrong man.
            # Polymarket anytime rules: rushing, receiving AND special-teams return TDs count; defensive TDs don't.
            t = g[(g.touchdown == 1) & g.td_player_name.notna()]
            defensive = (t.td_team != t.posteam) & t.play_type.isin(["pass", "run", "qb_kneel", "qb_spike", "no_play"])
            off = t[~defensive].sort_values("play_id")
            out[key] = sorted(set(off.td_player_name))
            # For grading the 2+ TD and first-TD numbers the site shows: TDs per player, and the game's first TD scorer
            # (null when the first TD was defensive, which no listed player can win).
            counts[key] = {k: int(v) for k, v in off.td_player_name.value_counts().items()}
            teams[key] = {k: sorted(set(nv(t) for t in v)) for k, v in off.groupby("td_player_name").td_team}   # scorer -> team(s), so two "J.Smith"s on opposite teams can't both get credit
            first_all = t.sort_values("play_id").head(1)
            first[key] = off.td_player_name.iloc[0] if len(first_all) and not bool(defensive.loc[first_all.index].iloc[0]) else None
        return jsonify({"ok": True, "season": season, "week": week, "games": out, "counts": counts, "first": first, "teams": teams})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/retrain-td", methods=["POST"])
def retrain_td():
    """Weekly TD retrain (same logic the scheduler runs, see td_prob.retrain): only switches if the candidate is
    measurably more accurate on held-out weeks. POST only: it can replace the live model."""
    try:
        return jsonify({"ok": True, **td_prob.retrain(int(request.args.get("season") or _season.data_season()))})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "service": "nfl-bettors-model"})

@app.route("/rerun-game-lines", methods=["POST"])
def rerun_game_lines():
    body = request.get_json(force=True)
    games = body.get("games", [])
    out = []
    # Fixed: fair_line.build() downloads real season data and fits a ridge
    # regression — was being called once PER GAME (15x redundant work,
    # the likely cause of Railway timeouts/crashes). Build once, reuse.
    M = None
    for g in games:
        try:
            if M is None:
                M, cur = fair_line.build(g.get("season") or _season.data_season())
            adj = {k: float(v) for k, v in (g.get("adj") or {}).items()}
            neutral = bool(g.get("neutral"))
            rest_away = g.get("restAwayDays")
            ph, pa = fair_line.predict(M, nv(g["away"]), nv(g["home"]), {nv(k): v for k, v in adj.items()}, neutral=neutral,
                                        rest_away_days=(float(rest_away) if rest_away is not None else None),
                                        home_qb_first_start=bool(g.get("homeQbFirstStart")), away_qb_first_start=bool(g.get("awayQbFirstStart")),
                                        week=g.get("week"))
            margin = ph - pa
            total, wd = fair_line.wind_adj(ph + pa, g.get("wind"), g.get("outdoor", False))
            # Totals: dome/closed roof and pace adjustments (tested 2006-2025). dome=None (unknown venue) skips the dome part.
            ex, dome_pts, pace_pts = fair_line.extra_total(M, nv(g["away"]), nv(g["home"]), g.get("dome"), g.get("turf"))
            total += ex
            raw_margin, raw_total = margin, total
            # Automatic injury adjustment (Estimate). Needs the official injury lists the site already loads.
            # If it can't run, the game simply keeps the plain model numbers.
            inj_info, inj_err = None, None
            if g.get("inj") is not None:
                try:
                    inj_info = injury_adj.adjust_game(nv(g["away"]), nv(g["home"]), (g["inj"] or {}).get("away"), (g["inj"] or {}).get("home"))
                    margin += inj_info["margin"]; total += inj_info["total"]
                except Exception as e:
                    inj_err = str(e)
            ph2, pa2 = (total + margin) / 2, (total - margin) / 2
            mkt_m = g.get("spread"); mkt_t = g.get("total")          # market home-favored margin and total, when the site has them
            mkt_m = float(mkt_m) if mkt_m is not None else None; mkt_t = float(mkt_t) if mkt_t is not None else None
            # Win chance is CALIBRATED (market spread as input when available); tested out-of-sample it is far more accurate than the
            # plain model's own percentage (Brier 0.208 vs 0.221).
            p_home = fair_line.cal_win(margin, mkt_m)
            result = {
                "game": f"{g['away']} @ {g['home']}", "homeScore": round(ph2, 1), "awayScore": round(pa2, 1),
                "homeSpread": round(-margin, 1), "total": round(total, 1),
                "homeWinPct": round(p_home * 100, 1), "awayWinPct": round((1 - p_home) * 100, 1),
                "raw": {"homeSpread": round(-raw_margin, 1), "total": round(raw_total, 1),
                        "homeWinPct": round(fair_line.cal_win(raw_margin, mkt_m) * 100, 1)},
                "fix": {"hfa": 0.0 if neutral else fair_line.HFA_FIX, "neutral": neutral, "dome": round(dome_pts, 2), "pace": round(pace_pts, 2),
                        "div": fair_line.is_division_game(nv(g["away"]), nv(g["home"])), "turf": bool(g.get("turf")),
                        "awayBye": bool(rest_away is not None and float(rest_away) >= 13),
                        "awayElim": fair_line.away_eliminated(M, nv(g["away"]), g.get("week")),
                        "homeQbFirstStart": bool(g.get("homeQbFirstStart")), "awayQbFirstStart": bool(g.get("awayQbFirstStart"))},
            }
            if inj_info and (inj_info["margin"] or inj_info["total"] or inj_info["home"]["players"] or inj_info["away"]["players"]):
                result["inj"] = inj_info
            if inj_err: result["injError"] = inj_err
            if mkt_m is not None:
                result["calHomeCover"] = round(fair_line.cal_cover(margin, mkt_m) * 100, 1)   # calibrated: stays ~50% (model gap has no measured signal)
            if mkt_t is not None:
                result["calUnder"] = round(fair_line.cal_under(total, mkt_t) * 100, 1)
            try: result["teamPts"] = fair_line.team_points(ph2, pa2, mkt_m, mkt_t)
            except Exception as e: result["teamPtsError"] = str(e)
            out.append(result)
        except Exception as e:
            out.append({"game": f"{g.get('away')} @ {g.get('home')}", "error": str(e)})
    return jsonify({"ok": True, "results": out})

@app.route("/rerun-td-probs", methods=["POST"])
def rerun_td_probs():
    body = request.get_json(force=True)
    games = body.get("games", [])
    out = []
    try: td_prob.refresh_live()          # fresh play-by-play / snaps / rosters / depth (was: loaded once per server start)
    except Exception as e: print(f"[td] refresh failed, using previous data: {e}", flush=True)
    for g in games:
        try:
            outs = g.get("outs", [])
            # posadj off (9/30 test: neutral) -- the old call passed True here, so the "default off" change never took effect
            active = bool(g.get("active"))   # inactive list is out (inside 80 min of kickoff): everyone listed is playing
            returning = g.get("returning", [])   # Out/Doubtful last week, not this week: treated as playing (the page labels them)
            away_df = td_prob.run(nv(g["away"]), nv(g["home"]), g["total"] / 2 - g["spread"] / 2, outs, active=active, returning=returning)
            home_df = td_prob.run(nv(g["home"]), nv(g["away"]), g["total"] / 2 + g["spread"] / 2, outs, active=active, returning=returning)
            # Extra markets from the same calibrated chances: 2+ TDs, first TD of the game, and any RB/WR/TE per team.
            top_a, top_h = away_df.head(14), home_df.head(14)
            f_a, f_h = td_prob.first_td([top_a.p.values, top_h.p.values])
            fa = dict(zip(top_a.index, f_a)); fh = dict(zip(top_h.index, f_h))
            def rows(df, first):
                two = td_prob.two_plus(df.p.values)
                return [{"name": r["name"], "pos": r.pos, "fair": round(r.p * 100, 1), "boosted": bool(r.boosted), "depthNote": r.get("depth_note") if isinstance(r.get("depth_note"), str) else None,
                         "two": round(float(two[i]) * 100, 1), "first": round(float(first[idx]) * 100, 1) if idx in first else None}
                        for i, (idx, r) in enumerate(df.iterrows())]
            out.append({
                "game": f"{g['away']} @ {g['home']}",
                "away": rows(away_df, fa), "home": rows(home_df, fh),
                "awayGroups": {k: round(v * 100, 1) for k, v in td_prob.group_any(away_df).items()},
                "homeGroups": {k: round(v * 100, 1) for k, v in td_prob.group_any(home_df).items()},
                "excluded": outs,
            })
        except Exception as e:
            out.append({"game": f"{g.get('away')} @ {g.get('home')}", "error": str(e)})
    return jsonify({"ok": True, "results": out})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
