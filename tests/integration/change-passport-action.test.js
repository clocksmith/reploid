import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import express from 'express';
import nodeFetch from 'node-fetch';
import { afterEach, describe, expect, it } from 'vitest';

import { runChangePassportAction } from '../../.github/actions/change-passport/index.js';
import { createChangeControlAuthenticator } from '../../server/change-control/auth.js';
import { createChangeControlRouter } from '../../server/change-control/routes.js';
import { createChangeControlService } from '../../server/change-control/service.js';
import { createMemoryChangeControlStore } from '../../server/change-control/store.js';
import {
  auth,
  createServiceFixturePolicy,
  createServiceStartPayload,
  digest,
  fixtureTimestamp
} from '../fixtures/change-passport/service-fixture.js';

const servers = [];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const startService = async () => {
  const store = createMemoryChangeControlStore();
  let second = 20;
  const service = createChangeControlService({ store, now: () => fixtureTimestamp(second++) });
  const token = 'action-token';
  const authenticate = createChangeControlAuthenticator({
    tokenEntries: [{
      token,
      principal: {
        subject: 'authority:proposer',
        authorityId: 'authority:proposer',
        organizationId: 'org:test',
        roles: ['proposer', 'evidence_producer', 'change_authority']
      }
    }]
  });
  const app = express();
  app.use(express.json());
  app.use('/change-control', createChangeControlRouter({ service, store, authenticate }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  return {
    serverUrl: `http://127.0.0.1:${server.address().port}/change-control`,
    token,
    service
  };
};

describe('Change Passport GitHub Action', () => {
  it('hashes admitted artifacts, freezes their manifest, and reports a blocked human-review gate', async () => {
    const { serverUrl, token } = await startService();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-change-passport-action-'));
    temporaryDirectories.push(workspace);
    await fs.mkdir(path.join(workspace, '.reploid'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'artifacts'), { recursive: true });
    const evidenceBytes = 'frozen CI evidence\n';
    await fs.writeFile(path.join(workspace, 'artifacts', 'tests.json'), evidenceBytes);
    const policy = await createServiceFixturePolicy();
    const passport = createServiceStartPayload(policy);
    const manifest = {
      schema: 'change.passport-ci/v1',
      passport,
      events: [
        {
          type: 'trigger.declared',
          role: 'change_authority',
          payload: {
            ...policy.reopeningRules[0],
            condition: policy.reopeningRules[0].match
          }
        },
        {
          type: 'evidence.admitted',
          role: 'evidence_producer',
          payload: {
            evidenceId: 'evidence:ci-tests',
            kind: 'tests',
            file: 'artifacts/tests.json',
            source: 'GitHub Actions',
            summary: 'Frozen CI evidence.',
            observedAt: fixtureTimestamp(2),
            custody: { mode: 'reference_only', accessRequired: true, retention: 'github_owned' }
          }
        },
        {
          type: 'evidence.frozen',
          role: 'change_authority',
          payload: { auto: true, cutoff: fixtureTimestamp(3) }
        }
      ]
    };
    const manifestPath = path.join(workspace, '.reploid', 'change-passport.json');
    const outputPath = path.join(workspace, 'github-output.txt');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const result = await runChangePassportAction({
      serverUrl,
      accessToken: token,
      manifestPath,
      workspace,
      outputPath,
      fetchImpl: nodeFetch,
      environment: {
        GITHUB_REPOSITORY: 'clocksmith/agent-runtime',
        GITHUB_SHA: 'candidate-sha',
        GITHUB_RUN_ID: '77'
      }
    });
    expect(result.projection.evidence.state).toBe('frozen');
    expect(result.gate).toMatchObject({ eligible: false, status: 'blocked' });
    expect(result.projection.evidence.admitted[0].digest).toBe(
      `sha256:${crypto.createHash('sha256').update(evidenceBytes).digest('hex')}`
    );
    expect(await fs.readFile(outputPath, 'utf8')).toContain('passport-id=passport:service:1');
    expect(await fs.readFile(outputPath, 'utf8')).toContain('gate-status=blocked');
  });

  it('rejects a manifest bound to a stale candidate revision before network activity', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-change-passport-stale-'));
    temporaryDirectories.push(workspace);
    const policy = await createServiceFixturePolicy();
    const manifestPath = path.join(workspace, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({
      schema: 'change.passport-ci/v1',
      passport: createServiceStartPayload(policy),
      events: []
    }));
    await expect(runChangePassportAction({
      serverUrl: 'https://reploid.invalid/change-control',
      accessToken: 'unused',
      manifestPath,
      workspace,
      environment: {
        GITHUB_REPOSITORY: 'clocksmith/agent-runtime',
        GITHUB_SHA: 'different-candidate'
      },
      fetchImpl: () => { throw new Error('network should not run'); }
    })).rejects.toThrow('candidateRevision does not match GITHUB_SHA');
  });

  it('refuses to attach CI evidence to an existing passport with different frozen identities', async () => {
    const { serverUrl, token, service } = await startService();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-change-passport-conflict-'));
    temporaryDirectories.push(workspace);
    const policy = await createServiceFixturePolicy();
    const expectedPassport = createServiceStartPayload(policy);
    const conflictingPassport = {
      ...expectedPassport,
      proposal: { ...expectedPassport.proposal, candidateHash: digest('d') }
    };
    await service.createPassport({
      payload: conflictingPassport,
      role: 'proposer',
      idempotencyKey: 'preexisting-conflict'
    }, auth('authority:proposer', ['proposer']));
    const manifestPath = path.join(workspace, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({
      schema: 'change.passport-ci/v1',
      passport: expectedPassport,
      events: []
    }));

    await expect(runChangePassportAction({
      serverUrl,
      accessToken: token,
      manifestPath,
      workspace,
      fetchImpl: nodeFetch,
      environment: {
        GITHUB_REPOSITORY: 'clocksmith/agent-runtime',
        GITHUB_SHA: 'candidate-sha'
      }
    })).rejects.toThrow('does not match the frozen CI manifest');
  });
});
