// Protocol fixtures for the real native runner; no network or account required.
const fs = require("node:fs");
const path = require('node:path');
const { spawn } = require("node:child_process");
const provider = process.argv[2];
const qaTag = process.argv.find(arg => arg.startsWith('--velum-qa-run='));
const args = process.argv.slice(3).filter(arg => arg !== qaTag);
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
  process.on('exit',()=>log({kind:'exit',prompt,at:Date.now()}));
  const emit = (value) => console.log(JSON.stringify(value));
  emit(provider === "codex" ? { type: "thread.started", thread_id: id } : { event: "init", conversation_id: id });
  if (prompt === "HOLD") {
    spawn(process.execPath, [__filename, provider, "--descendant", ...(qaTag ? [qaTag] : [])], { stdio: "inherit", windowsHide: true });
    setInterval(() => {}, 1000);
  } else if (prompt === "FAIL") {
    emit(provider === "codex" ? { type: "turn.failed", error: { message: "Provider fixture failure" } } : { event: "result", result: { status: "ERROR", error: "Provider fixture failure" } });
    process.exitCode = 1;
  } else {
    function complete(){
    const output=prompt==='METRICS_RESUME'?80:120;
    if(provider==='codex'){
      const usage={input_tokens:501,cached_input_tokens:200,output_tokens:output,reasoning_output_tokens:20};
      let total;
      if(process.env.CODEX_HOME){
        const dir=path.join(process.env.CODEX_HOME,'sessions/2026/09/30');fs.mkdirSync(dir,{recursive:true});
        const file=path.join(dir,`rollout-fixture-${id}.jsonl`);
        const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').trim().split('\n').at(-1)).payload.info.total_token_usage:{input_tokens:100000,cached_input_tokens:50000,output_tokens:50000,reasoning_output_tokens:10000};
        total=Object.fromEntries(Object.entries(usage).map(([key,value])=>[key,previous[key]+value]));
        fs.appendFileSync(file,JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'token_count',info:{model_context_window:100000,last_token_usage:{...usage,total_tokens:501+output},total_token_usage:total}}})+'\n');
      }
      emit({type:'item.completed',item:{id:'msg',type:'agent_message',text:`Reply: ${prompt}`}});
      emit({type:'turn.completed',usage:prompt==='METRICS_CUMULATIVE'?total:usage});
      setTimeout(()=>{},350);return;
    }
    if (prompt === 'DENIED') {
      // Agy sometimes supplies an empty DONE snapshot and reports the denial
      // only on stderr. The UI must correct the unconfirmed tool's status.
      emit({event:'step_update',step_update:{step_index:8,step_type:'tool',tool_name:'run_command',state:'DONE',tool_info:{parameters:{CommandLine:'fixture command'}}}});
      console.error('jetski: a tool required the command permission that headless mode cannot prompt for, so it was auto-denied.');
      for (let i=0;i<40;i++) console.error('Following stderr diagnostic '+i);
    }
    const step={event:'step_update',step_update:{step_index:8,step_type:'agent_response',state:'DONE',text_delta:`Reply: ${prompt}`,usage:{input_tokens:501,cache_read_tokens:200,output_tokens:output,thinking_tokens:20}}};
    emit(step);
    emit({...step,step_update:{...step.step_update,text_delta:''}}); // Repeated usage snapshot.
    emit({event:'step_update',step_update:{step_index:9,step_type:'checkpoint',state:'DONE',usage:{input_tokens:10,cache_read_tokens:0,output_tokens:5,thinking_tokens:0}}});
    emit({ event: "result", result: { status: "SUCCESS", response: `Reply: ${prompt}`, conversation_id: id, num_turns:3,usage:{input_tokens:100000,cache_read_tokens:80000,output_tokens:50000,thinking_tokens:10000} } });
    setTimeout(()=>{},350);
    }
    if(prompt==='QUEUE_HOLD')setTimeout(complete,1600);else complete();
  }
}
