import { chromium } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const root = '/var/tmp/reploid-cleanup-failure-20261012/self';
const results = [];
for (const frozen of [false, true]) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage(), result = { frozen, messages: [], sockets: [] };
  page.on('pageerror', error => result.messages.push({ error: error.stack }));
  page.on('console', msg => { if (['error','warning'].includes(msg.type())) result.messages.push({ type: msg.type(), text: msg.text() }); });
  page.on('websocket', ws => {
    const socket = { url: ws.url(), sent: [], received: [] }; result.sockets.push(socket);
    ws.on('framesent', frame => { try { const f = JSON.parse(frame.payload); socket.sent.push({ type: f.type, keys: Object.keys(f) }); } catch {} });
    ws.on('framereceived', frame => { try { const f = JSON.parse(frame.payload); socket.received.push({ type: f.type, error: f.error, message: f.message, keys: Object.keys(f) }); } catch {} });
    ws.on('socketerror', error => { socket.error = error; }); ws.on('close', () => { socket.closed = true; });
  });
  if (frozen) await context.route('http://localhost:8000/**', async route => {
    const u = new URL(route.request().url()), file = path.resolve(root, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).slice(1));
    if (!file.startsWith(root+'/')) return route.abort();
    if (!(await stat(file).catch(()=>null))?.isFile()) return route.continue();
    const contentType = { '.js':'text/javascript', '.json':'application/json', '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.wgsl':'text/plain' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ body: await readFile(file), contentType });
  });
  await page.goto('http://localhost:8000/');
  await page.locator('[data-chat-workspace]').waitFor();
  await page.waitForTimeout(15000);
  result.text = await page.locator('body').innerText();
  results.push(result);
  await context.close();
}
await browser.close();
await writeFile(new URL('./discovery-control.json', import.meta.url), JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results));
