import { test, expect } from '@playwright/test';
import { ClientMeasurement, type HostMeasurement } from '../../src/turnMeasurement';
import { boot } from './fixture';

const measured: HostMeasurement = {run_id:'run-1',provider:'muse',started_at_ms:1000,elapsed_ms:2500,first_event_ms:10,first_output_ms:400,finished:true,counters:{input_tokens:200,cached_input_tokens:0,output_tokens:125,reasoning_output_tokens:20,elapsed_ms:2500},counter_source:'provider records',host_clock:'Rust Instant',tokenizer:'not used',mcp_initialized:true,tool_calls:3,tool_errors:0};

test('client timing is independent, monotonic, run-bound and absent on replay', () => {
  const client=new ClientMeasurement();client.start(false,100);client.observe(measured);client.finish(2600);
  const report=client.report(measured,3000);expect(report.elapsed_ms).toBe(2500);expect(report.client_tokens_per_second).toBe(50);expect(report.displayed_tokens_per_second).toBe(50);expect(report.complete).toBe(true);
  expect(client.report({...measured,run_id:'run-2'}).elapsed_ms).toBeNull();
  client.start(true,100);client.observe(measured);client.finish(2600);expect(client.report(measured).elapsed_ms).toBeNull();expect(client.report(measured).client_tokens_per_second).toBeNull();
  client.start(false,100);client.observe({...measured,finished:false});expect(client.report({...measured,finished:false},1100).elapsed_ms).toBe(1000);expect(client.report({...measured,finished:false},1100).complete).toBe(false);
  client.reset();expect(client.report(measured).elapsed_ms).toBeNull();
});

test('agent tools expose separate desktop switches and save the requested permissions', async({page})=>{
  await boot(page);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Preferences',exact:false}).click();
  await expect(page.getByRole('switch',{name:'Desktop screenshots',exact:true})).toHaveAttribute('aria-checked','false');
  await expect(page.getByRole('switch',{name:'Control Windows apps',exact:true})).toHaveAttribute('aria-checked','false');
  await page.getByRole('switch',{name:'Desktop screenshots',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Desktop screenshots',exact:true})).toHaveAttribute('aria-checked','true');
  const call=await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_tools_configure').at(-1));
  expect(call.args.permissions.native_screenshot).toBe(true);expect(call.args.permissions.native_control).toBe(false);
  await page.getByRole('switch',{name:'Connect Velum tools',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Control Windows apps',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Remove Muse registration',exact:true}).click();
  await expect(page.getByRole('button',{name:'Remove Muse registration',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_tools_disconnect').at(-1).args.provider)).toBe('muse');
});

test('a diagnostics attachment includes host counts and the observed client duration without sending',async({page})=>{
  await boot(page);
  await page.evaluate(value=>{const q=(window as any).qa;q.measurement=value;const emit=(e:any)=>q.agent(e,q.calls.filter((c:any)=>c.cmd==='agent_new').at(-1).args.id);emit({kind:'turn_start',prompt:'Measure'});emit({kind:'turn_metrics',measurement:value});emit({kind:'usage',turn:value.counters});emit({kind:'turn_end',status:'completed'});},measured);
  await page.getByLabel('Project context and diagnostics').click();
  await expect(page.getByLabel('Velum diagnostics preview')).toContainText('\"turn_measurement\"');
  const value=await page.getByLabel('Velum diagnostics preview').inputValue();const report=JSON.parse(value);
  expect(report.turn_measurement.counters.output_tokens).toBe(125);expect(report.client_measurement.elapsed_ms).toBeGreaterThanOrEqual(0);expect(report.client_measurement.displayed_tokens_per_second).toBe(50);
  await page.getByRole('button',{name:'Add to message'}).click();expect(await page.locator('.composer textarea').inputValue()).toContain('"client_measurement"');
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_send').length)).toBe(0);
});

test('diagnostics distinguish awaiting counts from a completed unreported turn',async({page})=>{
  await boot(page);
  await page.evaluate(value=>{(window as any).qa.measurement=value;},{...measured,finished:false,counters:null,counter_source:'not reported'});
  await page.getByLabel('Project context and diagnostics').click();
  const panel=page.getByRole('dialog',{name:'Know what’s connected.'});
  await expect(panel).toContainText('Running turn');
  await expect(panel).toContainText('Awaiting provider output token counts');
  await page.evaluate(value=>{(window as any).qa.measurement=value;},{...measured,counters:null,counter_source:'not reported'});
  await page.getByRole('button',{name:'Refresh report'}).click();
  await expect(panel).toContainText('Completed turn');
  await expect(panel).toContainText('The provider did not report output token counts for this turn.');
  await expect(panel).not.toContainText('Awaiting provider output token counts');
});
