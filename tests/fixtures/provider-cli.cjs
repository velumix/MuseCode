// Protocol fixtures for the real native runner; no network or account required.
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const provider = process.argv[2];
const args = process.argv.slice(3);
const log = (entry) => fs.appendFileSync(process.env.MUSE_QA_LOG, JSON.stringify({ provider, pid: process.pid, ...entry }) + "\n");
if (args[0] === "--descendant") {
  log({ kind: "descendant" }); setInterval(() => {}, 1000);
} else if (!args.includes("exec") && !args.includes("--input-format")) {
  log({ kind: "terminal", cwd: process.cwd() });
  process.stdout.write(`${provider} QA terminal\r\n`);
  process.stdin.on("data", (chunk) => process.stdout.write(chunk));
  setInterval(() => {}, 1000);
} else {
  const input = fs.readFileSync(0, "utf8");
  const prompt = provider === "antigravity" ? JSON.parse(input).message.content : input;
  const id = provider === "codex" ? "62c2d305-9dd5-4c94-b4c0-667eb612f401" : "ae283c22-1851-4d5c-a5c5-d14d53c23b72";
  log({ kind: "provider-turn", prompt, args, cwd: process.cwd() });
  const emit = (value) => console.log(JSON.stringify(value));
  emit(provider === "codex" ? { type: "thread.started", thread_id: id } : { event: "init", conversation_id: id });
  if (prompt === "HOLD") {
    spawn(process.execPath, [__filename, provider, "--descendant"], { stdio: "inherit", windowsHide: true });
    setInterval(() => {}, 1000);
  } else if (prompt === "FAIL") {
    emit(provider === "codex" ? { type: "turn.failed", error: { message: "Provider fixture failure" } } : { event: "result", result: { status: "ERROR", error: "Provider fixture failure" } });
    process.exitCode = 1;
  } else if (provider === "codex") {
    emit({ type: "item.completed", item: { id: "msg", type: "agent_message", text: `Reply: ${prompt}` } });
    emit({ type: "turn.completed" });
  } else {
    emit({ event: "step_update", step_update: { step_type: "agent_response", text_delta: `Reply: ${prompt}` } });
    emit({ event: "result", result: { status: "SUCCESS", response: `Reply: ${prompt}`, conversation_id: id } });
  }
}
