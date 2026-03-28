import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHost = {
  initialize: vi.fn(),
  seedSystemFiles: vi.fn(),
  generate: vi.fn(),
  executeTool: vi.fn(),
  getModelConfig: vi.fn(),
  getModelLabel: vi.fn(),
  on: vi.fn(),
  hasAvailableProvider: vi.fn(),
  getSwarmSnapshot: vi.fn()
};

vi.mock('../../src/self/bridge.js', () => ({
  createSelfBridge: vi.fn(() => mockHost)
}));

import { createSelfRuntime } from '../../src/self/runtime.js';

describe('Self Runtime', () => {
  const bridgeEventHandlers = new Map();

  beforeEach(() => {
    bridgeEventHandlers.clear();
    mockHost.initialize.mockReset();
    mockHost.seedSystemFiles.mockReset();
    mockHost.generate.mockReset();
    mockHost.executeTool.mockReset();
    mockHost.getModelConfig.mockReset();
    mockHost.getModelLabel.mockReset();
    mockHost.on.mockReset();
    mockHost.hasAvailableProvider.mockReset();
    mockHost.getSwarmSnapshot.mockReset();

    mockHost.initialize.mockResolvedValue(null);
    mockHost.seedSystemFiles.mockResolvedValue({
      '/.system/self.json': '{"mode":"reploid","selfPath":"/.system/self.json","goal":"Test goal","environment":"Test environment"}'
    });
    mockHost.executeTool.mockResolvedValue({ ok: true });
    mockHost.getModelConfig.mockReturnValue({ id: 'test-model' });
    mockHost.getModelLabel.mockReturnValue('test-model');
    mockHost.hasAvailableProvider.mockReturnValue(false);
    mockHost.on.mockImplementation((event, handler) => {
      bridgeEventHandlers.set(event, handler);
      return () => bridgeEventHandlers.delete(event);
    });
    mockHost.getSwarmSnapshot.mockReturnValue({
      enabled: false,
      role: 'solo',
      peerCount: 0,
      providerCount: 0,
      transport: null,
      connectionState: 'disconnected'
    });
  });

  it('parks immediately in swarm consumer mode when no local inference exists', async () => {
    mockHost.getModelConfig.mockReturnValue(null);

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment',
      swarmEnabled: true
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
    });

    await runtime.start();

    expect(mockHost.seedSystemFiles).toHaveBeenCalledTimes(1);
    expect(mockHost.generate).not.toHaveBeenCalled();
    expect(latestSnapshot.parked).toBe(true);
    expect(latestSnapshot.status).toBe('PARKED');
    expect(latestSnapshot.activity).toContain('Waiting for swarm provider');
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('No local inference is configured')
      )
    ).toBe(true);
  });

  it('auto-resumes a parked swarm consumer when a provider appears', async () => {
    mockHost.getModelConfig.mockReturnValue(null);
    mockHost.hasAvailableProvider
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    mockHost.generate.mockResolvedValueOnce({
      raw: 'TOOL_CALL: ReadFile\nARGS: { "path": "/.system/self.json" }'
    });

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment',
      swarmEnabled: true
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
    expect(latestSnapshot.parked).toBe(true);

    await bridgeEventHandlers.get('provider-ready')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockHost.generate).toHaveBeenCalledTimes(1);
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/.system/self.json' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Swarm provider discovered. Resuming remote generation')
      )
    ).toBe(true);
  });

  it('records done as a milestone and continues running', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'MILESTONE: First milestone' })
      .mockResolvedValueOnce({ raw: 'TOOL_CALL: ReadFile\nARGS: { "path": "/.system/self.json" }' });

    const runtime = createSelfRuntime({
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
          message.origin === 'system' &&
          message.content.includes('Milestone recorded: First milestone')
      )
    ).toBe(true);
  });

  it('accepts DONE as a milestone alias and records it', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'DONE: Nested milestone' })
      .mockResolvedValueOnce({ raw: 'TOOL_CALL: ReadFile\nARGS: { "path": "/.system/self.json" }' });

    const runtime = createSelfRuntime({
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
          message.origin === 'system' &&
          message.content.includes('Milestone recorded: Nested milestone')
      )
    ).toBe(true);
  });

  it('redirects an explicit idle directive into self-improvement work', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'IDLE: Waiting for a new task suite' })
      .mockResolvedValueOnce({ raw: 'TOOL_CALL: ReadFile\nARGS: { "path": "/.system/self.json" }' });

    const runtime = createSelfRuntime({
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
          message.origin === 'system' &&
          message.content.includes('Continue with safe self-improvement work')
      )
    ).toBe(true);
  });

  it('ignores plain text and continues running', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'I built the first piece.' })
      .mockResolvedValueOnce({ raw: 'TOOL_CALL: ReadFile\nARGS: { "path": "/self/runtime.js" }' });

    const runtime = createSelfRuntime({
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
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/self/runtime.js' });
    expect(latestSnapshot.cycle).toBe(2);
    expect(latestSnapshot.status).toBe('IDLE');
    expect(latestSnapshot.activity).toBe('Stopped by user');
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Ignored non-directive model response')
      )
    ).toBe(true);
  });

  it('executes batched tool calls and caps the batch at five', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: [
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/.system/self.json" }',
        '',
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/self/runtime.js" }',
        '',
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/self/manifest.js" }',
        '',
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/tools/example.js" }',
        '',
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/bootstrapper/self/bridge.js" }',
        '',
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/bootstrapper/core/llm-client.js" }'
      ].join('\n')
    });

    const runtime = createSelfRuntime({
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
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(1, 'ReadFile', { path: '/.system/self.json' });
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(5, 'ReadFile', { path: '/bootstrapper/self/bridge.js' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Tool call limit (5) reached')
      )
    ).toBe(true);
  });

  it('redirects repeated milestone-only cycles into self-improvement work', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'MILESTONE: Standing by.' })
      .mockResolvedValueOnce({ raw: 'MILESTONE: Standing by.' })
      .mockResolvedValueOnce({ raw: 'MILESTONE: Standing by.' })
      .mockResolvedValueOnce({ raw: 'TOOL_CALL: ReadFile\nARGS: { "path": "/self/runtime.js" }' });

    const runtime = createSelfRuntime({
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
          message.origin === 'system' &&
          message.content.includes('Repeated milestone-only cycles detected with no new tool work')
      )
    ).toBe(true);
  });

  it('records a milestone when tools and done are sent in the same response', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: [
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/.system/self.json" }',
        '',
        'MILESTONE: Completed the first evaluation pass'
      ].join('\n')
    });

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawMilestone = snapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Milestone recorded: Completed the first evaluation pass')
      );
      if (sawMilestone) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(1);
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/.system/self.json' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Milestone recorded: Completed the first evaluation pass')
      )
    ).toBe(true);
  });

  it('does not record a milestone for a plain tool batch with no done directive', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: [
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/.system/self.json" }',
        '',
        'TOOL_CALL: ReadFile',
        'ARGS: { "path": "/self/runtime.js" }'
      ].join('\n')
    });

    const runtime = createSelfRuntime({
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
          message.origin === 'system' &&
          message.content.includes('Milestone recorded')
      )
    ).toBe(false);
  });
});
