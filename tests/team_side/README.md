Team-only NFL spread model (owner 10/19, option B: "go off the win success rate of the entire team", not prices). Research only, not in the app.
Run in order with a work folder that holds ff/games.csv (nflverse schedule): python3 feat.py DIR  (play-by-play from ~/.nfl_cache/pbp_<year>.parquet),
python3 model.py DIR, python3 deep.py DIR, python3 live.py DIR. Every season is predicted by a model trained only on earlier seasons; graded against the closing spread.
Results 10/19 are in CLAUDE.md (TEAM-ONLY SPREAD MODEL).
