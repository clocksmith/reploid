/**
 * E2E Test: Zero grows read and self-write tools from the CreateTool seed.
 */

import { test, expect } from '@playwright/test';

import {
  DB_PREFIX,
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  executeToolResult,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';
import { ZERO_READ_FILE_TOOL_CODE } from './zero-tool-fixtures.js';

const SELF_WRITE_TOOL_CODE = `
const ACTIVE_PREFIXES = [
  ['/self/tools/', '/tools/'],
  ['/self/ui/', '/ui/'],
  ['/self/core/', '/core/'],
  ['/self/config/', '/config/'],
  ['/self/styles/', '/styles/']
];

const safeId = (value = '') => String(value || 'self')
  .replace(/[^A-Za-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80) || 'self';

const textBytes = (value = '') => new TextEncoder().encode(String(value)).length;

const activePathFor = (targetPath) => {
  for (const [canonicalPrefix, activePrefix] of ACTIVE_PREFIXES) {
    if (targetPath.startsWith(canonicalPrefix)) {
      return activePrefix + targetPath.slice(canonicalPrefix.length);
    }
  }
  return targetPath;
};

const readPreviousTargets = async (VFS, paths) => {
  const previousTargets = {};
  for (const path of paths) {
    try {
      previousTargets[path] = await VFS.read(path);
    } catch {
      previousTargets[path] = null;
    }
  }
  return previousTargets;
};

export const tool = {
  name: 'SelfWrite',
  description: 'Evidence-backed self writer created by Zero from CreateTool.',
  capabilities: ['self:write'],
  activation: {
    checks: [{
      name: 'writes and loads a fixture tool',
      args: {
        targetPath: '/self/tools/ActivationProbe.js',
        content: 'export default async function() { return { ok: true }; }',
        evidencePath: '/artifacts/activation-self-write.json'
      },
      expected: {
        ok: true,
        applied: true,
        targetPath: '/self/tools/ActivationProbe.js',
        activeTargetPath: '/tools/ActivationProbe.js',
        reloaded: true,
        reloadKind: 'tool',
        toolName: 'ActivationProbe'
      }
    }]
  },
  inputSchema: {
    type: 'object',
    required: ['targetPath', 'content'],
    properties: {
      targetPath: { type: 'string' },
      content: { type: 'string' },
      evidencePath: { type: 'string' }
    }
  }
};

export default async function(args = {}, deps = {}) {
  const { VFS, ToolRunner, EventBus, Utils } = deps;
  if (!VFS?.write || !VFS?.read) throw new Error('Writable VFS unavailable');
  const targetPath = String(args.targetPath || '').trim();
  if (!targetPath.startsWith('/self/')) throw new Error('targetPath must be under /self');
  if (targetPath.split('/').includes('..')) throw new Error('Path traversal is not allowed');
  const content = String(args.content ?? '');
  const activeTargetPath = activePathFor(targetPath);
  const writePaths = [...new Set([targetPath, activeTargetPath])];
  const now = typeof Utils?.now === 'function' ? Utils.now() : Date.now();
  const createdAt = new Date(now).toISOString();
  const rollbackPath = '/artifacts/rollback/' + now.toString(36) + '-' + safeId(targetPath) + '.json';
  const evidencePath = String(args.evidencePath || '/artifacts/' + safeId(targetPath) + '-self-write.json');
  const previousTargets = await readPreviousTargets(VFS, writePaths);
  const rollback = {
    schema: 'reploid.zero.createdSelfWriter.rollback.v1',
    targetPath,
    activeTargetPath,
    writePaths,
    rollbackPath,
    previousTargets,
    createdAt
  };
  const evidence = {
    schema: 'reploid.zero.createdSelfWriter.evidence.v1',
    targetPath,
    activeTargetPath,
    evidencePath,
    bytes: textBytes(content),
    writePrepared: true,
    createdAt
  };

  await VFS.write(rollbackPath, JSON.stringify(rollback, null, 2));
  await VFS.write(evidencePath, JSON.stringify(evidence, null, 2));
  for (const path of writePaths) {
    await VFS.write(path, content);
  }

  let reloaded = false;
  let reloadKind = activeTargetPath === targetPath ? 'none' : 'route';
  let toolName = null;
  if (targetPath.startsWith('/self/tools/') && targetPath.endsWith('.js') && ToolRunner?.loadPath) {
    toolName = targetPath.split('/').pop().replace(/\\.js$/, '');
    reloaded = await ToolRunner.loadPath(targetPath, toolName, { allow: true });
    reloadKind = 'tool';
  }

  const result = {
    ok: true,
    applied: true,
    targetPath,
    activeTargetPath,
    writePaths,
    evidencePath,
    rollbackPath,
    reloaded,
    reloadKind,
    toolName
  };
  EventBus?.emit?.('selfwrite:accepted', result);
  return result;
}
`.trim();

async function installTool(page, name, code) {
  const result = await executeToolResult(page, 'CreateTool', { name, code });
  expect(result.ok).toBe(true);
  expect(result.value).toMatchObject({
    activated: true,
    targetPath: `/self/tools/${name}.js`,
    activationChecksPassed: true,
    replayPassed: true,
    toolLoaded: true
  });
  return result.value;
}

async function readIndexedDbVfsFile(page, instanceId, path) {
  return page.evaluate(async ({ dbName, path }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').get(path);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result?.content || null);
      });
    } finally {
      db.close();
    }
  }, {
    dbName: `${DB_PREFIX}--${instanceId}`,
    path
  });
}

test('/zero boots with CreateTool only, then creates and uses ReadFile', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`zero-created-reader-${testInfo.project.name}-${Date.now()}`);

  await bootRouteWithServiceWorker(page, '/zero', instanceId);
  await awakenWithoutGoal(page);

  const initialTools = await page.evaluate(() => window.REPLOID.toolRunner.list());
  expect(initialTools).toEqual(['CreateTool']);

  await installTool(page, 'ReadFile', ZERO_READ_FILE_TOOL_CODE);

  const toolsAfterCreate = await page.evaluate(() => window.REPLOID.toolRunner.list());
  expect(toolsAfterCreate).toEqual(expect.arrayContaining(['CreateTool', 'ReadFile']));

  const rootRead = await executeToolResult(page, 'ReadFile', { path: '/' });
  expect(rootRead.ok).toBe(true);
  expect(rootRead.value).toMatchObject({ kind: 'directory' });
  expect(rootRead.value.entries).toContain('/self/boot-spec.js');
});

test('/zero creates a self-writer and loads a patched tool through it', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`zero-created-self-tool-${testInfo.project.name}-${Date.now()}`);
  const toolName = `CreatedPatchSmoke${Date.now().toString(36)}`;
  const targetPath = `/self/tools/${toolName}.js`;
  const activeTargetPath = `/tools/${toolName}.js`;
  const code = `export const tool = {
  name: '${toolName}',
  description: 'Created self-writer smoke tool',
  inputSchema: { type: 'object', properties: {} }
};

export default async function() {
  return { ok: true, source: 'created-self-writer' };
}
`;

  await bootRouteWithServiceWorker(page, '/zero', instanceId);
  await awakenWithoutGoal(page);
  await installTool(page, 'ReadFile', ZERO_READ_FILE_TOOL_CODE);
  await installTool(page, 'SelfWrite', SELF_WRITE_TOOL_CODE);

  const directRead = await executeToolResult(page, 'ReadFile', { path: '/self/tools/SelfWrite.js' });
  expect(directRead.ok).toBe(true);
  expect(directRead.value.content).toContain("capabilities: ['self:write']");

  const patch = await executeToolResult(page, 'SelfWrite', {
    targetPath,
    content: code,
    evidencePath: `/artifacts/${toolName}-self-write.json`
  });
  expect(patch.ok).toBe(true);
  expect(patch.value).toMatchObject({
    ok: true,
    applied: true,
    targetPath,
    activeTargetPath,
    reloaded: true,
    reloadKind: 'tool',
    toolName
  });
  expect(patch.value.writePaths).toEqual([targetPath, activeTargetPath]);
  expect(patch.value.rollbackPath).toMatch(/^\/artifacts\/rollback\//);

  const toolRun = await executeToolResult(page, toolName, {});
  expect(toolRun).toMatchObject({
    ok: true,
    value: {
      ok: true,
      source: 'created-self-writer'
    }
  });

  const activeRead = await executeToolResult(page, 'ReadFile', { path: activeTargetPath });
  expect(activeRead.ok).toBe(true);
  expect(activeRead.value.content).toBe(code);

  const rollbackRead = await executeToolResult(page, 'ReadFile', { path: patch.value.rollbackPath });
  expect(rollbackRead.ok).toBe(true);
  expect(JSON.parse(rollbackRead.value.content)).toMatchObject({
    schema: 'reploid.zero.createdSelfWriter.rollback.v1',
    targetPath,
    activeTargetPath
  });
});

test('/zero created self-writer applies a UI self patch and hot-reloads the runtime shell', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`zero-created-ui-self-patch-${testInfo.project.name}-${Date.now()}`);
  const marker = `ui-created-self-patch-${Date.now().toString(36)}`;
  const targetPath = '/self/ui/zero/index.js';
  const activeTargetPath = '/ui/zero/index.js';

  await bootRouteWithServiceWorker(page, '/zero', instanceId);
  await awakenWithoutGoal(page);
  await installTool(page, 'ReadFile', ZERO_READ_FILE_TOOL_CODE);
  await installTool(page, 'SelfWrite', SELF_WRITE_TOOL_CODE);
  await expect(page.locator('.zero-shell')).toBeVisible();

  const sourceRead = await executeToolResult(page, 'ReadFile', { path: activeTargetPath });
  expect(sourceRead.ok).toBe(true);
  const original = sourceRead.value.content;
  const content = original.replace(
    '<div class="zero-shell">',
    `<div class="zero-shell" data-self-patch-marker="${marker}">`
  );
  expect(content).not.toBe(original);

  const beforeVersion = await page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null);
  const patch = await executeToolResult(page, 'SelfWrite', {
    targetPath,
    content,
    evidencePath: `/artifacts/${marker}.json`
  });

  expect(patch.ok).toBe(true);
  expect(patch.value).toMatchObject({
    ok: true,
    applied: true,
    targetPath,
    activeTargetPath,
    reloaded: false,
    reloadKind: 'route'
  });
  expect(patch.value.writePaths).toEqual([targetPath, activeTargetPath]);

  await expect.poll(async () => page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null), {
    timeout: 30000
  }).not.toBe(beforeVersion);
  await expect(page.locator(`.zero-shell[data-self-patch-marker="${marker}"]`)).toBeVisible();

  const activeRead = await executeToolResult(page, 'ReadFile', { path: activeTargetPath });
  expect(activeRead.ok).toBe(true);
  expect(activeRead.value.content).toContain(marker);
});

test('/zero created self-writer applies a core patch, mirrors it, and reloads cleanly', async ({ page }, testInfo) => {
  const instanceId = sanitizeInstanceId(`zero-created-core-self-patch-${testInfo.project.name}-${Date.now()}`);
  const marker = `zero-created-core-self-patch-${Date.now().toString(36)}`;
  const targetPath = '/self/core/utils.js';
  const activeTargetPath = '/core/utils.js';

  await bootRouteWithServiceWorker(page, '/zero', instanceId);
  await awakenWithoutGoal(page);
  await installTool(page, 'ReadFile', ZERO_READ_FILE_TOOL_CODE);
  await installTool(page, 'SelfWrite', SELF_WRITE_TOOL_CODE);
  await expect(page.locator('.zero-shell')).toBeVisible();

  const sourceRead = await executeToolResult(page, 'ReadFile', { path: activeTargetPath });
  expect(sourceRead.ok).toBe(true);
  const content = `${sourceRead.value.content}\n// ${marker}\n`;

  const reloadPromise = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 30000
  });
  const patch = await executeToolResult(page, 'SelfWrite', {
    targetPath,
    content,
    evidencePath: `/artifacts/${marker}.json`
  });

  expect(patch.ok).toBe(true);
  expect(patch.value).toMatchObject({
    ok: true,
    applied: true,
    targetPath,
    activeTargetPath,
    reloaded: false,
    reloadKind: 'route'
  });
  expect(patch.value.writePaths).toEqual([targetPath, activeTargetPath]);

  await reloadPromise;
  await expect.poll(async () => page.evaluate(() => ({
    mode: typeof window.getReploidMode === 'function' ? window.getReploidMode() : null,
    bootProfile: typeof window.getReploidBootProfile === 'function' ? window.getReploidBootProfile() : null,
    hasTrigger: typeof window.triggerAwaken === 'function'
  })), {
    timeout: 30000
  }).toEqual({
    mode: 'zero',
    bootProfile: 'zero_home',
    hasTrigger: true
  });
  await expect(page.locator('#wizard-container')).toBeVisible();

  const activeContent = await readIndexedDbVfsFile(page, instanceId, activeTargetPath);
  const canonicalContent = await readIndexedDbVfsFile(page, instanceId, targetPath);
  expect(activeContent).toContain(marker);
  expect(canonicalContent).toContain(marker);
});
