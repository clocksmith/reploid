import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from '../../scripts/critical-user-journey-contract.js';
import { validateReploidCriticalUserJourneys } from '../../scripts/verify-reploid-critical-user-journeys.js';

const catalogue = readFileSync(`${PROJECT_ROOT}/docs/critical-user-journeys.md`, 'utf8');
const validate = validateReploidCriticalUserJourneys;

describe('Reploid journey catalogue integrity (not runtime qualification)', () => {
  it('validates the actual catalogue, evidence links, anchors and scenario references', async () => {
    expect(await validate(catalogue)).toEqual([]);
  });

  it('detects deletion, renaming, duplicate IDs and malformed headings', async () => {
    expect(await validate(catalogue.replace('### CHAT-01 —', '### CHAT-99 —'))).toContain('Missing stable journey ID: CHAT-01');
    expect(await validate(catalogue.replace('### CHAT-02 —', '### CHAT-01 —'))).toContain('Duplicate journey ID: CHAT-01');
    expect(await validate(catalogue.replace('### CHAT-01 —', '### CHAT-1 —'))).toContain('Malformed journey heading: CHAT-1 — Ask without downloading model weights');
  });

  it('rejects absent, empty and repeated required fields', async () => {
    for (const replacement of ['', '- **Successful outcome:**', '- **Successful outcome:** yes\n- **Successful outcome:** again']) {
      expect(await validate(catalogue.replace(/^- \*\*Successful outcome:\*\*.*$/m, replacement)))
        .toContain('CHAT-01: require one nonempty Successful outcome field');
    }
  });

  it('requires linked evidence and rejects missing files, anchors and escaped paths', async () => {
    expect(await validate(catalogue.replace(/^- \*\*Acceptance evidence:\*\*.*$/m, '- **Acceptance evidence:** no proof linked')))
      .toContain('CHAT-01: acceptance evidence requires a link');
    for (const link of ['../missing-proof.md', '../TODO.md#missing-anchor', '../../outside.md', '#missing-anchor']) {
      expect((await validate(catalogue + `\n[bad evidence](${link})\n`)).some(error => error.startsWith(`Broken catalogue link: ${link}`))).toBe(true);
    }
  });

  it('rejects unknown, ambiguous and missing scenario references', async () => {
    expect(await validate(catalogue.replace('| Ordinary conversation | CHAT-01,', '| Ordinary conversation | CHAT-99,')))
      .toContain('Unknown journey reference: CHAT-99');
    expect(await validate(catalogue.replace('| Ordinary conversation | CHAT-01,', '| Ordinary conversation | CHAT-01/02,')))
      .toContain('Scenario must list explicit journey IDs: Ordinary conversation');
    expect(await validate(catalogue.replace('| Scenario | Journeys exercised |', '| Other | Journeys exercised |')))
      .toContain('Missing scenario coverage table');
  });

  it('rejects a malformed middle scenario instead of silently truncating the table', async () => {
    const broken = '| Ordinary conversation | CHAT-01 | broken row without end pipe';
    expect(await validate(catalogue.replace(/^\| Ordinary conversation \|.*$/m, broken)))
      .toContain(`Incomplete scenario: ${broken}`);
  });

  it('allows additional journeys, uneven families and variable-length flows', async () => {
    const developer = catalogue.match(/### DEV-01[^]*?(?=\n### |\n## )/)[0];
    const extended = catalogue.replace('## Coverage matrix', developer.replaceAll('DEV-01', 'DEV-03') + '\n## Coverage matrix')
      .replace(/^- \*\*Main flow:\*\*.*$/m, '- **Main flow:** Ask and receive an accepted answer.');
    expect(await validate(extended)).toEqual([]);
  });
});
