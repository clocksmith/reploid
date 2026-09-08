import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROJECT_ROOT,
  catscanChainForPath,
  loadCatscans,
  validateCatscanRepository
} from '../../scripts/verify-catscan.js';

const validCharter = ({ component, parent = 'none', evidence = 'evidence.test.js' }) => `# CATSCAN: ${component}

Parent: ${parent}

## Target

Produce one bounded observable outcome.

## Authority
- Owns its declared state.
- Does not own adjacent policy.

## Scope
- Includes the fixture component.

## Contracts
Inputs:
- Declared input.

Outputs:
- Declared output.

## Invariants
- Evidence and claims remain distinct.

## Acceptance
- The bounded outcome is observable.
- Evidence: [focused test](${evidence}).

## Non-goals
- Adjacent policy.

## Freedom
Any mechanism is permitted if it preserves these boundaries and passes the acceptance evidence.
`;

describe('CATSCAN component charters', () => {
  it('validates the repository charter graph and generated index', async () => {
    const { charters, errors } = await validateCatscanRepository();

    expect(errors).toEqual([]);
    expect(charters.length).toBeGreaterThanOrEqual(20);
    expect(charters.map((charter) => charter.component)).toEqual(expect.arrayContaining([
      'Reploid',
      'Poolday Interface',
      'Poolday Evidence Runtime',
      'X Operator Workbench',
      'Zero Proposal Interface'
    ]));
  });

  it('resolves the complete root-to-file charter chain in order', async () => {
    const charters = await loadCatscans();
    const chain = catscanChainForPath('self/ui/pool-home/view.js', charters)
      .map((charter) => path.relative(PROJECT_ROOT, charter.filePath).split(path.sep).join('/'));

    expect(chain).toEqual([
      'CATSCAN.md',
      'self/CATSCAN.md',
      'self/ui/CATSCAN.md',
      'self/ui/pool-home/CATSCAN.md'
    ]);
  });

  it('rejects duplicate identifiers, incomplete fields, bad parents, and missing links', async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-catscan-'));
    try {
      await fs.writeFile(path.join(fixtureRoot, 'evidence.test.js'), 'export {}\n');
      await fs.writeFile(path.join(fixtureRoot, 'CATSCAN.md'), validCharter({ component: 'Fixture Root' }));
      await fs.mkdir(path.join(fixtureRoot, 'child'));
      const invalidChild = validCharter({
        component: 'Fixture Root',
        parent: '[Missing](../missing/CATSCAN.md)',
        evidence: 'missing-evidence.test.js'
      }).replace(/## Invariants\n- Evidence and claims remain distinct\.\n\n/, '');
      await fs.writeFile(path.join(fixtureRoot, 'child', 'CATSCAN.md'), invalidChild);

      const { errors } = await validateCatscanRepository({
        root: fixtureRoot,
        checkIndex: false
      });

      expect(errors).toEqual(expect.arrayContaining([
        'child/CATSCAN.md: component identifier duplicates CATSCAN.md',
        'child/CATSCAN.md: missing Invariants field',
        'child/CATSCAN.md: Parent must reference CATSCAN.md',
        'child/CATSCAN.md: local link is missing: ../missing/CATSCAN.md',
        'child/CATSCAN.md: local link is missing: missing-evidence.test.js'
      ]));
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each(['file', 'directory'])('keeps a nested Git %s boundary separate from ordinary hidden components', async (gitKind) => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-catscan-boundary-'));
    try {
      await fs.mkdir(path.join(fixtureRoot, '.git'));
      await fs.writeFile(path.join(fixtureRoot, 'evidence.test.js'), 'export {}\n');
      await fs.writeFile(path.join(fixtureRoot, 'CATSCAN.md'), validCharter({ component: 'Fixture Root' }));
      const nested = path.join(fixtureRoot, '.checkouts', 'candidate');
      await fs.mkdir(nested, { recursive: true });
      if (gitKind === 'file') {
        await fs.writeFile(path.join(nested, '.git'), 'gitdir: /tmp/fixture-worktree-metadata\n');
      } else {
        await fs.mkdir(path.join(nested, '.git'));
      }
      await fs.writeFile(path.join(nested, 'CATSCAN.md'), validCharter({ component: 'Fixture Root' }));
      await fs.writeFile(path.join(nested, 'evidence.test.js'), 'export {}\n');
      const hidden = path.join(fixtureRoot, '.component');
      await fs.mkdir(hidden);
      await fs.writeFile(path.join(hidden, 'CATSCAN.md'), validCharter({
        component: 'Hidden Component',
        parent: '[Root](../CATSCAN.md)',
        evidence: '../evidence.test.js'
      }));

      const result = await validateCatscanRepository({ root: fixtureRoot, checkIndex: false });
      expect(result.errors).toEqual([]);
      expect(result.charters.map((charter) => charter.component).sort()).toEqual(['Fixture Root', 'Hidden Component']);

      // The nested checkout remains independently valid when selected as the root.
      const nestedResult = await validateCatscanRepository({ root: nested, checkIndex: false });
      expect(nestedResult.errors).toEqual([]);
      expect(nestedResult.charters).toHaveLength(1);

      // Discovery must still report invalid charters in ordinary hidden directories.
      await fs.writeFile(path.join(hidden, 'CATSCAN.md'), '# CATSCAN: Broken\n');
      const invalid = await validateCatscanRepository({ root: fixtureRoot, checkIndex: false });
      expect(invalid.errors).toContain('.component/CATSCAN.md: missing Target field');
    } finally {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
