#!/usr/bin/env node
/** Lint changed source; new modules automatically inherit the cleaned-code rules. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

export function createChangedCodeLinter(newFiles = [], cwd = process.cwd()) {
  return new ESLint({ cwd, overrideConfigFile: path.join(cwd, 'scripts/eslint.config.js'),
    ...(newFiles.length ? { overrideConfig: [{ files: newFiles, rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-nested-ternary': 'error'
    } }] } : {}) });
}

export async function lintChangedCode({ base, head = 'HEAD', cwd = process.cwd() }) {
  if (!base) {
    try { base = execFileSync('git', ['rev-parse', '--verify', 'HEAD^'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { base = '0000000000000000000000000000000000000000'; }
  }
  if (/^0+$/.test(base)) base = execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], { cwd, input: '', encoding: 'utf8' }).trim();
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
  const changed = git(['diff', '--name-only', '-z', '--diff-filter=ACMRT', base, head, '--']).filter(file => /\.m?js$/.test(file));
  const added = git(['diff', '--name-only', '-z', '--diff-filter=A', '--no-renames', base, head, '--']).filter(file => /\.m?js$/.test(file));
  if (!changed.length) return { errors: 0, warnings: 0 };
  const linter = createChangedCodeLinter(added, cwd);
  const files = [];
  for (const file of changed) if (!await linter.isPathIgnored(file)) files.push(file);
  if (!files.length) return { errors: 0, warnings: 0 };
  const results = await linter.lintFiles(files);
  const output = await (await linter.loadFormatter('stylish')).format(results);
  if (output) process.stdout.write(output);
  return results.reduce((total, result) => ({ errors: total.errors + result.errorCount,
    warnings: total.warnings + result.warningCount }), { errors: 0, warnings: 0 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--base') throw Error('Usage: lint-changed-code.js --base <git-revision>');
  const result = await lintChangedCode({ base: args[1] });
  process.exitCode = result.errors ? 1 : 0;
}
