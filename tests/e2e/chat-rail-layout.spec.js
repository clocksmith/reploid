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
    if (width <= 760) await expect(left.locator('[data-new-thread]')).toBeHidden();
    const controls = await page.evaluate(() => {
      const selectors = ['[data-toggle-thread-rail]', '[data-new-thread]', '[data-open-model]', '[data-conversation-actions] > summary', '[data-pool-settings] > summary', '[data-toggle-inspector]'];
      return selectors.map(selector => document.querySelector(selector)).filter(node => node.checkVisibility()).map(node => ({
        name: node.getAttribute('aria-label'), box: node.getBoundingClientRect().toJSON(),
        rail: node.closest('[data-thread-sidebar], [data-network-rail]').getBoundingClientRect().toJSON(),
      }));
    });
    for (const { name, box, rail } of controls) {
      expect(box.width, name).toBe(44);
      expect(box.height, name).toBe(44);
      expect(box.x, name).toBeGreaterThanOrEqual(rail.x + 8);
      expect(box.x + box.width, name).toBeLessThanOrEqual(rail.x + rail.width - 8);
    }
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
    expect(await toggle.locator('span').evaluate(node => getComputedStyle(node).backgroundImage)).toContain('radial-gradient');
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

for (const width of [1440, 900, 390, 320]) for (const theme of ['light', 'dark']) {
  test(`${theme} transcript and composer share the available column at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => {
      document.querySelector('.pool-home').dataset.poolTheme = theme;
      const stream = document.querySelector('[data-message-stream]');
      for (let index = 0; index < 12; index += 1) stream.append(stream.firstElementChild.cloneNode(true));
    }, theme);
    await page.locator('[data-composer-input]').fill('A draft that wraps when the available chat column becomes narrow.');
    const check = async state => {
      const result = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { stream: box('[data-message-stream]'), composer: box('[data-composer-area]'),
          area: box('[data-conversation-area]'), left: box('[data-thread-sidebar]'), right: box('[data-network-rail]') };
      });
      expect(Math.abs(result.stream.x - result.composer.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.stream.width - result.composer.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.composer.x + result.composer.width / 2 - result.area.x - result.area.width / 2)).toBeLessThanOrEqual(1);
      if (width > 760) {
        expect(result.composer.x).toBeGreaterThanOrEqual(result.left.x + result.left.width + 8);
        expect(result.composer.x + result.composer.width).toBeLessThanOrEqual(result.right.x - 8);
      }
      const input = page.locator('[data-composer-input]');
      await expect(input).toHaveValue('A draft that wraps when the available chat column becomes narrow.');
      await expect.poll(() => input.evaluate(node => Math.min(node.scrollHeight, innerHeight * 0.22) - node.clientHeight)).toBeLessThanOrEqual(1);
      const controls = await page.evaluate(() => ['[data-composer-send]', '.chat-file-label'].map(selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        const field = document.querySelector('[data-composer-field]').getBoundingClientRect();
        return box.width === 44 && box.x >= field.x && box.right <= field.right;
      }));
      expect(controls).toEqual([true, true]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath(`${state}.png`) });
    };
    await check('collapsed');
    await page.locator('[data-toggle-thread-rail]').click(); await check('left');
    if (width > 760) { await page.locator('[data-toggle-inspector]').click(); await check('both'); }
    await page.locator('[data-toggle-thread-rail]').click();
    if (width <= 760) await page.locator('[data-toggle-inspector]').click();
    await check('right');
    await page.locator('[data-close-inspector]').click(); await check('closed');
  });
}

for (const theme of ['light', 'dark']) for (const width of [1440, 320]) {
  test(`${theme} stationary glyphs and marble switches retain focus and reduced motion at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => { document.querySelector('.pool-home').dataset.poolTheme = theme; }, theme);
    const brand = page.locator('[data-toggle-thread-rail]');
    const glyphs = () => brand.locator('.pool-power-tower').evaluate(node => [...node.children].map(glyph => {
      const box = glyph.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    const before = await glyphs(); expect(before[1].y).toBeLessThan(before[0].y - 4);
    await brand.hover(); await expect.poll(glyphs).toEqual(before);
    await brand.focus(); await expect(brand).toBeFocused();
    expect(await brand.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    await page.locator('[data-toggle-inspector]').click();
    const toggle = page.locator('[data-mesh-connect]'), knob = toggle.locator('span');
    const on = await knob.boundingBox();
    const image = await knob.evaluate(node => getComputedStyle(node).backgroundImage);
    expect(image).toContain('radial-gradient'); expect(image).not.toContain('255, 255, 255');
    expect(on.width).toBe(on.height);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('Tab'); await toggle.focus(); expect(await toggle.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    await page.keyboard.press('Space'); await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect((await knob.boundingBox()).x).toBeLessThan(on.x);
    expect(await knob.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(image);
    expect(await knob.evaluate(node => getComputedStyle(node).transitionProperty)).toBe('none');
    await page.screenshot({ path: info.outputPath('marble-off-focus.png') });
    await page.keyboard.press('Space'); await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.evaluate(node => { node.disabled = true; }); await expect(toggle).toBeDisabled();
    await expect.poll(() => toggle.evaluate(node => Number(getComputedStyle(node).opacity))).toBeLessThan(1);
    await page.screenshot({ path: info.outputPath('marble-on-disabled.png') });
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
