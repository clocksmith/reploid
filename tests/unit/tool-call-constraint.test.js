// @vitest-environment node
// The provider-side application of tool settings and the requester's expectation of it. The
// session is the scripted stand-in of tests/helpers/tool-round-trip.js: the rendering, the
// compiled constraint and the mask are real; no model runs.
import { expect, it, vi } from 'vitest';
import { compileConstraintWithIdentity } from '../../shared/infrastructure/output-constraint.js';
import { openScopedModelProvider } from '../../shared/infrastructure/scoped-model-provider.js';
import { TOOL_CALL_FORMAT, createToolCallEnforcement, expectedConstraintIdentity, hasToolMessages, modelToolCallFormat,
  sessionEndTokenIds, toolConstraintSpec } from '../../shared/infrastructure/tool-call-constraint.js';
import { normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { NATIVE_WHOLE_MODEL_SETTINGS, nativeWholeModelSettings } from '../../server/native-whole-model.js';
import { readToolOutput } from '../../server/text-requester.js';
import profile from '../../apps/poolday/config/work-profile.json' with { type: 'json' };
import { addCall, addTool, callText, createFakeTokenizer, createScriptedSession } from '../helpers/tool-round-trip.js';

const settings = (toolChoice, extra = {}) => normalizeGenerationSettings({ tools: [addTool], toolChoice, ...extra });
const user = { role: 'user', content: 'What is 2 + 3?' };
const history = [user, { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'add', arguments: { a: 2, b: 3 } }] },
  { role: 'tool', toolCallId: 'call_1', content: '5' }];

it('reads a model tool-call format only when it is the declared, known one', () => {
  expect(modelToolCallFormat({ id: 'm' })).toBeNull();
  expect(modelToolCallFormat({ toolCallFormat: TOOL_CALL_FORMAT })).toBe('reploid.tool-call/hermes-v1');
  for (const unknown of ['hermes', '', null, true, { name: TOOL_CALL_FORMAT }]) {
    expect(() => modelToolCallFormat({ toolCallFormat: unknown })).toThrow('Unknown model toolCallFormat');
  }
  // The native whole-model provider advertises tools for such a model only, and never output schemas or thinking.
  expect(nativeWholeModelSettings({ id: 'm' })).toBe(NATIVE_WHOLE_MODEL_SETTINGS);
  expect(nativeWholeModelSettings({ toolCallFormat: TOOL_CALL_FORMAT })).toEqual({ schema: 'reploid.generation-settings/v1',
    maxOutputTokens: true, tools: true, outputSchema: false, thinking: false });
  expect(() => nativeWholeModelSettings({ toolCallFormat: 'other' })).toThrow('Unknown model toolCallFormat');
});

it('expects the identity of the constraint the settings compile to, and none when nothing is constrained', async () => {
  expect(toolConstraintSpec(undefined)).toBeNull();
  expect(toolConstraintSpec(normalizeGenerationSettings({ maxOutputTokens: 5 }))).toBeNull();
  expect(toolConstraintSpec(settings('none'))).toBeNull();
  expect(await expectedConstraintIdentity(settings('none'))).toBeNull();
  expect(await expectedConstraintIdentity(undefined)).toBeNull();
  const identities = await Promise.all(['auto', 'required', { name: 'add' }].map(choice => expectedConstraintIdentity(settings(choice))));
  expect(identities[0]).toBe((await compileConstraintWithIdentity({ kind: 'tool-call', tools: [addTool], toolChoice: 'auto' })).identity);
  expect(identities[0]).not.toBe(identities[1]);
  // With one declared tool, 'required' and naming that tool admit exactly the same output.
  expect(identities[1]).toBe(identities[2]);
  // The output limit and a description are not part of what the mask admits; a schema change is.
  expect(await expectedConstraintIdentity(settings('required', { maxOutputTokens: 9 }))).toBe(identities[1]);
  expect(await expectedConstraintIdentity(normalizeGenerationSettings({ toolChoice: 'required',
    tools: [{ ...addTool, parameters: { ...addTool.parameters, required: ['a'] } }] }))).not.toBe(identities[1]);
});

it('reads the end tokens from the session at run time and refuses a session that exposes none', () => {
  const session = stops => ({ supports: () => true, advanced: { getStopTokenIds: () => stops.list, getSpecialTokens: () => ({ eos: stops.eos, pad: 3 }) } });
  expect(sessionEndTokenIds(session({ list: [7, 9], eos: 2 }))).toEqual([7, 9, 2]);
  expect(sessionEndTokenIds(session({ list: [7, 7], eos: 7 }))).toEqual([7]);
  expect(sessionEndTokenIds(session({ list: [], eos: 0 }))).toEqual([0]);
  expect(() => sessionEndTokenIds(session({ list: [], eos: undefined }))).toThrow('reports no stop token');
  expect(() => sessionEndTokenIds({ supports: () => false, advanced: session({ list: [7] }).advanced })).toThrow('does not expose its stop tokens');
  expect(() => sessionEndTokenIds({ supports: () => true, advanced: { getSpecialTokens: () => ({ eos: 1 }) } })).toThrow('does not expose its stop tokens');
});

it('prepares nothing for a plain request, renders tool messages, and masks only when a call may be made', async () => {
  const enforcement = createToolCallEnforcement(), endTokenIds = vi.fn(() => [1]);
  expect(hasToolMessages([user])).toBe(false);
  expect(hasToolMessages(history)).toBe(true);
  const plain = [user];
  expect(await enforcement.prepare(plain, undefined, { endTokenIds })).toEqual({ messages: plain, generation: {}, constraintIdentity: null });
  expect((await enforcement.prepare(plain, normalizeGenerationSettings({ maxOutputTokens: 4 }), { endTokenIds })).messages).toBe(plain);
  const none = await enforcement.prepare(history, settings('none'), { endTokenIds });
  expect(none).toMatchObject({ generation: {}, constraintIdentity: null });
  // Tool results in history stay readable; calling being forbidden, no tools are offered.
  expect(none.messages).toEqual([user, { role: 'assistant', content: addCall }, { role: 'user', content: '<tool_response>\n5\n</tool_response>' }]);
  expect(endTokenIds).not.toHaveBeenCalled();

  const forced = await enforcement.prepare([user], settings('required'), { endTokenIds });
  expect(forced.constraintIdentity).toBe(await expectedConstraintIdentity(settings('required')));
  expect(forced.generation.logitMaskIdentity).toEqual({ id: 'reploid.output-constraint/v1', contentDigest: forced.constraintIdentity });
  expect(forced.messages[0]).toMatchObject({ role: 'system' });
  expect(forced.messages[0].content).toContain('<tools>');
  expect(endTokenIds).toHaveBeenCalledTimes(1);
  // The mask leaves only the wrapper's start at the first step, and only the end tokens after a whole call.
  const tokenizer = createFakeTokenizer(), context = generatedIds => ({ generatedIds, tokenizer, vocabSize: tokenizer.vocabSize });
  const allowed = generatedIds => {
    const logits = new Float32Array(tokenizer.vocabSize);
    forced.generation.logitMaskFn(logits, context(generatedIds));
    return [...logits].flatMap((value, id) => (value === 0 ? [tokenizer.texts[id] || `#${id}`] : []));
  };
  expect(allowed([]).sort()).toEqual(['\n', ' ', '<', '<tool_call>'].sort());
  const ids = [];
  for (let rest = addCall; rest;) {
    const id = tokenizer.texts.reduce((best, text, at) => (text && rest.startsWith(text) && text.length > (tokenizer.texts[best] || '').length ? at : best), -1);
    ids.push(id); rest = rest.slice(tokenizer.texts[id].length);
  }
  expect(allowed(ids)).toEqual(['#1', '\n', ' ']);
  // Each request gets its own mask over the one compiled constraint.
  const again = await enforcement.prepare([user], settings('required'), { endTokenIds });
  expect(again.constraintIdentity).toBe(forced.constraintIdentity);
  expect(again.generation.logitMaskFn).not.toBe(forced.generation.logitMaskFn);
  expect(allowed([]).length).toBe(4);
});

async function scopedProvider(sessionOptions = {}, manifest) {
  const model = { id: 'tool-model', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64), toolCallFormat: TOOL_CALL_FORMAT };
  const seen = [];
  const session = { ...createScriptedSession({ model, plan: () => ['The sum is 5.', addCall], seen, ...sessionOptions }), manifest };
  const provider = await openScopedModelProvider({ model, scope: 'test', signal: new AbortController().signal, providerPolicy: profile,
    generation: { maxTokens: 64 }, maxOutcomeCharacters: 4096, service: { open: async () => session } });
  return { provider, seen, session, generate: (messages, requestSettings) => provider.generate(messages, () => {},
    { signal: new AbortController().signal, ...(requestSettings ? { settings: requestSettings } : {}) }) };
}

it('applies the mask through the scoped provider and returns the constraint identity with the result', async () => {
  const f = await scopedProvider();
  const forced = await f.generate([user], settings('required'));
  expect(forced).toMatchObject({ content: addCall, constraintIdentity: await expectedConstraintIdentity(settings('required')),
    completion: { stopReason: 'stop-token' } });
  expect(f.seen[0].options).toMatchObject({ maxTokens: 64, logitMaskIdentity: { contentDigest: forced.constraintIdentity } });
  // Under 'auto' the same model writes the prose it prefers, still under a mask and its identity.
  const free = await f.generate([user], settings('auto'));
  expect(free).toMatchObject({ content: 'The sum is 5.', constraintIdentity: await expectedConstraintIdentity(settings('auto')) });
  const plain = await f.generate([user]);
  expect(plain.content).toBe('The sum is 5.');
  expect(plain).not.toHaveProperty('constraintIdentity');
  expect(f.seen[2].options).not.toHaveProperty('logitMaskFn');
  expect(f.seen[2].messages).toEqual([user]);
});

it('refuses a constrained request when the session cannot end it or the model must open with reasoning', async () => {
  const silent = await scopedProvider();
  silent.session.advanced = { getStats: () => null };
  // Refused before the session is used, so the resident owner keeps the loaded model.
  await expect(silent.generate([user], settings('required'))).rejects.toMatchObject({ recoverableSession: true,
    message: expect.stringContaining('does not expose its stop tokens') });
  await expect(silent.generate([{ role: 'tool', toolCallId: 'c', content: 5 }], settings('auto'))).rejects.toMatchObject({ recoverableSession: true });
  expect(silent.seen).toEqual([]);
  const reasoning = await scopedProvider({}, { inference: { output: { reasoningOutput: { openingToken: { id: 5, text: '<think>' } } } } });
  await expect(reasoning.generate([user], settings('auto'))).rejects.toThrow('declares reasoning output');
  // Neither limit touches a request that constrains nothing.
  await expect(reasoning.generate([user], settings('none'))).resolves.toMatchObject({ content: 'The sum is 5.' });
});

it('reads a completed answer as one validated call, plain text or a cut-off call, and nothing else', () => {
  const read = (content, choice = 'required', finish = 'stop') => readToolOutput(content, settings(choice), finish, 'attempt-1');
  expect(read(addCall)).toEqual({ text: '', finishReason: 'tool_calls',
    toolCalls: [{ id: expect.stringMatching(/^call_[a-f0-9]{24}$/), name: 'add', arguments: { a: 2, b: 3 } }] });
  expect(read(addCall).toolCalls[0].id).toBe(read(`\n${addCall}\n`, 'auto', 'length').toolCalls[0].id);
  expect(read(addCall).toolCalls[0].id).not.toBe(readToolOutput(addCall, settings('required'), 'stop', 'attempt-2').toolCalls[0].id);
  // A whole call stays a call even when the limit was reached right after it.
  expect(read(addCall, 'required', 'length').finishReason).toBe('tool_calls');
  expect(read('The sum is 5.', 'auto')).toEqual({ text: 'The sum is 5.', toolCalls: [], finishReason: 'stop' });
  // Under 'auto' only output that begins with the wrapper is a call: a later wrapper was never constrained and stays text.
  expect(read(`Adding. ${addCall}`, 'auto')).toEqual({ text: `Adding. ${addCall}`, toolCalls: [], finishReason: 'stop' });
  expect(read(' <tool', 'auto', 'length')).toEqual({ text: ' <tool', toolCalls: [], finishReason: 'length' });
  for (const [cut, choice] of [[addCall.slice(0, 30), 'required'], ['<tool_', 'required'], ['', 'required'], [addCall.slice(0, -3), 'auto']]) {
    expect(read(cut, choice, 'length')).toEqual({ text: '', toolCalls: [], finishReason: 'length' });
    expect(() => read(cut, choice, 'stop')).toThrow('Provider ended its output inside a tool call');
  }
  for (const [content, reason] of [
    [callText('add', '{"a": "two", "b": 3}'), 'has invalid arguments for "add"'],
    [callText('subtract', '{"a": 2, "b": 3}'), 'names undeclared tool "subtract"'],
    ['The sum is 5.', 'requires a tool call but the output has none'],
    [`${addCall}\n${addCall}`, 'Provider returned an invalid tool call'],
    [`${addCall} and more`, 'Provider returned an invalid tool call']
  ]) {
    let thrown;
    try { read(content); } catch (error) { thrown = error; }
    expect(thrown?.status).toBe(502);
    expect(thrown.message).toContain(reason);
  }
});
