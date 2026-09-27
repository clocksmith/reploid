#!/usr/bin/env node

import { verifyPoolCriticalUserJourneys } from './verify-pool-critical-user-journeys.js';
import { verifyZeroCriticalUserJourneys } from './verify-zero-critical-user-journeys.js';
import { verifyXCriticalUserJourneys } from './verify-x-critical-user-journeys.js';

const checks = [
  ['Poolday', verifyPoolCriticalUserJourneys],
  ['Zero', verifyZeroCriticalUserJourneys],
  ['X', verifyXCriticalUserJourneys]
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

if (failed) process.exit(1);
