import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { provisionReploidCloudAccess } from '../../scripts/build-reploid-cloud-access.js';

const evaluateGeneratedPayload = (source) => {
  const sandbox = {};
  const executable = source
    .replace(
      'export const GENERATED_REPLOID_CLOUD_ACCESS = Object.freeze(',
      'globalThis.__generated = Object.freeze('
    )
    .replace(/\nexport default GENERATED_REPLOID_CLOUD_ACCESS;\n?$/, '\n');
  vm.runInNewContext(executable, sandbox);
  return sandbox.__generated;
};

describe('build-reploid-cloud-access', () => {
  it('writes sealed windows and a private operator codebook without leaking the api key', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reploid-cloud-access-'));
    const outputPath = path.join(tempDir, 'cloud-access-windows.js');
    const codebookPath = path.join(tempDir, 'codebook.json');

    try {
      const result = await provisionReploidCloudAccess({
        env: {
          GEMINI_API_KEY: 'test-gemini-key',
          REPLOID_ROOT_ACCESS_SECRET: 'operator-master-secret',
          REPLOID_ACCESS_WINDOW_DAYS: '3',
          REPLOID_ACCESS_START_DATE: '2026-03-27'
        },
        outputPath,
        codebookPath
      });

      expect(result.windowCount).toBe(3);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.existsSync(codebookPath)).toBe(true);

      const generatedSource = fs.readFileSync(outputPath, 'utf8');
      expect(generatedSource).not.toContain('test-gemini-key');

      const generatedPayload = evaluateGeneratedPayload(generatedSource);
      expect(generatedPayload.windows).toHaveLength(3);
      expect(generatedPayload.windows[0].label).toBe('2026-03-27');

      const codebook = JSON.parse(fs.readFileSync(codebookPath, 'utf8'));
      expect(codebook.entries).toHaveLength(3);
      expect(codebook.entries[0].accessCode).toMatch(/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}$/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes an empty generated module when GEMINI_API_KEY is missing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reploid-cloud-access-empty-'));
    const outputPath = path.join(tempDir, 'cloud-access-windows.js');
    const codebookPath = path.join(tempDir, 'codebook.json');

    try {
      const result = await provisionReploidCloudAccess({
        env: {
          REPLOID_ACCESS_WINDOW_DAYS: '2',
          REPLOID_ACCESS_START_DATE: '2026-03-27'
        },
        outputPath,
        codebookPath
      });

      expect(result.windowCount).toBe(0);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.existsSync(codebookPath)).toBe(false);

      const generatedPayload = evaluateGeneratedPayload(fs.readFileSync(outputPath, 'utf8'));
      expect(generatedPayload.windows).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
