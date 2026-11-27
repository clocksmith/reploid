/**
 * Keyboard, focus and narrow-screen parity of the shipped Poolday screens (/, /network, /work, the
 * workspace drawers including Computers and Settings, and the specialist pages). No GPU: the
 * conversation journeys use a scripted executor (as conversation-acceptance.spec.js does) and the
 * other pages render without one. Run with `npm run test:e2e:ui` (tests/playwright.ui.config.js).
 */
import { test, expect } from '@playwright/test';
import { allowRemoteOnce } from '../fixtures/remote-permission.js';

const NARROW = [320, 390];
const PAGES = ['/', '/network', '/work', '/ask', '/compute', '/records', '/room-1', '/improve', '/examples', '/experiments'];
const DRAWERS = [
  { view: 'threads', bar: '[data-toggle-thread-rail]' },
  { view: 'conversation', bar: '[data-workspace-view="conversation"]' },
  { view: 'computers', bar: '[data-workspace-view="computers"]' },
  { view: 'settings', bar: '[data-workspace-view="settings"]' },
];

async function open(page, path) {
  await page.goto(path);
  await page.locator('[data-route-page], [data-chat-workspace]').first().waitFor();
}

/** Opens every disclosure that is showing (nested ones appear after their parent opens). */
async function expandAll(page) {
  for (let pass = 0; pass < 4; pass++) {
    const opened = await page.evaluate(() => {
      let count = 0;
      for (const details of document.querySelectorAll('details:not([open])')) {
        if (details.closest('[hidden], dialog:not([open]), .pool-menu') || details.classList.contains('pool-menu')) continue;
        details.open = true;
        count += 1;
      }
      return count;
    });
    if (!opened) break;
  }
}

/** Page overflow, and controls that reach past the viewport (inside a region that scrolls on its own is fine). */
function layoutProblems() {
  const width = window.innerWidth;
  const problems = [];
  const overflow = document.documentElement.scrollWidth - width;
  if (overflow > 0) problems.push(`page scrolls sideways by ${overflow}px`);
  const controls = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="switch"], [role="radio"]';
  const scrollsOnItsOwn = (element) => {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (['auto', 'scroll'].includes(style.overflowX) && node.scrollWidth > node.clientWidth) {
        const box = node.getBoundingClientRect();
        return box.left >= -1 && box.right <= width + 1;
      }
    }
    return false;
  };
  for (const control of document.querySelectorAll(controls)) {
    if (control.closest('[hidden], dialog:not([open]), details:not([open]) > :not(summary)')) continue;
    const box = control.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(control).visibility === 'hidden') continue;
    if ((box.right > width + 1 || box.left < -1) && !scrollsOnItsOwn(control)) {
      const name = control.getAttribute('aria-label') || control.textContent.trim().slice(0, 40) || control.tagName;
      problems.push(`${name} spans ${Math.round(box.left)}..${Math.round(box.right)} of ${width}`);
    }
  }
  return problems;
}

/** What has focus, whether a ring shows on it (or on the field that wraps it), and whether it is in view. */
function focusState() {
  const element = document.activeElement;
  if (!element || element === document.body) return null;
  const ring = (node) => {
    if (!node) return false;
    const style = getComputedStyle(node);
    return (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || (style.boxShadow && style.boxShadow !== 'none');
  };
  const box = element.getBoundingClientRect();
  return {
    name: (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 50),
    programmatic: element.getAttribute('tabindex') === '-1',
    ring: ring(element) || ring(element.closest('.pool-focus-within')) || ring(element.closest('.pool-choice, .pool-option, .pool-segment')),
    inView: box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth,
    inDrawer: !!element.closest('.pool-drawer'),
    inDialog: !!element.closest('dialog[open]'),
    inBar: !!element.closest('.pool-workspace-bar'),
    inMain: !!element.closest('.pool-workspace-main'),
  };
}

async function tabThrough(page, count) {
  const seen = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(focusState);
    if (state) seen.push(state);
  }
  return seen;
}

test.describe('narrow screens', () => {
  for (const width of NARROW) {
    test(`${width}px: no sideways scroll and no clipped controls on any page or drawer`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const targets = [...PAGES, ...DRAWERS.map((drawer) => `/?view=${drawer.view}`)];
      const problems = [];
      for (const target of targets) {
        await open(page, target);
        await expandAll(page);
        for (const problem of await page.evaluate(layoutProblems)) problems.push(`${target}: ${problem}`);
      }
      expect(problems).toEqual([]);
    });
  }

  test('320px: dialogs fit the screen and show the control that takes focus', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, '/');
    for (const opener of ['[data-open-model]', '[data-open-privacy]']) {
      await page.locator(opener).first().focus();
      await page.keyboard.press('Enter');
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await page.evaluate(layoutProblems)).toEqual([]);
      const state = await page.evaluate(focusState);
      expect(state?.inDialog).toBe(true);
      expect(state?.inView).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(opener).first()).toBeFocused();
    }
  });
});

test.describe('keyboard and focus', () => {
  test('every control in the workspace and its drawers shows a focus ring when tabbed to', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const missing = [];
    for (const target of ['/', ...DRAWERS.map((drawer) => `/?view=${drawer.view}`), '/ask', '/records', '/examples']) {
      await open(page, target);
      for (const state of await tabThrough(page, 40)) {
        if (!state.programmatic && !state.ring) missing.push(`${target}: ${state.name}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  for (const width of [390, 1280]) {
    test(`${width}px: a drawer opened from the bar takes focus, Escape closes it and focus returns`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, '/');
      for (const drawer of DRAWERS) {
        const bar = page.locator(drawer.bar).first();
        await bar.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`view=${drawer.view}`));
        const panel = page.locator('.pool-drawer:not([hidden])');
        await expect(panel.locator('h2')).toBeFocused();
        if (width < 760) {
          // The drawer covers the conversation: Tab stays with the drawer and the bar, never the hidden page.
          const seen = await tabThrough(page, 30);
          expect(seen.filter((state) => state.inMain).map((state) => state.name)).toEqual([]);
          expect(seen.some((state) => state.inDrawer)).toBe(true);
        } else {
          await page.keyboard.press('Tab');
        }
        // From inside the drawer, or (on a phone) from the bar, Escape closes it.
        if (width >= 760) await panel.locator('[data-drawer-close]').focus();
        await page.keyboard.press('Escape');
        await expect(page).not.toHaveURL(new RegExp(`view=${drawer.view}`));
        await expect(page.locator('.pool-drawer:not([hidden])')).toHaveCount(0);
        if (width >= 760) await expect(bar).toBeFocused();
        else expect((await page.evaluate(focusState))?.inBar).toBe(true);
      }
    });
  }

  test('the Answer on and privacy dialogs keep Tab inside, close on Escape and return focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await open(page, '/');
    for (const opener of ['[data-open-model]', '[data-open-privacy]']) {
      await page.locator(opener).first().focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('dialog[open]')).toBeVisible();
      const seen = await tabThrough(page, 20);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.filter((state) => !state.inDialog).map((state) => state.name)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(page.locator(opener).first()).toBeFocused();
    }
  });

  test('a dialog opened inside a drawer closes on Escape without closing the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mountScripted(page);
    await page.locator('[data-workspace-view="settings"]').click();
    const remove = page.locator('[data-storage-remove="stored-model"]');
    await remove.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    expect((await page.evaluate(focusState))?.inDialog).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/view=settings/);
    await expect(page.locator('.pool-drawer:not([hidden])')).toHaveCount(1);
    await expect(remove).toBeFocused();
  });
});

// A scripted conversation (as conversation-acceptance.spec.js mounts it), so the Threads list has a thread.
const fixturePartition = { planId: 'fixture', participantA: 'peer:' + 'a'.repeat(24), participantB: 'peer:' + 'b'.repeat(24) };
async function mountScripted(page) {
  const { LOCAL_DOPPLER_MODELS } = await import('../../shared/config/doppler-local-models.js');
  const release = JSON.stringify({ approvals: [{ modelId: LOCAL_DOPPLER_MODELS[0].id, modelIdentity: LOCAL_DOPPLER_MODELS[0].identity,
    adapterIdentities: [], evidence: 'Scripted keyboard fixture only', partition: fixturePartition }] });
  await page.route('**/config/partition-releases.json', (route) => route.fulfill({ contentType: 'application/json', body: release }));
  await page.goto('/');
  await page.locator('[data-chat-workspace]').waitFor();
  await page.evaluate(async (partition) => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const { partitionPrivacyBinding, createExecutionPolicy } = await import('/vendor/reploid/chat/execution-policy.js');
    const model = { ...CANONICAL_CHAT_MODELS[0], selectionId: 'test-partition', availability: 'ready', partition };
    const partitions = {
      getModels: () => [model],
      subscribe: () => () => undefined,
      async generate(request, controls) {
        const ids = { threadId: request.threadId, attemptId: request.attemptId };
        const recipients = [partition.participantA, partition.participantB];
        const privacyBinding = await partitionPrivacyBinding(request, recipients, partition);
        const approved = await controls.requestApproval({ ...ids, id: crypto.randomUUID(), peerId: partition.participantA, privacyBinding,
          recipientIdentity: partition.participantA, participantA: partition.participantA, participantB: partition.participantB,
          planId: partition.planId, operation: 'generate-partition', disclosure: 'partition-activations-and-tokens',
          modelId: model.id, modelIdentity: model.identity, adapterIdentities: [],
          input: { messages: request.messages, recipients }, expiresAt: Date.now() + 60000 });
        if (!approved) throw Error('Disclosure declined');
        controls.onDelta({ ...ids, sequence: 0, text: 'Scripted answer.' });
        return { ...ids, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'Scripted answer.' };
      },
    };
    const swarm = { getState: () => ({ sharing: false, consumer: { peers: [] } }), async connect() {} };
    const session = createChatSession({ partitions, swarm, storage: localStorage });
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
    // One stored download, so Settings offers the Remove confirmation.
    const modelStorage = { list: async () => [{ id: 'stored-model', name: 'Stored model', sizeBytes: 1048576 }], remove: async () => undefined };
    mountPoolday(root, { host: { chat: session, modelStorage, close: async () => {} }, viewState: { privacy, chosenModel: model, executionLocation: 'network' } });
    window.journey = { session };
  }, fixturePartition);
}

test('Threads: the actions menu and Rename work from the keyboard and give focus back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mountScripted(page);
  await page.locator('[data-composer-input]').fill('A question for the thread list');
  await page.locator('[data-composer-send]').click();
  await allowRemoteOnce(page);
  await expect(page.locator('[data-message-role="assistant"]')).toContainText('Scripted answer.');
  await page.locator('[data-toggle-thread-rail]').focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('.pool-drawer:not([hidden]) .pool-menu summary').first();
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.pool-drawer:not([hidden]) .pool-menu[open]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pool-menu[open]')).toHaveCount(0);
  await expect(menu).toBeFocused();
  await expect(page).toHaveURL(/view=threads/);
  // Tabbing away closes the menu too.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('.pool-menu[open]')).toHaveCount(0);
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.locator('.pool-menu[open] [data-rename-thread]').focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  expect((await page.evaluate(focusState))?.inDialog).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();
  await expect(page).toHaveURL(/view=threads/);
});
