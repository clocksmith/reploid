/**
 * E2E Test: /zero one safe iteration.
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

TOOL: CreateTool
name: WriteArtifact
code <<EOF
export const tool = {
  name: 'WriteArtifact',
  description: 'Write one bounded artifact file.',
  capabilities: ['vfs:write'],
  activation: {
    checks: [{
      name: 'writes an activation artifact',
      args: { path: '/artifacts/activation-write.txt', content: 'activation-write' },
      expected: { ok: true, path: '/artifacts/activation-write.txt', bytes: 16 }
    }]
  },
  inputSchema: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    }
  }
};

export default async function(args = {}, deps = {}) {
  const path = String(args.path || '').trim();
  if (!path.startsWith('/artifacts/') || path.split('/').includes('..')) {
    throw new Error('path must stay under /artifacts');
  }
  const content = String(args.content ?? '');
  await deps.VFS.write(path, content);
  return { ok: true, path, bytes: new TextEncoder().encode(content).length };
}
EOF

TOOL: WriteArtifact
path: /artifacts/probe.txt
content <<EOF
zero-safe-iteration
EOF
`;

const structuredDefinitionResponse = `REPLOID/0

TOOL: CreateTool
{
  "name": "DOMScanner",
  "description": "Scans visible DOM nodes.",
  "capabilities": ["dom:read"],
  "activation": {
    "fixtures": {},
    "checks": [{
      "name": "scan",
      "args": {"selector": "[data-zero-activation-missing]"},
      "expected": {"ok": true, "selector": "[data-zero-activation-missing]"}
    }]
  },
  "inputSchema": {"type": "object", "properties": {"selector": {"type": "string"}}},
  "call": "async (args) => ({ ok: true, selector: args.selector || 'button' })"
}

EVIDENCE:
{"status":"success","tool":"DOMScanner_created"}

TOOL: CreateTool
{
  "name": "OverlayManager",
  "description": "Mounts a transparent overlay.",
  "capabilities": ["dom:mutate"],
  "activation": {
    "fixtures": {},
    "checks": [{"name": "mount", "args": {"dryRun": true}, "expected": {"ok": true, "dryRun": true}}]
  },
  "inputSchema": {"type": "object", "properties": {"dryRun": {"type": "boolean"}}},
  "call": "async (args) => ({ ok: true, dryRun: args.dryRun === true })"
}

EVIDENCE:
{"status":"success","tool":"OverlayManager_created"}

TOOL: DOMScanner
{"selector":"button"}

TOOL: OverlayManager
{"dryRun":false}`;

test('/zero completes one safe artifact-producing iteration', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`zero-one-safe-${testInfo.project.name}-${Date.now()}`);

  await awakenWithMockGoal(
    page,
    '/zero',
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
    expect.objectContaining({ name: 'CreateTool' }),
    expect.objectContaining({ name: 'WriteArtifact' })
  ]));
  expect(toolcalls.modelUsed).toMatchObject({
    id: 'mock-model',
    provider: 'mock'
  });
  expect(audit.score).toMatchObject({
    passed: true,
    toolCallCount: 2,
    errorCount: 0
  });
});

test('/zero executes structured CreateTool definitions without trusting claimed evidence', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`zero-structured-tools-${testInfo.project.name}-${Date.now()}`);

  await awakenWithMockGoal(
    page,
    '/zero',
    instanceId,
    'Create and exercise DOMScanner and OverlayManager.',
    structuredDefinitionResponse,
    { maxIterations: 1 }
  );

  await waitForVfsPath(page, '/self/tools/DOMScanner.js');
  await waitForVfsPath(page, '/self/tools/OverlayManager.js');
  await waitForVfsPath(page, getCycleArtifactPath(1, 'audit.json'));

  const audit = await readVfsJson(page, getCycleArtifactPath(1, 'audit.json'));
  const toolcalls = await readVfsJson(page, getCycleArtifactPath(1, 'toolcalls.json'));

  expect(toolcalls.calls.map((call) => call.name)).toEqual([
    'CreateTool',
    'CreateTool',
    'DOMScanner',
    'OverlayManager'
  ]);
  expect(toolcalls.calls.every((call) => !Object.hasOwn(call.args || {}, 'EVIDENCE'))).toBe(true);
  expect(audit.score).toMatchObject({
    passed: true,
    toolCallCount: 4,
    errorCount: 0
  });
});
