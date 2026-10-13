/** Stateless text Responses protocol. No response store, continuation lookup or tools. */
import { randomUUID } from 'node:crypto';
import { parseTextChatCompletion } from './chat-completions.js';
import { createTextRequester, fail, object, freeze } from './text-requester.js';

export function parseTextResponse(body) {
  if (!object(body)) throw fail(400, 'A JSON object is required');
  for (const key of Object.keys(body)) if (!['model', 'input', 'instructions', 'store', 'stream'].includes(key)) throw fail(400, `Unsupported parameter: ${key}`, key);
  if (body.store !== false) throw fail(400, 'Stateless Responses requires explicit store:false', 'store');
  if (body.instructions !== undefined && body.instructions !== null && typeof body.instructions !== 'string') throw fail(400, 'instructions must be text', 'instructions');
  let messages;
  if (typeof body.input === 'string') messages = [{ role: 'user', content: body.input }];
  else if (Array.isArray(body.input) && body.input.length > 0 && body.input.length <= 128) messages = body.input.map((value, index) => {
    if (!object(value) || Object.keys(value).some(key => !['type', 'role', 'content'].includes(key))
      || value.type !== undefined && value.type !== 'message') throw fail(400, 'Only text message inputs are supported', `input[${index}]`);
    return { role: value.role, content: value.content };
  });
  else throw fail(400, 'Text input or text messages required', 'input');
  if (typeof body.instructions === 'string') messages.unshift({ role: 'system', content: body.instructions });
  const parsed = parseTextChatCompletion({ model: body.model, messages, stream: body.stream });
  return freeze({ ...parsed, instructions: body.instructions ?? null });
}

export function createResponses(options) {
  return createTextRequester(options, { path: '/v1/responses', idPrefix: 'resp_', parse: parseTextResponse,
    output({ id, created, model, input, write, end, json }) {
      const itemId = 'msg_' + randomUUID().replaceAll('-', '');
      let started = false, sequence = 0;
      const part = text => ({ type: 'output_text', text, annotations: [], logprobs: [] });
      const item = (text, status) => ({ id: itemId, type: 'message', role: 'assistant', status, content: [part(text)] });
      const response = (status, output = []) => ({ id, object: 'response', created_at: created, model, status,
        store: false, background: false, error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
        instructions: input.instructions, output, tools: [], tool_choice: 'none', parallel_tool_calls: false,
        temperature: null, top_p: null, metadata: null, access_programs: null, previous_response_id: null,
        text: { format: { type: 'text' } } });
      const frame = (type, value) => `event: ${type}\ndata: ${JSON.stringify({ ...value, type, sequence_number: sequence++ })}\n\n`;
      const event = (type, value) => write(frame(type, value));
      const position = { item_id: itemId, output_index: 0, content_index: 0 };
      const start = () => {
        if (started) return; started = true;
        event('response.created', { response: response('in_progress') });
        event('response.in_progress', { response: response('in_progress') });
        event('response.output_item.added', { output_index: 0, item: { ...item('', 'in_progress'), content: [] } });
        event('response.content_part.added', { ...position, part: part('') });
      };
      return {
        delta(text) { start(); event('response.output_text.delta', { ...position, delta: text, logprobs: [] }); },
        complete(content, finishReason, reason) {
          // The Responses incomplete enum has no context-limit member. Do not
          // rename a context limit to an output-token budget or successful stop.
          if (reason === 'context-limit') throw fail(502, 'Requester stopped at its context limit');
          const status = finishReason === 'length' ? 'incomplete' : 'completed';
          const finalItem = item(content, status), final = response(status, [finalItem]);
          final.completed_at = status === 'completed' ? Math.floor(Date.now() / 1000) : null;
          if (!input.stream) { json(final); return; }
          start();
          event('response.output_text.done', { ...position, text: content, logprobs: [] });
          event('response.content_part.done', { ...position, part: part(content) });
          event('response.output_item.done', { output_index: 0, item: finalItem });
          event(status === 'completed' ? 'response.completed' : 'response.incomplete', { response: final });
          end();
        },
        error(error) { end(frame('error', { code: 'server_error', message: String(error.message).slice(0, 1024), param: error.param })); }
      };
    }
  });
}
