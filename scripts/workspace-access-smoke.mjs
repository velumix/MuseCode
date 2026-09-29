// Opt-in: exercises the real native runner and installed, signed-in Codex CLI.
// Uses the existing account; no credentials or user file contents are exported.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';

assert(process.argv.includes('--live'), 'Use --live to authorize real provider turns.');
assert.equal(process.platform, 'win32');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceArg = process.argv.indexOf('--workspace');
const expectProfileDenial = process.argv.includes('--expect-profile-denial');
const resetMode = process.argv.includes('--mode-reset');
const ordinary = process.argv.includes('--ordinary-probe');
const isolated = process.argv.includes('--isolated');
const existing = execFileSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-Process velum-code -ErrorAction SilentlyContinue).Count'], {encoding:'utf8',windowsHide:true}).trim();
if (!isolated) assert.equal(existing, '0', 'Close Velum, or use --isolated with the separately identified test binary.');
const runDir = path.join(root,'.qa',`access-live-${Date.now()}`);
mkdirSync(runDir,{recursive:true});
const workspace = workspaceArg < 0 ? path.join(runDir,"dedicated project ' & spaces") : path.resolve(process.argv[workspaceArg + 1]);
if(workspaceArg < 0) mkdirSync(workspace);
const port = 19429;
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const alive = pid => {try {process.kill(pid,0); return true;} catch {return false;}};
const vite = spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:root,windowsHide:true,stdio:'ignore'});
let app, browser, invoke;
const reports=[];
const before = new Set(readdirSync(workspace).filter(n=>n.startsWith('.velum-access-')));
const id = `access-live-${randomUUID()}`;
try {
  for(let i=0;i<100;i++){try {if((await fetch('http://127.0.0.1:1420')).ok)break;}catch{}await wait(100);}
  app = spawn(path.join(root,isolated?'.qa/velum-access-smoke.exe':'src-tauri/target/debug/velum-code.exe'),[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,
    MUSE_CODE_CONFIG_DIR:path.join(runDir,'settings'),WEBVIEW2_USER_DATA_FOLDER:path.join(runDir,'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
  for(let i=0;i<120;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{}await wait(100);}
  assert(browser,'Native WebView2 connection unavailable');
  let page;
  for(let i=0;i<100;i++){page=browser.contexts()[0]?.pages()[0];if(page)break;await wait(100);}
  assert(page);await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
  invoke=(cmd,args={})=>page.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
  if (isolated) assert.equal(await invoke('plugin:app|identifier'), 'com.velumix.musecode.access-smoke', 'Test binary must have a distinct app identifier.');
  await invoke('desktop_set_notifications',{enabled:false});
  await invoke('agent_new',{id,tabId:id,workspace,provider:'codex',options:{model:'',reasoning:''},resume:false});
  if(expectProfileDenial) {
    await assert.rejects(invoke('agent_send',{id,prompt:'List the selected workspace.',yolo:false}),/Choose a project folder/);
  }
  const historyPath=path.join(runDir,'settings','history',`${id}.json`);
  async function checkpoint(after=0) {
    const deadline=Date.now()+240000;
    while(Date.now()<deadline) {
      try{const saved=JSON.parse(readFileSync(historyPath,'utf8')); if(saved.events.length>after&&saved.events.at(-1)?.kind==='turn_end')return saved;}catch{}
      await wait(250);
    }
    throw Error('Provider turn did not reach its history checkpoint');
  }
  let ordinaryEvents=0;
  if(ordinary && !expectProfileDenial) {
    await invoke('agent_send',{id,yolo:false,prompt:'Use one PowerShell tool call to list the selected workspace with Get-ChildItem -LiteralPath . -Force -ErrorAction Stop | Measure-Object. Do not inspect any file contents, use external connections, or change files. Do not spawn other agents. Then finish.'});
    ordinaryEvents=(await checkpoint()).events.length;
    const report=await invoke('app_diagnostics',{workspace,id});
    assert(report.workspace_access.agent.checks.every(c=>c.status==='untested'),'Ordinary tools were promoted to diagnostic evidence');
    assert.equal(report.workspace_access.collection.method,'explicit_diagnostic_turn');
    console.log('PASS: ordinary tool turn leaves explicit diagnostic results untested.');
  }
  const modes=process.argv.includes('--include-yolo')?[false,false,true,false]:resetMode?[false,false,false]:expectProfileDenial?[false]:[false,false];
  let previousSession;
  let previousEventCount = ordinaryEvents;
  for(const [index,yolo] of modes.entries()){
    const reset=resetMode&&index===2;
    if(reset) {
      await invoke('agent_set_permissions',{id,yolo:true});
      const invalid=await invoke('app_diagnostics',{workspace,id});
      assert(invalid.workspace_access.agent.checks.every(c=>c.status==='untested'));
      // No provider turn is launched in unrestricted mode. Switch the isolated
      // test session back to Standard and verify its new actual provider thread.
    }
    const changed=await invoke('agent_set_permissions',{id,yolo});
    const stale=await invoke('app_diagnostics',{workspace,id});
    if(index===0 || reset || modes[index-1]!==yolo) assert(stale.workspace_access.agent.checks.every(c=>c.status==='untested'),'Stale evidence survived mode change');
    if(index>0)assert.equal(changed.new_session,reset||modes[index-1]!==yolo,'Unexpected provider session transition');
    await invoke('agent_check_access',{id,yolo});
    let report;
    const deadline=Date.now()+240000;
    do {await wait(1000);report=await invoke('app_diagnostics',{workspace,id});}while(report.workspace_access.agent.running&&Date.now()<deadline);
    reports.push(report);
    writeFileSync(path.join(runDir,'diagnostics.json'),JSON.stringify(reports,null,2));
    assert(!report.workspace_access.agent.running,'Probe did not finish within four minutes');
    console.log(JSON.stringify({mode:yolo?'yolo':'standard',revision:report.workspace_access.permissions.revision,host:report.workspace_access.host.checks.map(c=>[c.operation,c.status]),agent:report.workspace_access.agent.checks.map(c=>[c.operation,c.status,c.error_code]),effective:report.workspace_access.permissions.effective}));
    assert(report.workspace_access.host.checks.every(c=>c.status==='pass'),'Host probe failed');
    if(expectProfileDenial) {
      assert.equal(report.workspace_access.selection.kind,'user_profile_root');
      assert.equal(report.workspace_access.agent.checks[0].status,'fail');
      assert.equal(report.workspace_access.agent.checks[0].error_code,'access_denied');
      assert.equal(report.workspace_access.agent.checks[1].status,'pass');
      assert.equal(report.workspace_access.agent.checks[2].status,'fail');
      // Codex 0.157's file_change event omits the native patch error. Preserve
      // an unknown tool failure instead of inventing an OS/policy error code.
      assert(['access_denied','tool_failure'].includes(report.workspace_access.agent.checks[2].error_code));
      assert(report.workspace_access.agent.checks.slice(3).every(c=>c.status==='untested'),'Dependent operations must remain untested after denied creation');
    } else assert(report.workspace_access.agent.checks.every(c=>c.status==='pass'),'Some real agent operations did not pass; see sanitized diagnostics');
    assert.equal(report.workspace_access.permissions.effective.sandbox,yolo?'danger-full-access':'workspace-write');
    assert.equal(report.workspace_access.permissions.effective.approval_policy,'never');
    assert.equal(report.workspace_access.agent.host_cleanup.status,'pass');
    // Read only our isolated test conversation's resume metadata, never export
    // its prompt or tool output. Wait for the normal history checkpoint.
    const saved=await checkpoint(previousEventCount);
    assert(saved?.session_id,'Provider did not return a persisted resume ID');
    assert(saved.events.length>previousEventCount&&saved.events.at(-1)?.kind==='turn_end','Current turn was not checkpointed');
    if(index>0)assert.equal(saved.session_id===previousSession,!reset&&modes[index-1]===yolo,'Resume ID did not follow the selected permission mode');
    previousSession=saved.session_id;
    previousEventCount=saved.events.length;
  }
  if(expectProfileDenial) {
    await invoke('agent_set_permissions',{id,yolo:true});
    await assert.rejects(invoke('agent_send',{id,prompt:'List the selected workspace.',yolo:false}),/Choose a project folder/);
    const report=await invoke('app_diagnostics',{workspace,id});
    assert.equal(report.workspace_access.permissions.requested_mode,'standard');
    assert.equal(report.workspace_access.permissions.launched_mode,null);
    assert(report.workspace_access.agent.checks.every(c=>c.status==='untested'),'Workspace guard retained stale evidence from the old mode');
    console.log('PASS: a rejected Standard launch still applies the requested mode and invalidates old evidence.');
  }
  if(!expectProfileDenial) {
    await invoke('agent_destroy',{id});
    await invoke('agent_new',{id,tabId:id,workspace,provider:'codex',options:{model:'',reasoning:''},resume:true});
    const report=await invoke('app_diagnostics',{workspace,id});
    assert(report.workspace_access.agent.checks.every(c=>c.status==='untested'),'Restored session reused in-memory diagnostic results');
    console.log('PASS: recreating the native session invalidates diagnostics.');
  }
  if(expectProfileDenial && process.argv.includes('--recover-project')) {
    const project=path.join(runDir,"selected project ' & spaces");
    mkdirSync(project);
    await invoke('agent_destroy',{id});
    await invoke('agent_new',{id,tabId:id,workspace:project,provider:'codex',options:{model:'',reasoning:''},resume:false});
    const fresh=await invoke('app_diagnostics',{workspace:project,id});
    assert(fresh.workspace_access.agent.checks.every(c=>c.status==='untested'));
    assert.equal(fresh.workspace_access.selection.kind,'project_directory');
    await invoke('agent_check_access',{id,yolo:false});
    let report;
    const deadline=Date.now()+240000;
    do{await wait(1000);report=await invoke('app_diagnostics',{workspace:project,id});}while(report.workspace_access.agent.running&&Date.now()<deadline);
    reports.push(report);
    writeFileSync(path.join(runDir,'diagnostics.json'),JSON.stringify(reports,null,2));
    assert(!report.workspace_access.agent.running);
    assert(report.workspace_access.agent.checks.every(c=>c.status==='pass'),'Selected project recovery failed');
    assert.equal(report.workspace_access.permissions.effective.sandbox,'workspace-write');
    assert.equal(report.workspace_access.permissions.effective.network,'restricted');
    assert.equal(report.workspace_access.agent.host_cleanup.status,'pass');
    assert.deepEqual(readdirSync(project).filter(n=>n.startsWith('.velum-access-')),[]);
    console.log('PASS: profile-root failure → explicit project selection → all six real agent checks pass in Standard.');
  }
  const after=readdirSync(workspace).filter(n=>n.startsWith('.velum-access-')&&!before.has(n));
  assert.deepEqual(after,[],'Probe directories leaked');
  console.log(`PASS: real native provider path, mode transitions, operation evidence and cleanup. Report: ${path.join(runDir,'diagnostics.json')}`);
} finally {
  await invoke?.('agent_stop',{id}).catch(()=>{});
  await invoke?.('agent_destroy',{id}).catch(()=>{});
  await invoke?.('desktop_quit').catch(()=>{});
  await browser?.close().catch(()=>{});
  if(app){for(let i=0;i<100&&alive(app.pid);i++)await wait(100);if(alive(app.pid))execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
  if(alive(vite.pid))vite.kill();
}
