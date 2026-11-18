/**
 * @fileoverview Tool calls as plain chat text, in the Qwen/Hermes wire format:
 *
 *   <tool_call>
 *   {"name": "<tool name>", "arguments": { ...json object... }}
 *   </tool_call>
 *
 * Doppler's chat templates carry no tools, so the provider renders tools, calls and
 * results into ordinary string messages here and reads calls back out of the output.
 * Rendering is canonical: JSON is written with sorted keys and `, ` / `: ` separators,
 * so a requester and a provider that hash the rendered messages agree. The one order
 * taken from the request is the order of a schema's `properties`, because constrained
 * generation writes arguments in that order and the prompt should show the same one.
 */
import { TOOL_CALL_CLOSE, TOOL_CALL_OPEN, validateAgainstSchema } from './output-constraint.js';

const TOOL_RESPONSE_OPEN = '<tool_response>', TOOL_RESPONSE_CLOSE = '</tool_response>';
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSpace = code => code === 32 || code === 10 || code === 13 || code === 9;

/** JSON with recursively sorted keys and Python-style separators, as Qwen's template writes it. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(', ')}]`;
  if (isPlainObject(value)) {
    const fields = Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}: ${canonicalJson(value[key])}`);
    return `{${fields.join(', ')}}`;
  }
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('Tool data must be JSON');
  return text;
}

// A tool's parameter schema: keywords sorted, declared property order kept.
function canonicalSchemaJson(schema) {
  if (!isPlainObject(schema)) return canonicalJson(schema);
  const fields = Object.keys(schema).sort().filter(key => schema[key] !== undefined).map(key => {
    const value = schema[key];
    if (key === 'items') return `"items": ${canonicalSchemaJson(value)}`;
    if (key !== 'properties' || !isPlainObject(value)) return `${JSON.stringify(key)}: ${canonicalJson(value)}`;
    const declared = Object.keys(value).map(name => `${JSON.stringify(name)}: ${canonicalSchemaJson(value[name])}`);
    return `"properties": {${declared.join(', ')}}`;
  });
  return `{${fields.join(', ')}}`;
}

const wrapper = call => `${TOOL_CALL_OPEN}\n{"name": ${JSON.stringify(call.name)}, "arguments": ${canonicalJson(call.arguments)}}\n${TOOL_CALL_CLOSE}`;

// Tools are offered unless the request declares none or forbids calling them.
function offeredTools(settings) {
  const tools = settings?.tools ?? [];
  if (!Array.isArray(tools)) throw new TypeError('settings.tools must be a list');
  return settings?.toolChoice === 'none' ? [] : tools;
}

function toolsBlock(tools) {
  const lines = tools.map(tool => `{"type": "function", "function": {"name": ${JSON.stringify(tool.name)}, `
    + `"description": ${JSON.stringify(tool.description ?? '')}, "parameters": ${canonicalSchemaJson(tool.parameters)}}}`);
  return ['# Tools', '', 'You may call one or more functions to assist with the user query.', '',
    'You are provided with function signatures within <tools></tools> XML tags:', '<tools>', ...lines, '</tools>', '',
    'For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:',
    TOOL_CALL_OPEN, '{"name": <function-name>, "arguments": <args-json-object>}', TOOL_CALL_CLOSE].join('\n');
}

/**
 * Render a conversation that may hold tool calls and tool results into plain
 * `{ role, content }` messages with roles system, user and assistant.
 *
 * The tools block joins the leading system message (one is created when the
 * conversation has none) when tools are declared and `toolChoice` is not 'none'. An
 * assistant message's `toolCalls` follow its content as wrappers, one per line group.
 * Consecutive tool results become one user message of `<tool_response>` blocks. Call
 * ids are not part of the text: results answer calls by position, as in the format.
 */
export function renderToolConversation(messages, settings) {
  if (!Array.isArray(messages)) throw new TypeError('messages must be a list');
  const rendered = [];
  let responses = [];
  const flush = () => {
    if (responses.length) rendered.push({ role: 'user', content: responses.join('\n') });
    responses = [];
  };
  for (const message of messages) {
    if (!isPlainObject(message) || typeof message.content !== 'string') throw new TypeError('Each message needs string content');
    if (message.role === 'tool') {
      responses.push(`${TOOL_RESPONSE_OPEN}\n${message.content}\n${TOOL_RESPONSE_CLOSE}`);
      continue;
    }
    flush();
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
      throw new TypeError(`Unsupported message role ${JSON.stringify(String(message.role).slice(0, 32))}`);
    }
    const calls = message.role === 'assistant' ? message.toolCalls ?? [] : [];
    if (!Array.isArray(calls) || !calls.every(call => isPlainObject(call) && typeof call.name === 'string' && isPlainObject(call.arguments))) {
      throw new TypeError('Each tool call needs a name and an arguments object');
    }
    rendered.push({ role: message.role, content: [message.content, ...calls.map(wrapper)].filter(Boolean).join('\n') });
  }
  flush();
  const tools = offeredTools(settings);
  if (tools.length) {
    const block = toolsBlock(tools);
    if (rendered[0]?.role === 'system') {
      rendered[0] = { role: 'system', content: rendered[0].content ? `${rendered[0].content}\n\n${block}` : block };
    } else rendered.unshift({ role: 'system', content: block });
  }
  return rendered;
}

// End of the JSON object that starts at `start`: -1 when the text stops inside it.
function jsonObjectEnd(text, start) {
  let depth = 0, quoted = false;
  for (let i = start; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (quoted) {
      if (code === 92) i += 1;
      else if (code === 34) quoted = false;
    } else if (code === 34) quoted = true;
    else if (code === 123 || code === 91) depth += 1;
    else if (code === 125 || code === 93) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const skipSpace = (text, from) => {
  let at = from;
  while (at < text.length && isSpace(text.charCodeAt(at))) at += 1;
  return at;
};

/**
 * Read tool calls out of generated text.
 *
 * `text` is the content outside call wrappers, trimmed. `toolCalls` holds only calls
 * that are whole, name a declared tool (the named one when `toolChoice` is `{ name }`)
 * and carry arguments valid for that tool's `parameters`. `complete` is false when the
 * output stops inside a wrapper, or, when a call is required, before one has begun:
 * the cut-off call is dropped and never offered for execution. `error` describes the
 * first whole call that was rejected, or a required call that is missing.
 *
 * With `toolChoice` 'none', or no declared tools, wrappers are plain text. With 'auto',
 * output that ends inside the opening tag itself is still plain text.
 */
export function parseToolCallOutput(content, settings) {
  if (typeof content !== 'string') throw new TypeError('content must be a string');
  const tools = offeredTools(settings);
  if (!tools.length) return { text: content.trim(), toolCalls: [], complete: true, error: null };
  const choice = settings.toolChoice ?? 'auto', named = isPlainObject(choice) ? choice.name : null;
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const toolCalls = [];
  let text = '', complete = true, error = null, at = 0, wrappers = 0;
  const reject = reason => {
    error ??= `Tool call ${wrappers} ${reason}`;
  };
  const quote = name => JSON.stringify(String(name).slice(0, 64));

  const accept = json => {
    let call;
    try {
      call = JSON.parse(json);
    } catch {
      return reject('is not valid JSON');
    }
    if (!isPlainObject(call) || typeof call.name !== 'string' || !isPlainObject(call.arguments)) {
      return reject('must be an object with a "name" string and an "arguments" object');
    }
    const tool = byName.get(call.name);
    if (!tool) return reject(`names undeclared tool ${quote(call.name)}`);
    if (named !== null && call.name !== named) return reject(`names ${quote(call.name)} but the tool choice is ${quote(named)}`);
    const verdict = validateAgainstSchema(tool.parameters, call.arguments);
    if (!verdict.valid) return reject(`has invalid arguments for ${quote(call.name)}: ${verdict.error}`);
    return toolCalls.push({ name: call.name, arguments: call.arguments });
  };

  while (at < content.length) {
    const open = content.indexOf(TOOL_CALL_OPEN, at);
    text += content.slice(at, open < 0 ? content.length : open);
    if (open < 0) break;
    wrappers += 1;
    const body = skipSpace(content, open + TOOL_CALL_OPEN.length);
    const end = content[body] === '{' ? jsonObjectEnd(content, body) : -1;
    if (end < 0) {
      // Nothing but an unfinished object follows the tag: the output was cut off.
      if (body === content.length || content[body] === '{') {
        complete = false;
        break;
      }
      reject('is not a JSON object');
      const close = content.indexOf(TOOL_CALL_CLOSE, body);
      at = close < 0 ? content.length : close + TOOL_CALL_CLOSE.length;
      continue;
    }
    const tail = skipSpace(content, end);
    if (content.startsWith(TOOL_CALL_CLOSE, tail)) {
      accept(content.slice(body, end));
      at = tail + TOOL_CALL_CLOSE.length;
    } else if (TOOL_CALL_CLOSE.startsWith(content.slice(tail))) {
      complete = false;
      break;
    } else {
      reject('is missing its closing tag');
      at = end;
    }
  }

  text = text.trim();
  if (wrappers === 0 && (choice === 'required' || named !== null)) {
    // A required call that has not begun: cut off if only the start of the tag is there.
    if (TOOL_CALL_OPEN.startsWith(text)) return { text: '', toolCalls, complete: false, error };
    error = 'The tool choice requires a tool call but the output has none';
  }
  return { text, toolCalls, complete, error };
}

function mix(text, seed) {
  let hash = seed;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0).toString(16).padStart(8, '0');
}

/**
 * A stable id for the `index`-th call of a request: the same request and index give the
 * same id on every retry. It is a label, not a secret or a proof.
 */
export function toolCallId(requestId, index) {
  if (typeof requestId !== 'string' || !requestId) throw new TypeError('requestId must be a non-empty string');
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('index must be a non-negative integer');
  const text = `${index}\n${requestId}`;
  return `call_${mix(text, 0x811c9dc5)}${mix(text, 0x9e3779b9)}${mix(text, 0x7f4a7c15)}`;
}
