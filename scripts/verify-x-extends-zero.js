#!/usr/bin/env node
/**
 * Checks that X is a pure extension of Zero, against the recorded divergences.
 *
 * (b) Zero's source closure (self/zero/source.json) never reaches a module outside it.
 * (c) Zero's modules never branch on X alone, and X's base closure keeps every Zero module.
 * (d) X with no upgrade ("spark") has exactly Zero's tools and module closure.
 *
 * docs/x/zero-extension.json records each divergence that exists today. A new one
 * fails, and so does a recorded one that no longer exists, so the record only shrinks:
 * `--prune` drops fixed entries, and a new divergence is recorded only by editing the file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { openBrowserTree } from '../server/browser-tree.js';
import { getToolNamesForMode } from '../shared/config/tool-surfaces.js';
import { LAB_UPGRADE_LEVELS, LAB_UPGRADE_TOOL_SURFACE_IDS } from '../self/config/lab-upgrades.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
export const RECORD_PATH = 'docs/x/zero-extension.json';
export const RECORD_SCHEMA = 'reploid/x-zero-extension/v1';

const X_ONLY_LEVELS = new Set(LAB_UPGRADE_LEVELS.filter(level => level !== 'spark'));
const isX = value => value === 'x' || /^\/x(?:[/?#]|$)/.test(value);
const isZero = value => value === 'zero' || /^\/zero(?:[/?#]|$)/.test(value);
const MODULE_URL = /^(\/[\w./-]+\.m?js)(?:[?#]|$)/;

const strings = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node?.type === 'TemplateLiteral') return node.quasis.map(quasi => quasi.value.cooked);
  return [];
};
const leadingString = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral') return node.quasis[0].value.cooked;
  if (node?.type === 'BinaryExpression' && node.operator === '+') return leadingString(node.left);
  return null;
};
const mentions = (node, test) => {
  let found = false;
  walk(node, child => { if (strings(child).some(test)) found = true; });
  return found;
};
function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, next));
    else if (value && typeof value === 'object') walk(value, visit, next);
  }
}

// A reference treats X and Zero alike when the smallest expression around it also names
// Zero, or when it is one arm of an if-chain whose previous arm names Zero.
function symmetric(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (['LogicalExpression', 'ArrayExpression', 'ObjectExpression', 'SwitchStatement'].includes(node.type)) {
      let outer = node;
      while (node.type === 'LogicalExpression' && ancestors[index - 1]?.type === 'LogicalExpression') outer = ancestors[--index];
      return mentions(outer, isZero);
    }
    if (/Statement$|Declaration$/.test(node.type) && node.type !== 'BlockStatement') {
      if (mentions(node, isZero)) return true;
      const block = ancestors[index - 1];
      const siblings = block?.type === 'SwitchCase' ? block.consequent : block?.body;
      // A statement nested directly in another (an if's consequent) belongs to that statement.
      if (!Array.isArray(siblings)) continue;
      const previous = siblings[siblings.indexOf(node) - 1];
      return Boolean(previous && mentions(previous, isZero));
    }
  }
  return false;
}

/** Divergences visible in one Zero-closure source file. */
export function analyzeZeroModule(file, source, inZeroClosure) {
  const found = [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const lines = source.split('\n');
  const where = node => `${file}:${node.loc.start.line}`;
  const snippet = node => lines[node.loc.start.line - 1].trim();
  const urlBindings = new Map();
  walk(ast, node => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const candidate = leadingString(node.init);
      if (candidate && MODULE_URL.test(candidate)) urlBindings.set(node.id.name, candidate);
    } else if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') {
      const candidate = leadingString(node.right);
      if (candidate && MODULE_URL.test(candidate)) urlBindings.set(node.left.name, candidate);
    }
  });
  const resolveTargetUrl = target => {
    const direct = leadingString(target) || (target?.type === 'Identifier' ? urlBindings.get(target.name) : null);
    return MODULE_URL.exec(direct || '')?.[1] || null;
  };
  walk(ast, (node, ancestors) => {
    // (b) A module URL handed to import() or a loader call must stay in Zero's closure.
    const targets = node.type === 'ImportExpression'
      ? [node.source]
      : (node.type === 'CallExpression' || node.type === 'NewExpression')
        ? node.arguments
        : [];
    for (const target of targets) {
      const url = resolveTargetUrl(target);
      if (url && !inZeroClosure(url.slice(1))) {
        found.push({ rule: 'b', kind: 'zero-imports-outside-closure', key: `${file} -> ${url.slice(1)}`, at: where(node) });
      }
    }
    for (const value of strings(node)) {
      // (c) Zero's modules may name X only where they treat X and Zero alike.
      if (isX(value) && !symmetric(ancestors)) {
        found.push({ rule: 'c', kind: 'x-branch-in-zero-module', key: `${file}: ${snippet(node)}`, at: where(node) });
      }
      // (c) X's upgrade levels are X's extension; Zero's modules never name them.
      if (X_ONLY_LEVELS.has(value)) {
        found.push({ rule: 'c', kind: 'x-upgrade-in-zero-module', key: `${file}: ${snippet(node)}`, at: where(node) });
      }
    }
  });
  return found;
}

/** Zero's tool host registers its built-in schemas by literal name. */
export const zeroHostToolNames = source => [...source.matchAll(/registerToolSchema\(\s*'([A-Za-z0-9]+)'/g)].map(match => match[1]);

/** X's tool runner must enforce Zero's verifiedToolSource gate on /self/tools/. */
export const xToolRunnerRequiresActivation = source => (
  /import\s*\{[^}]*\bverifiedToolSource\b[^}]*\}\s*from\s*'\.\/create-tool\.js'/.test(source)
  && /\bverifiedToolSource\s*\(\s*VFS\s*,/.test(source)
);

export async function findDivergences({ tree }) {
  const read = async served => (await tree.read(served)).toString('utf8');
  const zeroFiles = JSON.parse(await read('zero/source.json')).files.map(entry => entry.path);
  const zero = new Set(zeroFiles);
  const catalog = JSON.parse(await read('config/self-source-catalog.json'));
  const xSpark = new Set(catalog.profiles.spark.files);
  const found = [];
  for (const file of zeroFiles.filter(name => /\.m?js$/.test(name) && !name.includes('/vendor/acorn'))) {
    found.push(...analyzeZeroModule(file, await read(file), served => zero.has(served)));
  }
  // (c) X builds on Zero's modules; a Zero module missing from X's base is replaced there.
  for (const file of zeroFiles) {
    if (!xSpark.has(file)) found.push({ rule: 'c', kind: 'zero-module-not-in-x', key: file });
  }
  // (d) X with no upgrade adds nothing to Zero's closure.
  for (const file of xSpark) {
    if (!zero.has(file)) found.push({ rule: 'd', kind: 'x-base-module-not-in-zero', key: file });
  }
  const zeroTools = zeroHostToolNames(await read('zero/tools.js'));
  const xTools = getToolNamesForMode('x', { surfaceIds: LAB_UPGRADE_TOOL_SURFACE_IDS.spark });
  if (JSON.stringify([...zeroTools].sort()) !== JSON.stringify([...xTools].sort())) {
    found.push({ rule: 'd', kind: 'x-base-tools-differ', key: `zero ${zeroTools.join(',')} / x ${xTools.join(',')}` });
  }
  if (!xToolRunnerRequiresActivation(await read('core/tool-runner.js'))) {
    found.push({ rule: 'd', kind: 'x-tool-runner-skips-activation-evidence', key: 'core/tool-runner.js' });
  }
  return found;
}

/** Compare observed divergences with the record: new ones and fixed-but-recorded ones both fail. */
export function compareWithRecord(found, record) {
  const errors = [];
  if (record?.schema !== RECORD_SCHEMA) errors.push(`${RECORD_PATH} schema must be ${RECORD_SCHEMA}`);
  const recorded = new Map();
  for (const group of record?.divergences || []) {
    if (!group?.reason || !group?.evidence) errors.push(`divergence group ${group?.kind} needs a reason and evidence`);
    for (const key of group?.keys || []) recorded.set(`${group.kind}|${key}`, group);
  }
  const observed = new Set();
  for (const item of found) {
    const id = `${item.kind}|${item.key}`;
    observed.add(id);
    if (!recorded.has(id)) {
      errors.push(`new divergence (${item.rule}) ${item.kind}: ${item.key}${item.at ? ` at ${item.at}` : ''}`);
    }
  }
  for (const id of recorded.keys()) {
    if (!observed.has(id)) errors.push(`recorded divergence no longer exists; remove it from ${RECORD_PATH}: ${id}`);
  }
  return errors;
}

/** Drop recorded divergences that no longer exist; never record a new one. */
export function pruneRecord(found, record) {
  const observed = new Set(found.map(item => `${item.kind}|${item.key}`));
  const divergences = (record.divergences || [])
    .map(group => ({ ...group, keys: (group.keys || []).filter(key => observed.has(`${group.kind}|${key}`)) }))
    .filter(group => group.keys.length);
  return { ...record, divergences };
}

async function main() {
  const tree = await openBrowserTree();
  const file = path.join(ROOT, RECORD_PATH);
  let record = JSON.parse(await readFile(file, 'utf8'));
  const found = await findDivergences({ tree });
  if (process.argv.includes('--prune')) {
    record = pruneRecord(found, record);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  }
  const errors = compareWithRecord(found, record);
  if (errors.length) {
    console.error('[x-extension] X is not the recorded extension of Zero:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  const counts = Object.entries(Object.groupBy(found, item => item.kind)).map(([kind, items]) => `${kind} ${items.length}`);
  console.log(`[x-extension] no new divergences; recorded: ${counts.join(', ') || 'none'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
