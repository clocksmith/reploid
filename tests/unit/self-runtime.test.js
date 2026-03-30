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

vi.mock('../../self/bridge.js', () => ({
  createSelfBridge: vi.fn(() => mockHost)
}));

import { createSelfRuntime } from '../../self/runtime.js';

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
      '/self/self.json': '{"mode":"reploid","selfPath":"/self/self.json","goal":"Test goal","environment":"Test environment"}'
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

  it('exposes bridge events to the host shell', () => {
    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    const handler = vi.fn();
    const unsubscribe = runtime.on('file-changed', handler);

    expect(mockHost.on).toHaveBeenCalledWith('file-changed', handler);
    expect(typeof unsubscribe).toBe('function');
  });

  it('auto-resumes a parked swarm consumer when a provider appears', async () => {
    mockHost.getModelConfig.mockReturnValue(null);
    mockHost.hasAvailableProvider
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    mockHost.generate.mockResolvedValueOnce({
      raw: 'REPLOID/0\n\nTOOL: ReadFile\npath: /self/self.json'
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
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/self/self.json' });
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
      .mockResolvedValueOnce({ raw: 'REPLOID/0\n\nTOOL: ReadFile\npath: /self/self.json' });

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
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/self/self.json' });
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
      .mockResolvedValueOnce({ raw: 'REPLOID/0\n\nTOOL: ReadFile\npath: /self/self.json' });

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
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/self/self.json' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Milestone recorded: Nested milestone')
      )
    ).toBe(true);
  });

  it('parks on an explicit idle directive', async () => {
    mockHost.generate.mockResolvedValueOnce({ raw: 'IDLE: Waiting for a new task suite' });

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
    });

    await runtime.start();

    const snapshot = latestSnapshot;
    expect(mockHost.seedSystemFiles).toHaveBeenCalledTimes(1);
    expect(mockHost.generate).toHaveBeenCalledTimes(1);
    expect(mockHost.executeTool).not.toHaveBeenCalled();
    expect(snapshot.cycle).toBe(1);
    expect(snapshot.status).toBe('PARKED');
    expect(snapshot.parked).toBe(true);
    expect(
      snapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Wake condition: manual')
      )
    ).toBe(true);
  });

  it('ignores plain text and continues running', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'I built the first piece.' })
      .mockResolvedValueOnce({ raw: 'REPLOID/0\n\nTOOL: ReadFile\npath: /self/runtime.js' });

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
        'REPLOID/0',
        '',
        'TOOL: ReadFile',
        'path: /self/self.json',
        '',
        'TOOL: ReadFile',
        'path: /self/runtime.js',
        '',
        'TOOL: ReadFile',
        'path: /self/manifest.js',
        '',
        'TOOL: ReadFile',
        'path: /self/tools/example.js',
        '',
        'TOOL: ReadFile',
        'path: /self/capsule/index.js',
        '',
        'TOOL: ReadFile',
        'path: /self/bridge.js'
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
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(1, 'ReadFile', { path: '/self/self.json' });
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(5, 'ReadFile', { path: '/self/capsule/index.js' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Tool call limit (5) reached')
      )
    ).toBe(true);
  });

  it('parks repeated milestone-only cycles with no new tool work', async () => {
    mockHost.generate
      .mockResolvedValueOnce({ raw: 'MILESTONE: Standing by.' })
      .mockResolvedValueOnce({ raw: 'MILESTONE: Standing by.' })
      .mockResolvedValueOnce({ raw: 'MILESTONE: Standing by.' });

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

    expect(mockHost.generate).toHaveBeenCalledTimes(3);
    expect(latestSnapshot.status).toBe('PARKED');
    expect(latestSnapshot.parked).toBe(true);
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
        'REPLOID/0',
        '',
        'TOOL: ReadFile',
        'path: /self/self.json',
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
    expect(mockHost.executeTool).toHaveBeenCalledWith('ReadFile', { path: '/self/self.json' });
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
        'REPLOID/0',
        '',
        'TOOL: ReadFile',
        'path: /self/self.json',
        '',
        'TOOL: ReadFile',
        'path: /self/runtime.js'
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
