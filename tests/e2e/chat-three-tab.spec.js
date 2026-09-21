import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let server, origin;
test.beforeAll(async () => {
  const root = path.resolve('.');
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Three-tab chat integration</title>'); return; }
      const file = path.resolve(root, pathname.slice(1));
      if (![path.join(root, 'self') + path.sep, path.join(root, 'tests/fixtures') + path.sep].some(prefix => file.startsWith(prefix))) {
        response.writeHead(403).end(); return;
      }
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });

async function connect(left, right, leftId, rightId, kind) {
  const offer = await left.evaluate(({ rightId, kind }) => window.fixture.offer(rightId, kind), { rightId, kind });
  const answer = await right.evaluate(({ leftId, kind, offer }) => window.fixture.answer(leftId, kind, offer), { leftId, kind, offer });
  await left.evaluate(({ rightId, answer }) => window.fixture.accept(rightId, answer), { rightId, answer });
  await expect.poll(() => left.evaluate(id => window.fixture.ready(id), rightId)).toBe(true);
  await expect.poll(() => right.evaluate(id => window.fixture.ready(id), leftId)).toBe(true);
}

test('three same-profile tabs transfer verified test files, isolate concurrent chats and retain one model residency', async ({ browser }, testInfo) => {
  const context = await browser.newContext(), namespace = 'chat-' + Date.now();
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  const [a, b, c] = pages, pageErrors = [];
  try {
    await Promise.all(pages.map(async (page, index) => {
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(origin + '/?instance=' + ['a', 'b', 'c'][index]);
      await page.evaluate(async ({ role, namespace }) => {
        window.fixture = await import('/tests/fixtures/chat-three-tab.js');
        window.identity = await window.fixture.start({ role, namespace });
      }, { role: ['A', 'B', 'C'][index], namespace });
    }));
    const receiver = await b.evaluate(() => window.identity);
    const grant = await c.evaluate(receiver => window.fixture.provision(receiver), receiver);
    await Promise.all([a, b].map(page => page.evaluate(grant => window.fixture.configure(grant), grant)));
    await connect(b, c, 'B', 'C', 'files');
    const interrupted = await b.evaluate(() => window.fixture.acquire(true));
    expect(interrupted.failure).toBeTruthy(); expect(interrupted.storage.storedBytes).toBe(64);
    const resumed = await b.evaluate(() => window.fixture.acquire());
    expect(resumed.failure).toBe(null); expect(resumed.receipt.cacheBytes).toBe(64);
    expect(resumed.heldFiles).toEqual(['model', 'adapter']);
    await c.evaluate(() => window.fixture.disconnect('B'));
    const cached = await b.evaluate(() => window.fixture.acquire());
    expect(cached.failure).toBe(null); expect(cached.requests).toBe(0);
    await b.evaluate(() => window.fixture.serve());
    await connect(a, b, 'A', 'B', 'chat');
    await a.evaluate(() => window.fixture.chat());
    const first = await a.evaluate(() => window.fixture.send('Conversation one'));
    const second = await a.evaluate(() => window.fixture.send('Conversation two'));
    expect((await b.evaluate(() => window.fixture.state())).calls).toHaveLength(0);
    await a.evaluate(id => window.fixture.approve(id), first);
    await expect.poll(() => b.evaluate(() => window.fixture.state().calls.length)).toBe(1);
    await a.evaluate(id => window.fixture.approve(id), second);
    await expect.poll(() => b.evaluate(() => window.fixture.state().scheduler.queued)).toBe(1);
    await a.evaluate(id => window.fixture.cancel(id), first);
    await expect.poll(() => a.evaluate(() => window.fixture.state().workspace.threads[0].attempts[0].status)).toBe('cancelling');
    expect((await b.evaluate(() => window.fixture.state())).calls).toHaveLength(1);
    await b.evaluate(() => window.fixture.releaseExecution());
    await expect.poll(() => a.evaluate(() => window.fixture.state().workspace.threads.map(thread => thread.attempts.at(-1).status))).toEqual(['cancelled', 'completed']);
    const followup = await a.evaluate(id => window.fixture.send('Follow-up two', id), second);
    await a.evaluate(id => window.fixture.approve(id), followup);
    await expect.poll(() => b.evaluate(() => window.fixture.state().calls.length)).toBe(3);
    await expect.poll(() => a.evaluate(() => window.fixture.state().workspace.runningIds.length)).toBe(0);
    const states = await Promise.all(pages.map(page => page.evaluate(() => window.fixture.state())));
    expect(states[0].heldFiles).toEqual([]);
    expect(states[1].opens).toBe(1); expect(states[1].applied).toEqual([]);
    expect(states[1].calls[2].messages).toEqual([
      { role: 'user', content: 'Conversation two' }, { role: 'assistant', content: 'Injected answer: Conversation two' },
      { role: 'user', content: 'Follow-up two' }
    ]);
    expect(states[1].observations.map(row => row.status)).toEqual(['cancelled', 'completed', 'completed']);
    expect(states[2].calls).toEqual([]);
    const lost = await a.evaluate(() => window.fixture.send('Disconnect this request'));
    await a.evaluate(id => window.fixture.approve(id), lost);
    await expect.poll(() => b.evaluate(() => window.fixture.state().calls.length)).toBe(4);
    await expect.poll(() => a.evaluate(() => window.fixture.state().workspace.threads.at(-1).messages.at(-1).content)).toBe('Injected answer: ');
    await b.evaluate(() => window.fixture.disconnect('A'));
    await expect.poll(() => a.evaluate(() => window.fixture.state().workspace.threads.at(-1).attempts.at(-1).status)).toBe('failed');
    await b.evaluate(() => window.fixture.releaseExecution());
    await expect.poll(() => b.evaluate(() => window.fixture.state().scheduler.activeAttemptId)).toBe(null);
    await connect(a, b, 'A', 'B', 'chat');
    await a.evaluate(id => window.fixture.retry(id), lost);
    await a.evaluate(id => window.fixture.approve(id), lost);
    await expect.poll(() => a.evaluate(() => window.fixture.state().workspace.threads.at(-1).attempts.at(-1).status)).toBe('completed');
    const recovered = await a.evaluate(() => window.fixture.state().workspace.threads.at(-1));
    expect(recovered.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
    expect(recovered.attempts[1].retryOf).toBe(recovered.attempts[0].id);
    expect(recovered.attempts[1].id).not.toBe(recovered.attempts[0].id);
    expect(recovered.messages.map(message => message.content)).toEqual([
      'Disconnect this request', 'Injected answer: ', 'Injected answer: Disconnect this request'
    ]);
    const beforeReload = await a.evaluate(() => window.fixture.state().workspace.threads);
    await a.reload();
    await a.evaluate(async ({ namespace, grant }) => {
      window.fixture = await import('/tests/fixtures/chat-three-tab.js');
      await window.fixture.start({ role: 'A', namespace }); window.fixture.configure(grant); window.fixture.chat();
    }, { namespace, grant });
    expect((await a.evaluate(() => window.fixture.state())).workspace.threads).toEqual(beforeReload);
    expect((await b.evaluate(() => window.fixture.state())).calls).toHaveLength(5);
    expect((await b.evaluate(() => window.fixture.state())).opens).toBe(1);
    expect([...pageErrors, ...states.flatMap(state => state.errors)]).toEqual([]);
    await testInfo.attach('three-tab-integration', { contentType: 'application/json', body: JSON.stringify({
      executionClass: 'synthetic-files-injected-inference-real-webrtc', physicalDevices: 1, browserProfiles: 1, tabs: 3,
      actualModelInference: false, actualLoRAApplication: false, signedCompleteJobs: false,
      interrupted, resumed, cached, states, recovered, beforeReload
    }, null, 2) });
  } finally {
    await Promise.all(pages.map(page => page.evaluate(() => window.fixture?.close()).catch(() => {})));
    await context.close();
  }
});
