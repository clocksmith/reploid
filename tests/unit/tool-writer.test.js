/**
 * @fileoverview Unit tests for ToolWriter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import ToolWriterModule from '../../core/tool-writer.js';

describe('ToolWriter', () => {
  let toolWriter;
  let mockVFS;

  beforeEach(() => {
    mockVFS = {
      write: vi.fn().mockResolvedValue(true)
    };
    const ValidationError = class extends Error {
      constructor(message) {
        super(message);
        this.name = 'ValidationError';
      }
    };
    toolWriter = ToolWriterModule.factory({
      VFS: mockVFS,
      Utils: {
        logger: {
          info: vi.fn()
        },
        Errors: {
          ValidationError
        }
      }
    });
  });

  it('strips a leading pipe literal marker before staging tool code', async () => {
    const code = `|
export const tool = {
  name: 'KatamariEngine',
  description: 'Collect DOM elements.',
  inputSchema: { type: 'object', properties: {} },
  call: async () => ({ ok: true })
};
export default tool;`;

    await toolWriter.create('KatamariEngine', code);

    expect(mockVFS.write).toHaveBeenCalledWith(
      '/shadow/tools/KatamariEngine.js',
      expect.stringContaining('export const tool')
    );
    const stagedCode = mockVFS.write.mock.calls[0][1];
    expect(stagedCode.trimStart().startsWith('|')).toBe(false);
  });
});
