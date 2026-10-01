// Drives the real MCP stdio adapter and host bridge without provider accounts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const {randomUUID}=require('node:crypto');const {createInterface}=require('node:readline');
const provider=process.argv[2];const argv=process.argv.slice(3);
if (!argv.includes('exec') && !argv.includes('--input-format')) {
  if(provider==='muse') {process.argv.splice(2,1);require('./muse-cli.cjs');}
  else require('./provider-cli.cjs');
} else {
  let child;
  const emit=value=>console.log(JSON.stringify(value));
  const run=async()=>{
    const input=provider==='muse' ? fs.readFileSync(argv[argv.indexOf('--prompt-file')+1],'utf8') : fs.readFileSync(0,'utf8');
    const session=provider==='muse'?argv[argv.indexOf('--session-id')+1]:'bc466cb2-a79a-47c0-9309-46d65eb75608';const runId=randomUUID();
    if(provider==='muse')emit({stream:{kind:'session',id:session},payload_type:'run.lifecycle.started',payload:{command_id:runId,run_stream:{kind:'run',id:runId}}});
    if(provider==='codex')emit({type:'thread.started',thread_id:session});
    if(provider==='antigravity')emit({event:'init',conversation_id:session});
    const credentials={url:process.env.VELUM_TOOL_URL,token:process.env.VELUM_TOOL_TOKEN};
    assert(credentials.url&&credentials.token,'Turn credentials absent');
    child=spawn(process.env.VELUM_QA_APP,['--velum-tool-stdio'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let serial=0;const pending=new Map();
    createInterface({input:child.stdout}).on('line',line=>{const response=JSON.parse(line),job=pending.get(response.id);if(job){pending.delete(response.id);response.error?job.reject(Error(response.error.message)):job.resolve(response.result);}});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk.toString());
    child.on('exit',()=>{for(const job of pending.values())job.reject(Error('Adapter exited: '+errors));});
    const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
    const call=async(name,args={})=>{const response=await rpc('tools/call',{name,arguments:args});if(response.isError)throw Error(response.content[0].text);const content=response.content[0];return content.type==='image'?content:JSON.parse(content.text);};
    const init=await rpc('initialize',{protocolVersion:'2025-06-18',clientInfo:{name:'Velum fixture',version:'1'},capabilities:{}});assert.equal(init.protocolVersion,'2025-06-18');
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const names=(await rpc('tools/list')).tools.map(t=>t.name);
    for(const name of ['inspect_file','delete_file','workspace_search','vault_search','git_status','turn_diagnostics'])assert(names.includes(name));
    if(provider!=='codex'){assert(!names.includes('native_input'));assert(!names.includes('native_screenshot'));}
    const report={provider,initialize:true,names};
    let page=await call('workspace_search',{query:'needle',mode:'text',limit:7}),matches=[...page.matches],pages=1;
    while(page.next_cursor){page=await call('workspace_search',{query:'needle',cursor:page.next_cursor,limit:7});matches.push(...page.matches);pages++;assert(pages<100);}
    assert.equal(matches.length,220);assert(matches.every(m=>!m.path.includes('node_modules')&&!m.path.includes('.preview')));report.search={matches:matches.length,pages,skipped:page.skipped_entries};
    const filename=provider+'-cleanup.txt';const inspected=await call('inspect_file',{path:filename});
    const malformed=await rpc('tools/call',{name:'delete_file',arguments:{path:filename,expected_sha256:inspected.sha256.slice(0,41)}});
    assert.equal(malformed.isError,true);assert(malformed.content[0].text.includes('received 41 characters'));assert(fs.existsSync(path.join(process.cwd(),filename)));report.fullHashRequired=true;
    const rejected=await rpc('tools/call',{name:'delete_file',arguments:{path:filename,expected_sha256:'0'.repeat(64)}});assert.equal(rejected.isError,true);
    const deleted=await call('delete_file',{path:filename,expected_sha256:inspected.sha256});assert(deleted.deleted);assert(!fs.existsSync(path.join(process.cwd(),filename)));report.hashGuardedDelete=true;
    for(const file of ['../outside.txt','.git/config']){const value=await rpc('tools/call',{name:'inspect_file',arguments:{path:file}});assert.equal(value.isError,true);}
    const git=await call('git_status');assert.equal(git.global_config_changed,false);report.gitStatus=true;
    const vault=await call('vault_search',{query:'tool vault marker',limit:8});
    assert(vault.notes.some(n=>n.title===(provider==='codex'?'Private active note':'Visible active note')));
    assert(!vault.notes.some(n=>['Pending note','Other project note','Other bot private note',provider==='codex'?'Visible active note':'Private active note'].includes(n.title)));
    report.vaultScope=true;report.sharedOptInRespected=provider==='codex';
    const measured=await call('turn_diagnostics');assert(measured.elapsed_ms>=0);assert(measured.mcp_initialized);assert(measured.host_clock.includes('Rust Instant'));report.hostTiming=true;
    assert.equal(measured.finished,false);assert.equal(measured.counters,null);assert.equal(measured.tokens_per_second,null);
    // A completed model call can report counts while the provider process is
    // still working. Host diagnostics and UI must use that same live snapshot.
    if(provider==='muse') {
      assert(process.env.XDG_DATA_HOME,'Fixture provider storage must be isolated');
      const dir=path.join(process.env.XDG_DATA_HOME,'muse/sessions/2026/09/30',session);fs.mkdirSync(dir,{recursive:true});
      fs.appendFileSync(path.join(dir,'session.jsonl'),JSON.stringify({schema_version:1,id:randomUUID(),stream:{kind:'session',id:session},payload_type:'runtime.session',payload:{run_id:runId,event:{kind:'model_completed',usage:{input_tokens:100,cached_tokens:0,output_tokens:125,reasoning_tokens:0}}}})+'\n');
    } else if(provider==='codex') {
      assert(process.env.CODEX_HOME,'Fixture provider storage must be isolated');
      const dir=path.join(process.env.CODEX_HOME,'sessions/2026/09/30');fs.mkdirSync(dir,{recursive:true});
      fs.appendFileSync(path.join(dir,'rollout-'+session+'.jsonl'),JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'token_count',info:{model_context_window:1000,last_token_usage:{input_tokens:100,output_tokens:125,total_tokens:225},total_token_usage:{input_tokens:100,cached_input_tokens:0,output_tokens:125,reasoning_output_tokens:0}}}})+'\n');
    } else {
      emit({event:'step_update',step_update:{step_index:8,step_type:'agent_response',state:'RUNNING',usage:{input_tokens:100,output_tokens:125,cache_read_tokens:0,thinking_tokens:0}}});
    }
    let live;
    for(let attempt=0;attempt<50;attempt++) {
      live=await call('turn_diagnostics');
      if(live.counters?.output_tokens===125)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(live.counters?.output_tokens,125,'Live provider counts did not reach host diagnostics');
    assert.equal(live.finished,false,'Model usage must not finish the provider turn');
    assert.equal(live.tokens_per_second,125000/live.elapsed_ms);
    assert.notEqual(live.counter_source,'not reported');
    report.liveMeasurement={elapsed_ms:live.elapsed_ms,output_tokens:live.counters.output_tokens,tokens_per_second:live.tokens_per_second,counter_source:live.counter_source,finished:live.finished};
    if(names.includes('browser_open')) {
      const tab=await call('browser_open',{url:process.env.VELUM_QA_PREVIEW});let snapshot;
      for(let n=0;n<30;n++){snapshot=await call('browser_snapshot',{tab_id:tab.tab_id});if(JSON.stringify(snapshot).includes('Tool preview fixture'))break;await new Promise(r=>setTimeout(r,50));}
      assert(JSON.stringify(snapshot).includes('Tool preview fixture'));
      await call('browser_action',{tab_id:tab.tab_id,action:'fill',selector:'#name',text:'Velum test'});
      await call('browser_action',{tab_id:tab.tab_id,action:'click',selector:'#apply'});
      const value=await call('browser_action',{tab_id:tab.tab_id,action:'evaluate',expression:'document.querySelector("#result").textContent'});assert.equal(JSON.parse(value.result),'Velum test');
      const screenshot=await call('browser_screenshot',{tab_id:tab.tab_id});assert.equal(screenshot.mimeType,'image/png');assert(Buffer.from(screenshot.data,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));report.browser={navigation:true,fill:true,click:true,evaluate:true,screenshot:true};
    }
    if(provider==='codex') {
      assert(names.includes('native_input'));assert(names.includes('native_screenshot'));
      const windows=await call('native_windows');const target=windows.windows.find(w=>w.title===process.env.VELUM_QA_NATIVE_TITLE);assert(target,'The isolated native test window is unavailable');
      await call('native_input',{window_id:target.window_id,action:'type',text:'Velum native \u2713'});
      const screenshot=await call('native_screenshot',{window_id:target.window_id});assert.equal(screenshot.mimeType,'image/png');assert(Buffer.from(screenshot.data,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));report.native={windowDiscovery:true,unicodeInput:true,screenshot:true};
    }
    // A browser-origin request must not reach the authenticated local bridge.
    const cross=await fetch(credentials.url,{method:'POST',headers:{authorization:'Bearer '+credentials.token,'content-type':'application/json',origin:'https://untrusted.invalid'},body:JSON.stringify({id:1,method:'tools/list'})});assert.equal(cross.status,403);report.originRejected=true;
    const unauth=await fetch(credentials.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:1,method:'tools/list'})});assert.equal(unauth.status,401);report.missingAuthRejected=true;
    // Credentials never enter the report, stdout, tool result or saved log.
    fs.appendFileSync(process.env.VELUM_QA_TOOL_REPORT,JSON.stringify(report)+'\n');
    child.stdin.end();await new Promise(resolve=>child.on('exit',resolve));
    if(provider==='codex') {emit({type:'item.completed',item:{id:'answer',type:'agent_message',text:'Velum tool fixture passed'}});emit({type:'turn.completed',usage:{input_tokens:100,output_tokens:125,cached_input_tokens:0,reasoning_output_tokens:0}});}
    else if(provider==='antigravity') {emit({event:'step_update',step_update:{step_index:8,step_type:'agent_response',state:'DONE',text_delta:'Velum tool fixture passed',usage:{input_tokens:100,output_tokens:125,cache_read_tokens:0,thinking_tokens:0}}});emit({event:'result',result:{status:'SUCCESS',response:'Velum tool fixture passed'}});}
    else {emit({payload_type:'run.output.delta',payload:{text:'Velum tool fixture passed'}});emit({payload_type:'run.terminal.completed',payload:{terminal:'completed',text:'Velum tool fixture passed'}});}
  };
  run().catch(error=>{console.error('Velum tool fixture failed: '+error.message);child?.kill();process.exitCode=1;});
}
