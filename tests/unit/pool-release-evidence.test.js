import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPoolReleaseEvidenceIndex,
  capturePoolReleaseLane,
  validatePoolReleaseEvidenceIndex
} from '../../scripts/pool-release-evidence.js';

const temporaryDirectories = [];
const fakeHash = (character) => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

const release = {
  sourceRevision: 'abc123',
  sourceTreeHash: fakeHash('a'),
  browserBundleHash: fakeHash('b'),
  sourceDirty: false
};

const report = (status = 'passed', attachmentRelease = release) => ({
  suites: [{
    title: 'actual browser inference',
    specs: [{
      title: 'loads ESM-2 and returns a receipt',
      tests: [{
        projectName: 'chromium',
        results: [{
          status,
          startTime: '2026-08-16T00:00:00.000Z',
          duration: 42,
          attachments: [{
            name: 'receipt.json',
            contentType: 'application/json',
            body: Buffer.from(JSON.stringify({ accepted: true, release: attachmentRelease })).toString('base64')
          }]
        }]
      }]
    }]
  }],
  stats: { expected: status === 'passed' ? 1 : 0, unexpected: status === 'passed' ? 0 : 1 }
});

describe('Poolday release evidence aggregation', () => {
  it('copies the raw lane report and hashes every embedded attachment before overwrite', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-release-evidence-'));
    temporaryDirectories.push(directory);
    const reportPath = path.join(directory, 'shared-report.json');
    const outputDirectory = path.join(directory, 'run');
    await fs.writeFile(reportPath, JSON.stringify(report()), 'utf8');

    const lane = await capturePoolReleaseLane({
      lane: {
        id: 'primary',
        label: 'Primary browser inference',
        grep: 'loads ESM-2',
        requiredAttachments: ['receipt.json'],
        qualificationChecks: ['webGpuExecution']
      },
      reportPath,
      outputDirectory,
      expectedRelease: release
    });

    expect(lane).toMatchObject({
      laneId: 'primary',
      status: 'passed',
      releaseBound: true,
      qualificationChecks: ['webGpuExecution'],
      attachments: [expect.objectContaining({ name: 'receipt.json' })]
    });
    expect(await fs.readFile(path.join(outputDirectory, lane.report.path), 'utf8'))
      .toBe(JSON.stringify(report()));
    expect(await fs.readFile(path.join(outputDirectory, lane.attachments[0].path), 'utf8'))
      .toBe(JSON.stringify({ accepted: true, release }));
  });

  it('requires declared attachments and keeps the release set non-promotable', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-release-evidence-'));
    temporaryDirectories.push(directory);
    const reportPath = path.join(directory, 'shared-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report()), 'utf8');

    await expect(capturePoolReleaseLane({
      lane: { id: 'primary', label: 'Primary', grep: 'loads ESM-2', requiredAttachments: ['missing.json'] },
      reportPath,
      outputDirectory: path.join(directory, 'run')
    })).rejects.toThrow('is missing attachments: missing.json');

    await fs.writeFile(reportPath, JSON.stringify(report('passed', {
      ...release,
      browserBundleHash: fakeHash('9')
    })), 'utf8');
    await expect(capturePoolReleaseLane({
      lane: { id: 'primary', label: 'Primary', grep: 'loads ESM-2', requiredAttachments: ['receipt.json'] },
      reportPath,
      outputDirectory: path.join(directory, 'run'),
      expectedRelease: release
    })).rejects.toThrow('attachment release identity does not match: receipt.json');

    const index = buildPoolReleaseEvidenceIndex({
      status: 'passed',
      createdAt: '2026-08-16T00:00:00.000Z',
      release,
      deployment: {
        baseUrl: 'https://replo.id',
        backendSourceRevision: release.sourceRevision,
        backendImage: `us-central1-docker.pkg.dev/reploid/reploid/reploid-pool:${release.sourceRevision}`,
        backendRuntimeBundleHash: fakeHash('e'),
        platformRevision: 'reploid-pool-00042-abc'
      },
      config: { version: 'pool-config-v1', hash: fakeHash('c') },
      requiredLaneIds: ['primary'],
      lanes: [{
        schema: 'poolday.browser_release_lane/v1',
        laneId: 'primary',
        status: 'passed',
        releaseBound: true,
        report: { sha256: fakeHash('d') },
        attachments: []
      }]
    });
    expect(validatePoolReleaseEvidenceIndex(index)).toEqual({ ok: true, reasons: [] });
    expect(index.qualification).toMatchObject({ eligible: false });

    const forged = structuredClone(index);
    forged.qualification.eligible = true;
    expect(validatePoolReleaseEvidenceIndex(forged)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'release evidence cannot be promotion eligible',
        'release evidence record hash is invalid'
      ])
    });
  });
});
