// Explicit CPU/file-I/O operator command. No provider/SDK/model import.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { proveSourceIntegrity, readSourceProofMetadata, writeSourceIntegrityProof } from './source-integrity.js';
const [configPath, expectedConfigSha256, outputPath] = process.argv.slice(2);
assert(configPath && /^[a-f0-9]{64}$/u.test(expectedConfigSha256) && outputPath,
  'Usage: prove-source-integrity.js config.json config-sha256 new-proof.json');
const bytes = await readSourceProofMetadata(configPath, AbortSignal.timeout(5000));
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedConfigSha256, 'Source proof configuration changed');
const proof = await proveSourceIntegrity(JSON.parse(new TextDecoder().decode(bytes)));
await writeSourceIntegrityProof(outputPath, proof);
console.log(JSON.stringify({ completed: true, files: proof.files.length, verifiedBytes: proof.verifiedBytes, gpuOpened: false, modelImported: false }));
