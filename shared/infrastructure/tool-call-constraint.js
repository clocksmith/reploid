/**
 * @fileoverview The tool settings of one generation request, applied by a provider and
 * expected by a requester.
 *
 * A provider turns the canonical conversation (assistant `toolCalls`, `role: 'tool'`
 * results) into the plain string messages Doppler's chat templates accept, and, when a
 * call may or must be made, compiles the output constraint and hands Doppler a token mask
 * with the identity of that constraint. A requester computes the same identity from the
 * same settings, so a receipt naming another constraint, or none, is refused.
 *
 * Nothing here is applied unless the request declares tools or carries tool messages: a
 * plain conversation passes through untouched, with no mask and no identity.
 */
import { compileConstraintWithIdentity, constraintIdentitySource, createLogitMask, digestConstraintIdentity,
  logitMaskIdentity } from './output-constraint.js';
import { renderToolConversation } from './tool-call-format.js';

/** The wrapper format of tool-call-format.js, as a catalog model declares it in `toolCallFormat`. */
export const TOOL_CALL_FORMAT = 'reploid.tool-call/hermes-v1';
const FORMATS = new Set([TOOL_CALL_FORMAT]);
const MAX_COMPILED = 16;

/**
 * The tool-call format a catalog model declares, or null when it declares none. Only a
 * model trained on the format should declare it; an unknown value is refused, not ignored.
 */
export function modelToolCallFormat(model) {
  const declared = model?.toolCallFormat;
  if (declared === undefined) return null;
  if (!FORMATS.has(declared)) {
    throw new Error(`Unknown model toolCallFormat ${JSON.stringify(String(declared).slice(0, 64))}; supported: ${[...FORMATS].join(', ')}`);
  }
  return declared;
}

/** True when a conversation holds a tool call or a tool result, which only rendering makes readable. */
export function hasToolMessages(messages) {
  return Array.isArray(messages) && messages.some(message => message?.role === 'tool' || message?.toolCalls !== undefined);
}

/**
 * The constraint specification canonical settings call for: null when no tools are
 * declared or `toolChoice` is 'none', because output is then unconstrained.
 */
export function toolConstraintSpec(settings) {
  const tools = settings?.tools ?? [];
  if (!tools.length || settings.toolChoice === 'none') return null;
  return { kind: 'tool-call', toolChoice: settings.toolChoice ?? 'auto',
    tools: tools.map(tool => ({ name: tool.name, parameters: tool.parameters })) };
}

/**
 * The constraint identity a requester expects in the receipt for these settings, or null
 * when the settings constrain nothing. It is the digest `prepare` reports on a provider.
 */
export async function expectedConstraintIdentity(settings, cryptoApi = globalThis.crypto) {
  const spec = toolConstraintSpec(settings);
  return spec ? digestConstraintIdentity(constraintIdentitySource(spec), cryptoApi) : null;
}

/**
 * Every token id that ends generation for a loaded Doppler scoped session: the model's
 * configured stop tokens and the tokenizer's end-of-sequence token, the same two sources
 * Doppler's decode loop stops on. Read from the session at run time, never assumed.
 */
export function sessionEndTokenIds(session) {
  const advanced = session?.supports?.('advanced') === false ? null : session?.advanced;
  if (typeof advanced?.getStopTokenIds !== 'function' || typeof advanced?.getSpecialTokens !== 'function') {
    throw new Error('Doppler session does not expose its stop tokens; a constrained output could not end');
  }
  const ids = [...advanced.getStopTokenIds(), advanced.getSpecialTokens()?.eos].filter(id => Number.isSafeInteger(id) && id >= 0);
  if (!ids.length) throw new Error('Doppler session reports no stop token; a constrained output could not end');
  return [...new Set(ids)];
}

/**
 * One per loaded model. `prepare(messages, settings, { endTokenIds })` returns the messages
 * to give the model, the generation options to add, and the constraint identity applied:
 *
 * - no declared tools and no tool messages: the input messages, no options, identity null;
 * - tools with `toolChoice` 'none', or tool messages alone: rendered messages only;
 * - otherwise: rendered messages, `logitMaskFn` with `logitMaskIdentity`, and the identity.
 *
 * `endTokenIds()` is called only when a mask is made. Compiled constraints are kept by
 * identity, so equal tool sets reuse one acceptor and the token sets it has already
 * computed. The mask itself is per request: it tracks the tokens generated so far.
 *
 * The token table is built by the first masked step, from the tokenizer Doppler passes to
 * the mask, and is kept per tokenizer for as long as the model stays loaded. The scoped
 * session exposes no tokenizer, so it cannot be built when the model loads.
 */
export function createToolCallEnforcement() {
  const compiled = new Map();
  return Object.freeze({
    async prepare(messages, settings, { endTokenIds }) {
      const declared = (settings?.tools?.length ?? 0) > 0;
      if (!declared && !hasToolMessages(messages)) return { messages, generation: {}, constraintIdentity: null };
      const rendered = renderToolConversation(messages, settings);
      const spec = toolConstraintSpec(settings);
      if (!spec) return { messages: rendered, generation: {}, constraintIdentity: null };
      const identity = await digestConstraintIdentity(constraintIdentitySource(spec));
      let constraint = compiled.get(identity);
      if (constraint) compiled.delete(identity);
      else constraint = await compileConstraintWithIdentity(spec);
      if (constraint.identity !== identity) throw new Error('Compiled constraint identity changed');
      compiled.set(identity, constraint);
      while (compiled.size > MAX_COMPILED) compiled.delete(compiled.keys().next().value);
      return { messages: rendered, constraintIdentity: identity,
        generation: { logitMaskFn: createLogitMask({ constraint, endTokenIds: endTokenIds() }),
          logitMaskIdentity: logitMaskIdentity(constraint) } };
    }
  });
}
