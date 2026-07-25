import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifyLayer,
  extractModuleSpecifiers,
  findLayerViolations
} from '../../scripts/verify-layers.js';

const repoRoot = path.resolve('/workspace/reploid');

describe('layer verification', () => {
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
      source: "import { createContract } from '../../self/pool/config-contract.js';"
    });

    expect(violations).toEqual([]);
  });
});
