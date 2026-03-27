import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHost = {
  seedSystemFiles: vi.fn(),
  generate: vi.fn(),
  executeTool: vi.fn(),
  getModelLabel: vi.fn()
};

vi.mock('../../src/capsule/host.js', () => ({
  createCapsuleHost: vi.fn(() => mockHost)
}));

import { createCapsuleRuntime } from '../../src/capsule/runtime.js';

describe('Capsule Runtime', () => {
  beforeEach(() => {
    mockHost.seedSystemFiles.mockReset();
    mockHost.generate.mockReset();
    mockHost.executeTool.mockReset();
    mockHost.getModelLabel.mockReset();

    mockHost.seedSystemFiles.mockResolvedValue({
      '/.system/goal.txt': 'Test goal',
      '/.system/environment.txt': 'Test environment',
      '/.system/self.json': '{"mode":"absolute_zero"}'
    });
    mockHost.executeTool.mockResolvedValue({ ok: true });
    mockHost.getModelLabel.mockReturnValue('test-model');
  });

  it('records done as a milestone and continues running', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: '{"done":true,"reason":"First milestone"}' })
      .mockResolvedValueOnce({ raw: '{"tool":"ReadFile","args":{"path":"/.system/self.json"}}' });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolResult = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL ReadFile RESULT]')
      );
      if (sawToolResult) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(2);
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/.system/self.json' });
    expect(latestSnapshot.cycle).toBe(2);
    expect(latestSnapshot.status).toBe('IDLE');
    expect(latestSnapshot.activity).toBe('Stopped by user');
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Milestone recorded: First milestone')
      )
    ).toBe(true);
  });

  it('accepts a nested done object and records it as a milestone', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: '{"done":{"done":true,"reason":"Nested milestone"}}' })
      .mockResolvedValueOnce({ raw: '{"tool":"ReadFile","args":{"path":"/.system/self.json"}}' });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolResult = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL ReadFile RESULT]')
      );
      if (sawToolResult) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(2);
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/.system/self.json' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Milestone recorded: Nested milestone')
      )
    ).toBe(true);
  });

  it('redirects an explicit idle directive into self-improvement work', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: '{"idle":true,"reason":"Waiting for a new task suite","wakeOn":"manual"}' })
      .mockResolvedValueOnce({ raw: '{"tool":"ReadFile","args":{"path":"/.system/self.json"}}' });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolResult = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL ReadFile RESULT]')
      );
      if (sawToolResult && snapshot.running) {
        runtime.stop();
      }
    });

    await runtime.start();

    const snapshot = latestSnapshot;
    expect(mockHost.seedSystemFiles).toHaveBeenCalledTimes(1);
    expect(mockHost.generate).toHaveBeenCalledTimes(2);
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/.system/self.json' });
    expect(snapshot.cycle).toBe(2);
    expect(snapshot.status).toBe('IDLE');
    expect(snapshot.parked).toBe(false);
    expect(
      snapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Continue with safe self-improvement work')
      )
    ).toBe(true);
  });

  it('ignores plain text and continues running', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'I built the first piece.' })
      .mockResolvedValueOnce({ raw: '{"tool":"ReadFile","args":{"path":"/.system/goal.txt"}}' });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolResult = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL ReadFile RESULT]')
      );
      if (sawToolResult) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(2);
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/.system/goal.txt' });
    expect(latestSnapshot.cycle).toBe(2);
    expect(latestSnapshot.status).toBe('IDLE');
    expect(latestSnapshot.activity).toBe('Stopped by user');
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Ignored non-directive model response')
      )
    ).toBe(true);
  });

  it('executes batched tool calls and caps the batch at five', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: JSON.stringify({
        tools: [
          { tool: 'ReadFile', args: { path: '/.system/goal.txt' } },
          { tool: 'ReadFile', args: { path: '/.system/environment.txt' } },
          { tool: 'ReadFile', args: { path: '/.system/self.json' } },
          { tool: 'ReadFile', args: { path: '/kernel/runtime.js' } },
          { tool: 'ReadFile', args: { path: '/kernel/contract.js' } },
          { tool: 'ReadFile', args: { path: '/tools/example.js' } }
        ]
      })
    });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const toolMessages = snapshot.context.filter((message) => message.origin === 'tool');
      if (toolMessages.length >= 5) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(1);
    expect(mockHost.executeTool).toHaveBeenCalledTimes(5);
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(1, 'ReadFile', { path: '/.system/goal.txt' });
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(5, 'ReadFile', { path: '/kernel/contract.js' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Tool call limit (5) reached')
      )
    ).toBe(true);
  });

  it('redirects repeated milestone-only cycles into self-improvement work', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: '{"done":true,"reason":"Standing by."}' })
      .mockResolvedValueOnce({ raw: '{"done":true,"reason":"Standing by."}' })
      .mockResolvedValueOnce({ raw: '{"done":true,"reason":"Standing by."}' })
      .mockResolvedValueOnce({ raw: '{"tool":"ReadFile","args":{"path":"/.system/goal.txt"}}' });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolResult = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL ReadFile RESULT]')
      );
      if (sawToolResult) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(4);
    expect(latestSnapshot.status).toBe('IDLE');
    expect(latestSnapshot.parked).toBe(false);
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Repeated milestone-only cycles detected with no new tool work')
      )
    ).toBe(true);
  });

  it('records a milestone when tools and done are sent in the same response', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: JSON.stringify({
        tools: [
          { tool: 'ReadFile', args: { path: '/.system/goal.txt' } }
        ],
        done: {
          done: true,
          reason: 'Completed the first evaluation pass'
        }
      })
    });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawMilestone = snapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Milestone recorded: Completed the first evaluation pass')
      );
      if (sawMilestone) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(1);
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/.system/goal.txt' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Milestone recorded: Completed the first evaluation pass')
      )
    ).toBe(true);
  });

  it('does not record a milestone for a plain tool batch with no done directive', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: JSON.stringify({
        tools: [
          { tool: 'ReadFile', args: { path: '/.system/goal.txt' } },
          { tool: 'ReadFile', args: { path: '/.system/environment.txt' } }
        ]
      })
    });

    const runtime = createCapsuleRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const toolMessages = snapshot.context.filter((message) => message.origin === 'tool');
      if (toolMessages.length >= 2) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.executeTool).toHaveBeenCalledTimes(2);
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'host' &&
          message.content.includes('Milestone recorded')
      )
    ).toBe(false);
  });
});
