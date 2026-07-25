#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SOURCE_ROOTS = Object.freeze(['self/core', 'self/pool', 'self/ui', 'server']);

const FORBIDDEN_TARGETS = Object.freeze({
  'self/pool': new Set(['self/core', 'self/ui', 'server']),
  'self/core': new Set(['self/ui', 'server']),
  'self/ui': new Set(['server']),
  server: new Set(['self/core', 'self/ui'])
});

const toPosix = (value) => value.split(path.sep).join('/');

export function classifyLayer(relativePath) {
  const normalized = toPosix(relativePath).replace(/^\.\//, '');
  return SOURCE_ROOTS.find((root) => normalized === root || normalized.startsWith(`${root}/`)) || null;
}

export function extractModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return [...new Set(specifiers)];
}

export function findLayerViolations({ repoRoot, sourcePath, source }) {
  const relativeSource = toPosix(path.relative(repoRoot, sourcePath));
  const sourceLayer = classifyLayer(relativeSource);
  if (!sourceLayer) return [];

  const forbidden = FORBIDDEN_TARGETS[sourceLayer] || new Set();
  const violations = [];
  for (const specifier of extractModuleSpecifiers(source)) {
    if (!specifier.startsWith('.')) continue;
    const targetPath = path.resolve(path.dirname(sourcePath), specifier);
    const relativeTarget = toPosix(path.relative(repoRoot, targetPath));
    const targetLayer = classifyLayer(relativeTarget);
    if (targetLayer && forbidden.has(targetLayer)) {
      violations.push({
        source: relativeSource,
        sourceLayer,
        specifier,
        target: relativeTarget,
        targetLayer
      });
    }
  }
  return violations;
}

function walkJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJavaScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath);
  }
  return files;
}

export function verifyRepositoryLayers(repoRoot) {
  const violations = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = path.join(repoRoot, sourceRoot);
    for (const sourcePath of walkJavaScriptFiles(directory)) {
      violations.push(...findLayerViolations({
        repoRoot,
        sourcePath,
        source: fs.readFileSync(sourcePath, 'utf8')
      }));
    }
  }
  return violations;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const violations = verifyRepositoryLayers(repoRoot);
  if (violations.length > 0) {
    console.error('Layer verification failed:');
    for (const violation of violations) {
      console.error(
        `- ${violation.source} (${violation.sourceLayer}) imports `
        + `${violation.target} (${violation.targetLayer}) via ${violation.specifier}`
      );
    }
    process.exitCode = 1;
  } else {
    console.log('Layer verification passed.');
  }
}
