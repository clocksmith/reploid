#!/usr/bin/env node
/**
 * Reploid is JavaScript only: no Python or Go source, and no code that starts a Python or Go process.
 *
 *   node scripts/verify-js-only.js [ROOT]
 *
 * Fails when the repository (tracked files plus untracked, unignored ones) contains a Python or Go file, when a
 * JavaScript/TypeScript file passes python, pip, pytest or go (or a .py script) to a process-starting call, or when a
 * package.json script, CI workflow or shell script runs one of them. WGSL shaders and thin shell wrappers are fine.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_FILE = /(\.(py|pyc|pyi|pyw|ipynb|go)$)|(^|\/)(go\.mod|go\.sum|go\.work|pyproject\.toml|Pipfile|Pipfile\.lock|setup\.cfg|requirements[^/]*\.txt)$/;
const SOURCE_FILE = /\.(js|mjs|cjs|ts|tsx|mts|cts|jsx)$/;
const FORBIDDEN_COMMAND = /^(python[\d.]*|pip[\d.]*|pytest|uv|go)$/;
const PROCESS_CALL = /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|execa|execaSync|execaCommand|run|runCommand|runProcess)\s*\(/g;
// A shell command position: line start, a workflow `run:` or after a separator, optionally behind env assignments or sudo.
const SHELL_COMMAND = /(^|&&|\|\||[;|(`]|\$\(|^-?\s*run:)\s*(?:sudo\s+|env\s+|[A-Z_][A-Z0-9_]*=\S*\s+)*(python[\d.]*|pip[\d.]*|pytest|uv|go)(\s|$)/m;

/** The argument text of the call whose opening parenthesis is at `open`, skipping string contents. */
function callArguments(text, open) {
  let depth = 0, quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1, open + 400);
}

const commandOf = literal => path.posix.basename(literal.trim().split(/\s+/)[0] ?? '');

/** Process-starting calls in one JavaScript/TypeScript source that start Python or Go. */
export function findSpawnViolations(text) {
  const found = [];
  for (const match of text.matchAll(PROCESS_CALL)) {
    const args = callArguments(text, match.index + match[0].length - 1);
    const first = /^\s*(['"`])([^'"`]*)\1/.exec(args);
    const reasons = [];
    if (first && (FORBIDDEN_COMMAND.test(commandOf(first[2])) || /\.py$/.test(commandOf(first[2])))) reasons.push(`starts ${commandOf(first[2])}`);
    if (/(['"`])[^'"`\n]*\.py\1/.test(args)) reasons.push('passes a .py script');
    if (/(^|[^\w-])python[\d.]*\b/i.test(args.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, ''))) reasons.push('names a python command');
    if (reasons.length) found.push({ line: text.slice(0, match.index).split('\n').length, call: match[1], reasons });
  }
  return found;
}

/** Shell commands (package.json scripts, workflow steps, shell scripts) that run Python or Go. */
export function findShellViolations(command) {
  return command.split('\n').map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => !text.startsWith('#') && SHELL_COMMAND.test(text));
}

/** Every violation under `root` among `files` (repository-relative, POSIX separators). */
export function checkJsOnly({ root, files }) {
  const violations = [];
  const read = file => readFileSync(path.join(root, file), 'utf8');
  for (const file of files) {
    if (FORBIDDEN_FILE.test(file)) { violations.push({ file, problem: 'Python or Go file' }); continue; }
    if (SOURCE_FILE.test(file)) {
      for (const hit of findSpawnViolations(read(file))) violations.push({ file, line: hit.line, problem: `${hit.call}() ${hit.reasons.join(', ')}` });
    } else if (path.posix.basename(file) === 'package.json') {
      const scripts = JSON.parse(read(file)).scripts ?? {};
      for (const [name, command] of Object.entries(scripts)) {
        if (findShellViolations(command).length) violations.push({ file, problem: `script "${name}" runs Python or Go` });
      }
    } else if (/^\.github\/workflows\/.*\.ya?ml$/.test(file) || /\.(sh|bash|zsh)$/.test(file)) {
      for (const hit of findShellViolations(read(file))) violations.push({ file, line: hit.line, problem: `runs Python or Go: ${hit.text.slice(0, 120)}` });
    }
  }
  return violations;
}

export function listRepositoryFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))].filter(file => existsSync(path.join(root, file)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const files = listRepositoryFiles(root);
  const violations = checkJsOnly({ root, files });
  if (violations.length) {
    console.error(`verify:js-only: ${violations.length} violation(s). Reploid is JavaScript only: no Python or Go files or processes.`);
    for (const row of violations) console.error(`  ${row.file}${row.line ? `:${row.line}` : ''}: ${row.problem}`);
    process.exit(1);
  }
  console.log(`verify:js-only: ${files.length} files, no Python or Go.`);
}
