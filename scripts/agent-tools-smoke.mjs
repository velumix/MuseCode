// Tests native IPC, MCP stdio, all provider launch paths, project confinement,
// scoped memory, browser screenshots and attached timing. No paid model calls.
// --native also checks desktop input/capture and requires an unlocked desktop.
import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import { chromium } from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.equal(process.platform,'win32');
const release=process.argv.includes('--release'),installed=process.argv.includes('--installed'),native=process.argv.includes('--native');
const appPath=installed?path.join(process.env.LOCALAPPDATA,'Velum Code/velum-code.exe'):path.join(root,`src-tauri/target/${release?'release':'debug'}/velum-code.exe`);
const runDir=path.join(root,'.qa',`agent tools ${Date.now()} & project`),workspace=path.join(runDir,'project'),other=path.join(runDir,'other');
mkdirSync(workspace,{recursive:true});mkdirSync(other);
for(const dir of ['node_modules','.preview']){mkdirSync(path.join(workspace,dir));writeFileSync(path.join(workspace,dir,'noise.txt'),'needle');}
for(let n=0;n<110;n++)writeFileSync(path.join(workspace,`source-${n}.txt`),'needle\nneedle\n');
for(const p of ['muse','codex','antigravity'])writeFileSync(path.join(workspace,p+'-cleanup.txt'),'remove only this fixture');
execFileSync('git',['init',workspace],{windowsHide:true,stdio:'ignore'});
for(const [provider,command] of [['muse','muse'],['codex','codex'],['antigravity','agy']])writeFileSync(path.join(runDir,command+'.cmd'),`@echo off\r\n"${process.execPath}" "${path.join(root,'tests/fixtures/tool-provider.cjs')}" ${provider} %*\r\n`);
const preview=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Tool preview fixture</title><h1>Tool preview fixture</h1><input id="name" aria-label="Name"><button id="apply" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Apply</button><p id="result"></p>');});
await new Promise(resolve=>preview.listen(0,'127.0.0.1',resolve));
const reportFile=path.join(runDir,'tools.jsonl');writeFileSync(reportFile,'');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let vite,app,browser,invoke;
try {
  if(!release&&!installed){vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:root,windowsHide:true,stdio:'ignore'});for(let n=0;n<100;n++){try{if((await fetch('http://127.0.0.1:1420')).ok)break;}catch{}await sleep(100);}}
  app=spawn(appPath,[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,PATH:`${runDir};${process.env.PATH}`,MUSE_QA_LOG:path.join(runDir,'catalog.jsonl'),MUSE_CODE_CONFIG_DIR:path.join(runDir,'settings'),VELUM_ISOLATED_TEST:'1',XDG_DATA_HOME:path.join(runDir,'provider-data'),CODEX_HOME:path.join(runDir,'codex-data'),VELUM_QA_APP:appPath,VELUM_QA_NATIVE:native?'1':'0',VELUM_QA_NATIVE_TITLE:'Velum native QA '+createHash('sha256').update(path.join(runDir,'settings')).digest('hex').slice(0,8),GIT_TEST_ASSUME_DIFFERENT_OWNER:'1',VELUM_QA_PREVIEW:`http://127.0.0.1:${preview.address().port}`,VELUM_QA_TOOL_REPORT:reportFile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19446',WEBVIEW2_USER_DATA_FOLDER:path.join(runDir,'webview')}});
  for(let n=0;n<150;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:19446');break;}catch{}await sleep(100);}assert(browser,'Native WebView debug endpoint unavailable');
  let page;for(let n=0;n<100;n++){page=browser.contexts()[0]?.pages()[0];if(page)break;await sleep(100);}assert(page);
  await page.waitForSelector('.composer textarea:enabled');
  invoke=(cmd,args={})=>page.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
  await invoke('desktop_set_notifications',{enabled:false});
  const status=await invoke('agent_tools_status');assert(status.ready);assert.equal(status.permissions.native_control,false);assert.equal(status.permissions.native_screenshot,false);
  for(const [project,title,noteStatus] of [[workspace,'Visible active note','active'],[workspace,'Pending note','pending'],[other,'Other project note','active']])await invoke('memory_request',{workspace:project,request:{action:'save',id:null,revision:null,title,body:'tool vault marker',tags:[],scope:'project',status:noteStatus,pinned:false}});
  const privateBot=randomUUID();
  for(const [id,title] of [[privateBot,'Private active note'],[randomUUID(),'Other bot private note']]) {
    await invoke('bots_request',{request:{action:'save',profile:{id,name:'Tool test bot '+id.slice(0,8),role:'QA',avatar:'',color:'#79a9ff',enabled:true,provider:'codex',options:{model:'fixture-codex',reasoning:'high'},soul:'Run only fixture checks.',agent:'Verify tool scope.',shared_memory:false,memory_budget:1000,default_cron:'*/15 * * * *',timezone:'UTC',automatic:false,allow_handoffs:false,max_minutes:1,revision:''}}});
    await invoke('bots_memory',{id,workspace,request:{action:'save',id:null,revision:null,title,body:'tool vault marker',tags:[],scope:'project',status:'active',pinned:false}});
  }
  const outcomes=[];
  for(const provider of ['muse','codex','antigravity']) {
    const enableNative=native&&provider==='codex';
    await invoke('agent_tools_configure',{permissions:{...status.permissions,native_screenshot:enableNative,native_control:enableNative}});
    if(enableNative){await invoke('desktop_show');await page.locator('.composer textarea').focus();}
    const session=await invoke('agent_new',{id:`tools-${provider}`,tabId:`tools-${provider}`,workspace,provider,botId:provider==='codex'?privateBot:null});
    await invoke('agent_send',{id:session.id,prompt:'Run the deterministic Velum tool fixture.',yolo:false});
    let diagnostic;
    for(let n=0;n<800;n++){diagnostic=await invoke('app_diagnostics',{id:session.id,workspace});if(diagnostic.provider_runtime?.turn_status!=='running'&&diagnostic.turn_measurement?.finished)break;await sleep(100);}
    assert.equal(diagnostic.provider_runtime.turn_status,'completed',JSON.stringify(diagnostic.provider_runtime));
    assert.equal(diagnostic.turn_measurement.mcp_initialized,true);assert(diagnostic.turn_measurement.tool_calls>30);assert(diagnostic.turn_measurement.finished);assert(diagnostic.turn_measurement.elapsed_ms>0);
    assert.equal(diagnostic.turn_measurement.counters.output_tokens,125);
    assert.equal(diagnostic.turn_measurement.tokens_per_second,125000/diagnostic.turn_measurement.elapsed_ms);
    const serialized=JSON.stringify(diagnostic);assert(!serialized.includes(process.env.USERPROFILE));assert(!serialized.includes('VELUM_TOOL_TOKEN'));assert(!serialized.includes('tool vault marker'));
    if(enableNative)assert.equal(await page.locator('.composer textarea').inputValue(),'Velum native \u2713');
    outcomes.push({provider,diagnostics:diagnostic});await invoke('agent_destroy',{id:session.id});
  }
  // Observe an actual UI turn using performance.now and attach its previewed
  // report. The provider's 125 tokens are deterministic fixture accounting;
  // elapsed durations and tool results come from the real native application.
  writeFileSync(path.join(workspace,'muse-cleanup.txt'),'remove only this fixture');
  await page.getByRole('button',{name:'Project folder',exact:true}).click();
  await page.getByRole('textbox',{name:'Workspace directory',exact:true}).fill(workspace);
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.locator('.composer textarea:enabled').waitFor();
  await page.locator('.composer textarea').fill('Run the deterministic Velum tool fixture in the UI.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Stop"]')&&document.body.textContent.includes('Velum tool fixture passed'),{},{timeout:90000});
  await page.getByLabel('Project context and diagnostics').click();
  await page.waitForFunction(()=>{try{return JSON.parse(document.querySelector('[aria-label="Velum diagnostics preview"]').value).client_measurement.complete;}catch{return false;}},{},{timeout:15000});
  const clientReport=JSON.parse(await page.getByLabel('Velum diagnostics preview').inputValue());
  assert(clientReport.client_measurement.elapsed_ms>0);assert.equal(clientReport.turn_measurement.counters.output_tokens,125);
  assert.equal(clientReport.client_measurement.client_tokens_per_second,125000/clientReport.client_measurement.elapsed_ms);
  assert.equal(clientReport.client_measurement.displayed_tokens_per_second,125000/clientReport.turn_measurement.elapsed_ms);
  assert(!JSON.stringify(clientReport).includes(process.env.USERPROFILE));
  writeFileSync(path.join(runDir,'client-report.json'),JSON.stringify(clientReport,null,2));
  await page.getByRole('button',{name:'Add to message',exact:true}).click();
  assert((await page.locator('.composer textarea').inputValue()).includes('"client_measurement"'));
  const reports=readFileSync(reportFile,'utf8').trim().split('\n').map(JSON.parse);assert.equal(reports.length,4);
  assert(reports.every(r=>r.initialize&&r.search.matches===220&&r.fullHashRequired&&r.hashGuardedDelete&&r.gitStatus&&r.vaultScope&&r.originRejected&&r.missingAuthRejected));
  assert(reports.every(r=>r.liveMeasurement?.output_tokens===125&&r.liveMeasurement.finished===false));
  assert(reports.every(r=>r.native?.status===(native&&r.provider==='codex'?'passed':'not_requested')));
  if(native)assert(reports.find(r=>r.provider==='codex')?.native?.unicodeInput);
  assert(reports.every(r=>r.browser?.screenshot),'Expected installed Edge/Chrome + Node >=22 browser checks.');
  // Native permission defaults remain off. Actual preview browser screenshots
  // above contain only the fixture page, never the user's everyday browser.
  const disabled=await invoke('agent_tools_configure',{permissions:{...status.permissions,enabled:false}});assert.equal(disabled.permissions.enabled,false);
  writeFileSync(path.join(runDir,'result.json'),JSON.stringify({installed,release,nativeChecks:{requested:native,status:native?'passed':'not_requested'},reports,outcomes,clientReport,attachedWithoutSending:true,disabled:true},null,2));
  assert(existsSync(path.join(workspace,'source-0.txt')));
  console.log('PASS: all three provider launch paths expose real MCP tools, paginated search, hash-guarded deletion, scoped vault search, command-only Git trust, isolated browser actions/screenshots, live provider counters and completed host/client timing.');
  console.log(native?'PASS: native window discovery, Unicode input and screenshot checks.':'Native desktop checks not requested. Run npm run check:tools:native from an unlocked Windows desktop.');
  console.log(`Artifacts: ${runDir}`);
} finally {
  if(invoke)await invoke('desktop_quit').catch(()=>{});await browser?.close().catch(()=>{});
  if(app?.pid)try{execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}
  if(vite?.pid)try{execFileSync('taskkill',['/PID',String(vite.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}
  await new Promise(resolve=>preview.close(resolve));
}
