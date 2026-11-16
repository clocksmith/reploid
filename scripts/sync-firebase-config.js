#!/usr/bin/env node
/** Generate Firebase targets from shared cache/rewrite policy without reordering routes. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPOSITORY_ROOT } from './evidence-paths.js';

const common = JSON.parse(await fs.readFile(path.join(REPOSITORY_ROOT, 'deploy/firebase-common.json'), 'utf8'));
for (const [name, output] of [['reploid', 'firebase.json'], ['simulatte', 'firebase.simulatte-hosting.json']]) {
  const config = JSON.parse(await fs.readFile(path.join(REPOSITORY_ROOT, `deploy/firebase-${name}.template.json`), 'utf8'));
  for (const hosting of config.hosting) {
    hosting.headers = hosting.headers.map(entry => {
      if (typeof entry.headers !== 'string') return entry;
      if (!Object.hasOwn(common.headers, entry.headers)) throw new Error(`Unknown shared header policy: ${entry.headers}`);
      return { ...entry, headers: common.headers[entry.headers] };
    });
    hosting.rewrites = hosting.rewrites.map(entry => {
      if (!Object.hasOwn(entry, 'sharedRewrite')) return entry;
      if (Object.keys(entry).length !== 1 || !Object.hasOwn(common.rewrites, entry.sharedRewrite)) throw new Error('Unknown or ambiguous shared rewrite');
      return { source: entry.sharedRewrite, ...common.rewrites[entry.sharedRewrite] };
    });
  }
  const bytes = JSON.stringify(config, null, 2) + '\n', target = path.join(REPOSITORY_ROOT, output);
  if (process.argv.includes('--check')) {
    if (await fs.readFile(target, 'utf8') !== bytes) throw new Error(`${output} is stale; run npm run build:hosting-config`);
  } else await fs.writeFile(target, bytes);
}
console.log('Firebase target configs match their shared policy and target templates.');
