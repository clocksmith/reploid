/** Stateless Anthropic-shaped text Messages over declared local token semantics. */
import policy from '../self/config/partition-policy.json' with { type: 'json' };
import { parseTextChatCompletion } from './chat-completions.js';
import { createTextRequester, fail, object, freeze } from './text-requester.js';

export function parseTextMessage(body) {
  if (!object(body)) throw fail(400, 'A JSON object is required');
  for (const key of Object.keys(body)) if (!['model','messages','system','max_tokens','stream'].includes(key)) throw fail(400, `Unsupported parameter: ${key}`, key);
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
  return freeze({ ...parseTextChatCompletion({model:body.model,messages,stream:body.stream}), generationRequest: {
    schema:'reploid.partition-generation-request/v1',maxOutputTokens:body.max_tokens,usage:'raw-model-tokens/v1' } });
}
const errorBody = error => ({type:'error',error:{type: error.status===401?'authentication_error':error.status===403?'permission_error'
  :error.status===429?'rate_limit_error':error.status<500?'invalid_request_error':'api_error', message:String(error.message).slice(0,1024)}});
export function createMessages(options) {
  return createTextRequester(options,{path:'/v1/messages',idPrefix:'msg_',parse:parseTextMessage,errorBody,
    validateRequest(req) {
      if (req.headers['anthropic-version'] !== undefined && req.headers['anthropic-version'] !== '2023-06-01') throw fail(400,'Unsupported anthropic-version');
      if (req.headers['anthropic-beta'] !== undefined) throw fail(400,'Anthropic beta features are unsupported');
    },
    output({id,model,input,write,end,json}) {
      let started=false;
      const usage = value => ({input_tokens:value.inputTokens,output_tokens:value.outputTokens});
      const message = (content,stopReason,counts) => ({id,type:'message',role:'assistant',model,
        content:content===null?[]:[{type:'text',text:content}],stop_reason:stopReason,stop_sequence:null,usage:usage(counts)});
      const frame = (type,value) => `event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
      const event = (type,value) => write(frame(type,value));
      return {
        usage(value) {
          if (started) throw fail(502,'Duplicate input token observation'); started=true;
          event('message_start',{message:message(null,null,value)});
          event('content_block_start',{index:0,content_block:{type:'text',text:''}});
        },
        delta(text) { if(!started)throw fail(502,'Input token usage unavailable'); event('content_block_delta',{index:0,delta:{type:'text_delta',text}}); },
        complete(content,finishReason,reason,counts) {
          if (!counts) throw fail(502,'Actual provider token usage unavailable');
          if (reason==='context-limit' || reason==='stop-sequence') throw fail(502,'Requester stopping reason lacks a supported Messages mapping');
          const stopReason=finishReason==='length'?'max_tokens':'end_turn';
          if (!input.stream) {json(message(content,stopReason,counts));return;}
          event('content_block_stop',{index:0});
          event('message_delta',{delta:{stop_reason:stopReason,stop_sequence:null},usage:{output_tokens:counts.outputTokens}});
          end(frame('message_stop',{}));
        },
        error(error) {end(frame('error',{error}));}
      };
    }
  });
}
