// Opt-in real provider validation through Tauri's production runner. Existing
// CLI accounts are used; app preferences/history and all files are isolated.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

assert(process.argv.includes('--live'), 'Pass --live to run signed-in Muse and Agy turns.');
assert.equal(process.platform, 'win32');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, '.qa', `providers-verified-${Date.now()}`);
const workspace = path.join(runDir, "project ' & spaces");
mkdirSync(workspace, { recursive: true });
const known = 'Velum provider verification fixture.\n';
writeFileSync(path.join(workspace, 'hello.txt'), known);
const installed = process.argv.includes('--installed');
const providerIndex=process.argv.indexOf('--provider');
const providers=providerIndex<0 ? ['muse','antigravity'] : [process.argv[providerIndex+1]];
assert(providers.every(p=>['muse','antigravity'].includes(p)), 'Expected --provider muse or antigravity');
const release = installed || process.argv.includes('--release');
const appPath = installed ? path.join(process.env.LOCALAPPDATA, 'Velum Code/velum-code.exe') : path.join(root, `src-tauri/target/${release ? 'release' : 'debug'}/velum-code.exe`);
assert.equal(execFileSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-Process velum-code -ErrorAction SilentlyContinue).Count'], {encoding:'utf8',windowsHide:true}).trim(), '0', 'Close Velum before this isolated test; never attach to user conversations.');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 19433;
let app, browser, vite, invoke;
const ids=[];
const report = { installed, catalog: {}, turns: [], diagnostics: [], ui: [], errors: [] };
const save = () => writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(report, null, 2));
console.log(`Live provider evidence: ${runDir}`);
try {
  if (!release) {
    try { assert((await fetch('http://127.0.0.1:1420', {signal:AbortSignal.timeout(1000)})).ok); }
    catch {
      vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {cwd:root,windowsHide:true,stdio:'ignore'});
      for(let i=0;i<100;i++){ try { if((await fetch('http://127.0.0.1:1420')).ok) break; } catch{} await wait(100); }
    }
  }
  app = spawn(appPath, [], {cwd:workspace,windowsHide:true,stdio:'ignore',env:{...process.env,
    MUSE_CODE_CONFIG_DIR:path.join(runDir,'settings'), WEBVIEW2_USER_DATA_FOLDER:path.join(runDir,'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
  for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{}await wait(100);}
  assert(browser,'WebView2 connection unavailable');
  let page;
  for(let i=0;i<100;i++){page=browser.contexts()[0]?.pages()[0];if(page)break;await wait(100);}
  assert(page, 'Native webview missing');
  await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
  page.on('pageerror', error => report.errors.push(error.message));
  invoke=(cmd,args={})=>page.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
  await invoke('desktop_set_notifications',{enabled:false});
  report.providers = await invoke('provider_status');
  const catalogs=await Promise.allSettled(providers.map(async provider => {
    const started=Date.now();
    const catalog=await invoke('provider_models',{provider,refresh:true});
    report.catalog[provider]={...catalog,elapsedMs:Date.now()-started};save();
    assert(catalog.models.length, `${provider}: ${catalog.notice || 'No models'}`);
    console.log(`PASS: ${provider} discovered ${catalog.models.length} real models.`);
  }));
  for(const result of catalogs) if(result.status==='rejected') throw result.reason;
  for(const provider of process.argv.includes('--ui-only') ? [] : providers) {
    const id=`live-${provider}-${randomUUID()}`;ids.push(id);
    const options=report.catalog[provider].defaults;
    const marker=`VELUM_${provider.toUpperCase()}_OK`;
    await invoke('agent_new',{id,tabId:id,workspace,provider,options,resume:false});
    let eventCount=0, sessionId;
    async function run(label, command, args) {
      const started=Date.now();
      await invoke(command,{id,yolo:false,...args});
      const deadline=Date.now()+240000;
      while(Date.now()<deadline) {
        let saved;
        try { saved=JSON.parse(readFileSync(path.join(runDir,'settings','history',`${id}.json`),'utf8')); } catch{}
        if(saved?.events.length>eventCount && saved.events.at(-1)?.kind==='turn_end') {
          const events=saved.events.slice(eventCount); eventCount=saved.events.length;
          const result={provider,label,elapsedMs:Date.now()-started,sessionId:saved.session_id,events};
          assert.equal(saved.permission_mode,false,'Live test left Standard mode');
          report.turns.push(result);save();
          return result;
        }
        await wait(250);
      }
      await invoke('agent_stop',{id});
      throw Error(`${provider}: ${label} timed out. Check the provider service; no mode was weakened.`);
    }
    for(let turn=0;turn<2;turn++) {
      const result=await run(turn?'resume':'reply','agent_send',{prompt:turn ? 'Reply with the exact verification marker from my preceding request. Do not use tools or change anything.' : `Reply exactly ${marker}. Do not use tools, read files, or change anything.`});
      assert.equal(result.events.at(-1).status,'completed',JSON.stringify(result.events.at(-1)));
      const answer=result.events.at(-1).text || result.events.filter(e=>e.kind==='assistant_delta').map(e=>e.text).join('');
      assert.equal(answer.trim(),marker);
      if(turn) assert.equal(result.sessionId,sessionId,'Provider did not resume its conversation');
      sessionId=result.sessionId;
      console.log(`PASS: ${provider} ${turn?'resumed':'fresh'} reply (${result.elapsedMs}ms).`);
    }
    const diagnosticTurn=await run('workspace access','agent_check_access',{});
    const diagnostic=await invoke('app_diagnostics',{workspace,id});
    report.diagnostics.push({provider,diagnostic});save();
    assert(diagnostic.workspace_access.host.checks.every(c=>c.status==='pass'));
    const checks=diagnostic.workspace_access.agent.checks;
    if(provider==='muse') {
      assert.equal(diagnosticTurn.events.at(-1).status,'completed');
      assert(checks.every(c=>c.status==='pass'),JSON.stringify(checks));
      assert.equal(diagnostic.provider_runtime.progress.phase,'connected');
    } else if(diagnosticTurn.events.at(-1).status==='blocked') {
      assert(checks.some(c=>c.status==='blocked'&&c.error_code==='provider_policy'),'Denied command was not attributed to an operation');
      assert(checks.every(c=>['pass','blocked','untested'].includes(c.status)),'Policy denial mislabeled as filesystem failure');
    } else {
      assert.equal(diagnosticTurn.events.at(-1).status,'completed');
      assert(checks.every(c=>c.status==='pass'),JSON.stringify(checks));
    }
    assert.equal(diagnostic.workspace_access.agent.host_cleanup.status,'pass');
    assert(!JSON.stringify(diagnostic).includes(workspace),'Diagnostic path leak');
    assert.deepEqual(readdirSync(workspace),['hello.txt'],'Probe cleanup failed');
    assert.equal(readFileSync(path.join(workspace,'hello.txt'),'utf8'),known);
    console.log(JSON.stringify({provider,standardAccess:checks.map(c=>[c.operation,c.status,c.error_code])}));
    // Change only this test conversation's requested mode, run no YOLO turn,
    // and return to Standard before validating a fresh provider session.
    await invoke('agent_set_permissions',{id,yolo:true});
    await invoke('agent_set_permissions',{id,yolo:false});
    const invalid=await invoke('app_diagnostics',{workspace,id});
    assert(invalid.workspace_access.agent.checks.every(c=>c.status==='untested'));
    assert.equal(invalid.provider_runtime.progress,null);
    assert.equal(invalid.provider_runtime.last_retry,null);
    const fresh=await run('after permission reset','agent_send',{prompt:`Reply exactly ${marker}. Do not use tools or change anything.`});
    assert.equal(fresh.events.at(-1).status,'completed');
    assert.notEqual(fresh.sessionId,sessionId,'Permission change reused a stale provider session');
    console.log(`PASS: ${provider} invalidated diagnostics and started a fresh Standard session after a mode change.`);
    await invoke('agent_destroy',{id});
  }
  // Also drive the installed React controls, not just named native commands.
  await invoke('desktop_show');
  for(const provider of providers) {
    await page.getByLabel('AI provider').selectOption(provider);
    const chat=page.locator('.chat-wrap:not(.hidden)');
    const composer=chat.locator('.composer textarea');
    await expect(composer).toBeEnabled();
    const folder=chat.getByLabel('Workspace directory');
    if(await folder.getAttribute('title') !== workspace) {
      await folder.fill(workspace);
      await chat.getByRole('button',{name:'Apply',exact:true}).click();
    }
    await expect(folder).toHaveAttribute('title',workspace);
    await expect(composer).toBeEnabled();
    await expect(page.locator('.model-controls')).toHaveAttribute('aria-busy','false');
    await expect(chat.getByRole('button',{name:'YOLO mode'})).toHaveAttribute('aria-pressed','false');
    const marker=`VELUM_UI_${provider.toUpperCase()}_OK`;
    const started=Date.now();
    await composer.fill(`Reply exactly ${marker}. Do not use tools, read files, or change anything.`);
    await composer.press('Enter');
    await page.locator('.status-text').filter({hasText:'Done'}).waitFor({timeout:150000});
    await expect(chat.locator('.msg.assistant').last()).toContainText(marker);
    assert.equal(await chat.locator('.notice.error').count(),0);
    report.ui.push({provider,standard:true,workspaceApplied:true,responseVisible:true,elapsedMs:Date.now()-started});save();
    await page.screenshot({path:path.join(runDir,`installed-${provider}.png`)});
    console.log(`PASS: ${provider} real reply is visible after selecting a project in the installed UI.`);
  }
  assert.deepEqual(report.errors,[]);
  console.log(`PASS: real ${providers.join(' and ')} ${process.argv.includes('--ui-only')?'UI':'native runner and UI'} validation completed. No provider permission rules or existing workspace files were changed.`);
} catch(error) { report.errors.push(String(error));console.error(error);process.exitCode=1; }
finally {
  save();
  if(invoke) for(const id of ids) try{await invoke('agent_destroy',{id});}catch{}
  if(browser) await browser.close();
  if(app?.pid) try{execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}
  if(vite?.pid) try{execFileSync('taskkill',['/PID',String(vite.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}
}
