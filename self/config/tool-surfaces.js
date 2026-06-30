/**
 * @fileoverview Route/tool surface composition.
 *
 * /0 uses the shared file substrate only. /x is a strict superset with
 * cognition, worker, and swarm tools enabled by default.
 */

export const TOOL_SURFACES = Object.freeze({
  sharedFile: Object.freeze([
    'ReadFile',
    'WriteFile',
    'EditFile',
    'ListFiles',
    'DeleteFile',
    'MakeDirectory',
    'CopyFile',
    'MoveFile',
    'Head',
    'Tail',
    'Grep',
    'Find',
    'FileOutline',
    'git',
    'ListTools',
    'CreateTool',
    'LoadModule',
    'Promote'
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

export const ZERO_TOOL_SURFACE_IDS = Object.freeze(['sharedFile']);
export const X_TOOL_SURFACE_IDS = Object.freeze([
  ...ZERO_TOOL_SURFACE_IDS,
  'cognition',
  'workers',
  'swarm'
]);

export const TOOL_SURFACE_IDS_BY_MODE = Object.freeze({
  zero: ZERO_TOOL_SURFACE_IDS,
  reploid: ZERO_TOOL_SURFACE_IDS,
  x: X_TOOL_SURFACE_IDS
});

export const SHARED_FILE_TOOLS = TOOL_SURFACES.sharedFile;

export function getToolNamesForSurfaceIds(surfaceIds = [], options = {}) {
  const seen = new Set();
  const tools = [];
  for (const surfaceId of surfaceIds || []) {
    for (const toolName of TOOL_SURFACES[surfaceId] || []) {
      if (toolName === 'CreateTool' && options.hasToolWriter === false) continue;
      if (toolName === 'LoadModule' && options.hasSubstrateLoader === false) continue;
      if (seen.has(toolName)) continue;
      seen.add(toolName);
      tools.push(toolName);
    }
  }
  return tools;
}

export function getToolSurfaceIdsForMode(mode = 'reploid') {
  return TOOL_SURFACE_IDS_BY_MODE[mode] || ZERO_TOOL_SURFACE_IDS;
}

export function getToolNamesForMode(mode = 'reploid', options = {}) {
  return getToolNamesForSurfaceIds(getToolSurfaceIdsForMode(mode), options);
}

