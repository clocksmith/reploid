/**
 * @fileoverview Unit tests for ToolWriter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sha256 } from '../../self/core/promotion-policy.js';
import ToolWriterModule from '../../core/tool-writer.js';

describe('ToolWriter', () => {
  let toolWriter;
  let mockVFS;

  beforeEach(() => {
    mockVFS = {
      write: vi.fn().mockResolvedValue(true),
      read: vi.fn(async () => mockVFS.write.mock.calls.at(-1)[1])
    };
    const ValidationError = class extends Error {
      constructor(message) {
        super(message);
        this.name = 'ValidationError';
      }
    };
    toolWriter = ToolWriterModule.factory({
      VFS: mockVFS,
      VerificationManager: { verifyProposal: vi.fn(async files => ({
        passed: true, skipped: false,
        verification: { kind: 'static-worker', fileHashes: Object.fromEntries(await Promise.all(
          Object.entries(files).map(async ([path, code]) => [path, await sha256(code)])
        )) }
      })) },
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
