// Explicit metadata-only composition. No source-content, provider or SDK import.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { composeSourceIntegrityProof, readSourceProofMetadata } from './source-integrity.js';
const [configPath, expectedConfigSha256, outputPath] = process.argv.slice(2);
assert(configPath && /^[a-f0-9]{64}$/u.test(expectedConfigSha256) && outputPath,
  'Usage: compose-source-integrity.js config.json config-sha256 new-proof.json');
const bytes = await readSourceProofMetadata(configPath, AbortSignal.timeout(5000));
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedConfigSha256, 'Source proof composition configuration changed');
const proof = await composeSourceIntegrityProof(JSON.parse(new TextDecoder().decode(bytes)));
await fs.writeFile(outputPath, JSON.stringify(proof, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ completed: true, files: proof.files.length, verifiedBytes: proof.verifiedBytes,
  componentProofs: proof.componentProofs.length, sourceContentRead: false, gpuOpened: false, modelImported: false }));
