import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Production catalogue/session/UI with injected peer discovery only. No inference.
for (const theme of ['light', 'dark']) for (const width of [390, 1440]) {
  test(`fresh requester preparation keeps draft at ${width}px in ${theme}`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin, errors = [], modules = [], snapshots = [];
    page.on('response', response => {
      if (/\.(js|css)$/.test(response.url())) modules.push(response.body().then(bytes => ({
        path: new URL(response.url()).pathname, sha256: createHash('sha256').update(bytes).digest('hex')
      })));
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.context().route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (process.env.REPLOID_FIRST_USE_BEFORE === '1') {
      const source = await readFile('artifacts/first-use-preparation-20261013/conversation-workspace-before.js', 'utf8');
      await page.route('**/ui/pool-home/conversation-workspace.js', route => route.fulfill({ contentType: 'text/javascript', body: source }));
    }
    await page.setViewportSize({ width, height: 844 });
    // A static JSON document provides the origin without booting discovery or providers.
    await page.goto('/config/chat-files.json');
    await page.setContent('<!doctype html><html class="pool-page"><head><meta charset="utf-8"></head><body></body></html>');
    const manifest = JSON.parse(await readFile('self/styles/poolday/layers.json', 'utf8'));
    const layerFiles = [manifest.tokens, ...manifest.primitives, ...manifest.compositions];
    await page.evaluate(async ({ theme, layerFiles }) => {
      for (const file of layerFiles.map(name => `poolday/${name}`)) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `/styles/${file}`; document.head.append(link);
      }
      const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
      const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
      const { bindExecutionRibbon } = await import('/ui/pool-home/execution-ribbon.js');
      const { renderNav } = await import('/ui/pool-home/shell-view.js');
      const root = document.createElement('main'); root.className = 'pool-home'; root.dataset.poolRouteId = 'home'; root.dataset.poolTheme = theme;
      root.innerHTML = renderNav('home') + '<div class="pool-route-content">' + renderConversationWorkspace() + '</div>'; document.body.append(root);
      const model = CANONICAL_CHAT_MODELS[0];
      const peer = { peerId: 'fixture-preparing-peer', model: model.id, modelIdentity: model.identity, readiness: 'loading', hasInference: false, availableSlots: 0 };
      let connections = 0;
      const session = createChatSession({ storage: null, models: [model], swarm: {
        getState: () => ({ consumer: { connectionState: 'connected', peers: [peer] } }), async connect() { connections++; }
      } });
      const dispose = bindConversationWorkspace(root, session), ribbon = bindExecutionRibbon(root);
      const unsubscribe = session.subscribe(state => ribbon.update(state));
      window.firstUse = {
        state: () => session.getState(), connections: () => connections,
        phase(value) { peer.readiness = value; peer.hasInference = value === 'ready'; peer.availableSlots = value === 'ready' ? 1 : 0; session.refreshNetwork(); },
        async close() { unsubscribe(); dispose(); ribbon.dispose(); await session.close(); }
      };
    }, { theme, layerFiles });
    const draft = 'Can you explain a closure?';
    await page.locator('[data-composer-input]').fill(draft);
    await expect(page.locator('[data-ribbon-status]')).toHaveText('Preparing model');
    await expect(page.locator('[data-composer-send]')).toBeDisabled();
    const evidence = process.env.REPLOID_FIRST_USE_EVIDENCE;
    const observe = async () => snapshots.push(await page.evaluate(() => ({
      status: document.querySelector('[data-ribbon-status]').textContent,
      statusVisible: document.querySelector('[data-ribbon-status]').checkVisibility(),
      composerStatus: document.querySelector('[data-model-status]').textContent,
      composerStatusVisible: document.querySelector('[data-model-status]').checkVisibility(),
      retryVisible: !document.querySelector('[data-retry-connection]').hidden,
      sendDisabled: document.querySelector('[data-composer-send]').disabled,
      draft: document.querySelector('[data-composer-input]').value
    })));
    await observe();
    if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, `${theme}-${width}-preparing.png`), fullPage: true }); }
    try {
      await expect(page.locator('[data-retry-connection]')).toBeHidden();
      await expect(page.locator('[data-model-status]')).toBeVisible();
      await expect(page.locator('[data-model-status]')).toHaveText('Model preparing…');
      await page.evaluate(() => window.firstUse.phase('ready'));
      await expect(page.locator('[data-ribbon-status]')).toHaveText('1 model ready');
      await expect(page.locator('[data-composer-send]')).toBeEnabled();
      await expect(page.locator('[data-retry-connection]')).toBeHidden();
      await expect(page.locator('[data-model-status]')).toBeHidden();
      await expect(page.locator('[data-composer-input]')).toHaveValue(draft);
      await observe();
      await page.evaluate(() => window.firstUse.phase('unavailable'));
      await expect(page.locator('[data-ribbon-status]')).toHaveText('No model ready');
      await expect(page.locator('[data-composer-send]')).toBeDisabled();
      await expect(page.locator('[data-retry-connection]')).toBeVisible();
      await expect(page.locator('[data-model-status]')).toBeVisible();
      await expect(page.locator('[data-model-status]')).toHaveText('Model unavailable.');
      await expect(page.locator('[data-composer-input]')).toHaveValue(draft);
      await observe();
      expect(await page.evaluate(() => ({ calls: window.firstUse.connections(), threads: window.firstUse.state().threads.length }))).toEqual({ calls: 0, threads: 0 });
      expect(errors).toEqual([]);
    } finally {
      await page.evaluate(() => window.firstUse.close());
      if (evidence) await writeFile(path.join(evidence, `${theme}-${width}.json`), JSON.stringify({
        scope: 'Production session/catalogue/UI with injected discovery; no inference, GPU, contribution or external requests',
        theme, width, snapshots, errors, servedModules: await Promise.all(modules)
      }, null, 2) + '\n');
    }
  });
}
