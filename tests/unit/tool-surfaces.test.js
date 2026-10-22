import { describe, expect, it } from 'vitest';

import {
  getToolNamesForMode,
  ZERO_SEED_TOOLS
} from '../../self/config/tool-surfaces.js';
import { LAB_UPGRADE_LEVELS } from '../../self/config/lab-upgrades.js';
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
    expect(getToolNamesForMode('x', {
      upgradeLevel: 'full',
      hasToolWriter: true,
      hasSubstrateLoader: true
    })).toContain('Promote');
  });

  it('does not let a selected X upgrade expand Zero or an invalid X selection', () => {
    expect(getToolNamesForMode('zero', { upgradeLevel: 'full' })).toEqual(['CreateTool']);
    expect(getToolNamesForMode('x', { upgradeLevel: 'unknown' })).toEqual(['CreateTool']);
    expect(getToolNamesForMode('x', { upgradeLevel: 'reflection' })).toContain('ReadFile');
    expect(getToolNamesForMode('x', { upgradeLevel: 'reflection' })).not.toContain('SpawnWorker');
    expect(getToolNamesForMode('x', { upgradeLevel: 'substrate' })).toContain('SpawnWorker');
    expect(getToolNamesForMode('x', { upgradeLevel: 'substrate' })).not.toContain('SwarmShareFile');
    expect(getToolNamesForMode('x', { upgradeLevel: 'full' })).toContain('SwarmShareFile');
  });

  it.each(['zero', 'x'])('never advertises host git on %s, including optional levels', mode => {
    for (const upgradeLevel of LAB_UPGRADE_LEVELS) {
      expect(getToolNamesForMode(mode, { upgradeLevel })).not.toContain('git');
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
