#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyZeroCriticalUserJourneys } from './verify-zero-critical-user-journeys.js';
import { verifyXCriticalUserJourneys } from './verify-x-critical-user-journeys.js';
import { verifyReploidCriticalUserJourneys } from './verify-reploid-critical-user-journeys.js';
import {
  PROJECT_ROOT,
  getJourneyRegistryPath,
  renderJourneyStatusTable,
  replaceJourneyStatusTable
} from './critical-user-journey-contract.js';

// Each Markdown status table is generated from its registry; `--write` regenerates them.
export const JOURNEY_DOCS = Object.freeze({ zero: 'docs/zero/critical-user-journeys.md', x: 'docs/x/critical-user-journeys.md' });

export async function checkJourneyStatusTables({ root = PROJECT_ROOT, write = false } = {}) {
  const errors = [];
  const zero = JSON.parse(await readFile(getJourneyRegistryPath('zero'), 'utf8'));
  const x = JSON.parse(await readFile(getJourneyRegistryPath('x'), 'utf8'));
  const tables = {
    zero: renderJourneyStatusTable(zero),
    x: renderJourneyStatusTable(x, { base: zero,
      baseDoc: path.posix.relative(path.posix.dirname(JOURNEY_DOCS.x), JOURNEY_DOCS.zero) })
  };
  for (const [surface, doc] of Object.entries(JOURNEY_DOCS)) {
    const file = path.join(root, doc);
    const current = await readFile(file, 'utf8');
    const next = replaceJourneyStatusTable(current, tables[surface]);
    if (next === null) errors.push(`${doc} has no generated journey-status markers`);
    else if (next !== current && write) await writeFile(file, next);
    else if (next !== current) errors.push(`${doc} status table is stale; run npm run build:journeys`);
  }
  return errors;
}

async function main() {
  const write = process.argv.includes('--write');
  const checks = [
    ['Reploid catalogue integrity', verifyReploidCriticalUserJourneys],
    ['Zero', verifyZeroCriticalUserJourneys],
    ['X', verifyXCriticalUserJourneys],
    ['Zero and X status tables', () => checkJourneyStatusTables({ write })]
  ];
  let failed = false;
  for (const [name, verify] of checks) {
    const errors = await verify();
    if (errors.length === 0) {
      console.log(`${name} critical user journeys verified.`);
      continue;
    }
    failed = true;
    console.error(`${name} critical user journey verification failed:`);
    for (const error of errors) console.error(`- ${error}`);
  }
  if (failed) throw new Error('Critical user journey verification failed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
