/**
 * E2E Test: Genesis Configuration
 * Tests for genesis levels, blueprint paths, and worker types configuration.
 */
import { test, expect } from '@playwright/test';

test.describe('Genesis Configuration', () => {
  test('should load genesis-levels.json config', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.levels).toBeDefined();
    expect(config.vfsSeed).toBeDefined();
    expect(config.blueprintPaths).toBeDefined();
  });

  test('should have three genesis levels defined', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.levels.tabula).toBeDefined();
    expect(config.levels.reflection).toBeDefined();
    expect(config.levels.full).toBeDefined();
  });

  test('should have full as default genesis level', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.defaultLevel).toBe('full');
  });

  test('tabula level has minimal modules', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    const tabula = config.levels.tabula;
    expect(tabula.modules).toContain('VFS');
    expect(tabula.modules).toContain('AgentLoop');
    expect(tabula.modules).toContain('LLMClient');
    expect(tabula.modules.length).toBeLessThan(20);
  });

  test('reflection level extends tabula', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    const reflection = config.levels.reflection;
    expect(reflection.extends).toBe('tabula');
    expect(reflection.modules).toContain('ReflectionStore');
  });

  test('full level extends reflection', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    const full = config.levels.full;
    expect(full.extends).toBe('reflection');
    expect(full.modules).toContain('WorkerManager');
    expect(full.modules).toContain('CognitionAPI');
  });
});

test.describe('Blueprint Paths Configuration', () => {
  test('should have blueprint paths defined', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.blueprintPaths.none).toBeDefined();
    expect(config.blueprintPaths.reflection).toBeDefined();
    expect(config.blueprintPaths.full).toBeDefined();
    expect(config.blueprintPaths.beyond).toBeDefined();
  });

  test('should have none as default blueprint path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.defaultBlueprintPath).toBe('none');
  });
});

test.describe('Worker Types Configuration', () => {
  test('should have worker types defined', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.workerTypes).toBeDefined();
    expect(config.workerTypes.explore).toBeDefined();
    expect(config.workerTypes.analyze).toBeDefined();
    expect(config.workerTypes.execute).toBeDefined();
  });

  test('explore worker has read-only tools', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    const explore = config.workerTypes.explore;
    expect(explore.tools).toContain('ReadFile');
    expect(explore.tools).toContain('Grep');
    expect(explore.tools).not.toContain('WriteFile');
    expect(explore.canSpawnWorkers).toBe(false);
  });

  test('execute worker has full RSI capability', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    const execute = config.workerTypes.execute;
    expect(execute.tools).toBe('*');
    expect(execute.canSpawnWorkers).toBe(false);
  });
});

test.describe('VFS Seed Configuration', () => {
  test('should have VFS seed paths defined', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.vfsSeed.core).toBeDefined();
    expect(config.vfsSeed.tools).toBeDefined();
    expect(config.vfsSeed.infrastructure).toBeDefined();
  });

  test('VFS seed includes worker tools', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    const tools = config.vfsSeed.tools;
    expect(tools).toContain('tools/SpawnWorker.js');
    expect(tools).toContain('tools/ListWorkers.js');
    expect(tools).toContain('tools/AwaitWorkers.js');
  });
});

test.describe('Model Roles Configuration', () => {
  test('should have model roles defined', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const config = await page.evaluate(async () => {
      const response = await fetch('/config/genesis-levels.json');
      return response.json();
    });

    expect(config.modelRoles).toBeDefined();
    expect(config.modelRoles.orchestrator).toBeDefined();
    expect(config.modelRoles.fast).toBeDefined();
    expect(config.modelRoles.code).toBeDefined();
    expect(config.modelRoles.local).toBeDefined();
  });
});
