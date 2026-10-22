/**
 * @fileoverview Route/tool surface composition.
 *
 * /zero starts with only CreateTool. /x extends the same seed with explicitly
 * selected upgrades. Reploid keeps its separate file substrate.
 */

export const TOOL_SURFACES = Object.freeze({
  zeroSeed: Object.freeze([
    'CreateTool'
  ]),
  sharedFile: Object.freeze([
    'ReadFile',
    'ListFiles',
    'Grep',
    'ListTools',
    'WriteFile',
    'EditFile',
    'CreateTool',
    'LoadModule'
  ]),
  promotion: Object.freeze([
    'Promote'
  ]),
  optimization: Object.freeze([
    'DopplerOptimize'
  ]),
  extendedFile: Object.freeze([
    'DeleteFile',
    'MakeDirectory',
    'CopyFile',
    'MoveFile',
    'Head',
    'Tail',
    'Find',
    'FileOutline',
    'git'
  ]),
  cognition: Object.freeze([
    'ListMemories',
    'ListKnowledge',
    'RunGEPA'
  ]),
  workers: Object.freeze([
    'SpawnWorker',
    'ListWorkers',
    'AwaitWorkers'
  ]),
  swarm: Object.freeze([
    'SwarmShareFile',
    'SwarmRequestFile',
    'SwarmListPeers',
    'SwarmGetStatus'
  ])
});

export const ZERO_TOOL_SURFACE_IDS = Object.freeze(['zeroSeed']);
export const REPLOID_TOOL_SURFACE_IDS = Object.freeze([
  'sharedFile',
  'extendedFile',
  'promotion'
]);
export const UPGRADED_TOOL_SURFACE_IDS = Object.freeze([
  ...REPLOID_TOOL_SURFACE_IDS,
  'optimization',
  'cognition',
  'workers',
  'swarm'
]);

export const X_TOOL_SURFACE_IDS = ZERO_TOOL_SURFACE_IDS;

export const TOOL_SURFACE_IDS_BY_MODE = Object.freeze({
  zero: ZERO_TOOL_SURFACE_IDS,
  reploid: REPLOID_TOOL_SURFACE_IDS,
  x: X_TOOL_SURFACE_IDS
});

export const ZERO_SEED_TOOLS = TOOL_SURFACES.zeroSeed;
export const SHARED_FILE_TOOLS = TOOL_SURFACES.sharedFile;

export function getToolNamesForSurfaceIds(surfaceIds = [], options = {}) {
  const seen = new Set();
  const tools = [];
  for (const surfaceId of surfaceIds || []) {
    for (const toolName of TOOL_SURFACES[surfaceId] || []) {
      if (toolName === 'CreateTool' && options.hasToolWriter === false) continue;
      if (seen.has(toolName)) continue;
      seen.add(toolName);
      tools.push(toolName);
    }
  }
  return tools;
}

export function getToolSurfaceIdsForMode(mode = 'reploid', options = {}) {
  if (mode === 'x' && ['reflection', 'cognition', 'substrate', 'full'].includes(options.upgradeLevel)) {
    const surfaces = ['sharedFile', 'extendedFile', 'promotion'];
    if (['cognition', 'substrate', 'full'].includes(options.upgradeLevel)) surfaces.push('cognition');
    if (['substrate', 'full'].includes(options.upgradeLevel)) surfaces.push('workers');
    if (options.upgradeLevel === 'full') surfaces.push('optimization', 'swarm');
    return surfaces;
  }
  return TOOL_SURFACE_IDS_BY_MODE[mode] || ZERO_TOOL_SURFACE_IDS;
}

export function getToolNamesForMode(mode = 'reploid', options = {}) {
  const tools = getToolNamesForSurfaceIds(getToolSurfaceIdsForMode(mode, options), options);
  // Lab extensions never receive the host git dependency. Do not advertise it.
  return mode === 'zero' || mode === 'x' ? tools.filter(name => name !== 'git') : tools;
}

export function getVisibleToolsByMode(options = {}) {
  return Object.freeze({
    zero: getToolNamesForMode('zero', options),
    reploid: getToolNamesForMode('reploid', options),
    x: getToolNamesForMode('x', options)
  });
}
