/**
 * @fileoverview Publisher-facing client for the governed Poolday adapter registry.
 */

import { createPoolIdentity } from './identity.js';
import { createPoolSdk } from './sdk.js';
import { createSigningKeyPair, exportPublicKey } from './inference-receipt.js';
import {
  createAdapterRevocation,
  createSignedAdapterPublication
} from './adapter-publication.js';

export function createAdapterPublisherClient({
  publisherId = null,
  sdk = createPoolSdk(),
  keyPair = null,
  identity = createPoolIdentity('publisher')
} = {}) {
  let activePublisherId = publisherId;
  let activeKeyPair = keyPair;
  let publisherPublicKey = null;
  const publications = new Map();

  const ensureIdentity = async () => {
    if (!activePublisherId) activePublisherId = await identity?.getRoleId?.();
    if (!activePublisherId) throw new Error('publisherId is required');
    if (!activeKeyPair) activeKeyPair = identity
      ? await identity.getSigningKeyPair()
      : await createSigningKeyPair();
    if (!publisherPublicKey) publisherPublicKey = await exportPublicKey(activeKeyPair.publicKey);
    return { publisherId: activePublisherId, keyPair: activeKeyPair, publisherPublicKey };
  };

  return Object.freeze({
    async publish({ pack, visibility, originUrls = [], capabilities = [] } = {}) {
      const current = await ensureIdentity();
      const publication = await createSignedAdapterPublication({
        pack,
        publisherId: current.publisherId,
        publisherPublicKey: current.publisherPublicKey,
        privateKey: current.keyPair.privateKey,
        visibility,
        originUrls,
        capabilities
      });
      const result = await sdk.publishAdapter(publication);
      const saved = result?.publication || publication;
      publications.set(saved.packHash, saved);
      return saved;
    },
    async revoke(packHash, reason = 'publisher_revoked') {
      const current = await ensureIdentity();
      const publication = publications.get(packHash)
        || (await sdk.getAdapter(packHash))?.publication;
      if (!publication) throw new Error('adapter publication not found');
      const revocation = await createAdapterRevocation({
        publication,
        reason,
        privateKey: current.keyPair.privateKey
      });
      const result = await sdk.revokeAdapter(packHash, revocation);
      publications.delete(packHash);
      return result?.publication || result;
    },
    list(filters = {}) {
      return sdk.listAdapters(filters);
    },
    get(packHash) {
      return sdk.getAdapter(packHash);
    },
    async getPublisherId() {
      return (await ensureIdentity()).publisherId;
    },
    async getPublicKey() {
      return (await ensureIdentity()).publisherPublicKey;
    }
  });
}

export default { createAdapterPublisherClient };
