/** One retrieval owner per workspace: host-supplied search, extraction and support ports under library policy. */
import defaults from './policy.json' with { type: 'json' };
import { guardRetrievalPort } from './disclosure-ports.js';
import { verifyCitations } from './citations.js';
import { mapClaimSpans } from './claim-support.js';
import { normalizeRetrievalRequest, pendingRetrievalRecord, retrieveSources, validateRetrievalPolicy,
  validateRetrievalPorts, withSourceContext } from './sources.js';

export function createRetrieval({ provider, extractor = null, supportChecker = null, policy = defaults, now = Date.now }) {
  validateRetrievalPorts({ provider, extractor, supportChecker });
  const rules = validateRetrievalPolicy(policy);
  return Object.freeze({
    /** Validates a request's opt-in before anything is recorded. */
    request: (input, content) => normalizeRetrievalRequest(input, content, rules),
    pending: (request, startedAt) => pendingRetrievalRecord({ request, provider, extractor, policy: rules, startedAt }),
    /** `answer`: an opaque key for the answer, so per-answer costs can be summed in provider usage logs. */
    retrieve: (record, signal, { answer = null, onProgress, beforeDisclosure = null } = {}) => retrieveSources({ record,
      provider: guardRetrievalPort(provider, 'search', beforeDisclosure, signal),
      extractor: guardRetrievalPort(extractor, 'extract', beforeDisclosure, signal), signal, now, policy: rules, answer, onProgress }),
    dispatch: (request, record) => withSourceContext(request, record, rules),
    // Citation flags plus the claim-to-span mapping and deterministic validity; entailment awaits an independent reviewer.
    // withVerification (costs.js) attaches the result to its record together with the verification cost entry.
    verify: async (answer, record, signal, beforeDisclosure = null) => ({ ...await verifyCitations({ answer, record,
      checker: guardRetrievalPort(supportChecker, 'check', beforeDisclosure, signal), signal,
      maxSupportChecks: rules.maxSupportChecks }), claimSupport: await mapClaimSpans({ answer, record, policy: rules }) })
  });
}
