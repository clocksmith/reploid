// @vitest-environment node
import http from 'node:http';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createResponses, parseTextResponse } from '../../server/responses.js';
import { createChatCompletions } from '../../server/chat-completions.js';
import { createMessages } from '../../server/messages.js';
import { bindPreview } from '../helpers/bound-preview.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';
const orderedParticipant = mesh => ({
  ...mesh.meshes[5],
  generate(request, controls) {
    const ids = request.model.partition?.route?.stages?.map(stage => stage.participantId) ?? mesh.identities.map(key => key.peerId);
    const privacy = createExecutionPolicy({ ...request.privacy, recipients: { kind: 'named', ids: [...new Set(ids)] } });
    return mesh.meshes[5].generate({ ...request, privacy }, controls);
  }
});
const preview = (request, recipients=['stage']) => bindPreview(request, {threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,recipients,input:{messages:request.messages,...(request.generationRequest?{generationRequest:request.generationRequest}:{})}});
const model={id:'test-model',identity:'sha256:'+'a'.repeat(64),partition:{prepared:true,participantA:'actual-stage'}};
// The one Reploid extension: the same model pin and execution requirements as reploid/inference prepare().
const named=ids=>({placement:'network-allowed',participants:{kind:'named',ids},confidentiality:'executor-readable',allowMetadata:['model-id','timing','length','access-patterns']});
const extension=(ids,extra={})=>({poolId:'valera-private-pool-v1',model:{identity:model.identity},execution:named(ids),...extra});
const input={model:model.id,input:'hello',store:false}, owners=[];
afterEach(async()=>{for(const close of owners.splice(0).reverse())await close();});
const result=(request,content='hello',reason='eos-token')=>({threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,
  modelIdentity:request.model.identity,content,execution:{stopReason:reason}});
async function boot(overrides={}){
  const generate=vi.fn(async(request,controls)=>{await controls.requestApproval(await preview(request,['actual-stage']));
    for(const [sequence,text] of ['hel','lo'].entries())controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence,text});
    return result(request);
  });
  const participant={roomId:'valera-private-pool-v1',executionClass:'private-pool',getState:()=>({models:[model]}),generate,...overrides.participant};
  const authenticate=vi.fn(async req=>req.headers.authorization==='Bearer local-token'?{subject:'local-user'}:null);
  const authorize=vi.fn(async()=>true), options={authenticate,authorize,...overrides,participant};
  const api=createResponses(options),chat=createChatCompletions(options);
  const server=http.createServer((req,res)=>req.url==='/v1/chat/completions'?chat.handle(req,res):api.handle(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  owners.push(async()=>{await Promise.all([api.close(),chat.close()]);server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}/v1/responses`;
  const post=(body=input,options={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer local-token'},body:JSON.stringify(body),...options});
  return{api,chat,participant,generate,authenticate,authorize,post,url};
}
const events=text=>text.trim().split('\n\n').map(frame=>{const [event,data]=frame.split('\n');const row=JSON.parse(data.slice(6));expect(event).toBe(`event: ${row.type}`);return row;});
it.each(['previous_response_id','conversation','background','response_format','temperature','top_p','seed','metadata','stream_options','reasoning','truncation','include'])('rejects unsupported %s without executing',param=>{
  expect(()=>parseTextResponse({...input,[param]:null})).toThrow(`Unsupported parameter: ${param}`);
});
it.each([true,'false',1])('keeps no responses, so refuses store %j',store=>expect(()=>parseTextResponse({...input,store})).toThrow('Responses are not stored here'));
it.each([undefined,null,false])('accepts store %j: omitted and false both mean the response is not kept',store=>expect(parseTextResponse({...input,store}).messages).toEqual([{role:'user',content:'hello'}]));
it.each([[],Array(129).fill({role:'user',content:'x'}),[{role:'developer',content:'x'}],[{role:'tool',content:'x'}],[{role:'user',content:[{type:'input_text',text:'x'}]}],[{type:'function_call_output',role:'user',content:'x'}],[{role:'user',content:'x',id:'prior'}]])('rejects unimplemented input shape %j',value=>expect(()=>parseTextResponse({...input,input:value,instructions:'system'})).toThrow());
it('mounted route binds instructions and messages to actual authorization, preserving response identity without usage guesses',async()=>{
  const f=await boot(),response=await f.post({...input,instructions:'be concise',input:[{type:'message',role:'assistant',content:'prior'},{role:'user',content:'hello'}]});
  expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({object:'response',model:model.id,status:'completed',store:false,error:null,incomplete_details:null,
    output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'hello'}]}]});
  expect(body.usage).toBeUndefined();expect(body.completed_at).toBeTypeOf('number');expect(response.headers.get('x-reploid-model-identity')).toBe(model.identity);
  expect(f.authorize.mock.calls.map(([r])=>r.action)).toEqual(['chat.execute','chat.disclose']);
  const request=f.generate.mock.calls[0][0];expect(request.messages).toEqual([{role:'system',content:'be concise'},{role:'assistant',content:'prior'},{role:'user',content:'hello'}]);
  expect(Object.isFrozen(request.messages)).toBe(true);
  // The participant runs the authorized request plus the policy the inference API compiled from the standard requirements.
  const {privacy,...authorized}=request;expect(f.authorize.mock.calls[1][0].request).toEqual(authorized);
  expect(privacy).toMatchObject({placement:'network-allowed',recipients:{kind:'open',ids:[]},computation:'plaintext',leakage:['model-id','timing','length','access-patterns','plaintext']});
});
it('streams contiguous typed events with one stable item and a genuine completed terminal',async()=>{
  const f=await boot(),rows=events(await(await f.post({...input,stream:true})).text());
  expect(rows.map(r=>r.type)).toEqual(['response.created','response.in_progress','response.output_item.added','response.content_part.added','response.output_text.delta','response.output_text.delta','response.output_text.done','response.content_part.done','response.output_item.done','response.completed']);
  expect(rows.map(r=>r.sequence_number)).toEqual(rows.map((_,i)=>i));expect(new Set(rows.filter(r=>r.response).map(r=>r.response.id)).size).toBe(1);
  const id=rows[2].item.id;expect(rows.filter(r=>r.item_id).every(r=>r.item_id===id&&r.output_index===0&&r.content_index===0)).toBe(true);
  expect(rows[3].part.text).toBe('');expect(rows.filter(r=>r.type==='response.output_text.delta').map(r=>r.delta).join('')).toBe('hello');
  expect(rows.at(-1).response.output[0].id).toBe(id);expect(rows.at(-1).response.usage).toBeUndefined();
});
it.each([false,true])('max-tokens emits incomplete not completed (stream=%s)',async stream=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(await preview(request));return result(request,'partial','max-tokens');}}}),response=await f.post({...input,stream});
  const value=stream?events(await response.text()).at(-1):await response.json(),body=stream?value.response:value;
  if(stream)expect(value.type).toBe('response.incomplete');expect(body.status).toBe('incomplete');expect(body.completed_at).toBeNull();expect(body.incomplete_details).toEqual({reason:'max_output_tokens'});expect(body.output[0].status).toBe('incomplete');
});
it.each(['context-limit','unknown'])('does not fabricate terminal success or output budget for %s',async reason=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(await preview(request));controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'partial'});return result(request,'partial',reason);}}});
  // context-limit has no Responses mapping (server_error); an unrecognized reason fails the inference result check first.
  const rows=events(await(await f.post({...input,stream:true})).text());expect(rows.at(-1)).toMatchObject({type:'error',code:reason==='unknown'?'result_unverified':'server_error'});
  expect(rows.some(r=>['response.completed','response.incomplete'].includes(r.type))).toBe(false);
  expect((await f.post()).status).toBe(502);
});
it.each(['','no-delta'])('handles complete output without callbacks including empty text %j',async content=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(await preview(request));return result(request,content);}}}),rows=events(await(await f.post({...input,stream:true})).text());
  expect(rows.at(-1).type).toBe('response.completed');expect(rows.at(-1).response.output[0].content[0].text).toBe(content);
});
it('HTTP Responses reaches actual automatic requester and disclosure denial dispatches zero numerical stages',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const f=await boot({participant:orderedParticipant(mesh)}),body={model:mesh.model.id,input:tasks[0].prompt,store:false,stream:true};
  f.authorize.mockImplementation(async({action})=>action==='chat.execute');expect((await f.post(body)).status).toBe(403);
  expect(mesh.states.filter(row=>row.resident).every(row=>row.resident.executeStage.mock.calls.length===0)).toBe(true);
  f.authorize.mockResolvedValue(true);const rows=events(await(await f.post(body)).text());expect(rows.at(-1).response.output[0].content[0].text).toBe(tasks[0].chunks.join(''));
  expect(mesh.loads[5]).not.toHaveBeenCalled();expect(mesh.states[0].resident.executeStage).toHaveBeenCalledTimes(3);expect(mesh.states[1].resident.executeStage).toHaveBeenCalledTimes(3);expect(mesh.states[2].resident.executeStage).toHaveBeenCalledTimes(3);
  expect(mesh.states.every(row=>row.attempts.size===0)).toBe(true);
});
it('shares admission between protocols; disconnect and adapter close keep unsettled work charged without closing borrowed requester',async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let count=0;const signals=[],close=vi.fn();
  const f=await boot({participant:{close,generate:async(request,{signal})=>{signals.push(signal);if(++count===2)entered.resolve();await release.promise;throw Error('unknown cleanup');}}});
  const controller=new AbortController(),first=f.post(input,{signal:controller.signal});first.catch(()=>{});
  const second=fetch(f.url.replace('/responses','/chat/completions'),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer local-token'},body:JSON.stringify({model:model.id,messages:[{role:'user',content:'x'}]})});
  await entered.promise;expect((await f.post()).status).toBe(429);controller.abort();await expect(first).rejects.toThrow();await vi.waitFor(()=>expect(signals[0].aborted).toBe(true));
  expect(f.api.getState().active).toBe(1);expect(f.chat.getState().active).toBe(1);
  let closed=false;const stopping=f.api.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);expect(signals[1].aborted).toBe(false);
  release.resolve();await Promise.all([second,stopping]);expect(f.api.getState().active).toBe(0);expect(close).not.toHaveBeenCalled();
});
it.each(['authenticate','authorize'])('abort while %s awaits cannot execute late approval',async port=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let signal;
  const f=await boot({[port]:async(...args)=>{signal=port==='authenticate'?args[1].signal:args[0].signal;entered.resolve();await release.promise;return port==='authenticate'?{subject:'late'}:true;}});
  const controller=new AbortController(),request=f.post(input,{signal:controller.signal});request.catch(()=>{});await entered.promise;controller.abort();await expect(request).rejects.toThrow();
  await vi.waitFor(()=>expect(signal.aborted).toBe(true));expect(f.api.getState().active).toBe(1);release.resolve();await vi.waitFor(()=>expect(f.api.getState().active).toBe(0));expect(f.generate).not.toHaveBeenCalled();
});
it('authentication failure, unsupported input and wrong output identity never become a successful response',async()=>{
  const f=await boot();expect((await f.post(input,{headers:{'content-type':'application/json'}})).status).toBe(401);
  expect((await f.post({...input,tools:[{type:'web_search'}]})).status).toBe(400);expect(f.generate).not.toHaveBeenCalled();
  f.participant.generate=async request=>({...result(request),attemptId:'different'});expect((await f.post()).status).toBe(502);
});

it('binds a caller token ceiling, JSON output and private recipients to the actual requester, preserving usage and execution', async()=>{
  const ready={...model,textGeneration:{schema:'reploid.text-generation/v1',usage:'raw-model-tokens/v1'}};
  const f=await boot({participant:{getState:()=>({models:[ready]}),generate:async(request,controls)=>{
    expect(request.generationRequest.maxOutputTokens).toBe(2);
    expect(request.messages[0].content).toContain('valid JSON object');
    await controls.requestApproval(await preview(request,['actual-stage']));
    controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:0});
    controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'{"ok":true}'});
    return {...result(request,'{"ok":true}'),usage:{schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:2},execution:{stopReason:'eos-token',stepSummary:{count:2},receipt:{identity:'retained-provider-evidence'}}};
  }}});
  const response=await f.post({...input,stream:true,max_output_tokens:2,text:{format:{type:'json_object'}},reploid:extension(['actual-stage'])});
  expect(response.status).toBe(200);const rows=events(await response.text()),final=rows.at(-1).response;
  expect(final.status).toBe('completed');expect(final.usage).toEqual({input_tokens:7,output_tokens:2,total_tokens:9});
  expect(final.reploid).toMatchObject({executionReceipt:{schema:'reploid.execution-receipt/v1',status:'completed',requested:{model:{identity:model.identity},execution:named(['actual-stage'])},
    route:{shape:'split',participants:['actual-stage'],backend:'doppler-partition-plaintext/v1'}},execution:{receipt:{identity:'retained-provider-evidence'}}});
  // The provider's own receipt is referenced by digest and not described as checked here.
  expect(final.reploid.executionReceipt.evidence.integrity.providerReceipt).toMatchObject({checkedHere:false});
});
it('refuses a changed model binding before generation and recipients outside the private grant before disclosure', async()=>{
  const f=await boot();
  expect((await f.post({...input,reploid:extension(['actual-stage'],{model:{identity:'sha256:'+'f'.repeat(64)}})})).status).toBe(409);expect(f.generate).not.toHaveBeenCalled();
  // A route whose stages are not all named is refused when the plan is prepared, before generation or disclosure.
  const response=await f.post({...input,reploid:extension(['another-stage'])});
  expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('execution_route_unavailable');
  expect(f.authorize.mock.calls.map(([r])=>r.action)).toEqual(['chat.execute']);expect(f.generate).not.toHaveBeenCalled();
});
it('never publishes successful JSON completion for invalid or non-object output', async()=>{
  for(const content of ['not JSON','[]']){
    const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(await preview(request));controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:content});return result(request,content);}}});
    const text=await(await f.post({...input,stream:true,text:{format:{type:'json_object'}}})).text();
    expect(text).toContain('event: error');expect(text).not.toContain('event: response.completed');
  }
});
it.each([null,0,-1,1.5,100000])('rejects invalid caller output ceiling %s',max_output_tokens=>expect(()=>parseTextResponse({...input,max_output_tokens})).toThrow('max_output_tokens'));
it.each([null,{}, {format:{type:'json_schema'}},{format:{type:'json_object',schema:{}}}])('rejects unsupported structured output %j',text=>expect(()=>parseTextResponse({...input,text})).toThrow('text.format'));
it('checks recipients in native input and route stages, including activation-only recipients',async()=>{
  const staged={...model,partition:{prepared:true,route:{stages:[{participantId:'token-owner'},{participantId:'activation-owner'}]}}};
  const f=await boot({participant:{getState:()=>({models:[staged]}),generate:async(request,controls)=>{
    const p=await preview(request);delete p.recipients;p.input.recipients=['token-owner'];p.route={stages:[{participantId:'token-owner'},{participantId:'activation-owner'}]};
    await controls.requestApproval(p);return result(request);
  }}});
  const refused=await f.post({...input,reploid:extension(['token-owner'])});
  expect(refused.status).toBe(503);expect(f.generate).not.toHaveBeenCalled();
  const response=await f.post({...input,reploid:extension(['token-owner','activation-owner'])});
  expect(response.status).toBe(200);expect((await response.json()).reploid.executionReceipt.route.participants).toEqual(['activation-owner','token-owner']);
});
it('does not substitute an unadapted or differently planned model for a pinned adapter/plan',async()=>{
  const f=await boot();
  for(const pin of [{adapterIdentities:['sha256:'+'b'.repeat(64)]},{planIdentity:'sha256:'+'c'.repeat(64)}]){
    const response=await f.post({...input,reploid:extension(['actual-stage'],{model:{identity:model.identity,...pin}})});
    expect(response.status).toBe(409);
  }
  expect(f.generate).not.toHaveBeenCalled();
});
it.each(['public-pool','unknown'])('refuses a requester whose execution class is %s before disclosure',async executionClass=>{
 const f=await boot({participant:{executionClass}});
 const response=await f.post({...input,reploid:extension(['actual-stage'])});
 expect(response.status).toBe(403);expect(f.generate).not.toHaveBeenCalled();
});
it('binds whole-model token ceiling, JSON output and persistent recipient identity without transport UUID drift', async()=>{
  const whole={id:'whole-model',identity:model.identity,availability:'ready',providerIds:['transport-session-1'],
    generation:{maxTokens:64},textGeneration:{schema:'reploid.text-generation/v1',usage:'raw-model-tokens/v1'}};
  const f=await boot({participant:{getState:()=>({models:[whole]}),generate:async(request,controls)=>{
    expect(request.generationRequest.maxOutputTokens).toBe(64);
    await controls.requestApproval(await bindPreview(request,{threadId:request.threadId,attemptId:request.attemptId,modelId:whole.id,modelIdentity:whole.identity,
      adapterIdentities:[],providerId:'transport-session-1',recipientIdentity:'peer:5c0ecd2fd5fd8a105a4f8068',
      recipients:['peer:5c0ecd2fd5fd8a105a4f8068'],input:{messages:request.messages,generationRequest:request.generationRequest}}));
    controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'{"ok":true}'});
    return {threadId:request.threadId,attemptId:request.attemptId,modelId:whole.id,modelIdentity:whole.identity,adapterIdentities:[],
      content:'{"ok":true}',usage:{schema:'raw-model-tokens/v1',inputTokens:9,outputTokens:4},
      execution:{placement:'peer-whole-request',providerId:'transport-session-1',providerIdentity:'peer:5c0ecd2fd5fd8a105a4f8068',
        stopReason:'eos-token',completion:{promptTokenCount:9,generatedTokenCount:4,stopReason:'eos-token'}}};
  }}});
  const response=await f.post({model:whole.id,input:[{role:'user',content:'Return JSON'}],store:false,stream:true,max_output_tokens:64,
    text:{format:{type:'json_object'}},reploid:{poolId:'valera-private-pool-v1',model:{identity:whole.identity,adapterIdentities:[]},
      execution:named(['peer:5c0ecd2fd5fd8a105a4f8068'])}});
  expect(response.status).toBe(200);
  const rows=events(await response.text()),final=rows.at(-1).response;
  expect(final.status).toBe('completed');
  expect(final.usage).toEqual({input_tokens:9,output_tokens:4,total_tokens:13});
  // The persistent signing identity is the receipt's participant; the transport session id never appears in it.
  expect(final.reploid.executionReceipt).toMatchObject({requested:{model:{identity:whole.identity}},
    route:{shape:'remote',participants:['peer:5c0ecd2fd5fd8a105a4f8068'],backend:'doppler-plaintext/v1'}});
  expect(JSON.stringify(final.reploid.executionReceipt)).not.toContain('transport-session-1');
  expect(final.reploid.execution).toMatchObject({providerIdentity:'peer:5c0ecd2fd5fd8a105a4f8068'});
});
it.each(['chat.execute','chat.disclose'])('rejects private-pool drift while %s authorization awaits',async action=>{
  let f;
  f=await boot({authorize:async request=>{if(request.action===action)f.participant.executionClass='public-pool';return true;}});
  const response=await f.post({...input,reploid:extension(['actual-stage'])});
  expect(response.status).toBe(403);
  if(action==='chat.execute')expect(f.generate).not.toHaveBeenCalled();
});

const add={type:'function',name:'add',description:'Add.',parameters:{type:'object',properties:{a:{type:'integer',default:0},b:{type:'integer'}},required:['a','b']}};
it('converts function tools, function_call and function_call_output items to canonical settings and messages, statelessly',()=>{
  const parsed=parseTextResponse({...input,instructions:'be exact',tools:[add],tool_choice:{type:'function',name:'add'},parallel_tool_calls:false,max_output_tokens:9,
    input:[{role:'user',content:'2+3?'},{type:'message',role:'assistant',content:'Adding.'},{type:'function_call',id:'fc_1',status:'completed',call_id:'call_a',name:'add',arguments:'{"a":2,"b":3}'},
      {type:'function_call_output',call_id:'call_a',output:'5'}]});
  expect(parsed.settings).toMatchObject({maxOutputTokens:null,toolChoice:{name:'add'},tools:[{name:'add',description:'Add.',parameters:{type:'object',properties:{a:{type:'integer'},b:{type:'integer'}},required:['a','b']}}]});
  // The call joins the assistant turn it follows; the caller's call id is kept.
  expect(parsed.messages).toEqual([{role:'system',content:'be exact'},{role:'user',content:'2+3?'},
    {role:'assistant',content:'Adding.',toolCalls:[{id:'call_a',name:'add',arguments:{a:2,b:3}}]},{role:'tool',toolCallId:'call_a',content:'5'}]);
  expect(parsed.generationRequest.maxOutputTokens).toBe(9);
  expect(parsed).toMatchObject({declaredToolChoice:{type:'function',name:'add'},parallelToolCalls:false,declaredTools:[{type:'function',name:'add',strict:null}]});
  // No tools is the text contract unchanged: no settings, and items other than messages stay refused.
  expect(parseTextResponse({...input,tools:[],tool_choice:'none'})).not.toHaveProperty('settings');
  expect(()=>parseTextResponse({...input,input:[{type:'function_call_output',call_id:'c',output:'5'}]})).toThrow('Only text message inputs are supported');
  // The statelessness rules are the same with tools.
  expect(()=>parseTextResponse({...input,tools:[add],store:true})).toThrow('store:false');
  expect(()=>parseTextResponse({...input,tools:[add],previous_response_id:'resp_1'})).toThrow('Unsupported parameter: previous_response_id');
});
it.each([
  ['a hosted tool',{tools:[{type:'web_search'}]},'Only function tools'],
  ['the Chat Completions tool shape',{tools:[{type:'function',function:{name:'add'}}]},'Only function tools'],
  ['a schema keyword the constraint does not support',{tools:[{...add,parameters:{type:'object',properties:{a:{type:'integer',minimum:0}}}}]},'Tool "add": Unsupported JSON Schema keyword "minimum"'],
  ['an unknown tool choice',{tools:[add],tool_choice:{type:'function',function:{name:'add'}}},'tool_choice must be'],
  ['a required call without tools',{tool_choice:'required'},"toolChoice must be 'none' when no tools are declared"],
  ['JSON-object output with tools',{tools:[add],text:{format:{type:'json_object'}}},'cannot be combined with tools'],
  ['a function_call whose arguments are not a JSON object',{tools:[add],input:[{role:'user',content:'x'},{type:'function_call',call_id:'c',name:'add',arguments:'[2,3]'},{type:'function_call_output',call_id:'c',output:'5'}]},'JSON object encoded as a string'],
  ['a function_call_output with no call before it',{tools:[add],input:[{role:'user',content:'x'},{type:'function_call_output',call_id:'c',output:'5'}]},'must follow the assistant message'],
  ['a function_call left without its output',{tools:[add],input:[{role:'user',content:'x'},{type:'function_call',call_id:'c',name:'add',arguments:'{}'},{role:'user',content:'y'}]},'exactly one tool result'],
  ['an item of another type',{tools:[add],input:[{type:'reasoning',id:'r'}]},'Only message, function_call and function_call_output'],
  ['a non-string function_call_output',{tools:[add],input:[{role:'user',content:'x'},{type:'function_call',call_id:'c',name:'add',arguments:'{}'},{type:'function_call_output',call_id:'c',output:[{type:'input_text',text:'5'}]}]},'needs string output']
])('rejects %s with a 400',(_label,body,message)=>{
  let thrown;
  try{parseTextResponse({...input,...body});}catch(error){thrown=error;}
  expect(thrown?.status).toBe(400);expect(thrown.message).toContain(message);
});

it('one reploid extension gives one receipt on chat completions, messages and responses; requester-only is refused on all three before generation', async () => {
  const whole={id:'whole-model',identity:'sha256:'+'d'.repeat(64),availability:'ready',providerIds:['provider'],textGeneration:{schema:'reploid.text-generation/v1',usage:'raw-model-tokens/v1'}};
  const recipient='peer:'+'e'.repeat(24);
  const generate=vi.fn(async(request,controls)=>{
    await controls.requestApproval(await bindPreview(request,{threadId:request.threadId,attemptId:request.attemptId,modelId:whole.id,modelIdentity:whole.identity,
      adapterIdentities:[],providerId:'provider',recipientIdentity:recipient,recipients:[recipient],
      input:{messages:request.messages,...(request.generationRequest?{generationRequest:request.generationRequest}:{})}}));
    return {threadId:request.threadId,attemptId:request.attemptId,modelId:whole.id,modelIdentity:whole.identity,adapterIdentities:[],content:'hello',
      usage:{schema:'raw-model-tokens/v1',inputTokens:3,outputTokens:1},execution:{stopReason:'eos-token',completion:{promptTokenCount:3,generatedTokenCount:1,stopReason:'eos-token'}}};
  });
  const options={participant:{roomId:'valera-private-pool-v1',executionClass:'private-pool',getState:()=>({models:[whole]}),generate},
    authenticate:async()=>({subject:'local-user'}),authorize:async()=>true};
  const handlers={'/v1/chat/completions':createChatCompletions(options),'/v1/messages':createMessages(options),'/v1/responses':createResponses(options)};
  const server=http.createServer((req,res)=>handlers[req.url].handle(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  owners.push(async()=>{await Promise.all(Object.values(handlers).map(handler=>handler.close()));server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));});
  const post=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer local-token','x-api-key':'local-token','anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
  const send=reploid=>({'/v1/chat/completions':{model:whole.id,messages:[{role:'user',content:'hi'}],reploid},
    '/v1/messages':{model:whole.id,messages:[{role:'user',content:'hi'}],max_tokens:2,reploid},
    '/v1/responses':{model:whole.id,input:'hi',reploid}});
  const reploid={poolId:'valera-private-pool-v1',model:{identity:whole.identity},execution:named([recipient])};
  const receipts=[];
  for(const [path,body] of Object.entries(send(reploid))){
    const response=await post(path,body);expect(response.status,path).toBe(200);
    const {executionReceipt}=(await response.json()).reploid;
    expect(executionReceipt,path).toMatchObject({schema:'reploid.execution-receipt/v1',api:'reploid.inference/v1',status:'completed'});
    const {requestId:_requestId,attemptId:_attemptId,planId:_planId,...rest}=executionReceipt;receipts.push(rest);
  }
  expect(receipts[0]).toMatchObject({requested:{model:{id:whole.id,identity:whole.identity,adapterIdentities:[]},execution:named([recipient])},
    route:{shape:'remote',participants:[recipient],backend:'doppler-plaintext/v1',protocol:null},
    evidence:{confidentiality:{mode:'executor-readable',contentReadBy:{requesterDevice:false,participants:[recipient]}}}});
  // Same requested policy, same pinned and admitted route, same disclosures and the same evidence on every protocol.
  expect(receipts[1]).toEqual(receipts[0]);expect(receipts[2]).toEqual(receipts[0]);
  expect(generate).toHaveBeenCalledTimes(3);
  const strict={...reploid,execution:{...reploid.execution,confidentiality:'requester-only'}};
  for(const [path,body] of Object.entries(send(strict))){
    const response=await post(path,body),error=(await response.json()).error;
    expect(response.status,path).toBe(422);expect(error.code,path).toBe('confidential_execution_unavailable');
  }
  expect(generate).toHaveBeenCalledTimes(3);
});
