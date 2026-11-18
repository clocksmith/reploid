/** Text Chat Completions protocol over the existing authenticated HTTP requester. */
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { createTextRequester, fail, object, freeze } from './text-requester.js';
import { normalizeGenerationSettings } from '../packages/reploid/src/mesh/generation-settings.js';

export function parseTextChatCompletion(body) {
  if (!object(body)) throw fail(400, 'A JSON object is required');
  for (const key of Object.keys(body)) if (!['model', 'messages', 'stream', 'max_completion_tokens', 'max_tokens'].includes(key)) throw fail(400, `Unsupported parameter: ${key}`, key);
  // The caller's output limit is the only generation setting this protocol accepts. It becomes a
  // settings object that the provider enforces; `max_tokens` is the older name for the same limit.
  let maxOutputTokens;
  for (const key of ['max_completion_tokens', 'max_tokens']) {
    if (body[key] === undefined) continue;
    if (!Number.isSafeInteger(body[key]) || body[key] <= 0 || body[key] > policy.limits.maxTokens) {
      throw fail(400, `${key} must be a positive integer within the route budget`, key);
    }
    if (maxOutputTokens !== undefined && maxOutputTokens !== body[key]) throw fail(400, 'max_completion_tokens and max_tokens differ', key);
    maxOutputTokens = body[key];
  }
  if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 256) throw fail(400, 'A bounded model id is required', 'model');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw fail(400, 'stream must be boolean', 'stream');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 128) throw fail(400, 'Require 1–128 text messages', 'messages');
  let characters = 0;
  const messages = body.messages.map((message, index) => {
    const param = `messages[${index}]`;
    if (!object(message) || Object.keys(message).some(key => !['role', 'content'].includes(key))
      || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw fail(400, 'Only system/user/assistant string-content messages are supported', param);
    }
    characters += message.content.length;
    if (characters > policy.inputLimits.maxInputCharacters) throw fail(413, 'Input text limit exceeded', 'messages');
    return { role: message.role, content: message.content };
  });
  return freeze({ model: body.model, messages, stream: body.stream === true,
    ...(maxOutputTokens === undefined ? {} : { settings: normalizeGenerationSettings({ maxOutputTokens }) }) });
}


export function createChatCompletions(options) {
  return createTextRequester(options, { path: '/v1/chat/completions', idPrefix: 'chatcmpl-', parse: parseTextChatCompletion,
    output({ id, created, model, input, write, end, json }) {
      let started = false;
      const chunk = (delta, finishReason = null, usage = undefined) => write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, ...(usage ? { usage } : {}),
        choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }] })}\n\n`);
      return {
        delta(text) { chunk({ ...(started ? {} : { role: 'assistant' }), content: text }); started = true; },
        complete(content, finishReason, _reason, measured) {
          const usage = measured ? { prompt_tokens: measured.inputTokens, completion_tokens: measured.outputTokens,
            total_tokens: measured.inputTokens + measured.outputTokens } : undefined;
          if (input.stream) { chunk({}, finishReason, usage); end('data: [DONE]\n\n'); }
          else json({ id, object: 'chat.completion', created, model, ...(usage ? { usage } : {}),
            choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, logprobs: null, finish_reason: finishReason }] });
        },
        error(error) { end(`data: ${JSON.stringify({ error })}\n\n`); }
      };
    }
  });
}
