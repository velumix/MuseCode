// Protocol fixtures for the real native runner; no network or account required.
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const provider = process.argv[2];
const args = process.argv.slice(3);
const log = (entry) => fs.appendFileSync(process.env.MUSE_QA_LOG, JSON.stringify({ provider, pid: process.pid, ...entry }) + "\n");
if (provider === "codex" && args[0] === "app-server") {
  require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    const result = request.method === "model/list" ? { data: [{ model: "fixture-codex", displayName: "Fixture Codex", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }], defaultReasoningEffort: "high" }], nextCursor: null } : {};
    console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
} else if (provider === "antigravity" && args[0] === "models") {
  process.exitCode = fs.existsSync(process.env.MUSE_QA_LOG + ".auth") ? 0 : 1;
  if (!process.exitCode) console.log("fixture-agy-high    Fixture Antigravity (High)\nfixture-agy-low    Fixture Antigravity (Low)");
} else if (provider === "antigravity" && args.includes("--log-file")) {
  log({ kind: "auth" });
  let selected = false;
  let input = "";
  process.stdout.write("Select login method:\r\n> 1. Google OAuth\r\n");
  process.stdin.on("data", (chunk) => {
    input += chunk.toString();
    if (!input.includes("\r") && !input.includes("\n")) return;
    if (!selected) {
      selected = true;
      process.stdout.write("\x1b[2J\x1b[HOpen the URL below in your browser:\r\nhttps://accounts.google.com/o/oauth2/auth?state=fixture&code_challenge=test\r\n\r\nauthorization code...\r\n");
    } else if (input.includes("4/valid-fixture-code")) {
      fs.writeFileSync(process.env.MUSE_QA_LOG + ".auth", "verified");
      process.stdout.write("\x1b[2J\x1b[HSigned in.\r\n");
    } else process.stdout.write("\x1b[2J\x1b[HGot an error: token exchange failed: invalid_grant\r\n");
    input = "";
  });
  setInterval(() => {}, 1000);
} else if (args[0] === "--descendant") {
  log({ kind: "descendant" }); setInterval(() => {}, 1000);
} else if (!args.includes("exec") && !args.includes("--input-format")) {
  log({ kind: "terminal", cwd: process.cwd(), args });
  process.stdout.write(`${provider} QA terminal\r\n`);
  process.stdin.on("data", (chunk) => process.stdout.write(chunk));
  setInterval(() => {}, 1000);
} else {
  const input = fs.readFileSync(0, "utf8");
  const raw = provider === "antigravity" ? JSON.parse(input).message.content : input;
  const prompt = raw.includes("Current request:\n") ? raw.split("Current request:\n").at(-1) : raw;
  const id = provider === "codex" ? "62c2d305-9dd5-4c94-b4c0-667eb612f401" : "ae283c22-1851-4d5c-a5c5-d14d53c23b72";
  log({ kind: "provider-turn", prompt, input: raw, args, cwd: process.cwd() });
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
    if (prompt === 'DENIED') {
      console.error('jetski: a tool required the command permission that headless mode cannot prompt for, so it was auto-denied.');
      for (let i=0;i<40;i++) console.error('Following stderr diagnostic '+i);
    }
    emit({ event: "step_update", step_update: { step_type: "agent_response", text_delta: `Reply: ${prompt}` } });
    emit({ event: "result", result: { status: "SUCCESS", response: `Reply: ${prompt}`, conversation_id: id } });
  }
}
