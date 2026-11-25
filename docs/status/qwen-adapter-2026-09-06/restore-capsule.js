#!/usr/bin/env node
// Restore the exact signed model using retained metadata and verified local weights.
//   node restore-capsule.js /absolute/bundle /absolute/converted-model /absolute/new-capsule-directory
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const [bundle, convertedModel, destination] = process.argv.slice(2);
if (!bundle || !convertedModel || !destination) {
  console.error('usage: restore-capsule.js BUNDLE CONVERTED_MODEL DESTINATION');
  process.exit(2);
}
const retained = path.join(path.resolve(bundle), 'capsule', 'distribution');
const capsuleBytes = readFileSync(path.join(retained, 'capsule.json'));
const capsule = JSON.parse(capsuleBytes);
const sources = [];
for (const artifact of capsule.artifacts) {
  const relative = artifact.path;
  assert(!path.posix.isAbsolute(relative) && !relative.split('/').includes('..'), `unsafe path ${relative}`);
  let source = path.join(retained, relative);
  if (!existsSync(source)) {
    assert(['weight-shard', 'tokenizer'].includes(artifact.role), artifact.artifactId);
    source = path.join(path.resolve(convertedModel), path.posix.basename(relative));
  }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(source)) digest.update(chunk);
  assert(statSync(source).size === artifact.sizeBytes, artifact.artifactId);
  assert(`sha256:${digest.digest('hex')}` === artifact.hash, artifact.artifactId);
  sources.push([relative, path.resolve(source)]);
}
mkdirSync(destination); // All dependencies passed before creating the new directory.
writeFileSync(path.join(destination, 'capsule.json'), capsuleBytes);
for (const [relative, source] of sources) {
  const target = path.join(destination, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  symlinkSync(source, target);
}
console.log(`Restored ${sources.length} verified dependencies without copying model weights.`);
