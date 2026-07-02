import { beforeEach, describe, expect, it, vi } from 'vitest';

import TelemetryTimeline from '../../self/infrastructure/telemetry-timeline.js';

describe('TelemetryTimeline', () => {
  let mockUtils;
  let mockVFS;
  let mockEventBus;
  let telemetry;

  beforeEach(() => {
    let id = 0;
    mockUtils = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      },
      generateId: vi.fn((prefix = 'evt') => `${prefix}_${++id}`)
    };
    mockVFS = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockResolvedValue(''),
      write: vi.fn().mockResolvedValue(true)
    };
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn()
    };
    telemetry = TelemetryTimeline.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      EventBus: mockEventBus
    });
  });

  it('batches burst records into one timeline file write', async () => {
    await telemetry.record('agent:status', { state: 'THINKING' });
    await telemetry.record('tool:error', { tool: 'ReadFile' }, { severity: 'error' });

    expect(mockVFS.write).not.toHaveBeenCalled();

    await telemetry.flush();

    expect(mockVFS.exists).toHaveBeenCalledTimes(1);
    expect(mockVFS.write).toHaveBeenCalledTimes(1);
    const [path, content] = mockVFS.write.mock.calls[0];
    expect(path).toMatch(/^\/.logs\/timeline\/\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(content.trim().split('\n')).toHaveLength(2);
    expect(content).toContain('"type":"agent:status"');
    expect(content).toContain('"type":"tool:error"');
    expect(mockEventBus.emit).toHaveBeenCalledTimes(2);
  });
});
