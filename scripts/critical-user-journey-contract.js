import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

const ALLOWED_STATUSES = new Set(['supported', 'conditional', 'limited', 'blocked']);
const ALLOWED_WORK_STATES = new Set(['open', 'blocked']);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isStringArray = (value, { empty = false } = {}) => Array.isArray(value)
  && (empty || value.length > 0)
  && value.every(isNonEmptyString);

export const getJourneyRegistryPath = (surfaceName) => path.join(
  PROJECT_ROOT,
  'docs',
  'status',
  `${surfaceName}-critical-user-journeys.json`
);

export const checkRepoPath = async (repoPath, label, root, errors) => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, repoPath);
  if (path.isAbsolute(repoPath) || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    errors.push(`${label} escapes the repository: ${repoPath}`);
    return;
  }
  try {
    await fs.access(resolved);
  } catch {
    errors.push(`${label} is missing: ${repoPath}`);
  }
};

export async function validateCriticalUserJourneyRegistry(registry, {
  root = PROJECT_ROOT,
  expectedSchema,
  expectedSurface,
  requiredRoutes = []
} = {}) {
  const errors = [];
  if (registry?.schema !== expectedSchema) {
    errors.push(`schema must be ${expectedSchema}`);
  }
  if (!isNonEmptyString(registry?.updated)) errors.push('updated must be a non-empty string');
  if (registry?.surface !== expectedSurface) {
    errors.push(`surface must be ${expectedSurface}`);
  }
  if (!Array.isArray(registry?.journeys) || registry.journeys.length === 0) {
    errors.push('journeys must be a non-empty array');
    return errors;
  }
  if (!Array.isArray(registry?.openWork)) errors.push('openWork must be an array');
  if (!isStringArray(registry?.constraints)) {
    errors.push('constraints must be a non-empty string array');
  }

  const workIds = new Set();
  const journeyIds = new Set();
  const coveredRoutes = new Set();

  for (const [position, work] of (registry.openWork || []).entries()) {
    const label = `openWork[${position}]`;
    if (!isNonEmptyString(work?.id)) errors.push(`${label}.id must be a non-empty string`);
    else if (workIds.has(work.id)) errors.push(`${label}.id duplicates ${work.id}`);
    else workIds.add(work.id);
    if (!ALLOWED_WORK_STATES.has(work?.state)) errors.push(`${label}.state must be open or blocked`);
    if (!/^P[0-2]$/.test(String(work?.priority || ''))) {
      errors.push(`${label}.priority must be P0, P1, or P2`);
    }
    if (!isStringArray(work?.journeyIds)) {
      errors.push(`${label}.journeyIds must be a non-empty string array`);
    }
    if (!isNonEmptyString(work?.summary)) errors.push(`${label}.summary must be a non-empty string`);
    if (!isNonEmptyString(work?.acceptance)) {
      errors.push(`${label}.acceptance must be a non-empty string`);
    }
  }

  for (const [position, journey] of registry.journeys.entries()) {
    const label = `journeys[${position}]`;
    if (!isNonEmptyString(journey?.id)) errors.push(`${label}.id must be a non-empty string`);
    else if (journeyIds.has(journey.id)) errors.push(`${label}.id duplicates ${journey.id}`);
    else journeyIds.add(journey.id);
    if (!isNonEmptyString(journey?.actor)) errors.push(`${label}.actor must be a non-empty string`);
    if (!isNonEmptyString(journey?.outcome)) errors.push(`${label}.outcome must be a non-empty string`);
    if (!ALLOWED_STATUSES.has(journey?.status)) {
      errors.push(`${label}.status must be supported, conditional, limited, or blocked`);
    }
    if (typeof journey?.releaseCritical !== 'boolean') {
      errors.push(`${label}.releaseCritical must be boolean`);
    }
    if (!isStringArray(journey?.routes)) {
      errors.push(`${label}.routes must be a non-empty string array`);
    }
    for (const route of journey?.routes || []) coveredRoutes.add(route);
    if (!isStringArray(journey?.prerequisites, { empty: true })) {
      errors.push(`${label}.prerequisites must be a string array`);
    }
    if (!isStringArray(journey?.limitations)) {
      errors.push(`${label}.limitations must be a non-empty string array`);
    }
    if (!isStringArray(journey?.openWorkIds, { empty: true })) {
      errors.push(`${label}.openWorkIds must be a string array`);
    }

    const blocked = journey?.status === 'blocked';
    if (!isStringArray(journey?.implementationPaths, { empty: blocked })) {
      errors.push(
        `${label}.implementationPaths must ${blocked ? 'be a string array' : 'be a non-empty string array'}`
      );
    }
    if (!isStringArray(journey?.testPaths, { empty: blocked })) {
      errors.push(
        `${label}.testPaths must ${blocked ? 'be a string array' : 'be a non-empty string array'}`
      );
    }
    for (const repoPath of [...(journey?.implementationPaths || []), ...(journey?.testPaths || [])]) {
      await checkRepoPath(repoPath, label, root, errors);
    }
  }

  for (const journey of registry.journeys) {
    for (const workId of journey.openWorkIds || []) {
      if (!workIds.has(workId)) {
        errors.push(`journey ${journey.id} references unknown openWork ${workId}`);
      }
    }
  }
  for (const work of registry.openWork || []) {
    for (const journeyId of work.journeyIds || []) {
      if (!journeyIds.has(journeyId)) {
        errors.push(`openWork ${work.id} references unknown journey ${journeyId}`);
      }
      const journey = registry.journeys.find((candidate) => candidate.id === journeyId);
      if (journey && !(journey.openWorkIds || []).includes(work.id)) {
        errors.push(`openWork ${work.id} is not linked back from journey ${journeyId}`);
      }
    }
  }
  for (const route of requiredRoutes) {
    if (!coveredRoutes.has(route)) {
      errors.push(`critical ${expectedSurface} route is not covered by a journey: ${route}`);
    }
  }

  if (!isNonEmptyString(registry?.releaseEvidence?.gate)) {
    errors.push('releaseEvidence.gate must be a non-empty string');
  } else {
    await checkRepoPath(registry.releaseEvidence.gate, 'releaseEvidence.gate', root, errors);
  }
  if (!isStringArray(registry?.releaseEvidence?.requiredArtifactFields)) {
    errors.push('releaseEvidence.requiredArtifactFields must be a non-empty string array');
  }
  if (registry?.releaseEvidence?.retainedArtifact) {
    await checkRepoPath(
      registry.releaseEvidence.retainedArtifact,
      'releaseEvidence.retainedArtifact',
      root,
      errors
    );
  } else if (registry?.releaseEvidence?.status !== 'not-retained') {
    errors.push('releaseEvidence without retainedArtifact must have status not-retained');
  }

  return errors;
}
