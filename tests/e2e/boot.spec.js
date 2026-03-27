/**
 * E2E Test: Boot Flow
 * Covers the current wizard homepage and product mode switch.
 */
import { test, expect } from '@playwright/test';

const APP_PATH = '/src/index.html';
const HOME_PATH = '/';

async function openBoot(page) {
  await page.goto(APP_PATH);
  await page.waitForSelector('.boot-mode-btn[data-mode="absolute_zero"]', { timeout: 20000 });
}

async function openHome(page) {
  await page.goto(HOME_PATH);
  await page.waitForSelector('.wizard-home-provider [data-action="choose-browser"]', { timeout: 20000 });
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
    await expect(page.locator('.boot-mode-btn.selected[data-mode="absolute_zero"] .boot-mode-label')).toContainText('Absolute Zero');

    const bootModes = page.locator('.boot-mode-btn[data-mode]');
    await expect(bootModes).toHaveCount(3);
  });

  test('has Absolute Zero selected by default', async ({ page }) => {
    await openBoot(page);
    await page.waitForSelector('.boot-mode-btn.selected[data-mode="absolute_zero"]', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn.selected[data-mode="absolute_zero"] .boot-mode-label')).toContainText('Absolute Zero');
  });

  test('ignores stale saved mode and genesis on first load', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('REPLOID_MODE', 'zero');
      localStorage.setItem('REPLOID_GENESIS_LEVEL', 'full');
    });

    await openBoot(page);
    await page.waitForSelector('.boot-mode-btn.selected[data-mode="absolute_zero"]', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn.selected[data-mode="absolute_zero"] .boot-mode-label')).toContainText('Absolute Zero');
    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await page.locator('#goal-input').fill('Verify default mode mapping');
    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('capsule');
  });

  test('shows all three product modes', async ({ page }) => {
    await openBoot(page);

    await expect(page.locator('.boot-mode-btn[data-mode="absolute_zero"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="zero"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="x"]')).toBeVisible();
  });

  test('allows switching modes with single selection', async ({ page }) => {
    await openBoot(page);

    const zeroMode = page.locator('.boot-mode-btn[data-mode="absolute_zero"]');
    const xMode = page.locator('.boot-mode-btn[data-mode="x"]');

    await expect(zeroMode).toHaveClass(/selected/);
    await xMode.click();
    await expect(xMode).toHaveClass(/selected/);
    await expect(zeroMode).not.toHaveClass(/selected/);
  });
});

test.describe('Route Entry Points', () => {
  test('home route boots Absolute Zero without the mode selector or intro title stack', async ({ page }) => {
    await openHome(page);

    await expect(page.locator('.boot-mode-btn[data-mode]')).toHaveCount(0);
    await expect(page.locator('.wizard-brand')).toHaveCount(0);
    await expect(page.locator('.wizard-home-provider .type-h1')).toHaveText('Choose inference provider');
    await expect(page.locator('[data-action="advanced-settings"]')).toHaveCount(0);
    await expect(page.locator('[data-action="choose-browser"]')).toBeVisible();
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
  test('defaults Absolute Zero to the capsule genesis level', async ({ page }) => {
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
    await openBoot(page);

    await expect(page.locator('.wizard-stage-placeholder').filter({ hasText: 'Compose substrate' })).toBeVisible();
    await expect(page.locator('.wizard-stage-placeholder').filter({ hasText: 'Awaken' })).toBeVisible();
    await expect(page.locator('#goal-input')).toHaveCount(0);

    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await expect(page.locator('#goal-input')).toBeVisible();
  });

  test('shows contract-visible file browser and hides bootstrap internals behind disclosure in Absolute Zero', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('.seed-browser-panel')).toBeVisible();
    await expect(page.locator('.seed-browser-panel')).toContainText('Capsule self');
    await expect(page.locator('.seed-browser-panel')).toContainText('/.system/self.json');
    await expect(page.locator('[data-action="select-absolute-zero-path"][data-path="/kernel/runtime.js"]')).toBeVisible();
    await expect(page.locator('.seed-viewer-panel')).toContainText('/.system/self.json');
    await expect(page.locator('.seed-viewer-panel')).toContainText('"visibleTools"');
    await expect(page.locator('.boot-debug-panel')).not.toHaveAttribute('open', '');

    await page.locator('[data-action="select-absolute-zero-path"][data-path="/.system/environment.txt"]').click();
    await expect(page.locator('.seed-viewer-panel')).toContainText('/.system/environment.txt');
    await expect(page.locator('.seed-viewer-panel')).toContainText('Files persist in VFS and OPFS can store larger artifacts.');
  });

  test('shows Absolute Zero environment editor and host toggle', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('#environment-input')).toBeVisible();
    await expect(page.locator('[data-action="apply-environment-template"]')).toHaveCount(5);
    await expect(page.locator('#include-host-within-self')).toBeVisible();
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

test.describe('Absolute Zero Runtime', () => {
  test('awakens into capsule instead of the zero shell', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await openHome(page);

    await expect(page.locator('[data-action="choose-browser"]')).toBeEnabled();
    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await page.locator('#goal-input').fill('Boot into capsule');
    await page.locator('#environment-input').fill('Boot test environment');
    await page.locator('#awaken-btn').click();

    await page.waitForSelector('#app.active', { timeout: 20000 });
    await expect(page.locator('.capsule-shell')).toBeVisible();
    await expect(page.locator('.zero-shell')).toHaveCount(0);
    await expect(page.locator('#history-container')).toBeVisible();
    await expect(page.locator('#zero-human-form')).toHaveCount(0);
    await page.waitForFunction(() => {
      const snapshot = window.REPLOID?.capsuleRuntime?.getSnapshot?.();
      return !!(snapshot && snapshot.context?.length >= 3 && snapshot.renderedText?.includes('[BOOT]'));
    }, { timeout: 5000 });

    const capsuleSnapshot = await page.evaluate(() => {
      const snapshot = window.REPLOID?.capsuleRuntime?.getSnapshot?.();
      if (!snapshot) return null;
      return {
        renderedText: snapshot.renderedText,
        context: snapshot.context.map(({ role, origin, content }) => ({ role, origin, content }))
      };
    });

    const vfsState = await page.evaluate(async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('reploid-vfs-v0', 1);
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
        goal: await readEntry(db, '/.system/goal.txt'),
        environment: await readEntry(db, '/.system/environment.txt'),
        self: await readEntry(db, '/.system/self.json'),
        keys: await listKeys(db)
      };
    });

    const self = JSON.parse(vfsState.self);
    expect(capsuleSnapshot).not.toBeNull();
    expect(capsuleSnapshot.renderedText).toContain('[BOOT]');
    expect(capsuleSnapshot.renderedText).toContain('Goal:');
    expect(capsuleSnapshot.renderedText).toContain('Environment:');
    expect(capsuleSnapshot.renderedText).not.toContain('[USER]');
    expect(capsuleSnapshot.renderedText).not.toContain('[ASSISTANT]');
    expect(capsuleSnapshot.context.slice(0, 3).map((msg) => msg.origin)).toEqual(['bootstrap', 'bootstrap', 'bootstrap']);
    expect(capsuleSnapshot.context.some((msg) => msg.role === 'system')).toBe(false);
    expect(vfsState.goal).toContain('Boot into capsule');
    expect(vfsState.environment).toContain('Boot test environment');
    expect(vfsState.keys).not.toContain('/.system/prompt.txt');
    expect(vfsState.keys).toContain('/kernel/runtime.js');
    expect(vfsState.keys.some((key) => key.startsWith('/host/'))).toBe(false);
    expect(self.hostIncluded).toBe(false);
    expect(self.environmentPath).toBe('/.system/environment.txt');
    expect(self.goalPath).toBe('/.system/goal.txt');
  });

  test('mirrors /host when include-host-within-self is enabled', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto(HOME_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await page.locator('#goal-input').fill('Boot into capsule with host');
    await page.locator('#include-host-within-self').check();
    await page.locator('#awaken-btn').click();

    await page.waitForSelector('#app.active', { timeout: 20000 });

    const vfsState = await page.evaluate(async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('reploid-vfs-v0', 1);
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
        self: await readEntry(db, '/.system/self.json'),
        keys: await listKeys(db)
      };
    });

    const self = JSON.parse(vfsState.self);
    expect(self.hostIncluded).toBe(true);
    expect(vfsState.keys).toContain('/host/capsule/host.js');
    expect(vfsState.keys).toContain('/host/entry/start-app.js');
  });
});
