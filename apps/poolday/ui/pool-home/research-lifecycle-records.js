/**
 * @fileoverview Turns a submitted research lifecycle form into one signed record. Verifiers sign
 * evaluations; researchers sign the rest. Each phase module owns its record shapes.
 */
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import { createSignedResearchRevocation } from '../../pool/evidence-network.js';
import { questionRecordBuilders } from './research-question-records.js';
import { workRecordBuilders } from './research-work-records.js';
import { evaluationRecordBuilders } from './research-evaluation-records.js';
import { adjudicationRecordBuilders } from './research-adjudication-records.js';

const revocationRecord = (values, { researcher, roomId }) => {
  return createSignedResearchRevocation({
    identity: researcher,
    roomId,
    targetHash: values.get('targetHash'),
    reason: values.get('reason')
  });
};

const lifecycleRecordBuilders = new Map([
  ...Object.entries(questionRecordBuilders),
  ...Object.entries(workRecordBuilders),
  ...Object.entries(evaluationRecordBuilders),
  ...Object.entries(adjudicationRecordBuilders),
  ['revocation', revocationRecord]
]);

export const createLifecycleRecordFromForm = async (action, values, roomId, records) => {
  const researcher = createPoolIdentity(['evaluation', 'adjudication-evaluation'].includes(action) ? 'verifier' : 'researcher');
  const byHash = new Map(records.map((record) => [record.recordHash, record]));
  const build = lifecycleRecordBuilders.get(action);
  if (build) return build(values, { researcher, roomId, records, byHash });
  throw new Error(`Unsupported research lifecycle action: ${action}`);
};
