#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { SURFACE_INTENTS } from '../self/config/surface-intents.js';

const SOURCE_ROOTS = ['packages/reploid/src', 'self/core', 'self/pool', 'self/host', 'self/lab',
  'self/providers', 'self/ui', 'self/config', 'self/infrastructure', 'self/capabilities', 'functions', 'server', 'self'];
const forbidden = {
  'self/pool': ['self/ui', 'server', 'functions'], 'self/core': ['self/ui', 'server', 'functions'],
  'self/ui': ['server', 'functions'], server: ['self/core', 'self/ui'],
  'self/providers': ['self/ui', 'server', 'functions']
};
const posix = value => value.split(path.sep).join('/');
export function classifyLayer(value) {
  const normalized = posix(value).replace(/^\.\//, '');
  return SOURCE_ROOTS.find(root => normalized === root || normalized.startsWith(root + '/')) || null;
}
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value?.type) walk(value, visit);
  }
};
export function moduleEdges(source) {
  const edges = [];
  walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && node.source) {
      const value = node.source;
      const specifier = value.type === 'Literal' && typeof value.value === 'string' ? value.value
        : value.type === 'TemplateLiteral' && !value.expressions.length ? value.quasis[0].value.cooked : null;
      edges.push({ specifier, expression: source.slice(value.start, value.end), dynamic: node.type === 'ImportExpression' });
    }
  });
  return edges;
}
export const extractModuleSpecifiers = source => [...new Set(moduleEdges(source).map(edge => edge.specifier).filter(Boolean))];
const resolveEdge = (root, file, specifier) => {
  if (specifier.startsWith('.')) return path.resolve(path.dirname(file), specifier);
  if (specifier.startsWith('/')) return path.join(root, 'self', specifier);
  return null;
};
export function findLayerViolations({ repoRoot, sourcePath, source }) {
  const relative = posix(path.relative(repoRoot, sourcePath)), sourceLayer = classifyLayer(relative);
  if (!sourceLayer) return [];
  return moduleEdges(source).flatMap(({ specifier }) => {
    if (!specifier) return [];
    const resolved = resolveEdge(repoRoot, sourcePath, specifier);
    const target = resolved ? posix(path.relative(repoRoot, resolved)) : specifier;
    const targetLayer = classifyLayer(target);
    let reason = null;
    if (sourceLayer === 'packages/reploid/src' &&
      (resolved ? !target.startsWith('packages/reploid/src/') : !(relative === 'packages/reploid/src/adapters/doppler.js' && specifier === 'doppler-gpu'))) reason = 'library must remain independent of host and Node services';
    if (forbidden[sourceLayer]?.includes(targetLayer)) reason = 'forbidden layer dependency';
    if (relative.startsWith('packages/reploid/src/transport/') && /\/(adapters|agent|mesh|improvement)\//.test(target)) reason = 'transport cannot own execution or application policy';
    return reason ? [{ source: relative, sourceLayer, specifier, target, targetLayer, reason }] : [];
  });
}
function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'vendor') return [];
    return entry.isDirectory() ? filesUnder(file) : entry.isFile() && entry.name.endsWith('.js') ? [file] : [];
  });
}
export function findCycles(graph) {
  const visiting = new Set(), done = new Set(), stack = [], cycles = [];
  const visit = node => {
    if (visiting.has(node)) { cycles.push([...stack.slice(stack.indexOf(node)), node]); return; }
    if (done.has(node)) return;
    visiting.add(node); stack.push(node);
    for (const target of graph.get(node) || []) if (graph.has(target)) visit(target);
    stack.pop(); visiting.delete(node); done.add(node);
  };
  for (const node of graph.keys()) visit(node);
  return cycles;
}
export function findRequiredModuleLeaks(surface, modules) {
  const seen = new Set(), leaks = [];
  const visit = (id, chain) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (surface.absentModules.includes(id)) leaks.push([...chain, id]);
    for (const dependency of modules[id]?.dependencies || []) {
      if (!dependency.optional) visit(dependency.id, [...chain, id]);
    }
  };
  for (const id of surface.requiredModules) visit(id, []);
  return leaks;
}
export function verifyRepositoryLayers(repoRoot) {
  const violations = [], graph = new Map();
  const exceptionsFile = path.join(repoRoot, 'scripts/architecture-exceptions.json');
  const exceptions = fs.existsSync(exceptionsFile) ? JSON.parse(fs.readFileSync(exceptionsFile, 'utf8')) : { loaders: [], cycles: [] };
  for (const sourceRoot of ['packages/reploid/src', 'self', 'functions', 'server']) for (const file of filesUnder(path.join(repoRoot, sourceRoot))) {
    const relative = posix(path.relative(repoRoot, file)), source = fs.readFileSync(file, 'utf8');
    violations.push(...findLayerViolations({ repoRoot, sourcePath: file, source }));
    const edges = moduleEdges(source);
    graph.set(relative, edges.filter(edge => edge.specifier).map(edge => resolveEdge(repoRoot, file, edge.specifier))
      .filter(Boolean).map(target => posix(path.relative(repoRoot, target))));
    for (const edge of edges.filter(edge => !edge.specifier)) {
      if (!exceptions.loaders.some(entry => entry.source === relative && entry.expression === edge.expression && entry.owner && entry.contract)) {
        violations.push({ source: relative, reason: 'undeclared dynamic loader', expression: edge.expression });
      }
    }
  }
  for (const cycle of findCycles(graph)) {
    if (!exceptions.cycles.some(entry => entry.owner && entry.contract && JSON.stringify(entry.path) === JSON.stringify(cycle))) {
      violations.push({ source: cycle[0], reason: 'dependency cycle', cycle });
    }
  }
  const sourceRoot = path.join(repoRoot, 'packages/reploid/src'), deliveryRoot = path.join(repoRoot, 'self/vendor/reploid');
  const checkDelivery = (directory, relative = '') => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name), file = path.join(directory, entry.name);
      if (entry.isDirectory()) checkDelivery(file, name);
      else if (/\.(js|json|ts)$/.test(entry.name)) {
        const delivery = path.join(deliveryRoot, name);
        if (!fs.existsSync(delivery) || !fs.readFileSync(file).equals(fs.readFileSync(delivery))) {
          violations.push({ source: posix(path.relative(repoRoot, delivery)), reason: 'generated delivery differs from canonical source' });
        }
      }
    }
  };
  checkDelivery(sourceRoot);
  const checkOrphans = (directory, relative = '') => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name), file = path.join(directory, entry.name);
      if (entry.isDirectory()) checkOrphans(file, name);
      else if (/\.(js|json|ts)$/.test(entry.name) && name !== 'package-assets.json'
        && !fs.existsSync(path.join(sourceRoot, name))) {
        violations.push({ source: posix(path.relative(repoRoot, file)), reason: 'generated delivery has no canonical source' });
      }
    }
  };
  checkOrphans(deliveryRoot);
  return violations;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const violations = verifyRepositoryLayers(root);
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'self/config/module-registry.json'), 'utf8'));
  for (const chain of findRequiredModuleLeaks(SURFACE_INTENTS.zero, registry.modules)) {
    violations.push({ source: 'self/config/module-registry.json', reason: 'optional X capability is required by Zero', chain });
  }
  if (violations.length) { console.error(JSON.stringify(violations, null, 2)); process.exitCode = 1; }
  else console.log('Layer, loader, cycle and canonical delivery verification passed.');
}
