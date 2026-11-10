/**
 * @fileoverview Display text shared by the route controls: error messages with their next action,
 * and device labels.
 */

export const errorString = (error) => String(error?.message || error?.error || error || 'Unknown error');

export const displayPoolError = (error, {
  title = 'Request failed',
  action = 'Check the details below, then try the operation again.',
  context = {}
} = {}) => ({
  status: 'error',
  error: title,
  reason: errorString(error),
  code: error?.code || error?.payload?.code || null,
  retryable: error?.retryable ?? error?.payload?.retryable ?? null,
  action: error?.payload?.action || error?.action || action,
  transportDiagnostics: error?.diagnostics || error?.payload?.diagnostics || null,
  ...context,
  payload: error?.payload || null
});

export const formatDeviceLabel = (deviceInfo = {}) => {
  const adapter = deviceInfo.adapterInfo || {};
  return [
    adapter.vendor,
    adapter.architecture,
    adapter.device
  ].filter(Boolean).join(' / ') || deviceInfo.probeStatus || 'unknown';
};
