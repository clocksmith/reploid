export const normalizeVfsProgress = (progress = {}) => {
  if (!progress || typeof progress !== 'object') return null;
  const total = Number(progress.total || 0);
  const current = Number(progress.current ?? progress.written ?? progress.fetched ?? 0);
  const percent = total > 0
    ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
    : 0;
  return {
    scope: String(progress.scope || 'vfs'),
    phase: String(progress.phase || ''),
    label: String(progress.label || ''),
    total,
    current,
    percent,
    written: Number(progress.written || 0),
    fetched: Number(progress.fetched || 0),
    skipped: Number(progress.skipped || 0),
    timestamp: Number(progress.timestamp || Date.now())
  };
};

export const getCurrentFullSeedProgress = () => typeof window === 'undefined' ? null
  : normalizeVfsProgress(window.REPLOID_VFS_FULL_SEED_PROGRESS || window.REPLOID_VFS_SEED_PROGRESS);

export function createVfsProgressBinding(onProgress) {
  let attached = false;
  const setVfsProgress = value => {
    const progress = normalizeVfsProgress(value);
    if (progress) onProgress(progress);
  };
  const listener = event => setVfsProgress(event.detail);
  const attachVfsProgressListener = () => {
    if (attached || typeof window === 'undefined') return;
    attached = true;
    window.addEventListener('reploid:vfs-seed-progress', listener);
  };
  const dispose = () => {
    if (!attached) return;
    window.removeEventListener('reploid:vfs-seed-progress', listener);
    attached = false;
  };
  return { setVfsProgress, attachVfsProgressListener, dispose };
}
