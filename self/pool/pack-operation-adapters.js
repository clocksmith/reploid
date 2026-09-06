/** Operation semantics at the network boundary; no peer or transport policy. */
const requireValue = (value, message) => { if (!value) throw new Error(`Pack operation: ${message}`); };
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const vector = (value) => Array.isArray(value) && value.length > 0 && value.every(Number.isFinite);
const tokenIds = (value) => Array.isArray(value) && value.every((id) => Number.isSafeInteger(id) && id >= 0);
const fields = (value, allowed) => requireValue(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every((key) => allowed.includes(key)), 'unexpected input or option fields');
const closeVector = (left, right, policy) => vector(left) && vector(right) && left.length === right.length
  && left.every((value, index) => Math.abs(value - right[index]) <= policy.absoluteTolerance + policy.relativeTolerance * Math.abs(right[index]));
const tolerance = (policy) => {
  requireValue(policy.rule === 'numerical-tolerance'
    && Number.isFinite(policy.absoluteTolerance) && policy.absoluteTolerance >= 0
    && Number.isFinite(policy.relativeTolerance) && policy.relativeTolerance >= 0, 'explicit numerical comparison policy required');
};

const builtins = {
  generate: {
    version: 1,
    validateRequest({ input, options }) {
      fields(input, ['prompt', 'promptTokens']);
      requireValue(Object.hasOwn(input, 'prompt') !== Object.hasOwn(input, 'promptTokens'), 'one generation input required');
      requireValue(Object.hasOwn(input, 'prompt') ? text(input.prompt) : tokenIds(input.promptTokens) && input.promptTokens.length > 0, 'invalid generation input');
      fields(options, ['maxTokens', 'maxSeqLen', 'temperature', 'topP', 'topK', 'repetitionPenalty', 'repetitionPenaltyWindow', 'useChatTemplate', 'seed', 'suppressTokenIds', 'stopSequences']);
      requireValue(Number.isSafeInteger(options.maxTokens) && options.maxTokens > 0, 'maxTokens required');
      requireValue(Number.isSafeInteger(options.maxSeqLen) && options.maxSeqLen > 0, 'maxSeqLen required');
      for (const key of ['temperature', 'topP', 'topK', 'repetitionPenalty', 'repetitionPenaltyWindow']) requireValue(Number.isFinite(options[key]), `${key} required`);
      requireValue(typeof options.useChatTemplate === 'boolean', 'useChatTemplate required');
    },
    validateOutput(output, request) {
      requireValue(typeof output.text === 'string' && tokenIds(output.tokenIds) && output.tokenIds.length <= request.options.maxTokens, 'invalid generation output');
    },
    compare(output, reference, policy) {
      requireValue(policy.rule === 'exact-text', 'generation requires a declared exact-text reference rule');
      return output.text === reference.text;
    }
  },
  embed: {
    version: 1,
    validateRequest({ input, options }) {
      fields(input, ['texts', 'application']); fields(options, []);
      requireValue(Array.isArray(input.texts) && input.texts.length > 0 && input.texts.every(text), 'texts required');
      requireValue(input.application && typeof input.application === 'object'
        && !Array.isArray(input.application), 'signed embedding application required');
    },
    validateOutput(output, request, { completed }) {
      requireValue(Array.isArray(output.embeddings) && output.embeddings.length > 0
        && output.embeddings.length <= request.input.texts.length
        && (!completed || output.embeddings.length === request.input.texts.length)
        && output.embeddings.every((item) => vector(item.embedding)
          && item.embedding.length === output.embeddings[0].embedding.length), 'invalid embedding batch');
    },
    compare(output, reference, policy) {
      tolerance(policy);
      return output.embeddings.length === reference.embeddings.length
        && output.embeddings.every((item, index) => closeVector(item.embedding, reference.embeddings[index].embedding, policy));
    }
  },
  rerank: {
    version: 1,
    validateRequest({ input, options }) {
      fields(input, ['query', 'documents', 'application']); fields(options, []);
      requireValue(text(input.query) && Array.isArray(input.documents) && input.documents.length > 0
        && input.documents.every(text) && input.application && typeof input.application === 'object', 'rerank input and signed application required');
    },
    validateOutput(output, request) {
      const evidence = output.evidence;
      const count = request.input.documents.length;
      requireValue(evidence?.schema === 'doppler_rerank_evidence/v1'
        && Array.isArray(evidence.scores) && evidence.scores.length === count
        && evidence.scores.every((item, index) => item.index === index && Number.isFinite(item.score))
        && Array.isArray(evidence.ranking) && evidence.ranking.length === count
        && new Set(evidence.ranking.map((item) => item.index)).size === count
        && evidence.ranking.every((item, index) => Number.isSafeInteger(item.index) && item.index >= 0 && item.index < count
          && item.rank === index + 1 && item.score === evidence.scores[item.index].score), 'invalid rerank output');
    },
    compare(output, reference, policy) {
      tolerance(policy);
      return JSON.stringify(output.evidence.ranking.map((item) => item.index)) === JSON.stringify(reference.evidence.ranking.map((item) => item.index))
        && closeVector(output.evidence.scores.map((item) => item.score), reference.evidence.scores.map((item) => item.score), policy);
    }
  },
  encodeSequence: {
    version: 1,
    validateRequest({ input, options }) {
      fields(input, ['sequence']); fields(options, ['includeTokenEmbeddings', 'includeLogits']);
      requireValue(text(input.sequence) && typeof options.includeTokenEmbeddings === 'boolean'
        && typeof options.includeLogits === 'boolean', 'sequence and explicit output flags required');
    },
    validateOutput(output, request) {
      requireValue(tokenIds(output.tokens) && output.tokens.length > 0
        && Number.isSafeInteger(output.embeddingDim) && output.embeddingDim > 0
        && vector(output.pooledEmbedding) && output.pooledEmbedding.length === output.embeddingDim, 'invalid sequence geometry');
      requireValue(Array.isArray(output.tokenMask) && output.tokenMask.length === output.tokens.length
        && output.tokenMask.every((value) => value === 0 || value === 1), 'invalid sequence token mask');
      requireValue(request.options.includeTokenEmbeddings
        ? vector(output.tokenEmbeddings) && output.tokenEmbeddings.length === output.tokens.length * output.embeddingDim
        : output.tokenEmbeddings === null, 'sequence token output disagrees with requested outputs');
      requireValue(request.options.includeLogits
        ? Number.isSafeInteger(output.vocabSize) && output.vocabSize > 0 && vector(output.logits) && output.logits.length === output.tokens.length * output.vocabSize
        : output.logits === null, 'sequence logits disagree with requested outputs');
    },
    compare(output, reference, policy) {
      tolerance(policy);
      return JSON.stringify(output.tokens) === JSON.stringify(reference.tokens)
        && JSON.stringify(output.tokenMask) === JSON.stringify(reference.tokenMask)
        && ['pooledEmbedding', 'tokenEmbeddings', 'logits'].every((key) => output[key] === null || reference[key] === null
          ? output[key] === reference[key] : closeVector(output[key], reference[key], policy));
    }
  }
};

export function createPackOperationRegistry(additional = {}) {
  const entries = Object.entries({ ...builtins, ...additional });
  for (const [name, adapter] of entries) {
    requireValue(/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(name) && Number.isSafeInteger(adapter.version) && adapter.version > 0
      && ['validateRequest', 'validateOutput', 'compare'].every((method) => typeof adapter[method] === 'function'), 'invalid operation adapter');
  }
  return Object.freeze(Object.fromEntries(entries.map(([name, adapter]) => [name, Object.freeze({ ...adapter })])));
}
