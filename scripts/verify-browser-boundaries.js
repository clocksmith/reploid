#!/usr/bin/env node
/**
 * Mechanical ownership boundaries of the served browser tree.
 *
 *   self/          agent substrate: may load self and shared
 *   shared/        loaded by both: may load shared only
 *   apps/poolday/  the Poolday product: may load apps/poolday, shared and the
 *                  documented substrate entry points below
 *
 * A reference is a module specifier (static, dynamic or re-export, relative or
 * origin-relative), a new URL(..., import.meta.url) asset, or a script or
 * stylesheet an HTML document loads. Relative specifiers resolve between source
 * files; origin-relative URLs resolve in the served namespace. Every reference must
 * name an existing file inside the served tree.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserModuleReferences } from '../server/browser-module-references.js';
import { openBrowserTree, rootOf } from '../server/browser-tree.js';

/** Substrate modules the product may load: index.html boots /zero and the other substrate routes through them. */
export const SELF_ENTRY_POINTS = Object.freeze(['zero/boot.js', 'kernel/boot.js']);
const ALLOWED = Object.freeze({ self: ['self', 'shared'], shared: ['shared'], 'apps/poolday': ['apps/poolday', 'shared'] });
const posix = path.posix;
const stripSuffix = value => value.replace(/[?#].*$/, '');

function moduleReferences(code) {
  return browserModuleReferences(code).map(reference => reference.value).filter(Boolean);
}

function documentReferences(html) {
  const references = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"'#]+)["']/g)) references.push({ value: match[1], served: true });
  for (const match of html.matchAll(/<link\b[^>]*\brel=["']?(?:stylesheet|modulepreload)["']?[^>]*\bhref=["']([^"'#]+)["']/g)) references.push({ value: match[1], served: true });
  for (const block of html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)) {
    for (const value of moduleReferences(block[1])) references.push({ value, served: true });
  }
  return references;
}

/** Boundary violations of the repository's browser tree. Package mirrors are checked by verify-layers. */
export async function findBoundaryViolations({ repoRoot } = {}) {
  const tree = await openBrowserTree(repoRoot ? { repoRoot } : {});
  const violations = [];
  for (const served of tree.files) {
    if (served.startsWith('vendor/')) continue;
    const ext = posix.extname(served);
    if (!['.js', '.mjs', '.html'].includes(ext) || served === 'ui/pool-home/app.bundle.js' || served.startsWith('ui/react/')) continue;
    const source = tree.source(served), owner = rootOf(source);
    const text = await fs.readFile(tree.absolute(served), 'utf8');
    let references;
    try {
      references = ext === '.html' ? documentReferences(text)
        : moduleReferences(text).map(value => ({ value, served: false }));
    } catch (error) {
      violations.push({ source, reason: `dependency references could not be parsed: ${error.message}` });
      continue;
    }
    for (const { value, served: documentRelative } of references) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) continue;
      const bare = stripSuffix(value);
      if (!bare.startsWith('/') && !bare.startsWith('.') && !documentRelative) continue;
      let target, targetOwner;
      if (bare.startsWith('/') || documentRelative) {
        // A served URL: resolve against the document's served path.
        target = bare.startsWith('/') ? bare.slice(1) : posix.normalize(posix.join(posix.dirname(served), bare));
        if (!tree.has(target)) { violations.push({ source, reference: value, reason: 'served reference names no file in the browser tree' }); continue; }
        targetOwner = tree.owner(target);
      } else {
        const resolved = posix.normalize(posix.join(posix.dirname(source), bare));
        targetOwner = rootOf(resolved);
        target = targetOwner ? resolved.slice(targetOwner.length + 1) : null;
        if (!targetOwner || tree.source(target) !== resolved) {
          violations.push({ source, reference: value, reason: 'relative reference leaves the browser tree or names no source file' });
          continue;
        }
      }
      if (ALLOWED[owner].includes(targetOwner)) continue;
      if (owner === 'apps/poolday' && targetOwner === 'self' && SELF_ENTRY_POINTS.includes(target)) continue;
      violations.push({ source, reference: value, target: tree.source(target),
        reason: `${owner} may not load ${targetOwner}${owner === 'apps/poolday' ? ' outside its documented entry points' : ''}` });
    }
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await findBoundaryViolations();
  if (violations.length) { console.error(JSON.stringify(violations, null, 2)); process.exitCode = 1; }
  else console.log('Browser ownership boundaries hold: self and shared never load apps/poolday; shared loads only shared.');
}
