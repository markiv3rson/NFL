import { gradeAll, gradePick } from "../../../../nba/lib/record";
import { finalsFor } from "../../../../nba/lib/espn";
import { gradeMoves } from "../../../../nba/lib/pinnacle";
import { gradeParlays } from "../../../../nba/lib/parlays";
import { gradeNbaProps, compactNbaProps } from "../../../../nba/lib/props";
import { sharedBox } from "../../../../nba/lib/espn";
import { getRedis } from "../../../../nba/lib/redis";
import { gradeGameProps } from "../../../../nba/lib/gameprops";
import { usEvent } from "../../../../lib/polyus";
import { eventSlug } from "../../../../lib/gamemarkets";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try { const box = sharedBox();
    res.status(200).json({ ok: true, graded: await gradeAll(), moves: await gradeMoves(finalsFor, gradePick).catch(() => 0), parlays: await gradeParlays(finalsFor, box).catch(() => 0), props: await gradeNbaProps({ fetchBox: box }).catch(() => 0), compacted: await compactNbaProps().catch(() => 0),
      gameprops: await gradeGameProps(getRedis(), usEvent, (a, h, start) => eventSlug("nba", a, h, start)).catch(() => 0) }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
}
