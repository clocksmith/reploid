/**
 * @fileoverview Assignment-scoped adapter byte transfer over Poolday WebRTC.
 */

import { verifyAdapterPack } from './adapter-pack.js';
import { hashJson, sha256Hex } from './inference-receipt.js';
import {
  P2P_PAYLOAD_TYPES,
  createP2PPayload,
  hashP2PPayload,
  validateP2PPayload
} from './p2p-payload.js';

export const ADAPTER_TRANSFER_RECEIPT_SCHEMA = 'reploid.pool.adapter-transfer-receipt/v1';

const bytesToBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const base64ToBytes = (value) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(value || ''), 'base64'));
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const payloadWithoutHash = (payload = {}) => {
  const { payloadHash, ...body } = payload;
  return body;
};

const withPayloadHash = async (payload) => ({
  ...payload,
  payloadHash: await hashP2PPayload(payload)
});

const adapterForAssignment = (assignment = {}) => (
  assignment.adapter || assignment.model?.requirements?.adapter || null
);

export async function createAdapterArtifactRequest({
  assignment,
  missingChunkIndexes = [],
  fromPeerId,
  toPeerId
} = {}) {
  const adapter = adapterForAssignment(assignment);
  if (!adapter?.packHash) throw new Error('assignment adapter requirement is required');
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.ARTIFACT_REQUEST,
    assignmentId: assignment.assignmentId,
    jobId: assignment.jobId,
    fromPeerId,
    toPeerId,
    body: {
      schema: 'reploid.pool.adapter-artifact-request/v1',
      packHash: adapter.packHash,
      adapterSha256: adapter.adapterSha256,
      missingChunkIndexes: [...new Set(missingChunkIndexes.map(Number))].sort((a, b) => a - b)
    }
  });
  return withPayloadHash(payload);
}

export async function createAdapterArtifactChunks({
  assignment,
  pack,
  bytes,
  fromPeerId,
  toPeerId,
  requestedChunkIndexes = null
} = {}) {
  const verification = await verifyAdapterPack(pack, { requirePromoted: true });
  if (!verification.ok) throw new Error(`Adapter pack rejected: ${verification.reasons.join('; ')}`);
  const adapter = adapterForAssignment(assignment);
  if (adapter?.packHash !== pack.packHash || adapter?.adapterSha256 !== pack.adapter.sha256) {
    throw new Error('assignment adapter requirement does not match the supplied pack');
  }
  const sourceBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (await sha256Hex(sourceBytes) !== pack.adapter.sha256) throw new Error('adapter bytes hash mismatch');
  if (sourceBytes.byteLength !== Number(pack.adapter.bytes)) throw new Error('adapter byte length mismatch');

  const selected = requestedChunkIndexes === null
    ? pack.distribution.chunks.map((chunk) => Number(chunk.index))
    : [...new Set(requestedChunkIndexes.map(Number))].sort((a, b) => a - b);
  const offsets = [];
  let cursor = 0;
  for (const chunk of pack.distribution.chunks) {
    offsets.push(cursor);
    cursor += Number(chunk.bytes);
  }
  const payloads = [];
  for (const index of selected) {
    const descriptor = pack.distribution.chunks[index];
    if (!descriptor) throw new Error(`adapter chunk ${index} is not declared`);
    const chunkBytes = sourceBytes.slice(offsets[index], offsets[index] + Number(descriptor.bytes));
    if (await sha256Hex(chunkBytes) !== descriptor.sha256) {
      throw new Error(`adapter chunk ${index} hash mismatch before send`);
    }
    const payload = createP2PPayload({
      type: P2P_PAYLOAD_TYPES.ARTIFACT_CHUNK,
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      fromPeerId,
      toPeerId,
      body: {
        schema: 'reploid.pool.adapter-artifact-chunk/v1',
        packHash: pack.packHash,
        adapterSha256: pack.adapter.sha256,
        index,
        count: pack.distribution.chunks.length,
        chunkSha256: descriptor.sha256,
        bytes: chunkBytes.byteLength,
        dataBase64: bytesToBase64(chunkBytes)
      }
    });
    payloads.push(await withPayloadHash(payload));
  }
  return payloads;
}

export async function assembleAdapterArtifact({ assignment, pack, chunkPayloads = [] } = {}) {
  const verification = await verifyAdapterPack(pack, { requirePromoted: true });
  if (!verification.ok) throw new Error(`Adapter pack rejected: ${verification.reasons.join('; ')}`);
  const adapter = adapterForAssignment(assignment);
  if (adapter?.packHash !== pack.packHash) throw new Error('assignment adapter pack hash mismatch');
  const received = new Map();
  let sourcePeerId = null;
  for (const payload of chunkPayloads) {
    const validation = validateP2PPayload(payload);
    if (!validation.ok) throw new Error(validation.reasons.join('; '));
    if (payload.type !== P2P_PAYLOAD_TYPES.ARTIFACT_CHUNK) throw new Error('unexpected artifact payload type');
    if (payload.assignmentId !== assignment.assignmentId || payload.jobId !== assignment.jobId) {
      throw new Error('artifact chunk assignment binding mismatch');
    }
    if (await hashJson(payloadWithoutHash(payload)) !== payload.payloadHash) {
      throw new Error('artifact chunk payload hash mismatch');
    }
    if (payload.body?.packHash !== pack.packHash || payload.body?.adapterSha256 !== pack.adapter.sha256) {
      throw new Error('artifact chunk adapter identity mismatch');
    }
    const index = Number(payload.body.index);
    const descriptor = pack.distribution.chunks[index];
    if (!descriptor || received.has(index)) throw new Error(`adapter chunk ${index} is invalid or duplicated`);
    const chunkBytes = base64ToBytes(payload.body.dataBase64);
    if (chunkBytes.byteLength !== Number(descriptor.bytes)
      || payload.body.bytes !== Number(descriptor.bytes)
      || payload.body.chunkSha256 !== descriptor.sha256
      || await sha256Hex(chunkBytes) !== descriptor.sha256) {
      throw new Error(`adapter chunk ${index} integrity mismatch`);
    }
    sourcePeerId = sourcePeerId || payload.fromPeerId;
    if (sourcePeerId !== payload.fromPeerId) throw new Error('adapter chunks came from multiple undeclared peers');
    received.set(index, chunkBytes);
  }
  if (received.size !== pack.distribution.chunks.length) throw new Error('adapter artifact is incomplete');
  const output = new Uint8Array(Number(pack.adapter.bytes));
  let offset = 0;
  for (let index = 0; index < pack.distribution.chunks.length; index += 1) {
    output.set(received.get(index), offset);
    offset += received.get(index).byteLength;
  }
  if (await sha256Hex(output) !== pack.adapter.sha256) throw new Error('assembled adapter hash mismatch');
  const receiptCore = {
    schema: ADAPTER_TRANSFER_RECEIPT_SCHEMA,
    assignmentId: assignment.assignmentId,
    jobId: assignment.jobId,
    packHash: pack.packHash,
    adapterSha256: pack.adapter.sha256,
    routeDecisionHash: assignment.routeDecisionHash || null,
    source: 'peer',
    sourcePeerId,
    bytes: output.byteLength,
    chunkHashes: pack.distribution.chunks.map((chunk) => chunk.sha256)
  };
  return {
    bytes: output,
    transferReceipt: Object.freeze({
      ...receiptCore,
      receiptHash: await hashJson(receiptCore)
    })
  };
}

export default {
  ADAPTER_TRANSFER_RECEIPT_SCHEMA,
  createAdapterArtifactRequest,
  createAdapterArtifactChunks,
  assembleAdapterArtifact
};
