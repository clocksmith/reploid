import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHost = {
  initialize: vi.fn(),
  seedSystemFiles: vi.fn(),
  readBootstrapFiles: vi.fn(),
  writeRuntimeArtifact: vi.fn(),
  getAnchorObservations: vi.fn(),
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
    mockHost.readBootstrapFiles.mockReset();
    mockHost.writeRuntimeArtifact.mockReset();
    mockHost.getAnchorObservations.mockReset();
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
    mockHost.readBootstrapFiles.mockResolvedValue({
      '/self/blueprint-index.json': '{"activeBlueprints":["tabula-rasa-runtime"]}',
      '/self/prompts/kernel.md': 'Kernel prompt',
      '/self/blueprints/tabula-rasa-runtime.md': 'Tabula rasa runtime contract',
      '/self/blueprints/blueprint-index-contract.md': 'Blueprint index contract',
      '/self/blueprints/tool-contract.md': 'Tool contract',
      '/self/blueprints/promotion-contract.md': 'Promotion contract'
    });
    mockHost.executeTool.mockResolvedValue({ ok: true });
    mockHost.writeRuntimeArtifact.mockResolvedValue({ path: '/artifacts/rgr/test.json', written: true });
    mockHost.getAnchorObservations.mockResolvedValue([]);
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

  it('parks immediately in remote-slot mode when no local executor exists', async () => {
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
    expect(latestSnapshot.activity).toContain('Waiting for remote host slot');
    expect(latestSnapshot.rgr).toMatchObject({
      mode: 'shadow',
      topology: 'peer-assisted',
      role: 'consumer',
      gate: { state: 'blocked', anchors: 0, required: 3 },
      counters: { candidates: 0, toolCalls: 0, errors: 0, archive: 0 }
    });
    expect(latestSnapshot.rgr.slots).toHaveLength(7);
    expect(latestSnapshot.rgr.slots[0]).toMatchObject({
      id: 'elite',
      placement: 'remote',
      state: 'blocked'
    });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('No local host is configured')
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

  it('seeds kernel prompt and tabula-rasa blueprints into bootstrap context', async () => {
    mockHost.generate.mockResolvedValueOnce({ raw: 'IDLE: context seeded' });

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    await runtime.start();

    const snapshot = runtime.getSnapshot();
    expect(mockHost.readBootstrapFiles).toHaveBeenCalledWith([
      '/self/blueprint-index.json',
      '/self/prompts/kernel.md',
      '/self/blueprints/tabula-rasa-runtime.md',
      '/self/blueprints/blueprint-index-contract.md',
      '/self/blueprints/tool-contract.md',
      '/self/blueprints/promotion-contract.md'
    ]);
    expect(snapshot.renderedText).toContain('/self/blueprint-index.json');
    expect(snapshot.renderedText).toContain('/self/prompts/kernel.md');
    expect(snapshot.renderedText).toContain('Kernel prompt');
    expect(snapshot.renderedText).toContain('/self/blueprints/tabula-rasa-runtime.md');
    expect(snapshot.renderedText).toContain('Tabula rasa runtime contract');
    expect(snapshot.renderedText).toContain('/self/blueprints/blueprint-index-contract.md');
    expect(snapshot.renderedText).toContain('Blueprint index contract');
    expect(snapshot.renderedText).toContain('/self/blueprints/tool-contract.md');
    expect(snapshot.renderedText).toContain('/self/blueprints/promotion-contract.md');
    expect(snapshot.renderedText).not.toContain('Dream');
    expect(snapshot.rgr.instances).toEqual([]);
  });

  it('parks retryable provider quota errors instead of failing the run', async () => {
    mockHost.generate.mockRejectedValueOnce(new Error(
      'Gemini API Error: quota exceeded for generate_content_free_tier_requests. Please retry in 29.326s.'
    ));

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    await runtime.start();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.status).toBe('PARKED');
    expect(snapshot.parked).toBe(true);
    expect(snapshot.wakeOn).toBe('generation-retry');
    expect(snapshot.display.runState).toBe('WAITING');
    expect(snapshot.display.policy).toBe('auto-resume after provider retry');
    expect(snapshot.activity).toContain('Provider quota or rate limit');
    expect(snapshot.renderedText).toContain('Generation paused by provider quota or rate limit.');
    expect(snapshot.renderedText).not.toContain('[SYSTEM ERROR]');

    runtime.stop();
  });

  it('auto-resumes a parked remote slot when a peer host appears', async () => {
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
          message.content.includes('Remote host slot discovered. Resuming generation')
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

  it('caps large tool observations before feeding them back into context', async () => {
    const largeContent = `${'x'.repeat(5000)}TAIL`;
    mockHost.generate.mockResolvedValueOnce({
      raw: 'REPLOID/0\n\nTOOL: ReadFile\npath: /self/runtime.js'
    });
    mockHost.executeTool.mockResolvedValueOnce({
      path: '/self/runtime.js',
      backend: 'vfs',
      encoding: 'utf-8',
      content: largeContent,
      bytes: largeContent.length
    });

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

    const toolMessage = latestSnapshot.context.find((message) => message.origin === 'tool');
    expect(toolMessage.content).toContain('"path": "/self/runtime.js"');
    expect(toolMessage.content).toContain('"bytes": 5004');
    expect(toolMessage.content).toContain('[truncated ');
    expect(toolMessage.content).not.toContain('TAIL');
    expect(toolMessage.content.length).toBeLessThan(4300);
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
      const sawToolBatch = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL BATCH RESULT]')
      );
      if (sawToolBatch) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.generate).toHaveBeenCalledTimes(1);
    expect(mockHost.executeTool).toHaveBeenCalledTimes(5);
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(1, 'ReadFile', { path: '/self/self.json' });
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(5, 'ReadFile', { path: '/self/capsule/index.js' });
    expect(mockHost.writeRuntimeArtifact).toHaveBeenCalledWith(
      expect.stringMatching(/^\/artifacts\/rgr\/rgr-shadow-1-[a-f0-9]+\.json$/),
      expect.stringContaining('"state": "shadow"')
    );
    const toolMessages = latestSnapshot.context.filter((message) => message.origin === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toContain('[TOOL BATCH RESULT]');
    expect(toolMessages[0].content).toContain('mode: parallel-read');
    expect(toolMessages[0].content).toContain('count: 5');
    expect(toolMessages[0].content.match(/\[TOOL ReadFile RESULT\]/g)).toHaveLength(5);
    expect(latestSnapshot.rgr.archive.count).toBe(1);
    expect(latestSnapshot.rgr.archive.latest).toMatchObject({
      state: 'shadow',
      kind: 'read-evidence',
      scheduler: { mode: 'parallel-read', parallelGroups: 1 },
      gate: { state: 'pending-anchors' },
      anchor: { required: 3, qAnchor: 0 },
      validator: { state: 'quarantined', selfApprovalAllowed: false }
    });
    expect(latestSnapshot.rgr.archive.latest.score).toMatchObject({
      qAnchor: 0
    });
    expect(latestSnapshot.rgr.receipts.latestPath).toMatch(/^\/artifacts\/rgr\/rgr-shadow-1-[a-f0-9]+\.json$/);
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Tool call limit (5) reached')
      )
    ).toBe(true);
  });

  it('counts only bridge-verified anchor observations toward qAnchor', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: [
        'REPLOID/0',
        '',
        'TOOL: ReadFile',
        'path: /self/self.json'
      ].join('\n')
    });
    mockHost.getAnchorObservations.mockResolvedValue([
      {
        id: 'anchor-a',
        receiptId: 'receipt-a',
        provider: 'peer:anchor-a',
        jobHash: 'rgr-anchor:test',
        verified: true
      },
      {
        id: 'anchor-b',
        receiptId: 'receipt-b',
        provider: 'peer:anchor-b',
        jobHash: 'rgr-anchor:test',
        verified: true
      },
      {
        id: 'candidate-written',
        receiptId: 'fake',
        provider: 'self',
        verified: false
      }
    ]);

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

    expect(mockHost.getAnchorObservations).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: expect.stringMatching(/^rgr-shadow-1-[a-f0-9]+$/),
      digest: expect.stringMatching(/^[a-f0-9]+$/)
    }));
    expect(latestSnapshot.rgr.archive.latest.anchor.observations).toHaveLength(2);
    expect(latestSnapshot.rgr.archive.latest.score.qAnchor).toBe(0.667);
    expect(latestSnapshot.rgr.gate).toMatchObject({
      state: 'pending-anchors',
      anchors: 2,
      required: 3
    });
  });

  it('replay-scores archived candidates when anchor observations arrive later', async () => {
    mockHost.generate
      .mockResolvedValueOnce({
        raw: [
          'REPLOID/0',
          '',
          'TOOL: ReadFile',
          'path: /self/self.json'
        ].join('\n')
      })
      .mockResolvedValueOnce({ raw: 'IDLE: anchor replay checked' });
    mockHost.getAnchorObservations
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'anchor-a', receiptId: 'receipt-a', provider: 'peer:a', verified: true },
        { id: 'anchor-b', receiptId: 'receipt-b', provider: 'peer:b', verified: true },
        { id: 'anchor-c', receiptId: 'receipt-c', provider: 'peer:c', verified: true }
      ]);

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
    });

    await runtime.start();

    expect(latestSnapshot.rgr.archive.latest.score.qAnchor).toBe(1);
    expect(latestSnapshot.rgr.archive.latest.gate.state).toBe('passed');
    expect(latestSnapshot.rgr.archive.latest.promotion.allowed).toBe(true);
    expect(latestSnapshot.rgr.gate).toMatchObject({
      state: 'passed',
      anchors: 3,
      required: 3
    });
  });

  it('starts adjacent read-only tools through one scheduler group', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: [
        'REPLOID/0',
        '',
        'TOOL: ReadFile',
        'path: /self/a.js',
        '',
        'TOOL: ReadFile',
        'path: /self/b.js'
      ].join('\n')
    });

    const startedPaths = [];
    const pendingResolvers = [];
    let releaseImmediately = false;
    mockHost.executeTool.mockImplementation((name, args) => new Promise((resolve) => {
      startedPaths.push(args.path);
      const finish = () => resolve({ path: args.path, ok: true });
      if (releaseImmediately) {
        finish();
      } else {
        pendingResolvers.push(finish);
      }
    }));

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolBatch = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL BATCH RESULT]')
      );
      if (sawToolBatch) {
        runtime.stop();
      }
    });

    const startPromise = runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sawBothReadCallsBeforeRelease = startedPaths.join('|') === '/self/a.js|/self/b.js';
    releaseImmediately = true;
    pendingResolvers.splice(0).forEach((resolve) => resolve());
    await startPromise;

    expect(sawBothReadCallsBeforeRelease).toBe(true);
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(1, 'ReadFile', { path: '/self/a.js' });
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(2, 'ReadFile', { path: '/self/b.js' });
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'tool' &&
          message.content.includes('[TOOL BATCH RESULT]') &&
          message.content.includes('mode: parallel-read')
      )
    ).toBe(true);
  });

  it('keeps mutation tools as barriers between read groups', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: [
        'REPLOID/0',
        '',
        'TOOL: ReadFile',
        'path: /self/a.js',
        '',
        'TOOL: WriteFile',
        'path: /self/b.js',
        'content: updated',
        '',
        'TOOL: ReadFile',
        'path: /self/c.js'
      ].join('\n')
    });
    mockHost.executeTool.mockImplementation((name, args) => Promise.resolve({
      name,
      path: args.path,
      ok: true
    }));

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolBatch = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL BATCH RESULT]')
      );
      if (sawToolBatch) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.executeTool).toHaveBeenCalledTimes(3);
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(1, 'ReadFile', { path: '/self/a.js' });
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(2, 'WriteFile', {
      path: '/self/b.js',
      content: 'updated'
    });
    expect(mockHost.executeTool).toHaveBeenNthCalledWith(3, 'ReadFile', { path: '/self/c.js' });
    const toolMessages = latestSnapshot.context.filter((message) => message.origin === 'tool');
    expect(toolMessages).toHaveLength(1);
    const receipt = toolMessages[0].content;
    expect(receipt).toContain('[TOOL BATCH RESULT]');
    expect(receipt).toContain('mode: scheduled');
    expect(receipt.indexOf('/self/a.js')).toBeLessThan(receipt.indexOf('/self/b.js'));
    expect(receipt.indexOf('/self/b.js')).toBeLessThan(receipt.indexOf('/self/c.js'));
    expect(latestSnapshot.rgr.archive.latest).toMatchObject({
      kind: 'self-candidate',
      scheduler: { mode: 'scheduled' },
      gate: { state: 'pending-anchors' }
    });
  });

  it('honors PLAN after dependencies before running dependent tools', async () => {
    mockHost.generate.mockResolvedValueOnce({
      raw: [
        'REPLOID/0',
        '',
        'PLAN:',
        '[',
        '  {',
        '    "id": "a",',
        '    "tool": "ReadFile",',
        '    "args": { "path": "/self/a.js" }',
        '  },',
        '  {',
        '    "id": "b",',
        '    "tool": "ReadFile",',
        '    "args": { "path": "/self/b.js" }',
        '  },',
        '  {',
        '    "id": "c",',
        '    "after": ["a", "b"],',
        '    "tool": "WriteFile",',
        '    "args": { "path": "/artifacts/out.txt", "content": "ok" }',
        '  }',
        ']'
      ].join('\n')
    });

    const events = [];
    const pendingResolvers = [];
    mockHost.executeTool.mockImplementation((name, args) => {
      events.push(`start:${name}:${args.path}`);
      if (name === 'ReadFile') {
        return new Promise((resolve) => {
          pendingResolvers.push(() => {
            events.push(`finish:${name}:${args.path}`);
            resolve({ path: args.path, ok: true });
          });
        });
      }

      events.push(`finish:${name}:${args.path}`);
      return Promise.resolve({ path: args.path, ok: true });
    });

    const runtime = createSelfRuntime({
      goal: 'Test goal',
      environment: 'Test environment'
    });

    let latestSnapshot = runtime.getSnapshot();
    runtime.subscribe((snapshot) => {
      latestSnapshot = snapshot;
      const sawToolBatch = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL BATCH RESULT]')
      );
      if (sawToolBatch) {
        runtime.stop();
      }
    });

    const startPromise = runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual([
      'start:ReadFile:/self/a.js',
      'start:ReadFile:/self/b.js'
    ]);

    pendingResolvers.splice(0).forEach((resolve) => resolve());
    await startPromise;

    expect(events).toEqual([
      'start:ReadFile:/self/a.js',
      'start:ReadFile:/self/b.js',
      'finish:ReadFile:/self/a.js',
      'finish:ReadFile:/self/b.js',
      'start:WriteFile:/artifacts/out.txt',
      'finish:WriteFile:/artifacts/out.txt'
    ]);
    const toolMessages = latestSnapshot.context.filter((message) => message.origin === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toContain('[TOOL BATCH RESULT]');
    expect(toolMessages[0].content).toContain('mode: scheduled');
    expect(toolMessages[0].content).toContain('a:ReadFile, b:ReadFile, c:WriteFile');
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
      const sawToolBatch = snapshot.context.some(
        (message) => message.origin === 'tool' && message.content.includes('[TOOL BATCH RESULT]')
      );
      if (sawToolBatch) {
        runtime.stop();
      }
    });

    await runtime.start();

    expect(mockHost.executeTool).toHaveBeenCalledTimes(2);
    const toolMessages = latestSnapshot.context.filter((message) => message.origin === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toContain('[TOOL BATCH RESULT]');
    expect(
      latestSnapshot.context.some(
        (message) =>
          message.origin === 'system' &&
          message.content.includes('Milestone recorded')
      )
    ).toBe(false);
  });
});
