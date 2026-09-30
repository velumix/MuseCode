// Deterministic child process used by native-smoke.mjs, never shipped.
const fs = require("node:fs");
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const { spawn } = require("node:child_process");
const qaTag = process.argv.find(arg => arg.startsWith('--velum-qa-run='));
const args = process.argv.slice(2).filter(arg => arg !== qaTag);
const log = (entry) => fs.appendFileSync(process.env.MUSE_QA_LOG, JSON.stringify({ pid: process.pid, ...entry }) + "\n");
let turnSession = '', runId = '', currentPrompt = '';
function modelUsage(run = runId, output = currentPrompt === 'METRICS_RESUME' ? 80 : 120) {
  if(!process.env.XDG_DATA_HOME)return;
  const dir=path.join(process.env.XDG_DATA_HOME,'muse/sessions/2026/09/30',turnSession);
  fs.mkdirSync(dir,{recursive:true});
  const id=randomUUID();
  const record={schema_version:1,id,stream:{kind:'session',id:turnSession},payload_type:'runtime.session',payload:{run_id:run,source_run_record_id:id,event:{kind:'model_completed',usage:{input_tokens:501,cached_tokens:200,output_tokens:output,reasoning_tokens:20}}}};
  const line=JSON.stringify(record)+'\n';
  fs.appendFileSync(path.join(dir,'session.jsonl'),line+line); // Identical evidence must count once.
}
const record = (type, payload) => {
  if(type==='run.terminal.completed'){
    modelUsage();modelUsage(randomUUID(),900); // Child run is separate from the root turn.
  }
  console.log(JSON.stringify({ stream:{kind:'session',id:turnSession}, payload_type: type, payload }));
};
if (args[0] === "serve") {
  require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    const result = request.method === "model/list" ? { models: [{ modelId: "fixture-muse", displayLabel: "Fixture Muse", variants: ["low", "high", "max"] }, { modelId: "fixture-muse-fast", displayLabel: "Fixture Muse Fast", variants: ["low"] }] } : {};
    console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
} else if (args[0] === "--descendant") {
  log({ kind: "descendant" });
  setInterval(() => {}, 1000);
} else if (args[0] !== "exec") {
  log({ kind: "terminal", cwd: process.cwd(), args });
  process.stdout.write("Muse QA terminal\r\nsearch target\r\n");
  process.stdin.on("data", (chunk) => process.stdout.write(chunk));
  setInterval(() => {}, 1000);
} else {
  const file = args[args.indexOf("--prompt-file") + 1];
  const input = fs.readFileSync(file, "utf8");
  const prompt = input.includes("Current request:\n") ? input.split("Current request:\n").at(-1) : input;
  currentPrompt=prompt;turnSession=args[args.indexOf('--session-id')+1];runId=randomUUID();
  record('run.lifecycle.started',{command_id:runId,run_stream:{kind:'run',id:runId}});
  process.on('exit',()=>log({kind:'exit',prompt,at:Date.now()}));
  log({ kind: "turn", cwd: process.cwd(), prompt, input, file, args });
  if (prompt === "HOLD") {
    record("task.lifecycle.proposed", { task_id: "hold", event: { task_kind: "tool.powershell" } });
    spawn(process.execPath, [__filename, "--descendant", ...(qaTag ? [qaTag] : [])], { stdio: "inherit", windowsHide: true });
    setInterval(() => {}, 1000);
  } else if (prompt === "NO_COMPLETION") {
    record("run.output.delta", { text: "Incomplete output" });
    // Real launchers can exit zero without a provider terminal event.
  } else if (prompt === "RETRY_RECOVER") {
    const status = (phase, extra = {}) => record("task.lifecycle.status", { event: {
      message: "Provider status", details: { phase, facets: [
        { kind: "external_attempt", system: "meta", operation: "model.response", attempt: 1, max_attempts: 10, ...extra },
        { kind: "producer", detail: { request_id: "PRIVATE_REQUEST", token: "PRIVATE_TOKEN" } },
      ] },
    } });
    status("retry_scheduled", { next_attempt: 2, retry_delay_ms: 3000, http_status: 503 });
    setTimeout(() => {
      record('task.lifecycle.status',{event:{details:{phase:'opening_stream'}}});
      record("run.output.delta", { text: "Recovered after service retry" });
      record('task.lifecycle.status',{event:{details:{phase:'stream_succeeded'}}});
      record("run.terminal.completed", { terminal: "completed", text: "Recovered after service retry" });
    }, 3000);
  } else if (prompt === "MEMORY_PROPOSAL" || prompt === "MEMORY_FAIL") {
    const answer = 'Saved idea.\n```velum-memory\n[{"title":"Database choice","body":"The project uses SQLite with WAL mode.","tags":["database"]}]\n```';
    for (const text of answer) record("run.output.delta", { text });
    record("run.terminal.completed", { terminal: "completed", text: answer });
    if (prompt === "MEMORY_FAIL") process.exitCode = 7;
  } else if (prompt === "FAIL") {
    console.error("QA fixture failed deliberately");
    process.exitCode = 7;
  } else if (prompt === "BACKGROUND") {
    setTimeout(() => {
      record("run.output.delta", { text: "Reply: BACKGROUND" });
      record("run.terminal.completed", { terminal: "completed", text: "Reply: BACKGROUND" });
    }, 1400);
  } else if (prompt === 'QUEUE_HOLD') {
    setTimeout(()=>{
      record('run.output.delta',{text:'Reply: QUEUE_HOLD'});
      record('run.terminal.completed',{terminal:'completed',text:'Reply: QUEUE_HOLD'});
      setTimeout(()=>{},350);
    },1600);
  } else {
    if (prompt !== "FINAL_ONLY") record("run.output.delta", { text: `Reply: ${prompt}` });
    record("run.terminal.completed", { terminal: "completed", text: `Reply: ${prompt}` });
    // A terminal record often precedes process exit. It must not allow a
    // second send until the backend is actually ready for another child.
    setTimeout(() => {}, 350);
  }
}
