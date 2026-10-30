// The reply checks in .claude/hooks/guard.mjs (stop): each case is a fake transcript run through the hook; blocked = exit 2.
// Cases are the owner's real complaints of 10/30 ("Running the tests now." with nothing run, research asked and nothing done, "sorry").
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
const HOOK = new URL("../.claude/hooks/guard.mjs", import.meta.url).pathname, dir = mkdtempSync(join(tmpdir(), "guardtest-"));
const owner = (t) => ({ type: "user", message: { role: "user", content: t } });
const say = (t) => ({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
const tool = (name, input = {}) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
const result = () => ({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } });
let n = 0, fail = 0;
function run(name, lines, wantBlock) {
  const f = join(dir, `t${n++}.jsonl`); writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const r = spawnSync("node", [HOOK, "stop"], { input: JSON.stringify({ transcript_path: f, session_id: "guardtest", cwd: process.cwd() }), encoding: "utf8" });
  const blocked = r.status === 2;
  if (blocked !== wantBlock) { fail++; console.log(`FAIL ${name}: blocked=${blocked} ${r.stderr.trim()}`); } else console.log(`ok   ${name}`);
}
run("promise with nothing run", [owner("WHY ARE YOU NOT FOLLOWING MY RULES"), say("That was rule 6. Running the tests now.")], true);
run("research asked, nothing ran", [owner("I NEED YOU TO DO THE RESEARCH AND TESTS"), say("Testing now on what is downloaded.")], true);
run("work asked, answered with text only", [owner("Continue all your research and test only"), say("Here is what I found earlier.")], true);
run("sorry", [owner("why did it restart"), say("Sorry, the machine restarted.")], true);
run("long answer to a question", [owner("So what?"), say(Array(200).fill("word").join(" ") + ".")], true);
run("tools ran, promise of more without a background job", [owner("run the tests"), tool("Bash", { command: "ls" }), result(), say("Done with part one. Next I test the rest.")], true);
run("short answer to a question", [owner("So what"), say("The wind idea is out: nothing to add.")], false);
run("question with a conditional I'll", [owner("Can you build it?"), say('Send "build now" and I\'ll build it.')], false);
run("work done in the turn", [owner("Find more research"), tool("Bash", { command: "python3 x.py" }), result(), say("Tested 12 claims: none hold on unseen games.")], false);
run("background job started and said", [owner("download everything"), tool("Bash", { command: "python3 pull.py", run_in_background: true }), result(), say("The download is running in the background; I'll report when it finishes.")], false);
run("reply quoting the blocked words", [owner("Build now"), tool("Bash", { command: "npm run test:site" }), result(),
  say('It blocks a reply that says "sorry" or promises work ("running now", "I\'ll…") that is not running.')], false);
console.log(fail ? `${fail} guard check(s) failed` : `all ${n} guard checks pass`);
process.exit(fail ? 1 : 0);
