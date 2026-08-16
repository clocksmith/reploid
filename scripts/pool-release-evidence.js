/**
 * @fileoverview Durable indexing for one Poolday release-verification run.
 *
 * This artifact preserves Playwright lane reports before the shared JSON output
 * is overwritten. It is audit evidence, not a browser-qualification receipt.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export const POOL_RELEASE_EVIDENCE_SCHEMA = 'poolday.browser_release_evidence_set/v1';
export const POOL_RELEASE_LANE_SCHEMA = 'poolday.browser_release_lane/v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const safeName = (value) => String(value || 'attachment')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  || 'attachment';

const collectSpecs = (suite, specs = []) => {
  specs.push(...(suite?.specs || []));
  for (const child of suite?.suites || []) collectSpecs(child, specs);
  return specs;
};

export function findPlaywrightLaneResult(report = {}, grep = '') {
  const specs = (report.suites || []).flatMap((suite) => collectSpecs(suite));
  const matching = specs.filter((spec) => String(spec.title || '').includes(grep));
  if (matching.length !== 1) {
    throw new Error(`expected one Playwright spec matching ${grep}, found ${matching.length}`);
  }
  const spec = matching[0];
  const tests = spec.tests || [];
  if (tests.length !== 1) {
    throw new Error(`expected one Playwright test for ${spec.title}, found ${tests.length}`);
  }
  const results = tests[0].results || [];
  if (results.length === 0) throw new Error(`Playwright test has no result: ${spec.title}`);
  return { spec, test: tests[0], result: results[results.length - 1] };
}

const readAttachmentBytes = async (attachment) => {
  if (text(attachment?.body)) return Buffer.from(attachment.body, 'base64');
  if (text(attachment?.path)) return fs.readFile(attachment.path);
  throw new Error(`attachment has no body or path: ${attachment?.name || 'unnamed'}`);
};

export async function capturePoolReleaseLane({
  lane,
  reportPath,
  outputDirectory,
  expectedRelease = null,
  requirePassed = true
} = {}) {
  if (!text(lane?.id) || !text(lane?.label) || !text(lane?.grep)) {
    throw new TypeError('release lane id, label, and grep are required');
  }
  const reportBytes = await fs.readFile(reportPath);
  const report = JSON.parse(reportBytes.toString('utf8'));
  const { spec, test, result } = findPlaywrightLaneResult(report, lane.grep);
  if (requirePassed && result.status !== 'passed') {
    throw new Error(`Playwright lane did not pass: ${lane.id} (${result.status || 'missing'})`);
  }
  await fs.mkdir(outputDirectory, { recursive: true });
  const reportFilename = `${safeName(lane.id)}.playwright.json`;
  await fs.writeFile(path.join(outputDirectory, reportFilename), reportBytes);

  const attachments = [];
  const attachmentBytesByName = new Map();
  const nameCounts = new Map();
  for (const attachment of result.attachments || []) {
    const attachmentBytes = await readAttachmentBytes(attachment);
    const baseName = safeName(attachment.name);
    const count = nameCounts.get(baseName) || 0;
    nameCounts.set(baseName, count + 1);
    const filename = `${safeName(lane.id)}.${count === 0 ? baseName : `${count + 1}-${baseName}`}`;
    await fs.writeFile(path.join(outputDirectory, filename), attachmentBytes);
    attachmentBytesByName.set(attachment.name, attachmentBytes);
    attachments.push({
      name: attachment.name,
      contentType: attachment.contentType || 'application/octet-stream',
      path: filename,
      byteLength: attachmentBytes.byteLength,
      sha256: sha256(attachmentBytes)
    });
  }
  const attachmentNames = new Set(attachments.map((attachment) => attachment.name));
  const missingAttachments = (lane.requiredAttachments || []).filter((name) => !attachmentNames.has(name));
  if (missingAttachments.length > 0) {
    throw new Error(`Playwright lane ${lane.id} is missing attachments: ${missingAttachments.join(', ')}`);
  }
  if (expectedRelease) {
    for (const name of lane.requiredAttachments || []) {
      let body;
      try {
        body = JSON.parse(attachmentBytesByName.get(name).toString('utf8'));
      } catch (error) {
        throw new Error(`Playwright lane ${lane.id} release-bound attachment is not JSON: ${name} (${error.message})`);
      }
      const observed = body.release || {};
      if (observed.sourceRevision !== expectedRelease.sourceRevision
        || observed.sourceTreeHash !== expectedRelease.sourceTreeHash
        || observed.browserBundleHash !== expectedRelease.browserBundleHash
        || observed.sourceDirty !== false) {
        throw new Error(`Playwright lane ${lane.id} attachment release identity does not match: ${name}`);
      }
    }
  }

  return {
    schema: POOL_RELEASE_LANE_SCHEMA,
    laneId: lane.id,
    label: lane.label,
    grep: lane.grep,
    status: result.status,
    testTitle: spec.title,
    projectName: test.projectName || null,
    startedAt: result.startTime || null,
    durationMs: Number(result.duration || 0),
    qualificationChecks: [...(lane.qualificationChecks || [])],
    supportingClaim: lane.supportingClaim || null,
    releaseBound: expectedRelease !== null,
    report: {
      path: reportFilename,
      byteLength: reportBytes.byteLength,
      sha256: sha256(reportBytes)
    },
    attachments
  };
}

export function buildPoolReleaseEvidenceIndex({
  status,
  createdAt,
  release,
  deployment,
  config,
  requiredLaneIds,
  lanes,
  failure = null
} = {}) {
  const record = {
    schema: POOL_RELEASE_EVIDENCE_SCHEMA,
    status,
    createdAt,
    release: { ...release },
    deployment: { ...deployment },
    config: { ...config },
    requiredLaneIds: [...(requiredLaneIds || [])],
    lanes: [...(lanes || [])],
    failure,
    qualification: {
      eligible: false,
      reasons: [
        'release lane aggregation is audit evidence, not a browser qualification receipt',
        'two independently operated browser reproductions are not collected by this runner'
      ]
    }
  };
  return { ...record, recordHash: sha256(Buffer.from(JSON.stringify(record))) };
}

export function validatePoolReleaseEvidenceIndex(index = {}) {
  const reasons = [];
  if (index.schema !== POOL_RELEASE_EVIDENCE_SCHEMA) reasons.push('release evidence schema is invalid');
  if (!['running', 'passed', 'failed'].includes(index.status)) reasons.push('release evidence status is invalid');
  if (!text(index.createdAt) || !Number.isFinite(Date.parse(index.createdAt))) reasons.push('release evidence timestamp is invalid');
  if (!text(index.release?.sourceRevision)
    || !SHA256_PATTERN.test(index.release?.sourceTreeHash || '')
    || !SHA256_PATTERN.test(index.release?.browserBundleHash || '')
    || index.release?.sourceDirty !== false) {
    reasons.push('release evidence clean release identity is invalid');
  }
  if (!text(index.deployment?.baseUrl)) reasons.push('release evidence deployment URL is missing');
  if (index.status === 'passed' && (
    index.deployment?.backendSourceRevision !== index.release?.sourceRevision
    || !text(index.deployment?.backendImage)
    || !String(index.deployment.backendImage).endsWith(`:${index.release.sourceRevision}`)
    || !SHA256_PATTERN.test(index.deployment?.backendRuntimeBundleHash || '')
    || !text(index.deployment?.platformRevision)
  )) {
    reasons.push('passed release evidence backend identity does not match the source release');
  }
  if (!text(index.config?.version) || !SHA256_PATTERN.test(index.config?.hash || '')) {
    reasons.push('release evidence config identity is invalid');
  }
  const laneIds = (index.lanes || []).map((lane) => lane.laneId);
  if (new Set(laneIds).size !== laneIds.length) reasons.push('release evidence lane IDs are not unique');
  for (const lane of index.lanes || []) {
    if (lane.schema !== POOL_RELEASE_LANE_SCHEMA || !text(lane.laneId)
      || !SHA256_PATTERN.test(lane.report?.sha256 || '')) {
      reasons.push(`release lane evidence is invalid: ${lane.laneId || 'missing'}`);
    }
    for (const attachment of lane.attachments || []) {
      if (!text(attachment.name) || !text(attachment.path)
        || !SHA256_PATTERN.test(attachment.sha256 || '')) {
        reasons.push(`release lane attachment is invalid: ${lane.laneId || 'missing'}`);
      }
    }
  }
  if (index.status === 'passed') {
    const required = index.requiredLaneIds || [];
    if (required.length === 0
      || required.some((laneId) => !laneIds.includes(laneId))
      || (index.lanes || []).some((lane) => lane.status !== 'passed' || lane.releaseBound !== true)) {
      reasons.push('passed release evidence does not contain every passed required lane');
    }
  }
  if (index.qualification?.eligible !== false) {
    reasons.push('release evidence cannot be promotion eligible');
  }
  const { recordHash, ...record } = index;
  if (!SHA256_PATTERN.test(recordHash || '') || recordHash !== sha256(Buffer.from(JSON.stringify(record)))) {
    reasons.push('release evidence record hash is invalid');
  }
  return { ok: reasons.length === 0, reasons };
}

export async function writePoolReleaseEvidenceIndex(outputDirectory, input) {
  const index = buildPoolReleaseEvidenceIndex(input);
  const validation = validatePoolReleaseEvidenceIndex(index);
  if (!validation.ok) throw new Error(`release evidence index is invalid: ${validation.reasons.join('; ')}`);
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, 'release-evidence.json');
  await fs.writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return { index, outputPath };
}
