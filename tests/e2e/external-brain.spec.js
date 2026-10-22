import { test, expect } from '@playwright/test';

// CPU-only integration. Requires REPLOID_EXTERNAL_BRAIN=true on the local server.
// Keep browser sandboxing enabled; do not relax it to make this test run.
test.use({ launchOptions: {
  chromiumSandbox: true,
  args: [],
  ...(process.env.REPLOID_E2E_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.REPLOID_E2E_CHROMIUM_EXECUTABLE_PATH } : {})
} });
const headers = { 'X-Reploid-External-Brain': '1' };

test('local X accepts external decisions, exposes tool observations and cancels pending work', async ({ page, request, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const status = await request.get('/api/external-brain/status', { headers });
  expect(status.ok(), 'Start the local server with REPLOID_EXTERNAL_BRAIN=true').toBe(true);
  expect((await status.json()).enabled).toBe(true);
  const instance = `external-e2e-${Date.now()}`;
  await page.goto(`/x?instance=${instance}`);
  await page.locator('[data-action="choose-external"]').click();
  await expect(page.getByText('Mailbox ready. This does not mean dot is connected.')).toBeVisible();
  await page.locator('#goal-input').fill('Write and inspect a local external-brain acceptance artifact.');
  await page.locator('#awaken-btn').click();

  const nextRequest = async () => {
    let pending;
    await expect.poll(async () => {
      const body = await (await request.get('/api/external-brain/requests', { headers })).json();
      pending = body.pending.find(entry => entry.sessionId === `x:${instance}`);
      return !!pending;
    }).toBe(true);
    return pending;
  };
  const respond = (entry, toolCalls) => request.post(`/api/external-brain/requests/${entry.requestId}/respond`, {
    headers, data: { schema: 'reploid.external-brain.response/v1', requestId: entry.requestId,
      sessionId: entry.sessionId, content: '', toolCalls }
  });
  const first = await nextRequest();
  expect(first.tools.some(tool => tool.function.name === 'WriteFile')).toBe(true);
  expect((await respond(first, [{ name: 'WriteFile', args: {
    path: '/artifacts/external-brain-proof.txt', content: 'external-brain-browser-roundtrip'
  } }])).ok()).toBe(true);
  const second = await nextRequest();
  expect(JSON.stringify(second.messages)).toContain('bytesWritten');
  expect((await respond(second, [{ name: 'ReadFile', args: { path: '/artifacts/external-brain-proof.txt' } }])).ok()).toBe(true);
  const third = await nextRequest();
  expect(JSON.stringify(third.messages)).toContain('external-brain-browser-roundtrip');
  await page.evaluate(() => window.REPLOID.agent.stop());
  await expect.poll(async () => {
    const body = await (await request.get('/api/external-brain/requests', { headers })).json();
    return body.pending.some(entry => entry.requestId === third.requestId);
  }).toBe(false);
  expect((await respond(third, [{ name: 'WriteFile', args: {
    path: '/artifacts/must-not-exist.txt', content: 'late'
  } }])).status()).toBe(409);
  expect(await page.evaluate(() => window.REPLOID.vfs.exists('/artifacts/must-not-exist.txt'))).toBe(false);
});
