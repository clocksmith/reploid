#!/usr/bin/env node
/** Public showcase summaries contain counts and digests, never replay payloads. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const schema = 'reploid.showcase-summary/v1';
const fields = ['state', 'activityLog', 'conversationContext', 'systemPrompt', 'vfs', 'metadata'];
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0;

export function summarizeShowcase(bytes) {
  const run = JSON.parse(bytes.toString());
  if (!run || typeof run !== 'object' || Array.isArray(run) || !run.state || !run.vfs) {
    throw new Error('Expected a session export with state and VFS');
  }
  const activities = Array.isArray(run.activityLog) ? run.activityLog : [];
  return {
    schema, replayable: false,
    source: { sha256: digest(bytes), bytes: bytes.length },
    counts: {
      cycles: count(run.state.totalCycles) ? run.state.totalCycles : null,
      activityEntries: activities.length,
      errorEntries: activities.filter(row => row && (row.type === 'error' || row.level === 'error' || row.status === 'failed' || row.error)).length,
      contextMessages: Array.isArray(run.conversationContext) ? run.conversationContext.length : 0,
      virtualFiles: Object.keys(run.vfs).length,
      virtualFileBytes: Buffer.byteLength(JSON.stringify(run.vfs)),
    },
    omittedFields: fields.filter(field => Object.hasOwn(run, field)),
  };
}

export function validateShowcaseSummary(value) {
  const keys = (object, expected) => object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).sort().join(',') === [...expected].sort().join(',');
  if (!keys(value, ['schema', 'replayable', 'source', 'counts', 'omittedFields'])
    || value.schema !== schema || value.replayable !== false
    || !keys(value.source, ['sha256', 'bytes']) || !/^sha256:[a-f0-9]{64}$/.test(value.source.sha256)
    || !count(value.source.bytes)
    || !keys(value.counts, ['cycles', 'activityEntries', 'errorEntries', 'contextMessages', 'virtualFiles', 'virtualFileBytes'])
    || !Object.entries(value.counts).every(([key, n]) => key === 'cycles' && n === null || count(n))
    || !Array.isArray(value.omittedFields) || !value.omittedFields.every(field => fields.includes(field))
    || new Set(value.omittedFields).size !== value.omittedFields.length) {
    throw new Error('Showcase publication requires a counts-only summary; raw payload or unknown field rejected');
  }
}

function main() {
  const [mode, backupPath] = process.argv.slice(2);
  if (!['--check', '--sanitize'].includes(mode)) throw new Error('Use --check or --sanitize /absolute/private-backup-directory');
  let backup;
  if (mode === '--sanitize') {
    if (!backupPath || !path.isAbsolute(backupPath)) throw new Error('An absolute private backup directory is required');
    mkdirSync(backupPath, { recursive: true, mode: 0o700 });
    backup = realpathSync(backupPath);
    if (backup === root || backup.startsWith(root + path.sep)) throw new Error('Private backup must be outside the repository');
  }
  const directory = path.join(root, 'examples/showcase/runs');
  let checked = 0;
  for (const name of readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const target = path.join(directory, name), bytes = readFileSync(target);
    const original = JSON.parse(bytes);
    if (mode === '--check' || original.schema === schema) validateShowcaseSummary(original);
    else {
      const summary = summarizeShowcase(bytes); validateShowcaseSummary(summary);
      writeFileSync(path.join(backup, name), bytes, { flag: 'wx', mode: 0o600 });
      writeFileSync(target, JSON.stringify(summary, null, 2) + '\n');
    }
    checked++;
  }
  console.log(`Showcase privacy check passed: ${checked} counts-only summaries`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
