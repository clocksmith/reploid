/** Stateless Anthropic-shaped Messages over declared local token semantics, with client tools. */
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { canonicalTextRequest, parseTextChatCompletion, stripDescriptiveKeywords } from './chat-completions.js';
import { createTextRequester, fail, object, freeze } from './text-requester.js';

const MAX_TOOL_USE_ID = 128, INPUT_FRAGMENT = 96;

function parseTools(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw fail(400, 'tools must be a list of at most 16 client tools', 'tools');
  return value.map((tool, index) => {
    if (!object(tool) || Object.keys(tool).some(key => !['type', 'name', 'description', 'input_schema'].includes(key))
      || ![undefined, 'custom'].includes(tool.type) || !object(tool.input_schema)) {
      throw fail(400, 'Only client tools with name, description and input_schema are supported', `tools[${index}]`);
    }
    return { name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: stripDescriptiveKeywords(tool.input_schema) };
  });
}

function parseToolChoice(value) {
  if (value === undefined) return undefined;
  const choice = object(value) && Object.keys(value).every(key => ['type', 'name', 'disable_parallel_tool_use'].includes(key))
    // Accepted for compatibility. A forced call is constrained to exactly one call either way.
    && [undefined, true, false].includes(value.disable_parallel_tool_use)
    ? { auto: 'auto', any: 'required', none: 'none', tool: typeof value.name === 'string' ? { name: value.name } : null }[value.type] : null;
  if (!choice || (value.type !== 'tool' && value.name !== undefined)) {
    throw fail(400, 'tool_choice must be { type: auto | any | none } or { type: tool, name }', 'tool_choice');
  }
  return choice;
}

const blockText = (blocks, param) => blocks.map(block => {
  if (!object(block) || block.type !== 'text' || typeof block.text !== 'string' || Object.keys(block).some(key => !['type', 'text'].includes(key))) {
    throw fail(400, 'Only text blocks are supported here', param);
  }
  return block.text;
}).join('');

/** One Messages turn as canonical messages. Content blocks are read only in a request that declares
 * tools: an assistant turn may hold `text` and `tool_use`, a user turn `tool_result` then `text`. */
function convertMessage(message, index) {
  const param = `messages[${index}]`;
  if (Object.keys(message).some(key => !['role', 'content'].includes(key))
    || !(typeof message.content === 'string' || (Array.isArray(message.content) && message.content.length))) {
    throw fail(400, 'Message content must be text or a list of text, tool_use and tool_result blocks', param);
  }
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  const kind = message.role === 'assistant' ? 'tool_use' : 'tool_result';
  const tooling = message.content.filter(block => block?.type === kind), text = message.content.filter(block => block?.type !== kind);
  // Results come first in their turn, as the protocol requires, so each stays next to its call.
  if (kind === 'tool_result' && message.content.findLastIndex(block => block?.type === kind) >= tooling.length) {
    throw fail(400, 'tool_result blocks must come before other content in their message', param);
  }
  if (kind === 'tool_use') {
    const toolCalls = tooling.map(block => {
      if (Object.keys(block).some(key => !['type', 'id', 'name', 'input'].includes(key)) || typeof block.id !== 'string' || !block.id
        || block.id.length > MAX_TOOL_USE_ID || typeof block.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(block.name) || !object(block.input)) {
        throw fail(400, 'A tool_use block needs an id, a name and an input object', param);
      }
      return { id: block.id, name: block.name, arguments: block.input };
    });
    return { role: 'assistant', content: blockText(text, param), ...(toolCalls.length ? { toolCalls } : {}) };
  }
  const results = tooling.map(block => {
    if (Object.keys(block).some(key => !['type', 'tool_use_id', 'content', 'is_error'].includes(key)) || typeof block.tool_use_id !== 'string'
      || !block.tool_use_id || block.tool_use_id.length > MAX_TOOL_USE_ID || ![undefined, false].includes(block.is_error)
      || !(block.content === undefined || typeof block.content === 'string' || Array.isArray(block.content))) {
      throw fail(400, 'A tool_result block needs a tool_use_id and text content; is_error is unsupported', param);
    }
    return { role: 'tool', toolCallId: block.tool_use_id, content: typeof block.content === 'string' ? block.content : blockText(block.content ?? [], param) };
  });
  return [...results, ...(text.length ? [{ role: 'user', content: blockText(text, param) }] : [])];
}

export function parseTextMessage(body) {
  if (!object(body)) throw fail(400, 'A JSON object is required');
  for (const key of Object.keys(body)) if (!['model','messages','system','max_tokens','stream','tools','tool_choice'].includes(key)) throw fail(400, `Unsupported parameter: ${key}`, key);
  if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens <= 0 || body.max_tokens > policy.limits.maxTokens) {
    throw fail(400, 'max_tokens must be a positive integer within the route budget; cache-only requests are unsupported', 'max_tokens');
  }
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.some((value,index) => !object(value)
    || !['user','assistant'].includes(value.role) || value.role === body.messages[index-1]?.role)
    || body.messages[0].role !== 'user' || body.messages.at(-1).role !== 'user') {
    throw fail(400, 'Require alternating user/assistant text ending in user; assistant prefill is unsupported', 'messages');
  }
  if (body.system !== undefined && typeof body.system !== 'string') throw fail(400, 'system must be text', 'system');
  const messages = [...(body.system === undefined ? [] : [{role:'system',content:body.system}]), ...body.messages];
  const tools = parseTools(body.tools), toolChoice = parseToolChoice(body.tool_choice);
  // The output ceiling stays the signed generation request it has always been; tools are generation settings.
  const generationRequest = { schema:'reploid.partition-generation-request/v1',maxOutputTokens:body.max_tokens,usage:'raw-model-tokens/v1' };
  // Without tools this is the text contract unchanged: string content only, and no settings.
  if (!tools.length && toolChoice === undefined) return freeze({ ...parseTextChatCompletion({model:body.model,messages,stream:body.stream}), generationRequest });
  return freeze({ ...canonicalTextRequest({ model: body.model, stream: body.stream, messages, convert: convertMessage, tools, toolChoice,
    toolParam: index => `tools[${index}].input_schema` }), generationRequest });
}
const errorBody = error => ({type:'error',error:{type: error.status===401?'authentication_error':error.status===403?'permission_error'
  :error.status===429?'rate_limit_error':error.status<500?'invalid_request_error':'api_error', message:String(error.message).slice(0,1024)}});
export function createMessages(options) {
  // wholeModelUsage: a streamed request asks a whole-model provider for its input count before text.
  return createTextRequester(options,{path:'/v1/messages',idPrefix:'msg_',parse:parseTextMessage,errorBody,wholeModelUsage:true,
    validateRequest(req) {
      if (req.headers['anthropic-version'] !== undefined && req.headers['anthropic-version'] !== '2023-06-01') throw fail(400,'Unsupported anthropic-version');
      if (req.headers['anthropic-beta'] !== undefined) throw fail(400,'Anthropic beta features are unsupported');
    },
    output({id,model,input,write,end,json}) {
      let started=false, textOpen=false, held='';
      const tooling = Boolean(input.settings?.tools.length);
      const usage = value => ({input_tokens:value.inputTokens,output_tokens:value.outputTokens});
      // With tools declared, an answer holds a text block only when there is text; a call is a tool_use block.
      const blocks = (content,toolCalls) => [...(tooling && !content ? [] : [{type:'text',text:content}]),
        ...toolCalls.map(call => ({type:'tool_use',id:call.id,name:call.name,input:call.arguments}))];
      const message = (content,stopReason,counts,toolCalls=[]) => ({id,type:'message',role:'assistant',model,
        content:content===null?[]:blocks(content,toolCalls),stop_reason:stopReason,stop_sequence:null,usage:usage(counts)});
      const frame = (type,value) => `event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
      const event = (type,value) => write(frame(type,value));
      const start = value => { started=true; event('message_start',{message:message(null,null,value)}); };
      const openText = () => { textOpen=true; event('content_block_start',{index:0,content_block:{type:'text',text:''}}); };
      const textDelta = text => event('content_block_delta',{index:0,delta:{type:'text_delta',text}});
      return {
        // The route's own input token observation opens the stream. With tools declared the text
        // block opens with the first text instead, since the answer may be a call and no text.
        usage(value) {
          if (started) throw fail(502,'Duplicate input token observation');
          start(value); if (!tooling) openText();
        },
        // A partition route observes its input tokens before any text, and the requester refuses text
        // that precedes that observation. A whole-model provider reports its count before its first
        // token, and text then streams as it arrives. Only a provider that predates that report sends
        // text first: its text is kept here and the stream opens at completion with the actual count.
        delta(text) {
          if (!started) { held += text; return; }
          if (!textOpen) openText();
          textDelta(text);
        },
        complete(content,finishReason,reason,counts,_evidence,toolCalls=[]) {
          if (!counts) throw fail(502,'Actual provider token usage unavailable');
          if (reason==='context-limit' || reason==='stop-sequence') throw fail(502,'Requester stopping reason lacks a supported Messages mapping');
          const stopReason=finishReason==='tool_calls'?'tool_use':finishReason==='length'?'max_tokens':'end_turn';
          if (!input.stream) {json(message(content,stopReason,counts,toolCalls));return;}
          if (!started) {
            start({inputTokens:counts.inputTokens,outputTokens:0});
            if (held || !tooling) openText();
            if (held) textDelta(held);
          }
          if (textOpen) event('content_block_stop',{index:0});
          // A call arrives here whole and validated: its block opens with an empty input, which follows as JSON fragments.
          toolCalls.forEach((call,position) => {
            const index=position+(textOpen?1:0), encoded=JSON.stringify(call.arguments);
            event('content_block_start',{index,content_block:{type:'tool_use',id:call.id,name:call.name,input:{}}});
            for (let at=0; at<encoded.length; at+=INPUT_FRAGMENT) event('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:encoded.slice(at,at+INPUT_FRAGMENT)}});
            event('content_block_stop',{index});
          });
          event('message_delta',{delta:{stop_reason:stopReason,stop_sequence:null},usage:{output_tokens:counts.outputTokens}});
          end(frame('message_stop',{}));
        },
        error(error) {end(frame('error',{error}));}
      };
    }
  });
}
