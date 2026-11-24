import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import policy from './server-library-imports.json' with { type: 'json' };
import library from '../packages/reploid/package.json' with { type: 'json' };

export const SERVER_LIBRARY_BOUNDARY = 'hosted services consume public library entries and declared wire/host contracts, not private implementations';
// Shared browser modules that hosted services compose import the library through its served mirror,
// so hosted services import the same mirror and a process holds one copy of the library.
export const SERVER_LIBRARY_COPY = 'hosted services load the library through shared/vendor/reploid, the copy the shared modules they compose load, not packages/reploid/src';
const MIRROR = 'shared/vendor/reploid/';
const targets = new Set(Object.values(library.exports).map(value => typeof value === 'string' ? value : value.import)
  .filter(Boolean).map(value => value.replace(/^\.\//, '')));
if (policy.schema !== 'reploid.server-library-imports/v1') throw new Error('Unknown server library boundary schema');
for (const entry of [...policy.contractRoots, ...policy.modules]) {
  if (!entry.startsWith('src/') || entry.includes('..')
    || !fs.existsSync(fileURLToPath(new URL('../packages/reploid/' + entry, import.meta.url)))) {
    throw new Error('Server library boundary names a missing contract: ' + entry);
  }
}
for (const entry of policy.modules) targets.add(entry);

/** Published entry points follow package.json; internal wire/host ports have one explicit policy. */
export function serverLibraryImportAllowed(physicalPath) {
  if (!physicalPath.startsWith(MIRROR)) return true;
  const relative = 'src/' + physicalPath.slice(MIRROR.length);
  return targets.has(relative) || policy.contractRoots.some(prefix => relative.startsWith(prefix));
}

/** Hosted services never load the package source beside the mirror. */
export function serverLibraryCopyAllowed(physicalPath) {
  return !physicalPath.startsWith('packages/reploid/');
}
