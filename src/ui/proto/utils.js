/**
 * Proto Utils - Formatting and utility functions
 */

export const formatDuration = (ms = 0) => {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

export const formatTimestamp = (ts) => {
  if (!ts) return '--:--:--';
  try {
    return new Date(ts).toLocaleTimeString([], { hour12: false });
  } catch {
    return '--:--:--';
  }
};

export const formatSince = (ts) => {
  if (!ts) return '—';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSeconds < 1) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
};

export const summarizeText = (text, max = 160) => {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
};

export const formatPayloadSummary = (payload) => {
  if (!payload) return '';
  try {
    const json = JSON.stringify(payload, null, 2);
    const limit = 500;
    return json.length > limit ? `${json.slice(0, limit)}…` : json;
  } catch {
    return String(payload);
  }
};
