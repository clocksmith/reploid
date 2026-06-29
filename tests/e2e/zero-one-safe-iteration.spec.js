/**
 * E2E Test: /0 one safe iteration.
 */
import { test, expect } from '@playwright/test';
import {
  awakenWithMockGoal,
  getCycleArtifactPath,
  readVfsJson,
  readVfsText,
  sanitizeInstanceId,
  waitForVfsPath
} from './reploid-lab-helpers.js';

const response = `
REPLOID/0

TOOL: WriteFile
path: /artifacts/probe.txt
content <<EOF
zero-safe-iteration
EOF
`;

test('/0 completes one safe artifact-producing iteration', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`zero-one-safe-${testInfo.project.name}-${Date.now()}`);

  await awakenWithMockGoal(
    page,
    '/0',
    instanceId,
    'write a timestamp note to /artifacts/probe.txt',
    response,
    { maxIterations: 1 }
  );

  await waitForVfsPath(page, '/artifacts/probe.txt');
  await waitForVfsPath(page, getCycleArtifactPath(1, 'audit.json'));

  expect(await readVfsText(page, '/artifacts/probe.txt')).toBe('zero-safe-iteration');

  const audit = await readVfsJson(page, getCycleArtifactPath(1, 'audit.json'));
  const toolcalls = await readVfsJson(page, getCycleArtifactPath(1, 'toolcalls.json'));

  expect(toolcalls.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'WriteFile' })
  ]));
  expect(audit.score).toMatchObject({
    passed: true,
    toolCallCount: 1,
    errorCount: 0
  });
});
