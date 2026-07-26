/**
 * Hardware-qualified preservation test for Zero's bounded self-improvement loop.
 *
 * This lane deliberately uses the real Doppler provider. The ordinary Zero
 * browser suite remains fast and deterministic with a mock cognition provider;
 * this test proves that the same parser, tool activation, VFS, audit, and
 * rollback-evidence boundaries work when cognition comes from WebGPU.
 */

import { test, expect } from '@playwright/test';

import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import {
  bootRouteWithServiceWorker,
  getCycleArtifactPath,
  readVfsJson,
  sanitizeInstanceId,
  waitForVfsPath
} from './reploid-lab-helpers.js';

const ACTUAL_RSI_ARTIFACT = '/artifacts/actual-doppler-rsi.txt';
const ACTUAL_RSI_TOOL_SOURCE = `export const tool = {
  name: 'WriteActualRsiArtifact',
  description: 'Writes the hardware-qualified Zero RSI artifact.',
  capabilities: ['vfs:write'],
  activation: {
    fixtures: {},
    checks: [{
      name: 'write artifact',
      args: {},
      expected: { ok: true, path: '/artifacts/actual-doppler-rsi.txt' }
    }]
  },
  inputSchema: { type: 'object', properties: {} }
};

export default async function writeActualRsiArtifact(args = {}, deps = {}) {
  await deps.VFS.write('/artifacts/actual-doppler-rsi.txt', 'actual-doppler-rsi');
  return { ok: true, path: '/artifacts/actual-doppler-rsi.txt' };
}`;

test.describe('Zero actual Doppler RSI', () => {
  test.skip(
    process.env.REPLOID_E2E_ACTUAL_RSI !== '1',
    'Set REPLOID_E2E_ACTUAL_RSI=1 to run Zero with real Doppler WebGPU cognition.'
  );

  test('uses real Doppler cognition for one bounded, audited mutation cycle', async ({ page }, testInfo) => {
    test.setTimeout(900000);
    const instanceId = sanitizeInstanceId(`zero-actual-rsi-${testInfo.project.name}-${Date.now()}`);

    page.on('console', (message) => {
      const text = message.text();
      if (/doppler|webgpu|model|agent|error|failed/i.test(text)) {
        console.log(`[zero-actual-rsi:console:${message.type()}] ${text}`);
      }
    });

    await bootRouteWithServiceWorker(page, '/zero', instanceId);
    await expect.poll(async () => page.evaluate(() => typeof window.triggerAwaken === 'function'), {
      timeout: 30000
    }).toBe(true);

    await page.evaluate(({ instanceId, modelId }) => {
      const prefix = `REPLOID_INSTANCE_${instanceId}::`;
      localStorage.setItem(`${prefix}SELECTED_MODELS`, JSON.stringify([{
        id: modelId,
        name: 'Qwen 3.5 0.8B hardware-qualified RSI',
        provider: 'doppler',
        hostType: 'browser-local',
        queryMethod: 'browser',
        maxIterations: 2,
        maxTokens: 512,
        temperature: 0
      }]));
    }, {
      instanceId,
      modelId: LAUNCH_MODEL.modelId
    });

    await page.evaluate(async ({ artifactPath, toolSource }) => {
      await window.triggerAwaken(
        `Complete exactly one bounded self-improvement cycle. `
        + `The required live artifact is "${artifactPath}". `
        + `Return the exact REPLOID/0 response below, without changing, wrapping, `
        + `or abbreviating it. The first EOF terminates the code argument; do not `
        + `put any marker or commentary after the second tool call.\n\n`
        + `REPLOID/0\n\n`
        + `TOOL: CreateTool\n`
        + `name: WriteActualRsiArtifact\n`
        + `code <<EOF\n${toolSource}\nEOF\n\n`
        + `TOOL: WriteActualRsiArtifact\n`
      );
    }, {
      artifactPath: ACTUAL_RSI_ARTIFACT,
      toolSource: ACTUAL_RSI_TOOL_SOURCE
    });

    await waitForVfsPath(page, getCycleArtifactPath(2, 'audit.json'), 840000);
    const firstAudit = await readVfsJson(page, getCycleArtifactPath(1, 'audit.json'));
    const firstToolcalls = await readVfsJson(page, getCycleArtifactPath(1, 'toolcalls.json'));
    const firstTrace = await readVfsJson(page, getCycleArtifactPath(1, 'trace.json'));
    const secondAudit = await readVfsJson(page, getCycleArtifactPath(2, 'audit.json'));
    const secondToolcalls = await readVfsJson(page, getCycleArtifactPath(2, 'toolcalls.json'));
    const secondTrace = await readVfsJson(page, getCycleArtifactPath(2, 'trace.json'));
    await testInfo.attach('zero-actual-rsi-cycle', {
      body: Buffer.from(JSON.stringify({
        cycles: [
          { audit: firstAudit, toolcalls: firstToolcalls, trace: firstTrace },
          { audit: secondAudit, toolcalls: secondToolcalls, trace: secondTrace }
        ]
      }, null, 2)),
      contentType: 'application/json'
    });

    expect(firstTrace).toMatchObject({
      model: LAUNCH_MODEL.modelId,
      provider: 'doppler'
    });
    expect(secondTrace).toMatchObject({
      model: LAUNCH_MODEL.modelId,
      provider: 'doppler'
    });
    expect(firstToolcalls.modelUsed).toMatchObject({
      id: LAUNCH_MODEL.modelId,
      provider: 'doppler'
    });
    expect(firstToolcalls.calls.map((call) => call.name)).toContain('CreateTool');
    expect(firstToolcalls.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: 'CreateTool',
        error: null,
        resultPreview: expect.stringContaining('"activationChecksPassed": true')
      })
    ]));
    expect(secondToolcalls.calls.map((call) => call.name)).toContain('WriteActualRsiArtifact');
    expect(firstAudit.score).toMatchObject({
      passed: true,
      errorCount: 0
    });
    expect(secondAudit.score).toMatchObject({
      passed: true,
      errorCount: 0
    });
    expect(await page.evaluate(async (path) => window.REPLOID.vfs.read(path), ACTUAL_RSI_ARTIFACT))
      .toBe('actual-doppler-rsi');
  });
});
