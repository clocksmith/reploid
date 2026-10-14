// CPU-only reproduction of the run-3 Send failure with the export's own modules. It builds the
// preview exactly as automatic-ordered-partitions.js generate() does (requesterId = the requester's
// swarm peer identity) and evaluates the workspace's disclosureScope with the participant identity the
// product route gives the chat workspace ('local-user', self/host/chat-session.js:36) and, as a control,
// with the requester's peer identity. Usage: node disclosure-check.mjs <export app dir> <stage0 setup receipt> <requester peer id>
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [app, receiptPath, requesterPeerId] = process.argv.slice(2);
const load = file => import(pathToFileURL(path.join(app, file)).href);
const { disclosureScope } = await load('packages/reploid/src/chat/thread-grants.js');
const { orderedPartitionDisclosure } = await load('packages/reploid/src/mesh/partitions/partition-grants.js');
const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
const route = receipt.final.placementDecision.route, models = JSON.parse(await fs.readFile(path.join(app, 'self/config/chat-models.json'), 'utf8'));
const model = { id: route.modelId, identity: route.modelIdentity, adapters: [], partition: { schema: 'reploid.partition-selection/v2', planId: route.planId, route, coordinatorId: route.stages[0].participantId } };
const request = { model, permissions: { sharingScope: 'mesh' } };
const identityBinding = { schema: 'reploid.partition-attempt/v2', route, requesterId: requesterPeerId, threadId: 't-1', attemptId: 'a-1', placementGeneration: 0 };
const disclosure = orderedPartitionDisclosure(identityBinding);
const preview = { id: 'p-1', threadId: 't-1', attemptId: 'a-1', operation: 'generate-partition', peerId: route.stages[0].participantId,
  recipientIdentity: route.stages[0].participantId, ...model.partition, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [],
  disclosure, expiresAt: Date.now() + 60000, input: { messages: [], recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } };
const result = id => { const scope = disclosureScope(request, preview, id); return scope ? { scope: 'accepted', disclosure: scope.disclosure } : { scope: null }; };
console.log(JSON.stringify({ schema: 'reploid.run-3-disclosure-check/v1', catalogModels: models.length, route: route.stages.map(stage => stage.participantId),
  productRouteParticipant: { participantId: 'local-user', ...result('local-user') }, requesterPeerIdentity: { participantId: requesterPeerId, ...result(requesterPeerId) } }, null, 1));
