#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function artifactAdditionViolation(file, bytes, { policy, currentArchive }) {
  if (file === currentArchive && bytes <= policy.maxArchiveBytes) return null;
  const exception = policy.exceptions.find(entry => entry.path === file);
  if (exception && exception.reason?.trim() && Number.isSafeInteger(exception.maxBytes) && bytes <= exception.maxBytes) return null;
  if (policy.generatedRoots.some(root => file.startsWith(root))) {
    return `${file}: retain new run output in CI artifacts or object storage; a reviewed exception needs a reason and byte budget`;
  }
  if (file.startsWith('deploy/artifacts/') && file.endsWith('.tgz')) {
    return `${file}: only the current integrity-pinned runtime archive may be added`;
  }
  if (bytes > policy.maxNewBlobBytes) return `${file}: new blob exceeds the ${policy.maxNewBlobBytes}-byte source budget`;
  return null;
}

export function checkArtifactAdditions({ root, base, head = 'HEAD' }) {
  const git = args => execFileSync('git', args, { cwd: root, input: '', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (!base || /^0+$/.test(base)) base = git(['hash-object', '-t', 'tree', '--stdin']).trim();
  const policy = JSON.parse(git(['show', `${head}:scripts/artifact-policy.json`]));
  const pin = JSON.parse(git(['show', `${head}:shared/config/doppler-package.json`]));
  const currentArchive = `deploy/artifacts/${pin.name}-${pin.version}.tgz`;
  const added = new Set(git(['diff', '--name-only', '-z', '--diff-filter=A', base, head, '--']).split('\0').filter(Boolean));
  const entries = git(['ls-tree', '-rlz', head]).split('\0').filter(Boolean).map(row => {
    const [metadata, file] = row.split('\t');
    return { file, bytes: Number(metadata.trim().split(/\s+/).at(-1)) };
  });
  const failures = entries.filter(entry => added.has(entry.file)).map(entry => artifactAdditionViolation(entry.file, entry.bytes, { policy, currentArchive })).filter(Boolean);
  if (added.has(currentArchive)) {
    const bytes = execFileSync('git', ['show', `${head}:${currentArchive}`], { cwd: root, maxBuffer: policy.maxArchiveBytes + 1 });
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (integrity !== pin.integrity) failures.push(`${currentArchive}: bytes do not match the canonical runtime integrity pin`);
  }
  const total = entries.filter(entry => entry.file.startsWith('deploy/artifacts/') && entry.file.endsWith('.tgz'))
    .reduce((sum, entry) => sum + entry.bytes, 0);
  if (total > policy.maxDeployArchiveBytes) failures.push(`Deployment archives use ${total} bytes; budget is ${policy.maxDeployArchiveBytes}. Retire only archives whose evidence references have been preserved.`);
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--base') throw new Error('Usage: check-artifact-additions.js --base <revision>');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const failures = checkArtifactAdditions({ root, base: args[1] });
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('Added files and retained deployment archives satisfy their byte budgets.');
}
