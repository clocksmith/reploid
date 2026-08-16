/**
 * @fileoverview Deterministic identity for the code and locked inputs executed by Cloud Run.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { hashJson } from './hash.js';

export const COORDINATOR_RUNTIME_BUNDLE_SCHEMA = 'poolday.coordinator_runtime_bundle/v1';
export const DEFAULT_COORDINATOR_RUNTIME_SCOPE = Object.freeze([
  'Dockerfile',
  'package.json',
  'package-lock.json',
  'server',
  'self'
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const normalizeRelativePath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError(`Invalid coordinator runtime path: ${value}`);
  }
  return segments.join('/');
};

async function collectFiles(rootDirectory, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const absolutePath = path.join(rootDirectory, ...normalized.split('/'));
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Coordinator runtime scope cannot contain a symbolic link: ${normalized}`);
  }
  if (stat.isFile()) return [normalized];
  if (!stat.isDirectory()) throw new Error(`Coordinator runtime scope is not a file or directory: ${normalized}`);
  const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
  const files = [];
  for (const dirent of dirents) {
    const child = `${normalized}/${dirent.name}`;
    if (dirent.isSymbolicLink()) {
      throw new Error(`Coordinator runtime scope cannot contain a symbolic link: ${child}`);
    }
    if (dirent.isDirectory()) files.push(...await collectFiles(rootDirectory, child));
    else if (dirent.isFile()) files.push(child);
  }
  return files;
}

export async function buildCoordinatorRuntimeBundle({
  rootDirectory = DEFAULT_ROOT,
  scope = DEFAULT_COORDINATOR_RUNTIME_SCOPE
} = {}) {
  const normalizedScope = [...scope].map(normalizeRelativePath).sort();
  if (new Set(normalizedScope).size !== normalizedScope.length) {
    throw new TypeError('Coordinator runtime scope contains duplicate paths');
  }
  const filePaths = (await Promise.all(normalizedScope.map((entry) => (
    collectFiles(rootDirectory, entry)
  )))).flat().sort();
  if (new Set(filePaths).size !== filePaths.length) {
    throw new TypeError('Coordinator runtime scope overlaps the same file');
  }
  const files = await Promise.all(filePaths.map(async (relativePath) => {
    const bytes = await fs.readFile(path.join(rootDirectory, ...relativePath.split('/')));
    return {
      path: relativePath,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes)
    };
  }));
  const payload = {
    schema: COORDINATOR_RUNTIME_BUNDLE_SCHEMA,
    hashAlgorithm: 'sha256',
    scope: normalizedScope,
    files
  };
  return { ...payload, runtimeBundleHash: hashJson(payload) };
}

export function validateCoordinatorRuntimeBundle(bundle = {}) {
  const reasons = [];
  if (bundle.schema !== COORDINATOR_RUNTIME_BUNDLE_SCHEMA) reasons.push('coordinator runtime bundle schema is invalid');
  if (bundle.hashAlgorithm !== 'sha256') reasons.push('coordinator runtime bundle hash algorithm is invalid');
  if (!Array.isArray(bundle.scope) || bundle.scope.length === 0) reasons.push('coordinator runtime bundle scope is invalid');
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  if (files.length === 0) reasons.push('coordinator runtime bundle files are missing');
  let priorPath = null;
  const paths = new Set();
  for (const file of files) {
    let normalized = null;
    try {
      normalized = normalizeRelativePath(file?.path);
    } catch {
      reasons.push(`coordinator runtime bundle path is invalid: ${file?.path || 'missing'}`);
      continue;
    }
    if (normalized !== file.path || paths.has(normalized)
      || (priorPath !== null && priorPath.localeCompare(normalized) >= 0)) {
      reasons.push(`coordinator runtime bundle path is not unique and sorted: ${normalized}`);
    }
    paths.add(normalized);
    priorPath = normalized;
    if (!Number.isSafeInteger(file.byteLength) || file.byteLength < 0 || !SHA256_PATTERN.test(file.sha256 || '')) {
      reasons.push(`coordinator runtime bundle file identity is invalid: ${normalized}`);
    }
  }
  const payload = {
    schema: bundle.schema,
    hashAlgorithm: bundle.hashAlgorithm,
    scope: bundle.scope,
    files: bundle.files
  };
  if (!SHA256_PATTERN.test(bundle.runtimeBundleHash || '') || bundle.runtimeBundleHash !== hashJson(payload)) {
    reasons.push('coordinator runtime bundle hash is invalid');
  }
  return { ok: reasons.length === 0, reasons };
}
