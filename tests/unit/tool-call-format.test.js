import { describe, expect, it } from 'vitest';
import { canonicalJson, parseToolCallOutput, renderToolConversation, toolCallId } from '../../shared/infrastructure/tool-call-format.js';

const WEATHER = { name: 'get_weather', description: 'Weather for a "city"', parameters: { type: 'object',
  properties: { city: { type: 'string', description: 'City name' }, unit: { type: 'string', enum: ['c', 'f'] }, days: { type: 'integer' } },
  required: ['city'], additionalProperties: false } };
const CLOCK = { name: 'clock', description: 'Current time', parameters: { type: 'object', properties: {} } };
const settings = (toolChoice = 'auto', tools = [WEATHER, CLOCK]) => ({ schema: 'reploid.generation-settings/v1',
  maxOutputTokens: null, tools, toolChoice, outputSchema: null, thinking: null });
const wrap = (name, args) => `<tool_call>\n{"name": "${name}", "arguments": ${JSON.stringify(args)}}\n</tool_call>`;

describe('renderToolConversation', () => {
  const conversation = [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Weather in Paris and the time?' },
    { role: 'assistant', content: 'Checking.', toolCalls: [
      { id: 'call_1', name: 'get_weather', arguments: { unit: 'c', city: 'Paris' } },
      { id: 'call_2', name: 'clock', arguments: {} }] },
    { role: 'tool', toolCallId: 'call_1', content: '{"temp": 21}' },
    { role: 'tool', toolCallId: 'call_2', content: '12:00' },
    { role: 'user', content: 'Thanks' }
  ];

  it('renders tools, calls and results as plain system, user and assistant text', () => {
    const rendered = renderToolConversation(conversation, settings());
    expect(rendered.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user', 'user']);
    expect(rendered.every(message => Object.keys(message).join() === 'role,content' && typeof message.content === 'string')).toBe(true);
    expect(rendered[0].content.startsWith('Be brief.\n\n# Tools\n\n')).toBe(true);
    expect(rendered[0].content).toContain('<tools>\n{"type": "function", "function": {"name": "get_weather", "description": "Weather for a \\"city\\"", "parameters": {');
    expect(rendered[0].content).toContain('\n{"type": "function", "function": {"name": "clock", "description": "Current time", "parameters": {"properties": {}, "type": "object"}}}\n</tools>');
    expect(rendered[0].content.endsWith('<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>')).toBe(true);
    expect(rendered[2].content).toBe('Checking.\n<tool_call>\n{"name": "get_weather", "arguments": {"city": "Paris", "unit": "c"}}\n</tool_call>\n'
      + '<tool_call>\n{"name": "clock", "arguments": {}}\n</tool_call>');
    expect(rendered[3].content).toBe('<tool_response>\n{"temp": 21}\n</tool_response>\n<tool_response>\n12:00\n</tool_response>');
    expect(rendered[4]).toEqual({ role: 'user', content: 'Thanks' });
    expect(conversation[2].toolCalls).toHaveLength(2);
  });

  it('gives the same text whatever key order the request arrived in', () => {
    const shuffled = [...conversation];
    shuffled[2] = { toolCalls: [{ arguments: { city: 'Paris', unit: 'c' }, name: 'get_weather', id: 'call_1' }, conversation[2].toolCalls[1]],
      content: 'Checking.', role: 'assistant' };
    const reworded = { name: 'get_weather', parameters: { additionalProperties: false, required: ['city'],
      properties: { city: { description: 'City name', type: 'string' }, unit: { enum: ['c', 'f'], type: 'string' }, days: { type: 'integer' } },
      type: 'object' }, description: 'Weather for a "city"' };
    expect(renderToolConversation(shuffled, settings('auto', [reworded, CLOCK]))).toEqual(renderToolConversation(conversation, settings()));
    expect(renderToolConversation(conversation, settings())).toEqual(renderToolConversation(conversation, settings()));
  });

  it('shows properties in declared order, the order constrained output uses', () => {
    const [system] = renderToolConversation([], settings('required', [WEATHER]));
    expect(system.content).toContain('"properties": {"city": {"description": "City name", "type": "string"}, "unit": {"enum": ["c", "f"], "type": "string"}, "days": {"type": "integer"}}');
  });

  it('adds the tools block only when tools may be called', () => {
    const user = [{ role: 'user', content: 'Hi' }];
    expect(renderToolConversation(user, settings())[0]).toMatchObject({ role: 'system', content: expect.stringMatching(/^# Tools\n/) });
    expect(renderToolConversation(user, settings('none'))).toEqual(user);
    expect(renderToolConversation(user, settings('auto', []))).toEqual(user);
    expect(renderToolConversation([{ role: 'system', content: '' }, ...user], settings())[0].content.startsWith('# Tools')).toBe(true);
    // Earlier calls and results still render when this turn offers no tools.
    expect(renderToolConversation(conversation, settings('none')).map(message => message.content).join('\n')).toContain('<tool_response>\n12:00\n</tool_response>');
  });

  it('writes an assistant message that only calls a tool without a leading blank line', () => {
    const rendered = renderToolConversation([{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'clock', arguments: {} }] }], settings('none'));
    expect(rendered).toEqual([{ role: 'assistant', content: '<tool_call>\n{"name": "clock", "arguments": {}}\n</tool_call>' }]);
  });

  it('rejects messages it cannot render', () => {
    expect(() => renderToolConversation([{ role: 'developer', content: 'x' }], settings())).toThrow('Unsupported message role');
    expect(() => renderToolConversation([{ role: 'user', content: null }], settings())).toThrow('string content');
    expect(() => renderToolConversation([{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'clock', arguments: '{}' }] }], settings())).toThrow('arguments object');
  });

  it('writes canonical JSON with sorted keys at every depth', () => {
    expect(canonicalJson({ b: [{ d: 1, c: null }], a: 'x"y', n: 1.5 })).toBe('{"a": "x\\"y", "b": [{"c": null, "d": 1}], "n": 1.5}');
    expect(() => canonicalJson(() => {})).toThrow('JSON');
  });
});

describe('parseToolCallOutput', () => {
  it('returns text outside wrappers and every valid call', () => {
    const output = `Let me check.\n${wrap('get_weather', { city: 'Paris', days: 2 })}\n${wrap('clock', {})}\nDone.`;
    expect(parseToolCallOutput(output, settings())).toEqual({ text: 'Let me check.\n\n\nDone.', complete: true, error: null,
      toolCalls: [{ name: 'get_weather', arguments: { city: 'Paris', days: 2 } }, { name: 'clock', arguments: {} }] });
    expect(parseToolCallOutput('  Just text <b>.  ', settings())).toEqual({ text: 'Just text <b>.', toolCalls: [], complete: true, error: null });
    expect(parseToolCallOutput('<tool_call>{"arguments":{"city":"x"},\n "name":"get_weather"}</tool_call>', settings()).toolCalls).toHaveLength(1);
  });

  it('treats wrappers as text when tools may not be called', () => {
    const output = wrap('clock', {});
    expect(parseToolCallOutput(output, settings('none'))).toEqual({ text: output, toolCalls: [], complete: true, error: null });
    expect(parseToolCallOutput(output, settings('auto', []))).toEqual({ text: output, toolCalls: [], complete: true, error: null });
  });

  it.each([
    ['names undeclared tool "rm"', wrap('rm', {})],
    ['has invalid arguments for "get_weather": $: missing required property "city"', wrap('get_weather', {})],
    ['has invalid arguments for "get_weather": $.days: expected integer', wrap('get_weather', { city: 'x', days: 'two' })],
    ['has invalid arguments for "clock": $: unexpected property "zone"', wrap('clock', { zone: 'utc' })],
    ['is not valid JSON', '<tool_call>\n{"name": "clock", "arguments": {,}}\n</tool_call>'],
    ['must be an object with a "name" string and an "arguments" object', '<tool_call>\n{"name": "clock", "arguments": "{}"}\n</tool_call>'],
    ['is not a JSON object', '<tool_call>\nclock()\n</tool_call>'],
    ['is missing its closing tag', '<tool_call>\n{"name": "clock", "arguments": {}}\nand then more text']
  ])('omits a whole call that %s', (reason, bad) => {
    const result = parseToolCallOutput(`${bad}\n${wrap('clock', {})}`, settings());
    expect(result.error).toBe(`Tool call 1 ${reason}`);
    expect(result.complete).toBe(true);
    expect(result.toolCalls).toEqual([{ name: 'clock', arguments: {} }]);
  });

  it('holds a named choice to its tool and a required choice to a call', () => {
    expect(parseToolCallOutput(wrap('clock', {}), settings({ name: 'get_weather' }))).toEqual({ text: '', toolCalls: [], complete: true,
      error: 'Tool call 1 names "clock" but the tool choice is "get_weather"' });
    expect(parseToolCallOutput(wrap('clock', {}), settings({ name: 'clock' })).toolCalls).toEqual([{ name: 'clock', arguments: {} }]);
    expect(parseToolCallOutput('I would rather talk.', settings('required'))).toEqual({ text: 'I would rather talk.', toolCalls: [], complete: true,
      error: 'The tool choice requires a tool call but the output has none' });
  });

  const calls = [
    wrap('clock', {}),
    wrap('get_weather', { city: 'Par}is "x" </tool_call> \\ {[\n', unit: 'c', days: 3 }),
    `\n<tool_call>{"name":"get_weather","arguments":{"city":"\u00e9\u597d"}}</tool_call>`
  ];

  it.each(calls.map((output, index) => [index, output]))('never offers a cut-off call for execution (call %i)', (index, output) => {
    for (const choice of ['required', { name: JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)).name }]) {
      expect(parseToolCallOutput(output, settings(choice))).toMatchObject({ complete: true, error: null, toolCalls: [{}] });
      for (let length = 0; length < output.length; length += 1) {
        const result = parseToolCallOutput(output.slice(0, length), settings(choice));
        expect(result, JSON.stringify(output.slice(0, length))).toEqual({ text: '', toolCalls: [], complete: false, error: null });
      }
    }
    // Under 'auto' a call exists only once its opening tag is whole; before that the output is text.
    const opened = output.indexOf('<tool_call>') + '<tool_call>'.length;
    for (let length = 0; length < output.length; length += 1) {
      const result = parseToolCallOutput(output.slice(0, length), settings('auto'));
      expect(result.toolCalls, JSON.stringify(output.slice(0, length))).toEqual([]);
      expect(result.complete).toBe(length < opened);
    }
  });

  it('keeps earlier whole calls when a later one is cut off', () => {
    const output = `${wrap('clock', {})}\n${wrap('get_weather', { city: 'Paris' })}`;
    expect(parseToolCallOutput(output.slice(0, -8), settings())).toEqual({ text: '', toolCalls: [{ name: 'clock', arguments: {} }], complete: false, error: null });
  });
});

describe('toolCallId', () => {
  it('is stable per request and index and distinct across them', () => {
    expect(toolCallId('request-1', 0)).toBe(toolCallId('request-1', 0));
    expect(toolCallId('request-1', 0)).toMatch(/^call_[a-f0-9]{24}$/);
    const ids = new Set();
    for (const request of ['request-1', 'request-2', 'request-10']) for (let index = 0; index < 20; index += 1) ids.add(toolCallId(request, index));
    expect(ids.size).toBe(60);
    expect(() => toolCallId('', 0)).toThrow('requestId');
    expect(() => toolCallId('request-1', -1)).toThrow('index');
  });
});
