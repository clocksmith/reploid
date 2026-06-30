/**
 * @fileoverview Runtime UI entrypoints for self-hosted lab profiles.
 */

export const ZERO_RUNTIME_UI = Object.freeze({
  name: 'zero',
  stylePath: '/self/styles/zero.css',
  vfsModulePath: '/self/ui/zero/index.js',
  sourceModulePath: '/ui/zero/index.js',
  allowSourceFallback: false
});

export const PROTO_RUNTIME_UI = Object.freeze({
  name: 'proto',
  stylePath: '/self/styles/proto/index.css',
  vfsModulePath: '/self/ui/proto/index.js',
  sourceModulePath: '/ui/proto/index.js',
  allowSourceFallback: false
});
