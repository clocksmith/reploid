import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const readRootFile = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

describe('Cloud Run build context', () => {
  it('uploads only Cloud Build inputs and coordinator runtime files', async () => {
    const ignore = await readRootFile('.gcloudignore');

    expect(ignore).toContain('**');
    for (const requiredPath of [
      '!Dockerfile',
      '!package.json',
      '!package-lock.json',
      '!server/**',
      '!self/**',
      '!scripts/print-pool-env.js',
      '!deploy/cloudbuild.yaml',
      '!deploy/env.production.json'
    ]) {
      expect(ignore).toContain(requiredPath);
    }
    expect(ignore).toContain('server/logs/**');
    expect(ignore).not.toContain('!artifacts/**');
    expect(ignore).not.toContain('!node_modules/**');
  });

  it('copies only the declared coordinator runtime scope into the image', async () => {
    const dockerfile = await readRootFile('Dockerfile');
    const dockerIgnore = await readRootFile('.dockerignore');

    expect(dockerfile).not.toMatch(/^COPY\s+\.\s+\.$/m);
    expect(dockerfile).toContain('COPY Dockerfile ./Dockerfile');
    expect(dockerfile).toContain('COPY package.json package-lock.json ./');
    expect(dockerfile).toContain('COPY server ./server');
    expect(dockerfile).toContain('COPY self ./self');
    expect(dockerIgnore).toContain('**');
    expect(dockerIgnore).toContain('server/logs/**');
  });
});
