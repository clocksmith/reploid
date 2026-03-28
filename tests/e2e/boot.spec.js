/**
 * E2E Test: Boot Flow
 * Covers the current wizard homepage and product mode switch.
 */
import { test, expect } from '@playwright/test';

const APP_PATH = '/src/index.html';
const HOME_PATH = '/';
const DEFAULT_HOME_GOAL_SNIPPET = 'Build a live self-improvement control room for this runtime';

async function openBoot(page) {
  await page.goto(APP_PATH);
  await page.waitForSelector('.boot-mode-btn[data-mode="reploid"]', { timeout: 20000 });
}

async function openHome(page) {
  await page.goto(HOME_PATH);
  await page.waitForSelector('.inference-bar', { timeout: 20000 });
}

async function unlockGoalSection(page) {
  await openBoot(page);
  await page.click('[data-action="choose-browser"]');
  await page.click('[data-model="smollm2-360m"]');
  await expect(page.locator('#goal-input')).toBeVisible();
}

async function unlockAwakenSection(page) {
  await unlockGoalSection(page);
  await page.locator('#goal-input').fill('Boot into capsule');
  await expect(page.locator('#awaken-btn')).toBeVisible();
}

test.describe('Boot Screen', () => {
  test('loads with product modes and no duplicate mode heading', async ({ page }) => {
    await openBoot(page);

    await expect(page).toHaveTitle(/Reploid/i);
    await expect(page.locator('.wizard-mode-title')).toHaveCount(0);
    await expect(page.locator('.wizard-mode-copy .type-h1')).toHaveText('Choose runtime mode');
    await expect(page.locator('.boot-mode-btn.selected[data-mode="reploid"] .boot-mode-label')).toContainText('Reploid');

    const bootModes = page.locator('.boot-mode-btn[data-mode]');
    await expect(bootModes).toHaveCount(3);
  });

  test('has Reploid selected by default', async ({ page }) => {
    await openBoot(page);
    await page.waitForSelector('.boot-mode-btn.selected[data-mode="reploid"]', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn.selected[data-mode="reploid"] .boot-mode-label')).toContainText('Reploid');
  });

  test('ignores stale saved mode and genesis on first load', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('REPLOID_MODE', 'zero');
      localStorage.setItem('REPLOID_GENESIS_LEVEL', 'full');
    });

    await openBoot(page);
    await page.waitForSelector('.boot-mode-btn.selected[data-mode="reploid"]', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn.selected[data-mode="reploid"] .boot-mode-label')).toContainText('Reploid');
    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await page.locator('#goal-input').fill('Verify default mode mapping');
    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('capsule');
  });

  test('shows all three product modes', async ({ page }) => {
    await openBoot(page);

    await expect(page.locator('.boot-mode-btn[data-mode="reploid"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="zero"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="x"]')).toBeVisible();
  });

  test('allows switching modes with single selection', async ({ page }) => {
    await openBoot(page);

    const zeroMode = page.locator('.boot-mode-btn[data-mode="reploid"]');
    const xMode = page.locator('.boot-mode-btn[data-mode="x"]');

    await expect(zeroMode).toHaveClass(/selected/);
    await xMode.click();
    await expect(xMode).toHaveClass(/selected/);
    await expect(zeroMode).not.toHaveClass(/selected/);
  });
});

test.describe('Route Entry Points', () => {
  test('home route boots without early VFS misses for instance-scoped runtime modules', async ({ page }) => {
    const vfsMisses = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[SW] Missing module in VFS:')) {
        vfsMisses.push(text);
      }
    });

    await openHome(page);
    await page.waitForTimeout(250);

    expect(
      vfsMisses.filter((text) => (
        text.includes('/self/instance.js') || text.includes('/core/utils.js')
      ))
    ).toEqual([]);
  });

  test('home route boots Reploid with minimal inference controls', async ({ page }) => {
    await openHome(page);

    await expect(page.locator('.boot-mode-btn[data-mode]')).toHaveCount(0);
    await expect(page.locator('.wizard-brand')).toHaveCount(0);
    await expect(page.locator('.inference-bar-label')).toHaveText('No local inference');
    await expect(page.locator('.inference-bar-model')).toHaveCount(0);
    await expect(page.locator('.inference-bar-note')).toContainText('Use Configure to attach your own inference');
    await expect(page.locator('.inference-bar-shared-details')).toHaveCount(0);
    await expect(page.locator('#reploid-use-own-inference')).toBeVisible();
    await expect(page.locator('#reploid-swarm-enabled')).toBeVisible();
    await expect(page.locator('[data-action="advanced-settings"]')).toHaveCount(0);
    await expect(page.locator('[data-action="choose-browser"]')).toHaveCount(0);
    await expect(page.locator('#goal-input')).toHaveValue(new RegExp(DEFAULT_HOME_GOAL_SNIPPET));
    await expect(page.locator('[data-action="generate-goal"]')).toBeVisible();
    await expect(page.locator('[data-action="shuffle-goals"]')).toHaveCount(0);
    await expect(page.locator('[data-action="toggle-goal-category"]')).toHaveCount(0);
    await expect(page.locator('.goal-level-dropdown')).toHaveCount(0);
    await expect(page.locator('.seed-browser-panel')).not.toHaveAttribute('open', '');
    await expect(page.locator('#awaken-btn')).toBeDisabled();
    await expect(page.locator('.seed-browser-summary #awaken-btn')).toBeVisible();
    await expect(page.locator('.wizard-awaken')).toHaveCount(0);
    await expect(page.locator('#environment-input')).toHaveCount(0);
    await expect(page.locator('.seed-browser-panel')).toContainText('Awakened files');
    await expect(page.getByRole('link', { name: 'Open fresh peer' })).toBeVisible();
  });

  test('home route can draft a seeded goal before inference is configured', async ({ page }) => {
    await openHome(page);

    const goalInput = page.locator('#goal-input');
    await goalInput.fill('');
    await page.locator('[data-action="generate-goal"]').click();

    await expect(goalInput).not.toHaveValue('');
    await expect(page.locator('.goal-toolbar-status')).toContainText('hidden seed prompt');
  });

  test('home route can awaken as a swarm consumer without local inference', async ({ page }) => {
    await openHome(page);

    const swarmCheckbox = page.locator('#reploid-swarm-enabled');
    await page.locator('#goal-input').fill('Wait for provider peers');
    await expect(page.locator('#awaken-btn')).toBeDisabled();
    await swarmCheckbox.check();
    await expect(swarmCheckbox).toBeChecked();
    expect(await swarmCheckbox.evaluate((input) => {
      const styles = getComputedStyle(input);
      return styles.appearance || styles.getPropertyValue('-webkit-appearance') || '';
    })).not.toBe('none');
    await expect(page.locator('.inference-bar-label')).toHaveText('Peer inference');
    await expect(page.locator('.inference-bar-note')).toContainText('wait for a provider peer');
    await expect(page.locator('#awaken-btn')).toBeEnabled();
    await expect(page.locator('.wizard-awaken')).toHaveCount(0);
  });

  test('/0 locks the boot mode to Zero', async ({ page }) => {
    await page.goto('/0');
    await page.waitForSelector('.wizard-home-provider [data-action="choose-browser"]', { timeout: 20000 });

    await expect(page.locator('.boot-mode-btn[data-mode]')).toHaveCount(0);
    await expect(page.locator('.wizard-brand')).toHaveCount(0);
    await expect(page.locator('.wizard-home-provider .type-h1')).toHaveText('Choose inference provider');
    await expect(page.locator('[data-action="choose-browser"]')).toBeVisible();
    await expect(page.locator('[data-action="advanced-settings"]')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.getReploidMode())).toBe('zero');
  });

  test('/x locks the boot mode to X', async ({ page }) => {
    await page.goto('/x');
    await page.waitForSelector('.wizard-home-provider [data-action="choose-direct"]', { timeout: 20000 });

    await expect(page.locator('.boot-mode-btn[data-mode]')).toHaveCount(0);
    await expect(page.locator('.wizard-brand')).toHaveCount(0);
    await expect(page.locator('.wizard-home-provider .type-h1')).toHaveText('Choose inference provider');
    await expect(page.locator('[data-action="choose-direct"]')).toBeVisible();
    await expect(page.locator('[data-action="advanced-settings"]')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.getReploidMode())).toBe('x');
  });
});

test.describe('Same-Origin Multi-Peer', () => {
  test('opens a new peer in the same browser context with isolated instance, identity, and self state', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify({
        peerId: 'peer:legacy-shared',
        publicJwk: { x: 'legacy' },
        privateJwk: { d: 'legacy' },
        contribution: {}
      }));
    });
    const page = await context.newPage();

    const getPeerState = async (targetPage) => targetPage.evaluate(async () => {
      const instanceId = window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null;
      const snapshot = window.REPLOID?.runtime?.getSnapshot?.() || null;
      const dbName = instanceId ? `reploid-vfs-v0--${instanceId}` : 'reploid-vfs-v0';

      const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readEntry = async (db, path) => new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').get(path);
        request.onsuccess = () => resolve(request.result?.content || null);
        request.onerror = () => reject(request.error);
      });

      const db = await openDb();
      return {
        instanceId,
        dbName,
        snapshot: snapshot ? {
          instanceId: snapshot.instanceId,
          peerId: snapshot.swarm?.peerId || null
        } : null,
        selfJson: await readEntry(db, '/self/self.json')
      };
    });

    try {
      await openHome(page);

      const [peerPage] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('link', { name: 'Open new peer' }).click()
      ]);

      await peerPage.waitForLoadState('domcontentloaded');
      await peerPage.waitForSelector('.inference-bar', { timeout: 20000 });

      const firstInstanceId = await page.evaluate(() => window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null);
      const secondInstanceId = await peerPage.evaluate(() => window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null);

      expect(firstInstanceId).toBeTruthy();
      expect(secondInstanceId).toBeTruthy();
      expect(firstInstanceId).not.toBe(secondInstanceId);

      await page.locator('#goal-input').fill('Peer alpha objective');
      await page.locator('#reploid-swarm-enabled').check();
      await page.locator('#awaken-btn').click();

      await peerPage.locator('#goal-input').fill('Peer beta objective');
      await peerPage.locator('#reploid-swarm-enabled').check();
      await peerPage.locator('#awaken-btn').click();

      await page.waitForSelector('#app.active', { timeout: 20000 });
      await peerPage.waitForSelector('#app.active', { timeout: 20000 });

      const firstPeer = await getPeerState(page);
      const secondPeer = await getPeerState(peerPage);
      const firstSelf = JSON.parse(firstPeer.selfJson);
      const secondSelf = JSON.parse(secondPeer.selfJson);

      expect(firstPeer.instanceId).toBe(firstInstanceId);
      expect(secondPeer.instanceId).toBe(secondInstanceId);
      expect(firstPeer.dbName).not.toBe(secondPeer.dbName);
      expect(firstPeer.snapshot?.instanceId).toBe(firstInstanceId);
      expect(secondPeer.snapshot?.instanceId).toBe(secondInstanceId);
      expect(firstPeer.snapshot?.peerId).toBeTruthy();
      expect(secondPeer.snapshot?.peerId).toBeTruthy();
      expect(firstPeer.snapshot?.peerId).not.toBe(secondPeer.snapshot?.peerId);
      expect(firstSelf.goal).toContain('Peer alpha objective');
      expect(secondSelf.goal).toContain('Peer beta objective');
      expect(firstSelf.instanceId).toBe(firstInstanceId);
      expect(secondSelf.instanceId).toBe(secondInstanceId);
    } finally {
      await context.close();
    }
  });

  test('rotates the active peer identity after awaken instead of keeping the legacy peer', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify({
        peerId: 'peer:legacy-shared',
        publicJwk: { x: 'legacy' },
        privateJwk: { d: 'legacy' },
        contribution: {}
      }));
    });

    await openHome(page);
    await page.locator('#goal-input').fill('Rotate the active peer identity');
    await page.locator('#reploid-swarm-enabled').check();
    await page.locator('#awaken-btn').click();
    await page.waitForSelector('#app.active', { timeout: 20000 });

    await expect.poll(async () => page.evaluate(() => (
      window.REPLOID?.runtime?.getSnapshot?.()?.swarm?.peerId || null
    ))).toBe('peer:legacy-shared');

    const rotateButton = page.getByRole('button', { name: 'Rotate peer ID' });
    await expect(rotateButton).toBeEnabled();
    await rotateButton.click();

    await expect.poll(async () => page.evaluate(() => (
      window.REPLOID?.runtime?.getSnapshot?.()?.swarm?.peerId || null
    ))).not.toBe('peer:legacy-shared');
  });

  test('same-origin provider and consumer discover each other over swarm transport', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const getSwarmSnapshot = async (targetPage) => targetPage.evaluate(() => {
      const swarm = window.REPLOID?.runtime?.getSnapshot?.()?.swarm || null;
      return swarm ? {
        role: swarm.role,
        peerCount: swarm.peerCount,
        providerCount: swarm.providerCount,
        transport: swarm.transport,
        connectionState: swarm.connectionState,
        peerId: swarm.peerId
      } : null;
    });

    try {
      await openHome(page);

      const [peerPage] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('link', { name: 'Open new peer' }).click()
      ]);

      await peerPage.waitForLoadState('domcontentloaded');
      await peerPage.waitForSelector('.inference-bar', { timeout: 20000 });

      await page.locator('#goal-input').fill('Serve swarm peers');
      await page.locator('#reploid-use-own-inference').click();
      await page.selectOption('#direct-provider', 'gemini');
      await expect(page.locator('#direct-model')).toHaveValue('gemini-3.1-flash-lite-preview');
      await page.locator('#direct-key').fill('test-key');
      await page.locator('#reploid-swarm-enabled').check();
      await page.locator('#awaken-btn').click();

      await peerPage.locator('#goal-input').fill('Borrow swarm inference');
      await peerPage.locator('#reploid-swarm-enabled').check();
      await peerPage.locator('#awaken-btn').click();

      await page.waitForSelector('#app.active', { timeout: 20000 });
      await peerPage.waitForSelector('#app.active', { timeout: 20000 });

      await expect.poll(async () => {
        const swarm = await getSwarmSnapshot(page);
        return swarm ? {
          role: swarm.role,
          peerCount: swarm.peerCount,
          transport: swarm.transport,
          connectionState: swarm.connectionState,
          peerId: swarm.peerId
        } : null;
      }, { timeout: 20000 }).toEqual(expect.objectContaining({
        role: 'provider',
        peerCount: 1,
        connectionState: 'connected'
      }));

      await expect.poll(async () => {
        const swarm = await getSwarmSnapshot(peerPage);
        return swarm ? {
          role: swarm.role,
          peerCount: swarm.peerCount,
          providerCount: swarm.providerCount,
          transport: swarm.transport,
          connectionState: swarm.connectionState,
          peerId: swarm.peerId
        } : null;
      }, { timeout: 20000 }).toEqual(expect.objectContaining({
        role: 'consumer',
        peerCount: 1,
        providerCount: 1,
        connectionState: 'connected'
      }));
    } finally {
      await context.close();
    }
  });
});

test.describe('Connection Selection', () => {
  test('shows Doppler, direct, and proxy brain options', async ({ page }) => {
    await openBoot(page);

    await expect(page.locator('[data-action="choose-browser"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-browser"]')).toContainText('Doppler');
    await expect(page.locator('[data-action="choose-direct"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-proxy"]')).toBeVisible();
  });

  test('does not show a separate Doppler local-model path in direct mode', async ({ page }) => {
    await openBoot(page);

    await page.click('[data-action="choose-direct"]');

    await expect(page.locator('#enable-doppler')).toHaveCount(0);
    await expect(page.locator('#doppler-model-inline')).toHaveCount(0);
  });
});

test.describe('Advanced Mapping', () => {
  test('defaults Reploid to the capsule genesis level', async ({ page }) => {
    await unlockAwakenSection(page);

    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('capsule');
  });

  test('maps X to the full genesis level', async ({ page }) => {
    await openBoot(page);

    await page.click('.boot-mode-btn[data-mode="x"]');
    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await page.locator('#goal-input').fill('Boot into X');
    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('full');
  });
});

test.describe('Goal Input', () => {
  test('shows ordered placeholders and unlocks the goal input after inference config', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await openBoot(page);
    const goalInput = page.locator('#goal-input');

    if (await goalInput.isVisible().catch(() => false)) {
      await expect(goalInput).toBeVisible();
      return;
    }

    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await expect(goalInput).toBeVisible();
  });

  test('shows the self tree browser in Reploid', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('.seed-browser-panel')).toBeVisible();
    await expect(page.locator('.seed-browser-panel')).toContainText('Self tree');
    await expect(page.locator('.seed-browser-panel')).toContainText('/self/self.json');
    await expect(page.locator('[data-action="select-self-path"][data-path="/self/boot.json"]')).toBeVisible();
    await expect(page.locator('[data-action="select-self-path"][data-path="/self/runtime.js"]')).toBeVisible();
    await expect(page.locator('[data-action="select-self-path"][data-path="/self/capsule/index.js"]')).toBeVisible();
    await expect(page.locator('.seed-viewer-panel')).toContainText('/self/self.json');
    await expect(page.locator('.seed-viewer-panel')).toContainText('"visibleTools"');
    await expect(page.locator('.boot-debug-panel')).not.toHaveAttribute('open', '');
    await expect(page.locator('.seed-viewer-panel')).toContainText('"selfHosted": true');
  });

  test('shows Reploid environment editor without bootstrapper toggle', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('#environment-input')).toBeVisible();
    await expect(page.locator('[data-action="apply-environment-template"]')).toHaveCount(5);
    await expect(page.locator('#include-bootstrapper-within-self')).toHaveCount(0);
  });

  test('shows runtime preset rail and a single dropdown for the active level', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('[data-action="toggle-goal-category"]')).toHaveCount(5);
    await expect(page.locator('.goal-level-dropdown')).toBeVisible();
    await expect(page.locator('.goal-level-dropdown')).toContainText('L0: Basic Functions');
    await expect(page.locator('.goal-level-dropdown-list .goal-chip')).toHaveCount(5);
  });

  test('shows generated-goal action', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('[data-action="shuffle-goals"]')).toBeVisible();
    await expect(page.locator('[data-action="generate-goal"]')).toBeVisible();
    await expect(page.locator('[data-action="generate-goal"]')).toHaveText('Generate');
  });

  test('shuffle presets updates the goal input', async ({ page }) => {
    await unlockGoalSection(page);

    const goalInput = page.locator('#goal-input');
    await goalInput.fill('');
    await page.locator('[data-action="shuffle-goals"]').click();
    await expect(goalInput).not.toHaveValue('');
  });

  test('switches the preset dropdown when choosing a different runtime level', async ({ page }) => {
    await unlockGoalSection(page);

    await page.locator('[data-action="toggle-goal-category"][data-category="L2: Substrate"]').click();
    await expect(page.locator('.goal-level-dropdown')).toContainText('L2: Substrate');
    await expect(page.locator('.goal-level-dropdown-list .goal-chip')).toHaveCount(5);
    await expect(page.locator('.goal-level-dropdown')).toContainText('Twin capsule lab');
  });

  test('awaken button exists', async ({ page }) => {
    await unlockAwakenSection(page);

    await expect(page.locator('#awaken-btn')).toBeVisible();
  });

  test('enforces goal maxlength (500 chars)', async ({ page }) => {
    await unlockGoalSection(page);

    const goalInput = page.locator('#goal-input');
    await expect(goalInput).toHaveAttribute('maxlength', '500');
  });
});

test.describe('Reploid Runtime', () => {
  test('awakens into capsule instead of the zero shell', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await openHome(page);
    await page.locator('#goal-input').fill('Boot into Capsule');
    await page.locator('#reploid-swarm-enabled').check();
    await page.locator('#awaken-btn').click();

    await page.waitForSelector('#app.active', { timeout: 20000 });
    await expect(page.locator('.capsule-shell')).toBeVisible();
    await expect(page.locator('.zero-shell')).toHaveCount(0);
    await expect(page.locator('#history-container')).toBeVisible();
    await expect(page.locator('#zero-human-form')).toHaveCount(0);
    await page.waitForFunction(() => {
      const snapshot = window.REPLOID?.runtime?.getSnapshot?.();
      return !!(snapshot && snapshot.context?.length >= 1 && snapshot.renderedText?.includes('[BOOT]'));
    }, { timeout: 5000 });

    const capsuleSnapshot = await page.evaluate(() => {
      const snapshot = window.REPLOID?.runtime?.getSnapshot?.();
      if (!snapshot) return null;
      return {
        renderedText: snapshot.renderedText,
        context: snapshot.context.map(({ role, origin, content }) => ({ role, origin, content }))
      };
    });

    const vfsState = await page.evaluate(async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const instanceId = window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null;
        const dbName = instanceId ? `reploid-vfs-v0--${instanceId}` : 'reploid-vfs-v0';
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readEntry = async (db, path) => new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').get(path);
        request.onsuccess = () => resolve(request.result?.content || null);
        request.onerror = () => reject(request.error);
      });
      const listKeys = async (db) => new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').getAllKeys();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      const db = await openDb();
      return {
        self: await readEntry(db, '/self/self.json'),
        keys: await listKeys(db)
      };
    });

    const self = JSON.parse(vfsState.self);
    expect(capsuleSnapshot).not.toBeNull();
    expect(capsuleSnapshot.renderedText).toContain('[BOOT]');
    expect(capsuleSnapshot.renderedText).toContain('Self:');
    expect(capsuleSnapshot.renderedText).not.toContain('Goal:');
    expect(capsuleSnapshot.renderedText).not.toContain('Environment:');
    expect(capsuleSnapshot.renderedText).not.toContain('[USER]');
    expect(capsuleSnapshot.renderedText).not.toContain('[ASSISTANT]');
    expect(capsuleSnapshot.context.slice(0, 1).map((msg) => msg.origin)).toEqual(['bootstrap']);
    expect(capsuleSnapshot.context.some((msg) => msg.origin === 'system')).toBe(true);
    expect(vfsState.keys).not.toContain('/.system/prompt.txt');
    expect(vfsState.keys).not.toContain('/.system/goal.txt');
    expect(vfsState.keys).not.toContain('/.system/environment.txt');
    expect(vfsState.keys).toContain('/self/self.json');
    expect(vfsState.keys).toContain('/self/boot.json');
    expect(vfsState.keys).toContain('/self/identity.json');
    expect(vfsState.keys.some((key) => key.startsWith('/bootstrapper/'))).toBe(false);
    expect(self.bootstrapperIncluded).toBeUndefined();
    expect(self.selfPath).toBe('/self/self.json');
    expect(self.bootPath).toBe('/self/boot.json');
    expect(self.boot.host.startEntry).toBe('/self/host/start-app.js');
    expect(self.boot.kernel.bootEntry).toBe('/self/kernel/boot.js');
    expect(self.goal).toContain('Boot into Capsule');
    expect(self.environment).toContain('Browser-hosted JavaScript runtime with VFS and OPFS.');
    expect(self.selfHosted).toBe(true);
    expect(self.selfModifiable).toBe(true);
    expect(self.networkMode).toBe('swarm');
  });
});
