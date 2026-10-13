import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = path.resolve('self'), out = new URL('./', import.meta.url), errors = [], cases = [];
const css = ['tokens.css','primitives.css','components.css','components/materials.css','components/conversation.css','components/interaction.css','components/optical.css'];
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/styles/poolday/${file}">`).join('')}<main class="pool-home" style="min-height:100vh;padding:24px"><details open class="chat-execution-activity"><summary></summary><div data-activity-detail></div></details></main>`;
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type','text/html'); return res.end(html); }
    const file = path.resolve(base, '.' + pathname);
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light','dark']) for (const width of [320,1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for (const measured of [false,true]) {
      const result = await page.evaluate(async ({ theme, measured }) => {
        const { updateExecutionActivity } = await import('/ui/pool-home/execution-activity.js');
        document.querySelector('main').dataset.poolTheme = theme;
        const identity = { schema: 'reploid.partition-attempt/v2', requesterId: 'requester', route: {
          schema: 'reploid.partition-route/v1', planId: 'fixture', stages: Array.from({ length: 7 }, (_, index) => ({ index, participantId: 'node-' + index })) } };
        const execution = { identity };
        if (measured) execution.stepSummary = { count: 3, stages: identity.route.stages.map(({index}) => ({ partitionIndex:index, steps:3, stepMs:{ count:3,total:300*(index+1) } })) };
        const state = { participantId:'requester', activeThread:{ id:'thread', model:{name:'Fixture model'}, messages:[], attempts:[{id:'attempt',status:measured?'completed':'executing',execution}] } };
        updateExecutionActivity(document.querySelector('details'), state);
        return { rows:document.querySelectorAll('li').length, bars:document.querySelectorAll('.chat-distribution').length,
          text:document.querySelector('details').textContent, overflow:document.documentElement.scrollWidth>innerWidth };
      }, { theme, measured });
      assert.equal(result.rows,7); assert.equal(result.bars,measured?1:0); assert.equal(result.overflow,false);
      assert(result.text.includes(measured?'Complete · 7 computers':'Generating · 7 computers'));
      assert(result.text.includes(measured?'tok/s':'Timing pending'));
      cases.push({theme,width,measured,...result});
      await page.screenshot({path:new URL(`${theme}-${width}-${measured?'measured':'pending'}.png`,out).pathname});
    }
  }
  assert.deepEqual(errors,[]);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
await writeFile(new URL('browser.json',out),JSON.stringify({scope:'Source presentation fixture; no model or WebGPU work',cases,errors,serverClosed:!server.listening,browserClosed:true},null,2)+'\n');
console.log(`${cases.length} Chromium presentation controls passed; owned browser/server closed.`);
