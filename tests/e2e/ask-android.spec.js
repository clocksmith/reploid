/**
 * Ask on a phone with a saved owner pairing whose desktop is offline: the release regression for the Android report
 * (private desktop name in Ask, an unrelated pairing blocking Ask, disagreeing route indicators, the download as a
 * prerequisite, a clipped "Answer on", off-topic and covered starters, and a Send that looked ready with nothing to
 * answer). No GPU: the page runs the host's real chat session with a scripted contributor (swarm.generate), as
 * conversation-acceptance.spec.js scripts its executor. Not inference and not a physical phone.
 *
 *   REPLOID_UI_E2E_SPECS=ask-android.spec.js npx playwright test --config tests/playwright.ui.config.js
 */
import { test, expect } from '@playwright/test';
import { allowRemoteOnce } from '../fixtures/remote-permission.js';

const DESKTOP = 'peer:91d1d9293ca2d973191156dc';
const PRIVATE_NAME = 'Mars';
const PAIRING_KEY = 'reploid.owner-paired-desktop:v1';

// Android-like: touch, a phone's pixel ratio, and the browser's text size raised to 130% (Android's font-size setting
// raises the default font size, which em-based media queries follow).
for (const width of [320, 390, 1280]) {
  for (const largeText of width === 1280 ? [false] : [false, true]) {
    test.describe(`${width}px${largeText ? ', text 130%' : ''}`, () => {
      test.use({ viewport: { width, height: width === 1280 ? 800 : 760 }, hasTouch: true, isMobile: width !== 1280, deviceScaleFactor: width === 1280 ? 1 : 2.75 });

      test.beforeEach(async ({ page, baseURL }) => {
        if (largeText) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Page.setFontSizes', { fontSizes: { standard: 21, fixed: 17 } });
        }
        const origin = new URL(baseURL).origin;
        await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        await page.routeWebSocket('**/*', socket => socket.close());
        // A phone that paired with its desktop earlier: the pairing record keeps the desktop's private name.
        await page.addInitScript(({ key, host, name }) => {
          localStorage.setItem(key, JSON.stringify({ hostParticipantId: host, hostLabel: name, roomId: null, pairedAt: 1 }));
          localStorage.setItem('reploid.auto-download.v1', 'off');
        }, { key: PAIRING_KEY, host: DESKTOP, name: PRIVATE_NAME });
      });

      test('automatic chat: no private name, one route, readable controls, clear starters, answered by a contributor', async ({ page }) => {
        await mount(page, { contributors: true });
        await expect(page.locator('[data-composer-send]')).toHaveAttribute('data-send-mode', 'dispatch');
        await expectNoPrivateName(page);
        // One route: every indicator names contributors; nothing implies this device or the paired desktop.
        await expect(page.locator('[data-composer-model-source]')).toHaveText('Contributors');
        await expect(page.locator('[data-composer-input]')).toHaveAttribute('placeholder', 'Message a contributor…');
        await expect(page.locator('[data-prompt-disclosure]')).toHaveCount(0);
        await expect(page.locator('[data-chat-workspace]')).not.toContainText(/is offline/i);
        await expect(page.locator('[data-download-local], [data-optional-download]')).toHaveCount(0);
        await expectReadableAnswerOn(page);
        await expectStartersClear(page);
        await expectComposerUncovered(page);
        // With the keyboard open (a shorter visual viewport) the starters stay clear of the composer.
        if (width !== 1280) {
          await page.locator('[data-composer-input]').focus();
          await page.setViewportSize({ width, height: 420 });
          await expectStartersClear(page);
          await expectComposerUncovered(page);
          await page.setViewportSize({ width, height: 760 });
        }
        // One press dispatches to an eligible contributor.
        await page.locator('[data-composer-input]').fill('Suggest 3 heist movies with clever twists.');
        await page.locator('[data-composer-send]').click();
        await allowRemoteOnce(page);
        await expect(page.locator('[data-message-stream]')).toContainText('Contributor answer: Suggest 3 heist movies with clever twists.');
        const calls = await page.evaluate(() => window.askAndroid.calls);
        expect(calls).toHaveLength(1);
        expect(calls[0].recipients).toEqual({ kind: 'open', ids: [] });
        await expectNoPrivateName(page);
      });

      test('thread restricted to your devices: blocked with recovery, never sent to a contributor', async ({ page }) => {
        await mount(page, { contributors: true });
        await page.evaluate(async host => {
          const { createExecutionPolicy } = await import('/vendor/reploid/chat/execution-policy.js');
          const { session, model } = window.askAndroid;
          const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [host] }, computation: 'plaintext' });
          await session.select(await session.createThread({ model, executionLocation: 'network', privacy }));
        }, DESKTOP);
        await page.locator('[data-composer-input]').fill('Only for my desktop');
        await expect(page.locator('[data-model-status]')).toHaveText('Your desktop is offline. Open Reploid on your desktop.');
        await expect(page.locator('[data-open-model]')).toHaveAttribute('aria-label', /Your desktop/);
        await expect(page.locator('[data-composer-model-source]')).toHaveCount(0);
        await expect(page.locator('[data-composer-send]')).toHaveAttribute('data-send-mode', 'none');
        await expect(page.locator('[data-composer-send]')).toBeDisabled();
        await expect(page.locator('[data-retry-connection]')).toHaveCount(0);
        await page.locator('[data-composer-send]').click({ force: true });
        await page.locator('[data-composer-input]').press('Enter');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.askAndroid.calls.length)).toBe(0);
        expect(await page.evaluate(() => window.askAndroid.session.getState().activeThread.privacy.recipients)).toEqual({ kind: 'named', ids: [DESKTOP] });
        await expect(page.locator('[data-composer-input]')).toHaveValue('Only for my desktop');
        await expectNoPrivateName(page);
      });

      test('one press during discovery is queued visibly and sent when a contributor appears', async ({ page }) => {
        await mount(page, { contributors: false });
        await page.locator('[data-composer-input]').fill('Pick 3 classic films to watch with kids.');
        const send = page.locator('[data-composer-send]');
        await expect(send).toHaveAttribute('data-send-mode', 'queue');
        await expect(send).toHaveAttribute('aria-label', 'Send when a computer is found');
        await send.click();
        await expect(page.locator('[data-model-status]')).toHaveText('Finding computers…');
        await expect(page.locator('[data-cancel-queued-send]')).toBeVisible();
        expect(await page.evaluate(() => window.askAndroid.calls.length)).toBe(0);
        await page.evaluate(() => window.askAndroid.arrive());
        await allowRemoteOnce(page);
        await expect(page.locator('[data-message-stream]')).toContainText('Contributor answer: Pick 3 classic films to watch with kids.');
        expect(await page.evaluate(() => window.askAndroid.calls.length)).toBe(1);
      });

      if (width === 390 && !largeText) {
        test('a queued press that finds nobody in 30 s keeps the text and sends nothing', async ({ page }) => {
          test.setTimeout(90000);
          await mount(page, { contributors: false });
          await page.locator('[data-composer-input]').fill('Recommend 3 holiday movies that aren’t cheesy.');
          await page.locator('[data-composer-send]').click();
          await expect(page.locator('[data-cancel-queued-send]')).toBeVisible();
          await expect(page.locator('[data-model-status]')).toHaveText('No computer answered in 30 seconds. Nothing was sent.', { timeout: 40000 });
          await expect(page.locator('[data-composer-input]')).toHaveValue('Recommend 3 holiday movies that aren’t cheesy.');
          await expect(page.locator('[data-composer-send]')).toHaveAttribute('data-send-mode', 'none');
          await expect(page.locator('[data-retry-connection]')).toHaveCount(0);
          expect(await page.evaluate(() => window.askAndroid.calls.length)).toBe(0);
          expect(await page.evaluate(() => window.askAndroid.session.getState().threads.length)).toBe(0);
        });
      }
    });
  }
}

/** The React product over the host's real chat session; a scripted contributor answers through swarm.generate. */
async function mount(page, { contributors }) {
  // The page's own boot can still navigate once (a service worker or its address cleanup) right after it renders;
  // install the fixture on the page that stays.
  for (let attempt = 0; ; attempt++) {
    try { await install(page, contributors); break; } catch (error) {
      if (attempt >= 2 || !/Execution context was destroyed/.test(error.message)) throw error;
    }
  }
  await page.locator('[data-composer-input]').waitFor();
}

async function install(page, contributors) {
  await page.goto('/');
  await page.waitForLoadState('load');
  await page.locator('[data-chat-workspace]').waitFor();
  await page.evaluate(async ({ contributors }) => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const { bindExecutionRoute, plaintextExecutionRoute } = await import('/vendor/reploid/chat/execution-policy.js');
    const model = CANONICAL_CHAT_MODELS[0], provider = 'peer:' + 'c'.repeat(24);
    const advert = { peerId: 'contributor-1', model: model.id, modelIdentity: model.identity, readiness: 'ready', role: 'provider',
      hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 };
    let peers = contributors ? [advert] : [];
    const calls = [];
    const swarm = {
      getState: () => ({ sharing: false, consumer: { connectionState: 'connected', peers } }),
      hasProvider: () => peers.length > 0, connect: async () => {}, getOwnerPairingChannel: () => null,
      async generate(messages, controls) {
        calls.push({ recipients: controls.privacy?.recipients ?? null });
        const preview = { id: crypto.randomUUID(), providerId: provider, recipientIdentity: provider, operation: 'generate', disclosure: 'public',
          modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], input: messages, expiresAt: Date.now() + 60000 };
        const request = { model, privacy: controls.privacy };
        preview.privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [provider] }));
        if (!await controls.approve(preview)) throw Error('Declined');
        await controls.record({ stage: 'approved', preview });
        const content = 'Contributor answer: ' + messages.at(-1).content;
        controls.onPartial?.(content);
        return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content, provider: 'doppler', peerId: provider };
      }
    };
    const session = createChatSession({ swarm, storage: localStorage });
    const root = document.createElement('div'); document.body.replaceChildren(root);
    mountPoolday(root, { host: { chat: session, close: async () => {} }, viewState: {} });
    window.askAndroid = { session, model, calls, arrive() { peers = [advert]; session.refreshNetwork(); } };
  }, { contributors });
}

/** The paired desktop's private name is nowhere in Ask: not in the DOM, its attributes, or the accessibility tree. */
async function expectNoPrivateName(page) {
  const html = await page.evaluate(() => document.body.outerHTML);
  expect(html).not.toContain(PRIVATE_NAME);
  expect(await page.locator('body').ariaSnapshot()).not.toContain(PRIVATE_NAME);
}

/** "Answer on" names its computer and model in full, inside the viewport, and can be reached. */
async function expectReadableAnswerOn(page) {
  const selector = page.locator('[data-open-model]');
  await expect(selector).toBeVisible();
  const facts = await selector.evaluate(button => {
    const parts = [...button.querySelectorAll('[data-composer-model-source], [data-composer-model-name], .pool-selector-compact-label')]
      .filter(part => part.getClientRects().length);
    const box = button.getBoundingClientRect();
    return { clipped: parts.filter(part => part.scrollWidth > part.clientWidth + 1 || getComputedStyle(part).textOverflow === 'ellipsis' && part.scrollWidth > part.clientWidth),
      texts: parts.map(part => part.textContent), inView: box.left >= 0 && box.right <= window.innerWidth + 1, height: box.height };
  });
  if (page.viewportSize().width <= 390) expect(facts.texts).toEqual(['Answer on']);
  else {
    expect(facts.texts[0]).toBe('Contributors');
    expect(facts.texts[1]?.length).toBeGreaterThan(3);
  }
  expect(facts.clipped).toEqual([]);
  expect(facts.inView).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await selector.click();
  await expect(page.locator('[data-model-picker]')).toBeVisible();
  await page.locator('[data-model-picker-close]').click();
}

/** Every starter is a movie or show question, fully shown above the composer, and never under it. */
async function expectStartersClear(page) {
  const chips = page.locator('[data-starting-prompt]');
  await expect(chips).toHaveCount(3);
  for (const chip of await chips.all()) {
    await expect(chip).toHaveText(/\b(movies?|films?|shows?|series|miniseries|sitcom|episodes?|documentar(y|ies)|specials|musicals)\b/i);
    await chip.scrollIntoViewIfNeeded();
    const clear = await chip.evaluate(element => {
      const box = element.getBoundingClientRect(), composer = document.querySelector('[data-composer-area]').getBoundingClientRect();
      const transcript = document.querySelector('[data-chat-transcript]').getBoundingClientRect();
      return { aboveComposer: box.bottom <= composer.top + 0.5, insideTranscript: box.top >= transcript.top - 0.5 && box.bottom <= transcript.bottom + 0.5,
        inWidth: box.left >= 0 && box.right <= window.innerWidth + 0.5, wholeText: element.scrollWidth <= element.clientWidth + 1 };
    });
    expect(clear).toEqual({ aboveComposer: true, insideTranscript: true, inWidth: true, wholeText: true });
  }
}

/** Nothing lies over the composer's controls: each one is the element hit at its top, centre and bottom (not the dock). */
async function expectComposerUncovered(page) {
  const covered = await page.evaluate(() => [...document.querySelectorAll('[data-composer-toolbar] > *, [data-composer-input]')].filter(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    // Its centre and both edges: a dock that covers only the lower half still covers it.
    return [box.top + 2, box.top + box.height / 2, box.bottom - 2].some(y => {
      const hit = document.elementFromPoint(box.left + box.width / 2, y);
      return !(hit && (element === hit || element.contains(hit)));
    });
  }).map(element => element.getAttribute('aria-label') || element.outerHTML.slice(0, 60)));
  expect(covered).toEqual([]);
}
