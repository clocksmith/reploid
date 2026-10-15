#!/usr/bin/env node
/**
 * Keep planning authority where the owner put it. Public Reploid holds the product
 * contract and the architecture; the business plan, roadmap and acceptance register
 * are private. This check fails when:
 * - a declared compatibility file holds anything but headings, anchors and links;
 * - a retired planning path reappears;
 * - a tracked Markdown file outside retained evidence carries acceptance-register
 *   entries (REP-, DR-, DOP- or ALL- checkboxes);
 * - a tracked Markdown file links into the private Ouroboros checkout by relative path
 *   (CI clones Reploid alone; plain-text mentions are fine).
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Paths kept only so old links resolve; each points at the current owner. */
export const COMPATIBILITY_FILES = Object.freeze(['docs/poolday/product-intent.md']);
/** Planning documents moved to the owner's private records; they must not return. */
export const RETIRED_PATHS = Object.freeze([
  'ROADMAP.md',
  'docs/roadmap/requirements.md',
  'docs/roadmap/history.md',
  'docs/GOVERNANCE_DETAILS.md'
]);
/** Retained evidence quotes historical register text; it is not a planning surface. */
const EVIDENCE_PREFIXES = Object.freeze(['artifacts/', 'reports/', 'docs/status/', 'docs/archive/']);

const REGISTER_ENTRY = /^\s*[-*] \[[ xX]\] \*\*(REP|DR|DOP|ALL)-\d+/;
const PRIVATE_LINK = /\]\((?:\.\.\/)+ouroboros\//;
const COMPATIBILITY_INTRO = /^Compatibility links only\./;
const LINK_ONLY = /^(?:<a id="[^"]+"><\/a>)?(?:\[[^\]]+\]\([^)]+\)[ ,·|]*)+$/;
const NORMATIVE = /\b(MUST|SHOULD|SHALL|REQUIRED)\b/;

/** Problems in one compatibility file's text. */
export function compatibilityProblems(relative, text) {
  const problems = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    const at = `${relative}:${index + 1}`;
    if (NORMATIVE.test(line)) problems.push(`${at}: compatibility files carry no normative requirements`);
    else if (REGISTER_ENTRY.test(line)) problems.push(`${at}: compatibility files carry no acceptance-register entries`);
    else if (!(line === '' || line.startsWith('#') || COMPATIBILITY_INTRO.test(line) || LINK_ONLY.test(line))) {
      problems.push(`${at}: compatibility files hold only headings, anchors and links`);
    }
  });
  return problems;
}

/** Problems in any tracked Markdown file's text. */
export function markdownProblems(relative, text) {
  const problems = [];
  const evidence = EVIDENCE_PREFIXES.some(prefix => relative.startsWith(prefix));
  text.split('\n').forEach((line, index) => {
    if (!evidence && REGISTER_ENTRY.test(line)) {
      problems.push(`${relative}:${index + 1}: acceptance-register entries belong in the owner's private roadmap`);
    }
    if (PRIVATE_LINK.test(line)) problems.push(`${relative}:${index + 1}: links into the private Ouroboros checkout do not resolve in a Reploid-only clone`);
  });
  return problems;
}

const trackedFiles = root => execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

export async function verifyPlanningBoundary({ root = PROJECT_ROOT, files = null } = {}) {
  const tracked = files ?? trackedFiles(root);
  const present = new Set(tracked);
  const errors = [];
  for (const retired of RETIRED_PATHS) if (present.has(retired)) errors.push(`${retired}: retired planning path; the roadmap and register are private`);
  for (const relative of COMPATIBILITY_FILES) {
    if (!present.has(relative)) continue;
    errors.push(...compatibilityProblems(relative, await fs.readFile(path.join(root, relative), 'utf8')));
  }
  for (const relative of tracked) {
    if (!relative.endsWith('.md') || relative.startsWith('node_modules/')) continue;
    errors.push(...markdownProblems(relative, await fs.readFile(path.join(root, relative), 'utf8')));
  }
  return { errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { errors } = await verifyPlanningBoundary();
  if (errors.length) {
    console.error(`[planning-boundary] ${errors.length} problem(s):\n${errors.map(error => `  ${error}`).join('\n')}`);
    process.exit(1);
  }
  console.log('[planning-boundary] compatibility files are link-only and no planning register is public');
}
