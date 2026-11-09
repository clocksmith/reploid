import policy from './computer-identity.policy.json' with { type: 'json' };
import { publicProviderHardware } from './provider-hardware.js';

/** Stable display names identify a key, never a unique physical computer. */
export function participantLabel(id) {
  if (typeof id !== 'string' || !id) return 'Remote device';
  let hash = 0x811c9dc5;
  const input = policy.labelVersion + id;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193) >>> 0;
  return `${policy.colors[hash & 31]} ${policy.animals[(hash >>> 5) & 31]} · ${(hash >>> 16).toString(16).padStart(4, '0').toUpperCase()}`;
}

const labelText = value => {
  if (typeof value !== 'string' || value.length > policy.maxLabelLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Computer label must be plain text of at most 64 characters');
  }
  return value.trim();
};

/** The host supplies its existing channel-bound verifier and optional local label store.
 * No GPU work, network discovery, or global storage access occurs implicitly.
 */
export async function identifyComputer(connectionId, { verifyPeer, storage, ownerLabel, hardware, signal } = {}) {
  if (typeof verifyPeer !== 'function') throw new TypeError('A channel-bound peer verifier is required');
  const suppliedLabel = ownerLabel === undefined ? undefined : labelText(ownerLabel);
  const reportedHardware = publicProviderHardware(hardware);
  signal?.throwIfAborted();
  const participantId = await verifyPeer(connectionId, signal);
  signal?.throwIfAborted();
  if (typeof participantId !== 'string' || !/^peer:[a-f0-9]{24}$/.test(participantId)) {
    throw new Error('Computer identity could not be verified');
  }
  const key = policy.storagePrefix + participantId;
  let label = suppliedLabel, persistence = storage ? 'available' : 'unavailable';
  try {
    if (label === undefined && storage) {
      const saved = await storage.getItem(key);
      if (saved !== null && saved !== undefined) label = labelText(saved);
    }
    signal?.throwIfAborted();
    if (suppliedLabel !== undefined && storage) await storage.setItem(key, suppliedLabel);
  } catch (error) {
    signal?.throwIfAborted();
    persistence = 'unavailable';
  }
  signal?.throwIfAborted();
  return { participantId, connectionId, label: label || participantLabel(participantId),
    labelSource: label ? 'local-name' : 'participant-key', persistence,
    identityBasis: 'signing-key', hardware: reportedHardware };
}
