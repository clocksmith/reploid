import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from '../../scripts/critical-user-journey-contract.js';
import {
  EVIDENCE_STATUSES,
  OWNER_FIRST_VISIT_TEXT,
  validateReploidCriticalUserJourneys
} from '../../scripts/verify-reploid-critical-user-journeys.js';

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
    for (const link of ['../missing-proof.md', '../ROADMAP.md#missing-anchor', '../../outside.md', '#missing-anchor']) {
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

  it('gives every journey acceptance criteria and an evidence status from the allowed set', async () => {
    const headings = [...catalogue.matchAll(/^### ([A-Z]+-\d{2}) — /gm)].map(match => match[1]);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).toEqual(expect.arrayContaining(['FIRST-01', 'FIRST-04', 'MESH-06', 'TRUST-06']));
    const statuses = [...catalogue.matchAll(/^- \*\*Evidence status:\*\* (.*)$/gm)].map(match => match[1]);
    expect(statuses).toHaveLength(headings.length);
    for (const status of statuses) expect(EVIDENCE_STATUSES.some(value => status.startsWith(value))).toBe(true);
    expect(catalogue.match(/^- \*\*Acceptance criteria:\*\*/gm)).toHaveLength(headings.length);

    expect(await validate(catalogue.replace('- **Evidence status:** not shown. Criteria 1 and 3', '- **Evidence status:** mostly fine. Criteria 1 and 3')))
      .toContain('FIRST-01: evidence status must start with one of: not shown, source integration, physical acceptance, release qualified');
    expect(await validate(catalogue.replace(/^(### TRUST-06[^]*?)- \*\*Acceptance criteria:\*\*\n(?: {2}\d+\. .*\n)+/m, '$1')))
      .toContain('TRUST-06: require one nonempty Acceptance criteria field');
    expect(await validate(catalogue.replace(/^(### MESH-06[^]*?)- \*\*Evidence status:\*\* .*$/m, '$1- **Evidence status:** physical acceptance on one laptop.')))
      .toContain('MESH-06: physical acceptance must name its retained receipt or commit');
  });

  it('maps every FIRST journey to existing catalogue journeys', async () => {
    expect(await validate(catalogue.replace('- **Covers:** CONTRIB-01, CONTRIB-02, CONTRIB-05', '- **Covers:** CONTRIB-01, CONTRIB-09')))
      .toContain('FIRST-03: covers unknown catalogue journey CONTRIB-09');
    expect(await validate(catalogue.replace('- **Covers:** MESH-06', '- **Covers:** FIRST-01')))
      .toContain('FIRST-04: Covers entry is not a catalogue journey ID: FIRST-01');
    expect(await validate(catalogue.replace('- **Covers:** MESH-06\n', '')))
      .toContain('FIRST-04: require one nonempty Covers field');
  });

  it("keeps the owner's four journeys and acceptance line byte for byte", async () => {
    const start = catalogue.indexOf('<!-- owner-text:start -->\n') + '<!-- owner-text:start -->\n'.length;
    expect(catalogue.slice(start, catalogue.indexOf('<!-- owner-text:end -->'))).toBe(OWNER_FIRST_VISIT_TEXT);
    const reworded = "The owner's first-visit journeys differ from the pinned copy; change them only on the owner's word";
    expect(await validate(catalogue.replace('No Join button or network\n   setup.', 'No Join button or network setup.'))).toContain(reworded);
    expect(await validate(catalogue.replace('get an answer without configuring', 'get an answer without setting up'))).toContain(reworded);
    expect(await validate(catalogue.replace('<!-- owner-text:end -->', '')))
      .toContain("Missing the owner's first-visit journeys between owner-text markers");
  });

  it('allows additional journeys, uneven families and variable-length flows', async () => {
    const developer = catalogue.match(/### DEV-01[^]*?(?=\n### |\n## )/)[0];
    const extended = catalogue.replace('## Coverage matrix', developer.replaceAll('DEV-01', 'DEV-03') + '\n## Coverage matrix')
      .replace(/^- \*\*Main flow:\*\*.*$/m, '- **Main flow:** Ask and receive an accepted answer.');
    expect(await validate(extended)).toEqual([]);
  });
});
