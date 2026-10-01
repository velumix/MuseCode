// Runs with Node >=22. Receives one JSON request on stdin. This browser is
// owned by Velum, never an attachment to the user's everyday browser.
const fs = require('node:fs');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const { endpoint, tool, args } = request;
const parsed = new URL(endpoint);
if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw Error('Invalid preview endpoint.');
let socket;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 18000);
const read = async path => {
  const response = await fetch(endpoint + path, { signal: controller.signal });
  if (!response.ok) throw Error('Preview browser did not respond.');
  return response.json();
};
async function connect(url) {
  const wsUrl = new URL(url);
  if (wsUrl.hostname !== '127.0.0.1' || wsUrl.port !== parsed.port || wsUrl.protocol !== 'ws:') throw Error('Invalid preview socket.');
  socket = new WebSocket(url);
  const pending = new Map(); let id = 0;
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    const job = pending.get(value.id);
    if (job) { pending.delete(value.id); value.error ? job.reject(Error(value.error.message)) : job.resolve(value.result); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('Preview connection failed.')), { once: true }); });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params }));
  });
}
async function main() {
  if (tool === 'browser_close') {
    const version = await read('/json/version'); const cdp = await connect(version.webSocketDebuggerUrl);
    // Browser.close commonly closes the socket before acknowledging.
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })); return { closed: true };
  }
  if (tool === 'browser_open') {
    const version = await read('/json/version'); const browser = await connect(version.webSocketDebuggerUrl);
    const url = new URL(args.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Use an HTTP/HTTPS URL without embedded credentials.');
    const target = await browser('Target.createTarget', { url: url.href });
    return { tab_id: target.targetId, url: url.href, profile: 'isolated; closed when this turn ends' };
  }
  const targets = await read('/json/list');
  const target = targets.find(t => t.type === 'page' && t.id === args.tab_id);
  if (!target) throw Error('This tab is unavailable or belongs to another turn. Use browser_open.');
  const cdp = await connect(target.webSocketDebuggerUrl);
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw Error('Page evaluation failed; check the selector or expression.');
    return result.result.value ?? null;
  };
  if (tool === 'browser_screenshot') {
    const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (result.data.length > 8 * 1024 * 1024) throw Error('Preview screenshot exceeds 8 MiB.');
    return { image_base64: result.data };
  }
  if (tool === 'browser_snapshot') return evaluate(`JSON.stringify({title:document.title,url:location.href,ready_state:document.readyState,elements:[...document.querySelectorAll('h1,h2,h3,button,a,input,textarea,select,[role]')].filter(e=>e.getClientRects().length).slice(0,100).map(e=>({tag:e.tagName,role:e.getAttribute('role'),id:e.id,text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,180),type:e.type,disabled:!!e.disabled}))}).slice(0,18000)`);
  if (tool !== 'browser_action') throw Error('Unknown browser operation.');
  if (args.action === 'evaluate') {
    if (!args.expression || args.expression.length > 16000) throw Error('Supply a page expression up to 16 KiB.');
    const value = await evaluate(args.expression); const json = JSON.stringify(value);
    return { result: json?.slice(0,18000), truncated: (json?.length ?? 0) > 18000 };
  }
  if (args.action === 'press') {
    const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38 };
    if (!codes[args.key]) throw Error('Unsupported browser key.');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: args.key, windowsVirtualKeyCode: codes[args.key] });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: args.key, windowsVirtualKeyCode: codes[args.key] });
    return { performed: true };
  }
  if (!args.selector || args.selector.length > 1000) throw Error('Supply a CSS selector up to 1000 characters.');
  const selector = JSON.stringify(args.selector);
  if (args.action === 'click') return { performed: await evaluate(`(()=>{const e=document.querySelector(${selector});if(!e||!e.getClientRects().length||e.disabled)throw Error('Unavailable element');e.scrollIntoView({block:'center'});e.click();return true})()`) };
  if (args.action === 'fill') return { performed: await evaluate(`(()=>{const e=document.querySelector(${selector});if(!e||!e.getClientRects().length||e.disabled||!['INPUT','TEXTAREA'].includes(e.tagName))throw Error('Unavailable field');e.focus();const setter=Object.getOwnPropertyDescriptor(e.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set;setter.call(e,${JSON.stringify(args.text ?? '')});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`) };
  throw Error('Unsupported browser action.');
}
main().then(result => process.stdout.write(JSON.stringify(result))).catch(error => process.stdout.write(JSON.stringify({ error: ['Invalid preview endpoint.','Invalid preview socket.','Preview connection failed.','Preview browser did not respond.','This tab is unavailable or belongs to another turn. Use browser_open.','Use an HTTP/HTTPS URL without embedded credentials.','Page evaluation failed; check the selector or expression.','Unsupported browser key.','Supply a CSS selector up to 1000 characters.'].includes(error.message) ? error.message : 'Preview operation failed (' + error.name + '). Check the URL, tab, selector and browser availability.' }))).finally(() => { clearTimeout(timer); if (socket && socket.readyState === WebSocket.OPEN) socket.close(); });
