/**
 * @fileoverview Export a source-only X image and materialize its browser host assets.
 */

import { cloneSelfBootSpec } from '../boot-spec.js';
import { assertSelfImagePath, createSelfImageManifest, validateSelfImageManifest } from './manifest.js';

const SOURCE_MANIFEST_PATH = '/config/self-source-manifest.json';
const SOURCE_MANIFEST_IMAGE_PATH = `/self${SOURCE_MANIFEST_PATH}`;
const VFS_MANIFEST_IMAGE_PATH = '/self/config/vfs-manifest.json';
const SOURCE_CATALOG_IMAGE_PATH = '/self/config/self-source-catalog.json';
const REQUIRED_SOURCES = Object.freeze([
  'boot-spec.js',
  'kernel/index.html',
  'kernel/boot.js',
  'host/seed-vfs.js',
  'host/start-app.js',
  'host/vfs-bootstrap.js',
  'host/sw-module-loader.js',
  'config/self-source-manifest.json',
  'config/self-source-catalog.json',
  'config/vfs-manifest.json',
  'image/export.js',
  'image/manifest.js'
]);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sortPaths = (paths) => [...paths].sort((left, right) => left.localeCompare(right));
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

const parseJson = (text, path) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid source JSON: ${path}`);
  }
};

const assertSourcePath = (path) => {
  if (typeof path !== 'string' || path.startsWith('/')) {
    throw new Error(`Invalid root-relative source path: ${path}`);
  }
  assertSelfImagePath(`/self/${path}`);
  return path;
};

export const validateSourceManifest = (value) => {
  if (value?.schema !== 'reploid/self-source/v1' || value.version !== 1
    || typeof value.level !== 'string' || !value.level
    || !Array.isArray(value.files) || !Array.isArray(value.seedFiles)
    || value.files.length !== value.seedFiles.length
    || (value.prerequisites !== undefined && (!Array.isArray(value.prerequisites)
      || value.prerequisites.some((entry) => typeof entry !== 'string')))) {
    throw new Error('Invalid self-source manifest: aligned files and seedFiles are required');
  }
  const manifest = JSON.parse(JSON.stringify(value));
  const paths = new Set();
  const seedPaths = new Set();
  manifest.files.forEach((path, index) => {
    assertSourcePath(path);
    const seedPath = assertSourcePath(manifest.seedFiles[index]);
    const sourcePath = seedPath.startsWith('self/') ? seedPath.slice('self/'.length) : seedPath;
    if (path !== sourcePath) throw new Error(`Self-source path does not match seed path: ${path}`);
    if (paths.has(path)) throw new Error(`Duplicate self-source path: ${path}`);
    if (seedPaths.has(seedPath)) throw new Error(`Duplicate self-source seed path: ${seedPath}`);
    paths.add(path);
    seedPaths.add(seedPath);
  });
  for (const path of REQUIRED_SOURCES) {
    if (!paths.has(path)) throw new Error(`Missing boot source: /self/${path}`);
  }
  return manifest;
};

const readSourceCatalog = (text, sourceManifest) => {
  const catalog = parseJson(text, SOURCE_CATALOG_IMAGE_PATH);
  if (catalog?.schema !== 'reploid/self-source-catalog/v1' || catalog.version !== 1
    || !catalog.profiles || typeof catalog.profiles !== 'object' || Array.isArray(catalog.profiles)
    || !hasOwn(catalog.profiles, sourceManifest.level)) {
    throw new Error('Invalid self-source catalog: selected profile is required');
  }
  return catalog;
};

async function readText(deps, path) {
  const file = await deps.readFile({ path });
  if (typeof file?.content !== 'string') throw new Error(`Missing text source: ${path}`);
  return file.content;
}

export async function exportSelfImage(args = {}, deps) {
  if (args.roots !== undefined
    && (!Array.isArray(args.roots) || args.roots.length !== 1 || args.roots[0] !== '/self')) {
    throw new Error('Source image exports require the complete /self root');
  }
  const sourceText = await readText(deps, SOURCE_MANIFEST_PATH);
  const sourceManifest = validateSourceManifest(parseJson(sourceText, SOURCE_MANIFEST_PATH));

  if (args.includeTools === true) {
    const installedPaths = sortPaths(await deps.VFS.list('/self/tools/'));
    for (const path of installedPaths) {
      if (!path.startsWith('/self/tools/') || !path.endsWith('.js')) continue;
      assertSelfImagePath(path);
      const sourcePath = path.slice('/self/'.length);
      const existingIndex = sourceManifest.files.indexOf(sourcePath);
      if (existingIndex >= 0) {
        // ToolRunner loads installed /self/tools after /tools. Export the same
        // active replacement rather than the inactive builtin's original bytes.
        sourceManifest.seedFiles[existingIndex] = path.slice(1);
      } else {
        sourceManifest.files.push(sourcePath);
        sourceManifest.seedFiles.push(path.slice(1));
      }
    }
  }

  const files = {};
  for (let index = 0; index < sourceManifest.files.length; index += 1) {
    const path = `/self/${sourceManifest.files[index]}`;
    files[path] = await readText(deps, `/${sourceManifest.seedFiles[index]}`);
  }
  // The image contains only its declared seed closure, never the host's full inventory.
  files[SOURCE_MANIFEST_IMAGE_PATH] = args.includeTools === true ? serialize(sourceManifest) : sourceText;
  files[VFS_MANIFEST_IMAGE_PATH] = serialize({ version: 1, files: [...sourceManifest.seedFiles] });
  // Fresh boot selects its seed closure from the catalog, not the active descriptor.
  // Keep that selected profile aligned so explicitly exported installed tools seed too.
  const sourceCatalog = readSourceCatalog(files[SOURCE_CATALOG_IMAGE_PATH], sourceManifest);
  sourceCatalog.profiles[sourceManifest.level] = sourceManifest;
  files[SOURCE_CATALOG_IMAGE_PATH] = serialize(sourceCatalog);
  const bootSpec = cloneSelfBootSpec();
  const manifest = await createSelfImageManifest({
    paths: sortPaths(Object.keys(files)),
    bootSpec,
    readText: async (path) => files[path]
  });
  const image = {
    schema: 'reploid/self-image-export/v1',
    version: 1,
    exportedAt: new Date().toISOString(),
    boot: bootSpec,
    manifest,
    files
  };
  await validateSelfImageExport(image);
  if (args.includeContent === false) return { ...image, files: undefined };
  return image;
}

export async function validateSelfImageExport(image) {
  if (image?.schema !== 'reploid/self-image-export/v1' || image.version !== 1) {
    throw new Error('Invalid self-image export');
  }
  const checked = await validateSelfImageManifest({ manifest: image.manifest, files: image.files });
  const sourceManifest = validateSourceManifest(parseJson(checked.files[SOURCE_MANIFEST_IMAGE_PATH], SOURCE_MANIFEST_IMAGE_PATH));
  const declared = new Set(sourceManifest.files.map((path) => `/self/${path}`));
  for (const path of declared) {
    if (!hasOwn(checked.files, path)) throw new Error(`Missing declared source: ${path}`);
  }
  for (const path of Object.keys(checked.files)) {
    if (!declared.has(path)) throw new Error(`Undeclared self-image source: ${path}`);
  }
  const vfsManifest = parseJson(checked.files[VFS_MANIFEST_IMAGE_PATH], VFS_MANIFEST_IMAGE_PATH);
  if (!Array.isArray(vfsManifest?.files)
    || vfsManifest.files.length !== sourceManifest.seedFiles.length
    || vfsManifest.files.some((path, index) => path !== sourceManifest.seedFiles[index])) {
    throw new Error('Self-image VFS manifest does not match the declared seed closure');
  }
  const sourceCatalog = readSourceCatalog(checked.files[SOURCE_CATALOG_IMAGE_PATH], sourceManifest);
  const selected = validateSourceManifest(sourceCatalog.profiles[sourceManifest.level]);
  const descriptorKeys = ['schema', 'version', 'level', 'files', 'seedFiles', 'prerequisites'];
  if (descriptorKeys.some((key) => JSON.stringify(selected[key]) !== JSON.stringify(sourceManifest[key]))) {
    throw new Error('Self-image catalog profile does not match the declared seed closure');
  }
  return { ...checked, sourceManifest };
}

export async function materializeSelfImage(image) {
  const { files: sourceFiles, sourceManifest } = await validateSelfImageExport(image);
  const files = Object.fromEntries(Object.entries(sourceFiles).map(([path, content]) => [path.slice('/self'.length), content]));
  const html = sourceFiles['/self/kernel/index.html'];
  // Enter the image's surface before the kernel reads the route, without copying browser state.
  const route = sourceManifest.level === 'spark' ? '/x' : '/zero';
  const routeWrapper = `<script>if (location.pathname === '/' || location.pathname === '/index.html') history.replaceState(null, '', '${route}' + location.search + location.hash);</script>`;
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('Kernel HTML is missing its head element');
  files['/index.html'] = html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n    ${routeWrapper}`);
  files['/x'] = html;
  files['/zero'] = html;
  files['/sw.js'] = "const version = new URL(self.location.href).searchParams.get('v');\nconst suffix = version ? `?v=${encodeURIComponent(version)}` : '';\nimportScripts(`/host/sw-module-loader.js${suffix}`);\n";
  return {
    schema: 'reploid/self-image-host/v1',
    version: 1,
    prerequisites: [...(sourceManifest.prerequisites || [])],
    files
  };
}

export const tool = {
  name: 'ExportSelfImage',
  description: 'Exports the declared source-only X image with verified hashes. Hosting and provider access remain separate prerequisites.',
  inputSchema: {
    type: 'object',
    properties: {
      includeContent: { type: 'boolean' },
      includeTools: { type: 'boolean', description: 'Include installed /self/tools/*.js sources in the image.' }
    }
  },
  call: async (args, deps) => exportSelfImage(args, deps)
};
