import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {boot} from './fixture';

test('project picker cancellation and failed access preserve the chat and draft', async({page}) => {
  await boot(page);
  const input=page.locator('.composer textarea');
  await input.fill('Keep this draft');
  await page.getByLabel('Choose project folder').click();
  await expect(page.getByLabel('Workspace directory')).toHaveValue('C:\\QA');
  await page.evaluate(()=>{(window as any).qa.pickedFolder='C:\\denied-project';});
  await page.getByLabel('Choose project folder').click();
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('cannot list');
  await expect(input).toHaveValue('Keep this draft');
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_new').length)).toBe(1);
});

test('diagnostics previews exact sanitized text and attaches without sending', async({page})=>{
  await boot(page);const input=page.locator('.composer textarea');
  await input.fill('My private draft token=do-not-include');
  await page.getByLabel('Project context and diagnostics').click();
  await expect(page.getByLabel('Velum diagnostics preview')).toContainText('not checked');
  expect(await page.getByLabel('Velum diagnostics preview').inputValue()).not.toContain('do-not-include');
  await page.evaluate(()=>{(window as any).qa.readOnlyFolder=true;});
  await page.getByRole('button',{name:'Test file access'}).click();
  await expect(page.getByLabel('Velum diagnostics preview')).toContainText('"write_access": false');
  const report=await page.getByLabel('Velum diagnostics preview').inputValue();
  await page.getByRole('button',{name:'Add to message'}).click();
  await expect(input).toHaveValue('My private draft token=do-not-include\n\n[Velum diagnostics — reference data captured by Velum]\n```json\n'+report+'\n```');
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_send').length)).toBe(0);
});

test('layout preview excludes conversation and input text and supports keyboard focus', async({page})=>{
  await boot(page);await page.locator('.composer textarea').fill('unsent-secret');
  await page.getByLabel('Project context and diagnostics').click();
  await page.getByRole('button',{name:'Chat layout',exact:true}).click();
  const view=JSON.parse(await page.getByLabel('Chat layout snapshot preview').inputValue());
  expect(view.layout.map((r:any)=>r.region)).toContain('composer');
  expect(JSON.stringify(view)).not.toContain('unsent-secret');
  expect(JSON.stringify(view)).not.toContain('C:\\QA');
  expect((await new AxeBuilder({page}).include('.context-panel').analyze()).violations).toEqual([]);
  await page.screenshot({path:test.info().outputPath('context-desktop.png')});
  await page.getByRole('button',{name:'Add to message'}).focus();await page.keyboard.press('Tab');
  await expect(page.getByLabel('Close diagnostics')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.composer textarea')).toHaveValue('unsent-secret');
});

test('blocked provider output remains visible and allows retry',async({page})=>{
  await boot(page);await page.locator('.composer textarea').fill('Inspect project');await page.getByLabel('Send',{exact:true}).click();
  await page.evaluate(()=>{const qa=(window as any).qa;qa.agent({kind:'assistant_delta',text:'Partial result'});qa.agent({kind:'turn_end',status:'blocked',reason:'Antigravity blocked a tool. Review /permissions.'});});
  await expect(page.locator('.msg.assistant')).toContainText('Partial result');
  await expect(page.locator('.notice.error')).toContainText('/permissions');
  await expect(page.getByLabel('Stop',{exact:true})).toHaveCount(0);
  await page.locator('.composer textarea').fill('Retry');await expect(page.getByLabel('Send',{exact:true})).toBeEnabled();
});
