// Real Polymarket combo price for one NBA parlay (10/17, owner: "I need this for the nba also"): the NFL route's handler on NBA markets
// (pages/api/comboquote.js, lib/comboquote.js). Asks for a quote and closes it: never accepts, nothing is bought.
import { quoteHandler } from "../comboquote";
export const config = { maxDuration: 30 };
export default quoteHandler("nba");
