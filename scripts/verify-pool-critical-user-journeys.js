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
export const JOURNEY_REGISTRY_PATH = getJourneyRegistryPath('poolday');

const REQUIRED_ROUTES = new Set(['/', '/ask', '/compute', '/records', '/history', '/network']);

export async function validatePoolCriticalUserJourneys(registry, {
  root = PROJECT_ROOT,
  poolConfig = null
} = {}) {
  const errors = await validateCriticalUserJourneyRegistry(registry, {
    root,
    expectedSchema: 'reploid/poolday-critical-user-journeys/v1',
    expectedSurface: '/',
    requiredRoutes: [...REQUIRED_ROUTES]
  });

  const config = poolConfig || JSON.parse(
    await fs.readFile(path.join(root, 'self', 'pool', 'pool-config.json'), 'utf8')
  );
  const enabledModelIds = new Set(
    (config.modelCatalog || []).filter((model) => model.enabled !== false).map((model) => model.modelId)
  );
  const policyIds = new Set(Object.keys(config.policies || {}));

  for (const [position, journey] of (registry.journeys || []).entries()) {
    const label = `journeys[${position}]`;
    for (const modelId of journey?.modelIds || []) {
      if (!enabledModelIds.has(modelId)) errors.push(`${label}.modelIds is not enabled: ${modelId}`);
    }
    for (const policyId of journey?.policyIds || []) {
      if (!policyIds.has(policyId)) {
        errors.push(`${label}.policyIds is unknown: ${policyId}`);
        continue;
      }
      for (const modelId of journey?.modelIds || []) {
        if (!config.policies[policyId]?.allowedModels?.includes(modelId)) {
          errors.push(`${label} model ${modelId} is not allowed by policy ${policyId}`);
        }
      }
    }
  }

  return errors;
}

export async function verifyPoolCriticalUserJourneys(registryPath = JOURNEY_REGISTRY_PATH) {
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  return validatePoolCriticalUserJourneys(registry, {
    root: path.resolve(path.dirname(registryPath), '..', '..')
  });
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const errors = await verifyPoolCriticalUserJourneys();
  if (errors.length > 0) {
    console.error('Poolday critical user journey verification failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log('Poolday critical user journeys verified.');
}
