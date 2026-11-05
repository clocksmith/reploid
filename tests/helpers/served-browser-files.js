/**
 * Contract harnesses serve the browser tree under /self/ (and /core/ for the
 * Verification Worker). Those files are read as Hosting serves them: from the
 * source root that holds them, with cross-root module specifiers in served form.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openBrowserTree, toServedModuleSource, resolveServedFile, REPOSITORY_ROOT } from '../../server/browser-tree.js';

let opening;
/** Served bytes for a /self/ or /core/ harness path, or null when it is not a browser file. */
export async function readServedHarnessFile(pathname) {
  const served = pathname.startsWith('/self/') ? pathname.slice('/self/'.length)
    : pathname.startsWith('/core/') ? pathname.slice(1) : null;
  if (!served) return null;
  const tree = await (opening ||= openBrowserTree());
  return tree.has(served) ? tree.read(served) : null;
}

/** Served text of a browser path (for example core/vfs.js), read synchronously. */
export function readServedTextSync(servedPath) {
  const file = resolveServedFile(servedPath);
  const text = readFileSync(file, 'utf8');
  return /\.m?js$/.test(file) ? toServedModuleSource(text, path.relative(REPOSITORY_ROOT, file).split(path.sep).join('/')) : text;
}

/** Served text of a browser path. */
export async function readServedText(servedPath) {
  return readServedTextSync(servedPath);
}
