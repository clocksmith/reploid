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

  beforeEach(async () => {
    document.body.innerHTML = '<main id="root"></main>';
    localStorage.clear();
    root = document.querySelector('#root');
    eventBus = createEventBus();
    ui = ZeroUI.factory({
      Utils: createUtils(),
      EventBus: eventBus,
      AgentLoop: {
        getRecentActivities: vi.fn(() => []),
        hasPendingProviderResume: vi.fn(() => false),
        isRunning: vi.fn(() => true),
        stop: vi.fn()
      },
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

  it('renders the Reploid loop as Model Input, Model Output, Tool Run, and Runtime Event cards', () => {
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
    expect(titles).toContain('Model Output');
    expect(titles).toContain('Tool Run');
    expect(titles).toContain('Runtime Event');
    expect(titles).not.toContain('WriteFile');
    expect(titles).not.toContain('Tool results (1)');

    const contextRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.textContent.includes('TOOL_RESULT (ReadFile)'));
    expect(contextRow.textContent).toContain('New context: 1 messages');
    expect(contextRow.textContent).toContain('/ui/zero/index.js');

    const decisionRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Model Output');
    expect(decisionRow.textContent).toContain('tool request: 1 tool kind');

    const actionRows = [...root.querySelectorAll('.zero-trace-entry')]
      .filter((row) => row.querySelector('.zero-trace-title')?.textContent === 'Tool Run');
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0].textContent).toContain('Ran: WriteFile');
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
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Model Output');
    const actionRow = [...root.querySelectorAll('.zero-trace-entry')]
      .find((row) => row.querySelector('.zero-trace-title')?.textContent === 'Tool Run');

    expect(decisionRow.querySelector('summary').textContent).toBe('tool request: 2 tool kind(s)');
    expect(actionRow.querySelector('summary')).toBeNull();
    expect(actionRow.textContent).toContain('Result: 1 ok / 1 err');
    expect(actionRow.textContent).toContain('First error: Error: Tool module load failed');
    expect(actionRow.textContent).toContain('Ran: CreateTool, LoadModule');
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
});
