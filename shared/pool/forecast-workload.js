import { validateExecutablePack } from './executable-pack.js';

export const FORECAST_WORKLOAD = 'timeseries.forecast.v1';
export const FORECAST_EXECUTION_MODE = 'complete_forecast';
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

/** A consumer supplies its qualified catalog pin; this does not enable a public catalog row. */
export function validateForecastModelContract(model = {}) {
  const reasons = [];
  if (model.workload !== FORECAST_WORKLOAD || model.executionMode !== FORECAST_EXECUTION_MODE ||
      model.runtime !== 'doppler' || model.backend !== 'browser-webgpu') reasons.push('forecast runtime/workload mismatch');
  if (!model.modelId || !digest(model.modelHash) || !digest(model.manifestHash) ||
      model.modelHash !== model.executablePack?.semanticRoot || model.manifestHash !== model.executablePack?.envelopeDigest) reasons.push('forecast model identity mismatch');
  if (model.executablePack?.requiredOperation !== 'forecast') reasons.push('public forecast Pack operation required');
  reasons.push(...validateExecutablePack(model.executablePack).reasons);
  const forecast = model.forecast;
  if (!forecast || !Number.isSafeInteger(forecast.contextLength) || forecast.contextLength < 8 || forecast.contextLength > 2048 ||
      !Number.isInteger(forecast.maxHorizon) || forecast.maxHorizon < 1 || forecast.maxHorizon > 64 ||
      !Array.isArray(forecast.quantiles) || !forecast.quantiles.includes(0.5) || forecast.quantiles.length > 19 ||
      forecast.quantiles.some((q, i) => !Number.isFinite(q) || q <= 0 || q >= 1 || (i > 0 && q <= forecast.quantiles[i - 1])) ||
      !digest(forecast.applicationDigest) || !digest(forecast.contractDigest)) reasons.push('invalid forecast geometry/application pin');
  if (['distributedExecution', 'executionTopology', 'modelSplit', 'modelPartitions', 'partitionPlan', 'splitPlan', 'kvShardPlan', 'attentionShardPlan']
    .some(field => Object.hasOwn(model, field))) reasons.push('forecast jobs require complete-model execution');
  return { ok: !reasons.length, reasons };
}

export function isForecastPoolModel(model = {}) {
  return model.workload === FORECAST_WORKLOAD && validateForecastModelContract(model).ok;
}

export function validateForecastCosts(costs) {
  if (!costs || ['durationMs', 'preparationMs', 'inputBytes', 'modelBytes', 'outputBytes', 'retries', 'replicas', 'verificationMs']
    .some(key => typeof costs[key] !== 'number' || !Number.isFinite(costs[key]) || costs[key] < 0)) throw new Error('Invalid forecast execution costs');
  for (const key of ['inputBytes', 'modelBytes', 'outputBytes', 'retries', 'replicas']) {
    if (!Number.isSafeInteger(costs[key])) throw new Error('Fractional forecast byte/count measurement');
  }
  if (costs.replicas < 1 || ['relayBytes', 'energyJoules'].some(key => costs[key] !== null &&
    (typeof costs[key] !== 'number' || !Number.isFinite(costs[key]) || costs[key] < 0))) throw new Error('Missing or invalid optional cost measurement');
}

export function validateForecastValues(output, { horizon, quantiles }) {
  if (!output || !Array.isArray(output.point) || output.point.length !== horizon ||
      !Array.isArray(output.timestamps) || output.timestamps.length !== horizon ||
      !Array.isArray(output.quantiles) || output.quantiles.length !== horizon) throw new Error('Wrong forecast output shape');
  for (let i = 0; i < horizon; i++) {
    const row = output.quantiles[i];
    if (typeof output.timestamps[i] !== 'string' || !Number.isFinite(Date.parse(output.timestamps[i])) ||
        (i > 0 && Date.parse(output.timestamps[i]) <= Date.parse(output.timestamps[i - 1])) ||
        !Number.isFinite(output.point[i]) || !Array.isArray(row) || row.length !== quantiles.length ||
        row.some((value, index) => !Number.isFinite(value) || (index > 0 && value < row[index - 1])) ||
        row[quantiles.indexOf(0.5)] !== output.point[i]) throw new Error('Invalid forecast values, intervals or chronology');
  }
}
