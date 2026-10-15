/** One retrieval owner per workspace: host-supplied search, extraction and support ports under library policy. */
import defaults from './policy.json' with { type: 'json' };
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
    retrieve: (record, signal) => retrieveSources({ record, provider, extractor, signal, now, policy: rules }),
    dispatch: (request, record) => withSourceContext(request, record, rules),
    // Citation flags plus the claim-to-span mapping and deterministic validity; entailment awaits an independent reviewer.
    verify: async (answer, record, signal) => ({ ...await verifyCitations({ answer, record, checker: supportChecker, signal,
      maxSupportChecks: rules.maxSupportChecks }), claimSupport: await mapClaimSpans({ answer, record, policy: rules }) })
  });
}
