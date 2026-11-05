import { snapshotJson, hashConfiguration } from '../config/index.js';

async function digest(value, cryptoApi) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshotJson(value)));
  const hash = await cryptoApi.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

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
