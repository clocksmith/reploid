import { describe, expect, it } from 'vitest';

import {
  getToolNamesForMode,
  ZERO_SEED_TOOLS
} from '../../self/config/tool-surfaces.js';
import { listReploidEnvironmentTemplates } from '../../self/config/reploid-environments.js';

describe('tool surfaces', () => {
  it('keeps Zero at the CreateTool-only seed surface', () => {
    const zeroTools = getToolNamesForMode('zero', {
      hasToolWriter: true,
      hasSubstrateLoader: false
    });

    expect(zeroTools).toEqual(['CreateTool']);
  });

  it('keeps Promote available to broader runtime surfaces', () => {
    expect(getToolNamesForMode('reploid', {
      hasToolWriter: true,
      hasSubstrateLoader: true
    })).toContain('Promote');
    expect(getToolNamesForMode('x', {
      hasToolWriter: true,
      hasSubstrateLoader: true
    })).toContain('Promote');
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
