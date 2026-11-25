#!/usr/bin/env node
// Verify the retained archive; optionally extract into a new directory.
//   node verify.js [--extract /absolute/new-bundle-directory]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const assert = (condition, message = 'verification failed') => { if (!condition) throw new Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Regular-file entries of an uncompressed POSIX tar (ustar, with pax and GNU long-name headers). */
export function readTarFiles(tar) {
  const files = [];
  let offset = 0, longName = null, paxPath = null;
  const field = (block, start, length) => block.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every(byte => byte === 0)) break;
    const size = parseInt(field(block, 124, 12).trim() || '0', 8);
    const type = field(block, 156, 1) || '0';
    const prefix = field(block, 345, 155);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      paxPath = match ? match[1] : null;
      continue;
    }
    if (type === 'g') continue;
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100));
    longName = null; paxPath = null;
    files.push({ name, type, size, data: Buffer.from(data) });
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { extract: { type: 'string' } } });
  const root = path.dirname(fileURLToPath(import.meta.url));
  const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8'));
  const archive = readFileSync(path.join(root, index.archive.file));
  assert(archive.length === index.archive.sizeBytes, 'archive size');
  assert(sha256(archive) === index.archive.sha256, 'archive sha256');
  const expected = new Map(index.files.map(row => [row.path, row]));
  const verified = new Map();
  for (const member of readTarFiles(gunzipSync(archive))) {
    const parts = member.name.split('/');
    assert(member.type === '0' && !member.name.startsWith('/') && !parts.includes('..'), `unsafe member ${member.name}`);
    assert(expected.has(member.name) && !verified.has(member.name), `unexpected member ${member.name}`);
    const row = expected.get(member.name);
    assert(member.size === row.sizeBytes, `size ${member.name}`);
    assert(sha256(member.data) === row.sha256, member.name);
    verified.set(member.name, member.data);
  }
  assert(verified.size === expected.size, 'missing members');
  if (values.extract) {
    mkdirSync(values.extract); // Refuse to overwrite an existing reproduction.
    for (const [name, data] of verified) {
      const target = path.join(values.extract, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
  }
  console.log(`Verified ${verified.size} files; archive SHA-256 ${index.archive.sha256}`);
}
