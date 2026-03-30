/**
 * @fileoverview Strict boot contract for the self-owned runtime, host, and kernel.
 */

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizePath = (path) => {
  const value = String(path || '').trim();
  if (!value) {
    throw new Error('Missing path');
  }
  return value.startsWith('/') ? value : `/${value}`;
};

export const SELF_BOOT_SPEC = Object.freeze({
  schema: 'reploid/self-boot/v1',
  version: 1,
  title: 'Reploid · Browser RSI Substrate',
  baseHref: '/',
  bootSpecPath: '/self/boot.json',
  selfPath: '/self/self.json',
  identityPath: '/self/identity.json',
  canonicalRoots: ['/self'],
  writableRoots: ['/self', '/artifacts', 'opfs:/artifacts'],
  kernel: {
    htmlEntry: '/self/kernel/index.html',
    bootEntry: '/self/kernel/boot.js'
  },
  host: {
    seedEntry: '/self/host/seed-vfs.js',
    startEntry: '/self/host/start-app.js',
    vfsBootstrapEntry: '/self/host/vfs-bootstrap.js',
    serviceWorkerEntry: '/self/host/sw-module-loader.js'
  },
  runtime: {
    runtimeEntry: '/self/runtime.js',
    uiEntry: '/self/capsule/index.js',
    uiStylePath: 'styles/capsule.css'
  },
  image: {
    manifestEntry: '/self/image/manifest.js',
    exportEntry: '/self/image/export.js'
  },
  projections: [
    {
      source: '/self/kernel/index.html',
      target: '/src/index.html',
      mode: 'wrapper'
    },
    {
      source: '/self/host/seed-vfs.js',
      target: '/src/entry/seed-vfs.js',
      mode: 'shim'
    },
    {
      source: '/self/host/start-app.js',
      target: '/src/entry/start-app.js',
      mode: 'shim'
    },
    {
      source: '/self/host/vfs-bootstrap.js',
      target: '/src/boot-helpers/vfs-bootstrap.js',
      mode: 'shim'
    },
    {
      source: '/self/host/sw-module-loader.js',
      target: '/src/sw-module-loader.js',
      mode: 'wrapper'
    }
  ],
  routes: {
    '/': {
      mode: 'reploid',
      bootProfile: 'reploid_home',
      genesisLevel: 'capsule'
    },
    '/0': {
      mode: 'zero',
      bootProfile: 'zero_home',
      genesisLevel: 'spark'
    },
    '/x': {
      mode: 'x',
      bootProfile: 'x_home',
      genesisLevel: 'full'
    }
  }
});

export function cloneSelfBootSpec() {
  return clone(SELF_BOOT_SPEC);
}

export function getRouteBootSpec(pathname = '/') {
  return SELF_BOOT_SPEC.routes[String(pathname || '/').trim() || '/'] || null;
}

export function toSourceWebPath(path) {
  const normalized = normalizePath(path);
  if (normalized.startsWith('/self/')) {
    return `/src${normalized}`;
  }
  return normalized;
}

export function toVfsPath(path) {
  return normalizePath(path);
}
