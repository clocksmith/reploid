#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PROJECT_ROOT,
  getJourneyRegistryPath,
  validateCriticalUserJourneyRegistry,
  validateJourneyExtension
} from './critical-user-journey-contract.js';

export { PROJECT_ROOT };
export const JOURNEY_REGISTRY_PATH = getJourneyRegistryPath('x');
export const BASE_REGISTRY = 'docs/status/zero-critical-user-journeys.json';

// X's registry extends Zero's: it holds only X additions and journeys whose status differs.
export const validateXCriticalUserJourneys = async (registry, { root = PROJECT_ROOT, base = null } = {}) => {
  const errors = await validateCriticalUserJourneyRegistry(registry, {
    root,
    expectedSchema: 'reploid/x-critical-user-journeys/v2',
    expectedSurface: '/x',
    requiredRoutes: ['/x']
  });
  if (registry?.extends !== BASE_REGISTRY) {
    errors.push(`extends must be ${BASE_REGISTRY}`);
    return errors;
  }
  const zero = base || JSON.parse(await fs.readFile(path.resolve(root, BASE_REGISTRY), 'utf8'));
  return [...errors, ...validateJourneyExtension(registry, zero)];
};

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
