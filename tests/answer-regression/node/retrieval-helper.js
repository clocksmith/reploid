// Retrieval and citation checks for the answer regression harness, through the retrieval component's
// exported interface only (packages/reploid/src/retrieval/index.js). Automated regression evaluation —
// not independent acceptance.
//
// Reads one JSON request (or an array of requests) on stdin and writes one JSON response (or array):
//   {"op":"prepare","documents":[...],"query":"...","limits":{...},"now":<ms>,"messages":[...]}
//     -> {"ok":true,"record":{...},"dispatchedMessages":[...]|null,"failureMessage":string|null}
//     Fixed-document search and extraction, numbered context and dispatch, as the workspace composes them.
//   {"op":"verify","answer":"...","record":{...}}
//     -> {"ok":true,"verification":{...}}  createRetrieval().verify with no support checker, as the workspace stores it:
//        verifyCitations flags plus claimSupport (mapClaimSpans: deterministic citation validity). Support stays unverified.
//   {"op":"describe"} -> {"ok":true,"policy":{...},"schemas":{...}}
import { CITATION_VERIFICATION_SCHEMA, RETRIEVAL_RECORD_SCHEMA, createFixedSearchProvider, createRetrieval,
  retrievalFailureMessage } from '../../../packages/reploid/src/retrieval/index.js';
import policy from '../../../packages/reploid/src/retrieval/policy.json' with { type: 'json' };

const read = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

async function prepare({ documents, query, limits, now, messages }) {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('prepare needs a fixed positive now');
  const clock = () => now;
  const provider = createFixedSearchProvider({ documents, now: clock });
  const port = createRetrieval({ provider, extractor: provider, supportChecker: null, now: clock });
  const last = messages.at(-1);
  const request = port.request({ query, limits }, last.content);
  const record = await port.retrieve(port.pending(request, now), null);
  if (record.outcome !== 'retrieved') {
    return { ok: true, record, dispatchedMessages: null, failureMessage: retrievalFailureMessage(record) };
  }
  const dispatched = await port.dispatch({ messages, retrieval: request }, record);
  return { ok: true, record, dispatchedMessages: dispatched.messages, failureMessage: null };
}

async function handle(request) {
  try {
    if (request.op === 'prepare') return await prepare(request);
    if (request.op === 'verify') {
      // verify never searches; the provider port only satisfies createRetrieval's validation.
      const port = createRetrieval({ provider: { id: 'reploid.answer-regression.verify-only', version: '1', search: async () => [] },
        supportChecker: null });
      return { ok: true, verification: await port.verify(request.answer, request.record, null) };
    }
    if (request.op === 'describe') {
      return { ok: true, policy: { id: policy.id, version: policy.version },
        schemas: { record: RETRIEVAL_RECORD_SCHEMA, verification: CITATION_VERIFICATION_SCHEMA } };
    }
    throw new Error(`Unknown op ${request.op}`);
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

const input = await read();
const output = Array.isArray(input) ? await Promise.all(input.map(handle)) : await handle(input);
process.stdout.write(JSON.stringify(output) + '\n');
