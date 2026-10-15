import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compatibilityProblems, markdownProblems, verifyPlanningBoundary } from '../../scripts/verify-planning-boundary.js';

describe('planning boundary', () => {
  it('passes on the repository: link-only compatibility files and no public planning register', async () => {
    expect((await verifyPlanningBoundary()).errors).toEqual([]);
  });

  it('rejects normative text, register entries and prose in a compatibility file', () => {
    const file = 'docs/poolday/product-intent.md';
    expect(compatibilityProblems(file, '# Moved\n\nCompatibility links only. Read the [contract](../product-specification.md).\n\n<a id="x"></a>[X](../a.md#x)\n')).toEqual([]);
    expect(compatibilityProblems(file, 'Contributors MUST disclose limits.\n')).toEqual([`${file}:1: compatibility files carry no normative requirements`]);
    expect(compatibilityProblems(file, '- [ ] **REP-8 — Search.** Retrieve sources.\n')).toEqual([`${file}:1: compatibility files carry no acceptance-register entries`]);
    expect(compatibilityProblems(file, 'Search runs through paid providers.\n')).toEqual([`${file}:1: compatibility files hold only headings, anchors and links`]);
  });

  it('rejects public register entries and relative links into Ouroboros, but not retained evidence or plain mentions', () => {
    expect(markdownProblems('docs/notes.md', '- [x] **DR-6 — Useful combined capacity.**\n')).toHaveLength(1);
    expect(markdownProblems('artifacts/run/README.md', '- [x] **DR-6 — Useful combined capacity.**\n')).toEqual([]);
    expect(markdownProblems('docs/notes.md', 'See [roadmap](../../ouroboros/docs/projects/reploid/roadmap.md).\n')).toHaveLength(1);
    expect(markdownProblems('docs/notes.md', 'The roadmap is private (`ouroboros/docs/projects/reploid/roadmap.md`).\n')).toEqual([]);
  });

  it('rejects a retired planning path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'planning-boundary-'));
    try {
      await fs.writeFile(path.join(root, 'ROADMAP.md'), '# Roadmap\n');
      expect((await verifyPlanningBoundary({ root, files: ['ROADMAP.md'] })).errors)
        .toEqual(['ROADMAP.md: retired planning path; the roadmap and register are private']);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
