// @vitest-environment node
import http from 'node:http';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createMessages, parseTextMessage } from '../../server/messages.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';
import { bindPreview } from '../helpers/bound-preview.js';
const capability={schema:'reploid.text-generation/v1',usage:'raw-model-tokens/v1'};
const orderedParticipant = mesh => ({
  ...mesh.meshes[5],
  generate(request, controls) {
    const ids = request.model.partition?.route?.stages?.map(stage => stage.participantId) ?? mesh.identities.map(key => key.peerId);
    const privacy = createExecutionPolicy({ ...request.privacy, recipients: { kind: 'named', ids: [...new Set(ids)] } });
    return mesh.meshes[5].generate({ ...request, privacy }, controls);
  }
});
const preview = (request, recipients=['stage']) => bindPreview(request, {threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,recipients,input:{messages:request.messages,...(request.generationRequest?{generationRequest:request.generationRequest}:{})}});
const model={id:'test-model',identity:'sha256:'+'a'.repeat(64),partition:{prepared:true,participantA:'actual-stage'},textGeneration:capability};
const input={model:model.id,messages:[{role:'user',content:'hello'}],max_tokens:2},owners=[];
afterEach(async()=>{for(const close of owners.splice(0).reverse())await close();});
async function boot(overrides={}){
  const generate=vi.fn(async(request,controls)=>{await controls.requestApproval(await preview(request,['actual-stage']));
    await controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:0});
    controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'hello'});
    return {threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,content:'hello',
      usage:{schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:1},execution:{stopReason:'stop-token',stepSummary:{count:1}}};
  });
  const participant={getState:()=>({models:[model]}),generate,...overrides.participant};
  const authenticate=vi.fn(async req=>req.headers['x-api-key']==='local-token'?{subject:'local-user'}:null),authorize=vi.fn(async()=>true);
  const api=createMessages({authenticate,authorize,...overrides,participant}),server=http.createServer(api.handle);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));owners.push(async()=>{await api.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}/v1/messages`,post=(body=input,options={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-api-key':'local-token','anthropic-version':'2023-06-01'},body:JSON.stringify(body),...options});
  return{api,post,url,generate,participant,authenticate,authorize};
}
const events=text=>text.trim().split('\n\n').map(frame=>{const[event,data]=frame.split('\n');const row=JSON.parse(data.slice(6));expect(event).toBe(`event: ${row.type}`);return row;});
it.each(['thinking','output_config','temperature','top_p','top_k','seed','stop_sequences','metadata','service_tier','container'])('rejects unsupported %s',param=>expect(()=>parseTextMessage({...input,[param]:null})).toThrow(`Unsupported parameter: ${param}`));
it.each([undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1])('rejects unsupported output ceiling %s before generation',max_tokens=>expect(()=>parseTextMessage({...input,max_tokens})).toThrow('max_tokens'));
it.each([[{role:'assistant',content:'prefill'}],[{role:'system',content:'hidden'}],[{role:'user',content:'a'},{role:'user',content:'b'}],[{role:'user',content:[{type:'text',text:'a'}]}]])('rejects unsupported prompt shape %j',messages=>expect(()=>parseTextMessage({...input,messages})).toThrow());
it('authenticates immutable caller ceiling, actual disclosure and input/output token observations',async()=>{
  const f=await boot(),response=await f.post({...input,system:'be terse'}),body=await response.json();expect(response.status).toBe(200);
  expect(body).toMatchObject({type:'message',role:'assistant',model:model.id,content:[{type:'text',text:'hello'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:7,output_tokens:1}});
  const request=f.generate.mock.calls[0][0];expect(Object.isFrozen(request.generationRequest)).toBe(true);expect(request.generationRequest.maxOutputTokens).toBe(2);
  expect(request.messages[0]).toEqual({role:'system',content:'be terse'});expect(f.authorize.mock.calls.map(([row])=>row.action)).toEqual(['chat.execute','chat.disclose']);
});
it('streams observed input usage before text and final cumulative raw output count',async()=>{
  const f=await boot(),rows=events(await(await f.post({...input,stream:true})).text());
  expect(rows.map(r=>r.type)).toEqual(['message_start','content_block_start','content_block_delta','content_block_stop','message_delta','message_stop']);
  expect(rows[0].message.usage).toEqual({input_tokens:7,output_tokens:0});expect(rows[4]).toMatchObject({delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
});
it('actual HTTP/automatic/grant/peer chain enforces a smaller cap and reports tokenizer and sampler counts',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const last=mesh.states[2].resident,execute=last.executeStage.getMockImplementation();
  last.executeStage.mockImplementation(async request=>({...await execute(request),done:request.step+1===request.maxTokens,stopReason:'max-tokens'}));
  const f=await boot({participant:orderedParticipant(mesh)}),response=await f.post({model:mesh.model.id,messages:[{role:'user',content:tasks[0].prompt}],max_tokens:2,stream:true});
  expect(response.status).toBe(200);const rows=events(await response.text());expect(rows[0].message.usage).toEqual({input_tokens:2,output_tokens:0});
  expect(rows.at(-2)).toMatchObject({type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:2}});expect(last.executeStage).toHaveBeenCalledTimes(2);
  expect(last.executeStage.mock.calls.every(([r])=>r.maxTokens===2&&r.generation.maxTokens===2)).toBe(true);expect(mesh.states.every(row=>row.attempts.size===0)).toBe(true);
  expect(f.authorize.mock.calls[1][0].preview.input.generationRequest.maxOutputTokens).toBe(2);
});
it('recipient denial after execution approval dispatches no stages',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const f=await boot({participant:orderedParticipant(mesh),authorize:async({action})=>action==='chat.execute'});
  expect((await f.post({model:mesh.model.id,messages:[{role:'user',content:tasks[0].prompt}],max_tokens:2})).status).toBe(403);
  expect(mesh.states.filter(row=>row.resident).every(row=>row.resident.executeStage.mock.calls.length===0)).toBe(true);
});
it.each(['missing','late','different-attempt','duplicate','changed-final','over-cap'])('refuses %s usage rather than inventing protocol counts',async kind=>{
  const f=await boot();f.participant.generate=async(request,controls)=>{
    await controls.requestApproval(await preview(request));
    const event={threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:0};
    const delta=()=>controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'x'});
    if(kind==='late')delta();if(kind==='different-attempt')event.attemptId='wrong';
    if(kind!=='missing')await controls.onUsage(event);if(kind==='duplicate')await controls.onUsage(event);if(kind!=='late')delta();
    return {...request,modelId:model.id,modelIdentity:model.identity,content:'x',execution:{stopReason:'stop-token',stepSummary:{count:1}},usage:{schema:'raw-model-tokens/v1',inputTokens:kind==='changed-final'?8:7,outputTokens:kind==='over-cap'?3:1}};
  };
  const response=await f.post({...input,stream:true});if(response.status===200){const rows=events(await response.text());expect(rows.at(-1).type).toBe('error');expect(rows.some(r=>r.type==='message_stop')).toBe(false);}else expect(response.status).toBe(502);
});
it('cancellation keeps unresolved HTTP admission charged and cannot publish a late terminal',async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let signal;
  const f=await boot({participant:{generate:async(request,controls)=>{signal=controls.signal;entered.resolve();await release.promise;throw Error('unsettled owner');}}});
  const controller=new AbortController(),request=f.post(input,{signal:controller.signal});request.catch(()=>{});await entered.promise;controller.abort();await expect(request).rejects.toThrow();
  await vi.waitFor(()=>expect(signal.aborted).toBe(true));expect(f.api.getState().active).toBe(1);release.resolve();await vi.waitFor(()=>expect(f.api.getState().active).toBe(0));
});
it('does not invent counts for an old route, accepts no unauthorized request and rejects unknown protocol headers',async()=>{
  const f=await boot({participant:{getState:()=>({models:[{...model,textGeneration:undefined}]})}});expect((await f.post()).status).toBe(502);expect(f.generate).not.toHaveBeenCalled();
  const denied=await f.post(input,{headers:{'content-type':'application/json'}});expect(denied.status).toBe(401);expect((await denied.json()).error.type).toBe('authentication_error');
  expect((await f.post(input,{headers:{'content-type':'application/json','x-api-key':'local-token','anthropic-version':'unknown'}})).status).toBe(400);
});
it.each(['missing','pending','denied'])('refuses output while disclosure is %s even if borrowed provider violates callback contract',async mode=>{
  const gate=Promise.withResolvers(),f=await boot({authorize:async({action})=>action==='chat.execute'?true:mode==='pending'?gate.promise:false});
  f.participant.generate=async(request,controls)=>{
    if(mode!=='missing'){const approval=preview(request,['unapproved']).then(value=>controls.requestApproval(value));approval.catch(()=>{});if(mode==='denied')await approval.catch(()=>{});}
    await controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:1,outputTokens:0});
    throw Error('should not get here');
  };
  try{const response=await f.post({...input,stream:true}),text=await response.text();expect(response.status).toBe(mode==='denied'?403:502);expect(text).not.toContain('message_start');expect(text).not.toContain('message_stop');}finally{gate.resolve(true);}
});
it.each(['input','output','schema'])('validates final-only %s usage before emitting fallback text',async field=>{
  const f=await boot();f.participant.generate=async(request,controls)=>{
    await controls.requestApproval(await preview(request,['approved']));await controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:2,outputTokens:0});
    return {...request,modelId:model.id,modelIdentity:model.identity,content:'UNVALIDATED_FINAL_TEXT',execution:{stopReason:'stop-token',stepSummary:{count:1}},
      usage:{schema:field==='schema'?'wrong':'raw-model-tokens/v1',inputTokens:field==='input'?3:2,outputTokens:field==='output'?0:1}};
  };
  const text=await(await f.post({...input,stream:true})).text();expect(text).toContain('event: error');expect(text).not.toContain('UNVALIDATED_FINAL_TEXT');expect(text).not.toContain('message_stop');
});
it.each(['thread','attempt','model','messages','cap'])('unrelated disclosure %s cannot unlock output',async field=>{
  const f=await boot();f.participant.generate=async(request,controls)=>{
    const p=structuredClone(await preview(request));if(field==='thread')p.threadId='other';if(field==='attempt')p.attemptId='other';if(field==='model')p.modelIdentity='other';if(field==='messages')p.input.messages[0].content='different';if(field==='cap')p.input.generationRequest.maxOutputTokens++;
    await controls.requestApproval(p);throw Error('should not execute');
  };
  const response=await f.post({...input,stream:true});expect(response.status).toBe(502);expect(f.authorize.mock.calls.map(([row])=>row.action)).toEqual(['chat.execute']);
});
it('callbacks retained by a completed provider cannot publish late output or approval',async()=>{
  const f=await boot(),generate=f.participant.generate;let request,controls;
  f.participant.generate=async(r,c)=>{request=r;controls=c;return generate(r,c);};
  expect((await f.post()).status).toBe(200);await vi.waitFor(()=>expect(f.api.getState().active).toBe(0));
  expect(()=>controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:1,text:'late'})).toThrow();
  await expect(controls.requestApproval(await preview(request))).rejects.toThrow();expect(f.authorize).toHaveBeenCalledTimes(2);
});

// A whole-model route: no partition, and the provider may report its input count before its first text.
const whole={id:'whole-model',identity:'sha256:'+'b'.repeat(64),availability:'ready',providerIds:['provider'],textGeneration:capability},wholeInput={...input,model:whole.id};
const wholeResult=(request,content,inputTokens,outputTokens)=>({threadId:request.threadId,attemptId:request.attemptId,modelId:whole.id,modelIdentity:whole.identity,adapterIdentities:[],content,
  usage:{schema:'raw-model-tokens/v1',inputTokens,outputTokens},execution:{stopReason:'stop-token',completion:{promptTokenCount:inputTokens,generatedTokenCount:outputTokens}}});
const wholeBoot=script=>boot({participant:{getState:()=>({models:[whole]}),generate:async(request,controls)=>{
  await controls.requestApproval(await preview(request,['provider']));let sequence=0;
  return script({request,controls,usage:inputTokens=>controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens,outputTokens:0}),
    delta:text=>controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:sequence++,text})});}}});
it('opens a whole-model stream with the early input count and sends text before the provider has finished',async()=>{
  const held=Promise.withResolvers();let finished=false;
  const f=await wholeBoot(async({request,usage,delta})=>{await usage(7);delta('he');await held.promise;delta('llo');finished=true;return wholeResult(request,'hello',7,2);});
  const response=await f.post({...wholeInput,stream:true}),reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  try{
    // Fails, instead of waiting for ever, when no text arrives while the provider is held open.
    const arrive=()=>{let timer;return Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('No text reached the client while the provider was held open')),2000);})]).finally(()=>clearTimeout(timer));};
    while(!text.includes('text_delta')){const part=await arrive();if(part.done)throw Error(`The response ended without text: ${text}`);text+=decoder.decode(part.value,{stream:true});}
    const early=events(text);expect(early.map(r=>r.type)).toEqual(['message_start','content_block_start','content_block_delta']);
    expect(early[0].message.usage).toEqual({input_tokens:7,output_tokens:0});expect(early[2].delta).toEqual({type:'text_delta',text:'he'});expect(finished).toBe(false);
    held.resolve();for(let part=await reader.read();!part.done;part=await reader.read())text+=decoder.decode(part.value,{stream:true});
    const rows=events(text);expect(rows.map(r=>r.type)).toEqual(['message_start','content_block_start','content_block_delta','content_block_delta','content_block_stop','message_delta','message_stop']);
    expect(rows[3].delta.text).toBe('llo');expect(rows[5]).toMatchObject({delta:{stop_reason:'end_turn'},usage:{output_tokens:2}});
  }finally{held.resolve();await reader.cancel().catch(()=>{});}
});
it('holds whole-model text until completion only when no input count arrived before it, and asks for the count only when streaming',async()=>{
  const asked=[],f=await wholeBoot(async({request,controls,delta})=>{asked.push(typeof controls.onUsage);delta('he');delta('llo');return wholeResult(request,'hello',7,2);});
  const rows=events(await(await f.post({...wholeInput,stream:true})).text());
  expect(rows.map(r=>r.type)).toEqual(['message_start','content_block_start','content_block_delta','content_block_stop','message_delta','message_stop']);
  expect(rows[0].message.usage).toEqual({input_tokens:7,output_tokens:0});expect(rows[2].delta.text).toBe('hello');expect(rows[4].usage).toEqual({output_tokens:2});
  expect(await(await f.post(wholeInput)).json()).toMatchObject({content:[{type:'text',text:'hello'}],usage:{input_tokens:7,output_tokens:2}});
  // An unstreamed response publishes no early count, so it does not ask a whole-model route for one.
  expect(asked).toEqual(['function','undefined']);
});
it.each(['changed-final','duplicate','late','zero'])('refuses a whole-model stream whose early input count is %s',async kind=>{
  const f=await wholeBoot(async({request,usage,delta})=>{
    if(kind==='late')delta('x');await usage(kind==='zero'?0:7);if(kind==='duplicate')await usage(7);if(kind!=='late')delta('x');
    return wholeResult(request,'x',kind==='changed-final'?8:7,1);});
  const response=await f.post({...wholeInput,stream:true}),text=await response.text();expect(text).not.toContain('message_stop');
  // The stream opens with the first accepted count, so a later refusal is its error event; before that it is a 502.
  if(['changed-final','duplicate'].includes(kind)){const rows=events(text);expect(rows[0].message.usage.input_tokens).toBe(7);expect(rows.at(-1).type).toBe('error');expect(rows.some(r=>r.type==='message_delta')).toBe(false);}
  else{expect(response.status).toBe(502);expect(text).not.toContain('message_start');}
});

const add={name:'add',description:'Add.',input_schema:{type:'object',properties:{a:{type:'integer',default:0},b:{type:'integer'}},required:['a','b']}};
it('converts tools, tool choice, tool_use and tool_result blocks to canonical settings and messages',()=>{
  const parsed=parseTextMessage({...input,system:'be exact',tools:[add,{type:'custom',name:'now',input_schema:{type:'object'}}],tool_choice:{type:'tool',name:'add',disable_parallel_tool_use:true},
    messages:[{role:'user',content:'2+3 and the time?'},{role:'assistant',content:[{type:'text',text:'Checking.'},{type:'tool_use',id:'toolu_a',name:'add',input:{a:2,b:3}},{type:'tool_use',id:'toolu_b',name:'now',input:{}}]},
      {role:'user',content:[{type:'tool_result',tool_use_id:'toolu_b',content:[{type:'text',text:'noon'}]},{type:'tool_result',tool_use_id:'toolu_a',content:'5'},{type:'text',text:'and now?'}]}]});
  expect(parsed.settings).toMatchObject({maxOutputTokens:null,toolChoice:{name:'add'},
    tools:[{name:'add',description:'Add.',parameters:{type:'object',properties:{a:{type:'integer'},b:{type:'integer'}},required:['a','b']}},{name:'now',description:'',parameters:{type:'object'}}]});
  // The caller's ids are kept and results follow their calls in call order; the output ceiling stays a generation request.
  expect(parsed.messages).toEqual([{role:'system',content:'be exact'},{role:'user',content:'2+3 and the time?'},
    {role:'assistant',content:'Checking.',toolCalls:[{id:'toolu_a',name:'add',arguments:{a:2,b:3}},{id:'toolu_b',name:'now',arguments:{}}]},
    {role:'tool',toolCallId:'toolu_a',content:'5'},{role:'tool',toolCallId:'toolu_b',content:'noon'},{role:'user',content:'and now?'}]);
  expect(parsed.generationRequest).toEqual({schema:'reploid.partition-generation-request/v1',maxOutputTokens:2,usage:'raw-model-tokens/v1'});
  expect(['auto','any','none'].map(type=>parseTextMessage({...input,tools:[add],tool_choice:{type}}).settings.toolChoice)).toEqual(['auto','required','none']);
  // Without tools the text contract is unchanged: no settings, and content blocks stay refused.
  expect(parseTextMessage(input)).not.toHaveProperty('settings');
  expect(parseTextMessage({...input,tools:[]})).not.toHaveProperty('settings');
});
it.each([
  ['a server tool',{tools:[{type:'web_search_20250305',name:'web_search'}]},'Only client tools'],
  ['a tool with cache control',{tools:[{...add,cache_control:{type:'ephemeral'}}]},'Only client tools'],
  ['a schema keyword the constraint does not support',{tools:[{...add,input_schema:{type:'object',properties:{s:{type:'string',format:'date'}}}}]},'Tool "add": Unsupported JSON Schema keyword "format"'],
  ['a bare string tool choice',{tools:[add],tool_choice:'auto'},'tool_choice must be'],
  ['a forced call without tools',{tool_choice:{type:'any'}},"toolChoice must be 'none' when no tools are declared"],
  ['a tool_use block in a user turn',{tools:[add],messages:[{role:'user',content:[{type:'tool_use',id:'t',name:'add',input:{}}]}]},'Only text blocks'],
  ['a tool_use input that is not an object',{tools:[add],messages:[{role:'user',content:'x'},{role:'assistant',content:[{type:'tool_use',id:'t',name:'add',input:'{}'}]},{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'5'}]}]},'needs an id, a name and an input object'],
  ['a tool_result after text',{tools:[add],messages:[{role:'user',content:'x'},{role:'assistant',content:[{type:'tool_use',id:'t',name:'add',input:{}}]},{role:'user',content:[{type:'text',text:'so'},{type:'tool_result',tool_use_id:'t',content:'5'}]}]},'must come before other content'],
  ['an error tool_result',{tools:[add],messages:[{role:'user',content:'x'},{role:'assistant',content:[{type:'tool_use',id:'t',name:'add',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'boom',is_error:true}]}]},'is_error is unsupported'],
  ['a tool_use left without its result',{tools:[add],messages:[{role:'user',content:'x'},{role:'assistant',content:[{type:'tool_use',id:'t',name:'add',input:{}}]},{role:'user',content:'next'}]},'exactly one tool result'],
  ['an image block',{tools:[add],messages:[{role:'user',content:[{type:'image',source:{}}]}]},'Only text blocks'],
  ['an empty content list',{tools:[add],messages:[{role:'user',content:[]}]},'Message content must be text or a list']
])('rejects %s with a 400',(_label,body,message)=>{
  let thrown;
  try{parseTextMessage({...input,...body});}catch(error){thrown=error;}
  expect(thrown?.status).toBe(400);expect(thrown.message).toContain(message);
});
