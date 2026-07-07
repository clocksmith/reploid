/**
 * @fileoverview Unit tests for LoadModule tool.
 */

import { describe, it, expect, vi } from 'vitest';
import call from '../../../self/tools/LoadModule.js';

describe('LoadModule', () => {
  it('reports a leading pipe literal marker before calling ToolRunner', async () => {
    const ToolRunner = {
      loadPath: vi.fn().mockResolvedValue(true)
    };
    const VFS = {
      read: vi.fn().mockResolvedValue(`|
export const tool = {
  call: async () => ({ ok: true })
};
export default tool;`)
    };

    await expect(call({
      path: '/self/tools/KatamariEngine.js'
    }, {
      VFS,
      ToolRunner
    })).rejects.toThrow('leading pipe literal marker');

    expect(ToolRunner.loadPath).not.toHaveBeenCalled();
  });
});
