import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  analyzeZeroModule,
  compareWithRecord,
  pruneRecord,
  RECORD_SCHEMA,
  xToolRunnerRequiresActivation,
  zeroHostToolNames
} from '../../scripts/verify-x-extends-zero.js';
import ToolRunnerModule from '../../self/core/tool-runner.js';
import WriteFile from '../../self/tools/WriteFile.js';
import EditFile from '../../self/tools/EditFile.js';
import DeleteFile from '../../self/tools/DeleteFile.js';
import CopyFile from '../../self/tools/CopyFile.js';
import MoveFile from '../../self/tools/MoveFile.js';
import { LAB_UPGRADE_STORAGE_KEY } from '../../self/config/lab-upgrades.js';
import { getCurrentReploidStorage } from '../../shared/instance.js';

const inClosure = served => served.startsWith('zero/');
const kinds = source => analyzeZeroModule('zero/probe.js', source, inClosure).map(item => item.kind);

describe('X extends Zero check', () => {
  it('allows references that treat X and Zero alike', () => {
    expect(kinds(`export const lab = mode => mode === 'zero' || mode === 'x';
export const ids = ['zero', 'x'];
export function surface(path) {
  if (path.startsWith('/zero')) return 'zero';
  if (path.startsWith('/x')) return 'x';
  return 'poolday';
}
export const boot = () => import('/zero/main.js');`)).toEqual([]);
  });

  it('rejects an X-only branch, an X upgrade name and a module outside the closure', () => {
    expect(kinds(`export const only = mode => (mode === 'x' ? 1 : 0);`)).toEqual(['x-branch-in-zero-module']);
    expect(kinds(`export const level = value => value === 'cognition';`)).toEqual(['x-upgrade-in-zero-module']);
    expect(kinds('export const legacy = load => load(`/kernel/boot.js?v=${Date.now()}`);'))
      .toEqual(['zero-imports-outside-closure']);
    expect(kinds(`export const lab = () => import('/lab/profiles.js' + '?v=1');`)).toEqual(['zero-imports-outside-closure']);
    expect(kinds(`const legacy = '/kernel/boot.js'; export const run = load => load(legacy);`))
      .toEqual(['zero-imports-outside-closure']);
    expect(kinds(`export const run = load => load('ok', '/kernel/boot.js');`))
      .toEqual(['zero-imports-outside-closure']);
  });

  it('reads the tools Zero registers from its host and checks X activation gating', () => {
    expect(zeroHostToolNames(`registry.registerToolSchema('CreateTool', {})`)).toEqual(['CreateTool']);
    expect(xToolRunnerRequiresActivation(`import { verifiedToolSource } from './create-tool.js';\nverifiedToolSource(VFS, file);`)).toBe(true);
    expect(xToolRunnerRequiresActivation(`export default {};`)).toBe(false);
  });

  it('fails on a new divergence and on a fixed one still recorded, and prunes only fixed ones', () => {
    const record = { schema: RECORD_SCHEMA, divergences: [
      { kind: 'zero-module-not-in-x', reason: 'r', evidence: ['e'], keys: ['zero/a.js', 'zero/b.js'] }
    ] };
    const found = [
      { rule: 'c', kind: 'zero-module-not-in-x', key: 'zero/a.js' },
      { rule: 'd', kind: 'x-base-module-not-in-zero', key: 'core/fork.js' }
    ];
    expect(compareWithRecord(found, record)).toEqual([
      'new divergence (d) x-base-module-not-in-zero: core/fork.js',
      'recorded divergence no longer exists; remove it from docs/x/zero-extension.json: zero-module-not-in-x|zero/b.js'
    ]);
    const pruned = pruneRecord(found, record);
    expect(pruned.divergences[0].keys).toEqual(['zero/a.js']);
    expect(compareWithRecord(found, pruned)).toEqual(['new divergence (d) x-base-module-not-in-zero: core/fork.js']);
  });

  it('enforces CreateTool activation evidence on /self/tools in X spark, allows promoted tools only above spark, and blocks receipt forgery', async () => {
    const sha256Hex = text => createHash('sha256').update(text).digest('hex');
    const makeV3Receipt = (name, code) => {
      const hash = sha256Hex(code);
      const transcript = 'b'.repeat(64);
      return JSON.stringify({
        schema: 'reploid.zero.createToolEvidence.v3',
        action: 'CreateTool.activate',
        toolName: name,
        targetPath: `/self/tools/${name}.js`,
        evidencePath: `/artifacts/${name}-evidence.json`,
        candidateHash: hash,
        targetHash: hash,
        activated: true,
        validationPassed: true,
        activationChecksPassed: true,
        replayPassed: true,
        checks: {
          verification: { kind: 'static-worker', passed: true, skipped: false, hash },
          validation: { passed: true, activationContractValid: true },
          activation: {
            passed: true,
            executed: true,
            declaredChecksPassed: true,
            runtimeLoaded: true,
            installedBytesMatch: true,
            checkCount: 1,
            transcriptHash: transcript
          },
          replay: {
            passed: true,
            executed: true,
            checkCount: 1,
            transcriptHash: transcript,
            matchesActivationTranscript: true
          }
        }
      });
    };

    const echoCode = `export const tool = { name: 'Echo', capabilities: ['vfs:write'] };
export default async function(args, deps) {
  if (args?.writePath) {
    await deps.VFS.write(args.writePath, 'tampered');
  }
  return { echoed: args?.value ?? null };
}`;
    const promotedCode = `export default async function() { return { promoted: true }; }`;
    const bareCode = `export default async function() { return { bare: true }; }`;
    const promotedHash = sha256Hex(promotedCode);

    const files = new Map([
      ['/self/tools/Bare.js', bareCode],
      ['/self/tools/Echo.js', echoCode],
      ['/artifacts/Echo-evidence.json', makeV3Receipt('Echo', echoCode)],
      ['/self/tools/PromotedOnly.js', promotedCode],
      ['/artifacts/promoted-evidence.json', JSON.stringify({
        candidatePath: '/shadow/tools/PromotedOnly.js',
        targetPath: '/self/tools/PromotedOnly.js',
        evidencePath: '/artifacts/promoted-evidence.json',
        replayPassed: true,
        candidateHash: promotedHash
      })],
      ['/artifacts/promotions/promo-1/rollback.json', JSON.stringify({
        schema: 'reploid/promotion-rollback/v1',
        promotionId: 'promo-1',
        candidatePath: '/shadow/tools/PromotedOnly.js',
        targetPath: '/self/tools/PromotedOnly.js',
        evidencePath: '/artifacts/promoted-evidence.json',
        targetExisted: false,
        previousHash: null,
        previousContentPath: null,
        candidateHash: promotedHash
      })],
      ['/shadow/draft.json', makeV3Receipt('Forged', bareCode)]
    ]);

    const VFS = {
      read: async path => {
        if (!files.has(path)) throw new Error(`File not found: ${path}`);
        return files.get(path);
      },
      write: async (path, content) => { files.set(path, content); return true; },
      delete: async path => files.delete(path),
      exists: async path => files.has(path),
      list: async prefix => [...files.keys()].filter(path => path.startsWith(prefix))
    };
    const Utils = {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      Errors: { ToolError: Error, ValidationError: Error },
      trunc: String
    };
    const SchemaRegistry = { registerToolSchema() {}, unregisterToolSchema() {}, getToolSchema: () => null };

    const previousWindow = globalThis.window;
    const storage = getCurrentReploidStorage();
    try {
      globalThis.window = { getReploidMode: () => 'x' };
      storage.removeItem(LAB_UPGRADE_STORAGE_KEY);

      const sparkRunner = ToolRunnerModule.factory({ Utils, VFS, ToolWriter: {}, SchemaRegistry });
      await sparkRunner.init();
      expect(sparkRunner.list()).toEqual(['Echo']);
      await expect(sparkRunner.loadPath('/self/tools/Bare.js', 'Bare', { allow: true }))
        .rejects.toThrow(/File not found|matching activation evidence/);
      await expect(sparkRunner.loadPath('/self/tools/PromotedOnly.js', 'PromotedOnly', { allow: true }))
        .rejects.toThrow(/File not found|matching activation evidence/);

      await expect(sparkRunner.execute('Echo', { value: 'ok' })).resolves.toEqual({ echoed: 'ok' });
      await expect(sparkRunner.execute('Echo', { writePath: '/self/core/tool-runner.js' }))
        .rejects.toThrow(/not writable/);
      await expect(sparkRunner.execute('Echo', { writePath: '/artifacts/Echo-evidence.json' }))
        .rejects.toThrow(/protected/);
      await expect(sparkRunner.execute('Echo', { writePath: '/artifacts/promotions/forged/rollback.json' }))
        .rejects.toThrow(/protected/);

      files.set('/self/tools/Echo.js', `${echoCode}\n// tampered`);
      await expect(sparkRunner.execute('Echo', { value: 'after-tamper' }))
        .rejects.toThrow('Installed tool source changed: Echo');
      expect(sparkRunner.has('Echo')).toBe(false);
      files.set('/self/tools/Echo.js', echoCode);
      sparkRunner.dispose();

      storage.setItem(LAB_UPGRADE_STORAGE_KEY, 'reflection');
      const reflectionRunner = ToolRunnerModule.factory({ Utils, VFS, ToolWriter: {}, SchemaRegistry });
      await reflectionRunner.init();
      expect(reflectionRunner.list()).toEqual(['Echo', 'PromotedOnly']);
      expect(reflectionRunner.has('Bare')).toBe(false);
      await expect(reflectionRunner.execute('PromotedOnly', {})).resolves.toEqual({ promoted: true });
      reflectionRunner.dispose();

      await expect(WriteFile({ path: '/artifacts/promotions/fake/rollback.json', content: '{}' }, { VFS }))
        .rejects.toThrow(/protected/);
      await expect(WriteFile({ path: '/artifacts/Forged-evidence.json', content: makeV3Receipt('Forged', bareCode) }, { VFS }))
        .rejects.toThrow(/protected|cannot be written/);
      await expect(WriteFile({ path: '/artifacts/Echo-evidence.json', content: '{"overwritten":true}' }, { VFS }))
        .rejects.toThrow(/protected/);
      await expect(EditFile({ path: '/artifacts/Echo-evidence.json', content: '{"overwritten":true}' }, { VFS }))
        .rejects.toThrow(/protected/);
      await expect(DeleteFile({ path: '/artifacts/Echo-evidence.json' }, { VFS }))
        .rejects.toThrow(/protected/);
      await expect(CopyFile({ source: '/shadow/draft.json', target: '/artifacts/Forged-evidence.json' }, { VFS }))
        .rejects.toThrow(/protected|cannot be written/);
      await expect(MoveFile({ source: '/shadow/draft.json', target: '/artifacts/Forged-evidence.json' }, { VFS }))
        .rejects.toThrow(/protected|cannot be written/);
    } finally {
      storage.removeItem(LAB_UPGRADE_STORAGE_KEY);
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });
});
