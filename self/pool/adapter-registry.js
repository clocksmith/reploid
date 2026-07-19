/**
 * @fileoverview Private governed adapter registry and verified local byte cache.
 */

import { sha256Hex } from './inference-receipt.js';
import {
  publishedAdapterRequirementsEqual,
  verifyAdapterPublication,
  verifyAdapterRevocation
} from './adapter-publication.js';

export const ADAPTER_ACQUISITION_SCHEMA = 'reploid.pool.adapter-acquisition/v1';

const toBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('adapter bytes must be an ArrayBuffer or typed array');
};

export function createAdapterRegistry({ readBytes = null, writeBytes = null, deleteBytes = null } = {}) {
  const publications = new Map();
  const cachedBytes = new Map();
  const acquisitions = new Map();

  const loadBytes = async (packHash) => {
    if (cachedBytes.has(packHash)) return cachedBytes.get(packHash);
    if (typeof readBytes !== 'function') return null;
    const value = await readBytes(packHash);
    if (value == null) return null;
    const bytes = toBytes(value);
    cachedBytes.set(packHash, bytes);
    return bytes;
  };

  const artifactValid = async (publication, bytes) => (
    publication?.revoked !== true
    && bytes?.byteLength === Number(publication?.pack?.adapter?.bytes)
    && await sha256Hex(bytes) === publication?.pack?.adapter?.sha256
  );

  return Object.freeze({
    async publish(publication) {
      const verification = await verifyAdapterPublication(publication);
      if (!verification.ok) throw new Error(verification.reasons.join('; '));
      const existing = publications.get(publication.packHash);
      if (existing && existing.publicationHash !== publication.publicationHash) {
        throw new Error('adapter pack hash already has a different publication identity');
      }
      publications.set(publication.packHash, publication);
      return publication;
    },
    async cache({ publication, bytes, acquisition = null } = {}) {
      await this.publish(publication);
      const byteView = toBytes(bytes);
      if (!await artifactValid(publication, byteView)) throw new Error('adapter bytes do not match publication');
      cachedBytes.set(publication.packHash, byteView);
      if (acquisition) acquisitions.set(publication.packHash, acquisition);
      if (typeof writeBytes === 'function') await writeBytes(publication.packHash, byteView);
      return publication.packHash;
    },
    getPublication(packHash) {
      const publication = publications.get(packHash) || null;
      return publication?.revoked === true ? null : publication;
    },
    list({ capability = null, publisherId = null, visibility = null } = {}) {
      return Array.from(publications.values()).filter((publication) => (
        publication.revoked !== true
        && (!capability || publication.capabilities?.includes(capability))
        && (!publisherId || publication.publisher?.publisherId === publisherId)
        && (!visibility || publication.visibility === visibility)
      ));
    },
    async hasCached(packHash) {
      const publication = this.getPublication(packHash);
      if (!publication) return false;
      return artifactValid(publication, await loadBytes(packHash));
    },
    async getArtifact(packHash) {
      const publication = this.getPublication(packHash);
      const bytes = publication ? await loadBytes(packHash) : null;
      if (!publication || !await artifactValid(publication, bytes)) return null;
      return {
        publication,
        pack: publication.pack,
        bytes,
        acquisition: acquisitions.get(packHash) || null
      };
    },
    async revoke(packHash, revocation) {
      const publication = publications.get(packHash);
      if (!publication) throw new Error('adapter publication not found');
      const verification = await verifyAdapterRevocation(revocation, publication);
      if (!verification.ok) throw new Error(verification.reasons.join('; '));
      publications.set(packHash, { ...publication, revoked: true, revocation });
      cachedBytes.delete(packHash);
      acquisitions.delete(packHash);
      if (typeof deleteBytes === 'function') await deleteBytes(packHash);
      return revocation;
    },
    requirementMatchesPublication(requirement, publication) {
      if (!publication || publication.revoked === true) return false;
      return publishedAdapterRequirementsEqual(requirement, {
        ...requirement,
        packHash: publication.packHash,
        adapterId: publication.pack.adapter?.id,
        adapterSha256: publication.pack.adapter?.sha256,
        baseModelId: publication.pack.baseModel?.modelId,
        baseModelHash: publication.pack.baseModel?.modelHash,
        baseManifestHash: publication.pack.baseModel?.manifestHash,
        humanPromotionReceiptHash: publication.pack.evidence?.humanPromotionReceiptHash,
        dopplerParityReceiptHash: publication.pack.evidence?.dopplerParityReceiptHash,
        gammaSelectionReceiptHash: publication.pack.evidence?.gammaSelectionReceiptHash,
        publicationHash: publication.publicationHash,
        publisherId: publication.publisher?.publisherId
      });
    }
  });
}

export async function acquireAdapterForAssignment({
  assignment,
  registry,
  fetchFromPeer = null,
  fetchFromOrigin = null
} = {}) {
  const requirement = assignment?.adapter || assignment?.model?.requirements?.adapter || null;
  if (!requirement) return null;
  if (!registry) throw new Error('adapter registry is required');
  const cached = await registry.getArtifact(requirement.packHash);
  if (cached) {
    return {
      ...cached,
      acquisition: cached.acquisition || {
        schema: ADAPTER_ACQUISITION_SCHEMA,
        packHash: requirement.packHash,
        adapterSha256: requirement.adapterSha256,
        source: 'cache',
        sourcePeerId: null,
        bytes: cached.bytes.byteLength,
        verifiedAt: new Date().toISOString()
      }
    };
  }
  const errors = [];
  for (const [source, fetchArtifact] of [['peer', fetchFromPeer], ['origin', fetchFromOrigin]]) {
    if (typeof fetchArtifact !== 'function') continue;
    try {
      const artifact = await fetchArtifact({ assignment, requirement });
      if (!artifact?.publication || !artifact?.bytes) throw new Error('source returned no publication or bytes');
      if (!registry.requirementMatchesPublication(requirement, artifact.publication)) {
        throw new Error('source publication does not match assignment requirement');
      }
      const acquisition = artifact.acquisition || artifact.transferReceipt || {
        schema: ADAPTER_ACQUISITION_SCHEMA,
        packHash: requirement.packHash,
        adapterSha256: requirement.adapterSha256,
        source,
        sourcePeerId: artifact.sourcePeerId || null,
        bytes: toBytes(artifact.bytes).byteLength,
        verifiedAt: new Date().toISOString()
      };
      await registry.cache({ publication: artifact.publication, bytes: artifact.bytes, acquisition });
      return registry.getArtifact(requirement.packHash);
    } catch (error) {
      errors.push(`${source}: ${error.message}`);
    }
  }
  throw new Error(`adapter acquisition failed: ${errors.join('; ') || 'no peer or origin source configured'}`);
}

export default {
  ADAPTER_ACQUISITION_SCHEMA,
  createAdapterRegistry,
  acquireAdapterForAssignment
};
