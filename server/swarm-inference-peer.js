/**
 * @fileoverview Server-backed virtual swarm peer for env-backed inference.
 */

const PROTOCOL_VERSION = 1;

const payloadSize = (payload) => JSON.stringify(payload || {}).length;

const createEnvelope = (peerId, type, payload) => ({
  protocolVersion: PROTOCOL_VERSION,
  type,
  peerId,
  timestamp: Date.now(),
  payload: payload || {},
  payloadSize: payloadSize(payload)
});

export function createSwarmInferencePeer(options = {}) {
  const inferenceService = options.inferenceService;
  const peerId = String(options.peerId || 'peer_signal_provider').trim() || 'peer_signal_provider';

  if (!inferenceService) {
    throw new Error('inferenceService is required');
  }

  const getMetadata = () => {
    const config = inferenceService.getConfig();
    return {
      transport: 'signaling-relay',
      relayMode: 'server-inference',
      provider: config.provider,
      model: config.model,
      capabilities: ['generation']
    };
  };

  const buildAdvertisement = () => {
    const config = inferenceService.getConfig();
    return {
      kind: 'peer_advertisement',
      peerId,
      role: 'provider',
      swarmEnabled: true,
      hasInference: true,
      capabilities: ['generation'],
      provider: config.provider,
      model: config.model,
      updatedAt: Date.now()
    };
  };

  const sendAdvertisement = async ({ targetPeerId, sendEnvelope }) => {
    sendEnvelope(targetPeerId, createEnvelope(peerId, 'reploid:peer-advertisement', buildAdvertisement()));
  };

  return {
    peerId,
    get metadata() {
      return getMetadata();
    },
    matchesRoom: () => inferenceService.isPeerAvailable(),
    async onPeerJoined(context) {
      if (!inferenceService.isPeerAvailable()) return;
      await sendAdvertisement(context);
    },
    async onMessage({ sourcePeerId, envelope, sendEnvelope }) {
      const requestId = String(envelope?.payload?.requestId || '').trim();

      switch (envelope?.type) {
        case 'ping':
          sendEnvelope(
            sourcePeerId,
            createEnvelope(peerId, 'pong', {
              ts: envelope?.payload?.ts || Date.now(),
              received: Date.now()
            })
          );
          return;

        case 'reploid:generation-request': {
          try {
            const response = await inferenceService.generate({
              provider: envelope?.payload?.provider || null,
              model: envelope?.payload?.model || null,
              messages: envelope?.payload?.messages || []
            });

            sendEnvelope(
              sourcePeerId,
              createEnvelope(peerId, 'reploid:generation-result', {
                requestId,
                response
              })
            );
          } catch (error) {
            sendEnvelope(
              sourcePeerId,
              createEnvelope(peerId, 'reploid:generation-error', {
                requestId,
                error: error?.message || String(error)
              })
            );
          }
          return;
        }

        case 'reploid:receipt':
          return;

        default:
          sendEnvelope(
            sourcePeerId,
            createEnvelope(peerId, 'reploid:generation-error', {
              requestId,
              error: `Unsupported server relay message: ${String(envelope?.type || 'unknown')}`
            })
          );
      }
    }
  };
}

export default {
  createSwarmInferencePeer
};
