// Everything the page shows, computed server-side from: model numbers, Polymarket lines,
// sportsbook consensus (reference/prior only), injuries. Betting venue = Polymarket only.
import { ncdf, ninv, toAmerican, kellyStake, SD_MARGIN, SD_TOTAL, isThinMarket, shiftCover } from "./odds";

export const tierFor = (pct) => (pct < 52.4 ? "none" : pct < 55 ? "weak" : pct < 60 ? "moderate" : "strong");
export const sgn = (n) => (n > 0 ? "+" : "") + n;

// Model pick at a market line. Uses the CALIBRATED cover/under chance (m.calHomeCover / m.calUnder), computed
// server-side by fair_line.py's cal_cover/cal_under against this same market line. Tested out-of-sample: the
// model-vs-market gap carries no measurable signal for covers or unders, so this sits at ~50% almost always —
// that's correct, not a bug. (Moneyline is different: m.homeWinPct is calibrated with the market spread as a real
// input and does move meaningfully game to game — see gameBets() below.)
// The model's side of the spread / total (9/30 rewrite). Before, the side came from a calibrated cover chance; once that chance
// became a flat constant (the model's gap carries no measurable signal), the "side" was ALWAYS the away team (spread) and the
// graded Record tab was scoring "away teams cover", not the model's pick. Now the side is what the model actually says:
// spread = the team the model likes more than the line does; total = over if the model total is above the line. `pct` is the
// historical cover rate of the model's side (2013-25), not a per-game chance, so the card says "No lean" either way.
export const MODEL_SIDE_RATE = { spread: 0.51, total: 0.505 };
export function spreadPick(m, homeSpread, away, home) {
  if (!m || m.homeMargin == null || homeSpread == null) return null;
  const gap = m.homeMargin + homeSpread;              // model's home margin minus the market's (-homeSpread)
  // Dead toss-up on the raw numbers: lean the side the CALIBRATED chance leans (every game gets a side when that chance is not exactly 50%).
  const tie = Math.abs(gap) < 0.05; if (tie && (m.calHomeCover == null || m.calHomeCover === 50)) return null;
  const isHome = tie ? m.calHomeCover > 50 : gap > 0, pct = MODEL_SIDE_RATE.spread * 100;
  return { side: isHome ? "home" : "away", team: isHome ? home : away, line: isHome ? homeSpread : -homeSpread,
    label: `${isHome ? home : away} ${sgn(isHome ? homeSpread : -homeSpread)}`, pct, tier: tierFor(pct), gap: tie ? 0 : Math.abs(gap), ...(tie ? { tie: true } : {}) };
}
export function totalPick(m, line) {
  if (!m || m.total == null || line == null) return null;
  const gap = m.total - line;
  const tie = Math.abs(gap) < 0.05; if (tie && (m.calUnder == null || m.calUnder === 50)) return null;   // same tie-break as spreads
  const over = tie ? m.calUnder < 50 : gap > 0, pct = MODEL_SIDE_RATE.total * 100;
  return { side: over ? "over" : "under", line, label: `${over ? "Over" : "Under"} ${line}`, pct, tier: tierFor(pct), gap: tie ? 0 : Math.abs(gap), ...(tie ? { tie: true } : {}) };
}

// Sportsbook no-vig fair probability, moved to Polymarket's exact line (normal approx, protocol SDs).
function bookFairSpreadHome(bk, polyHS) {
  if (!bk || !bk.spread) return null;
  return shiftCover(bk.spread.home.fair, bk.spread.homeSpread, polyHS);
}
function bookFairOver(bk, line) {
  if (!bk || !bk.total) return null;
  const mu = bk.total.line - SD_TOTAL * ninv(1 - bk.total.over.fair);
  return 1 - ncdf((line - mu) / SD_TOTAL);
}

// Candidate Polymarket bets for one game with book-based fair probability (2.11 prior; Estimate if no books).
export function gameBets(key, away, home, poly, bk, spick, tpick, m) {
  const out = [];
  const add = (market, label, price, fair, agrees, estimate = false) => {
    if (!(price > 0 && price < 1) || fair == null) return;
    const ev = fair / price - 1;
    out.push({ game: key, market, label, price, odds: toAmerican(price), fair, fairOdds: toAmerican(fair), ev,
      stake: kellyStake(fair, price), agrees, estimate, recheck: ev > 0.3,
      section: ev > 0.3 ? "recheck" : estimate ? "estimate" : "bet" });
  };
  // Model-only fair probabilities (used when no sportsbook reference exists -> Estimate). Calibrated (same
  // reasoning as spreadPick/totalPick above): the model-vs-market gap has no measured signal for covers/unders,
  // so this correctly sits at ~50% rather than showing a fake edge.
  // At THIS line (9/30): before, these returned the chance at the last rerun's line even after Polymarket moved
  // (rerun at -3, market now -7 -> "49% fair" at -7 and a fake big edge).
  const mHome = (hs) => (m && m.calHomeCover != null ? (m.mktHomeSpread != null ? shiftCover(m.calHomeCover / 100, m.mktHomeSpread, hs) : m.calHomeCover / 100) : null);
  const mOver = (line) => { if (!m || m.calUnder == null) return null; let pu = m.calUnder / 100;
    if (m.mktTotal != null && m.mktTotal !== line) { const mu = m.mktTotal - SD_TOTAL * ninv(pu); pu = ncdf((line - mu) / SD_TOTAL); } return 1 - pu; };
  if (poly && poly.spread) {
    const hs = poly.spread.homeSpread, bf = bookFairSpreadHome(bk, hs), fh = bf != null ? bf : mHome(hs), est = bf == null;
    if (fh != null) {
      add("spread", `${home} ${sgn(hs)}`, poly.spread.home, fh, spick ? spick.side === "home" : null, est);
      add("spread", `${away} ${sgn(-hs)}`, poly.spread.away, 1 - fh, spick ? spick.side === "away" : null, est);
    }
  }
  if (poly && poly.ml) {
    const whp = m ? winPctAt(m, poly.spread ? poly.spread.homeSpread : null) : null;   // win chance at the current line
    const fh = bk && bk.ml ? bk.ml.home.fair : whp != null ? whp / 100 : null, est = !(bk && bk.ml);
    if (fh != null) {
      add("ml", `${home} ML`, poly.ml.home, fh, spick ? spick.team === home : null, est);
      add("ml", `${away} ML`, poly.ml.away, 1 - fh, spick ? spick.team === away : null, est);
    }
  }
  if (poly && poly.total) {
    const bf = bookFairOver(bk, poly.total.line), fo = bf != null ? bf : mOver(poly.total.line), est = bf == null;
    if (fo != null) {
      add("total", `Over ${poly.total.line}`, poly.total.over, fo, tpick ? tpick.side === "over" : null, est);
      add("total", `Under ${poly.total.line}`, poly.total.under, 1 - fo, tpick ? tpick.side === "under" : null, est);
    }
  }
  return out;
}

// Match a pbp short name ("Bi.Robinson", "A.St.Brown") to a full name ("Bijan Robinson", "Amon-Ra St. Brown").
const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "");
export function nameMatches(short, text) {
  const i = short.indexOf(".");
  // Play-by-play short form = 1-3 letters then "." with no space before it ("Bi.Robinson", "A.J.Brown"). Anything else is a
  // full name, even with a "." in it ("Travis Etienne Jr.", "Amon-Ra St. Brown"): before 9/30 those never matched, even themselves.
  const isShort = i > 0 && i <= 3 && !/\s/.test(short.slice(0, i));
  if (!isShort) {   // no initial: whole words in order ("Mike Williams" must NOT match "Mike Williamson"; before 9/30 it did)
    const SUF = new Set(["jr", "sr", "ii", "iii", "iv", "v"]), words = (x) => norm(x.replace(/[-.]/g, " ")).split(/\s+/).filter((w) => w && !SUF.has(w));
  const a = words(short), t = words(text);   // suffixes ignored on both sides ("Travis Etienne Jr." = "Travis Etienne")
    if (!a.length) return false;
    for (let s = 0; s + a.length <= t.length; s++) if (a.every((w, j) => t[s + j] === w)) return true;
    return false;
  }
  const pre = short.slice(0, i).toLowerCase(), rest = norm(short.slice(i + 1)).replace(/ /g, "");
  const w = norm(text.replace(/[-.]/g, " ")).split(/\s+/).filter(Boolean);
  for (let a = 1; a < w.length; a++) {
    let s = "";
    for (let b = a; b < w.length && s.length < rest.length; b++) { s += w[b]; if (s === rest && (w[a - 1].startsWith(pre) || (a > 1 && w[a - 2].startsWith(pre)))) return true; }
  }
  return false;
}

// Polymarket's real wording is literal: "<Player> 1+ touchdowns" / "2+" / "3+".
// A market with NO number+threshold at all ("Will X score a touchdown?") is also anytime (1+).
function isAnytimeTD(q) {
  if (/anytime/i.test(q)) return !/\b(first|last|passing)\b/i.test(q);
  if (/\b(two|three|2 or more|3 or more|multiple|passing|first|last)\b/i.test(q)) return false;
  const m = q.match(/(\d+)\s*\+/);
  return !m || m[1] === "1";
}
// TD rows for one game: model fair % + Polymarket TD price + injury status.
const lastOf = (n) => norm(String(n).replace(/[\s.]+(jr|sr|ii|iii|iv|v)\.?\s*$/i, "").split(".").pop()).trim().split(/\s+/).pop() || "";
// rosterPos: Map(normalized full name -> position) for both teams (snap counts). The last-name fallback below never takes a
// market whose name is a roster player at a DIFFERENT position (9/30: a WR "Z.Jones" with no market got QB Daniel Jones's).
export const rosterKey = (n) => norm(String(n).replace(/[-.]/g, " ")).replace(/\s+/g, " ").trim();
export const rosterPosFor = (snaps, away, home) => snaps ? new Map([...Object.values(snaps[away] || {}), ...Object.values(snaps[home] || {})].map((x) => [rosterKey(x.name), x.pos])) : null;
const POSG = (x) => ({ FB: "RB", HB: "RB" }[x] || x);
export function tdRows(key, away, home, tdModel, tdPrices, injuries, rosterPos = null) {
  const rows = [], allNames = [...((tdModel && tdModel.away) || []), ...((tdModel && tdModel.home) || [])].map((x) => x.name);
  for (const side of ["away", "home"]) {
    const team = side === "away" ? away : home;
    for (const p of (tdModel && tdModel[side]) || []) {
      let price = null, stale = false, market = null, bid = null, thin = false;
      if (tdPrices) {
        // Polymarket lists 1+, 2+, 3+ (and passing) TD markets per player. Anytime = 1+.
        // Skip every other threshold; if several still match, 1+ is always the highest price.
        const px = (q) => (typeof tdPrices[q] === "number" ? { ask: tdPrices[q] } : tdPrices[q]);
        const cands = Object.keys(tdPrices).filter((q) => nameMatches(p.name, q) && isAnytimeTD(q));
        // Prefer a real market: an empty 95¢ placeholder on one wording used to win the sort and then get discarded,
        // hiding a real price on the other wording of the same market.
        const real = (c) => !isThinMarket(px(c).ask, px(c).bid ?? null);
        let q = cands.sort((a, b) => real(b) - real(a) || px(b).ask - px(a).ask)[0];
        // Nickname fallback (9/30): "Bam Knight" on Polymarket is "Z.Knight" in play-by-play, so the initial check fails.
        // Match on last name only when exactly ONE modeled player in this game and ONE anytime market share it.
        if (!q) {
          const ln = lastOf(p.name), same = allNames.filter((n) => lastOf(n) === ln).length;
          const mk = Object.keys(tdPrices).filter((k) => isAnytimeTD(k) && lastOf(k.replace(/\s*(1\+|anytime).*$/i, "")) === ln);
          const other = mk.length === 1 && rosterPos ? rosterPos.get(rosterKey(mk[0].replace(/\s*(1\+|anytime).*$/i, ""))) : null;
          if (ln && same === 1 && mk.length === 1 && !(other && POSG(other) !== POSG(p.pos))) q = mk[0];
        }
        if (q) { const o = px(q); price = o.ask; bid = o.bid ?? null; thin = isThinMarket(o.ask, o.bid ?? null); market = q;
          // A thin 90¢+ "price" is an empty placeholder (no one trading), not a real ask. Before 9/28 night it made the
          // row look like -900 odds and the tab's -600 filter hid the PLAYER entirely (e.g. CHI/JAX/TEN/BAL showed none).
          if (thin && price >= 0.9) { price = null; bid = null; thin = false; market = null; } }
      }
      else if (p.price != null) { price = p.price / 100; stale = true; }
      const inj = ((injuries || {})[team] || []).find((x) => nameMatches(p.name, x.name));
      // Out AND Doubtful leave the TD list: 99% of Doubtful starters sit (2016-25 reports), and an inactive player's
      // anytime-TD market resolves No. Before 9/28 a Doubtful player kept his full % on the tab.
      const out = /^(out|doubtful)$/i.test(inj ? inj.status || "" : "");
      if (out) continue;                                            // #11 Out/Doubtful players leave the TD list
      if (!(p.fair >= 10) && !(price != null && !stale)) continue;  // #17 only relevant players
      rows.push({ player: p.name, pos: p.pos, team, game: key, two: p.two ?? null, first: p.first ?? null, fair: p.fair, price, bid, thin, stale, market, note: p.note, depthNote: p.depthNote || null, injury: inj ? inj.status : null });
    }
  }
  // rank by fair within the game, lead rusher = top RB per team
  const ranked = rows.filter((r) => r.fair != null).sort((a, b) => b.fair - a.fair);
  ranked.forEach((r, i) => { r.rank = i + 1; r.of = ranked.length; });
  for (const t of [away, home]) { const tr = ranked.filter((r) => r.team === t); tr.forEach((r, i) => { r.teamRank = i + 1; r.teamOf = tr.length; }); }
  for (const t of [away, home]) { const rb = ranked.find((r) => r.team === t && r.pos === "RB"); if (rb) rb.leadRusher = true; }
  for (const r of rows) {
    priceTd(r);
  }
  return rows;
}
// EV / price label / money-bet / stake for one TD row. Exported so week.js re-runs it AFTER calibration: before 9/28 these
// were computed from the raw model number while the tab showed the calibrated one.
export function priceTd(r) {
  {
    r.odds = r.price ? toAmerican(r.price) : null;
    r.fairOdds = r.fair != null ? toAmerican(r.fair / 100) : null;
    r.ev = r.fair != null && r.price ? (r.fair / 100) / r.price - 1 : null;
    // Price label: Underpriced / Fair / Overpriced (±5%). Lean: Bet or Pass only.
    r.priceLabel = r.ev == null ? null : r.ev <= -0.05 ? "Overpriced" : r.ev < 0.05 ? "Fair" : "Underpriced";
    // Mark's rule: team's top 4 likely scorers = Bet (colored by price: green/yellow/red).
    // #5 and below = Bet only if Underpriced, otherwise Pass.
    r.lean = r.ev == null ? "—" : r.teamRank <= 4 || r.priceLabel === "Underpriced" ? "Bet" : "Pass";
    // Money list (Best Bets + stake): only Underpriced 5–30% on a live price.
    // Thin market (isThinMarket: no bid within 5¢ / 40% of the ask): the ask isn't a real price, so never a money bet.
    r.moneyBet = !r.stale && !r.thin && r.priceLabel === "Underpriced" && r.ev <= 0.3;
    r.stake = r.moneyBet ? kellyStake(r.fair / 100, r.price) : 0;
    r.recheck = r.ev != null && r.ev > 0.3;
  }
  return r;
}

// Protocol 2.13 correlation warnings across the Best Bets list.
export function correlationWarnings(bets, tdBets) {
  for (const t of tdBets) {
    t.warnings = [];
    const [away, home] = t.game.split(" @ "), opp = t.team === away ? home : away;
    for (const b of bets.filter((b) => b.game === t.game)) {
      if (t.leadRusher && /^Under/.test(b.label)) t.warnings.push(`Conflicts with ${b.label}`);
      if ((b.market === "spread" || b.market === "ml") && b.label.startsWith(opp + " ")) t.warnings.push(`Conflicts with ${b.label}`);
      if ((b.market === "spread" || b.market === "ml") && b.label.startsWith(t.team + " ") && t.leadRusher)
        t.warnings.push(`Goes with ${b.label}`);
      if (/^Under/.test(b.label) && !t.leadRusher) t.warnings.push(`Conflicts with ${b.label}`);
    }
  }
  for (const b of bets) {
    b.warnings = [];
    const sides = bets.filter((x) => x.game === b.game && x !== b && x.market !== "total" && b.market !== "total" && x.label.split(" ")[0] === b.label.split(" ")[0]);
    if (sides.length) b.warnings.push(`Same team as ${sides.map((x) => x.label).join(", ")}`);
  }
}

// Polymarket anytime-TD markets that match NO modeled player (QBs, returners, kickers-turned-rushers, new signings).
// The model only covers RB/WR/TE, so before 9/28 these players (e.g. a rushing QB at 40¢) silently never appeared.
// Listed with price only — no model number exists for them.
export function tdUnmodeled(tdModel, tdPrices, used = new Set()) {   // used = markets already attached to a player row
  if (!tdPrices) return [];
  const names = [...((tdModel && tdModel.away) || []), ...((tdModel && tdModel.home) || [])].map((p) => p.name);
  const out = [];
  for (const q of Object.keys(tdPrices)) {
    if (!isAnytimeTD(q) || used.has(q) || names.some((n) => nameMatches(n, q))) continue;
    const v = typeof tdPrices[q] === "number" ? { ask: tdPrices[q] } : tdPrices[q];
    if (!(v.ask > 0.05)) continue;
    if (isThinMarket(v.ask, v.bid ?? null)) continue;   // real markets only: empty 98-99¢ placeholders and 1¢-bid long shots aren't prices
    out.push({ player: q.replace(/\s*(1\+|anytime).*$/i, "").replace(/^will\s+/i, "").trim(), price: v.ask, thin: false });   // thin ones skipped above
  }
  return out.sort((a, b) => b.price - a.price).slice(0, 8);
}

// Calibrated home win % (fair_line.cal_win, same coefficients) at a GIVEN market line. homeWinPct is stored at the
// line of the last rerun; when Polymarket moves, the card and the moneyline grade should use the current/closing line.
const CAL_WIN = [-0.0452, 0.1464, 0.0];   // same as fair_line.CAL_WIN (rechecked 9/30: market-only, the model-gap weight is 0)
// Home win chance from the market spread alone (the same calibrated formula, no model needed) -- used by "Most likely winners".
export const winPctMarket = (homeSpread) => (homeSpread == null ? null : 100 / (1 + Math.exp(-(CAL_WIN[0] + CAL_WIN[1] * -homeSpread))));
export function winPctAt(m, homeSpread) {
  if (!m || m.homeMargin == null || homeSpread == null) return m ? m.homeWinPct ?? null : null;
  const mkt = -homeSpread, x = CAL_WIN[0] + CAL_WIN[1] * mkt + CAL_WIN[2] * (m.homeMargin - mkt);
  return 100 / (1 + Math.exp(-x));
}

