#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PROJECT_ROOT,
  getJourneyRegistryPath,
  validateCriticalUserJourneyRegistry
} from './critical-user-journey-contract.js';

export { PROJECT_ROOT };
export const JOURNEY_REGISTRY_PATH = getJourneyRegistryPath('x');

export const validateXCriticalUserJourneys = (registry, { root = PROJECT_ROOT } = {}) => (
  validateCriticalUserJourneyRegistry(registry, {
    root,
    expectedSchema: 'reploid/x-critical-user-journeys/v1',
    expectedSurface: '/x',
    requiredRoutes: ['/x']
  })
);

export async function verifyXCriticalUserJourneys(registryPath = JOURNEY_REGISTRY_PATH) {
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  return validateXCriticalUserJourneys(registry, {
    root: path.resolve(path.dirname(registryPath), '..', '..')
  });
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const errors = await verifyXCriticalUserJourneys();
  if (errors.length > 0) {
    console.error('X critical user journey verification failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log('X critical user journeys verified.');
}
