// Called by the Railway scheduler every 30 minutes on game days: rebuilds the slate (fresh Polymarket lines + model), which saves each
// game's first-seen line (for "line moved") and every PICK / LEAN seen before tip-off (for the record). It is also the only thing that
// can pull sportsbook odds (twice a day when due; ?books=now forces one for a signed-in person).
import { buildSlate } from "../../../nba/lib/slate";
import { getRedis, SLATE_CACHE } from "../../../nba/lib/redis";
import { markSnapshot, logError } from "../../../nba/lib/status";
import { recordBookGaps, recordGaps, recordInjuryShadow, recordAngleShadows, recordMoves, pullPinnacle, pinnacleFailed, pinnacleOk } from "../../../nba/lib/pinnacle";
import { scoreNbaProps } from "../../../nba/lib/props";
import { recordH1Shadows } from "../../../nba/lib/h1spread";
export const config = { maxDuration: 120 };   // 10/23: room for the props retry (25 s + 3 s + 25 s) after the slate build
export default async function handler(req, res) {
  try {
    const data = await buildSlate({ days: 1, pullBooks: true, forceBooks: req.query.books === "now" });
    await getRedis().set(SLATE_CACHE, JSON.stringify(data), "EX", 60).catch(() => {});
    await markSnapshot({ games: data.games.length, modelOk: data.modelOk, picks: data.bestBets.length, books: data.booksPull || null });
    if (data.modelOk === false) await logError("model", data.modelError || "model service did not answer");   // null = nothing to send (no game had lines)
    if (data.booksPull && data.booksPull.note && !data.booksPull.pulled) await logError("books", data.booksPull.note);
    // 10/29 (owner: "check tonight that the books pulls happen before each tip-off wave"): the closing snapshot 3 minutes before a tip names any game
    // whose books are not from the 90 minutes before its tip (BOOK GAP is off for it) -- it lands on Models -> System
    { const bt = Date.parse(data.books && data.books.t), now = Date.parse(data.now) || Date.now();
      const late = data.games.filter((g) => !g.preseason && !g.inProgress && Date.parse(g.start) > now && Date.parse(g.start) - now <= 10 * 60e3 && !(isFinite(bt) && bt <= Date.parse(g.start) && Date.parse(g.start) - bt <= 90 * 60e3));
      if (late.length) await logError("books", `no books pull in the 90 minutes before tip-off for ${late.map((g) => g.key).join(", ")} -- BOOK GAP is off for ${late.length === 1 ? "it" : "them"}`); }
    // 10/20 (owner: Player props): the NBA prop model scores every recorded line of each game not yet tipped (last copy before tip-off = the locked one)
    let props = null; try { props = await scoreNbaProps(data.games); if (props.error && !props.building) await logError("props", props.error); } catch (e) { await logError("props", e); }
    // Pinnacle's free feed (opening lines + history for LINE MOVE) comes AFTER the page data is saved, so a slow or blocked feed can never cost the
    // snapshot. A failed pull is only logged on the 2nd in a row; a pull that answered but saved nothing for a day with games counts as a failure.
    let pin = null;
    try {
      const r = await pullPinnacle(data.games); pin = r.n;
      if (r.n === 0 && data.games.some((g) => !g.inProgress && !g.preseason)) await pinnacleFailed(r.fails > 0 ? "one league failed and nothing was saved" : "the feed answered but no game was saved", logError); else await pinnacleOk();
      const reg = data.games.filter((g) => !g.preseason);   // the signals were tested on regular-season lines only
      await recordMoves(reg); await recordGaps(reg); await recordBookGaps(reg, data.books && data.books.t); await recordInjuryShadow(reg); await recordAngleShadows(reg).catch(() => 0); await recordH1Shadows(reg).catch(() => 0);
    } catch (e) { await pinnacleFailed(String(e.message || e).slice(0, 120), logError); }
    res.status(200).json({ ok: true, games: data.games.length, modelOk: data.modelOk, picks: data.bestBets.length, books: data.booksPull, pinnacle: pin, props, at: data.now });
  } catch (err) { await logError("snapshot", err); await markSnapshot({ games: 0, modelOk: null, failed: String(err && err.message || err).slice(0, 120) }).catch(() => {}); res.status(500).json({ ok: false, error: String(err) }); }
}
