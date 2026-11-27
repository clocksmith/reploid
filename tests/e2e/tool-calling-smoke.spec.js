/**
 * E2E Test: shared tool-calling contract.
 */
import { test, expect } from '@playwright/test';
import { getToolNamesForMode } from '../../shared/config/tool-surfaces.js';
import { LAB_UPGRADE_TOOL_SURFACE_IDS } from '../../self/config/lab-upgrades.js';
import {
  LAB_ROUTE_CASES,
  awakenWithoutGoal,
  bootLegacyLabInstance,
  bootRouteWithServiceWorker,
  executeToolResult,
  readInstanceVfs,
  sanitizeInstanceId,
  selectLabUpgradeBeforeBoot
} from './reploid-lab-helpers.js';

const toolCandidateCode = `
export const tool = {
  name: 'ContractProbeTool',
  description: 'Contract probe',
  activation: {
    checks: [{ name: 'returns ok', args: {}, expected: { ok: true } }]
  },
  inputSchema: { type: 'object', properties: {} }
};

export default async function() {
  return { ok: true };
}
`;

const rejectedToolCandidateCode = `
export const tool = {
  name: 'RejectedProbeTool',
  description: 'Rejected contract probe',
  activation: {
    checks: [{ name: 'returns ok', args: {}, expected: { ok: true } }]
  },
  inputSchema: { type: 'object', properties: {} }
};

export default async function() {
  return { ok: false };
}
`;

test.describe('tool calling smoke', () => {
  for (const routeCase of LAB_ROUTE_CASES) {
    test(`${routeCase.route} tools return typed results and enforce route boundaries`, async ({ page }, testInfo) => {
      const instanceId = sanitizeInstanceId(`tool-contract-${routeCase.label}-${testInfo.project.name}-${Date.now()}`);
      const sourcePath = `/shadow/tool-contract-${routeCase.label}.txt`;
      const directoryPath = `/shadow/tool-contract-${routeCase.label}`;
      const copyPath = `${directoryPath}/copy.txt`;
      const movedPath = `${directoryPath}/moved.txt`;

      await bootLegacyLabInstance(page, routeCase.mode, instanceId);
      await awakenWithoutGoal(page);

      if (routeCase.requiredTools.length === 1 && routeCase.requiredTools[0] === 'CreateTool') {
        const initialTools = await page.evaluate(() => window.REPLOID.toolRunner.list());
        expect(initialTools).toEqual(['CreateTool']);
        for (const toolName of routeCase.requiredTools) {
          expect(initialTools, `${routeCase.route} tool ${toolName}`).toContain(toolName);
        }
        for (const toolName of routeCase.forbiddenTools) {
          expect(initialTools, `${routeCase.route} forbidden tool ${toolName}`).not.toContain(toolName);
        }

        const readBeforeCreate = await executeToolResult(page, 'ReadFile', { path: '/self/boot-spec.js' });
        expect(readBeforeCreate.ok).toBe(false);
        expect(readBeforeCreate.message).toMatch(/Tool (not found|not available)/);

        const rejectedTool = await executeToolResult(page, 'CreateTool', {
          name: 'RejectedProbeTool',
          code: rejectedToolCandidateCode
        });
        expect(rejectedTool.ok).toBe(false);
        expect(rejectedTool.message).toContain('activation check returns ok failed');

        const rejectedState = await page.evaluate(async () => ({
          evidence: JSON.parse(await window.REPLOID.vfs.read('/artifacts/RejectedProbeTool-evidence.json')),
          targetExists: await window.REPLOID.vfs.exists('/self/tools/RejectedProbeTool.js'),
          toolLoaded: window.REPLOID.toolRunner.has('RejectedProbeTool')
        }));
        expect(rejectedState).toMatchObject({
          evidence: {
            validationPassed: true,
            activationChecksPassed: false,
            replayPassed: false,
            activated: false,
            failure: { stage: 'activation_checks' }
          },
          targetExists: false,
          toolLoaded: false
        });

        const createTool = await executeToolResult(page, 'CreateTool', {
          name: 'ContractProbeTool',
          code: toolCandidateCode
        });
        expect(createTool.ok).toBe(true);
        expect(createTool.value).toMatchObject({
          success: true,
          name: 'ContractProbeTool',
          path: '/shadow/tools/ContractProbeTool.js',
          staged: true,
          activated: true,
          targetPath: '/self/tools/ContractProbeTool.js',
          validationPassed: true,
          activationChecksPassed: true,
          replayPassed: true,
          toolLoaded: true
        });

        const activationEvidence = await page.evaluate(async () => {
          const content = await window.REPLOID.vfs.read('/artifacts/ContractProbeTool-evidence.json');
          return JSON.parse(content);
        });
        expect(activationEvidence).toMatchObject({
          schema: 'reploid.zero.createToolEvidence.v3',
          validationPassed: true,
          activationChecksPassed: true,
          replayPassed: true,
          activated: true,
          checks: {
            activation: {
              executed: true,
              passed: true
            },
            replay: {
              executed: true,
              matchesActivationTranscript: true,
              passed: true
            }
          }
        });

        const probeRun = await executeToolResult(page, 'ContractProbeTool', {});
        expect(probeRun).toMatchObject({
          ok: true,
          value: { ok: true }
        });

        const afterCreate = await page.evaluate(() => window.REPLOID.toolRunner.list());
        expect(afterCreate).toEqual(expect.arrayContaining(['CreateTool', 'ContractProbeTool']));
        return;
      }

      const listed = await executeToolResult(page, 'ListTools');
      expect(listed.ok).toBe(true);
      for (const toolName of routeCase.requiredTools) {
        expect(listed.value, `${routeCase.route} tool ${toolName}`).toContain(toolName);
      }
      for (const toolName of routeCase.forbiddenTools) {
        expect(listed.value, `${routeCase.route} forbidden tool ${toolName}`).not.toContain(toolName);
      }

      const readSeed = await executeToolResult(page, 'ReadFile', { path: '/self/boot-spec.js' });
      expect(readSeed.ok).toBe(true);
      expect(readSeed.value.content).toContain('SELF_BOOT_SPEC');

      const write = await executeToolResult(page, 'WriteFile', { path: sourcePath, content: 'alpha' });
      expect(write.ok).toBe(true);

      const editMiss = await executeToolResult(page, 'EditFile', {
        path: sourcePath,
        patch: [{ find: 'not-present', replace: 'beta' }]
      });
      expect(editMiss.ok).toBe(true);
      expect(editMiss.value.changed).toBe(false);

      const preserved = await executeToolResult(page, 'ReadFile', { path: sourcePath });
      expect(preserved.value.content).toBe('alpha');

      if (listed.value.includes('MakeDirectory')) {
        const mkdir = await executeToolResult(page, 'MakeDirectory', { path: directoryPath });
        expect(mkdir.ok).toBe(true);

        const copy = await executeToolResult(page, 'CopyFile', { source: sourcePath, target: copyPath });
        expect(copy.ok).toBe(true);
        const move = await executeToolResult(page, 'MoveFile', { source: copyPath, target: movedPath });
        expect(move.ok).toBe(true);
        const movedRead = await executeToolResult(page, 'ReadFile', { path: movedPath });
        expect(movedRead.value.content).toBe('alpha');

        const list = await executeToolResult(page, 'ListFiles', { path: directoryPath, recursive: true });
        expect(list.ok).toBe(true);
        expect(list.value).toContain(movedPath);
      } else {
        const mkdir = await executeToolResult(page, 'MakeDirectory', { path: directoryPath });
        expect(mkdir.ok).toBe(false);
        expect(mkdir.message).toMatch(/Tool (not found|not available)/);
      }

      const createTool = await executeToolResult(page, 'CreateTool', {
        name: 'ContractProbeTool',
        code: toolCandidateCode
      });
      expect(createTool.ok).toBe(true);
      if (routeCase.route === '/zero') {
        expect(createTool.value).toMatchObject({
          success: true,
          name: 'ContractProbeTool',
          path: '/shadow/tools/ContractProbeTool.js',
          staged: true,
          activated: true,
          targetPath: '/self/tools/ContractProbeTool.js',
          validationPassed: true,
          toolLoaded: true
        });
      } else {
        expect(createTool.value).toMatchObject({
          success: true,
          name: 'ContractProbeTool',
          path: '/shadow/tools/ContractProbeTool.js',
          staged: true,
          toolLoaded: false
        });
      }

      const toolNamesAfterCreate = await executeToolResult(page, 'ListTools');
      if (routeCase.route === '/zero') {
        expect(toolNamesAfterCreate.value).toContain('ContractProbeTool');
      } else {
        expect(toolNamesAfterCreate.value).not.toContain('ContractProbeTool');
      }

      const badLoad = await executeToolResult(page, 'LoadModule', { path: '/shadow/tools/ContractProbeTool.js' });
      expect(badLoad.ok).toBe(false);
      expect(badLoad.message).toContain('promoted /self paths');

      const blockedSelfWrite = await executeToolResult(page, 'WriteFile', {
        path: '/self/tools/ContractProbeTool.js',
        content: toolCandidateCode
      });
      expect(blockedSelfWrite.ok).toBe(false);

      const blockedSelfEdit = await executeToolResult(page, 'EditFile', {
        path: '/self/tools/ContractProbeTool.js',
        content: toolCandidateCode,
        create: true
      });
      expect(blockedSelfEdit.ok).toBe(false);

      const badArgs = await executeToolResult(page, 'ReadFile', {});
      expect(badArgs.ok).toBe(false);
      expect(badArgs.message).toContain('Missing path');

      if (routeCase.route === '/zero') {
        const forbidden = await executeToolResult(page, 'SpawnWorker', {});
        expect(forbidden.ok).toBe(false);
        expect(forbidden.message).toMatch(/Tool (not found|not available)/);
      }
    });
  }

  test('fresh /x at spark activates verified tools inside Zero capsule without the legacy kernel', async ({ page }, testInfo) => {
    const instanceId = sanitizeInstanceId(`tool-contract-x-capsule-${testInfo.project.name}-${Date.now()}`);
    await bootRouteWithServiceWorker(page, '/x', instanceId);
    await expect(page.locator('.zero-capsule h1')).toHaveText('X');
    await expect(page.locator('#zero-upgrade-level')).toHaveValue('spark');

    const capsuleResult = await page.evaluate(async ({ candidate, rejected }) => {
      const { openZeroStore } = await import('/zero/store.js');
      const { createZeroTools } = await import('/zero/tools.js');
      const store = await openZeroStore();
      const source = JSON.parse(await store.read('/zero/source.json'));
      const tools = await createZeroTools({ VFS: store, source });
      try {
        const schemasBefore = tools.schemas().map(item => item.function.name);
        let rejectedMessage = null;
        try {
          await tools.execute('CreateTool', { name: 'RejectedProbeTool', code: rejected });
        } catch (error) {
          rejectedMessage = error.message;
        }
        const created = await tools.execute('CreateTool', { name: 'ContractProbeTool', code: candidate });
        const executed = await tools.execute('ContractProbeTool', {});
        const schemasAfter = tools.schemas().map(item => item.function.name);
        return { schemasBefore, rejectedMessage, created, executed, schemasAfter };
      } finally {
        tools.dispose();
        store.close();
      }
    }, { candidate: toolCandidateCode, rejected: rejectedToolCandidateCode });

    expect(capsuleResult.schemasBefore).toEqual(['CreateTool']);
    expect(capsuleResult.rejectedMessage).toContain('activation check returns ok failed');
    expect(capsuleResult.created).toMatchObject({
      success: true,
      name: 'ContractProbeTool',
      activated: true,
      targetPath: '/self/tools/ContractProbeTool.js',
      replayPassed: true
    });
    expect(capsuleResult.executed).toEqual({ ok: true });
    expect(capsuleResult.schemasAfter).toEqual(['CreateTool', 'ContractProbeTool']);

    const files = await readInstanceVfs(page, 'x', instanceId);
    expect(JSON.parse(files['/artifacts/ContractProbeTool-evidence.json']).schema)
      .toBe('reploid.zero.createToolEvidence.v3');
  });

  test('/x upgraded to reflection exposes file and promotion tools and stages CreateTool', async ({ page }, testInfo) => {
    const instanceId = sanitizeInstanceId(`tool-contract-x-reflection-${testInfo.project.name}-${Date.now()}`);
    const sourcePath = `/shadow/tool-contract-x-reflection.txt`;
    const directoryPath = `/shadow/tool-contract-x-reflection`;
    const copyPath = `${directoryPath}/copy.txt`;
    const movedPath = `${directoryPath}/moved.txt`;
    const expectedTools = getToolNamesForMode('x', {
      surfaceIds: LAB_UPGRADE_TOOL_SURFACE_IDS.reflection,
      hasToolWriter: true,
      hasSubstrateLoader: true
    });

    await selectLabUpgradeBeforeBoot(page, instanceId, 'reflection');
    await bootRouteWithServiceWorker(page, '/x', instanceId);
    await awakenWithoutGoal(page);

    const listed = await executeToolResult(page, 'ListTools');
    expect(listed.ok).toBe(true);
    for (const toolName of expectedTools) {
      expect(listed.value, `/x reflection tool ${toolName}`).toContain(toolName);
    }

    const readSeed = await executeToolResult(page, 'ReadFile', { path: '/self/boot-spec.js' });
    expect(readSeed.ok).toBe(true);
    expect(readSeed.value.content).toContain('SELF_BOOT_SPEC');

    const write = await executeToolResult(page, 'WriteFile', { path: sourcePath, content: 'alpha' });
    expect(write.ok).toBe(true);

    const editMiss = await executeToolResult(page, 'EditFile', {
      path: sourcePath,
      patch: [{ find: 'not-present', replace: 'beta' }]
    });
    expect(editMiss.ok).toBe(true);
    expect(editMiss.value.changed).toBe(false);

    const mkdir = await executeToolResult(page, 'MakeDirectory', { path: directoryPath });
    expect(mkdir.ok).toBe(true);
    const copy = await executeToolResult(page, 'CopyFile', { source: sourcePath, target: copyPath });
    expect(copy.ok).toBe(true);
    const move = await executeToolResult(page, 'MoveFile', { source: copyPath, target: movedPath });
    expect(move.ok).toBe(true);
    const movedRead = await executeToolResult(page, 'ReadFile', { path: movedPath });
    expect(movedRead.value.content).toBe('alpha');

    const createTool = await executeToolResult(page, 'CreateTool', {
      name: 'ContractProbeTool',
      code: toolCandidateCode
    });
    expect(createTool.ok).toBe(true);
    expect(createTool.value).toMatchObject({
      success: true,
      name: 'ContractProbeTool',
      path: '/shadow/tools/ContractProbeTool.js',
      staged: true,
      toolLoaded: false
    });

    const toolNamesAfterCreate = await executeToolResult(page, 'ListTools');
    expect(toolNamesAfterCreate.value).not.toContain('ContractProbeTool');

    const badLoad = await executeToolResult(page, 'LoadModule', { path: '/shadow/tools/ContractProbeTool.js' });
    expect(badLoad.ok).toBe(false);
    expect(badLoad.message).toContain('promoted /self paths');

    const unpromotedLoad = await executeToolResult(page, 'LoadModule', { path: '/self/tools/MissingReceiptTool.js' });
    expect(unpromotedLoad.ok).toBe(false);

    const blockedSelfWrite = await executeToolResult(page, 'WriteFile', {
      path: '/self/tools/ContractProbeTool.js',
      content: toolCandidateCode
    });
    expect(blockedSelfWrite.ok).toBe(false);
  });
});
