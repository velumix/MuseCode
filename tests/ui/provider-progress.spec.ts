import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixture';
import { progressMessage } from '../../src/providerProgress';
const composer = (page: Page) => page.locator('.chat-wrap:not(.hidden) textarea');
test('provider status names match the selected provider',()=>{
  const progress={phase:'retrying' as const,checked_at_ms:0,retry_at_ms:null,attempt:null,max_attempts:null,http_status:429};
  expect(progressMessage(progress,'codex')).toContain('Codex service is rate limited');
  expect(progressMessage({...progress,phase:'connecting'},'antigravity')).toBe('Connecting to Antigravity…');
  expect(progressMessage({...progress,http_status:null})).toBe('Muse is retrying the connection');
});

test('response and tool activity clear retry warnings as soon as recovery is observed',async({page})=>{
  await boot(page);await composer(page).fill('Recovery test');await composer(page).press('Enter');
  for(const event of [{kind:'assistant_delta',text:'Recovered answer'},{kind:'tool_start',task_id:'shell',name:'Shell'}]){
    await page.evaluate(()=> (window as any).qa.agent({kind:'provider_progress',progress:{phase:'retrying',checked_at_ms:Date.now(),retry_at_ms:Date.now()+60000,attempt:2,max_attempts:10,http_status:503}}));
    await expect(page.locator('.provider-wait')).toContainText('503');
    await page.evaluate(event=>(window as any).qa.agent(event),event);
    await expect(page.locator('.provider-wait')).toHaveCount(0);
    await expect(page.locator('.chat-running')).toContainText(event.kind==='tool_start'?'Running Shell':'Responding');
    await expect(page.locator('.status-text')).not.toContainText('503');
  }
});

test('Muse service retries show status, countdown and recovery without blocking Stop', async ({ page }) => {
  await boot(page);
  await page.clock.install({ time: new Date('2026-09-29T20:00:00Z') });
  await composer(page).fill('Retry fixture'); await composer(page).press('Enter');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).qa.agent({ kind: 'provider_progress', progress: {
    phase: 'retrying', checked_at_ms: Date.now(), retry_at_ms: Date.now() + 60_000,
    attempt: 2, max_attempts: 10, http_status: 503,
  } }));
  await expect(page.locator('.provider-wait')).toContainText('temporarily unavailable (HTTP 503)');
  await expect(page.locator('.provider-wait')).toContainText('Retrying in 60s');
  await expect(page.locator('.provider-wait')).toContainText('attempt 2/10');
  await page.clock.fastForward(10_000);
  await expect(page.locator('.provider-wait')).toContainText('Retrying in 50s');
  await page.setViewportSize({ width: 760, height: 600 });
  expect(await page.locator('.chat-running').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: '.qa/provider-retry-desktop.png' });
  await page.evaluate(() => (window as any).qa.agent({ kind: 'provider_progress', progress: {
    phase: 'connecting', checked_at_ms: Date.now(), retry_at_ms: null, attempt: 2, max_attempts: 10, http_status: null,
  } }));
  await expect(page.locator('.provider-wait')).toHaveCount(0);
  await expect(page.locator('.chat-running')).toContainText('Connecting to Muse');
  await page.evaluate(() => (window as any).qa.agent({ kind: 'turn_end', status: 'completed', text: 'Recovered' }));
  await expect(page.locator('.chat-running')).toHaveCount(0);
  await expect(page.locator('.msg.assistant')).toContainText('Recovered');
});

test('stopping a rate limited Muse turn clears its countdown and preserves the next draft', async ({ page }) => {
  await boot(page);
  await composer(page).fill('Rate limit fixture'); await composer(page).press('Enter');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).qa.agent({ kind: 'provider_progress', progress: {
    phase: 'retrying', checked_at_ms: Date.now(), retry_at_ms: Date.now() - 1000,
    attempt: 3, max_attempts: 10, http_status: 429,
  } }));
  await expect(page.locator('.provider-wait')).toContainText('rate limited (HTTP 429)');
  await expect(page.locator('.provider-wait')).toContainText('Waiting for retry');
  await composer(page).fill('Keep this draft');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('.provider-wait')).toHaveCount(0);
  await expect(composer(page)).toHaveValue('Keep this draft');
  await composer(page).press('Enter');
  await expect(page.locator('.chat-running')).not.toContainText('429');
});
