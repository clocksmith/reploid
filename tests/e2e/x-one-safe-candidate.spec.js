/**
 * E2E Test: /x one safe candidate through VFSSandbox, ArenaHarness, and Promote.
 */
import { test, expect } from '@playwright/test';
import {
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

test('/x evaluates and promotes one safe candidate with an auditable decision event', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`x-one-safe-${testInfo.project.name}-${Date.now()}`);

  await bootRouteWithServiceWorker(page, '/x', instanceId);
  await awakenWithoutGoal(page);

  const result = await page.evaluate(async () => {
    const container = window.REPLOID.container;
    const vfs = window.REPLOID.vfs;
    const arena = await container.resolve('ArenaHarness');
    const toolRunner = await container.resolve('ToolRunner');
    const acceptedEvents = [];
    const eventBus = await container.resolve('EventBus');
    eventBus.on('promotion:accepted', (event) => acceptedEvents.push(event), 'x-one-safe-candidate-test');

    const candidatePath = '/shadow/candidates/x-one-safe/probe.js';
    const targetPath = '/self/tools/XOneSafeProbe.js';
    const evidencePath = '/artifacts/x-one-safe-evidence.json';
    const candidateCode = `
export const tool = {
  name: 'XOneSafeProbe',
  description: 'Safe candidate probe',
  inputSchema: { type: 'object', properties: {} }
};

export default async function() {
  return { ok: true };
}
`;

    const arenaResult = await arena.verifySolution({
      name: 'x-one-safe',
      solution: candidateCode,
      parseChanges: (solution) => ({
        [candidatePath]: solution
      })
    });
    const sandboxRestored = !(await vfs.exists(candidatePath).catch(() => false));

    await vfs.write(candidatePath, candidateCode);
    await vfs.write(evidencePath, JSON.stringify({
      candidatePath,
      targetPath,
      evidencePath,
      replayPassed: arenaResult.passed === true
    }));

    const promotion = await toolRunner.execute('Promote', {
      candidatePath,
      targetPath,
      evidencePath
    });

    return {
      arenaResult,
      sandboxRestored,
      promotion,
      acceptedEvents,
      targetExists: await vfs.exists(targetPath)
    };
  });

  expect(result.arenaResult).toMatchObject({
    passed: true,
    changes: ['/shadow/candidates/x-one-safe/probe.js']
  });
  expect(result.sandboxRestored).toBe(true);
  expect(result.promotion).toMatchObject({ ok: true, promoted: true });
  expect(result.targetExists).toBe(true);
  expect(result.acceptedEvents).toEqual(expect.arrayContaining([
    expect.objectContaining({ targetPath: '/self/tools/XOneSafeProbe.js' })
  ]));
});
