import { describe, expect, it } from 'vitest';

import { renderAwakenedFilesPanel } from '../../src/ui/boot-wizard/steps/goal.js';

const createReploidState = (overrides = {}) => ({
  mode: 'reploid',
  routeLockedMode: null,
  connectionType: 'direct',
  directConfig: {
    provider: 'openai',
    apiKey: 'test-key',
    model: 'gpt-5'
  },
  proxyConfig: {
    url: null,
    model: null
  },
  dopplerConfig: {
    model: null
  },
  goal: 'Inspect the boot source',
  environment: 'Browser-hosted runtime',
  swarmEnabled: false,
  selectedSelfPath: '/self/runtime.js',
  selfPreview: {
    loadingSelf: false,
    loadedSelf: true,
    loadingBootstrapper: false,
    loadedBootstrapper: false,
    error: null,
    contents: {
      '/self/runtime.js': 'export const runtime = true;'
    }
  },
  ...overrides
});

describe('goal step awakened files panel', () => {
  it('renders an inspectable source browser when requested', () => {
    const html = renderAwakenedFilesPanel(createReploidState(), {
      showSourceBrowser: true,
      defaultOpen: true
    });

    expect(html).toContain('Inspect the exact files and source Reploid exposes as the awakened self at awaken time.');
    expect(html).toContain('seed-tree-panel');
    expect(html).toContain('data-action="select-self-path"');
    expect(html).toContain('/self/runtime.js');
    expect(html).toContain('export const runtime = true;');
    expect(html).toContain('data-action="start-seed-edit"');
    expect(html).toContain('Read-only source preview. Edit to stage a boot override for awaken.');
    expect(html).toContain('<details class="panel seed-browser-panel seed-browser-panel-collapsed" open>');
  });

  it('keeps the collapsed path list as the default variant', () => {
    const html = renderAwakenedFilesPanel(createReploidState());

    expect(html).toContain('Primary Reploid exposes these files as the awakened self at awaken time.');
    expect(html).toContain('/self/runtime.js');
    expect(html).toContain('/self/capsule/index.js');
    expect(html).not.toContain('seed-tree-panel');
  });
});
