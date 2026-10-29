// The owner's rules (CLAUDE.md), enforced where code can enforce them. Wired in .claude/settings.json.
//   node guard.mjs prompt  (UserPromptSubmit) saves the owner's latest message
//   node guard.mjs pre     (PreToolUse)       blocks an action the latest message does not allow
//   node guard.mjs stop    (Stop)             keeps a "build now" reply going until the tests ran and it does not end on a question
// A block = exit 2, the reason on stderr (Claude reads it).
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const mode = process.argv[2];
let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
const PROJ = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const STATE = join(tmpdir(), "slatezz-guard");
const stateFile = () => join(STATE, `${String(input.session_id || "x").replace(/[^\w-]/g, "")}.txt`);
// "build now" / "merge now" said as a command -- not inside "did I say build now?", "I didn't say build now", "until I say build now", "wait for ..."
const NEG = /\b(did\s+i|didn['’]?t|did\s+not|not|never|until|till|before|wait(ing)?\s+(for|till|until)|when|after)\s+(i\s+)?(say|said|tell\s+you(\s+to)?|told\s+you(\s+to)?)?\s*(to\s+)?["“']?(build|merge)\s+now\b/gi;
const said = (word) => ({ test: (p) => new RegExp(`\\b${word}\\s+now\\b`, "i").test(String(p).replace(NEG, " ")) });
const BUILD = said("build"), MERGE = said("merge");
const block = (msg) => { process.stderr.write(`BLOCKED (owner's rules): ${msg}\n`); process.exit(2); };

// the last part of the transcript as parsed lines (the file can be very large)
function tail(bytes = 8e6) {
  try { const fd = openSync(input.transcript_path, "r"), size = fstatSync(fd).size, n = Math.min(size, bytes), buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n); closeSync(fd);
    return buf.toString("utf8").split("\n").slice(size > n ? 1 : 0).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
// an owner message (not a tool result, not an interrupt notice, not a summary)
function ownerText(d) {
  if (!d || d.type !== "user" || d.isMeta || d.isCompactSummary || !d.message) return null;
  const c = d.message.content;
  const t = typeof c === "string" ? c : Array.isArray(c) && !c.some((x) => x && x.type === "tool_result") ? c.filter((x) => x && x.type === "text").map((x) => x.text).join(" ") : null;
  if (t == null || /^\s*(\[Request interrupted|<task-notification>|\[SYSTEM NOTIFICATION|Stop hook feedback|Tool loaded\.?\s*$|<system-reminder>)/i.test(t)) return null;
  return t;
}
function lastPrompt() {
  try { return readFileSync(stateFile(), "utf8"); } catch {}
  const L = tail(); for (let i = L.length - 1; i >= 0; i--) { const t = ownerText(L[i]); if (t != null) return t; }
  return "";
}
const inProj = (p) => { if (!p) return false; const a = resolve(PROJ, String(p)); return a === PROJ || a.startsWith(PROJ + "/"); };

if (mode === "prompt") {
  // a background-job notice, a hook's message or a tool notice is not the owner speaking: it never replaces the owner's latest message
  const p = String(input.prompt || "");
  if (/^\s*(<task-notification>|\[SYSTEM NOTIFICATION|Stop hook feedback|Tool loaded\.?\s*$|<system-reminder>)/i.test(p)) process.exit(0);
  try { mkdirSync(STATE, { recursive: true }); writeFileSync(stateFile(), p); } catch {}
  process.exit(0);
}

if (mode === "pre") {
  const P = lastPrompt(), build = BUILD.test(P), merge = MERGE.test(P), t = input.tool_name || "", ti = input.tool_input || {};
  const NOBUILD = 'rule 3: nothing changes until the owner\'s latest message says "build now". Answer and wait (rule 1).';
  const NOMERGE = 'rule 3: nothing goes live (PR / merge / main) until the owner\'s latest message says "merge now".';
  // rule 2: no questions back after "build now"
  if (t === "AskUserQuestion" && build) block('rule 2: no questions or options after "build now". Decide it yourself.');
  // rule 3: file changes in the project
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t) && inProj(ti.file_path || ti.notebook_path) && !build) block(NOBUILD);
  // GitHub: PRs / merges need "merge now"; pushes and file writes need "build now" (to main: "merge now")
  if (/^mcp__github__(create_pull_request|merge_pull_request|enable_pr_auto_merge|update_pull_request_branch)$/.test(t) && !merge) block(NOMERGE);
  if (/^mcp__github__(push_files|create_or_update_file|delete_file|create_branch)$/.test(t)) { if (/^(main|master)$/.test(String(ti.branch || ""))) { if (!merge) block(NOMERGE); } else if (!build) block(NOBUILD); }
  if (t === "Bash") {
    const cmd = String(ti.command || "");
    const toMain = /\bgit\s+push\b[^;&|\n]*\b(main|master)\b/.test(cmd) || /\bgh\s+api\b[^\n]*(\/merges\b|\/pulls\/\d+\/merge\b|-X\s*POST[^\n]*\/pulls\b)/.test(cmd);
    if (toMain && !merge) block(NOMERGE);
    const gitWrite = /\bgit\s+(commit|push|merge|rebase|reset|revert|cherry-pick|am|apply|stash|restore|rm|mv|add|tag|checkout\s+--)\b/.test(cmd);
    const editInPlace = /\bsed\s+(-[a-zA-Z]*i\b|--in-place)|\bperl\s+-[a-zA-Z]*i/.test(cmd);
    const redirs = [...cmd.matchAll(/(?:^|[^\d&>])>>?\s*(?!&)["']?([^\s;&|"'<>]+)/g)].map((m) => m[1]).filter((p) => p !== "/dev/null");
    const projMention = new RegExp(`(^|[\\s'"(=])(${PROJ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|\\.?/?(public|lib|pages|nba|tests|railway-model-service|scripts|\\.claude)/|CLAUDE\\.md|package(-lock)?\\.json|vercel\\.json|railway\\.json)`);
    const otherWrite = /open\([^)\n]*,\s*['"][wa]|writeFileSync|appendFileSync|\.write_text\(|shutil\.(copy|move)|os\.(remove|rename|replace|unlink)|\b(rm|mv|cp|touch|mkdir|tee|truncate|ln)\s|\bnpm\s+(install|i|uninstall|update)\b/.test(cmd);
    const wantsWrite = gitWrite || (editInPlace && projMention.test(cmd)) || redirs.some(inProj) || (otherWrite && projMention.test(cmd));
    if (wantsWrite && !build && !(toMain && merge)) block(NOBUILD);
    // rule 18: commit lines, no model names
    if (/\bgit\s+commit\b/.test(cmd) && /\s(-[a-zA-Z]*m|--message)\b/.test(cmd)) {
      if (!cmd.includes("Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>") || !/Claude-Session:\s*https:\/\/claude\.ai\/code\/session_/.test(cmd)) block("rule 18: a commit ends with the Co-Authored-By line and the Claude-Session line.");
      if (/\b(opus|sonnet|haiku|fable)\b|claude-(opus|sonnet|haiku|fable)/i.test(cmd.replace(/Co-Authored-By: Claude Opus 5\.5 <noreply@anthropic\.com>/g, ""))) block("rule 18: no model names in commits.");
    }
    // before a push: no secrets (rule 17), both sports (rule 8), the tests pass (rules 6 / 11 / 12 / 15)
    if (/\bgit\s+push\b/.test(cmd)) {
      const sh = (c) => { try { return execSync(c, { cwd: PROJ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64e6 }); } catch { return ""; } };
      const base = sh("git rev-parse --abbrev-ref --symbolic-full-name @{u}").trim() || "origin/main", range = `${base}..HEAD`;
      const files = sh(`git diff --name-only ${range}`).split("\n").filter(Boolean), added = sh(`git diff ${range}`).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
      if (/rediss?:\/\/[^\s:@\/]*:[^\s@\/]{6,}@|KV_REST_API_(READ_ONLY_)?TOKEN\s*=\s*["']?\w{20,}|sk-ant-[\w-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|POLYMARKET_SECRET_KEY\s*=\s*["']?\w{10,}/.test(added)) block("rule 17: this push carries a secret (database URL / token / key). Take it out first.");
      const nfl = files.some((f) => /^public\/(app\.js|index\.html)$/.test(f)), nba = files.some((f) => /^public\/nba\//.test(f));
      const msgs = sh(`git log --format=%B ${range}`);
      if (nfl !== nba && !/\[(NFL|NBA) only\]/.test(msgs)) block(`rule 8: only the ${nfl ? "NFL" : "NBA"} pages changed. A look / layout change goes on both sports; a code-only change for one sport says "[${nfl ? "NFL" : "NBA"} only]" in its commit message.`);
      if (files.length) { try { execSync("npm run test:site && npm run test:nba", { cwd: PROJ, stdio: ["ignore", "pipe", "pipe"], timeout: 300e3 }); }
        catch (e) { block(`rules 6 / 11 / 12 / 15: the tests fail, nothing is pushed.\n${String((e.stdout || "") + (e.stderr || "")).split("\n").filter((l) => /FAIL|failed|Error/.test(l)).slice(0, 15).join("\n")}`); } }
      // rules 8 / 10: a change to the pages is saved only when every page of both sports passes the look check (phone + computer)
      if (files.some((f) => /^public\//.test(f) || f === "tests/lookcheck.mjs")) { try { execSync("node tests/lookcheck.mjs", { cwd: PROJ, stdio: ["ignore", "pipe", "pipe"], timeout: 900e3 }); }
        catch (e) { block(`rules 8 / 10: the look check fails (pages differ NFL vs NBA, wrap, overlap or run off the screen), nothing is pushed.\n${String(e.stdout || "").split("\n").slice(0, 25).join("\n")}`); } }
    }
  }
  process.exit(0);
}

if (mode === "stop") {
  if (input.stop_hook_active) process.exit(0);
  const L = tail(); let start = -1, prompt = "";
  for (let i = L.length - 1; i >= 0; i--) { const t = ownerText(L[i]); if (t != null) { start = i; prompt = t; break; } }
  if (start < 0 || !BUILD.test(prompt)) process.exit(0);
  let lastEdit = -1, lastTest = -1, lastPageEdit = -1, lastLook = -1, lastText = "";
  L.slice(start + 1).forEach((d, i) => {
    if (d.type !== "assistant" || !d.message || !Array.isArray(d.message.content)) return;
    for (const c of d.message.content) {
      if (c.type === "text" && c.text.trim()) lastText = c.text;
      if (c.type !== "tool_use") continue;
      const ti = c.input || {}, cmd = String(ti.command || "");
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name) && inProj(ti.file_path || ti.notebook_path)) lastEdit = i;
      if (c.name === "Bash" && /\bnpm\s+(run\s+)?test\b|\bnpm\s+run\s+test:(site|nba)\b/.test(cmd)) lastTest = i;
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name) && /\/public\//.test(String(ti.file_path || ""))) lastPageEdit = i;
      if (c.name === "Bash" && /\/public\//.test(cmd) && /\bsed\s+-i|open\([^)]*['"]w|>>?\s*public\//.test(cmd)) lastPageEdit = i;
      if (c.name === "Bash" && /lookcheck\.mjs|npm\s+run\s+test:look/.test(cmd)) lastLook = i;
    }
  });
  if (lastEdit >= 0 && lastTest < lastEdit) block("rule 6: files changed after the last test run. Run npm run test:site and npm run test:nba before finishing.");
  if (lastPageEdit >= 0 && lastLook < lastPageEdit) block("rules 6 / 8: pages changed after the last look check. Run npm run test:look (every page, both sports, phone + computer) and fix what it finds before finishing.");
  if (/\?\s*$/.test(lastText.trim())) block('rule 2: no questions back after "build now". Decide it yourself and finish.');
  process.exit(0);
}
process.exit(0);
