import { describe, expect, it } from 'vitest';

import {
  getToolNamesForMode,
  ZERO_SEED_TOOLS
} from '../../shared/config/tool-surfaces.js';
import { getLabToolSurfaceIds, LAB_UPGRADE_LEVELS } from '../../self/config/lab-upgrades.js';

const xTools = (level, options = {}) => getToolNamesForMode('x', { ...options, surfaceIds: getLabToolSurfaceIds('x', level) });
import { listReploidEnvironmentTemplates } from '../../self/config/reploid-environments.js';

describe('tool surfaces', () => {
  it('keeps Zero at the CreateTool-only seed surface', () => {
    const zeroTools = getToolNamesForMode('zero', {
      hasToolWriter: true,
      hasSubstrateLoader: false
    });

    expect(zeroTools).toEqual(['CreateTool']);
    expect(getToolNamesForMode('x')).toEqual(['CreateTool']);
  });

  it('keeps Promote available to broader runtime surfaces', () => {
    expect(getToolNamesForMode('reploid', {
      hasToolWriter: true,
      hasSubstrateLoader: true
    })).toContain('Promote');
    expect(xTools('full', {
      hasToolWriter: true,
      hasSubstrateLoader: true
    })).toContain('Promote');
  });

  it('does not let a selected X upgrade expand Zero or an invalid X selection', () => {
    expect(getToolNamesForMode('zero', { surfaceIds: getLabToolSurfaceIds('zero', 'full') })).toEqual(['CreateTool']);
    expect(xTools('unknown')).toEqual(['CreateTool']);
    expect(xTools('spark')).toEqual(getToolNamesForMode('zero'));
    // The shared table holds no X upgrade policy: a level name alone selects nothing.
    expect(getToolNamesForMode('x', { upgradeLevel: 'full' })).toEqual(['CreateTool']);
    expect(xTools('reflection')).toContain('ReadFile');
    expect(xTools('reflection')).not.toContain('SpawnWorker');
    expect(xTools('substrate')).toContain('SpawnWorker');
    expect(xTools('substrate')).not.toContain('SwarmShareFile');
    expect(xTools('full')).toContain('SwarmShareFile');
  });

  it.each(['zero', 'x'])('never advertises host git on %s, including optional levels', mode => {
    for (const upgradeLevel of LAB_UPGRADE_LEVELS) {
      expect(getToolNamesForMode(mode, { surfaceIds: getLabToolSurfaceIds(mode, upgradeLevel) })).not.toContain('git');
    }
    expect(getToolNamesForMode('reploid')).toContain('git');
  });

  it('keeps Zero environment templates aligned with the shared file surface', () => {
    const visibleSurface = `Visible Zero seed surface: ${ZERO_SEED_TOOLS.join(', ')}.`;
    const starterPath = 'Starter self-edit path: CreateTool, created reader/lister, created mutation tool.';

    for (const template of listReploidEnvironmentTemplates()) {
      expect(template.text).toContain('Model writes go under /shadow and /artifacts.');
      expect(template.text).toContain(visibleSurface);
      if (template.id === 'e0' || template.id === 'e1') {
        expect(template.text).toContain(starterPath);
      }
    }
  });
});
