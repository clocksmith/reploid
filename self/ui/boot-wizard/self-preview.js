/**
 * @fileoverview Shared self-source preview loader for boot UIs.
 */

import { getState, setNestedState } from './state.js';
import { SELF_SOURCE_MIRRORS } from '../../manifest.js';

const VFS_BYPASS_HEADER = 'x-reploid-vfs-bypass';

const fetchPreviewSourceText = async (webPath) => {
  const response = await fetch(webPath, {
    cache: 'no-store',
    headers: {
      [VFS_BYPASS_HEADER]: '1'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to load preview source: ${webPath} (${response.status})`);
  }
  return response.text();
};

const loadMirrorContents = async (mirrors) => {
  const entries = await Promise.all(
    mirrors.map(async ({ webPath, vfsPath }) => [vfsPath, await fetchPreviewSourceText(webPath)])
  );
  return Object.fromEntries(entries);
};

export async function ensureSelfPreviewLoaded() {
  const current = getState().selfPreview || {};
  const needSelf = !current.loadedSelf && !current.loadingSelf;

  if (!needSelf) return;

  setNestedState('selfPreview', {
    loadingSelf: current.loadingSelf || needSelf,
    error: null
  });

  try {
    const nextContents = { ...(getState().selfPreview?.contents || {}) };
    if (needSelf) {
      Object.assign(nextContents, await loadMirrorContents(SELF_SOURCE_MIRRORS));
    }

    setNestedState('selfPreview', {
      contents: nextContents,
      loadingSelf: false,
      loadedSelf: current.loadedSelf || needSelf,
      loadingBootstrapper: false,
      loadedBootstrapper: false,
      error: null
    });
  } catch (err) {
    setNestedState('selfPreview', {
      loadingSelf: false,
      loadingBootstrapper: false,
      error: err?.message || 'Failed to load Reploid file previews'
    });
  }
}

export default {
  ensureSelfPreviewLoaded
};
