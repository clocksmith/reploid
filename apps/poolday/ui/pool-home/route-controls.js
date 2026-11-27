
import { getPeerRoomId, getPeerRelayMode } from '../../host/product-context.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../../../../shared/pool/model-contract.js';
import { FASTEST_RECEIPT_POLICY_ID, getPolicy } from '../../pool/policy-router.js';

export const describeSelectedRun = ({
  policyId,
  modelId,
  adapterPackHash = null,
  status = 'finding_peer_provider'
} = {}) => {
  const policy = getPolicy(policyId || FASTEST_RECEIPT_POLICY_ID);
  const model = getEnabledPoolModelContract(modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
  return {
    status,
    transport: `webrtc_peer_room_${getPeerRelayMode()}`,
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    workMode: 'whole_job_redundant_records',
    policyId: policy?.policyId || policyId || FASTEST_RECEIPT_POLICY_ID,
    trustTier: policy?.adaptiveRing ? 'group check' : 'one tab',
    requiredAgreement: policy?.adaptiveRing
      ? `${policy.minRingSize || 1}-${policy.maxRingSize || 1} tabs, match by output hash`
      : `${policy?.redundancy || 1} tab${Number(policy?.redundancy || 1) === 1 ? '' : 's'}`,
    model: {
      modelId: model.modelId,
      modelHash: model.modelHash,
      manifestHash: model.manifestHash,
      runtime: model.runtime,
      backend: model.backend
    },
    adapter: adapterPackHash ? {
      packHash: adapterPackHash,
      state: 'selected_pending_provider'
    } : null
  };
};
