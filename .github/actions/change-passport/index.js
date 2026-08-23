import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { ChangePassportClient, ChangePassportHttpError } from '../../../sdk/change-passport/dist/index.js';
import {
  canonicalChangePassportJson,
  hashChangePassportValue,
  normalizeChangePassportStart
} from '../../../self/core/change-passport.js';

export const CHANGE_PASSPORT_CI_SCHEMA = 'change.passport-ci/v1';

const sha256File = async (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return `sha256:${hash.digest('hex')}`;
};

const validateGitHubBinding = (passport, environment = process.env) => {
  const expectedRepository = `${passport.proposal.repository.owner}/${passport.proposal.repository.name}`;
  if (environment.GITHUB_REPOSITORY && environment.GITHUB_REPOSITORY !== expectedRepository) {
    throw new Error(`Manifest repository ${expectedRepository} does not match GITHUB_REPOSITORY ${environment.GITHUB_REPOSITORY}`);
  }
  if (environment.GITHUB_SHA && environment.GITHUB_SHA !== passport.proposal.candidateRevision) {
    throw new Error('Manifest candidateRevision does not match GITHUB_SHA');
  }
};

const assertExistingPassportBinding = (expectedInput, projection) => {
  const expected = normalizeChangePassportStart(expectedInput);
  const actual = {
    passportId: projection.passportId,
    organizationId: projection.organizationId,
    changeClass: projection.changeClass,
    proposal: projection.proposal,
    policy: projection.policy,
    evaluator: projection.evaluator,
    budget: projection.budget,
    rollback: projection.rollback,
    evidenceCutoff: projection.evidenceCutoff,
    createdAt: projection.createdAt,
    sourceEpisode: projection.sourceEpisode
  };
  if (canonicalChangePassportJson(actual) !== canonicalChangePassportJson(expected)) {
    throw new Error('Existing Change Passport does not match the frozen CI manifest');
  }
};

const resolveEventPayload = async (client, passportId, event, workspace) => {
  const payload = structuredClone(event.payload || {});
  if (event.type === 'evidence.admitted' && payload.file) {
    const filePath = path.resolve(workspace, payload.file);
    payload.digest = await sha256File(filePath);
    payload.uri ||= `repository:${path.relative(workspace, filePath)}`;
    delete payload.file;
  }
  if (event.type === 'evidence.frozen' && payload.auto === true) {
    const current = await client.getPassport(passportId);
    const admitted = [...current.projection.evidence.admitted]
      .sort((left, right) => String(left.evidenceId).localeCompare(String(right.evidenceId)));
    payload.evidenceIds = admitted.map((entry) => entry.evidenceId);
    payload.manifestHash = await hashChangePassportValue(
      admitted.map((entry) => [entry.evidenceId, entry.digest])
    );
    payload.cutoff ||= new Date().toISOString();
    delete payload.auto;
  }
  if (event.type === 'evaluation.recorded' && payload.resultFile) {
    const result = JSON.parse(await fs.readFile(path.resolve(workspace, payload.resultFile), 'utf8'));
    Object.assign(payload, result);
    delete payload.resultFile;
    const current = await client.getPassport(passportId);
    payload.evaluatorId ||= current.projection.evaluator.evaluatorId;
    payload.evaluatorAuthorityId ||= current.projection.evaluator.authorityId;
    payload.evaluatorHash ||= current.projection.evaluator.evaluatorHash;
    payload.suiteHash ||= current.projection.evaluator.suiteHash;
    payload.contractHash ||= current.projection.evaluator.contractHash;
    payload.baselineHash ||= current.projection.proposal.baselineHash;
    payload.candidateHash ||= current.projection.proposal.candidateHash;
    payload.evidenceManifestHash ||= current.projection.evidence.manifestHash;
  }
  return payload;
};

const writeOutput = async (outputPath, key, value) => {
  if (!outputPath) return;
  await fs.appendFile(outputPath, `${key}=${String(value)}\n`);
};

export async function runChangePassportAction({
  serverUrl,
  accessToken,
  manifestPath,
  workspace = process.cwd(),
  failOnBlocked = false,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  outputPath = environment.GITHUB_OUTPUT || null
} = {}) {
  if (!serverUrl || !accessToken) throw new Error('serverUrl and accessToken are required');
  const resolvedManifestPath = path.resolve(workspace, manifestPath || '.reploid/change-passport.json');
  const manifest = JSON.parse(await fs.readFile(resolvedManifestPath, 'utf8'));
  if (manifest.schema !== CHANGE_PASSPORT_CI_SCHEMA) throw new Error('Change Passport CI manifest schema mismatch');
  if (!manifest.passport?.passportId) throw new Error('Change Passport CI manifest passport is required');
  validateGitHubBinding(manifest.passport, environment);
  const client = new ChangePassportClient({
    baseUrl: serverUrl,
    accessToken,
    clientId: `github-action:${environment.GITHUB_RUN_ID || 'local'}`,
    fetchImpl
  });
  let result;
  if (manifest.create === false) {
    result = await client.getPassport(manifest.passport.passportId);
    assertExistingPassportBinding(manifest.passport, result.projection);
  } else {
    try {
      result = await client.createPassport(manifest.passport, {
        role: manifest.createRole || 'proposer',
        idempotencyKey: manifest.createIdempotencyKey || `create:${manifest.passport.passportId}`
      });
    } catch (error) {
      if (!(error instanceof ChangePassportHttpError) || ![400, 409].includes(error.status)) throw error;
      result = await client.getPassport(manifest.passport.passportId);
      assertExistingPassportBinding(manifest.passport, result.projection);
    }
  }
  for (let index = 0; index < (manifest.events || []).length; index += 1) {
    const event = manifest.events[index];
    const payload = await resolveEventPayload(client, manifest.passport.passportId, event, workspace);
    result = event.type === 'trigger.observed'
      ? await client.observeTrigger(manifest.passport.passportId, payload, {
          role: event.role,
          idempotencyKey: event.idempotencyKey || `event:${index}:${event.type}`
        })
      : await client.appendEvent(manifest.passport.passportId, event.type, payload, {
          role: event.role,
          idempotencyKey: event.idempotencyKey || `event:${index}:${event.type}`
        });
  }
  result = await client.getPassport(manifest.passport.passportId);
  await writeOutput(outputPath, 'passport-id', result.projection.passportId);
  await writeOutput(outputPath, 'gate-status', result.gate.status);
  await writeOutput(outputPath, 'decision-state', result.projection.decision.state);
  await writeOutput(outputPath, 'effect-state', result.projection.effect.state);
  if (failOnBlocked && !result.gate.eligible) {
    const error = new Error(`Change Passport gate is blocked: ${result.gate.reasons.join('; ')}`);
    error.result = result;
    throw error;
  }
  return result;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runChangePassportAction({
    serverUrl: process.env['INPUT_SERVER-URL'],
    accessToken: process.env['INPUT_ACCESS-TOKEN'],
    manifestPath: process.env.INPUT_MANIFEST,
    failOnBlocked: String(process.env['INPUT_FAIL-ON-BLOCKED'] || '').toLowerCase() === 'true'
  }).then((result) => {
    process.stdout.write(`Change Passport ${result.projection.passportId}: ${result.gate.status}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
