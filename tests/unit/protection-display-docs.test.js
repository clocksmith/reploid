/**
 * The "Who can read it?" names, the "Where it runs" route labels and the code texts have one source
 * (inference/protections.js). The docs quote them verbatim.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROTECTION_DISPLAY, ROUTE_DISPLAY, SPLIT_DISPLAY, READER_ROLE_DISPLAY, ASSUMPTION_DISPLAY } from '../../packages/reploid/src/inference/protections.js';
import { PROTECTIONS, PROTECTION_ROUTES } from '../../packages/reploid/src/chat/execution-policy.js';
import { READER_ROLES, ASSUMPTIONS } from '../../packages/reploid/src/inference/contract.js';

const doc = readFileSync(resolve(process.cwd(), 'docs/confidential-execution.md'), 'utf8');

describe('protection display names in the docs', () => {
  it('lists every protection value with its label and line in one table row', () => {
    expect(Object.keys(PROTECTION_DISPLAY).sort()).toEqual([...PROTECTIONS].sort());
    for (const [value, { label, line }] of Object.entries(PROTECTION_DISPLAY)) {
      expect(doc).toContain(`| ${label} | \`${value}\` | ${line} |`);
    }
  });

  it('lists every route with its "Where it runs" label, and each protection with exactly its routes', () => {
    for (const [route, { label }] of Object.entries(ROUTE_DISPLAY)) expect(doc).toContain(`| ${label} | \`${route}\` |`);
    for (const protection of PROTECTIONS) {
      expect(doc).toContain(`| \`${protection}\` | ${PROTECTION_ROUTES[protection].map(route => `\`${route}\``).join(', ')} |`);
    }
  });

  it('quotes the requester-held edges line and documents the reader count for any plaintext split', () => {
    expect(doc).toContain(SPLIT_DISPLAY['requester-edges'].line);
    expect(doc).toMatch(/\*\*Any plaintext split\*\* shows how many computers can read the message/);
  });

  it('lists every reader role and assumption code with its display text', () => {
    for (const role of READER_ROLES) expect(doc).toContain(`| \`${role}\` | ${READER_ROLE_DISPLAY[role]} |`);
    for (const code of ASSUMPTIONS) expect(doc).toContain(`| \`${code}\` | ${ASSUMPTION_DISPLAY[code]} |`);
  });

  it('states that protections are not ranked, that auto can widen readers, and that only your devices is a participants choice', () => {
    expect(doc).toMatch(/protections are not ranked/);
    expect(doc).toMatch(/"never weaker protection" does not mean "never\s+more readers"/);
    expect(doc).toMatch(/\*\*Only your devices\*\* is a participants choice, not a route/);
  });
});
