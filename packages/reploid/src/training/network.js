import { createPartitionDataChannel, partitionBinaryResult } from '../transport/partition-data-channel.js';

/** Reuse authenticated, bounded binary framing; training never enters partition execution. */
export function createTrainingNetwork({ openNetwork, localParticipantId, receive, allowed, policy }) {
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
  const encode = value => encoder.encode(JSON.stringify(value));
  const decode = bytes => JSON.parse(decoder.decode(bytes));
  const authorized = new Set();
  const network = openNetwork({ label: 'reploid-training', maxPeers: policy.maxParticipants,
    timeoutMs: policy.connectTimeoutMs,
    createEndpoint({ channel, remoteParticipantId }) {
      const endpoint = createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId,
        limits: policy.channel,
        authorize({ action, metadata }) {
          if (metadata.schema !== 'reploid.lora-request/v1' || !['describe', 'contribute'].includes(metadata.operation)) return false;
          return action === 'send' || action === 'accept'
            ? authorized.has(remoteParticipantId) : allowed(remoteParticipantId);
        },
        async serve(metadata, bytes, { signal }) {
          const result = await receive({ action: metadata.operation, jobId: metadata.jobId, body: decode(bytes), remoteParticipantId, signal });
          return partitionBinaryResult({ schema: 'reploid.lora-response/v1', jobId: metadata.jobId }, encode(result));
        }
      });
      return { ...endpoint, participantId: remoteParticipantId,
        async trainingRequest(action, jobId, body, signal) {
          const reply = await endpoint.request({ schema: 'reploid.lora-request/v1', operation: action, jobId }, encode(body),
            { signal, maxResponseBytes: policy.channel.maxPayloadBytes });
          if (reply.result?.schema !== 'reploid.lora-response/v1' || reply.result.jobId !== jobId) throw new Error('Training reply identity changed');
          return decode(reply.bytes);
        }
      };
    }
  });
  return Object.freeze({
    async connect(peerId, signal) {
      signal.throwIfAborted();
      const endpoint = await network.connect(peerId);
      signal.throwIfAborted(); authorized.add(endpoint.participantId);
      return { participantId: endpoint.participantId, request: endpoint.trainingRequest };
    },
    close() { authorized.clear(); return network.close(); }
  });
}
