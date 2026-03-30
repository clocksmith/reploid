/**
 * @fileoverview Export the canonical /self image.
 */

import { SELF_BOOT_SPEC, cloneSelfBootSpec } from '../boot-spec.js';
import { createSelfImageManifest, isCanonicalSelfPath } from './manifest.js';

const sortPaths = (paths) => [...paths].sort((left, right) => left.localeCompare(right));

async function listCanonicalPaths(vfs, roots = SELF_BOOT_SPEC.canonicalRoots) {
  const keys = await vfs.list('/');
  return sortPaths(keys.filter((path) => isCanonicalSelfPath(path, roots)));
}

export async function exportSelfImage(args = {}, deps) {
  const roots = Array.isArray(args.roots) && args.roots.length > 0
    ? args.roots.map((root) => String(root || '').trim()).filter(Boolean)
    : SELF_BOOT_SPEC.canonicalRoots;
  const includeContent = args.includeContent !== false;
  const bootSpec = cloneSelfBootSpec();
  const paths = await listCanonicalPaths(deps.VFS, roots);
  const files = {};

  for (const path of paths) {
    const file = await deps.readFile({ path });
    files[path] = String(file.content || '');
  }

  const manifest = await createSelfImageManifest({
    paths,
    bootSpec,
    readText: async (path) => files[path] || ''
  });

  return {
    schema: 'reploid/self-image-export/v1',
    version: 1,
    exportedAt: new Date().toISOString(),
    boot: bootSpec,
    manifest,
    files: includeContent ? files : undefined
  };
}

export const tool = {
  name: 'ExportSelfImage',
  description: 'Exports the canonical /self image with hashes and optional file contents.',
  inputSchema: {
    type: 'object',
    properties: {
      roots: {
        type: 'array',
        items: { type: 'string' }
      },
      includeContent: {
        type: 'boolean'
      }
    }
  },
  call: async (args, deps) => exportSelfImage(args, deps)
};
