// Mark's logged bets (entered from his Polymarket screenshots).
const td = (game, player, team, price) => ({ game, kind: "td", player, team, price });
const sp = (game, team, line, price) => ({ game, kind: "spread", team, line, price });
const tot = (game, side, line, price) => ({ game, kind: "total", side, line, price });

// Mark's Week 3 combos, entered from his Polymarket screenshots (9/26). "toWin" = total payout.
// Every preloaded bet is from the 2026 season (9/30: after the season rolls over they must not be graded as 2027 bets).
export const SEED_SEASON = 2026;
export const SEED_BETS = [
  { id: "w3-c1", week: 3, cost: 9.11, toWin: 162.09, legs: [td("LV @ NO", "Travis Etienne Jr.", "NO", .37), td("LA @ DEN", "Kyren Williams", "LA", .53), td("LA @ DEN", "RJ Harvey", "DEN", .25)] },
  { id: "w3-c2", week: 3, cost: 9.13, toWin: 131.97, legs: [tot("ARI @ SF", "under", 48.5, .52), tot("MIN @ TB", "under", 43.5, .545), tot("BAL @ DAL", "over", 53.5, .49), tot("LV @ NO", "under", 43.5, .49)] },
  { id: "w3-c3", week: 3, cost: 10.00, toWin: 189.58, legs: [sp("LV @ NO", "LV", 3.5, .53), td("LV @ NO", "Ashton Jeanty", "LV", .49), td("LV @ NO", "Chris Olave", "NO", .38), tot("LV @ NO", "under", 43.5, .49)] },
  { id: "w3-c4", week: 3, cost: 10.00, toWin: 121.86, legs: [sp("CAR @ CLE", "CAR", -1.5, .52), sp("LAC @ BUF", "LAC", 7.5, .525), sp("NE @ JAX", "JAX", -2.5, .54), sp("NYJ @ DET", "DET", -6.5, .51)] },
  { id: "w3-c5", week: 3, cost: 10.00, toWin: 132.89, legs: [tot("CAR @ CLE", "under", 43.5, .545), tot("LAC @ BUF", "under", 49.5, .485), tot("NE @ JAX", "under", 46.5, .515), tot("NYJ @ DET", "under", 48.5, .505)] },
  { id: "w3-c6", week: 3, cost: 15.00, toWin: 255.80, legs: [td("CAR @ CLE", "Quinshon Judkins", "CLE", .45), td("CAR @ CLE", "Tetairoa McMillan", "CAR", .33), td("HOU @ IND", "David Montgomery", "HOU", .46), td("NYJ @ DET", "Jahmyr Gibbs", "DET", .72)] },
  { id: "w3-c7", week: 3, cost: 20.00, toWin: 683.77, legs: [td("ARI @ SF", "Trey McBride", "ARI", .32), td("MIN @ TB", "Bucky Irving", "TB", .40), td("MIN @ TB", "Justin Jefferson", "MIN", .38), td("BAL @ DAL", "CeeDee Lamb", "DAL", .43)] },
  { id: "w3-c8", week: 3, cost: 25.00, toWin: 236.35, legs: [td("HOU @ IND", "Jonathan Taylor", "IND", .56), td("NYJ @ DET", "Amon-Ra St. Brown", "DET", .51), td("SEA @ WAS", "Jaxon Smith-Njigba", "SEA", .48), td("ARI @ SF", "Christian McCaffrey", "SF", .67)] },
  // Week 4 TNF combo (10/2), from his Polymarket screenshot: cost, payout and legs are exact; the three leg prices are
  // ESTIMATED (only their product, 20/130.32, is known) so they affect expected/CLV, never P/L.
  { id: "w4-c1", week: 4, cost: 20.00, toWin: 130.32, legs: [sp("PIT @ CLE", "CLE", 2.5, .52), td("PIT @ CLE", "Quinshon Judkins", "CLE", .59), tot("PIT @ CLE", "over", 37.5, .50)] },
];

