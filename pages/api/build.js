// Which deployment is live (10/18 night, owner: "I always have to close it then reopen"): the pages ask every minute and reload themselves
// when a newer build answers (public/shell.js buildWatch). Tiny and never cached.
import { BUILD } from "../../lib/redis";
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, build: BUILD });
}
