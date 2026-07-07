import { describe, expect, it } from 'vitest';

import { getToolNamesForMode } from '../../self/config/tool-surfaces.js';

describe('tool surfaces', () => {
  it('keeps Promote out of the Zero tool surface', () => {
    const zeroTools = getToolNamesForMode('zero', {
      hasToolWriter: true,
      hasSubstrateLoader: true
    });

    expect(zeroTools).toContain('CreateTool');
    expect(zeroTools).toContain('LoadModule');
    expect(zeroTools).not.toContain('Promote');
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
});
