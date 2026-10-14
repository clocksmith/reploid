// CPU-only check that the served and packaged swarm transport admits the ordered partition
// channel. Reads files and the checkout's commit blobs; starts no transport, peer or application.
// New script for final-2; no precedent copy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const [applicationRoot, installedRoot, previousApplicationRoot, checkout, commit, output] = process.argv.slice(2);
assert(output, 'Provide application export, installed native package, previous export, checkout, commit and receipt path');
const LABEL = 'reploid-partitions-ordered';
const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const channels = text => {
  const literal = /const AUXILIARY_CHANNELS = Object\.freeze\(\[([^\]]*)\]\)/.exec(text);
  assert(literal, 'Auxiliary channel list not found');
  return [...literal[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
};
const copies = {
  'export packages/reploid/src/transport/swarm.js': path.join(applicationRoot, 'packages/reploid/src/transport/swarm.js'),
  'export self/vendor/reploid/transport/swarm.js': path.join(applicationRoot, 'self/vendor/reploid/transport/swarm.js'),
  'served vendor/reploid/transport/swarm.js': path.join(applicationRoot, '.firebase-hosting/reploid/vendor/reploid/transport/swarm.js'),
  'packaged packages/reploid/src/transport/swarm.js': path.join(installedRoot, 'packages/reploid/src/transport/swarm.js'),
};
const rows = {};
for (const [label, file] of Object.entries(copies)) {
  const bytes = await fs.readFile(file), list = channels(bytes.toString('utf8'));
  rows[label] = { sha256: hash(bytes), channels: list, admitsOrdered: list.includes(LABEL),
    exportsAdmittedLabels: bytes.includes('export const SWARM_AUXILIARY_CHANNELS = AUXILIARY_CHANNELS;') };
}
const blobs = {};
for (const name of ['packages/reploid/src/transport/swarm.js', 'self/vendor/reploid/transport/swarm.js']) {
  blobs[name] = hash(Buffer.from((await exec('git', ['show', `${commit}:${name}`], { cwd: checkout, encoding: 'buffer', maxBuffer: 1 << 26 })).stdout));
}
// The packaged module's own exported list, as the installed native participant would import it.
const imported = [...(await import(pathToFileURL(copies['packaged packages/reploid/src/transport/swarm.js']).href)).SWARM_AUXILIARY_CHANNELS];
const previous = channels(await fs.readFile(path.join(previousApplicationRoot, '.firebase-hosting/reploid/vendor/reploid/transport/swarm.js'), 'utf8'));
const users = async (root, directory) => (await exec('grep', ['-rl', LABEL, directory], { cwd: root })).stdout.trim().split('\n').sort();
const result = { schema: 'reploid.swarm-ordered-channel-check/v1', label: LABEL, commit, copies: rows, commitBlobs: blobs,
  packagedModuleExport: imported, packagedModuleAdmitsOrdered: imported.includes(LABEL),
  servedMatchesCommit: rows['served vendor/reploid/transport/swarm.js'].sha256 === blobs['self/vendor/reploid/transport/swarm.js'],
  packagedMatchesCommit: rows['packaged packages/reploid/src/transport/swarm.js'].sha256 === blobs['packages/reploid/src/transport/swarm.js'],
  previousServedAdmitsOrdered: previous.includes(LABEL),
  servedFilesUsingLabel: await users(path.join(applicationRoot, '.firebase-hosting/reploid'), 'vendor/reploid'),
  packagedFilesUsingLabel: await users(installedRoot, 'packages/reploid/src') };
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
assert(Object.values(rows).every(row => row.admitsOrdered && row.exportsAdmittedLabels) && result.packagedModuleAdmitsOrdered
  && result.servedMatchesCommit && result.packagedMatchesCommit, 'Ordered channel is not admitted by every copy');
console.log(`All ${Object.keys(rows).length} copies admit ${LABEL}; served and packaged copies equal commit ${commit}`);
