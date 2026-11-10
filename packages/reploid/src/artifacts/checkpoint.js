import { snapshotJson, hashConfiguration } from '../config/index.js';
import { sha256Hex } from './signatures.js';

const digest = (value, cryptoApi) => sha256Hex(JSON.stringify(snapshotJson(value)), cryptoApi);

export async function createCheckpoint({ config, instanceId, state, cryptoApi = globalThis.crypto }) {
  const payload = snapshotJson({ schema: 'reploid.checkpoint/v1', instanceId,
    configHash: await hashConfiguration(config, cryptoApi), state });
  return { ...payload, digest: await digest(payload, cryptoApi) };
}

export async function verifyCheckpoint({ checkpoint, config, instanceId, cryptoApi = globalThis.crypto }) {
  const data = snapshotJson(checkpoint);
  const { digest: expected, ...payload } = data;
  if (payload.schema !== 'reploid.checkpoint/v1' || payload.instanceId !== instanceId
    || payload.configHash !== await hashConfiguration(config, cryptoApi)
    || expected !== await digest(payload, cryptoApi)) throw new Error('Checkpoint identity or integrity mismatch');
  return payload.state;
}
