/* @vitest-environment happy-dom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZeroUI from '../../self/ui/zero/index.js';

const createEventBus = () => {
  const handlers = new Map();
  return {
    on: vi.fn((eventName, handler) => {
      const list = handlers.get(eventName) || [];
      list.push(handler);
      handlers.set(eventName, list);
      return () => {
        handlers.set(eventName, (handlers.get(eventName) || []).filter((item) => item !== handler));
      };
    }),
    emit(eventName, payload) {
      for (const handler of handlers.get(eventName) || []) {
        handler(payload);
      }
    }
  };
};

const createUtils = () => ({
  escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
  trunc(value = '', max = 220) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
});

describe('ZeroUI', () => {
  let root;
  let eventBus;
  let ui;
  let agentLoop;

  beforeEach(async () => {
    document.body.innerHTML = '<main id="root"></main>';
    localStorage.clear();
    root = document.querySelector('#root');
    eventBus = createEventBus();
    agentLoop = {
      getRecentActivities: vi.fn(() => []),
      hasPendingProviderResume: vi.fn(() => false),
      isRunning: vi.fn(() => true),
      stop: vi.fn(),
      exportReplayBundle: vi.fn(async () => ({
        schema: 'reploid.run-replay.v1',
        exportedAt: Date.parse('2026-07-07T00:00:00Z'),
        mode: 'zero',
        route: '/zero',
        goal: 'Build something',
        trace: { schema: 'reploid.run-trace.v1', startedAt: 1000, droppedEvents: 0, provenance: {},
          events: [{ seq: 0, ts: 1000, type: 'model_text', data: { content: 'visible answer' } }] },
        metadata: {
          cycleCount: 1,
          activityCount: 2,
          fileCount: 3
        }
      }))
    };
    ui = ZeroUI.factory({
      Utils: createUtils(),
      EventBus: eventBus,
      AgentLoop: agentLoop,
      StateManager: {
        getState: vi.fn(() => ({ totalCycles: 0 }))
      },
      mode: 'zero'
    });
    await ui.mount(root);
  });

  afterEach(() => {
    ui?.cleanup();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps an expanded trace row open when new rows render above it', () => {
    eventBus.emit('agent:history', {
      type: 'llm_response',
      cycle: 1,
      content: 'First response body'
    });

    const firstDetails = root.querySelector('.zero-trace-details');
    expect(firstDetails).toBeTruthy();
    firstDetails.open = true;

    eventBus.emit('agent:history', {
      type: 'llm_response',
      cycle: 2,
      content: 'Second response body'
    });

    const detailsRows = [...root.querySelectorAll('.zero-trace-details')];
    expect(detailsRows).toHaveLength(2);
    expect(detailsRows[0].open).toBe(false);
    expect(detailsRows[1].open).toBe(true);
    expect(detailsRows[1].textContent).toContain('First response body');
  });

  it('keeps the visible lower trace row anchored when new rows render above it', () => {
    eventBus.emit('agent:history', {
      type: 'llm_response',
      cycle: 1,
      content: 'Older response body'
    });
    eventBus.emit('agent:history', {
      type: 'llm_response',
      cycle: 2,
      content: 'Newer response body'
    });

    const container = root.querySelector('#history-container');
    const olderRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.textContent.includes('Older response body'));
    const olderKey = olderRow.dataset.traceKey;
    container.scrollTop = 25;

    const originalGetRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this === container) {
        return { top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500 };
      }
      if (this.dataset?.traceKey === olderKey) {
        const rowCount = root.querySelectorAll('.zero-trace-entry').length;
        const top = rowCount > 2 ? 260 : 100;
        return { top, bottom: top + 40, left: 0, right: 500, width: 500, height: 40 };
      }
      return { top: -100, bottom: -60, left: 0, right: 500, width: 500, height: 40 };
    };

    try {
      eventBus.emit('agent:history', {
        type: 'llm_response',
        cycle: 3,
        content: 'Newest response body'
      });
    } finally {
      Element.prototype.getBoundingClientRect = originalGetRect;
    }

    expect(container.scrollTop).toBe(185);
  });

  it('renders the Reploid loop as Model Input, Model Response, Tool Run, and Runtime Event cards', () => {
    const firstContext = [
      '## Message 1 / 2 [SYSTEM]\nYou are Zero.',
      '## Message 2 / 2 [USER]\nBegin. Goal: Build.',
      '## Tools offered\n- ReadFile\n- WriteFile'
    ].join('\n\n');
    const secondContext = [
      '## Message 1 / 3 [SYSTEM]\nYou are Zero.',
      '## Message 2 / 3 [USER]\nBegin. Goal: Build.',
      '## Message 3 / 3 [USER]\nTOOL_RESULT (ReadFile):\n/ui/zero/index.js',
      '## Tools offered\n- ReadFile\n- WriteFile'
    ].join('\n\n');

    eventBus.emit('agent:history', {
      type: 'model_request',
      cycle: 1,
      content: firstContext,
      messageCount: 2,
      inputChars: firstContext.length,
      toolNames: ['ReadFile', 'WriteFile']
    });
    eventBus.emit('agent:history', {
      type: 'model_request',
      cycle: 2,
      content: secondContext,
      messageCount: 3,
      inputChars: secondContext.length,
      toolNames: ['ReadFile', 'WriteFile']
    });
    eventBus.emit('agent:history', {
      type: 'llm_response',
      cycle: 2,
      content: 'REPLOID/0\n\nTOOL: WriteFile\npath: /shadow/demo.js',
      latencyMs: 125
    });
    eventBus.emit('agent:tool:start', {
      cycle: 2,
      tool: 'WriteFile'
    });
    eventBus.emit('agent:tool:end', {
      cycle: 2,
      tool: 'WriteFile',
      durationMs: 4,
      success: true
    });
    eventBus.emit('agent:history', {
      type: 'tool_result',
      cycle: 2,
      tool: 'WriteFile',
      args: { path: '/shadow/demo.js' },
      result: '{"path":"/shadow/demo.js","bytesWritten":12}',
      durationMs: 4
    });
    eventBus.emit('agent:history', {
      type: 'tool_batch',
      cycle: 2,
      total: 1,
      errors: 0,
      calls: [{ name: 'WriteFile', args: { path: '/shadow/demo.js' } }],
      results: [{
        name: 'WriteFile',
        args: { path: '/shadow/demo.js' },
        error: null,
        durationMs: 4,
        resultPreview: '{"path":"/shadow/demo.js","bytesWritten":12}'
      }],
      durationMs: 6
    });
    eventBus.emit('agent:history', {
      type: 'cycle_throttle',
      cycle: 2,
      content: 'Waiting 5s before cycle 3',
      throttleDelayMs: 5000
    });

    const titles = [...root.querySelectorAll('.zero-trace-title')].map((item) => item.textContent);
    expect(titles).toContain('Model Input');
    expect(titles).toContain('Model Response');
    expect(titles).toContain('Tool Run');
    expect(titles).toContain('Runtime Event');
    expect(titles).not.toContain('WriteFile');
    expect(titles).not.toContain('Tool results (1)');

    const contextRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.textContent.includes('TOOL_RESULT (ReadFile)'));
    expect(contextRow.textContent).toContain('New context: 1 messages');
    expect(contextRow.textContent).toContain('/ui/zero/index.js');

    const decisionRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Model Response');
    expect(decisionRow.textContent).toContain('requested 1 tool kind');

    const actionRows = [...root.querySelectorAll('.zero-trace-entry')]
      .filter((row) => row.querySelector('.zero-trace-title')?.textContent === 'Tool Run');
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0].textContent).toContain('Requested: WriteFile');
    expect(actionRows[0].textContent).toContain('bytesWritten');
    expect(actionRows[0].textContent.match(/1\. WriteFile/g)).toHaveLength(1);
  });

  it('separates decision summaries from action results and opens failed actions', () => {
    eventBus.emit('agent:history', {
      type: 'llm_response',
      cycle: 4,
      content: 'REPLOID/0\n\nTOOL: CreateTool\nname: DemoTool\n\nTOOL: LoadModule\npath: /self/tools/DemoTool.js',
      latencyMs: 80
    });
    eventBus.emit('agent:history', {
      type: 'tool_batch',
      cycle: 4,
      total: 2,
      errors: 1,
      calls: [
        { name: 'CreateTool', args: { name: 'DemoTool' } },
        { name: 'LoadModule', args: { path: '/self/tools/DemoTool.js' } }
      ],
      results: [
        {
          name: 'CreateTool',
          args: { name: 'DemoTool' },
          error: null,
          resultPreview: '{"activated":true}',
          durationMs: 4
        },
        {
          name: 'LoadModule',
          args: { path: '/self/tools/DemoTool.js' },
          error: 'Error: Tool module load failed',
          resultPreview: 'Error: Tool module load failed',
          durationMs: 20
        }
      ],
      durationMs: 25
    });

    const decisionRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Model Response');
    const actionRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Tool Run');

    expect(decisionRow.querySelector('summary').textContent).toBe('requested 2 tool kind(s)');
    expect(actionRow.querySelector('summary')).toBeNull();
    expect(actionRow.textContent).toContain('Executed: 1 ok / 1 err');
    expect(actionRow.textContent).toContain('First error: Error: Tool module load failed');
    expect(actionRow.textContent).toContain('Requested: CreateTool, LoadModule');
  });

  it('keeps action result details in requested tool order', () => {
    eventBus.emit('agent:history', {
      type: 'tool_batch',
      cycle: 13,
      total: 2,
      errors: 1,
      calls: [
        { name: 'CreateTool', args: { name: 'KatamariEngine' } },
        { name: 'LoadModule', args: { path: '/self/tools/KatamariEngine.js' } }
      ],
      results: [
        {
          name: 'LoadModule',
          args: { path: '/self/tools/KatamariEngine.js' },
          error: 'Error: Tool LoadModule is temporarily disabled.',
          durationMs: 0
        },
        {
          name: 'CreateTool',
          args: { name: 'KatamariEngine' },
          resultPreview: '{"activated":true}',
          durationMs: 23
        },
      ],
      durationMs: 107
    });

    const actionRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Tool Run');
    const text = actionRow.textContent;

    expect(text.indexOf('1. CreateTool ok')).toBeGreaterThan(-1);
    expect(text.indexOf('2. LoadModule error')).toBeGreaterThan(text.indexOf('1. CreateTool ok'));
    expect(text).toContain('First error: Error: Tool LoadModule is temporarily disabled.');
  });

  it('does not render the initial system prompt as a separate trace card', () => {
    const context = [
      '## Message 1 / 2 [SYSTEM]\nYou are Zero.',
      '## Message 2 / 2 [USER]\nBegin. Goal: Build.',
      '## Tools offered\n- ReadFile'
    ].join('\n\n');

    eventBus.emit('agent:history', {
      type: 'system_prompt',
      cycle: 0,
      content: 'You are Zero.\n\n## Runtime Boundary'
    });
    eventBus.emit('agent:history', {
      type: 'model_request',
      cycle: 1,
      content: context,
      messageCount: 2,
      inputChars: context.length,
      toolNames: ['ReadFile']
    });

    const titles = [...root.querySelectorAll('.zero-trace-title')].map((item) => item.textContent);
    expect(titles).toEqual(['Model Input']);
    expect(root.textContent).not.toContain('Initial system prompt');
    expect(root.textContent).toContain('Full envelope: 2 messages');
  });

  it('renders the complete system prompt inside the initial model input details', () => {
    const systemPrompt = [
      'You are Zero.',
      'x'.repeat(700),
      '## BEHAVIORAL FOCUS',
      'Do this goal first. Then improve forever.'
    ].join('\n');
    const context = [
      `## Message 1 / 2 [SYSTEM]\n${systemPrompt}`,
      '## Message 2 / 2 [USER]\nBegin. Goal: Build.',
      '## Tools offered\n- ReadFile'
    ].join('\n\n');

    eventBus.emit('agent:history', {
      type: 'model_request',
      cycle: 1,
      content: context,
      messageCount: 2,
      inputChars: context.length,
      toolNames: ['ReadFile']
    });

    const contextRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Model Input');
    const details = contextRow.querySelector('.zero-trace-body').textContent;

    expect(details).toContain('## BEHAVIORAL FOCUS');
    expect(details).toContain('Do this goal first. Then improve forever.');
    expect(details).not.toContain('continuous improvem...');
  });

  it('uses runtime-emitted context deltas when full model context repeats', () => {
    const fullContext = [
      '## Message 1 / 3 [SYSTEM]\nYou are Zero.',
      '## Message 2 / 3 [USER]\nBegin. Goal: Build.',
      '## Message 3 / 3 [USER]\nTOOL_RESULT (ReadFile):\n/ui/zero/index.js',
      '## Tools offered\n- ReadFile'
    ].join('\n\n');

    eventBus.emit('agent:history', {
      type: 'model_request',
      cycle: 2,
      content: fullContext,
      messageCount: 3,
      inputChars: fullContext.length,
      toolNames: ['ReadFile'],
      contextDeltaMessages: [
        { role: 'user', content: 'TOOL_RESULT (ReadFile):\n/ui/zero/index.js' }
      ],
      contextDeltaCount: 1,
      contextDeltaChars: 41,
      contextDeltaMode: 'delta'
    });

    const contextRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Model Input');
    expect(contextRow.textContent).toContain('New context: 1 messages / 41 chars');
    expect(contextRow.textContent).toContain('/ui/zero/index.js');
    expect(contextRow.textContent).not.toContain('Begin. Goal: Build.');
  });

  it('uses operator-facing state labels', () => {
    eventBus.emit('agent:status', {
      state: 'STARTING',
      activity: 'Initializing'
    });
    expect(root.querySelector('#agent-state').textContent).toBe('Starting');

    eventBus.emit('agent:status', {
      state: 'ACTING',
      activity: 'Executing: WriteFile'
    });
    expect(root.querySelector('#agent-state').textContent).toBe('Running tools');

    eventBus.emit('agent:status', {
      state: 'PARKED',
      activity: 'Provider unavailable'
    });
    expect(root.querySelector('#agent-state').textContent).toBe('Parked');
  });

  it('keeps conversation and controls visible while technical details are collapsed', () => {
    const inspect = root.querySelector('.zero-inspect');
    expect(inspect.open).toBe(false);
    expect(root.querySelector('#history-container').closest('details')).toBe(inspect);
    expect(root.querySelector('#agent-cycle').closest('details')).toBe(inspect);
    expect(root.querySelector('#btn-toggle').closest('details')).toBeNull();
    expect(root.querySelector('[data-zero-preset]')).toBeNull();
    expect(root.querySelector('[data-zero-action="run-epoch"]')).toBeNull();
    expect(root.querySelector('[data-zero-action="export-self-source"]')).toBeTruthy();
    eventBus.emit('agent:history', { type: 'llm_response', content: 'A useful reply.\n```js\nconst verbose = true;\n```' });
    expect(root.querySelector('#zero-conversation').textContent).toContain('A useful reply.');
    expect(root.querySelector('#zero-conversation').textContent).not.toContain('const verbose');
    expect(root.querySelector('#history-container').textContent).toContain('const verbose');
  });

  it('keeps errors and actual pending approval controls outside Inspect', () => {
    eventBus.emit('agent:error', { message: 'Tool failed', error: 'Missing configured gate' });
    expect(root.querySelector('#zero-notices').textContent).toContain('Missing configured gate');
    expect(root.querySelector('#zero-notices').closest('details')).toBeNull();
    const approve = vi.fn();
    eventBus.on('hitl:approve', approve);
    eventBus.emit('hitl:approval-pending', { id: 'approval-one', action: 'CreateTool', data: { name: 'SafeTool' } });
    const button = root.querySelector('[data-zero-action="approve"]');
    expect(button.closest('details')).toBeNull();
    button.click();
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ approvalId: 'approval-one' }));
    eventBus.emit('hitl:approval-granted', { approvalId: 'approval-one' });
    expect(root.querySelector('[data-zero-action="approve"]')).toBeNull();
  });

  it('rehydrates pending approval controls from the controller after UI reload', async () => {
    ui.cleanup();
    const pending = { id: 'still-pending', action: 'Promote', status: 'pending', data: { path: '/self/tool.js' } };
    ui = ZeroUI.factory({ Utils: createUtils(), EventBus: eventBus, AgentLoop: agentLoop,
      HITLController: { getApprovalQueue: () => [pending] }, mode: 'zero' });
    await ui.mount(root);
    expect(root.querySelector('[data-zero-approval="still-pending"]')).toBeTruthy();
    expect(root.querySelector('#zero-approvals').textContent).toContain('Promote');
    expect(root.querySelector('#zero-approvals').closest('details')).toBeNull();
  });

  it('normalizes a legacy external model label and projects authoritative states', () => {
    ui.setModels([{ id: 'external-brain', provider: 'external', name: 'External brain' }]);
    expect(root.querySelector('#agent-model').textContent).toBe('Connected agent');
    for (const state of ['THINKING', 'ACTING', 'RUNNING', 'PAUSED', 'ERROR', 'IDLE', 'UNKNOWN']) {
      eventBus.emit('agent:status', { state });
      expect(root.querySelector('#agent-state').dataset.agentState).toBe(state);
    }
  });

  it('exports a replayable run JSON from Inspect', async () => {
    const urls = [];
    globalThis.URL.createObjectURL = vi.fn((blob) => {
      urls.push(blob);
      return 'blob:run-json';
    });
    globalThis.URL.revokeObjectURL = vi.fn();
    const clicked = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      clicked.push(this.download);
    };

    try {
      root.querySelector('[data-zero-action="export-run-json"]').click();
      await Promise.resolve();
      await Promise.resolve();
      expect(clicked).toEqual([]);
      expect(root.querySelector('[data-replay-preview]').hidden).toBe(false);
      root.querySelector('[data-replay-action="confirm-export"]').click();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }

    expect(agentLoop.exportReplayBundle).toHaveBeenCalledWith({
      route: expect.any(String),
      mode: 'zero'
    });
    expect(clicked[0]).toMatch(/^reploid-zero-run-/);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:run-json');
    expect(root.querySelector('[data-replay-preview]').hidden).toBe(true);
  });

  it('keeps model request and tool result telemetry outside conversation', () => {
    eventBus.emit('agent:history', { type: 'llm_response', cycle: 1, content: 'Useful ordinary reply.' });
    eventBus.emit('agent:history', {
      type: 'model_request', cycle: 2, content: '## Message 1 / 1 [SYSTEM]\nPRIVATE_ENVELOPE',
      messageCount: 1, inputChars: 45
    });
    eventBus.emit('agent:history', { type: 'tool_result', cycle: 2, tool: 'ReadFile', result: 'TOOL_RESULT_MARKER' });
    expect(root.querySelector('#zero-conversation').textContent).toBe('ZeroUseful ordinary reply.');
    expect(root.querySelector('#history-container').textContent).toContain('PRIVATE_ENVELOPE');
    expect(root.querySelector('#history-container').textContent).toContain('TOOL_RESULT_MARKER');
  });

  it('retains conversation through telemetry-only churn', () => {
    eventBus.emit('agent:history', { type: 'llm_response', cycle: 1, content: 'Keep this user-facing reply.' });
    for (let cycle = 2; cycle < 83; cycle++) {
      eventBus.emit('agent:history', { type: 'cycle_throttle', cycle, content: 'Inspect-only telemetry.' });
    }
    expect(root.querySelector('#zero-conversation').textContent).toContain('Keep this user-facing reply.');
  });

  it('keeps unfinished streaming code fences in Inspect', () => {
    eventBus.emit('agent:stream', { cycle: 1, content: 'Helpful prose.\n```js\nconst STREAM_PRIVATE_CODE = true;' });
    expect(root.querySelector('#zero-conversation').textContent).toContain('Helpful prose.');
    expect(root.querySelector('#zero-conversation').textContent).not.toContain('STREAM_PRIVATE_CODE');
    expect(root.querySelector('#history-container').textContent).toContain('STREAM_PRIVATE_CODE');
  });

  it('explicitly places a mixed technical response in Inspect without changing its raw text', () => {
    const raw = 'I will prepare the requested helper.\n\nREPLOID/0\n\nTOOL: CreateTool\nname: Example\ncode <<EOF\nexport default async function() { return "RAW_TOOL_CODE"; }\nEOF';
    eventBus.emit('agent:history', { type: 'llm_response', cycle: 1, content: raw });
    expect(root.querySelector('#zero-conversation').textContent).toContain('Details in Inspect.');
    expect(root.querySelector('#zero-conversation').textContent).not.toMatch(/RAW_TOOL_CODE|TOOL: CreateTool|REPLOID\/0/);
    expect(root.querySelector('.zero-trace-body').textContent).toBe(raw);
  });

  it('keeps complete local human notes in conversation', () => {
    const note = `Keep this exact input.\n${'A'.repeat(240)}\nFINAL_MEANINGFUL_CONSTRAINT`;
    root.querySelector('#zero-human-input').value = note;
    root.querySelector('[data-zero-action="send-note"]').click();
    expect(root.querySelector('.zero-message p').textContent).toBe(note);
  });

  it('rehydrates available conversation independently of the recent telemetry limit', async () => {
    agentLoop.getRecentActivities.mockReturnValue([
      { kind: 'llm_response', cycle: 1, content: 'Retained reply before telemetry.' },
      ...Array.from({ length: 25 }, (_, index) => ({
        kind: 'cycle_throttle', cycle: index + 2, content: 'Inspect-only.'
      }))
    ]);
    ui.cleanup();
    await ui.mount(root);
    expect(root.querySelector('#zero-conversation').textContent).toContain('Retained reply before telemetry.');
  });

  it('replaces streaming text with one final response and preserves ordinary trust prose', () => {
    const raw = 'Proposal status does not establish evaluation or promotion.\nThis is ordinary recorded prose, not telemetry.';
    eventBus.emit('agent:stream', { cycle: 1, content: 'Proposal status' });
    eventBus.emit('agent:history', { type: 'llm_response', cycle: 1, content: raw });
    expect(root.querySelectorAll('.zero-message')).toHaveLength(1);
    expect(root.querySelector('.zero-message p').textContent).toBe(raw);
    expect(root.querySelector('.zero-trace-body').textContent).toBe(raw);
  });

  it('does not classify ordinary inline protocol mentions as technical responses', () => {
    const raw = 'The words REPLOID/0 and TOOL: CreateTool are mentioned in this sentence.\nNo request is made.';
    eventBus.emit('agent:history', { type: 'llm_response', cycle: 1, content: raw });
    expect(root.querySelector('.zero-message p').textContent).toBe(raw);
  });

  it('preserves prose surrounding closed code fences and retains the raw response', () => {
    const raw = 'Before code.\n```js\nconst hidden = true;\n```\nAfter code.';
    eventBus.emit('agent:history', { type: 'llm_response', cycle: 1, content: raw });
    expect(root.querySelector('.zero-message p').textContent).toBe('Before code.\n[Code in Inspect]\nAfter code.');
    expect(root.querySelector('.zero-trace-body').textContent).toBe(raw);
  });

  it('keeps retained technical response disclosures backed by exact raw Inspect text after telemetry churn', () => {
    const raw = 'Useful context.\nREPLOID/0\nTOOL: CreateTool\ncode <<EOF\nconst retainedRaw = true;\nEOF';
    eventBus.emit('agent:history', { type: 'llm_response', cycle: 1, content: raw });
    for (let cycle = 2; cycle < 83; cycle++) {
      eventBus.emit('agent:history', { type: 'cycle_throttle', cycle, content: 'Inspect-only telemetry.' });
    }
    expect(root.querySelector('#zero-conversation').textContent).toContain('Details in Inspect.');
    const rows = [...root.querySelectorAll('.zero-trace-entry')];
    expect(rows.filter(row => row.querySelector('.zero-trace-body')?.textContent === raw)).toHaveLength(1);
    expect(rows.length).toBeLessThanOrEqual(160);
  });
});
