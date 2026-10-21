// STACK shadow model (10/21): logistic regression (C 0.02) on every model's output + the rules + the moves + schedule facts, home-cover side,
// fit on 2020-25 by scratchpad/stack/stack_fit.py (walk-forward numbers in CLAUDE.md). Inputs are standardized after the player sums have the line taken out (resid).
export const STACK_MODEL = {
 "cols": [
  "gm_edge",
  "gm_tedge",
  "tm_n",
  "td_d",
  "td_s",
  "tdtop_h",
  "tdtop_a",
  "py_d",
  "py_s",
  "rec_yds_h",
  "rec_yds_a",
  "r_bounce",
  "r_floordog",
  "r_beatthe",
  "mv_sp",
  "mv_to",
  "rest_d",
  "dome",
  "div_game"
 ],
 "coef": [
  -0.108017,
  0.09447,
  0.066232,
  0.094655,
  0.067692,
  -0.020088,
  -0.095557,
  -0.109651,
  -0.048399,
  -0.016731,
  -0.035249,
  0.079101,
  0.100466,
  0.019052,
  -0.076146,
  0.099823,
  -0.020489,
  0.001492,
  -0.075623
 ],
 "intercept": 0.026758,
 "mu": {
  "gm_edge": -1.84619,
  "gm_tedge": 0.601965,
  "tm_n": -0.024574,
  "td_d": -0.0,
  "td_s": -0.0,
  "tdtop_h": -0.0,
  "tdtop_a": -0.0,
  "py_d": 0.0,
  "py_s": -0.0,
  "rec_yds_h": -0.0,
  "rec_yds_a": -0.0,
  "r_bounce": -0.03707,
  "r_floordog": -0.000883,
  "r_beatthe": -0.046778,
  "mv_sp": 0.071933,
  "mv_to": -0.095322,
  "rest_d": -0.037952,
  "dome": 0.328332,
  "div_game": 0.349515
 },
 "sd": {
  "gm_edge": 2.961484,
  "gm_tedge": 3.063549,
  "tm_n": 0.051954,
  "td_d": 0.414522,
  "td_s": 0.50575,
  "tdtop_h": 0.093084,
  "tdtop_a": 0.091067,
  "py_d": 81.539177,
  "py_s": 84.100919,
  "rec_yds_h": 37.02976,
  "rec_yds_a": 35.667832,
  "r_bounce": 0.189016,
  "r_floordog": 0.194898,
  "r_beatthe": 0.613828,
  "mv_sp": 2.075941,
  "mv_to": 2.542259,
  "rest_d": 2.660629,
  "dome": 0.469814,
  "div_game": 0.477027
 },
 "resid": {
  "td_d": {
   "a": -0.025455,
   "b": 0.084371,
   "against": "spread"
  },
  "py_d": {
   "a": -5.413845,
   "b": 7.697183,
   "against": "spread"
  },
  "td_s": {
   "a": 0.837891,
   "b": 0.060503,
   "against": "total_line"
  },
  "py_s": {
   "a": 223.724929,
   "b": 10.133519,
   "against": "total_line"
  },
  "tdtop_h": {
   "a": 0.432044,
   "b": 0.007993,
   "against": "spread"
  },
  "tdtop_a": {
   "a": 0.437576,
   "b": -0.007542,
   "against": "spread"
  },
  "rec_yds_h": {
   "a": 41.021058,
   "b": 3.900358,
   "against": "total_line"
  },
  "rec_yds_a": {
   "a": 44.587281,
   "b": 3.748531,
   "against": "total_line"
  }
 },
 "cut": 0.0935,
 "bands": {
  "all": {
   "n": 761,
   "hit": 53.5
  },
  "under": {
   "n": 608,
   "hit": 52.8
  },
  "confident": {
   "n": 153,
   "hit": 56.2
  }
 },
 "train": {
  "seasons": "2020-2025",
  "n": 1133
 },
 "builtAt": "2026-10-21"
};
