import { describe, expect, it } from 'vitest';

import { renderAwakenedFilesPanel, renderGoalStep } from '../../self/ui/boot-wizard/steps/goal.js';

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

describe('goal step action row', () => {
  it('renders shuffle and awaken together below the goal input', () => {
    const html = renderGoalStep(createReploidState({
      mode: 'zero',
      goal: 'Build live DOM katamari'
    }), {
      goalActionMode: 'generate-only',
      primaryActionHtml: `
        <button class="btn btn-primary btn-op goal-action-button"
                data-op="☇"
                data-action="awaken"
                id="awaken-btn">
          Awaken
        </button>
      `
    });

    const inputIndex = html.indexOf('id="goal-input"');
    const actionRowIndex = html.indexOf('class="goal-primary-action"');
    const shuffleIndex = html.indexOf('data-action="generate-goal"');
    const awakenIndex = html.indexOf('data-action="awaken"');

    expect(actionRowIndex).toBeGreaterThan(inputIndex);
    expect(shuffleIndex).toBeGreaterThan(actionRowIndex);
    expect(awakenIndex).toBeGreaterThan(shuffleIndex);
    expect(html).toContain('data-op="⇄"');
    expect(html).toContain('data-op="☇"');
    expect(html).toContain('goal-action-button');
  });

  it('renders cycle interval control for Zero and X boot goals only', () => {
    const zeroHtml = renderGoalStep(createReploidState({
      mode: 'zero',
      cycleIntervalSeconds: 12
    }), {
      goalActionMode: 'generate-only'
    });
    const xHtml = renderGoalStep(createReploidState({
      mode: 'x',
      cycleIntervalSeconds: 7
    }), {
      goalActionMode: 'generate-only'
    });
    const reploidHtml = renderGoalStep(createReploidState({
      mode: 'reploid',
      cycleIntervalSeconds: 5
    }), {
      goalActionMode: 'generate-only'
    });

    expect(zeroHtml).toContain('id="cycle-interval-seconds"');
    expect(zeroHtml).toContain('value="12"');
    expect(xHtml).toContain('id="cycle-interval-seconds"');
    expect(xHtml).toContain('value="7"');
    expect(reploidHtml).not.toContain('id="cycle-interval-seconds"');
  });
});
