import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Isolated presentation fixtures: no discovery, inference, model loading or GPU work.
test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:5198/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      const layers = ['tokens.css', 'primitives.css', 'components.css', 'components/materials.css', 'components/conversation.css', 'components/interaction.css', 'components/optical.css'];
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/rd.css">'
        + layers.map(file => `<link rel="stylesheet" href="/styles/poolday/${file}">`).join('') + '<main class="pool-home" data-pool-route-id="home"></main>' });
    }
    const filename = path.resolve('self', '.' + pathname);
    if (!filename.startsWith(path.resolve('self') + '/')) return route.abort();
    try { return route.fulfill({ contentType: pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: await readFile(filename) }); }
    catch { return route.abort(); }
  });
  await page.goto('http://127.0.0.1:5198/');
  await page.evaluate(async () => {
    const [{ renderConversationWorkspace, bindConversationWorkspace }, { renderNav }] = await Promise.all([
      import('/ui/pool-home/conversation-workspace.js'), import('/ui/pool-home/shell-view.js')
    ]);
    const root = document.querySelector('.pool-home');
    root.innerHTML = renderNav('home') + '<div class="pool-route-content">' + renderConversationWorkspace() + '</div>';
    const model = { id: 'qwen', name: 'Qwen 3.5 0.8B', availability: 'ready' };
    const thread = { id: 'thread', title: 'Jump into a useful conversation', model, permissions: { sharingScope: 'mesh' }, grants: [],
      messages: [{ id: 'question', role: 'user', content: 'Jump!' }, { id: 'response', role: 'assistant', attemptId: 'attempt', content: 'Ready for the challenge. Let’s go.' }],
      attempts: [{ id: 'attempt', status: 'completed', execution: { placement: 'two-device-layer-partition', participantA: 'participant-c', participantB: 'participant-a', requesterId: 'requester',
        stepSummary: { metrics: { localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } } } } }] };
    const listeners = new Set(), drafts = new Map();
    const state = window.railState = { participantId: 'requester', models: [model], defaultModel: model,
      threads: [thread, ...Array.from({ length: 12 }, (_, index) => ({ ...thread, id: 'old-' + index, title: 'Earlier conversation ' + (index + 1) }))],
      activeThread: thread, selectedId: thread.id, runningIds: [], network: {
        consumer: { peerId: 'requester-transport', connectionState: 'connected', peers: ['a', 'b', 'c', 'd'].map(id => ({ peerId: 'transport-' + id })) },
        partitionPeers: ['a', 'b', 'c', 'd'].map(id => ({ transportId: 'transport-' + id, participantId: 'participant-' + id, available: true, description: { index: id === 'a' ? 1 : 0, phase: 'ready', offer: model } }))
      } };
    const emit = window.emitRailState = () => listeners.forEach(listener => listener(state));
    const session = { getState: () => state, subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
      saveDraft: (id, draft) => drafts.set(id, draft), getDraft: id => drafts.get(id),
      select(id) { state.selectedId = id; state.activeThread = state.threads.find(item => item.id === id) || null; emit(); },
      disconnect() { state.network.consumer.connectionState = 'disconnected'; emit(); }, connect() { state.network.consumer.connectionState = 'connected'; emit(); }
    };
    window.disposeRails = bindConversationWorkspace(root, session);
  });
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`${theme} rails contain controls and fill expanded widths at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width > 760 ? 1000 : 844 });
    await page.evaluate(theme => { document.querySelector('.pool-home').dataset.poolTheme = theme; }, theme);
    const left = page.locator('[data-thread-sidebar]'), right = page.locator('[data-network-rail]');
    await expect(left.locator('[data-toggle-thread-rail]')).toBeVisible();
    await expect(right.locator('[data-toggle-inspector]')).toBeVisible();
    await expect(page.locator('[data-thread-list]')).toBeHidden();
    await page.locator('[data-composer-input]').fill('Keep this draft.');
    await page.screenshot({ path: info.outputPath('collapsed.png'), fullPage: true });
    await page.locator('[data-toggle-thread-rail]').click();
    await expect(left.locator('[data-current-model]')).toBeVisible();
    const widths = await left.evaluate(node => ({
      list: node.querySelector('[data-thread-list]').clientWidth,
      row: node.querySelector('.chat-thread-row').clientWidth,
      item: node.querySelector('.chat-thread-item').clientWidth,
      model: node.querySelector('[data-current-model]').clientWidth,
      rail: node.clientWidth,
    }));
    expect(widths.list - widths.row).toBeLessThanOrEqual(10);
    expect(widths.row - widths.item).toBeLessThanOrEqual(2);
    expect(widths.rail - widths.model).toBeLessThanOrEqual(20);
    await page.screenshot({ path: info.outputPath('threads.png'), fullPage: true });
    if (width <= 1000) await page.locator('[data-toggle-thread-rail]').click();
    await page.locator('[data-toggle-inspector]').click();
    await expect(right.locator('[data-contextual-inspector]')).toBeVisible();
    const headingWidths = await right.evaluate(node => ({ rail: node.clientWidth, settings: node.querySelector('[data-pool-settings] > summary').clientWidth, network: node.querySelector('[data-toggle-inspector]').clientWidth }));
    expect(headingWidths.rail - headingWidths.settings).toBeLessThanOrEqual(20);
    expect(headingWidths.rail - headingWidths.network).toBeLessThanOrEqual(20);
    await expect(right.locator('.network-peer-row strong')).toHaveText(['Computer 1', 'Computer 2', 'Computer 3', 'Computer 4']);
    const toggle = page.locator('[data-mesh-connect]');
    const contrast = await toggle.evaluate(node => ({ track: getComputedStyle(node).backgroundColor, thumb: getComputedStyle(node.firstElementChild).backgroundColor }));
    expect(contrast.thumb).not.toBe(contrast.track);
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: info.outputPath('network.png'), fullPage: true });
    await page.locator('[data-close-inspector]').click();
    await page.locator('[data-execution-activity]:not([hidden]) summary').click();
    await expect(page.locator('[data-activity-detail] li > span:first-child')).toHaveText(['Computer 3', 'Computer 1']);
    await page.evaluate(() => { window.railState.network.consumer.peers.reverse(); window.emitRailState(); });
    await expect(page.locator('[data-activity-detail] li > span:first-child')).toHaveText(['Computer 3', 'Computer 1']);
    await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-composer-input]')).toBeInViewport();
    // Archive browsing expands the existing rail, including on phones.
    await left.locator('[data-conversation-actions] > summary').click();
    await left.locator('[data-show-archived]').click();
    await expect(page.locator('[data-chat-workspace]')).toHaveAttribute('data-threads-open', '');
    await expect(left).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft.');
    await page.screenshot({ path: info.outputPath('activity.png'), fullPage: true });
  });
}

test('Verification Worker accepts all changed presentation modules', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const files = ['components/interface-icons.js', ...['computer-labels', 'conversation-workspace', 'execution-activity', 'execution-ribbon', 'index', 'network-controls', 'network-inspector'].map(name => 'pool-home/' + name + '.js')];
    const snapshot = Object.fromEntries(await Promise.all(files.map(async file => ['/self/ui/' + file, await (await fetch('/ui/' + file)).text()])));
    return new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timeout = setTimeout(() => { worker.terminate(); reject(Error('Worker timeout')); }, 10000);
      worker.onmessage = event => { clearTimeout(timeout); worker.terminate(); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
  });
  expect(result.passed, JSON.stringify(result)).toBe(true);
});
