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
            ph, pa = fair_line.predict(M, g["away"], g["home"], adj)
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
            away_df = td_prob.run(g["away"], g["home"], g["total"] / 2 - g["spread"] / 2, outs, True)
            home_df = td_prob.run(g["home"], g["away"], g["total"] / 2 + g["spread"] / 2, outs, True)
            out.append({
                "game": f"{g['away']} @ {g['home']}",
                "away": [{"name": r["name"], "pos": r.pos, "fair": round(r.p * 100, 1)} for _, r in away_df.iterrows()],
                "home": [{"name": r["name"], "pos": r.pos, "fair": round(r.p * 100, 1)} for _, r in home_df.iterrows()],
                "excluded": outs,
            })
        except Exception as e:
            out.append({"game": f"{g.get('away')} @ {g.get('home')}", "error": str(e)})
    return jsonify({"ok": True, "results": out})

if __name__ == "__main__":
    import os
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
