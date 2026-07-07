import { describe, it, expect, vi, beforeEach } from 'vitest';
import ToolExecutorModule from '../../infrastructure/tool-executor.js';

describe('ToolExecutor', () => {
  let toolRunner;
  let toolExecutor;

  beforeEach(() => {
    toolRunner = {
      execute: vi.fn()
    };
    toolExecutor = ToolExecutorModule.factory({
      Utils: {
        logger: {
          warn: vi.fn(),
          error: vi.fn()
        },
        trunc: (value, max) => String(value).slice(0, max)
      },
      ToolRunner: toolRunner
    });
  });

  it('does not retry deterministic tool input errors', async () => {
    toolRunner.execute.mockRejectedValue(new Error('File not found: /artifacts'));

    const result = await toolExecutor.executeWithRetry(
      { name: 'ReadFile', args: { path: '/artifacts' } },
      { maxRetries: 2 }
    );

    expect(toolRunner.execute).toHaveBeenCalledTimes(1);
    expect(result.error?.message).toBe('File not found: /artifacts');
  });

  it('retries retryable tool errors', async () => {
    toolRunner.execute
      .mockRejectedValueOnce(new Error('Transient failure'))
      .mockResolvedValueOnce('ok');

    const result = await toolExecutor.executeWithRetry(
      { name: 'TransientTool', args: {} },
      { maxRetries: 2, retryDelayMs: 1 }
    );

    expect(toolRunner.execute).toHaveBeenCalledTimes(2);
    expect(result.error).toBeNull();
    expect(result.result).toBe('ok');
  });

  it('preserves raw object results alongside display output', async () => {
    const raw = { ok: false, reasons: ['evidence replayPassed must be true'] };
    toolRunner.execute.mockResolvedValue(raw);

    const result = await toolExecutor.executeWithRetry(
      { name: 'Promote', args: {} },
      { maxRetries: 0 }
    );

    expect(result.error).toBeNull();
    expect(result.rawResult).toBe(raw);
    expect(JSON.parse(result.result)).toEqual(raw);
  });

  it('does not retry LoadModule precondition errors', async () => {
    toolRunner.execute.mockRejectedValue(new Error('LoadModule only supports promoted /self paths'));

    const result = await toolExecutor.executeWithRetry(
      { name: 'LoadModule', args: { path: '/shadow/tools/Demo.js' } },
      { maxRetries: 2 }
    );

    expect(toolRunner.execute).toHaveBeenCalledTimes(1);
    expect(result.error?.message).toBe('LoadModule only supports promoted /self paths');
  });
});
