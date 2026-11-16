import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifyLayer,
  extractModuleSpecifiers,
  findLayerViolations,
  findExecutionOwnerViolations,
  moduleEdges,
  findCycles,
  findRequiredModuleLeaks,
  validateArchitectureExceptions
} from '../../scripts/verify-layers.js';

const repoRoot = path.resolve('/workspace/reploid');

describe('layer verification', () => {
  it('requires a real exception owner and a concrete removal condition', () => {
    const exceptions = { loaders: [{ source: 'probe.js', expression: 'loader', owner: 'missing/CATSCAN.md', contract: 'A scoped loader' }], cycles: [] };
    const violations = validateArchitectureExceptions(exceptions, repoRoot);
    expect(violations.map(row => row.reason)).toEqual([
      'exception requires removalCondition', 'exception owner does not exist inside repository: missing/CATSCAN.md'
    ]);
  });
  it('retains computed URL assets for the owned-loader check', () => {
    expect(moduleEdges('new URL(assetPath, import.meta.url)')).toEqual([
      { specifier: null, expression: 'assetPath', dynamic: true }
    ]);
  });
  it('keeps native execution independent from product provider implementations', () => {
    const sourcePath = path.join(repoRoot, 'server/native-whole-model.js');
    expect(findLayerViolations({ repoRoot, sourcePath,
      source: "import { createWorkResidentProvider } from '../apps/poolday/providers/work-resident-provider.js'" }))
      .toEqual([expect.objectContaining({ reason: 'native hosts must use shared execution ports, not product provider implementations' })]);
    expect(findLayerViolations({ repoRoot, sourcePath,
      source: "import policy from '../apps/poolday/config/work-profile.json' with { type: 'json' }" })).toEqual([]);
  });
  it.each([
    ['partition-discovery.js', './partition-placement.js'],
    ['partition-placement.js', '../../transport/partition-data-channel.js'],
    ['partition-reservations.js', './resident-partition.js'],
  ])('keeps %s independent from %s', (owner, dependency) => {
    const violations = findLayerViolations({ repoRoot,
      sourcePath: path.join(repoRoot, 'packages/reploid/src/mesh/partitions', owner),
      source: `import '${dependency}';` });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('must remain independent');
  });
  it('classifies architectural source roots', () => {
    expect(classifyLayer('self/pool/config.js')).toBe('self/pool');
    expect(classifyLayer('self/core/agent-loop.js')).toBe('self/core');
    expect(classifyLayer('self/ui/pool-home/view.js')).toBe('self/ui');
    expect(classifyLayer('server/pool/routes.js')).toBe('server');
    expect(classifyLayer('scripts/verify-layers.js')).toBeNull();
  });

  it('extracts static, re-export, side-effect, and literal dynamic imports', () => {
    expect(extractModuleSpecifiers([
      "import value from './value.js';",
      "export { other } from './other.js';",
      "import './side-effect.js';",
      "const lazy = import('./lazy.js');"
    ].join('\n'))).toEqual([
      './value.js',
      './other.js',
      './side-effect.js',
      './lazy.js'
    ]);
  });

  it('applies dependency ownership to assets addressed through import.meta.url', () => {
    expect(findLayerViolations({ repoRoot,
      sourcePath: path.join(repoRoot, 'packages/reploid/src/transport/probe.js'),
      source: "new URL('../chat/workspace.js', import.meta.url);" }))
      .toEqual([expect.objectContaining({ reason: 'transport cannot own execution or application policy' })]);
  });

  it('rejects domain imports that reach into presentation', () => {
    const violations = findLayerViolations({
      repoRoot,
      sourcePath: path.join(repoRoot, 'self/pool/domain.js'),
      source: "import { render } from '../ui/pool-home/view.js';"
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      sourceLayer: 'self/pool',
      targetLayer: 'self/ui'
    });
  });

  it('allows server adapters to consume shared Pool domain contracts', () => {
    const violations = findLayerViolations({
      repoRoot,
      sourcePath: path.join(repoRoot, 'server/pool/config.js'),
      source: "import { createContract } from '../../apps/poolday/pool/config-contract.js';"
    });

    expect(violations).toEqual([]);
  });

  it('parses real edges without interpreting comments or strings as imports', () => {
    expect(moduleEdges("// import './fake.js'\nconst text = \"import('./fake.js')\"; import(`./real.js`); import(loader);")).toEqual([
      { specifier: './real.js', expression: '`./real.js`', dynamic: true },
      { specifier: null, expression: 'loader', dynamic: true }
    ]);
  });

  it.each([
    ['server/entry.js', '../self/tools/Promote.js'],
    ['server/entry.js', '../apps/poolday/ui/pool-home/work.js'],
    ['packages/reploid/src/agent/turn.js', '../../../../self/config/models.js'],
    ['packages/reploid/src/agent/turn.js', 'firebase-admin'],
    ['packages/reploid/src/transport/peer.js', '../adapters/doppler.js'],
    ['self/ui/page.js', '../../packages/functions/index.js'],
    ['packages/reploid/src/transport/peer.js', '../chat/index.js'],
    ['apps/poolday/host/chat-session.js', '../providers/work-network-provider.js'],
    ['apps/poolday/host/chat-execution.js', '../../../shared/vendor/reploid/chat/scheduler.js'],
    ['apps/poolday/host/chat-view.js', './chat-execution.js'],
    ['apps/poolday/host/readonly-view.js', '../infrastructure/storage.js']
  ])('rejects the boundary crossing from %s', (source, target) => {
    expect(findLayerViolations({ repoRoot, sourcePath: path.join(repoRoot, source),
      source: `export * from '${target}';` })).toHaveLength(1);
  });

  it('detects cycles through reexports and preserves acyclic shared dependencies', () => {
    expect(findCycles(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]]))).toEqual([['a', 'b', 'c', 'a']]);
    expect(findCycles(new Map([['a', ['c']], ['b', ['c']], ['c', []]]))).toEqual([]);
  });

  it('allows optional extensions but rejects their mandatory inclusion in Zero', () => {
    const surface = { requiredModules: ['core'], absentModules: ['sandbox'] };
    const modules = { core: { dependencies: [{ id: 'sandbox', optional: true }] } };
    expect(findRequiredModuleLeaks(surface, modules)).toEqual([]);
    modules.core.dependencies[0].optional = false;
    expect(findRequiredModuleLeaks(surface, modules)).toEqual([['core', 'sandbox']]);
  });
  it('keeps compatibility entries inert and strategies behind the engine', () => {
    const root = 'packages/reploid/src/agent/';
    expect(findExecutionOwnerViolations(root + 'runtime.js', "export { createTaskStrategy as createAgentRuntime } from './task-strategy.js';")).toEqual([]);
    expect(findExecutionOwnerViolations(root + 'runtime.js', 'export function loop() { while (true) {} }')).toHaveLength(1);
    expect(findExecutionOwnerViolations(root + 'lab-strategy.js', 'setTimeout(resume, 10)')).toHaveLength(1);
    expect(findLayerViolations({ repoRoot, sourcePath: path.join(repoRoot, root + 'task-strategy.js'),
      source: "import { dispatchTool } from './tool-dispatch.js'" })).toHaveLength(1);
  });

});
