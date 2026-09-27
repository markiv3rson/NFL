// Week 3 (2026) model numbers from before the site was automated.
// Used only until the first "Rerun model" stores fresh numbers for a game.
export const SEED = { season: 2026, week: 3,
  // Games played before automatic snapshots existed: last pre-game Polymarket prices on record.
  close: { "2026:3:ATL @ GB": { t: "2026-09-24T19:33:00Z", src: "record",
    poly: { ml: { away: 0.31, home: 0.70 }, spread: { homeSpread: -5.5, home: 0.48, away: 0.52 }, total: { line: 42.5, over: 0.52, under: 0.49 } }, books: null } },
  games: {
 "ATL @ GB": {
  "homeMargin": 2.8,
  "total": 41.2,
  "homeWinPct": 58.4,
  "source": "seed"
 },
 "CAR @ CLE": {
  "homeMargin": -2.7,
  "total": 43.8,
  "homeWinPct": 41.8,
  "source": "seed"
 },
 "CIN @ PIT": {
  "homeMargin": -0.2,
  "total": 42,
  "homeWinPct": 49.4,
  "source": "seed"
 },
 "HOU @ IND": {
  "homeMargin": -1.9,
  "total": 45.8,
  "homeWinPct": 44.2,
  "source": "seed"
 },
 "TEN @ NYG": {
  "homeMargin": 1.4,
  "total": 48.2,
  "homeWinPct": 54.2,
  "source": "seed"
 },
 "ARI @ SF": {
  "homeMargin": 4.8,
  "total": 49.4,
  "homeWinPct": 64.4,
  "source": "seed"
 },
 "MIN @ TB": {
  "homeMargin": -2.2,
  "total": 39.5,
  "homeWinPct": 43.3,
  "source": "seed"
 },
 "BAL @ DAL": {
  "homeMargin": -4.2,
  "total": 54.6,
  "homeWinPct": 37.4,
  "source": "seed"
 },
 "LV @ NO": {
  "homeMargin": 2.4,
  "total": 38.6,
  "homeWinPct": 57.4,
  "source": "seed"
 },
 "LA @ DEN": {
  "homeMargin": -3.2,
  "total": 44,
  "homeWinPct": 40.2,
  "source": "seed"
 },
 "PHI @ CHI": {
  "homeMargin": 1,
  "total": 48.4,
  "homeWinPct": 53,
  "source": "seed"
 },
 "NE @ JAX": {
  "homeMargin": -0.3,
  "total": 46.7,
  "homeWinPct": 49,
  "source": "seed"
 },
 "SEA @ WAS": {
  "homeMargin": -8.3,
  "total": 46.6,
  "homeWinPct": 26,
  "source": "seed"
 },
 "KC @ MIA": {
  "homeMargin": -7,
  "total": 47.9,
  "homeWinPct": 29.6,
  "source": "seed"
 },
 "LAC @ BUF": {
  "homeMargin": 5.5,
  "total": 48.7,
  "homeWinPct": 66.5,
  "source": "seed"
 },
 "NYJ @ DET": {
  "homeMargin": 3.7,
  "total": 47.4,
  "homeWinPct": 61.1,
  "source": "seed"
 }
},
  td: {"ATL @ GB":{"away":[{"name":"Bi.Robinson","pos":"RB","fair":46.6,"price":57},{"name":"D.London","pos":"WR","fair":25.7,"price":32},{"name":"K.Pitts","pos":"TE","fair":null,"price":19}],"home":[{"name":"C.Watson","pos":"WR","fair":37.1,"price":38},{"name":"M.Lloyd","pos":"RB","fair":30.1,"price":30},{"name":"T.Kraft","pos":"TE","fair":25.5,"price":31},{"name":"M.Golden","pos":"WR","fair":null,"price":31},{"name":"K.Johnson","pos":"RB","fair":null,"price":32}]},"CIN @ PIT":{"away":[{"name":"C.Brown","pos":"WR","fair":47,"price":50},{"name":"J.Chase","pos":"WR","fair":38,"price":42},{"name":"T.Higgins","pos":"WR","fair":null,"price":34},{"name":"M.Gesicki","pos":"TE","fair":null,"price":18}],"home":[{"name":"J.Warren","pos":"RB","fair":35,"price":44},{"name":"R.Dowdle","pos":"RB","fair":31,"price":32},{"name":"D.Metcalf","pos":"WR","fair":null,"price":30},{"name":"P.Freiermuth","pos":"TE","fair":null,"price":21}]},"KC @ MIA":{"away":[{"name":"K.Walker","pos":"RB","fair":54,"price":67},{"name":"T.Kelce","pos":"TE","fair":37,"price":39},{"name":"R.Rice","pos":"RB","fair":44,"price":38},{"name":"X.Worthy","pos":"WR","fair":null,"price":34}],"home":[{"name":"D.Achane","pos":"RB","fair":42,"price":43},{"name":"M.Washington","pos":"WR","fair":null,"price":24}]},"LAC @ BUF":{"away":[{"name":"O.Hampton","pos":"RB","fair":47,"price":51},{"name":"L.McConkey","pos":"WR","fair":34,"note":"cracked rib, playing in a flak jacket — known, ongoing, not a new absence risk","price":31},{"name":"Q.Johnston","pos":"WR","fair":32,"price":29}],"home":[{"name":"J.Cook","pos":"RB","fair":46,"price":63},{"name":"K.Shakir","pos":"WR","fair":null,"price":33},{"name":"D.Kincaid","pos":"TE","fair":null,"price":31}]},"SEA @ WAS":{"away":[{"name":"J.Smith-Njigba","pos":"WR","fair":50,"price":49},{"name":"J.Price","pos":"RB","fair":17,"price":38},{"name":"R.Shaheed","pos":"WR","fair":null,"price":23},{"name":"C.Kupp","pos":"WR","fair":null,"price":20}],"home":[{"name":"J.Croskey-Merritt","pos":"RB","fair":29,"price":28},{"name":"T.McLaurin","pos":"WR","fair":24,"price":21},{"name":"S.Diggs","pos":"WR","fair":null,"price":21}]},"NE @ JAX":{"away":[{"name":"R.Stevenson","pos":"RB","fair":33,"price":38},{"name":"H.Henry","pos":"TE","fair":21.1,"price":26},{"name":"R.Doubs","pos":"WR","fair":19.2,"price":24},{"name":"D.Douglas","pos":"WR","fair":null,"price":19},{"name":"T.Henderson","pos":"RB","fair":34.9,"note":"just back from ankle injury, real 50/50 split expected with R.Stevenson — don't treat this fair% as a clean lead-back number","price":null}],"home":[{"name":"P.Washington","pos":"WR","fair":30.3,"price":35},{"name":"B.Tuten","pos":"RB","fair":26.1,"price":38},{"name":"C.Rodriguez","pos":"RB","fair":22.7,"price":27},{"name":"J.Meyers","pos":"WR","fair":20.3,"price":24},{"name":"B.Strange","pos":"TE","fair":19.2,"price":24}]},"NYJ @ DET":{"away":[{"name":"B.Hall","pos":"RB","fair":37.7,"price":46},{"name":"G.Wilson","pos":"WR","fair":33.7,"price":32}],"home":[{"name":"J.Gibbs","pos":"RB","fair":68.4,"price":70},{"name":"A.St.Brown","pos":"WR","fair":58.2,"price":52},{"name":"S.LaPorta","pos":"TE","fair":28.9,"price":34}]},"ARI @ SF":{"away":[{"name":"T.McBride","pos":"TE","fair":45.7,"price":32},{"name":"J.Love","pos":"RB","fair":38.1,"price":35}],"home":[{"name":"C.McCaffrey","pos":"RB","fair":66.4,"price":69},{"name":"M.Evans","pos":"WR","fair":34.8,"note":"was DNP Friday — verify before betting","price":40},{"name":"D.Samuel","pos":"WR","fair":33.9,"price":35},{"name":"G.Kittle","pos":"TE","fair":32.5,"price":34}]},"BAL @ DAL":{"away":[{"name":"D.Henry","pos":"RB","fair":60.3,"price":65},{"name":"Z.Flowers","pos":"WR","fair":36.6,"price":null},{"name":"M.Andrews","pos":"TE","fair":28.4,"price":42}],"home":[{"name":"J.Williams","pos":"RB","fair":51.3,"price":56},{"name":"C.Lamb","pos":"WR","fair":42.6,"price":43},{"name":"G.Pickens","pos":"WR","fair":33.2,"price":37},{"name":"J.Ferguson","pos":"TE","fair":31.2,"price":25}]},"HOU @ IND":{"away":[{"name":"N.Collins","pos":"WR","fair":40.5,"note":"still no price seen — verify he's active before betting, was Questionable","price":null},{"name":"D.Montgomery","pos":"RB","fair":38.6,"price":47},{"name":"D.Schultz","pos":"TE","fair":31.2,"price":30},{"name":"W.Marks","pos":"RB","fair":29.1,"price":26}],"home":[{"name":"J.Taylor","pos":"RB","fair":63.3,"price":58},{"name":"T.Warren","pos":"TE","fair":29.5,"price":27},{"name":"K.Allen","pos":"WR","fair":23,"price":19},{"name":"J.Downs","pos":"WR","fair":21.5,"price":24}]},"LA @ DEN":{"away":[{"name":"K.Williams","pos":"RB","fair":44.4,"price":53},{"name":"P.Nacua","pos":"WR","fair":42,"note":"Officially DOUBTFUL per team's Friday report (DNP Wed/Thu/Fri) — real risk of sitting, don't bet blind on his fair%","price":null},{"name":"D.Adams","pos":"WR","fair":41.7,"price":46},{"name":"J.Waddle","pos":"WR","fair":20.8,"price":30}],"home":[{"name":"J.Coleman","pos":"RB","fair":43.2,"price":22},{"name":"R.Harvey","pos":"RB","fair":29.8,"price":25},{"name":"J.Dobbins","pos":"RB","fair":24.3,"price":38},{"name":"C.Sutton","pos":"WR","fair":21.7,"price":25}]},"LV @ NO":{"away":[{"name":"A.Jeanty","pos":"RB","fair":49.6,"price":49}],"home":[{"name":"C.Olave","pos":"WR","fair":39.8,"price":37},{"name":"T.Etienne","pos":"RB","fair":38.4,"price":38},{"name":"A.Kamara","pos":"RB","fair":28.7,"price":34},{"name":"J.Johnson","pos":"TE","fair":23,"price":23}]},"TEN @ NYG":{"away":[{"name":"W.Robinson","pos":"WR","fair":24.4,"price":18},{"name":"T.Pollard","pos":"RB","fair":23.3,"price":39},{"name":"E.Ayomanor","pos":"WR","fair":21,"price":12}],"home":[{"name":"C.Skattebo","pos":"RB","fair":45.6,"price":46},{"name":"M.Nabers","pos":"WR","fair":33.8,"price":29},{"name":"I.Likely","pos":"TE","fair":28.3,"price":23},{"name":"T.Tracy","pos":"RB","fair":27.2,"price":20},{"name":"D.Singletary","pos":"RB","fair":24.2,"price":13}]},"PHI @ CHI":{"away":[{"name":"S.Barkley","pos":"RB","fair":34.9,"price":50},{"name":"D.Smith","pos":"WR","fair":31.5,"price":33},{"name":"D.Goedert","pos":"TE","fair":null,"note":"priced despite Friday DNP — same pattern as Evans/Nacua, verify before betting","price":32}],"home":[{"name":"D.Swift","pos":"RB","fair":49.6,"price":51},{"name":"K.Monangai","pos":"RB","fair":30.4,"price":33},{"name":"R.Odunze","pos":"WR","fair":25.8,"price":17}]},"CAR @ CLE":{"away":[{"name":"C.Hubbard","pos":"RB","fair":36.8,"price":52},{"name":"T.McMillan","pos":"WR","fair":32.1,"price":33},{"name":"J.Coker","pos":"WR","fair":29.9,"price":25},{"name":"D.Waller","pos":"TE","fair":24.8,"price":21}],"home":[{"name":"Q.Judkins","pos":"RB","fair":31.8,"price":45},{"name":"D.Boston","pos":"WR","fair":30.5,"price":28},{"name":"H.Fannin","pos":"TE","fair":22.7,"price":26}]},"MIN @ TB":{"away":[{"name":"J.Jefferson","pos":"WR","fair":32.2,"price":38},{"name":"A.Jones","pos":"RB","fair":30,"price":50},{"name":"J.Mason","pos":"RB","fair":28,"price":null}],"home":[{"name":"B.Irving","pos":"RB","fair":37.7,"price":41},{"name":"K.Gainwell","pos":"RB","fair":24.1,"price":22},{"name":"E.Egbuka","pos":"WR","fair":23.7,"price":28}]}} };
// Hand-written game notes (known model blind spots). Kept across reruns for that week.
export const FLAGS = { "2026:3": {
 "TEN @ NYG": {
  "total": {
   "tier": "strong-lt",
   "short": "Giants QB change",
   "note": "huge number, low trust — market total is way below model's fair ~48, almost certainly pricing in Dart's injury/Jameis starting"
  }
 },
 "ARI @ SF": {
  "spread": {
   "tier": "strong-lt",
   "short": "market sees something the model doesn't",
   "note": "strong number, low trust — market is far more lopsided than the model, something real may be missing"
  }
 },
 "PHI @ CHI": {
  "spread": {
   "tier": "conflict",
   "short": "QB unknown",
   "note": "conflicts hard with the real market (PHI 68%) — no confident lean here, it's a QB-situation gap not a betting signal"
  },
  "total": {
   "tier": "strong-lt",
   "short": "QB unknown",
   "note": "same QB-situation gap, not a real edge"
  }
 },
 "SEA @ WAS": {
  "total": {
   "tier": "strong-lt",
   "short": "QB situation changed",
   "note": "strong number, but was priced with backup QBs assumed — Darnold's return changes the picture, recheck"
  }
 },
 "KC @ MIA": {
  "spread": {
   "tier": "strong-lt",
   "short": "Hill/Waddle gone",
   "note": "strong number, low trust — model blind to Hill/Waddle gone"
  }
 }
} };
