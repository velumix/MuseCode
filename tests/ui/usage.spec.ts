import { test, expect } from '@playwright/test';
import { mergeUsage, tokenRate } from '../../src/usage';
import { transcript } from '../../src/remote/transcript';
import { boot } from './fixture';

test('usage accepts numeric provider data and rejects invalid counters', () => {
  expect(mergeUsage({}, { context: { used_tokens: -2, window_tokens: 100, measured_at: 10 } })).toEqual({});
  const usage = mergeUsage({}, { context: { used_tokens: 100, window_tokens: 0, measured_at: 10 }, turn: { output_tokens: 120, elapsed_ms: 2000, input_tokens: Number.MAX_SAFE_INTEGER + 1 } });
  expect(usage.context?.window_tokens).toBeNull();
  expect(usage.turn?.input_tokens).toBeNull();
  expect(tokenRate(usage.turn)).toBe(60);
  expect(tokenRate({ ...usage.turn!, elapsed_ms: 0 })).toBeNull();
  expect(tokenRate({ ...usage.turn!, output_tokens: null })).toBeNull();
  expect(tokenRate(usage.turn, 4000)).toBe(30);
  expect(tokenRate({...usage.turn!,output_tokens:NaN})).toBeNull();
  expect(tokenRate(usage.turn,Infinity)).toBeNull();
  const estimated = mergeUsage({}, { context: { used_tokens: 27299, window_tokens: null, measured_at: 10, estimated: true } });
  expect(estimated.context).toMatchObject({ used_tokens: 27299, window_tokens: null, estimated: true });
  expect(mergeUsage(estimated, { turn: { output_tokens: 5, elapsed_ms: 1000 } }).context?.estimated).toBe(true);
  expect(mergeUsage({}, { context: { used_tokens: 50, window_tokens: 100, measured_at: 10 } }).context?.estimated).toBe(false);
});

test('phone event fold preserves context between turns and discards stale memory and reset counters', () => {
  const events = [
    { seq: 1, event: { kind: 'usage', context: { used_tokens: 50, window_tokens: 100, measured_at: 10 }, turn: { output_tokens: 4, elapsed_ms: 1000 } } },
    { seq: 2, event: { kind: 'memory_context', titles: ['Old note'], bytes: 200 } },
    { seq: 3, event: { kind: 'turn_start', prompt: 'Next' } },
  ];
  const view = transcript(events);
  expect(view.usage.context?.used_tokens).toBe(50);
  expect(view.usage.turn).toBeNull();
  expect(view.memory).toBeNull();
  expect(transcript([...events, { seq: 4, event: { kind: 'usage_reset' } }]).usage).toEqual({});
});

test('desktop context ring, rate, details and reset follow provider events', async ({ page }) => {
  await boot(page);
  const input = page.locator('.chat-wrap:not(.hidden) textarea');
  await input.fill('Usage test');
  await input.press('Enter');
  await page.evaluate(() => {
    const qa = (window as any).qa;
    qa.agent({ kind: 'usage', context: { used_tokens: 95000, window_tokens: 100000, measured_at: Date.now() }, turn: { input_tokens: 1200, cached_input_tokens: 200, output_tokens: 120, reasoning_output_tokens: 20, elapsed_ms: 2000 } });
    qa.agent({ kind: 'memory_context', titles: ['Project preference'], bytes: 288 });
    qa.agent({ kind: 'turn_end', status: 'completed' });
  });
  await expect(page.locator('.usage-context')).toContainText('95%');
  await expect(page.locator('.usage-context')).toHaveClass(/critical/);
  await expect(page.locator('.usage-speed')).toContainText('60 tok/s');
  await page.locator('.usage-summary').click();
  await expect(page.locator('.usage-details')).toContainText('95,000 / 100,000');
  await expect(page.locator('.usage-details')).toContainText('Project preference');
  await page.keyboard.press('Escape');
  await expect(page.locator('.usage-summary')).toBeFocused();
  await page.evaluate(() => (window as any).qa.agent({ kind: 'usage_reset' }));
  await expect(page.locator('.usage-context')).toHaveClass(/unknown/);
  await expect(page.locator('.usage-speed')).toHaveText('— tok/s');
  await expect(page.locator('.usage-memory')).not.toContainText('Memory');
});

test('estimated muse context shows a labeled estimate and never a percentage', async ({ page }) => {
  await boot(page);
  const input = page.locator('.chat-wrap:not(.hidden) textarea');
  await input.fill('Estimate test');
  await input.press('Enter');
  await page.evaluate(() => {
    (window as any).qa.agent({ kind: 'usage', context: { used_tokens: 27299, window_tokens: null, measured_at: Date.now(), estimated: true }, turn: null });
  });
  await expect(page.locator('.usage-context')).toContainText('est.');
  await expect(page.locator('.usage-context')).toHaveClass(/unknown/);
  await page.locator('.usage-summary').click();
  await expect(page.locator('.usage-details')).toContainText('No capacity figure is reported');
});
