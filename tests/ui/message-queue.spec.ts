import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { boot } from './fixture';
const composer = (page: Page) => page.locator('.chat-wrap:not(.hidden) .composer textarea');
const queue = (page: Page) => page.getByRole('region', { name: 'Message queue' });
async function send(page: Page, text: string) { await composer(page).fill(text); await composer(page).press('Enter'); }
async function finish(page: Page, status = 'completed') {
  await page.evaluate(status => (window as any).qa.agent({kind:'turn_end',status,text:'Finished response'}), status);
}

for (const provider of ['muse', 'codex', 'antigravity']) {
  test(`${provider}: queued messages run in order and reset turn metrics`, async ({ page }) => {
    await boot(page);
    if (provider === 'antigravity') {
      await page.evaluate(() => { (window as any).qa.antigravityInstalled = true; });
      await page.getByRole('button', {name:'Refresh providers and models',exact:true}).click();
    }
    if (provider !== 'muse') await page.getByLabel('AI provider').selectOption(provider);
    await expect(composer(page)).toBeEnabled();
    await send(page, 'First active request');
    await send(page, 'Second pending request');
    await send(page, 'Third pending request');
    await expect(queue(page)).toContainText('2 queued');
    await expect(page.locator('.chat-wrap:not(.hidden) .msg.user')).toHaveCount(1);
    await expect(page.getByRole('button', {name:'Stop',exact:true})).toBeEnabled();
    await expect(page.locator('.model-controls button').first()).toBeDisabled();
    await page.evaluate(() => (window as any).qa.agent({kind:'usage',turn:{output_tokens:120,elapsed_ms:2000}}));
    await finish(page);
    await expect(queue(page)).toContainText('1 queued');
    await expect(page.locator('.chat-wrap:not(.hidden) .msg.user').last()).toContainText('Second pending request');
    await expect(page.locator('.chat-wrap:not(.hidden) .usage-speed')).toHaveText('— tok/s');
    await finish(page);
    await expect(queue(page)).toHaveCount(0);
    await expect(page.locator('.chat-wrap:not(.hidden) .msg.user').last()).toContainText('Third pending request');
    await finish(page);
    await expect(page.locator('.status-text')).toContainText('Done');
    await expect(page.locator('.chat-wrap:not(.hidden) .msg.user')).toHaveCount(3);
    await expect(page.getByLabel('AI provider')).toBeEnabled();
  });
}

test('queue pause, edit, remove, resume and Stop keep pending work reviewable', async ({ page }) => {
  await boot(page); await send(page,'Active work'); await send(page,'Edit me'); await send(page,'Remove me');
  await page.getByRole('button',{name:'Pause queue',exact:true}).click();
  await page.getByRole('button',{name:'Edit queued message 1',exact:true}).click();
  await page.getByRole('textbox',{name:'Edit queued message 1',exact:true}).fill('Edited pending work');
  await page.getByRole('button',{name:'Save queued message',exact:true}).click();
  await page.getByRole('button',{name:'Remove queued message 2',exact:true}).click();
  await finish(page);
  await expect(page.locator('.status-text')).toContainText('Queue paused');
  await expect(queue(page)).toContainText('Edited pending work');
  await expect(page.getByRole('button',{name:'Choose project folder',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Resume queue',exact:true}).click();
  await expect(queue(page)).toHaveCount(0);
  await expect(page.locator('.msg.user').last()).toContainText('Edited pending work');
  await send(page,'Wait after Stop');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(queue(page)).toContainText('Paused');
  await expect(queue(page)).toContainText('Wait after Stop');
  await expect(page.locator('.msg.user')).toHaveCount(2);
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  await expect(queue(page)).toHaveCount(0);
  await expect(page.getByLabel('AI provider')).toBeEnabled();
});

test('failed turn pauses queue and failed enqueue preserves the original and newer draft', async ({ page }) => {
  await boot(page); await send(page,'Active work'); await send(page,'Pending work');
  await finish(page,'failed');
  await expect(queue(page)).toContainText('Paused');
  await page.evaluate(()=>{const qa=(window as any).qa;qa.holdSend=true;});
  await send(page,'Keep original rejected message');
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).qa.releaseSend)).toBe('function');
  await composer(page).fill('Newer draft');
  await page.evaluate(()=>{const qa=(window as any).qa;qa.failSend=true;qa.releaseSend();});
  await expect(page.locator('.notice.error').last()).toContainText('Could not queue');
  await expect(page.locator('.msg.user').last()).toContainText('Not sent');
  await expect(composer(page)).toHaveValue('Newer draft');
  await expect(queue(page)).toContainText('1 queued');
});

test('recovered queue waits for Resume and remains accessible at compact desktop sizes', async ({ page }) => {
  await page.addInitScript(()=>{(window as any).qaAgentRestore=[{kind:'queue_state',running:false,queue:{items:[{id:'11111111-1111-4111-8111-111111111111',prompt:'Recovered pending work',yolo:false,remote:true}],paused:true,reason:'Review the recovered messages, then resume the queue.'}}];});
  await boot(page);
  await expect(queue(page)).toContainText('Recovered pending work');
  await expect(queue(page)).toContainText('From phone');
  await expect(page.locator('.msg.user')).toHaveCount(0);
  await page.setViewportSize({width:760,height:600});
  await expect(composer(page)).toBeInViewport();
  expect(await queue(page).evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.message-queue').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:'.qa/message-queue-desktop.png',animations:'disabled'});
  await page.getByRole('button',{name:'Resume queue',exact:true}).click();
  await expect(page.locator('.msg.user')).toContainText('Recovered pending work');
});

test('rapid Enter cannot duplicate an active submission or a queued follow-up', async ({ page }) => {
  await boot(page);
  for(const message of ['First','Queued second']) {
    await composer(page).fill(message);
    await composer(page).evaluate(element=>{
      element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    });
  }
  await expect(queue(page)).toContainText('1 queued');
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_send').length)).toBe(2);
});
