// No SDK/provider imports: model execution stays behind the runner's --execute.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { verifyPeerRuntime } from './runtime-identity.js';
import { requirePeerRepresentation } from './representation.js';
import { inspectCompleteOutput } from './complete-output.js';
import { readDiagnosticMetadata, inspectDiagnosticSourceMap } from '../../native-diagnostic-source.js';
const freeze = JSON.parse(await fs.readFile(process.argv[2]));
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const provenance = await verifyPeerRuntime(freeze.pooledConfig.provenance);
for (const item of freeze.sourceFiles) {
  assert.equal(await fs.realpath(item.path), item.canonicalPath, 'Frozen source alias changed');
  const stat = await fs.lstat(item.canonicalPath, { bigint: true });
  assert(stat.isFile() && stamp(stat) === item.stamp, 'Frozen source file changed');
}
const representation = [];
for (const spec of Object.values(freeze.native)) {
  const config = JSON.parse(await fs.readFile(spec.nativeConfigPath));
  const metadata = await readDiagnosticMetadata(config), layout = await inspectDiagnosticSourceMap(config, metadata);
  assert(layout.rows.every(row => row.available), 'Complete mapped source unavailable');
  representation.push(requirePeerRepresentation(metadata.manifest, config.runtimeConfig));
}
if (process.argv[3]) {
  const candidate = JSON.parse(await fs.readFile(process.argv[3]));
  const outputs = candidate.rows.map(row => inspectCompleteOutput(row, candidate.workload,
    candidate.kind === 'pooled' ? 'peer' : 'native'));
  assert(outputs.length === 3, 'One fresh and two repeated requests required');
  for (const row of outputs) assert.deepEqual(row, outputs[0], 'Repeated complete output differs');
  console.log(JSON.stringify({ outputs }));
} else console.log(JSON.stringify({ provenance, representation, gpuOpened: false, modelImported: false }));
