import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {boot, pickProvider, revealAssistant} from './fixture';
const composer=(page:Page)=>page.locator('.chat-wrap:not(.hidden) .composer textarea');
async function answer(page:Page){
  await composer(page).fill('Refine the project navigation.');await composer(page).press('Enter');
  await page.evaluate(()=>{const q=(window as any).qa;q.agent({kind:'assistant_delta',text:'## Proposed changes\n\nI changed the navigation and the entire page layout.'});q.agent({kind:'turn_end',status:'completed'});});
  await expect(page.getByRole('button',{name:'Correct response',exact:true})).toBeVisible();
}
test('focused defaults show the task while assistant and project details stay reachable',async({page})=>{
  await boot(page,0,false);
  await expect(page.getByRole('button',{name:'Assistant settings',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(page.getByLabel('AI provider')).toBeHidden();
  await expect(page.getByLabel('Workspace directory')).toBeHidden();
  await expect(composer(page)).toBeFocused();
  await expect(page.locator('.assistant-summary')).toContainText('Deep model');
  await page.getByRole('button',{name:'Assistant settings',exact:true}).click();
  await expect(page.getByLabel('AI provider')).toBeVisible();
  await page.getByRole('button',{name:'Assistant settings',exact:true}).click();
  await page.getByRole('button',{name:'Project folder',exact:true}).click();
  await expect(page.getByLabel('Workspace directory')).toBeVisible();
  await page.getByRole('button',{name:'Project folder',exact:true}).click();
  await expect(page.getByLabel('Workspace directory')).toBeHidden();
  for(const [width,height] of [[1200,800],[760,560]]){
    await page.setViewportSize({width,height});await expect(composer(page)).toBeInViewport();
    await expect(page.getByRole('button',{name:'Build something',exact:false})).toBeInViewport();
    expect(await page.locator('.conversation-pane').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
  await page.setViewportSize({width:1200,height:800});
  await page.screenshot({path:'.qa/focus-ux-empty.png',animations:'disabled'});
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
test('starters prepare an editable request and preserve a draft without starting work',async({page})=>{
  await boot(page,0,false);await composer(page).fill('My original idea');
  await page.getByRole('button',{name:/Build something/}).click();
  await expect(composer(page)).toHaveValue(/My original idea\n\nHelp me build/);
  await expect(composer(page)).toBeFocused();
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_send'))).toHaveLength(0);
});
test('activity groups keep results quiet while failures remain visible and inspectable',async({page})=>{
  await boot(page,0,false);await composer(page).fill('Inspect the project');await composer(page).press('Enter');
  await page.evaluate(()=>{const q=(window as any).qa;for(const task of ['one','two']){q.agent({kind:'tool_start',task_id:task,name:'read_file'});q.agent({kind:'tool_output',task_id:task,text:'Detailed tool output'});q.agent({kind:'tool_end',task_id:task,status:'completed'});}q.agent({kind:'tool_start',task_id:'bad',name:'write_file'});q.agent({kind:'tool_end',task_id:'bad',status:'blocked',reason:'The provider blocked this edit.'});});
  const group=page.getByRole('region',{name:'Agent activity'});await expect(group).toHaveCount(1);
  await expect(group).toContainText('An action needs attention');await expect(page.locator('.tool-card')).toHaveCount(0);
  await group.getByRole('button').first().click();await expect(page.locator('.tool-card')).toHaveCount(3);
  await expect(group).toContainText('The provider blocked this edit.');
});
test('corrections preserve the composer draft and only save a lesson after review',async({page})=>{
  await boot(page,0,false);await answer(page);await composer(page).fill('My next idea is still a draft.');
  await page.getByRole('button',{name:'Correct response',exact:true}).click();
  await expect(page.getByLabel('What should change?',{exact:true})).toBeFocused();
  await page.getByLabel('What should change?',{exact:true}).fill('Keep the existing layout and change only the navigation.');
  await page.getByRole('checkbox',{name:'Remember a lesson for this project',exact:true}).check();
  await page.getByLabel('Lesson for next time',{exact:true}).fill('Before editing the UI, preserve everything outside the requested scope.');
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.args?.request?.action==='save_lesson'))).toHaveLength(0);
  await page.screenshot({path:'.qa/focus-ux-correction.png',animations:'disabled'});
  expect((await new AxeBuilder({page}).include('.correction-composer').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Send & save lesson',exact:true}).click();
  await expect(page.getByRole('region',{name:'Correct this response'})).toContainText('Lesson saved');
  await expect(composer(page)).toHaveValue('My next idea is still a draft.');
  const recorded=await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_send').at(-1).args.prompt);
  expect(recorded).toContain('this earlier response');expect(recorded).toContain('change only the navigation');
  const note=await page.evaluate(()=>(window as any).qa.memory.notes[0]);
  expect(note.body).toBe('Before editing the UI, preserve everything outside the requested scope.');expect(note.scope).toBe('project');expect(note.pinned).toBe(true);
});
test('failed lesson saves retry the save without sending the correction twice',async({page})=>{
  await boot(page,0,false);await answer(page);await page.getByRole('button',{name:'Correct response',exact:true}).click();
  await page.getByLabel('What should change?',{exact:true}).fill('Keep the existing public API.');
  await page.getByRole('checkbox',{name:'Remember a lesson for this project',exact:true}).check();
  await page.evaluate(()=>{(window as any).qa.memoryConflict=true;});
  await page.getByRole('button',{name:'Send & save lesson',exact:true}).click();
  await expect(page.locator('.correction-error')).toContainText('Correction sent');
  await page.evaluate(()=>{(window as any).qa.memoryConflict=false;});
  await page.getByRole('button',{name:'Retry saving lesson',exact:true}).click();
  await expect(page.getByRole('region',{name:'Correct this response'})).toContainText('Lesson saved');
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.cmd==='agent_send').length)).toBe(2);
});
test('failed corrections retain their edit and never save an unsent lesson',async({page})=>{
  await boot(page,0,false);await answer(page);await composer(page).fill('Keep this newer draft');
  await page.getByRole('button',{name:'Correct response',exact:true}).click();await page.getByLabel('What should change?',{exact:true}).fill('Correct the output counter.');
  await page.getByRole('checkbox',{name:'Remember a lesson for this project',exact:true}).check();
  await page.evaluate(()=>{(window as any).qa.failSend=true;});
  await page.getByRole('button',{name:'Send & save lesson',exact:true}).click();
  await expect(page.getByLabel('What should change?',{exact:true})).toHaveValue('Correct the output counter.');
  await expect(composer(page)).toHaveValue('Keep this newer draft');
  expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.args?.request?.action==='save_lesson'))).toHaveLength(0);
});
test('pending guidance is discoverable and opens directly in Review',async({page})=>{
  await boot(page,0,false);
  await page.evaluate(()=>{const q=(window as any).qa;q.memory.notes=[{id:'pending',revision:'r1',title:'Respect requested scope',body:'Keep unrelated UI unchanged.',tags:['lesson'],scope:'project',status:'pending',pinned:false,source:'Muse conversation',created_at:1,updated_at:1}];q.emit('memory-changed',{});});
  await expect(page.getByLabel('1 suggestions to review')).toBeVisible();
  await page.getByRole('button',{name:'Memory',exact:true}).click();
  await expect(page.getByRole('button',{name:/^Review/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.memory-list')).toContainText('Respect requested scope');
});
test('a long Unicode correction gets a valid title and respects disabled memory',async({page})=>{
  await boot(page,0,false);await answer(page);await page.getByRole('button',{name:'Correct response',exact:true}).click();
  await page.getByLabel('What should change?',{exact:true}).fill('🙂'.repeat(100)+' Keep the original layout.');
  await page.getByRole('checkbox',{name:'Remember a lesson for this project',exact:true}).check();
  await page.evaluate(()=>{(window as any).qa.memory.settings.enabled=false;});
  await page.getByRole('button',{name:'Send & save lesson',exact:true}).click();
  await expect(page.getByRole('region',{name:'Correct this response'})).toContainText('Memory is off');
  const title=await page.evaluate(()=>(window as any).qa.calls.find((c:any)=>c.args?.request?.action==='save_lesson').args.request.title);
  expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(160);
  await expect(page.getByRole('button',{name:'Project folder',exact:true})).toHaveAttribute('aria-expanded','false');
});

for (const provider of ['muse','codex','antigravity']) {
  test(`${provider}: a correction joins active work without replacing the next draft`,async({page})=>{
    await boot(page,0,false);
    if(provider==='antigravity') {
      await page.evaluate(()=>{(window as any).qa.antigravityInstalled=true;});
      await revealAssistant(page);
      await page.getByRole('button',{name:'Refresh providers and models',exact:true}).click();
    }
    if(provider!=='muse') await pickProvider(page,provider);
    await answer(page);
    await composer(page).fill('Continue working');await composer(page).press('Enter');
    await composer(page).fill('My next thought stays here');
    await page.getByRole('button',{name:'Correct response',exact:true}).last().click();
    await page.getByLabel('What should change?',{exact:true}).fill('Keep the existing public API.');
    await page.getByRole('button',{name:'Queue correction',exact:true}).click();
    await expect(page.getByRole('region',{name:'Message queue'})).toContainText('Keep the existing public API.');
    await expect(composer(page)).toHaveValue('My next thought stays here');
    await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();
    expect(await page.evaluate(()=>(window as any).qa.calls.filter((c:any)=>c.args?.request?.action==='save_lesson'))).toHaveLength(0);
  });
}

test('the focused experience supports light glass and adjustable activity defaults',async({page})=>{
  await boot(page,0,false);await answer(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Daylight theme',exact:true}).click();
  await page.getByRole('tab',{name:'Glass & finish',exact:true}).click();
  await page.getByRole('button',{name:'Crystal',exact:true}).click();
  await page.getByRole('tab',{name:'Preferences',exact:true}).click();
  await page.getByRole('switch',{name:'Compact assistant controls',exact:true}).click();
  await page.getByRole('switch',{name:'Group agent activity',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Assistant settings',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('AI provider')).toBeVisible();
  await composer(page).fill('Check the project');await composer(page).press('Enter');
  await page.evaluate(()=>{const q=(window as any).qa;q.agent({kind:'tool_start',task_id:'check',name:'read_file'});q.agent({kind:'tool_end',task_id:'check',status:'completed'});q.agent({kind:'turn_end',status:'completed',text:'Done'});});
  await expect(page.locator('.tool-card')).toHaveCount(1);await expect(page.locator('.agent-activity')).toHaveCount(0);
  await page.getByRole('button',{name:'Correct response',exact:true}).last().click();
  await page.getByLabel('What should change?',{exact:true}).fill('Keep the changes within the requested scope.');
  await page.getByRole('checkbox',{name:'Remember a lesson for this project',exact:true}).check();
  await page.setViewportSize({width:760,height:480});
  await page.getByRole('button',{name:'Send & save lesson',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'Send & save lesson',exact:true})).toBeInViewport();
  expect(await page.locator('.chat-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({width:1200,height:800});
  await page.locator('.correction-composer').screenshot({path:'.qa/focus-ux-light-correction.png',animations:'disabled'});
});
