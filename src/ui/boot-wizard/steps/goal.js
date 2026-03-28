/**
 * @fileoverview Goal selection step renderer
 */

import { findGoalMeta, getGoalEntries } from '../goals.js';
import {
  BOOTSTRAPPER_SOURCE_MIRRORS,
  SELF_SOURCE_MIRRORS,
  buildSelfFiles,
  listSelfSeedPaths
} from '../../../self/manifest.js';
import { listReploidEnvironmentTemplates } from '../../../config/reploid-environments.js';
import { getReploidLaunchState } from '../reploid-inference.js';

const DEFAULT_SELF_PATH = '/.system/self.json';
const SELF_WRITABLE_ROOTS = Object.freeze([
  '/.system',
  '/self',
  '/capsule',
  '/tools',
  '/.memory',
  '/artifacts'
]);
const GOAL_LEVEL_ORDER = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4']);

const escapeText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const escapeAttr = (value) => escapeText(value).replace(/'/g, '&#39;');

const buildGoalTags = (goal) => {
  const tags = Array.isArray(goal.tags) ? goal.tags : [];
  return Array.from(new Set(tags)).slice(0, 5);
};

const getGoalLevelKey = (category) => {
  const match = String(category || '').match(/(L[0-4])/i);
  return match ? match[1].toUpperCase() : String(category || '');
};

const sortGoalEntriesByLevel = (entries) => [...entries].sort((left, right) => {
  const leftIndex = GOAL_LEVEL_ORDER.indexOf(getGoalLevelKey(left[0]));
  const rightIndex = GOAL_LEVEL_ORDER.indexOf(getGoalLevelKey(right[0]));
  const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
  return String(left[0] || '').localeCompare(String(right[0] || ''));
});

const renderRootSummary = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  return entries.map(({ root, count }) => `
    <span class="boot-root-chip">${escapeText(`${root} ${count}`)}</span>
  `).join('');
};

const buildPathTree = (filePaths, directoryPaths = []) => {
  const root = {
    type: 'dir',
    name: '/',
    path: '/',
    children: new Map()
  };

  const ensureDir = (path) => {
    if (!path || path === '/') return root;
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
    let node = root;
    let currentPath = '';
    parts.forEach((part) => {
      currentPath += `/${part}`;
      if (!node.children.has(part)) {
        node.children.set(part, {
          type: 'dir',
          name: part,
          path: currentPath,
          children: new Map()
        });
      }
      node = node.children.get(part);
    });
    return node;
  };

  directoryPaths.forEach((dirPath) => ensureDir(dirPath));

  filePaths.forEach((filePath) => {
    const cleanPath = String(filePath || '').trim();
    if (!cleanPath) return;
    const parts = cleanPath.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) return;
    const filename = parts.pop();
    const dirPath = parts.length ? `/${parts.join('/')}` : '/';
    const parent = ensureDir(dirPath);
    parent.children.set(filename, {
      type: 'file',
      name: filename,
      path: cleanPath
    });
  });

  const sortChildren = (node) => Array.from(node.children.values())
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
    .map((child) => child.type === 'dir'
      ? {
          ...child,
          children: sortChildren(child)
        }
      : child);

  return sortChildren(root);
};

const renderTreeNodes = (nodes, activePath, depth = 0) => nodes.map((node) => {
  const selected = node.path === activePath ? ' selected' : '';
  const label = `${node.name}${node.type === 'dir' ? '/' : ''}`;
  const children = node.type === 'dir'
    ? `<div class="seed-tree-children">${renderTreeNodes(node.children || [], activePath, depth + 1)}</div>`
    : '';

  return `
    <div class="seed-tree-node seed-tree-node-${node.type}">
      <button class="seed-tree-item${selected}"
              type="button"
              data-action="select-self-path"
              data-path="${escapeAttr(node.path)}"
              data-depth="${depth}"
              aria-pressed="${selected ? 'true' : 'false'}">
        <span class="seed-tree-label">${escapeText(label)}</span>
      </button>
      ${children}
    </div>
  `;
}).join('');

const listImmediateChildren = (dirPath, allPaths) => {
  const cleanDir = dirPath === '/' ? '/' : dirPath.replace(/\/+$/, '');
  const prefix = cleanDir === '/' ? '/' : `${cleanDir}/`;
  const depth = cleanDir === '/' ? 0 : cleanDir.split('/').filter(Boolean).length;

  return allPaths
    .filter((path) => path !== cleanDir && path.startsWith(prefix))
    .filter((path) => path.split('/').filter(Boolean).length === depth + 1)
    .sort();
};

const hasConfiguredInference = (state) => {
  if (state.mode === 'reploid' && state.routeLockedMode === 'reploid') {
    return getReploidLaunchState(state).hasInference;
  }

  if (state.connectionType === 'proxy') {
    return !!(state.proxyConfig?.url && state.proxyConfig?.model);
  }

  if (state.connectionType === 'direct') {
    return !!(state.directConfig?.provider && state.directConfig?.apiKey && state.directConfig?.model);
  }

  if (state.connectionType === 'browser') {
    return !!state.dopplerConfig?.model;
  }

  return false;
};

const buildSelfBrowserData = (state) => {
  const systemFiles = buildSelfFiles({
    goal: state.goal || '',
    environment: state.environment || '',
    includeBootstrapperWithinSelf: !!state.includeBootstrapperWithinSelf,
    swarmEnabled: !!state.swarmEnabled,
    hasInference: hasConfiguredInference(state)
  });
  const mirrorPaths = [
    ...SELF_SOURCE_MIRRORS.map(({ vfsPath }) => vfsPath),
    ...(state.includeBootstrapperWithinSelf
      ? BOOTSTRAPPER_SOURCE_MIRRORS.map(({ vfsPath }) => vfsPath)
      : [])
  ];
  const filePaths = [
    ...Object.keys(systemFiles),
    ...mirrorPaths
  ].sort();
  const directoryPaths = [
    ...SELF_WRITABLE_ROOTS,
    ...(state.includeBootstrapperWithinSelf ? ['/bootstrapper'] : [])
  ];
  const allPaths = Array.from(new Set([...filePaths, ...directoryPaths])).sort();
  const treeNodes = buildPathTree(filePaths, directoryPaths);
  const activePath = allPaths.includes(state.selectedSelfPath)
    ? state.selectedSelfPath
    : DEFAULT_SELF_PATH;
  const preview = state.selfPreview || {};
  const fileContents = {
    ...systemFiles,
    ...(preview.contents || {})
  };
  const children = listImmediateChildren(activePath, allPaths);
  const isDirectory = !filePaths.includes(activePath);

  let summary = 'Directory';
  let source = 'Live self root';
  let content = '';

  if (activePath in systemFiles) {
    summary = 'Generated file';
    source = 'Generated at awaken as the live self manifest.';
    content = systemFiles[activePath];
  } else if (activePath.startsWith('/self/') || activePath.startsWith('/capsule/')) {
    summary = 'Mirrored source';
    source = 'Mirrored from the Reploid self source.';
    content = fileContents[activePath] || (preview.loadingSelf ? '(Loading preview...)' : '(Preview unavailable)');
  } else if (activePath.startsWith('/bootstrapper/')) {
    summary = 'Mirrored source';
    source = 'Mirrored from bootstrapper source because "Include bootstrapper within self" is enabled.';
    content = fileContents[activePath] || (preview.loadingBootstrapper ? '(Loading preview...)' : '(Preview unavailable)');
  } else if (activePath === '/.system') {
    source = 'Writable root for the live self manifest and any future system metadata.';
  } else if (activePath === '/self') {
    source = 'Writable root for the awakened self runtime, bridge, tool runner, and mirrored implementation modules.';
  } else if (activePath === '/capsule') {
    source = 'Writable root for the Capsule shell UI.';
  } else if (activePath === '/tools') {
    source = 'Writable root for dynamically created tools.';
  } else if (activePath === '/.memory') {
    source = 'Writable root for durable memories and lightweight state.';
  } else if (activePath === '/artifacts') {
    source = 'Writable root for generated outputs and artifacts.';
  } else if (isDirectory) {
    source = 'Contract-visible directory.';
  }

  if (isDirectory) {
    content = children.length > 0 ? children.join('\n') : '(empty by default)';
  }

  return {
    treeNodes,
    activePath,
    summary,
    source,
    content,
    previewError: preview.error || '',
    previewLoading: preview.loadingSelf || preview.loadingBootstrapper
  };
};

/**
 * Render GOAL step
 */
export function renderGoalStep(state, options = {}) {
  const levelsDocUrl = 'https://github.com/clocksmith/reploid/blob/main/docs/RSI-LEVELS.md';
  const hideBootInternals = options.hideBootInternals === true;
  const shuffleSeed = Number(state.goalShuffleSeed) || 0;
  const entries = sortGoalEntriesByLevel(getGoalEntries(shuffleSeed));
  const goalValue = state.goal || '';
  const environmentValue = state.environment || '';
  const environmentTemplates = listReploidEnvironmentTemplates();
  const selectedEnvironmentTemplate = state.selectedEnvironmentTemplate || '';
  const generatorStatus = state.goalGenerator?.status || 'idle';
  const generatorError = state.goalGenerator?.error || null;
  const generating = generatorStatus === 'generating';
  const showReploidEnvironment = state.mode === 'reploid';
  const bootPayload = state.bootPayload || {};
  const showExpandedReploidInternals = showReploidEnvironment && !hideBootInternals;
  const explorer = showExpandedReploidInternals ? buildSelfBrowserData(state) : null;
  const awakenedSeedPaths = showReploidEnvironment
    ? listSelfSeedPaths({
        includeBootstrapperWithinSelf: !!state.includeBootstrapperWithinSelf,
        swarmEnabled: !!state.swarmEnabled,
        hasInference: hasConfiguredInference(state)
      }).filter((path) => !path.startsWith('/bootstrapper/'))
    : [];
  const goalTitle = options.title || (showReploidEnvironment ? 'Compose self' : 'Set the first objective');
  const goalCaption = options.caption || (showReploidEnvironment
    ? 'Reploid starts from a minimal live self. Access windows, identity, runtime, tool runner, bridge, and Capsule shell stay explicit and editable.'
    : 'Set the first objective the Reploid should pursue.');
  const currentGoalMeta = findGoalMeta(goalValue);
  const fallbackCategory = entries[0]?.[0] || '';
  const selectedGoalCategory = entries.some(([category]) => category === state.selectedGoalCategory)
    ? state.selectedGoalCategory
    : (entries.some(([category]) => category === currentGoalMeta?.category) ? currentGoalMeta.category : fallbackCategory);
  const selectedGoalEntry = entries.find(([category]) => category === selectedGoalCategory) || entries[0] || ['', []];
  const selectedGoalLevel = getGoalLevelKey(selectedGoalEntry[0]);
  const selectedGoals = Array.isArray(selectedGoalEntry[1]) ? selectedGoalEntry[1] : [];

  return `
    <div class="wizard-step wizard-goal">
      <div class="goal-header">
        <h2 class="type-h1">${goalTitle}</h2>
        <p class="type-caption">${goalCaption}</p>
      </div>

      <div class="goal-compose-grid">
        <div class="goal-compose-main">
          <div class="custom-goal goal-editor-block">
            <div class="goal-editor-header">
              <label class="type-label" for="goal-input">Goal</label>
              <div class="goal-editor-toolbar">
                <div class="goal-level-rail" role="list" aria-label="Runtime preset levels">
                  ${entries.map(([category]) => {
                    const levelKey = getGoalLevelKey(category);
                    const isSelected = category === selectedGoalCategory;
                    return `
                      <button class="btn btn-ghost goal-level-btn${isSelected ? ' selected' : ''}"
                              type="button"
                              data-action="toggle-goal-category"
                              data-category="${escapeAttr(category)}"
                              aria-pressed="${isSelected ? 'true' : 'false'}"
                              title="${escapeAttr(category)}">
                        ${escapeText(levelKey)}
                      </button>
                    `;
                  }).join('')}
                </div>
                <div class="goal-preset-actions">
                  <button class="btn btn-ghost"
                          data-action="shuffle-goals"
                          type="button">
                    Shuffle
                  </button>
                  <button class="btn btn-prism"
                          data-action="generate-goal"
                          type="button"
                          ${generating ? 'disabled' : ''}>
                    ${generating ? 'Creating...' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
            <details class="goal-level-dropdown goal-level-dropdown-inline" data-category="${escapeAttr(selectedGoalCategory)}"${state.goalPresetsOpen ? ' open' : ''}>
              <summary class="goal-level-dropdown-header">
                <div>
                  <div class="type-label">${escapeText(selectedGoalEntry[0])}</div>
                  <div class="type-caption">${escapeText(`${selectedGoals.length} preset${selectedGoals.length === 1 ? '' : 's'} available`)}</div>
                </div>
                <a class="link-secondary type-caption" href="${levelsDocUrl}" target="_blank" rel="noopener">Read the L0-L4 level guide</a>
              </summary>
              <div class="goal-level-dropdown-list" data-category="${escapeAttr(selectedGoalCategory)}">
                ${selectedGoals.map((goal) => {
                  const goalText = goal.text || goal.view || '';
                  const viewText = goal.view || goalText;
                  const tags = buildGoalTags(goal)
                    .map((tag) => `<span class="goal-tag">${escapeText(tag)}</span>`)
                    .join('');
                  const locked = goal.locked ? 'locked' : '';
                  const isSelected = goalText === goalValue;
                  const selected = isSelected ? 'selected' : '';

                  return `
                    <button class="goal-chip ${locked} ${selected}"
                            data-action="select-goal"
                            data-goal="${escapeAttr(goalText)}"
                            title="${escapeAttr(goalText)}"
                            aria-pressed="${isSelected ? 'true' : 'false'}"
                            ${goal.locked ? 'disabled' : ''}>
                      <div class="goal-chip-header">
                        <div class="goal-chip-level-row">
                          <span class="goal-level-pill">${escapeText(selectedGoalLevel)}</span>
                          <span class="goal-view">${escapeText(viewText)}</span>
                        </div>
                        ${tags ? `<span class="goal-flags">${tags}</span>` : ''}
                      </div>
                      <div class="goal-prompt">${escapeText(goalText)}</div>
                    </button>
                  `;
                }).join('')}
              </div>
            </details>
            <textarea id="goal-input"
                      class="goal-input"
                      maxlength="500"
                      rows="3"
                      placeholder="Describe the first task or trajectory to pursue.">${escapeText(goalValue)}</textarea>
            ${(generatorError || generatorStatus === 'ready') ? `
              <div class="goal-toolbar-status type-caption">
                ${generatorError ? `Error: ${escapeText(generatorError)}` : 'Objective drafted by Reploid'}
              </div>
            ` : ''}
          </div>

          ${showExpandedReploidInternals ? `
            <div class="custom-goal environment-block">
              <div class="environment-header">
                <label class="type-label" for="environment-input">Environment</label>
                <div class="environment-template-rail" role="list" aria-label="Reploid environment templates">
                  ${environmentTemplates.map((template) => `
                    <button class="btn btn-ghost environment-template-btn${template.id === selectedEnvironmentTemplate ? ' selected' : ''}"
                            type="button"
                            data-action="apply-environment-template"
                            data-template="${escapeAttr(template.id)}"
                            aria-pressed="${template.id === selectedEnvironmentTemplate ? 'true' : 'false'}"
                            title="${escapeAttr(`${template.label} ${template.title}`)}">
                      ${escapeText(template.label)}
                    </button>
                  `).join('')}
                </div>
              </div>
              <textarea id="environment-input"
                        class="goal-input environment-input"
                        maxlength="4000"
                        rows="8"
                        placeholder="Describe the verified substrate, writable roots, and capability constraints.">${escapeText(environmentValue)}</textarea>
              <label class="checkbox-label environment-toggle">
                <input type="checkbox"
                       id="include-bootstrapper-within-self"
                       ${state.includeBootstrapperWithinSelf ? 'checked' : ''} />
                <span>Include bootstrapper within self</span>
              </label>
              <div class="type-caption environment-caption">
                Mirror bootstrapper source into <code>/bootstrapper</code> so the Reploid can inspect and edit the code that awakens it.
              </div>
            </div>
          ` : ''}

        </div>
      </div>

      ${showReploidEnvironment && hideBootInternals ? `
        <aside class="panel seed-browser-panel">
          <div class="seed-browser-header">
            <div>
              <h3 class="type-h2">Awakened files</h3>
              <p class="type-caption">Primary Reploid seeds these files into VFS at awaken time.</p>
            </div>
          </div>
          <div class="seed-browser-shell">
            <div class="seed-viewer-panel">
              <div class="seed-viewer-header">
                <div>
                  <div class="type-label">Seeded into VFS</div>
                  <div class="type-caption">These are the initial self files. Tool execution, identity, and collaboration policy live under <code>/self</code>, and the Capsule shell lives under <code>/capsule</code>.</div>
                </div>
                <span class="advanced-pill">Minimal</span>
              </div>
              <pre class="seed-file-viewer">${escapeText(awakenedSeedPaths.join('\n'))}</pre>
            </div>
          </div>
        </aside>
      ` : ''}

      ${showExpandedReploidInternals ? `
        <aside class="panel seed-browser-panel">
          <div class="seed-browser-header">
            <div>
              <h3 class="type-h2">Live self</h3>
              <p class="type-caption">Files the awakened Reploid starts with as self and writable substrate.</p>
            </div>
          </div>
          ${explorer.previewError ? `
            <div class="type-caption">☒ ${escapeText(explorer.previewError)}</div>
          ` : ''}
          <div class="seed-browser-shell">
            <div class="seed-tree-panel">
              ${renderTreeNodes(explorer.treeNodes, explorer.activePath)}
            </div>
            <div class="seed-viewer-panel">
              <div class="seed-viewer-header">
                <div>
                  <div class="type-label">${escapeText(explorer.activePath)}</div>
                  <div class="type-caption">${escapeText(explorer.source)}</div>
                </div>
                <span class="advanced-pill">${escapeText(explorer.summary)}</span>
              </div>
              <pre class="seed-file-viewer">${escapeText(explorer.content)}</pre>
              ${explorer.previewLoading ? `
                <div class="type-caption seed-viewer-status">Loading mirrored source previews...</div>
              ` : ''}
            </div>
          </div>
        </aside>
      ` : ''}

      ${showExpandedReploidInternals ? `
        <details class="panel boot-debug-panel">
          <summary class="boot-manifest-summary">Bootstrapper internals: ${bootPayload.bootFiles?.length || 0} preload / ${bootPayload.manifestFiles?.length || 0} manifest</summary>
          ${bootPayload.loading ? `
            <div class="type-caption">Loading bootstrapper manifest...</div>
          ` : bootPayload.error ? `
            <div class="type-caption">☒ ${escapeText(bootPayload.error)}</div>
          ` : `
            <div class="boot-payload-block">
              <div class="boot-payload-block-header">
                <span class="type-label">Preloaded before UI boot</span>
                <span class="type-caption">${bootPayload.bootFiles?.length || 0} files</span>
              </div>
              <pre class="boot-file-tree">${escapeText(bootPayload.bootTree || '')}</pre>
            </div>
            <div class="boot-root-summary">
              ${renderRootSummary(bootPayload.rootSummary)}
            </div>
            <details class="boot-manifest-details">
              <summary class="boot-manifest-summary">Full app VFS manifest: ${bootPayload.manifestFiles?.length || 0} files</summary>
              <pre class="boot-file-tree boot-file-tree-full">${escapeText((bootPayload.manifestFiles || []).join('\n'))}</pre>
            </details>
          `}
        </details>
      ` : ''}
    </div>
  `;
}
