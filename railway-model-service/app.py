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
  POST /rerun-game-lines   body: {"games": [{"away":"ATL","home":"GB","wind":10,"outdoor":true}, ...]}
  POST /rerun-td-probs     body: {"games": [{"away":"ATL","home":"GB","spread":-2.8,"total":41.2,"outs":["D.Goedert"]}, ...]}
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import fair_line
import td_prob

app = Flask(__name__)
CORS(app)

# ESPN (schedule tab) uses LAR / WSH; nflverse (the models) uses LA / WAS.
ALIASES = {"LAR": "LA", "WSH": "WAS", "JAC": "JAX"}
def nv(team):
    return ALIASES.get(team, team)

@app.route("/td-scorers", methods=["GET"])
def td_scorers():
    """Rushing/receiving TD scorers per game from nflverse play-by-play (defensive/special teams TDs excluded,
    matching Polymarket's anytime-TD rules). Used to grade TD bets on the My Bets tab."""
    try:
        season = int(request.args.get("season", 2026)); week = int(request.args.get("week"))
        p = td_prob.fetch_pbp(season)
        p = p[(p.season_type == "REG") & (p.week == week)]
        out = {}
        for gid, g in p.groupby("game_id"):
            key = f"{nv(g.away_team.iloc[0])} @ {nv(g.home_team.iloc[0])}"
            names = list(g[g.rush_touchdown == 1].rusher_player_name.dropna()) + list(g[g.pass_touchdown == 1].receiver_player_name.dropna())
            out[key] = sorted(set(names))
        return jsonify({"ok": True, "season": season, "week": week, "games": out})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/retrain-td", methods=["POST", "GET"])
def retrain_td():
    """Weekly TD retrain: train a candidate on all completed data (current season included),
    test both the candidate and the currently-active model on the same recent held-out weeks they
    didn't train on, and only switch if the candidate is measurably more accurate. Every attempt is logged."""
    try:
        season = int(request.args.get("season", td_prob.CURRENT))
        season_pg, _, _, _ = td_prob.player_games(season)
        cur_weeks = sorted(season_pg.week.unique().tolist())
        holdout = cur_weeks[-2:] if len(cur_weeks) >= 4 else []           # last 2 completed weeks, held out
        train_weeks_seasons = [2024, 2025] + ([season] if len(cur_weeks) > 2 else [])
        candidate = td_prob.fit_model(train_weeks_seasons)
        cand_brier = td_prob.eval_holdout(candidate, season, holdout) if holdout else None
        active_brier = td_prob.eval_holdout(td_prob.m, season, holdout) if holdout else None
        went_live = False
        if cand_brier is not None and active_brier is not None and cand_brier < active_brier - 1e-4:
            td_prob.m = candidate
            saved = td_prob.save_active({"model": candidate, "trained": train_weeks_seasons, "holdout_weeks": holdout,
                                          "brier": cand_brier, "t": __import__("datetime").datetime.utcnow().isoformat()})
            went_live = True
        else:
            saved = None
        return jsonify({"ok": True, "went_live": went_live, "candidate_brier": cand_brier, "active_brier": active_brier,
                         "holdout_weeks": holdout, "trained_on": train_weeks_seasons, "saved": bool(saved)})
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
                M, cur = fair_line.build(g.get("season", 2026))
            adj = {k: float(v) for k, v in (g.get("adj") or {}).items()}
            ph, pa = fair_line.predict(M, nv(g["away"]), nv(g["home"]), {nv(k): v for k, v in adj.items()})
            margin = ph - pa
            total, wd = fair_line.wind_adj(ph + pa, g.get("wind"), g.get("outdoor", False))
            ph2, pa2 = ph + wd / 2, pa + wd / 2
            p_home = 1 - fair_line.ncdf(-margin / fair_line.SD_MARGIN)
            result = {
                "game": f"{g['away']} @ {g['home']}", "homeScore": round(ph2, 1), "awayScore": round(pa2, 1),
                "homeSpread": round(-margin, 1), "total": round(total, 1),
                "homeWinPct": round(p_home * 100, 1), "awayWinPct": round((1 - p_home) * 100, 1),
            }
            if g.get("spread") is not None:
                pc = 1 - fair_line.ncdf((g["spread"] - margin) / fair_line.SD_MARGIN)
                result["homeCoversMktSpread"] = round(pc * 100, 1)
            if g.get("total") is not None:
                pu = fair_line.ncdf((g["total"] - total) / fair_line.SD_TOTAL)
                result["underMktTotal"] = round(pu * 100, 1)
            out.append(result)
        except Exception as e:
            out.append({"game": f"{g.get('away')} @ {g.get('home')}", "error": str(e)})
    return jsonify({"ok": True, "results": out})

@app.route("/rerun-td-probs", methods=["POST"])
def rerun_td_probs():
    body = request.get_json(force=True)
    games = body.get("games", [])
    out = []
    for g in games:
        try:
            outs = g.get("outs", [])
            away_df = td_prob.run(nv(g["away"]), nv(g["home"]), g["total"] / 2 - g["spread"] / 2, outs, True)
            home_df = td_prob.run(nv(g["home"]), nv(g["away"]), g["total"] / 2 + g["spread"] / 2, outs, True)
            out.append({
                "game": f"{g['away']} @ {g['home']}",
                "away": [{"name": r["name"], "pos": r.pos, "fair": round(r.p * 100, 1), "boosted": bool(r.boosted)} for _, r in away_df.iterrows()],
                "home": [{"name": r["name"], "pos": r.pos, "fair": round(r.p * 100, 1), "boosted": bool(r.boosted)} for _, r in home_df.iterrows()],
                "excluded": outs,
            })
        except Exception as e:
            out.append({"game": f"{g.get('away')} @ {g.get('home')}", "error": str(e)})
    return jsonify({"ok": True, "results": out})

if __name__ == "__main__":
    import os
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
