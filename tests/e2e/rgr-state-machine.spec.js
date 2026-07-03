/**
 * E2E Test: Recursive GEPA Ring state trace.
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
path: /artifacts/state-machine-probe.txt
content <<EOF
state-machine-ok
EOF
`;

test('Seed to Shadow transition is recorded with cycle artifacts', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`rgr-state-${testInfo.project.name}-${Date.now()}`);

  await awakenWithMockGoal(
    page,
    '/zero',
    instanceId,
    'write a state-machine probe artifact',
    writeResponse,
    { maxIterations: 1 }
  );

  await waitForVfsPath(page, getCycleArtifactPath(1, 'audit.json'));

  const input = await readVfsJson(page, getCycleArtifactPath(1, 'input.json'));
  const trace = await readVfsJson(page, getCycleArtifactPath(1, 'trace.json'));
  const decision = await readVfsJson(page, getCycleArtifactPath(1, 'decision.json'));
  const audit = await readVfsJson(page, getCycleArtifactPath(1, 'audit.json'));

  expect(input).toMatchObject({ stateBefore: 'Seed', event: 'cycle:start' });
  expect(trace).toMatchObject({ stateBefore: 'Seed', event: 'llm:response', stateAfter: 'Shadow' });
  expect(decision).toMatchObject({ stateBefore: 'Seed', event: 'decision', stateAfter: 'Shadow' });
  expect(audit).toMatchObject({ stateBefore: 'Seed', event: 'audit', stateAfter: 'Shadow' });
});
