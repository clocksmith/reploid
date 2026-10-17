import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Isolated presentation fixtures: no discovery, inference, model loading or GPU work.
test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:5198/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      const manifest = JSON.parse(await readFile(path.resolve('self/styles/poolday/layers.json'), 'utf8'));
      const layers = [manifest.tokens, ...manifest.primitives, ...manifest.compositions];
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html class="pool-page"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
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
    window.railSession = session;
    window.disposeRails = bindConversationWorkspace(root, session);
  });
});

// Rendered contract: four >=44px controls form a desktop column or a mobile row.
// Compact desktop threads retain icons; model selection lives in its own panel.
// Panel changes preserve draft and focus. Pending computer rows stay visible before ads.
const railButtons = ['[data-toggle-thread-rail]', '[data-new-thread]', '[data-toggle-inspector]', '[data-inspector-section="settings"]'];
const contrastRatio = (first, second) => {
  const luminance = css => css.match(/[\d.]+/g).slice(0,3).map(Number).map(value => {
    const channel=value/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;
  }).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
  const a=luminance(first),b=luminance(second);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
};


async function measureControls(page) {
  return page.evaluate(selectors => selectors.map(selector => {
    const node = document.querySelector(selector), box = node.getBoundingClientRect();
    const glyph = node.querySelector('svg, .pool-power-tower'), icon = glyph.getBoundingClientRect();
    const label = node.querySelector('.chat-rail-label');
    const labelBox = label?.checkVisibility() ? label.getBoundingClientRect() : icon;
    const top = Math.min(icon.top, labelBox.top), bottom = Math.max(icon.bottom, labelBox.bottom);
    return { selector, box: box.toJSON(), icon: icon.toJSON(), visible: node.checkVisibility(),
      background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color, radius: getComputedStyle(node).borderRadius,
      centerX: icon.x + icon.width / 2 - box.x - box.width / 2,
      centerY: (top + bottom) / 2 - box.y - box.height / 2 };
  }), railButtons);
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`${theme} one rail centers all four controls and opens each panel at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => { document.querySelector('.pool-home').dataset.poolTheme = theme; }, theme);
    const rail = page.locator('[data-thread-sidebar]');
    await expect(page.locator('.chat-thread-title').first()).toBeHidden();
    if (width <= 760) await expect(page.locator('[data-thread-list]')).toBeHidden();
    await expect(page.locator('[data-conversation-actions]')).toBeHidden();
    await expect(page.locator('.pool-power-tower:visible')).toHaveCount(1);
    await expect(page.locator('[data-pool-settings] > summary')).toBeHidden();
    const controls = await measureControls(page);
    expect(controls.every(item => item.visible)).toBe(true);
    expect(new Set(controls.map(item => item.radius)).size).toBe(1);
    for (const item of controls) {
      expect(contrastRatio(item.background,item.color), item.selector).toBeGreaterThanOrEqual(3);
      expect(item.box.width, item.selector).toBeGreaterThanOrEqual(44); expect(item.box.height, item.selector).toBeGreaterThanOrEqual(44);
      if (width > 760) expect(item.box.width, item.selector).toBe(44);
      expect(Math.abs(item.centerX), item.selector).toBeLessThanOrEqual(0.5);
      expect(Math.abs(item.centerY), item.selector).toBeLessThanOrEqual(0.5);
      if (width > 760) expect(item.box.x).toBe(controls[0].box.x);
      else expect(item.box.y).toBe(controls[0].box.y);
    }
    // Check the graphic itself, not only the wrapper around the logo.
    const brand = await page.locator('[data-toggle-thread-rail]').evaluate(node => {
      const box=node.getBoundingClientRect(), parts=[...node.querySelectorAll('.pool-power-tower > *')].map(glyph=>glyph.getBoundingClientRect());
      return { dx:(Math.min(...parts.map(b=>b.x))+Math.max(...parts.map(b=>b.right)))/2-box.x-box.width/2,
        dy:(Math.min(...parts.map(b=>b.y))+Math.max(...parts.map(b=>b.bottom)))/2-box.y-box.height/2 };
    });
    expect(Math.abs(brand.dx)).toBeLessThanOrEqual(2); expect(Math.abs(brand.dy)).toBeLessThanOrEqual(2);
    await page.locator('[data-composer-input]').fill('Keep this draft.');
    await page.screenshot({path:info.outputPath('collapsed.png')});
    await page.locator('[data-toggle-thread-rail]').click();
    await expect(page.locator('[data-thread-list]')).toBeVisible();
    await expect(page.locator('[data-conversation-actions]')).toBeVisible();
    await expect(page.locator('[data-open-model]')).toBeVisible();
    await page.screenshot({path:info.outputPath('threads.png')});
    await page.locator('[data-toggle-inspector]').click();
    await expect(page.locator('.chat-thread-title').first()).toBeHidden();
    if (width <= 760) await expect(page.locator('[data-thread-list]')).toBeHidden();
    await expect(page.locator('[data-contextual-inspector]')).toBeVisible();
    await expect(page.locator('.network-peer-row strong')).toHaveText(['Computer 1','Computer 2','Computer 3','Computer 4']);
    await page.screenshot({path:info.outputPath('network.png')});
    await page.locator('[data-inspector-section="settings"]').click();
    await expect(page.locator('[data-inspector-pane="settings"]')).toBeVisible();
    await page.locator('[data-toggle-thread-rail]').click();
    await expect(page.locator('[data-contextual-inspector]')).toBeHidden();
    await expect(page.locator('[data-thread-list]')).toBeVisible();
    await page.locator('[data-conversation-actions] > summary').click();
    await page.locator('[data-show-archived]').click();
    await expect(page.locator('[data-chat-workspace]')).toHaveAttribute('data-threads-open','');
    await page.locator('[data-toggle-thread-rail]').click();
    await page.locator('[data-open-model]').click();
    await expect(page.locator('[data-inspector-pane="model"]')).toBeVisible();
    await expect(page.locator('#network-inspector-title')).toBeFocused();
    await expect(page.locator('[data-current-model]')).toBeVisible();
    await page.locator('[data-close-inspector]').click();
    await expect(page.locator('[data-open-model]')).toBeFocused();
    await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft.');
    for (const item of await measureControls(page)) {
      expect(Math.abs(item.centerX),item.selector).toBeLessThanOrEqual(0.5);
      expect(Math.abs(item.centerY),item.selector).toBeLessThanOrEqual(0.5);
      if (width > 760) expect(item.box.x).toBe(controls[0].box.x);
      else expect(item.box.y).toBe(controls[0].box.y);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await expect(rail).toBeVisible();
    await page.locator('[data-toggle-inspector]').click();
    await page.locator('[data-new-thread]').click();
    await expect(page.locator('[data-contextual-inspector]')).toBeHidden();
    await expect(page.locator('[data-composer-input]')).toBeFocused();
    expect(await page.evaluate(()=>window.railState.selectedId)).toBe(null);
  });
}

for (const width of [1440, 900, 390, 320]) for (const theme of ['light', 'dark']) {
  test(`${theme} shared chat column follows the single panel at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({width,height:844});
    await page.evaluate(theme=>{
      document.querySelector('.pool-home').dataset.poolTheme=theme;
      const stream=document.querySelector('[data-message-stream]');
      for(let i=0;i<12;i++)stream.append(stream.firstElementChild.cloneNode(true));
    },theme);
    const input=page.locator('[data-composer-input]');
    await input.fill('A draft that wraps when the available chat column becomes narrow.');
    const check=async state=>{
      const result=await page.evaluate(()=>{
        const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
        return {stream:box('[data-message-stream]'),composer:box('[data-composer-area]'),area:box('[data-conversation-area]'),rail:box('[data-thread-sidebar]')};
      });
      expect(Math.abs(result.stream.x-result.composer.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.stream.width-result.composer.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.composer.x+result.composer.width/2-result.area.x-result.area.width/2)).toBeLessThanOrEqual(1);
      if(width>760)expect(result.composer.x).toBeGreaterThanOrEqual(result.rail.right+8);
      expect(result.composer.right).toBeLessThanOrEqual(width-8);
      await expect(input).toHaveValue('A draft that wraps when the available chat column becomes narrow.');
      await expect.poll(()=>input.evaluate(node=>Math.min(node.scrollHeight,innerHeight*.22)-node.clientHeight)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({path:info.outputPath(state+'.png')});
    };
    await check('collapsed');await page.locator('[data-toggle-thread-rail]').click();await check('threads');
    await page.locator('[data-toggle-inspector]').click();await check('network');
    await page.locator('[data-close-inspector]').click();await check('closed');
  });
}

for (const theme of ['light','dark']) for (const width of [1440,320]) {
  test(`${theme} keyboard focus and marble switches at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:844});
    await page.evaluate(theme=>{document.querySelector('.pool-home').dataset.poolTheme=theme;},theme);
    await page.keyboard.press('Tab');
    const brand=page.locator('[data-toggle-thread-rail]');await brand.focus();
    expect(await brand.evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');await expect(brand).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('Escape');await expect(brand).toHaveAttribute('aria-expanded','false');
    await expect(brand).toBeFocused();
    const network=page.locator('[data-toggle-inspector]');await network.focus();await page.keyboard.press('Enter');
    await expect(page.locator('[data-contextual-inspector]')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('[data-contextual-inspector]')).toBeHidden();
    await expect(network).toBeFocused();await page.keyboard.press('Enter');
    const toggle=page.locator('[data-mesh-connect]'),knob=toggle.locator('span');
    const on=await knob.boundingBox(),image=await knob.evaluate(node=>getComputedStyle(node).backgroundImage);
    expect(image).toContain('radial-gradient');expect(image).not.toContain('255, 255, 255');
    await page.emulateMedia({reducedMotion:'reduce'});await toggle.focus();
    expect(await toggle.evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('solid');
    await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-checked','false');
    expect((await knob.boundingBox()).x).toBeLessThan(on.x);
    expect(await knob.evaluate(node=>getComputedStyle(node).backgroundImage)).toBe(image);
    expect(await knob.evaluate(node=>getComputedStyle(node).transitionProperty)).toBe('none');
    await page.screenshot({path:info.outputPath('marble-off.png')});
    await page.keyboard.press('Escape');await expect(page.locator('[data-contextual-inspector]')).toBeHidden();
    await expect(network).toBeFocused();
  });
}

test('Verification Worker accepts changed presentation modules',async({page})=>{
  const result=await page.evaluate(async()=>{
    const files=['conversation-workspace','network-inspector','shell-view','index'];
    const snapshot=Object.fromEntries(await Promise.all(files.map(async file=>['/self/ui/pool-home/'+file+'.js',await(await fetch('/ui/pool-home/'+file+'.js')).text()])));
    return new Promise((resolve,reject)=>{
      const worker=new Worker('/core/verification-worker.js');const timeout=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},10000);
      worker.onmessage=event=>{clearTimeout(timeout);worker.terminate();resolve(event.data);};
      worker.onerror=event=>{clearTimeout(timeout);worker.terminate();reject(Error(event.message));};worker.postMessage({type:'VERIFY',snapshot});
    });
  });
  expect(result.passed,JSON.stringify(result)).toBe(true);
});

for (const width of [1440,320]) test(`shared shell inspector survives mounting and route return at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  await page.evaluate(async()=>{
    const {renderNav}=await import('/ui/pool-home/shell-view.js');
    const {renderConversationWorkspace,bindConversationWorkspace}=await import('/ui/pool-home/conversation-workspace.js');
    const {renderNetworkInspector,bindNetworkInspector}=await import('/ui/pool-home/network-inspector.js');
    const {bindThemeSelector}=await import('/ui/pool-home/theme.js');
    const root=document.querySelector('.pool-home'),session=window.railSession;
    let disposeView=window.disposeRails,inspector,theme;
    window.mountSharedRoute=route=>{
      disposeView?.();inspector?.dispose();theme?.dispose?.();
      root.dataset.poolRouteId=route;
      root.innerHTML=renderNav(route)+'<div class="pool-route-content"></div><div data-shell-inspector>'+renderNetworkInspector()+'</div>';
      const shell=root.querySelector('[data-shell-inspector]');inspector=bindNetworkInspector(shell,session);
      const content=root.querySelector('.pool-route-content');
      if(route==='home'){
        const settings=root.querySelector('[data-pool-settings]');settings.dataset.railSettings='';
        const section=settings.querySelector('section');shell.querySelector('[data-inspector-pane="settings"]').append(...section.childNodes);section.hidden=true;
        settings.querySelector('summary').onclick=event=>{event.preventDefault();inspector.toggle('settings',event.currentTarget);};
        content.innerHTML=renderConversationWorkspace({inspector:false});disposeView=bindConversationWorkspace(content,session,{inspector});
      }else{disposeView=null;content.textContent='Changes';}
      theme=bindThemeSelector(document.body);window.sharedInspector=inspector;
    };
    window.mountSharedRoute('home');
  });
  await page.locator('[data-composer-input]').fill('Preserve my draft across navigation.');
  await page.locator('[data-toggle-inspector]').click();
  await expect(page.locator('.network-peer-row strong')).toHaveCount(4);
  await page.locator('[data-inspector-section="settings"]').click();
  await expect(page.locator('[data-pool-theme-choice="dark"]')).toBeVisible();
  await page.locator('[data-pool-theme-choice="dark"]').click();
  await expect(page.locator('.pool-home')).toHaveAttribute('data-pool-theme','dark');
  await page.evaluate(()=>{window.railState.network.consumer.peers.pop();window.emitRailState();});
  await page.locator('[data-inspector-section="participants"]').click();
  await expect(page.locator('[data-peer-readiness]')).toBeVisible();
  await page.evaluate(()=>window.mountSharedRoute('improve'));
  await expect(page.locator('[data-pool-settings] > summary')).toBeVisible();
  await page.locator('[data-pool-settings] > summary').click();
  await expect(page.locator('[data-pool-theme-choice="light"]')).toBeVisible();
  await page.evaluate(()=>window.mountSharedRoute('home'));
  await expect(page.locator('[data-composer-input]')).toHaveValue('Preserve my draft across navigation.');
  await expect(page.locator('.pool-power-tower:visible')).toHaveCount(1);
  await page.locator('[data-toggle-inspector]').click();
  await page.locator('[data-inspector-section="settings"]').click();
  await expect(page.locator('[data-pool-theme-choice="light"]')).toBeVisible();
  await expect(page.locator('[data-pool-theme-choice="light"]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('shared-settings-return.png')});
});


for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
  test(`${theme} connection journey preserves pending, transfer, readiness and interruption at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => {
      document.querySelector('.pool-home').dataset.poolTheme = theme;
      const network = window.railState.network;
      network.partitionPeers = [];
      network.consumer.peers = [];
      network.consumer.connections = [{ id: 'transport-a', attemptId: 'connection-1', phase: 'preparing' }];
      window.emitRailState();
    }, theme);
    await page.locator('[data-composer-input]').fill('Keep the draft while computers connect.');
    await page.locator('[data-toggle-inspector]').click();
    const row = page.locator('.network-peer-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Preparing connection');
    await expect(row).toContainText('Waiting for connection configuration');
    await expect(row).toBeInViewport();
    await page.screenshot({ path: info.outputPath('pending.png') });
    await page.evaluate(() => { window.railState.network.consumer.connections[0].phase = 'awaiting-answer'; window.emitRailState(); });
    await expect(row).toContainText('Waiting for computer');
    await page.evaluate(() => { window.railState.network.consumer.connections[0].phase = 'connected'; window.emitRailState(); });
    await expect(row).toContainText('Waiting for this computer to report its model status');
    await expect(page.locator('[data-peer-readiness]')).toContainText('1 connected · 0 ready');
    await page.evaluate(() => {
      window.railState.network.consumer.peers = [{ peerId: 'transport-a', model: 'qwen', readiness: 'loading',
        preparation: { kind: 'receiving', receivedBytes: 25, totalBytes: 100 } }]; window.emitRailState();
    });
    await expect(row).toContainText('Receiving files');
    await expect(row.locator('progress')).toHaveAttribute('value', '25');
    await row.locator('summary').click();
    await page.evaluate(() => { window.railState.network.consumer.peers[0].preparation.receivedBytes = 75; window.emitRailState(); });
    await expect(row.locator('progress')).toHaveAttribute('value', '75');
    await expect(row.locator('details')).toHaveAttribute('open', '');
    await page.screenshot({ path: info.outputPath('receiving.png') });
    await page.evaluate(() => {
      window.railState.network.consumer.connections[0].authenticated = true;
      window.railState.network.consumer.peers[0].preparation = { kind: 'pipelines', prepared: 2, total: 4 };
      window.emitRailState();
    });
    await expect(row).toContainText('Authenticated identity observed on this connection');
    await expect(row).toContainText('Preparing GPU');
    await expect(row.locator('progress')).toHaveAttribute('value', '2');
    await page.evaluate(() => { window.railState.network.consumer.peers[0].readiness = 'ready'; window.emitRailState(); });
    await expect(page.locator('[data-peer-readiness]')).toContainText('1 connected · 1 ready');
    await expect(row).toContainText('Model loaded and ready to answer');
    await page.screenshot({ path: info.outputPath('ready.png') });
    await page.evaluate(() => { window.railState.network.consumer.peers[0].activity = { phase: 'executing' }; window.emitRailState(); });
    await expect(row).toContainText('Answering a request');
    await page.evaluate(() => { window.railState.network.consumer.peers[0].activity.phase = 'stopping'; window.emitRailState(); });
    await expect(row).toContainText('Finishing cleanup before releasing resources');
    await page.evaluate(() => { window.railState.network.consumer.connections[0].phase = 'interrupted'; window.emitRailState(); });
    await expect(row).toContainText('Connection interrupted');
    await expect(page.locator('[data-peer-readiness]')).toContainText('0 connected · 0 ready');
    await page.screenshot({ path: info.outputPath('interrupted.png') });
    await expect(row).not.toContainText('Model loaded and ready');
    await page.evaluate(() => {
      window.railState.network.consumer.connections[0] = { id: 'transport-a', attemptId: 'connection-2', phase: 'connected' };
      window.railState.network.consumer.peers[0].attemptId = 'connection-1';
      window.emitRailState();
    });
    await expect(row).toContainText('Waiting for this computer to report its model status');
    await expect(row).toContainText('Identity authentication has not been observed on this connection');
    await expect(page.locator('[data-peer-readiness]')).toContainText('1 connected · 0 ready');
    await page.evaluate(() => {
      window.railState.network.consumer.connections = []; window.railState.network.consumer.peers = [];
      window.railState.network.consumer.connectionState = 'retrying';
      window.railState.network.connectionFailure = { peerId: 'transport-a', message: 'Connection timed out' };
      window.emitRailState();
    });
    await expect(row).toContainText('Connection failed');
    await expect(page.locator('[data-connection-detail]')).toContainText('Retrying');
    await page.screenshot({ path: info.outputPath('failed.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('[data-close-inspector]').click();
    await expect(page.locator('[data-composer-input]')).toHaveValue('Keep the draft while computers connect.');
  });
}

test('connection runtime passes the Verification Worker', async ({ page }, info) => {
  const files = ['host/work-swarm.js', 'vendor/reploid/transport/swarm.js', 'vendor/reploid/transport/room.js',
    'vendor/reploid/mesh/legacy-generation.js', 'ui/pool-home/network-controls.js', 'ui/pool-home/network-inspector.js',
    'ui/pool-home/computer-labels.js', 'ui/pool-home/shell-view.js', 'ui/pool-home/message-list.js',
    'providers/work-resident-provider.js', 'vendor/reploid/mesh/preparation-progress.js', 'vendor/reploid/mesh/peer-identity.js',
    'vendor/reploid/mesh/partitions/automatic-partitions.js', 'vendor/reploid/mesh/partitions/automatic-ordered-partitions.js',
    'vendor/reploid/retrieval/sources.js'];
  const snapshot = Object.fromEntries(await Promise.all(files.map(async file => ['/' + file, await readFile('self/' + file, 'utf8')])));
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    worker.onerror = event => { worker.terminate(); reject(Error(event.message)); };
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  await info.attach('verification.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.errors).toEqual([]); expect(result.passed).toBe(true);
});


for (const width of [1440, 390]) test(`system failure is separate from model output and controls align at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(() => {
    const thread = window.railState.activeThread;
    thread.messages[1].content = '';
    thread.attempts[0] = { id: 'attempt', status: 'failed', error: 'Could not retrieve sources: retrieval exceeded its time limit.',
      retrieval: { outcome: 'failed', limits: { timeoutMs: 10000 }, error: { code: 'timeout', stage: 'extraction' } } };
    window.emitRailState();
  });
  const row = page.locator('.is-assistant');
  await expect(row.locator('[data-system-status]')).toHaveText('System · Reading search results timed out after 10 seconds. No model answer was generated.');
  await expect(row.locator('[aria-label="Model output"]')).toBeHidden();
  await expect(row.locator('[data-copy-message]')).toHaveCount(0);
  await expect(row.locator('[data-retry-attempt]')).toHaveText('Retry');
  const boxes = await row.evaluate(row => ({
    status: row.querySelector('[data-system-status]').getBoundingClientRect().toJSON(),
    details: row.querySelector('[data-execution-trigger]').getBoundingClientRect().toJSON(),
    retry: row.querySelector('[data-retry-attempt]').getBoundingClientRect().toJSON()
  }));
  expect(Math.abs(boxes.details.x - boxes.status.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes.details.y - boxes.retry.y)).toBeLessThanOrEqual(1);
  expect(boxes.retry.x - boxes.details.right).toBeLessThanOrEqual(24);
  await page.screenshot({ path: info.outputPath('retrieval-failure.png') });
});
