/**
 * E2E Test: iteration artifact chain.
 */
import { test, expect } from '@playwright/test';
import {
  awakenWithMockGoal,
  getCycleArtifactPath,
  readVfsJson,
  sanitizeInstanceId,
  waitForVfsPath
} from './reploid-lab-helpers.js';

const writeResponse = `
REPLOID/0

TOOL: WriteFile
path: /artifacts/iteration-artifacts-probe.txt
content <<EOF
artifact-chain-ok
EOF
`;

test('a claimed iteration produces input, trace, toolcall, score, mutation, decision, and audit artifacts', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`iteration-artifacts-${testInfo.project.name}-${Date.now()}`);
  const artifacts = [
    'input.json',
    'trace.json',
    'toolcalls.json',
    'score.json',
    'mutation.json',
    'decision.json',
    'audit.json'
  ];

  await awakenWithMockGoal(
    page,
    '/0',
    instanceId,
    'write an artifact-chain probe',
    writeResponse,
    { maxIterations: 1 }
  );

  await waitForVfsPath(page, getCycleArtifactPath(1, 'audit.json'));

  for (const artifact of artifacts) {
    await waitForVfsPath(page, getCycleArtifactPath(1, artifact));
  }

  const toolcalls = await readVfsJson(page, getCycleArtifactPath(1, 'toolcalls.json'));
  const score = await readVfsJson(page, getCycleArtifactPath(1, 'score.json'));
  const mutation = await readVfsJson(page, getCycleArtifactPath(1, 'mutation.json'));

  expect(toolcalls.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'WriteFile' })
  ]));
  expect(score.score).toMatchObject({
    passed: true,
    toolCallCount: 1,
    errorCount: 0
  });
  expect(mutation.paths).toContain('/artifacts/iteration-artifacts-probe.txt');
});
