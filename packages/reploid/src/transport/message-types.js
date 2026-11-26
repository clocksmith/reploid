/** Application message vocabulary shared by room and WebRTC transports.
 * Raft, federated learning, synchronization and artifact handlers belong to the
 * embedding application through onMessage(); admission never grants execution.
 */
import { INTRODUCTION_CONTACT, INTRODUCTION_SIGNAL } from './introductions.js';
import { OWNER_PAIRING_REQUEST, OWNER_PAIRING_RESULT } from './owner-pairing.js';
import { CIRCLE_JOIN_REQUEST, CIRCLE_JOIN_RESULT } from './circle-join.js';
export const PROTOCOL_VERSION = 1;
// Non-generation mesh operations (mesh/operation-envelope.js). Defined here so transport/ never imports mesh/.
export const MESH_OPERATION_REQUEST = 'reploid:mesh-operation-request';
export const MESH_OPERATION_RESULT = 'reploid:mesh-operation-result';
export const MESH_OPERATION_CANCEL = 'reploid:mesh-operation-cancel';
export const APPLICATION_MESSAGE_TYPES = Object.freeze([
  'sync-request', 'sync-response',
  'goal-update', 'reflection-share',
  'artifact-announce', 'artifact-request', 'artifact-chunk', 'artifact-ack',
  'reploid:peer-advertisement',
  'reploid:identity-challenge', 'reploid:identity-proof',
  'reploid:generation-admit', 'reploid:generation-admitted',
  // Delivery protocol 1: a provider acknowledges a request frame on arrival (see mesh/request-delivery.js).
  'reploid:request-received',
  'reploid:generation-request', 'reploid:generation-update',
  'reploid:generation-result', 'reploid:generation-error',
  'reploid:generation-cancel', 'reploid:generation-recover', 'reploid:generation-recovery',
  'reploid:receipt', 'reploid:target-score-request', 'reploid:target-score-result',
  MESH_OPERATION_REQUEST, MESH_OPERATION_RESULT, MESH_OPERATION_CANCEL,
  'reploid:web-offer', 'reploid:web-request', 'reploid:web-response', 'reploid:web-cancel',
  'reploid:tool-offer', 'reploid:tool-offer-ack',
  'reploid:custody-request', 'reploid:custody-response', 'reploid:custody-offer',
  'ping', 'pong',
  'raft:request-vote', 'raft:request-vote-response',
  'raft:append-entries', 'raft:append-entries-response',
  'raft:client-request', 'raft:client-response',
  'fl:hello', 'fl:round-start', 'fl:update', 'fl:round-commit', 'fl:round-failed'
]);
export const RTC_MESSAGE_TYPES = Object.freeze([...APPLICATION_MESSAGE_TYPES, INTRODUCTION_CONTACT, INTRODUCTION_SIGNAL,
  OWNER_PAIRING_REQUEST, OWNER_PAIRING_RESULT, CIRCLE_JOIN_REQUEST, CIRCLE_JOIN_RESULT]);
export const ROOM_MESSAGE_TYPES = Object.freeze([...APPLICATION_MESSAGE_TYPES, 'peer-announce', 'peer-leave']);
