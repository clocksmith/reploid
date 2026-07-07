/**
 * @fileoverview Shared tabula-rasa Reploid boot contracts.
 */

export const DEFAULT_REPLOID_HOME_GOAL = [
  'Start from the blueprint index.',
  'Read only the blueprints needed for the objective.',
  'Write any candidate changes under /shadow and evidence under /artifacts.',
  'Zero installs tools through CreateTool activation evidence; broader Reploid/X changes use Promote.'
].join(' ');

export const RING_SLOTS = Object.freeze([
  'elite',
  'performance',
  'robustness',
  'repair',
  'low-cost',
  'safety',
  'fallback'
]);

export const SELF_FILE_PATHS = Object.freeze([
  '/self/self.json',
  '/self/boot.json',
  '/self/blueprint-index.json',
  '/self/prompts/kernel.md',
  '/self/blueprints/tabula-rasa-runtime.md',
  '/self/blueprints/blueprint-index-contract.md',
  '/self/blueprints/tool-contract.md',
  '/self/blueprints/promotion-contract.md',
  '/self/runtime.js',
  '/self/bridge.js',
  '/self/capsule/index.js',
  '/self/host/start-reploid.js'
]);

export const SELF_SOURCE_PATHS = Object.freeze({
  '/self/blueprint-index.json': '/blueprint-index.json',
  '/self/prompts/kernel.md': '/prompts/kernel.md',
  '/self/blueprints/tabula-rasa-runtime.md': '/blueprints/tabula-rasa-runtime.md',
  '/self/blueprints/blueprint-index-contract.md': '/blueprints/blueprint-index-contract.md',
  '/self/blueprints/tool-contract.md': '/blueprints/tool-contract.md',
  '/self/blueprints/promotion-contract.md': '/blueprints/promotion-contract.md',
  '/self/runtime.js': '/runtime.js',
  '/self/bridge.js': '/bridge.js',
  '/self/capsule/index.js': '/capsule/index.js',
  '/self/host/start-reploid.js': '/host/start-reploid.js'
});

export function buildSelfPreview() {
  return JSON.stringify({
    selfHosted: true,
    productModel: 'Reploid',
    operatingState: 'tabula-rasa',
    blueprintIndexPath: '/self/blueprint-index.json',
    visibleToolsByMode: {
      zero: ['ReadFile', 'WriteFile', 'EditFile', 'ListFiles', 'Grep', 'ListTools', 'CreateTool', 'LoadModule'],
      reploid: ['ReadFile', 'WriteFile', 'EditFile', 'ListFiles', 'Grep', 'ListTools', 'CreateTool', 'LoadModule', 'Promote'],
      x: ['ReadFile', 'WriteFile', 'EditFile', 'ListFiles', 'Grep', 'ListTools', 'CreateTool', 'LoadModule', 'Promote', 'SpawnWorker', 'AwaitWorkers']
    },
    writableRoots: ['/shadow', '/artifacts', 'opfs:/artifacts']
  }, null, 2);
}

export function buildBootPreview() {
  return JSON.stringify({
    schema: 'reploid/self-boot/v1',
    title: 'Reploid',
    defaultRoute: '/',
    bootProfile: 'reploid_home',
    kernel: {
      htmlEntry: '/self/kernel/index.html',
      bootEntry: '/self/kernel/boot.js'
    },
    runtime: {
      runtimeEntry: '/self/runtime.js',
      uiEntry: '/self/capsule/index.js'
    }
  }, null, 2);
}

export function getGeneratedSelfFilePreview(path) {
  if (path === '/self/self.json') return buildSelfPreview();
  if (path === '/self/boot.json') return buildBootPreview();
  return '';
}

export function getReploidLaunchLabels(state = {}) {
  const hasInference = !!(
    state.ownInference &&
    String(state.directProvider || '').trim() &&
    String(state.directModel || '').trim() &&
    String(state.directKey || '').trim()
  );
  const topology = state.swarmEnabled ? 'peer-assisted' : 'local';
  const slots = hasInference && state.swarmEnabled
    ? 'local/remote'
    : hasInference
      ? 'local'
      : state.swarmEnabled
        ? 'remote'
        : 'empty';
  const role = state.swarmEnabled
    ? hasInference ? 'provider' : 'consumer'
    : hasInference ? 'solo host' : 'offline';
  const executor = hasInference && state.swarmEnabled
    ? 'local host + remote slots'
    : hasInference
      ? 'local host'
      : state.swarmEnabled
        ? 'waiting for host'
        : 'none';
  const note = hasInference
    ? state.swarmEnabled
      ? 'Local slots execute here and remote slots may join'
      : 'All runnable slots execute locally'
    : state.swarmEnabled
      ? 'Waiting for remote host slots'
      : 'No executor attached';

  return {
    hasInference,
    topology,
    slots,
    role,
    executor,
    note,
    canAwaken: hasInference || !!state.swarmEnabled
  };
}
