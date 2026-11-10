/** Doppler reports GPU pipeline preparation before a resident is ready. Hosts show it as
 * contribution progress; the contribution phase stays theirs. `outstanding` means a started
 * compilation still owns the stage, so nothing it holds is released yet. Other events are ignored. */
const STATUSES = Object.freeze(['preparing', 'prepared', 'cancelling', 'cancelled', 'timed-out', 'failed']);

const message = ({ status, prepared, total, outstanding }) => {
  if (status === 'cancelling') return 'Stopping after the current GPU pipeline finishes compiling';
  if (status === 'cancelled') return `Stopped preparing GPU pipelines: ${prepared} of ${total}`;
  if (status === 'timed-out') return outstanding
    ? 'Preparation time limit reached; waiting for the current GPU pipeline to finish compiling'
    : `Preparation time limit reached: ${prepared} of ${total} GPU pipelines`;
  if (status === 'failed') return `GPU pipeline preparation failed: ${prepared} of ${total}`;
  return `Preparing GPU pipelines: ${prepared} of ${total}`;
};

export function residentPreparationProgress(event) {
  if (event?.phase !== 'pipelines' || !STATUSES.includes(event.status)) return null;
  const { status, prepared, total, key, elapsedMs, startedAt, maxDurationMs, outstanding } = event;
  if (![prepared, total].every(value => Number.isSafeInteger(value) && value >= 0) || prepared > total
    || typeof outstanding !== 'boolean' || !Number.isFinite(elapsedMs)) return null;
  return Object.freeze({ stage: 'preparing', status, prepared, total, key: typeof key === 'string' ? key : null,
    elapsedMs, startedAt: Number.isFinite(startedAt) ? startedAt : null,
    maxDurationMs: Number.isSafeInteger(maxDurationMs) ? maxDurationMs : null, outstanding,
    message: message({ status, prepared, total, outstanding }) });
}
