// No SDK/provider imports: model execution stays behind the runner's --execute.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { verifyPeerRuntime } from './runtime-identity.js';
import { requirePeerRepresentation } from './representation.js';
import { inspectCompleteOutput } from './complete-output.js';
import { verifySourceIntegrityProof, requiredSourceIntegrityFiles, verifySourceAliases } from './source-integrity.js';
import { readDiagnosticMetadata, inspectDiagnosticSourceMap } from '../../native-diagnostic-source.js';
const freeze = JSON.parse(await fs.readFile(process.argv[2]));
const provenance = await verifyPeerRuntime(freeze.pooledConfig.provenance);
const integrityConfig = freeze.sourceIntegrity;
const sourceContinuity = await verifySourceAliases(freeze.sourceFiles, AbortSignal.timeout(5000));
const representation = [];
let requiredFiles;
for (const spec of Object.values(freeze.native)) {
  const config = JSON.parse(await fs.readFile(spec.nativeConfigPath));
  const metadata = await readDiagnosticMetadata(config), layout = await inspectDiagnosticSourceMap(config, metadata);
  assert(layout.rows.every(row => row.available), 'Complete mapped source unavailable');
  representation.push(requirePeerRepresentation(metadata.manifest, config.runtimeConfig));
  const files = await requiredSourceIntegrityFiles(metadata, layout, AbortSignal.timeout(5000));
  if (requiredFiles) assert.deepEqual(files, requiredFiles, 'Native arms select different source content');
  requiredFiles = files;
}
if (integrityConfig) assert.deepEqual(integrityConfig.files, requiredFiles, 'Content proof coverage differs from the admitted model');
const sourceIntegrity = integrityConfig?.proof ? await verifySourceIntegrityProof(integrityConfig)
  : { ready: false, reason: 'No pinned complete content proof; snapshots alone prove continuity',
    requiredFiles: requiredFiles.length, requiredBytes: requiredFiles.reduce((sum, file) => sum + file.bytes, 0),
    timedPeerReaderModified: false };
if (process.argv[3]) {
  const candidate = JSON.parse(await fs.readFile(process.argv[3]));
  const outputs = candidate.rows.map(row => inspectCompleteOutput(row, candidate.workload,
    candidate.kind === 'pooled' ? 'peer' : 'native'));
  assert(outputs.length === 3, 'One fresh and two repeated requests required');
  for (const row of outputs) assert.deepEqual(row, outputs[0], 'Repeated complete output differs');
  console.log(JSON.stringify({ outputs }));
} else console.log(JSON.stringify({ provenance, representation, sourceContinuity, sourceIntegrity, gpuOpened: false, modelImported: false }));
