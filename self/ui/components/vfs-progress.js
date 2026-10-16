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
