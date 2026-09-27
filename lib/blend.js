// Game-line blend (logged only, never shown on Game Lines/Totals): a weighted mix of the model and
// the market, weighted by each one's actual backtest accuracy (BACKTEST-RESULTS.pdf, 5 seasons pooled).
// Weights are fixed from that backtest, not re-fit here, so the blend can't overfit to recent weeks.
const MAE = { marginModel: 10.41, marginMarket: 9.72, totalModel: 10.71, totalMarket: 10.25 };
const wFrom = (maeModel, maeMarket) => 1 / maeModel / (1 / maeModel + 1 / maeMarket);
export const W_MARGIN = wFrom(MAE.marginModel, MAE.marginMarket); // ~0.483
export const W_TOTAL = wFrom(MAE.totalModel, MAE.totalMarket);    // ~0.489

// bookHomeMargin/bookTotal = the sportsbook no-vig line (never Polymarket's own price, per 2.11).
export function blendGame(modelMargin, bookHomeMargin, modelTotal, bookTotal) {
  const margin = modelMargin != null && bookHomeMargin != null ? W_MARGIN * modelMargin + (1 - W_MARGIN) * bookHomeMargin : null;
  const total = modelTotal != null && bookTotal != null ? W_TOTAL * modelTotal + (1 - W_TOTAL) * bookTotal : null;
  return { margin, total };
}
