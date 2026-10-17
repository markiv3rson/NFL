#!/usr/bin/env python3
"""Tune HALF_LIFE and ALPHA on 2010-2016 only. 2017-2026 is never used for tuning."""
import itertools, numpy as np
import nba_data as nd, fair_line as fl
g = nd.games(); tg = nd.team_games()
seasons = [2010, 2012, 2014, 2016]
res = []
for hl, al in itertools.product([120, 150], [2, 5, 10]):
    w = fl.walk_forward(g, tg, seasons, step_days=14, half_life=hl, alpha=al)
    x = g.merge(w, on="game_id"); x = x[(x.season_type == 2) & x.m_margin.notna()]
    res.append((hl, al, (x.margin - x.m_margin).abs().mean(), (x.total - x.m_total).abs().mean()))
    print(res[-1], flush=True)
