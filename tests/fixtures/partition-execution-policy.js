import { createExecutionPolicy, partitionPrivacyBinding } from '../../packages/reploid/src/chat/execution-policy.js';

export const partitionTestPolicy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });

export function partitionTestBinding(input) {
  const route = input.route ?? { planId: input.planId, participantA: input.participantA, participantB: input.participantB };
  const recipients = input.route ? input.route.stages.map(stage => stage.participantId) : [input.participantA, input.participantB];
  return partitionPrivacyBinding({ privacy: partitionTestPolicy, model: { id: input.modelId ?? route.modelId, identity: input.modelIdentity ?? route.modelIdentity,
    partition: route, adapters: (input.adapterIdentities || []).map(identity => ({ identity })) } }, recipients, route);
}
